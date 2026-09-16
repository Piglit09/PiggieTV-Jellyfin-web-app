import { describe, expect, it } from 'vitest';

import {
    PTV_RELATED_VIDEO_CANDIDATE_LIMIT,
    PTV_RELATED_VIDEO_DISPLAY_LIMIT,
    PTV_RELATED_VIDEO_FIELDS,
    rankPtvRelatedVideoItems
} from './detailsRelatedRecommendations';

type TestItem = Record<string, unknown> & {
    Genres?: string[];
    Id: string;
    Name: string;
    People?: Array<{ Id: string; Name: string; Type: string }>;
    ProductionYear?: number;
    Studios?: Array<{ Id: string; Name: string }>;
    Tags?: string[];
    Type?: string;
};

function movie(
    id: string,
    name: string,
    options: Partial<TestItem> = {}
): TestItem {
    return {
        Id: id,
        Name: name,
        Type: 'Movie',
        ...options
    };
}

describe('Details related-video recommendations', () => {
    it('hydrates one expanded Similar pool and keeps the visible shelf bounded', () => {
        expect(PTV_RELATED_VIDEO_CANDIDATE_LIMIT).toBeGreaterThan(PTV_RELATED_VIDEO_DISPLAY_LIMIT);
        expect(PTV_RELATED_VIDEO_DISPLAY_LIMIT).toBe(12);
        expect(PTV_RELATED_VIDEO_FIELDS.split(',')).toEqual(expect.arrayContaining([
            'Genres',
            'People',
            'CollectionName',
            'Tags',
            'Studios',
            'OriginalTitle',
            'ProviderIds'
        ]));
    });

    it('keeps a shared director and cast trilogy ahead of generic studio matches', () => {
        const dc = [{ Id: 'studio-dc', Name: 'DC' }];
        const nolan = { Id: 'person-nolan', Name: 'Christopher Nolan', Type: 'Director' };
        const bale = { Id: 'person-bale', Name: 'Christian Bale', Type: 'Actor' };
        const seed = movie('dark-knight', 'The Dark Knight', {
            Genres: [ 'Action', 'Crime', 'Drama' ],
            People: [ nolan, bale ],
            ProductionYear: 2008,
            Studios: dc,
            Tags: [ 'Batman', 'Superhero', 'Vigilante' ]
        });
        const candidates = [
            movie('dirty-harry', 'Dirty Harry', { Genres: [ 'Action', 'Crime' ] }),
            movie('batman-hush', 'Batman: Hush', { Genres: [ 'Action' ], Studios: dc, Tags: [ 'Batman' ] }),
            movie('dark-knight-rises', 'The Dark Knight Rises', {
                Genres: [ 'Action', 'Crime', 'Drama' ],
                People: [ nolan, bale ],
                ProductionYear: 2012,
                Studios: dc,
                Tags: [ 'Batman', 'Superhero', 'Vigilante' ]
            }),
            movie('batman-begins', 'Batman Begins', {
                Genres: [ 'Action', 'Crime', 'Drama' ],
                People: [ nolan, bale ],
                ProductionYear: 2005,
                Studios: dc,
                Tags: [ 'Batman', 'Superhero', 'Vigilante' ]
            })
        ];

        expect(rankPtvRelatedVideoItems(seed, candidates, 4).slice(0, 2).map(item => item.Id)).toEqual([
            'dark-knight-rises',
            'batman-begins'
        ]);
    });

    it('promotes franchise, studio, and genre affinity over weak Jellyfin server order', () => {
        const pixar = [{ Id: 'studio-pixar', Name: 'Pixar Animation Studios' }];
        const disney = [{ Id: 'studio-disney', Name: 'Walt Disney Animation Studios' }];
        const seed = movie('seed', 'Toy Story 5', {
            Genres: [ 'Animation', 'Family', 'Comedy', 'Adventure' ],
            ProductionYear: 2026,
            Studios: pixar,
            Tags: [ 'Friendship', 'Toys' ]
        });
        const serverOrder = [
            movie('neverending', 'The NeverEnding Story II', { Genres: [ 'Family', 'Adventure', 'Fantasy' ], ProductionYear: 1990 }),
            movie('superman', 'Superman II', { Genres: [ 'Action', 'Adventure' ], ProductionYear: 1980 }),
            movie('hunger-games', 'The Hunger Games', { Genres: [ 'Action', 'Adventure', 'Drama' ], ProductionYear: 2012 }),
            movie('bridesmaids', 'Bridesmaids', { Genres: [ 'Comedy' ], ProductionYear: 2011 }),
            movie('poor-things', 'Poor Things', { Genres: [ 'Comedy', 'Drama' ], ProductionYear: 2023 }),
            movie('gran-turismo', 'Gran Turismo', { Genres: [ 'Action', 'Drama' ], ProductionYear: 2023 }),
            movie('toy-story-4', 'Toy Story 4', {
                Genres: [ 'Animation', 'Family', 'Comedy', 'Adventure' ],
                ProductionYear: 2019,
                Studios: pixar,
                Tags: [ 'Friendship', 'Toys' ]
            }),
            movie('lightyear', 'Lightyear', {
                Genres: [ 'Animation', 'Family', 'Science Fiction', 'Adventure' ],
                ProductionYear: 2022,
                Studios: pixar,
                Tags: [ 'Space', 'Friendship' ]
            }),
            movie('finding-dory', 'Finding Dory', {
                Genres: [ 'Animation', 'Family', 'Comedy', 'Adventure' ],
                ProductionYear: 2016,
                Studios: pixar
            }),
            movie('zootopia', 'Zootopia 2', {
                Genres: [ 'Animation', 'Family', 'Comedy', 'Adventure' ],
                ProductionYear: 2025,
                Studios: disney,
                Tags: [ 'Friendship' ]
            }),
            movie('wreck-it-ralph', 'Wreck-It Ralph', {
                Genres: [ 'Animation', 'Family', 'Comedy', 'Adventure' ],
                ProductionYear: 2012,
                Studios: disney
            }),
            movie('encanto', 'Encanto', {
                Genres: [ 'Animation', 'Family', 'Comedy', 'Fantasy' ],
                ProductionYear: 2021,
                Studios: disney
            }),
            movie('shrek', 'Shrek', { Genres: [ 'Animation', 'Family', 'Comedy', 'Adventure' ], ProductionYear: 2001 }),
            movie('bad-guys', 'The Bad Guys 2', { Genres: [ 'Animation', 'Family', 'Comedy' ], ProductionYear: 2025 }),
            movie('spellbound', 'Spellbound', { Genres: [ 'Animation', 'Family', 'Comedy' ], ProductionYear: 2024 })
        ];

        const ranked = rankPtvRelatedVideoItems(seed, serverOrder);
        const firstSixIds = ranked.slice(0, 6).map(item => item.Id);

        expect(ranked).toHaveLength(12);
        expect(ranked[0]?.Id).toBe('toy-story-4');
        expect(firstSixIds).toEqual(expect.arrayContaining([
            'lightyear',
            'finding-dory',
            'zootopia'
        ]));
        expect(ranked.map(item => item.Id)).not.toContain('gran-turismo');
        expect(serverOrder[0]?.Id).toBe('neverending');
    });

    it('uses production-year proximity after stronger affinity signals tie', () => {
        const studio = [{ Id: 'studio-a', Name: 'Studio A' }];
        const seed = movie('seed', 'Premium Adventure', {
            Genres: [ 'Adventure' ],
            ProductionYear: 2026,
            Studios: studio
        });
        const older = movie('older', 'Older Adventure', {
            Genres: [ 'Adventure' ],
            ProductionYear: 1981,
            Studios: studio
        });
        const recent = movie('recent', 'Recent Adventure', {
            Genres: [ 'Adventure' ],
            ProductionYear: 2025,
            Studios: studio
        });

        expect(rankPtvRelatedVideoItems(seed, [ older, recent ], 2).map(item => item.Id)).toEqual([
            'recent',
            'older'
        ]);
    });

    it('applies the shared related policy studio caps when the pool is diverse enough', () => {
        const seed = movie('seed', 'Animation Seed', { Genres: [ 'Animation' ] });
        const names = [ 'North', 'South', 'East', 'West', 'Central' ];
        const candidates = [
            ...Array.from({ length: 5 }, (_, index) => movie(`a-${index}`, `Alpha ${names[index]}`, {
                Genres: [ 'Animation' ],
                Studios: [{ Id: 'studio-a', Name: 'Studio A' }]
            })),
            ...Array.from({ length: 3 }, (_, index) => movie(`b-${index}`, `Bravo ${names[index]}`, {
                Genres: [ 'Animation' ],
                Studios: [{ Id: 'studio-b', Name: 'Studio B' }]
            })),
            ...Array.from({ length: 3 }, (_, index) => movie(`c-${index}`, `Charlie ${names[index]}`, {
                Genres: [ 'Animation' ],
                Studios: [{ Id: 'studio-c', Name: 'Studio C' }]
            }))
        ];

        const ranked = rankPtvRelatedVideoItems(seed, candidates, 9);
        const studioACount = ranked.filter(item => item.Studios?.[0]?.Id === 'studio-a').length;

        expect(studioACount).toBeLessThanOrEqual(3);
        expect(rankPtvRelatedVideoItems(seed, candidates, 9).map(item => item.Id)).toEqual(
            ranked.map(item => item.Id)
        );
    });

    it('preserves Jellyfin order when usable affinity metadata is absent', () => {
        const seed = movie('seed', 'Unrelated Seed');
        const candidates = [
            movie('one', 'First'),
            movie('two', 'Second'),
            movie('three', 'Third')
        ];

        expect(rankPtvRelatedVideoItems(seed, candidates, 2).map(item => item.Id)).toEqual([
            'one',
            'two'
        ]);
    });

    it('does not treat a shared library ParentId as series or franchise affinity', () => {
        const seed = movie('seed', 'Seed Feature', { ParentId: 'movies-library' });
        const candidates = [
            movie('first', 'First Result', { ParentId: 'different-library' }),
            movie('second', 'Second Result', { ParentId: 'movies-library' })
        ];

        expect(rankPtvRelatedVideoItems(seed, candidates, 2).map(item => item.Id)).toEqual([
            'first',
            'second'
        ]);
    });
});
