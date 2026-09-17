import { describe, expect, it, vi } from 'vitest';

import {
    GENERIC_IDENTIFY_READBACK_DELAYS_MS,
    GENERIC_IDENTIFY_READBACK_TIMEOUT_MS,
    classifyIdentifyAuthorityFailure,
    confirmGenericIdentifyMutation,
    createGenericIdentifyExpectedEffect,
    getGenericIdentifyReadbackState,
    isIdentifyOwnerCurrent,
    pollIdentifyExpectedEffectReadback,
    pollGenericIdentifyReadback
} from './itemIdentifierExpectedEffects';

const BEFORE = {
    BackdropImageTags: [ 'backdrop-old' ],
    Genres: [ 'Drama' ],
    Id: 'item-1',
    ImageTags: { Primary: 'primary-old' },
    Name: 'Old title',
    Overview: 'Old overview',
    ProviderIds: { Tmdb: 'old-id' },
    Type: 'Movie'
};

const MUSIC_ALBUM_BEFORE = {
    AlbumArtist: 'Original Artist',
    AlbumArtists: [ { Id: 'artist-original', Name: 'Original Artist' } ],
    ArtistItems: [ { Id: 'artist-original', Name: 'Original Artist' } ],
    Artists: [ 'Original Artist' ],
    Genres: [ 'Rock' ],
    Id: 'album-1',
    Name: 'Original Album',
    ProviderIds: { MusicBrainzAlbum: 'album-old' },
    Type: 'MusicAlbum'
};

function musicAlbumEffect(
    mutationResult: Record<string, unknown>,
    outboundItem: Record<string, unknown> = {}
) {
    return createGenericIdentifyExpectedEffect({
        beforeItem: MUSIC_ALBUM_BEFORE,
        itemType: 'MusicAlbum',
        mutationResult,
        outboundItem: {
            ...MUSIC_ALBUM_BEFORE,
            ...outboundItem
        }
    });
}

function effect(
    outboundItem: Record<string, unknown>,
    options: Readonly<{
        itemType?: string;
        mutationResult?: Record<string, unknown>;
        replaceAllImages?: boolean;
        replaceBackdrop?: boolean;
        replacePrimary?: boolean;
    }> = {}
) {
    return createGenericIdentifyExpectedEffect({
        beforeItem: BEFORE,
        itemType: options.itemType || 'Movie',
        mutationResult: options.mutationResult,
        outboundItem: {
            ...BEFORE,
            ...outboundItem
        },
        replaceAllImages: options.replaceAllImages,
        replaceBackdrop: options.replaceBackdrop,
        replacePrimary: options.replacePrimary
    });
}

function readback(expectedEffect: ReturnType<typeof effect>, item: Record<string, unknown>) {
    return getGenericIdentifyReadbackState(expectedEffect, item);
}

describe('Identify owner identity', () => {
    it('rejects disconnected and same-ID replacement owners', () => {
        const originalOwner = { Id: 'item-1' };
        const replacementOwner = { Id: 'item-1' };

        expect(isIdentifyOwnerCurrent(originalOwner, originalOwner)).toBe(true);
        expect(isIdentifyOwnerCurrent(originalOwner, originalOwner, false)).toBe(false);
        expect(isIdentifyOwnerCurrent(replacementOwner, originalOwner)).toBe(false);
    });
});

describe('generic Identify expected-effect projection', () => {
    it('A: confirms an immediate metadata-only mutation', () => {
        const expectedEffect = effect({ Name: 'New title' });

        expect(readback(expectedEffect, { ...BEFORE, Name: 'New title' })).toMatchObject({
            artworkSettled: true,
            metadataSettled: true,
            settled: true,
            supported: true
        });
    });

    it('D/E: rejects the pre-mutation state and unrelated changed values', () => {
        const expectedEffect = effect({ Name: 'Expected title' });

        expect(readback(expectedEffect, BEFORE).settled).toBe(false);
        expect(readback(expectedEffect, {
            ...BEFORE,
            Name: 'Unrelated title',
            Overview: 'Another process changed this'
        }).settled).toBe(false);
    });

    it('F: accepts deterministic scalar normalization only', () => {
        const expectedEffect = effect({ Name: '  New   title  ' });

        expect(readback(expectedEffect, { ...BEFORE, Name: 'New title' }).settled).toBe(true);
        expect(readback(expectedEffect, { ...BEFORE, Name: 'Different title' }).settled).toBe(false);
    });

    it('F: canonicalizes numeric years and Jellyfin date representations', () => {
        const expectedEffect = effect({
            PremiereDate: '2026-09-01T00:00:00.0000000Z',
            ProductionYear: 2026
        });

        expect(readback(expectedEffect, {
            ...BEFORE,
            PremiereDate: '2026-09-01T00:00:00Z',
            ProductionYear: '2026'
        }).settled).toBe(true);
        expect(readback(expectedEffect, {
            ...BEFORE,
            PremiereDate: '2026-09-02T00:00:00Z',
            ProductionYear: 2026
        }).settled).toBe(false);
    });

    it('G-I: requires expected provider IDs and ignores unrelated IDs', () => {
        const expectedEffect = effect({
            ProviderIds: {
                ...BEFORE.ProviderIds,
                Tmdb: 'new-id'
            }
        });

        expect(readback(expectedEffect, {
            ...BEFORE,
            ProviderIds: { Imdb: 'tt-extra', tmdb: 'new-id' }
        }).settled).toBe(true);
        expect(readback(expectedEffect, {
            ...BEFORE,
            ProviderIds: { Imdb: 'tt-extra', Tmdb: 'old-id' }
        }).settled).toBe(false);
    });

    it('J/K: canonicalizes list order but rejects a missing expected entry', () => {
        const expectedEffect = effect({ Genres: [ 'Drama', 'Science Fiction' ] });

        expect(readback(expectedEffect, {
            ...BEFORE,
            Genres: [ 'science fiction', 'DRAMA' ]
        }).settled).toBe(true);
        expect(readback(expectedEffect, {
            ...BEFORE,
            Genres: [ 'Drama' ]
        }).settled).toBe(false);
    });

    it('J/K: canonicalizes people roles, studios, and tags without accepting omissions', () => {
        const expectedEffect = effect({
            People: [
                { Name: 'Jane Doe', Role: 'Lead', Type: 'Actor' },
                { Name: 'John Doe', Type: 'Director' }
            ],
            Studios: [ { Name: 'Studio B' }, { Name: 'Studio A' } ],
            Tags: [ 'Featured', 'Archive' ]
        });
        const confirmed = {
            ...BEFORE,
            People: [
                { Id: 'ignored', Name: 'John Doe', Type: 'director' },
                { Name: 'JANE DOE', Role: 'lead', Type: 'actor' }
            ],
            Studios: [ { Name: 'studio a' }, { Name: 'STUDIO B' } ],
            Tags: [ 'archive', 'FEATURED' ]
        };

        expect(readback(expectedEffect, confirmed).settled).toBe(true);
        expect(readback(expectedEffect, {
            ...confirmed,
            People: [ { Name: 'Jane Doe', Role: 'Lead', Type: 'Actor' } ]
        }).settled).toBe(false);
    });

    it('keeps explicit profiles narrow and refuses an unproven effect category', () => {
        expect(effect({ Name: 'New title' }, { itemType: 'Movie' })).toMatchObject({
            profile: 'MOVIE',
            supported: true
        });
        expect(createGenericIdentifyExpectedEffect({
            beforeItem: BEFORE,
            intendedFields: [ 'SeriesName' ],
            itemType: 'Movie',
            outboundItem: { ...BEFORE, SeriesName: 'Unexpected relationship' }
        })).toMatchObject({
            reason: 'UNSUPPORTED_EXPECTED_EFFECT',
            supported: false
        });
    });

    it.each([
        [ 'Movie', 'MOVIE' ],
        [ 'Trailer', 'TRAILER' ],
        [ 'Series', 'SERIES' ],
        [ 'BoxSet', 'BOX_SET' ],
        [ 'Person', 'PERSON' ]
    ])('defines a grounded %s authority profile', (itemType, expectedProfile) => {
        expect(effect({ Name: 'New title' }, { itemType })).toMatchObject({
            profile: expectedProfile,
            supported: true
        });
    });

    it('does not claim authority for an idempotent mutation with no observable transition', () => {
        expect(effect({ Name: BEFORE.Name })).toMatchObject({
            reason: 'NO_OBSERVABLE_EFFECT',
            supported: false
        });
    });

    it('binds authority to the exact item identity and type', () => {
        const expectedEffect = effect({ Name: 'New title' });

        expect(readback(expectedEffect, { ...BEFORE, Id: 'other-item', Name: 'New title' }).missingCategories)
            .toContain('item-identity');
        expect(readback(expectedEffect, { ...BEFORE, Name: 'New title', Type: 'Series' }).settled).toBe(false);
        expect(readback(expectedEffect, { ...BEFORE, Id: 'ITEM-1', Name: 'New title', Type: 'movie' }).settled).toBe(true);
        expect(readback(expectedEffect, { ...BEFORE, Id: '', Name: 'New title' }).settled).toBe(false);
        expect(readback(expectedEffect, { ...BEFORE, Name: 'New title', Type: '' }).settled).toBe(false);
    });

    it('fails closed for unmodeled RemoteSearch effects and ReplaceAllImages', () => {
        expect(effect({ Name: 'New title' }, {
            mutationResult: { IndexNumberEnd: 2, Name: 'New title' }
        })).toMatchObject({ reason: 'UNSUPPORTED_EXPECTED_EFFECT', supported: false });
        expect(effect({ Name: 'New title' }, {
            mutationResult: { AlbumArtist: { Name: 'Private artist' }, Name: 'New title' }
        })).toMatchObject({ reason: 'UNSUPPORTED_EXPECTED_EFFECT', supported: false });
        expect(effect({ Name: 'New title' }, {
            mutationResult: { AlbumArtist: { ProviderIds: { MusicBrainzArtist: 'private-id' } }, Name: 'New title' }
        })).toMatchObject({ reason: 'UNSUPPORTED_EXPECTED_EFFECT', supported: false });
        expect(effect({ Name: 'New title' }, {
            mutationResult: { Artists: [ { Name: 'Private artist' } ], Name: 'New title' }
        })).toMatchObject({ reason: 'UNSUPPORTED_EXPECTED_EFFECT', supported: false });
        expect(effect({ Name: 'New title' }, { replaceAllImages: true }))
            .toMatchObject({ reason: 'UNSUPPORTED_EXPECTED_EFFECT', supported: false });
    });

    it('L: allows unchanged artwork when replacement was not requested', () => {
        const expectedEffect = effect({ Name: 'New title' });

        expect(readback(expectedEffect, {
            ...BEFORE,
            Name: 'New title'
        })).toMatchObject({ artworkSettled: true, settled: true });
    });

    it('M: rejects stale Primary when Primary replacement is requested', () => {
        const expectedEffect = effect({ Name: 'New title' }, { replacePrimary: true });

        expect(readback(expectedEffect, { ...BEFORE, Name: 'New title' }).settled).toBe(false);
        expect(readback(expectedEffect, {
            ...BEFORE,
            ImageTags: { Primary: 'primary-new' },
            Name: 'New title'
        }).settled).toBe(true);
    });

    it('N: rejects stale Backdrop tags when Backdrop replacement is requested', () => {
        const expectedEffect = effect({ Name: 'New title' }, { replaceBackdrop: true });

        expect(readback(expectedEffect, { ...BEFORE, Name: 'New title' }).settled).toBe(false);
        expect(readback(expectedEffect, {
            ...BEFORE,
            BackdropImageTags: [ 'backdrop-new' ],
            Name: 'New title'
        }).settled).toBe(true);
    });

    it('O/P: requires every requested metadata and artwork effect', () => {
        const expectedEffect = effect({ Name: 'New title' }, { replacePrimary: true });

        expect(readback(expectedEffect, { ...BEFORE, Name: 'New title' }).settled).toBe(false);
        expect(readback(expectedEffect, {
            ...BEFORE,
            ImageTags: { Primary: 'primary-new' }
        }).settled).toBe(false);
    });
});

describe('Music Identify relationship authority', () => {
    const relationshipMutation = {
        AlbumArtist: {
            Id: 'artist-primary',
            Name: 'Primary Artist',
            ProviderIds: { MusicBrainzArtist: 'mb-primary' }
        },
        Artists: [
            {
                Id: 'artist-primary',
                Name: 'Primary Artist',
                ProviderIds: { MusicBrainzArtist: 'mb-primary' }
            },
            {
                Id: 'artist-guest',
                Name: 'Guest Artist',
                ProviderIds: { MusicBrainzArtist: 'mb-guest' }
            }
        ],
        Name: 'Confirmed Album',
        ProviderIds: { MusicBrainzAlbum: 'album-new' }
    };
    const confirmedAlbum = {
        ...MUSIC_ALBUM_BEFORE,
        AlbumArtist: 'Primary Artist',
        AlbumArtists: [ { Id: 'artist-primary', Name: 'Primary Artist' } ],
        ArtistItems: [
            { Id: 'artist-primary', Name: 'Primary Artist' },
            { Id: 'artist-guest', Name: 'Guest Artist' }
        ],
        Artists: [ 'Primary Artist', 'Guest Artist' ],
        Name: 'Confirmed Album',
        ProviderIds: { MusicBrainzAlbum: 'album-new', Tidal: 'unrelated-extra' }
    };

    it('A: confirms exact MusicAlbum metadata and relationship effects', () => {
        const expectedEffect = musicAlbumEffect(relationshipMutation, {
            Name: 'Confirmed Album',
            ProviderIds: { MusicBrainzAlbum: 'album-new' }
        });

        expect(readback(expectedEffect, confirmedAlbum)).toMatchObject({
            artworkSettled: true,
            metadataSettled: true,
            settled: true,
            supported: true
        });
        expect(expectedEffect.effects.map(entry => entry.category)).toEqual(expect.arrayContaining([
            'album-artists',
            'artist-items',
            'name',
            'provider-ids'
        ]));
    });

    it('B-D: rejects stale album metadata, AlbumArtist, or requested Artists', () => {
        const expectedEffect = musicAlbumEffect(relationshipMutation, {
            Name: 'Confirmed Album',
            ProviderIds: { MusicBrainzAlbum: 'album-new' }
        });

        expect(readback(expectedEffect, MUSIC_ALBUM_BEFORE).settled).toBe(false);
        expect(readback(expectedEffect, {
            ...confirmedAlbum,
            AlbumArtist: MUSIC_ALBUM_BEFORE.AlbumArtist,
            AlbumArtists: MUSIC_ALBUM_BEFORE.AlbumArtists
        }).missingCategories).toContain('album-artists');
        expect(readback(expectedEffect, {
            ...confirmedAlbum,
            ArtistItems: [ { Id: 'artist-primary', Name: 'Primary Artist' } ],
            Artists: [ 'Primary Artist' ]
        }).missingCategories).toContain('artist-items');
    });

    it('E/F: ignores relationship order and safely collapses exact duplicates', () => {
        const expectedEffect = musicAlbumEffect({
            ...relationshipMutation,
            Artists: [
                relationshipMutation.Artists[0],
                relationshipMutation.Artists[1],
                relationshipMutation.Artists[0]
            ]
        }, {
            Name: 'Confirmed Album',
            ProviderIds: { MusicBrainzAlbum: 'album-new' }
        });

        expect(readback(expectedEffect, {
            ...confirmedAlbum,
            ArtistItems: [
                confirmedAlbum.ArtistItems[1],
                confirmedAlbum.ArtistItems[0],
                confirmedAlbum.ArtistItems[1]
            ]
        }).settled).toBe(true);
    });

    it('G: rejects the same relationship name when stable IDs differ', () => {
        const expectedEffect = musicAlbumEffect(relationshipMutation, {
            Name: 'Confirmed Album',
            ProviderIds: { MusicBrainzAlbum: 'album-new' }
        });

        expect(readback(expectedEffect, {
            ...confirmedAlbum,
            AlbumArtists: [ { Id: 'artist-impostor', Name: 'Primary Artist' } ]
        }).settled).toBe(false);
    });

    it('accepts distinct same-name relationships when every stable ID matches exactly', () => {
        const expectedEffect = musicAlbumEffect({
            Artists: [
                { Id: 'artist-same-a', Name: 'Same Artist' },
                { Id: 'artist-same-b', Name: 'Same Artist' }
            ],
            Name: 'Confirmed Album'
        }, { Name: 'Confirmed Album' });

        expect(readback(expectedEffect, {
            ...MUSIC_ALBUM_BEFORE,
            ArtistItems: [
                { Id: 'artist-same-b', Name: 'Same Artist' },
                { Id: 'artist-same-a', Name: 'Same Artist' }
            ],
            Name: 'Confirmed Album'
        }).settled).toBe(true);
    });

    it('H: rejects an unrelated added relationship instead of treating it as proof', () => {
        const expectedEffect = musicAlbumEffect(relationshipMutation, {
            Name: 'Confirmed Album',
            ProviderIds: { MusicBrainzAlbum: 'album-new' }
        });

        expect(readback(expectedEffect, {
            ...confirmedAlbum,
            ArtistItems: [
                confirmedAlbum.ArtistItems[0],
                { Id: 'artist-unrelated', Name: 'Unrelated Artist' }
            ]
        }).settled).toBe(false);
    });

    it('accepts unrelated authoritative track artists only after every requested relationship matches', () => {
        const expectedEffect = musicAlbumEffect(relationshipMutation, {
            Name: 'Confirmed Album',
            ProviderIds: { MusicBrainzAlbum: 'album-new' }
        });

        expect(readback(expectedEffect, {
            ...confirmedAlbum,
            ArtistItems: [
                ...confirmedAlbum.ArtistItems,
                { Id: 'artist-unrelated', Name: 'Unrelated Artist' }
            ]
        }).settled).toBe(true);
    });

    it('I/J: accepts unrelated provider IDs but rejects a missing required provider ID', () => {
        const expectedEffect = musicAlbumEffect(relationshipMutation, {
            Name: 'Confirmed Album',
            ProviderIds: { MusicBrainzAlbum: 'album-new' }
        });

        expect(readback(expectedEffect, confirmedAlbum).settled).toBe(true);
        expect(readback(expectedEffect, {
            ...confirmedAlbum,
            ProviderIds: { Tidal: 'unrelated-extra' }
        }).settled).toBe(false);
    });

    it('uses exact unique-name fallback when Jellyfin omits relationship identity metadata', () => {
        const expectedEffect = musicAlbumEffect({
            AlbumArtist: { Name: 'Primary Artist' },
            Artists: [ { Name: 'Primary Artist' }, { Name: 'Guest Artist' } ],
            Name: 'Confirmed Album'
        }, { Name: 'Confirmed Album' });

        expect(readback(expectedEffect, {
            ...confirmedAlbum,
            AlbumArtists: [ { Name: 'Primary Artist' } ],
            ArtistItems: [ { Name: 'Guest Artist' }, { Name: 'Primary Artist' } ]
        }).settled).toBe(true);
    });

    it('uses the authoritative MusicBrainzAlbumArtist bridge for a new primary artist', () => {
        const expectedEffect = musicAlbumEffect({
            AlbumArtist: {
                Name: 'Primary Artist',
                ProviderIds: { MusicBrainzArtist: 'mb-primary' }
            },
            Name: 'Confirmed Album'
        }, { Name: 'Confirmed Album' });
        const bridged = {
            ...MUSIC_ALBUM_BEFORE,
            AlbumArtist: 'Primary Artist',
            AlbumArtists: [ { Id: 'artist-server-id', Name: 'Primary Artist' } ],
            Name: 'Confirmed Album',
            ProviderIds: { MusicBrainzAlbumArtist: 'mb-primary' }
        };

        expect(readback(expectedEffect, bridged).settled).toBe(true);
        expect(readback(expectedEffect, {
            ...bridged,
            ProviderIds: { MusicBrainzAlbumArtist: 'mb-other' }
        }).settled).toBe(false);
    });

    it('does not bridge a provider-backed RemoteSearchResult relationship to a stale same-name server ID', () => {
        const beforeAlbum = {
            ...MUSIC_ALBUM_BEFORE,
            ProviderIds: {
                ...MUSIC_ALBUM_BEFORE.ProviderIds,
                MusicBrainzAlbumArtist: 'mb-original'
            }
        };
        const expectedEffect = createGenericIdentifyExpectedEffect({
            beforeItem: beforeAlbum,
            itemType: 'MusicAlbum',
            mutationResult: {
                AlbumArtist: {
                    Name: 'Original Artist',
                    ProviderIds: { MusicBrainzArtist: 'mb-requested' }
                },
                Name: 'Confirmed Album'
            },
            outboundItem: {
                ...beforeAlbum,
                Name: 'Confirmed Album'
            }
        });
        const relationshipEffect = expectedEffect.effects.find(entry => entry.kind === 'relationship-set');

        expect(expectedEffect.supported).toBe(true);
        expect(relationshipEffect).toMatchObject({
            field: 'AlbumArtists',
            values: [ {
                id: '',
                name: 'original artist',
                providerIds: { musicbrainzartist: 'mb-requested' }
            } ]
        });
        expect(readback(expectedEffect, {
            ...beforeAlbum,
            Name: 'Confirmed Album'
        })).toMatchObject({
            missingCategories: [ 'album-artists' ],
            settled: false
        });
    });

    it('does not use a name-only expectation to authorize a stable NameGuidPair', () => {
        const expectedEffect = musicAlbumEffect({
            AlbumArtist: { Name: 'Requested Artist' },
            Name: 'Confirmed Album'
        }, { Name: 'Confirmed Album' });

        expect(readback(expectedEffect, {
            ...MUSIC_ALBUM_BEFORE,
            AlbumArtist: 'Requested Artist',
            AlbumArtists: [ { Id: 'artist-server-id', Name: 'Requested Artist' } ],
            Name: 'Confirmed Album'
        })).toMatchObject({
            missingCategories: [ 'album-artists' ],
            settled: false
        });
    });

    it('does not fall back to stale display strings when authoritative relationship arrays are explicitly empty', () => {
        const expectedEffect = musicAlbumEffect({
            AlbumArtist: { Name: 'Primary Artist' },
            Artists: [ { Name: 'Primary Artist' }, { Name: 'Guest Artist' } ],
            Name: 'Confirmed Album'
        }, { Name: 'Confirmed Album' });

        expect(readback(expectedEffect, {
            ...MUSIC_ALBUM_BEFORE,
            AlbumArtist: 'Primary Artist',
            AlbumArtists: [],
            ArtistItems: [],
            Artists: [ 'Primary Artist', 'Guest Artist' ],
            Name: 'Confirmed Album'
        })).toMatchObject({
            missingCategories: [ 'album-artists', 'artist-items' ],
            settled: false
        });
    });

    it('fails closed for a new multi-artist provider relationship without a trusted ID bridge', () => {
        expect(musicAlbumEffect({
            Artists: [
                { Name: 'Primary Artist', ProviderIds: { MusicBrainzArtist: 'mb-primary' } },
                { Name: 'Guest Artist', ProviderIds: { MusicBrainzArtist: 'mb-guest' } }
            ],
            Name: 'Confirmed Album'
        }, { Name: 'Confirmed Album' })).toMatchObject({
            reason: 'UNSUPPORTED_EXPECTED_EFFECT',
            supported: false
        });
    });

    it('fails closed when a remote Artists array mixes valid and empty or malformed entries', () => {
        const expectedEffect = musicAlbumEffect({
            Artists: [
                { Name: 'Valid Artist' },
                {},
                null
            ],
            Name: 'Confirmed Album'
        }, { Name: 'Confirmed Album' });

        expect(expectedEffect).toMatchObject({
            reason: 'UNSUPPORTED_EXPECTED_EFFECT',
            supported: false
        });
    });

    it('fails closed when relationship names are ambiguous without stronger identities', () => {
        expect(musicAlbumEffect({
            Artists: [
                { Name: 'Same Artist', ProviderIds: { MusicBrainzArtist: 'artist-a' } },
                { Name: 'Same Artist', ProviderIds: { MusicBrainzArtist: 'artist-b' } }
            ],
            Name: 'Confirmed Album'
        }, { Name: 'Confirmed Album' })).toMatchObject({
            reason: 'UNSUPPORTED_EXPECTED_EFFECT',
            supported: false
        });
    });

    it('supports MusicArtist metadata authority without inventing album relationships', () => {
        const beforeArtist = {
            Id: 'artist-1',
            Name: 'Old Artist',
            ProviderIds: { MusicBrainzArtist: 'artist-old' },
            Type: 'MusicArtist'
        };
        const expectedEffect = createGenericIdentifyExpectedEffect({
            beforeItem: beforeArtist,
            itemType: 'MusicArtist',
            mutationResult: {
                Name: 'Confirmed Artist',
                ProviderIds: { MusicBrainzArtist: 'artist-new' }
            },
            outboundItem: {
                ...beforeArtist,
                Name: 'Confirmed Artist',
                ProviderIds: { MusicBrainzArtist: 'artist-new' }
            }
        });

        expect(readback(expectedEffect, {
            ...beforeArtist,
            Name: 'Confirmed Artist',
            ProviderIds: { MusicBrainzArtist: 'artist-new' }
        })).toMatchObject({ settled: true, supported: true });
        expect(expectedEffect.profile).toBe('MUSIC_ARTIST');
    });

    it('fails closed for MusicArtist relationship payloads and unproven Music fields', () => {
        const beforeArtist = { Id: 'artist-1', Name: 'Old Artist', Type: 'MusicArtist' };

        expect(createGenericIdentifyExpectedEffect({
            beforeItem: beforeArtist,
            itemType: 'MusicArtist',
            mutationResult: { Artists: [ { Id: 'artist-2', Name: 'Other' } ], Name: 'New Artist' },
            outboundItem: { ...beforeArtist, Name: 'New Artist' }
        })).toMatchObject({ reason: 'UNSUPPORTED_EXPECTED_EFFECT', supported: false });
        expect(createGenericIdentifyExpectedEffect({
            beforeItem: beforeArtist,
            itemType: 'MusicArtist',
            mutationResult: { Genres: [ 'Unproven' ], Name: 'New Artist' },
            outboundItem: { ...beforeArtist, Genres: [ 'Unproven' ], Name: 'New Artist' }
        })).toMatchObject({ reason: 'UNSUPPORTED_EXPECTED_EFFECT', supported: false });
    });

    it('fails closed for malformed or direct plural Music relationship mutations', () => {
        expect(musicAlbumEffect({ AlbumArtist: 'Malformed Artist', Name: 'New Album' }, { Name: 'New Album' }))
            .toMatchObject({ reason: 'UNSUPPORTED_EXPECTED_EFFECT', supported: false });
        expect(musicAlbumEffect({ Artists: [ 'Malformed Artist' ], Name: 'New Album' }, { Name: 'New Album' }))
            .toMatchObject({ reason: 'UNSUPPORTED_EXPECTED_EFFECT', supported: false });
        expect(musicAlbumEffect({
            AlbumArtists: [ { Id: 'artist-direct', Name: 'Direct Artist' } ],
            Name: 'New Album'
        }, { Name: 'New Album' })).toMatchObject({ reason: 'UNSUPPORTED_EXPECTED_EFFECT', supported: false });
    });

    it('Y: keeps MusicVideo unsupported', () => {
        expect(effect({ Name: 'New title' }, { itemType: 'MusicVideo' })).toMatchObject({
            reason: 'UNSUPPORTED_ITEM_TYPE',
            supported: false
        });
    });

    it('K-M: reuses the bounded six-read contract for stale and failed MusicAlbum reads', async () => {
        const expectedEffect = musicAlbumEffect(relationshipMutation, {
            Name: 'Confirmed Album',
            ProviderIds: { MusicBrainzAlbum: 'album-new' }
        });
        const loadItem = vi.fn()
            .mockResolvedValueOnce(MUSIC_ALBUM_BEFORE)
            .mockRejectedValueOnce(new TypeError('network'))
            .mockResolvedValueOnce(confirmedAlbum);
        const result = await confirmGenericIdentifyMutation({
            expectedEffect,
            loadItem,
            waitFor: vi.fn().mockResolvedValue(undefined)
        });

        expect(result).toMatchObject({
            attempts: 3,
            fallbackWrites: 0,
            item: confirmedAlbum,
            status: 'confirmed'
        });
        expect(loadItem).toHaveBeenCalledTimes(3);
    });

    it('N: stops a wrong MusicAlbum identity without fallback writes or additional reads', async () => {
        const expectedEffect = musicAlbumEffect(relationshipMutation, {
            Name: 'Confirmed Album',
            ProviderIds: { MusicBrainzAlbum: 'album-new' }
        });
        const buildFallbackProjection = vi.fn(() => expectedEffect);
        const writeFallback = vi.fn();
        const loadItem = vi.fn().mockResolvedValue({
            ...confirmedAlbum,
            Id: 'album-other'
        });
        const result = await confirmGenericIdentifyMutation({
            buildFallbackProjection,
            expectedEffect,
            loadItem,
            waitFor: vi.fn().mockResolvedValue(undefined),
            writeFallback
        });

        expect(result).toMatchObject({
            attempts: 1,
            fallbackWrites: 0,
            item: null,
            status: 'unconfirmed'
        });
        expect(loadItem).toHaveBeenCalledOnce();
        expect(buildFallbackProjection).not.toHaveBeenCalled();
        expect(writeFallback).not.toHaveBeenCalled();
    });

    it('stops a wrong relationship readback after one read when fallback callbacks are absent', async () => {
        const expectedEffect = musicAlbumEffect(relationshipMutation, {
            Name: 'Confirmed Album',
            ProviderIds: { MusicBrainzAlbum: 'album-new' }
        });
        const loadItem = vi.fn().mockResolvedValue({
            ...confirmedAlbum,
            Id: 'album-other'
        });
        const result = await confirmGenericIdentifyMutation({
            expectedEffect,
            loadItem,
            waitFor: vi.fn().mockResolvedValue(undefined)
        });

        expect(result).toMatchObject({
            attempts: 1,
            fallbackWrites: 0,
            item: null,
            status: 'unconfirmed'
        });
        expect(loadItem).toHaveBeenCalledOnce();
    });

    it('bounds stale MusicArtist state before adopting a later exact readback', async () => {
        const beforeArtist = {
            Id: 'artist-1',
            Name: 'Old Artist',
            ProviderIds: { MusicBrainzArtist: 'artist-old' },
            Type: 'MusicArtist'
        };
        const confirmedArtist = {
            ...beforeArtist,
            Name: 'Confirmed Artist',
            ProviderIds: { MusicBrainzArtist: 'artist-new' }
        };
        const expectedEffect = createGenericIdentifyExpectedEffect({
            beforeItem: beforeArtist,
            itemType: 'MusicArtist',
            mutationResult: {
                Name: 'Confirmed Artist',
                ProviderIds: { MusicBrainzArtist: 'artist-new' }
            },
            outboundItem: confirmedArtist
        });
        const loadItem = vi.fn()
            .mockResolvedValueOnce(beforeArtist)
            .mockResolvedValueOnce(confirmedArtist);
        const result = await confirmGenericIdentifyMutation({
            expectedEffect,
            loadItem,
            waitFor: vi.fn().mockResolvedValue(undefined)
        });

        expect(result).toMatchObject({
            attempts: 2,
            fallbackWrites: 0,
            item: confirmedArtist,
            status: 'confirmed'
        });
        expect(loadItem).toHaveBeenCalledTimes(2);
    });

    it('L/R: exhausts six stale MusicAlbum reads and cancels before any read', async () => {
        const expectedEffect = musicAlbumEffect(relationshipMutation, {
            Name: 'Confirmed Album',
            ProviderIds: { MusicBrainzAlbum: 'album-new' }
        });
        const staleLoad = vi.fn().mockResolvedValue(MUSIC_ALBUM_BEFORE);
        const staleResult = await confirmGenericIdentifyMutation({
            expectedEffect,
            loadItem: staleLoad,
            waitFor: vi.fn().mockResolvedValue(undefined)
        });
        const cancelledLoad = vi.fn();
        const cancelledResult = await confirmGenericIdentifyMutation({
            expectedEffect,
            isCurrent: () => false,
            loadItem: cancelledLoad,
            waitFor: vi.fn().mockResolvedValue(undefined)
        });

        expect(staleResult).toMatchObject({ attempts: 6, fallbackWrites: 0, item: null, status: 'unconfirmed' });
        expect(staleLoad).toHaveBeenCalledTimes(6);
        expect(cancelledResult).toMatchObject({ attempts: 0, fallbackWrites: 0, item: null, status: 'retired' });
        expect(cancelledLoad).not.toHaveBeenCalled();
    });
});

describe('generic Identify bounded authoritative readback', () => {
    it('uses the accepted six-read schedule and 20-second deadline', () => {
        expect(GENERIC_IDENTIFY_READBACK_DELAYS_MS).toEqual([ 0, 300, 750, 1500, 3000, 5000 ]);
        expect(GENERIC_IDENTIFY_READBACK_TIMEOUT_MS).toBe(20_000);
    });

    it('B: rejects old state, then confirms the exact expected state', async () => {
        const expectedEffect = effect({ Name: 'New title' });
        const loadItem = vi.fn()
            .mockResolvedValueOnce(BEFORE)
            .mockResolvedValueOnce({ ...BEFORE, Name: 'New title' });
        const waitFor = vi.fn().mockResolvedValue(undefined);

        const result = await pollGenericIdentifyReadback({ expectedEffect, loadItem, waitFor });

        expect(result).toMatchObject({ attempts: 2, status: 'confirmed' });
        expect(result.item).toMatchObject({ Name: 'New title' });
        expect(loadItem).toHaveBeenCalledTimes(2);
        expect(waitFor).toHaveBeenCalledTimes(1);
        expect(waitFor).toHaveBeenCalledWith(300);
    });

    it('C: exhausts six stale reads without returning an authoritative item', async () => {
        const loadItem = vi.fn().mockResolvedValue(BEFORE);

        const result = await pollGenericIdentifyReadback({
            expectedEffect: effect({ Name: 'New title' }),
            loadItem,
            waitFor: vi.fn().mockResolvedValue(undefined)
        });

        expect(result).toMatchObject({ attempts: 6, item: null, status: 'unconfirmed' });
        expect(loadItem).toHaveBeenCalledTimes(6);
    });

    it('stops generic polling after one wrong-identity readback', async () => {
        const loadItem = vi.fn().mockResolvedValue({
            ...BEFORE,
            Id: 'other-item',
            Name: 'New title'
        });
        const result = await pollGenericIdentifyReadback({
            expectedEffect: effect({ Name: 'New title' }),
            loadItem,
            waitFor: vi.fn().mockResolvedValue(undefined)
        });

        expect(result).toMatchObject({
            attempts: 1,
            item: null,
            status: 'unconfirmed'
        });
        expect(loadItem).toHaveBeenCalledOnce();
    });

    it('Q: retries after a read failure and accepts a later exact confirmation', async () => {
        const loadItem = vi.fn()
            .mockRejectedValueOnce(new Error('network'))
            .mockResolvedValueOnce({ ...BEFORE, Name: 'New title' });

        const result = await pollGenericIdentifyReadback({
            expectedEffect: effect({ Name: 'New title' }),
            loadItem,
            waitFor: vi.fn().mockResolvedValue(undefined)
        });

        expect(result).toMatchObject({ attempts: 2, status: 'confirmed' });
        expect(loadItem).toHaveBeenCalledTimes(2);
    });

    it('R: bounds mixed failures/unconfirmed reads and retains safe state', async () => {
        const loadItem = vi.fn()
            .mockRejectedValueOnce(new Error('network-1'))
            .mockResolvedValueOnce(BEFORE)
            .mockRejectedValueOnce(new Error('network-2'))
            .mockResolvedValue(BEFORE);

        const result = await pollGenericIdentifyReadback({
            expectedEffect: effect({ Name: 'New title' }),
            loadItem,
            waitFor: vi.fn().mockResolvedValue(undefined)
        });

        expect(result).toMatchObject({ attempts: 6, item: null, status: 'unconfirmed' });
        expect(loadItem).toHaveBeenCalledTimes(6);
    });

    it('S: retires a late read from an older operation before it can publish', async () => {
        let current = true;
        let resolveRead: ((item: typeof BEFORE) => void) | undefined;
        const loadItem = vi.fn(() => new Promise<typeof BEFORE>(resolve => {
            resolveRead = resolve;
        }));
        const readbackPromise = pollGenericIdentifyReadback({
            expectedEffect: effect({ Name: 'New title' }),
            isCurrent: () => current,
            loadItem
        });

        await vi.waitFor(() => expect(loadItem).toHaveBeenCalledOnce());
        current = false;
        resolveRead?.({ ...BEFORE, Name: 'New title' });

        await expect(readbackPromise).resolves.toMatchObject({
            attempts: 1,
            item: null,
            status: 'retired'
        });
    });

    it('enforces the overall deadline independently of the configured read count', async () => {
        let now = 0;
        const loadItem = vi.fn(async () => {
            now = GENERIC_IDENTIFY_READBACK_TIMEOUT_MS;
            return BEFORE;
        });

        const result = await pollIdentifyExpectedEffectReadback({
            delays: GENERIC_IDENTIFY_READBACK_DELAYS_MS,
            isSettled: () => false,
            loadItem,
            now: () => now,
            timeoutMs: GENERIC_IDENTIFY_READBACK_TIMEOUT_MS,
            waitFor: vi.fn().mockResolvedValue(undefined)
        });

        expect(result).toMatchObject({ attempts: 1, item: null, status: 'unconfirmed' });
        expect(loadItem).toHaveBeenCalledOnce();
    });

    it.each([ 'Audio', 'Playlist', 'Episode', 'Season', 'Photo', 'MusicVideo', 'UnknownType' ])(
        'W: keeps unsupported %s unconfirmed and performs zero reads', async itemType => {
            const expectedEffect = effect({ Name: 'New title' }, { itemType });
            const loadItem = vi.fn();

            expect(expectedEffect).toMatchObject({
                reason: 'UNSUPPORTED_ITEM_TYPE',
                supported: false
            });

            const result = await pollGenericIdentifyReadback({ expectedEffect, loadItem });

            expect(result).toMatchObject({ attempts: 0, item: null, status: 'unsupported' });
            expect(loadItem).not.toHaveBeenCalled();
        }
    );
});

describe('generic Identify mutation orchestration', () => {
    const confirmedItem = { ...BEFORE, Name: 'New title' };

    it('confirms immediately with one read and no fallback write', async () => {
        const writeFallback = vi.fn();
        const result = await confirmGenericIdentifyMutation({
            buildFallbackProjection: () => effect({ Name: 'New title' }),
            expectedEffect: effect({ Name: 'New title' }),
            loadItem: vi.fn().mockResolvedValue(confirmedItem),
            waitFor: vi.fn().mockResolvedValue(undefined),
            writeFallback
        });

        expect(result).toMatchObject({ attempts: 1, fallbackWrites: 0, status: 'confirmed' });
        expect(writeFallback).not.toHaveBeenCalled();
    });

    it('performs one generation-safe fallback write, then confirms', async () => {
        const loadItem = vi.fn()
            .mockResolvedValueOnce(BEFORE)
            .mockResolvedValueOnce(confirmedItem);
        const writeFallback = vi.fn().mockResolvedValue(undefined);
        const result = await confirmGenericIdentifyMutation({
            buildFallbackProjection: item => createGenericIdentifyExpectedEffect({
                beforeItem: item,
                itemType: 'Movie',
                outboundItem: confirmedItem
            }),
            expectedEffect: effect({ Name: 'New title' }),
            loadItem,
            waitFor: vi.fn().mockResolvedValue(undefined),
            writeFallback
        });

        expect(result).toMatchObject({ attempts: 2, fallbackWrites: 1, status: 'confirmed' });
        expect(loadItem).toHaveBeenCalledTimes(2);
        expect(writeFallback).toHaveBeenCalledOnce();
    });

    it('never exceeds six reads or one fallback write when state remains stale', async () => {
        const loadItem = vi.fn().mockResolvedValue(BEFORE);
        const writeFallback = vi.fn().mockResolvedValue(undefined);
        const result = await confirmGenericIdentifyMutation({
            buildFallbackProjection: item => createGenericIdentifyExpectedEffect({
                beforeItem: item,
                itemType: 'Movie',
                outboundItem: confirmedItem
            }),
            expectedEffect: effect({ Name: 'New title' }),
            loadItem,
            waitFor: vi.fn().mockResolvedValue(undefined),
            writeFallback
        });

        expect(result).toMatchObject({ attempts: 6, fallbackWrites: 1, item: null, status: 'unconfirmed' });
        expect(loadItem).toHaveBeenCalledTimes(6);
        expect(writeFallback).toHaveBeenCalledOnce();
    });

    it('performs zero reads and writes for an unsupported profile', async () => {
        const loadItem = vi.fn();
        const writeFallback = vi.fn();
        const result = await confirmGenericIdentifyMutation({
            expectedEffect: effect({ Name: 'New title' }, { itemType: 'Audio' }),
            loadItem,
            writeFallback
        });

        expect(result).toMatchObject({ attempts: 0, fallbackWrites: 0, item: null, status: 'unsupported' });
        expect(loadItem).not.toHaveBeenCalled();
        expect(writeFallback).not.toHaveBeenCalled();
    });

    it('U: cancellation before confirmation produces zero reads and writes', async () => {
        const loadItem = vi.fn();
        const writeFallback = vi.fn();
        const result = await confirmGenericIdentifyMutation({
            expectedEffect: effect({ Name: 'New title' }),
            isCurrent: () => false,
            loadItem,
            writeFallback
        });

        expect(result).toMatchObject({ attempts: 0, fallbackWrites: 0, item: null, status: 'retired' });
        expect(loadItem).not.toHaveBeenCalled();
        expect(writeFallback).not.toHaveBeenCalled();
    });

    it('S: a late older operation cannot supersede a newer confirmation', async () => {
        let generation = 1;
        let resolveOlder: ((item: typeof confirmedItem) => void) | undefined;
        const olderLoad = vi.fn(() => new Promise<typeof confirmedItem>(resolve => {
            resolveOlder = resolve;
        }));
        const olderPromise = confirmGenericIdentifyMutation({
            expectedEffect: effect({ Name: 'New title' }),
            isCurrent: () => generation === 1,
            loadItem: olderLoad
        });

        await vi.waitFor(() => expect(olderLoad).toHaveBeenCalledOnce());
        generation = 2;

        const newerResult = await confirmGenericIdentifyMutation({
            expectedEffect: effect({ Name: 'New title' }),
            isCurrent: () => generation === 2,
            loadItem: vi.fn().mockResolvedValue(confirmedItem)
        });

        resolveOlder?.(confirmedItem);

        expect(newerResult).toMatchObject({ item: confirmedItem, status: 'confirmed' });
        await expect(olderPromise).resolves.toMatchObject({ item: null, status: 'retired' });
    });

    it('retires during a fallback write without adopting it or reading again', async () => {
        let current = true;
        let resolveWrite: (() => void) | undefined;
        const loadItem = vi.fn().mockResolvedValue(BEFORE);
        const writeFallback = vi.fn(() => new Promise<void>(resolve => {
            resolveWrite = resolve;
        }));
        const resultPromise = confirmGenericIdentifyMutation({
            buildFallbackProjection: item => createGenericIdentifyExpectedEffect({
                beforeItem: item,
                itemType: 'Movie',
                outboundItem: confirmedItem
            }),
            expectedEffect: effect({ Name: 'New title' }),
            isCurrent: () => current,
            loadItem,
            waitFor: vi.fn().mockResolvedValue(undefined),
            writeFallback
        });

        await vi.waitFor(() => expect(writeFallback).toHaveBeenCalledOnce());
        current = false;
        resolveWrite?.();

        await expect(resultPromise).resolves.toMatchObject({
            attempts: 1,
            fallbackWrites: 1,
            item: null,
            status: 'retired'
        });
        expect(loadItem).toHaveBeenCalledOnce();
    });

    it('does not write when the targeted read returns a different item identity', async () => {
        const writeFallback = vi.fn();
        const result = await confirmGenericIdentifyMutation({
            buildFallbackProjection: () => effect({ Name: 'New title' }),
            expectedEffect: effect({ Name: 'New title' }),
            loadItem: vi.fn().mockResolvedValue({ ...BEFORE, Id: 'other-item' }),
            waitFor: vi.fn().mockResolvedValue(undefined),
            writeFallback
        });

        expect(result).toMatchObject({ attempts: 1, fallbackWrites: 0, item: null, status: 'unconfirmed' });
        expect(writeFallback).not.toHaveBeenCalled();
    });
});

describe('Identify diagnostic privacy', () => {
    it.each([
        [ { name: 'PtvReadingIdentifyTimeoutError' }, 'timeout' ],
        [ { name: 'AbortError' }, 'cancelled' ],
        [ { status: 401 }, 'authentication' ],
        [ { status: 403 }, 'forbidden' ],
        [ { status: 404 }, 'not-found' ],
        [ { status: 409 }, 'conflict' ],
        [ { status: 429 }, 'rate-limited' ],
        [ { status: 422 }, 'http-client' ],
        [ { status: 503 }, 'http-server' ],
        [ { name: 'TypeError' }, 'network' ]
    ])('maps failures to a closed enum', (error, expected) => {
        expect(classifyIdentifyAuthorityFailure(error)).toBe(expected);
    });

    it('never returns a private error name, message, URL, or provider value', () => {
        const privateError = {
            message: 'Private Title https://private.example/?api_key=secret',
            name: 'Private_Filename_provider-id-secret'
        };
        const result = classifyIdentifyAuthorityFailure(privateError);

        expect(result).toBe('unknown');
        expect(JSON.stringify(result)).not.toMatch(/Private|secret|provider|https/i);
    });

    it('maps a falsy promise rejection to the fixed unknown category', () => {
        expect(classifyIdentifyAuthorityFailure(null)).toBe('unknown');
        expect(classifyIdentifyAuthorityFailure(undefined)).toBe('unknown');
    });
});
