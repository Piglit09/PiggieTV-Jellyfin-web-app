import { describe, expect, it } from 'vitest';

import type { PtvMusicHomeData } from './musicTypes';
import {
    getMusicCatalogLoadState,
    getMusicHeroTrackCountLabel
} from './musicLoadState';

function createHomeData(trackCount: number, failedSections: string[] | null = null): PtvMusicHomeData {
    return {
        completeness: 'initial-usable',
        generatedAt: Date.now(),
        library: null,
        libraryDebug: failedSections ? {
            dropReasons: [],
            droppedAlbumCount: 0,
            droppedArtistCount: 0,
            droppedTrackCount: 0,
            failedSections,
            fetchedAlbumCount: 0,
            fetchedArtistCount: 0,
            fetchedTrackCount: trackCount,
            jellyfinAlbumTotal: 0,
            jellyfinArtistTotal: 0,
            jellyfinTrackTotal: trackCount,
            lastMusicQueryUrl: '',
            musicLibraryName: null,
            pageCount: {
                albums: 0,
                artists: 0,
                playlists: 0,
                tracks: 0
            },
            pageSize: 50,
            playlistCount: 0,
            selectedMusicLibraryId: null,
            totalRecordCountFromApi: {
                albums: 0,
                artists: 0,
                playlists: 0,
                tracks: trackCount
            }
        } : undefined,
        nextEligibleRefreshAt: 0,
        refreshReason: 'test',
        sections: [],
        stats: {
            albumCount: 0,
            artistCount: 0,
            trackCount
        }
    };
}

describe('Music library load state', () => {
    it('renders cached data without claiming that the deferred live index is loading', () => {
        expect(getMusicHeroTrackCountLabel(createHomeData(42), 'scheduled')).toBe('42 cached tracks');
    });

    it('settles live-index failures with cached and empty fallbacks', () => {
        expect(getMusicHeroTrackCountLabel(createHomeData(42), 'failed'))
            .toBe('42 cached tracks; live count unavailable');
        expect(getMusicHeroTrackCountLabel(createHomeData(0), 'failed'))
            .toBe('Live track count unavailable');
    });

    it('reports an authoritative live count after indexing completes', () => {
        expect(getMusicHeroTrackCountLabel(createHomeData(1, []), 'ready')).toBe('1 library track');
    });

    it('keeps an empty catalog route loading while its own index is pending', () => {
        expect(getMusicCatalogLoadState(0, 'scheduled')).toBe('loading');
        expect(getMusicCatalogLoadState(0, 'loading')).toBe('loading');
    });

    it('renders cached catalog items immediately and settles true empty states', () => {
        expect(getMusicCatalogLoadState(12, 'loading')).toBe('ready');
        expect(getMusicCatalogLoadState(0, 'ready')).toBe('empty');
        expect(getMusicCatalogLoadState(0, 'failed')).toBe('empty');
    });
});
