import { describe, expect, it } from 'vitest';

import {
    canPublishPtvMusicIdentifyResult,
    PtvMusicIdentifyAuthorityOverlay,
    reconcilePtvMusicAlbumRelationshipsFromTracks,
    reconcilePtvMusicIdentifyHomeData,
    reconcilePtvMusicIdentifyItem,
    reconcilePtvMusicIdentifyItems,
    reconcilePtvMusicIdentifyPresentationItems,
    reconcilePtvMusicIdentifyQueueItem,
    type PtvMusicIdentifyOwnerState
} from './musicIdentifyAdoption';
import { projectPtvMusicLibraryIndexItemForStorage } from './musicHomeSnapshot';
import type {
    PtvMusicHomeData,
    PtvMusicItem
} from './musicTypes';

const OLD_ALBUM: PtvMusicItem = {
    Id: 'album-1',
    Name: 'Old Album',
    Type: 'MusicAlbum'
};
const CONFIRMED_ALBUM: PtvMusicItem = {
    AlbumArtists: [ { Id: 'artist-1', Name: 'Confirmed Artist' } ],
    Id: 'album-1',
    ImageTags: { Primary: 'confirmed-image-tag' },
    Name: 'Confirmed Album',
    Type: 'MusicAlbum'
};
const OLD_ARTIST: PtvMusicItem = {
    Id: 'artist-1',
    Name: 'Old Artist',
    Type: 'MusicArtist'
};
const CONFIRMED_ARTIST: PtvMusicItem = {
    Id: 'artist-1',
    ImageTags: { Primary: 'confirmed-artist-tag' },
    Name: 'Confirmed Artist',
    Type: 'MusicArtist'
};

function homeData(items: PtvMusicItem[]): PtvMusicHomeData {
    return {
        generatedAt: 1,
        library: { id: 'music', name: 'Music' },
        sections: [ { id: 'albums', items, kind: 'album', title: 'Albums' } ],
        stats: { albumCount: 1, artistCount: 1, trackCount: 0 }
    };
}

function ownerState(owner: PtvMusicItem = OLD_ALBUM): PtvMusicIdentifyOwnerState {
    return {
        albumDetailItem: owner,
        albums: [ owner ],
        artistDetailAlbums: [],
        artistDetailArtist: null,
        artists: [],
        homeData: homeData([ owner ]),
        metadataLookupItem: null,
        searchResults: []
    };
}

function canPublish(overrides: Partial<Parameters<typeof canPublishPtvMusicIdentifyResult>[0]> = {}) {
    return canPublishPtvMusicIdentifyResult({
        currentGeneration: 2,
        currentIdentityKey: 'server:user',
        currentRouteKey: '/music/album/album-1',
        mounted: true,
        operation: {
            generation: 2,
            identityKey: 'server:user',
            isOwnerCurrent: () => true,
            item: OLD_ALBUM,
            routeKey: '/music/album/album-1'
        },
        ownerState: ownerState(),
        result: {
            item: CONFIRMED_ALBUM,
            readbackCode: 'READBACK_CONFIRMED'
        },
        ...overrides
    });
}

describe('PTV Music confirmed Identify adoption', () => {
    it('overlays confirmed albums, artists, and related Audio presentation only within one identity', () => {
        const overlay = new PtvMusicIdentifyAuthorityOverlay();
        const requestRevision = overlay.captureRequestRevision();
        const mediaSources = [ { Id: 'source-1' } ];
        const userData = { IsFavorite: true, PlaybackPositionTicks: 12_345 };
        const playingTrack: PtvMusicItem = {
            Album: 'Old Album',
            AlbumArtist: 'Old Artist',
            AlbumArtists: [ { Id: 'artist-1', Name: 'Old Artist' } ],
            AlbumId: 'album-1',
            Artist: 'Old Artist',
            ArtistItems: [ { Id: 'artist-1', Name: 'Old Artist' } ],
            Artists: [ 'Old Artist' ],
            Id: 'track-1',
            MediaSources: mediaSources,
            Name: 'Playing Track',
            RunTimeTicks: 987_654_321,
            UserData: userData,
            Type: 'Audio'
        };

        expect(overlay.confirm('server-a:user-a', CONFIRMED_ALBUM)).toBe(true);
        expect(overlay.confirm('server-a:user-a', CONFIRMED_ARTIST)).toBe(true);
        expect(overlay.reconcileItem('server-a:user-a', OLD_ALBUM, requestRevision)).toMatchObject(CONFIRMED_ALBUM);
        expect(overlay.reconcileItem('server-a:user-a', OLD_ARTIST, requestRevision)).toMatchObject(CONFIRMED_ARTIST);

        const reconciledTrack = overlay.reconcilePresentationItem(
            'server-a:user-a',
            playingTrack,
            requestRevision
        );

        expect(reconciledTrack).toMatchObject({
            Album: 'Confirmed Album',
            AlbumArtist: 'Confirmed Artist',
            AlbumArtists: [ { Id: 'artist-1', Name: 'Confirmed Artist' } ],
            AlbumId: 'album-1',
            Artist: 'Confirmed Artist',
            ArtistItems: [ { Id: 'artist-1', Name: 'Confirmed Artist' } ],
            Artists: [ 'Confirmed Artist' ],
            Id: 'track-1',
            Name: 'Playing Track',
            Type: 'Audio'
        });
        expect(reconciledTrack.MediaSources).toBe(mediaSources);
        expect(reconciledTrack.RunTimeTicks).toBe(playingTrack.RunTimeTicks);
        expect(reconciledTrack.UserData).toBe(userData);
        expect(overlay.reconcileItem('server-b:user-b', OLD_ALBUM, requestRevision)).toBe(OLD_ALBUM);
        expect(overlay.reconcileItem('server-b:user-b', OLD_ARTIST, requestRevision)).toBe(OLD_ARTIST);
        expect(overlay.reconcilePresentationItem('server-b:user-b', playingTrack, requestRevision))
            .toBe(playingTrack);
    });

    it('keeps rich album relationships, children, and playback ownership while adopting confirmed metadata', () => {
        const albumArtists = [ { Id: 'artist-1', Name: 'Original Artist' } ];
        const artistItems = [ { Id: 'artist-1', Name: 'Original Artist' } ];
        const artists = [ 'Original Artist' ];
        const albumMediaSources = [ { Id: 'album-source-1' } ];
        const albumUserData = { IsFavorite: true, PlaybackPositionTicks: 54_321 };
        const tracks = Array.from({ length: 18 }, (_entry, index): PtvMusicItem => ({
            Album: 'The Surface',
            AlbumArtist: 'Original Artist',
            AlbumArtists: albumArtists,
            AlbumId: 'album-surface',
            ArtistItems: artistItems,
            Artists: artists,
            Id: `track-${index + 1}`,
            MediaSources: [ { Id: `track-source-${index + 1}` } ],
            Name: `Track ${index + 1}`,
            RunTimeTicks: 100_000 + index,
            Type: 'Audio',
            UserData: { PlaybackPositionTicks: index }
        }));
        const current: PtvMusicItem = {
            AlbumArtist: 'Original Artist',
            AlbumArtists: albumArtists,
            ArtistItems: artistItems,
            Artists: artists,
            ChildCount: 18,
            Children: tracks,
            Id: 'album-surface',
            ImageTags: { Logo: 'logo-old', Primary: 'primary-old' },
            IsFolder: true,
            MediaSources: albumMediaSources,
            Name: 'The Surface',
            ProviderIds: { Discogs: 'discogs-stable', MusicBrainzAlbum: 'mb-old' },
            RecursiveItemCount: 18,
            Type: 'MusicAlbum',
            UserData: albumUserData
        };
        const confirmed: PtvMusicItem = {
            AlbumArtist: '',
            AlbumArtists: [],
            ArtistItems: [],
            Artists: [],
            ChildCount: 0,
            Id: 'album-surface',
            ImageTags: { Primary: 'primary-confirmed' },
            IsFolder: false,
            MediaSources: [],
            Name: 'The Surface (Confirmed)',
            ProviderIds: { MusicBrainzAlbum: 'mb-confirmed' },
            RecursiveItemCount: 0,
            Type: 'MusicAlbum',
            UserData: {}
        };
        const adopted = reconcilePtvMusicIdentifyItem(current, confirmed);

        expect(adopted).toMatchObject({
            AlbumArtist: 'Original Artist',
            ChildCount: 18,
            ImageTags: { Logo: 'logo-old', Primary: 'primary-confirmed' },
            IsFolder: true,
            Name: 'The Surface (Confirmed)',
            ProviderIds: { Discogs: 'discogs-stable', MusicBrainzAlbum: 'mb-confirmed' },
            RecursiveItemCount: 18
        });
        expect(adopted?.AlbumArtists).toBe(albumArtists);
        expect(adopted?.ArtistItems).toBe(artistItems);
        expect(adopted?.Artists).toBe(artists);
        expect(adopted?.Children).toBe(tracks);
        expect(adopted?.MediaSources).toBe(albumMediaSources);
        expect(adopted?.UserData).toBe(albumUserData);

        const reconciledTracks = reconcilePtvMusicIdentifyPresentationItems(tracks, confirmed);
        const detail = {
            error: '',
            isLoading: false,
            isTracksLoading: false,
            item: adopted,
            tracks: [ ...reconciledTracks ]
        };

        expect(detail.tracks).toHaveLength(18);
        expect(detail.tracks.map(track => track.Id)).toEqual(tracks.map(track => track.Id));
        detail.tracks.forEach((track, index) => {
            expect(track).toMatchObject({
                Album: 'The Surface (Confirmed)',
                AlbumArtist: 'Original Artist',
                Id: `track-${index + 1}`,
                RunTimeTicks: 100_000 + index,
                Type: 'Audio'
            });
            expect(track.AlbumArtists).toBe(albumArtists);
            expect(track.ArtistItems).toBe(artistItems);
            expect(track.Artists).toBe(artists);
            expect(track.MediaSources).toBe(tracks[index].MediaSources);
            expect(track.UserData).toBe(tracks[index].UserData);
        });

        const overlay = new PtvMusicIdentifyAuthorityOverlay();
        const staleRequestRevision = overlay.captureRequestRevision();

        expect(overlay.confirm('server:user', confirmed)).toBe(true);
        const overlaid = overlay.reconcileItem('server:user', current, staleRequestRevision);

        expect(overlaid).toMatchObject({
            AlbumArtist: 'Original Artist',
            ChildCount: 18,
            Name: 'The Surface (Confirmed)',
            RecursiveItemCount: 18
        });
        expect(overlaid?.AlbumArtists).toBe(albumArtists);
        expect(overlaid?.Children).toBe(tracks);
        expect(overlaid?.MediaSources).toBe(albumMediaSources);
        expect(overlaid?.UserData).toBe(albumUserData);
    });

    it('adopts non-empty confirmed relationship groups without surrendering structural ownership', () => {
        const current: PtvMusicItem = {
            AlbumArtist: 'Old Artist',
            AlbumArtists: [ { Id: 'artist-old', Name: 'Old Artist' } ],
            ArtistItems: [ { Id: 'artist-old', Name: 'Old Artist' } ],
            Artists: [ 'Old Artist' ],
            ChildCount: 18,
            Id: 'album-1',
            IsFolder: true,
            Name: 'Old Album',
            Type: 'MusicAlbum'
        };
        const adopted = reconcilePtvMusicIdentifyItem(current, {
            AlbumArtist: 'Confirmed Artist',
            AlbumArtists: [ { Id: 'artist-confirmed', Name: 'Confirmed Artist' } ],
            ArtistItems: [ { Id: 'artist-confirmed', Name: 'Confirmed Artist' } ],
            Artists: [ 'Confirmed Artist' ],
            ChildCount: 0,
            Id: 'album-1',
            IsFolder: false,
            Name: 'Confirmed Album',
            Type: 'MusicAlbum'
        });

        expect(adopted).toMatchObject({
            AlbumArtist: 'Confirmed Artist',
            AlbumArtists: [ { Id: 'artist-confirmed', Name: 'Confirmed Artist' } ],
            ArtistItems: [ { Id: 'artist-confirmed', Name: 'Confirmed Artist' } ],
            Artists: [ 'Confirmed Artist' ],
            ChildCount: 18,
            IsFolder: true,
            Name: 'Confirmed Album'
        });
    });

    it('closes sparse album relationships from matching authoritative Audio children only', () => {
        const childrenOwner = [ { Id: 'owned-child-1' } ];
        const mediaSources = [ { Id: 'album-source-1' } ];
        const userData = { IsFavorite: true, PlaybackPositionTicks: 9876 };
        const album: PtvMusicItem = {
            AlbumArtist: '',
            AlbumArtists: [],
            Artist: '',
            ArtistItems: [],
            Artists: [],
            ChildCount: 18,
            Children: childrenOwner,
            Id: 'album-surface',
            IsFolder: true,
            MediaSources: mediaSources,
            Name: 'The Surface',
            RecursiveItemCount: 18,
            Type: 'MusicAlbum',
            UserData: userData
        };
        const unrelatedTrack: PtvMusicItem = {
            AlbumArtist: 'Wrong Artist',
            AlbumArtists: [ { Id: 'wrong-artist', Name: 'Wrong Artist' } ],
            AlbumId: 'other-album',
            Artist: 'Wrong Artist',
            ArtistItems: [ { Id: 'wrong-artist', Name: 'Wrong Artist' } ],
            Artists: [ 'Wrong Artist' ],
            Id: 'track-unrelated',
            Type: 'Audio'
        };
        const nonAudioChild: PtvMusicItem = {
            AlbumArtist: 'Wrong Video Artist',
            AlbumId: 'album-surface',
            Id: 'video-1',
            Type: 'MusicVideo'
        };
        const matchingTrack: PtvMusicItem = {
            AlbumArtist: 'Surface Artist',
            AlbumArtists: [ { Id: 'surface-artist', Name: 'Surface Artist' } ],
            AlbumId: 'album-surface',
            Artist: 'Surface Artist feat. Guest',
            ArtistItems: [ { Id: 'surface-artist', Name: 'Surface Artist' }, { Id: 'guest', Name: 'Guest' } ],
            Artists: [ 'Surface Artist', 'Guest' ],
            Id: 'track-1',
            MediaSources: [ { Id: 'track-source-1' } ],
            Type: 'Audio',
            UserData: { PlaybackPositionTicks: 1234 }
        };
        const reconciled = reconcilePtvMusicAlbumRelationshipsFromTracks(
            album,
            [ unrelatedTrack, nonAudioChild, matchingTrack ]
        );

        expect(reconciled).toMatchObject({
            AlbumArtist: 'Surface Artist',
            AlbumArtists: [ { Id: 'surface-artist', Name: 'Surface Artist' } ],
            Artist: 'Surface Artist',
            ArtistItems: [ { Id: 'surface-artist', Name: 'Surface Artist' } ],
            Artists: [ 'Surface Artist' ],
            ChildCount: 18,
            IsFolder: true,
            Name: 'The Surface',
            RecursiveItemCount: 18
        });
        expect(reconciled?.Children).toBe(childrenOwner);
        expect(reconciled?.MediaSources).toBe(mediaSources);
        expect(reconciled?.UserData).toBe(userData);
        expect(matchingTrack.MediaSources).toEqual([ { Id: 'track-source-1' } ]);
        expect(matchingTrack.UserData).toEqual({ PlaybackPositionTicks: 1234 });
    });

    it('never overwrites populated album relationships with child projections', () => {
        const albumArtists = [ { Id: 'album-owner', Name: 'Album Owner' } ];
        const artistItems = [ { Id: 'artist-owner', Name: 'Artist Owner' } ];
        const artists = [ 'Artist Owner' ];
        const album: PtvMusicItem = {
            AlbumArtist: 'Album Owner',
            AlbumArtists: albumArtists,
            Artist: 'Artist Owner',
            ArtistItems: artistItems,
            Artists: artists,
            Id: 'album-1',
            Name: 'Owned Album',
            Type: 'MusicAlbum'
        };
        const conflictingTrack: PtvMusicItem = {
            AlbumArtist: 'Child Album Artist',
            AlbumArtists: [ { Id: 'child-album-artist', Name: 'Child Album Artist' } ],
            AlbumId: 'album-1',
            Artist: 'Child Artist',
            ArtistItems: [ { Id: 'child-artist', Name: 'Child Artist' } ],
            Artists: [ 'Child Artist' ],
            Id: 'track-1',
            Type: 'Audio'
        };

        const reconciled = reconcilePtvMusicAlbumRelationshipsFromTracks(album, [ conflictingTrack ]);

        expect(reconciled).toBe(album);
        expect(reconciled?.AlbumArtists).toBe(albumArtists);
        expect(reconciled?.ArtistItems).toBe(artistItems);
        expect(reconciled?.Artists).toBe(artists);
    });

    it('prevents a late pre-Identify response from replacing confirmed home and catalog state', () => {
        const overlay = new PtvMusicIdentifyAuthorityOverlay();
        const requestRevision = overlay.captureRequestRevision();
        const lateStaleHome = homeData([ OLD_ALBUM ]);
        const lateStaleCatalog = [ OLD_ALBUM ];

        expect(overlay.confirm('server:user', CONFIRMED_ALBUM)).toBe(true);

        const reconciledHome = overlay.reconcileHomeData('server:user', lateStaleHome, requestRevision);
        const reconciledCatalog = overlay.reconcileItems('server:user', lateStaleCatalog, requestRevision);

        expect(reconciledHome.sections[0].items).toEqual([ CONFIRMED_ALBUM ]);
        expect(reconciledCatalog).toEqual([ CONFIRMED_ALBUM ]);
        expect(reconciledHome.sections[0].items[0]).not.toBe(CONFIRMED_ALBUM);
        expect(reconciledCatalog[0]).not.toBe(CONFIRMED_ALBUM);
        expect(reconciledHome.sections[0].items[0]).toMatchObject({
            ImageTags: { Primary: 'confirmed-image-tag' },
            Name: 'Confirmed Album'
        });
        expect(reconciledCatalog[0]).toMatchObject({
            ImageTags: { Primary: 'confirmed-image-tag' },
            Name: 'Confirmed Album'
        });
    });

    it('overlays only responses started before confirmation so newer authority can win', () => {
        const overlay = new PtvMusicIdentifyAuthorityOverlay();
        const olderRequestRevision = overlay.captureRequestRevision();
        const laterAuthoritativeAlbum: PtvMusicItem = {
            ...CONFIRMED_ALBUM,
            ImageTags: { Primary: 'later-authoritative-image-tag' },
            Name: 'Later Authoritative Album'
        };

        expect(overlay.confirm('server:user', CONFIRMED_ALBUM)).toBe(true);
        const newerRequestRevision = overlay.captureRequestRevision();

        expect(overlay.reconcileItem('server:user', laterAuthoritativeAlbum, olderRequestRevision))
            .toEqual(CONFIRMED_ALBUM);
        expect(overlay.reconcileItem('server:user', laterAuthoritativeAlbum, newerRequestRevision))
            .toBe(laterAuthoritativeAlbum);
    });

    it('G: prevents an older Identify generation from overwriting the newer album artist relationship', () => {
        const overlay = new PtvMusicIdentifyAuthorityOverlay();
        const olderRequestRevision = overlay.captureRequestRevision();
        const newestRelationship: PtvMusicItem = {
            AlbumArtist: 'Newest Artist',
            AlbumArtists: [ { Id: 'artist-newest', Name: 'Newest Artist' } ],
            Id: 'album-1',
            Name: 'Confirmed Album',
            Type: 'MusicAlbum'
        };
        const staleRelationship: PtvMusicItem = {
            AlbumArtist: 'Stale Artist',
            AlbumArtists: [ { Id: 'artist-stale', Name: 'Stale Artist' } ],
            Id: 'album-1',
            Name: 'Stale Album',
            Type: 'MusicAlbum'
        };

        expect(overlay.confirm('server:user', newestRelationship)).toBe(true);
        const newerRequestRevision = overlay.captureRequestRevision();

        expect(overlay.reconcileItem('server:user', staleRelationship, olderRequestRevision)).toMatchObject({
            AlbumArtist: 'Newest Artist',
            AlbumArtists: [ { Id: 'artist-newest', Name: 'Newest Artist' } ]
        });
        expect(overlay.reconcileItem('server:user', staleRelationship, newerRequestRevision))
            .toBe(staleRelationship);
    });

    it('bounds overlay retention so an evicted identity can accept newer authoritative state', () => {
        const overlay = new PtvMusicIdentifyAuthorityOverlay();
        const requestRevision = overlay.captureRequestRevision();
        const laterAuthoritativeAlbum: PtvMusicItem = {
            ...CONFIRMED_ALBUM,
            Name: 'Later Authoritative Album'
        };

        expect(overlay.confirm('server:user', CONFIRMED_ALBUM)).toBe(true);
        for (let index = 0; index < 32; index += 1) {
            expect(overlay.confirm('server:user', {
                Id: `other-album-${index}`,
                Name: `Other Album ${index}`,
                Type: 'MusicAlbum'
            })).toBe(true);
        }

        expect(overlay.reconcileItem('server:user', laterAuthoritativeAlbum, requestRevision))
            .toBe(laterAuthoritativeAlbum);
    });

    it('S: immutably replaces only matching MusicAlbum instances', () => {
        const other: PtvMusicItem = { Id: 'album-2', Name: 'Other', Type: 'MusicAlbum' };
        const currentHome = homeData([ OLD_ALBUM, other ]);
        const nextHome = reconcilePtvMusicIdentifyHomeData(currentHome, CONFIRMED_ALBUM);
        const nextAlbums = reconcilePtvMusicIdentifyItems([ OLD_ALBUM, other ], CONFIRMED_ALBUM);

        expect(nextHome).not.toBe(currentHome);
        expect(nextHome.sections[0].items).toEqual([ CONFIRMED_ALBUM, other ]);
        expect(nextAlbums).toEqual([ CONFIRMED_ALBUM, other ]);
        expect(nextAlbums[1]).toBe(other);
    });

    it('T: adopts only the exact MusicArtist identity and type', () => {
        expect(reconcilePtvMusicIdentifyItems([ OLD_ARTIST ], CONFIRMED_ARTIST))
            .toEqual([ CONFIRMED_ARTIST ]);
        expect(reconcilePtvMusicIdentifyItem(OLD_ALBUM, CONFIRMED_ARTIST)).toBe(OLD_ALBUM);
        expect(reconcilePtvMusicIdentifyItem(OLD_ARTIST, CONFIRMED_ARTIST)).toEqual(CONFIRMED_ARTIST);
    });

    it('O/U: rejects older operations and unconfirmed results', () => {
        expect(canPublish({ currentGeneration: 3 })).toBe(false);
        expect(canPublish({
            result: { item: CONFIRMED_ALBUM, readbackCode: 'REFRESH_FAILED' }
        })).toBe(false);
        expect(canPublish({ result: { item: null, readbackCode: 'READBACK_CONFIRMED' } })).toBe(false);
    });

    it('P: rejects a same-ID owner replacement by object identity', () => {
        const replacement = { ...OLD_ALBUM };

        expect(canPublish({ ownerState: ownerState(replacement) })).toBe(false);
        expect(canPublish({
            operation: {
                generation: 2,
                identityKey: 'server:user',
                isOwnerCurrent: () => false,
                item: OLD_ALBUM,
                routeKey: '/music/album/album-1'
            }
        })).toBe(false);
    });

    it('Q: rejects route, identity, and mounted-owner retirement', () => {
        expect(canPublish({ mounted: false })).toBe(false);
        expect(canPublish({ currentRouteKey: '/music' })).toBe(false);
        expect(canPublish({ currentIdentityKey: 'other:user' })).toBe(false);
    });

    it('rejects null, empty, or whitespace-only publication identities', () => {
        expect(canPublish({ currentIdentityKey: null })).toBe(false);
        expect(canPublish({ currentIdentityKey: '' })).toBe(false);
        expect(canPublish({
            operation: {
                generation: 2,
                identityKey: null,
                isOwnerCurrent: () => true,
                item: OLD_ALBUM,
                routeKey: '/music/album/album-1'
            }
        })).toBe(false);
        expect(canPublish({
            currentIdentityKey: '   ',
            operation: {
                generation: 2,
                identityKey: '   ',
                isOwnerCurrent: () => true,
                item: OLD_ALBUM,
                routeKey: '/music/album/album-1'
            }
        })).toBe(false);
    });

    it('rejects wrong item ID/type and unsupported MusicVideo publication', () => {
        expect(canPublish({
            result: {
                item: { ...CONFIRMED_ALBUM, Id: 'album-other' },
                readbackCode: 'READBACK_CONFIRMED'
            }
        })).toBe(false);
        expect(canPublish({
            result: {
                item: { ...CONFIRMED_ALBUM, Type: 'MusicVideo' },
                readbackCode: 'READBACK_CONFIRMED'
            }
        })).toBe(false);
    });

    it('V: updates only safe Now Playing presentation metadata without replacing playback data', () => {
        const playingTrack: PtvMusicItem = {
            Album: 'Old Album',
            AlbumId: 'album-1',
            Container: 'flac',
            Id: 'track-1',
            MediaSources: [ { Id: 'source-1' } ],
            Name: 'Playing Track',
            RunTimeTicks: 123456,
            Type: 'Audio'
        };
        const reconciled = reconcilePtvMusicIdentifyQueueItem(playingTrack, CONFIRMED_ALBUM);

        expect(reconciled).toMatchObject({
            Album: 'Confirmed Album',
            AlbumId: 'album-1',
            Id: 'track-1',
            Name: 'Playing Track',
            RunTimeTicks: 123456,
            Type: 'Audio'
        });
        expect(reconciled.MediaSources).toBe(playingTrack.MediaSources);
    });

    it('projects confirmed DTOs to card-safe persistent fields', () => {
        const stored = projectPtvMusicLibraryIndexItemForStorage({
            ...CONFIRMED_ALBUM,
            CanDownload: false,
            DateCreated: '2026-09-01T12:00:00.000Z',
            MediaSources: [ { Id: 'private-source' } ],
            ParentId: 'safe-parent-id',
            Path: '/private/media/album.flac',
            ProviderIds: { MusicBrainzAlbum: 'private-provider-detail' }
        });

        expect(stored).toMatchObject({
            AlbumArtists: CONFIRMED_ALBUM.AlbumArtists,
            CanDownload: false,
            DateCreated: '2026-09-01T12:00:00.000Z',
            Id: CONFIRMED_ALBUM.Id,
            ImageTags: CONFIRMED_ALBUM.ImageTags,
            Name: CONFIRMED_ALBUM.Name,
            ParentId: 'safe-parent-id',
            Type: CONFIRMED_ALBUM.Type
        });
        expect(stored).not.toHaveProperty('MediaSources');
        expect(stored).not.toHaveProperty('Path');
        expect(stored).not.toHaveProperty('ProviderIds');
    });
});
