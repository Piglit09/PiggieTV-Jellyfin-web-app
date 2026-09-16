import { describe, expect, it } from 'vitest';

import type {
    PtvRecommendationMediaType,
    PtvRecommendationScore,
    PtvTasteProfile
} from '../types/recommendationTypes';
import { buildPtvRecommendationRowsWithQuality } from './recommendationRows';

const MEDIA_TYPES: PtvRecommendationMediaType[] = [ 'movie', 'show', 'anime' ];

function createScore(
    id: string,
    genre: string,
    source: 'candidate' | 'history',
    index: number
): PtvRecommendationScore {
    return {
        affinityScore: source === 'history' ? 80 : 28,
        discoveryWeight: source === 'history' ? 20 : 80,
        item: {
            Genres: [ genre ],
            Id: id,
            Name: id,
            Type: index % 3 === 0 ? 'Movie' : 'Series'
        },
        mediaType: MEDIA_TYPES[index % MEDIA_TYPES.length],
        reasons: [ {
            category: 'genres',
            label: genre,
            score: source === 'history' ? 80 : 28,
            source
        } ],
        score: source === 'history' ? 80 : 64
    } as PtvRecommendationScore;
}

describe('P2 recommendation semantics', () => {
    const profile = {
        crossMediaTerms: {},
        favoriteArtists: {}
    } as PtvTasteProfile;

    it('creates four distinct subject rows when explicit history relationships are sufficient', () => {
        const subjects = Array.from({ length: 4 }, (_, index) => ({
            Genres: [ `genre-${index}` ],
            Id: `subject-${index}`,
            Name: `Subject ${index}`,
            Type: 'Movie'
        }));
        const scores = subjects.flatMap((_, subjectIndex) => (
            Array.from({ length: 12 }, (_entry, index) => (
                createScore(`candidate-${subjectIndex}-${index}`, `genre-${subjectIndex}`, 'candidate', index)
            ))
        ));
        const result = buildPtvRecommendationRowsWithQuality(profile, scores, {
            historyItems: subjects
        });
        const rows = result.rows.filter(row => row.id.startsWith('because-you-watched-'));

        expect(rows).toHaveLength(4);
        expect(new Set(rows.flatMap(row => row.items.map(item => item.item.Id))).size).toBe(48);
        expect(rows.map(row => row.title)).toEqual([
            'Because You Watched Subject 0',
            'Because You Watched Subject 1',
            'Because You Watched Subject 2',
            'Because You Watched Subject 3'
        ]);
    });

    it('does not label aggregate-only candidates as personalized', () => {
        const scores = Array.from({ length: 24 }, (_, index) => (
            createScore(`aggregate-${index}`, 'discovery', 'candidate', index)
        ));

        expect(buildPtvRecommendationRowsWithQuality(profile, scores).rows).toEqual([]);
    });

    it('builds PTV Recommendation only when affinity and discovery pools both exist', () => {
        const affinity = Array.from({ length: 18 }, (_, index) => (
            createScore(`affinity-${index}`, `genre-${index % 4}`, 'history', index)
        ));
        const discovery = Array.from({ length: 18 }, (_, index) => (
            createScore(`discovery-${index}`, `genre-${index % 4}`, 'candidate', index)
        ));
        const row = buildPtvRecommendationRowsWithQuality(profile, [ ...affinity, ...discovery ])
            .rows.find(candidate => candidate.id === 'ptv-discovery');

        expect(row).toBeDefined();
        const sources = row?.items.map(item => item.reasons[0]?.source);
        const affinityRatio = (sources?.filter(source => source === 'history').length || 0) / (sources?.length || 1);
        const discoveryRatio = (sources?.filter(source => source === 'candidate').length || 0) / (sources?.length || 1);
        expect(affinityRatio).toBeGreaterThanOrEqual(0.4);
        expect(affinityRatio).toBeLessThanOrEqual(0.6);
        expect(discoveryRatio).toBeGreaterThanOrEqual(0.4);
        expect(discoveryRatio).toBeLessThanOrEqual(0.6);
    });
});
