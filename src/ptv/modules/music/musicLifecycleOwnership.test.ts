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
const musicApiSource = readFileSync(
    resolve(process.cwd(), 'src/ptv/modules/music/musicApi.ts'),
    'utf8'
);
const musicAlbumArtistResolutionSource = readFileSync(
    resolve(process.cwd(), 'src/ptv/modules/music/musicAlbumArtistResolution.ts'),
    'utf8'
);
const musicQueueSource = readFileSync(
    resolve(process.cwd(), 'src/ptv/modules/music/musicQueue.ts'),
    'utf8'
);

describe('PiggieTV Music route resource ownership', () => {
    it('routes Identify through confirmed authority without a broad Music request fallback', () => {
        const identifyStart = musicPageSource.indexOf('const openAdminAction = useCallback(');
        const identifyEnd = musicPageSource.indexOf('\n    const adminControls = useMemo', identifyStart);
        const identifySource = musicPageSource.slice(identifyStart, identifyEnd);

        expect(musicPageSource).toContain('itemIdentifier.showWithAuthority(itemId, serverId)');
        expect(identifySource).toContain('canPublishPtvMusicIdentifyResult({');
        expect(identifySource).toContain('result: authorityResult');
        expect(identifySource).toContain('adoptConfirmedMusicIdentifyItem(');
        expect(identifySource).not.toContain('loadMusicData(');
        expect(identifySource).not.toContain('fetchPtvMusicItem(');
        expect(identifySource).not.toContain('getPtvUserViews');
        expect(identifySource).not.toContain('invalidatePtvMusicHomeCache(');
        expect(identifySource).not.toContain('window.location');
        expect(identifySource).not.toContain('routeController');
    });

    it('keeps Music admin-dialog failure diagnostics value-free', () => {
        const identifyStart = musicPageSource.indexOf('const openAdminAction = useCallback(');
        const identifyEnd = musicPageSource.indexOf('\n    const adminControls = useMemo', identifyStart);
        const identifySource = musicPageSource.slice(identifyStart, identifyEnd);

        expect(identifySource).toContain("'music-admin-dialog-failed'");
        expect(identifySource).toContain('failureReason:');
        expect(identifySource).not.toContain('error: getMusicErrorMessage(error)');
    });

    it('records album artist ownership with a category-only diagnostic payload', () => {
        const viewStart = musicPageSource.indexOf('function AlbumOrPlaylistView(');
        const viewEnd = musicPageSource.indexOf('\ntype ', viewStart + 1);
        const viewSource = musicPageSource.slice(viewStart, viewEnd);

        expect(viewSource).toContain("'music-album-artist-source'");
        expect(viewSource).toContain('source: detail.artistSource');
        expect(viewSource).not.toContain('artist:');
        expect(viewSource).not.toContain('albumId:');
        expect(viewSource).not.toContain('trackId:');
        expect(viewSource).not.toContain('Name:');
    });

    it('prioritizes structured album-owned artist relationships in the shared display getter', () => {
        const getterStart = musicApiSource.indexOf('export function getPtvMusicArtist(');
        const getterEnd = musicApiSource.indexOf('\nexport function ', getterStart + 1);
        const getterSource = musicApiSource.slice(getterStart, getterEnd);
        const albumBranch = getterSource.slice(
            getterSource.indexOf('const artist = firstKnownMusicDisplayValue(isAlbum ? ['),
            getterSource.indexOf('] : [')
        );

        expect(albumBranch.indexOf('item?.AlbumArtists')).toBeGreaterThanOrEqual(0);
        expect(albumBranch.indexOf('item?.AlbumArtists')).toBeLessThan(albumBranch.indexOf('item?.AlbumArtist,'));
        expect(albumBranch.indexOf('item?.AlbumArtist,')).toBeLessThan(albumBranch.indexOf('item?.Artists'));
        expect(albumBranch.indexOf('item?.Artists')).toBeLessThan(albumBranch.indexOf('item?.Artist,'));
    });

    it('derives album artist ownership without adding transport or broad reload work', () => {
        expect(musicAlbumArtistResolutionSource).not.toContain('fetch(');
        expect(musicAlbumArtistResolutionSource).not.toContain('requestPtv');
        expect(musicAlbumArtistResolutionSource).not.toContain('getPtvUserViews');
        expect(musicAlbumArtistResolutionSource).not.toContain('loadMusicData');
        expect(musicAlbumArtistResolutionSource).not.toContain('invalidatePtvMusicHomeCache');
    });

    it('suppresses identify metadata queue diagnostics before any media ID can be recorded', () => {
        const emitStart = musicQueueSource.indexOf('function emitQueueUpdated(action: string)');
        const emitEnd = musicQueueSource.indexOf('\nfunction ', emitStart + 1);
        const emitSource = musicQueueSource.slice(emitStart, emitEnd);
        const reconcileStart = musicQueueSource.indexOf('export function reconcilePtvMusicQueueIdentifyMetadata(');
        const reconcileEnd = musicQueueSource.indexOf('\nexport function retirePtvMusicIdentityState', reconcileStart);
        const reconcileSource = musicQueueSource.slice(reconcileStart, reconcileEnd);

        expect(musicQueueSource).toMatch(
            /const noisyQueueUpdateActions = new Set\(\[[\s\S]*?'identify-metadata'[\s\S]*?\]\)/
        );
        expect(emitSource).toContain('if (!noisyQueueUpdateActions.has(action))');
        expect(emitSource).toContain('currentItemId: snapshot.currentItem?.Id || null');
        expect(reconcileSource).toContain("emitQueueUpdated('identify-metadata')");
        expect(reconcileSource).not.toContain('recordPtvEvent(');
        expect(reconcileSource).not.toContain('currentItemId');
        expect(reconcileSource).not.toContain('itemId');
    });

    it('reconciles persistent home and exact library-index snapshots after confirmed Identify adoption', () => {
        const adoptionStart = musicPageSource.indexOf('const adoptConfirmedMusicIdentifyItem = useCallback(');
        const adoptionEnd = musicPageSource.indexOf('\n    const openAdminAction = useCallback(', adoptionStart);
        const adoptionSource = musicPageSource.slice(adoptionStart, adoptionEnd);
        const reconciliationStart = musicApiSource.search(
            /export (?:async )?function reconcilePtvMusicIdentifyCaches\(/
        );
        const cachePathStart = musicApiSource.indexOf(
            'function reconcilePersistentPtvMusicIdentifyHomeCache('
        );
        const reconciliationEnd = reconciliationStart >= 0 ?
            musicApiSource.indexOf('\nexport ', reconciliationStart + 1) : -1;
        let reconciliationSource = '';

        if (cachePathStart >= 0) {
            const end = reconciliationEnd >= 0 ? reconciliationEnd : musicApiSource.length;

            reconciliationSource = musicApiSource.slice(cachePathStart, end);
        }

        expect(reconciliationStart).toBeGreaterThanOrEqual(0);
        expect(cachePathStart).toBeGreaterThanOrEqual(0);
        expect(adoptionSource).toContain('reconcilePtvMusicIdentifyCaches(');
        expect(adoptionSource.indexOf('musicIdentifyAuthorityOverlay.confirm('))
            .toBeGreaterThan(adoptionSource.indexOf('reconcilePtvMusicIdentifyCaches('));
        expect(adoptionSource.indexOf('setHomeData('))
            .toBeGreaterThan(adoptionSource.indexOf('musicIdentifyAuthorityOverlay.confirm('));
        expect(reconciliationSource).toContain('[ true, false ].forEach(initialOnly =>');
        expect(reconciliationSource).toContain('reconcilePersistentPtvMusicIdentifyHomeCache(');
        expect(reconciliationSource).toContain('compactPtvMusicHomeSnapshotForStorage(data)');
        expect(reconciliationSource).toContain(
            'const libraryIndexKeys = Array.from(libraryIds, getMusicLibraryIndexCacheKey);'
        );
        expect(reconciliationSource).toContain(
            'beginPtvMusicRequestGeneration(musicLibraryIndexRequestGenerations, key);'
        );
        expect(reconciliationSource).toContain('updatePtvLibraryIndexCache<PtvMusicLibraryIndex>(');
        expect(reconciliationSource).toContain(
            'projectPtvMusicLibraryIndexItemForStorage(reconciled)'
        );
        expect(reconciliationSource).toContain('musicLibraryIndexWriteChains.get(key)');
        expect(reconciliationSource).not.toContain('deletePtvLibraryIndexCache(');
        expect(reconciliationSource).not.toContain('deletePtvLibraryIndexCacheByPrefix(');
        expect(reconciliationSource).not.toContain('invalidatePtvMusicHomeCache(');
        expect(reconciliationSource).not.toContain('musicHomeCache.clear(');
        expect(reconciliationSource).not.toContain('fetch(');
        expect(reconciliationSource).not.toContain('fetchPtvMusic');
        expect(reconciliationSource).not.toContain('getApiClient(');
        expect(reconciliationSource).not.toContain('getPtvMusicHome(');
        expect(reconciliationSource).not.toContain('loadMusicData(');
        expect(reconciliationSource).not.toContain('getPtvUserViews');
    });

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
