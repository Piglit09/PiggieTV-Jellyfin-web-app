/* eslint-disable @stylistic/operator-linebreak, array-callback-return, compat/compat, curly, no-nested-ternary, sonarjs/cognitive-complexity, sonarjs/no-alphabetical-sort, sonarjs/no-nested-conditional -- Collector mapping favors explicit, privacy-safe state classification and guarded legacy-browser fallbacks. */
import { getCurrentPtvApiClient, getPtvCurrentUserId } from '../../api/client';
import { getPtvBuildInfo } from '../../core/buildInfo';
import { getPtvWebCapabilityReport } from '../../core/capabilities/webCapabilityAdapter';
import { getPtvClientProfile } from '../../core/clientProfile';
import {
    createPtvDiagnosticHealth,
    getPtvDiagnosticPercentile,
    type PtvFocusGraphDiagnostic,
    type PtvFocusElementCategory,
    type PtvFocusScopeCategory,
    type PtvFocusVisibilityDiagnostic,
    type PtvImageRole,
    type PtvInputDiagnostic,
    type PtvPlaybackMediaMode,
    type PtvPlaybackRouteClassification,
    type PtvPlaybackSessionDiagnostic,
    type PtvPlaybackSessionState,
    type PtvRemoteInputSource,
    type PtvRemoteInputStage,
    type PtvSafeRemoteAction,
    type PtvShelfDiagnostic
} from '../../core/diagnostics/diagnosticContracts';
import type { PtvCoreInitializationEvent } from '../../core/initialization/coreInitialization';
import {
    subscribePtvObservability,
    type PtvObservabilityEvent
} from '../../core/observability';
import { getCurrentPtvPluginApiClient } from '../../core/pluginApi';
import {
    classifyPtvTvFocusElement,
    classifyPtvTvFocusScope,
    getPtvSafeFocusFingerprint,
    subscribePtvTvNavigation,
    type PtvTvNavigationSnapshot
} from '../../core/tvFocus';
import {
    FEATURED_CACHE_UPDATED_EVENT,
    getFeaturedContentCacheStatus
} from '../../modules/cache/featuredContentCache';
import { subscribePtvRecommendationDiagnosticScope } from '../../modules/recommendations/diagnostics/recommendationDiagnosticScope';
import {
    PTV_ROUTE_CRITICAL_LIFECYCLE_EVENT,
    type PtvRouteCriticalLifecycleDetail
} from '../../shell/routeCriticalLifecycle';
import { getPtvCanonicalRouteIdentity } from '../../shell/routeIdentity';
import {
    getPtvDiagnosticPreferences,
    subscribePtvDiagnosticPreferences
} from './diagnosticPreferences';
import {
    getPtvDiagnosticStore,
    normalizePtvDiagnosticRouteFamily
} from './diagnosticStore';

type DisposableCollector = {
    dispose: () => void;
    refreshExternalStatus: () => Promise<void>;
};

type RouteControllerDetail = {
    full?: string;
    hash?: string;
    normalizedPath?: string;
    path?: string;
    routeGeneration?: number;
    routeId?: string;
    routeKey?: string;
};

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[role="button"]:not([aria-disabled="true"])',
    '[role="link"]:not([aria-disabled="true"])',
    '[role="menuitem"]:not([aria-disabled="true"])',
    '[tabindex]:not([tabindex="-1"])',
    '[data-ptv-focusable="true"]'
].join(',');

let platform: DisposableCollector | null = null;
let routeCriticalLifecycleHandler: ((detail: PtvRouteCriticalLifecycleDetail) => void) | null = null;

export const PTV_PLAYBACK_SESSION_SNAPSHOT_EVENT = 'ptv-playback-session-snapshot';
const PTV_PLAYBACK_MAX_COUNT = 10_000_000;
const PTV_PLAYBACK_MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1_000;
const PTV_PLAYBACK_MAX_SECONDS = 7 * 24 * 60 * 60;
const PTV_PLAYBACK_ROUTE_FAMILIES = [
    'audio',
    'books',
    'collections',
    'comics',
    'details',
    'full-screen-player',
    'home',
    'item',
    'live-tv',
    'manga',
    'mini-player',
    'movies',
    'music',
    'now-playing',
    'other',
    'playback',
    'player',
    'reading',
    'search',
    'shows',
    'tv',
    'unknown',
    'video'
] as const;
const PTV_PLAYBACK_RECOVERY_RESULTS = [
    'cancelled',
    'failed',
    'ignored',
    'load-restarted',
    'media-error-recovered',
    'not-attempted',
    'not-needed',
    'recovered',
    'retrying',
    'skipped',
    'source-replaced',
    'stale',
    'success',
    'succeeded',
    'suppressed',
    'timed-out',
    'timeout',
    'unknown'
] as const;

const PTV_ROUTE_CRITICAL_STATES = [
    'cancelled',
    'empty',
    'failed',
    'partial',
    'pending',
    'success'
] as const;

export function getPtvDiagnosticNavigationIdentity(detail: RouteControllerDetail = {}) {
    const detailFull = detail.full || '';
    const fullHashIndex = detailFull.indexOf('#');
    const detailHash = detail.hash
        || (fullHashIndex >= 0 ? detailFull.slice(fullHashIndex) : '');
    const fallbackPath = detail.normalizedPath
        || detail.path
        || (fullHashIndex >= 0 ? detailFull.slice(0, fullHashIndex) : detailFull)
        || window.location.pathname;

    return getPtvCanonicalRouteIdentity(detailHash || window.location.hash, fallbackPath);
}

export function normalizePtvRouteCriticalLifecycleDetail(
    value: unknown
): PtvRouteCriticalLifecycleDetail | null {
    if (!isRecord(value)) return null;

    const lifecycleId = typeof value.lifecycleId === 'string' ? value.lifecycleId.trim() : '';
    const navigationKey = typeof value.navigationKey === 'string'
        ? getPtvCanonicalRouteIdentity(value.navigationKey)
        : '';
    const routeFamily = typeof value.routeFamily === 'string' ? value.routeFamily.trim() : '';
    const routeGeneration = Number(value.routeGeneration);
    const routeKey = typeof value.routeKey === 'string' ? value.routeKey.trim() : '';
    const state = typeof value.state === 'string' ? value.state.trim().toLowerCase() : '';

    if (
        !lifecycleId
        || !navigationKey
        || !routeFamily
        || !Number.isSafeInteger(routeGeneration)
        || routeGeneration < 0
        || !routeKey
        || !PTV_ROUTE_CRITICAL_STATES.includes(state as typeof PTV_ROUTE_CRITICAL_STATES[number])
    ) return null;

    return {
        lifecycleId,
        navigationKey,
        routeFamily,
        routeGeneration,
        routeKey,
        state: state as PtvRouteCriticalLifecycleDetail['state']
    };
}
const PTV_RECOMMENDATION_GENERATION_LIMIT = 12;

type PtvRecommendationGenerationState = {
    authoritative: boolean;
    explicitIdentity: boolean;
    failureObserved: boolean;
    identityScope: string | null;
    key: string;
    sequence: number;
    startedAt: number;
    startedAtIso: string | null;
    terminal: boolean;
};

let recommendationGenerationSequence = 0;
let currentRecommendationGeneration: PtvRecommendationGenerationState | null = null;
let recommendationFailureSticky = false;
const recommendationGenerations = new Map<string, PtvRecommendationGenerationState>();

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function numberField(detail: unknown, names: string[], fallback = 0) {
    if (!isRecord(detail)) return fallback;

    for (const name of names) {
        const value = Number(detail[name]);

        if (Number.isFinite(value)) return value;
    }

    return fallback;
}

function arrayField(detail: unknown, name: string) {
    return isRecord(detail) && Array.isArray(detail[name]) ? detail[name] : [];
}

function booleanField(detail: unknown, name: string) {
    return isRecord(detail) && detail[name] === true;
}

function hasField(detail: unknown, names: string[]) {
    return isRecord(detail) && names.some(name => Object.prototype.hasOwnProperty.call(detail, name));
}

function safeEnum(value: unknown, allowed: readonly string[], fallback: string) {
    const normalized = typeof value === 'string' ? value.toLowerCase().trim() : '';

    return allowed.includes(normalized) ? normalized : fallback;
}

function safeVersion(value: unknown) {
    const normalized = typeof value === 'string' ? value.trim() : '';

    return /^v?\d+(?:\.\d+){1,4}(?:[-+][0-9a-z.-]+)?$/i.test(normalized) ? normalized : 'unknown';
}

function safeHash(value: string) {
    let hash = 5381;

    for (let index = 0; index < value.length; index += 1) {
        hash = (Math.imul(hash, 33) ^ value.charCodeAt(index)) >>> 0;
    }

    return `element-${hash.toString(36)}`;
}

function getPtvRecommendationGenerationKey(detail: unknown, allowNestedDetail = true): string | null {
    if (!isRecord(detail)) return null;

    for (const name of [
        'generation',
        'generationId',
        'generationKey',
        'generationSequence',
        'generationToken',
        'requestGeneration',
        'requestId',
        'generationStartedAt'
    ]) {
        const value = detail[name];

        if (typeof value === 'number' && Number.isFinite(value)) {
            return `generation-${safeHash(String(value))}`;
        }
        if (typeof value === 'string' && value.trim()) {
            return `generation-${safeHash(value.trim().slice(0, 256))}`;
        }
    }

    if (allowNestedDetail && isRecord(detail.detail)) {
        return getPtvRecommendationGenerationKey(detail.detail, false);
    }

    return null;
}

function isPtvCoreRecommendationFailureName(name: string) {
    return /^recommendation-(?:candidate-fetch|engine|generation|music-library-prerequisite|profile|provider|recently-added|source)(?:-|:|$)/.test(name);
}

function isPtvCoreRecommendationStartName(name: string) {
    return name === 'recommendation-generation-start'
        || name === 'recommendation-generation-started'
        || name === 'recommendation-candidate-fetch-start'
        || name === 'recommendation-candidate-fetch-started';
}

function isPtvCoreRecommendationCompletionName(name: string) {
    return name === 'recommendation-diagnostic-report'
        || name === 'recommendation-generation-completed'
        || name === 'recommendation-provider-loaded'
        || name === 'recommendation-rows-generated';
}

function trimPtvRecommendationGenerations() {
    while (recommendationGenerations.size > PTV_RECOMMENDATION_GENERATION_LIMIT) {
        const oldestKey = recommendationGenerations.keys().next().value;

        if (typeof oldestKey !== 'string') return;
        if (oldestKey === currentRecommendationGeneration?.key) {
            const current = recommendationGenerations.get(oldestKey);

            recommendationGenerations.delete(oldestKey);
            if (current) recommendationGenerations.set(oldestKey, current);
            continue;
        }
        recommendationGenerations.delete(oldestKey);
    }
}

function beginPtvRecommendationGeneration(event: PtvObservabilityEvent) {
    const explicitKey = getPtvRecommendationGenerationKey(event.detail);
    const existing = explicitKey ? recommendationGenerations.get(explicitKey) : null;

    if (existing) {
        if (currentRecommendationGeneration && existing.sequence < currentRecommendationGeneration.sequence) {
            return null;
        }

        existing.terminal = false;
        currentRecommendationGeneration = existing;
        return existing;
    }

    if (currentRecommendationGeneration && event.at < currentRecommendationGeneration.startedAt) return null;

    recommendationGenerationSequence += 1;
    const generation: PtvRecommendationGenerationState = {
        authoritative: false,
        explicitIdentity: Boolean(explicitKey),
        failureObserved: false,
        identityScope: null,
        key: explicitKey || `observed-generation-${recommendationGenerationSequence}`,
        sequence: recommendationGenerationSequence,
        startedAt: event.at,
        startedAtIso: null,
        terminal: false
    };

    currentRecommendationGeneration = generation;
    recommendationGenerations.set(generation.key, generation);
    trimPtvRecommendationGenerations();

    return generation;
}

function getPtvRecommendationEventGeneration(event: PtvObservabilityEvent) {
    const explicitKey = getPtvRecommendationGenerationKey(event.detail);

    if (explicitKey) {
        const generation = recommendationGenerations.get(explicitKey);

        return {
            current: Boolean(generation && generation === currentRecommendationGeneration),
            generation: generation || null,
            proven: Boolean(generation)
        };
    }

    const generation = currentRecommendationGeneration;

    return {
        current: Boolean(generation),
        generation,
        proven: Boolean(generation && !generation.explicitIdentity && generation.sequence === 1)
    };
}

function resetPtvRecommendationGenerationState() {
    currentRecommendationGeneration = null;
    recommendationFailureSticky = false;
    recommendationGenerationSequence = 0;
    recommendationGenerations.clear();
}

function observedRecommendationCount(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ?
        Math.min(PTV_PLAYBACK_MAX_COUNT, Math.floor(value)) : 0;
}

function observedRecommendationDuration(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ?
        Math.min(PTV_PLAYBACK_MAX_DURATION_MS, Number(value.toFixed(3))) : null;
}

function resetPtvRecommendationSummary(retireIdentity: boolean, active: boolean) {
    const store = getPtvDiagnosticStore();
    const previous = store.getSnapshot().recommendations;

    store.updateContext({
        recommendations: {
            ...previous,
            active,
            cacheState: retireIdentity ? 'unknown' : previous.cacheState,
            candidateCount: 0,
            configuredRows: 0,
            diversityCapRejectionCount: 0,
            duplicateSuppressionCount: 0,
            fallbackUsed: false,
            feedbackRejectionCount: 0,
            generatedItemCount: 0,
            generatedRows: 0,
            health: createPtvDiagnosticHealth('unknown', active ?
                'Recommendation generation is running.' :
                'Recommendation summary was retired with the authentication scope.'),
            identityDuplicateRejectionCount: 0,
            itemCount: 0,
            lastErrorCategory: 'none',
            lastFailureAt: retireIdentity ? null : previous.lastFailureAt,
            lastFailureCategory: retireIdentity ? 'none' : previous.lastFailureCategory,
            lastFailureResolvedAt: retireIdentity ? null : previous.lastFailureResolvedAt,
            lastGenerationAt: retireIdentity ? null : previous.lastGenerationAt,
            providerCount: 0,
            renderedItemCount: null,
            runDurationMs: null,
            sourceCount: 0,
            tasteSignalCount: 0,
            terminalOutcome: null
        }
    });
}

function retirePtvRecommendationSummary() {
    resetPtvRecommendationGenerationState();
    resetPtvRecommendationSummary(true, false);
}

function beginAuthoritativePtvRecommendationGeneration(event: PtvObservabilityEvent) {
    if (!isRecord(event.detail)) return false;
    const key = getPtvRecommendationGenerationKey(event.detail);
    const identityScope = event.detail.identityScope;
    const startedAtIso = event.detail.startedAt;

    if (!key || typeof identityScope !== 'string' || !/^recommendation-scope-\d+$/.test(identityScope)
        || typeof startedAtIso !== 'string' || !Number.isFinite(Date.parse(startedAtIso))) return false;
    if (recommendationGenerations.has(key)) return true;
    if (currentRecommendationGeneration && event.at < currentRecommendationGeneration.startedAt) return true;

    const changedIdentity = Boolean(currentRecommendationGeneration
        && currentRecommendationGeneration.identityScope !== identityScope);
    if (changedIdentity) resetPtvRecommendationGenerationState();
    const generation = beginPtvRecommendationGeneration(event);

    if (!generation) return true;
    generation.authoritative = true;
    generation.identityScope = identityScope;
    generation.startedAtIso = startedAtIso;
    resetPtvRecommendationSummary(changedIdentity, true);
    return true;
}

function finishAuthoritativePtvRecommendationGeneration(event: PtvObservabilityEvent) {
    if (!isRecord(event.detail)) return;
    const generation = currentRecommendationGeneration;

    if (!generation?.authoritative || generation.terminal
        || generation.key !== getPtvRecommendationGenerationKey(event.detail)
        || generation.identityScope !== event.detail.identityScope
        || generation.startedAtIso !== event.detail.startedAt) return;

    const outcome = event.detail.outcome;
    if (outcome !== 'success' && outcome !== 'partial' && outcome !== 'failed' && outcome !== 'cancelled') return;
    generation.terminal = true;
    const detail = event.detail;
    const store = getPtvDiagnosticStore();
    const previous = store.getSnapshot().recommendations;
    const providerCount = observedRecommendationCount(detail.providerCount);
    const generatedRows = observedRecommendationCount(detail.generatedRowCount);
    const generatedItemCount = observedRecommendationCount(detail.generatedItemCount);
    const identityDuplicateRejectionCount = observedRecommendationCount(detail.identityDuplicateRejectionCount);
    const diversityCapRejectionCount = observedRecommendationCount(detail.diversityCapRejectionCount);
    const completedAt = typeof detail.completedAt === 'string' && Number.isFinite(Date.parse(detail.completedAt)) ?
        detail.completedAt : new Date(event.at).toISOString();
    const failure = outcome === 'partial' || outcome === 'failed';
    const category = failure ? safeEnum(detail.errorCategory, [
        'generation', 'source-all-failed', 'source-partial'
    ], outcome === 'partial' ? 'source-partial' : 'generation') : 'none';
    const health = outcome === 'success' ?
        createPtvDiagnosticHealth('healthy', 'Recommendation generation completed successfully.') :
        outcome === 'partial' ?
            createPtvDiagnosticHealth('degraded', 'Recommendation generation completed with a bounded fallback.') :
            outcome === 'failed' ?
                createPtvDiagnosticHealth('degraded', 'Recommendation generation failed safely.') :
                createPtvDiagnosticHealth('unknown', 'Recommendation generation was cancelled.');

    store.updateContext({
        recommendations: {
            ...previous,
            active: false,
            candidateCount: observedRecommendationCount(detail.candidateCount),
            diversityCapRejectionCount,
            duplicateSuppressionCount: identityDuplicateRejectionCount + diversityCapRejectionCount,
            fallbackUsed: detail.fallbackUsed === true,
            feedbackRejectionCount: observedRecommendationCount(detail.feedbackRejectionCount),
            generatedItemCount,
            generatedRows,
            health,
            identityDuplicateRejectionCount,
            itemCount: generatedItemCount,
            lastErrorCategory: category,
            lastFailureAt: failure ? completedAt : previous.lastFailureAt,
            lastFailureCategory: failure ? category : previous.lastFailureCategory,
            lastFailureResolvedAt: failure ? null :
                outcome === 'success' && previous.lastFailureAt && !previous.lastFailureResolvedAt ?
                    completedAt : previous.lastFailureResolvedAt,
            lastGenerationAt: completedAt,
            providerCount,
            renderedItemCount: typeof detail.renderedItemCount === 'number' && Number.isFinite(detail.renderedItemCount)
                && detail.renderedItemCount >= 0 ? observedRecommendationCount(detail.renderedItemCount) : null,
            runDurationMs: observedRecommendationDuration(detail.durationMs),
            sourceCount: providerCount,
            tasteSignalCount: observedRecommendationCount(detail.tasteSignalCount),
            terminalOutcome: outcome
        }
    });
}

function boundedPlaybackNumber(value: unknown, maximum: number, integer = false) {
    const number = Number(value);

    if (!Number.isFinite(number)) return 0;

    const bounded = Math.min(maximum, Math.max(0, number));
    return integer ? Math.floor(bounded) : Number(bounded.toFixed(3));
}

function playbackRecord(value: unknown) {
    return isRecord(value) ? value : {};
}

function safePlaybackSessionId(value: unknown) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';

    if (!normalized) return '';
    if (/^(?:ptv-)?playback(?:-session)?-[a-z0-9][a-z0-9-]{0,63}$/.test(normalized)) return normalized;

    return `playback-session-${safeHash(normalized).replace(/^element-/, '')}`;
}

function safePlaybackUpdatedAt(value: unknown, fallback: string) {
    const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;

    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function safePlaybackState(value: unknown): PtvPlaybackSessionState {
    const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
    const allowed: readonly PtvPlaybackSessionState[] = [
        'IDLE',
        'LOADING',
        'BUFFERING',
        'PLAYING',
        'DEGRADED',
        'STALLED',
        'RECOVERING',
        'ENDED',
        'FAILED'
    ];

    return allowed.includes(normalized as PtvPlaybackSessionState)
        ? normalized as PtvPlaybackSessionState
        : 'IDLE';
}

function safePlaybackMediaMode(value: unknown): PtvPlaybackMediaMode {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    const modes: Readonly<Record<string, PtvPlaybackMediaMode>> = {
        'direct play': 'Direct Play',
        'direct stream': 'Direct Stream',
        'hls transcode': 'HLS Transcode',
        unknown: 'Unknown'
    };

    return modes[normalized] || 'Unknown';
}

function safePlaybackRouteClassification(value: unknown): PtvPlaybackRouteClassification {
    const normalized = typeof value === 'string' ? value.trim().toUpperCase() : '';
    const allowed: readonly PtvPlaybackRouteClassification[] = [
        'LAN_DIRECT',
        'LOCAL_VIA_PUBLIC_HOSTNAME',
        'PUBLIC_PROXY',
        'CLOUDFLARE_TUNNEL',
        'VPN_PATH',
        'UNKNOWN'
    ];

    return allowed.includes(normalized as PtvPlaybackRouteClassification)
        ? normalized as PtvPlaybackRouteClassification
        : 'UNKNOWN';
}

function safePlaybackRouteFamily(value: unknown) {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';

    return PTV_PLAYBACK_ROUTE_FAMILIES.includes(normalized as typeof PTV_PLAYBACK_ROUTE_FAMILIES[number])
        ? normalized
        : 'unknown';
}

function safePlaybackRecoveryResults(value: unknown) {
    if (!Array.isArray(value)) return [];

    return value.slice(-20).map(result => {
        const normalized = typeof result === 'string' ? result.trim().toLowerCase().replace(/_/g, '-') : '';

        return PTV_PLAYBACK_RECOVERY_RESULTS.includes(normalized as typeof PTV_PLAYBACK_RECOVERY_RESULTS[number])
            ? normalized
            : 'unknown';
    });
}

export function normalizePtvPlaybackSessionSnapshot(
    value: unknown,
    fallbackUpdatedAt = new Date().toISOString()
): PtvPlaybackSessionDiagnostic | null {
    const outer = playbackRecord(value);
    const detail = isRecord(outer.detail) ? outer.detail : outer;
    const diagnosticSessionId = safePlaybackSessionId(detail.diagnosticSessionId);

    if (!diagnosticSessionId) return null;

    const buffer = playbackRecord(detail.buffer);
    const stalls = playbackRecord(detail.stalls);
    const hls = playbackRecord(detail.hls);
    const player = playbackRecord(detail.player);
    const transitions = Array.isArray(detail.readyStateTransitions) ? detail.readyStateTransitions : [];

    return {
        buffer: {
            averageAheadSeconds: boundedPlaybackNumber(buffer.averageAheadSeconds, PTV_PLAYBACK_MAX_SECONDS),
            belowTwoSecondsCount: boundedPlaybackNumber(buffer.belowTwoSecondsCount, PTV_PLAYBACK_MAX_COUNT, true),
            currentAheadSeconds: boundedPlaybackNumber(buffer.currentAheadSeconds, PTV_PLAYBACK_MAX_SECONDS),
            maximumAheadSeconds: boundedPlaybackNumber(buffer.maximumAheadSeconds, PTV_PLAYBACK_MAX_SECONDS),
            minimumAheadSeconds: boundedPlaybackNumber(buffer.minimumAheadSeconds, PTV_PLAYBACK_MAX_SECONDS),
            sampleCount: boundedPlaybackNumber(buffer.sampleCount, PTV_PLAYBACK_MAX_COUNT, true),
            zeroBufferCount: boundedPlaybackNumber(buffer.zeroBufferCount, PTV_PLAYBACK_MAX_COUNT, true)
        },
        diagnosticSessionId,
        hls: {
            droppedFragmentTrackingCount: boundedPlaybackNumber(hls.droppedFragmentTrackingCount, PTV_PLAYBACK_MAX_COUNT, true),
            duplicateFragmentRequestCount: boundedPlaybackNumber(hls.duplicateFragmentRequestCount, PTV_PLAYBACK_MAX_COUNT, true),
            fragmentAverageLatencyMs: boundedPlaybackNumber(hls.fragmentAverageLatencyMs, PTV_PLAYBACK_MAX_DURATION_MS),
            fragmentFailureCount: boundedPlaybackNumber(hls.fragmentFailureCount, PTV_PLAYBACK_MAX_COUNT, true),
            fragmentLongestLatencyMs: boundedPlaybackNumber(hls.fragmentLongestLatencyMs, PTV_PLAYBACK_MAX_DURATION_MS),
            fragmentP95LatencyMs: boundedPlaybackNumber(hls.fragmentP95LatencyMs, PTV_PLAYBACK_MAX_DURATION_MS),
            fragmentRequestCount: boundedPlaybackNumber(hls.fragmentRequestCount, PTV_PLAYBACK_MAX_COUNT, true),
            fragmentRetryCount: boundedPlaybackNumber(hls.fragmentRetryCount, PTV_PLAYBACK_MAX_COUNT, true),
            fragmentSuccessCount: boundedPlaybackNumber(hls.fragmentSuccessCount, PTV_PLAYBACK_MAX_COUNT, true),
            fragmentTimeoutCount: boundedPlaybackNumber(hls.fragmentTimeoutCount, PTV_PLAYBACK_MAX_COUNT, true),
            manifestAverageLatencyMs: boundedPlaybackNumber(hls.manifestAverageLatencyMs, PTV_PLAYBACK_MAX_DURATION_MS),
            manifestP95LatencyMs: boundedPlaybackNumber(hls.manifestP95LatencyMs, PTV_PLAYBACK_MAX_DURATION_MS),
            manifestRequestCount: boundedPlaybackNumber(hls.manifestRequestCount, PTV_PLAYBACK_MAX_COUNT, true),
            manifestSuccessCount: boundedPlaybackNumber(hls.manifestSuccessCount, PTV_PLAYBACK_MAX_COUNT, true)
        },
        mediaMode: safePlaybackMediaMode(detail.mediaMode),
        player: {
            activeLoadRestarts: boundedPlaybackNumber(player.activeLoadRestarts, PTV_PLAYBACK_MAX_COUNT, true),
            mediaSourceAssignments: boundedPlaybackNumber(player.mediaSourceAssignments, PTV_PLAYBACK_MAX_COUNT, true),
            mountCount: boundedPlaybackNumber(player.mountCount, PTV_PLAYBACK_MAX_COUNT, true),
            pauseCalls: boundedPlaybackNumber(player.pauseCalls, PTV_PLAYBACK_MAX_COUNT, true),
            playCalls: boundedPlaybackNumber(player.playCalls, PTV_PLAYBACK_MAX_COUNT, true),
            programmaticSeeks: boundedPlaybackNumber(player.programmaticSeeks, PTV_PLAYBACK_MAX_COUNT, true),
            qualitySwitches: boundedPlaybackNumber(player.qualitySwitches, PTV_PLAYBACK_MAX_COUNT, true),
            recoveryActions: boundedPlaybackNumber(player.recoveryActions, PTV_PLAYBACK_MAX_COUNT, true),
            sourceReplacements: boundedPlaybackNumber(player.sourceReplacements, PTV_PLAYBACK_MAX_COUNT, true),
            staleEventsIgnored: boundedPlaybackNumber(player.staleEventsIgnored, PTV_PLAYBACK_MAX_COUNT, true),
            unmountCount: boundedPlaybackNumber(player.unmountCount, PTV_PLAYBACK_MAX_COUNT, true)
        },
        readyStateTransitions: transitions.slice(-16).flatMap(transition => {
            if (!isRecord(transition)) return [];

            return [{
                atMs: boundedPlaybackNumber(transition.atMs, PTV_PLAYBACK_MAX_DURATION_MS),
                from: boundedPlaybackNumber(transition.from, 4, true),
                to: boundedPlaybackNumber(transition.to, 4, true)
            }];
        }),
        routeClassification: safePlaybackRouteClassification(detail.routeClassification),
        routeFamily: safePlaybackRouteFamily(detail.routeFamily),
        sourceGeneration: boundedPlaybackNumber(detail.sourceGeneration, PTV_PLAYBACK_MAX_COUNT, true),
        stalls: {
            cumulativeDurationMs: boundedPlaybackNumber(stalls.cumulativeDurationMs, PTV_PLAYBACK_MAX_DURATION_MS),
            episodeDurationsMs: Array.isArray(stalls.episodeDurationsMs)
                ? stalls.episodeDurationsMs.slice(-20).map(duration => (
                    boundedPlaybackNumber(duration, PTV_PLAYBACK_MAX_DURATION_MS)
                ))
                : [],
            longestDurationMs: boundedPlaybackNumber(stalls.longestDurationMs, PTV_PLAYBACK_MAX_DURATION_MS),
            recoveryResults: safePlaybackRecoveryResults(stalls.recoveryResults),
            stalledCount: boundedPlaybackNumber(stalls.stalledCount, PTV_PLAYBACK_MAX_COUNT, true),
            waitingCount: boundedPlaybackNumber(stalls.waitingCount, PTV_PLAYBACK_MAX_COUNT, true)
        },
        state: safePlaybackState(detail.state),
        terminal: detail.terminal === true,
        updatedAt: safePlaybackUpdatedAt(detail.updatedAt, fallbackUpdatedAt)
    };
}

export function classifyPtvDiagnosticFocusElement(
    element: Element | null
): PtvFocusElementCategory {
    return classifyPtvTvFocusElement(element);
}

function getFocusFingerprint(element: Element | null) {
    return getPtvSafeFocusFingerprint(element);
}

function classifyImageRole(element: HTMLImageElement): PtvImageRole {
    const value = [
        element.dataset.imageType,
        element.getAttribute('fetchpriority'),
        element.className
    ].join(' ').toLowerCase();

    if (/backdrop|background|hero/.test(value)) return 'backdrop';
    if (/logo/.test(value)) return 'logo';
    if (/avatar|profile/.test(value)) return 'avatar';
    if (/thumb/.test(value)) return 'thumbnail';
    if (/poster|card|cover/.test(value)) return 'poster';

    return 'unknown';
}

type PtvImageLifecycleState = {
    fingerprint: string;
    startedAt: number;
    terminal: boolean;
};

function getImageGenerationFingerprint(image: HTMLImageElement) {
    const source = [
        image.currentSrc,
        image.getAttribute('src'),
        image.getAttribute('data-src'),
        image.getAttribute('srcset'),
        image.getAttribute('sizes')
    ].filter(Boolean).join('|');

    return source ? safeHash(source) : '';
}

export function createPtvImageRemountGuard(limit = 32) {
    const generations = new Set<string>();

    return {
        shouldRecord(scope: string, image: HTMLImageElement) {
            const fingerprint = getImageGenerationFingerprint(image);
            if (!scope || !fingerprint) return true;

            const key = `${scope}:${fingerprint}`;
            if (generations.has(key)) return false;

            generations.add(key);
            if (generations.size > limit) {
                const oldest = generations.values().next().value;
                if (oldest) generations.delete(oldest);
            }

            return true;
        }
    };
}

export function isPtvDiagnosticsRouteFamily(routeFamily: string) {
    return routeFamily === 'dashboard/piggietv/diagnostics'
        || routeFamily === 'settings/admin/piggietv/diagnostics';
}

export function createPtvImageLifecycleTracker(now: () => number = () => performance.now()) {
    const states = new WeakMap<HTMLImageElement, PtvImageLifecycleState>();

    return {
        begin(image: HTMLImageElement) {
            const fingerprint = getImageGenerationFingerprint(image);
            const previous = states.get(image);

            if (!fingerprint || previous?.fingerprint === fingerprint) return null;

            const state = {
                fingerprint,
                startedAt: now(),
                terminal: false
            };

            states.set(image, state);
            return state;
        },
        complete(image: HTMLImageElement) {
            const state = states.get(image);

            if (!state || state.terminal) return null;

            state.terminal = true;
            return state;
        },
        forget(image: HTMLImageElement) {
            states.delete(image);
        }
    };
}

export function isPtvDiagnosticRouteContentReady(root: ParentNode = document) {
    if ((root instanceof Element && root.matches('[data-ptv-route-critical-pending="true"]'))
        || root.querySelector('[data-ptv-route-critical-pending="true"]')) return false;

    const visiblePendingShelf = Array.from(root.querySelectorAll<HTMLElement>(
        '[data-ptv-row-mounted="true"]:not([data-ptv-row-resumed="true"]), .ptv-row-virtual-slot.ptv-row-virtual-placeholder'
    )).some(isPtvDiagnosticFocusVisible);
    const visiblePendingImage = Array.from(root.querySelectorAll<HTMLImageElement>('img[src], img[data-src]'))
        .some(image => !image.complete && isPtvDiagnosticFocusVisible(image));

    return !visiblePendingShelf && !visiblePendingImage;
}

function currentRouteFamily() {
    return normalizePtvDiagnosticRouteFamily(window.location.hash || window.location.pathname);
}

export function isPtvDiagnosticFocusVisible(element: Element | null) {
    if (!(element instanceof HTMLElement) || !element.isConnected) return false;

    const rect = element.getBoundingClientRect();
    const width = window.innerWidth || document.documentElement.clientWidth || 0;
    const height = window.innerHeight || document.documentElement.clientHeight || 0;

    return rect.width > 0
        && rect.height > 0
        && rect.right >= 0
        && rect.bottom >= 0
        && rect.left <= width
        && rect.top <= height;
}

function getFocusDiagnostic(snapshot: PtvTvNavigationSnapshot) {
    const profile = getPtvClientProfile();
    const activeElement = document.activeElement;
    const status = !profile.isTv ? 'unsupported' : snapshot.focusManagerReady
        ? snapshot.focusTargetCount > 0 ? 'healthy' : 'degraded'
        : 'failing';
    const reason = !profile.isTv
        ? 'TV focus diagnostics are unsupported for the active non-TV profile.'
        : snapshot.focusManagerReady
            ? snapshot.focusTargetCount > 0
                ? 'The TV focus engine is active with eligible candidates.'
                : 'The TV focus engine is active, but no focus candidates were found.'
            : 'The TV focus engine has not initialized.';

    return {
        candidateCount: snapshot.focusTargetCount,
        currentCandidatePresent: snapshot.focusGraphSummary.currentCandidatePresent,
        currentCategory: classifyPtvDiagnosticFocusElement(activeElement),
        currentFingerprint: getFocusFingerprint(activeElement),
        currentRoute: currentRouteFamily(),
        currentScope: snapshot.focusGraphSummary.activeScope,
        currentVisible: isPtvDiagnosticFocusVisible(activeElement),
        disabledReason: profile.isTv ? snapshot.focusManagerReady ? '' : 'not-initialized' : 'non-tv-profile',
        disposalCount: snapshot.focusEngineDisposalCount,
        duplicateListenerCount: snapshot.focusEngineDuplicateListenerCount,
        engineEnabled: profile.isTv && snapshot.focusManagerReady,
        engineRequested: snapshot.focusEngineRequested,
        enableReason: snapshot.focusEngineEnableReason,
        graphRebuildCount: snapshot.focusGraphRebuildCount,
        health: createPtvDiagnosticHealth(status, reason, {
            collectorAvailable: profile.isTv,
            metrics: {
                candidates: snapshot.focusTargetCount,
                navigationMoves: snapshot.navigationMoves
            }
        }),
        initializationCount: snapshot.focusEngineInitializationCount,
        initializationReason: profile.isTv ? profile.tvDetectionReason : 'non-tv-profile',
        isTv: profile.isTv,
        lastRebuildReason: snapshot.focusGraphSummary.lastRebuildReason,
        listenerInstallCount: snapshot.focusEngineListenerInstallCount
    } as const;
}

const SAFE_INPUT_STAGES: readonly PtvRemoteInputStage[] = [
    'browser-event-received',
    'event-classified',
    'key-normalized',
    'platform-mapping-applied',
    'action-resolved',
    'focus-handler-reached',
    'handler-rejected',
    'current-candidate-resolved',
    'target-search-started',
    'target-found',
    'target-rejected',
    'focus-movement-requested',
    'focus-event-observed',
    'movement-confirmed',
    'movement-timed-out',
    'completed'
];
const SAFE_INPUT_ACTIONS: readonly PtvSafeRemoteAction[] = [
    'up', 'down', 'left', 'right', 'enter', 'back', 'play-pause', 'menu', 'color-key', 'unknown'
];
const SAFE_INPUT_SOURCES: readonly PtvRemoteInputSource[] = [
    'keyboard', 'webos-remote', 'android-tv-profile', 'fire-tv-profile', 'synthetic-test'
];
const SAFE_FOCUS_CATEGORIES: readonly PtvFocusElementCategory[] = [
    'nav-item', 'media-card', 'hero-action', 'button', 'menu-item', 'dialog-control', 'player-control', 'unknown'
];
const SAFE_SCOPE_CATEGORIES: readonly PtvFocusScopeCategory[] = [
    'main-content', 'navigation', 'dropdown-menu', 'context-menu', 'modal-dialog',
    'settings-panel', 'player-controls', 'full-screen-music-player', 'unknown'
];
const SAFE_DIAGNOSTIC_REASONS = new Set([
    'none',
    'unknown',
    'focus-observed',
    'focus-lost',
    'focus-graph-refresh',
    'manager-start',
    'startup-ready',
    'content-ready',
    'runtime-content-ready',
    'dynamic-content',
    'dom-mutation',
    'route-change',
    'scope-changed',
    'visibility-resume',
    'pageshow',
    'playback-start',
    'playback-stop',
    'back-navigation',
    'route-owned-by-jellyfin',
    'duplicate-suppressed-by-existing-owner',
    'default-prevented-before-focus-owner',
    'modified-key',
    'reader-owned-key',
    'no-current-focus',
    'current-outside-active-scope',
    'current-not-in-focus-graph',
    'direction-unresolved',
    'no-directional-target',
    'browser-focus-confirmation-timeout',
    'focus-apply-failed'
]);

function safeFocusCategory(value: unknown): PtvFocusElementCategory {
    return safeEnum(value, SAFE_FOCUS_CATEGORIES, 'unknown') as PtvFocusElementCategory;
}

function safeScopeCategory(value: unknown): PtvFocusScopeCategory {
    return safeEnum(value, SAFE_SCOPE_CATEGORIES, 'unknown') as PtvFocusScopeCategory;
}

function safeFingerprint(value: unknown) {
    const normalized = typeof value === 'string' ? value : '';

    return /^(?:focus|element)-[a-z0-9]+$/.test(normalized) ? normalized : 'none';
}

function safeDiagnosticReason(value: unknown, fallback = 'none') {
    const normalized = typeof value === 'string'
        ? value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 80)
        : '';

    return SAFE_DIAGNOSTIC_REASONS.has(normalized) ? normalized : fallback;
}

function getPendingRenderCounts(snapshot: ReturnType<ReturnType<typeof getPtvDiagnosticStore>['getSnapshot']>) {
    const pendingImages = Math.max(
        0,
        snapshot.images.filter(image => image.status === 'requested').length
        - snapshot.images.filter(image => image.status === 'loaded' || image.status === 'errored').length
    );
    const pendingShelves = Math.max(
        0,
        snapshot.shelves.filter(shelf => shelf.status === 'request-started').length
        - snapshot.shelves.filter(shelf => ['cancelled', 'disposed', 'empty', 'failed', 'settled'].includes(shelf.status)).length
    );

    return { pendingImages, pendingShelves };
}

function classifyInputDelay(
    stage: PtvRemoteInputStage,
    failureReason: string,
    elapsedMs: number,
    frameP95Ms: number,
    routeSettled: boolean
): PtvInputDiagnostic['delayClassification'] {
    if (/target|candidate|graph/.test(failureReason) || stage === 'target-rejected') return 'target-search';
    if (/focus-confirmation|focus-apply/.test(failureReason) || stage === 'movement-timed-out') return 'browser-focus-application';
    if (!routeSettled) return 'route-instability';
    if (frameP95Ms > 50 && elapsedMs > 32) return 'render-frame-delay';
    if (elapsedMs > 32) return 'input-handling';

    return 'unknown';
}

function getFocusObscuredBy(element: Element | null): PtvFocusVisibilityDiagnostic['obscuredBy'] {
    if (!(element instanceof HTMLElement) || !element.isConnected || !isPtvDiagnosticFocusVisible(element)) return 'unknown';
    if (typeof document.elementsFromPoint !== 'function') return 'unobscured';

    const rect = element.getBoundingClientRect();
    const atCenter = document.elementsFromPoint(
        Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2)),
        Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2))
    );
    const covering = atCenter.find(candidate => candidate !== element && !element.contains(candidate));

    if (!covering) return 'unobscured';
    if (covering.closest('[role="dialog"], dialog, [aria-modal="true"]')) return 'modal';
    if (covering.closest('#videoOsdPage, .videoOsdPage, .ptv-player-chrome-root')) return 'player';
    if (covering.closest('.ptv-diagnostics-overlay, .ptv-performance-overlay')) return 'overlay';
    if (covering.closest('header, .skinHeader, .ptv-header')) return 'fixed-header';

    return 'unknown';
}

export function bridgePtvFocusDiagnosticEvent(event: Event) {
    const payload = (event as CustomEvent<{ detail?: unknown; name?: string }>).detail;
    const detail = isRecord(payload?.detail) ? payload.detail : {};
    const name = payload?.name || 'unknown';
    const store = getPtvDiagnosticStore();
    const snapshot = store.getSnapshot();
    const routeFamily = normalizePtvDiagnosticRouteFamily(String(detail.route || window.location.hash));
    const occurredAt = new Date().toISOString();

    if (name === 'ptv-tv-input-pipeline') {
        const stage = safeEnum(detail.inputStage, SAFE_INPUT_STAGES, 'completed') as PtvRemoteInputStage;
        const safeAction = safeEnum(detail.keyCategory, SAFE_INPUT_ACTIONS, 'unknown') as PtvSafeRemoteAction;
        const source = safeEnum(detail.inputSource, SAFE_INPUT_SOURCES, 'keyboard') as PtvRemoteInputSource;
        const failureReason = safeDiagnosticReason(detail.failureReason);
        const elapsedMs = Math.max(0, numberField(detail, ['elapsedMs']));
        const frameP95Ms = snapshot.frames.at(-1)?.p95FrameMs || 0;
        const routeSettled = snapshot.routes.at(-1)?.status === 'settled';
        const { pendingImages, pendingShelves } = getPendingRenderCounts(snapshot);
        const movementAttempted = booleanField(detail, 'movementAttempted')
            || ['focus-movement-requested', 'focus-event-observed', 'movement-confirmed', 'movement-timed-out'].includes(stage);
        const movementSucceeded = stage === 'movement-confirmed' || booleanField(detail, 'movementConfirmed');
        const movementResult = stage === 'movement-confirmed' ? 'confirmed'
            : stage === 'movement-timed-out' ? 'timed-out'
                : stage === 'target-rejected' ? 'failed'
                    : movementAttempted ? 'pending'
                        : safeAction === 'enter' || safeAction === 'back' ? 'not-applicable'
                            : 'not-attempted';

        store.recordInput({
            activeRequests: store.getRequestSummary().active,
            currentCandidateResolved: booleanField(detail, 'currentCandidateResolved'),
            defaultPreventedAfter: booleanField(detail, 'defaultPreventedAfter'),
            defaultPreventedBefore: booleanField(detail, 'defaultPreventedBefore'),
            delayClassification: classifyInputDelay(stage, failureReason, elapsedMs, frameP95Ms, routeSettled),
            direction: ['up', 'down', 'left', 'right'].includes(safeAction)
                ? safeAction as 'down' | 'left' | 'right' | 'up' : 'unknown',
            elapsedMs,
            eventPhase: safeEnum(detail.eventPhase, ['capture', 'target'], 'unknown') as 'capture' | 'target' | 'unknown',
            eventType: safeEnum(detail.eventType, ['keydown', 'keyup'], 'keydown') as 'keydown' | 'keyup',
            failureReason,
            frameP95Ms,
            handlerReached: booleanField(detail, 'handlerReached'),
            inputId: /^remote-input-\d+$/.test(String(detail.inputId || ''))
                ? String(detail.inputId) : `remote-input-${safeHash(String(detail.inputId || occurredAt))}`,
            movementAttempted,
            movementResult,
            movementSucceeded,
            nextFocusFingerprint: safeFingerprint(detail.focusedFingerprint || detail.targetFingerprint),
            occurredAt,
            pendingImages,
            pendingShelves,
            previousFocusFingerprint: getFocusFingerprint(document.activeElement),
            propagationStopped: booleanField(detail, 'propagationStopped'),
            repeat: booleanField(detail, 'repeat'),
            repeatCount: Math.max(0, numberField(detail, ['repeatCount'])),
            routeFamily,
            routeSettled,
            safeAction,
            source,
            stage,
            stageSequence: Math.max(0, numberField(detail, ['stageSequence'])),
            targetCandidateFound: booleanField(detail, 'targetFound') || stage === 'target-found' || movementSucceeded,
            targetCategory: safeFocusCategory(detail.targetCategory || detail.focusedCategory)
        });
        if (movementSucceeded && ['up', 'down', 'left', 'right'].includes(safeAction)) {
            store.markRouteFocusPhase('first-directional-movement');
        }
        return;
    }

    if (name === 'ptv-tv-focus-graph' && isRecord(detail.graphSummary)) {
        const graph = detail.graphSummary;
        const categoryCounts = isRecord(graph.candidateCountByCategory) ? graph.candidateCountByCategory : {};
        const nearest = isRecord(graph.nearestCandidateCategories) ? graph.nearestCandidateCategories : {};
        const nearestFingerprints = isRecord(graph.nearestCandidateFingerprints)
            ? graph.nearestCandidateFingerprints
            : {};
        const rejected = isRecord(graph.rejectedByReason) ? graph.rejectedByReason : {};
        const graphDiagnostic: PtvFocusGraphDiagnostic = {
            activeScope: safeScopeCategory(graph.activeScope),
            buildDurationMs: Math.max(0, numberField(graph, ['buildDurationMs'])),
            candidateCountByCategory: Object.fromEntries(SAFE_FOCUS_CATEGORIES.map(category => [
                category,
                Math.max(0, numberField(categoryCounts, [category]))
            ])) as Record<PtvFocusElementCategory, number>,
            containerCount: Math.max(0, numberField(graph, ['containerCount'])),
            currentCandidatePresent: booleanField(graph, 'currentCandidatePresent'),
            currentRegion: safeEnum(
                graph.currentRegion,
                ['above', 'below', 'left', 'right', 'overlapping', 'offscreen', 'unknown'],
                'unknown'
            ) as PtvFocusGraphDiagnostic['currentRegion'],
            enabledCount: Math.max(0, numberField(graph, ['enabledCount'])),
            generatedAt: occurredAt,
            generation: Math.max(0, numberField(graph, ['generation'])),
            lastRebuildReason: safeDiagnosticReason(graph.lastRebuildReason, 'focus-graph-refresh'),
            nearestCandidateCategories: {
                down: safeFocusCategory(nearest.down),
                left: safeFocusCategory(nearest.left),
                right: safeFocusCategory(nearest.right),
                up: safeFocusCategory(nearest.up)
            },
            nearestCandidateFingerprints: {
                down: safeFingerprint(nearestFingerprints.down),
                left: safeFingerprint(nearestFingerprints.left),
                right: safeFingerprint(nearestFingerprints.right),
                up: safeFingerprint(nearestFingerprints.up)
            },
            offscreenCount: Math.max(0, numberField(graph, ['offscreenCount'])),
            rejectedByReason: {
                blockedByModal: Math.max(0, numberField(rejected, ['blockedByModal'])),
                detached: Math.max(0, numberField(rejected, ['detached'])),
                disabled: Math.max(0, numberField(rejected, ['disabled'])),
                hidden: Math.max(0, numberField(rejected, ['hidden'])),
                outsideActiveScope: Math.max(0, numberField(rejected, ['outsideActiveScope'])),
                zeroSize: Math.max(0, numberField(rejected, ['zeroSize']))
            },
            routeFamily,
            totalCandidateCount: Math.max(0, numberField(graph, ['totalCandidateCount'])),
            visibleCount: Math.max(0, numberField(graph, ['visibleCount']))
        };

        store.recordFocusGraph(graphDiagnostic);
        store.markRouteFocusPhase('focus-graph-ready');
        return;
    }

    if (name === 'ptv-tv-focus-change') {
        const category = safeFocusCategory(detail.category);
        const visible = booleanField(detail, 'visible');

        store.recordFocusChange({
            candidatePresent: booleanField(detail, 'candidatePresent'),
            category,
            fingerprint: safeFingerprint(detail.fingerprint),
            inputId: /^remote-input-\d+$/.test(String(detail.inputId || '')) ? String(detail.inputId) : '',
            occurredAt,
            previousCategory: safeFocusCategory(detail.previousCategory),
            reason: safeDiagnosticReason(detail.reason, 'focus-observed'),
            routeFamily,
            scope: safeScopeCategory(detail.scope),
            visible
        });
        store.recordFocusVisibility({
            detachedDuringAnimation: false,
            focusMovedBeforeScrollSettled: false,
            focusToVisibleDurationMs: visible ? 0 : null,
            focusedCategory: category,
            inputId: /^remote-input-\d+$/.test(String(detail.inputId || '')) ? String(detail.inputId) : '',
            obscuredBy: getFocusObscuredBy(document.activeElement),
            occurredAt,
            routeFamily,
            scrollContainer: safeScopeCategory(detail.scope),
            status: 'focus-observed',
            visible,
            virtualizedNodeReplaced: false
        });
        store.markRouteFocusPhase('initial-focus');
        return;
    }

    if (name === 'ptv-tv-focus-scope') {
        store.recordFocusScope({
            candidateCount: Math.max(0, numberField(detail, ['candidateCount'])),
            initialFocusedCategory: safeFocusCategory(detail.initialFocusedCategory),
            leakedFocusOutsideScope: booleanField(detail, 'leakedFocusOutsideScope'),
            occurredAt,
            orphanedAfterRouteChange: booleanField(detail, 'orphanedAfterRouteChange'),
            previousFocusRestored: typeof detail.previousFocusRestored === 'boolean'
                ? detail.previousFocusRestored : null,
            routeFamily,
            scope: safeScopeCategory(detail.scope),
            status: safeEnum(
                detail.scopeStatus,
                ['opened', 'activated', 'back-or-close', 'closed', 'orphaned'],
                'activated'
            ) as 'activated' | 'back-or-close' | 'closed' | 'opened' | 'orphaned',
            trapActive: booleanField(detail, 'trapActive')
        });
        return;
    }

    if (name === 'ptv-tv-focus-lost') {
        store.markRouteFocusPhase('focus-lost');
        store.recordFocusVisibility({
            detachedDuringAnimation: booleanField(detail, 'detachedDuringAnimation'),
            focusMovedBeforeScrollSettled: false,
            focusToVisibleDurationMs: null,
            focusedCategory: safeFocusCategory(detail.previousCategory),
            inputId: '',
            obscuredBy: 'unknown',
            occurredAt,
            routeFamily,
            scrollContainer: 'unknown',
            status: 'focus-observed',
            visible: false,
            virtualizedNodeReplaced: booleanField(detail, 'detachedDuringAnimation')
        });
        return;
    }

    if (name === 'ptv-tv-focus-restoration-started' || name === 'ptv-tv-focus-back') {
        store.markRouteFocusPhase('restoration-started');
    } else if (name === 'ptv-tv-focus-restored') {
        store.markRouteFocusPhase(booleanField(detail, 'focusRestoreSuccess') ? 'restored' : 'restoration-failed');
    } else if (name === 'ptv-tv-focus-restore-retry-stopped') {
        store.markRouteFocusPhase('restoration-failed');
    }
}

export function bridgePtvDiagnosticObservabilityEvent(event: PtvObservabilityEvent) {
    const store = getPtvDiagnosticStore();

    if (event.type === 'playback' && event.name === PTV_PLAYBACK_SESSION_SNAPSHOT_EVENT) {
        const snapshot = normalizePtvPlaybackSessionSnapshot(event.detail, new Date(event.at).toISOString());

        if (snapshot) store.upsertPlaybackSession(snapshot);
        return;
    }

    if (event.type === 'route' && event.name === PTV_ROUTE_CRITICAL_LIFECYCLE_EVENT) {
        const detail = normalizePtvRouteCriticalLifecycleDetail(event.detail);

        if (detail) routeCriticalLifecycleHandler?.(detail);
        return;
    }

    if (event.type === 'cache') {
        updateCacheSummary();
        return;
    }

    if (event.type === 'recommendation') {
        if (event.name === 'recommendation-generation-start') {
            if (beginAuthoritativePtvRecommendationGeneration(event)) return;
        }
        if (event.name === 'recommendation-generation-finished') {
            finishAuthoritativePtvRecommendationGeneration(event);
            return;
        }
        // The current engine owns its terminal lifecycle. Its legacy stage logs
        // cannot establish a generation when authentication failed closed.
        if (isRecord(event.detail) && typeof event.detail.generationId === 'string'
            && /^recommendation-generation-\d+$/.test(event.detail.generationId)) return;
        if (currentRecommendationGeneration?.authoritative) return;

        const snapshot = store.getSnapshot();
        const previous = snapshot.recommendations;
        const explicitGenerationKey = getPtvRecommendationGenerationKey(event.detail);
        const failureNamed = /fail|error/.test(event.name);
        const failed = failureNamed && isPtvCoreRecommendationFailureName(event.name);
        const globalStarted = Boolean(explicitGenerationKey)
            && isPtvCoreRecommendationStartName(event.name);
        const completed = isPtvCoreRecommendationCompletionName(event.name);
        const startedGeneration = globalStarted ? beginPtvRecommendationGeneration(event) : null;
        const eventGeneration = globalStarted
            ? {
                current: Boolean(startedGeneration),
                generation: startedGeneration,
                proven: Boolean(startedGeneration)
            }
            : getPtvRecommendationEventGeneration(event);

        if (!globalStarted && explicitGenerationKey && (!eventGeneration.generation || !eventGeneration.current)) {
            return;
        }

        const sourceTimings = arrayField(event.detail, 'sourceTimings');
        const sourceFailures = arrayField(event.detail, 'sourceFailures');
        const explicitFailedSourceCount = numberField(event.detail, ['failedSourceCount'], sourceFailures.length);
        const eventSourceCount = Math.max(
            numberField(event.detail, ['sourceCount']),
            sourceFailures.length,
            sourceTimings.length
        );
        const sourceCount = Math.max(
            previous.sourceCount,
            eventSourceCount
        );
        const successfulSourceCount = sourceTimings.filter(timing => (
            !isRecord(timing) || timing.status !== 'failed'
        )).length;
        const completionAffectsCurrent = completed && (
            eventGeneration.current || (!currentRecommendationGeneration && !explicitGenerationKey)
        );
        const allSourcesFailed = completionAffectsCurrent
            && eventSourceCount > 0
            && explicitFailedSourceCount >= eventSourceCount;
        const partialFallback = completionAffectsCurrent && explicitFailedSourceCount > 0 && (
            successfulSourceCount > 0 || explicitFailedSourceCount < eventSourceCount
        );
        const localSourceFailure = failed && /source|prerequisite/.test(event.name);
        const failureAffectsCurrent = failed && (
            eventGeneration.current || !explicitGenerationKey
        );
        const sourceSummaryPresent = hasField(event.detail, [
            'failedSourceCount',
            'sourceCount',
            'sourceFailures',
            'sourceTimings'
        ]);
        const explicitSuccess = booleanField(event.detail, 'recovered')
            || booleanField(event.detail, 'success')
            || (isRecord(event.detail) && /complete|healthy|recover|success/.test(String(event.detail.status || '').toLowerCase()));
        const successfulSourceSummary = sourceSummaryPresent
            && explicitFailedSourceCount === 0
            && (
                successfulSourceCount > 0
                || (hasField(event.detail, ['failedSourceCount']) && explicitFailedSourceCount === 0)
                || eventSourceCount === 0
            );
        const provenSuccessfulCompletion = completionAffectsCurrent
            && eventGeneration.proven
            && !allSourcesFailed
            && (explicitSuccess || successfulSourceSummary);

        if (failureAffectsCurrent || allSourcesFailed) {
            recommendationFailureSticky = true;
            if (eventGeneration.current && eventGeneration.generation) {
                eventGeneration.generation.failureObserved = true;
            }
        } else if (provenSuccessfulCompletion) {
            recommendationFailureSticky = false;
            if (eventGeneration.generation) eventGeneration.generation.failureObserved = false;
        }

        if (eventGeneration.generation && eventGeneration.current) {
            if (completionAffectsCurrent || (failureAffectsCurrent && !localSourceFailure)) {
                eventGeneration.generation.terminal = true;
            }
        }

        const nextHealth = allSourcesFailed
            ? createPtvDiagnosticHealth('degraded', 'All observed recommendation sources failed safely.')
            : failureAffectsCurrent
                ? createPtvDiagnosticHealth(
                    'degraded',
                    localSourceFailure
                        ? 'A recommendation source failed; generation recovery has not been proven.'
                        : 'Recommendation generation failed safely.'
                )
                : completed && recommendationFailureSticky
                    ? previous.health
                    : completed && completionAffectsCurrent
                        ? createPtvDiagnosticHealth(
                            'healthy',
                            partialFallback
                                ? 'Recommendation generation completed with a bounded source fallback.'
                                : sourceCount === 0
                                    ? 'Recommendation generation completed with no eligible sources.'
                                    : 'Recommendation generation completed successfully.'
                        )
                        : previous.health;

        store.updateContext({
            recommendations: {
                ...previous,
                active: completionAffectsCurrent || (failureAffectsCurrent && !localSourceFailure)
                    ? false
                    : globalStarted && startedGeneration ? true : previous.active,
                configuredRows: Math.max(previous.configuredRows, numberField(event.detail, ['configuredRows', 'configuredRowCount'])),
                duplicateSuppressionCount: previous.duplicateSuppressionCount
                    + numberField(event.detail, ['duplicateItemsRemoved', 'duplicateSuppressionCount']),
                generatedRows: Math.max(previous.generatedRows, numberField(event.detail, ['generatedRows', 'rowCount', 'recommendationRowsGenerated'])),
                health: nextHealth,
                itemCount: Math.max(previous.itemCount, numberField(event.detail, ['itemCount', 'totalItems'])),
                lastErrorCategory: allSourcesFailed || (failureAffectsCurrent && !localSourceFailure) ? 'generation'
                    : partialFallback || (failureAffectsCurrent && localSourceFailure) ? 'source-partial'
                        : previous.lastErrorCategory,
                lastGenerationAt: completionAffectsCurrent ? new Date(event.at).toISOString() : previous.lastGenerationAt,
                runDurationMs: completionAffectsCurrent
                    ? event.durationMs ?? numberField(event.detail, ['durationMs'], previous.runDurationMs || 0)
                    : previous.runDurationMs,
                sourceCount
            }
        });
        return;
    }

    if (event.type === 'row-fetch' || (event.type === 'render' && /row|shelf/i.test(event.name))) {
        const status = classifyPtvDiagnosticShelfStatus(event);

        store.recordShelf({
            durationMs: event.durationMs ?? null,
            itemCount: numberField(event.detail, ['itemCount', 'items', 'renderedItems'], 0),
            occurredAt: new Date(event.at).toISOString(),
            routeFamily: currentRouteFamily(),
            shelfFamily: /reading/i.test(event.name) ? 'reading'
                : /music/i.test(event.name) ? 'music'
                    : /recommend/i.test(event.name) ? 'recommendations'
                        : 'content',
            status
        });
    }
}

function hasPtvDiagnosticCancellationDetail(detail: unknown): boolean {
    if (!isRecord(detail)) return false;
    if (detail.cancellation === true || detail.cancelled === true || detail.canceled === true) return true;

    return [
        detail.code,
        detail.error,
        detail.errorCategory,
        detail.kind,
        detail.message,
        detail.name,
        detail.outcome,
        detail.reason,
        detail.status
    ].some(value => {
        if (typeof value === 'string') return /abort|cancel/i.test(value);
        if (!isRecord(value)) return false;

        return [ value.code, value.kind, value.message, value.name, value.status ]
            .some(nested => typeof nested === 'string' && /abort|cancel/i.test(nested));
    });
}

export function classifyPtvDiagnosticShelfStatus(
    event: Pick<PtvObservabilityEvent, 'detail' | 'name'>
): PtvShelfDiagnostic['status'] {
    if (/timeout|timed-out/i.test(event.name)) return 'failed';
    if (/abort|cancel/i.test(event.name) || hasPtvDiagnosticCancellationDetail(event.detail)) return 'cancelled';
    if (/fail|error/.test(event.name)) return 'failed';
    if (/empty/.test(event.name)) return 'empty';
    if (/dispose|unmount/.test(event.name)) return 'disposed';
    if (/settled|complete|mounted|visible/.test(event.name)) return 'settled';
    if (/render/.test(event.name)) return 'render-started';
    if (/return|success/.test(event.name)) return 'data-returned';

    return 'request-started';
}

function updateCacheSummary() {
    const status = getFeaturedContentCacheStatus({ prime: false });
    const now = Date.now();
    const ageMs = status.createdAt ? Math.max(0, now - status.createdAt) : null;
    const readOutcome = status.lastReadOutcome;
    const writeOutcome = status.lastWriteOutcome;
    const readFailing = Boolean(status.readError || readOutcome === 'failed' || readOutcome === 'rejected');
    const writeFailing = Boolean(status.writeError || writeOutcome === 'failed' || writeOutcome === 'unverified');
    const failing = readFailing || writeFailing || Boolean(status.lastRefreshError);
    const countsObserved = status.countsObserved ?? Boolean(status.createdAt);
    const emptyObservationAt = status.countsObservedAt ?? status.lastReadAttemptAt;
    const observedEmpty = readOutcome === 'empty' && countsObserved && status.itemCount === 0
        && status.sectionCount === 0 && !status.createdAt;
    const emptyWithinTtl = observedEmpty && typeof emptyObservationAt === 'number'
        && Number.isFinite(emptyObservationAt) && typeof status.ttlMs === 'number'
        && status.ttlMs > 0 && now >= emptyObservationAt && now - emptyObservationAt <= status.ttlMs;
    const emptyExpired = observedEmpty && typeof emptyObservationAt === 'number'
        && Number.isFinite(emptyObservationAt) && !emptyWithinTtl;
    const cacheState = status.isFresh ? 'fresh' : status.createdAt || emptyExpired ? 'stale' : 'unknown';
    const toIso = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value)
        ? new Date(value).toISOString() : null;
    let healthStatus: 'degraded' | 'healthy' | 'unknown' = 'unknown';
    let healthReason = 'No featured-content cache entry is currently available.';

    if (failing) {
        healthStatus = 'degraded';
        healthReason = 'The featured-content cache reported a read, write, or refresh error.';
    } else if (status.isFresh) {
        healthStatus = 'healthy';
        healthReason = 'The featured-content cache is fresh.';
    } else if (emptyWithinTtl) {
        healthStatus = 'healthy';
        healthReason = 'The featured-content cache was observed empty.';
    } else if (status.createdAt || emptyExpired) {
        healthStatus = 'degraded';
        healthReason = 'The featured-content cache is stale.';
    }

    getPtvDiagnosticStore().updateContext({
        cache: {
            ageMs,
            cacheLayer: 'web-featured-content',
            countsObserved,
            countsObservedAt: toIso(status.countsObservedAt),
            fallbackAvailable: Boolean(status.fallbackAvailable),
            health: createPtvDiagnosticHealth(
                healthStatus,
                healthReason,
                {
                    metrics: {
                        ...(countsObserved ? { itemCount: status.itemCount, sectionCount: status.sectionCount } : {})
                    }
                }
            ),
            itemCount: status.itemCount,
            lastErrorCategory: readFailing ? 'read' : writeFailing ? 'write'
                : status.lastRefreshError ? 'refresh' : 'none',
            lastReadAttemptAt: toIso(status.lastReadAttemptAt),
            lastReadFailureAt: toIso(status.lastReadFailureAt),
            lastReadFailureCategory: safeEnum(status.lastReadFailureCategory,
                ['none', 'transport', 'authentication', 'timeout', 'parse', 'semantic', 'unknown'], 'unknown'),
            lastReadOutcome: safeEnum(readOutcome,
                ['not-attempted', 'in-progress', 'empty', 'adopted', 'rejected', 'failed'], 'not-attempted'),
            lastReadStatus: readOutcome === 'adopted' ? 'available' : readOutcome === 'not-attempted'
                ? 'not-read' : readOutcome,
            lastWriteAttemptAt: toIso(status.lastWriteAttemptAt),
            lastWriteOutcome: safeEnum(writeOutcome,
                ['not-attempted', 'in-progress', 'verified', 'unverified', 'failed'], 'not-attempted'),
            lastWriteStatus: writeOutcome === 'verified' ? 'stored' : writeOutcome === 'not-attempted'
                ? 'not-observed' : writeOutcome,
            observationAgeMs: 0,
            observedAt: new Date(now).toISOString(),
            owner: 'featured-content',
            sectionCount: status.sectionCount,
            state: cacheState,
            storageType: safeEnum(status.storage, ['memory', 'plugin-file', 'none'], 'unknown'),
            ttlMs: status.ttlMs,
            version: status.cacheVersion
        }
    });
}

export function refreshPtvDiagnosticCacheSummary(): void {
    updateCacheSummary();
}

export function getPtvDiagnosticCacheSamplingIntervalMs(isLowPower: boolean): number {
    return isLowPower ? 5 * 60_000 : 60_000;
}

function getPluginCapabilities(status: Record<string, unknown>) {
    const source = isRecord(status.capabilities) ? status.capabilities
        : isRecord(status.features) ? status.features
            : isRecord(status.featureFlags) ? status.featureFlags
                : {};

    return Object.entries(source)
        .filter(([name, value]) => /^[a-z0-9._-]{1,80}$/i.test(name) && value === true)
        .map(([name]) => name)
        .sort()
        .slice(0, 100);
}

async function refreshExternalStatus() {
    const store = getPtvDiagnosticStore();
    const apiClient = getCurrentPtvApiClient() as (ReturnType<typeof getCurrentPtvApiClient> & {
        serverAddress?: () => string;
        serverInfo?: () => Record<string, unknown>;
    }) | null;
    const pluginClient = getCurrentPtvPluginApiClient();
    const authenticatedSessionPresent = Boolean(getPtvCurrentUserId());
    const serverInfo = apiClient?.serverInfo?.() || {};
    const serverVersion = safeVersion(serverInfo.Version || serverInfo.version);
    let originClassification: 'remote-server' | 'same-origin' | 'unknown' = 'unknown';

    try {
        const address = apiClient?.serverAddress?.();

        if (address) originClassification = new URL(address, window.location.href).origin === window.location.origin
            ? 'same-origin' : 'remote-server';
    } catch {
        originClassification = 'unknown';
    }

    store.updateContext({
        server: {
            authenticatedSessionPresent,
            health: createPtvDiagnosticHealth(
                apiClient ? 'healthy' : 'unavailable',
                apiClient ? 'The existing Jellyfin API client is available.' : 'The Jellyfin API client is unavailable.',
                { collectorAvailable: Boolean(apiClient) }
            ),
            lastResponseDurationMs: null,
            originClassification,
            reachable: apiClient ? true : null,
            version: serverVersion
        }
    });

    if (!pluginClient) {
        store.updateContext({
            plugin: {
                ...store.getSnapshot().plugin,
                health: createPtvDiagnosticHealth('unavailable', 'The PiggieTV plugin API client is unavailable.', {
                    collectorAvailable: false
                }),
                reachable: null,
                status: 'unavailable'
            }
        });
        return;
    }

    const startedAt = performance.now();

    try {
        const rawStatus = await pluginClient.getStatus<unknown>();
        const status = isRecord(rawStatus) ? rawStatus : {};
        const capabilityIdentifiers = getPluginCapabilities(status);
        const version = safeVersion(status.pluginVersion || status.version);
        const apiVersion = Number(status.apiVersion);
        const durationMs = Number((performance.now() - startedAt).toFixed(1));
        const currentServerVersion = safeVersion(status.serverVersion || serverVersion);

        store.updateContext({
            plugin: {
                apiVersion: Number.isFinite(apiVersion) ? apiVersion : null,
                capabilityFingerprint: safeHash(`${version}:${capabilityIdentifiers.join(':')}`),
                capabilityIdentifiers,
                health: createPtvDiagnosticHealth('healthy', 'The PiggieTV plugin status endpoint responded.', {
                    metrics: {
                        capabilityCount: capabilityIdentifiers.length,
                        responseDurationMs: durationMs
                    }
                }),
                reachable: true,
                status: 'active',
                version
            },
            server: {
                ...store.getSnapshot().server,
                health: createPtvDiagnosticHealth('healthy', 'The authenticated plugin request reached Jellyfin.', {
                    metrics: { responseDurationMs: durationMs }
                }),
                lastResponseDurationMs: durationMs,
                reachable: true,
                version: currentServerVersion
            }
        });
    } catch {
        const durationMs = Number((performance.now() - startedAt).toFixed(1));

        store.updateContext({
            plugin: {
                ...store.getSnapshot().plugin,
                health: createPtvDiagnosticHealth('degraded', 'The plugin status endpoint did not respond successfully.', {
                    metrics: { responseDurationMs: durationMs }
                }),
                reachable: false,
                status: 'unreachable'
            }
        });
    }
}

function initializeContext() {
    const store = getPtvDiagnosticStore();
    const profile = getPtvClientProfile();
    const capabilities = getPtvWebCapabilityReport(profile);
    const build = getPtvBuildInfo();
    const capabilityIdentifiers = Object.entries(capabilities.capabilities)
        .filter(([, available]) => available)
        .map(([name]) => name)
        .sort();
    const unsupportedCapabilities = Object.entries(capabilities.capabilities)
        .filter(([, available]) => !available)
        .map(([name]) => name)
        .sort();

    store.updateContext({
        build: {
            buildId: build.frontendBuildId,
            buildTimestamp: build.frontendBuildDate,
            commitSha: build.frontendCommitSha,
            environment: build.environment,
            packageVersion: build.ptvWebVersion
        },
        core: {
            ...store.getSnapshot().core,
            capabilityIdentifiers,
            unsupportedCapabilities
        },
        platform: {
            deviceClass: capabilities.deviceClass,
            eligibilitySource: profile.tvDetectionReason,
            eligibilityTimestamp: new Date().toISOString(),
            isAndroidTv: profile.isAndroidTv,
            isFireTv: profile.isFireTv,
            isTv: profile.isTv,
            isWebOs: profile.isWebOs,
            layoutMode: profile.layoutMode,
            platform: capabilities.platform,
            profile: profile.kind,
            reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false,
            userAgentClassification: profile.isWebOs ? 'webos'
                : profile.isFireTv ? 'fire-tv'
                    : profile.isAndroidTv ? 'android-tv'
                        : profile.isTv ? 'generic-tv'
                            : profile.isMobile || profile.isTablet ? 'mobile'
                                : profile.kind === 'desktop' ? 'desktop'
                                    : 'unknown',
            visibilityState: document.hidden ? 'hidden' : 'visible'
        }
    });
}

function createCollector(): DisposableCollector {
    const store = getPtvDiagnosticStore();
    let disposed = false;
    let animationFrame = 0;
    let frameFlushTimer = 0;
    let cacheSummaryTimer = 0;
    let routeSettleTimer = 0;
    let scrollSettleTimer = 0;
    let scrollStartedAt = 0;
    let scrollFocus: HTMLElement | null = null;
    let scrollFocusFingerprint = 'none';
    let scrollInputId = '';
    let scrollScope: PtvFocusScopeCategory = 'unknown';
    let currentCriticalLifecycleId = '';
    let currentNavigationKey = '';
    let currentRouteControllerKey = '';
    let currentRouteGeneration: number | null = null;
    let currentRouteSessionId = '';
    let routeLayoutFingerprint = '';
    let routeReadySince = 0;
    let lastFrameAt = 0;
    let frameIntervals: number[] = [];
    let longTaskCount = 0;
    let collectorOverheadMs = 0;
    const disposers: Array<() => void> = [];
    const refreshCacheSummary = () => {
        if (!disposed) refreshPtvDiagnosticCacheSummary();
    };
    const imageLifecycle = createPtvImageLifecycleTracker();
    const diagnosticSelfImageGenerations = createPtvImageRemountGuard();
    const handleDiagnosticScroll = (event: Event) => {
        if (!scrollStartedAt) {
            const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            const target = event.target instanceof HTMLElement ? event.target : active;

            scrollStartedAt = performance.now();
            scrollFocus = active;
            scrollFocusFingerprint = getFocusFingerprint(active);
            scrollInputId = store.getSnapshot().inputs.at(-1)?.inputId || '';
            scrollScope = classifyPtvTvFocusScope(target);
            store.recordFocusVisibility({
                detachedDuringAnimation: false,
                focusMovedBeforeScrollSettled: false,
                focusToVisibleDurationMs: null,
                focusedCategory: classifyPtvDiagnosticFocusElement(active),
                inputId: scrollInputId,
                obscuredBy: getFocusObscuredBy(active),
                occurredAt: new Date().toISOString(),
                routeFamily: currentRouteFamily(),
                scrollContainer: scrollScope,
                status: 'scroll-started',
                visible: isPtvDiagnosticFocusVisible(active),
                virtualizedNodeReplaced: false
            });
        }

        window.clearTimeout(scrollSettleTimer);
        scrollSettleTimer = window.setTimeout(() => {
            const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            const detached = Boolean(scrollFocus && !scrollFocus.isConnected);
            const visible = isPtvDiagnosticFocusVisible(current);

            store.recordFocusVisibility({
                detachedDuringAnimation: detached,
                focusMovedBeforeScrollSettled: scrollFocusFingerprint !== getFocusFingerprint(current),
                focusToVisibleDurationMs: visible
                    ? Number(Math.max(0, performance.now() - scrollStartedAt).toFixed(2)) : null,
                focusedCategory: classifyPtvDiagnosticFocusElement(current),
                inputId: scrollInputId,
                obscuredBy: getFocusObscuredBy(current),
                occurredAt: new Date().toISOString(),
                routeFamily: currentRouteFamily(),
                scrollContainer: scrollScope,
                status: 'scroll-settled',
                visible,
                virtualizedNodeReplaced: detached
            });
            scrollStartedAt = 0;
            scrollFocus = null;
            scrollFocusFingerprint = 'none';
            scrollInputId = '';
            scrollScope = 'unknown';
        }, 120);
    };

    const evaluateRouteSettlement = () => {
        if (disposed || !currentRouteSessionId) return;

        const route = store.getSnapshot().routes.find(candidate => candidate.routeSessionId === currentRouteSessionId);

        if (!route || route.settledAt) return;

        const ready = route.criticalState !== 'undeclared'
            && route.criticalState !== 'pending';
        const fingerprint = `critical:${route.criticalState}`;
        const now = performance.now();

        if (!ready) {
            routeReadySince = 0;
            routeLayoutFingerprint = fingerprint;
        } else if (!routeReadySince || routeLayoutFingerprint !== fingerprint) {
            routeReadySince = now;
            routeLayoutFingerprint = fingerprint;
        } else if (now - routeReadySince >= 500) {
            store.markRoutePhase(currentRouteSessionId, 'settled');
            return;
        }

        routeSettleTimer = window.setTimeout(evaluateRouteSettlement, 100);
    };
    const startRoute = (detail: RouteControllerDetail = {}) => {
        const navigationKey = getPtvDiagnosticNavigationIdentity(detail);
        const routeGeneration = Number.isSafeInteger(detail.routeGeneration)
            && Number(detail.routeGeneration) >= 0
            ? Number(detail.routeGeneration)
            : null;
        const routeControllerKey = typeof detail.routeKey === 'string' ? detail.routeKey : '';
        const hasDifferentKnownGeneration = currentRouteGeneration !== null
            && routeGeneration !== null
            && routeGeneration !== currentRouteGeneration;

        if (currentRouteSessionId
            && navigationKey === currentNavigationKey
            && !hasDifferentKnownGeneration) {
            if (routeGeneration !== null) {
                currentRouteGeneration = routeGeneration;
                currentRouteControllerKey = routeControllerKey || currentRouteControllerKey;
                store.associateRouteGeneration(currentRouteSessionId, routeGeneration);
            }

            return currentRouteSessionId;
        }

        window.clearTimeout(routeSettleTimer);
        const route = detail?.normalizedPath || detail?.hash || detail?.path || detail?.full || window.location.hash;

        currentCriticalLifecycleId = '';
        currentNavigationKey = navigationKey;
        currentRouteControllerKey = routeControllerKey;
        currentRouteGeneration = routeGeneration;
        currentRouteSessionId = store.startRoute(route, routeGeneration);
        const routeSessionId = currentRouteSessionId;
        routeLayoutFingerprint = '';
        routeReadySince = 0;
        window.requestAnimationFrame(() => {
            if (disposed || currentRouteSessionId !== routeSessionId) return;
            store.markRoutePhase(routeSessionId, 'initialized');

            if (document.querySelector('main, [role="main"], .mainAnimatedPage:not(.hide), [data-ptv-route-content]')) {
                store.markRoutePhase(routeSessionId, 'first-content');
            }
            if (document.querySelector(FOCUSABLE_SELECTOR)) {
                store.markRoutePhase(routeSessionId, 'first-focusable');
            }
        });
        routeSettleTimer = window.setTimeout(evaluateRouteSettlement, 100);

        return routeSessionId;
    };
    const handleRoute = (event: Event) => {
        startRoute((event as CustomEvent<RouteControllerDetail>).detail);
    };
    const handleRouteCriticalLifecycle = (detail: PtvRouteCriticalLifecycleDetail) => {
        if (!currentRouteSessionId || detail.navigationKey !== currentNavigationKey) return;
        if (
            currentRouteGeneration !== null
            && detail.routeGeneration !== currentRouteGeneration
        ) return;
        if (currentRouteControllerKey && detail.routeKey !== currentRouteControllerKey) return;
        if (normalizePtvDiagnosticRouteFamily(detail.routeFamily) !== currentRouteFamily()) return;

        if (currentRouteGeneration === null) {
            currentRouteGeneration = detail.routeGeneration;
            currentRouteControllerKey = detail.routeKey;
            store.associateRouteGeneration(currentRouteSessionId, detail.routeGeneration);
        }

        if (detail.state === 'pending') {
            if (store.markRouteCriticalState(
                currentRouteSessionId,
                detail.state,
                detail.routeGeneration
            )) {
                currentCriticalLifecycleId = detail.lifecycleId;
                routeReadySince = 0;
            }
            return;
        }

        if (currentCriticalLifecycleId && detail.lifecycleId !== currentCriticalLifecycleId) return;
        if (!store.markRouteCriticalState(
            currentRouteSessionId,
            detail.state,
            detail.routeGeneration
        )) return;

        currentCriticalLifecycleId = detail.lifecycleId;
        routeReadySince = 0;

        if (
            detail.state !== 'cancelled'
            && detail.state !== 'failed'
            && !store.getSnapshot().routes.find(route => route.routeSessionId === currentRouteSessionId)?.firstContentAt
        ) {
            store.markRoutePhase(currentRouteSessionId, 'first-content');
        }
    };

    routeCriticalLifecycleHandler = handleRouteCriticalLifecycle;

    const recordImageRequest = (image: HTMLImageElement) => {
        if (!image.getAttribute('src') && !image.getAttribute('data-src')) return;

        const role = classifyImageRole(image);
        const routeFamily = currentRouteFamily();
        if (
            role === 'logo'
            && isPtvDiagnosticsRouteFamily(routeFamily)
            && !diagnosticSelfImageGenerations.shouldRecord(currentRouteSessionId || routeFamily, image)
        ) return;

        const lifecycle = imageLifecycle.begin(image);

        if (!lifecycle) return;

        store.recordImage({
            cacheClassification: 'browser-managed',
            decodeDurationMs: null,
            durationMs: null,
            fallbackUsed: image.dataset.ptvFallback === 'true',
            occurredAt: new Date().toISOString(),
            role,
            routeFamily,
            status: 'requested'
        });

        if (image.complete) {
            void Promise.resolve().then(() => {
                if (disposed || !image.isConnected) return;
                recordImageTerminal(image, image.naturalWidth > 0 ? 'loaded' : 'errored');
            });
        }
    };
    const recordImageTerminal = (image: HTMLImageElement, status: 'errored' | 'loaded') => {
        const lifecycle = imageLifecycle.complete(image);

        if (!lifecycle) return;

        store.recordImage({
            cacheClassification: 'browser-managed',
            decodeDurationMs: null,
            durationMs: Number((performance.now() - lifecycle.startedAt).toFixed(1)),
            fallbackUsed: image.dataset.ptvFallback === 'true',
            occurredAt: new Date().toISOString(),
            role: classifyImageRole(image),
            routeFamily: currentRouteFamily(),
            status
        });
    };
    const recordImageCompletion = (event: Event) => {
        const image = event.target instanceof HTMLImageElement ? event.target : null;

        if (!image) return;

        recordImageRequest(image);
        recordImageTerminal(image, event.type === 'load' ? 'loaded' : 'errored');
    };
    const forgetImages = (node: Node) => {
        if (!(node instanceof Element)) return;
        if (node instanceof HTMLImageElement) imageLifecycle.forget(node);
        node.querySelectorAll<HTMLImageElement>('img').forEach(imageLifecycle.forget);
    };

    const mutationObserver = new MutationObserver(records => {
        const startedAt = performance.now();

        records.forEach(record => {
            if (record.type === 'attributes' && record.target instanceof HTMLImageElement) {
                recordImageRequest(record.target);
            }
            record.addedNodes.forEach(node => {
                if (!(node instanceof Element)) return;
                if (node instanceof HTMLImageElement) recordImageRequest(node);
                node.querySelectorAll<HTMLImageElement>('img[src], img[data-src]').forEach(recordImageRequest);
            });
            record.removedNodes.forEach(forgetImages);
        });

        if (currentRouteSessionId) {
            const route = store.getSnapshot().routes.find(candidate => candidate.routeSessionId === currentRouteSessionId);

            if (!route?.firstContentAt
                && document.querySelector('main, [role="main"], .mainAnimatedPage:not(.hide), [data-ptv-route-content]')) {
                store.markRoutePhase(currentRouteSessionId, 'first-content');
            }
            if (!route?.firstFocusableAt
                && document.querySelector(FOCUSABLE_SELECTOR)) {
                store.markRoutePhase(currentRouteSessionId, 'first-focusable');
            }
        }
        collectorOverheadMs += performance.now() - startedAt;
    });

    const flushFrames = () => {
        if (!frameIntervals.length && !document.hidden) return;

        const visibleIntervals = document.hidden ? [] : frameIntervals.filter(interval => interval > 0 && interval < 1000);
        const durationMs = visibleIntervals.reduce((sum, interval) => sum + interval, 0);
        const jankyFrames = visibleIntervals.filter(interval => interval > 50).length;
        const fps = durationMs > 0 ? Math.min(120, (visibleIntervals.length / durationMs) * 1000) : 0;

        store.recordFrame({
            approximateFps: Number(fps.toFixed(1)),
            collectorOverheadMs: Number(collectorOverheadMs.toFixed(2)),
            frameCount: visibleIntervals.length,
            jankyFrameCount: jankyFrames,
            jankyFramePercentage: visibleIntervals.length
                ? Number(((jankyFrames / visibleIntervals.length) * 100).toFixed(1)) : 0,
            longestFrameMs: Number(Math.max(0, ...visibleIntervals).toFixed(1)),
            longTaskCount,
            p50FrameMs: getPtvDiagnosticPercentile(visibleIntervals, 0.5),
            p90FrameMs: getPtvDiagnosticPercentile(visibleIntervals, 0.9),
            p95FrameMs: getPtvDiagnosticPercentile(visibleIntervals, 0.95),
            p99FrameMs: getPtvDiagnosticPercentile(visibleIntervals, 0.99),
            reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false,
            routeFamily: currentRouteFamily(),
            sampledAt: new Date().toISOString(),
            visibilityState: document.hidden ? 'hidden' : 'visible'
        });
        frameIntervals = [];
        longTaskCount = 0;
        collectorOverheadMs = 0;
    };
    const frameTick = (at: number) => {
        if (lastFrameAt > 0) frameIntervals.push(at - lastFrameAt);
        lastFrameAt = at;
        animationFrame = window.requestAnimationFrame(frameTick);
    };

    let longTaskObserver: PerformanceObserver | null = null;

    try {
        if (typeof PerformanceObserver !== 'undefined'
            && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
            longTaskObserver = new PerformanceObserver(list => {
                longTaskCount += list.getEntries().length;
            });
            longTaskObserver.observe({ entryTypes: ['longtask'] });
            store.setCollectorCapability('longTasks', true);
        } else {
            store.setCollectorCapability('longTasks', false);
        }
    } catch {
        store.setCollectorCapability('longTasks', false);
    }

    const handleCacheUpdate = () => updateCacheSummary();
    window.addEventListener('ptv:routecontrollerchange', handleRoute);
    window.addEventListener('hashchange', handleRoute);
    window.addEventListener('popstate', handleRoute);
    window.addEventListener('ptv:focus-diagnostic', bridgePtvFocusDiagnosticEvent);
    window.addEventListener(FEATURED_CACHE_UPDATED_EVENT, handleCacheUpdate);
    document.addEventListener('load', recordImageCompletion, true);
    document.addEventListener('error', recordImageCompletion, true);
    document.addEventListener('scroll', handleDiagnosticScroll, true);
    mutationObserver.observe(document.documentElement, {
        attributeFilter: ['data-src', 'sizes', 'src', 'srcset'],
        attributes: true,
        childList: true,
        subtree: true
    });
    document.querySelectorAll<HTMLImageElement>('img[src], img[data-src]').forEach(recordImageRequest);
    animationFrame = window.requestAnimationFrame(frameTick);
    frameFlushTimer = window.setInterval(flushFrames, 1000);
    cacheSummaryTimer = window.setInterval(() => {
        if (!document.hidden) refreshCacheSummary();
    }, getPtvDiagnosticCacheSamplingIntervalMs(getPtvClientProfile().isLowPower));
    store.setCacheSummaryRefresher(refreshCacheSummary);

    disposers.push(
        subscribePtvObservability(bridgePtvDiagnosticObservabilityEvent),
        subscribePtvRecommendationDiagnosticScope(retirePtvRecommendationSummary),
        subscribePtvTvNavigation(snapshot => store.setFocus(getFocusDiagnostic(snapshot))),
        subscribePtvDiagnosticPreferences(preferences => {
            store.setCollectorEnabled(preferences.collectionEnabled);
        })
    );

    store.setCollectorEnabled(getPtvDiagnosticPreferences().collectionEnabled);
    [
        'cacheSummary',
        'frameTiming',
        'focusGraph',
        'focusScopes',
        'focusVisibility',
        'imageLifecycle',
        'pluginStatus',
        'playbackSessionSnapshots',
        'requestCoordinator',
        'remoteInputPipeline',
        'routeLifecycle',
        'routeRestoration',
        'shelfLifecycle',
        'tvFocus'
    ].forEach(name => store.setCollectorCapability(name, true));
    initializeContext();
    updateCacheSummary();
    startRoute();
    void refreshExternalStatus();

    return {
        dispose() {
            if (disposed) return;

            disposed = true;
            window.cancelAnimationFrame(animationFrame);
            window.clearInterval(frameFlushTimer);
            window.clearInterval(cacheSummaryTimer);
            store.setCacheSummaryRefresher(null);
            window.clearTimeout(routeSettleTimer);
            window.clearTimeout(scrollSettleTimer);
            mutationObserver.disconnect();
            longTaskObserver?.disconnect();
            window.removeEventListener('ptv:routecontrollerchange', handleRoute);
            window.removeEventListener('hashchange', handleRoute);
            window.removeEventListener('popstate', handleRoute);
            window.removeEventListener('ptv:focus-diagnostic', bridgePtvFocusDiagnosticEvent);
            window.removeEventListener(FEATURED_CACHE_UPDATED_EVENT, handleCacheUpdate);
            document.removeEventListener('load', recordImageCompletion, true);
            document.removeEventListener('error', recordImageCompletion, true);
            document.removeEventListener('scroll', handleDiagnosticScroll, true);
            if (routeCriticalLifecycleHandler === handleRouteCriticalLifecycle) {
                routeCriticalLifecycleHandler = null;
            }
            disposers.splice(0).forEach(dispose => dispose());
        },
        refreshExternalStatus
    };
}

export function recordPtvCoreInitializationDiagnostic(event: PtvCoreInitializationEvent) {
    const store = getPtvDiagnosticStore();
    const snapshot = store.getSnapshot();

    if (event.type === 'step-started') {
        store.updateContext({
            core: {
                ...snapshot.core,
                health: createPtvDiagnosticHealth('unknown', `Core initialization is running: ${event.name}.`),
                initializationState: 'initializing'
            }
        });
        return;
    }

    if (event.type === 'step-completed') {
        const failing = event.result.status === 'failed';
        const degraded = event.result.status === 'degraded';

        if (failing || degraded) {
            store.addWarning(`core step ${event.result.name} ${event.result.status}`);
        }
        return;
    }

    store.updateContext({
        core: {
            ...snapshot.core,
            activeAdapters: event.result.steps
                .filter(step => step.status !== 'skipped')
                .map(step => step.name),
            health: createPtvDiagnosticHealth(
                event.result.ready ? event.result.degraded ? 'degraded' : 'healthy' : 'failing',
                event.result.ready
                    ? event.result.degraded
                        ? 'PTV Core initialized with noncritical degradation.'
                        : 'PTV Core initialized successfully.'
                    : 'PTV Core initialization did not reach ready.',
                {
                    metrics: {
                        completedSteps: event.result.steps.filter(step => step.status === 'success').length,
                        degradedSteps: event.result.steps.filter(step => step.status === 'degraded').length
                    }
                }
            ),
            initializationOrder: event.result.steps.map(step => step.name),
            initializationState: event.result.ready ? event.result.degraded ? 'degraded' : 'ready' : 'failed'
        }
    });
}

export function initializePtvWebDiagnosticPlatform() {
    platform ||= createCollector();

    return platform;
}

export function refreshPtvWebDiagnosticExternalStatus() {
    return initializePtvWebDiagnosticPlatform().refreshExternalStatus();
}

export function disposePtvWebDiagnosticPlatformForTests() {
    platform?.dispose();
    platform = null;
    resetPtvRecommendationGenerationState();
}

/* eslint-enable @stylistic/operator-linebreak, array-callback-return, compat/compat, curly, no-nested-ternary, sonarjs/cognitive-complexity, sonarjs/no-alphabetical-sort, sonarjs/no-nested-conditional */
