import { describe, expect, it } from 'vitest';

import type {
    PtvRecommendationHomeData,
    PtvRecommendationItem,
    PtvRecommendationRow,
    PtvRecommendationScore
} from '../recommendations/types/recommendationTypes';
import {
    buildPtvCinematicDetailsModel,
    getPtvCinematicEvidenceChips
} from './detailsCinematicModel';

function getMediaType(item: PtvRecommendationItem): PtvRecommendationScore['mediaType'] {
    if (item.Type === 'Book') return 'book';
    if (item.Type === 'Series') return 'show';
    if (item.Type === 'Audio') return 'music';

    return 'movie';
}

function score(item: PtvRecommendationItem, value = 50): PtvRecommendationScore {
    return {
        affinityScore: value,
        discoveryWeight: 20,
        item,
        mediaType: getMediaType(item),
        reasons: [],
        score: value,
        source: 'fixture'
    };
}

function data(candidates: PtvRecommendationScore[], rows: PtvRecommendationRow[] = []): PtvRecommendationHomeData {
    return {
        candidates,
        generatedAt: 1,
        mixes: [],
        profileUpdatedAt: 1,
        quality: {
            duplicateItemsRemoved: 0,
            rowOverlapPercentage: 0,
            scoreDistribution: { buckets: [], max: 0, median: 0, min: 0, p25: 0, p75: 0, p90: 0 },
            unresolvedArtistCount: 0
        },
        rows
    };
}

describe('F4A media universe model', () => {
    it('accepts explicit evidence and rejects weak title similarity', () => {
        const seed = { CollectionName: 'Explicit World', Id: 'seed', Name: 'Origin', Type: 'Movie' };
        const model = buildPtvCinematicDetailsModel(seed, data([
            score({ CollectionName: 'Explicit World', Id: 'accepted', Name: 'Different Name', Type: 'Movie' }),
            score({ Id: 'rejected', Name: 'Origin Returns', Type: 'Movie' })
        ]));
        const ids = model.shelves.flatMap(shelf => shelf.items.map(card => card.itemId));

        expect(ids).toContain('accepted');
        expect(ids).not.toContain('rejected');
    });

    it('uses administrator order before collection and release order', () => {
        const seed = { CollectionName: 'World', Id: 'seed', Name: 'Origin', Type: 'Movie' };
        const model = buildPtvCinematicDetailsModel(seed, data([
            score({ CollectionIndexNumber: 1, CollectionName: 'World', Id: 'later', Name: 'Later', ProductionYear: 2000, PtvWatchOrder: 2, Type: 'Movie' }),
            score({ CollectionIndexNumber: 2, CollectionName: 'World', Id: 'first', Name: 'First', ProductionYear: 2020, PtvWatchOrder: 1, Type: 'Movie' })
        ]));
        const timeline = model.shelves[0];

        expect(timeline.orderSource).toBe('administrator');
        expect(timeline.orderLabel).toBe('Administrator order');
        expect(timeline.orderExplanation).toContain('administrator-configured');
        expect(timeline.items.map(card => card.itemId)).toEqual(['first', 'later']);
    });

    it('labels a non-chronological fallback as release order', () => {
        const seed = { CollectionName: 'World', Id: 'seed', Name: 'Origin', Type: 'Movie' };
        const model = buildPtvCinematicDetailsModel(seed, data([
            score({ CollectionName: 'World', Id: 'later', Name: 'Later', ProductionYear: 2024, Type: 'Movie' }),
            score({ CollectionName: 'World', Id: 'first', Name: 'First', ProductionYear: 2020, Type: 'Movie' })
        ]));

        expect(model.shelves[0].orderSource).toBe('release');
        expect(model.shelves[0].orderLabel).toBe('Release order');
        expect(model.shelves[0].title).not.toContain('Chronological');
    });

    it('does not repeat cast without a distinct connected-title reason', () => {
        const seed = {
            Id: 'seed',
            Name: 'Origin',
            People: [
                { Id: 'person', Name: 'Exact Director', Type: 'Director' },
                { Name: 'Missing Identity', Type: 'Actor' }
            ],
            Studios: [{ Id: 'studio', Name: 'Exact Studio' }],
            Type: 'Movie'
        };
        const model = buildPtvCinematicDetailsModel(seed, data([]));
        const entities = model.shelves.find(shelf => shelf.presentation === 'entities');

        expect(entities?.items.map(card => card.itemId)).toEqual(['studio']);
        expect(entities?.items.map(card => card.entityType)).toEqual(['Studio']);
        expect(entities?.title).toBe('Explore connected sources');
        expect(entities?.relationship).toBe('shared-studio');
    });

    it('places strongly connected library titles ahead of creator and collection navigation', () => {
        const director = { Id: 'nolan', Name: 'Christopher Nolan', Type: 'Director' };
        const studio = { Id: 'dc', Name: 'DC' };
        const seed = {
            Id: 'dark-knight',
            Name: 'The Dark Knight',
            People: [director],
            Studios: [studio],
            Type: 'Movie'
        };
        const model = buildPtvCinematicDetailsModel(seed, data([
            score({
                Id: 'batman-begins',
                Name: 'Batman Begins',
                People: [director],
                Studios: ['DC'],
                Type: 'Movie'
            })
        ]));

        expect(model.shelves[0]?.id).toBe('explicit-connections');
        expect(model.shelves[0]?.items.map(card => card.itemId)).toEqual(['batman-begins']);
        expect(model.shelves[1]?.id).toBe('universe-entities');
        expect(model.shelves[1]?.title).toBe('Explore connected sources');
        expect(model.shelves[1]?.items[0]?.reason).toContain('connected title');
    });

    it('converts existing canonical metadata destinations into visual entity cards', () => {
        const model = buildPtvCinematicDetailsModel({ Id: 'seed', Name: 'Origin', Type: 'Movie' }, data([]), [{
            ariaLabel: 'Open collection',
            href: '#/collections?view=all&query=World',
            key: 'franchise:world',
            kind: 'franchise',
            label: 'Explore World',
            meta: 'Franchise',
            query: 'World'
        }]);
        const entity = model.shelves[0].items[0];

        expect(entity).toMatchObject({
            entityType: 'Franchise',
            href: '#/collections?view=all&query=World',
            kind: 'entity',
            title: 'World'
        });
    });

    it('allows cross-library media only through an authoritative mapping record', () => {
        const seed = { CollectionName: 'Shared Name', Id: 'movie', Name: 'Film', Type: 'Movie' };
        const album = { CollectionName: 'Shared Name', Id: 'album', Name: 'Score', Type: 'MusicAlbum' };
        const candidates = data([
            score(album),
            score({ Id: 'similar-title', Name: 'Film Soundtrack', Type: 'MusicAlbum' })
        ]);
        const absentModel = buildPtvCinematicDetailsModel(seed, candidates);
        const model = buildPtvCinematicDetailsModel(seed, candidates, [], [{
            category: 'soundtrack',
            direction: 'source-to-target',
            displayOrder: 0,
            item: album
        }]);
        const shelf = model.shelves.find(candidate => candidate.id === 'cross-library');

        expect(absentModel.shelves.some(candidate => candidate.id === 'cross-library')).toBe(false);
        expect(shelf?.items.map(card => card.itemId)).toEqual(['album']);
        expect(shelf?.items[0].reasonChips).toContain('Soundtrack');
    });

    it('emits truthful explanation chips without scoring internals', () => {
        const chips = getPtvCinematicEvidenceChips({
            Genres: ['Drama'],
            Id: 'seed',
            People: [{ Id: 'director', Name: 'Director', Type: 'Director' }],
            Type: 'Movie'
        }, {
            Genres: ['Drama'],
            Id: 'candidate',
            People: [{ Id: 'director', Name: 'Director', Type: 'Director' }],
            Type: 'Movie'
        });

        expect(chips).toEqual(['Same Director', 'Same Genre']);
        expect(chips.join(' ')).not.toMatch(/score|affinity/i);
    });

    it('bounds shelves, cards, and focus source IDs while globally deduplicating media', () => {
        const candidates = Array.from({ length: 30 }, (_, index) => score({
            CollectionName: 'World',
            Genres: ['Drama'],
            Id: `item-${index}`,
            Name: `Item ${index}`,
            Type: 'Movie'
        }, 100 - index));
        const duplicateRow: PtvRecommendationRow = {
            explanation: 'Existing recommendation evidence.',
            id: 'recommended-movies',
            items: candidates,
            title: 'Recommended Movies'
        };
        const model = buildPtvCinematicDetailsModel({ CollectionName: 'World', Genres: ['Drama'], Id: 'seed', Name: 'Seed', Type: 'Movie' }, data(candidates, [duplicateRow]));
        const ids = model.shelves.flatMap(shelf => shelf.items.filter(card => card.kind !== 'entity').map(card => card.itemId));

        expect(model.shelves.length).toBeLessThanOrEqual(5);
        expect(model.shelves.every(shelf => shelf.items.length <= 12)).toBe(true);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('does not retain personalized A to B to A state in the pure model', () => {
        const seed = { Id: 'seed', Name: 'Seed', Type: 'Movie' };
        const row = (id: string): PtvRecommendationRow => ({
            explanation: 'Scoped recommendation.',
            id: 'recommended-movies',
            items: [score({ Id: id, Name: id, Type: 'Movie' })],
            title: 'Recommended Movies'
        });
        const a1 = buildPtvCinematicDetailsModel(seed, data([], [row('a')]));
        const b = buildPtvCinematicDetailsModel(seed, data([], [row('b')]));
        const a2 = buildPtvCinematicDetailsModel(seed, data([], [row('a')]));

        expect(a1.shelves[0].items[0].itemId).toBe('a');
        expect(b.shelves[0].items[0].itemId).toBe('b');
        expect(a2.shelves[0].items[0].itemId).toBe('a');
    });
});
