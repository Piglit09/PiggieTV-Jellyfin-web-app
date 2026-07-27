import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import type { PtvClientKind } from '../../core/clientProfile';
import { PTV_RUNTIME } from '../../core/config';
import { isPtvDebugEnabled } from '../../core/observability';
import { getCurrentPtvPluginApiClient, normalizePtvApiError } from '../../core/pluginApi';

let remoteDiagnosticsRefreshInFlight: Promise<[unknown, unknown, DiagnosticsStorageStatus | null]> | null = null;
let remoteDiagnosticsRefreshProfile = '';
let remoteDiagnosticsExportInFlight = false;

type RemoteDiagnosticsClient = {
    boot: RemoteDiagnosticsBootMarker;
    capabilityMode: DiagnosticsCapabilityMode;
    applicationName: string;
    applicationVersion: string;
    capabilities: RemoteDiagnosticsClientCapabilities;
    clientId: string;
    deviceName: string;
    diagnosticsActive: boolean;
    displayName: string;
    expiresAtUtc: string | null;
    firstSeenUtc: string;
    hasReport: boolean;
    lastSeenUtc: string;
    lastLeaseRejection: string | null;
    leasePending: boolean;
    online: boolean;
    platform: string;
    profile: PtvClientKind | 'unknown';
    reportedAtUtc: string | null;
    route: string;
    sessionId: string | null;
    snapshotPending: boolean;
};

type DiagnosticsCapabilityMode = 'full-native' | 'full-web' | 'server-observed' | 'stale-build' | 'unsupported';

type RemoteDiagnosticsBootMarker = {
    checkInAttempted: boolean;
    checkInStatus: number | null;
    diagnosticsModuleLoaded: boolean;
    failureCode: string | null;
    frontendBuildId: string;
    loadedClientBuildId: string;
    platformDetected: string;
    ptvRuntimeLoaded: boolean;
    remoteDiagnosticsRegistrationCount: number;
};

type RemoteDiagnosticsClientCapabilities = {
    heartbeat: boolean;
    memoryMetrics: boolean;
    navigationTiming: boolean;
    networkTiming: boolean;
    performanceMetrics: boolean;
    physicalLayoutSnapshot: boolean;
    playbackTelemetry: boolean;
    remoteCommands: boolean;
    reportExport: boolean;
};

type DetectedJellyfinSession = {
    applicationName: string;
    applicationVersion: string;
    capabilityMode: DiagnosticsCapabilityMode;
    deviceId: string;
    deviceName: string;
    explanation: string;
    id: string;
    lastActivityDate: string;
    matchingDiagnosticsClientId: string | null;
    playbackState: string;
    platform: string;
};

type StoredRemoteDiagnosticsReport = {
    clientId: string;
    receivedAtUtc: string;
    report: unknown;
};

type PhysicalLayoutSnapshotSummary = {
    cssOwnershipStatus: 'unsupported';
    firstShelfTop: number | null;
    issueCodes: string[];
    latestMilestone: string;
    milestoneCount: number;
    shellBrandHeight: number | null;
    shellBrandWidth: number | null;
    status: 'healthy' | 'regression' | 'unavailable' | 'warning';
    viewportHeight: number | null;
    viewportWidth: number | null;
};

type BusyAction = 'clear-storage' | 'consolidate-storage' | 'download' | 'refresh' | 'refresh-storage' | 'report' | 'rotate-storage' | 'snapshot' | 'start' | 'stop' | null;
type ClientLoadState = 'empty' | 'error' | 'loading' | 'success';
type SessionsLoadState = 'empty' | 'error' | 'loading' | 'success';
type RemoteDiagnosticsSource = 'jellyfin' | 'local-cache' | 'plugin-cache' | 'recommendation';

type DiagnosticsStorageStatus = {
    activeFileSizeBytes: number;
    activeLogPath: string;
    duplicateEventsSuppressed: number;
    eventsAggregated: number;
    eventsDropped: number;
    eventsQueued: number;
    eventsWritten: number;
    lastRotationUtc: string | null;
    legacyFileCount: number;
    legacyFileSizeBytes: number;
    oldestRetainedAtUtc: string | null;
    retentionDays: number;
    rotatedFileCount: number;
    totalRetainedBytes: number;
    writeFailures: number;
};

const REMOTE_DIAGNOSTICS_COMPONENT = 'RemoteDiagnosticsPanel';
const REMOTE_DIAGNOSTICS_SOURCE: RemoteDiagnosticsSource = 'plugin-cache';
const REMOTE_DIAGNOSTICS_ITEM_TYPE = 'remote-diagnostics-client';
const PHYSICAL_LAYOUT_ISSUE_LABELS: Record<string, string> = {
    'duplicate-shell': 'multiple shell headers',
    'first-shelf-after-viewport': 'first shelf starts below the TV viewport',
    'first-shelf-missing': 'first shelf was not present',
    'focus-not-visible': 'focused control has no detected focus indicator',
    'focus-outside-viewport': 'focused control is outside the viewport',
    'hero-content-obscured-by-shell-brand': 'shell branding overlaps hero content',
    'legacy-header-visible': 'legacy Jellyfin header is visible',
    'shell-brand-outside-header': 'shell branding escapes the header bounds',
    'shell-brand-oversized': 'shell branding is oversized'
};
const PHYSICAL_LAYOUT_STATUS_LABELS = {
    healthy: 'Layout invariants passed.',
    regression: 'Layout regression detected.',
    unavailable: 'Layout evidence is unavailable.',
    warning: 'Layout evidence needs review.'
} as const;
const PHYSICAL_LAYOUT_STATUS_SEVERITIES = {
    healthy: 'success',
    regression: 'error',
    unavailable: 'warning',
    warning: 'warning'
} as const;

const PROFILE_FILTERS: Array<{ label: string; value: '' | PtvClientKind }> = [
    { label: 'All profiles', value: '' },
    { label: 'webOS', value: 'webos' },
    { label: 'Fire TV', value: 'firetv' },
    { label: 'TV / ten-foot', value: 'tv' },
    { label: 'Mobile', value: 'mobile' },
    { label: 'Desktop', value: 'desktop' }
];

function formatTimestamp(value: string | null | undefined) {
    if (!value) return 'n/a';

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatBytes(value: number) {
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const exponent = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
    return `${(value / (1024 ** exponent)).toFixed(exponent ? 1 : 0)} ${units[exponent]}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getCurrentRoute() {
    return `${window.location.pathname}${window.location.hash}${window.location.search}` || '/';
}

function shouldLogMalformedRemoteDiagnosticsItem() {
    return PTV_RUNTIME.mode === 'development' || isPtvDebugEnabled();
}

function warnMalformedRemoteDiagnosticsItem(options: {
    itemId?: string;
    missingProperty: string;
    sourceRow: string;
}) {
    if (!shouldLogMalformedRemoteDiagnosticsItem()) return;

    console.warn('[PiggieTV Dashboard] Malformed remote diagnostics client skipped or normalized.', {
        componentName: REMOTE_DIAGNOSTICS_COMPONENT,
        itemId: options.itemId || '[missing]',
        itemType: REMOTE_DIAGNOSTICS_ITEM_TYPE,
        missingProperty: options.missingProperty,
        route: getCurrentRoute(),
        source: REMOTE_DIAGNOSTICS_SOURCE,
        sourceRow: options.sourceRow
    });
}

function getSafeString(value: unknown, fallback = '') {
    return typeof value === 'string' ? value : fallback;
}

function getSafeNullableString(value: unknown) {
    return typeof value === 'string' ? value : null;
}

function getSafeBoolean(value: unknown) {
    return typeof value === 'boolean' ? value : false;
}

function getSafeNumber(value: unknown, fallback = 0) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getOptionalSafeNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function getRemoteDiagnosticsResponseValue(record: Record<string, unknown>, field: string) {
    if (record[field] !== undefined) return record[field];

    const pascalField = `${field.charAt(0).toUpperCase()}${field.slice(1)}`;

    return record[pascalField];
}

function normalizeStoredRemoteDiagnosticsReport(value: unknown): StoredRemoteDiagnosticsReport | null {
    if (!isRecord(value)) return null;

    const clientId = getSafeString(getRemoteDiagnosticsResponseValue(value, 'clientId')).trim();
    const receivedAtUtc = getSafeString(getRemoteDiagnosticsResponseValue(value, 'receivedAtUtc')).trim();
    const report = getRemoteDiagnosticsResponseValue(value, 'report');

    if (!clientId || !receivedAtUtc || report === undefined) return null;

    return { clientId, receivedAtUtc, report };
}

function normalizePhysicalLayoutSnapshot(report: unknown): PhysicalLayoutSnapshotSummary | null {
    if (!isRecord(report) || !isRecord(report.physicalLayoutSnapshot)) return null;

    const snapshot = report.physicalLayoutSnapshot;
    if (snapshot.capability !== 'physicalLayoutSnapshot') return null;

    const status = snapshot.status === 'healthy'
        || snapshot.status === 'regression'
        || snapshot.status === 'warning'
        || snapshot.status === 'unavailable' ? snapshot.status : 'unavailable';
    const milestones = Array.isArray(snapshot.milestones) ? snapshot.milestones.slice(0, 8) : [];
    const latestMilestone = milestones.find(entry => isRecord(entry) && entry.key === snapshot.latestMilestone)
        || milestones[milestones.length - 1];
    const milestoneRecord = isRecord(latestMilestone) ? latestMilestone : {};
    const viewport = isRecord(milestoneRecord.viewport) ? milestoneRecord.viewport : {};
    const nodes = Array.isArray(milestoneRecord.nodes) ? milestoneRecord.nodes : [];
    const getNodeRect = (key: string) => {
        const node = nodes.find(entry => isRecord(entry) && entry.key === key);
        return isRecord(node) && isRecord(node.rect) ? node.rect : {};
    };
    const shellBrandRect = getNodeRect('shellBrand');
    const firstShelfRect = getNodeRect('firstShelf');
    const issueCodes = Array.isArray(snapshot.issueCodes) ? snapshot.issueCodes
        .filter((issue): issue is string => typeof issue === 'string' && issue in PHYSICAL_LAYOUT_ISSUE_LABELS)
        .slice(0, 12) : [];

    return {
        cssOwnershipStatus: 'unsupported',
        firstShelfTop: getOptionalSafeNumber(firstShelfRect.top),
        issueCodes,
        latestMilestone: typeof snapshot.latestMilestone === 'string' ? snapshot.latestMilestone : 'none',
        milestoneCount: milestones.length,
        shellBrandHeight: getOptionalSafeNumber(shellBrandRect.height),
        shellBrandWidth: getOptionalSafeNumber(shellBrandRect.width),
        status,
        viewportHeight: getOptionalSafeNumber(viewport.height),
        viewportWidth: getOptionalSafeNumber(viewport.width)
    };
}

function normalizeClientCapabilities(value: unknown): RemoteDiagnosticsClientCapabilities {
    const record = isRecord(value) ? value : {};

    return {
        heartbeat: getSafeBoolean(getRemoteDiagnosticsResponseValue(record, 'heartbeat')),
        memoryMetrics: getSafeBoolean(getRemoteDiagnosticsResponseValue(record, 'memoryMetrics')),
        navigationTiming: getSafeBoolean(getRemoteDiagnosticsResponseValue(record, 'navigationTiming')),
        networkTiming: getSafeBoolean(getRemoteDiagnosticsResponseValue(record, 'networkTiming')),
        performanceMetrics: getSafeBoolean(getRemoteDiagnosticsResponseValue(record, 'performanceMetrics')),
        physicalLayoutSnapshot: getSafeBoolean(getRemoteDiagnosticsResponseValue(record, 'physicalLayoutSnapshot')),
        playbackTelemetry: getSafeBoolean(getRemoteDiagnosticsResponseValue(record, 'playbackTelemetry')),
        remoteCommands: getSafeBoolean(getRemoteDiagnosticsResponseValue(record, 'remoteCommands')),
        reportExport: getSafeBoolean(getRemoteDiagnosticsResponseValue(record, 'reportExport'))
    };
}

function normalizeBootMarker(value: unknown): RemoteDiagnosticsBootMarker {
    const record = isRecord(value) ? value : {};

    return {
        checkInAttempted: getSafeBoolean(getRemoteDiagnosticsResponseValue(record, 'checkInAttempted')),
        checkInStatus: getOptionalSafeNumber(getRemoteDiagnosticsResponseValue(record, 'checkInStatus')),
        diagnosticsModuleLoaded: getSafeBoolean(getRemoteDiagnosticsResponseValue(record, 'diagnosticsModuleLoaded')),
        failureCode: getSafeNullableString(getRemoteDiagnosticsResponseValue(record, 'failureCode')),
        frontendBuildId: getSafeString(getRemoteDiagnosticsResponseValue(record, 'frontendBuildId'), 'unknown'),
        loadedClientBuildId: getSafeString(getRemoteDiagnosticsResponseValue(record, 'loadedClientBuildId'), 'unknown'),
        platformDetected: getSafeString(getRemoteDiagnosticsResponseValue(record, 'platformDetected'), 'unknown'),
        ptvRuntimeLoaded: getSafeBoolean(getRemoteDiagnosticsResponseValue(record, 'ptvRuntimeLoaded')),
        remoteDiagnosticsRegistrationCount: getSafeNumber(getRemoteDiagnosticsResponseValue(record, 'remoteDiagnosticsRegistrationCount'))
    };
}

function getSafeProfile(value: unknown) {
    const profile = getSafeString(value, 'unknown');

    return PROFILE_FILTERS.some(option => option.value === profile) || profile === 'unknown' ?
        profile as PtvClientKind | 'unknown' :
        'unknown';
}

function getSafeCapabilityMode(value: unknown): DiagnosticsCapabilityMode {
    const mode = getSafeString(value);

    return mode === 'full-native'
        || mode === 'full-web'
        || mode === 'server-observed'
        || mode === 'stale-build'
        || mode === 'unsupported' ? mode : 'full-web';
}

function warnMissingDisplayField(record: Record<string, unknown>, field: string, itemId: string, sourceRow: string) {
    const value = getRemoteDiagnosticsResponseValue(record, field);
    if (value !== undefined && value !== null) return;

    warnMalformedRemoteDiagnosticsItem({
        itemId,
        missingProperty: field,
        sourceRow
    });
}

function normalizeRemoteDiagnosticsClients(value: unknown) {
    if (!Array.isArray(value)) {
        warnMalformedRemoteDiagnosticsItem({
            missingProperty: 'clients',
            sourceRow: 'remote-diagnostics-clients'
        });

        return [];
    }

    const seenClientIds = new Set<string>();
    const clients: RemoteDiagnosticsClient[] = [];

    value.forEach((entry, index) => {
        const sourceRow = `remote-diagnostics-clients[${index}]`;

        if (!isRecord(entry)) {
            warnMalformedRemoteDiagnosticsItem({
                missingProperty: 'client',
                sourceRow
            });
            return;
        }

        const clientId = getSafeString(getRemoteDiagnosticsResponseValue(entry, 'clientId')).trim();
        if (!clientId) {
            warnMalformedRemoteDiagnosticsItem({
                missingProperty: 'clientId',
                sourceRow
            });
            return;
        }

        if (seenClientIds.has(clientId)) {
            warnMalformedRemoteDiagnosticsItem({
                itemId: clientId,
                missingProperty: 'uniqueClientId',
                sourceRow
            });
            return;
        }
        seenClientIds.add(clientId);

        warnMissingDisplayField(entry, 'lastSeenUtc', clientId, sourceRow);
        warnMissingDisplayField(entry, 'profile', clientId, sourceRow);
        warnMissingDisplayField(entry, 'route', clientId, sourceRow);

        clients.push({
            applicationName: getSafeString(getRemoteDiagnosticsResponseValue(entry, 'applicationName'), 'PiggieTV'),
            applicationVersion: getSafeString(getRemoteDiagnosticsResponseValue(entry, 'applicationVersion')),
            boot: normalizeBootMarker(getRemoteDiagnosticsResponseValue(entry, 'boot')),
            capabilityMode: getSafeCapabilityMode(getRemoteDiagnosticsResponseValue(entry, 'capabilityMode')),
            capabilities: normalizeClientCapabilities(getRemoteDiagnosticsResponseValue(entry, 'capabilities')),
            clientId,
            deviceName: getSafeString(getRemoteDiagnosticsResponseValue(entry, 'deviceName')),
            diagnosticsActive: getSafeBoolean(getRemoteDiagnosticsResponseValue(entry, 'diagnosticsActive')),
            displayName: getSafeString(getRemoteDiagnosticsResponseValue(entry, 'displayName'), `PiggieTV client ${clientId.slice(-8)}`),
            expiresAtUtc: getSafeNullableString(getRemoteDiagnosticsResponseValue(entry, 'expiresAtUtc')),
            firstSeenUtc: getSafeString(getRemoteDiagnosticsResponseValue(entry, 'firstSeenUtc')),
            hasReport: getSafeBoolean(getRemoteDiagnosticsResponseValue(entry, 'hasReport')),
            lastLeaseRejection: getSafeNullableString(getRemoteDiagnosticsResponseValue(entry, 'lastLeaseRejection')),
            lastSeenUtc: getSafeString(getRemoteDiagnosticsResponseValue(entry, 'lastSeenUtc')),
            leasePending: getSafeBoolean(getRemoteDiagnosticsResponseValue(entry, 'leasePending')),
            online: getSafeBoolean(getRemoteDiagnosticsResponseValue(entry, 'online')),
            platform: getSafeString(getRemoteDiagnosticsResponseValue(entry, 'platform'), 'unknown'),
            profile: getSafeProfile(getRemoteDiagnosticsResponseValue(entry, 'profile')),
            reportedAtUtc: getSafeNullableString(getRemoteDiagnosticsResponseValue(entry, 'reportedAtUtc')),
            route: getSafeString(getRemoteDiagnosticsResponseValue(entry, 'route'), '/unknown'),
            sessionId: getSafeNullableString(getRemoteDiagnosticsResponseValue(entry, 'sessionId')),
            snapshotPending: getSafeBoolean(getRemoteDiagnosticsResponseValue(entry, 'snapshotPending'))
        });
    });

    return clients.sort((left, right) => {
        const leftTime = Date.parse(left.lastSeenUtc) || 0;
        const rightTime = Date.parse(right.lastSeenUtc) || 0;

        return rightTime - leftTime;
    });
}

function getShortClientId(client: RemoteDiagnosticsClient) {
    const clientId = getSafeString(client.clientId);

    return clientId.slice(-8) || 'unknown';
}

function formatClientOption(client: RemoteDiagnosticsClient, duplicateDisplayName = false) {
    const lastSeen = formatTimestamp(client.lastSeenUtc);
    const appLabel = client.applicationVersion ?
        `${client.applicationName} ${client.applicationVersion}` :
        client.applicationName;
    const duplicateSuffix = duplicateDisplayName ? ` | id ${getShortClientId(client)}` : '';

    return `${client.displayName}${duplicateSuffix} | ${client.platform} | ${appLabel} | ${client.online ? 'online' : lastSeen}`;
}

function getCapabilityLabels(client: RemoteDiagnosticsClient) {
    const entries: Array<[keyof RemoteDiagnosticsClientCapabilities, string]> = [
        ['heartbeat', 'heartbeat'],
        ['remoteCommands', 'commands'],
        ['reportExport', 'reports'],
        ['performanceMetrics', 'performance'],
        ['physicalLayoutSnapshot', 'physical layout'],
        ['networkTiming', 'network'],
        ['playbackTelemetry', 'playback'],
        ['memoryMetrics', 'memory']
    ];

    return entries
        .filter(([key]) => client.capabilities[key])
        .map(([, label]) => label);
}

function getSessionPlatform(applicationName: string, deviceName: string) {
    const combined = `${applicationName} ${deviceName}`.toLowerCase();

    if (combined.includes('webos') || combined.includes('lg smart tv')) return 'webOS';
    if (combined.includes('fire tv') || combined.includes('amazon') || combined.includes('android tv')) return 'Fire TV / Android TV';

    return 'Jellyfin client';
}

function getSessionPlaybackState(record: Record<string, unknown>) {
    if (isRecord(record.NowPlayingItem) || isRecord(record.nowPlayingItem)) return 'playing';
    let playState: Record<string, unknown> = {};

    if (isRecord(record.PlayState)) {
        playState = record.PlayState;
    } else if (isRecord(record.playState)) {
        playState = record.playState;
    }

    if (getSafeBoolean(playState.IsPaused) || getSafeBoolean(playState.isPaused)) return 'paused';

    return 'connected';
}

function findMatchingDiagnosticsClient(
    session: Pick<DetectedJellyfinSession, 'applicationName' | 'deviceName'>,
    clients: RemoteDiagnosticsClient[]
): RemoteDiagnosticsClient | null {
    const sessionDevice = session.deviceName.toLowerCase();
    const sessionApp = session.applicationName.toLowerCase();

    return clients.find(client => {
        const clientDevice = `${client.displayName} ${client.deviceName}`.toLowerCase();
        const clientApp = client.applicationName.toLowerCase();

        return (sessionDevice.length > 0 && clientDevice.includes(sessionDevice))
            || (sessionApp.length > 0 && clientApp === sessionApp && clientDevice.includes(sessionDevice));
    }) || null;
}

function getDetectedSessionModeAndExplanation(
    session: Pick<DetectedJellyfinSession, 'applicationName' | 'applicationVersion' | 'deviceName'>,
    match: RemoteDiagnosticsClient | null
) {
    if (match) {
        return {
            capabilityMode: match.capabilityMode,
            explanation: `${session.deviceName} has completed a real PTV diagnostics check-in and is diagnostics ready.`
        };
    }

    const appLabel = `${session.applicationName} ${session.applicationVersion}`.trim();
    const appLower = session.applicationName.toLowerCase();
    const deviceLower = session.deviceName.toLowerCase();

    if (appLower.includes('android tv') || deviceLower.includes('fire tv')) {
        return {
            capabilityMode: 'unsupported' as const,
            explanation: `${session.deviceName} is connected through ${appLabel}, but that native app does not currently include the PTV diagnostics client.`
        };
    }

    if (appLower.includes('webos') || deviceLower.includes('lg smart tv')) {
        return {
            capabilityMode: 'unsupported' as const,
            explanation: `${session.deviceName} is connected through ${appLabel}. Jellyfin for webOS is a server-web wrapper, but this session has not produced a PTV runtime/check-in marker; fully restart the app or clear its cached server assets, then verify the loaded build.`
        };
    }

    return {
        capabilityMode: 'server-observed' as const,
        explanation: `${session.deviceName} is visible only through Jellyfin session data. Server-observed mode is limited to session/playback state.`
    };
}

function normalizeDetectedJellyfinSessions(value: unknown, clients: RemoteDiagnosticsClient[]) {
    if (!Array.isArray(value)) return [];

    return value.flatMap((entry, index): DetectedJellyfinSession[] => {
        if (!isRecord(entry)) return [];

        const id = getSafeString(entry.Id || entry.id, `session-${index}`);
        const deviceId = getSafeString(entry.DeviceId || entry.deviceId, id);
        const applicationName = getSafeString(entry.Client || entry.client || entry.AppName || entry.appName, 'Jellyfin client');
        const applicationVersion = getSafeString(entry.ApplicationVersion || entry.applicationVersion);
        const deviceName = getSafeString(entry.DeviceName || entry.deviceName, 'Unknown device');
        const baseSession = {
            applicationName,
            applicationVersion,
            deviceId,
            deviceName
        };
        const match = findMatchingDiagnosticsClient(baseSession, clients);
        const modeAndExplanation = getDetectedSessionModeAndExplanation(baseSession, match);

        return [{
            ...baseSession,
            ...modeAndExplanation,
            id,
            lastActivityDate: getSafeString(entry.LastActivityDate || entry.lastActivityDate),
            matchingDiagnosticsClientId: match?.clientId || null,
            playbackState: getSessionPlaybackState(entry),
            platform: getSessionPlatform(applicationName, deviceName)
        }];
    });
}

function getApiErrorMessage(error: unknown) {
    return normalizePtvApiError(error).message || 'Remote diagnostics request failed.';
}

function getSessionLabel(client: RemoteDiagnosticsClient) {
    if (client.diagnosticsActive) return `client active until ${formatTimestamp(client.expiresAtUtc)}`;
    if (client.leasePending) return `waiting for client until ${formatTimestamp(client.expiresAtUtc)}`;

    return 'off';
}

function getModeLabel(mode: DiagnosticsCapabilityMode) {
    return mode.replace('-', ' ');
}

function getRemoteClientBootSummary(client: RemoteDiagnosticsClient) {
    const status = client.boot.checkInStatus ? `HTTP ${client.boot.checkInStatus}` : 'pending';

    return [
        `platform=${client.boot.platformDetected}`,
        `runtime=${client.boot.ptvRuntimeLoaded ? 'loaded' : 'missing'}`,
        `diagnostics=${client.boot.diagnosticsModuleLoaded ? 'loaded' : 'missing'}`,
        `checkIn=${client.boot.checkInAttempted ? status : 'not attempted'}`,
        `build=${client.boot.loadedClientBuildId}`,
        `registrations=${client.boot.remoteDiagnosticsRegistrationCount}`,
        client.boot.failureCode ? `failure=${client.boot.failureCode}` : null
    ].filter(Boolean).join('; ');
}

function getPluginApi() {
    const pluginApi = getCurrentPtvPluginApiClient();
    if (!pluginApi) throw new Error('PiggieTV plugin API is not connected yet.');

    return pluginApi;
}

function downloadJson(value: unknown, filename: string) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    // eslint-disable-next-line compat/compat -- Supported by every runtime targeted by the PiggieTV dashboard.
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = filename;
    link.click();
    // eslint-disable-next-line compat/compat -- Paired with createObjectURL above to release the temporary report URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function getEmptyClientOptionLabel(loadState: ClientLoadState) {
    return loadState === 'loading' ? 'Loading clients...' : 'No clients checked in';
}

function getClientDisplayNameCounts(clients: RemoteDiagnosticsClient[]) {
    return clients.reduce<Record<string, number>>((counts, client) => {
        const key = client.displayName.toLowerCase();

        counts[key] = (counts[key] || 0) + 1;
        return counts;
    }, {});
}

function RemoteDiagnosticsClientLoadMessage({
    detectedSessions,
    hasClients,
    loadState
}: Readonly<{
    detectedSessions: DetectedJellyfinSession[];
    hasClients: boolean;
    loadState: ClientLoadState;
}>) {
    if (hasClients) return null;
    if (loadState === 'loading') return <Typography color='text.secondary'>Loading remote diagnostics clients...</Typography>;
    if (loadState === 'empty') {
        const unsupportedSession = detectedSessions.find(session => session.capabilityMode !== 'full-web' && session.capabilityMode !== 'full-native');

        if (unsupportedSession) {
            return <Typography color='text.secondary'>{unsupportedSession.explanation}</Typography>;
        }

        return (
            <Typography color='text.secondary'>
                No supported PTV clients have checked in yet. Open or refresh PiggieTV on a web browser, webOS client, Fire TV web wrapper, or other PTV web runtime first.
            </Typography>
        );
    }
    if (loadState === 'error') return <Typography color='text.secondary'>Remote diagnostics clients could not be loaded.</Typography>;

    return null;
}

function DetectedSessionsSection({
    detectedSessions,
    sessionsLoadState
}: Readonly<{
    detectedSessions: DetectedJellyfinSession[];
    sessionsLoadState: SessionsLoadState;
}>) {
    return (
        <Stack spacing={0.75}>
            <Stack direction='row' alignItems='center' justifyContent='space-between' flexWrap='wrap' gap={1}>
                <Typography variant='h4'>Detected Jellyfin sessions</Typography>
                <Chip
                    label={`${detectedSessions.length} session${detectedSessions.length === 1 ? '' : 's'}`}
                    size='small'
                />
            </Stack>
            {sessionsLoadState === 'loading' ? (
                <Typography color='text.secondary'>Loading active Jellyfin sessions...</Typography>
            ) : null}
            {sessionsLoadState === 'empty' ? (
                <Typography color='text.secondary'>No active Jellyfin TV sessions were reported by the server.</Typography>
            ) : null}
            {sessionsLoadState === 'error' ? (
                <Typography color='text.secondary'>Jellyfin sessions could not be loaded.</Typography>
            ) : null}
            {detectedSessions.map(session => (
                <Box
                    key={`${session.id}-${session.deviceId}`}
                    sx={{
                        border: '1px solid rgba(205, 174, 255, 0.14)',
                        borderRadius: 1,
                        p: 1
                    }}
                >
                    <Stack direction='row' alignItems='center' justifyContent='space-between' flexWrap='wrap' gap={1}>
                        <Typography>{session.deviceName}</Typography>
                        <Chip
                            color={session.capabilityMode === 'full-web' || session.capabilityMode === 'full-native' ? 'success' : 'default'}
                            label={getModeLabel(session.capabilityMode)}
                            size='small'
                        />
                    </Stack>
                    <Typography color='text.secondary' variant='body2'>
                        {session.applicationName}{session.applicationVersion ? ` ${session.applicationVersion}` : ''} · {session.platform} · {session.playbackState} · last active {formatTimestamp(session.lastActivityDate)}
                    </Typography>
                    <Typography color='text.secondary' variant='body2'>{session.explanation}</Typography>
                </Box>
            ))}
        </Stack>
    );
}

function RemoteDiagnosticsClientStatus({ selectedClient }: Readonly<{ selectedClient: RemoteDiagnosticsClient }>) {
    return (
        <Stack className='ptv-dashboard-status-list' spacing={0.5}>
            <Typography>Client: {selectedClient.displayName} ({selectedClient.platform})</Typography>
            <Typography>App: {selectedClient.applicationName}{selectedClient.applicationVersion ? ` ${selectedClient.applicationVersion}` : ''}</Typography>
            <Typography>Mode: {getModeLabel(selectedClient.capabilityMode)}</Typography>
            <Typography>Profile / route: {selectedClient.profile} / {selectedClient.route}</Typography>
            <Typography>Runtime marker: {getRemoteClientBootSummary(selectedClient)}</Typography>
            <Typography>First seen: {formatTimestamp(selectedClient.firstSeenUtc)}</Typography>
            <Typography>Last seen: {formatTimestamp(selectedClient.lastSeenUtc)}</Typography>
            <Typography>Capabilities: {getCapabilityLabels(selectedClient).join(', ') || 'heartbeat only'}</Typography>
            <Typography>Session: {getSessionLabel(selectedClient)}</Typography>
            <Typography>Lease rejection: {selectedClient.lastLeaseRejection || 'none'}</Typography>
            <Typography>Snapshot: {selectedClient.snapshotPending ? 'pending' : 'not pending'}</Typography>
            <Typography>Latest report: {selectedClient.hasReport ? formatTimestamp(selectedClient.reportedAtUtc) : 'none'}</Typography>
        </Stack>
    );
}

function PhysicalTvLayoutSnapshotSection({
    report,
    supported
}: Readonly<{
    report: StoredRemoteDiagnosticsReport | null;
    supported: boolean;
}>) {
    const snapshot = normalizePhysicalLayoutSnapshot(report?.report);

    if (!supported) {
        return (
            <Stack spacing={0.5} data-ptv-physical-layout-snapshot>
                <Typography variant='h4'>Physical TV Layout Snapshot</Typography>
                <Alert severity='info'>The selected client does not advertise physical layout collection.</Alert>
            </Stack>
        );
    }
    if (!report) {
        return (
            <Stack spacing={0.5} data-ptv-physical-layout-snapshot>
                <Typography variant='h4'>Physical TV Layout Snapshot</Typography>
                <Typography color='text.secondary'>Request a snapshot, then view the latest report to evaluate TV layout invariants.</Typography>
            </Stack>
        );
    }
    if (!snapshot) {
        return (
            <Stack spacing={0.5} data-ptv-physical-layout-snapshot>
                <Typography variant='h4'>Physical TV Layout Snapshot</Typography>
                <Alert severity='warning'>The uploaded report has no compatible physical layout snapshot. The client build may be stale.</Alert>
            </Stack>
        );
    }

    const statusLabel = PHYSICAL_LAYOUT_STATUS_LABELS[snapshot.status];
    const severity = PHYSICAL_LAYOUT_STATUS_SEVERITIES[snapshot.status];
    const issues = snapshot.issueCodes.map(issue => PHYSICAL_LAYOUT_ISSUE_LABELS[issue]);

    return (
        <Stack spacing={0.5} data-ptv-physical-layout-snapshot>
            <Typography variant='h4'>Physical TV Layout Snapshot</Typography>
            <Alert severity={severity}>{statusLabel}{issues.length ? ` ${issues.join('; ')}.` : ''}</Alert>
            <Typography color='text.secondary' variant='body2'>
                Latest milestone: {snapshot.latestMilestone}; retained milestones: {snapshot.milestoneCount}; viewport: {snapshot.viewportWidth ?? 'n/a'} x {snapshot.viewportHeight ?? 'n/a'}.
            </Typography>
            <Typography color='text.secondary' variant='body2'>
                Shell brand: {snapshot.shellBrandWidth ?? 'n/a'} x {snapshot.shellBrandHeight ?? 'n/a'}; first shelf top: {snapshot.firstShelfTop ?? 'n/a'}; CSS source attribution: {snapshot.cssOwnershipStatus}.
            </Typography>
        </Stack>
    );
}

export function RemoteDiagnosticsPanel() {
    const [busyAction, setBusyAction] = useState<BusyAction>(null);
    const [clientLoadState, setClientLoadState] = useState<ClientLoadState>('loading');
    const [clients, setClients] = useState<RemoteDiagnosticsClient[]>([]);
    const [detectedSessions, setDetectedSessions] = useState<DetectedJellyfinSession[]>([]);
    const [durationMinutes, setDurationMinutes] = useState<5 | 10>(5);
    const [errorMessage, setErrorMessage] = useState('');
    const [profileFilter, setProfileFilter] = useState<'' | PtvClientKind>('');
    const [report, setReport] = useState<StoredRemoteDiagnosticsReport | null>(null);
    const [selectedClientId, setSelectedClientId] = useState('');
    const [sessionsLoadState, setSessionsLoadState] = useState<SessionsLoadState>('loading');
    const [statusMessage, setStatusMessage] = useState('');
    const [storage, setStorage] = useState<DiagnosticsStorageStatus | null>(null);

    const selectedClient = useMemo(
        () => clients.find(client => client.clientId === selectedClientId) || null,
        [clients, selectedClientId]
    );
    const displayNameCounts = useMemo(() => getClientDisplayNameCounts(clients), [clients]);
    const hasClients = clients.length > 0;
    const selectedClientSupportsCommands = selectedClient?.capabilities.remoteCommands === true;
    const selectedClientSupportsReportExport = selectedClient?.capabilities.reportExport === true;

    const refreshClients = useCallback(async (quiet = false) => {
        if (!quiet) setBusyAction('refresh');
        if (!quiet) setClientLoadState('loading');

        try {
            const pluginApi = getPluginApi();
            const refreshProfile = profileFilter || '';

            if (!remoteDiagnosticsRefreshInFlight || remoteDiagnosticsRefreshProfile !== refreshProfile) {
                remoteDiagnosticsRefreshProfile = refreshProfile;
                remoteDiagnosticsRefreshInFlight = Promise.all([
                    pluginApi.getRemoteDiagnosticsClients<unknown>(profileFilter || undefined, {
                        bypassCache: true
                    }),
                    pluginApi.getJellyfinSessions<unknown>({
                        activeWithinSeconds: 300,
                        controllableByUserId: pluginApi.getCurrentUserId?.()
                    }),
                    typeof pluginApi.getRemoteDiagnosticsStorage === 'function'
                        ? pluginApi.getRemoteDiagnosticsStorage<DiagnosticsStorageStatus>({ bypassCache: true }).catch(() => null)
                        : Promise.resolve(null)
                ]).finally(() => {
                    remoteDiagnosticsRefreshInFlight = null;
                });
            }

            const [rawClients, rawSessions, rawStorage] = await remoteDiagnosticsRefreshInFlight;
            const nextClients = normalizeRemoteDiagnosticsClients(rawClients);
            const nextSessions = normalizeDetectedJellyfinSessions(rawSessions, nextClients);

            setDetectedSessions(nextSessions);
            setSessionsLoadState(nextSessions.length ? 'success' : 'empty');
            setClients(nextClients);
            setClientLoadState(nextClients.length ? 'success' : 'empty');
            setStorage(rawStorage);
            setSelectedClientId(previousId => {
                if (nextClients.some(client => client.clientId === previousId)) return previousId;

                return nextClients[0]?.clientId || '';
            });
            setErrorMessage('');
        } catch (error) {
            setClientLoadState('error');
            setSessionsLoadState('error');
            if (!quiet) setErrorMessage(getApiErrorMessage(error));
        } finally {
            if (!quiet) setBusyAction(null);
        }
    }, [profileFilter]);

    useEffect(() => {
        refreshClients().catch(() => undefined);
        const timer = window.setInterval(() => {
            if (document.visibilityState !== 'visible') return;
            refreshClients(true).catch(() => undefined);
        }, 30_000);

        return () => window.clearInterval(timer);
    }, [refreshClients]);

    useEffect(() => {
        setReport(null);
    }, [selectedClientId]);

    const runClientAction = useCallback(async (
        action: Exclude<BusyAction, 'download' | 'refresh' | 'report' | null>,
        request: (clientId: string) => Promise<unknown>,
        successMessage: string
    ) => {
        if (!selectedClientId) return;

        setBusyAction(action);
        setErrorMessage('');
        setStatusMessage('');
        try {
            await request(selectedClientId);
            setStatusMessage(successMessage);
            await refreshClients(true);
        } catch (error) {
            setErrorMessage(getApiErrorMessage(error));
        } finally {
            setBusyAction(null);
        }
    }, [refreshClients, selectedClientId]);

    const startSession = useCallback(() => runClientAction(
        'start',
        clientId => getPluginApi().startRemoteDiagnosticsSession(clientId, durationMinutes),
        `Temporary diagnostics enabled for ${durationMinutes} minutes. The client will receive the lease on its next local check-in.`
    ), [durationMinutes, runClientAction]);

    const stopSession = useCallback(() => runClientAction(
        'stop',
        clientId => getPluginApi().stopRemoteDiagnosticsSession(clientId),
        'Diagnostics lease revoked.'
    ), [runClientAction]);

    const requestSnapshot = useCallback(() => runClientAction(
        'snapshot',
        clientId => getPluginApi().requestRemoteDiagnosticsSnapshot(clientId),
        'One-time snapshot requested. Refresh after the client checks in.'
    ), [runClientAction]);

    const loadReport = useCallback(async (download = false) => {
        if (!selectedClientId) return;
        if (download && remoteDiagnosticsExportInFlight) return;

        if (download) remoteDiagnosticsExportInFlight = true;

        setBusyAction(download ? 'download' : 'report');
        setErrorMessage('');
        try {
            const rawReport = await getPluginApi().getRemoteDiagnosticsReport<unknown>(selectedClientId, {
                bypassCache: true
            });
            const nextReport = normalizeStoredRemoteDiagnosticsReport(rawReport);

            if (!nextReport) throw new Error('Remote diagnostics report response is invalid.');

            setReport(nextReport);
            if (download) {
                const timestamp = nextReport.receivedAtUtc.replace(/[:.]/g, '-');
                downloadJson(nextReport.report, `piggie-tv-diagnostics-${selectedClientId}-${timestamp}.json`);
                setStatusMessage('Diagnostics report downloaded locally.');
            }
        } catch (error) {
            setErrorMessage(getApiErrorMessage(error));
        } finally {
            if (download) remoteDiagnosticsExportInFlight = false;
            setBusyAction(null);
        }
    }, [selectedClientId]);

    const handleProfileFilterChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setProfileFilter(event.target.value as '' | PtvClientKind);
    }, []);
    const handleClientChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setSelectedClientId(event.target.value);
        setReport(null);
    }, []);
    const handleDurationChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setDurationMinutes(Number(event.target.value) === 10 ? 10 : 5);
    }, []);
    const handleRefresh = useCallback(() => {
        refreshClients().catch(() => undefined);
    }, [refreshClients]);
    const handleViewReport = useCallback(() => {
        loadReport().catch(() => undefined);
    }, [loadReport]);
    const handleDownloadReport = useCallback(() => {
        loadReport(true).catch(() => undefined);
    }, [loadReport]);
    const runStorageAction = useCallback(async (action: Exclude<BusyAction, 'download' | 'refresh' | 'report' | 'snapshot' | 'start' | 'stop' | null>, request: () => Promise<unknown>, message: string, confirmation?: string) => {
        if (confirmation && !window.confirm(confirmation)) return;
        setBusyAction(action);
        setErrorMessage('');
        try {
            await request();
            setStatusMessage(message);
            await refreshClients(true);
        } catch (error) {
            setErrorMessage(getApiErrorMessage(error));
        } finally {
            setBusyAction(null);
        }
    }, [refreshClients]);

    return (
        <Stack spacing={1.25} data-ptv-remote-diagnostics-admin>
            <Divider />
            <Stack direction='row' alignItems='center' justifyContent='space-between' flexWrap='wrap' gap={1}>
                <Typography variant='h3'>Remote client diagnostics</Typography>
                <Chip
                    color={clients.some(client => client.sessionId) ? 'warning' : 'default'}
                    label={`${clients.length} recent client${clients.length === 1 ? '' : 's'}`}
                    size='small'
                />
            </Stack>
            <Typography color='text.secondary'>
                Local server only. Detailed collection is off by default, limited to a selected client for 5 or 10 minutes, held in memory, and automatically expires.
            </Typography>
            {errorMessage ? <Alert severity='error'>{errorMessage}</Alert> : null}
            {statusMessage ? <Alert severity='info'>{statusMessage}</Alert> : null}
            <DetectedSessionsSection detectedSessions={detectedSessions} sessionsLoadState={sessionsLoadState} />
            <Divider />
            <Typography variant='h4'>Remote diagnostics clients</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <TextField
                    fullWidth
                    label='Profile filter'
                    onChange={handleProfileFilterChange}
                    select
                    size='small'
                    value={profileFilter}
                >
                    {PROFILE_FILTERS.map(option => (
                        <MenuItem key={option.value || 'all'} value={option.value}>{option.label}</MenuItem>
                    ))}
                </TextField>
                <TextField
                    fullWidth
                    disabled={!hasClients}
                    label='Client'
                    onChange={handleClientChange}
                    select
                    size='small'
                    value={selectedClientId}
                >
                    {!hasClients ? (
                        <MenuItem disabled value=''>
                            {getEmptyClientOptionLabel(clientLoadState)}
                        </MenuItem>
                    ) : null}
                    {clients.map(client => (
                        <MenuItem key={client.clientId} value={client.clientId}>
                            <Stack spacing={0.25}>
                                <Typography>{client.displayName}</Typography>
                                <Typography color='text.secondary' variant='caption'>
                                    {formatClientOption(client, (displayNameCounts[client.displayName.toLowerCase()] || 0) > 1)}
                                </Typography>
                            </Stack>
                        </MenuItem>
                    ))}
                </TextField>
                <TextField
                    label='Duration'
                    onChange={handleDurationChange}
                    select
                    size='small'
                    value={durationMinutes}
                    sx={{ minWidth: 130 }}
                >
                    <MenuItem value={5}>5 minutes</MenuItem>
                    <MenuItem value={10}>10 minutes</MenuItem>
                </TextField>
            </Stack>
            <RemoteDiagnosticsClientLoadMessage
                detectedSessions={detectedSessions}
                hasClients={hasClients}
                loadState={clientLoadState}
            />
            {selectedClient ? <RemoteDiagnosticsClientStatus selectedClient={selectedClient} /> : null}
            <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap>
                <Button disabled={busyAction !== null} onClick={handleRefresh} variant='outlined'>Refresh clients</Button>
                <Button disabled={!selectedClient || !selectedClientSupportsCommands || busyAction !== null} onClick={startSession} variant='contained'>Start diagnostics</Button>
                <Button disabled={!selectedClient?.sessionId || !selectedClientSupportsCommands || busyAction !== null} onClick={stopSession} variant='outlined'>Stop</Button>
                <Button disabled={!selectedClient || !selectedClientSupportsCommands || busyAction !== null} onClick={requestSnapshot} variant='outlined'>Request snapshot</Button>
                <Button disabled={!selectedClient?.hasReport || !selectedClientSupportsReportExport || busyAction !== null} onClick={handleViewReport} variant='outlined'>View report</Button>
                <Button disabled={!selectedClient?.hasReport || !selectedClientSupportsReportExport || busyAction !== null} onClick={handleDownloadReport} variant='outlined'>Download report</Button>
            </Stack>
            <PhysicalTvLayoutSnapshotSection
                report={report}
                supported={selectedClient?.capabilities.physicalLayoutSnapshot === true}
            />
            <Divider />
            <Typography variant='h4'>Diagnostics storage</Typography>
            {storage ? (
                <Stack className='ptv-dashboard-status-list' spacing={0.5}>
                    <Typography>Active log: {storage.activeLogPath || 'unavailable'} ({formatBytes(storage.activeFileSizeBytes)})</Typography>
                    <Typography>Retained: {storage.rotatedFileCount} rotation(s), {formatBytes(storage.totalRetainedBytes)}, oldest {formatTimestamp(storage.oldestRetainedAtUtc)}, {storage.retentionDays} day retention</Typography>
                    <Typography>Events: {storage.eventsWritten} written, {storage.eventsAggregated} aggregated, {storage.duplicateEventsSuppressed} duplicates suppressed, {storage.eventsDropped} dropped, {storage.eventsQueued} queued</Typography>
                    <Typography>Health: {storage.writeFailures} write failure(s), last rotation {formatTimestamp(storage.lastRotationUtc)}, legacy files {storage.legacyFileCount} ({formatBytes(storage.legacyFileSizeBytes)})</Typography>
                </Stack>
            ) : <Typography color='text.secondary'>Rolling diagnostics storage is unavailable on this plugin build.</Typography>}
            <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap>
                <Button disabled={busyAction !== null} onClick={() => runStorageAction('refresh-storage', async () => undefined, 'Diagnostics storage refreshed.') } variant='outlined'>Refresh storage</Button>
                <Button disabled={!storage || busyAction !== null} onClick={() => runStorageAction('rotate-storage', () => getPluginApi().rotateRemoteDiagnosticsStorage(), 'Diagnostics log rotated.') } variant='outlined'>Rotate now</Button>
                <Button disabled={!storage || busyAction !== null} onClick={() => window.open(getPluginApi().getRemoteDiagnosticsStorageDownloadUrl(), '_blank', 'noopener') } variant='outlined'>Download current log</Button>
                <Button disabled={!storage || busyAction !== null} onClick={() => window.open(getPluginApi().getRemoteDiagnosticsStorageBundleUrl(), '_blank', 'noopener') } variant='outlined'>Download bundle</Button>
                <Button color='warning' disabled={!storage || busyAction !== null} onClick={() => runStorageAction('consolidate-storage', () => getPluginApi().consolidateRemoteDiagnosticsStorage(), 'Legacy PTV diagnostics consolidated.', 'Archive and remove only recognized legacy PTV diagnostic files?') } variant='outlined'>Consolidate legacy logs</Button>
                <Button color='error' disabled={!storage || busyAction !== null} onClick={() => runStorageAction('clear-storage', () => getPluginApi().clearRemoteDiagnosticsStorage(), 'Rolling diagnostics logs cleared.', 'Delete all current PTV rolling diagnostic logs?') } variant='outlined'>Clear diagnostic logs</Button>
            </Stack>
            {report ? (
                <Box
                    component='pre'
                    sx={{
                        backgroundColor: 'rgba(0, 0, 0, 0.25)',
                        borderRadius: 1,
                        maxHeight: 360,
                        overflow: 'auto',
                        p: 1.25,
                        whiteSpace: 'pre-wrap'
                    }}
                >
                    {JSON.stringify(report.report, null, 2)}
                </Box>
            ) : null}
        </Stack>
    );
}
