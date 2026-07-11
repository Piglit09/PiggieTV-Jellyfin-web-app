import {
    getPtvCurrentUserId,
    getPtvServerId
} from '../../../api';
import { getPtvPerformanceProfile } from '../../../core/clientProfile';
import { timePtvAsync } from '../../../core/observability';
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
import { buildPtvRecommendationDebugReport } from '../debug/recommendationDebug';
import { buildPtvRecommendationMixes, buildPtvRecommendationRowsWithQuality } from '../rows/recommendationRows';
import { getPtvRecommendationScoreModel, scorePtvRecommendationCandidates } from '../scoring/scoringModel';
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

function getCurrentCacheKey(includeHomeScans = false) {
    return `${getPtvServerId() || 'server'}:${getPtvCurrentUserId() || 'user'}:${includeHomeScans ? 'home-scans' : 'primary-sources'}`;
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

function getProfile(bundle: PtvRecommendationDataBundle, options: PtvRecommendationRunOptions = {}) {
    if (!bundle.profileSignals.length) {
        const cachedProfile = loadPtvTasteProfile(bundle.serverId, bundle.userId);
        const profile = cachedProfile || buildPtvTasteProfile([], {
            now: options.now,
            serverId: bundle.serverId,
            userId: bundle.userId
        });

        logPtvRecommendationStage('Profile loaded', {
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
            profileSource: 'generated',
            serverId: profile.serverId,
            sourceCount: Object.values(profile.sourceCounts).reduce((total, count) => total + (count || 0), 0),
            userId: profile.userId
        });

        return profile;
    } catch (error) {
        logPtvRecommendationFailure('Profile load', error, {
            profileSignals: bundle.profileSignals.length,
            serverId: bundle.serverId,
            userId: bundle.userId
        });
        throw error;
    }
}

export async function buildPtvRecommendationEngineResult(
    bundle?: PtvRecommendationDataBundle,
    options: PtvRecommendationRunOptions = {}
): Promise<PtvRecommendationEngineResult> {
    logPtvRecommendationStage('Engine created', {
        providedBundle: Boolean(bundle)
    });

    return timePtvAsync('recommendation', 'recommendation-engine-run', async () => {
        try {
            throwIfRecommendationAborted(options.signal);
            assertCanRunRecommendationGeneration();
            const dataBundle = bundle || await getPtvRecommendationDataBundle({
                includeHomeScans: options.includeHomeScans,
                signal: options.signal
            });
            throwIfRecommendationAborted(options.signal);
            const now = options.now || Date.now();
            const profile = getProfile(dataBundle, { now });
            throwIfRecommendationAborted(options.signal);
            const candidates = scorePtvRecommendationCandidates(
                profile,
                uniqueCandidates(dataBundle.candidates.map(input => input.item)),
                { now }
            );
            throwIfRecommendationAborted(options.signal);
            const rowResult = buildPtvRecommendationRowsWithQuality(profile, candidates);
            const rows = rowResult.rows;
            const mixes = buildPtvRecommendationMixes(candidates);
            const debug = buildPtvRecommendationDebugReport(profile, candidates, rows, {
                duplicateItemsRemoved: rowResult.duplicateItemsRemoved,
                rowDiagnostics: rowResult.rowDiagnostics,
                rowOverlapPercentage: rowResult.rowOverlapPercentage
            }, undefined, {
                now,
                sourceFailures: dataBundle.sourceFailures,
                sourceTimings: dataBundle.sourceTimings
            });

            logPtvRecommendationStage('Recommendations generated', {
                candidateCount: candidates.length,
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
                providedBundle: Boolean(bundle)
            });
            throw error;
        }
    }, {
        providedBundle: Boolean(bundle)
    });
}

export async function getPtvRecommendationDashboardData(options: { forceRefresh?: boolean; includeHomeScans?: boolean; signal?: AbortSignal } = {}): Promise<PtvRecommendationDashboardData> {
    const now = Date.now();
    const cacheKey = getCurrentCacheKey(options.includeHomeScans === true);
    const cached = dashboardCache.get(cacheKey);

    throwIfRecommendationAborted(options.signal);
    assertCanRunRecommendationGeneration();

    if (!options.forceRefresh && cached && cached.expiresAt > now) {
        return cached.data;
    }

    const result = await buildPtvRecommendationEngineResult(undefined, {
        includeHomeScans: options.includeHomeScans,
        now,
        signal: options.signal
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

export async function getPtvRecommendationHomeData(options: { forceRefresh?: boolean; includeHomeScans?: boolean; signal?: AbortSignal } = {}): Promise<PtvRecommendationHomeData> {
    const now = Date.now();
    const cacheKey = getCurrentCacheKey(options.includeHomeScans === true);
    const cached = homeCache.get(cacheKey);

    throwIfRecommendationAborted(options.signal);
    assertCanRunRecommendationGeneration();

    if (!options.forceRefresh && cached && cached.expiresAt > now) {
        return cached.data;
    }

    const result = await buildPtvRecommendationEngineResult(undefined, {
        includeHomeScans: options.includeHomeScans,
        now,
        signal: options.signal
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
