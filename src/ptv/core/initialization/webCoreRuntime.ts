import { getCurrentPtvApiClient, getPtvCurrentUserId, getPtvServerId } from '../../api/client';
import { startPtvRouteController } from '../../shell/routeController';
import { startPtvPlaybackStateService } from '../../services/playbackStateService';
import { initializePtvLibraryIndexCache } from '../../utils/libraryIndexCache';
import {
    disposePtvWebDiagnosticPlatformForTests,
    initializePtvWebDiagnosticPlatform,
    recordPtvCoreInitializationDiagnostic
} from '../../services/diagnostics/webDiagnosticPlatform';
import { getPtvWebCapabilityReport } from '../capabilities/webCapabilityAdapter';
import type { PtvClientCapabilityReport } from '../capabilities/clientCapabilities';
import type { PtvCoreScope } from '../contracts/version';
import { createPtvDiagnosticEvent, type PtvDiagnosticEvent } from '../diagnostics/diagnosticEvent';
import {
    createPtvFeatureFlagDocument,
    type PtvFeatureFlagDocument
} from '../featureFlags/featureFlagContracts';
import {
    applyPtvFeatureSettings,
    getPtvFeatureSettings,
    PTV_FEATURE_SETTINGS_CHANGE_EVENT,
    type PtvFeatureSettings
} from '../featureSettings';
import { recordPtvEvent } from '../observability';
import { registerPtvRuntimeListener } from '../runtime';
import type { PtvSettingsDocument } from '../settings/settingsContracts';
import {
    createPtvCoreInitializer,
    type PtvCoreInitializationAdapter,
    type PtvCoreInitializationEvent,
    type PtvCoreInitializationHandler,
    type PtvCoreInitializationResult
} from './coreInitialization';

type PtvWebCoreRuntimeSnapshot = {
    capabilityReport: PtvClientCapabilityReport | null;
    diagnosticEvent: PtvDiagnosticEvent | null;
    featureFlags: PtvFeatureFlagDocument | null;
    initializationEvents: PtvCoreInitializationEvent[];
    result: PtvCoreInitializationResult | null;
    settings: PtvSettingsDocument<Record<string, unknown>> | null;
};

export type PtvWebCoreRuntimeDependencies = {
    api?: PtvCoreInitializationHandler;
    cache?: PtvCoreInitializationHandler;
    deviceIdentity?: PtvCoreInitializationHandler;
    diagnostics?: PtvCoreInitializationHandler;
    environment?: PtvCoreInitializationHandler;
    getCapabilityReport?: () => PtvClientCapabilityReport;
    getScope?: () => PtvCoreScope;
    getSettings?: () => PtvFeatureSettings;
    navigation?: PtvCoreInitializationHandler;
    playback?: PtvCoreInitializationHandler;
    registerSettingsListener?: (listener: () => void) => () => void;
    session?: PtvCoreInitializationHandler;
    settings?: PtvCoreInitializationHandler;
};

type PtvWebCoreRuntime = ReturnType<typeof createPtvWebCoreRuntime>;

type PtvCoreRuntimeWindow = Window & Partial<
    Record<'__PTV_CORE_RUNTIME_ADOPTION__', PtvWebCoreRuntime>
>;

function getDefaultScope(): PtvCoreScope {
    const serverId = getPtvServerId();
    const userId = getPtvCurrentUserId();

    if (serverId && userId) return { kind: 'user', serverId, userId };
    if (serverId) return { kind: 'server', serverId };

    return { kind: 'device', deviceId: window.location.host || 'web' };
}

function toBooleanFeatureFlags(settings: PtvFeatureSettings) {
    return Object.fromEntries(
        Object.entries(settings).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
    );
}

function defaultSettingsListener(listener: () => void) {
    return registerPtvRuntimeListener('ptv-core:feature-settings', () => {
        window.addEventListener(PTV_FEATURE_SETTINGS_CHANGE_EVENT, listener);

        return () => window.removeEventListener(PTV_FEATURE_SETTINGS_CHANGE_EVENT, listener);
    });
}

export function createPtvWebCoreRuntime(dependencies: PtvWebCoreRuntimeDependencies = {}) {
    const snapshot: PtvWebCoreRuntimeSnapshot = {
        capabilityReport: null,
        diagnosticEvent: null,
        featureFlags: null,
        initializationEvents: [],
        result: null,
        settings: null
    };
    let settingsListenerDisposer: (() => void) | null = null;

    const getScope = dependencies.getScope || getDefaultScope;
    const getSettings = dependencies.getSettings || getPtvFeatureSettings;
    const updateSettingsAdapters = () => {
        const values = getSettings();
        const scope = getScope();

        applyPtvFeatureSettings(values);
        snapshot.settings = {
            schemaVersion: 1,
            scope,
            unknownFields: {},
            values: { ...values }
        };
        snapshot.featureFlags = createPtvFeatureFlagDocument({
            scope,
            values: toBooleanFeatureFlags(values)
        });
    };

    const adapter: PtvCoreInitializationAdapter = {
        environment: dependencies.environment || (() => {
            snapshot.capabilityReport = (dependencies.getCapabilityReport || getPtvWebCapabilityReport)();
        }),
        deviceIdentity: dependencies.deviceIdentity || (() => {
            getScope();
        }),
        session: dependencies.session || (() => {
            // Existing Jellyfin session restoration and login routing remain authoritative.
            getCurrentPtvApiClient();
        }),
        settings: dependencies.settings || (() => {
            updateSettingsAdapters();
            if (!settingsListenerDisposer) {
                settingsListenerDisposer = (dependencies.registerSettingsListener || defaultSettingsListener)(
                    updateSettingsAdapters
                );
            }
        }),
        cache: dependencies.cache || (async () => {
            if (!await initializePtvLibraryIndexCache()) {
                throw new Error('IndexedDB library cache is unavailable.');
            }
        }),
        api: dependencies.api || (() => {
            // API client creation and authentication remain owned by Jellyfin.
            getCurrentPtvApiClient();
        }),
        diagnostics: dependencies.diagnostics || (() => {
            initializePtvWebDiagnosticPlatform();
            const capabilityReport = snapshot.capabilityReport || getPtvWebCapabilityReport();
            snapshot.diagnosticEvent = createPtvDiagnosticEvent({
                appVersion: typeof __PTV_VERSION__ === 'string' ? __PTV_VERSION__ : 'unknown',
                category: 'startup',
                deviceClass: capabilityReport.deviceClass,
                metadata: {
                    adapter: 'web',
                    capabilityCount: Object.keys(capabilityReport.capabilities).length
                },
                name: 'core-runtime-initialized',
                platform: capabilityReport.platform,
                sessionId: 'existing-web-session',
                success: true
            });
            recordPtvEvent('profile', 'core-runtime-diagnostic', snapshot.diagnosticEvent);
        }),
        navigation: dependencies.navigation || (() => {
            startPtvRouteController();
        }),
        playback: dependencies.playback || (() => {
            startPtvPlaybackStateService();
        }),
        dispose: () => {
            settingsListenerDisposer?.();
            settingsListenerDisposer = null;
            disposePtvWebDiagnosticPlatformForTests();
        }
    };
    const initializer = createPtvCoreInitializer(adapter, {
        observer: event => {
            snapshot.initializationEvents.push(event);
            recordPtvCoreInitializationDiagnostic(event);
            if (event.type === 'completed') snapshot.result = event.result;
        }
    });

    return {
        async dispose() {
            await initializer.dispose();
            snapshot.result = null;
        },
        getSnapshot() {
            return {
                ...snapshot,
                initializationEvents: [...snapshot.initializationEvents]
            };
        },
        initialize() {
            return initializer.initialize();
        }
    };
}

export function getPtvWebCoreRuntime() {
    const runtimeWindow = window as PtvCoreRuntimeWindow;

    runtimeWindow.__PTV_CORE_RUNTIME_ADOPTION__ ||= createPtvWebCoreRuntime();

    return runtimeWindow.__PTV_CORE_RUNTIME_ADOPTION__;
}

export function initializePtvWebCoreRuntime() {
    return getPtvWebCoreRuntime().initialize();
}

export async function resetPtvWebCoreRuntimeForTests() {
    const runtimeWindow = window as PtvCoreRuntimeWindow;

    await runtimeWindow.__PTV_CORE_RUNTIME_ADOPTION__?.dispose();
    delete runtimeWindow.__PTV_CORE_RUNTIME_ADOPTION__;
}
