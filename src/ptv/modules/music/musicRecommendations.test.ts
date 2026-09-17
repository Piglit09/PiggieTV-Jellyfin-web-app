import { beforeEach, describe, expect, it, vi } from 'vitest';

const recommendationEventMocks = vi.hoisted(() => ({
    recordPtvEvent: vi.fn()
}));
const recommendationPluginMocks = vi.hoisted(() => ({
    getCurrentPtvPluginApiClient: vi.fn()
}));

vi.mock('../../core/observability', () => recommendationEventMocks);
vi.mock('../../core/pluginApi', () => recommendationPluginMocks);

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
    beforeEach(() => {
        recommendationEventMocks.recordPtvEvent.mockClear();
    });

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

    it('keeps non-track and zero-affinity music records out of related playback queues', async () => {
        const seed = musicItem('seed-1', 'Seed Artist', 'Seed Track', [ 'Synth' ]);
        const playable = musicItem('track-1', 'Related Artist', 'Related Track', [ 'Synth' ]);
        const unrelated = {
            ...musicItem('unrelated-1', 'Unrelated Artist', 'Unrelated Track', [ 'Country' ]),
            UserData: {
                IsFavorite: true,
                PlayCount: 50
            }
        };
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
                playable,
                unrelated
            ]
        });

        expect(related.map(item => item.Id)).toEqual(['track-1']);
    });

    it('holds the Made For You, Discovery, and Related familiarity policies when supply is balanced', async () => {
        const seed = musicItem('seed-policy', 'Seed Artist', 'Seed Track', [ 'Synth' ]);
        const familiar = Array.from({ length: 7 }, (_, index) => ({
            ...musicItem(`familiar-${index}`, `Familiar ${index}`, `Familiar ${index}`, [ 'Synth' ]),
            UserData: { IsFavorite: true, PlayCount: 3 }
        }));
        const discovery = Array.from({ length: 8 }, (_, index) => (
            musicItem(`discovery-${index}`, `Discovery ${index}`, `Discovery ${index}`, [ 'Synth' ])
        ));
        const madeForYouDiscovery = Array.from({ length: 3 }, (_, index) => (
            musicItem(`made-discovery-${index}`, `Made Discovery ${index}`, `Made Discovery ${index}`, [ 'Synth' ])
        ));
        const shelves = buildPtvMusicRecommendationShelves(
            [ seed ],
            [ ...familiar, ...madeForYouDiscovery ],
            [ ...familiar.slice(0, 2).map(item => ({ ...item, Id: `new-${item.Id}` })), ...discovery ],
            [],
            10
        );
        const related = await buildPtvMusicRelatedTracks(seed, {
            limit: 10,
            pool: [ ...familiar.slice(0, 6), ...discovery.slice(0, 4) ]
        });

        expect(shelves.madeForYou.filter(item => item.UserData?.PlayCount).length).toBe(7);
        expect(shelves.madeForYou.filter(item => !item.UserData?.PlayCount).length).toBe(3);
        expect(shelves.recommended.filter(item => item.UserData?.PlayCount).length).toBe(2);
        expect(shelves.recommended.filter(item => !item.UserData?.PlayCount).length).toBe(8);
        expect(related.filter(item => item.UserData?.PlayCount).length).toBe(6);
        expect(related.filter(item => !item.UserData?.PlayCount).length).toBe(4);
    });
});

describe('buildPtvMusicRecommendations()', () => {
    beforeEach(() => {
        recommendationEventMocks.recordPtvEvent.mockClear();
        recommendationPluginMocks.getCurrentPtvPluginApiClient.mockReset();
        recommendationPluginMocks.getCurrentPtvPluginApiClient.mockReturnValue(null);
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
            ...musicItem('familiar', 'Familiar Artist', 'Familiar Song', ['Synth']),
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
            {
                ...musicItem('seed-related-2', 'Seed Artist', 'Seed Related Two', ['Synth']),
                AlbumId: 'seed-related-album-2'
            },
            musicItem('album-related-1', 'Album Artist', 'Album Related One', ['Synth']),
            musicItem('album-related-2', 'Album Artist', 'Album Related Two'),
            musicItem('album-related-3', 'Album Artist', 'Album Related Three'),
            familiar,
            disliked,
            hidden,
            musicItem('discovery-1', 'Discovery One', 'Discovery One', ['Synth']),
            musicItem('discovery-2', 'Discovery Two', 'Discovery Two', ['Synth']),
            musicItem('discovery-3', 'Discovery Three', 'Discovery Three', ['Synth']),
            musicItem('discovery-3', 'Discovery Three', 'Discovery Three', ['Synth'])
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
        expect(Math.max(...Object.values(artistCounts))).toBeLessThanOrEqual(3);
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
        expect(first.items.findIndex(item => item.Id === 'liked-track')).toBeLessThan(first.items.length - 1);
    });

    it('keeps Radio at 25/75 while excluding high-score tracks outside strict seed affinity', async () => {
        const seed = {
            ...musicItem('radio-seed', 'Radio Seed', 'Radio Seed', [ 'Synth' ]),
            UserData: { IsFavorite: true, PlayCount: 4 }
        };
        const familiar = {
            ...musicItem('radio-familiar', 'Known Guest', 'Known Guest', [ 'Synth' ]),
            UserData: { IsFavorite: true, PlayCount: 4 }
        };
        const discovery = Array.from({ length: 8 }, (_, index) => (
            musicItem(`radio-discovery-${index}`, `New Artist ${index}`, `New Track ${index}`, [ 'Synth' ])
        ));
        const unrelated = {
            ...musicItem('unrelated-favorite', 'Country Favorite', 'Unrelated Favorite', [ 'Country' ]),
            UserData: { IsFavorite: true, PlayCount: 100 }
        };

        useMusicHome([ seed, familiar, ...discovery, unrelated ]);
        const result = await buildPtvMusicRecommendations({
            limit: 10,
            seed: { item: seed, kind: 'song', label: seed.Name },
            sessionSeed: 'strict-radio-policy'
        });
        const familiarCount = result.items.filter(item => item.UserData?.PlayCount).length;

        expect(result.items).toHaveLength(10);
        expect(result.items[0]?.Id).toBe('radio-seed');
        expect(familiarCount).toBe(2);
        expect(result.items.length - familiarCount).toBe(8);
        expect(result.items.map(item => item.Id)).not.toContain('unrelated-favorite');
        expect(recommendationEventMocks.recordPtvEvent).toHaveBeenCalledWith(
            'recommendation',
            'music-recommendation-generation-completed',
            expect.objectContaining({
                algorithmId: 'ptv-diversified-sequence-v2',
                algorithmPolicyId: 'music-premium-v2',
                discoveryCount: 8,
                familiarCount: 2,
                itemCount: 10,
                surface: 'radio'
            })
        );
    });

    it('uses the plugin V2 rank when advertised and preserves a local fallback boundary', async () => {
        const items = [
            musicItem('plugin-a', 'Artist A', 'Track A', [ 'Ambient' ]),
            musicItem('plugin-b', 'Artist B', 'Track B', [ 'Ambient' ])
        ];
        const getStatus = vi.fn().mockResolvedValue({
            featureFlags: { recommendationPolicyV2: true }
        });
        const rankRecommendations = vi.fn().mockImplementation((request: {
            requestId: string;
            surface: string;
        }) => Promise.resolve({
            algorithmId: 'ptv-diversified-sequence-v2',
            cohort: 'music-premium',
            constraints: {
                discoveryTarget: 0.8,
                familiarTarget: 0.2,
                maxConsecutiveAlbum: 1,
                maxConsecutiveArtist: 1,
                maxItemsPerAlbum: 1,
                maxItemsPerArtist: 2
            },
            contractVersion: '2.0',
            generatedAt: '2026-08-08T00:00:00Z',
            generationLatencyMs: 1,
            items: [
                { classification: 'discovery', id: 'plugin-b', mediaType: 'Audio', rank: 1, reasons: [], score: 2, source: 'jellyfin-music-library', title: 'Track B', transitionScore: 0 },
                { classification: 'discovery', id: 'plugin-a', mediaType: 'Audio', rank: 2, reasons: [], score: 1, source: 'jellyfin-music-library', title: 'Track A', transitionScore: 0 }
            ],
            policyVersion: 'music-premium-v2',
            requestId: request.requestId,
            surface: request.surface
        }));

        recommendationPluginMocks.getCurrentPtvPluginApiClient.mockReturnValue({
            getCurrentUserId: () => 'user-1',
            getStatus,
            rankRecommendations
        });
        useMusicHome(items);

        const result = await buildPtvMusicRecommendations({
            limit: 2,
            prompt: 'Ambient focus radio',
            seed: { kind: 'random' },
            sessionSeed: 'plugin-v2'
        });

        expect(result.items.map(item => item.Id)).toEqual([ 'plugin-b', 'plugin-a' ]);
        expect(getStatus).toHaveBeenCalledWith({ signal: undefined });
        expect(rankRecommendations).toHaveBeenCalledWith(
            expect.objectContaining({
                contractVersion: '2.0',
                policyVersion: 'music-premium-v2',
                seed: expect.objectContaining({ genres: expect.arrayContaining([ 'ambient' ]) }),
                surface: 'radio'
            }),
            { signal: undefined }
        );
    });

    it('falls back to the local V2 rank when the plugin returns malformed ranked items', async () => {
        const items = [
            musicItem('local-a', 'Artist A', 'Track A', [ 'Ambient' ]),
            musicItem('local-b', 'Artist B', 'Track B', [ 'Ambient' ])
        ];
        const rankRecommendations = vi.fn().mockResolvedValue({
            algorithmId: 'ptv-diversified-sequence-v2',
            cohort: 'music-premium',
            constraints: {
                discoveryTarget: 0.75,
                familiarTarget: 0.25,
                maxConsecutiveAlbum: 2,
                maxConsecutiveArtist: 2,
                maxItemsPerAlbum: 2,
                maxItemsPerArtist: 3
            },
            contractVersion: '2.0',
            generatedAt: '2026-08-08T00:00:00Z',
            generationLatencyMs: 1,
            items: [{}],
            policyVersion: 'music-premium-v2',
            requestId: 'malformed-request',
            surface: 'radio'
        });

        recommendationPluginMocks.getCurrentPtvPluginApiClient.mockReturnValue({
            getCurrentUserId: () => 'user-1',
            getStatus: vi.fn().mockResolvedValue({
                featureFlags: { recommendationPolicyV2: true }
            }),
            rankRecommendations
        });
        useMusicHome(items);

        await expect(buildPtvMusicRecommendations({
            limit: 2,
            prompt: 'Ambient focus radio',
            seed: { kind: 'random' },
            sessionSeed: 'malformed-plugin-v2'
        })).resolves.toEqual(expect.objectContaining({
            items: expect.arrayContaining(items)
        }));
        expect(recommendationEventMocks.recordPtvEvent).toHaveBeenCalledWith(
            'recommendation',
            'music-recommendation-policy-fallback',
            expect.objectContaining({
                fallbackReason: 'plugin-rank-failed',
                source: 'local-v2',
                surface: 'radio'
            })
        );
    });

    it('uses free-text prompt terms to rank matching genres and tags ahead of unrelated tracks', async () => {
        useMusicHome([
            musicItem('horror-synth-1', 'Night One', 'Neon Graves', [ 'Horror', 'Synthwave' ]),
            musicItem('horror-synth-2', 'Night Two', 'Midnight Circuit', [ 'Synthwave' ]),
            musicItem('horror-synth-3', 'Night Three', 'Dark Signal', [ 'Horror' ]),
            musicItem('country-1', 'Daylight', 'Open Road', [ 'Country' ]),
            musicItem('pop-1', 'Sunshine', 'Bright Lights', [ 'Pop' ])
        ]);

        const result = await buildPtvMusicRecommendations({
            limit: 3,
            prompt: 'Make me a 50-song Horror Synthwave mix',
            seed: { kind: 'random' },
            sessionSeed: 'prompt-intent'
        });

        expect(result.items.map(item => item.Id)).toEqual(expect.arrayContaining([
            'horror-synth-1',
            'horror-synth-2',
            'horror-synth-3'
        ]));
        expect(result.items.every(item => item.Id?.startsWith('horror-synth-'))).toBe(true);
    });

    it('does not pad an explicit prompt with unrelated homepage tracks', async () => {
        useMusicHome([
            musicItem('darkwave-1', 'Night Signal', 'Black Glass', [ 'Darkwave' ]),
            musicItem('darkwave-2', 'Cold Neon', 'After Midnight', [ 'Darkwave' ]),
            ...Array.from({ length: 12 }, (_, index) => (
                musicItem(`country-${index}`, `Country ${index}`, `Open Road ${index}`, [ 'Country' ])
            ))
        ]);
        musicApiMocks.fetchPtvMusicTracksForGenerator.mockResolvedValue([]);

        const result = await buildPtvMusicRecommendations({
            limit: 8,
            prompt: 'Build a darkwave playlist',
            seed: { kind: 'random' },
            sessionSeed: 'prompt-relevance-floor'
        });

        expect(result.items.map(item => item.Id)).toEqual(expect.arrayContaining([ 'darkwave-1', 'darkwave-2' ]));
        expect(result.items).toHaveLength(2);
        expect(result.items.every(item => item.Genres?.includes('Darkwave'))).toBe(true);
    });

    it.each([
        [ 'Relax', 'Ambient' ],
        [ 'Focus', 'Classical' ],
        [ 'Party', 'Dance' ],
        [ 'Workout', 'Metal' ],
        [ 'Commute', 'Rock' ],
        [ 'Sleep', 'Drone' ],
        [ 'Romance', 'Soul' ]
    ])('maps the %s mood chip to useful %s vocabulary', async (mood, matchingGenre) => {
        useMusicHome([
            musicItem(`match-${mood}-1`, `${mood} Artist`, `${mood} One`, [ matchingGenre ]),
            musicItem(`match-${mood}-2`, `${mood} Guest`, `${mood} Two`, [ matchingGenre ]),
            musicItem(`miss-${mood}`, 'Wrong Artist', 'Wrong Track', [ 'Spoken Word' ])
        ]);

        const result = await buildPtvMusicRecommendations({
            limit: 1,
            prompt: `Make 50-song ${mood} mix`,
            seed: {
                kind: 'genre',
                label: mood,
                value: mood.toLowerCase()
            },
            sessionSeed: `mood-${mood}`
        });

        expect(result.items[0]?.Genres).toContain(matchingGenre);
    });

    it('keeps FLAC-only and OPUS-only quality requests distinct', async () => {
        useMusicHome([
            { ...musicItem('flac-1', 'Lossless One', 'FLAC One'), Container: 'flac' },
            { ...musicItem('flac-2', 'Lossless Two', 'FLAC Two'), Container: 'flac' },
            { ...musicItem('opus-1', 'Efficient One', 'OPUS One'), Container: 'opus' },
            { ...musicItem('mp3-1', 'Legacy One', 'MP3 One'), Container: 'mp3' }
        ]);
        musicApiMocks.fetchPtvMusicTracksForGenerator.mockResolvedValue([]);

        const flac = await buildPtvMusicRecommendations({
            limit: 4,
            prompt: 'Make FLAC-only playlist',
            seed: { kind: 'quality', label: 'FLAC', value: 'flac' }
        });
        const opus = await buildPtvMusicRecommendations({
            limit: 4,
            prompt: 'Make OPUS-only playlist',
            seed: { kind: 'quality', label: 'OPUS', value: 'opus' }
        });

        expect(flac.items.map(item => item.Id)).toEqual(expect.arrayContaining([ 'flac-1', 'flac-2' ]));
        expect(flac.items.every(item => item.Container === 'flac')).toBe(true);
        expect(opus.items.map(item => item.Id)).toEqual([ 'opus-1' ]);
    });

    it('spreads controlled discovery through a seeded mix instead of appending it at the end', async () => {
        const familiar = Array.from({ length: 6 }, (_, index) => ({
            ...musicItem(`familiar-${index}`, `Familiar ${index}`, `Familiar Track ${index}`, [ 'Synth' ]),
            UserData: {
                IsFavorite: true,
                PlayCount: 4
            }
        }));
        const discovery = Array.from({ length: 4 }, (_, index) => (
            musicItem(`discovery-${index}`, `Discovery ${index}`, `Discovery Track ${index}`, [ 'Synth' ])
        ));

        useMusicHome([ ...familiar, ...discovery ]);
        const result = await buildPtvMusicRecommendations({
            limit: 8,
            seed: { kind: 'genre', label: 'Synth', value: 'Synth' },
            sessionSeed: 'distributed-discovery'
        });

        expect(result.items.slice(0, 4).some(item => !item.UserData?.PlayCount)).toBe(true);
        expect(result.items.slice(4).some(item => item.UserData?.PlayCount)).toBe(true);
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

        expect(result.items).toHaveLength(2);
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
            musicItem(`alternative-${index}`, `Alternative ${index}`, `Alternative Track ${index}`, [ 'Synth' ])
        ));

        useMusicHome([...albumTracks, ...alternatives]);
        const result = await buildPtvMusicRecommendations({
            limit: 8,
            seed: {
                item: {
                    Genres: [ 'Synth' ],
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
        expect(result.items.filter(item => item.AlbumId === 'seed-album').length).toBeLessThanOrEqual(2);
        expect(longestAlbumArtistRun).toBeLessThanOrEqual(2);
    });

    it('keeps hard concentration caps when a small library cannot fill the requested limit', async () => {
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

        expect(result.items).toHaveLength(1);
        expect(new Set(result.items.map(item => item.Id)).size).toBe(1);
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
