import { describe, expect, it } from 'vitest';

import type {
    PtvRecommendationHomeData,
    PtvRecommendationItem,
    PtvRecommendationRow,
    PtvRecommendationScore
} from '../recommendations/types/recommendationTypes';
import {
    buildPtvCinematicDetailsModel,
    getPtvCinematicMediaFamily,
    type PtvAuthoritativeRelationshipCategory
} from './detailsCinematicModel';

function getMediaType(item: PtvRecommendationItem): PtvRecommendationScore['mediaType'] {
    if (item.Type === 'Audio' || item.Type === 'MusicAlbum') return 'music';
    if (item.Type === 'Book') return 'book';
    if (item.Type === 'Series') return 'show';

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

describe('cinematic Details model', () => {
    it('builds a release-order franchise timeline only from explicit collection metadata', () => {
        const seed = { CollectionName: 'Saga', Id: 'seed', Name: 'Saga II', ProductionYear: 2002, Type: 'Movie' };
        const candidates = [
            score({ CollectionName: 'Saga', Id: 'three', Name: 'Saga III', ProductionYear: 2003, Type: 'Movie' }),
            score({ CollectionName: 'Saga', Id: 'one', Name: 'Saga I', ProductionYear: 2001, Type: 'Movie' }),
            score({ Id: 'lookalike', Name: 'Saga Forever', ProductionYear: 2004, Type: 'Movie' })
        ];
        const model = buildPtvCinematicDetailsModel(seed, data(candidates));
        const timeline = model.shelves.find(shelf => shelf.id === 'franchise-order');

        expect(timeline?.orderLabel).toBe('Release order');
        expect(timeline?.items.map(item => item.itemId)).toEqual(['one', 'three']);
        expect(model.shelves.flatMap(shelf => shelf.items).some(item => item.itemId === 'lookalike')).toBe(false);
    });

    it('uses explicit series identity for episode order', () => {
        const seed = { Id: 'seed', Name: 'Episode 2', SeriesId: 'series', Type: 'Episode' };
        const model = buildPtvCinematicDetailsModel(seed, data([
            score({ Id: 's2e1', IndexNumber: 1, Name: 'Episode 1', ParentIndexNumber: 2, SeriesId: 'series', Type: 'Episode' }),
            score({ Id: 's1e4', IndexNumber: 4, Name: 'Episode 4', ParentIndexNumber: 1, SeriesId: 'series', Type: 'Episode' })
        ]));

        expect(model.family).toBe('series');
        expect(model.shelves[0].id).toBe('series-timeline');
        expect(model.shelves[0].items.map(item => item.itemId)).toEqual(['s1e4', 's2e1']);
    });

    it('connects music through exact artist metadata', () => {
        const seed = { Id: 'artist', Name: 'Exact Artist', Type: 'MusicArtist' };
        const model = buildPtvCinematicDetailsModel(seed, data([
            score({ AlbumArtist: 'Exact Artist', Id: 'album', Name: 'Album', ProductionYear: 2020, Type: 'MusicAlbum' }),
            score({ AlbumArtist: 'Another Artist', Id: 'other', Name: 'Exact Artist Tribute', Type: 'MusicAlbum' })
        ]));

        expect(model.family).toBe('music');
        expect(model.shelves[0].items.map(item => item.itemId)).toEqual(['album']);
    });

    it('builds reading order from explicit series metadata', () => {
        const seed = { Id: 'book-2', Name: 'Volume Two', SeriesName: 'Book Saga', Type: 'Book' };
        const model = buildPtvCinematicDetailsModel(seed, data([
            score({ Id: 'book-3', Name: 'Volume Three', ProductionYear: 2022, SeriesName: 'Book Saga', Type: 'Book' }),
            score({ Id: 'book-1', Name: 'Volume One', ProductionYear: 2020, SeriesName: 'Book Saga', Type: 'Book' })
        ]));

        expect(model.family).toBe('reading');
        expect(model.shelves[0].title).toBe('Reading order');
        expect(model.shelves[0].items.map(item => item.itemId)).toEqual(['book-1', 'book-3']);
    });

    it('reuses authoritative recommendation order but rejects an unrelated subject heading', () => {
        const recommended = [
            score({ Id: 'first', Name: 'First', Type: 'Movie' }, 90),
            score({ Id: 'second', Name: 'Second', Type: 'Movie' }, 80)
        ];
        const row: PtvRecommendationRow = {
            explanation: 'Existing engine explanation.',
            id: 'because-you-watched-fixture',
            items: recommended,
            title: 'Because You Watched Fixture'
        };
        const model = buildPtvCinematicDetailsModel({ Id: 'seed', Name: 'Seed', Type: 'Movie' }, data([], [row]));

        expect(model.shelves[0]).toMatchObject({
            description: 'Personalized by the existing PiggieTV recommendation owner.',
            relationship: 'authoritative-recommendation',
            title: 'Recommended for you'
        });
        expect(model.shelves[0].items.map(item => item.itemId)).toEqual(['first', 'second']);
    });

    it('deduplicates every ItemId across all shelves', () => {
        const duplicate = score({ CollectionName: 'Saga', Genres: ['Adventure'], Id: 'duplicate', Name: 'Duplicate', Type: 'Movie' });
        const row: PtvRecommendationRow = {
            explanation: 'Existing engine explanation.',
            id: 'recommended-movies',
            items: [duplicate],
            title: 'Recommended Movies'
        };
        const model = buildPtvCinematicDetailsModel({ CollectionName: 'Saga', Genres: ['Adventure'], Id: 'seed', Name: 'Seed', Type: 'Movie' }, data([duplicate, duplicate], [row]));
        const ids = model.shelves.flatMap(shelf => shelf.items.map(item => item.itemId));

        expect(ids).toEqual(['duplicate']);
        expect(model.dedupedCandidateCount).toBeGreaterThan(0);
    });

    it('requires authoritative evidence for cross-library relationships', () => {
        const seed = {
            CollectionName: 'Shared Name',
            Id: 'seed',
            Name: 'Seed',
            People: [{ Name: 'Shared Creator', Type: 'Director' }],
            SeriesName: 'Shared Series Name',
            Type: 'Movie'
        };
        const linkedBook = { Id: 'linked-book', Name: 'Linked Book', Type: 'Book' };
        const recommendationData = data([
            score({ CollectionName: 'Shared Name', Id: 'name-only-book', Name: 'Name-only Book', People: [{ Name: 'Shared Creator', Type: 'Author' }], SeriesName: 'Shared Series Name', Type: 'Book' }),
            score(linkedBook)
        ]);
        const absentModel = buildPtvCinematicDetailsModel(seed, recommendationData);
        const model = buildPtvCinematicDetailsModel(seed, recommendationData, [], [{
            category: 'adaptation',
            direction: 'source-to-target',
            displayOrder: 0,
            item: linkedBook
        }]);
        const crossLibrary = model.shelves.find(shelf => shelf.id === 'cross-library');
        const renderedIds = model.shelves.flatMap(shelf => shelf.items.map(card => card.itemId));

        expect(absentModel.shelves.some(shelf => shelf.id === 'cross-library')).toBe(false);
        expect(crossLibrary?.items.map(card => card.itemId)).toEqual(['linked-book']);
        expect(crossLibrary?.items[0].reasonChips).toContain('Adaptation');
        expect(renderedIds).not.toContain('name-only-book');
    });

    it('renders every allowlisted mapping category with deterministic order and global deduplication', () => {
        const categories: PtvAuthoritativeRelationshipCategory[] = [
            'soundtrack',
            'adaptation',
            'based-on',
            'spin-off',
            'companion-reading',
            'companion-video',
            'related-game',
            'related-comic',
            'related-book'
        ];
        const relationships = categories.map((category, index) => ({
            category,
            direction: 'source-to-target' as const,
            displayOrder: categories.length - index,
            item: {
                Id: `target-${index}`,
                Name: `Target ${index}`,
                Type: index % 2 ? 'Book' : 'MusicAlbum'
            }
        }));
        const model = buildPtvCinematicDetailsModel(
            { Id: 'seed', Name: 'Seed', Type: 'Movie' },
            data([score(relationships[0].item)]),
            [],
            [...relationships, relationships[0]]
        );
        const shelf = model.shelves.find(candidate => candidate.id === 'cross-library');
        const itemIds = model.shelves.flatMap(candidate => candidate.items.map(card => card.itemId));

        expect(shelf?.items).toHaveLength(categories.length);
        expect(shelf?.items[0].itemId).toBe('target-8');
        expect(new Set(shelf?.items.flatMap(card => card.reasonChips || []))).toEqual(new Set([
            'Soundtrack',
            'Adaptation',
            'Based On',
            'Spin-off',
            'Companion Reading',
            'Companion Video',
            'Related Game',
            'Related Comic',
            'Related Book'
        ]));
        expect(itemIds.filter(itemId => itemId === 'target-0')).toHaveLength(1);
    });

    it('preserves explicit same-family creator metadata without requiring a person ID', () => {
        const seed = {
            Id: 'seed',
            Name: 'Seed',
            People: [{ Id: 'known-person', Name: 'Shared Creator', Type: 'Director' }],
            Type: 'Movie'
        };
        const model = buildPtvCinematicDetailsModel(seed, data([
            score({ Id: 'movie', Name: 'Movie', People: [{ Name: 'Shared Creator', Type: 'Director' }], Type: 'Movie' })
        ]));
        const explicitConnections = model.shelves.find(shelf => shelf.id === 'explicit-connections');

        expect(explicitConnections?.relationship).toBe('shared-creator');
        expect(explicitConnections?.items[0].reason).toContain('Same Director');
    });

    it('classifies supported media without changing route ownership', () => {
        expect(getPtvCinematicMediaFamily({ Type: 'Movie' })).toBe('video');
        expect(getPtvCinematicMediaFamily({ Type: 'Episode' })).toBe('series');
        expect(getPtvCinematicMediaFamily({ Type: 'MusicAlbum' })).toBe('music');
        expect(getPtvCinematicMediaFamily({ Container: 'epub', Type: 'File' })).toBe('reading');
        expect(getPtvCinematicMediaFamily({ Type: 'Photo' })).toBe('other');
    });
});
