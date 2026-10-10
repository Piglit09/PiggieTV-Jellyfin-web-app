import { describe, expect, it } from 'vitest';

import type {
    PtvRecommendationHomeData,
    PtvRecommendationItem,
    PtvRecommendationRow,
    PtvRecommendationScore
} from '../recommendations/types/recommendationTypes';
import {
    buildPtvCinematicDetailsModel,
    getPtvCinematicEvidenceChips,
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
        expect(model.kicker).toBe('Explore related titles');
        expect(model.gateway?.description).not.toContain('universe');
        const entities = model.shelves.find(shelf => shelf.id === 'universe-entities');

        expect(entities?.title).toBe('Explore connected sources');
        expect(entities?.description).toContain('connected titles');
        expect(entities?.items.find(card => card.itemId === 'known-person')?.reason).toBe('1 connected title');
    });

    it('names an explicit franchise, collection, or series without inferring one from shared metadata', () => {
        const related = [score({ CollectionName: 'Avatar Collection', Franchise: 'Avatar', Genres: ['Animation'], Id: 'other', Name: 'Other', Type: 'Movie' })];

        expect(buildPtvCinematicDetailsModel({
            CollectionName: 'Avatar Collection', Franchise: 'Avatar', Id: 'franchise', Name: 'Avatar', Type: 'Movie'
        }, data(related)).kicker).toBe('Explore this franchise');
        expect(buildPtvCinematicDetailsModel({
            CollectionName: 'Avatar Collection', Id: 'collection', Name: 'Avatar', Type: 'Movie'
        }, data(related)).kicker).toBe('Explore this collection');
        expect(buildPtvCinematicDetailsModel({
            Id: 'series', Name: 'Avatar', SeriesName: 'Avatar', Type: 'Episode'
        }, data([])).kicker).toBe('Explore this series');
    });

    it('uses a generic heading when a franchise item only has general metadata connections', () => {
        const model = buildPtvCinematicDetailsModel({
            Franchise: 'Avatar', Genres: ['Animation'], Id: 'seed', Name: 'Avatar', Type: 'Movie'
        }, data([score({ Genres: ['Animation'], Id: 'other', Name: 'Unrelated', Type: 'Movie' })]));

        expect(model.shelves.some(shelf => shelf.id === 'franchise-order')).toBe(false);
        expect(model.kicker).toBe('Explore related titles');
        expect(model.shelves.find(shelf => shelf.id === 'explicit-connections')?.relationship).toBe('shared-genre');
    });

    it('does not call a shared collection a franchise when franchise identity differs', () => {
        const model = buildPtvCinematicDetailsModel({
            CollectionName: 'Animation Collection', Franchise: 'Avatar', Id: 'seed', Name: 'Avatar', Type: 'Movie'
        }, data([score({
            CollectionName: 'Animation Collection', Franchise: 'Other', Id: 'other', Name: 'Other', Type: 'Movie'
        })]));

        expect(model.shelves.some(shelf => shelf.id === 'franchise-order')).toBe(true);
        expect(model.kicker).toBe('Explore this collection');
    });

    it('does not call a franchise-only match a shared collection', () => {
        const seed = { Franchise: 'Avatar', Id: 'seed', Name: 'Seed', Type: 'Movie' };
        const candidate = { Franchise: 'Avatar', Id: 'other', Name: 'Other', Type: 'Movie' };
        const chips = getPtvCinematicEvidenceChips(seed, candidate);

        expect(chips).toContain('Same Franchise');
        expect(chips).not.toContain('Same Collection');
    });

    it('does not call a mixed collection timeline a single franchise', () => {
        const model = buildPtvCinematicDetailsModel({
            CollectionName: 'Animation Collection', Franchise: 'Avatar', Id: 'seed', Name: 'Seed', Type: 'Movie'
        }, data([
            score({ CollectionName: 'Animation Collection', Franchise: 'Avatar', Id: 'avatar', Name: 'Avatar', Type: 'Movie' }),
            score({ CollectionName: 'Animation Collection', Franchise: 'Other', Id: 'other', Name: 'Other', Type: 'Movie' })
        ]));

        expect(model.shelves.find(shelf => shelf.id === 'franchise-order')?.items).toHaveLength(2);
        expect(model.kicker).toBe('Explore this collection');
    });

    it('uses a generic heading when no single identity covers a mixed timeline', () => {
        const model = buildPtvCinematicDetailsModel({
            CollectionName: 'Animation Collection', Franchise: 'Avatar', Id: 'seed', Name: 'Seed', Type: 'Movie'
        }, data([
            score({ Franchise: 'Avatar', Id: 'avatar', Name: 'Avatar', Type: 'Movie' }),
            score({ CollectionName: 'Animation Collection', Id: 'collection', Name: 'Collection Film', Type: 'Movie' })
        ]));

        expect(model.shelves.find(shelf => shelf.id === 'franchise-order')?.items).toHaveLength(2);
        expect(model.kicker).toBe('Explore related titles');
    });

    it.each([
        ['Studios', 'Same Studio', 'shared-studio'],
        ['Networks', 'Same Network', 'shared-network'],
        ['Labels', 'Same Label', 'shared-label'],
        ['Publishers', 'Same Publisher', 'shared-publisher']
    ] as const)('labels a shared %s field by its actual kind', (field, expectedChip, expectedRelationship) => {
        const seed = { Id: 'seed', Name: 'Seed', Type: 'Movie', [field]: ['Shared'] };
        const candidate = { Id: 'candidate', Name: 'Candidate', Type: 'Movie', [field]: ['Shared'] };
        const model = buildPtvCinematicDetailsModel(seed, data([score(candidate)]));
        const shelf = model.shelves.find(entry => entry.id === 'explicit-connections');

        expect(shelf?.relationship).toBe(expectedRelationship);
        expect(shelf?.items[0].reasonChips).toContain(expectedChip);
        expect(shelf?.items[0].reasonChips).not.toContain('Same Collection');
    });

    it('classifies a genre-only discovery entity as genre metadata', () => {
        const model = buildPtvCinematicDetailsModel({ Id: 'seed', Name: 'Seed', Type: 'Movie' }, data([]), [{
            ariaLabel: 'Open animation', href: '#/search?query=Animation', key: 'genre:animation',
            kind: 'genre', label: 'Explore Animation', meta: 'Genre', query: 'Animation'
        }]);

        expect(model.shelves.find(shelf => shelf.id === 'universe-entities')?.relationship).toBe('shared-genre');
    });

    it('classifies supported media without changing route ownership', () => {
        expect(getPtvCinematicMediaFamily({ Type: 'Movie' })).toBe('video');
        expect(getPtvCinematicMediaFamily({ Type: 'Episode' })).toBe('series');
        expect(getPtvCinematicMediaFamily({ Type: 'MusicAlbum' })).toBe('music');
        expect(getPtvCinematicMediaFamily({ Container: 'epub', Type: 'File' })).toBe('reading');
        expect(getPtvCinematicMediaFamily({ Type: 'Photo' })).toBe('other');
    });
});
