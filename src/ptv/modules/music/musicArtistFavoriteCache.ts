import { PtvMusicIdentityResourceCache } from './musicIdentityCache';
import type { PtvMusicItem } from './musicTypes';

export type PtvMusicArtistFavoriteDetail = Readonly<{
    artist: PtvMusicItem | null;
}>;

export function reconcilePtvMusicArtistFavorite<TDetail extends PtvMusicArtistFavoriteDetail>(
    detail: TDetail,
    artistId: string,
    isFavorite: boolean
): TDetail {
    if (detail.artist?.Id !== artistId || detail.artist.UserData?.IsFavorite === isFavorite) {
        return detail;
    }

    return {
        ...detail,
        artist: {
            ...detail.artist,
            UserData: {
                ...(detail.artist.UserData || {}),
                IsFavorite: isFavorite
            }
        }
    };
}

export function reconcilePtvMusicArtistFavoriteCache<TDetail extends PtvMusicArtistFavoriteDetail>(
    cache: PtvMusicIdentityResourceCache<TDetail>,
    identityKey: string | null,
    artistId: string,
    isFavorite: boolean
): TDetail | undefined {
    const cachedDetail = cache.get(identityKey, artistId);

    if (!cachedDetail) return undefined;

    const reconciledDetail = reconcilePtvMusicArtistFavorite(cachedDetail, artistId, isFavorite);

    if (reconciledDetail !== cachedDetail) {
        cache.set(identityKey, artistId, reconciledDetail);
    }

    return reconciledDetail;
}
