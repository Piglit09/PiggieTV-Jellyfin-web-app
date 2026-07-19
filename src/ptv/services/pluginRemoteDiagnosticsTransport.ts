import { normalizePtvApiError, waitForCurrentPtvPluginApiClient } from '../core/pluginApi';
import {
    disposePtvRemoteDiagnosticsAgent,
    setPtvRemoteDiagnosticsTransport,
    startPtvRemoteDiagnosticsAgent,
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

const CAPABILITY_RECHECK_MS = 5 * 60 * 1000;
const capabilityChecks = new Map<string, CapabilityCacheEntry>();

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
        .then(statusSupportsRemoteDiagnostics)
        .catch((error: unknown) => {
            if (normalizePtvApiError(error).kind === 'missing') return false;

            capabilityChecks.delete(capabilityKey);
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
    startPtvRemoteDiagnosticsAgent();
    setPtvRemoteDiagnosticsTransport({
        async checkIn(presence: PtvRemoteDiagnosticsPresence) {
            const pluginApi = await waitForCurrentPtvPluginApiClient();

            if (!await supportsRemoteDiagnostics(pluginApi)) return { disable: true };

            return pluginApi.checkInRemoteDiagnostics<PtvRemoteDiagnosticsCommand, PtvRemoteDiagnosticsPresence>(presence, {
                bypassCache: true
            });
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
