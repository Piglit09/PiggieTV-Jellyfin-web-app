import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    scoreCandidates: vi.fn()
}));

vi.mock('../../../api', () => ({
    getPtvCurrentUserId: vi.fn(() => identity.userId),
    getPtvServerId: vi.fn(() => identity.serverId)
}));

vi.mock('../../../core/clientProfile', () => ({
    getPtvPerformanceProfile: vi.fn(() => ({
        isFireTv: false,
        isLowPower: false
    }))
}));

vi.mock('../../../core/observability', () => ({
    timePtvAsync: vi.fn(async (_category: string, _name: string, callback: () => Promise<unknown>) => callback())
}));

vi.mock('../debug/recommendationRuntimeDebug', () => ({
    logPtvRecommendationFailure: vi.fn(),
    logPtvRecommendationStage: vi.fn()
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
        invalidatePtvRecommendationCache({
            serverId: 'server-a',
            userId: 'user-a'
        });
        engineMocks.getBundle.mockReset();
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
});
