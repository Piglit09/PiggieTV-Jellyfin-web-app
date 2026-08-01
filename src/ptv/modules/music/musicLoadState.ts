import type { PtvMusicHomeData } from './musicTypes';

export type MusicLibraryIndexLoadState = 'failed' | 'loading' | 'ready' | 'scheduled';
export type MusicCatalogLoadState = 'empty' | 'loading' | 'ready';

function formatTrackCount(trackCount: number, qualifier: 'cached' | 'library') {
    const noun = trackCount === 1 ? 'track' : 'tracks';

    return `${trackCount} ${qualifier} ${noun}`;
}

export function getMusicCatalogLoadState(
    itemCount: number,
    libraryIndexLoadState: MusicLibraryIndexLoadState
): MusicCatalogLoadState {
    if (itemCount > 0) return 'ready';
    if (libraryIndexLoadState === 'loading' || libraryIndexLoadState === 'scheduled') return 'loading';

    return 'empty';
}

export function getMusicHeroTrackCountLabel(
    homeData: PtvMusicHomeData,
    libraryIndexLoadState: MusicLibraryIndexLoadState = 'scheduled'
) {
    const trackCount = homeData.stats.trackCount;

    if (libraryIndexLoadState === 'failed') {
        if (trackCount === 0) return 'Live track count unavailable';

        return `${formatTrackCount(trackCount, 'cached')}; live count unavailable`;
    }

    if (!homeData.libraryDebug && trackCount > 0) {
        return formatTrackCount(trackCount, 'cached');
    }

    if (!homeData.libraryDebug) {
        return libraryIndexLoadState === 'loading' ? 'Loading library tracks' : 'Library count scheduled';
    }

    if (homeData.libraryDebug.failedSections.includes('tracks') && trackCount === 0) {
        return 'Live track count unavailable';
    }

    return formatTrackCount(trackCount, 'library');
}
