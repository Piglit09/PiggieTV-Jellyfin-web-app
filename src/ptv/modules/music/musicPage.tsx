/* eslint-disable react/jsx-no-bind, no-void */
import React, {
    createContext,
    FormEvent,
    useCallback,
    useContext,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState
} from 'react';
import { useLocation } from 'react-router-dom';

import Page from 'components/Page';
import toast from 'components/toast/toast';

import './music.scss';

import {
    getPtvApiUrl,
    getPtvCurrentUserId,
    getPtvServerId,
    hasPtvImageUrlFailed,
    setPtvFavorite
} from '../../api';
import { PTV_ASSETS } from '../../core/config';
import { getPtvPerformanceProfile } from '../../core/clientProfile';
import { getPtvMusicPlayerResourcePolicy } from './musicPlayerResourcePolicy';
import { recordPtvEvent } from '../../core/observability';
import { scheduleRouteCheck } from '../../core/router';
import {
    notifyPtvTvFocusContentReady,
    notifyPtvTvPlaybackSurfaceDisposed,
    notifyPtvTvPlaybackSurfaceReady
} from '../../core/tvFocus';
import { resolvePtvStaticAssetUrl } from '../../core/urlOrigins';
import { setPtvFullScreenMusicPresentationAvailable } from '../../services/playbackPresentationService';
import { getPtvDisplayIdentityKey } from '../../services/displayIdentity';
import { acquirePtvRuntimeOverlayOcclusion } from '../../services/runtimeOverlayOcclusion';
import PTVShell, { type PtvShellNavLink } from '../../shell/PTVShell';
import { usePtvAdminDebugVisibility } from '../../utils/usePtvAdminDebugVisibility';
import { PtvIcon } from '../icons';

import PtvMusicArtwork from './musicArtwork';
import {
    addPtvMusicItemsToQueue,
    addPtvMusicToQueue,
    getPtvMusicQueueSnapshot,
    nextPtvMusicTrack,
    playPtvMusicNext,
    playPtvMusicItemsNext,
    playPtvMusicTracks,
    previousPtvMusicTrack,
    reconcilePtvMusicQueueIdentifyMetadata,
    seekPtvMusicFromClientX,
    seekPtvMusicPercent,
    setPtvMusicRepeatMode,
    setPtvMusicVolume,
    setPtvMusicVirtualQueue,
    subscribeToPtvMusicQueue,
    togglePtvMusicMute,
    togglePtvMusicPlayPause,
    togglePtvMusicShuffle
} from './musicQueue';
import {
    canPublishPtvMusicIdentifyResult,
    isExactPtvMusicIdentifyItem,
    PtvMusicIdentifyAuthorityOverlay,
    reconcilePtvMusicIdentifyItem,
    reconcilePtvMusicIdentifyPresentationHomeData,
    reconcilePtvMusicIdentifyPresentationItems,
    type PtvMusicIdentifyAuthorityResult,
    type PtvMusicIdentifyOperation,
    type PtvMusicIdentifyOwnerState
} from './musicIdentifyAdoption';
import {
    resolvePtvMusicAlbumArtist,
    type PtvMusicAlbumArtistSource
} from './musicAlbumArtistResolution';
import {
    fetchPtvMusicAlbumTracks,
    fetchPtvMusicAlbumsByArtist,
    fetchPtvMusicItem,
    fetchPtvMusicPlaylistTracks,
    fetchPtvMusicPlaylists,
    fetchPtvMusicTracksByArtist,
    fetchPtvMusicVideos,
    getMusicImagePlaceholder,
    getMusicImageUrl,
    getPtvMusicDataCoordinator,
    getPtvMusicAlbum,
    getPtvMusicArtist,
    getPtvMusicBitrate,
    getPtvMusicCodec,
    getPtvMusicGenres,
    getPtvMusicTitle,
    invalidatePtvMusicHomeCache,
    isPtvMusicQualityMatch,
    markPtvMusicImageUrlFailed,
    PTV_MUSIC_LIBRARY_RETAIN_LIMIT,
    reconcilePtvMusicIdentifyCaches,
    searchPtvMusicMetadata,
    searchPtvMusic,
    uniquePtvMusicItems
} from './musicApi';
import PtvMusicItemMenuOverlay from './musicItemMenuOverlay';
import type { MusicContinuityHistoryEntry } from './ListeningHistoryView';
import {
    generatePtvMusicPlaylist,
    savePtvMusicPlaylist
} from './musicPlaylists';
import {
    getPtvLikedMusicItems,
    getPtvLikedMusicItemIds,
    isPtvMusicItemLiked,
    reconcilePtvLikedMusicIdentifyMetadata,
    setPtvMusicItemLiked,
    subscribeToPtvLikedMusic
} from './musicLikes';
import { PTV_MUSIC_PLAYLISTS_CHANGED_EVENT } from './musicPlaylistEvents';
import {
    getMusicCatalogLoadState,
    getMusicHeroTrackCountLabel,
    type MusicLibraryIndexLoadState
} from './musicLoadState';
import {
    reconcilePtvMusicArtistFavorite,
    reconcilePtvMusicArtistFavoriteCache
} from './musicArtistFavoriteCache';
import { buildPtvCollectionMixSeed } from './musicMixSeed';
import { PtvMusicIdentityResourceCache } from './musicIdentityCache';
import {
    getPtvMusicRouteHomeGate,
    isPtvMusicCatalogView,
    isPtvMusicHomeIndependentView
} from './musicRoutePolicy';
import { loadPtvProgressiveMusicDetail } from './musicProgressiveDetail';
import {
    beginPtvMusicRouteWork,
    isPtvMusicRouteWorkCurrent,
    retirePtvMusicRouteWork,
    settlePtvMusicRouteWork
} from './musicRouteWork';
import { buildPtvDistinctMusicRecommendationRow, buildPtvMusicRelatedTracks } from './musicRecommendations';
import type {
    PtvRecommendationScoreDistribution
} from '../recommendations/types/recommendationTypes';
import type {
    PtvMusicHomeData,
    PtvMusicItem,
    PtvMusicLibraryDebug,
    PtvMusicLibraryIndex,
    PtvMusicMetadataLookupResponse,
    PtvMusicPlaylistResult,
    PtvMusicQueueSnapshot,
    PtvMusicSection,
    PtvMusicSeed
} from './musicTypes';

const EMPTY_HOME_DATA: PtvMusicHomeData = {
    completeness: 'initial-usable',
    debug: {
        duplicateItemsRemoved: 0,
        recommendationDropReasons: [],
        recommendationRowsDropped: 0,
        recommendationRowsLoaded: 0,
        recommendationRowsRendered: 0,
        rowOverlapPercentage: 0,
        scoreDistribution: getEmptyMusicRecommendationScoreDistribution(),
        unresolvedArtistCount: 0
    },
    generatedAt: 0,
    library: null,
    nextEligibleRefreshAt: 0,
    refreshReason: 'empty-initial-state',
    sections: [],
    stats: {
        albumCount: 0,
        artistCount: 0,
        trackCount: 0
    }
};

const PTV_MUSIC_STALE_HOME_REFRESH_AGE_MS = 5 * 60 * 1000;
const PTV_MUSIC_QUEUE_GENERATION_TIMEOUT_MS = 10000;
const PTV_MUSIC_LOW_POWER_QUEUE_GENERATION_TIMEOUT_MS = 14000;
const PTV_MUSIC_FIRETV_QUEUE_GENERATION_TIMEOUT_MS = 18000;
const PTV_MUSIC_LOW_POWER_PLAYBACK_READY_DELAY_MS = 120;
const PTV_MUSIC_FIRETV_PLAYBACK_READY_DELAY_MS = 220;

function getEmptyMusicRecommendationScoreDistribution(): PtvRecommendationScoreDistribution {
    return {
        buckets: [
            { count: 0, label: '0-19' },
            { count: 0, label: '20-39' },
            { count: 0, label: '40-59' },
            { count: 0, label: '60-79' },
            { count: 0, label: '80-96' }
        ],
        max: 0,
        median: 0,
        min: 0,
        p25: 0,
        p75: 0,
        p90: 0
    };
}

const EMPTY_QUEUE_SNAPSHOT: PtvMusicQueueSnapshot = {
    autoQueueSeedItem: null,
    autoQueueSeedRevision: 0,
    currentIndex: -1,
    currentItem: null,
    isAudio: false,
    isMuted: false,
    isPlaying: false,
    isShuffled: false,
    playlist: [],
    positionTicks: 0,
    queueSourceLabel: 'Active session',
    repeatMode: 'RepeatNone',
    runtimeTicks: 0,
    volumeLevel: 50
};

const PTV_MUSIC_FALLBACK_BACKGROUND_URL = resolvePtvStaticAssetUrl(PTV_ASSETS.backgrounds.page);
const PTV_MUSIC_ROUTE_WORK_OWNER = 'music-route';
const PTV_MUSIC_SEARCH_ROUTE_WORK_OWNER = 'music-route:search';
const PTV_MUSIC_ITEM_ROUTE_WORK_OWNER = 'music-route:item';
const PTV_MUSIC_ARTIST_ROUTE_WORK_OWNER = 'music-route:artist';
const PTV_MUSIC_ALBUM_ROUTE_WORK_OWNER = 'music-route:album';
const PTV_MUSIC_PLAYLIST_ROUTE_WORK_OWNER = 'music-route:playlist';
const PTV_MUSIC_SKELETON_KEYS = [
    'music-skeleton-1',
    'music-skeleton-2',
    'music-skeleton-3',
    'music-skeleton-4',
    'music-skeleton-5',
    'music-skeleton-6',
    'music-skeleton-7',
    'music-skeleton-8'
];
type MusicAdminAction = 'identify' | 'images' | 'lookup' | 'metadata';
type MusicAdminActionOwner = Readonly<{
    isCurrent: () => boolean;
}>;

type MusicAdminContextValue = Readonly<{
    canShowDebug: boolean;
    isAdmin: boolean;
    onAction: (item: PtvMusicItem, action: MusicAdminAction, owner?: MusicAdminActionOwner) => void;
}>;

type MusicMetadataLookupState = Readonly<{
    error: string;
    isLoading: boolean;
    item: PtvMusicItem;
    response: PtvMusicMetadataLookupResponse | null;
}>;

type MusicPlaybackActionName = 'generate-play' | 'play-all' | 'play-item' | 'shuffle';
type MusicPlaybackActionQueueResult = Readonly<{
    items: PtvMusicItem[];
    seed?: number | string | null;
}>;
type MusicPlaybackActionBuildContext = Readonly<{
    isCurrent: () => boolean;
    sessionSeed: string;
    signal: AbortSignal;
}>;
type MusicPlaybackActionRequest = Readonly<{
    action: MusicPlaybackActionName;
    buildQueue: (context: MusicPlaybackActionBuildContext) => Promise<MusicPlaybackActionQueueResult> | MusicPlaybackActionQueueResult;
    generationSource: string;
    libraryId?: string;
    mediaSource?: string;
    playlistId?: string;
    preserveVirtualQueue?: boolean;
    sourceButton: string;
    startIndex?: number;
    startPositionTicks?: number;
}>;
type MusicPlaybackActionState = Readonly<{
    action: MusicPlaybackActionName;
    sourceButton: string;
    startedAt: number;
}>;
type MusicPlaybackActionTelemetry = {
    buttonIgnoredCount: number;
    duplicateRequestCount: number;
    emptyQueueCount: number;
    playAllRequests: number;
    queueGenerationFailures: number;
    shuffleRequests: number;
};
type MusicPlaybackActionContextValue = Readonly<{
    activeAction: MusicPlaybackActionState | null;
    isBusy: boolean;
    runPlaybackAction: (request: MusicPlaybackActionRequest) => Promise<boolean>;
}>;

const MUSIC_ADMIN_CONTEXT = createContext<MusicAdminContextValue>({
    canShowDebug: false,
    isAdmin: false,
    onAction: () => undefined
});
const MUSIC_PLAYBACK_ACTION_CONTEXT = createContext<MusicPlaybackActionContextValue>({
    activeAction: null,
    isBusy: false,
    runPlaybackAction: () => Promise.resolve(false)
});

type MusicView =
    | 'album'
    | 'albums'
    | 'artist'
    | 'artists'
    | 'explore'
    | 'genres'
    | 'history'
    | 'home'
    | 'item'
    | 'library'
    | 'liked'
    | 'player'
    | 'playlist'
    | 'playlists'
    | 'songs';

type MusicRouteState = Readonly<{
    id: string;
    search: string;
    view: MusicView;
}>;

type MusicPreset = Readonly<{
    label: string;
    prompt: string;
    seedKind: PtvMusicSeed['kind'];
    seedValue: string;
}>;

type ArtistDetailState = Readonly<{
    albums: PtvMusicItem[];
    artist: PtvMusicItem | null;
    error: string;
    isLoading: boolean;
    topSongs: PtvMusicItem[];
}>;

const ARTIST_ALBUM_INITIAL_LIMIT = 16;
const ARTIST_TRACK_INITIAL_LIMIT = 24;
const artistDetailCache = new PtvMusicIdentityResourceCache<ArtistDetailState>(48);

type ProgressiveArtistCallbacks = Readonly<{
    onAlbums: (items: PtvMusicItem[]) => void;
    onSummary: (item: PtvMusicItem) => void;
    onTracks: (items: PtvMusicItem[]) => void;
}>;

async function loadProgressiveArtistDetail(
    artistId: string,
    callbacks: ProgressiveArtistCallbacks,
    signal?: AbortSignal
) {
    const artist = await fetchPtvMusicItem(artistId, signal);
    const artistName = getPtvMusicTitle(artist);

    callbacks.onSummary(artist);
    await Promise.allSettled([
        fetchPtvMusicAlbumsByArtist(artistId, artistName, ARTIST_ALBUM_INITIAL_LIMIT, signal).then(callbacks.onAlbums),
        fetchPtvMusicTracksByArtist(artistId, artistName, ARTIST_TRACK_INITIAL_LIMIT, signal).then(callbacks.onTracks)
    ]);
}

type ItemDetailState = Readonly<{
    artistSource: PtvMusicAlbumArtistSource;
    error: string;
    isLoading: boolean;
    isTracksLoading: boolean;
    item: PtvMusicItem | null;
    tracks: PtvMusicItem[];
}>;

type MusicBackdropContext = Readonly<{
    albumDetail: ItemDetailState;
    artistDetail: ArtistDetailState;
    artists: PtvMusicItem[];
    currentItem: PtvMusicItem | null;
    homeData: PtvMusicHomeData;
    playlistDetail: ItemDetailState;
    route: MusicRouteState;
    seed: number;
}>;

const MUSIC_PLAYLIST_PRESETS: MusicPreset[] = [
    {
        label: 'Song Radio',
        prompt: 'Make playlist from this song',
        seedKind: 'song',
        seedValue: ''
    },
    {
        label: 'Artist Mix',
        prompt: 'Make playlist from this artist',
        seedKind: 'artist',
        seedValue: ''
    },
    {
        label: 'Genre Mix',
        prompt: 'Make 50-song genre mix',
        seedKind: 'genre',
        seedValue: ''
    },
    {
        label: 'Album Vibe',
        prompt: 'Make playlist from this album vibe',
        seedKind: 'album',
        seedValue: ''
    },
    {
        label: 'Discovery',
        prompt: 'Make 50-song discovery mix',
        seedKind: 'random',
        seedValue: ''
    },
    {
        label: 'FLAC Only',
        prompt: 'Make FLAC-only playlist',
        seedKind: 'quality',
        seedValue: 'flac'
    },
    {
        label: 'OPUS Only',
        prompt: 'Make OPUS-only playlist',
        seedKind: 'quality',
        seedValue: 'opus'
    }
];

const MUSIC_MOOD_CHIPS = [
    'Relax',
    'Focus',
    'Party',
    'Workout',
    'Commute',
    'Sleep',
    'Romance',
    'Discovery',
    'FLAC',
    'OPUS'
];

function logMusicPageEvent(name: string, detail: Record<string, unknown> = {}) {
    recordPtvEvent('render', name, detail);
}

function getMusicPerformanceNow() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function' ?
        performance.now() :
        Date.now();
}

function getMusicQueueTimeoutMs() {
    const profile = getPtvPerformanceProfile();

    if (profile.isFireTv) return PTV_MUSIC_FIRETV_QUEUE_GENERATION_TIMEOUT_MS;
    if (profile.isLowPower) return PTV_MUSIC_LOW_POWER_QUEUE_GENERATION_TIMEOUT_MS;

    return PTV_MUSIC_QUEUE_GENERATION_TIMEOUT_MS;
}

function getMusicPlaybackReadyDelayMs() {
    const profile = getPtvPerformanceProfile();

    if (profile.isFireTv) return PTV_MUSIC_FIRETV_PLAYBACK_READY_DELAY_MS;
    if (profile.isLowPower) return PTV_MUSIC_LOW_POWER_PLAYBACK_READY_DELAY_MS;

    return 0;
}

function isMusicMediaSessionReady() {
    return typeof navigator !== 'undefined' && 'mediaSession' in navigator;
}

function waitForMusicPlaybackReadiness() {
    const delayMs = getMusicPlaybackReadyDelayMs();

    return new Promise<void>(resolve => {
        if (!delayMs) {
            if (typeof requestAnimationFrame === 'function') {
                requestAnimationFrame(() => resolve());
                return;
            }

            resolve();
            return;
        }

        window.setTimeout(resolve, delayMs);
    });
}

function withMusicQueueTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    label: string,
    onTimeout: () => void
) {
    return new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(() => {
            onTimeout();
            reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
        }, timeoutMs);

        promise
            .then(result => {
                window.clearTimeout(timer);
                resolve(result);
            })
            .catch(error => {
                window.clearTimeout(timer);
                reject(error);
            });
    });
}

function useMusicPlaybackActions() {
    return useContext(MUSIC_PLAYBACK_ACTION_CONTEXT);
}

function isMusicActionActive(actions: MusicPlaybackActionContextValue, sourceButton: string) {
    return actions.activeAction?.sourceButton === sourceButton;
}

function MusicActionSpinner({ active }: Readonly<{
    active: boolean;
}>) {
    if (!active) return null;

    return <span className='ptv-music-action-spinner' aria-hidden='true' />;
}

function openMusicAdminDialog(item: PtvMusicItem, action: Exclude<MusicAdminAction, 'lookup'>) {
    const itemId = item.Id;

    if (!itemId) return Promise.resolve();

    const serverId = item.ServerId;

    if (action === 'images') {
        return import('components/imageeditor/imageeditor')
            .then(({ default: imageEditor }) => imageEditor.show({
                itemId,
                serverId
            }));
    }

    if (action === 'metadata') {
        return import('components/metadataEditor/metadataEditor')
            .then(({ default: metadataEditor }) => metadataEditor.show(itemId, serverId));
    }

    return import('components/itemidentifier/itemidentifier')
        .then(itemIdentifier => itemIdentifier.showWithAuthority(itemId, serverId));
}

function cleanupMusicRouteState() {
    document.documentElement.classList.remove('ptv-route-music-mounted');
    document.body.classList.remove('ptv-route-music-mounted');
    delete document.documentElement.dataset.ptvMusicRouteMounted;
    delete document.body.dataset.ptvMusicRouteMounted;
}

function verifyMusicShell() {
    const headerRoot = document.querySelector('.ptv-app-header-root');
    const header = document.querySelector('.ptv-skinHeader, .ptv-legacy-skinHeader, .skinHeader');
    const sidebar = document.querySelector('.ptv-sidebar, .mainDrawer');
    const missing = [
        !headerRoot && !header ? 'header' : '',
        !sidebar ? 'sidebar' : ''
    ].filter(Boolean);

    if (missing.length) {
        console.warn('[PTV Music] music-shell-missing', { missing });
        recordPtvEvent('render', 'music-shell-missing', { missing });

        const routeController = window.PTV?.routeController as {
            refresh?: () => unknown;
        } | undefined;

        routeController?.refresh?.();
        return false;
    }

    logMusicPageEvent('music-shell-ready', {
        header: Boolean(header),
        headerRoot: Boolean(headerRoot),
        sidebar: true
    });
    logMusicPageEvent('music-sidebar-preserved', {
        navItems: document.querySelectorAll('.ptv-sidebar-item, .mainDrawer .navMenuOption, .mainDrawer .ptv-custom-link').length
    });

    return true;
}

function getQueryParam(search: string, key: string) {
    const query = search.startsWith('?') ? search.slice(1) : search;
    const pairs = query ? query.split('&') : [];

    for (const pair of pairs) {
        const [rawKey, rawValue = ''] = pair.split('=');

        if (decodeURIComponent(rawKey || '') === key) {
            return decodeURIComponent(rawValue.replace(/\+/g, ' '));
        }
    }

    return '';
}

function getMusicRoute(pathname: string, search: string): MusicRouteState {
    const parts = pathname.split('/').filter(Boolean);
    const viewSegment = parts[1] || 'home';
    const searchTerm = getQueryParam(search, 'search');

    if (viewSegment === 'explore') {
        return {
            id: '',
            search: searchTerm,
            view: 'explore'
        };
    }

    if (viewSegment === 'library') {
        return {
            id: '',
            search: searchTerm,
            view: 'library'
        };
    }

    if (viewSegment === 'liked') {
        return {
            id: '',
            search: searchTerm,
            view: 'liked'
        };
    }

    if (viewSegment === 'genres' || viewSegment === 'history') {
        return {
            id: '',
            search: searchTerm,
            view: viewSegment
        };
    }

    if (viewSegment === 'player') {
        return {
            id: '',
            search: searchTerm,
            view: 'player'
        };
    }

    if (viewSegment === 'artists' || viewSegment === 'albums' || viewSegment === 'songs' || viewSegment === 'playlists') {
        return {
            id: '',
            search: searchTerm,
            view: viewSegment
        };
    }

    if (viewSegment === 'artist' || viewSegment === 'album' || viewSegment === 'item' || viewSegment === 'playlist') {
        return {
            id: decodeURIComponent(parts[2] || ''),
            search: searchTerm,
            view: viewSegment
        };
    }

    return {
        id: '',
        search: searchTerm,
        view: 'home'
    };
}

function getMusicRouteTitle(route: MusicRouteState) {
    if (route.view === 'home') return 'Music';
    if (route.view === 'item') return 'Song';
    if (route.view === 'player') return 'Now Playing';
    if (route.view === 'liked') return 'Liked Songs';
    if (route.view === 'genres') return 'Genres';
    if (route.view === 'history') return 'Listening History';
    if (route.view === 'artists') return 'Artists';
    if (route.view === 'albums') return 'Albums';
    if (route.view === 'songs') return 'Songs';
    if (route.view === 'playlists') return 'Playlists';

    return route.view.charAt(0).toUpperCase() + route.view.slice(1);
}

function getMusicContextLinks(route: MusicRouteState): PtvShellNavLink[] {
    return [
        { active: route.view === 'home', href: '#/music', icon: 'home', id: 'music-home', label: 'Home' },
        { active: route.view === 'explore', href: '#/music/explore', icon: 'shuffle', id: 'music-explore', label: 'Explore' },
        { active: route.view === 'artists', href: '#/music/artists', icon: 'person', id: 'music-artists', label: 'Artists' },
        { active: route.view === 'albums', href: '#/music/albums', icon: 'music', id: 'music-albums', label: 'Albums' },
        { active: route.view === 'songs', href: '#/music/songs', icon: 'audio', id: 'music-songs', label: 'Songs' },
        { active: route.view === 'genres', href: '#/music/genres', icon: 'filter', id: 'music-genres', label: 'Genres' },
        { active: route.view === 'playlists', href: '#/music/playlists', icon: 'playlists', id: 'music-playlists', label: 'Playlists' },
        { active: route.view === 'liked', href: '#/music/liked', icon: 'favorite', id: 'music-liked', label: 'Liked' },
        { active: route.view === 'history', href: '#/music/history', icon: 'activity', id: 'music-history', label: 'History' }
    ];
}

function shouldShowMusicToolbarTitle(view: MusicView) {
    return !['albums', 'artists', 'library', 'playlists', 'songs'].includes(view);
}

function getActiveMusicDisplayIdentityKey() {
    return getPtvDisplayIdentityKey(getPtvServerId(), getPtvCurrentUserId());
}

function recordMusicImageFailure(imageUrl: string) {
    markPtvMusicImageUrlFailed(imageUrl);
}

function getItemBackdropUrl(item: PtvMusicItem | null | undefined, size = 1200) {
    const imageUrl = getMusicImageUrl(item, size, 'Backdrop');

    if (!imageUrl || hasPtvImageUrlFailed(imageUrl)) {
        return PTV_MUSIC_FALLBACK_BACKGROUND_URL || getMusicImagePlaceholder();
    }

    return imageUrl;
}

function getMusicPageBackdropErrorHandler() {
    return (event: React.SyntheticEvent<HTMLImageElement>) => {
        const failedUrl = event.currentTarget.currentSrc || event.currentTarget.src;

        if (failedUrl && failedUrl !== PTV_MUSIC_FALLBACK_BACKGROUND_URL) {
            recordMusicImageFailure(failedUrl);
        }

        if (event.currentTarget.dataset.ptvFallbackApplied === 'true') {
            event.currentTarget.hidden = true;
            return;
        }

        event.currentTarget.dataset.ptvFallbackApplied = 'true';
        event.currentTarget.src = PTV_MUSIC_FALLBACK_BACKGROUND_URL || getMusicImagePlaceholder();
    };
}

function getMusicImageErrorHandler() {
    return (event: React.SyntheticEvent<HTMLImageElement>) => {
        const failedUrl = event.currentTarget.currentSrc || event.currentTarget.src;

        if (failedUrl && failedUrl !== getMusicImagePlaceholder()) {
            recordMusicImageFailure(failedUrl);
        }

        if (event.currentTarget.dataset.ptvFallbackApplied === 'true') {
            event.currentTarget.hidden = true;
            return;
        }

        event.currentTarget.dataset.ptvFallbackApplied = 'true';
        event.currentTarget.src = getMusicImagePlaceholder();
    };
}

function getCachedMusicImageUrl(
    item: PtvMusicItem | null | undefined,
    size = 360,
    preferredImageType: 'Backdrop' | 'Primary' | 'Thumb' = 'Primary'
) {
    const imageUrl = getMusicImageUrl(item, size, preferredImageType);

    if (!imageUrl || hasPtvImageUrlFailed(imageUrl)) return getMusicImagePlaceholder();

    return imageUrl;
}

function getMusicItemDomKey(item: PtvMusicItem, prefix: string) {
    return item.Id
        || item.ProviderIds?.MusicBrainzTrackId
        || item.ProviderIds?.MusicBrainzAlbum
        || item.ProviderIds?.MusicBrainzArtist
        || `${prefix}-${getPtvMusicTitle(item)}-${getPtvMusicArtist(item)}-${getPtvMusicAlbum(item)}`;
}

const musicHomeSectionItemCache = new WeakMap<PtvMusicHomeData, Map<string, PtvMusicItem[]>>();
const musicHomeTracksCache = new WeakMap<PtvMusicHomeData, PtvMusicItem[]>();
const musicHomeGenreNamesCache = new WeakMap<PtvMusicHomeData, string[]>();

function getSection(homeData: PtvMusicHomeData, id: string) {
    let sectionItems = musicHomeSectionItemCache.get(homeData);

    if (!sectionItems) {
        sectionItems = new Map(homeData.sections.map(section => [section.id, section.items]));
        musicHomeSectionItemCache.set(homeData, sectionItems);
    }

    return sectionItems.get(id) || [];
}

function getSectionItems(homeData: PtvMusicHomeData, id: string) {
    return getSection(homeData, id);
}

function getAllHomeTracks(homeData: PtvMusicHomeData) {
    const cached = musicHomeTracksCache.get(homeData);

    if (cached) {
        return cached;
    }

    const tracks = uniquePtvMusicItems(homeData.sections
        .filter(section => section.kind === 'track')
        .reduce<PtvMusicItem[]>((items, section) => items.concat(section.items), []));

    musicHomeTracksCache.set(homeData, tracks);

    return tracks;
}

function getQuickPicks(homeData: PtvMusicHomeData) {
    return uniquePtvMusicItems([
        ...getSectionItems(homeData, 'made-for-you'),
        ...getSectionItems(homeData, 'recommended'),
        ...getSectionItems(homeData, 'recently-played'),
        ...getSectionItems(homeData, 'high-quality'),
        ...getAllHomeTracks(homeData)
    ]).slice(0, 12);
}

function getListenAgainItems(homeData: PtvMusicHomeData) {
    return uniquePtvMusicItems([
        ...getSectionItems(homeData, 'recently-played'),
        ...getSectionItems(homeData, 'continue-listening')
    ]).slice(0, 18);
}

function hasMusicVisual(item: PtvMusicItem | null | undefined) {
    return Boolean(item?.BackdropImageTags?.length
        || item?.ParentBackdropImageTags?.length
        || item?.ImageTags?.Primary
        || item?.ImageTags?.Thumb
        || item?.ParentThumbImageTag);
}

function getStableMusicBackdropItem(items: PtvMusicItem[], seed: number) {
    if (!items.length) return null;

    const normalizedSeed = Math.abs(Math.floor(seed || Date.now()));

    return items[normalizedSeed % items.length] || items[0] || null;
}

function getHomeMusicBackdropItem(homeData: PtvMusicHomeData, artists: PtvMusicItem[], seed: number) {
    const artistCandidates = uniquePtvMusicItems([
        ...getSectionItems(homeData, 'top-artists'),
        ...artists
    ]).filter(hasMusicVisual);

    if (artistCandidates.length) {
        return getStableMusicBackdropItem(artistCandidates, seed);
    }

    return getStableMusicBackdropItem(uniquePtvMusicItems([
        ...getSectionItems(homeData, 'top-albums'),
        ...getListenAgainItems(homeData),
        ...getAllHomeTracks(homeData)
    ]).filter(hasMusicVisual), seed);
}

function normalizeMusicLookupName(value: unknown) {
    return String(value || '').trim().toLowerCase();
}

function getTrackArtistLookupNames(item: PtvMusicItem | null | undefined) {
    return new Set([
        item?.AlbumArtist,
        ...(item?.Artists || []),
        item?.Artist,
        ...(item?.AlbumArtists || []).map(entry => entry.Name),
        ...(item?.MusicBrainzArtistNames || []),
        item?.MusicBrainzArtistName,
        ...(item?.ArtistItems || []).map(entry => entry.Name),
        getPtvMusicArtist(item)
    ].map(normalizeMusicLookupName).filter(Boolean));
}

function getHomeArtistItems(homeData: PtvMusicHomeData, artists: PtvMusicItem[]) {
    return uniquePtvMusicItems([
        ...artists,
        ...homeData.sections
            .filter(section => section.kind === 'artist')
            .flatMap(section => section.items)
    ]);
}

function getPlayerArtistBackdropItem(item: PtvMusicItem | null, homeData: PtvMusicHomeData, artists: PtvMusicItem[] = []) {
    if (!item) return null;

    const artistNames = getTrackArtistLookupNames(item);

    if (!artistNames.size) return item;

    const artistItem = getHomeArtistItems(homeData, artists)
        .filter(hasMusicVisual)
        .find(candidate => artistNames.has(normalizeMusicLookupName(getPtvMusicTitle(candidate))));

    return artistItem || item;
}

function getMusicRouteBackdropItem({
    albumDetail,
    artistDetail,
    artists,
    currentItem,
    homeData,
    playlistDetail,
    route,
    seed
}: MusicBackdropContext) {
    if (route.view === 'artist') return artistDetail.artist || null;
    if (route.view === 'album') return albumDetail.item || null;
    if (route.view === 'playlist') return playlistDetail.item || null;
    if (route.view === 'item' || route.view === 'player') {
        return getPlayerArtistBackdropItem(currentItem, homeData, artists)
            || getHomeMusicBackdropItem(homeData, artists, seed);
    }

    return getHomeMusicBackdropItem(homeData, artists, seed);
}

function getGenreNames(homeData: PtvMusicHomeData) {
    const cached = musicHomeGenreNamesCache.get(homeData);
    if (cached) return cached;

    const genres = new Set<string>();

    getAllHomeTracks(homeData).forEach(item => {
        getPtvMusicGenres(item).forEach(genre => {
            genres.add(genre);
        });
    });

    const nextGenreNames = Array.from(genres).slice(0, 12);

    musicHomeGenreNamesCache.set(homeData, nextGenreNames);

    return nextGenreNames;
}

function getItemYear(item: PtvMusicItem | null | undefined) {
    const year = item?.ProductionYear || (item?.PremiereDate ? new Date(item.PremiereDate).getFullYear() : 0);

    return year ? String(year) : '';
}

function getBitrateLabel(item: PtvMusicItem | null | undefined) {
    const bitrate = getPtvMusicBitrate(item);

    if (!bitrate) return '';

    return `${Math.round(bitrate / 1000)} kbps`;
}

function getShuffledMusicItemsWithSeed(items: PtvMusicItem[], initialSeed = (Date.now() + items.length) >>> 0) {
    const shuffledItems = [...items];
    let seed = initialSeed;

    for (let index = shuffledItems.length - 1; index > 0; index -= 1) {
        seed = (seed * 1664525 + 1013904223) >>> 0;

        const targetIndex = seed % (index + 1);
        const currentItem = shuffledItems[index];

        shuffledItems[index] = shuffledItems[targetIndex];
        shuffledItems[targetIndex] = currentItem;
    }

    return {
        items: shuffledItems,
        seed: initialSeed
    };
}

function formatTicks(ticks: number) {
    const totalSeconds = Math.max(0, Math.floor(ticks / 10000000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const paddedSeconds = seconds < 10 ? `0${seconds}` : String(seconds);

    return `${minutes}:${paddedSeconds}`;
}

function getProgressPercent(snapshot: PtvMusicQueueSnapshot) {
    if (!snapshot.runtimeTicks) return 0;

    return Math.max(0, Math.min(100, (snapshot.positionTicks / snapshot.runtimeTicks) * 100));
}

function getRepeatLabel(mode: string) {
    if (mode === 'RepeatOne') return 'Repeat One';
    if (mode === 'RepeatAll') return 'Repeat All';

    return 'Repeat Off';
}

function getNextRepeatMode(mode: string) {
    if (mode === 'RepeatNone') return 'RepeatAll';
    if (mode === 'RepeatAll') return 'RepeatOne';

    return 'RepeatNone';
}

function getItemNavigationHref(item: PtvMusicItem, kind?: PtvMusicSection['kind']) {
    if (!item.Id) return '#/music';

    if (kind === 'artist' || item.Type === 'MusicArtist') return `#/music/artist/${encodeURIComponent(item.Id)}`;
    if (kind === 'album' || item.Type === 'MusicAlbum') return `#/music/album/${encodeURIComponent(item.Id)}`;
    if (item.Type === 'Playlist') return `#/music/playlist/${encodeURIComponent(item.Id)}`;

    return '';
}

function getCardMeta(item: PtvMusicItem, kind?: PtvMusicSection['kind']) {
    if (kind === 'artist' || item.Type === 'MusicArtist') return <span>Artist</span>;
    if (kind === 'album' || item.Type === 'MusicAlbum') {
        return <span>{[getPtvMusicArtist(item), getItemYear(item)].filter(Boolean).join(' - ')}</span>;
    }
    if (item.Type === 'Playlist') return <span>Playlist</span>;

    const artist = getPtvMusicArtist(item);
    const album = getPtvMusicAlbum(item);
    const artistMeta = getMusicMetadataLink(artist, getPrimaryArtistHref(item));
    const albumMeta = getMusicMetadataLink(album, getMusicAlbumHref(item));

    if (!artist && !album) return <span />;

    return (
        <>
            {artistMeta}
            {artist && album ? ' ' : ''}
            {albumMeta}
        </>
    );
}

function getMusicQualityBadges(item: PtvMusicItem) {
    return [
        getPtvMusicCodec(item).toUpperCase(),
        getBitrateLabel(item)
    ].filter(Boolean).slice(0, 2);
}

type MusicCatalogSort = 'favorites' | 'most-played' | 'recent' | 'title-asc' | 'title-desc' | 'year-desc';
type MusicCatalogFilter = 'all' | 'favorites' | 'has-year' | 'recent';

function getMusicItemDateMs(item: PtvMusicItem) {
    const dateText = item.DateCreated || item.PremiereDate || '';
    const timestamp = dateText ? Date.parse(dateText) : 0;

    return Number.isFinite(timestamp) ? timestamp : 0;
}

function getMusicItemPlayCount(item: PtvMusicItem) {
    return Number(item.UserData?.PlayCount || 0);
}

function getMusicCatalogSearchText(item: PtvMusicItem) {
    return [
        getPtvMusicTitle(item),
        getPtvMusicArtist(item),
        getPtvMusicAlbum(item),
        getItemYear(item),
        ...getPtvMusicGenres(item)
    ].join(' ').toLowerCase();
}

function filterAndSortMusicCatalogItems(
    items: PtvMusicItem[],
    searchTerm: string,
    filter: MusicCatalogFilter,
    sort: MusicCatalogSort
) {
    const query = searchTerm.trim().toLowerCase();
    const recentCutoffMs = Date.now() - (1000 * 60 * 60 * 24 * 120);

    return uniquePtvMusicItems(items)
        .filter(item => {
            return (!query || getMusicCatalogSearchText(item).includes(query))
                && (filter !== 'favorites' || Boolean(item.UserData?.IsFavorite))
                && (filter !== 'has-year' || Boolean(getItemYear(item)))
                && (filter !== 'recent' || getMusicItemDateMs(item) >= recentCutoffMs);
        })
        .sort((left, right) => {
            if (sort === 'favorites') {
                return Number(Boolean(right.UserData?.IsFavorite)) - Number(Boolean(left.UserData?.IsFavorite))
                    || getPtvMusicTitle(left).localeCompare(getPtvMusicTitle(right));
            }

            if (sort === 'most-played') {
                return getMusicItemPlayCount(right) - getMusicItemPlayCount(left)
                    || getPtvMusicTitle(left).localeCompare(getPtvMusicTitle(right));
            }

            if (sort === 'recent') {
                return getMusicItemDateMs(right) - getMusicItemDateMs(left)
                    || getPtvMusicTitle(left).localeCompare(getPtvMusicTitle(right));
            }

            if (sort === 'year-desc') {
                return Number(getItemYear(right) || 0) - Number(getItemYear(left) || 0)
                    || getPtvMusicTitle(left).localeCompare(getPtvMusicTitle(right));
            }

            return sort === 'title-desc' ?
                getPtvMusicTitle(right).localeCompare(getPtvMusicTitle(left)) :
                getPtvMusicTitle(left).localeCompare(getPtvMusicTitle(right));
        });
}

function getSeedKindForCollection(kind: PtvMusicSection['kind'], fallback: PtvMusicSeed['kind']) {
    if (kind === 'album') return 'album';
    if (kind === 'artist') return 'artist';

    return fallback;
}

function useMusicQueueSnapshot() {
    const [snapshot, setSnapshot] = useState<PtvMusicQueueSnapshot>(EMPTY_QUEUE_SNAPSHOT);

    useEffect(() => subscribeToPtvMusicQueue(setSnapshot), []);

    return snapshot;
}

function useCurrentMusicItem() {
    const [item, setItem] = useState<PtvMusicItem | null>(null);
    const revisionRef = useRef(-1);

    useEffect(() => subscribeToPtvMusicQueue(snapshot => {
        setItem(currentItem => {
            const nextItem = snapshot.currentItem;
            const nextRevision = Number((snapshot as PtvMusicQueueSnapshot & { queueRevision?: number }).queueRevision ?? -1);

            if ((currentItem?.Id || '') === (nextItem?.Id || '') && revisionRef.current === nextRevision) return currentItem;

            revisionRef.current = nextRevision;
            return nextItem;
        });
    }), []);

    return item;
}

function mapMusicHistoryEntry(entry: MusicContinuityHistoryEntry) {
    return {
        ...entry,
        item: {
            ...entry.item,
            UserData: {
                PlaybackPositionTicks: entry.positionTicks,
                Played: entry.completed
            }
        }
    };
}

function useMusicContinuityHistory() {
    const serverId = getPtvServerId();
    const userId = getPtvCurrentUserId(serverId);
    const identityKey = getPtvDisplayIdentityKey(serverId, userId);
    const [history, setHistory] = useState<MusicContinuityHistoryEntry[]>([]);

    useEffect(() => {
        let disposed = false;
        let unsubscribe = () => undefined;

        if (!identityKey) {
            setHistory([]);
            return unsubscribe;
        }

        void import('./musicContinuity').then(module => {
            if (disposed || getPtvDisplayIdentityKey(getPtvServerId(), getPtvCurrentUserId()) !== identityKey) return;

            unsubscribe = module.subscribeToPtvMusicContinuity({
                serverId,
                userId
            }, document => {
                if (disposed) return;

                setHistory((document?.recentTracks || []).map(mapMusicHistoryEntry));
            });
        });

        return () => {
            disposed = true;
            unsubscribe();
        };
    }, [identityKey, serverId, userId]);

    return history;
}

function useMusicContinuityRecentTracks() {
    const history = useMusicContinuityHistory();

    return useMemo(() => history.map(entry => entry.item), [history]);
}

function MusicQualityTags({ item }: Readonly<{ item: PtvMusicItem }>) {
    const badges = getMusicQualityBadges(item);

    if (!badges.length) return null;

    return (
        <div className='ptv-music-quality-tags' aria-label='Audio quality'>
            {badges.map(label => (
                <span key={label}>{label}</span>
            ))}
        </div>
    );
}

type MusicActionButtonProps = Readonly<{
    children?: React.ReactNode;
    className?: string;
    focusKey?: string;
    icon?: string;
    initialFocus?: string;
    isActive?: boolean;
    label: string;
    onClick: () => void;
}>;

function MusicActionButton({
    children,
    className = '',
    focusKey,
    icon,
    initialFocus,
    isActive = false,
    label,
    onClick
}: MusicActionButtonProps) {
    return (
        <button
            type='button'
            className={`ptv-music-action ${isActive ? 'ptv-music-action-active' : ''} ${className}`.trim()}
            data-ptv-focus-key={focusKey}
            data-ptv-initial-focus={initialFocus}
            aria-label={label}
            title={label}
            onClick={onClick}
        >
            {icon ? <PtvIcon name={icon} /> : null}
            {children ? <span>{children}</span> : null}
        </button>
    );
}

type MusicChipsProps = Readonly<{
    homeData: PtvMusicHomeData;
    onGenerated: (result: PtvMusicPlaylistResult) => void;
}>;

function MusicChips({ homeData, onGenerated }: MusicChipsProps) {
    const playbackActions = useMusicPlaybackActions();
    const availableGenres = getGenreNames(homeData);
    const chips = [...MUSIC_MOOD_CHIPS, ...availableGenres.slice(0, 6)]
        .filter((value, index, values) => values.indexOf(value) === index)
        .slice(0, 14);

    const makeChipMix = (chip: string) => {
        const normalizedChip = chip.toLowerCase();
        const isQualityChip = normalizedChip === 'flac' || normalizedChip === 'opus';

        void playbackActions.runPlaybackAction({
            action: 'shuffle',
            buildQueue: async ({ isCurrent, sessionSeed, signal }) => {
                const result = await generatePtvMusicPlaylist({
                    isCurrent,
                    prompt: isQualityChip ? `Make ${chip.toUpperCase()}-only playlist` : `Make 50-song ${chip} mix`,
                    sessionSeed,
                    seed: {
                        kind: isQualityChip ? 'quality' : 'genre',
                        label: chip,
                        value: normalizedChip
                    },
                    signal
                });

                onGenerated(result);

                return {
                    items: result.items,
                    seed: normalizedChip
                };
            },
            generationSource: 'music-chip',
            mediaSource: isQualityChip ? 'quality' : 'genre',
            sourceButton: `music-chip-${normalizedChip}`
        });
    };

    return (
        <div className='ptv-music-chip-row' aria-label='Music filters'>
            {chips.map(chip => (
                <button key={chip} type='button' disabled={playbackActions.isBusy} onClick={() => makeChipMix(chip)}>
                    <MusicActionSpinner active={isMusicActionActive(playbackActions, `music-chip-${chip.toLowerCase()}`)} />
                    {chip}
                </button>
            ))}
        </div>
    );
}

type MusicCardProps = Readonly<{
    artworkEager?: boolean;
    artworkRootMargin?: string;
    contextIndex?: number;
    contextItems?: PtvMusicItem[];
    item: PtvMusicItem;
    kind?: PtvMusicSection['kind'];
    onGenerated: (result: PtvMusicPlaylistResult) => void;
    shape?: 'artist' | 'compact' | 'square';
}>;

function useMusicAdminControls() {
    return useContext(MUSIC_ADMIN_CONTEXT);
}

function useMusicAdminActionOwner(item: PtvMusicItem): MusicAdminActionOwner {
    const connectedRef = useRef(false);
    const itemRef = useRef(item);

    itemRef.current = item;
    useEffect(() => {
        connectedRef.current = true;

        return () => {
            connectedRef.current = false;
        };
    }, []);

    return useMemo(() => ({
        isCurrent: () => connectedRef.current && itemRef.current === item
    }), [item]);
}

function getMusicDownloadUrl(item: PtvMusicItem) {
    if (!item.Id || item.Type !== 'Audio' || item.CanDownload === false) return '';

    try {
        return getPtvApiUrl(`Items/${item.Id}/Download`);
    } catch {
        return '';
    }
}

function getPrimaryArtistHref(item: PtvMusicItem) {
    if (item.Type === 'MusicArtist' && item.Id) {
        return `#/music/artist/${encodeURIComponent(item.Id)}`;
    }

    const artist = [
        ...(item.ArtistItems || []),
        ...(item.AlbumArtists || [])
    ].find(entry => entry.Id);

    return artist?.Id ? `#/music/artist/${encodeURIComponent(artist.Id)}` : '';
}

function getMusicAlbumHref(item: PtvMusicItem) {
    if (item.Type === 'MusicAlbum' && item.Id) {
        return `#/music/album/${encodeURIComponent(item.Id)}`;
    }

    return item.AlbumId ? `#/music/album/${encodeURIComponent(item.AlbumId)}` : '';
}

function getMusicMetadataLink(value: string, href: string) {
    if (!value) return <span />;

    if (href) {
        return <a className='ptv-music-player-meta-link' href={href}>{value}</a>;
    }

    return <span>{value}</span>;
}

function getMusicArtistLink(item: PtvMusicItem) {
    return getMusicMetadataLink(getPtvMusicArtist(item), getPrimaryArtistHref(item));
}

function getMusicAlbumLink(item: PtvMusicItem) {
    return getMusicMetadataLink(getPtvMusicAlbum(item), getMusicAlbumHref(item));
}

function getMenuSeedKind(item: PtvMusicItem): PtvMusicSeed['kind'] {
    if (item.Type === 'MusicAlbum') return 'album';
    if (item.Type === 'MusicArtist') return 'artist';

    return 'song';
}

function MusicItemMenu({ item }: Readonly<{
    item: PtvMusicItem;
}>) {
    const { isAdmin, onAction } = useMusicAdminControls();
    const adminActionOwner = useMusicAdminActionOwner(item);
    const playbackActions = useMusicPlaybackActions();
    const title = getPtvMusicTitle(item);
    const [isOpen, setOpen] = useState(false);
    const menuId = useId();
    const triggerId = useId();
    const triggerRef = useRef<HTMLButtonElement>(null);
    const artistHref = getPrimaryArtistHref(item);
    const downloadUrl = getMusicDownloadUrl(item);
    const canAddToQueue = Boolean(item.Id && item.Type === 'Audio');
    const adminActions: Array<{
        action: MusicAdminAction;
        icon: string;
        label: string;
    }> = [
        {
            action: 'lookup',
            icon: 'search',
            label: 'Find Metadata'
        },
        {
            action: 'identify',
            icon: 'metadata',
            label: 'Identify'
        },
        {
            action: 'metadata',
            icon: 'edit',
            label: 'Edit Metadata'
        },
        {
            action: 'images',
            icon: 'image',
            label: 'Images'
        }
    ];

    useEffect(() => {
        if (!isOpen) return undefined;

        return acquirePtvRuntimeOverlayOcclusion('ptv-music-item-menu');
    }, [isOpen]);

    const closeMenu = () => setOpen(false);
    const startMix = () => {
        closeMenu();
        void playbackActions.runPlaybackAction({
            action: 'generate-play',
            buildQueue: async ({ isCurrent, sessionSeed, signal }) => {
                const result = await generatePtvMusicPlaylist({
                    isCurrent,
                    limit: 50,
                    sessionSeed,
                    seed: {
                        id: item.Id,
                        item,
                        kind: getMenuSeedKind(item),
                        label: title,
                        value: title
                    },
                    signal
                });

                return {
                    items: result.items,
                    seed: item.Id || title
                };
            },
            generationSource: 'music-item-menu',
            mediaSource: getMenuSeedKind(item),
            playlistId: item.Id,
            sourceButton: `music-item-menu-mix-${item.Id || title}`
        });
    };
    const addToQueue = () => {
        closeMenu();
        void addPtvMusicToQueue(item);
    };
    const openAdminMenuAction = (action: MusicAdminAction) => {
        closeMenu();
        onAction(item, action, adminActionOwner);
    };

    return (
        <div className='ptv-music-item-menu'>
            <button
                ref={triggerRef}
                id={triggerId}
                type='button'
                className='ptv-music-item-menu-button'
                aria-controls={menuId}
                aria-expanded={isOpen}
                aria-haspopup='menu'
                aria-label={`Open actions for ${title}`}
                title={`Actions for ${title}`}
                onClick={() => setOpen(current => !current)}
            >
                <PtvIcon name='moreVertical' />
            </button>
            {isOpen ? (
                <PtvMusicItemMenuOverlay
                    id={menuId}
                    labelledBy={triggerId}
                    onClose={closeMenu}
                    triggerRef={triggerRef}
                >
                    <button type='button' role='menuitem' disabled={playbackActions.isBusy} onClick={startMix}>
                        <PtvIcon name='shuffle' />
                        <MusicActionSpinner active={isMusicActionActive(playbackActions, `music-item-menu-mix-${item.Id || title}`)} />
                        <span>Start mix</span>
                    </button>
                    <button type='button' role='menuitem' disabled={!canAddToQueue} onClick={addToQueue}>
                        <PtvIcon name='playlists' />
                        <span>Add to queue</span>
                    </button>
                    {downloadUrl ? (
                        <a role='menuitem' href={downloadUrl} download onClick={closeMenu}>
                            <PtvIcon name='download' />
                            <span>Download</span>
                        </a>
                    ) : (
                        <button type='button' role='menuitem' disabled>
                            <PtvIcon name='download' />
                            <span>Download</span>
                        </button>
                    )}
                    {artistHref ? (
                        <a role='menuitem' href={artistHref} onClick={closeMenu}>
                            <PtvIcon name='artist' />
                            <span>Go to artist</span>
                        </a>
                    ) : (
                        <button type='button' role='menuitem' disabled>
                            <PtvIcon name='artist' />
                            <span>Go to artist</span>
                        </button>
                    )}
                    {isAdmin && item.Id ? (
                        <div className='ptv-music-item-menu-section' role='presentation'>
                            <span>Metadata controls</span>
                            {adminActions.map(entry => (
                                <button
                                    key={entry.action}
                                    type='button'
                                    role='menuitem'
                                    onClick={() => openAdminMenuAction(entry.action)}
                                >
                                    <PtvIcon name={entry.icon} />
                                    <span>{entry.label}</span>
                                </button>
                            ))}
                        </div>
                    ) : null}
                </PtvMusicItemMenuOverlay>
            ) : null}
        </div>
    );
}

function MusicAdminActions({ item }: Readonly<{
    item: PtvMusicItem;
}>) {
    return <MusicItemMenu item={item} />;
}

function MusicCardActions({ item, makeRadio, playItem }: Readonly<{
    item: PtvMusicItem;
    makeRadio: () => void;
    playItem: () => void;
}>) {
    const playbackActions = useMusicPlaybackActions();
    const title = getPtvMusicTitle(item);

    return (
        <div className='ptv-music-card-actions'>
            <button type='button' disabled={playbackActions.isBusy} onClick={playItem} aria-label={`Play ${title}`}>
                <PtvIcon name='play' />
            </button>
            <button type='button' disabled={playbackActions.isBusy} onClick={makeRadio} aria-label={`Start mix from ${title}`}>
                <PtvIcon name='shuffle' />
            </button>
            <MusicItemMenu item={item} />
        </div>
    );
}

function getMetadataProviderLabel(provider: string) {
    if (provider.toLowerCase() === 'musicbrainz') return 'MusicBrainz';
    if (provider.toLowerCase() === 'discogs') return 'Discogs';

    return provider;
}

function formatMetadataCandidateTags(values?: string[]) {
    return (values || []).filter(Boolean).slice(0, 6).join(' / ');
}

function MusicMetadataLookupDialog({ canShowDebug, onClose, onRefresh, state }: Readonly<{
    canShowDebug: boolean;
    onClose: () => void;
    onRefresh: (item: PtvMusicItem) => void;
    state: MusicMetadataLookupState | null;
}>) {
    const isOpen = Boolean(state);
    const adminControls = useContext(MUSIC_ADMIN_CONTEXT);
    const adminActionOwner = useMusicAdminActionOwner(state?.item || {});

    useEffect(() => {
        if (!isOpen) return undefined;

        return acquirePtvRuntimeOverlayOcclusion('ptv-music-metadata-dialog');
    }, [isOpen]);

    if (!state) return null;

    const title = getPtvMusicTitle(state.item);
    const candidates = state.response?.candidates || [];
    const providers = state.response?.providers || [];

    return (
        <div className='ptv-music-admin-lookup-backdrop' role='presentation'>
            <section className='ptv-music-admin-lookup-dialog' role='dialog' aria-modal='true' aria-labelledby='ptvMusicMetadataLookupTitle'>
                <div className='ptv-music-admin-lookup-heading'>
                    <div>
                        <p className='ptv-music-kicker'>Song metadata</p>
                        <h2 id='ptvMusicMetadataLookupTitle'>{title}</h2>
                        <span>{[getPtvMusicArtist(state.item), getPtvMusicAlbum(state.item)].filter(Boolean).join(' ')}</span>
                    </div>
                    <button type='button' onClick={onClose} aria-label='Close metadata lookup'>
                        <PtvIcon name='delete' />
                    </button>
                </div>

                <div className='ptv-music-admin-lookup-actions'>
                    <button type='button' onClick={() => onRefresh(state.item)} disabled={state.isLoading}>
                        <PtvIcon name='refresh' />
                        <span>{state.isLoading ? 'Searching...' : 'Search Again'}</span>
                    </button>
                    <button type='button' onClick={() => void openMusicAdminDialog(state.item, 'metadata')}>
                        <PtvIcon name='metadata' />
                        <span>Edit Metadata</span>
                    </button>
                    <button type='button' onClick={() => adminControls.onAction(state.item, 'identify', adminActionOwner)}>
                        <PtvIcon name='search' />
                        <span>Identify</span>
                    </button>
                </div>

                {state.error ? <p className='ptv-music-admin-lookup-error'>{state.error}</p> : null}
                {state.isLoading ? <p className='ptv-music-admin-lookup-empty'>Searching MusicBrainz and Discogs...</p> : null}

                {!state.isLoading && providers.length ? (
                    <div className='ptv-music-admin-provider-status'>
                        {providers.map(provider => (
                            <span key={provider.provider}>
                                {getMetadataProviderLabel(provider.provider)}:
                                {' '}
                                {provider.error || `${provider.candidateCount || 0} candidates${provider.cached ? ' (cached)' : ''}`}
                            </span>
                        ))}
                    </div>
                ) : null}

                {!state.isLoading && !state.error && !candidates.length ? (
                    <p className='ptv-music-admin-lookup-empty'>No metadata candidates were found.</p>
                ) : null}

                {candidates.length ? (
                    <div className='ptv-music-admin-candidate-list'>
                        {candidates.map((candidate, index) => {
                            const providerIds = Object.entries(candidate.providerIds || {});
                            const tags = formatMetadataCandidateTags([
                                ...(candidate.genres || []),
                                ...(candidate.styles || []),
                                ...(candidate.labels || [])
                            ]);

                            return (
                                <article key={`${candidate.provider}-${candidate.url || index}`} className='ptv-music-admin-candidate'>
                                    <div>
                                        <span>{getMetadataProviderLabel(candidate.provider)}</span>
                                        <strong>{candidate.summary || [candidate.artist, candidate.title || title, candidate.album].filter(Boolean).join(' - ')}</strong>
                                        {tags ? <em>{tags}</em> : null}
                                    </div>
                                    <div className='ptv-music-admin-candidate-ids'>
                                        {providerIds.map(([key, value]) => (
                                            <code key={key}>{key}: {value}</code>
                                        ))}
                                    </div>
                                    <div className='ptv-music-admin-candidate-actions'>
                                        <span>{Math.round(candidate.confidence || 0)}%</span>
                                        {candidate.url ? (
                                            <a href={candidate.url} target='_blank' rel='noreferrer'>
                                                Open
                                            </a>
                                        ) : null}
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                ) : null}

                {canShowDebug && state.response?.diagnostics?.length ? (
                    <pre className='ptv-music-admin-lookup-debug'>
                        {state.response.diagnostics.join('\n')}
                    </pre>
                ) : null}
            </section>
        </div>
    );
}

function MusicCard({
    artworkEager = false,
    artworkRootMargin,
    contextIndex = 0,
    contextItems = [],
    item,
    kind = 'track',
    onGenerated,
    shape = 'square'
}: MusicCardProps) {
    const playbackActions = useMusicPlaybackActions();
    const title = getPtvMusicTitle(item);
    const href = getItemNavigationHref(item, kind);
    const meta = getCardMeta(item, kind);
    const recommendationReasonText = String(item.PtvRecommendationReasonText || '');
    const isTrack = kind === 'track' && item.Type !== 'Playlist' && item.Type !== 'MusicAlbum' && item.Type !== 'MusicArtist';

    const playItem = () => {
        if (isTrack) {
            const items = contextItems.length ? contextItems : [item];
            const startIndex = contextItems.length ? contextIndex : 0;

            void playbackActions.runPlaybackAction({
                action: 'play-item',
                buildQueue: () => ({ items }),
                generationSource: 'music-card',
                mediaSource: kind,
                sourceButton: `music-card-play-${item.Id || title}`,
                startIndex
            });
            return;
        }

        void playbackActions.runPlaybackAction({
            action: 'play-all',
            buildQueue: async ({ isCurrent, sessionSeed, signal }) => {
                const result = await generatePtvMusicPlaylist({
                    isCurrent,
                    limit: 50,
                    sessionSeed,
                    seed: {
                        id: item.Id,
                        item,
                        kind: getSeedKindForCollection(kind, 'random'),
                        label: title,
                        value: title
                    },
                    signal
                });

                onGenerated(result);

                return {
                    items: result.items,
                    seed: item.Id || title
                };
            },
            generationSource: 'music-card-collection',
            mediaSource: kind,
            playlistId: item.Id,
            sourceButton: `music-card-play-${item.Id || title}`
        });
    };

    const makeRadio = () => {
        void playbackActions.runPlaybackAction({
            action: 'shuffle',
            buildQueue: async ({ isCurrent, sessionSeed, signal }) => {
                const result = await generatePtvMusicPlaylist({
                    isCurrent,
                    limit: 50,
                    sessionSeed,
                    seed: {
                        id: item.Id,
                        item,
                        kind: getSeedKindForCollection(kind, 'song'),
                        label: title,
                        value: title
                    },
                    signal
                });

                onGenerated(result);

                return {
                    items: result.items,
                    seed: item.Id || title
                };
            },
            generationSource: 'music-card-radio',
            mediaSource: kind,
            playlistId: item.Id,
            sourceButton: `music-card-radio-${item.Id || title}`
        });
    };

    return (
        <article
            className={`ptv-music-card ptv-music-card-${shape} ptv-music-card-kind-${kind}`}
            data-ptv-recommendation-reasons={recommendationReasonText}
            title={recommendationReasonText || undefined}
        >
            {href ? (
                <a
                    className='ptv-music-card-art'
                    data-ptv-focus-key={`music-card:${item.Id || title}`}
                    href={href}
                    aria-label={`Open ${title}`}
                >
                    <PtvMusicArtwork
                        alt=''
                        eager={artworkEager}
                        imageUrl={getCachedMusicImageUrl(item, shape === 'artist' ? 280 : 360)}
                        placeholderUrl={getMusicImagePlaceholder()}
                        rootMargin={artworkRootMargin}
                        onSourceFailure={recordMusicImageFailure}
                    />
                    {isTrack ? <MusicQualityTags item={item} /> : null}
                </a>
            ) : (
                <button
                    type='button'
                    className='ptv-music-card-art'
                    data-ptv-focus-key={`music-card:${item.Id || title}`}
                    disabled={playbackActions.isBusy}
                    onClick={playItem}
                    aria-label={`Play ${title}`}
                >
                    <PtvMusicArtwork
                        alt=''
                        eager={artworkEager}
                        imageUrl={getCachedMusicImageUrl(item, 360)}
                        placeholderUrl={getMusicImagePlaceholder()}
                        rootMargin={artworkRootMargin}
                        onSourceFailure={recordMusicImageFailure}
                    />
                    {isTrack ? <MusicQualityTags item={item} /> : null}
                    <span><PtvIcon name='play' /></span>
                </button>
            )}
            <div className='ptv-music-card-text'>
                {href ? <a href={href}>{title}</a> : (
                    <button type='button' className='ptv-music-card-title-button' disabled={playbackActions.isBusy} onClick={playItem}>
                        {title}
                    </button>
                )}
                <p>{meta}</p>
            </div>
            <MusicCardActions item={item} makeRadio={makeRadio} playItem={playItem} />
        </article>
    );
}

type MusicRowProps = Readonly<{
    items: PtvMusicItem[];
    kind?: PtvMusicSection['kind'];
    onGenerated: (result: PtvMusicPlaylistResult) => void;
    shape?: 'artist' | 'compact' | 'square';
    subtitle?: string;
    title: string;
}>;

function MusicRow({
    items,
    kind = 'track',
    onGenerated,
    shape = 'square',
    subtitle,
    title
}: MusicRowProps) {
    const rowRef = useRef<HTMLDivElement>(null);
    const rowItems = uniquePtvMusicItems(items).slice(0, 24);
    const visibleItems = rowItems.slice(0, getPtvMusicPlayerResourcePolicy().visibleRowItemLimit);

    useEffect(() => {
        if (rowItems.length) notifyPtvTvFocusContentReady(`music-row:${title}`);
    }, [rowItems.length, title]);

    if (!rowItems.length) return null;

    const scrollRow = (direction: 1 | -1) => {
        rowRef.current?.scrollBy({
            behavior: 'smooth',
            left: direction * Math.max(340, rowRef.current.clientWidth * 0.78)
        });
    };

    return (
        <section className='ptv-music-section'>
            <div className='ptv-music-section-heading'>
                <div>
                    {subtitle ? <p className='ptv-music-kicker'>{subtitle}</p> : null}
                    <h2>{title}</h2>
                </div>
                <div className='ptv-music-row-controls'>
                    <button type='button' aria-label={`Scroll ${title} left`} onClick={() => scrollRow(-1)}>
                        <PtvIcon name='skipPrevious' />
                    </button>
                    <button type='button' aria-label={`Scroll ${title} right`} onClick={() => scrollRow(1)}>
                        <PtvIcon name='skipNext' />
                    </button>
                </div>
            </div>
            <div ref={rowRef} className={`ptv-music-row ptv-music-row-${shape}`}>
                {visibleItems.map((item, index) => (
                    <MusicCard
                        key={getMusicItemDomKey(item, title)}
                        contextIndex={index}
                        contextItems={rowItems}
                        item={item}
                        kind={kind}
                        onGenerated={onGenerated}
                        shape={shape}
                    />
                ))}
            </div>
        </section>
    );
}

type QuickPicksProps = Readonly<{
    items: PtvMusicItem[];
    subtitle?: string;
    title?: string;
}>;

function QuickPicks({ items, subtitle = 'Library radio', title = 'Quick picks' }: QuickPicksProps) {
    const playbackActions = useMusicPlaybackActions();
    const tracks = uniquePtvMusicItems(items).slice(0, 12);
    const visibleTracks = tracks.slice(0, getPtvMusicPlayerResourcePolicy().visibleQuickPickLimit);

    if (!tracks.length) return null;

    return (
        <section className='ptv-music-quick-picks'>
            <div className='ptv-music-section-heading'>
                <div>
                    <p className='ptv-music-kicker'>{subtitle}</p>
                    <h2>{title}</h2>
                </div>
                <button
                    type='button'
                    disabled={playbackActions.isBusy}
                    onClick={() => void playbackActions.runPlaybackAction({
                        action: 'play-all',
                        buildQueue: () => ({ items: tracks }),
                        generationSource: 'quick-picks',
                        mediaSource: 'track',
                        sourceButton: 'quick-picks-play-all'
                    })}
                >
                    <PtvIcon name='play' />
                    <MusicActionSpinner active={isMusicActionActive(playbackActions, 'quick-picks-play-all')} />
                    <span>Play all</span>
                </button>
            </div>
            <div className='ptv-music-quick-grid'>
                {visibleTracks.map((item, index) => (
                    <TrackCompactRow
                        key={getMusicItemDomKey(item, 'quick-picks')}
                        contextIndex={index}
                        contextItems={tracks}
                        item={item}
                    />
                ))}
            </div>
        </section>
    );
}

type MusicHomeHeroProps = Readonly<{
    homeData: PtvMusicHomeData;
    items: PtvMusicItem[];
    libraryIndexLoadState: MusicLibraryIndexLoadState;
    onGenerated: (result: PtvMusicPlaylistResult) => void;
}>;

function MusicHomeHero({ homeData, items, libraryIndexLoadState, onGenerated }: MusicHomeHeroProps) {
    const playbackActions = useMusicPlaybackActions();
    const resourcePolicy = getPtvMusicPlayerResourcePolicy();
    const heroItem = items[0] || getAllHomeTracks(homeData)[0] || null;
    const heroTracks = heroItem ? uniquePtvMusicItems([
        heroItem,
        ...items,
        ...getAllHomeTracks(homeData)
    ]).slice(0, 36) : [];
    const libraryName = homeData.library?.name || 'Music';
    const trackCountLabel = getMusicHeroTrackCountLabel(homeData, libraryIndexLoadState);

    const makeRadio = () => {
        if (!heroItem) return;

        void playbackActions.runPlaybackAction({
            action: 'generate-play',
            buildQueue: async ({ isCurrent, sessionSeed, signal }) => {
                const result = await generatePtvMusicPlaylist({
                    isCurrent,
                    prompt: `Make playlist from ${getPtvMusicTitle(heroItem)}`,
                    sessionSeed,
                    seed: {
                        id: heroItem.Id,
                        item: heroItem,
                        kind: 'song',
                        label: getPtvMusicTitle(heroItem)
                    },
                    signal
                });

                onGenerated(result);

                return {
                    items: result.items,
                    seed: heroItem.Id || getPtvMusicTitle(heroItem)
                };
            },
            generationSource: 'music-home-hero-radio',
            mediaSource: 'track',
            playlistId: heroItem.Id,
            sourceButton: 'music-home-hero-radio'
        });
    };

    if (!heroItem) {
        return (
            <section className='ptv-music-home-hero ptv-music-home-hero-empty'>
                <div className='ptv-music-home-hero-copy'>
                    <p className='ptv-music-kicker'>Music library</p>
                    <h2>{libraryName}</h2>
                    <p>Music will appear here after Jellyfin returns audio from this library.</p>
                    <a href='#/home'>
                        <PtvIcon name='home' />
                        <span>Back to Home</span>
                    </a>
                </div>
            </section>
        );
    }

    return (
        <section className='ptv-music-home-hero'>
            <div className='ptv-music-home-hero-backdrop' aria-hidden='true'>
                {resourcePolicy.renderHomeHeroBackdropImage ? <img
                    alt=''
                    decoding='async'
                    loading='eager'
                    src={getCachedMusicImageUrl(heroItem, 900, 'Backdrop')}
                    onError={getMusicImageErrorHandler()}
                /> : null}
            </div>
            <div className='ptv-music-home-hero-art'>
                <img
                    alt=''
                    decoding='async'
                    loading='eager'
                    src={getCachedMusicImageUrl(heroItem, resourcePolicy.homeArtworkWidth)}
                    onError={getMusicImageErrorHandler()}
                />
            </div>
            <div className='ptv-music-home-hero-copy'>
                <p className='ptv-music-kicker'>{libraryName}</p>
                <h2>{getPtvMusicTitle(heroItem)}</h2>
                <p>{getPtvMusicArtist(heroItem)} - {getPtvMusicAlbum(heroItem)}</p>
                <div className='ptv-music-hero-badges'>
                    <span>{getPtvMusicCodec(heroItem).toUpperCase() || 'AUDIO'}</span>
                    {getBitrateLabel(heroItem) ? <span>{getBitrateLabel(heroItem)}</span> : null}
                    {trackCountLabel ? <span>{trackCountLabel}</span> : null}
                </div>
                <div className='ptv-music-hero-actions'>
                    <button
                        type='button'
                        disabled={playbackActions.isBusy}
                        onClick={() => void playbackActions.runPlaybackAction({
                            action: 'play-all',
                            buildQueue: () => ({ items: heroTracks }),
                            generationSource: 'music-home-hero',
                            mediaSource: 'track',
                            sourceButton: 'music-home-hero-play'
                        })}
                    >
                        <PtvIcon name='play' />
                        <MusicActionSpinner active={isMusicActionActive(playbackActions, 'music-home-hero-play')} />
                        <span>Play</span>
                    </button>
                    <button
                        type='button'
                        disabled={playbackActions.isBusy}
                        onClick={() => void playbackActions.runPlaybackAction({
                            action: 'shuffle',
                            buildQueue: () => getShuffledMusicItemsWithSeed(heroTracks),
                            generationSource: 'music-home-hero',
                            mediaSource: 'track',
                            sourceButton: 'music-home-hero-shuffle'
                        })}
                    >
                        <PtvIcon name='shuffle' />
                        <MusicActionSpinner active={isMusicActionActive(playbackActions, 'music-home-hero-shuffle')} />
                        <span>Shuffle</span>
                    </button>
                    <button type='button' onClick={() => void addPtvMusicToQueue(heroItem)}>
                        <PtvIcon name='playlists' />
                        <span>Add to Queue</span>
                    </button>
                    <button type='button' disabled={playbackActions.isBusy} onClick={makeRadio}>
                        <PtvIcon name='music' />
                        <MusicActionSpinner active={isMusicActionActive(playbackActions, 'music-home-hero-radio')} />
                        <span>Make Radio</span>
                    </button>
                </div>
            </div>
        </section>
    );
}

type TrackCompactRowProps = Readonly<{
    contextIndex?: number;
    contextItems?: PtvMusicItem[];
    item: PtvMusicItem;
}>;

function TrackCompactRow({
    contextIndex = 0,
    contextItems = [],
    item
}: TrackCompactRowProps) {
    const playbackActions = useMusicPlaybackActions();
    const artist = getPtvMusicArtist(item);
    const album = getPtvMusicAlbum(item);
    const playItem = () => {
        const items = contextItems.length ? contextItems : [item];
        const startIndex = contextItems.length ? contextIndex : 0;

        void playbackActions.runPlaybackAction({
            action: 'play-item',
            buildQueue: () => ({ items }),
            generationSource: 'track-compact-row',
            mediaSource: 'track',
            sourceButton: `track-compact-play-${item.Id || getPtvMusicTitle(item)}`,
            startIndex
        });
    };

    return (
        <article className='ptv-music-track-compact'>
            <button
                type='button'
                className='ptv-music-track-art'
                aria-label={`Play ${getPtvMusicTitle(item)}`}
                disabled={playbackActions.isBusy}
                onClick={playItem}
            >
                <img
                    alt=''
                    decoding='async'
                    loading='lazy'
                    src={getCachedMusicImageUrl(item, 96)}
                    onError={getMusicImageErrorHandler()}
                />
                <span><PtvIcon name='play' /></span>
            </button>
            <div>
                <button
                    type='button'
                    className='ptv-music-track-title-button'
                    disabled={playbackActions.isBusy}
                    onClick={playItem}
                >
                    {getPtvMusicTitle(item)}
                </button>
                <span>
                    {getMusicArtistLink(item)}
                    {artist && album ? ' ' : ''}
                    {getMusicAlbumLink(item)}
                </span>
            </div>
            <div className='ptv-music-track-actions'>
                <button type='button' aria-label={`Play ${getPtvMusicTitle(item)} next`} onClick={() => void playPtvMusicNext(item)}>
                    <PtvIcon name='skipNext' />
                </button>
                <MusicAdminActions item={item} />
            </div>
        </article>
    );
}

type TrackTableProps = Readonly<{
    items: PtvMusicItem[];
    limit?: number;
    title?: string;
}>;

function TrackTable({ items, limit = 24, title = 'Top songs' }: TrackTableProps) {
    const playbackActions = useMusicPlaybackActions();
    const allTracks = useMemo(() => uniquePtvMusicItems(items), [items]);
    const [visibleLimit, setVisibleLimit] = useState(limit);
    const tracks = allTracks.slice(0, visibleLimit);
    const likedIds = useLikedMusicIds();

    useEffect(() => {
        setVisibleLimit(limit);
    }, [allTracks, limit, title]);

    if (!tracks.length) return null;

    const playTrack = (index: number) => {
        void playbackActions.runPlaybackAction({
            action: 'play-item',
            buildQueue: () => ({ items: allTracks }),
            generationSource: 'track-table',
            mediaSource: 'track',
            sourceButton: `track-table-play-${title}-${index}`,
            startIndex: index
        });
    };

    const toggleFavorite = (item: PtvMusicItem) => {
        if (!item.Id) return;

        void setPtvMusicItemLiked(item, !likedIds.has(item.Id)).catch(error => {
            recordPtvEvent('render', 'music-playback-error', {
                error: getMusicErrorMessage(error),
                itemId: item.Id || null,
                stage: 'track-table-favorite'
            });
        });
    };

    return (
        <section className='ptv-music-track-table-section'>
            <div className='ptv-music-section-heading'>
                <h2>{title}</h2>
                <button
                    type='button'
                    disabled={playbackActions.isBusy}
                    onClick={() => void playbackActions.runPlaybackAction({
                        action: 'play-all',
                        buildQueue: () => ({ items: allTracks }),
                        generationSource: 'track-table',
                        mediaSource: 'track',
                        sourceButton: `track-table-play-all-${title}`
                    })}
                >
                    <PtvIcon name='play' />
                    <MusicActionSpinner active={isMusicActionActive(playbackActions, `track-table-play-all-${title}`)} />
                    <span>Play all</span>
                </button>
            </div>
            <div className='ptv-music-track-table'>
                <div className='ptv-music-track-table-head' role='row'>
                    <span>#</span>
                    <span>Title</span>
                    <span>Artist</span>
                    <span>Plays</span>
                    <span>Album</span>
                    <span>Actions</span>
                </div>
                {tracks.map((item, index) => (
                    <article key={getMusicItemDomKey(item, title)} className='ptv-music-track-row'>
                        <button
                            type='button'
                            className='ptv-music-track-art'
                            aria-label={`Play ${getPtvMusicTitle(item)}`}
                            disabled={playbackActions.isBusy}
                            onClick={() => playTrack(index)}
                        >
                            <img
                                alt=''
                                decoding='async'
                                loading='lazy'
                                src={getCachedMusicImageUrl(item, 80)}
                                onError={getMusicImageErrorHandler()}
                            />
                            <span><PtvIcon name='play' /></span>
                        </button>
                        <button
                            type='button'
                            className='ptv-music-track-title-button'
                            disabled={playbackActions.isBusy}
                            onClick={() => playTrack(index)}
                        >
                            {getPtvMusicTitle(item)}
                        </button>
                        <span>{getMusicArtistLink(item)}</span>
                        <span>{Number(item.UserData?.PlayCount || 0).toLocaleString()} plays</span>
                        <span>{getMusicAlbumLink(item)}</span>
                        <div className='ptv-music-track-actions'>
                            <button
                                type='button'
                                className={likedIds.has(item.Id || '') ? 'ptv-music-liked' : ''}
                                aria-label={likedIds.has(item.Id || '') ? `Remove ${getPtvMusicTitle(item)} from Liked Songs` : `Like ${getPtvMusicTitle(item)}`}
                                onClick={() => toggleFavorite(item)}
                            >
                                <PtvIcon name='favorite' />
                            </button>
                            <MusicAdminActions item={item} />
                        </div>
                    </article>
                ))}
            </div>
            {tracks.length < allTracks.length ? (
                <button
                    className='ptv-music-track-table-more'
                    type='button'
                    onClick={() => setVisibleLimit(current => Math.min(allTracks.length, current + 48))}
                >
                    Show more ({allTracks.length - tracks.length} remaining)
                </button>
            ) : null}
        </section>
    );
}

type SmartPlaylistPanelProps = Readonly<{
    generated: PtvMusicPlaylistResult | null;
    onGenerated: (result: PtvMusicPlaylistResult) => void;
}>;

function SmartPlaylistPanel({ generated, onGenerated }: SmartPlaylistPanelProps) {
    const playbackActions = useMusicPlaybackActions();
    const [prompt, setPrompt] = useState('Make 50-song discovery mix');
    const [seedKind, setSeedKind] = useState<PtvMusicSeed['kind']>('random');
    const [seedValue, setSeedValue] = useState('');
    const [status, setStatus] = useState('');

    const seed = useMemo<PtvMusicSeed>(() => ({
        kind: seedKind,
        label: seedValue || seedKind,
        value: seedValue
    }), [seedKind, seedValue]);

    const onSubmit = (event: FormEvent) => {
        event.preventDefault();
        setStatus('Building...');

        void generatePtvMusicPlaylist({
            prompt,
            seed
        }).then(result => {
            onGenerated(result);
            setStatus(`${result.items.length} tracks`);
        }).catch(error => {
            setStatus(error instanceof Error ? error.message : 'Could not build playlist');
        });
    };

    const applyPreset = (preset: MusicPreset) => {
        setPrompt(preset.prompt);
        setSeedKind(preset.seedKind);
        setSeedValue(preset.seedValue);
    };

    const saveGenerated = () => {
        if (!generated) return;

        setStatus('Saving...');
        void savePtvMusicPlaylist(generated.name, generated.items).then(() => {
            setStatus('Saved');
        }).catch(error => {
            setStatus(error instanceof Error ? error.message : 'Could not save playlist');
        });
    };

    return (
        <section className='ptv-music-generator-panel'>
            <div className='ptv-music-panel-heading'>
                <div>
                    <p className='ptv-music-kicker'>Smart mixes</p>
                    <h2>Radio builder</h2>
                </div>
                {status ? <p className='ptv-music-generator-status' aria-live='polite'>{status}</p> : null}
            </div>
            <div className='ptv-music-preset-grid' aria-label='Playlist presets'>
                {MUSIC_PLAYLIST_PRESETS.map(preset => (
                    <button key={preset.label} type='button' onClick={() => applyPreset(preset)}>
                        {preset.label}
                    </button>
                ))}
            </div>
            <form className='ptv-music-generator-form' onSubmit={onSubmit}>
                <label>
                    <span>Prompt</span>
                    <input
                        aria-label='Playlist prompt'
                        value={prompt}
                        onChange={event => setPrompt(event.target.value)}
                        placeholder='Make 50-song Horror Synthwave mix'
                    />
                </label>
                <label>
                    <span>Seed</span>
                    <select
                        aria-label='Seed type'
                        value={seedKind}
                        onChange={event => setSeedKind(event.target.value as PtvMusicSeed['kind'])}
                    >
                        <option value='random'>Discovery</option>
                        <option value='song'>Song</option>
                        <option value='artist'>Artist</option>
                        <option value='genre'>Genre</option>
                        <option value='album'>Album</option>
                        <option value='favorites'>Favorites</option>
                        <option value='recent'>Recently Played</option>
                        <option value='top'>Highest Played</option>
                        <option value='quality'>Quality</option>
                    </select>
                </label>
                <label>
                    <span>Value</span>
                    <input
                        aria-label='Seed value'
                        value={seedValue}
                        onChange={event => setSeedValue(event.target.value)}
                        placeholder='Genre, artist, codec, or album'
                    />
                </label>
                <button type='submit'>
                    <PtvIcon name='shuffle' />
                    <span>Generate</span>
                </button>
            </form>
            {generated ? (
                <div className='ptv-music-generated-results'>
                    <div>
                        <p className='ptv-music-kicker'>Generated</p>
                        <h3>{generated.name}</h3>
                        <span>{generated.description}</span>
                    </div>
                    <div className='ptv-music-generated-actions'>
                        <button
                            type='button'
                            disabled={playbackActions.isBusy}
                            onClick={() => void playbackActions.runPlaybackAction({
                                action: 'play-all',
                                buildQueue: () => ({ items: generated.items }),
                                generationSource: 'smart-playlist-generated',
                                mediaSource: 'generated-playlist',
                                playlistId: generated.name,
                                sourceButton: 'smart-playlist-generated-play'
                            })}
                        >
                            <PtvIcon name='play' />
                            <MusicActionSpinner active={isMusicActionActive(playbackActions, 'smart-playlist-generated-play')} />
                            <span>Play</span>
                        </button>
                        <button type='button' onClick={saveGenerated}>
                            <PtvIcon name='playlists' />
                            <span>Save</span>
                        </button>
                    </div>
                    <div className='ptv-music-generated-list'>
                        {generated.items.map((item, index) => (
                            <TrackCompactRow
                                key={getMusicItemDomKey(item, generated.name)}
                                contextIndex={index}
                                contextItems={generated.items}
                                item={item}
                            />
                        ))}
                    </div>
                </div>
            ) : null}
        </section>
    );
}

type MusicHomeViewProps = Readonly<{
    generated: PtvMusicPlaylistResult | null;
    homeData: PtvMusicHomeData;
    libraryIndexLoadState: MusicLibraryIndexLoadState;
    onGenerated: (result: PtvMusicPlaylistResult) => void;
}>;

type DeferredMusicRecommendationRowsState = Readonly<{
    homeData: PtvMusicHomeData;
    madeForYou: PtvMusicItem[];
    recommended: PtvMusicItem[];
}>;

function DeferredMusicRecommendationRows({ homeData, onGenerated }: Readonly<{
    homeData: PtvMusicHomeData;
    onGenerated: (result: PtvMusicPlaylistResult) => void;
}>) {
    const [rows, setRows] = useState<DeferredMusicRecommendationRowsState | null>(null);

    useEffect(() => {
        let disposed = false;
        const timerId = window.setTimeout(() => {
            const madeForYouSource = getSectionItems(homeData, 'made-for-you');
            const recommendedSource = getSectionItems(homeData, 'recommended');
            const newReleases = uniquePtvMusicItems([
                ...getSectionItems(homeData, 'new-music'),
                ...getSectionItems(homeData, 'recently-added-music')
            ]);
            const primaryRows = uniquePtvMusicItems([
                ...getSectionItems(homeData, 'continue-listening'),
                ...getSectionItems(homeData, 'recently-played')
            ]);
            const madeForYou = buildPtvDistinctMusicRecommendationRow(
                madeForYouSource,
                primaryRows
            );
            const recommended = buildPtvDistinctMusicRecommendationRow([
                ...recommendedSource,
                ...newReleases,
                ...getSectionItems(homeData, 'high-quality')
            ], [
                ...primaryRows,
                ...madeForYou
            ]);

            if (!disposed) {
                setRows({
                    homeData,
                    madeForYou,
                    recommended
                });
            }
        }, 0);

        return () => {
            disposed = true;
            window.clearTimeout(timerId);
        };
    }, [homeData]);

    if (rows?.homeData !== homeData) return null;

    return (
        <>
            <MusicRow
                items={rows.madeForYou}
                onGenerated={onGenerated}
                subtitle='Personalized from your library'
                title='Made For You'
            />
            <MusicRow
                items={rows.recommended}
                onGenerated={onGenerated}
                subtitle='Smart picks'
                title='Recommended'
            />
        </>
    );
}

function MusicHomeView({ generated, homeData, libraryIndexLoadState, onGenerated }: MusicHomeViewProps) {
    const continuityRecentTracks = useMusicContinuityRecentTracks();
    const listenAgain = getListenAgainItems(homeData);
    const quickPicks = getQuickPicks(homeData);
    const continueListening = uniquePtvMusicItems([
        ...continuityRecentTracks.filter(item => {
            const positionTicks = Number(item.UserData?.PlaybackPositionTicks || 0);
            const runtimeTicks = Number(item.RunTimeTicks || 0);

            return positionTicks > 0 && runtimeTicks > positionTicks && !item.UserData?.Played;
        }),
        ...getSectionItems(homeData, 'continue-listening')
    ]);
    const recentlyPlayed = uniquePtvMusicItems([
        ...continuityRecentTracks,
        ...getSectionItems(homeData, 'recently-played')
    ]);
    const resourcePolicy = getPtvMusicPlayerResourcePolicy();
    const genreSections = homeData.sections
        .filter(section => section.id.startsWith('genre-'))
        .slice(0, resourcePolicy.visibleGenreSectionLimit);
    const newReleases = uniquePtvMusicItems([
        ...getSectionItems(homeData, 'new-music'),
        ...getSectionItems(homeData, 'recently-added-music')
    ]);
    const likedSongs = getSectionItems(homeData, 'liked-songs');
    const topArtists = getSectionItems(homeData, 'top-artists');
    const topAlbums = getSectionItems(homeData, 'top-albums');

    return (
        <div className='ptv-music-view ptv-music-home-view'>
            <MusicHomeHero
                homeData={homeData}
                items={listenAgain}
                libraryIndexLoadState={libraryIndexLoadState}
                onGenerated={onGenerated}
            />
            <MusicChips homeData={homeData} onGenerated={onGenerated} />
            <MusicRow
                items={continueListening.length ? continueListening : listenAgain}
                onGenerated={onGenerated}
                subtitle='Pick up where you left off'
                title='Continue Listening'
            />
            <DeferredMusicRecommendationRows homeData={homeData} onGenerated={onGenerated} />
            <MusicRow
                items={recentlyPlayed}
                onGenerated={onGenerated}
                subtitle='Listening history'
                title='Recently Played'
            />
            <QuickPicks items={quickPicks} subtitle='Instant stations' title='Quick Mixes' />
            {genreSections.map(section => (
                <MusicRow
                    key={section.id}
                    items={section.items}
                    kind={section.kind}
                    onGenerated={onGenerated}
                    subtitle='Genre radio'
                    title={section.title}
                />
            ))}
            <SmartPlaylistPanel generated={generated} onGenerated={onGenerated} />
            <MusicRow
                items={newReleases}
                onGenerated={onGenerated}
                subtitle='Fresh in Jellyfin'
                title='New Releases'
            />
            <MusicRow
                items={likedSongs}
                onGenerated={onGenerated}
                subtitle='Favorites'
                title='Liked Songs'
            />
            <MusicRow
                items={topArtists}
                kind='artist'
                onGenerated={onGenerated}
                shape='artist'
                subtitle='Your library'
                title='Top Artists'
            />
            <MusicRow
                items={topAlbums}
                kind='album'
                onGenerated={onGenerated}
                subtitle='Your library'
                title='Top Albums'
            />
        </div>
    );
}

type MusicExploreViewProps = Readonly<{
    generated: PtvMusicPlaylistResult | null;
    homeData: PtvMusicHomeData;
    onGenerated: (result: PtvMusicPlaylistResult) => void;
    search: string;
    searchResults: PtvMusicItem[];
}>;

function MusicExploreView({
    generated,
    homeData,
    onGenerated,
    search,
    searchResults
}: MusicExploreViewProps) {
    const resourcePolicy = getPtvMusicPlayerResourcePolicy();
    const genreSections = homeData.sections
        .filter(section => section.id.startsWith('genre-'))
        .slice(0, resourcePolicy.visibleGenreSectionLimit);
    const qualityItems = getSectionItems(homeData, 'high-quality');

    return (
        <div className='ptv-music-view'>
            <MusicChips homeData={homeData} onGenerated={onGenerated} />
            {search ? (
                <MusicRow
                    items={searchResults}
                    onGenerated={onGenerated}
                    title={`Search results for "${search}"`}
                />
            ) : null}
            <QuickPicks items={getQuickPicks(homeData)} />
            {genreSections.map(section => (
                <MusicRow
                    key={section.id}
                    items={section.items}
                    onGenerated={onGenerated}
                    subtitle='Genre radio'
                    title={section.title}
                />
            ))}
            <MusicRow
                items={qualityItems.filter(item => isPtvMusicQualityMatch(item, ['flac']))}
                onGenerated={onGenerated}
                subtitle='High quality'
                title='FLAC picks'
            />
            <MusicRow
                items={qualityItems.filter(item => isPtvMusicQualityMatch(item, ['opus']))}
                onGenerated={onGenerated}
                subtitle='High quality'
                title='OPUS picks'
            />
            <SmartPlaylistPanel generated={generated} onGenerated={onGenerated} />
        </div>
    );
}

type MusicLibraryViewProps = Readonly<{
    albums: PtvMusicItem[];
    artists: PtvMusicItem[];
    canShowDebug: boolean;
    homeData: PtvMusicHomeData;
    libraryIndexLoadState: MusicLibraryIndexLoadState;
    likedSongs: PtvMusicItem[];
    onGenerated: (result: PtvMusicPlaylistResult) => void;
    playlists: PtvMusicItem[];
}>;

function MusicLibraryDebugPanel({ canShowDebug, debug }: Readonly<{
    canShowDebug: boolean;
    debug?: PtvMusicLibraryDebug;
}>) {
    if (!canShowDebug) return null;
    if (!debug) return null;

    const albumQuery = debug.queryStatus?.albums;
    const artistQuery = debug.queryStatus?.artists;
    const songQuery = debug.queryStatus?.tracks;
    const debugRows = [
        ['userId', debug.userId || 'none'],
        ['serverId', debug.serverId || 'none'],
        ['musicLibraryCount', debug.musicLibraryCount ?? 'unknown'],
        ['musicLibrariesFound', JSON.stringify(debug.musicLibrariesFound || [])],
        ['selectedMusicLibraryId', debug.selectedMusicLibraryId || 'none'],
        ['selectedParentId', debug.selectedParentId || 'none'],
        ['musicLibraryName', debug.musicLibraryName || 'none'],
        ['libraryDetectionReason', debug.libraryDetectionReason || 'none'],
        ['finalStateReason', debug.finalStateReason || 'unknown'],
        ['failedSections', debug.failedSections.length ? debug.failedSections.join(' | ') : 'none'],
        ['jellyfinArtistTotal', debug.jellyfinArtistTotal],
        ['jellyfinAlbumTotal', debug.jellyfinAlbumTotal],
        ['jellyfinTrackTotal', debug.jellyfinTrackTotal],
        ['playlistCount', debug.playlistCount],
        ['fetchedArtistCount', debug.fetchedArtistCount],
        ['fetchedAlbumCount', debug.fetchedAlbumCount],
        ['fetchedTrackCount', debug.fetchedTrackCount],
        ['albumQueryUrl', albumQuery?.url || 'none'],
        ['albumQueryParentId', albumQuery?.parentId || 'none'],
        ['albumQueryResponseCount', albumQuery?.responseCount ?? albumQuery?.count ?? 0],
        ['albumQueryFailureReason', albumQuery?.failureReason || albumQuery?.error || 'none'],
        ['artistQueryUrl', artistQuery?.url || 'none'],
        ['artistQueryParentId', artistQuery?.parentId || 'none'],
        ['artistQueryResponseCount', artistQuery?.responseCount ?? artistQuery?.count ?? 0],
        ['artistQueryFailureReason', artistQuery?.failureReason || artistQuery?.error || 'none'],
        ['songQueryUrl', songQuery?.url || 'none'],
        ['songQueryParentId', songQuery?.parentId || 'none'],
        ['songQueryResponseCount', songQuery?.responseCount ?? songQuery?.count ?? 0],
        ['songQueryFailureReason', songQuery?.failureReason || songQuery?.error || 'none'],
        ['queryStatus', JSON.stringify(debug.queryStatus || {})],
        ['totalRecordCountFromApi', JSON.stringify(debug.totalRecordCountFromApi)],
        ['pageSize', debug.pageSize],
        ['pageCount', JSON.stringify(debug.pageCount)],
        ['lastMusicQueryUrl', debug.lastMusicQueryUrl || 'none'],
        ['failedImageOwnership', 'shared-image-registry'],
        ['droppedArtistCount', debug.droppedArtistCount],
        ['droppedAlbumCount', debug.droppedAlbumCount],
        ['droppedTrackCount', debug.droppedTrackCount],
        ['dropReasons', debug.dropReasons.length ? debug.dropReasons.join(' | ') : 'none']
    ];

    return (
        <details className='ptv-music-library-debug'>
            <summary>Music library debug</summary>
            <dl>
                {debugRows.map(([label, value]) => (
                    <React.Fragment key={String(label)}>
                        <dt>{label}</dt>
                        <dd>{String(value)}</dd>
                    </React.Fragment>
                ))}
            </dl>
        </details>
    );
}

function MusicSectionTimingDebugPanel({ canShowDebug, homeData }: Readonly<{
    canShowDebug: boolean;
    homeData: PtvMusicHomeData;
}>) {
    if (!canShowDebug) return null;
    if (!homeData.sectionTimings?.length) return null;

    return (
        <details className='ptv-music-library-debug'>
            <summary>Music section timings</summary>
            <dl>
                <dt>isPartial</dt>
                <dd>{String(Boolean(homeData.isPartial))}</dd>
                {homeData.sectionTimings.map(timing => (
                    <React.Fragment key={`${timing.id}-${timing.status}`}>
                        <dt>{timing.id}</dt>
                        <dd>
                            {timing.status} - {timing.itemCount} item(s) - {timing.durationMs}ms
                            {timing.error ? ` - ${timing.error}` : ''}
                        </dd>
                    </React.Fragment>
                ))}
            </dl>
        </details>
    );
}

function MusicLibraryView({
    albums,
    artists,
    canShowDebug,
    homeData,
    libraryIndexLoadState,
    likedSongs,
    onGenerated,
    playlists
}: MusicLibraryViewProps) {
    const albumCountState = getMusicLibraryCountState(homeData, 'albums');
    const artistCountState = getMusicLibraryCountState(homeData, 'artists');
    const trackCountState = getMusicLibraryCountState(homeData, 'tracks');
    const libraryLoadState = getMusicCatalogLoadState(
        albums.length + artists.length + playlists.length,
        libraryIndexLoadState
    );

    return (
        <div className='ptv-music-view'>
            <section className='ptv-music-library-hero'>
                <p className='ptv-music-kicker'>Your collection</p>
                <h1>Library</h1>
                <div>
                    <span>{getMusicLibraryCountLabel(homeData.stats.trackCount, 'track', 'tracks', trackCountState)}</span>
                    <span>{likedSongs.length} liked songs</span>
                    <span>{getMusicLibraryCountLabel(homeData.stats.artistCount, 'artist', 'artists', artistCountState)}</span>
                    <span>{getMusicLibraryCountLabel(homeData.stats.albumCount, 'album', 'albums', albumCountState)}</span>
                    <span>{playlists.length} playlists</span>
                </div>
            </section>
            <MusicLibraryDebugPanel canShowDebug={canShowDebug} debug={homeData.libraryDebug} />
            <MusicSectionTimingDebugPanel canShowDebug={canShowDebug} homeData={homeData} />
            {libraryLoadState === 'loading' ? <MusicLoading label='Loading library' /> : null}
            <MusicRow
                items={likedSongs}
                onGenerated={onGenerated}
                subtitle='Favorites'
                title='Liked Songs'
            />
            <MusicRow
                items={playlists}
                kind='mix'
                onGenerated={onGenerated}
                subtitle='Saved in Jellyfin'
                title='Playlists'
            />
            <MusicRow
                items={artists}
                kind='artist'
                onGenerated={onGenerated}
                shape='artist'
                subtitle='Library'
                title='Artists'
            />
            <MusicRow
                items={albums}
                kind='album'
                onGenerated={onGenerated}
                subtitle='Library'
                title='Albums'
            />
            <MusicRow
                items={getSectionItems(homeData, 'recently-added-music')}
                onGenerated={onGenerated}
                subtitle='Library'
                title='Recently added music'
            />
        </div>
    );
}

type MusicCatalogViewProps = Readonly<{
    albums: PtvMusicItem[];
    artists: PtvMusicItem[];
    homeData: PtvMusicHomeData;
    libraryIndexLoadState: MusicLibraryIndexLoadState;
    likedSongs: PtvMusicItem[];
    onGenerated: (result: PtvMusicPlaylistResult) => void;
    playlists: PtvMusicItem[];
    tracks: PtvMusicItem[];
    view: Extract<MusicView, 'albums' | 'artists' | 'playlists' | 'songs'>;
}>;

type MusicCatalogHeaderProps = Readonly<{
    countLabel: string;
    filter: MusicCatalogFilter;
    onFilterChange: (value: MusicCatalogFilter) => void;
    onSearchChange: (value: string) => void;
    onSortChange: (value: MusicCatalogSort) => void;
    search: string;
    sort: MusicCatalogSort;
    subtitle: string;
    title: string;
}>;

function MusicCatalogHeader({
    countLabel,
    filter,
    onFilterChange,
    onSearchChange,
    onSortChange,
    search,
    sort,
    subtitle,
    title
}: MusicCatalogHeaderProps) {
    return (
        <section className='ptv-music-catalog-header'>
            <div className='ptv-music-catalog-title'>
                <p className='ptv-music-kicker'>Browse</p>
                <h1>{title}</h1>
                <div>
                    <span>{countLabel}</span>
                    <span>{subtitle}</span>
                </div>
            </div>
            <div className='ptv-music-catalog-controls' aria-label={`${title} browse controls`}>
                <label>
                    <span>Search</span>
                    <input
                        type='search'
                        value={search}
                        aria-label={`Search ${title}`}
                        placeholder={`Search ${title.toLowerCase()}`}
                        onChange={event => onSearchChange(event.currentTarget.value)}
                    />
                </label>
                <label>
                    <span>Sort</span>
                    <select value={sort} onChange={event => onSortChange(event.currentTarget.value as MusicCatalogSort)}>
                        <option value='title-asc'>A-Z</option>
                        <option value='title-desc'>Z-A</option>
                        <option value='recent'>Recently added</option>
                        <option value='year-desc'>Year</option>
                        <option value='most-played'>Most played</option>
                        <option value='favorites'>Favorites first</option>
                    </select>
                </label>
                <label>
                    <span>Filter</span>
                    <select value={filter} onChange={event => onFilterChange(event.currentTarget.value as MusicCatalogFilter)}>
                        <option value='all'>All</option>
                        <option value='favorites'>Favorites</option>
                        <option value='recent'>Recent</option>
                        <option value='has-year'>Has year</option>
                    </select>
                </label>
            </div>
        </section>
    );
}

function MusicCatalogGrid({
    emptyLabel,
    items,
    kind,
    onGenerated,
    shape = 'square'
}: Readonly<{
    emptyLabel: string;
    items: PtvMusicItem[];
    kind: PtvMusicSection['kind'];
    onGenerated: (result: PtvMusicPlaylistResult) => void;
    shape?: MusicCardProps['shape'];
}>) {
    const resourcePolicy = getPtvMusicPlayerResourcePolicy();
    const [visibleLimit, setVisibleLimit] = useState(resourcePolicy.catalogInitialCardLimit);
    const visibleItems = items.slice(0, visibleLimit);

    useEffect(() => {
        setVisibleLimit(resourcePolicy.catalogInitialCardLimit);
    }, [items, kind, resourcePolicy.catalogInitialCardLimit]);

    if (!items.length) {
        return (
            <section className='ptv-music-empty-state'>
                <PtvIcon name='music' />
                <h2>No {emptyLabel} found</h2>
                <p>Try a different search or filter.</p>
            </section>
        );
    }

    return (
        <section className={`ptv-music-catalog-grid-section ptv-music-catalog-grid-section-${kind}`}>
            <div className={`ptv-music-catalog-grid ptv-music-catalog-grid-${kind}`}>
                {visibleItems.map((item, index) => (
                    <MusicCard
                        key={getMusicItemDomKey(item, `catalog-${kind}`)}
                        artworkEager={index < resourcePolicy.catalogImmediateArtworkLimit}
                        artworkRootMargin={resourcePolicy.catalogArtworkRootMargin}
                        contextIndex={index}
                        contextItems={visibleItems}
                        item={item}
                        kind={kind}
                        onGenerated={onGenerated}
                        shape={shape}
                    />
                ))}
            </div>
            {visibleItems.length < items.length ? (
                <div className='ptv-music-catalog-load-more'>
                    <button type='button' onClick={() => setVisibleLimit(limit => limit + resourcePolicy.catalogPageIncrement)}>
                        <PtvIcon name='more' />
                        <span>Show more</span>
                    </button>
                    <span>{visibleItems.length} of {items.length}</span>
                </div>
            ) : null}
        </section>
    );
}

function getMusicCatalogCountLabel(
    itemCount: number,
    visibleItemCount: number,
    itemLabel: string,
    libraryIndexLoadState: MusicLibraryIndexLoadState
) {
    if (getMusicCatalogLoadState(itemCount, libraryIndexLoadState) === 'loading') {
        return `Loading ${itemLabel}`;
    }

    return `${visibleItemCount} of ${itemCount} ${itemLabel}`;
}

function MusicCatalogLoadBoundary({
    children,
    itemCount,
    label,
    libraryIndexLoadState
}: Readonly<{
    children: React.ReactNode;
    itemCount: number;
    label: string;
    libraryIndexLoadState: MusicLibraryIndexLoadState;
}>) {
    if (getMusicCatalogLoadState(itemCount, libraryIndexLoadState) === 'loading') {
        return <MusicLoading label={label} />;
    }

    // eslint-disable-next-line react/jsx-no-useless-fragment -- Keeps the loading boundary's return type stable without adding layout markup.
    return <>{children}</>;
}

function MusicCatalogView({
    albums,
    artists,
    homeData,
    libraryIndexLoadState,
    likedSongs,
    onGenerated,
    playlists,
    tracks,
    view
}: MusicCatalogViewProps) {
    const [isCreatingPlaylist, setCreatingPlaylist] = useState(false);
    const [catalogFilter, setCatalogFilter] = useState<MusicCatalogFilter>('all');
    const [catalogSearch, setCatalogSearch] = useState('');
    const [catalogSort, setCatalogSort] = useState<MusicCatalogSort>('title-asc');
    const shouldUseHomeFallback = libraryIndexLoadState === 'failed';
    const songItems = uniquePtvMusicItems([
        ...tracks,
        ...(shouldUseHomeFallback ? getAllHomeTracks(homeData) : []),
        ...likedSongs
    ]);
    const makeDiscoveryPlaylist = useCallback(() => {
        if (isCreatingPlaylist) return;

        setCreatingPlaylist(true);
        recordPtvEvent('render', 'playlist-create-clicked', {
            source: 'music-playlists-page-new-playlist'
        });
        void generatePtvMusicPlaylist({
            prompt: 'Make 50-song discovery mix',
            seed: {
                kind: 'random',
                label: 'Discovery'
            }
        }).then(result => {
            onGenerated(result);
            return savePtvMusicPlaylist(result.name, result.items);
        }).catch(error => {
            recordPtvEvent('render', 'playlist-create-failed', {
                error: error instanceof Error ? error.message : String(error),
                source: 'music-playlists-page-new-playlist'
            });
        }).finally(() => {
            setCreatingPlaylist(false);
        });
    }, [isCreatingPlaylist, onGenerated]);

    if (view === 'artists') {
        const items = uniquePtvMusicItems([
            ...artists,
            ...(shouldUseHomeFallback ? getSectionItems(homeData, 'top-artists') : [])
        ]);
        const filteredItems = filterAndSortMusicCatalogItems(items, catalogSearch, catalogFilter, catalogSort);

        return (
            <div className='ptv-music-view ptv-music-catalog-view'>
                <MusicCatalogHeader
                    countLabel={getMusicCatalogCountLabel(items.length, filteredItems.length, 'artists', libraryIndexLoadState)}
                    filter={catalogFilter}
                    search={catalogSearch}
                    sort={catalogSort}
                    subtitle='Full artist library'
                    title='Artists'
                    onFilterChange={setCatalogFilter}
                    onSearchChange={setCatalogSearch}
                    onSortChange={setCatalogSort}
                />
                <MusicCatalogLoadBoundary
                    itemCount={items.length}
                    label='Loading artists'
                    libraryIndexLoadState={libraryIndexLoadState}
                >
                    <MusicCatalogGrid
                        emptyLabel='artists'
                        items={filteredItems}
                        kind='artist'
                        onGenerated={onGenerated}
                        shape='artist'
                    />
                </MusicCatalogLoadBoundary>
            </div>
        );
    }

    if (view === 'albums') {
        const items = uniquePtvMusicItems([
            ...albums,
            ...(shouldUseHomeFallback ? getSectionItems(homeData, 'top-albums') : [])
        ]);
        const filteredItems = filterAndSortMusicCatalogItems(items, catalogSearch, catalogFilter, catalogSort);

        return (
            <div className='ptv-music-view ptv-music-catalog-view'>
                <MusicCatalogHeader
                    countLabel={getMusicCatalogCountLabel(items.length, filteredItems.length, 'albums', libraryIndexLoadState)}
                    filter={catalogFilter}
                    search={catalogSearch}
                    sort={catalogSort}
                    subtitle='Full album library'
                    title='Albums'
                    onFilterChange={setCatalogFilter}
                    onSearchChange={setCatalogSearch}
                    onSortChange={setCatalogSort}
                />
                <MusicCatalogLoadBoundary
                    itemCount={items.length}
                    label='Loading albums'
                    libraryIndexLoadState={libraryIndexLoadState}
                >
                    <MusicCatalogGrid
                        emptyLabel='albums'
                        items={filteredItems}
                        kind='album'
                        onGenerated={onGenerated}
                    />
                </MusicCatalogLoadBoundary>
            </div>
        );
    }

    if (view === 'playlists') {
        return (
            <div className='ptv-music-view'>
                <section className='ptv-music-library-hero'>
                    <p className='ptv-music-kicker'>Browse</p>
                    <h1>Playlists</h1>
                    <div>
                        <span>{likedSongs.length ? `${likedSongs.length} liked songs` : 'Liked Music'}</span>
                        <span>{playlists.length} playlists</span>
                    </div>
                    <div className='ptv-music-library-actions'>
                        <button type='button' disabled={isCreatingPlaylist} onClick={makeDiscoveryPlaylist}>
                            <PtvIcon name='playlists' />
                            <MusicActionSpinner active={isCreatingPlaylist} />
                            <span>New Playlist</span>
                        </button>
                    </div>
                </section>
                <MusicRow
                    items={likedSongs}
                    onGenerated={onGenerated}
                    subtitle='Favorites'
                    title='Liked Music'
                />
                <MusicCatalogLoadBoundary
                    itemCount={playlists.length}
                    label='Loading playlists'
                    libraryIndexLoadState={libraryIndexLoadState}
                >
                    {!playlists.length ? (
                        <section className='ptv-music-empty-state'>
                            <PtvIcon name='playlists' />
                            <h2>No playlists yet</h2>
                            <p>Create a discovery mix or save a generated radio session to build your library.</p>
                        </section>
                    ) : null}
                </MusicCatalogLoadBoundary>
                <MusicRow
                    items={playlists}
                    kind='mix'
                    onGenerated={onGenerated}
                    subtitle='Saved in Jellyfin'
                    title='Playlists'
                />
            </div>
        );
    }

    const filteredSongItems = filterAndSortMusicCatalogItems(songItems, catalogSearch, catalogFilter, catalogSort);

    return (
        <div className='ptv-music-view ptv-music-catalog-view'>
            <MusicCatalogHeader
                countLabel={getMusicCatalogCountLabel(songItems.length, filteredSongItems.length, 'songs', libraryIndexLoadState)}
                filter={catalogFilter}
                search={catalogSearch}
                sort={catalogSort}
                subtitle='Playable tracks from your music libraries'
                title='Songs'
                onFilterChange={setCatalogFilter}
                onSearchChange={setCatalogSearch}
                onSortChange={setCatalogSort}
            />
            <MusicCatalogLoadBoundary
                itemCount={songItems.length}
                label='Loading songs'
                libraryIndexLoadState={libraryIndexLoadState}
            >
                <TrackTable items={filteredSongItems} limit={96} title='Songs' />
            </MusicCatalogLoadBoundary>
        </div>
    );
}

type LikedSongsViewProps = Readonly<{
    likedSongs: PtvMusicItem[];
}>;

function LikedSongsView({ likedSongs }: LikedSongsViewProps) {
    const playbackActions = useMusicPlaybackActions();
    const tracks = uniquePtvMusicItems(likedSongs);

    if (!tracks.length) {
        return (
            <div className='ptv-music-view'>
                <section className='ptv-music-library-hero'>
                    <p className='ptv-music-kicker'>Favorites</p>
                    <h1>Liked Songs</h1>
                    <div>
                        <span>Tap the heart on a song to build this playlist.</span>
                    </div>
                </section>
            </div>
        );
    }

    return (
        <div className='ptv-music-view'>
            <section className='ptv-music-library-hero'>
                <p className='ptv-music-kicker'>Favorites</p>
                <h1>Liked Songs</h1>
                <div>
                    <span>{tracks.length} songs</span>
                    <span>Used for PiggieTV music recommendations</span>
                </div>
            </section>
            <div className='ptv-music-hero-actions'>
                <button
                    type='button'
                    disabled={playbackActions.isBusy}
                    onClick={() => void playbackActions.runPlaybackAction({
                        action: 'play-all',
                        buildQueue: () => ({ items: tracks }),
                        generationSource: 'liked-songs',
                        mediaSource: 'track',
                        playlistId: 'liked-songs',
                        sourceButton: 'liked-songs-play'
                    })}
                >
                    <PtvIcon name='play' />
                    <MusicActionSpinner active={isMusicActionActive(playbackActions, 'liked-songs-play')} />
                    <span>Play</span>
                </button>
                <button
                    type='button'
                    disabled={playbackActions.isBusy}
                    onClick={() => void playbackActions.runPlaybackAction({
                        action: 'shuffle',
                        buildQueue: () => getShuffledMusicItemsWithSeed(tracks),
                        generationSource: 'liked-songs',
                        mediaSource: 'track',
                        playlistId: 'liked-songs',
                        sourceButton: 'liked-songs-shuffle'
                    })}
                >
                    <PtvIcon name='shuffle' />
                    <MusicActionSpinner active={isMusicActionActive(playbackActions, 'liked-songs-shuffle')} />
                    <span>Shuffle</span>
                </button>
            </div>
            <TrackTable items={tracks} title='Liked Songs' />
        </div>
    );
}

const LazyMusicGenresView = React.lazy(() => import('./MusicGenresView'));
const LazyListeningHistoryView = React.lazy(() => import('./ListeningHistoryView'));

function MusicGenresRoute({ homeData, onGenerated, tracks }: Readonly<{
    homeData: PtvMusicHomeData;
    onGenerated: (result: PtvMusicPlaylistResult) => void;
    tracks: PtvMusicItem[];
}>) {
    const playbackActions = useMusicPlaybackActions();

    const startGenreMix = (genre: string) => {
        void playbackActions.runPlaybackAction({
            action: 'generate-play',
            buildQueue: async ({ isCurrent, sessionSeed, signal }) => {
                const result = await generatePtvMusicPlaylist({
                    isCurrent,
                    limit: 50,
                    sessionSeed,
                    seed: {
                        kind: 'genre',
                        label: genre,
                        value: genre
                    },
                    signal
                });

                onGenerated(result);
                return {
                    items: result.items,
                    seed: genre
                };
            },
            generationSource: 'genre-catalog',
            mediaSource: 'genre',
            sourceButton: `genre-mix-${genre}`
        });
    };

    return (
        <React.Suspense fallback={<MusicLoading label='Loading genres' />}>
            <LazyMusicGenresView
                activeSourceButton={playbackActions.activeAction?.sourceButton || ''}
                homeData={homeData}
                isBusy={playbackActions.isBusy}
                tracks={tracks}
                onStartMix={startGenreMix}
            />
        </React.Suspense>
    );
}

function ListeningHistoryRoute() {
    const playbackActions = useMusicPlaybackActions();
    const history = useMusicContinuityHistory();

    return (
        <React.Suspense fallback={<MusicLoading label='Loading listening history' />}>
            <LazyListeningHistoryView
                history={history}
                isBusy={playbackActions.isBusy}
                onPlay={entry => void playbackActions.runPlaybackAction({
                    action: 'play-item',
                    buildQueue: () => ({ items: [entry.item] }),
                    generationSource: 'listening-history',
                    mediaSource: 'history',
                    sourceButton: `history-resume-${entry.item.Id}`,
                    startPositionTicks: entry.completed ? 0 : entry.positionTicks
                })}
            />
        </React.Suspense>
    );
}

type ArtistViewProps = Readonly<{
    detail: ArtistDetailState;
    homeData: PtvMusicHomeData;
    onFavoriteChange: (change: MusicFavoriteChange) => void;
    onGenerated: (result: PtvMusicPlaylistResult) => void;
}>;

type MusicFavoriteChange = Readonly<{
    identityKey: string | null;
    isFavorite: boolean;
    itemId: string;
}>;

const LazyArtistRelatedSection = React.lazy(() => import('./ArtistRelatedSection'));

function ArtistView({ detail, homeData, onFavoriteChange, onGenerated }: ArtistViewProps) {
    const playbackActions = useMusicPlaybackActions();
    const artist = detail.artist;
    const artistName = getPtvMusicTitle(artist);
    const singles = detail.topSongs.filter(item => !detail.albums.some(album => album.Id === item.AlbumId)).slice(0, 12);
    const artistFavorite = useMusicFavoriteItem(artist, 'artist-favorite', onFavoriteChange);

    if (detail.isLoading) return <MusicLoading label='Loading artist' />;
    if (detail.error) return <MusicError message={detail.error} />;
    if (!artist) return <MusicError message='Artist could not be loaded.' />;

    const playArtist = () => {
        void playbackActions.runPlaybackAction({
            action: 'play-all',
            buildQueue: () => ({ items: detail.topSongs }),
            generationSource: 'artist-view',
            mediaSource: 'artist',
            playlistId: artist.Id,
            sourceButton: `artist-play-${artist.Id || artistName}`
        });
    };

    const shuffleArtist = () => {
        void playbackActions.runPlaybackAction({
            action: 'shuffle',
            buildQueue: () => getShuffledMusicItemsWithSeed(detail.topSongs),
            generationSource: 'artist-view',
            mediaSource: 'artist',
            playlistId: artist.Id,
            sourceButton: `artist-shuffle-${artist.Id || artistName}`
        });
    };

    const makeArtistRadio = () => {
        void playbackActions.runPlaybackAction({
            action: 'generate-play',
            buildQueue: async ({ isCurrent, sessionSeed, signal }) => {
                const result = await generatePtvMusicPlaylist({
                    isCurrent,
                    limit: 50,
                    sessionSeed,
                    seed: {
                        id: artist.Id,
                        item: artist,
                        kind: 'artist',
                        label: artistName,
                        value: artistName
                    },
                    signal
                });

                onGenerated(result);

                return {
                    items: result.items,
                    seed: artist.Id || artistName
                };
            },
            generationSource: 'artist-view-radio',
            mediaSource: 'artist',
            playlistId: artist.Id,
            sourceButton: `artist-radio-${artist.Id || artistName}`
        });
    };

    return (
        <div className='ptv-music-view ptv-music-artist-view'>
            <section className='ptv-music-artist-hero'>
                <div className='ptv-music-artist-backdrop'>
                    <img alt='' decoding='async' loading='eager' src={getItemBackdropUrl(artist)} onError={getMusicPageBackdropErrorHandler()} />
                </div>
                <div className='ptv-music-artist-copy'>
                    <p className='ptv-music-kicker'>Artist</p>
                    <h1>{artistName}</h1>
                    <p>{artist.Overview || `${detail.topSongs.length} tracks in your PiggieTV library`}</p>
                    <div className='ptv-music-artist-actions'>
                        <button type='button' disabled={playbackActions.isBusy} onClick={playArtist}>
                            <PtvIcon name='play' />
                            <MusicActionSpinner active={isMusicActionActive(playbackActions, `artist-play-${artist.Id || artistName}`)} />
                            <span>Play</span>
                        </button>
                        <button type='button' disabled={playbackActions.isBusy} onClick={shuffleArtist}>
                            <PtvIcon name='shuffle' />
                            <MusicActionSpinner active={isMusicActionActive(playbackActions, `artist-shuffle-${artist.Id || artistName}`)} />
                            <span>Shuffle</span>
                        </button>
                        <button type='button' disabled={playbackActions.isBusy} onClick={makeArtistRadio}>
                            <PtvIcon name='music' />
                            <MusicActionSpinner active={isMusicActionActive(playbackActions, `artist-radio-${artist.Id || artistName}`)} />
                            <span>Start Artist Mix</span>
                        </button>
                        <button type='button' aria-pressed={artistFavorite.isFavorite} onClick={artistFavorite.toggleFavorite}>
                            <PtvIcon name='favorite' />
                            <span>{artistFavorite.isFavorite ? 'Favorited' : 'Favorite'}</span>
                        </button>
                    </div>
                </div>
            </section>
            <TrackTable items={detail.topSongs} />
            <MusicRow
                items={detail.albums}
                kind='album'
                onGenerated={onGenerated}
                subtitle='Artist releases'
                title='Albums'
            />
            <MusicRow
                items={singles.length ? singles : detail.topSongs}
                onGenerated={onGenerated}
                subtitle='Artist releases'
                title='Singles & EPs'
            />
            <React.Suspense fallback={<p className='ptv-music-empty'>Finding related artists...</p>}>
                <LazyArtistRelatedSection
                    artist={artist}
                    homeData={homeData}
                    topSongs={detail.topSongs}
                >
                    {relatedArtists => relatedArtists.length ? (
                        <MusicRow
                            items={relatedArtists}
                            kind='artist'
                            onGenerated={onGenerated}
                            shape='artist'
                            subtitle='Related'
                            title='Fans might also like'
                        />
                    ) : null}
                </LazyArtistRelatedSection>
            </React.Suspense>
        </div>
    );
}

type AlbumOrPlaylistViewProps = Readonly<{
    detail: ItemDetailState;
    homeData: PtvMusicHomeData;
    kind: 'album' | 'playlist';
    onGenerated: (result: PtvMusicPlaylistResult) => void;
}>;

function getAlbumOrPlaylistLabels(kind: AlbumOrPlaylistViewProps['kind']) {
    if (kind === 'album') {
        return {
            entityName: 'Album',
            mixName: 'Album',
            trackLoadingName: 'songs',
            tracksName: 'Songs'
        };
    }

    return {
        entityName: 'Playlist',
        mixName: 'Playlist',
        trackLoadingName: 'playlist tracks',
        tracksName: 'Playlist tracks'
    };
}

const LazyAlbumRelatedSection = React.lazy(() => import('./AlbumRelatedSection'));

function AlbumOrPlaylistView({ detail, homeData, kind, onGenerated }: AlbumOrPlaylistViewProps) {
    const playbackActions = useMusicPlaybackActions();
    const item = detail.item;
    const title = getPtvMusicTitle(item);
    const favorite = useMusicFavoriteItem(item, `${kind}-favorite`);
    const labels = getAlbumOrPlaylistLabels(kind);
    const totalDurationTicks = detail.tracks.reduce((total, track) => total + Number(track.RunTimeTicks || 0), 0);

    useEffect(() => {
        if (kind !== 'album' || !item?.Id || detail.isLoading || detail.isTracksLoading) return;

        recordPtvEvent('render', 'music-album-artist-source', {
            source: detail.artistSource
        });
    }, [ detail.artistSource, detail.isLoading, detail.isTracksLoading, item?.Id, kind ]);

    if (detail.isLoading && !item) return <MusicLoading label={`Loading ${kind}`} />;
    if (detail.error) return <MusicError message={detail.error} />;
    if (!item) return <MusicError message={`${labels.entityName} could not be loaded.`} />;

    const makeRadio = () => {
        void playbackActions.runPlaybackAction({
            action: 'generate-play',
            buildQueue: async ({ isCurrent, sessionSeed, signal }) => {
                const result = await generatePtvMusicPlaylist({
                    isCurrent,
                    limit: 50,
                    sessionSeed,
                    seed: buildPtvCollectionMixSeed(item, kind, title, detail.tracks),
                    signal
                });

                onGenerated(result);

                return {
                    items: result.items,
                    seed: item.Id || title
                };
            },
            generationSource: `${kind}-radio`,
            mediaSource: kind,
            playlistId: item.Id,
            sourceButton: `${kind}-radio-${item.Id || title}`
        });
    };

    return (
        <div className='ptv-music-view ptv-music-detail-view'>
            <section className='ptv-music-detail-hero'>
                <img
                    alt=''
                    decoding='async'
                    loading='eager'
                    src={getCachedMusicImageUrl(item, 380)}
                    onError={getMusicImageErrorHandler()}
                />
                <div>
                    <p className='ptv-music-kicker'>{kind}</p>
                    <h1>{title}</h1>
                    <p>{[
                        getPtvMusicArtist(item),
                        getItemYear(item),
                        detail.isTracksLoading ? 'Loading tracks...' : `${detail.tracks.length} tracks`,
                        totalDurationTicks ? formatTicks(totalDurationTicks) : '',
                        getPtvMusicGenres(item).slice(0, 3).join(', ')
                    ].filter(Boolean).join(' - ')}</p>
                    <div className='ptv-music-detail-actions'>
                        <button
                            type='button'
                            disabled={playbackActions.isBusy || detail.isTracksLoading || !detail.tracks.length}
                            onClick={() => void playbackActions.runPlaybackAction({
                                action: 'play-all',
                                buildQueue: () => ({ items: detail.tracks }),
                                generationSource: `${kind}-view`,
                                mediaSource: kind,
                                playlistId: item.Id,
                                sourceButton: `${kind}-play-${item.Id || title}`
                            })}
                        >
                            <PtvIcon name='play' />
                            <MusicActionSpinner active={isMusicActionActive(playbackActions, `${kind}-play-${item.Id || title}`)} />
                            <span>Play</span>
                        </button>
                        <button
                            type='button'
                            disabled={playbackActions.isBusy || detail.isTracksLoading || !detail.tracks.length}
                            onClick={() => void playbackActions.runPlaybackAction({
                                action: 'shuffle',
                                buildQueue: () => getShuffledMusicItemsWithSeed(detail.tracks),
                                generationSource: `${kind}-view`,
                                mediaSource: kind,
                                playlistId: item.Id,
                                sourceButton: `${kind}-shuffle-${item.Id || title}`
                            })}
                        >
                            <PtvIcon name='shuffle' />
                            <MusicActionSpinner active={isMusicActionActive(playbackActions, `${kind}-shuffle-${item.Id || title}`)} />
                            <span>Shuffle</span>
                        </button>
                        <button type='button' disabled={playbackActions.isBusy} onClick={makeRadio}>
                            <PtvIcon name='music' />
                            <MusicActionSpinner active={isMusicActionActive(playbackActions, `${kind}-radio-${item.Id || title}`)} />
                            <span>Start {labels.mixName} Mix</span>
                        </button>
                        <button
                            type='button'
                            disabled={detail.isTracksLoading || !detail.tracks.length}
                            onClick={() => void playPtvMusicItemsNext(detail.tracks)}
                        >
                            <PtvIcon name='skipNext' />
                            <span>Play Next</span>
                        </button>
                        <button
                            type='button'
                            disabled={detail.isTracksLoading || !detail.tracks.length}
                            onClick={() => void addPtvMusicItemsToQueue(detail.tracks)}
                        >
                            <PtvIcon name='playlists' />
                            <span>Add to Queue</span>
                        </button>
                        <button type='button' aria-pressed={favorite.isFavorite} onClick={favorite.toggleFavorite}>
                            <PtvIcon name='favorite' />
                            <span>{favorite.isFavorite ? 'Favorited' : 'Favorite'}</span>
                        </button>
                        <MusicAdminActions item={item} />
                    </div>
                </div>
            </section>
            {detail.isTracksLoading ? (
                <p className='ptv-music-empty' aria-live='polite'>
                    Loading {labels.trackLoadingName}...
                </p>
            ) : (
                <TrackTable items={detail.tracks} limit={32} title={labels.tracksName} />
            )}
            {kind === 'album' ? (
                <React.Suspense fallback={<p className='ptv-music-empty'>Finding related albums...</p>}>
                    <LazyAlbumRelatedSection homeData={homeData} item={item}>
                        {relatedAlbums => relatedAlbums.length ? (
                            <MusicRow
                                items={relatedAlbums}
                                kind='album'
                                onGenerated={onGenerated}
                                subtitle='More from this artist and nearby genres'
                                title='Related Albums'
                            />
                        ) : null}
                    </LazyAlbumRelatedSection>
                </React.Suspense>
            ) : null}
        </div>
    );
}

type PlayerViewProps = Readonly<{
    homeData: PtvMusicHomeData;
    musicVideos: PtvMusicItem[];
}>;

const LazyMusicPlayerPanel = React.lazy(() => import('./MusicPlayerPanel'));
const LazyPtvMusicPlaylistModal = React.lazy(() => import('./musicPlaylistModal'));

function PlayerView({ homeData, musicVideos }: PlayerViewProps) {
    const snapshot = useMusicQueueSnapshot();
    const item = snapshot.currentItem;
    const hasLoadedItem = Boolean(item);
    const playerRef = useRef<HTMLDivElement>(null);
    const autoQueueSeedItem = snapshot.autoQueueSeedItem || item;
    const resourcePolicy = getPtvMusicPlayerResourcePolicy();
    const progress = getProgressPercent(snapshot);
    const [relatedItems, setRelatedItems] = useState<PtvMusicItem[]>([]);
    const [isRelatedLoading, setIsRelatedLoading] = useState(false);
    const [playlistModalItem, setPlaylistModalItem] = useState<PtvMusicItem | null>(null);
    const { isLiked, toggleLiked } = useLikedMusicItem(item, 'player-page-favorite');
    const relatedPool = useMemo(() => getAllHomeTracks(homeData), [homeData]);
    const visibleRelatedItems = relatedItems.filter(relatedItem => relatedItem.Id !== item?.Id);
    const playerBackdropItem = useMemo(() => getPlayerArtistBackdropItem(item, homeData), [homeData, item]);
    const playNextFromVisibleQueue = () => nextPtvMusicTrack();

    useEffect(() => {
        recordPtvEvent('render', 'music-player-mounted', {
            itemId: item?.Id || null,
            route: 'page'
        });
    }, [item?.Id]);

    useEffect(() => {
        const player = playerRef.current;

        if (!hasLoadedItem || !player) {
            setPtvFullScreenMusicPresentationAvailable(false);
            return;
        }

        setPtvFullScreenMusicPresentationAvailable(true);
        notifyPtvTvPlaybackSurfaceReady(player, 'full-screen-player');

        return () => {
            setPtvFullScreenMusicPresentationAvailable(false);
            notifyPtvTvPlaybackSurfaceDisposed(player, 'full-screen-player');
        };
    }, [hasLoadedItem]);

    useEffect(() => {
        let disposed = false;

        if (!autoQueueSeedItem) {
            setRelatedItems([]);
            setIsRelatedLoading(false);
            return () => {
                disposed = true;
            };
        }

        setIsRelatedLoading(true);
        const timerId = window.setTimeout(() => {
            void buildPtvMusicRelatedTracks(autoQueueSeedItem, {
                limit: 24,
                pool: relatedPool
            }).then(items => {
                if (disposed) return;

                setRelatedItems(items);
                setPtvMusicVirtualQueue(autoQueueSeedItem, items, 'player-related');
            }).catch(error => {
                if (disposed) return;

                recordPtvEvent('render', 'music-player-related-failed', {
                    error: getMusicErrorMessage(error),
                    itemId: autoQueueSeedItem.Id || null
                });
                setRelatedItems([]);
            }).finally(() => {
                if (!disposed) {
                    setIsRelatedLoading(false);
                }
            });
        }, 0);

        return () => {
            disposed = true;
            window.clearTimeout(timerId);
        };
    }, [autoQueueSeedItem, relatedPool, snapshot.autoQueueSeedRevision]);

    if (!item) {
        return (
            <div className='ptv-music-view'>
                <section className='ptv-music-player-empty'>
                    <PtvIcon name='music' />
                    <h1>No track playing</h1>
                    <p>Start a song from Home, Explore, Library, an artist, or an album.</p>
                    <a href='#/music'>Go to Music Home</a>
                </section>
            </div>
        );
    }

    return (
        <div
            ref={playerRef}
            className='ptv-music-view ptv-music-now-playing-view ptv-music-fullscreen-player'
            data-ptv-focus-scope='full-screen-player'
            data-ptv-playback-surface='full-screen-player'
        >
            <div className='ptv-music-now-playing-backdrop' aria-hidden='true'>
                {resourcePolicy.renderPlayerBackdropImage ? <img
                    alt=''
                    decoding='async'
                    loading='eager'
                    src={getItemBackdropUrl(playerBackdropItem || item, 1200)}
                    onError={getMusicPageBackdropErrorHandler()}
                /> : null}
            </div>
            <section className='ptv-music-now-playing-main'>
                <div className='ptv-music-song-video-toggle'>
                    <button type='button' className='ptv-music-toggle-active'>Song</button>
                    {musicVideos.length ? <button type='button'>Video</button> : null}
                </div>
                <img
                    className='ptv-music-now-playing-art'
                    alt=''
                    decoding='async'
                    loading='eager'
                    src={getCachedMusicImageUrl(item, resourcePolicy.artworkWidth)}
                    onError={getMusicImageErrorHandler()}
                />
                <div className='ptv-music-now-playing-meta'>
                    <h1>{getPtvMusicTitle(item)}</h1>
                    <p>
                        {getMusicArtistLink(item)}
                        {getPtvMusicArtist(item) && getPtvMusicAlbum(item) ? ' · ' : ''}
                        {getMusicAlbumLink(item)}
                    </p>
                    <div>
                        <span>{getPtvMusicCodec(item).toUpperCase() || 'AUDIO'}</span>
                        {getBitrateLabel(item) ? <span>{getBitrateLabel(item)}</span> : null}
                    </div>
                </div>
                <div
                    className='ptv-music-now-playing-progress'
                    style={{ '--ptv-music-progress': `${progress}%` } as React.CSSProperties}
                >
                    <input
                        type='range'
                        min={0}
                        max={100}
                        step={0.1}
                        value={progress}
                        aria-label='Seek'
                        onPointerDown={event => seekPtvMusicFromClientX(event.clientX, event.currentTarget)}
                        onChange={event => seekPtvMusicPercent(Number(event.target.value))}
                    />
                    <div>
                        <span>{formatTicks(snapshot.positionTicks)}</span>
                        <span>{formatTicks(snapshot.runtimeTicks)}</span>
                    </div>
                </div>
                <div className='ptv-music-now-playing-controls'>
                    <MusicActionButton icon='shuffle' isActive={snapshot.isShuffled} label='Shuffle' onClick={() => togglePtvMusicShuffle()} />
                    <MusicActionButton icon='skipPrevious' label='Previous' onClick={() => void previousPtvMusicTrack()} />
                    <MusicActionButton
                        icon='favorite'
                        isActive={isLiked}
                        label={isLiked ? 'Remove from Liked Songs' : 'Like song'}
                        onClick={toggleLiked}
                    />
                    <MusicActionButton
                        className='ptv-music-action-primary'
                        focusKey='full-screen-player:primary'
                        icon={snapshot.isPlaying ? 'pause' : 'play'}
                        initialFocus='full-screen-player-primary'
                        label={snapshot.isPlaying ? 'Pause' : 'Play'}
                        onClick={() => void togglePtvMusicPlayPause()}
                    />
                    <MusicActionButton icon='skipNext' label='Next' onClick={() => void playNextFromVisibleQueue()} />
                    <MusicActionButton
                        icon='refresh'
                        isActive={snapshot.repeatMode !== 'RepeatNone'}
                        label={getRepeatLabel(snapshot.repeatMode)}
                        onClick={() => setPtvMusicRepeatMode(getNextRepeatMode(snapshot.repeatMode))}
                    >
                        {snapshot.repeatMode === 'RepeatOne' ? '1' : null}
                    </MusicActionButton>
                    <MusicActionButton
                        className='ptv-music-action-add'
                        label='Add to playlist'
                        onClick={() => setPlaylistModalItem(item)}
                    >
                        +
                    </MusicActionButton>
                </div>
                <div className='ptv-music-volume-strip'>
                    <button type='button' aria-label='Mute' onClick={() => togglePtvMusicMute()}>
                        <PtvIcon name='volume' />
                    </button>
                    <input
                        type='range'
                        min={0}
                        max={100}
                        value={snapshot.volumeLevel}
                        aria-label='Volume'
                        onChange={event => setPtvMusicVolume(Number(event.target.value))}
                    />
                    <span>{snapshot.isMuted ? 'Muted' : `${snapshot.volumeLevel}%`}</span>
                </div>
            </section>
            <React.Suspense fallback={(
                <aside className='ptv-music-player-panel ptv-music-player-panel-loading' aria-live='polite'>
                    Loading queue tools...
                </aside>
            )}>
                <LazyMusicPlayerPanel
                    isRelatedLoading={isRelatedLoading}
                    item={item}
                    onAddToPlaylist={setPlaylistModalItem}
                    relatedItems={visibleRelatedItems}
                    snapshot={snapshot}
                />
            </React.Suspense>
            {playlistModalItem ? (
                <React.Suspense fallback={null}>
                    <LazyPtvMusicPlaylistModal
                        isOpen
                        item={playlistModalItem}
                        onClose={() => setPlaylistModalItem(null)}
                    />
                </React.Suspense>
            ) : null}
        </div>
    );
}

type MusicLoadingProps = Readonly<{
    label: string;
}>;

function MusicLoading({ label }: MusicLoadingProps) {
    return (
        <section className='ptv-music-loading' aria-live='polite'>
            <span />
            <p>{label}</p>
            <div className='ptv-music-skeleton-grid' aria-hidden='true'>
                {PTV_MUSIC_SKELETON_KEYS.map(key => (
                    <i key={key} />
                ))}
            </div>
        </section>
    );
}

type MusicErrorProps = Readonly<{
    message: string;
}>;

function MusicError({ message }: MusicErrorProps) {
    return (
        <section className='ptv-music-error'>
            <PtvIcon name='alerts' />
            <p>{message}</p>
        </section>
    );
}

function getInitialArtistDetail(): ArtistDetailState {
    return {
        albums: [],
        artist: null,
        error: '',
        isLoading: false,
        topSongs: []
    };
}

function getInitialItemDetail(): ItemDetailState {
    return {
        artistSource: 'unknown',
        error: '',
        isLoading: false,
        isTracksLoading: false,
        item: null,
        tracks: []
    };
}

function getMusicErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function getMusicAdminDialogFailureReason(error: unknown) {
    const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
    const status = Number(record.status || record.statusCode || 0);
    const fingerprint = `${String(record.name || '')} ${String(record.message || '')}`;

    if (/abort|cancel/i.test(fingerprint)) return 'cancelled';
    if (/timeout|timed out/i.test(fingerprint)) return 'timeout';
    if (status === 401 || status === 403) return 'authentication';
    if (status === 404) return 'not-found';
    if (status >= 500) return 'server';
    if (status >= 400) return 'client';
    if (/network|failed to fetch|offline/i.test(fingerprint)) return 'network';

    return 'unknown';
}

function isMusicRouteAbortError(error: unknown) {
    const errorName = error && typeof error === 'object' && 'name' in error ?
        String((error as { name?: unknown }).name || '') :
        '';

    return errorName === 'AbortError' || /abort|cancel|superseded/i.test(getMusicErrorMessage(error));
}

function hasMusicHomeFailedSections(homeData: PtvMusicHomeData) {
    return (homeData.sectionTimings || []).some(timing => timing.status === 'error');
}

function recoverMusicPageItems(
    stage: string,
    promise: Promise<PtvMusicItem[]>,
    isCurrent: () => boolean
): Promise<PtvMusicItem[]> {
    return promise.catch(error => {
        if (isMusicRouteAbortError(error) || !isCurrent()) return [];

        recordPtvEvent('api', 'music-page-section-failed', {
            error: getMusicErrorMessage(error),
            stage
        });

        return [];
    });
}

function mergeMusicLibraryIndex(homeData: PtvMusicHomeData, libraryIndex: PtvMusicLibraryIndex): PtvMusicHomeData {
    const failedSections = new Set(libraryIndex.debug.failedSections || []);

    return {
        ...homeData,
        library: homeData.library || libraryIndex.library,
        libraryDebug: libraryIndex.debug,
        stats: {
            albumCount: failedSections.has('albums') ? homeData.stats.albumCount : libraryIndex.debug.jellyfinAlbumTotal,
            artistCount: failedSections.has('artists') ? homeData.stats.artistCount : libraryIndex.debug.jellyfinArtistTotal,
            trackCount: failedSections.has('tracks') ? homeData.stats.trackCount : libraryIndex.debug.jellyfinTrackTotal
        }
    };
}

type MusicLibraryCountSection = 'albums' | 'artists' | 'tracks';
type MusicLibraryCountState = 'failed' | 'pending' | 'ready';

function getMusicLibraryCountState(homeData: PtvMusicHomeData, section: MusicLibraryCountSection): MusicLibraryCountState {
    if (!homeData.libraryDebug) return 'pending';
    if (homeData.libraryDebug.failedSections.includes(section)) return 'failed';

    return 'ready';
}

function getMusicLibraryCountLabel(
    count: number,
    singular: string,
    plural: string,
    state: MusicLibraryCountState
) {
    if (state === 'pending') return `Loading ${plural}`;
    if (state === 'failed' && count === 0) return `Unable to load ${plural}`;

    return `${count} ${count === 1 ? singular : plural}`;
}

function mergeMusicHomeDataWithLibraryState(previous: PtvMusicHomeData, nextHomeData: PtvMusicHomeData): PtvMusicHomeData {
    if (!previous.libraryDebug) return nextHomeData;

    return {
        ...nextHomeData,
        library: nextHomeData.library || previous.library,
        libraryDebug: previous.libraryDebug,
        stats: previous.stats
    };
}

function useLikedMusicIds() {
    const [likedIds, setLikedIds] = useState<Set<string>>(() => getPtvLikedMusicItemIds());

    useEffect(() => subscribeToPtvLikedMusic(() => {
        setLikedIds(getPtvLikedMusicItemIds());
    }), []);

    return likedIds;
}

function useLikedMusicItem(item: PtvMusicItem | null, failureStage: string) {
    const [isLiked, setLiked] = useState(() => isPtvMusicItemLiked(item));

    useEffect(() => {
        setLiked(isPtvMusicItemLiked(item));

        return subscribeToPtvLikedMusic(() => {
            setLiked(isPtvMusicItemLiked(item));
        });
    }, [item]);

    const toggleLiked = () => {
        if (!item) return;

        const nextLiked = !isLiked;

        setLiked(nextLiked);
        void setPtvMusicItemLiked(item, nextLiked)
            .catch(error => {
                setLiked(!nextLiked);
                recordPtvEvent('render', 'music-playback-error', {
                    error: getMusicErrorMessage(error),
                    itemId: item.Id || null,
                    stage: failureStage
                });
            });
    };

    return {
        isLiked,
        toggleLiked
    };
}

function useMusicFavoriteItem(
    item: PtvMusicItem | null,
    failureStage: string,
    onFavoriteChange?: (change: MusicFavoriteChange) => void
) {
    const [isFavorite, setFavorite] = useState(Boolean(item?.UserData?.IsFavorite));

    useEffect(() => {
        setFavorite(Boolean(item?.UserData?.IsFavorite));
    }, [item?.Id, item?.UserData?.IsFavorite]);

    const toggleFavorite = () => {
        if (!item?.Id) return;

        const serverId = item.ServerId || getPtvServerId();
        const identityKey = getPtvDisplayIdentityKey(serverId, getPtvCurrentUserId(serverId));
        const nextFavorite = !isFavorite;
        const change = {
            identityKey,
            isFavorite: nextFavorite,
            itemId: item.Id
        };

        setFavorite(nextFavorite);
        onFavoriteChange?.(change);
        void setPtvFavorite(item.Id, nextFavorite, {
            serverId
        })
            .then(() => {
                onFavoriteChange?.(change);
            })
            .catch(error => {
                setFavorite(!nextFavorite);
                onFavoriteChange?.({
                    ...change,
                    isFavorite: !nextFavorite
                });
                toast('Favorite could not be updated');
                recordPtvEvent('render', 'music-favorite-failed', {
                    error: getMusicErrorMessage(error),
                    itemId: item.Id || null,
                    stage: failureStage
                });
            });
    };

    return {
        isFavorite,
        toggleFavorite
    };
}

export default function PiggieTvMusicPage() {
    const location = useLocation();
    const route = useMemo(() => getMusicRoute(location.pathname, location.search), [location.pathname, location.search]);
    const backgroundSeedRef = useRef(Date.now());
    const musicDeferredTimersRef = useRef<number[]>([]);
    const musicLibraryIndexActiveRequestKeyRef = useRef('');
    const musicLibraryIndexRequestIdRef = useRef(0);
    const musicMountedRef = useRef(false);
    const musicIdentifyGenerationRef = useRef(0);
    const musicRouteKeyRef = useRef(`${location.pathname}${location.search}`);
    const musicRequestIdRef = useRef(0);
    const musicRouteWorkSignalRef = useRef<AbortSignal | null>(null);
    const loadedRouteViewRef = useRef(route.view);
    const routeViewRef = useRef(route.view);
    const [homeData, setHomeData] = useState<PtvMusicHomeData>(EMPTY_HOME_DATA);
    const [playlists, setPlaylists] = useState<PtvMusicItem[]>([]);
    const [albums, setAlbums] = useState<PtvMusicItem[]>([]);
    const [artists, setArtists] = useState<PtvMusicItem[]>([]);
    const [tracks, setTracks] = useState<PtvMusicItem[]>([]);
    const [musicVideos, setMusicVideos] = useState<PtvMusicItem[]>([]);
    const [likedSongs, setLikedSongs] = useState<PtvMusicItem[]>(() => getPtvLikedMusicItems());
    const [generated, setGenerated] = useState<PtvMusicPlaylistResult | null>(null);
    const [metadataLookup, setMetadataLookup] = useState<MusicMetadataLookupState | null>(null);
    const [searchResults, setSearchResults] = useState<PtvMusicItem[]>([]);
    const [artistDetail, setArtistDetail] = useState<ArtistDetailState>(getInitialArtistDetail);
    const [albumDetail, setAlbumDetail] = useState<ItemDetailState>(getInitialItemDetail);
    const [playlistDetail, setPlaylistDetail] = useState<ItemDetailState>(getInitialItemDetail);
    const [isLoading, setLoading] = useState(true);
    const [libraryIndexLoadState, setLibraryIndexLoadState] = useState<MusicLibraryIndexLoadState>('scheduled');
    const [errorMessage, setErrorMessage] = useState('');
    const activePlaybackActionRef = useRef<MusicPlaybackActionState | null>(null);
    const activePlaybackAbortControllerRef = useRef<AbortController | null>(null);
    const playbackTelemetryRef = useRef<MusicPlaybackActionTelemetry>({
        buttonIgnoredCount: 0,
        duplicateRequestCount: 0,
        emptyQueueCount: 0,
        playAllRequests: 0,
        queueGenerationFailures: 0,
        shuffleRequests: 0
    });
    const [activePlaybackAction, setActivePlaybackAction] = useState<MusicPlaybackActionState | null>(null);
    const { canShowDebug, isAdmin } = usePtvAdminDebugVisibility();
    const currentMusicItem = useCurrentMusicItem();
    const musicDataCoordinator = useMemo(() => getPtvMusicDataCoordinator(), []);
    const musicIdentifyAuthorityOverlay = useMemo(() => new PtvMusicIdentifyAuthorityOverlay(), []);
    const musicIdentifyOwnerStateRef = useRef<PtvMusicIdentifyOwnerState | null>(null);

    musicRouteKeyRef.current = `${location.pathname}${location.search}`;
    musicIdentifyOwnerStateRef.current = {
        albumDetailItem: albumDetail.item,
        albums,
        artistDetailAlbums: artistDetail.albums,
        artistDetailArtist: artistDetail.artist,
        artists,
        homeData,
        metadataLookupItem: metadataLookup?.item || null,
        searchResults
    };
    const reconcileMusicIdentifyItem = useCallback((item: PtvMusicItem | null, requestRevision: number) => (
        musicIdentifyAuthorityOverlay.reconcileItem(getActiveMusicDisplayIdentityKey(), item, requestRevision)
    ), [musicIdentifyAuthorityOverlay]);
    const reconcileMusicIdentifyItems = useCallback((items: readonly PtvMusicItem[], requestRevision: number) => (
        musicIdentifyAuthorityOverlay.reconcileItems(getActiveMusicDisplayIdentityKey(), items, requestRevision)
    ), [musicIdentifyAuthorityOverlay]);
    const reconcileMusicIdentifyHomeData = useCallback((current: PtvMusicHomeData, requestRevision: number) => (
        musicIdentifyAuthorityOverlay.reconcileHomeData(
            getActiveMusicDisplayIdentityKey(),
            current,
            requestRevision
        )
    ), [musicIdentifyAuthorityOverlay]);
    const reconcileMusicIdentifyArtistDetail = useCallback((
        current: ArtistDetailState,
        identityKey: string | null,
        requestRevision: number
    ) => {
        const artist = musicIdentifyAuthorityOverlay.reconcileItem(
            identityKey,
            current.artist,
            requestRevision
        );
        const reconciledAlbums = musicIdentifyAuthorityOverlay.reconcileItems(
            identityKey,
            current.albums,
            requestRevision
        );
        const topSongs = musicIdentifyAuthorityOverlay.reconcileItems(
            identityKey,
            current.topSongs,
            requestRevision
        );

        if (
            artist === current.artist
            && reconciledAlbums === current.albums
            && topSongs === current.topSongs
        ) return current;

        return {
            ...current,
            albums: [ ...reconciledAlbums ],
            artist,
            topSongs: [ ...topSongs ]
        };
    }, [musicIdentifyAuthorityOverlay]);
    const reconcileArtistFavorite = useCallback((change: MusicFavoriteChange) => {
        if (!change.identityKey) return;

        reconcilePtvMusicArtistFavoriteCache(
            artistDetailCache,
            change.identityKey,
            change.itemId,
            change.isFavorite
        );

        if (getActiveMusicDisplayIdentityKey() !== change.identityKey) return;

        setArtistDetail(current => {
            const reconciled = reconcilePtvMusicArtistFavorite(
                current,
                change.itemId,
                change.isFavorite
            );

            if (reconciled !== current) {
                artistDetailCache.set(change.identityKey, change.itemId, reconciled);
            }

            return reconciled;
        });
    }, []);
    const backdropItem = useMemo(() => getMusicRouteBackdropItem({
        albumDetail,
        artistDetail,
        artists,
        currentItem: currentMusicItem,
        homeData,
        playlistDetail,
        route,
        seed: backgroundSeedRef.current
    }), [
        albumDetail,
        artistDetail,
        artists,
        currentMusicItem,
        homeData,
        playlistDetail,
        route
    ]);

    useEffect(() => {
        const serverId = getPtvServerId();
        const userId = getPtvCurrentUserId(serverId);
        const identityKey = getPtvDisplayIdentityKey(serverId, userId);

        if (!identityKey) return;

        void import('./musicContinuity').then(module => {
            if (getPtvDisplayIdentityKey(getPtvServerId(), getPtvCurrentUserId()) !== identityKey) return;

            module.savePtvMusicContinuityRoute({
                serverId,
                userId
            }, `${location.pathname}${location.search}`);
        });
    }, [location.pathname, location.search]);

    useEffect(() => () => {
        activePlaybackAbortControllerRef.current?.abort();
    }, [location.pathname, location.search]);

    const runMusicMetadataLookup = useCallback((item: PtvMusicItem) => {
        const requestRevision = musicIdentifyAuthorityOverlay.captureRequestRevision();
        const lookupItem = reconcileMusicIdentifyItem(item, requestRevision) || item;

        setMetadataLookup({
            error: '',
            isLoading: true,
            item: lookupItem,
            response: null
        });

        void searchPtvMusicMetadata(lookupItem)
            .then(response => {
                setMetadataLookup(current => {
                    if (!current || !isExactPtvMusicIdentifyItem(current.item, lookupItem)) return current;

                    return {
                        error: '',
                        isLoading: false,
                        item: reconcileMusicIdentifyItem(current.item, requestRevision) || current.item,
                        response
                    };
                });
            })
            .catch(error => {
                const message = getMusicErrorMessage(error) || 'Music metadata lookup failed.';

                recordPtvEvent('api', 'music-metadata-lookup-failed', {
                    failureReason: getMusicAdminDialogFailureReason(error),
                    itemType: lookupItem.Type || 'Unknown'
                });
                setMetadataLookup(current => {
                    if (!current || !isExactPtvMusicIdentifyItem(current.item, lookupItem)) return current;

                    return {
                        error: message,
                        isLoading: false,
                        item: reconcileMusicIdentifyItem(current.item, requestRevision) || current.item,
                        response: null
                    };
                });
            });
    }, [musicIdentifyAuthorityOverlay, reconcileMusicIdentifyItem]);

    const adoptConfirmedMusicIdentifyItem = useCallback(async (
        confirmed: PtvMusicItem,
        identityKey: string | null,
        isCurrent: () => boolean
    ) => {
        if (!await reconcilePtvMusicIdentifyCaches(identityKey, confirmed, isCurrent)) return false;
        if (!isCurrent()) return false;
        if (!musicIdentifyAuthorityOverlay.confirm(identityKey, confirmed)) return false;

        const reconcileArtistDetail = (current: ArtistDetailState) => {
            const artist = reconcilePtvMusicIdentifyItem(current.artist, confirmed);
            const reconciledAlbums = reconcilePtvMusicIdentifyPresentationItems(current.albums, confirmed);
            const topSongs = reconcilePtvMusicIdentifyPresentationItems(current.topSongs, confirmed);

            if (
                artist === current.artist
                && reconciledAlbums === current.albums
                && topSongs === current.topSongs
            ) return current;

            return {
                ...current,
                albums: [ ...reconciledAlbums ],
                artist,
                topSongs: [ ...topSongs ]
            };
        };

        artistDetailCache.valuesForIdentity(identityKey).forEach(current => {
            const next = reconcileArtistDetail(current);

            if (next !== current && next.artist?.Id) {
                artistDetailCache.set(identityKey, next.artist.Id, next);
            }
        });
        setHomeData(current => reconcilePtvMusicIdentifyPresentationHomeData(current, confirmed));
        setAlbums(current => {
            const next = reconcilePtvMusicIdentifyPresentationItems(current, confirmed);

            return next === current ? current : [ ...next ];
        });
        setArtists(current => {
            const next = reconcilePtvMusicIdentifyPresentationItems(current, confirmed);

            return next === current ? current : [ ...next ];
        });
        setTracks(current => {
            const next = reconcilePtvMusicIdentifyPresentationItems(current, confirmed);

            return next === current ? current : [ ...next ];
        });
        setLikedSongs(reconcilePtvLikedMusicIdentifyMetadata(confirmed));
        setSearchResults(current => {
            const next = reconcilePtvMusicIdentifyPresentationItems(current, confirmed);

            return next === current ? current : [ ...next ];
        });
        setAlbumDetail(current => {
            const item = reconcilePtvMusicIdentifyItem(current.item, confirmed);
            const detailTracks = reconcilePtvMusicIdentifyPresentationItems(current.tracks, confirmed);
            const isCurrentAlbum = isExactPtvMusicIdentifyItem(current.item, confirmed)
                && confirmed.Type === 'MusicAlbum';
            const identifyArtistSource = isCurrentAlbum ?
                resolvePtvMusicAlbumArtist(confirmed, detailTracks, {
                    childScope: 'authoritative-album-query',
                    preservedOwner: current.item
                }).source :
                current.artistSource;
            const relationshipResolution = resolvePtvMusicAlbumArtist(item, detailTracks, {
                childScope: 'authoritative-album-query'
            });
            const nextArtistSource = isCurrentAlbum && identifyArtistSource !== 'unknown' ?
                identifyArtistSource : relationshipResolution.source;

            return relationshipResolution.item === current.item
                && detailTracks === current.tracks
                && nextArtistSource === current.artistSource ?
                current : {
                    ...current,
                    artistSource: nextArtistSource,
                    item: relationshipResolution.item,
                    tracks: [ ...detailTracks ]
                };
        });
        setArtistDetail(reconcileArtistDetail);
        setPlaylistDetail(current => {
            const playlistTracks = reconcilePtvMusicIdentifyPresentationItems(current.tracks, confirmed);

            return playlistTracks === current.tracks ?
                current : { ...current, tracks: [ ...playlistTracks ] };
        });
        setGenerated(current => {
            if (!current) return current;

            const items = reconcilePtvMusicIdentifyPresentationItems(current.items, confirmed);

            return items === current.items ? current : { ...current, items: [ ...items ] };
        });
        setMetadataLookup(current => {
            if (!current) return current;

            const item = reconcilePtvMusicIdentifyItem(current.item, confirmed) || current.item;

            return item === current.item ? current : { ...current, item };
        });
        reconcilePtvMusicQueueIdentifyMetadata(confirmed);
        return true;
    }, [musicIdentifyAuthorityOverlay]);

    const openAdminAction = useCallback((
        item: PtvMusicItem,
        action: MusicAdminAction,
        owner: MusicAdminActionOwner = { isCurrent: () => true }
    ) => {
        if (action === 'lookup') {
            runMusicMetadataLookup(item);
            return;
        }

        if (action !== 'identify') {
            void openMusicAdminDialog(item, action)
                .catch(error => {
                    recordPtvEvent('render', 'music-admin-dialog-failed', {
                        action,
                        failureReason: getMusicAdminDialogFailureReason(error),
                        itemType: item.Type || 'Unknown'
                    });
                });
            return;
        }

        const operation: PtvMusicIdentifyOperation = {
            generation: ++musicIdentifyGenerationRef.current,
            identityKey: getActiveMusicDisplayIdentityKey(),
            isOwnerCurrent: owner.isCurrent,
            item,
            routeKey: musicRouteKeyRef.current
        };

        void openMusicAdminDialog(item, action)
            .then(async result => {
                const authorityResult = result as PtvMusicIdentifyAuthorityResult | null | undefined;
                const confirmed = authorityResult?.item;
                const canPublish = () => {
                    const ownerState = musicIdentifyOwnerStateRef.current;

                    return Boolean(ownerState && canPublishPtvMusicIdentifyResult({
                        currentGeneration: musicIdentifyGenerationRef.current,
                        currentIdentityKey: getActiveMusicDisplayIdentityKey(),
                        currentRouteKey: musicRouteKeyRef.current,
                        mounted: musicMountedRef.current,
                        operation,
                        ownerState,
                        result: authorityResult
                    }));
                };

                if (!confirmed || !canPublish()) return;

                await adoptConfirmedMusicIdentifyItem(confirmed, operation.identityKey, canPublish);
            })
            .catch(error => {
                if (!error) return;

                recordPtvEvent('render', 'music-admin-dialog-failed', {
                    action,
                    failureReason: getMusicAdminDialogFailureReason(error),
                    itemType: item.Type || 'Unknown'
                });
            });
    }, [adoptConfirmedMusicIdentifyItem, runMusicMetadataLookup]);

    const adminControls = useMemo<MusicAdminContextValue>(() => ({
        canShowDebug,
        isAdmin,
        onAction: openAdminAction
    }), [canShowDebug, isAdmin, openAdminAction]);

    const runPlaybackAction = useCallback(async (request: MusicPlaybackActionRequest) => {
        const clickTimestamp = Date.now();
        const clickPerformanceAt = getMusicPerformanceNow();
        const performanceProfile = getPtvPerformanceProfile();
        const telemetry = playbackTelemetryRef.current;
        const mediaSessionReady = isMusicMediaSessionReady();
        const clickDetail = {
            FireTVProfile: performanceProfile.isFireTv,
            MediaSessionReady: mediaSessionReady,
            PlayerReady: Boolean(getPtvMusicQueueSnapshot().currentItem),
            action: request.action,
            clickTimestamp,
            generationSource: request.generationSource,
            libraryId: request.libraryId || null,
            mediaSource: request.mediaSource || null,
            playlistId: request.playlistId || null,
            playAllRequests: request.action === 'play-all' ? telemetry.playAllRequests + 1 : telemetry.playAllRequests,
            shuffleRequests: request.action === 'shuffle' ? telemetry.shuffleRequests + 1 : telemetry.shuffleRequests,
            sourceButton: request.sourceButton
        };

        if (request.action === 'play-all') telemetry.playAllRequests += 1;
        if (request.action === 'shuffle') telemetry.shuffleRequests += 1;

        recordPtvEvent('playback', 'music-playback-action-click', clickDetail);

        if (activePlaybackActionRef.current) {
            telemetry.buttonIgnoredCount += 1;
            telemetry.duplicateRequestCount += 1;
            recordPtvEvent('playback', 'music-playback-action-ignored', {
                ...clickDetail,
                activeAction: activePlaybackActionRef.current.action,
                activeSourceButton: activePlaybackActionRef.current.sourceButton,
                buttonIgnoredCount: telemetry.buttonIgnoredCount,
                duplicateRequestCount: telemetry.duplicateRequestCount,
                fallbackReason: 'queue-generation-in-progress'
            });

            return false;
        }

        const nextAction = {
            action: request.action,
            sourceButton: request.sourceButton,
            startedAt: clickTimestamp
        };
        // eslint-disable-next-line compat/compat -- Jellyfin provides the legacy-browser AbortController polyfill.
        const actionController = new AbortController();
        const actionIdentityKey = getPtvDisplayIdentityKey(getPtvServerId(), getPtvCurrentUserId());
        const isCurrentAction = () => (
            !actionController.signal.aborted
            && activePlaybackActionRef.current === nextAction
            && getPtvDisplayIdentityKey(getPtvServerId(), getPtvCurrentUserId()) === actionIdentityKey
        );
        const sessionSeed = `${actionIdentityKey}:${request.sourceButton}:${clickTimestamp}`;

        activePlaybackActionRef.current = nextAction;
        activePlaybackAbortControllerRef.current = actionController;
        setActivePlaybackAction(nextAction);

        try {
            const queueGenerationStartedAt = getMusicPerformanceNow();
            const timeoutMs = getMusicQueueTimeoutMs();
            const queueResult = await withMusicQueueTimeout(
                Promise.resolve().then(() => request.buildQueue({
                    isCurrent: isCurrentAction,
                    sessionSeed,
                    signal: actionController.signal
                })),
                timeoutMs,
                `${request.sourceButton} queue generation`,
                () => actionController.abort()
            );
            if (!isCurrentAction()) throw new DOMException('Music action was superseded.', 'AbortError');
            const queueGenerationMs = Math.round((getMusicPerformanceNow() - queueGenerationStartedAt) * 10) / 10;
            const queueItems = (queueResult.items || []).filter(Boolean);
            const requestedStartIndex = request.startIndex || 0;
            const safeStartIndex = Math.max(0, Math.min(requestedStartIndex, Math.max(0, queueItems.length - 1)));

            recordPtvEvent('playback', 'music-queue-generation-complete', {
                ...clickDetail,
                generationSource: request.generationSource,
                queueBuildTime: queueGenerationMs,
                queueGenerationMs,
                queueSize: queueItems.length,
                shuffleSeed: queueResult.seed ?? null,
                startIndex: safeStartIndex
            });

            if (!queueItems.length) {
                telemetry.emptyQueueCount += 1;
                throw new Error('empty queue');
            }

            const playbackRequestStartedAt = getMusicPerformanceNow();

            await waitForMusicPlaybackReadiness();
            if (!isCurrentAction()) throw new DOMException('Music action was superseded.', 'AbortError');
            await playPtvMusicTracks(queueItems, safeStartIndex, {
                preserveVirtualQueue: Boolean(request.preserveVirtualQueue),
                queueSourceLabel: request.mediaSource || request.generationSource,
                rejectOnPlaybackError: true,
                startPositionTicks: request.startPositionTicks
            });

            const snapshot = getPtvMusicQueueSnapshot();

            if (!snapshot.playlist.length || !snapshot.currentItem) {
                telemetry.emptyQueueCount += 1;
                throw new Error('player accepted an empty queue');
            }

            recordPtvEvent('playback', 'music-playback-start-requested', {
                ...clickDetail,
                FireTVProfile: performanceProfile.isFireTv,
                MediaSessionReady: isMusicMediaSessionReady(),
                PlayerReady: Boolean(snapshot.currentItem),
                playbackStartMs: Math.round((getMusicPerformanceNow() - playbackRequestStartedAt) * 10) / 10,
                queueGenerationMs,
                queueSize: snapshot.playlist.length,
                startedItemId: snapshot.currentItem.Id || null,
                totalActionMs: Math.round((getMusicPerformanceNow() - clickPerformanceAt) * 10) / 10
            });

            return true;
        } catch (error) {
            const message = getMusicErrorMessage(error) || 'Unable to generate playlist';
            const wasCancelled = actionController.signal.aborted
                || (error instanceof DOMException && error.name === 'AbortError')
                || /cancel|superseded/i.test(message);

            if (wasCancelled) {
                recordPtvEvent('playback', 'music-queue-generation-cancelled', {
                    ...clickDetail,
                    reason: message
                });
                return false;
            }
            telemetry.queueGenerationFailures += 1;
            toast('Unable to generate playlist');
            recordPtvEvent('playback', 'music-queue-generation-failed', {
                ...clickDetail,
                cancelledPromise: wasCancelled,
                emptyQueueCount: telemetry.emptyQueueCount,
                exception: message,
                failureReason: message,
                queueGenerationFailures: telemetry.queueGenerationFailures,
                timeout: /timed out/i.test(message),
                totalActionMs: Math.round((getMusicPerformanceNow() - clickPerformanceAt) * 10) / 10
            });

            return false;
        } finally {
            if (activePlaybackActionRef.current === nextAction) {
                activePlaybackActionRef.current = null;
                activePlaybackAbortControllerRef.current = null;
                setActivePlaybackAction(null);
            }
        }
    }, []);

    const playbackActionControls = useMemo<MusicPlaybackActionContextValue>(() => ({
        activeAction: activePlaybackAction,
        isBusy: Boolean(activePlaybackAction),
        runPlaybackAction
    }), [activePlaybackAction, runPlaybackAction]);

    useEffect(() => {
        routeViewRef.current = route.view;
    }, [route.view]);

    const clearDeferredMusicWork = useCallback((recordRouteExit = true) => {
        musicDeferredTimersRef.current.forEach(timerId => {
            window.clearTimeout(timerId);
        });
        musicDeferredTimersRef.current = [];

        if (recordRouteExit) {
            musicDataCoordinator.cancelRouteWork(PTV_MUSIC_ROUTE_WORK_OWNER, 'route-exit');
            musicRouteWorkSignalRef.current = null;
        }
    }, [musicDataCoordinator]);

    const scheduleDeferredMusicWork = useCallback((task: () => void, delayMs: number) => {
        const timerId = window.setTimeout(() => {
            musicDeferredTimersRef.current = musicDeferredTimersRef.current.filter(id => id !== timerId);
            task();
        }, delayMs);

        musicDeferredTimersRef.current.push(timerId);

        return timerId;
    }, []);

    const loadMusicLibraryIndex = useCallback((
        forceRefresh = false,
        ownerRequestId = musicRequestIdRef.current,
        signal = musicRouteWorkSignalRef.current || undefined
    ): Promise<null | void> => {
        const identifyRequestRevision = musicIdentifyAuthorityOverlay.captureRequestRevision();
        const libraryRequestKey = `${ownerRequestId}:${forceRefresh ? 'refresh' : 'normal'}`;
        const isCurrentLibraryRequest = (libraryRequestId: number) => (
            musicMountedRef.current
            && ownerRequestId === musicRequestIdRef.current
            && libraryRequestId === musicLibraryIndexRequestIdRef.current
            && !signal?.aborted
        );

        if (signal?.aborted) {
            return Promise.resolve(null);
        }

        if (musicLibraryIndexActiveRequestKeyRef.current === libraryRequestKey) {
            recordPtvEvent('api', 'music-library-index-duplicate-suppressed', {
                forceRefresh,
                ownerRequestId
            });

            return Promise.resolve(null);
        }

        const libraryRequestId = ++musicLibraryIndexRequestIdRef.current;

        musicLibraryIndexActiveRequestKeyRef.current = libraryRequestKey;
        if (isCurrentLibraryRequest(libraryRequestId)) {
            setLibraryIndexLoadState('loading');
        }

        return musicDataCoordinator.loadLibraryIndex({
            forceRefresh,
            isCurrent: () => isCurrentLibraryRequest(libraryRequestId),
            signal
        })
            .then(libraryIndex => {
                if (!isCurrentLibraryRequest(libraryRequestId)) return;

                setHomeData(previous => reconcileMusicIdentifyHomeData(
                    mergeMusicLibraryIndex(previous, libraryIndex),
                    identifyRequestRevision
                ));
                setLibraryIndexLoadState('ready');
                if (!libraryIndex.debug.failedSections.includes('playlists')) {
                    setPlaylists(libraryIndex.playlists.slice(0, PTV_MUSIC_LIBRARY_RETAIN_LIMIT));
                }

                if (!libraryIndex.debug.failedSections.includes('albums')) {
                    setAlbums([ ...reconcileMusicIdentifyItems(
                        libraryIndex.albums.slice(0, PTV_MUSIC_LIBRARY_RETAIN_LIMIT),
                        identifyRequestRevision
                    ) ]);
                }

                if (!libraryIndex.debug.failedSections.includes('artists')) {
                    setArtists([ ...reconcileMusicIdentifyItems(
                        libraryIndex.artists.slice(0, PTV_MUSIC_LIBRARY_RETAIN_LIMIT),
                        identifyRequestRevision
                    ) ]);
                }

                if (!libraryIndex.debug.failedSections.includes('tracks')) {
                    setTracks([ ...reconcileMusicIdentifyItems(
                        libraryIndex.tracks.slice(0, PTV_MUSIC_LIBRARY_RETAIN_LIMIT),
                        identifyRequestRevision
                    ) ]);
                }
                const libraryUiDiagnostic = {
                    albumCount: libraryIndex.albums.length,
                    albumsRendered: Math.min(libraryIndex.albums.length, PTV_MUSIC_LIBRARY_RETAIN_LIMIT),
                    artistCount: libraryIndex.artists.length,
                    artistsRendered: Math.min(libraryIndex.artists.length, PTV_MUSIC_LIBRARY_RETAIN_LIMIT),
                    libraryId: libraryIndex.library?.id || null,
                    libraryName: libraryIndex.library?.name || null,
                    playlistCount: libraryIndex.playlists.length,
                    playlistsRendered: Math.min(libraryIndex.playlists.length, PTV_MUSIC_LIBRARY_RETAIN_LIMIT),
                    songCount: libraryIndex.tracks.length,
                    tracksFetched: libraryIndex.tracks.length,
                    tracksRendered: Math.min(libraryIndex.tracks.length, PTV_MUSIC_LIBRARY_RETAIN_LIMIT)
                };

                recordPtvEvent('api', 'music-library-ui-counts-loaded', {
                    ...libraryUiDiagnostic,
                    debug: libraryIndex.debug
                });
                console.info('[PTV Music] music library UI counts', libraryUiDiagnostic);
            })
            .catch(error => {
                if (isMusicRouteAbortError(error) || !isCurrentLibraryRequest(libraryRequestId)) {
                    return;
                }

                if (musicMountedRef.current && ownerRequestId === musicRequestIdRef.current) {
                    setLibraryIndexLoadState('failed');
                }
                recordPtvEvent('api', 'music-library-index-background-failed', {
                    error: getMusicErrorMessage(error)
                });
            })
            .finally(() => {
                if (musicLibraryIndexActiveRequestKeyRef.current === libraryRequestKey) {
                    musicLibraryIndexActiveRequestKeyRef.current = '';
                }
            });
    }, [
        musicDataCoordinator,
        musicIdentifyAuthorityOverlay,
        reconcileMusicIdentifyHomeData,
        reconcileMusicIdentifyItems
    ]);

    const loadMusicData = useCallback((forceRefresh = false) => {
        const identifyRequestRevision = musicIdentifyAuthorityOverlay.captureRequestRevision();
        const routeEnteredAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
        const requestId = ++musicRequestIdRef.current;
        const activeRouteView = routeViewRef.current;
        const shouldLoadLibraryIndex = isPtvMusicCatalogView(activeRouteView);
        let hasPublishedFirstVisibleContent = false;

        setLibraryIndexLoadState('scheduled');

        clearDeferredMusicWork(false);
        const routeSignal = musicDataCoordinator.beginRouteWork(PTV_MUSIC_ROUTE_WORK_OWNER);
        const isCurrentRequest = () => (
            musicMountedRef.current
            && requestId === musicRequestIdRef.current
            && !routeSignal.aborted
        );

        musicRouteWorkSignalRef.current = routeSignal;
        setLoading(true);
        setErrorMessage('');

        if (forceRefresh) {
            invalidatePtvMusicHomeCache();
        }

        if (shouldLoadLibraryIndex) {
            void loadMusicLibraryIndex(forceRefresh, requestId, routeSignal);
        }

        if (isPtvMusicHomeIndependentView(activeRouteView)) {
            setLoading(false);
            recordPtvEvent('render', 'music-home-snapshot-skipped', {
                routeView: activeRouteView,
                routeWorkOwned: true
            });

            return Promise.resolve();
        }

        const loadMusicVideos = () => {
            scheduleDeferredMusicWork(() => {
                if (!isCurrentRequest()) return;

                void recoverMusicPageItems(
                    'music-videos',
                    fetchPtvMusicVideos(8, routeSignal),
                    isCurrentRequest
                )
                    .then(nextMusicVideos => {
                        if (isCurrentRequest()) {
                            setMusicVideos(nextMusicVideos);
                        }
                    });
            }, 3200);
        };
        const scheduleBackgroundHomeRefresh = (cachedHomeData: PtvMusicHomeData) => {
            const cacheAgeMs = Math.max(0, Date.now() - cachedHomeData.generatedAt);
            const completedDataAgeMs = cacheAgeMs;
            const completeness = cachedHomeData.completeness || (cachedHomeData.isPartial ? 'degraded' : 'complete');
            const hasFailedSections = hasMusicHomeFailedSections(cachedHomeData);
            const nextEligibleRefreshAt = cachedHomeData.nextEligibleRefreshAt || (cachedHomeData.generatedAt + PTV_MUSIC_STALE_HOME_REFRESH_AGE_MS);
            const isFreshEnough = cachedHomeData.generatedAt > 0 && Date.now() < nextEligibleRefreshAt;
            const isIntentionalInitialSnapshot = completeness === 'initial-usable' && !hasFailedSections;

            if (isFreshEnough && completeness === 'complete' && !forceRefresh) {
                recordPtvEvent('render', 'music-background-refresh-suppressed', {
                    backgroundRefreshSuppressed: true,
                    backgroundRefreshSuppressionReason: 'complete-fresh',
                    completedDataAgeMs,
                    completeness,
                    duplicateMusicRequestPrevented: true,
                    hasFailedSections,
                    isPartial: Boolean(cachedHomeData.isPartial),
                    musicRouteEnteredAt: routeEnteredAt,
                    nextEligibleRefreshAt,
                    refreshReason: cachedHomeData.refreshReason || null,
                    routeView: activeRouteView
                });

                return;
            }

            recordPtvEvent('render', 'music-background-refresh-scheduled', {
                cacheAgeMs,
                completeness,
                completedDataAgeMs,
                hasFailedSections,
                isPartial: Boolean(cachedHomeData.isPartial),
                musicRouteEnteredAt: routeEnteredAt,
                refreshReason: cachedHomeData.refreshReason || null,
                routeView: activeRouteView
            });

            scheduleDeferredMusicWork(() => {
                const refreshStartedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();

                void musicDataCoordinator.loadHomeSnapshot({
                    forceRefresh,
                    initialOnly: false,
                    isCurrent: isCurrentRequest,
                    signal: routeSignal
                })
                    .then(refreshedHomeData => {
                        if (!isCurrentRequest()) return;

                        setHomeData(previous => reconcileMusicIdentifyHomeData(
                            mergeMusicHomeDataWithLibraryState(previous, refreshedHomeData),
                            identifyRequestRevision
                        ));
                        recordPtvEvent('render', 'music-background-refresh-completed', {
                            musicBackgroundRefreshCompleted: true,
                            musicBackgroundRefreshMs: Number(((typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()) - refreshStartedAt).toFixed(1)),
                            sectionCount: refreshedHomeData.sections.length
                        });
                    })
                    .catch(error => {
                        if (isMusicRouteAbortError(error) || !isCurrentRequest()) return;

                        recordPtvEvent('render', 'music-background-refresh-failed', {
                            error: getMusicErrorMessage(error)
                        });
                    });
            }, isIntentionalInitialSnapshot ? 500 : 350);
        };
        const publishVisibleHomeData = (nextHomeData: PtvMusicHomeData, delivery: 'progressive' | 'snapshot') => {
            if (!isCurrentRequest()) return;

            setHomeData(previous => reconcileMusicIdentifyHomeData(
                mergeMusicHomeDataWithLibraryState(previous, nextHomeData),
                identifyRequestRevision
            ));
            setLoading(false);

            if (hasPublishedFirstVisibleContent) return;

            hasPublishedFirstVisibleContent = true;
            const visibleAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
            const visibleDurationMs = Number((visibleAt - routeEnteredAt).toFixed(1));

            recordPtvEvent('render', 'music-first-visible-content', {
                cacheAgeMs: Math.max(0, Date.now() - nextHomeData.generatedAt),
                delivery,
                musicCachedRenderMs: visibleDurationMs,
                musicFirstInteractiveMs: visibleDurationMs,
                musicFirstVisibleContentMs: visibleDurationMs,
                musicRouteEnteredAt: routeEnteredAt,
                sectionCount: nextHomeData.sections.length
            });
        };

        return musicDataCoordinator.loadHomeSnapshot({
            forceRefresh,
            initialOnly: true,
            isCurrent: isCurrentRequest,
            onProgress: progressiveHomeData => publishVisibleHomeData(progressiveHomeData, 'progressive'),
            signal: routeSignal
        })
            .then(nextHomeData => {
                if (!isCurrentRequest()) return;

                publishVisibleHomeData(nextHomeData, 'snapshot');
                loadMusicVideos();
                scheduleBackgroundHomeRefresh(nextHomeData);
            })
            .catch(error => {
                if (isMusicRouteAbortError(error) || !isCurrentRequest()) return;

                setErrorMessage(getMusicErrorMessage(error) || 'Music could not be loaded.');
                recordPtvEvent('render', 'music-playback-error', {
                    error: getMusicErrorMessage(error),
                    stage: 'music-shell-data'
                });
                setLoading(false);
            });
    }, [
        clearDeferredMusicWork,
        loadMusicLibraryIndex,
        musicDataCoordinator,
        musicIdentifyAuthorityOverlay,
        reconcileMusicIdentifyHomeData,
        scheduleDeferredMusicWork
    ]);

    useEffect(() => {
        musicMountedRef.current = true;
        document.documentElement.classList.add('ptv-route-music-mounted');
        document.body.classList.add('ptv-route-music-mounted');
        document.documentElement.dataset.ptvMusicRouteMounted = 'true';
        document.body.dataset.ptvMusicRouteMounted = 'true';
        logMusicPageEvent('music-route-mounted', {
            hash: window.location.hash
        });
        recordPtvEvent('render', 'music-page-mounted', {
            hash: window.location.hash
        });
        console.info('[PTV Music] music page mounted', {
            hash: window.location.hash
        });
        void loadMusicData();
        scheduleDeferredMusicWork(() => {
            if (verifyMusicShell()) {
                logMusicPageEvent('music-shell-attached', {
                    hash: window.location.hash
                });
            }
        }, 0);

        return () => {
            musicMountedRef.current = false;
            musicRequestIdRef.current += 1;
            clearDeferredMusicWork();
            cleanupMusicRouteState();
            logMusicPageEvent('music-shell-detached', {
                hash: window.location.hash
            });
            logMusicPageEvent('music-route-unmounted', {
                hash: window.location.hash
            });
            window.setTimeout(() => {
                scheduleRouteCheck(true);
            }, 0);
        };
    }, [clearDeferredMusicWork, loadMusicData, scheduleDeferredMusicWork]);

    useEffect(() => {
        if (!musicMountedRef.current || loadedRouteViewRef.current === route.view) return;

        loadedRouteViewRef.current = route.view;
        void loadMusicData();
    }, [loadMusicData, route.view]);

    useEffect(() => subscribeToPtvLikedMusic(setLikedSongs), []);

    useEffect(() => {
        if (!musicMountedRef.current || !isPtvMusicCatalogView(route.view)) return;

        const routeSignal = musicRouteWorkSignalRef.current;

        if (!routeSignal || routeSignal.aborted) return;

        void loadMusicLibraryIndex(false, musicRequestIdRef.current, routeSignal);
    }, [loadMusicLibraryIndex, route.view]);

    useEffect(() => {
        let refreshController: AbortController | null = null;

        const refreshPlaylists = () => {
            refreshController?.abort();
            // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill for legacy web runtimes.
            const controller = new AbortController();
            const isCurrent = () => (
                musicMountedRef.current
                && refreshController === controller
                && !controller.signal.aborted
            );

            refreshController = controller;
            void recoverMusicPageItems(
                'playlists-refresh',
                fetchPtvMusicPlaylists(36, controller.signal),
                isCurrent
            )
                .then(items => {
                    if (isCurrent()) {
                        setPlaylists(items.slice(0, PTV_MUSIC_LIBRARY_RETAIN_LIMIT));
                    }
                })
                .finally(() => {
                    if (refreshController === controller) {
                        refreshController = null;
                    }
                });
        };

        window.addEventListener(PTV_MUSIC_PLAYLISTS_CHANGED_EVENT, refreshPlaylists);

        return () => {
            window.removeEventListener(PTV_MUSIC_PLAYLISTS_CHANGED_EVENT, refreshPlaylists);
            refreshController?.abort();
            refreshController = null;
        };
    }, []);

    useEffect(() => {
        if (!homeData.generatedAt) return;

        const pageDiagnostic = {
            albumCount: homeData.stats.albumCount,
            artistCount: homeData.stats.artistCount,
            isPartial: Boolean(homeData.isPartial),
            libraryId: homeData.library?.id || null,
            libraryName: homeData.library?.name || null,
            route: route.view,
            sectionCount: homeData.sections.length,
            songCount: homeData.stats.trackCount,
            trackCount: homeData.stats.trackCount
        };

        logMusicPageEvent('music-page-rendered', pageDiagnostic);
        console.info('[PTV Music] music page rendered', pageDiagnostic);
        verifyMusicShell();
    }, [homeData, route.view]);

    useEffect(() => {
        setSearchResults([]);

        if (route.view !== 'explore' || !route.search) return undefined;

        const identifyRequestRevision = musicIdentifyAuthorityOverlay.captureRequestRevision();
        const routeWork = beginPtvMusicRouteWork(
            PTV_MUSIC_SEARCH_ROUTE_WORK_OWNER,
            `${getActiveMusicDisplayIdentityKey() || 'identity-unavailable'}:${route.search}`
        );
        const isCurrent = () => (
            musicMountedRef.current
            && isPtvMusicRouteWorkCurrent(routeWork)
        );

        void searchPtvMusic(route.search, 60, routeWork.signal).then(results => {
            if (isCurrent()) {
                setSearchResults([ ...reconcileMusicIdentifyItems(results, identifyRequestRevision) ]);
            }
        }).catch(error => {
            if (isMusicRouteAbortError(error) || !isCurrent()) return;

            recordPtvEvent('api', 'music-search-failed', {
                error: getMusicErrorMessage(error),
                query: route.search
            });
            setSearchResults([]);
        }).finally(() => {
            settlePtvMusicRouteWork(routeWork);
        });

        return () => {
            retirePtvMusicRouteWork(routeWork);
        };
    }, [musicIdentifyAuthorityOverlay, reconcileMusicIdentifyItems, route.search, route.view]);

    useEffect(() => {
        if (route.view !== 'item' || !route.id) return undefined;

        const routeWork = beginPtvMusicRouteWork(
            PTV_MUSIC_ITEM_ROUTE_WORK_OWNER,
            `${getActiveMusicDisplayIdentityKey() || 'identity-unavailable'}:${route.id}`
        );
        const isCurrent = () => (
            musicMountedRef.current
            && isPtvMusicRouteWorkCurrent(routeWork)
        );

        void fetchPtvMusicItem(route.id, routeWork.signal)
            .then(item => {
                if (!isCurrent()) return;
                if (!item) return;

                recordPtvEvent('route', 'music-item-route-loaded', {
                    itemId: item.Id || route.id,
                    route: `#/music/item/${route.id}`
                });
                void runPlaybackAction({
                    action: 'play-item',
                    buildQueue: () => ({ items: [item] }),
                    generationSource: 'music-item-route',
                    mediaSource: 'track',
                    playlistId: item.Id || route.id,
                    sourceButton: `music-item-route-${item.Id || route.id}`
                });
            })
            .catch(error => {
                if (isMusicRouteAbortError(error) || !isCurrent()) return;

                recordPtvEvent('route', 'music-item-route-load-failed', {
                    error: getMusicErrorMessage(error),
                    itemId: route.id,
                    route: `#/music/item/${route.id}`
                });
            })
            .finally(() => {
                settlePtvMusicRouteWork(routeWork);
            });

        return () => {
            retirePtvMusicRouteWork(routeWork);
        };
    }, [route.id, route.view, runPlaybackAction]);

    useEffect(() => {
        const artistRouteEnteredAt = performance.now();

        if (route.view !== 'artist' || !route.id) {
            setArtistDetail(getInitialArtistDetail());
            return undefined;
        }

        const displayIdentityKey = getActiveMusicDisplayIdentityKey();
        const identifyRequestRevision = musicIdentifyAuthorityOverlay.captureRequestRevision();
        const cachedDetailValue = artistDetailCache.get(displayIdentityKey, route.id);
        const cachedDetail = cachedDetailValue ?
            reconcileMusicIdentifyArtistDetail(
                cachedDetailValue,
                displayIdentityKey,
                identifyRequestRevision
            ) : undefined;

        if (cachedDetail && cachedDetail !== cachedDetailValue) {
            artistDetailCache.set(displayIdentityKey, route.id, cachedDetail);
        }
        const routeWork = beginPtvMusicRouteWork(
            PTV_MUSIC_ARTIST_ROUTE_WORK_OWNER,
            `${displayIdentityKey || 'identity-unavailable'}:${route.id}`
        );
        const isCurrent = () => (
            musicMountedRef.current
            && isPtvMusicRouteWorkCurrent(routeWork)
        );

        if (cachedDetail?.artist) {
            setArtistDetail(cachedDetail);
            recordPtvEvent('cache', 'music-artist-summary-cache-hit', {
                artistCacheHit: true,
                artistId: route.id,
                artistSummaryVisibleMs: Math.round((performance.now() - artistRouteEnteredAt) * 10) / 10
            });
        } else {
            setArtistDetail({
                ...getInitialArtistDetail(),
                isLoading: true
            });
        }

        void loadProgressiveArtistDetail(route.id, {
            onSummary: artist => {
                if (!isCurrent()) return;

                const summaryDetail = reconcileMusicIdentifyArtistDetail({
                    albums: cachedDetail?.albums || [],
                    artist,
                    error: '',
                    isLoading: false,
                    topSongs: cachedDetail?.topSongs || []
                }, displayIdentityKey, identifyRequestRevision);

                artistDetailCache.set(displayIdentityKey, route.id, summaryDetail);
                setArtistDetail(summaryDetail);
                recordPtvEvent('render', 'music-artist-summary-visible', {
                    artistCacheHit: Boolean(cachedDetail),
                    artistId: route.id,
                    artistFirstInteractiveMs: Math.round((performance.now() - artistRouteEnteredAt) * 10) / 10,
                    artistSummaryVisibleMs: Math.round((performance.now() - artistRouteEnteredAt) * 10) / 10
                });
            },
            onAlbums: artistAlbums => {
                if (!isCurrent()) return;

                setArtistDetail(current => {
                    const next = reconcileMusicIdentifyArtistDetail({
                        ...current,
                        albums: [ ...reconcileMusicIdentifyItems(
                            artistAlbums,
                            identifyRequestRevision
                        ) ]
                    }, displayIdentityKey, identifyRequestRevision);

                    artistDetailCache.set(displayIdentityKey, route.id, next);
                    return next;
                });
                recordPtvEvent('render', 'music-artist-albums-visible', {
                    artistAlbumsVisibleMs: Math.round((performance.now() - artistRouteEnteredAt) * 10) / 10,
                    artistId: route.id,
                    artistQueryItemCount: artistAlbums.length
                });
            },
            onTracks: topSongs => {
                if (!isCurrent()) return;

                setArtistDetail(current => {
                    const next = {
                        ...current,
                        topSongs: [ ...reconcileMusicIdentifyItems(
                            topSongs,
                            identifyRequestRevision
                        ) ]
                    };

                    artistDetailCache.set(displayIdentityKey, route.id, next);
                    return next;
                });
                recordPtvEvent('render', 'music-artist-tracks-visible', {
                    artistId: route.id,
                    artistQueryItemCount: topSongs.length,
                    artistTracksVisibleMs: Math.round((performance.now() - artistRouteEnteredAt) * 10) / 10
                });
            }
        }, routeWork.signal)
            .catch(error => {
                if (isMusicRouteAbortError(error) || !isCurrent()) return;

                setArtistDetail({
                    ...getInitialArtistDetail(),
                    error: error instanceof Error ? error.message : 'Artist could not be loaded.',
                    isLoading: false
                });
            })
            .finally(() => {
                settlePtvMusicRouteWork(routeWork);
            });

        return () => {
            const cancellation = retirePtvMusicRouteWork(routeWork);

            if (cancellation) {
                recordPtvEvent('api', 'music-artist-request-cancelled', {
                    abortLatencyMs: cancellation.abortLatencyMs,
                    artistId: route.id,
                    artistRequestCancelled: true
                });
            }
        };
    }, [
        musicIdentifyAuthorityOverlay,
        reconcileMusicIdentifyArtistDetail,
        reconcileMusicIdentifyItems,
        route.id,
        route.view
    ]);

    useEffect(() => {
        if (route.view !== 'album' || !route.id) {
            setAlbumDetail(getInitialItemDetail());
            return undefined;
        }

        setAlbumDetail({
            ...getInitialItemDetail(),
            isLoading: true,
            isTracksLoading: true
        });

        const identifyRequestRevision = musicIdentifyAuthorityOverlay.captureRequestRevision();
        const routeWork = beginPtvMusicRouteWork(
            PTV_MUSIC_ALBUM_ROUTE_WORK_OWNER,
            `${getActiveMusicDisplayIdentityKey() || 'identity-unavailable'}:${route.id}`
        );
        const isCurrent = () => (
            musicMountedRef.current
            && isPtvMusicRouteWorkCurrent(routeWork)
        );

        void loadPtvProgressiveMusicDetail({
            isCurrent,
            loadItem: () => fetchPtvMusicItem(route.id, routeWork.signal),
            loadTracks: () => fetchPtvMusicAlbumTracks(route.id, 100, routeWork.signal),
            onItem: item => {
                setAlbumDetail(current => {
                    const detailItem = reconcileMusicIdentifyItem(item, identifyRequestRevision);
                    const relationshipResolution = resolvePtvMusicAlbumArtist(detailItem, current.tracks, {
                        childScope: 'authoritative-album-query'
                    });

                    return {
                        ...current,
                        artistSource: relationshipResolution.source,
                        error: '',
                        isLoading: false,
                        item: relationshipResolution.item
                    };
                });
            },
            onItemError: error => {
                if (isMusicRouteAbortError(error)) return;

                setAlbumDetail({
                    ...getInitialItemDetail(),
                    error: error instanceof Error ? error.message : 'Album could not be loaded.'
                });
            },
            onTracks: albumTracks => {
                const detailTracks = [ ...reconcileMusicIdentifyItems(
                    albumTracks,
                    identifyRequestRevision
                ) ];

                setAlbumDetail(current => {
                    const relationshipResolution = resolvePtvMusicAlbumArtist(current.item, detailTracks, {
                        childScope: 'authoritative-album-query'
                    });

                    return {
                        ...current,
                        artistSource: relationshipResolution.source,
                        isTracksLoading: false,
                        item: relationshipResolution.item,
                        tracks: detailTracks
                    };
                });
            },
            onTracksError: error => {
                if (isMusicRouteAbortError(error)) return;

                setAlbumDetail(current => ({
                    ...current,
                    isTracksLoading: false
                }));
                recordPtvEvent('api', 'music-album-tracks-failed', {
                    albumId: route.id,
                    error: getMusicErrorMessage(error)
                });
            }
        }).finally(() => {
            settlePtvMusicRouteWork(routeWork);
        });

        return () => {
            retirePtvMusicRouteWork(routeWork);
        };
    }, [
        musicIdentifyAuthorityOverlay,
        reconcileMusicIdentifyItem,
        reconcileMusicIdentifyItems,
        route.id,
        route.view
    ]);

    useEffect(() => {
        if (route.view !== 'playlist' || !route.id) {
            setPlaylistDetail(getInitialItemDetail());
            return undefined;
        }

        setPlaylistDetail({
            ...getInitialItemDetail(),
            isLoading: true,
            isTracksLoading: true
        });

        const identifyRequestRevision = musicIdentifyAuthorityOverlay.captureRequestRevision();
        const routeWork = beginPtvMusicRouteWork(
            PTV_MUSIC_PLAYLIST_ROUTE_WORK_OWNER,
            `${getActiveMusicDisplayIdentityKey() || 'identity-unavailable'}:${route.id}`
        );
        const isCurrent = () => (
            musicMountedRef.current
            && isPtvMusicRouteWorkCurrent(routeWork)
        );

        void loadPtvProgressiveMusicDetail({
            isCurrent,
            loadItem: () => fetchPtvMusicItem(route.id, routeWork.signal),
            loadTracks: () => fetchPtvMusicPlaylistTracks(route.id, 100, routeWork.signal),
            onItem: item => {
                setPlaylistDetail(current => ({
                    ...current,
                    error: '',
                    isLoading: false,
                    item
                }));
            },
            onItemError: error => {
                if (isMusicRouteAbortError(error)) return;

                setPlaylistDetail({
                    ...getInitialItemDetail(),
                    error: error instanceof Error ? error.message : 'Playlist could not be loaded.'
                });
            },
            onTracks: playlistTracks => {
                setPlaylistDetail(current => ({
                    ...current,
                    isTracksLoading: false,
                    tracks: [ ...reconcileMusicIdentifyItems(
                        playlistTracks,
                        identifyRequestRevision
                    ) ]
                }));
            },
            onTracksError: error => {
                if (isMusicRouteAbortError(error)) return;

                setPlaylistDetail(current => ({
                    ...current,
                    isTracksLoading: false
                }));
                recordPtvEvent('api', 'music-playlist-tracks-failed', {
                    error: getMusicErrorMessage(error),
                    playlistId: route.id
                });
            }
        }).finally(() => {
            settlePtvMusicRouteWork(routeWork);
        });

        return () => {
            const cancellation = retirePtvMusicRouteWork(routeWork);

            if (cancellation) {
                recordPtvEvent('api', 'music-playlist-request-cancelled', {
                    abortLatencyMs: cancellation.abortLatencyMs,
                    playlistId: route.id,
                    playlistRequestCancelled: true
                });
            }
        };
    }, [musicIdentifyAuthorityOverlay, reconcileMusicIdentifyItems, route.id, route.view]);

    const refresh = () => {
        void loadMusicData(true);
    };

    const renderView = () => {
        const homeGate = getPtvMusicRouteHomeGate(route.view, {
            hasError: Boolean(errorMessage),
            hasHomeSections: homeData.sections.length > 0,
            isLoading
        });

        if (homeGate === 'loading') return <MusicLoading label='Loading Music' />;
        if (homeGate === 'error') return <MusicError message={errorMessage} />;

        switch (route.view) {
            case 'explore':
                return (
                    <MusicExploreView
                        generated={generated}
                        homeData={homeData}
                        onGenerated={setGenerated}
                        search={route.search}
                        searchResults={searchResults}
                    />
                );
            case 'library':
                return (
                    <MusicLibraryView
                        albums={albums}
                        artists={artists}
                        canShowDebug={canShowDebug}
                        homeData={homeData}
                        libraryIndexLoadState={libraryIndexLoadState}
                        likedSongs={likedSongs}
                        onGenerated={setGenerated}
                        playlists={playlists}
                    />
                );
            case 'artists':
            case 'albums':
            case 'songs':
            case 'playlists':
                return (
                    <MusicCatalogView
                        albums={albums}
                        artists={artists}
                        homeData={homeData}
                        libraryIndexLoadState={libraryIndexLoadState}
                        likedSongs={likedSongs}
                        onGenerated={setGenerated}
                        playlists={playlists}
                        tracks={tracks}
                        view={route.view}
                    />
                );
            case 'liked':
                return <LikedSongsView likedSongs={likedSongs} />;
            case 'genres':
                return <MusicGenresRoute homeData={homeData} onGenerated={setGenerated} tracks={tracks} />;
            case 'history':
                return <ListeningHistoryRoute />;
            case 'artist':
                return (
                    <ArtistView
                        detail={artistDetail}
                        homeData={homeData}
                        onFavoriteChange={reconcileArtistFavorite}
                        onGenerated={setGenerated}
                    />
                );
            case 'album':
                return <AlbumOrPlaylistView detail={albumDetail} homeData={homeData} kind='album' onGenerated={setGenerated} />;
            case 'playlist':
                return <AlbumOrPlaylistView detail={playlistDetail} homeData={homeData} kind='playlist' onGenerated={setGenerated} />;
            case 'item':
            case 'player':
                return <PlayerView homeData={homeData} musicVideos={musicVideos} />;
            case 'home':
            default:
                return (
                    <MusicHomeView
                        generated={generated}
                        homeData={homeData}
                        libraryIndexLoadState={libraryIndexLoadState}
                        onGenerated={setGenerated}
                    />
                );
        }
    };
    const showToolbarTitle = shouldShowMusicToolbarTitle(route.view);

    return (
        <Page
            id='ptvMusicPage'
            title='Music'
            className='mainAnimatedPage type-interior ptv-music-page'
            isMenuButtonEnabled
        >
            <PTVShell
                backdropSource={`music-${route.view}`}
                backdropUrl={backdropItem ? getItemBackdropUrl(backdropItem, 1800) : ''}
                className='ptv-music-shell'
                contextualLinks={getMusicContextLinks(route)}
                section='music'
                title='Music'
            >
                <main className={`ptv-music-app ptv-music-app-shell ptv-music-route-${route.view}`}>
                    <div className='ptv-music-body'>
                        <section className='ptv-music-main' aria-label='PiggieTV Music'>
                            <div className='ptv-music-main-scroll'>
                                {showToolbarTitle || isAdmin ? (
                                    <div className={`ptv-music-main-toolbar${showToolbarTitle ? '' : ' ptv-music-main-toolbar-compact'}`}>
                                        {showToolbarTitle ? (
                                            <div>
                                                <p className='ptv-music-kicker'>PiggieTV</p>
                                                <h1>{getMusicRouteTitle(route)}</h1>
                                                {homeData.library?.name ? (
                                                    <span className='ptv-music-toolbar-sync'>{homeData.library.name}</span>
                                                ) : null}
                                            </div>
                                        ) : <span aria-hidden='true' />}
                                        {isAdmin ? (
                                            <button type='button' onClick={refresh}>
                                                <PtvIcon name='refresh' />
                                                <span>Refresh</span>
                                            </button>
                                        ) : null}
                                    </div>
                                ) : null}
                                <MUSIC_PLAYBACK_ACTION_CONTEXT.Provider value={playbackActionControls}>
                                    <MUSIC_ADMIN_CONTEXT.Provider value={adminControls}>
                                        {renderView()}
                                        <MusicMetadataLookupDialog
                                            canShowDebug={canShowDebug}
                                            onClose={() => setMetadataLookup(null)}
                                            onRefresh={runMusicMetadataLookup}
                                            state={metadataLookup}
                                        />
                                    </MUSIC_ADMIN_CONTEXT.Provider>
                                </MUSIC_PLAYBACK_ACTION_CONTEXT.Provider>
                            </div>
                        </section>
                    </div>
                </main>
            </PTVShell>
        </Page>
    );
}

/* eslint-enable react/jsx-no-bind, no-void */
