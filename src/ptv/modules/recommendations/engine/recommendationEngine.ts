import {
    getPtvCurrentUserId,
    getPtvServerId
} from '../../../api';
import { getPtvPerformanceProfile } from '../../../core/clientProfile';
import { recordPtvEvent, timePtvAsync } from '../../../core/observability';
import {
    buildPtvTasteProfile,
    loadPtvTasteProfile,
    savePtvTasteProfile
} from './tasteProfile';
import {
    logPtvRecommendationFailure,
    logPtvRecommendationStage
} from '../debug/recommendationRuntimeDebug';
import { getPtvRecommendationDataBundle } from '../providers/jellyfinRecommendationProvider';
import { capturePtvRecommendationDiagnosticScope } from '../diagnostics/recommendationDiagnosticScope';
import {
    createPtvRecommendationIdentity,
    getPtvRecommendationCacheScopePrefix
} from '../recommendationIdentity';
import { buildPtvRecommendationDebugReport } from '../debug/recommendationDebug';
import { buildPtvRecommendationMixes, buildPtvRecommendationRowsWithQuality } from '../rows/recommendationRows';
import { getPtvRecommendationScoreModel, scorePtvRecommendationCandidates } from '../scoring/scoringModel';
import {
    filterAndDedupePtvRecommendationRows,
    filterPtvRecommendationCandidates,
    getPtvAdjacentRecommendationRowOverlapPercentage,
    shouldExcludePtvRecommendationItem
} from '../feedback/recommendationFeedback';
import type {
    PtvRecommendationDashboardData,
    PtvRecommendationDataBundle,
    PtvRecommendationEngineResult,
    PtvRecommendationHomeData,
    PtvRecommendationItem,
    PtvRecommendationRunOptions,
    PtvTasteProfile,
    PtvTasteSignal
} from '../types/recommendationTypes';

const DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000;
const HOME_CACHE_TTL_MS = 5 * 60 * 1000;
let recommendationDiagnosticGenerationSequence = 0;
let latestRecommendationDiagnosticGenerationId = '';

type DashboardCacheEntry = {
    data: PtvRecommendationDashboardData;
    expiresAt: number;
};

type HomeCacheEntry = {
    data: PtvRecommendationHomeData;
    expiresAt: number;
};

const dashboardCache = new Map<string, DashboardCacheEntry>();
const homeCache = new Map<string, HomeCacheEntry>();

function createRecommendationAbortError(message = 'Recommendation generation was cancelled.') {
    return Object.assign(new Error(message), {
        kind: 'abort'
    });
}

function throwIfRecommendationAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw createRecommendationAbortError();
}

function assertCanRunRecommendationGeneration() {
    const performanceProfile = getPtvPerformanceProfile();

    if (performanceProfile.isFireTv || performanceProfile.isLowPower) {
        throw new Error('Recommendation generation is disabled on Fire TV and low-power clients.');
    }
}

function getCurrentRecommendationIdentity(options: {
    feedback?: PtvRecommendationRunOptions['feedback'];
    includeHomeScans?: boolean;
    serverId?: string | null;
    userId?: string | null;
} = {}) {
    return createPtvRecommendationIdentity({
        feedback: options.feedback,
        includeHomeScans: options.includeHomeScans,
        serverId: options.serverId ?? getPtvServerId(),
        userId: options.userId ?? getPtvCurrentUserId()
    });
}

export function invalidatePtvRecommendationCache(scope: {
    serverId?: string | null;
    userId?: string | null;
} = {}) {
    const serverId = String(scope.serverId || getPtvServerId() || '').trim();
    const userId = String(scope.userId || getPtvCurrentUserId() || '').trim();

    if (!serverId || !userId) return 0;

    const cachePrefix = getPtvRecommendationCacheScopePrefix({ serverId, userId });
    let invalidatedEntries = 0;

    [dashboardCache, homeCache].forEach(cache => {
        [...cache.keys()].forEach(cacheKey => {
            if (!cacheKey.startsWith(cachePrefix)) return;

            cache.delete(cacheKey);
            invalidatedEntries += 1;
        });
    });

    return invalidatedEntries;
}

function uniqueCandidates(items: PtvRecommendationItem[]) {
    const seen = new Set<string>();
    const uniqueItems: PtvRecommendationItem[] = [];

    items.forEach(item => {
        const id = String(item.Id || item.Name || '');

        if (!id || seen.has(id)) return;

        seen.add(id);
        uniqueItems.push(item);
    });

    return uniqueItems;
}

function getTopRecommendationSources(profile: PtvTasteProfile) {
    const signals = [
        ...Object.values(profile.favoriteGenres),
        ...Object.values(profile.favoriteBookGenres),
        ...Object.values(profile.favoriteMusicGenres),
        ...Object.values(profile.favoriteStudios),
        ...Object.values(profile.favoriteArtists),
        ...Object.values(profile.favoriteAuthors),
        ...Object.values(profile.favoriteCollections),
        ...Object.values(profile.crossMediaTerms)
    ];
    const merged = signals.reduce<Record<string, PtvTasteSignal>>((accumulator, signal) => {
        const existing = accumulator[signal.label];

        accumulator[signal.label] = existing ?
            {
                ...existing,
                count: existing.count + signal.count,
                score: Math.max(existing.score, signal.score)
            } :
            signal;

        return accumulator;
    }, {});

    return Object.values(merged)
        .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
        .slice(0, 10)
        .map(signal => ({
            label: signal.label,
            score: Math.round(signal.score)
        }));
}

function getProfile(
    bundle: PtvRecommendationDataBundle,
    options: PtvRecommendationRunOptions = {},
    diagnosticGenerationId = ''
) {
    if (!bundle.profileSignals.length) {
        const cachedProfile = loadPtvTasteProfile(bundle.serverId, bundle.userId);
        const profile = cachedProfile || buildPtvTasteProfile([], {
            now: options.now,
            serverId: bundle.serverId,
            userId: bundle.userId
        });

        logPtvRecommendationStage('Profile loaded', {
            generationId: diagnosticGenerationId,
            profileSource: cachedProfile ? 'localStorage' : 'empty-new-user',
            serverId: profile.serverId,
            sourceCount: Object.values(profile.sourceCounts).reduce((total, count) => total + (count || 0), 0),
            userId: profile.userId
        });

        return profile;
    }

    try {
        const profile = buildPtvTasteProfile(bundle.profileSignals, {
            now: options.now,
            serverId: bundle.serverId,
            userId: bundle.userId
        });

        savePtvTasteProfile(profile);
        logPtvRecommendationStage('Profile loaded', {
            generationId: diagnosticGenerationId,
            profileSource: 'generated',
            serverId: profile.serverId,
            sourceCount: Object.values(profile.sourceCounts).reduce((total, count) => total + (count || 0), 0),
            userId: profile.userId
        });

        return profile;
    } catch (error) {
        logPtvRecommendationFailure('Profile load', error, {
            generationId: diagnosticGenerationId,
            profileSignals: bundle.profileSignals.length,
            serverId: bundle.serverId,
            userId: bundle.userId
        });
        throw error;
    }
}

function getRecommendationDiagnosticClock(): number | null {
    try {
        const value = performance.now();

        return Number.isFinite(value) ? value : null;
    } catch {
        return null;
    }
}

function getRecommendationDiagnosticDuration(startedAt: number | null): number | null {
    if (startedAt === null) return null;
    const completedAt = getRecommendationDiagnosticClock();

    return completedAt === null || completedAt < startedAt ? null :
        Number((completedAt - startedAt).toFixed(3));
}

function getRecommendationSourceOutcome(bundle: PtvRecommendationDataBundle | null) {
    const sourceTimings = bundle?.sourceTimings || [];
    const sourceFailures = bundle?.sourceFailures || [];
    const providerCount = new Set([
        ...sourceTimings.map(timing => timing.source),
        ...sourceFailures.map(failure => failure.source)
    ]).size;
    const fallbackUsed = bundle?.prerequisiteFallbackUsed === true || sourceFailures.length > 0 || sourceTimings.some(timing => (
        timing.subqueries?.some(subquery => subquery.status === 'failed')
    ));
    const allSourcesFailed = providerCount > 0 && !sourceTimings.some(timing => timing.status !== 'failed');

    return {
        allSourcesFailed,
        fallbackUsed,
        providerCount
    };
}

export async function buildPtvRecommendationEngineResult(
    bundle?: PtvRecommendationDataBundle,
    options: PtvRecommendationRunOptions = {}
): Promise<PtvRecommendationEngineResult> {
    const diagnosticGenerationId = `recommendation-generation-${++recommendationDiagnosticGenerationSequence}`;
    const startedAt = new Date().toISOString();
    const startedAtMonotonic = getRecommendationDiagnosticClock();
    const diagnosticScope = capturePtvRecommendationDiagnosticScope({
        serverId: bundle?.serverId ?? options.serverId ?? getPtvServerId(),
        userId: bundle?.userId ?? options.userId ?? getPtvCurrentUserId()
    });
    let completedBundle: PtvRecommendationDataBundle | null = null;
    let identityDuplicateRejectionCount = 0;
    let diversityCapRejectionCount = 0;
    let feedbackRejectionCount = 0;

    if (diagnosticScope) {
        latestRecommendationDiagnosticGenerationId = diagnosticGenerationId;
        recordPtvEvent('recommendation', 'recommendation-generation-start', {
            generationId: diagnosticGenerationId,
            identityScope: diagnosticScope.identityScope,
            startedAt
        });
    }

    const publishTerminal = (outcome: 'success' | 'partial' | 'failed' | 'cancelled',
        result?: PtvRecommendationEngineResult) => {
        if (!diagnosticScope?.isCurrent() || latestRecommendationDiagnosticGenerationId !== diagnosticGenerationId) return;
        const sourceOutcome = getRecommendationSourceOutcome(completedBundle);
        let errorCategory = 'none';

        if (outcome === 'failed') {
            errorCategory = sourceOutcome.allSourcesFailed && result ? 'source-all-failed' : 'generation';
        } else if (outcome === 'partial') {
            errorCategory = 'source-partial';
        }

        recordPtvEvent('recommendation', 'recommendation-generation-finished', {
            candidateCount: result?.candidates.length || 0,
            completedAt: new Date().toISOString(),
            diversityCapRejectionCount,
            durationMs: getRecommendationDiagnosticDuration(startedAtMonotonic),
            errorCategory,
            fallbackUsed: sourceOutcome.fallbackUsed,
            feedbackRejectionCount,
            generatedItemCount: result?.rows.reduce((count, row) => count + row.items.length, 0) || 0,
            generatedRowCount: result?.rows.length || 0,
            generationId: diagnosticGenerationId,
            identityDuplicateRejectionCount,
            identityScope: diagnosticScope.identityScope,
            outcome,
            providerCount: sourceOutcome.providerCount,
            renderedItemCount: null,
            startedAt,
            tasteSignalCount: completedBundle?.profileSignals.length || 0
        });
    };

    logPtvRecommendationStage('Generation started', {
        generationId: diagnosticGenerationId,
        providedBundle: Boolean(bundle)
    });
    logPtvRecommendationStage('Engine created', {
        generationId: diagnosticGenerationId,
        providedBundle: Boolean(bundle)
    });

    try {
        const result = await timePtvAsync('recommendation', 'recommendation-engine-run', async () => {
            try {
                throwIfRecommendationAborted(options.signal);
                assertCanRunRecommendationGeneration();
                const dataBundle = bundle || await getPtvRecommendationDataBundle({
                    diagnosticGenerationId,
                    includeHomeScans: options.includeHomeScans,
                    serverId: options.serverId,
                    signal: options.signal,
                    userId: options.userId
                });
                completedBundle = dataBundle;
                throwIfRecommendationAborted(options.signal);
                const now = options.now || Date.now();
                const profile = getProfile(dataBundle, { now }, diagnosticGenerationId);
                throwIfRecommendationAborted(options.signal);
                const uniqueCandidateItems = uniqueCandidates(dataBundle.candidates.map(input => input.item));
                identityDuplicateRejectionCount = Math.max(0, dataBundle.candidates.length - uniqueCandidateItems.length);
                feedbackRejectionCount = uniqueCandidateItems.filter(item => (
                    shouldExcludePtvRecommendationItem(item, options.feedback)
                )).length;
                const filteredCandidateItems = filterPtvRecommendationCandidates(
                    uniqueCandidateItems,
                    options.feedback
                );
                const candidates = scorePtvRecommendationCandidates(
                    profile,
                    filteredCandidateItems,
                    { now }
                );
                throwIfRecommendationAborted(options.signal);
                const rowResult = buildPtvRecommendationRowsWithQuality(profile, candidates, {
                    historyItems: dataBundle.profileSignals
                        .filter(signal => signal.source === 'history')
                        .map(signal => signal.item)
                });
                const rowFilterDiagnostics = {
                    feedbackRejectionCount: 0,
                    identityDuplicateRejectionCount: 0
                };
                const rows = filterAndDedupePtvRecommendationRows(rowResult.rows, options.feedback, {
                    diagnosticCounts: rowFilterDiagnostics
                });
                const rowItemCountBeforeFeedback = rowResult.rows.reduce((total, row) => total + row.items.length, 0);
                const rowItemCountAfterFeedback = rows.reduce((total, row) => total + row.items.length, 0);
                const rowFilteringRemovals = Math.max(0, rowItemCountBeforeFeedback - rowItemCountAfterFeedback);
                identityDuplicateRejectionCount += rowResult.identityDuplicateRejectionCount || 0;
                identityDuplicateRejectionCount += rowFilterDiagnostics.identityDuplicateRejectionCount;
                feedbackRejectionCount += rowFilterDiagnostics.feedbackRejectionCount;
                diversityCapRejectionCount = rowResult.diversityCapRejectionCount || 0;
                const mixes = buildPtvRecommendationMixes(candidates);
                const debug = buildPtvRecommendationDebugReport(profile, candidates, rows, {
                    duplicateItemsRemoved: rowResult.duplicateItemsRemoved + rowFilteringRemovals,
                    rowDiagnostics: rows
                        .map(row => row.diagnostics)
                        .filter((diagnostic): diagnostic is NonNullable<typeof diagnostic> => Boolean(diagnostic)),
                    rowOverlapPercentage: getPtvAdjacentRecommendationRowOverlapPercentage(rows)
                }, undefined, {
                    now,
                    sourceFailures: dataBundle.sourceFailures,
                    sourceTimings: dataBundle.sourceTimings
                });

                logPtvRecommendationStage('Recommendations generated', {
                    candidateCount: candidates.length,
                    generationId: diagnosticGenerationId,
                    mixCount: mixes.length,
                    profileSignalCount: dataBundle.profileSignals.length
                });
                const providerItemCounts = dataBundle.sourceTimings.reduce<Record<string, number>>((counts, timing) => {
                    counts[timing.source] = timing.itemCount;

                    return counts;
                }, {});
                const providerCandidateCounts = dataBundle.sourceTimings.reduce<Record<string, number>>((counts, timing) => {
                    counts[timing.source] = timing.candidateCount ?? timing.itemCount;

                    return counts;
                }, {});

                logPtvRecommendationStage('Diagnostic report generated', {
                    broadCandidateItemCount: providerItemCounts['broad-candidates'] || 0,
                    candidateCountByProvider: providerCandidateCounts,
                    favoriteItemCount: providerItemCounts.favorites || 0,
                    finalRecommendationCount: candidates.length,
                    generationId: diagnosticGenerationId,
                    generatedRowCount: rows.length,
                    historyItemCount: providerItemCounts.history || 0,
                    profileSignalCount: dataBundle.profileSignals.length,
                    recentlyAddedItemCount: providerItemCounts['recently-added'] || 0,
                    resumeItemCount: providerItemCounts.resume || 0,
                    rowIds: rows.map(row => row.id),
                    sourceFailures: dataBundle.sourceFailures,
                    sourceTimings: dataBundle.sourceTimings
                });
                logPtvRecommendationStage('Rows generated', {
                    duplicateItemsRemoved: debug.quality.duplicateItemsRemoved,
                    generationId: diagnosticGenerationId,
                    rowDiagnostics: rows.map(row => ({
                        id: row.id,
                        itemCount: row.items.length,
                        ...row.diagnostics
                    })),
                    rowCount: rows.length,
                    rowIds: rows.map(row => row.id),
                    rowOverlapPercentage: debug.quality.rowOverlapPercentage
                });

                return {
                    candidates,
                    debug,
                    mixes,
                    profile,
                    rows
                };
            } catch (error) {
                logPtvRecommendationFailure('Engine creation', error, {
                    generationId: diagnosticGenerationId,
                    providedBundle: Boolean(bundle)
                });
                throw error;
            }
        }, {
            generationId: diagnosticGenerationId,
            providedBundle: Boolean(bundle)
        });
        const sourceOutcome = getRecommendationSourceOutcome(completedBundle);
        let outcome: 'success' | 'partial' | 'failed' = 'success';

        if (sourceOutcome.allSourcesFailed) outcome = 'failed';
        else if (sourceOutcome.fallbackUsed) outcome = 'partial';
        publishTerminal(outcome, result);

        return result;
    } catch (error) {
        const candidate = error as { kind?: unknown; name?: unknown } | null;
        const cancelled = options.signal?.aborted || candidate?.kind === 'abort' || candidate?.name === 'AbortError';
        publishTerminal(cancelled ? 'cancelled' : 'failed');
        throw error;
    }
}

export async function getPtvRecommendationDashboardData(options: {
    forceRefresh?: boolean;
    includeHomeScans?: boolean;
    serverId?: string | null;
    signal?: AbortSignal;
    userId?: string | null;
} = {}): Promise<PtvRecommendationDashboardData> {
    const now = Date.now();
    const identity = getCurrentRecommendationIdentity(options);
    const cacheKey = identity.cacheKey;
    const cached = dashboardCache.get(cacheKey);

    throwIfRecommendationAborted(options.signal);
    assertCanRunRecommendationGeneration();

    if (!options.forceRefresh && cached && cached.expiresAt > now) {
        return cached.data;
    }

    const result = await buildPtvRecommendationEngineResult(undefined, {
        includeHomeScans: options.includeHomeScans,
        now,
        serverId: identity.serverId,
        signal: options.signal,
        userId: identity.userId
    });
    throwIfRecommendationAborted(options.signal);
    const scoreModel = getPtvRecommendationScoreModel();
    const data: PtvRecommendationDashboardData = {
        ...result,
        generatedAt: now,
        metrics: {
            crossMediaMatches: result.candidates.filter(candidate => candidate.reasons.some(reason => reason.category === 'cross-media')).length,
            discoveryPercentage: Math.round(scoreModel.discoveryRatio * 100),
            duplicateItemsRemoved: result.debug.quality.duplicateItemsRemoved,
            recommendationCount: result.candidates.length,
            rowOverlapPercentage: result.debug.quality.rowOverlapPercentage,
            scoreDistribution: result.debug.quality.scoreDistribution,
            sourceCount: Object.values(result.profile.sourceCounts).reduce((total, count) => total + (count || 0), 0),
            failedSourceCount: result.debug.sourceFailures.length,
            sourceFailures: result.debug.sourceFailures,
            sourceTimings: result.debug.sourceTimings,
            topRecommendationSources: getTopRecommendationSources(result.profile),
            unresolvedArtistCount: result.debug.quality.unresolvedArtistCount
        }
    };

    dashboardCache.set(cacheKey, {
        data,
        expiresAt: now + DASHBOARD_CACHE_TTL_MS
    });

    return data;
}

export async function getPtvRecommendationHomeData(options: {
    feedback?: PtvRecommendationRunOptions['feedback'];
    forceRefresh?: boolean;
    includeHomeScans?: boolean;
    serverId?: string | null;
    signal?: AbortSignal;
    userId?: string | null;
} = {}): Promise<PtvRecommendationHomeData> {
    const now = Date.now();
    const identity = getCurrentRecommendationIdentity(options);
    const cacheKey = identity.cacheKey;
    const cached = homeCache.get(cacheKey);

    throwIfRecommendationAborted(options.signal);
    assertCanRunRecommendationGeneration();

    if (!options.forceRefresh && cached && cached.expiresAt > now) {
        return cached.data;
    }

    const result = await buildPtvRecommendationEngineResult(undefined, {
        feedback: options.feedback,
        includeHomeScans: options.includeHomeScans,
        now,
        serverId: identity.serverId,
        signal: options.signal,
        userId: identity.userId
    });
    throwIfRecommendationAborted(options.signal);
    const data: PtvRecommendationHomeData = {
        candidates: result.candidates,
        generatedAt: now,
        mixes: result.mixes,
        profileUpdatedAt: result.profile.updatedAt,
        quality: result.debug.quality,
        rows: result.rows
    };

    homeCache.set(cacheKey, {
        data,
        expiresAt: now + HOME_CACHE_TTL_MS
    });

    return data;
}
