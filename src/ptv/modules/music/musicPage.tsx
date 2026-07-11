/* eslint-disable react/jsx-no-bind, no-void */
import React, {
    createContext,
    FormEvent,
    useCallback,
    useContext,
    useEffect,
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
    hasPtvImageUrlFailed,
    markPtvImageUrlFailed,
    setPtvFavorite
} from '../../api';
import { PTV_ASSETS, PTV_ROUTES } from '../../core/config';
import { getPtvPerformanceProfile } from '../../core/clientProfile';
import { recordPtvEvent } from '../../core/observability';
import { scheduleRouteCheck } from '../../core/router';
import { resolvePtvStaticAssetUrl } from '../../core/urlOrigins';
import PTVShell from '../../shell/PTVShell';
import { getPtvRouteControllerState } from '../../shell/routeController';
import { usePtvAdminDebugVisibility } from '../../utils/usePtvAdminDebugVisibility';
import { PtvIcon } from '../icons';

import {
    addPtvMusicToQueue,
    getPtvMusicQueueSnapshot,
    nextPtvMusicTrack,
    playPtvMusicNext,
    playPtvMusicTracks,
    previousPtvMusicTrack,
    seekPtvMusicFromClientX,
    seekPtvMusicPercent,
    setPtvMusicRepeatMode,
    setPtvMusicVolume,
    setPtvMusicVirtualQueue,
    stopPtvMusicPlayback,
    subscribeToPtvMusicQueue,
    togglePtvMusicMute,
    togglePtvMusicPlayPause,
    togglePtvMusicShuffle
} from './musicQueue';
import {
    fetchPtvMusicAlbumTracks,
    fetchPtvMusicAlbumsByArtist,
    fetchPtvMusicItem,
    fetchPtvMusicLibraryIndex,
    fetchPtvMusicLyrics,
    fetchPtvMusicPlaylistTracks,
    fetchPtvMusicPlaylists,
    fetchPtvMusicTracksByArtist,
    fetchPtvMusicVideos,
    getMusicImagePlaceholder,
    getMusicImageUrl,
    getPtvMusicAlbum,
    getPtvMusicArtist,
    getPtvMusicBitrate,
    getPtvMusicCodec,
    getPtvMusicGenres,
    getPtvMusicHome,
    getPtvMusicTitle,
    invalidatePtvMusicHomeCache,
    isPtvMusicQualityMatch,
    searchPtvMusicMetadata,
    searchPtvMusic,
    uniquePtvMusicItems
} from './musicApi';
import {
    generatePtvMusicPlaylist,
    savePtvMusicPlaylist
} from './musicPlaylists';
import {
    getPtvLikedMusicItems,
    getPtvLikedMusicItemIds,
    isPtvMusicItemLiked,
    setPtvMusicItemLiked,
    subscribeToPtvLikedMusic
} from './musicLikes';
import {
    PTV_MUSIC_PLAYLISTS_CHANGED_EVENT,
    PtvMusicPlaylistModal
} from './musicPlaylistModal';
import { buildPtvMusicRelatedTracks } from './musicRecommendations';
import type {
    PtvRecommendationScoreDistribution
} from '../recommendations/types/recommendationTypes';
import type {
    PtvMusicHomeData,
    PtvMusicItem,
    PtvMusicLibraryDebug,
    PtvMusicLibraryIndex,
    PtvMusicLyricLine,
    PtvMusicMetadataLookupResponse,
    PtvMusicPlaylistResult,
    PtvMusicQueueSnapshot,
    PtvMusicSection,
    PtvMusicSeed
} from './musicTypes';

const EMPTY_HOME_DATA: PtvMusicHomeData = {
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
    sections: [],
    stats: {
        albumCount: 0,
        artistCount: 0,
        trackCount: 0
    }
};

const PTV_MUSIC_FULL_HOME_LOAD_DELAY_MS = 2500;
const PTV_MUSIC_LIBRARY_INDEX_LOAD_DELAY_MS = 5000;
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
    repeatMode: 'RepeatNone',
    runtimeTicks: 0,
    volumeLevel: 50
};

const PTV_MUSIC_LOGO_URL = resolvePtvStaticAssetUrl(PTV_ASSETS.logos.icon);
const PTV_MUSIC_FALLBACK_BACKGROUND_URL = resolvePtvStaticAssetUrl(PTV_ASSETS.backgrounds.page);
const PTV_MUSIC_LIBRARY_UI_RENDER_LIMIT = 96;
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
const failedMusicImageUrls = new Set<string>();

type MusicAdminAction = 'identify' | 'images' | 'lookup' | 'metadata';

type MusicAdminContextValue = Readonly<{
    canShowDebug: boolean;
    isAdmin: boolean;
    onAction: (item: PtvMusicItem, action: MusicAdminAction) => void;
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
type MusicPlaybackActionRequest = Readonly<{
    action: MusicPlaybackActionName;
    buildQueue: () => Promise<MusicPlaybackActionQueueResult> | MusicPlaybackActionQueueResult;
    generationSource: string;
    libraryId?: string;
    mediaSource?: string;
    playlistId?: string;
    preserveVirtualQueue?: boolean;
    sourceButton: string;
    startIndex?: number;
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

type MusicView = 'album' | 'artist' | 'explore' | 'home' | 'item' | 'library' | 'liked' | 'player' | 'playlist';

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

type ItemDetailState = Readonly<{
    error: string;
    isLoading: boolean;
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

const PLAYER_TABS = ['Up Next', 'Lyrics', 'Related'] as const;

function logMusicPageEvent(name: string, detail: Record<string, unknown> = {}) {
    recordPtvEvent('render', name, detail);
}

function getMusicPerformanceNow() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
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

function withMusicQueueTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
    return new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(() => {
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
        .then(itemIdentifier => itemIdentifier.show(itemId, serverId));
}

function cleanupMusicRouteState() {
    document.documentElement.classList.remove('ptv-route-music-mounted');
    document.body.classList.remove('ptv-route-music-mounted');
    delete document.documentElement.dataset.ptvMusicRouteMounted;
    delete document.body.dataset.ptvMusicRouteMounted;
}

function navigateToPtvHome(event?: React.MouseEvent<HTMLElement>) {
    event?.preventDefault();
    logMusicPageEvent('music-navigation-home', {
        from: window.location.hash
    });
    void stopPtvMusicPlayback('music-home-navigation');
    cleanupMusicRouteState();
    window.location.hash = '#/home';
    window.setTimeout(() => {
        scheduleRouteCheck(true);

        const routeState = getPtvRouteControllerState();

        logMusicPageEvent('music-navigation-complete', {
            currentRoute: routeState.routeId,
            hash: window.location.hash,
            mode: routeState.mode
        });
    }, 0);
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

    if (viewSegment === 'player') {
        return {
            id: '',
            search: searchTerm,
            view: 'player'
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

    return route.view.charAt(0).toUpperCase() + route.view.slice(1);
}

function getItemBackdropUrl(item: PtvMusicItem | null | undefined, size = 1200) {
    const imageUrl = getMusicImageUrl(item, size, 'Backdrop');

    if (!imageUrl || failedMusicImageUrls.has(imageUrl) || hasPtvImageUrlFailed(imageUrl)) {
        return PTV_MUSIC_FALLBACK_BACKGROUND_URL || getMusicImagePlaceholder();
    }

    return imageUrl;
}

function getMusicPageBackdropErrorHandler() {
    return (event: React.SyntheticEvent<HTMLImageElement>) => {
        const failedUrl = event.currentTarget.currentSrc || event.currentTarget.src;

        if (failedUrl && failedUrl !== PTV_MUSIC_FALLBACK_BACKGROUND_URL) {
            failedMusicImageUrls.add(failedUrl);
            markPtvImageUrlFailed(failedUrl);
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
            failedMusicImageUrls.add(failedUrl);
            markPtvImageUrlFailed(failedUrl);
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

    if (!imageUrl || failedMusicImageUrls.has(imageUrl) || hasPtvImageUrlFailed(imageUrl)) return getMusicImagePlaceholder();

    return imageUrl;
}

function getMusicItemDomKey(item: PtvMusicItem, prefix: string) {
    return item.Id
        || item.ProviderIds?.MusicBrainzTrackId
        || item.ProviderIds?.MusicBrainzAlbum
        || item.ProviderIds?.MusicBrainzArtist
        || `${prefix}-${getPtvMusicTitle(item)}-${getPtvMusicArtist(item)}-${getPtvMusicAlbum(item)}`;
}

function getSection(homeData: PtvMusicHomeData, id: string) {
    return homeData.sections.find(section => section.id === id);
}

function getSectionItems(homeData: PtvMusicHomeData, id: string) {
    return getSection(homeData, id)?.items || [];
}

function getAllHomeTracks(homeData: PtvMusicHomeData) {
    return uniquePtvMusicItems(homeData.sections
        .filter(section => section.kind === 'track')
        .reduce<PtvMusicItem[]>((items, section) => items.concat(section.items), []));
}

function getQuickPicks(homeData: PtvMusicHomeData) {
    return uniquePtvMusicItems([
        ...getSectionItems(homeData, 'recommended-for-you'),
        ...getSectionItems(homeData, 'recently-played'),
        ...getSectionItems(homeData, 'high-quality'),
        ...getAllHomeTracks(homeData)
    ]).slice(0, 12);
}

function getListenAgainItems(homeData: PtvMusicHomeData) {
    return uniquePtvMusicItems([
        ...getSectionItems(homeData, 'recently-played'),
        ...getSectionItems(homeData, 'continue-listening'),
        ...getSectionItems(homeData, 'recommended-for-you')
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
    const genres = new Set<string>();

    getAllHomeTracks(homeData).forEach(item => {
        getPtvMusicGenres(item).forEach(genre => {
            genres.add(genre);
        });
    });

    return Array.from(genres).slice(0, 12);
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
    if (kind === 'artist' || item.Type === 'MusicArtist') return 'Artist';
    if (kind === 'album' || item.Type === 'MusicAlbum') return [getPtvMusicArtist(item), getItemYear(item)].filter(Boolean).join(' - ');
    if (item.Type === 'Playlist') return 'Playlist';

    const codec = getPtvMusicCodec(item).toUpperCase();

    return [getPtvMusicArtist(item), getPtvMusicAlbum(item), codec].filter(Boolean).join(' - ');
}

function getMusicQualityBadges(item: PtvMusicItem) {
    return [
        getPtvMusicCodec(item).toUpperCase(),
        getBitrateLabel(item)
    ].filter(Boolean).slice(0, 2);
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

    useEffect(() => subscribeToPtvMusicQueue(snapshot => {
        setItem(currentItem => {
            const nextItem = snapshot.currentItem;

            if ((currentItem?.Id || '') === (nextItem?.Id || '')) return currentItem;

            return nextItem;
        });
    }), []);

    return item;
}

function MusicPageBackdrop({ item, route }: Readonly<{
    item: PtvMusicItem | null;
    route: MusicView;
}>) {
    const imageUrl = item ? getItemBackdropUrl(item, 1800) : PTV_MUSIC_FALLBACK_BACKGROUND_URL;
    const label = item ? `${getPtvMusicTitle(item)} - ${getPtvMusicArtist(item)}` : 'PiggieTV Music';

    return (
        <div className={`ptv-music-page-backdrop ptv-music-page-backdrop-${route}`} aria-hidden='true' data-ptv-music-backdrop-title={label}>
            <img
                alt=''
                decoding='async'
                loading='eager'
                src={imageUrl || PTV_MUSIC_FALLBACK_BACKGROUND_URL || getMusicImagePlaceholder()}
                onError={getMusicPageBackdropErrorHandler()}
            />
        </div>
    );
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

function useMusicLyrics(item: PtvMusicItem | null) {
    const [lyrics, setLyrics] = useState<PtvMusicLyricLine[]>([]);

    useEffect(() => {
        let isMounted = true;

        setLyrics([]);

        if (!item?.Id || !item.HasLyrics) {
            return () => {
                isMounted = false;
            };
        }

        void fetchPtvMusicLyrics(item).then(response => {
            if (isMounted) {
                setLyrics(response.Lyrics || []);
            }
        });

        return () => {
            isMounted = false;
        };
    }, [item]);

    return lyrics;
}

type MusicActionButtonProps = Readonly<{
    children?: React.ReactNode;
    className?: string;
    icon?: string;
    isActive?: boolean;
    label: string;
    onClick: () => void;
}>;

function MusicActionButton({
    children,
    className = '',
    icon,
    isActive = false,
    label,
    onClick
}: MusicActionButtonProps) {
    return (
        <button
            type='button'
            className={`ptv-music-action ${isActive ? 'ptv-music-action-active' : ''} ${className}`.trim()}
            aria-label={label}
            title={label}
            onClick={onClick}
        >
            {icon ? <PtvIcon name={icon} /> : null}
            {children ? <span>{children}</span> : null}
        </button>
    );
}

type MusicTopBarProps = Readonly<{
    initialSearch: string;
}>;

function MusicTopBar({ initialSearch }: MusicTopBarProps) {
    const [searchTerm, setSearchTerm] = useState(initialSearch);

    useEffect(() => {
        setSearchTerm(initialSearch);
    }, [initialSearch]);

    const onSubmit = (event: FormEvent) => {
        event.preventDefault();
        const normalizedSearchTerm = searchTerm.trim();

        window.location.hash = normalizedSearchTerm ?
            `#/music/explore?search=${encodeURIComponent(normalizedSearchTerm)}` :
            '#/music/explore';
    };

    return (
        <header className='ptv-music-top'>
            <a className='ptv-music-brand' href='#/music' aria-label='PiggieTV Music home'>
                <span className='ptv-music-brand-mark'>
                    <img
                        alt=''
                        decoding='async'
                        loading='eager'
                        src={PTV_MUSIC_LOGO_URL}
                    />
                </span>
                <strong>PiggieTV Music</strong>
            </a>
            <form className='ptv-music-search' onSubmit={onSubmit}>
                <PtvIcon name='search' />
                <input
                    value={searchTerm}
                    onChange={event => setSearchTerm(event.target.value)}
                    placeholder='Search songs, albums, artists, playlists'
                    aria-label='Search music'
                />
            </form>
            <div className='ptv-music-top-actions'>
                <a href='#/home' aria-label='Go to PiggieTV home' onClick={navigateToPtvHome}>
                    <PtvIcon name='home' />
                </a>
                <a href='#/music/player' aria-label='Open now playing'>
                    <PtvIcon name='fullscreen' />
                </a>
                <a href='#/music/library' aria-label='Open music library'>
                    <PtvIcon name='library' />
                </a>
            </div>
        </header>
    );
}

type MusicSidebarProps = Readonly<{
    likedCount: number;
    playlists: PtvMusicItem[];
    route: MusicRouteState;
}>;

function MusicSidebar({ likedCount, playlists, route }: MusicSidebarProps) {
    const navItems = [
        {
            href: '#/home',
            icon: 'home',
            id: 'ptv-home',
            label: 'PTV Home'
        },
        {
            href: '#/music',
            icon: 'music',
            id: 'home',
            label: 'Music Home'
        },
        {
            href: '#/music/explore',
            icon: 'shuffle',
            id: 'explore',
            label: 'Explore'
        },
        {
            href: '#/music/library',
            icon: 'library',
            id: 'library',
            label: 'Library'
        },
        {
            href: PTV_ROUTES.readingLibrary,
            icon: 'books',
            id: 'reading-library',
            label: 'Reading Library'
        }
    ];

    const makeDiscoveryPlaylist = () => {
        recordPtvEvent('render', 'playlist-create-clicked', {
            source: 'music-sidebar-new-playlist'
        });
        void generatePtvMusicPlaylist({
            prompt: 'Make 50-song discovery mix',
            seed: {
                kind: 'random',
                label: 'Discovery'
            }
        }).then(result => savePtvMusicPlaylist(result.name, result.items))
            .catch(error => {
                recordPtvEvent('render', 'playlist-create-failed', {
                    error: error instanceof Error ? error.message : String(error),
                    source: 'music-sidebar-new-playlist'
                });
            });
    };

    return (
        <aside className='ptv-music-sidebar' aria-label='Music navigation'>
            <nav className='ptv-music-sidebar-nav'>
                {navItems.map(item => (
                    <a
                        key={item.id}
                        className={route.view === item.id ? 'ptv-music-nav-active' : ''}
                        href={item.href}
                        onClick={item.id === 'ptv-home' ? navigateToPtvHome : undefined}
                    >
                        <PtvIcon name={item.icon} />
                        <span>{item.label}</span>
                    </a>
                ))}
            </nav>
            <button type='button' className='ptv-music-new-playlist' onClick={makeDiscoveryPlaylist}>
                <PtvIcon name='playlists' />
                <span>New playlist</span>
            </button>
            <div className='ptv-music-sidebar-playlists'>
                <p className='ptv-music-sidebar-heading'>Playlists</p>
                <a href='#/music/liked'>
                    <strong>Liked Music</strong>
                    <span>{likedCount ? `${likedCount} favorite songs` : 'Favorite songs'}</span>
                </a>
                {playlists.slice(0, 18).map(item => (
                    <a
                        key={getMusicItemDomKey(item, 'sidebar-playlist')}
                        href={`#/music/playlist/${encodeURIComponent(item.Id || '')}`}
                    >
                        <strong>{getPtvMusicTitle(item)}</strong>
                        <span>Music playlist</span>
                    </a>
                ))}
                {!playlists.length ? (
                    <p className='ptv-music-sidebar-empty'>No music playlists yet</p>
                ) : null}
            </div>
        </aside>
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
            buildQueue: async () => {
                const result = await generatePtvMusicPlaylist({
                    prompt: isQualityChip ? `Make ${chip.toUpperCase()}-only playlist` : `Make 50-song ${chip} mix`,
                    seed: {
                        kind: isQualityChip ? 'quality' : 'genre',
                        label: chip,
                        value: normalizedChip
                    }
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

function getMenuSeedKind(item: PtvMusicItem): PtvMusicSeed['kind'] {
    if (item.Type === 'MusicAlbum') return 'album';
    if (item.Type === 'MusicArtist') return 'artist';

    return 'song';
}

function MusicItemMenu({ item }: Readonly<{
    item: PtvMusicItem;
}>) {
    const { isAdmin, onAction } = useMusicAdminControls();
    const playbackActions = useMusicPlaybackActions();
    const title = getPtvMusicTitle(item);
    const [isOpen, setOpen] = useState(false);
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
    const closeMenu = () => setOpen(false);
    const startMix = () => {
        closeMenu();
        void playbackActions.runPlaybackAction({
            action: 'generate-play',
            buildQueue: async () => {
                const result = await generatePtvMusicPlaylist({
                    limit: 50,
                    seed: {
                        id: item.Id,
                        item,
                        kind: getMenuSeedKind(item),
                        label: title,
                        value: title
                    }
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
        onAction(item, action);
    };

    return (
        <div className='ptv-music-item-menu'>
            <button
                type='button'
                className='ptv-music-item-menu-button'
                aria-expanded={isOpen}
                aria-haspopup='menu'
                aria-label={`Open actions for ${title}`}
                title={`Actions for ${title}`}
                onClick={() => setOpen(current => !current)}
            >
                <PtvIcon name='moreVertical' />
            </button>
            {isOpen ? (
                <div className='ptv-music-item-menu-popover' role='menu'>
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
                </div>
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
                        <span>{[getPtvMusicArtist(state.item), getPtvMusicAlbum(state.item)].filter(Boolean).join(' - ')}</span>
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
                    <button type='button' onClick={() => void openMusicAdminDialog(state.item, 'identify')}>
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
            buildQueue: async () => {
                const result = await generatePtvMusicPlaylist({
                    limit: 50,
                    seed: {
                        id: item.Id,
                        item,
                        kind: getSeedKindForCollection(kind, 'random'),
                        label: title,
                        value: title
                    }
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
            buildQueue: async () => {
                const result = await generatePtvMusicPlaylist({
                    limit: 50,
                    seed: {
                        id: item.Id,
                        item,
                        kind: getSeedKindForCollection(kind, 'song'),
                        label: title,
                        value: title
                    }
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
                <a className='ptv-music-card-art' href={href} aria-label={`Open ${title}`}>
                    <img
                        alt=''
                        decoding='async'
                        loading='lazy'
                        src={getCachedMusicImageUrl(item, shape === 'artist' ? 280 : 360)}
                        onError={getMusicImageErrorHandler()}
                    />
                    {isTrack ? <MusicQualityTags item={item} /> : null}
                </a>
            ) : (
                <button type='button' className='ptv-music-card-art' disabled={playbackActions.isBusy} onClick={playItem} aria-label={`Play ${title}`}>
                    <img
                        alt=''
                        decoding='async'
                        loading='lazy'
                        src={getCachedMusicImageUrl(item, 360)}
                        onError={getMusicImageErrorHandler()}
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
                {rowItems.map((item, index) => (
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
}>;

function QuickPicks({ items }: QuickPicksProps) {
    const playbackActions = useMusicPlaybackActions();
    const tracks = uniquePtvMusicItems(items).slice(0, 12);

    if (!tracks.length) return null;

    return (
        <section className='ptv-music-quick-picks'>
            <div className='ptv-music-section-heading'>
                <div>
                    <p className='ptv-music-kicker'>Library radio</p>
                    <h2>Quick picks</h2>
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
                {tracks.map((item, index) => (
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
    onGenerated: (result: PtvMusicPlaylistResult) => void;
}>;

function MusicHomeHero({ homeData, items, onGenerated }: MusicHomeHeroProps) {
    const playbackActions = useMusicPlaybackActions();
    const heroItem = items[0] || getAllHomeTracks(homeData)[0] || null;
    const heroTracks = heroItem ? uniquePtvMusicItems([
        heroItem,
        ...items,
        ...getAllHomeTracks(homeData)
    ]).slice(0, 36) : [];
    const libraryName = homeData.library?.name || 'Music';
    const trackCountLabel = getMusicHeroTrackCountLabel(homeData);

    const makeRadio = () => {
        if (!heroItem) return;

        void playbackActions.runPlaybackAction({
            action: 'generate-play',
            buildQueue: async () => {
                const result = await generatePtvMusicPlaylist({
                    prompt: `Make playlist from ${getPtvMusicTitle(heroItem)}`,
                    seed: {
                        id: heroItem.Id,
                        item: heroItem,
                        kind: 'song',
                        label: getPtvMusicTitle(heroItem)
                    }
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
                <img
                    alt=''
                    decoding='async'
                    loading='eager'
                    src={getCachedMusicImageUrl(heroItem, 900, 'Backdrop')}
                    onError={getMusicImageErrorHandler()}
                />
            </div>
            <div className='ptv-music-home-hero-art'>
                <img
                    alt=''
                    decoding='async'
                    loading='eager'
                    src={getCachedMusicImageUrl(heroItem, 380)}
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
            <button type='button' className='ptv-music-track-art' disabled={playbackActions.isBusy} onClick={playItem}>
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
                <span>{getPtvMusicArtist(item)} - {getPtvMusicAlbum(item)}</span>
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

type PlayerQueueSongCardProps = Readonly<{
    contextIndex: number;
    contextItems: PtvMusicItem[];
    item: PtvMusicItem;
    listId: string;
}>;

function PlayerQueueSongCard({
    contextIndex,
    contextItems,
    item,
    listId
}: PlayerQueueSongCardProps) {
    const playbackActions = useMusicPlaybackActions();
    const title = getPtvMusicTitle(item);
    const artist = getPtvMusicArtist(item);
    const album = getPtvMusicAlbum(item);
    const meta = [artist, album].filter(Boolean).join(' - ');

    const playItem = () => {
        void playbackActions.runPlaybackAction({
            action: 'play-item',
            buildQueue: () => ({ items: contextItems }),
            generationSource: 'player-queue',
            mediaSource: 'track',
            preserveVirtualQueue: true,
            sourceButton: `player-queue-play-${item.Id || title}`,
            startIndex: contextIndex
        });
    };

    return (
        <article className='ptv-music-player-song-card' data-ptv-music-key={getMusicItemDomKey(item, listId)}>
            <button
                type='button'
                className='ptv-music-player-song-card-main'
                aria-label={`Play ${title}`}
                disabled={playbackActions.isBusy}
                onClick={playItem}
            >
                <span className='ptv-music-player-song-play'>
                    <PtvIcon name='play' />
                </span>
                <img
                    alt=''
                    decoding='async'
                    loading='lazy'
                    src={getCachedMusicImageUrl(item, 112)}
                    onError={getMusicImageErrorHandler()}
                />
                <span className='ptv-music-player-song-copy'>
                    <strong>{title}</strong>
                    <em>{meta || artist}</em>
                </span>
            </button>
        </article>
    );
}

type TrackTableProps = Readonly<{
    items: PtvMusicItem[];
    title?: string;
}>;

function TrackTable({ items, title = 'Top songs' }: TrackTableProps) {
    const playbackActions = useMusicPlaybackActions();
    const tracks = uniquePtvMusicItems(items).slice(0, 12);
    const likedIds = useLikedMusicIds();

    if (!tracks.length) return null;

    const playTrack = (index: number) => {
        void playbackActions.runPlaybackAction({
            action: 'play-item',
            buildQueue: () => ({ items: tracks }),
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
                        buildQueue: () => ({ items: tracks }),
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
                {tracks.map((item, index) => (
                    <article key={getMusicItemDomKey(item, title)} className='ptv-music-track-row'>
                        <button type='button' className='ptv-music-track-art' disabled={playbackActions.isBusy} onClick={() => playTrack(index)}>
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
                        <span>{getPtvMusicArtist(item)}</span>
                        <span>{Number(item.UserData?.PlayCount || 0).toLocaleString()} plays</span>
                        <span>{getPtvMusicAlbum(item)}</span>
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
                        {generated.items.slice(0, 9).map((item, index) => (
                            <TrackCompactRow
                                key={getMusicItemDomKey(item, generated.name)}
                                contextIndex={index}
                                contextItems={generated.items.slice(0, 9)}
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
    onGenerated: (result: PtvMusicPlaylistResult) => void;
}>;

function MusicHomeView({ generated, homeData, onGenerated }: MusicHomeViewProps) {
    const listenAgain = getListenAgainItems(homeData);
    const quickPicks = getQuickPicks(homeData);
    const recommendationRows = homeData.sections.filter(section => ![
        'recently-played',
        'continue-listening'
    ].includes(section.id));

    return (
        <div className='ptv-music-view ptv-music-home-view'>
            <MusicHomeHero homeData={homeData} items={listenAgain} onGenerated={onGenerated} />
            <MusicChips homeData={homeData} onGenerated={onGenerated} />
            <MusicRow
                items={listenAgain}
                onGenerated={onGenerated}
                subtitle='For your library'
                title='Listen again'
            />
            <QuickPicks items={quickPicks} />
            <SmartPlaylistPanel generated={generated} onGenerated={onGenerated} />
            {recommendationRows.map(section => (
                <MusicRow
                    key={section.id}
                    items={section.items}
                    kind={section.kind}
                    onGenerated={onGenerated}
                    shape={section.kind === 'artist' ? 'artist' : 'square'}
                    subtitle={section.subtitle || section.kind}
                    title={section.title}
                />
            ))}
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
    const genreSections = homeData.sections.filter(section => section.id.startsWith('genre-'));
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
        ['failedImageUrlCount', failedMusicImageUrls.size],
        ['failedImageUrls', Array.from(failedMusicImageUrls).slice(-5).join(' | ') || 'none'],
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
    likedSongs,
    onGenerated,
    playlists
}: MusicLibraryViewProps) {
    const albumCountState = getMusicLibraryCountState(homeData, 'albums');
    const artistCountState = getMusicLibraryCountState(homeData, 'artists');
    const trackCountState = getMusicLibraryCountState(homeData, 'tracks');

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

type ArtistViewProps = Readonly<{
    detail: ArtistDetailState;
    homeData: PtvMusicHomeData;
    onGenerated: (result: PtvMusicPlaylistResult) => void;
}>;

function ArtistView({ detail, homeData, onGenerated }: ArtistViewProps) {
    const playbackActions = useMusicPlaybackActions();
    const artist = detail.artist;
    const artistName = getPtvMusicTitle(artist);
    const singles = detail.topSongs.filter(item => !detail.albums.some(album => album.Id === item.AlbumId)).slice(0, 12);
    const similarArtists = getSectionItems(homeData, 'top-artists')
        .filter(item => item.Id !== artist?.Id && getPtvMusicTitle(item) !== artistName)
        .slice(0, 16);

    if (detail.isLoading) return <MusicLoading label='Loading artist' />;
    if (detail.error) return <MusicError message={detail.error} />;
    if (!artist) return <MusicError message='Artist could not be loaded.' />;

    const playArtist = () => {
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
            buildQueue: async () => {
                const result = await generatePtvMusicPlaylist({
                    limit: 50,
                    seed: {
                        id: artist.Id,
                        item: artist,
                        kind: 'artist',
                        label: artistName,
                        value: artistName
                    }
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
                            <PtvIcon name='shuffle' />
                            <MusicActionSpinner active={isMusicActionActive(playbackActions, `artist-shuffle-${artist.Id || artistName}`)} />
                            <span>Shuffle</span>
                        </button>
                        <button type='button' disabled={playbackActions.isBusy} onClick={makeArtistRadio}>
                            <PtvIcon name='music' />
                            <MusicActionSpinner active={isMusicActionActive(playbackActions, `artist-radio-${artist.Id || artistName}`)} />
                            <span>Mix</span>
                        </button>
                        <button type='button' onClick={() => artist.Id && void setPtvFavorite(artist.Id, !artist.UserData?.IsFavorite)}>
                            <PtvIcon name='favorite' />
                            <span>{artist.UserData?.IsFavorite ? 'Favorited' : 'Favorite'}</span>
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
            <MusicRow
                items={similarArtists}
                kind='artist'
                onGenerated={onGenerated}
                shape='artist'
                subtitle='Related'
                title='Fans might also like'
            />
        </div>
    );
}

type AlbumOrPlaylistViewProps = Readonly<{
    detail: ItemDetailState;
    kind: 'album' | 'playlist';
    onGenerated: (result: PtvMusicPlaylistResult) => void;
}>;

function AlbumOrPlaylistView({ detail, kind, onGenerated }: AlbumOrPlaylistViewProps) {
    const playbackActions = useMusicPlaybackActions();
    const item = detail.item;
    const title = getPtvMusicTitle(item);

    if (detail.isLoading) return <MusicLoading label={`Loading ${kind}`} />;
    if (detail.error) return <MusicError message={detail.error} />;
    if (!item) return <MusicError message={`${kind === 'album' ? 'Album' : 'Playlist'} could not be loaded.`} />;

    const makeRadio = () => {
        void playbackActions.runPlaybackAction({
            action: 'generate-play',
            buildQueue: async () => {
                const result = await generatePtvMusicPlaylist({
                    limit: 50,
                    seed: {
                        id: item.Id,
                        item,
                        kind: kind === 'album' ? 'album' : 'random',
                        label: title,
                        value: title
                    }
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
                    <p>{[getPtvMusicArtist(item), getItemYear(item), `${detail.tracks.length} tracks`].filter(Boolean).join(' - ')}</p>
                    <div className='ptv-music-detail-actions'>
                        <button
                            type='button'
                            disabled={playbackActions.isBusy}
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
                        <button type='button' disabled={playbackActions.isBusy} onClick={makeRadio}>
                            <PtvIcon name='shuffle' />
                            <MusicActionSpinner active={isMusicActionActive(playbackActions, `${kind}-radio-${item.Id || title}`)} />
                            <span>Radio</span>
                        </button>
                        <button type='button' onClick={() => item.Id && void setPtvFavorite(item.Id, !item.UserData?.IsFavorite)}>
                            <PtvIcon name='favorite' />
                            <span>{item.UserData?.IsFavorite ? 'Favorited' : 'Favorite'}</span>
                        </button>
                        <MusicAdminActions item={item} />
                    </div>
                </div>
            </section>
            <TrackTable items={detail.tracks} title={kind === 'album' ? 'Songs' : 'Playlist tracks'} />
        </div>
    );
}

type PlayerViewProps = Readonly<{
    homeData: PtvMusicHomeData;
    musicVideos: PtvMusicItem[];
}>;

type PlayerSidePanelProps = Readonly<{
    isRelatedLoading: boolean;
    item: PtvMusicItem;
    lyrics: PtvMusicLyricLine[];
    queueItems: PtvMusicItem[];
    relatedItems: PtvMusicItem[];
}>;

type PlayerTrackListProps = Readonly<{
    emptyMessage: string;
    isLoading: boolean;
    items: PtvMusicItem[];
    listId: string;
}>;

function PlayerTrackList({
    emptyMessage,
    isLoading,
    items,
    listId
}: PlayerTrackListProps) {
    return (
        <div className='ptv-music-player-list'>
            {isLoading ? <p className='ptv-music-empty'>Finding related tracks...</p> : null}
            {!isLoading && !items.length ? <p className='ptv-music-empty'>{emptyMessage}</p> : null}
            {items.map((item, index) => (
                <PlayerQueueSongCard
                    key={getMusicItemDomKey(item, listId)}
                    contextIndex={index}
                    contextItems={items}
                    item={item}
                    listId={listId}
                />
            ))}
        </div>
    );
}

function PlayerSidePanel({
    isRelatedLoading,
    item,
    lyrics,
    queueItems,
    relatedItems
}: PlayerSidePanelProps) {
    const [activeTab, setActiveTab] = useState<typeof PLAYER_TABS[number]>('Up Next');
    const [saveStatus, setSaveStatus] = useState('');
    const panelTitle = activeTab === 'Up Next' ? 'Playing from' : activeTab;

    const saveQueue = () => {
        setSaveStatus('Saving...');
        void savePtvMusicPlaylist('PiggieTV Now Playing Queue', queueItems).then(() => {
            setSaveStatus('Saved');
        }).catch(error => {
            setSaveStatus(error instanceof Error ? error.message : 'Could not save queue');
        });
    };

    return (
        <aside className='ptv-music-player-panel'>
            <div className='ptv-music-player-tabs' role='tablist' aria-label='Now playing panels'>
                {PLAYER_TABS.map(tab => (
                    <button
                        key={tab}
                        type='button'
                        className={activeTab === tab ? 'ptv-music-player-tab-active' : ''}
                        onClick={() => setActiveTab(tab)}
                    >
                        {tab}
                    </button>
                ))}
            </div>
            <div className='ptv-music-player-panel-actions'>
                <div>
                    <strong>{panelTitle}</strong>
                    <span>{getPtvMusicAlbum(item)}</span>
                </div>
                <button type='button' onClick={saveQueue}>
                    <PtvIcon name='playlists' />
                    <span>Save queue</span>
                </button>
            </div>
            {saveStatus ? <p className='ptv-music-generator-status'>{saveStatus}</p> : null}
            {activeTab === 'Up Next' ? (
                <>
                    <div className='ptv-music-related-queue-note'>
                        <div>
                            <strong>Related queue</strong>
                        </div>
                    </div>
                    <PlayerTrackList
                        emptyMessage='No related tracks matched this song yet.'
                        isLoading={isRelatedLoading}
                        items={queueItems}
                        listId='player-queue'
                    />
                </>
            ) : null}
            {activeTab === 'Lyrics' ? (
                <div className='ptv-music-lyrics-lines'>
                    {lyrics.length ? lyrics.slice(0, 72).map(line => (
                        <p key={`${line.Start || 0}-${line.Text || ''}`}>{line.Text}</p>
                    )) : <p className='ptv-music-empty'>No lyrics metadata</p>}
                </div>
            ) : null}
            {activeTab === 'Related' ? (
                <PlayerTrackList
                    emptyMessage='No related tracks matched this song yet.'
                    isLoading={isRelatedLoading}
                    items={relatedItems}
                    listId='player-related'
                />
            ) : null}
        </aside>
    );
}

function PlayerView({ homeData, musicVideos }: PlayerViewProps) {
    const snapshot = useMusicQueueSnapshot();
    const item = snapshot.currentItem;
    const autoQueueSeedItem = snapshot.autoQueueSeedItem || item;
    const lyrics = useMusicLyrics(item);
    const progress = getProgressPercent(snapshot);
    const [relatedItems, setRelatedItems] = useState<PtvMusicItem[]>([]);
    const [isRelatedLoading, setIsRelatedLoading] = useState(false);
    const [isPlaylistModalOpen, setPlaylistModalOpen] = useState(false);
    const { isLiked, toggleLiked } = useLikedMusicItem(item, 'player-page-favorite');
    const relatedPool = useMemo(() => getAllHomeTracks(homeData), [homeData]);
    const remainingPlaylistItems = snapshot.currentIndex >= 0 ?
        snapshot.playlist.slice(snapshot.currentIndex + 1) :
        snapshot.playlist.filter(queueItem => queueItem.Id !== item?.Id);
    const visibleRelatedItems = relatedItems.filter(relatedItem => relatedItem.Id !== item?.Id);
    const queueItems = remainingPlaylistItems.length ? remainingPlaylistItems : visibleRelatedItems;
    const playerBackdropItem = useMemo(() => getPlayerArtistBackdropItem(item, homeData), [homeData, item]);
    const playNextFromVisibleQueue = () => nextPtvMusicTrack();

    useEffect(() => {
        recordPtvEvent('render', 'music-player-mounted', {
            itemId: item?.Id || null,
            route: 'page'
        });
    }, [item?.Id]);

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
        void buildPtvMusicRelatedTracks(autoQueueSeedItem, {
            limit: 24,
            pool: relatedPool
        }).then(items => {
            if (disposed) return;

            setRelatedItems(items);
            setPtvMusicVirtualQueue(autoQueueSeedItem, items, 'player-related');
        }).finally(() => {
            if (!disposed) {
                setIsRelatedLoading(false);
            }
        });

        return () => {
            disposed = true;
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
        <div className='ptv-music-view ptv-music-now-playing-view'>
            <div className='ptv-music-now-playing-backdrop' aria-hidden='true'>
                <img
                    alt=''
                    decoding='async'
                    loading='eager'
                    src={getItemBackdropUrl(playerBackdropItem || item, 1200)}
                    onError={getMusicPageBackdropErrorHandler()}
                />
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
                    src={getCachedMusicImageUrl(item, 520)}
                    onError={getMusicImageErrorHandler()}
                />
                <div className='ptv-music-now-playing-meta'>
                    <h1>{getPtvMusicTitle(item)}</h1>
                    <p>{getPtvMusicArtist(item)} - {getPtvMusicAlbum(item)}</p>
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
                        icon={snapshot.isPlaying ? 'pause' : 'play'}
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
                        onClick={() => setPlaylistModalOpen(true)}
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
            <PlayerSidePanel
                isRelatedLoading={isRelatedLoading}
                item={item}
                lyrics={lyrics}
                queueItems={queueItems}
                relatedItems={relatedItems}
            />
            <PtvMusicPlaylistModal
                isOpen={isPlaylistModalOpen}
                item={item}
                onClose={() => setPlaylistModalOpen(false)}
            />
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
        error: '',
        isLoading: false,
        item: null,
        tracks: []
    };
}

function getMusicErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function recoverMusicPageItems(stage: string, promise: Promise<PtvMusicItem[]>): Promise<PtvMusicItem[]> {
    return promise.catch(error => {
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

function getMusicHeroTrackCountLabel(homeData: PtvMusicHomeData) {
    const state = getMusicLibraryCountState(homeData, 'tracks');

    if (state === 'pending') return 'Loading library tracks';
    if (state === 'failed' && homeData.stats.trackCount === 0) return '';

    return `${homeData.stats.trackCount} library ${homeData.stats.trackCount === 1 ? 'track' : 'tracks'}`;
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

export default function PiggieTvMusicPage() {
    const location = useLocation();
    const route = useMemo(() => getMusicRoute(location.pathname, location.search), [location.pathname, location.search]);
    const backgroundSeedRef = useRef(Date.now());
    const musicLibraryIndexRequestIdRef = useRef(0);
    const musicMountedRef = useRef(false);
    const musicRequestIdRef = useRef(0);
    const [homeData, setHomeData] = useState<PtvMusicHomeData>(EMPTY_HOME_DATA);
    const [playlists, setPlaylists] = useState<PtvMusicItem[]>([]);
    const [albums, setAlbums] = useState<PtvMusicItem[]>([]);
    const [artists, setArtists] = useState<PtvMusicItem[]>([]);
    const [musicVideos, setMusicVideos] = useState<PtvMusicItem[]>([]);
    const [likedSongs, setLikedSongs] = useState<PtvMusicItem[]>(() => getPtvLikedMusicItems());
    const [generated, setGenerated] = useState<PtvMusicPlaylistResult | null>(null);
    const [metadataLookup, setMetadataLookup] = useState<MusicMetadataLookupState | null>(null);
    const [searchResults, setSearchResults] = useState<PtvMusicItem[]>([]);
    const [artistDetail, setArtistDetail] = useState<ArtistDetailState>(getInitialArtistDetail);
    const [albumDetail, setAlbumDetail] = useState<ItemDetailState>(getInitialItemDetail);
    const [playlistDetail, setPlaylistDetail] = useState<ItemDetailState>(getInitialItemDetail);
    const [isLoading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState('');
    const activePlaybackActionRef = useRef<MusicPlaybackActionState | null>(null);
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

    const runMusicMetadataLookup = useCallback((item: PtvMusicItem) => {
        setMetadataLookup({
            error: '',
            isLoading: true,
            item,
            response: null
        });

        void searchPtvMusicMetadata(item)
            .then(response => {
                setMetadataLookup({
                    error: '',
                    isLoading: false,
                    item,
                    response
                });
            })
            .catch(error => {
                const message = getMusicErrorMessage(error) || 'Music metadata lookup failed.';

                recordPtvEvent('api', 'music-metadata-lookup-failed', {
                    error: message,
                    itemId: item.Id || null
                });
                setMetadataLookup({
                    error: message,
                    isLoading: false,
                    item,
                    response: null
                });
            });
    }, []);

    const openAdminAction = useCallback((item: PtvMusicItem, action: MusicAdminAction) => {
        if (action === 'lookup') {
            runMusicMetadataLookup(item);
            return;
        }

        void openMusicAdminDialog(item, action)
            .catch(error => {
                recordPtvEvent('render', 'music-admin-dialog-failed', {
                    action,
                    error: getMusicErrorMessage(error),
                    itemId: item.Id || null
                });
            });
    }, [runMusicMetadataLookup]);

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

        activePlaybackActionRef.current = nextAction;
        setActivePlaybackAction(nextAction);

        try {
            const queueGenerationStartedAt = getMusicPerformanceNow();
            const timeoutMs = getMusicQueueTimeoutMs();
            const queueResult = await withMusicQueueTimeout(
                Promise.resolve().then(request.buildQueue),
                timeoutMs,
                `${request.sourceButton} queue generation`
            );
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
            await playPtvMusicTracks(queueItems, safeStartIndex, {
                preserveVirtualQueue: Boolean(request.preserveVirtualQueue),
                rejectOnPlaybackError: true
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

            telemetry.queueGenerationFailures += 1;
            toast('Unable to generate playlist');
            recordPtvEvent('playback', 'music-queue-generation-failed', {
                ...clickDetail,
                cancelledPromise: /cancel/i.test(message),
                emptyQueueCount: telemetry.emptyQueueCount,
                exception: message,
                failureReason: message,
                queueGenerationFailures: telemetry.queueGenerationFailures,
                timeout: /timed out/i.test(message),
                totalActionMs: Math.round((getMusicPerformanceNow() - clickPerformanceAt) * 10) / 10
            });

            return false;
        } finally {
            activePlaybackActionRef.current = null;
            setActivePlaybackAction(null);
        }
    }, []);

    const playbackActionControls = useMemo<MusicPlaybackActionContextValue>(() => ({
        activeAction: activePlaybackAction,
        isBusy: Boolean(activePlaybackAction),
        runPlaybackAction
    }), [activePlaybackAction, runPlaybackAction]);

    const loadMusicLibraryIndex = useCallback((forceRefresh = false, ownerRequestId = musicRequestIdRef.current) => {
        const libraryRequestId = ++musicLibraryIndexRequestIdRef.current;

        return fetchPtvMusicLibraryIndex({ forceRefresh })
            .then(libraryIndex => {
                if (
                    !musicMountedRef.current
                    || ownerRequestId !== musicRequestIdRef.current
                    || libraryRequestId !== musicLibraryIndexRequestIdRef.current
                ) {
                    return;
                }

                setHomeData(previous => mergeMusicLibraryIndex(previous, libraryIndex));
                if (!libraryIndex.debug.failedSections.includes('playlists')) {
                    setPlaylists(libraryIndex.playlists.slice(0, PTV_MUSIC_LIBRARY_UI_RENDER_LIMIT));
                }

                if (!libraryIndex.debug.failedSections.includes('albums')) {
                    setAlbums(libraryIndex.albums.slice(0, PTV_MUSIC_LIBRARY_UI_RENDER_LIMIT));
                }

                if (!libraryIndex.debug.failedSections.includes('artists')) {
                    setArtists(libraryIndex.artists.slice(0, PTV_MUSIC_LIBRARY_UI_RENDER_LIMIT));
                }
                const libraryUiDiagnostic = {
                    albumCount: libraryIndex.albums.length,
                    albumsRendered: Math.min(libraryIndex.albums.length, PTV_MUSIC_LIBRARY_UI_RENDER_LIMIT),
                    artistCount: libraryIndex.artists.length,
                    artistsRendered: Math.min(libraryIndex.artists.length, PTV_MUSIC_LIBRARY_UI_RENDER_LIMIT),
                    libraryId: libraryIndex.library?.id || null,
                    libraryName: libraryIndex.library?.name || null,
                    playlistCount: libraryIndex.playlists.length,
                    playlistsRendered: Math.min(libraryIndex.playlists.length, PTV_MUSIC_LIBRARY_UI_RENDER_LIMIT),
                    songCount: libraryIndex.tracks.length,
                    tracksFetched: libraryIndex.tracks.length
                };

                recordPtvEvent('api', 'music-library-ui-counts-loaded', {
                    ...libraryUiDiagnostic,
                    debug: libraryIndex.debug
                });
                console.info('[PTV Music] music library UI counts', libraryUiDiagnostic);
            })
            .catch(error => {
                recordPtvEvent('api', 'music-library-index-background-failed', {
                    error: getMusicErrorMessage(error)
                });
            });
    }, []);

    const loadMusicData = useCallback((forceRefresh = false) => {
        const requestId = ++musicRequestIdRef.current;
        const isCurrentRequest = () => musicMountedRef.current && requestId === musicRequestIdRef.current;

        setLoading(true);
        setErrorMessage('');

        if (forceRefresh) {
            invalidatePtvMusicHomeCache();
        }

        const loadMusicVideos = () => {
            void recoverMusicPageItems('music-videos', fetchPtvMusicVideos(8))
                .then(nextMusicVideos => {
                    if (isCurrentRequest()) {
                        setMusicVideos(nextMusicVideos);
                    }
                });
        };
        const scheduleLibraryIndex = () => {
            window.setTimeout(() => {
                if (isCurrentRequest()) {
                    void loadMusicLibraryIndex(forceRefresh, requestId);
                }
            }, PTV_MUSIC_LIBRARY_INDEX_LOAD_DELAY_MS);
        };
        const loadFullHomeData = () => {
            void getPtvMusicHome({ forceRefresh })
                .then(nextHomeData => {
                    if (!isCurrentRequest()) return;

                    const nextAlbums = getSectionItems(nextHomeData, 'top-albums');
                    const nextArtists = getSectionItems(nextHomeData, 'top-artists');

                    setHomeData(previous => mergeMusicHomeDataWithLibraryState(previous, nextHomeData));
                    if (nextAlbums.length) setAlbums(nextAlbums);
                    if (nextArtists.length) setArtists(nextArtists);
                })
                .catch(error => {
                    recordPtvEvent('render', 'music-playback-error', {
                        error: getMusicErrorMessage(error),
                        stage: 'music-shell-background-data'
                    });
                });
        };

        return getPtvMusicHome({ forceRefresh, initialOnly: true })
            .then(nextHomeData => {
                if (!isCurrentRequest()) return;

                const nextAlbums = getSectionItems(nextHomeData, 'top-albums');
                const nextArtists = getSectionItems(nextHomeData, 'top-artists');

                setHomeData(previous => mergeMusicHomeDataWithLibraryState(previous, nextHomeData));
                if (nextAlbums.length) setAlbums(nextAlbums);
                if (nextArtists.length) setArtists(nextArtists);
                setLoading(false);
                loadMusicVideos();
                scheduleLibraryIndex();

                if (nextHomeData.isPartial) {
                    window.setTimeout(() => {
                        if (isCurrentRequest()) loadFullHomeData();
                    }, PTV_MUSIC_FULL_HOME_LOAD_DELAY_MS);
                }
            })
            .catch(error => {
                if (!isCurrentRequest()) return;

                setErrorMessage(getMusicErrorMessage(error) || 'Music could not be loaded.');
                recordPtvEvent('render', 'music-playback-error', {
                    error: getMusicErrorMessage(error),
                    stage: 'music-shell-data'
                });
                setLoading(false);
            });
    }, [loadMusicLibraryIndex]);

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
        window.setTimeout(() => {
            if (verifyMusicShell()) {
                logMusicPageEvent('music-shell-attached', {
                    hash: window.location.hash
                });
            }
        }, 0);
        void loadMusicData();

        return () => {
            musicMountedRef.current = false;
            musicRequestIdRef.current += 1;
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
    }, [loadMusicData]);

    useEffect(() => subscribeToPtvLikedMusic(setLikedSongs), []);

    useEffect(() => {
        const refreshPlaylists = () => {
            void recoverMusicPageItems('playlists-refresh', fetchPtvMusicPlaylists())
                .then(items => setPlaylists(items.slice(0, PTV_MUSIC_LIBRARY_UI_RENDER_LIMIT)));
        };

        window.addEventListener(PTV_MUSIC_PLAYLISTS_CHANGED_EVENT, refreshPlaylists);

        return () => {
            window.removeEventListener(PTV_MUSIC_PLAYLISTS_CHANGED_EVENT, refreshPlaylists);
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
        let isMounted = true;

        setSearchResults([]);

        if (route.view !== 'explore' || !route.search) return undefined;

        void searchPtvMusic(route.search, 60).then(results => {
            if (isMounted) {
                setSearchResults(results);
            }
        }).catch(error => {
            recordPtvEvent('api', 'music-search-failed', {
                error: getMusicErrorMessage(error),
                query: route.search
            });

            if (isMounted) {
                setSearchResults([]);
            }
        });

        return () => {
            isMounted = false;
        };
    }, [route.search, route.view]);

    useEffect(() => {
        let isMounted = true;

        if (route.view !== 'item' || !route.id) return undefined;

        void fetchPtvMusicItem(route.id)
            .then(item => {
                if (!isMounted) return;

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
                recordPtvEvent('route', 'music-item-route-load-failed', {
                    error: getMusicErrorMessage(error),
                    itemId: route.id,
                    route: `#/music/item/${route.id}`
                });
            });

        return () => {
            isMounted = false;
        };
    }, [route.id, route.view, runPlaybackAction]);

    useEffect(() => {
        let isMounted = true;

        if (route.view !== 'artist' || !route.id) {
            setArtistDetail(getInitialArtistDetail());
            return undefined;
        }

        setArtistDetail({
            ...getInitialArtistDetail(),
            isLoading: true
        });

        void fetchPtvMusicItem(route.id)
            .then(artist => Promise.all([
                fetchPtvMusicTracksByArtist(route.id, getPtvMusicTitle(artist), 80),
                fetchPtvMusicAlbumsByArtist(route.id, getPtvMusicTitle(artist), 36)
            ]).then(([topSongs, nextAlbums]) => ({
                albums: nextAlbums,
                artist,
                topSongs
            })))
            .then(detail => {
                if (isMounted) {
                    setArtistDetail({
                        ...detail,
                        error: '',
                        isLoading: false
                    });
                }
            })
            .catch(error => {
                if (isMounted) {
                    setArtistDetail({
                        ...getInitialArtistDetail(),
                        error: error instanceof Error ? error.message : 'Artist could not be loaded.',
                        isLoading: false
                    });
                }
            });

        return () => {
            isMounted = false;
        };
    }, [route.id, route.view]);

    useEffect(() => {
        let isMounted = true;

        if (route.view !== 'album' || !route.id) {
            setAlbumDetail(getInitialItemDetail());
            return undefined;
        }

        setAlbumDetail({
            ...getInitialItemDetail(),
            isLoading: true
        });

        void Promise.all([
            fetchPtvMusicItem(route.id),
            fetchPtvMusicAlbumTracks(route.id)
        ]).then(([item, tracks]) => {
            if (isMounted) {
                setAlbumDetail({
                    error: '',
                    isLoading: false,
                    item,
                    tracks
                });
            }
        }).catch(error => {
            if (isMounted) {
                setAlbumDetail({
                    ...getInitialItemDetail(),
                    error: error instanceof Error ? error.message : 'Album could not be loaded.',
                    isLoading: false
                });
            }
        });

        return () => {
            isMounted = false;
        };
    }, [route.id, route.view]);

    useEffect(() => {
        let isMounted = true;

        if (route.view !== 'playlist' || !route.id) {
            setPlaylistDetail(getInitialItemDetail());
            return undefined;
        }

        setPlaylistDetail({
            ...getInitialItemDetail(),
            isLoading: true
        });

        void Promise.all([
            fetchPtvMusicItem(route.id),
            fetchPtvMusicPlaylistTracks(route.id)
        ]).then(([item, tracks]) => {
            if (isMounted) {
                setPlaylistDetail({
                    error: '',
                    isLoading: false,
                    item,
                    tracks
                });
            }
        }).catch(error => {
            if (isMounted) {
                setPlaylistDetail({
                    ...getInitialItemDetail(),
                    error: error instanceof Error ? error.message : 'Playlist could not be loaded.',
                    isLoading: false
                });
            }
        });

        return () => {
            isMounted = false;
        };
    }, [route.id, route.view]);

    const refresh = () => {
        void loadMusicData(true);
    };

    const renderView = () => {
        if (isLoading && !homeData.sections.length) return <MusicLoading label='Loading Music' />;
        if (errorMessage && !homeData.sections.length) return <MusicError message={errorMessage} />;

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
                        likedSongs={likedSongs}
                        onGenerated={setGenerated}
                        playlists={playlists}
                    />
                );
            case 'liked':
                return <LikedSongsView likedSongs={likedSongs} />;
            case 'artist':
                return <ArtistView detail={artistDetail} homeData={homeData} onGenerated={setGenerated} />;
            case 'album':
                return <AlbumOrPlaylistView detail={albumDetail} kind='album' onGenerated={setGenerated} />;
            case 'playlist':
                return <AlbumOrPlaylistView detail={playlistDetail} kind='playlist' onGenerated={setGenerated} />;
            case 'item':
            case 'player':
                return <PlayerView homeData={homeData} musicVideos={musicVideos} />;
            case 'home':
            default:
                return <MusicHomeView generated={generated} homeData={homeData} onGenerated={setGenerated} />;
        }
    };

    return (
        <Page
            id='ptvMusicPage'
            title='Music'
            className='mainAnimatedPage type-interior ptv-music-page'
            isMenuButtonEnabled
        >
            <PTVShell className='ptv-music-shell' section='music' title='Music'>
                <main className={`ptv-music-app ptv-music-app-shell ptv-music-route-${route.view}`}>
                    <MusicPageBackdrop item={backdropItem} route={route.view} />
                    <div className='ptv-music-body'>
                        <MusicSidebar likedCount={likedSongs.length} playlists={playlists} route={route} />
                        <section className='ptv-music-main' aria-label='PiggieTV Music'>
                            <div className='ptv-music-main-scroll'>
                                <div className='ptv-music-main-toolbar'>
                                    <div>
                                        <p className='ptv-music-kicker'>PiggieTV</p>
                                        <h1>{getMusicRouteTitle(route)}</h1>
                                        {homeData.library?.name ? (
                                            <span className='ptv-music-toolbar-sync'>{homeData.library.name}</span>
                                        ) : null}
                                    </div>
                                    {isAdmin ? (
                                        <button type='button' onClick={refresh}>
                                            <PtvIcon name='refresh' />
                                            <span>Refresh</span>
                                        </button>
                                    ) : null}
                                </div>
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
