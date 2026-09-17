import { describe, expect, it } from 'vitest';

import {
    resolvePtvMusicAlbumArtist,
    type PtvMusicAlbumArtistSource
} from './musicAlbumArtistResolution';
import { reconcilePtvMusicIdentifyItem } from './musicIdentifyAdoption';
import type { PtvMusicItem } from './musicTypes';

function album(overrides: Partial<PtvMusicItem> = {}): PtvMusicItem {
    return {
        Id: 'album-route-owner',
        Name: 'The Surface',
        Type: 'MusicAlbum',
        ...overrides
    };
}

function track(index: number, overrides: Partial<PtvMusicItem> = {}): PtvMusicItem {
    return {
        Album: 'The Surface',
        AlbumId: 'album-child-owner',
        ArtistItems: [ { Id: 'artist-beartooth', Name: 'Beartooth' } ],
        Artists: [ 'Beartooth' ],
        Id: `track-${index}`,
        Type: 'Audio',
        ...overrides
    };
}

function surfaceTracks() {
    return Array.from({ length: 18 }, (_, index) => track(index + 1, {
        MediaSources: [ { Id: `source-${index + 1}` } ],
        UserData: { PlaybackPositionTicks: index + 1 }
    }));
}

describe('PTV Music album artist resolution', () => {
    it('A: resolves a valid scalar AlbumArtist when no structured relationship is present', () => {
        expect(resolvePtvMusicAlbumArtist(album({ AlbumArtist: 'Beartooth' }), [])).toMatchObject({
            artist: 'Beartooth',
            source: 'album-relationship'
        });
    });

    it('A: prefers authoritative album relationships over generic artist fields', () => {
        const owner = album({
            AlbumArtist: 'Wrong Scalar',
            AlbumArtists: [ { Id: 'artist-beartooth', Name: 'Beartooth' } ],
            Artist: 'Wrong Artist',
            ArtistItems: [ { Id: 'wrong-artist', Name: 'Wrong Artist' } ],
            Artists: [ 'Wrong Artists' ]
        });
        const result = resolvePtvMusicAlbumArtist(owner, surfaceTracks());

        expect(result).toMatchObject({ artist: 'Beartooth', source: 'album-relationship' });
        expect(result.item).toBe(owner);
    });

    it('B: preserves the previous same-item relationship when a sparse confirmed DTO omits it', () => {
        const sparseConfirmed = album({ ImageTags: { Primary: 'new-image' } });
        const previousOwner = album({
            AlbumArtists: [ { Id: 'artist-beartooth', Name: 'Beartooth' } ]
        });
        const result = resolvePtvMusicAlbumArtist(sparseConfirmed, [], {
            preservedOwner: previousOwner
        });

        expect(result).toMatchObject({ artist: 'Beartooth', source: 'preserved-owner' });
        expect(result.item).toMatchObject({
            AlbumArtist: 'Beartooth',
            AlbumArtists: [ { Id: 'artist-beartooth', Name: 'Beartooth' } ]
        });
        expect(result.item?.ImageTags).toBe(sparseConfirmed.ImageTags);
    });

    it('C/J: derives a bounded relationship when all 18 scoped child tracks agree', () => {
        const owner = album();
        const tracks = surfaceTracks();
        const mediaSources = tracks.map(item => item.MediaSources);
        const userData = tracks.map(item => item.UserData);
        const ids = tracks.map(item => item.Id);
        const result = resolvePtvMusicAlbumArtist(owner, tracks, {
            childScope: 'authoritative-album-query'
        });

        expect(result).toMatchObject({ artist: 'Beartooth', source: 'child-consensus' });
        expect(result.item).toMatchObject({
            AlbumArtist: 'Beartooth',
            AlbumArtists: [ { Id: 'artist-beartooth', Name: 'Beartooth' } ],
            Artist: 'Beartooth',
            ArtistItems: [ { Id: 'artist-beartooth', Name: 'Beartooth' } ],
            Artists: [ 'Beartooth' ]
        });
        expect(tracks).toHaveLength(18);
        expect(tracks.map(item => item.Id)).toEqual(ids);
        expect(tracks.map(item => item.MediaSources)).toEqual(mediaSources);
        expect(tracks.map(item => item.UserData)).toEqual(userData);
    });

    it('F/J: preserves one 18-track The Surface owner through sparse Identify and remount', () => {
        const tracks = surfaceTracks();
        const trackIds = tracks.map(item => item.Id);
        const mediaSources = tracks.map(item => item.MediaSources);
        const userData = tracks.map(item => item.UserData);
        const initial = resolvePtvMusicAlbumArtist(album(), tracks, {
            childScope: 'authoritative-album-query'
        });
        const sparseConfirmed = album({
            AlbumArtist: '',
            AlbumArtists: [],
            Artist: '',
            ArtistItems: [],
            Artists: [],
            ImageTags: { Primary: 'confirmed-image' }
        });
        const preserved = resolvePtvMusicAlbumArtist(sparseConfirmed, tracks, {
            childScope: 'authoritative-album-query',
            preservedOwner: initial.item
        });
        const adopted = reconcilePtvMusicIdentifyItem(initial.item, sparseConfirmed);
        const remounted = resolvePtvMusicAlbumArtist(adopted, tracks, {
            childScope: 'authoritative-album-query'
        });

        expect(preserved).toMatchObject({ artist: 'Beartooth', source: 'preserved-owner' });
        expect(adopted).toMatchObject({
            AlbumArtist: 'Beartooth',
            AlbumArtists: [ { Id: 'artist-beartooth', Name: 'Beartooth' } ],
            ImageTags: { Primary: 'confirmed-image' }
        });
        expect(remounted.artist).toBe('Beartooth');
        expect(tracks).toHaveLength(18);
        expect(tracks.map(item => item.Id)).toEqual(trackIds);
        expect(tracks.map(item => item.MediaSources)).toEqual(mediaSources);
        expect(tracks.map(item => item.UserData)).toEqual(userData);
    });

    it('D: refuses to invent an album artist when credible child relationships disagree', () => {
        const tracks = surfaceTracks();

        tracks[17] = track(18, {
            ArtistItems: [ { Id: 'artist-guest', Name: 'Another Artist' } ],
            Artists: [ 'Another Artist' ]
        });

        expect(resolvePtvMusicAlbumArtist(album(), tracks, {
            childScope: 'authoritative-album-query'
        })).toMatchObject({
            artist: 'Unknown Artist',
            source: 'unknown'
        });
    });

    it('D: requires consensus across exact-ID child tracks instead of trusting the first child', () => {
        const tracks = [
            track(1, { AlbumId: 'album-route-owner' }),
            track(2, {
                AlbumId: 'album-route-owner',
                ArtistItems: [ { Id: 'artist-guest', Name: 'Another Artist' } ],
                Artists: [ 'Another Artist' ]
            })
        ];

        expect(resolvePtvMusicAlbumArtist(album(), tracks, {
            childScope: 'authoritative-album-query'
        }).source).toBe('unknown');
    });

    it('D: refuses alternate-identity fallback when the children do not share one album identity', () => {
        const tracks = surfaceTracks();

        tracks[17] = track(18, { AlbumId: 'another-album' });

        expect(resolvePtvMusicAlbumArtist(album(), tracks, {
            childScope: 'authoritative-album-query'
        }).source).toBe('unknown');
    });

    it('never authorizes an alternate album identity from matching title text alone', () => {
        expect(resolvePtvMusicAlbumArtist(album(), surfaceTracks()).source).toBe('unknown');
    });

    it('preserves compatible ID-only relationship arrays while adding the agreed display name', () => {
        const albumArtists = [ { Id: 'artist-beartooth' } ];
        const artistItems = [ { Id: 'artist-beartooth' } ];
        const result = resolvePtvMusicAlbumArtist(album({ AlbumArtists: albumArtists, ArtistItems: artistItems }), surfaceTracks(), {
            childScope: 'authoritative-album-query'
        });

        expect(result).toMatchObject({ artist: 'Beartooth', source: 'child-consensus' });
        expect(result.item?.AlbumArtists).toBe(albumArtists);
        expect(result.item?.ArtistItems).toBe(artistItems);
        expect(result.item?.AlbumArtist).toBe('Beartooth');
    });

    it('refuses to associate child consensus with conflicting ID-only owner relationships', () => {
        const owner = album({
            AlbumArtists: [ { Id: 'different-artist' } ],
            ArtistItems: [ { Id: 'different-artist' } ]
        });
        const result = resolvePtvMusicAlbumArtist(owner, surfaceTracks(), {
            childScope: 'authoritative-album-query'
        });

        expect(result).toMatchObject({ artist: 'Unknown Artist', source: 'unknown' });
        expect(result.item).toBe(owner);
    });

    it('E: keeps a zero-track album safely unknown', () => {
        expect(resolvePtvMusicAlbumArtist(album(), [])).toMatchObject({
            artist: 'Unknown Artist',
            source: 'unknown'
        });
    });

    it('H: deterministically re-derives the relationship after a fresh remount', () => {
        const first = resolvePtvMusicAlbumArtist(album(), surfaceTracks(), {
            childScope: 'authoritative-album-query'
        });
        const remounted = resolvePtvMusicAlbumArtist(album(), surfaceTracks(), {
            childScope: 'authoritative-album-query'
        });

        expect(remounted.artist).toBe(first.artist);
        expect(remounted.source).toBe(first.source);
        expect(remounted.item).toEqual(first.item);
    });

    it('uses only the four share-safe diagnostic source categories', () => {
        const allowed: PtvMusicAlbumArtistSource[] = [
            'album-relationship',
            'preserved-owner',
            'child-consensus',
            'unknown'
        ];

        expect(allowed).toEqual([
            'album-relationship',
            'preserved-owner',
            'child-consensus',
            'unknown'
        ]);
    });
});
