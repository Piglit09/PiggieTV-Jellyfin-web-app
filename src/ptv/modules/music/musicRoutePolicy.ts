const PTV_MUSIC_CATALOG_VIEWS = new Set([
    'albums',
    'artists',
    'genres',
    'library',
    'playlists',
    'songs'
]);

const PTV_MUSIC_HOME_INDEPENDENT_VIEWS = new Set([
    ...PTV_MUSIC_CATALOG_VIEWS,
    'album',
    'artist',
    'history',
    'item',
    'liked',
    'player',
    'playlist'
]);

export function isPtvMusicCatalogView(view: string) {
    return PTV_MUSIC_CATALOG_VIEWS.has(view);
}

export function isPtvMusicHomeIndependentView(view: string) {
    return PTV_MUSIC_HOME_INDEPENDENT_VIEWS.has(view);
}

export type PtvMusicRouteHomeGate = 'error' | 'loading' | 'ready';

export function getPtvMusicRouteHomeGate(
    view: string,
    options: {
        hasError: boolean;
        hasHomeSections: boolean;
        isLoading: boolean;
    }
): PtvMusicRouteHomeGate {
    if (isPtvMusicHomeIndependentView(view) || options.hasHomeSections) return 'ready';
    if (options.isLoading) return 'loading';
    if (options.hasError) return 'error';

    return 'ready';
}
