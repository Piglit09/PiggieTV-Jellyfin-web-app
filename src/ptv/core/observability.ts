import { PTV_DEBUG, PTV_EVENTS, PTV_RUNTIME } from './config';
import {
    applyPtvClientProfileClasses,
    getPtvClientProfile,
    getPtvPerformanceProfile,
    type PtvClientProfile,
    type PtvPerformanceProfile
} from './clientProfile';
import { dispatchPtvCustomEvent } from './events';
import { getPtvPluginApiDiagnostics, getPtvPluginApiResolvedRoot } from './pluginApi';
import { getPtvRuntimeDiagnostics } from './runtime';
import { resetRuntimeScope } from './scope';
import { classifyPtvRequestUrl } from './urlOrigins';
import { appendBoundedPtvEvent } from './observabilityBuffer';
import { redactPtvSensitiveText, redactPtvSensitiveValue } from './diagnostics/redaction';
import { ptvSafeConsole } from './safeConsole';

export type PtvDebugEventType =
    | 'api'
    | 'cache'
    | 'frame'
    | 'image'
    | 'memory'
    | 'playback'
    | 'profile'
    | 'recommendation'
    | 'render'
    | 'route'
    | 'row-fetch';

export type PtvObservabilityEvent = Readonly<{
    at: number;
    detail?: unknown;
    durationMs?: number;
    kind: 'event' | 'timing';
    name: string;
    type: PtvDebugEventType;
}>;

type PtvDebugTiming = {
    at: number;
    detail?: unknown;
    durationMs: number;
    name: string;
    type: PtvDebugEventType;
};

type PtvDebugEvent = {
    at: number;
    detail?: unknown;
    name: string;
    type: PtvDebugEventType;
};

type PtvImageTracker = {
    completed: boolean;
    imageInstanceId: string;
    lastEventAt: number;
    lastEventKey: string;
    resetCount: number;
    routeKey: string;
    sourceComponent: string;
    startedAt: number;
    url: string;
};

type PtvDebugSummary = {
    averageMs: number;
    count: number;
    maxMs: number;
    p95Ms: number;
};

type PtvDebugRecommendationSummary = PtvDebugSummary & {
    duplicateItemsRemoved: number;
    recommendationEngineLoaded: boolean;
    recommendationProfileLoaded: boolean;
    recommendationProviderLoaded: boolean;
    recommendationRowsGenerated: number;
    recommendationRowsRendered: number;
    rowOverlapPercentage: number;
    scoreDistribution: unknown;
    unresolvedArtistCount: number;
};

type PtvDebugHomeSummary = {
    backgroundRefreshCompleted: boolean;
    backgroundRefreshDurationMs: number | null;
    backgroundRefreshStarted: boolean;
    cacheHeroUsed: boolean;
    cacheRenderMs: number | null;
    cacheRowsUsed: boolean;
    cacheUsedForHero: boolean;
    cacheUsedForRows: boolean;
    fallbackFetchesSkipped: string[];
    firstInteractiveMs: number | null;
    homeInitialRenderMs: number | null;
    slowFetchesAborted: string[];
};

type PtvDebugReadingSummary = {
    firstPageRenderMs: number | null;
    readerOpenMs: number | null;
    readingCacheRenderMs: number | null;
    readingFirstShelfMs: number | null;
    readingFullyLoadedMs: number | null;
    readingImage: PtvDebugSummary;
    readingInitialRenderMs: number | null;
    readingLibraryDiscoveryMs: number | null;
    readingShelfFetch: PtvDebugSummary;
    readingSlowFetchesAborted: string[];
};

type PtvDebugTvRenderSummary = {
    activeCardCount: number;
    mountedHomeCardCount: number;
    mountedHomeRowCount: number;
    peakMountedCardCount: number;
    plannedHomeCardCount: number;
    visibleBrowseShelfCount: number;
};

type PtvDebugApi = {
    clear: () => void;
    disable: () => void;
    enable: () => void;
    event: (type: PtvDebugEventType, name: string, detail?: unknown) => void;
    report: () => ReturnType<typeof getPtvDebugReport>;
    shouldCollect: typeof shouldCollectDiagnostics;
    time: typeof timePtvAsync;
    timing: (type: PtvDebugEventType, name: string, durationMs: number, detail?: unknown) => void;
};

type PtvGlobal = Record<string, unknown> & {
    debug?: PtvDebugApi;
};

/* eslint-disable @typescript-eslint/naming-convention -- Existing browser runtime sentinels intentionally use global-style names. */
type PtvWindow = Window & Partial<Record<'PTV_DEBUG' | '__PTV_IMAGE_TRACKER__' | '__PTV_OBSERVABILITY_INSTALLED__' | '__PTV_STARTUP_EVENT_RECORDED__', boolean>> & {
    PTV?: PtvGlobal;
    __PTV_INITIALIZATION_ATTEMPT_COUNT__?: number;
    __PTV_INITIALIZATION_COMPLETED_COUNT__?: number;
    __PTV_INITIALIZATION_SKIPPED_OWNERS__?: Record<string, boolean>;
    __PTV_INITIALIZATION_SKIPPED_COUNT__?: number;
    __PTV_INITIALIZATION_OWNER__?: string;
};
/* eslint-enable @typescript-eslint/naming-convention */

type NavigatorWithMemory = Navigator & {
    deviceMemory?: number;
};

type PerformanceWithMemory = Performance & {
    memory?: {
        jsHeapSizeLimit?: number;
        totalJSHeapSize?: number;
        usedJSHeapSize?: number;
    };
};

const ptvWindow = window as PtvWindow;
const dispatchDebugEvent = dispatchPtvCustomEvent as (eventName: string, detail?: unknown) => void;
const timings: PtvDebugTiming[] = [];
const events: PtvDebugEvent[] = [];
const observabilitySubscribers = new Set<(event: PtvObservabilityEvent) => void>();
const readingImageProfileCacheHits = new Map<string, {
    count: number;
    imageProfile: string;
    preferredImageType: string;
}>();
let readingImageProfileRepresentativeEvents = 0;
const imageTrackers = new WeakMap<HTMLImageElement, PtvImageTracker>();
const imageEventDedupe = new Map<string, number>();
const imageTrackerResetDedupe = new Map<string, number>();
const observedImageFailures = new Map<string, number>();
const observedImageRetrySuppressions = new Map<string, number>();
const observedResourceEntries = new Map<string, number>();
const IMAGE_EVENT_DEDUPE_MS = 15 * 1000;
const IMAGE_ERROR_SUPPRESSION_MS = 5 * 60 * 1000;
const IMAGE_MAX_LIFECYCLE_MS = 15 * 1000;
const IMAGE_TRACKER_RESET_DEDUPE_MS = 30 * 1000;
const STATIC_LOGO_EVENT_SUPPRESSION_MS = 5 * 60 * 1000;
const IMAGE_DEDUPE_LIMIT = 500;
const PTV_FORCE_DIAGNOSTICS_KEY = 'ptv:debug-force-diagnostics';

let debugEnabled = false;
let debugAdminAllowed = false;
let debugScope: ReturnType<typeof resetRuntimeScope> | null = null;
let debugCacheStatusProvider: (() => unknown) | null = null;
let debugShellStatusProvider: (() => unknown) | null = null;
let debugSignupStatusProvider: (() => unknown) | null = null;
let resourceObserver: PerformanceObserver | null = null;
let resourceObserverAttachedAt = 0;
let imageInstanceSequence = 0;

function now() {
    return Math.round(performance.now());
}

function trimBuffer<T>(buffer: T[], maxLength: number) {
    if (buffer.length <= maxLength) return;

    buffer.splice(0, buffer.length - maxLength);
}

function getReadingImageProfileCacheHitSummary() {
    const byProfileType = [...readingImageProfileCacheHits.values()]
        .sort((left, right) => left.imageProfile.localeCompare(right.imageProfile)
            || left.preferredImageType.localeCompare(right.preferredImageType));

    return {
        byProfileType,
        representativeEvents: readingImageProfileRepresentativeEvents,
        total: byProfileType.reduce((sum, entry) => sum + entry.count, 0)
    };
}

function aggregateReadingImageProfileCacheHit(detail: unknown) {
    if (!isRecord(detail)) return null;

    const imageProfile = typeof detail.imageProfile === 'string' ? detail.imageProfile : 'unknown';
    const preferredImageType = typeof detail.preferredImageType === 'string' ? detail.preferredImageType : 'unknown';
    const key = `${imageProfile}:${preferredImageType}`;
    const aggregate = readingImageProfileCacheHits.get(key) || {
        count: 0,
        imageProfile,
        preferredImageType
    };

    aggregate.count += 1;
    readingImageProfileCacheHits.set(key, aggregate);

    const shouldKeepRepresentative = aggregate.count <= 3
        || [10, 25, 50].includes(aggregate.count)
        || aggregate.count % 100 === 0;

    if (!shouldKeepRepresentative) return null;

    readingImageProfileRepresentativeEvents += 1;

    return {
        cacheHitCount: aggregate.count,
        imageProfile,
        preferredImageType,
        representative: true
    };
}

function getStorage() {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function getInitialDebugValue() {
    return Boolean(
        ptvWindow.PTV_DEBUG === true
        || window.location.search.includes('ptvDebug=1')
        || getStorage()?.getItem(PTV_DEBUG.storageKey) === '1'
        || getStorage()?.getItem(PTV_DEBUG.legacyStorageKey) === '1'
    );
}

function getForceDiagnosticsValue() {
    return Boolean(
        window.location.search.includes('ptvForceDiagnostics=1')
        || getStorage()?.getItem(PTV_FORCE_DIAGNOSTICS_KEY) === '1'
    );
}

export function shouldCollectDiagnostics() {
    if (!debugEnabled || !debugAdminAllowed) return false;

    if (getForceDiagnosticsValue()) return true;

    const profile = getPtvPerformanceProfile();

    return !profile.isFireTv && !profile.isLowPower;
}

function getPtvGlobal() {
    ptvWindow.PTV ||= {};

    return ptvWindow.PTV;
}

function debugConsole(message: string, detail?: unknown) {
    if (!shouldCollectDiagnostics()) return;

    ptvSafeConsole.debug(`[PiggieTV Debug] ${message}`, detail);
}

function warnDebug(message: string, detail?: unknown) {
    if (!shouldCollectDiagnostics()) return;

    ptvSafeConsole.warn(`[PiggieTV Debug] ${message}`, detail);
}

function getActiveProfiles(): {
    clientProfile: PtvClientProfile;
    performanceProfile: PtvPerformanceProfile;
} {
    const clientProfile = applyPtvClientProfileClasses();
    const performanceProfile = getPtvPerformanceProfile();

    if (!performanceProfile.renderProfile?.id || !performanceProfile.renderProfile?.tier) {
        warnDebug('Unable to detect active render profile.', {
            clientProfile,
            performanceProfile
        });
    }

    return {
        clientProfile,
        performanceProfile
    };
}

export function recordPtvStartupEvent(owner = 'observability') {
    const runtimeDiagnostics = getPtvRuntimeDiagnostics();

    if (ptvWindow.__PTV_STARTUP_EVENT_RECORDED__) {
        const skippedOwners = ptvWindow.__PTV_INITIALIZATION_SKIPPED_OWNERS__ || {};

        if (skippedOwners[owner]) return;

        skippedOwners[owner] = true;
        ptvWindow.__PTV_INITIALIZATION_SKIPPED_OWNERS__ = skippedOwners;
        ptvWindow.__PTV_INITIALIZATION_SKIPPED_COUNT__ = (ptvWindow.__PTV_INITIALIZATION_SKIPPED_COUNT__ || 0) + 1;

        if (!shouldCollectDiagnostics()) return;

        recordPtvEvent('profile', 'ptv:init-skipped', {
            existingRuntimeDetected: true,
            initializationAttemptCount: ptvWindow.__PTV_INITIALIZATION_ATTEMPT_COUNT__ || runtimeDiagnostics.runtimeCreateCount || 1,
            initializationCompletedCount: ptvWindow.__PTV_INITIALIZATION_COMPLETED_COUNT__ || (runtimeDiagnostics.ready ? 1 : 0),
            initializationOwner: ptvWindow.__PTV_INITIALIZATION_OWNER__ || owner,
            initializationSkippedCount: ptvWindow.__PTV_INITIALIZATION_SKIPPED_COUNT__,
            runtime: runtimeDiagnostics,
            skippedOwner: owner
        });

        return;
    }

    ptvWindow.__PTV_INITIALIZATION_ATTEMPT_COUNT__ = runtimeDiagnostics.runtimeCreateCount || 1;
    ptvWindow.__PTV_STARTUP_EVENT_RECORDED__ = true;
    ptvWindow.__PTV_INITIALIZATION_COMPLETED_COUNT__ = runtimeDiagnostics.ready ? 1 : 0;
    ptvWindow.__PTV_INITIALIZATION_OWNER__ = owner;

    if (!shouldCollectDiagnostics()) return;

    const {
        clientProfile,
        performanceProfile
    } = getActiveProfiles();

    recordPtvEvent('profile', 'ptv:init', {
        clientProfile: {
            hasHover: clientProfile.hasHover,
            isAndroidTv: clientProfile.isAndroidTv,
            isCoarsePointer: clientProfile.isCoarsePointer,
            isFireTv: clientProfile.isFireTv,
            isLowPower: clientProfile.isLowPower,
            isMobile: clientProfile.isMobile,
            isRoku: clientProfile.isRoku,
            isTenFootClient: clientProfile.isTenFootClient,
            isTizen: clientProfile.isTizen,
            isTv: clientProfile.isTv,
            isWebOs: clientProfile.isWebOs,
            kind: clientProfile.kind,
            layoutMode: clientProfile.layoutMode,
            responsive: clientProfile.responsive,
            supportsAspectRatio: clientProfile.supportsAspectRatio,
            supportsBackdropFilter: clientProfile.supportsBackdropFilter,
            supportsContainerQueries: clientProfile.supportsContainerQueries,
            supportsContentVisibility: clientProfile.supportsContentVisibility,
            tvDetectionReason: clientProfile.tvDetectionReason,
            tvPlatform: clientProfile.tvPlatform
        },
        existingRuntimeDetected: false,
        initializationAttemptCount: ptvWindow.__PTV_INITIALIZATION_ATTEMPT_COUNT__,
        initializationCompletedCount: ptvWindow.__PTV_INITIALIZATION_COMPLETED_COUNT__,
        initializationOwner: owner,
        initializationSkippedCount: ptvWindow.__PTV_INITIALIZATION_SKIPPED_COUNT__ || 0,
        renderProfile: performanceProfile.renderProfile,
        runtime: runtimeDiagnostics
    });
}

function getMemorySnapshot() {
    const memory = (performance as PerformanceWithMemory).memory;
    const deviceMemory = Number((navigator as NavigatorWithMemory).deviceMemory || 0);
    const heapRatio = memory?.jsHeapSizeLimit && memory.usedJSHeapSize ?
        memory.usedJSHeapSize / memory.jsHeapSizeLimit :
        0;

    let mode: 'high' | 'low' | 'medium' | 'unknown' = 'unknown';

    if (deviceMemory > 0 && deviceMemory <= 2) {
        mode = 'low';
    } else if (deviceMemory > 0 && deviceMemory <= 4) {
        mode = 'medium';
    } else if (deviceMemory > 4 || heapRatio > 0) {
        mode = heapRatio > 0.82 ? 'low' : 'high';
    }

    return {
        deviceMemory,
        hardwareConcurrency: Number(navigator['hardwareConcurrency'] || 0),
        jsHeapLimit: memory?.jsHeapSizeLimit || 0,
        mode,
        totalJsHeap: memory?.totalJSHeapSize || 0,
        usedJsHeap: memory?.usedJSHeapSize || 0,
        usedRatio: heapRatio
    };
}

function getTimingSummary(type: PtvDebugEventType): PtvDebugSummary {
    const values = timings
        .filter(timing => timing.type === type)
        .map(timing => timing.durationMs)
        .sort((a, b) => a - b);

    if (!values.length) {
        return {
            averageMs: 0,
            count: 0,
            maxMs: 0,
            p95Ms: 0
        };
    }

    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const p95Index = Math.min(values.length - 1, Math.floor(values.length * 0.95));

    return {
        averageMs: Number(average.toFixed(1)),
        count: values.length,
        maxMs: Number(values[values.length - 1].toFixed(1)),
        p95Ms: Number(values[p95Index].toFixed(1))
    };
}

function getEventCount(type: PtvDebugEventType, name: string) {
    return events.filter(event => event.type === type && event.name === name).length;
}

function getLatestEvent(type: PtvDebugEventType, name: string) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];

        if (event.type === type && event.name === name) return event;
    }

    return null;
}

function getLatestEventByNames(type: PtvDebugEventType, names: string[]) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];

        if (event.type === type && names.includes(event.name)) return event;
    }

    return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasAnyRecommendationEvent(names: string[]) {
    return names.some(name => getEventCount('recommendation', name) > 0);
}

function getFiniteNumber(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return null;

    const numericValue = Number(value);

    return Number.isFinite(numericValue) ? numericValue : null;
}

function getRecordNumber(detail: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
        const numericValue = getFiniteNumber(detail[key]);

        if (numericValue !== null) return numericValue;
    }

    return null;
}

function getRecordBoolean(detail: Record<string, unknown>, key: string) {
    return typeof detail[key] === 'boolean' ? detail[key] as boolean : false;
}

function getRecordStringArray(detail: Record<string, unknown>, key: string) {
    const value = detail[key];

    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function getTvRenderSummary(): PtvDebugTvRenderSummary {
    const homeDetail = getLatestEvent('render', 'native-home-render-complete')?.detail;
    const latestBrowseDetail = getLatestEventByNames('render', [
        'ptv-browse-row-render-mounted',
        'ptv-browse-row-render-unmounted'
    ])?.detail;
    let peakMountedCardCount = 0;

    events.forEach(event => {
        if (event.type !== 'render' || !isRecord(event.detail)) return;

        const peak = getRecordNumber(event.detail, [
            'peakMountedCardCount',
            'mountedCardsRendered'
        ]);

        if (peak !== null) peakMountedCardCount = Math.max(peakMountedCardCount, peak);
    });

    const getDetailNumber = (detail: unknown, keys: string[]) => {
        if (!isRecord(detail)) return 0;

        return getRecordNumber(detail, keys) || 0;
    };

    return {
        activeCardCount: getDetailNumber(latestBrowseDetail, ['activeCardCount']),
        mountedHomeCardCount: getDetailNumber(homeDetail, ['mountedCardsRendered']),
        mountedHomeRowCount: getDetailNumber(homeDetail, ['mountedRows']),
        peakMountedCardCount,
        plannedHomeCardCount: getDetailNumber(homeDetail, ['totalCardsPlanned']),
        visibleBrowseShelfCount: getDetailNumber(latestBrowseDetail, ['visibleShelfCount'])
    };
}

function getPlaybackOwnershipSummary() {
    if (typeof document === 'undefined') {
        return {
            audioElementCount: 0,
            duplicatePlayerSuppressed: 0,
            fullScreenMusicPlayerCount: 0,
            hiddenPlayerCount: 0,
            miniPlayerCount: 0,
            playbackControllerCount: 0,
            playbackPortalCount: 0
        };
    }

    const fullScreenSelector = '.ptv-music-now-playing-view, .ptv-music-fullscreen';
    const fullScreenPlayers = Array.from(document.querySelectorAll<HTMLElement>(fullScreenSelector));

    return {
        audioElementCount: document.querySelectorAll('audio[data-ptv-music-native-player="true"]').length,
        duplicatePlayerSuppressed: getEventCount('render', 'duplicate-music-player-overlay-suppressed'),
        fullScreenMusicPlayerCount: fullScreenPlayers.length,
        hiddenPlayerCount: fullScreenPlayers.filter(element => {
            const style = window.getComputedStyle(element);

            return style.display === 'none' || style.visibility === 'hidden' || element.hidden;
        }).length,
        miniPlayerCount: document.querySelectorAll('.ptv-media-dock-ptv-music').length,
        playbackControllerCount: document.querySelectorAll('audio[data-ptv-music-native-player="true"]').length ? 1 : 0,
        playbackPortalCount: document.querySelectorAll('[data-ptv-music-player-root="true"]').length
    };
}

function getLatestRecommendationNumber(names: string[], keys: string[]) {
    for (const name of names) {
        const detail = getLatestEvent('recommendation', name)?.detail;

        if (!isRecord(detail)) continue;

        const numericValue = getRecordNumber(detail, keys);

        if (numericValue !== null) return numericValue;
    }

    return 0;
}

function getLatestRecommendationValue(names: string[], key: string) {
    for (const name of names) {
        const detail = getLatestEvent('recommendation', name)?.detail;

        if (!isRecord(detail) || !(key in detail)) continue;

        return detail[key];
    }

    return null;
}

function getRecommendationSummary(): PtvDebugRecommendationSummary {
    return {
        ...getTimingSummary('recommendation'),
        duplicateItemsRemoved: getLatestRecommendationNumber([
            'native-home-recommendation-rows-loaded',
            'music-recommendation-rows-loaded',
            'recommendation-rows-generated',
            'recommendation-dashboard-rendered'
        ], [
            'duplicateItemsRemoved'
        ]),
        recommendationEngineLoaded: hasAnyRecommendationEvent([
            'recommendation-engine-created',
            'recommendation-engine-run'
        ]),
        recommendationProfileLoaded: hasAnyRecommendationEvent([
            'recommendation-profile-loaded'
        ]),
        recommendationProviderLoaded: hasAnyRecommendationEvent([
            'recommendation-provider-created',
            'recommendation-candidate-fetch-completed',
            'recommendation-candidate-fetch-complete',
            'recommendation-provider-loaded'
        ]),
        recommendationRowsGenerated: getLatestRecommendationNumber([
            'recommendation-rows-generated'
        ], [
            'rowCount'
        ]),
        recommendationRowsRendered: getLatestRecommendationNumber([
            'recommendation-dashboard-rendered',
            'row-builder-recommendation-rows-loaded',
            'music-recommendation-rows-loaded',
            'native-home-recommendation-rows-loaded'
        ], [
            'recommendationRowsRendered',
            'rowCount'
        ]),
        rowOverlapPercentage: getLatestRecommendationNumber([
            'native-home-recommendation-rows-loaded',
            'music-recommendation-rows-loaded',
            'recommendation-rows-generated',
            'recommendation-dashboard-rendered'
        ], [
            'rowOverlapPercentage'
        ]),
        scoreDistribution: getLatestRecommendationValue([
            'native-home-recommendation-rows-loaded',
            'music-recommendation-rows-loaded',
            'recommendation-dashboard-rendered'
        ], 'scoreDistribution'),
        unresolvedArtistCount: getLatestRecommendationNumber([
            'native-home-recommendation-rows-loaded',
            'music-recommendation-rows-loaded',
            'recommendation-dashboard-rendered'
        ], [
            'unresolvedArtistCount'
        ])
    };
}

function getHomeSummary(): PtvDebugHomeSummary {
    const detail = getLatestEvent('render', 'native-home-interactive')?.detail;

    if (!isRecord(detail)) {
        return {
            backgroundRefreshCompleted: false,
            backgroundRefreshDurationMs: null,
            backgroundRefreshStarted: false,
            cacheHeroUsed: false,
            cacheRenderMs: null,
            cacheRowsUsed: false,
            cacheUsedForHero: false,
            cacheUsedForRows: false,
            fallbackFetchesSkipped: [],
            firstInteractiveMs: null,
            homeInitialRenderMs: null,
            slowFetchesAborted: []
        };
    }

    return {
        backgroundRefreshCompleted: getRecordBoolean(detail, 'backgroundRefreshCompleted'),
        backgroundRefreshDurationMs: getRecordNumber(detail, ['backgroundRefreshDurationMs']),
        backgroundRefreshStarted: getRecordBoolean(detail, 'backgroundRefreshStarted'),
        cacheHeroUsed: getRecordBoolean(detail, 'cacheHeroUsed'),
        cacheRenderMs: getRecordNumber(detail, ['cacheRenderMs']),
        cacheRowsUsed: getRecordBoolean(detail, 'cacheRowsUsed'),
        cacheUsedForHero: getRecordBoolean(detail, 'cacheUsedForHero'),
        cacheUsedForRows: getRecordBoolean(detail, 'cacheUsedForRows'),
        fallbackFetchesSkipped: getRecordStringArray(detail, 'fallbackFetchesSkipped'),
        firstInteractiveMs: getRecordNumber(detail, ['firstInteractiveMs']),
        homeInitialRenderMs: getRecordNumber(detail, ['homeInitialRenderMs']),
        slowFetchesAborted: getRecordStringArray(detail, 'slowFetchesAborted')
    };
}

function getLatestReadingDetail(names: string[]) {
    for (const name of names) {
        const detail = getLatestEvent('render', name)?.detail;

        if (isRecord(detail)) return detail;
    }

    return null;
}

function getNamedTimingSummary(type: PtvDebugEventType, name: string): PtvDebugSummary {
    const values = timings
        .filter(timing => timing.type === type && timing.name === name)
        .map(timing => timing.durationMs)
        .sort((a, b) => a - b);

    if (!values.length) {
        return {
            averageMs: 0,
            count: 0,
            maxMs: 0,
            p95Ms: 0
        };
    }

    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const p95Index = Math.min(values.length - 1, Math.floor(values.length * 0.95));

    return {
        averageMs: Number(average.toFixed(1)),
        count: values.length,
        maxMs: Number(values[values.length - 1].toFixed(1)),
        p95Ms: Number(values[p95Index].toFixed(1))
    };
}

function getReadingSummary(): PtvDebugReadingSummary {
    const interactiveDetail = getLatestReadingDetail([
        'readingFullyLoadedMs',
        'readingFirstShelfMs',
        'reading-page-interactive',
        'readingInitialRenderMs'
    ]);
    const firstPageDetail = getLatestReadingDetail(['firstPageRenderMs']);
    const readerOpenDetail = getLatestReadingDetail(['readerOpenMs']);

    return {
        firstPageRenderMs: firstPageDetail ? getRecordNumber(firstPageDetail, ['firstPageRenderMs']) : null,
        readerOpenMs: readerOpenDetail ? getRecordNumber(readerOpenDetail, ['readerOpenMs']) : null,
        readingCacheRenderMs: interactiveDetail ? getRecordNumber(interactiveDetail, ['readingCacheRenderMs']) : null,
        readingFirstShelfMs: interactiveDetail ? getRecordNumber(interactiveDetail, ['readingFirstShelfMs']) : null,
        readingFullyLoadedMs: interactiveDetail ? getRecordNumber(interactiveDetail, ['readingFullyLoadedMs']) : null,
        readingImage: getTimingSummary('image'),
        readingInitialRenderMs: interactiveDetail ? getRecordNumber(interactiveDetail, ['readingInitialRenderMs']) : null,
        readingLibraryDiscoveryMs: interactiveDetail ? getRecordNumber(interactiveDetail, ['readingLibraryDiscoveryMs']) : null,
        readingShelfFetch: getNamedTimingSummary('api', 'readingShelfFetch'),
        readingSlowFetchesAborted: interactiveDetail ? getRecordStringArray(interactiveDetail, 'readingSlowFetchesAborted') : []
    };
}

function installDebugFlagAccessor() {
    const initialValue = getInitialDebugValue();

    debugEnabled = initialValue;

    try {
        Object.defineProperty(ptvWindow, 'PTV_DEBUG', {
            configurable: true,
            get() {
                return debugEnabled;
            },
            set(value: unknown) {
                setPtvDebug(value === true);
            }
        });
    } catch {
        ptvWindow.PTV_DEBUG = initialValue;
    }
}

function setDebugStorage(enabled: boolean) {
    const storage = getStorage();
    if (!storage) return;

    try {
        if (enabled) {
            storage.setItem(PTV_DEBUG.storageKey, '1');
        } else {
            storage.removeItem(PTV_DEBUG.storageKey);
        }

        storage.removeItem(PTV_DEBUG.legacyStorageKey);
    } catch {
        // Storage can be blocked on some embedded TV browsers.
    }
}

function getImageUrl(image: HTMLImageElement) {
    return image.currentSrc || image.src || image.getAttribute('src') || image.getAttribute('data-src') || '';
}

function normalizeImageTrackerUrl(url: string) {
    if (!url) return '';

    const anchor = document.createElement('a');
    anchor.href = url;

    return anchor.href || url;
}

function isStaticLogoUrl(url: string) {
    return /\/(?:web\/)?assets\/logo\/(?:banner-light|sidebar-logo)\.(?:webp|png)(?:[?#].*)?$/i.test(url);
}

function getImageSourceComponent(image: HTMLImageElement) {
    const explicitComponent = image.dataset.ptvImageComponent;

    if (explicitComponent) return explicitComponent;

    if (image.dataset.ptvLogo) return `${image.dataset.ptvLogo}-logo`;
    if (image.classList.contains('ptv-hero-logo')) return 'hero-logo';
    if (image.classList.contains('ptv-hero-bg')) return 'hero-backdrop';
    if (image.classList.contains('ptv-brand-logo')) return 'header-logo';
    if (image.classList.contains('ptv-sidebar-logo')) return 'sidebar-logo';
    if (image.classList.contains('ptv-drawer-logo')) return 'drawer-logo';

    return 'image';
}

function getImageDatasetBoolean(value: string | undefined) {
    if (value === undefined) return null;

    return value === 'true';
}

function getImageDatasetDebugDetail(image: HTMLImageElement): Record<string, unknown> {
    const {
        ptvImageBackdropTagsPresent,
        ptvImageHasBackdropTag,
        ptvImageHasPrimaryTag,
        ptvImageHasSeriesPrimaryTag,
        ptvImageHasThumbTag,
        ptvImageItemId,
        ptvImageItemName,
        ptvImageItemType,
        ptvImageTag,
        ptvImageTagsPresent,
        ptvImageType,
        ptvImageUrl
    } = image.dataset;
    const detail: Record<string, unknown> = {};

    if (ptvImageItemId) detail.itemId = ptvImageItemId;
    if (ptvImageItemName) detail.itemName = ptvImageItemName;
    if (ptvImageItemType) detail.itemType = ptvImageItemType;
    if (ptvImageUrl) detail.imageUrl = ptvImageUrl;
    if (ptvImageType) detail.imageType = ptvImageType;
    if (ptvImageTag) detail.imageTag = ptvImageTag;

    const imageTagsPresent = getImageDatasetBoolean(ptvImageTagsPresent);
    const backdropTagsPresent = getImageDatasetBoolean(ptvImageBackdropTagsPresent);
    const hasPrimaryTag = getImageDatasetBoolean(ptvImageHasPrimaryTag);
    const hasThumbTag = getImageDatasetBoolean(ptvImageHasThumbTag);
    const hasBackdropTag = getImageDatasetBoolean(ptvImageHasBackdropTag);
    const hasSeriesPrimaryTag = getImageDatasetBoolean(ptvImageHasSeriesPrimaryTag);

    if (imageTagsPresent !== null) detail.imageTagsPresent = imageTagsPresent;
    if (backdropTagsPresent !== null) detail.backdropTagsPresent = backdropTagsPresent;
    if (hasPrimaryTag !== null) detail.hasPrimaryTag = hasPrimaryTag;
    if (hasThumbTag !== null) detail.hasThumbTag = hasThumbTag;
    if (hasBackdropTag !== null) detail.hasBackdropTag = hasBackdropTag;
    if (hasSeriesPrimaryTag !== null) detail.hasSeriesPrimaryTag = hasSeriesPrimaryTag;

    return detail;
}

function createImageTracker(
    image: HTMLImageElement,
    url: string,
    previousTracker?: PtvImageTracker,
    completed = false
): PtvImageTracker {
    imageInstanceSequence += 1;

    return {
        completed,
        imageInstanceId: `image-${imageInstanceSequence}`,
        lastEventAt: previousTracker?.lastEventAt || 0,
        lastEventKey: previousTracker?.lastEventKey || '',
        resetCount: previousTracker?.resetCount || 0,
        routeKey: `${window.location.pathname}${window.location.hash}`,
        sourceComponent: getImageSourceComponent(image),
        startedAt: completed ? previousTracker?.startedAt || performance.now() : performance.now(),
        url
    };
}

function trimMap<TValue>(map: Map<string, TValue>, maxEntries = IMAGE_DEDUPE_LIMIT) {
    if (map.size <= maxEntries) return;

    const entriesToDelete = map.size - maxEntries;
    let deleted = 0;

    for (const key of map.keys()) {
        map.delete(key);
        deleted += 1;

        if (deleted >= entriesToDelete) return;
    }
}

function isResolvedImage(image: HTMLImageElement) {
    return Boolean(image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
}

function observeImage(image: HTMLImageElement) {
    if (!shouldCollectDiagnostics()) return;

    const url = normalizeImageTrackerUrl(getImageUrl(image));
    if (!url) return;

    const tracker = imageTrackers.get(image);
    const trackerUrl = normalizeImageTrackerUrl(tracker?.url || '');

    if (trackerUrl === url) return;

    if (isResolvedImage(image)) {
        imageTrackers.set(image, createImageTracker(image, url, tracker, true));
        return;
    }

    imageTrackers.set(image, createImageTracker(image, url, tracker));
}

function observeImages(root: ParentNode = document) {
    if (!shouldCollectDiagnostics()) return;

    root.querySelectorAll?.('img[src], img[data-src]').forEach(image => {
        if (image instanceof HTMLImageElement) {
            observeImage(image);
        }
    });
}

function getCurrentImageTracker(image: HTMLImageElement, url: string) {
    const existingTracker = imageTrackers.get(image);
    const normalizedUrl = normalizeImageTrackerUrl(url);
    const existingUrl = normalizeImageTrackerUrl(existingTracker?.url || '');

    if (!existingTracker || existingUrl === normalizedUrl) {
        return existingTracker;
    }

    const sourceComponent = getImageSourceComponent(image);
    const resetCount = existingTracker.resetCount + 1;
    const resetKey = `${sourceComponent}:${existingUrl}->${normalizedUrl}`;
    const lastResetAt = imageTrackerResetDedupe.get(resetKey);

    existingTracker.resetCount = resetCount;
    existingTracker.sourceComponent = sourceComponent;
    imageTrackerResetDedupe.set(resetKey, Date.now());
    trimMap(imageTrackerResetDedupe);

    if (!lastResetAt || Date.now() - lastResetAt >= IMAGE_TRACKER_RESET_DEDUPE_MS) {
        recordPtvEvent('image', 'image-tracker-reset', {
            nextUrl: normalizedUrl,
            previousUrl: existingUrl,
            resetCount,
            sourceComponent
        });
    }

    return undefined;
}

function getImageEventDetail(image: HTMLImageElement, url: string) {
    const originDetail = getRequestOriginDetail(url);

    return {
        ...originDetail,
        ...getImageDatasetDebugDetail(image),
        imageUrl: image.dataset.ptvImageUrl || url,
        naturalHeight: image.naturalHeight,
        naturalWidth: image.naturalWidth,
        url
    };
}

function getRequestOriginDetail(url: string) {
    const pluginApiRoot = getPtvPluginApiResolvedRoot();

    return classifyPtvRequestUrl(url, {
        jellyfinRoot: pluginApiRoot,
        pluginRoot: pluginApiRoot
    });
}

function getImageResourceDuration(url: string) {
    const getEntriesByName = Reflect.get(performance, 'getEntriesByName');

    if (typeof getEntriesByName !== 'function') return null;

    const entries = getEntriesByName.call(performance, url, 'resource') as PerformanceEntry[];

    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index] as PerformanceResourceTiming;

        if (entry.initiatorType === 'img' && Number.isFinite(entry.duration)) {
            return Math.max(0, entry.duration);
        }
    }

    return null;
}

function handleImageError(image: HTMLImageElement, tracker: PtvImageTracker | undefined, eventName: string, url: string) {
    markImageTrackerComplete(image, tracker, eventName, url);

    const failedAt = observedImageFailures.get(url);
    const suppressLoggedAt = observedImageRetrySuppressions.get(url);
    const isSuppressed = Boolean(failedAt && Date.now() - failedAt < IMAGE_ERROR_SUPPRESSION_MS);
    const detail = getImageEventDetail(image, url);

    if (isSuppressed) {
        if (!suppressLoggedAt || Date.now() - suppressLoggedAt >= IMAGE_ERROR_SUPPRESSION_MS) {
            observedImageRetrySuppressions.set(url, Date.now());
            trimMap(observedImageRetrySuppressions);
            recordPtvEvent('image', 'image-retry-suppressed', detail);
        }

        return;
    }

    observedImageFailures.set(url, Date.now());
    trimMap(observedImageFailures);
    recordPtvEvent('image', 'image-failed-once', detail);
    warnDebug('Image failed to load.', detail);
}

function handleImageLoad(image: HTMLImageElement, tracker: PtvImageTracker | undefined, eventName: string, url: string) {
    const observerAgeMs = tracker ? performance.now() - tracker.startedAt : 0;
    const currentRouteKey = `${window.location.pathname}${window.location.hash}`;

    markImageTrackerComplete(image, tracker, eventName, url);

    if (tracker && tracker.routeKey !== currentRouteKey) {
        recordPtvEvent('image', 'image-timing-route-mismatch', {
            ...getImageEventDetail(image, url),
            imageTimingRouteMismatch: true,
            observerAttachedAt: tracker.startedAt,
            routeKey: currentRouteKey,
            trackerRouteKey: tracker.routeKey
        });
        return;
    }

    if (isStaticLogoUrl(url) && observerAgeMs > 1000) {
        const resourceDurationMs = getImageResourceDuration(url);

        recordPtvEvent('image', 'static-logo-load-suppressed', {
            ...getImageEventDetail(image, url),
            durationMs: resourceDurationMs === null ? null : Number(resourceDurationMs.toFixed(1)),
            observerAgeDiscarded: true,
            timingSource: resourceDurationMs === null ? 'unavailable' : 'resource'
        });
        return;
    }

    if (observerAgeMs > IMAGE_MAX_LIFECYCLE_MS) {
        recordPtvEvent('image', 'image-duration-discarded', {
            ...getImageEventDetail(image, url),
            observerAgeMs: Number(observerAgeMs.toFixed(1)),
            staleImageTimingDiscarded: true
        });
        return;
    }

    if (observerAgeMs > 0) {
        recordPtvTiming('image', eventName, observerAgeMs, getImageEventDetail(image, url));
        return;
    }

    recordPtvEvent('image', eventName, getImageEventDetail(image, url));
}

function handleImageDone(event: Event) {
    if (!shouldCollectDiagnostics()) return;
    if (!(event.target instanceof HTMLImageElement)) return;

    const image = event.target;
    const url = normalizeImageTrackerUrl(getImageUrl(image) || imageTrackers.get(image)?.url || '');
    if (!url) return;

    const eventName = event.type === 'error' ? 'image-error' : 'image-load';
    const tracker = getCurrentImageTracker(image, url);

    if (shouldSuppressImageEvent(image, tracker, eventName, url)) return;

    if (event.type === 'error') {
        handleImageError(image, tracker, eventName, url);
        return;
    }

    handleImageLoad(image, tracker, eventName, url);
}

function shouldSuppressImageEvent(
    image: HTMLImageElement,
    tracker: PtvImageTracker | undefined,
    eventName: string,
    url: string
) {
    const eventAt = Date.now();
    const eventKey = `${eventName}:${url}`;
    const lastGlobalEventAt = imageEventDedupe.get(eventKey);

    if (
        tracker?.lastEventKey === eventKey
        && eventAt - tracker.lastEventAt < IMAGE_EVENT_DEDUPE_MS
    ) {
        return true;
    }

    if (lastGlobalEventAt && eventAt - lastGlobalEventAt < IMAGE_EVENT_DEDUPE_MS) {
        return true;
    }

    imageEventDedupe.set(eventKey, eventAt);
    trimMap(imageEventDedupe);
    markImageTrackerComplete(image, tracker, eventName, url);

    return false;
}

function markImageTrackerComplete(
    image: HTMLImageElement,
    tracker: PtvImageTracker | undefined,
    eventName: string,
    url: string
) {
    const nextTracker = tracker || {
        completed: false,
        imageInstanceId: `image-${++imageInstanceSequence}`,
        lastEventAt: 0,
        lastEventKey: '',
        resetCount: 0,
        routeKey: `${window.location.pathname}${window.location.hash}`,
        sourceComponent: getImageSourceComponent(image),
        startedAt: performance.now(),
        url
    };

    nextTracker.completed = true;
    nextTracker.lastEventAt = Date.now();
    nextTracker.lastEventKey = `${eventName}:${url}`;
    nextTracker.sourceComponent = getImageSourceComponent(image);
    nextTracker.url = url;
    imageTrackers.set(image, nextTracker);
}

function startResourceObserver() {
    const PerformanceObserverCtor = window['PerformanceObserver'];

    if (!PerformanceObserverCtor || resourceObserver) return;

    try {
        resourceObserverAttachedAt = performance.now();
        const setResourceTimingBufferSize = performance['setResourceTimingBufferSize'];

        if (typeof setResourceTimingBufferSize === 'function') {
            setResourceTimingBufferSize.call(performance, PTV_DEBUG.resourceTimingBufferSize);
        }

        resourceObserver = new PerformanceObserverCtor(list => {
            list.getEntries().forEach(entry => {
                if ((entry as PerformanceResourceTiming).initiatorType !== 'img') return;

                if (entry.startTime < resourceObserverAttachedAt - 1) {
                    recordPtvEvent('image', 'stale-image-resource-timing-discarded', {
                        observerAttachedAt: Number(resourceObserverAttachedAt.toFixed(1)),
                        resourceStartTime: Number(entry.startTime.toFixed(1)),
                        staleImageTimingDiscarded: true,
                        url: entry.name
                    });
                    return;
                }

                if (shouldSuppressResourceEntry(entry as PerformanceResourceTiming)) return;

                recordPtvTiming('image', 'image-resource', entry.duration || 0, {
                    ...getRequestOriginDetail(entry.name),
                    transferSize: (entry as PerformanceResourceTiming).transferSize || 0,
                    url: entry.name
                });
            });
        });
        resourceObserver.observe({
            buffered: true,
            type: 'resource'
        });
    } catch {
        resourceObserver = null;
    }
}

function shouldSuppressResourceEntry(entry: PerformanceResourceTiming) {
    if (isStaticLogoUrl(entry.name)) {
        const staticLogoKey = `static-logo:${entry.name}`;
        const lastStaticLogoAt = observedResourceEntries.get(staticLogoKey);

        if (lastStaticLogoAt && Date.now() - lastStaticLogoAt < STATIC_LOGO_EVENT_SUPPRESSION_MS) {
            return true;
        }

        observedResourceEntries.set(staticLogoKey, Date.now());
    }

    const entryKey = [
        entry.name,
        Math.round(entry.startTime || 0),
        Math.round(entry.duration || 0),
        entry.transferSize || 0
    ].join(':');

    if (observedResourceEntries.has(entryKey)) return true;

    observedResourceEntries.set(entryKey, Date.now());
    trimMap(observedResourceEntries);

    return false;
}

function stopResourceObserver() {
    resourceObserver?.disconnect();
    resourceObserver = null;
    resourceObserverAttachedAt = 0;
}

function startDebugObservers() {
    if (!shouldCollectDiagnostics()) return;
    if (debugScope) return;
    if (!document.body) {
        window.addEventListener('DOMContentLoaded', startDebugObservers, { once: true });
        return;
    }

    debugScope = resetRuntimeScope('debug-observability');
    ptvWindow.__PTV_IMAGE_TRACKER__ = true;
    debugScope.listen(document, 'load', handleImageDone, true);
    debugScope.listen(document, 'error', handleImageDone, true);
    const observer = new MutationObserver((mutations: MutationRecord[]) => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node instanceof HTMLImageElement) {
                    observeImage(node);
                } else if (node instanceof HTMLElement) {
                    observeImages(node);
                }
            });

            if (mutation.target instanceof HTMLImageElement) {
                observeImage(mutation.target);
            }
        });
    });

    observer.observe(document.body, {
        attributeFilter: ['src', 'data-src', 'srcset'],
        attributes: true,
        childList: true,
        subtree: true
    });
    debugScope.add(() => observer.disconnect(), {
        label: 'debug image observer',
        type: 'observer'
    });
    debugConsole('image observer created');
    debugScope.interval(() => {
        recordPtvEvent('memory', 'sample', getMemorySnapshot());
    }, 5000);
    observeImages();
    startResourceObserver();
}

function stopDebugObservers() {
    debugScope?.dispose();
    debugScope = null;
    ptvWindow.__PTV_IMAGE_TRACKER__ = false;
    debugConsole('image tracker disposed');
    stopResourceObserver();
}

export function isPtvDebugEnabled() {
    return debugEnabled;
}

export function setPtvDebugAdminAccess(isAdmin: boolean) {
    debugAdminAllowed = isAdmin;
    document.documentElement.classList.toggle('ptv-debug-admin', isAdmin);

    const canCollectDiagnostics = shouldCollectDiagnostics();

    if (canCollectDiagnostics) {
        startDebugObservers();
    } else {
        stopDebugObservers();
        clearPtvDebugReport();
    }

    dispatchDebugEvent(PTV_EVENTS.debugChange, {
        canCollectDiagnostics,
        enabled: debugEnabled,
        isAdmin
    });
}

export function getPtvDebugPersistenceState() {
    const storage = getStorage();

    if (!storage) {
        return {
            enabled: debugEnabled,
            persisted: false,
            storageAvailable: false,
            storageKey: PTV_DEBUG.storageKey
        };
    }

    const storedValue = storage.getItem(PTV_DEBUG.storageKey);

    return {
        enabled: debugEnabled,
        persisted: debugEnabled ? storedValue === '1' : storedValue !== '1',
        storageAvailable: true,
        storageKey: PTV_DEBUG.storageKey
    };
}

export function setPtvDebug(enabled: boolean) {
    if (debugEnabled === enabled) return debugEnabled;

    debugEnabled = enabled;
    setDebugStorage(enabled);
    document.documentElement.classList.toggle('ptv-debug-mode', enabled);

    const canCollectDiagnostics = shouldCollectDiagnostics();

    if (enabled && canCollectDiagnostics) {
        startDebugObservers();
        recordPtvEvent('profile', 'debug-enabled', getPtvClientProfile());
    } else {
        stopDebugObservers();
        clearPtvDebugReport();
    }

    dispatchDebugEvent(PTV_EVENTS.debugChange, {
        canCollectDiagnostics,
        enabled
    });
    debugConsole(enabled ? 'enabled' : 'disabled');

    return debugEnabled;
}

export function recordPtvEvent(type: PtvDebugEventType, name: string, detail?: unknown) {
    const at = Date.now();
    const safeName = redactPtvSensitiveText(name, 300);
    const safeDetail = detail === undefined ? undefined : redactPtvSensitiveValue(detail);

    observabilitySubscribers.forEach(listener => {
        try {
            listener({ at, detail: safeDetail, kind: 'event', name: safeName, type });
        } catch {
            // Passive observers cannot affect application behavior.
        }
    });

    if (!shouldCollectDiagnostics()) return;

    const eventDetail = type === 'image' && safeName === 'reading-image-profile-cache-hit' ?
        aggregateReadingImageProfileCacheHit(safeDetail) :
        safeDetail;

    if (eventDetail === null) return;

    appendBoundedPtvEvent(events, {
        at,
        detail: eventDetail,
        name: safeName,
        type
    }, PTV_DEBUG.maxEvents);
}

export function recordPtvTiming(
    type: PtvDebugEventType,
    name: string,
    durationMs: number,
    detail?: unknown
) {
    const roundedDuration = Number(durationMs.toFixed(1));
    const safeName = redactPtvSensitiveText(name, 300);
    const safeDetail = detail === undefined ? undefined : redactPtvSensitiveValue(detail);

    observabilitySubscribers.forEach(listener => {
        try {
            listener({
                at: Date.now(),
                detail: safeDetail,
                durationMs: roundedDuration,
                kind: 'timing',
                name: safeName,
                type
            });
        } catch {
            // Passive observers cannot affect application behavior.
        }
    });

    if (!shouldCollectDiagnostics()) return;

    if (type === 'image' && durationMs > IMAGE_MAX_LIFECYCLE_MS) {
        recordPtvEvent('image', 'image-duration-discarded', {
            detail,
            durationMs: Number(durationMs.toFixed(1)),
            name: safeName
        });
        return;
    }

    timings.push({
        at: Date.now(),
        detail: safeDetail,
        durationMs: roundedDuration,
        name: safeName,
        type
    });
    trimBuffer(timings, PTV_DEBUG.maxTimings);

    if (roundedDuration > 500) {
        debugConsole(`${type}:${safeName} ${roundedDuration}ms`, safeDetail);
    }
}

export function subscribePtvObservability(listener: (event: PtvObservabilityEvent) => void) {
    observabilitySubscribers.add(listener);

    return () => {
        observabilitySubscribers.delete(listener);
    };
}

export function timePtvAsync<T>(
    type: PtvDebugEventType,
    name: string,
    task: () => Promise<T>,
    detail?: unknown
): Promise<T> {
    if (!shouldCollectDiagnostics()) {
        return Promise.resolve().then(task);
    }

    const startedAt = performance.now();

    return Promise.resolve()
        .then(task)
        .then(result => {
            recordPtvTiming(type, name, performance.now() - startedAt, detail);

            return result;
        })
        .catch((err: unknown) => {
            recordPtvTiming(type, `${name}:error`, performance.now() - startedAt, {
                detail,
                error: err instanceof Error ? err.message : String(err)
            });
            throw err;
        });
}

export function registerPtvDebugCacheStatusProvider(provider: () => unknown) {
    debugCacheStatusProvider = provider;
}

export function registerPtvDebugShellStatusProvider(provider: (() => unknown) | null) {
    debugShellStatusProvider = provider;
}

export function registerPtvDebugSignupStatusProvider(provider: (() => unknown) | null) {
    debugSignupStatusProvider = provider;
}

// eslint-disable-next-line sonarjs/function-return-type -- Provider snapshots intentionally share the recursive diagnostic union.
function getSanitizedDebugProviderValue(provider: (() => unknown) | null) {
    let result: ReturnType<typeof redactPtvSensitiveValue> = null;

    if (!provider) return result;

    try {
        result = redactPtvSensitiveValue(provider());
    } catch {
        result = { status: 'unavailable' };
    }

    return result;
}

export function getPtvDebugReport() {
    if (!shouldCollectDiagnostics()) {
        return {
            active: false,
            cache: {
                errors: 0,
                hits: 0,
                misses: 0,
                status: null,
                staleHits: 0,
                timings: getTimingSummary('cache')
            },
            clientProfile: {
                appliedClasses: [],
                hasHover: false,
                isAndroidTv: false,
                isCoarsePointer: false,
                isFireTv: false,
                isLowPower: false,
                isMobile: false,
                isRoku: false,
                isTenFootClient: false,
                isTizen: false,
                isTv: false,
                isWebOs: false,
                kind: 'desktop',
                layoutMode: 'desktop',
                responsive: {
                    devicePixelRatio: 1,
                    hoverCapability: 'unknown',
                    innerHeight: 0,
                    innerWidth: 0,
                    layoutMode: 'desktop',
                    layoutModeReason: 'diagnostics-disabled',
                    matchedMediaQuery: 'n/a',
                    pointerType: 'unknown',
                    visualViewportHeight: 0,
                    visualViewportWidth: 0
                },
                supportsAspectRatio: false,
                supportsBackdropFilter: false,
                supportsContainerQueries: false,
                supportsContentVisibility: false,
                tvDetectionReason: 'diagnostics-disabled',
                tvPlatform: 'none',
                userAgent: 'unavailable'
            },
            events: [],
            home: getHomeSummary(),
            playbackOwnership: getPlaybackOwnershipSummary(),
            images: {
                cachedFailures: 0,
                errors: 0,
                fallbackCount: 0,
                nativeHomeFailures: 0,
                profileCacheHits: getReadingImageProfileCacheHitSummary(),
                resetCount: 0,
                retryCount: 0,
                rowBackdropFailures: 0,
                timings: getTimingSummary('image')
            },
            memory: null,
            origins: PTV_RUNTIME,
            pluginApi: null,
            reading: getReadingSummary(),
            recommendations: getRecommendationSummary(),
            render: getTimingSummary('render'),
            renderProfile: {
                id: 'disabled',
                tier: 'disabled'
            },
            rowFetch: getTimingSummary('row-fetch'),
            shell: null,
            signup: null,
            timings: [],
            timestamp: now(),
            tvRender: getTvRenderSummary(),
            runtime: getPtvRuntimeDiagnostics()
        };
    }

    const {
        clientProfile,
        performanceProfile
    } = getActiveProfiles();
    const renderProfile = performanceProfile.renderProfile || {
        id: document.documentElement.dataset.ptvRenderProfile || 'unknown',
        tier: document.documentElement.dataset.ptvRenderTier || 'unknown'
    };
    let appliedClasses: string[] = [];

    if (typeof document !== 'undefined') {
        appliedClasses = Array.from(document.documentElement.classList)
            .filter(className => className.startsWith('ptv-'));
    }

    return {
        active: debugEnabled,
        cache: {
            errors: getEventCount('cache', 'error'),
            hits: getEventCount('cache', 'hit'),
            misses: getEventCount('cache', 'miss'),
            status: getSanitizedDebugProviderValue(debugCacheStatusProvider),
            staleHits: getEventCount('cache', 'stale-hit'),
            timings: getTimingSummary('cache')
        },
        clientProfile: {
            appliedClasses,
            hasHover: clientProfile.hasHover,
            isAndroidTv: clientProfile.isAndroidTv,
            isCoarsePointer: clientProfile.isCoarsePointer,
            isFireTv: clientProfile.isFireTv,
            isLowPower: clientProfile.isLowPower,
            isMobile: clientProfile.isMobile,
            isRoku: clientProfile.isRoku,
            isTenFootClient: clientProfile.isTenFootClient,
            isTizen: clientProfile.isTizen,
            isTv: clientProfile.isTv,
            isWebOs: clientProfile.isWebOs,
            kind: clientProfile.kind,
            layoutMode: clientProfile.layoutMode,
            responsive: clientProfile.responsive,
            supportsAspectRatio: clientProfile.supportsAspectRatio,
            supportsBackdropFilter: clientProfile.supportsBackdropFilter,
            supportsContainerQueries: clientProfile.supportsContainerQueries,
            supportsContentVisibility: clientProfile.supportsContentVisibility,
            tvDetectionReason: clientProfile.tvDetectionReason,
            tvPlatform: clientProfile.tvPlatform,
            userAgent: clientProfile.userAgent.slice(0, 320)
        },
        events: [...events],
        home: getHomeSummary(),
        playbackOwnership: getPlaybackOwnershipSummary(),
        images: {
            cachedFailures: getEventCount('image', 'image-url-failure-cached'),
            errors: getEventCount('image', 'image-error') + getEventCount('image', 'image-failed-once'),
            fallbackCount: getEventCount('image', 'native-home-image-fallback') + getEventCount('image', 'row-backdrop-image-fallback'),
            nativeHomeFailures: getEventCount('image', 'native-home-image-failed'),
            profileCacheHits: getReadingImageProfileCacheHitSummary(),
            resetCount: getEventCount('image', 'image-tracker-reset'),
            retryCount: getEventCount('image', 'image-retry-suppressed'),
            rowBackdropFailures: getEventCount('image', 'row-backdrop-image-fallback'),
            timings: getTimingSummary('image')
        },
        memory: getMemorySnapshot(),
        origins: PTV_RUNTIME,
        pluginApi: getPtvPluginApiDiagnostics(),
        reading: getReadingSummary(),
        recommendations: getRecommendationSummary(),
        render: getTimingSummary('render'),
        renderProfile,
        rowFetch: getTimingSummary('row-fetch'),
        shell: getSanitizedDebugProviderValue(debugShellStatusProvider),
        signup: getSanitizedDebugProviderValue(debugSignupStatusProvider),
        timings: [...timings],
        timestamp: now(),
        tvRender: getTvRenderSummary(),
        runtime: getPtvRuntimeDiagnostics()
    };
}

export function clearPtvDebugReport() {
    timings.splice(0, timings.length);
    events.splice(0, events.length);
    readingImageProfileCacheHits.clear();
    readingImageProfileRepresentativeEvents = 0;
}

function installDebugApi() {
    const ptv = getPtvGlobal();

    ptv.debug = {
        clear: clearPtvDebugReport,
        disable: () => setPtvDebug(false),
        enable: () => setPtvDebug(true),
        event: recordPtvEvent,
        report: getPtvDebugReport,
        shouldCollect: shouldCollectDiagnostics,
        time: timePtvAsync,
        timing: recordPtvTiming
    };
}

export function initPtvObservability() {
    if (ptvWindow.__PTV_OBSERVABILITY_INSTALLED__ === true) return;

    ptvWindow.__PTV_OBSERVABILITY_INSTALLED__ = true;
    installDebugFlagAccessor();
    installDebugApi();
    document.documentElement.classList.toggle('ptv-debug-mode', debugEnabled);

    if (debugEnabled && shouldCollectDiagnostics()) {
        startDebugObservers();
        recordPtvEvent('profile', 'debug-enabled', getPtvClientProfile());
    }
}

initPtvObservability();
