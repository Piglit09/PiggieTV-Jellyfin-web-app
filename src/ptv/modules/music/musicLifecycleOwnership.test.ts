import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const musicPageSource = readFileSync(
    resolve(process.cwd(), 'src/ptv/modules/music/musicPage.tsx'),
    'utf8'
);
const musicPlayerPanelSource = readFileSync(
    resolve(process.cwd(), 'src/ptv/modules/music/MusicPlayerPanel.tsx'),
    'utf8'
);
const musicLyricsPanelSource = readFileSync(
    resolve(process.cwd(), 'src/ptv/modules/music/MusicLyricsPanel.tsx'),
    'utf8'
);

describe('PiggieTV Music route resource ownership', () => {
    it('tracks shell verification in the route deferred-work ledger', () => {
        expect(musicPageSource).toMatch(
            /void loadMusicData\(\);\s*scheduleDeferredMusicWork\(\(\) => \{\s*if \(verifyMusicShell\(\)\)/
        );
        expect(musicPageSource).toMatch(
            /musicRequestIdRef\.current \+= 1;\s*clearDeferredMusicWork\(\);/
        );
    });

    it('passes cancellation into delayed videos and playlist refreshes', () => {
        expect(musicPageSource).toContain('fetchPtvMusicVideos(8, routeSignal)');
        expect(musicPageSource).toContain('fetchPtvMusicPlaylists(36, controller.signal)');
        expect(musicPageSource).toContain('refreshController?.abort();');
    });

    it('leaves the shell backdrop as the sole page-backdrop visual owner', () => {
        expect(musicPageSource).not.toContain('function MusicPageBackdrop');
        expect(musicPageSource).not.toContain('<MusicPageBackdrop');
        expect(musicPageSource).toContain('backdropUrl={backdropItem ? getItemBackdropUrl(backdropItem, 1800) : \'\'}');
    });

    it('uses route-aware Home readiness and catalog-local loading states', () => {
        expect(musicPageSource).toContain('const homeGate = getPtvMusicRouteHomeGate(route.view');
        expect(musicPageSource).not.toContain('if (isLoading && !homeData.sections.length)');
        expect(musicPageSource).toContain("getMusicCatalogCountLabel(items.length, filteredItems.length, 'artists'");
        expect(musicPageSource).toContain("label='Loading albums'");
        expect(musicPageSource).toContain("label='Loading songs'");
        expect(musicPageSource).toContain('libraryIndexLoadState={libraryIndexLoadState}');
    });

    it('keeps live catalog arrays owned by the library index', () => {
        expect(musicPageSource).toContain("const shouldUseHomeFallback = libraryIndexLoadState === 'failed'");
        expect(musicPageSource).not.toMatch(
            /loadHomeSnapshot\([\s\S]*?setAlbums\(nextAlbums\)/
        );
        expect(musicPageSource).toContain('catalogInitialCardLimit');
        expect(musicPageSource).toContain('catalogImmediateArtworkLimit');
    });

    it('owns album and playlist detail work with abortable route generations', () => {
        expect(musicPageSource).toContain("const PTV_MUSIC_ALBUM_ROUTE_WORK_OWNER = 'music-route:album'");
        expect(musicPageSource).toContain("const PTV_MUSIC_PLAYLIST_ROUTE_WORK_OWNER = 'music-route:playlist'");
        expect(musicPageSource).toContain('fetchPtvMusicAlbumTracks(route.id, 100, routeWork.signal)');
        expect(musicPageSource).toContain('fetchPtvMusicPlaylistTracks(route.id, 100, routeWork.signal)');
        expect(musicPageSource).toContain('loadPtvProgressiveMusicDetail({');
        expect(musicPageSource).toContain('retirePtvMusicRouteWork(routeWork)');
    });

    it('fetches lyrics only for the selected tab and aborts on tab or item retirement', () => {
        expect(musicPageSource).toContain("const LazyMusicPlayerPanel = React.lazy(() => import('./MusicPlayerPanel'))");
        expect(musicPlayerPanelSource).toContain("const LazyMusicLyricsPanel = React.lazy(() => import('./MusicLyricsPanel'))");
        expect(musicPlayerPanelSource).not.toContain("from './musicApi'");
        expect(musicLyricsPanelSource).toContain('fetchPtvMusicLyrics(itemRef.current, controller.signal)');
        expect(musicLyricsPanelSource).toContain('controllerRef.current?.abort()');
        expect(musicLyricsPanelSource).toContain('requestIdentityRef.current !== requestIdentity');
    });

    it('defers optional recommendation and related CPU until after primary render', () => {
        expect(musicPageSource).toContain('function DeferredMusicRecommendationRows');
        expect(musicPageSource).toMatch(
            /window\.setTimeout\(\(\) => \{[\s\S]*?buildPtvDistinctMusicRecommendationRow/
        );
        expect(musicPageSource).toMatch(
            /timerId = window\.setTimeout\(\(\) => \{\s*void buildPtvMusicRelatedTracks/
        );
        expect(musicPageSource).toContain("setPtvMusicVirtualQueue(autoQueueSeedItem, items, 'player-related')");
    });
});
