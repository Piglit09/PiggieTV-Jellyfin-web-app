import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    PtvRecommendationDataBundle,
    PtvRecommendationItem,
    PtvRecommendationScore
} from '../types/recommendationTypes';

const identity = vi.hoisted(() => ({
    serverId: 'server-a',
    userId: 'user-a'
}));
const engineMocks = vi.hoisted(() => ({
    getBundle: vi.fn(),
    logFailure: vi.fn(),
    logStage: vi.fn(),
    recordEvent: vi.fn(),
    scoreCandidates: vi.fn()
}));

vi.mock('lib/jellyfin-apiclient', () => ({ ServerConnections: {} }));

vi.mock('../../../api', () => ({
    getPtvCurrentUserId: vi.fn(() => identity.userId),
    getPtvServerId: vi.fn(() => identity.serverId)
}));

vi.mock('../../../api/client', () => ({
    getCurrentPtvApiClient: vi.fn(() => ({
        getCurrentUserId: () => identity.userId,
        serverId: () => identity.serverId,
        serverInfo: () => ({ Id: identity.serverId })
    }))
}));

vi.mock('../../../core/clientProfile', () => ({
    getPtvPerformanceProfile: vi.fn(() => ({
        isFireTv: false,
        isLowPower: false
    }))
}));

vi.mock('../../../core/observability', () => ({
    recordPtvEvent: engineMocks.recordEvent,
    timePtvAsync: vi.fn(async (_category: string, _name: string, callback: () => Promise<unknown>) => callback())
}));

vi.mock('../debug/recommendationRuntimeDebug', () => ({
    logPtvRecommendationFailure: engineMocks.logFailure,
    logPtvRecommendationStage: engineMocks.logStage
}));

vi.mock('../providers/jellyfinRecommendationProvider', () => ({
    getPtvRecommendationDataBundle: engineMocks.getBundle
}));

vi.mock('./tasteProfile', () => ({
    buildPtvTasteProfile: vi.fn(() => ({
        crossMediaTerms: {},
        favoriteActors: {},
        favoriteArtists: {},
        favoriteAuthors: {},
        favoriteBookGenres: {},
        favoriteCollections: {},
        favoriteDecades: {},
        favoriteDirectors: {},
        favoriteGenres: {},
        favoriteMusicGenres: {},
        favoriteSeries: {},
        favoriteStudios: {},
        mediaTypes: {},
        profileVersion: 1,
        serverId: 'server-a',
        sourceCounts: {},
        updatedAt: 1,
        userId: 'user-a'
    })),
    loadPtvTasteProfile: vi.fn(() => null),
    savePtvTasteProfile: vi.fn()
}));

vi.mock('../scoring/scoringModel', () => ({
    getPtvRecommendationScoreModel: vi.fn(() => ({
        discoveryRatio: 0.3
    })),
    scorePtvRecommendationCandidates: engineMocks.scoreCandidates
}));

vi.mock('../rows/recommendationRows', () => ({
    buildPtvRecommendationMixes: vi.fn(() => []),
    buildPtvRecommendationRowsWithQuality: vi.fn((_profile, scores: PtvRecommendationScore[]) => ({
        duplicateItemsRemoved: 0,
        rowDiagnostics: [],
        rowOverlapPercentage: 100,
        rows: [
            {
                explanation: 'first',
                id: 'first',
                items: scores,
                title: 'first'
            },
            {
                explanation: 'second',
                id: 'second',
                items: scores.slice().reverse(),
                title: 'second'
            }
        ]
    }))
}));

vi.mock('../debug/recommendationDebug', () => ({
    buildPtvRecommendationDebugReport: vi.fn((_profile, _scores, _rows, quality) => ({
        quality: {
            ...quality,
            scoreDistribution: {
                buckets: [],
                max: 0,
                median: 0,
                min: 0,
                p25: 0,
                p75: 0,
                p90: 0
            },
            unresolvedArtistCount: 0
        },
        sourceFailures: [],
        sourceTimings: []
    }))
}));

import {
    buildPtvRecommendationEngineResult,
    getPtvRecommendationHomeData,
    invalidatePtvRecommendationCache
} from './recommendationEngine';

function item(Id: string, played = false): PtvRecommendationItem {
    return {
        Id,
        Name: Id,
        Type: 'Movie',
        UserData: {
            Played: played
        }
    };
}

function bundle(...items: PtvRecommendationItem[]): PtvRecommendationDataBundle {
    return {
        candidates: items.map(value => ({
            item: value,
            source: 'candidate'
        })),
        profileSignals: [],
        serverId: 'server-a',
        sourceFailures: [],
        sourceTimings: [],
        userId: 'user-a'
    };
}

describe('recommendation engine feedback integration', () => {
    beforeEach(() => {
        identity.serverId = 'server-a';
        identity.userId = 'user-a';
        invalidatePtvRecommendationCache({
            serverId: 'server-a',
            userId: 'user-a'
        });
        engineMocks.getBundle.mockReset();
        engineMocks.logFailure.mockReset();
        engineMocks.logStage.mockReset();
        engineMocks.recordEvent.mockReset();
        engineMocks.scoreCandidates.mockReset();
        engineMocks.scoreCandidates.mockImplementation((_profile, items: PtvRecommendationItem[]) => items.map(value => ({
            affinityScore: 50,
            discoveryWeight: 50,
            item: value,
            mediaType: 'movie',
            reasons: [],
            score: 50,
            source: 'test'
        })));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function recordedGenerationEvents(name: string) {
        return engineMocks.recordEvent.mock.calls.filter(([ type, eventName ]) => (
            type === 'recommendation' && eventName === name
        )).map(([, , detail ]) => detail);
    }

    it('publishes one authoritative success only after the entire engine run settles', async () => {
        let resolveBundle!: (value: PtvRecommendationDataBundle) => void;
        engineMocks.getBundle.mockImplementation(() => new Promise(resolve => {
            resolveBundle = resolve;
        }));
        const run = buildPtvRecommendationEngineResult();

        expect(recordedGenerationEvents('recommendation-generation-start')).toHaveLength(1);
        expect(recordedGenerationEvents('recommendation-generation-finished')).toHaveLength(0);

        resolveBundle(bundle(item('keep-a')));
        await run;

        const [ finished ] = recordedGenerationEvents('recommendation-generation-finished');
        expect(finished).toMatchObject({
            outcome: 'success',
            fallbackUsed: false,
            candidateCount: 1,
            providerCount: 0,
            tasteSignalCount: 0,
            generatedRowCount: 1,
            feedbackRejectionCount: 0
        });
        expect(finished.identityScope).toMatch(/^recommendation-scope-\d+$/);
        expect(finished.generationId).toBe(recordedGenerationEvents('recommendation-generation-start')[0].generationId);
        expect(Date.parse(finished.completedAt)).toBeGreaterThanOrEqual(Date.parse(finished.startedAt));
        expect(JSON.stringify(finished)).not.toMatch(/server-a|user-a|ptv-recommendations|cacheKey/);
    });

    it('reports partial source fallback separately from all-source failure', async () => {
        const partial = bundle(item('keep-a'));
        partial.sourceFailures = [{ source: 'history', error: 'private source failure' }];
        partial.sourceTimings = [
            { source: 'favorites', status: 'success', itemCount: 1, durationMs: 1, slow: false },
            { source: 'history', status: 'failed', itemCount: 0, durationMs: 1, slow: false }
        ];
        await buildPtvRecommendationEngineResult(partial);
        expect(recordedGenerationEvents('recommendation-generation-finished')[0]).toMatchObject({
            outcome: 'partial',
            fallbackUsed: true,
            providerCount: 2,
            errorCategory: 'source-partial'
        });

        const allFailed = bundle();
        allFailed.sourceFailures = [{ source: 'history', error: 'private source failure' }];
        allFailed.sourceTimings = [
            { source: 'history', status: 'failed', itemCount: 0, durationMs: 1, slow: false }
        ];
        await buildPtvRecommendationEngineResult(allFailed);
        expect(recordedGenerationEvents('recommendation-generation-finished')[1]).toMatchObject({
            outcome: 'failed',
            providerCount: 1,
            errorCategory: 'source-all-failed'
        });
    });

    it('reports a recovered provider prerequisite failure as a partial fallback', async () => {
        const recovered = bundle(item('keep-a'));
        recovered.prerequisiteFallbackUsed = true;
        await buildPtvRecommendationEngineResult(recovered);

        expect(recordedGenerationEvents('recommendation-generation-finished')[0]).toMatchObject({
            outcome: 'partial',
            fallbackUsed: true,
            errorCategory: 'source-partial'
        });
    });

    it('publishes bounded failed and cancelled outcomes without raw errors', async () => {
        engineMocks.scoreCandidates.mockImplementationOnce(() => {
            throw new Error('private-host/user-a');
        });
        await expect(buildPtvRecommendationEngineResult(bundle(item('keep-a')))).rejects.toThrow();
        // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill for legacy web runtimes.
        const signal = new AbortController();
        signal.abort();
        await expect(buildPtvRecommendationEngineResult(bundle(item('keep-a')), { signal: signal.signal })).rejects.toThrow();

        expect(recordedGenerationEvents('recommendation-generation-finished').map(detail => detail.outcome)).toEqual([
            'failed', 'cancelled'
        ]);
        expect(JSON.stringify(recordedGenerationEvents('recommendation-generation-finished'))).not.toMatch(/private-host|user-a/);
    });

    it('does not create a generation when a home result comes from cache', async () => {
        engineMocks.getBundle.mockResolvedValue(bundle(item('keep-a')));
        await getPtvRecommendationHomeData();
        await getPtvRecommendationHomeData();
        expect(recordedGenerationEvents('recommendation-generation-start')).toHaveLength(1);
        expect(recordedGenerationEvents('recommendation-generation-finished')).toHaveLength(1);
    });

    it('suppresses a late terminal from an older concurrent generation', async () => {
        let resolveFirst!: (value: PtvRecommendationDataBundle) => void;
        engineMocks.getBundle.mockImplementationOnce(() => new Promise(resolve => {
            resolveFirst = resolve;
        }))
            .mockResolvedValueOnce(bundle(item('new')));
        const first = buildPtvRecommendationEngineResult();
        await buildPtvRecommendationEngineResult();
        resolveFirst(bundle(item('old')));
        await first;
        expect(recordedGenerationEvents('recommendation-generation-start')).toHaveLength(2);
        expect(recordedGenerationEvents('recommendation-generation-finished')).toHaveLength(1);
    });

    it('suppresses a late terminal after the authenticated identity changes', async () => {
        let resolveBundle!: (value: PtvRecommendationDataBundle) => void;
        engineMocks.getBundle.mockImplementation(() => new Promise(resolve => {
            resolveBundle = resolve;
        }));
        const run = buildPtvRecommendationEngineResult();
        identity.serverId = 'server-b';
        identity.userId = 'user-b';
        resolveBundle(bundle(item('old')));
        await run;
        expect(recordedGenerationEvents('recommendation-generation-finished')).toHaveLength(0);
    });

    it('retains null when engine timing is unavailable and reports measured time when available', async () => {
        const clock = vi.spyOn(performance, 'now').mockReturnValue(NaN);
        await buildPtvRecommendationEngineResult(bundle(item('first')));
        let measuredAt = 0;
        clock.mockImplementation(() => {
            measuredAt += 17;
            return measuredAt;
        });
        await buildPtvRecommendationEngineResult(bundle(item('second')));
        const finishes = recordedGenerationEvents('recommendation-generation-finished');
        expect(finishes[0].durationMs).toBeNull();
        expect(finishes[1].durationMs).toBeGreaterThan(0);
    });

    it('filters feedback and completed items before scoring, then removes adjacent row duplicates', async () => {
        const result = await buildPtvRecommendationEngineResult(bundle(
            item('keep-a'),
            item('hidden'),
            item('completed', true),
            item('keep-b')
        ), {
            feedback: {
                entries: [{
                    action: 'not-interested',
                    createdAt: 1,
                    itemId: 'hidden',
                    terms: []
                }],
                undoStack: []
            }
        });

        expect(engineMocks.scoreCandidates.mock.calls[0][1].map((value: PtvRecommendationItem) => value.Id)).toEqual([
            'keep-a',
            'keep-b'
        ]);
        expect(result.rows.map(row => row.items.map(score => score.item.Id))).toEqual([
            ['keep-a', 'keep-b']
        ]);
        expect(recordedGenerationEvents('recommendation-generation-finished')[0]).toMatchObject({
            candidateCount: 2,
            feedbackRejectionCount: 2,
            identityDuplicateRejectionCount: 2,
            generatedItemCount: 2
        });
    });

    it('invalidates only the existing scoped cache and forces one new generation', async () => {
        engineMocks.getBundle.mockResolvedValue(bundle(item('keep-a'), item('keep-b')));

        await getPtvRecommendationHomeData();
        await getPtvRecommendationHomeData();

        expect(engineMocks.getBundle).toHaveBeenCalledTimes(1);
        expect(invalidatePtvRecommendationCache({
            serverId: 'other-server',
            userId: 'user-a'
        })).toBe(0);
        expect(invalidatePtvRecommendationCache({
            serverId: 'server-a',
            userId: 'user-a'
        })).toBe(1);

        await getPtvRecommendationHomeData();

        expect(engineMocks.getBundle).toHaveBeenCalledTimes(2);
    });

    it('propagates a distinct opaque diagnostic generation through each real engine run', async () => {
        engineMocks.getBundle.mockResolvedValue(bundle(item('keep-a')));

        await Promise.all([
            buildPtvRecommendationEngineResult(),
            buildPtvRecommendationEngineResult()
        ]);

        const starts = engineMocks.logStage.mock.calls.filter(([ stage ]) => stage === 'Generation started');
        const generationIds = starts.map(([, detail ]) => String(detail.generationId));

        expect(generationIds).toHaveLength(2);
        expect(new Set(generationIds).size).toBe(2);
        generationIds.forEach(generationId => {
            expect(generationId).toMatch(/^recommendation-generation-\d+$/);
        });
        expect(engineMocks.getBundle.mock.calls.map(([ options ]) => options.diagnosticGenerationId)).toEqual(generationIds);

        for (const [, detail ] of engineMocks.logStage.mock.calls.filter(([ stage ]) => (
            [
                'Diagnostic report generated',
                'Engine created',
                'Generation started',
                'Profile loaded',
                'Recommendations generated',
                'Rows generated'
            ].includes(stage)
        ))) {
            expect(generationIds).toContain(String(detail.generationId));
        }
    });
});
