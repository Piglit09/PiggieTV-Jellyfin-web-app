import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { SessionInfoDto } from '@jellyfin/sdk/lib/generated-client/models/session-info-dto';
import type { SystemInfo } from '@jellyfin/sdk/lib/generated-client/models/system-info';
import type { TaskInfo } from '@jellyfin/sdk/lib/generated-client/models/task-info';
import type { VirtualFolderInfo } from '@jellyfin/sdk/lib/generated-client/models/virtual-folder-info';

import {
    getPtvBuildInfo,
    type PtvPluginBuildStatus
} from '../../../core/buildInfo';
import type {
    AdminDashboardOverall,
    AdminDashboardSnapshot,
    AdminDashboardSources,
    AdminDashboardWarning,
    AdminFeaturedContentSummary,
    AdminLibrariesSummary,
    AdminLibraryKind,
    AdminPlaybackMethod,
    AdminPlaybackSession,
    AdminPlaybackSummary,
    AdminPtvSummary,
    AdminServerSummary,
    AdminTasksSummary,
    AdminTaskState,
    AdminTaskSummaryItem
} from './adminDashboardModel';

const JELLYFIN_TICKS_PER_MINUTE = 600_000_000;
const DEFAULT_RECENT_TASK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_RECENT_TASK_LIMIT = 5;
const MAX_DISPLAY_TEXT_LENGTH = 180;

type UnknownRecord = Record<string, unknown>;

type NormalizedTaskWithPriority = {
    item: AdminTaskSummaryItem;
    priority: number;
    sortTimestamp: number;
};

export type AdminTaskNormalizationOptions = Readonly<{
    now?: Date | number;
    recentFailureWindowMs?: number;
    recentLimit?: number;
}>;

function isRecord(value: unknown): value is UnknownRecord {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toDisplayText(value: unknown): string | null {
    if (typeof value !== 'string') return null;

    const normalized = value.trim();
    return normalized ? normalized.slice(0, MAX_DISPLAY_TEXT_LENGTH) : null;
}

function toNonNegativeInteger(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
    return Math.floor(value);
}

function toIsoDate(value: unknown): string | null {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'number' && (!Number.isFinite(value) || value <= 0)) return null;

    const timestamp = typeof value === 'number' ? value : Date.parse(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) return null;

    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toTimestamp(value: string | null): number {
    if (!value) return 0;

    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function clampPercentage(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const bounded = Math.min(100, Math.max(0, value));
    return bounded < 100 ? Math.min(99.9, Math.round(bounded * 10) / 10) : 100;
}

function formatCount(count: number, singular: string, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`;
}

export function normalizeAdminServer(systemInfo: SystemInfo): AdminServerSummary {
    const name = toDisplayText(systemInfo.ServerName);
    const version = toDisplayText(systemInfo.Version);
    // Jellyfin's currently generated SDK marks both OS display fields as deprecated.
    // Keep this unknown until a supported summary field is available.
    const operatingSystem = null;

    if (systemInfo.IsShuttingDown) {
        return {
            message: 'The server is shutting down.',
            name,
            operatingSystem,
            severity: 'error',
            sourceState: 'ready',
            state: 'shutting-down',
            statusLabel: 'Shutting down',
            version
        };
    }

    if (systemInfo.HasPendingRestart) {
        return {
            message: 'A server restart is pending.',
            name,
            operatingSystem,
            severity: 'warning',
            sourceState: 'ready',
            state: 'restart-pending',
            statusLabel: 'Restart pending',
            version
        };
    }

    return {
        message: 'The PiggieTV server is reachable.',
        name,
        operatingSystem,
        severity: 'healthy',
        sourceState: 'ready',
        state: 'online',
        statusLabel: 'Online',
        version
    };
}

export function createUnavailableAdminServer(): AdminServerSummary {
    return {
        message: 'Server information could not be loaded.',
        name: null,
        operatingSystem: null,
        severity: 'error',
        sourceState: 'unavailable',
        state: 'unavailable',
        statusLabel: 'Unavailable',
        version: null
    };
}

function readBoolean(record: UnknownRecord, key: string): boolean | null {
    return typeof record[key] === 'boolean' ? record[key] : null;
}

function readPtvBuildStatus(status: UnknownRecord): PtvPluginBuildStatus {
    const pluginVersion = toDisplayText(status.pluginVersion || status.version) || undefined;
    const apiVersion = toNonNegativeInteger(status.apiVersion) ?? undefined;
    const cacheVersion = toNonNegativeInteger(status.cacheVersion) ?? undefined;
    const featuredContent = isRecord(status.featuredContent) ? status.featuredContent : undefined;
    const featuredCacheVersion = toNonNegativeInteger(featuredContent?.cacheVersion) ?? undefined;
    const featureFlags = isRecord(status.featureFlags) ? Object.fromEntries(
        Object.entries(status.featureFlags)
            .filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
    ) : undefined;
    const features = Array.isArray(status.features) ? status.features.filter(
        (feature): feature is string => typeof feature === 'string'
    ) : undefined;

    return {
        apiVersion,
        cacheVersion,
        featuredContent: featuredCacheVersion === undefined ? undefined : {
            cacheVersion: featuredCacheVersion
        },
        featureFlags,
        features,
        pluginVersion,
        version: pluginVersion
    };
}

function createUnknownFeaturedContent(): AdminFeaturedContentSummary {
    return {
        createdAt: null,
        expiresAt: null,
        heroCount: null,
        itemCount: null,
        sectionCount: null,
        severity: 'unknown',
        state: 'unknown',
        statusLabel: 'Unknown',
        updatedAt: null
    };
}

function createUnavailableFeaturedContent(): AdminFeaturedContentSummary {
    return {
        ...createUnknownFeaturedContent(),
        state: 'unavailable',
        statusLabel: 'Unavailable'
    };
}

function normalizeFeaturedContent(
    status: UnknownRecord,
    refreshInProgress: boolean
): AdminFeaturedContentSummary {
    const featured = isRecord(status.featuredContent) ? status.featuredContent : null;
    const hasPayload = featured ? readBoolean(featured, 'hasPayload') : null;
    const heroCount = featured ? toNonNegativeInteger(featured.heroCount) : null;
    const sectionCount = featured ? toNonNegativeInteger(featured.sectionCount) : null;
    const itemCount = featured ? toNonNegativeInteger(featured.itemCount) : null;
    const createdAt = toIsoDate(featured?.createdAt ?? status.featuredCacheCreatedAt);
    const expiresAt = toIsoDate(featured?.expiresAt ?? status.featuredCacheExpiresAt);
    const updatedAt = toIsoDate(featured?.updatedAt);
    const cacheExists = readBoolean(status, 'featuredCacheExists');
    const cacheFresh = readBoolean(status, 'featuredCacheFresh');
    const hasKnownCounts = heroCount !== null || sectionCount !== null || itemCount !== null;
    const knownItemTotal = (heroCount || 0) + (itemCount || 0);
    const isEmpty = hasPayload === false
        || cacheExists === false
        || (hasPayload === null && hasKnownCounts && knownItemTotal === 0);

    const shared = {
        createdAt,
        expiresAt,
        heroCount,
        itemCount,
        sectionCount,
        updatedAt
    };

    if (isEmpty) {
        return {
            ...shared,
            severity: 'warning',
            state: 'empty',
            statusLabel: 'Cache empty'
        };
    }

    if (hasPayload === true && cacheFresh === false) {
        return {
            ...shared,
            severity: 'warning',
            state: 'stale',
            statusLabel: 'Cache stale'
        };
    }

    if (refreshInProgress) {
        return {
            ...shared,
            severity: 'info',
            state: 'refreshing',
            statusLabel: 'Refreshing'
        };
    }

    if (hasPayload === true) {
        return {
            ...shared,
            severity: 'healthy',
            state: 'healthy',
            statusLabel: 'Ready'
        };
    }

    return {
        ...createUnknownFeaturedContent(),
        ...shared
    };
}

export function normalizeAdminPtvStatus(value: unknown): AdminPtvSummary {
    const ptvWebVersion = getPtvBuildInfo().ptvWebVersion;

    if (!isRecord(value) || Object.keys(value).length === 0) {
        return {
            featuredContent: createUnknownFeaturedContent(),
            message: 'PiggieTV plugin health could not be determined.',
            pluginVersion: null,
            ptvWebVersion,
            refreshInProgress: null,
            severity: 'unknown',
            sourceState: 'ready',
            state: 'unknown',
            statusLabel: 'Unknown'
        };
    }

    const buildInfo = getPtvBuildInfo(readPtvBuildStatus(value), {
        pluginConnected: true
    });
    const pluginVersion = toDisplayText(value.pluginVersion || value.version);
    const refreshInProgress = readBoolean(value, 'refreshInProgress') === true;
    const featuredContent = normalizeFeaturedContent(value, refreshInProgress);
    const ok = readBoolean(value, 'ok');
    const explicitlyDegraded = readBoolean(value, 'degraded') === true
        || readBoolean(value, 'cacheHealthy') === false
        || readBoolean(value, 'settingsAvailable') === false
        || toDisplayText(value.lastRefreshError) !== null;

    if (ok === false || explicitlyDegraded) {
        return {
            featuredContent,
            message: 'The PiggieTV plugin is reachable, but attention is required.',
            pluginVersion,
            ptvWebVersion: buildInfo.ptvWebVersion,
            refreshInProgress,
            severity: 'warning',
            sourceState: 'ready',
            state: 'degraded',
            statusLabel: 'Degraded'
        };
    }

    if (ok === true) {
        return {
            featuredContent,
            message: 'The PiggieTV plugin is reachable.',
            pluginVersion,
            ptvWebVersion: buildInfo.ptvWebVersion,
            refreshInProgress,
            severity: featuredContent.severity === 'warning' ? 'warning' : 'healthy',
            sourceState: 'ready',
            state: featuredContent.severity === 'warning' ? 'degraded' : 'healthy',
            statusLabel: featuredContent.severity === 'warning' ? 'Degraded' : 'Healthy'
        };
    }

    return {
        featuredContent,
        message: 'The PiggieTV plugin responded without health information.',
        pluginVersion,
        ptvWebVersion: buildInfo.ptvWebVersion,
        refreshInProgress,
        severity: 'unknown',
        sourceState: 'ready',
        state: 'unknown',
        statusLabel: 'Unknown'
    };
}

export function createUnavailableAdminPtv(): AdminPtvSummary {
    return {
        featuredContent: createUnavailableFeaturedContent(),
        message: 'PiggieTV plugin status is temporarily unavailable.',
        pluginVersion: null,
        ptvWebVersion: getPtvBuildInfo(undefined, { pluginConnected: false }).ptvWebVersion,
        refreshInProgress: null,
        severity: 'error',
        sourceState: 'unavailable',
        state: 'unavailable',
        statusLabel: 'Unavailable'
    };
}

function normalizeLibraryKind(collectionType: VirtualFolderInfo['CollectionType']): AdminLibraryKind {
    switch (collectionType) {
        case 'movies':
            return 'movies';
        case 'tvshows':
            return 'shows';
        case 'music':
        case 'musicvideos':
            return 'music';
        case 'books':
            return 'books';
        case 'mixed':
            return 'mixed';
        default:
            return 'other';
    }
}

export function normalizeAdminLibraries(
    virtualFolders: readonly VirtualFolderInfo[]
): AdminLibrariesSummary {
    const breakdown: Record<AdminLibraryKind, number> = {
        books: 0,
        mixed: 0,
        movies: 0,
        music: 0,
        other: 0,
        shows: 0
    };

    for (const folder of virtualFolders) {
        const kind = normalizeLibraryKind(folder.CollectionType);
        breakdown[kind] += 1;
    }

    const count = virtualFolders.length;

    return {
        breakdown,
        count,
        message: count === 0 ? 'No media libraries are configured.' : `${formatCount(count, 'library', 'libraries')} configured.`,
        severity: count === 0 ? 'info' : 'healthy',
        sourceState: 'ready',
        state: count === 0 ? 'empty' : 'available',
        statusLabel: count === 0 ? 'None configured' : 'Available'
    };
}

export function createUnavailableAdminLibraries(): AdminLibrariesSummary {
    return {
        breakdown: null,
        count: null,
        message: 'Library information could not be loaded.',
        severity: 'unknown',
        sourceState: 'unavailable',
        state: 'unavailable',
        statusLabel: 'Unavailable'
    };
}

function normalizePlaybackMethod(playMethod: unknown): AdminPlaybackMethod {
    switch (playMethod) {
        case 'DirectPlay':
            return 'direct-play';
        case 'DirectStream':
            return 'direct-stream';
        case 'Transcode':
            return 'transcoding';
        default:
            return 'unknown';
    }
}

function playbackMethodLabel(method: AdminPlaybackMethod) {
    switch (method) {
        case 'direct-play':
            return 'Direct Play';
        case 'direct-stream':
            return 'Direct Stream';
        case 'transcoding':
            return 'Transcoding';
        default:
            return 'Unknown';
    }
}

function formatEpisodeCode(item: BaseItemDto) {
    const season = toNonNegativeInteger(item.ParentIndexNumber);
    const episode = toNonNegativeInteger(item.IndexNumber);

    if (season === null && episode === null) return null;
    if (season === null) return `E${String(episode).padStart(2, '0')}`;
    if (episode === null) return `S${String(season).padStart(2, '0')}`;

    return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
}

function normalizeMediaDisplay(item: BaseItemDto): Pick<
    AdminPlaybackSession,
    'mediaKind' | 'mediaSubtitle' | 'mediaTitle'
> {
    const itemName = toDisplayText(item.Name);

    if (item.Type === 'Episode') {
        const seriesName = toDisplayText(item.SeriesName);
        const episodeCode = formatEpisodeCode(item);
        const subtitleParts = [ episodeCode, seriesName ? itemName : null ].filter(Boolean);

        return {
            mediaKind: 'episode',
            mediaSubtitle: subtitleParts.length > 0 ? subtitleParts.join(' · ') : null,
            mediaTitle: seriesName || itemName || 'Episode'
        };
    }

    if (item.Type === 'Audio') {
        const artist = item.Artists?.map(toDisplayText).find(Boolean)
            || toDisplayText(item.AlbumArtist)
            || toDisplayText(item.Album);

        return {
            mediaKind: 'music',
            mediaSubtitle: itemName,
            mediaTitle: artist || 'Music'
        };
    }

    if (item.Type === 'Movie') {
        return {
            mediaKind: 'movie',
            mediaSubtitle: null,
            mediaTitle: itemName || 'Movie'
        };
    }

    return {
        mediaKind: 'other',
        mediaSubtitle: null,
        mediaTitle: itemName || 'Media'
    };
}

function normalizePlaybackProgress(session: SessionInfoDto) {
    const positionTicks = session.PlayState?.PositionTicks;
    const runTimeTicks = session.NowPlayingItem?.RunTimeTicks;

    if (
        typeof positionTicks !== 'number'
        || !Number.isFinite(positionTicks)
        || typeof runTimeTicks !== 'number'
        || !Number.isFinite(runTimeTicks)
        || runTimeTicks <= 0
    ) {
        return {
            progressPercent: null,
            remainingMinutes: null
        };
    }

    const clampedPosition = Math.min(runTimeTicks, Math.max(0, positionTicks));

    return {
        progressPercent: Math.round((clampedPosition / runTimeTicks) * 100),
        remainingMinutes: Math.ceil((runTimeTicks - clampedPosition) / JELLYFIN_TICKS_PER_MINUTE)
    };
}

function normalizeTranscodeDetails(session: SessionInfoDto, method: AdminPlaybackMethod) {
    if (method !== 'transcoding') {
        return {
            bitrateMbps: null,
            resolution: null
        };
    }

    const bitrate = session.TranscodingInfo?.Bitrate;
    const height = session.TranscodingInfo?.Height;
    const bitrateMbps = typeof bitrate === 'number' && Number.isFinite(bitrate) && bitrate > 0 ?
        Math.round((bitrate / 1_000_000) * 10) / 10 :
        null;
    const resolution = typeof height === 'number' && Number.isFinite(height) && height > 0 ?
        `${Math.round(height)}p` :
        null;

    return {
        bitrateMbps,
        resolution
    };
}

function isActiveMediaSession(session: SessionInfoDto) {
    return Boolean(session.NowPlayingItem && session.PlayState && session.IsActive !== false);
}

function normalizePlaybackSession(session: SessionInfoDto): AdminPlaybackSession {
    const method = normalizePlaybackMethod(session.PlayState?.PlayMethod);
    const paused = session.PlayState?.IsPaused === true;

    return {
        ...normalizeMediaDisplay(session.NowPlayingItem!),
        ...normalizePlaybackProgress(session),
        ...normalizeTranscodeDetails(session, method),
        clientName: toDisplayText(session.Client),
        deviceName: toDisplayText(session.DeviceName)
            || toDisplayText(session.DeviceType)
            || toDisplayText(session.Client)
            || 'Unknown device',
        method,
        methodLabel: playbackMethodLabel(method),
        paused,
        statusLabel: paused ? 'Paused' : 'Playing',
        userName: toDisplayText(session.UserName)
    };
}

export function normalizeAdminPlayback(
    sourceSessions: readonly SessionInfoDto[]
): AdminPlaybackSummary {
    const sessions = sourceSessions.filter(isActiveMediaSession).map(normalizePlaybackSession);
    const directPlayCount = sessions.filter(session => session.method === 'direct-play').length;
    const directStreamCount = sessions.filter(session => session.method === 'direct-stream').length;
    const transcodeCount = sessions.filter(session => session.method === 'transcoding').length;
    const unknownMethodCount = sessions.filter(session => session.method === 'unknown').length;
    const activeStreamCount = sessions.length;

    return {
        activeStreamCount,
        directPlayCount,
        directStreamCount,
        message: activeStreamCount === 0 ?
            'No one is streaming right now.' :
            `${formatCount(activeStreamCount, 'active stream')}.`,
        sessions,
        severity: activeStreamCount === 0 ? 'healthy' : 'info',
        sourceState: 'ready',
        state: activeStreamCount === 0 ? 'idle' : 'active',
        statusLabel: activeStreamCount === 0 ? 'Idle' : 'Active',
        transcodeCount,
        unknownMethodCount
    };
}

export function createUnavailableAdminPlayback(): AdminPlaybackSummary {
    return {
        activeStreamCount: null,
        directPlayCount: null,
        directStreamCount: null,
        message: 'Active stream information could not be loaded.',
        sessions: [],
        severity: 'unknown',
        sourceState: 'unavailable',
        state: 'unavailable',
        statusLabel: 'Unavailable',
        transcodeCount: null,
        unknownMethodCount: null
    };
}

function normalizeTaskState(task: TaskInfo): AdminTaskState {
    if (task.State === 'Running') return 'running';
    if (task.State === 'Cancelling') return 'cancelling';

    switch (task.LastExecutionResult?.Status) {
        case 'Completed':
            return 'completed';
        case 'Failed':
            return 'failed';
        case 'Cancelled':
            return 'cancelled';
        case 'Aborted':
            return 'aborted';
        default:
            return 'never-run';
    }
}

function taskStatusPresentation(state: AdminTaskState): Pick<
    AdminTaskSummaryItem,
    'severity' | 'statusLabel'
> {
    switch (state) {
        case 'running':
            return { severity: 'info', statusLabel: 'Running' };
        case 'cancelling':
            return { severity: 'warning', statusLabel: 'Cancelling' };
        case 'completed':
            return { severity: 'healthy', statusLabel: 'Completed' };
        case 'failed':
            return { severity: 'error', statusLabel: 'Failed' };
        case 'cancelled':
            return { severity: 'info', statusLabel: 'Cancelled' };
        case 'aborted':
            return { severity: 'warning', statusLabel: 'Aborted' };
        default:
            return { severity: 'unknown', statusLabel: 'Never run' };
    }
}

function isWithinRecentWindow(timestamp: number, now: number, windowMs: number) {
    return timestamp > 0 && timestamp <= now + 60_000 && timestamp >= now - windowMs;
}

function isImportantTask(task: TaskInfo) {
    const searchable = `${task.Key || ''} ${task.Name || ''} ${task.Category || ''}`.toLowerCase();
    return /backup|library|plugin|piggie|ptv/.test(searchable);
}

function getTaskPriority(state: AdminTaskState, isRecent: boolean, important: boolean) {
    if (isRecent) {
        switch (state) {
            case 'failed':
                return 100;
            case 'aborted':
                return 95;
            case 'cancelled':
                return 70;
            case 'completed':
                return 20;
            default:
                break;
        }
    }

    if (state === 'running') return 90;
    if (state === 'cancelling') return 85;
    return important ? 30 : 0;
}

function getTaskProgress(task: TaskInfo, state: AdminTaskState) {
    if (state !== 'running' && state !== 'cancelling') return null;
    if (typeof task.CurrentProgressPercentage !== 'number'
        || !Number.isFinite(task.CurrentProgressPercentage)
        || task.CurrentProgressPercentage < 0
        || task.CurrentProgressPercentage > 100) return null;
    return clampPercentage(task.CurrentProgressPercentage);
}

function normalizeTask(
    task: TaskInfo,
    now: number,
    recentWindowMs: number
): NormalizedTaskWithPriority {
    const state = normalizeTaskState(task);
    const lastExecutionStartedAt = toIsoDate(task.LastExecutionResult?.StartTimeUtc);
    const completedAt = toIsoDate(task.LastExecutionResult?.EndTimeUtc);
    const sortTimestamp = Math.max(toTimestamp(completedAt), toTimestamp(lastExecutionStartedAt));
    const isRecent = isWithinRecentWindow(sortTimestamp, now, recentWindowMs);
    const priority = getTaskPriority(state, isRecent, isImportantTask(task));

    return {
        item: {
            completedAt,
            name: toDisplayText(task.Name) || 'Scheduled task',
            progressPercent: getTaskProgress(task, state),
            ...taskStatusPresentation(state),
            startedAt: state === 'running' || state === 'cancelling' ? null : lastExecutionStartedAt,
            state
        },
        priority,
        sortTimestamp
    };
}

function resolveNow(value: Date | number | undefined) {
    if (value instanceof Date) return value.getTime();
    return typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
}

function resolveRecentWindow(value: number | undefined) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return DEFAULT_RECENT_TASK_WINDOW_MS;
    }

    return value;
}

function resolveRecentLimit(value: number | undefined) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return DEFAULT_RECENT_TASK_LIMIT;
    }

    return Math.floor(value);
}

function taskSummaryPresentation(runningCount: number, attentionCount: number): Pick<
    AdminTasksSummary,
    'message' | 'severity' | 'state' | 'statusLabel'
> {
    if (attentionCount > 0) {
        const verb = attentionCount === 1 ? 'needs' : 'need';
        return {
            message: `${formatCount(attentionCount, 'task')} ${verb} attention.`,
            severity: 'warning',
            state: 'attention',
            statusLabel: 'Attention'
        };
    }

    if (runningCount > 0) {
        return {
            message: `${formatCount(runningCount, 'task')} running.`,
            severity: 'info',
            state: 'available',
            statusLabel: 'Running'
        };
    }

    return {
        message: 'Scheduled tasks are operating normally.',
        severity: 'healthy',
        state: 'available',
        statusLabel: 'Healthy'
    };
}

export function normalizeAdminTasks(
    tasks: readonly TaskInfo[],
    options: AdminTaskNormalizationOptions = {}
): AdminTasksSummary {
    const now = resolveNow(options.now);
    const recentWindowMs = resolveRecentWindow(options.recentFailureWindowMs);
    const recentLimit = resolveRecentLimit(options.recentLimit);
    const normalized = tasks.map(task => normalizeTask(task, now, recentWindowMs));
    const runningCount = normalized.filter(task => task.item.state === 'running').length;
    const failedRecentlyCount = normalized.filter(task => task.item.state === 'failed'
        && isWithinRecentWindow(task.sortTimestamp, now, recentWindowMs)).length;
    const cancelledRecentlyCount = normalized.filter(task => task.item.state === 'cancelled'
        && isWithinRecentWindow(task.sortTimestamp, now, recentWindowMs)).length;
    const abortedRecentlyCount = normalized.filter(task => task.item.state === 'aborted'
        && isWithinRecentWindow(task.sortTimestamp, now, recentWindowMs)).length;
    const attentionCount = failedRecentlyCount + abortedRecentlyCount;
    const recent = normalized
        .filter(task => task.priority > 0)
        .sort((left, right) => right.priority - left.priority
            || right.sortTimestamp - left.sortTimestamp
            || left.item.name.localeCompare(right.item.name))
        .slice(0, recentLimit)
        .map(task => task.item);

    return {
        abortedRecentlyCount,
        cancelledRecentlyCount,
        failedRecentlyCount,
        recent,
        runningCount,
        sourceState: 'ready',
        ...taskSummaryPresentation(runningCount, attentionCount)
    };
}

export function createUnavailableAdminTasks(): AdminTasksSummary {
    return {
        abortedRecentlyCount: null,
        cancelledRecentlyCount: null,
        failedRecentlyCount: null,
        message: 'Scheduled task information could not be loaded.',
        recent: [],
        runningCount: null,
        severity: 'unknown',
        sourceState: 'unavailable',
        state: 'unavailable',
        statusLabel: 'Unavailable'
    };
}

function getServerWarnings(server: AdminServerSummary): AdminDashboardWarning[] {
    switch (server.state) {
        case 'unavailable':
            return [ {
                code: 'server-unavailable',
                message: 'Server information could not be loaded.',
                severity: 'error',
                source: 'server',
                title: 'Server connection issue'
            } ];
        case 'shutting-down':
            return [ {
                code: 'server-shutting-down',
                message: 'The server is shutting down.',
                severity: 'error',
                source: 'server',
                title: 'Server shutting down'
            } ];
        case 'restart-pending':
            return [ {
                code: 'server-restart-pending',
                message: 'A server restart is pending.',
                severity: 'warning',
                source: 'server',
                title: 'Restart pending'
            } ];
        default:
            return [];
    }
}

function getPtvWarnings(ptv: AdminPtvSummary): AdminDashboardWarning[] {
    const warnings: AdminDashboardWarning[] = [];

    if (ptv.state === 'unavailable') {
        warnings.push({
            code: 'ptv-unavailable',
            message: 'PiggieTV plugin status is temporarily unavailable.',
            severity: 'error',
            source: 'ptv',
            title: 'PTV Plugin unavailable'
        });
    } else if (
        ptv.state === 'degraded'
        && ptv.featuredContent.state !== 'empty'
        && ptv.featuredContent.state !== 'stale'
    ) {
        warnings.push({
            code: 'ptv-degraded',
            message: 'The PiggieTV plugin is reachable, but attention is required.',
            severity: 'warning',
            source: 'ptv',
            title: 'PTV Plugin degraded'
        });
    }

    if (ptv.featuredContent.state === 'empty') {
        warnings.push({
            code: 'featured-content-empty',
            message: 'Featured content is unavailable until the cache contains media.',
            severity: 'warning',
            source: 'ptv',
            title: 'Featured content cache is empty'
        });
    } else if (ptv.featuredContent.state === 'stale') {
        warnings.push({
            code: 'featured-content-stale',
            message: 'Featured content is available, but its cache is stale.',
            severity: 'warning',
            source: 'ptv',
            title: 'Featured content needs refresh'
        });
    }

    return warnings;
}

function getLibraryWarnings(libraries: AdminLibrariesSummary): AdminDashboardWarning[] {
    if (libraries.state === 'unavailable') {
        return [ {
            code: 'libraries-unavailable',
            message: 'Library information could not be loaded.',
            severity: 'warning',
            source: 'libraries',
            title: 'Libraries unavailable'
        } ];
    }

    if (libraries.state === 'empty') {
        return [ {
            code: 'libraries-empty',
            message: 'No media libraries are configured.',
            severity: 'info',
            source: 'libraries',
            title: 'No libraries configured'
        } ];
    }

    return [];
}

function getPlaybackWarnings(playback: AdminPlaybackSummary): AdminDashboardWarning[] {
    if (playback.state !== 'unavailable') return [];

    return [ {
        code: 'sessions-unavailable',
        message: 'Active stream information could not be loaded.',
        severity: 'warning',
        source: 'playback',
        title: 'Playback activity unavailable'
    } ];
}

function getTaskWarnings(tasks: AdminTasksSummary): AdminDashboardWarning[] {
    if (tasks.state === 'unavailable') {
        return [ {
            code: 'tasks-unavailable',
            message: 'Scheduled task information could not be loaded.',
            severity: 'warning',
            source: 'tasks',
            title: 'Task status unavailable'
        } ];
    }

    const warnings: AdminDashboardWarning[] = [];
    const failedCount = tasks.failedRecentlyCount ?? 0;
    const abortedCount = tasks.abortedRecentlyCount ?? 0;

    if (failedCount > 0) {
        warnings.push({
            code: 'tasks-failed',
            message: `${formatCount(failedCount, 'scheduled task')} failed recently.`,
            severity: 'warning',
            source: 'tasks',
            title: 'Scheduled task failure'
        });
    }

    if (abortedCount > 0) {
        warnings.push({
            code: 'tasks-aborted',
            message: `${formatCount(abortedCount, 'scheduled task')} aborted recently.`,
            severity: 'warning',
            source: 'tasks',
            title: 'Scheduled task aborted'
        });
    }

    return warnings;
}

export function buildAdminDashboardWarnings(
    sources: AdminDashboardSources
): readonly AdminDashboardWarning[] {
    return [
        ...getServerWarnings(sources.server),
        ...getPtvWarnings(sources.ptv),
        ...getLibraryWarnings(sources.libraries),
        ...getPlaybackWarnings(sources.playback),
        ...getTaskWarnings(sources.tasks)
    ];
}

export function buildAdminDashboardOverall(
    sources: AdminDashboardSources,
    warnings: readonly AdminDashboardWarning[] = buildAdminDashboardWarnings(sources)
): AdminDashboardOverall {
    if (sources.server.state === 'unavailable' || sources.server.state === 'shutting-down') {
        return {
            message: 'PiggieTV cannot confirm normal server operation.',
            severity: 'error',
            state: 'server-issue',
            statusLabel: 'Server connection issue'
        };
    }

    if (sources.ptv.state === 'unavailable') {
        return {
            message: 'The server is reachable, but the PiggieTV plugin is unavailable.',
            severity: 'error',
            state: 'plugin-unavailable',
            statusLabel: 'PTV plugin unavailable'
        };
    }

    if (warnings.some(warning => warning.severity === 'error' || warning.severity === 'warning')) {
        return {
            message: 'Review the items requiring attention below.',
            severity: 'warning',
            state: 'attention',
            statusLabel: 'Attention required'
        };
    }

    if (sources.ptv.state === 'unknown' || sources.ptv.featuredContent.state === 'unknown') {
        return {
            message: 'Server operation is available, but complete health could not be determined.',
            severity: 'unknown',
            state: 'unknown',
            statusLabel: 'Status incomplete'
        };
    }

    return {
        message: 'Server, PiggieTV, libraries, playback and tasks are responding normally.',
        severity: 'healthy',
        state: 'operational',
        statusLabel: 'All systems operational'
    };
}

export function createAdminDashboardSnapshot(
    sources: AdminDashboardSources,
    generatedAt: Date | number = Date.now()
): AdminDashboardSnapshot {
    const warnings = buildAdminDashboardWarnings(sources);
    const timestamp = generatedAt instanceof Date ? generatedAt.getTime() : generatedAt;

    return {
        ...sources,
        generatedAt: toIsoDate(timestamp) || new Date().toISOString(),
        overall: buildAdminDashboardOverall(sources, warnings),
        warnings
    };
}
