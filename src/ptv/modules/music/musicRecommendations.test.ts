import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    buildPtvDistinctMusicRecommendationRow,
    buildPtvMusicRecommendations,
    buildPtvMusicRelatedTracks,
    buildPtvMusicRecommendationShelves,
    createPtvMusicRecommendationEngine
} from './musicRecommendations';

const musicApiMocks = vi.hoisted(() => ({
    fetchPtvMusicTracksForGenerator: vi.fn(),
    getPtvMusicHome: vi.fn()
}));

vi.mock('./musicApi', () => musicApiMocks);

type TestMusicItem = Parameters<typeof buildPtvMusicRecommendationShelves>[0][number];

function musicItem(
    id: string,
    artist: string,
    title: string,
    genres: string[] = []
) {
    return {
        Album: `${artist} album`,
        AlbumArtist: artist,
        AlbumId: `${artist}-album`,
        ArtistItems: [{ Name: artist }],
        Artists: [artist],
        DateCreated: '2026-07-19T00:00:00Z',
        Genres: genres,
        Id: id,
        Name: title,
        Type: 'Audio',
        UserData: {
            IsFavorite: false,
            PlayCount: 0
        }
    } as TestMusicItem;
}

describe('buildPtvMusicRecommendationShelves()', () => {
    it('repairs stale cached discovery rows without repeating affinity items', () => {
        const madeForYou = [
            musicItem('made-1', 'Alpha', 'Affinity One'),
            musicItem('made-2', 'Beta', 'Affinity Two')
        ];
        const repaired = buildPtvDistinctMusicRecommendationRow([
            ...madeForYou,
            musicItem('discover-1', 'Gamma', 'Discovery One'),
            musicItem('discover-1', 'Gamma', 'Discovery One'),
            musicItem('discover-2', 'Delta', 'Discovery Two')
        ], madeForYou);

        expect(repaired.map(item => item.Id)).toEqual(['discover-1', 'discover-2']);
    });

    it('initializes the engine before it generates shelf data', () => {
        const engine = createPtvMusicRecommendationEngine();

        expect(engine.initialized).toBe(false);

        const shelves = engine.buildShelves(
            [musicItem('seed-1', 'Seed Artist', 'Seed Track')],
            [musicItem('made-1', 'Seed Artist', 'Affinity Track')],
            [musicItem('recommended-1', 'New Artist', 'Discovery Track')]
        );

        expect(engine.initialized).toBe(true);
        expect(shelves.madeForYou.map(item => item.Id)).toEqual(['made-1']);
        expect(shelves.recommended.map(item => item.Id)).toEqual(['recommended-1']);
    });

    it('keeps affinity and discovery shelves distinct while using profile signals', () => {
        const shelves = buildPtvMusicRecommendationShelves(
            [
                musicItem('seed-alpha', 'Alpha', 'Played Alpha', ['Synth']),
                musicItem('seed-beta', 'Beta', 'Played Beta', ['Jazz'])
            ],
            [
                musicItem('aff-alpha', 'Alpha', 'Alpha Affinity', ['Synth']),
                musicItem('aff-beta', 'Beta', 'Beta Affinity', ['Jazz']),
                musicItem('aff-gamma', 'Gamma', 'Gamma Affinity', ['Synth']),
                musicItem('aff-delta', 'Delta', 'Delta Affinity', ['Country'])
            ],
            [
                musicItem('discover-epsilon', 'Epsilon', 'Epsilon Discovery', ['Pop']),
                musicItem('discover-zeta', 'Zeta', 'Zeta Discovery', ['Rock']),
                musicItem('discover-eta', 'Eta', 'Eta Discovery', ['Soul'])
            ],
            [],
            3
        );

        expect(shelves.madeForYou.map(item => item.Id)).toEqual([
            'aff-alpha',
            'aff-beta',
            'aff-gamma'
        ]);
        expect(shelves.recommended.map(item => item.Id)).toEqual([
            'discover-epsilon',
            'discover-eta',
            'discover-zeta'
        ]);
        expect(shelves.overlapPercentage).toBe(0);
    });

    it('reserves continue-listening items from discovery', () => {
        const continueItem = musicItem('resume-1', 'Resume Artist', 'Resume Track');
        const shelves = buildPtvMusicRecommendationShelves(
            [musicItem('seed-1', 'Seed Artist', 'Seed Track')],
            [continueItem, musicItem('aff-1', 'Affinity Artist', 'Affinity Track')],
            [continueItem, musicItem('discover-1', 'Discovery Artist', 'Discovery Track')],
            [continueItem],
            5
        );

        expect(shelves.madeForYou.map(item => item.Id)).toEqual(['aff-1']);
        expect(shelves.recommended.map(item => item.Id)).toEqual(['discover-1']);
    });

    it('keeps non-track music records out of related playback queues', async () => {
        const seed = musicItem('seed-1', 'Seed Artist', 'Seed Track');
        const playable = musicItem('track-1', 'Related Artist', 'Related Track');
        const related = await buildPtvMusicRelatedTracks(seed, {
            pool: [
                {
                    ...musicItem('album-1', 'Seed Artist', 'Album Record'),
                    MediaType: 'Audio',
                    Type: 'MusicAlbum'
                },
                {
                    ...musicItem('artist-1', 'Seed Artist', 'Artist Record'),
                    Type: 'MusicArtist'
                },
                playable
            ]
        });

        expect(related.map(item => item.Id)).toEqual(['track-1']);
    });
});

describe('buildPtvMusicRecommendations()', () => {
    beforeEach(() => {
        musicApiMocks.fetchPtvMusicTracksForGenerator.mockReset();
        musicApiMocks.getPtvMusicHome.mockReset();
    });

    function useMusicHome(items: TestMusicItem[]) {
        musicApiMocks.getPtvMusicHome.mockResolvedValue({
            sections: [{
                items
            }]
        });
    }

    it('keeps a playable song seed first while enforcing feedback and concentration limits', async () => {
        const seed = musicItem('seed-song', 'Seed Artist', 'Seed Song', ['Synth']);
        const familiar = {
            ...musicItem('familiar', 'Familiar Artist', 'Familiar Song', ['Rock']),
            UserData: {
                IsFavorite: true,
                PlayCount: 4
            }
        };
        const disliked = {
            ...musicItem('disliked', 'Disliked Artist', 'Disliked Song'),
            UserData: {
                IsFavorite: false,
                Likes: false,
                PlayCount: 0
            }
        } as TestMusicItem;
        const hidden = musicItem('hidden', 'Hidden Artist', 'Hidden Song');
        const pool = [
            seed,
            musicItem('seed-related-1', 'Seed Artist', 'Seed Related One', ['Synth']),
            musicItem('seed-related-2', 'Seed Artist', 'Seed Related Two', ['Synth']),
            musicItem('album-related-1', 'Album Artist', 'Album Related One'),
            musicItem('album-related-2', 'Album Artist', 'Album Related Two'),
            musicItem('album-related-3', 'Album Artist', 'Album Related Three'),
            familiar,
            disliked,
            hidden,
            musicItem('discovery-1', 'Discovery One', 'Discovery One'),
            musicItem('discovery-2', 'Discovery Two', 'Discovery Two'),
            musicItem('discovery-3', 'Discovery Three', 'Discovery Three'),
            musicItem('discovery-3', 'Discovery Three', 'Discovery Three')
        ];

        useMusicHome(pool);
        const request = {
            feedback: {
                entries: [{
                    action: 'hide-from-home' as const,
                    createdAt: 1,
                    itemId: 'hidden',
                    terms: []
                }],
                undoStack: []
            },
            limit: 8,
            seed: {
                item: seed,
                kind: 'song' as const,
                label: 'Seed Song'
            },
            sessionSeed: 'stable-session'
        };
        const first = await buildPtvMusicRecommendations(request);
        const second = await buildPtvMusicRecommendations(request);
        const itemIds = first.items.map(item => item.Id);
        const artistCounts = first.items.reduce<Record<string, number>>((counts, item) => {
            const artist = String(item.AlbumArtist || '');

            counts[artist] = (counts[artist] || 0) + 1;

            return counts;
        }, {});
        const albumCounts = first.items.reduce<Record<string, number>>((counts, item) => {
            const album = String(item.AlbumId || '');

            counts[album] = (counts[album] || 0) + 1;

            return counts;
        }, {});

        expect(itemIds[0]).toBe('seed-song');
        expect(second.items.map(item => item.Id)).toEqual(itemIds);
        expect(new Set(itemIds).size).toBe(itemIds.length);
        expect(itemIds).toContain('familiar');
        expect(itemIds).not.toContain('disliked');
        expect(itemIds).not.toContain('hidden');
        expect(Math.max(...Object.values(artistCounts))).toBeLessThanOrEqual(2);
        expect(Math.max(...Object.values(albumCounts))).toBeLessThanOrEqual(2);
        expect(musicApiMocks.fetchPtvMusicTracksForGenerator).not.toHaveBeenCalled();
    });

    it.each([
        {
            expectedFirstId: 'album-track-1',
            seed: {
                item: {
                    Id: 'album-a',
                    Name: 'Album A',
                    Type: 'MusicAlbum'
                } as TestMusicItem,
                kind: 'album' as const,
                label: 'Album A'
            }
        },
        {
            expectedFirstId: 'artist-track',
            seed: {
                item: {
                    Id: 'artist-b',
                    Name: 'Artist B',
                    Type: 'MusicArtist'
                } as TestMusicItem,
                kind: 'artist' as const,
                label: 'Artist B'
            }
        },
        {
            expectedFirstId: 'genre-track',
            seed: {
                kind: 'genre' as const,
                label: 'Jazz',
                value: 'Jazz'
            }
        }
    ])('starts a $seed.kind mix with a matching track', async ({ expectedFirstId, seed }) => {
        const secondAlbumTrack = {
            ...musicItem('album-track-2', 'Artist A', 'Album Track Two'),
            Album: 'Album A',
            AlbumId: 'album-a',
            IndexNumber: 2
        };
        const firstAlbumTrack = {
            ...musicItem('album-track-1', 'Artist A', 'Album Track One'),
            Album: 'Album A',
            AlbumId: 'album-a',
            IndexNumber: 1
        };
        const artistTrack = {
            ...musicItem('artist-track', 'Artist B', 'Artist Track'),
            ArtistItems: [{
                Id: 'artist-b',
                Name: 'Artist B'
            }]
        };

        useMusicHome([
            secondAlbumTrack,
            firstAlbumTrack,
            artistTrack,
            musicItem('genre-track', 'Artist C', 'Genre Track', ['Jazz']),
            musicItem('other-track', 'Artist D', 'Other Track', ['Rock'])
        ]);

        const result = await buildPtvMusicRecommendations({
            limit: 3,
            seed,
            sessionSeed: 'seed-first'
        });

        expect(result.items[0]?.Id).toBe(expectedFirstId);
    });

    it('uses sessionSeed for repeatable ordering while favoring discovery and retaining familiarity', async () => {
        const unplayed = Array.from({ length: 8 }, (_, index) => (
            musicItem(`new-${index}`, `New Artist ${index}`, `New Track ${index}`)
        ));
        const familiar = {
            ...musicItem('liked-track', 'Liked Artist', 'Liked Track'),
            UserData: {
                IsFavorite: true,
                LastPlayedDate: '2025-01-01T00:00:00Z',
                PlayCount: 3
            }
        };

        useMusicHome([
            ...unplayed,
            familiar
        ]);

        const first = await buildPtvMusicRecommendations({
            limit: 5,
            seed: {
                kind: 'random'
            },
            sessionSeed: 'session-a'
        });
        const repeated = await buildPtvMusicRecommendations({
            limit: 5,
            seed: {
                kind: 'random'
            },
            sessionSeed: 'session-a'
        });
        const differentSession = await buildPtvMusicRecommendations({
            limit: 5,
            seed: {
                kind: 'random'
            },
            sessionSeed: 'session-b'
        });

        expect(repeated.items.map(item => item.Id)).toEqual(first.items.map(item => item.Id));
        expect(differentSession.items.map(item => item.Id)).not.toEqual(first.items.map(item => item.Id));
        expect(first.items[0]?.Id).toMatch(/^new-/);
        expect(first.items.map(item => item.Id)).toContain('liked-track');
    });

    it('keeps Artist Mix album concentration bounded when the library supports alternatives', async () => {
        const artistTracks = [
            ['album-a-1', 'album-a'],
            ['album-a-2', 'album-a'],
            ['album-a-3', 'album-a'],
            ['album-b-1', 'album-b'],
            ['album-b-2', 'album-b'],
            ['album-c-1', 'album-c'],
            ['album-c-2', 'album-c'],
            ['album-d-1', 'album-d'],
            ['album-d-2', 'album-d'],
            ['album-e-1', 'album-e']
        ].map(([id, albumId], index) => ({
            ...musicItem(id, 'Seed Artist', `Artist Track ${index}`),
            AlbumId: albumId,
            ArtistItems: [{ Id: 'seed-artist', Name: 'Seed Artist' }]
        }));

        useMusicHome(artistTracks);
        const result = await buildPtvMusicRecommendations({
            limit: 8,
            seed: {
                item: {
                    Id: 'seed-artist',
                    Name: 'Seed Artist',
                    Type: 'MusicArtist'
                } as TestMusicItem,
                kind: 'artist',
                label: 'Seed Artist'
            },
            sessionSeed: 'artist-album-bounds'
        });
        const firstWindowAlbumCounts = result.items.slice(0, 10)
            .reduce<Record<string, number>>((counts, item) => {
                const albumId = String(item.AlbumId || '');

                counts[albumId] = (counts[albumId] || 0) + 1;
                return counts;
            }, {});

        expect(result.items).toHaveLength(8);
        expect(Math.max(...Object.values(firstWindowAlbumCounts))).toBeLessThanOrEqual(2);
    });

    it('lets Album Mix retain album relevance while bounding artist streaks when alternatives exist', async () => {
        const albumTracks = Array.from({ length: 5 }, (_, index) => ({
            ...musicItem(`album-track-${index}`, 'Album Artist', `Album Track ${index}`),
            Album: 'Seed Album',
            AlbumId: 'seed-album',
            IndexNumber: index + 1
        }));
        const alternatives = Array.from({ length: 4 }, (_, index) => (
            musicItem(`alternative-${index}`, `Alternative ${index}`, `Alternative Track ${index}`)
        ));

        useMusicHome([...albumTracks, ...alternatives]);
        const result = await buildPtvMusicRecommendations({
            limit: 8,
            seed: {
                item: {
                    Id: 'seed-album',
                    Name: 'Seed Album',
                    Type: 'MusicAlbum'
                } as TestMusicItem,
                kind: 'album',
                label: 'Seed Album'
            },
            sessionSeed: 'album-artist-bounds'
        });
        let albumArtistRun = 0;
        let longestAlbumArtistRun = 0;

        result.items.forEach(item => {
            albumArtistRun = item.AlbumArtist === 'Album Artist' ? albumArtistRun + 1 : 0;
            longestAlbumArtistRun = Math.max(longestAlbumArtistRun, albumArtistRun);
        });

        expect(result.items[0]?.AlbumId).toBe('seed-album');
        expect(result.items.filter(item => item.AlbumId === 'seed-album').length).toBeGreaterThan(2);
        expect(longestAlbumArtistRun).toBeLessThanOrEqual(2);
    });

    it('relaxes concentration only after strict candidates are exhausted in a small library', async () => {
        const smallLibrary = Array.from({ length: 5 }, (_, index) => ({
            ...musicItem(`small-${index}`, 'Only Artist', `Small Track ${index}`),
            AlbumId: 'only-album'
        }));

        useMusicHome(smallLibrary);
        const result = await buildPtvMusicRecommendations({
            limit: 5,
            seed: { kind: 'random' },
            sessionSeed: 'small-library-fallback'
        });

        expect(result.items).toHaveLength(5);
        expect(new Set(result.items.map(item => item.Id)).size).toBe(5);
    });

    it('forwards cancellation to fallback work and rejects a retired generation', async () => {
        // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill for legacy web runtimes.
        const controller = new AbortController();

        useMusicHome([]);
        musicApiMocks.fetchPtvMusicTracksForGenerator.mockImplementation((
            _query: unknown,
            _limit: number,
            signal?: AbortSignal
        ) => new Promise((_resolve, reject) => {
            // eslint-disable-next-line sonarjs/no-nested-functions -- The pending generator request must observe the test-owned signal.
            signal?.addEventListener('abort', () => {
                reject(new DOMException('Stopped', 'AbortError'));
            }, { once: true });
        }));

        const pending = buildPtvMusicRecommendations({
            limit: 5,
            seed: {
                kind: 'random'
            },
            sessionSeed: 'cancelled-session',
            signal: controller.signal
        });

        await vi.waitFor(() => {
            expect(musicApiMocks.fetchPtvMusicTracksForGenerator).toHaveBeenCalledWith(
                expect.any(Object),
                expect.any(Number),
                controller.signal
            );
        });
        controller.abort();

        await expect(pending).rejects.toMatchObject({
            name: 'AbortError'
        });
    });

    it('rejects superseded work after Home resolves without starting fallback work', async () => {
        const isCurrent = vi.fn()
            .mockReturnValueOnce(true)
            .mockReturnValueOnce(true)
            .mockReturnValue(false);

        useMusicHome([
            musicItem('track-1', 'Artist One', 'Track One')
        ]);

        await expect(buildPtvMusicRecommendations({
            isCurrent,
            limit: 1,
            seed: {
                kind: 'random'
            }
        })).rejects.toMatchObject({
            name: 'AbortError'
        });
        expect(musicApiMocks.fetchPtvMusicTracksForGenerator).not.toHaveBeenCalled();
    });
});
