import { describe, expect, it } from 'vitest';

import {
    reconcilePtvMusicArtistFavorite,
    reconcilePtvMusicArtistFavoriteCache
} from './musicArtistFavoriteCache';
import { PtvMusicIdentityResourceCache } from './musicIdentityCache';

function getArtistDetail(isFavorite: boolean) {
    return {
        albums: [{ Id: 'album-1' }],
        artist: {
            Id: 'artist-1',
            Name: 'Anonymous Artist',
            Type: 'MusicArtist',
            UserData: {
                IsFavorite: isFavorite
            }
        },
        error: '',
        isLoading: false,
        topSongs: [{ Id: 'track-1' }]
    };
}

describe('PiggieTV Artist favorite cache reconciliation', () => {
    it('keeps an optimistic favorite active when the same identity reopens the cached Artist', () => {
        const cache = new PtvMusicIdentityResourceCache<ReturnType<typeof getArtistDetail>>(4);
        const originalDetail = getArtistDetail(false);

        cache.set('server-a:user-a', 'artist-1', originalDetail);
        cache.set('server-b:user-b', 'artist-1', getArtistDetail(false));

        const reconciled = reconcilePtvMusicArtistFavoriteCache(
            cache,
            'server-a:user-a',
            'artist-1',
            true
        );

        expect(reconciled?.artist?.UserData?.IsFavorite).toBe(true);
        expect(cache.get('server-a:user-a', 'artist-1')?.artist?.UserData?.IsFavorite).toBe(true);
        expect(cache.get('server-b:user-b', 'artist-1')?.artist?.UserData?.IsFavorite).toBe(false);
        expect(originalDetail.artist.UserData.IsFavorite).toBe(false);
        expect(reconciled?.albums).toBe(originalDetail.albums);
        expect(reconciled?.topSongs).toBe(originalDetail.topSongs);
    });

    it('rolls back only the matching Artist and identity when the server mutation fails', () => {
        const cache = new PtvMusicIdentityResourceCache<ReturnType<typeof getArtistDetail>>(4);

        cache.set('server-a:user-a', 'artist-1', getArtistDetail(true));
        cache.set('server-a:user-a', 'artist-2', {
            ...getArtistDetail(true),
            artist: {
                ...getArtistDetail(true).artist,
                Id: 'artist-2'
            }
        });

        reconcilePtvMusicArtistFavoriteCache(cache, 'server-a:user-a', 'artist-1', false);

        expect(cache.get('server-a:user-a', 'artist-1')?.artist?.UserData?.IsFavorite).toBe(false);
        expect(cache.get('server-a:user-a', 'artist-2')?.artist?.UserData?.IsFavorite).toBe(true);
        expect(reconcilePtvMusicArtistFavorite(getArtistDetail(true), 'artist-2', false))
            .toEqual(getArtistDetail(true));
    });
});
