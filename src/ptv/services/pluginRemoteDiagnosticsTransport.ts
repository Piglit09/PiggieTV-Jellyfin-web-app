import { normalizePtvApiError, waitForCurrentPtvPluginApiClient } from '../core/pluginApi';
import {
    disposePtvRemoteDiagnosticsAgent,
    setPtvRemoteDiagnosticsTransport,
    startPtvRemoteDiagnosticsAgent,
    updatePtvRemoteDiagnosticsBootMarker,
    type PtvRemoteDiagnosticsCommand,
    type PtvRemoteDiagnosticsPresence
} from './remoteDiagnostics';
import type { PtvRemoteDiagnosticsPayload } from '../core/remoteDiagnosticsModel';

type RemoteDiagnosticsCapabilityStatus = {
    featureFlags?: Record<string, boolean>;
    features?: Record<string, boolean> | string[];
};

type PluginApiClient = Awaited<ReturnType<typeof waitForCurrentPtvPluginApiClient>>;

type CapabilityCacheEntry = {
    checkedAt: number;
    result: Promise<boolean>;
};

export type PtvRemoteDiagnosticsTransportDebug = {
    bootstrapLoaded: boolean;
    capabilityAdvertised: boolean | null;
    checkInEndpointUrl: string | null;
    detectedClientProfile: string | null;
    generatedClientId: string | null;
    lastFailureReason: string | null;
    lastHeartbeatAt: string | null;
    lastHeartbeatStatus: number | null;
    registrationAttempted: boolean;
};

const CAPABILITY_RECHECK_MS = 5 * 60 * 1000;
const capabilityChecks = new Map<string, CapabilityCacheEntry>();
const transportDebug: PtvRemoteDiagnosticsTransportDebug = {
    bootstrapLoaded: false,
    capabilityAdvertised: null,
    checkInEndpointUrl: null,
    detectedClientProfile: null,
    generatedClientId: null,
    lastFailureReason: null,
    lastHeartbeatAt: null,
    lastHeartbeatStatus: null,
    registrationAttempted: false
};

function copyTransportDebug() {
    return { ...transportDebug };
}

export function getPtvPluginRemoteDiagnosticsTransportDebug() {
    return copyTransportDebug();
}

function resetTransportDebug() {
    transportDebug.bootstrapLoaded = false;
    transportDebug.capabilityAdvertised = null;
    transportDebug.checkInEndpointUrl = null;
    transportDebug.detectedClientProfile = null;
    transportDebug.generatedClientId = null;
    transportDebug.lastFailureReason = null;
    transportDebug.lastHeartbeatAt = null;
    transportDebug.lastHeartbeatStatus = null;
    transportDebug.registrationAttempted = false;
}

function getErrorStatus(error: unknown) {
    if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') {
        return error.status;
    }

    return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getCommandValue(record: Record<string, unknown>, field: string) {
    if (record[field] !== undefined) return record[field];

    return record[`${field.charAt(0).toUpperCase()}${field.slice(1)}`];
}

function normalizeRemoteDiagnosticsCommand(value: unknown): PtvRemoteDiagnosticsCommand {
    if (!isRecord(value)) return {};

    const rawLease = getCommandValue(value, 'lease');
    const leaseRecord = isRecord(rawLease) ? rawLease : null;
    const profiles = leaseRecord ? getCommandValue(leaseRecord, 'profiles') : null;
    const command: PtvRemoteDiagnosticsCommand = {};
    const disable = getCommandValue(value, 'disable');
    const requestSnapshot = getCommandValue(value, 'requestSnapshot');

    if (typeof disable === 'boolean') command.disable = disable;
    if (rawLease === null) command.lease = null;
    if (leaseRecord) {
        command.lease = {
            durationMs: Number(getCommandValue(leaseRecord, 'durationMs')) || 0,
            enabled: getCommandValue(leaseRecord, 'enabled') === true,
            expiresAt: Number(getCommandValue(leaseRecord, 'expiresAt')) || 0,
            issuedAt: Number(getCommandValue(leaseRecord, 'issuedAt')) || 0,
            profiles: (Array.isArray(profiles) ?
                profiles.filter((entry): entry is string => typeof entry === 'string') : []) as
                NonNullable<PtvRemoteDiagnosticsCommand['lease']>['profiles'],
            sessionId: typeof getCommandValue(leaseRecord, 'sessionId') === 'string' ?
                getCommandValue(leaseRecord, 'sessionId') as string : ''
        };
    }
    if (typeof requestSnapshot === 'boolean') command.requestSnapshot = requestSnapshot;

    return command;
}

function statusSupportsRemoteDiagnostics(status: RemoteDiagnosticsCapabilityStatus) {
    if (typeof status.featureFlags?.remoteDiagnostics === 'boolean') {
        return status.featureFlags.remoteDiagnostics;
    }
    if (Array.isArray(status.features)) return status.features.includes('remoteDiagnostics');

    return status.features?.remoteDiagnostics === true;
}

function supportsRemoteDiagnostics(pluginApi: PluginApiClient) {
    // getCurrentPtvPluginApiClient returns a fresh wrapper on each call. Key the
    // capability by its resolved server/plugin URL so 30-second check-ins reuse
    // one status result while a server switch naturally gets a separate entry.
    const capabilityKey = pluginApi.getRemoteDiagnosticsReportDownloadUrl('capability-probe');
    const cached = capabilityChecks.get(capabilityKey);

    if (cached && Date.now() - cached.checkedAt < CAPABILITY_RECHECK_MS) return cached.result;

    const check = pluginApi.getStatus<RemoteDiagnosticsCapabilityStatus>({ bypassCache: true })
        .then(status => {
            const supported = statusSupportsRemoteDiagnostics(status);
            transportDebug.capabilityAdvertised = supported;
            if (!supported) transportDebug.lastFailureReason = 'remote-diagnostics-capability-not-advertised';

            return supported;
        })
        .catch((error: unknown) => {
            if (normalizePtvApiError(error).kind === 'missing') return false;

            capabilityChecks.delete(capabilityKey);
            transportDebug.capabilityAdvertised = null;
            transportDebug.lastFailureReason = normalizePtvApiError(error).message || 'remote-diagnostics-capability-check-failed';
            throw error;
        });

    capabilityChecks.set(capabilityKey, {
        checkedAt: Date.now(),
        result: check
    });
    return check;
}

/**
 * Connects the opt-in client collector to the authenticated, same-server plugin API.
 * Presence remains deliberately small; full reports are sent only during a temporary lease.
 */
export function startPtvPluginRemoteDiagnosticsTransport() {
    resetTransportDebug();
    startPtvRemoteDiagnosticsAgent();
    transportDebug.bootstrapLoaded = true;
    setPtvRemoteDiagnosticsTransport({
        async checkIn(presence: PtvRemoteDiagnosticsPresence) {
            const pluginApi = await waitForCurrentPtvPluginApiClient();

            transportDebug.registrationAttempted = true;
            transportDebug.generatedClientId = presence.clientId || null;
            transportDebug.detectedClientProfile = presence.profile?.kind || null;
            transportDebug.checkInEndpointUrl = pluginApi.getRemoteDiagnosticsCheckInUrl();
            updatePtvRemoteDiagnosticsBootMarker({
                checkInAttempted: true,
                checkInStatus: null,
                failureCode: null
            });

            if (!await supportsRemoteDiagnostics(pluginApi)) {
                updatePtvRemoteDiagnosticsBootMarker({
                    failureCode: 'remote-diagnostics-capability-not-advertised'
                });
                return { disable: true };
            }

            try {
                const rawCommand = await pluginApi.checkInRemoteDiagnostics<unknown, PtvRemoteDiagnosticsPresence>(presence, {
                    bypassCache: true
                });
                const command = normalizeRemoteDiagnosticsCommand(rawCommand);

                transportDebug.lastFailureReason = null;
                transportDebug.lastHeartbeatAt = new Date().toISOString();
                transportDebug.lastHeartbeatStatus = 200;
                updatePtvRemoteDiagnosticsBootMarker({
                    checkInStatus: 200,
                    failureCode: null
                });

                return command;
            } catch (error) {
                const normalized = normalizePtvApiError(error);

                transportDebug.lastFailureReason = normalized.message || normalized.kind || 'remote-diagnostics-check-in-failed';
                transportDebug.lastHeartbeatStatus = getErrorStatus(error);
                updatePtvRemoteDiagnosticsBootMarker({
                    checkInStatus: getErrorStatus(error),
                    failureCode: normalized.kind || 'remote-diagnostics-check-in-failed'
                });
                throw error;
            }
        },
        async publishSnapshot(payload: PtvRemoteDiagnosticsPayload) {
            const pluginApi = await waitForCurrentPtvPluginApiClient();

            if (!await supportsRemoteDiagnostics(pluginApi)) return;

            await pluginApi.publishRemoteDiagnosticsReport(payload, { bypassCache: true });
        }
    });

    return () => {
        setPtvRemoteDiagnosticsTransport(null);
        disposePtvRemoteDiagnosticsAgent();
    };
}
