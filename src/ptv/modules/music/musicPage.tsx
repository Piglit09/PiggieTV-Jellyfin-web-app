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
import { PTV_ASSETS } from '../../core/config';
import { getPtvPerformanceProfile } from '../../core/clientProfile';
import { recordPtvEvent } from '../../core/observability';
import { scheduleRouteCheck } from '../../core/router';
import { resolvePtvStaticAssetUrl } from '../../core/urlOrigins';
import PTVShell, { type PtvShellNavLink } from '../../shell/PTVShell';
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
    subscribeToPtvMusicQueue,
    togglePtvMusicMute,
    togglePtvMusicPlayPause,
    togglePtvMusicShuffle
} from './musicQueue';
import {
    fetchPtvMusicAlbumTracks,
    fetchPtvMusicAlbumsByArtist,
    fetchPtvMusicItem,
    fetchPtvMusicLyrics,
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
import {
    getMusicHeroTrackCountLabel,
    type MusicLibraryIndexLoadState
} from './musicLoadState';
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

const PTV_MUSIC_LIBRARY_INDEX_LOAD_DELAY_MS = 5000;
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
    repeatMode: 'RepeatNone',
    runtimeTicks: 0,
    volumeLevel: 50
};

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

type MusicView =
    | 'album'
    | 'albums'
    | 'artist'
    | 'artists'
    | 'explore'
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
const artistDetailCache = new Map<string, ArtistDetailState>();

type ProgressiveArtistCallbacks = Readonly<{
    onAlbums: (items: PtvMusicItem[]) => void;
    onSummary: (item: PtvMusicItem) => void;
    onTracks: (items: PtvMusicItem[]) => void;
}>;

async function loadProgressiveArtistDetail(artistId: string, callbacks: ProgressiveArtistCallbacks) {
    const artist = await fetchPtvMusicItem(artistId);
    const artistName = getPtvMusicTitle(artist);

    callbacks.onSummary(artist);
    await Promise.allSettled([
        fetchPtvMusicAlbumsByArtist(artistId, artistName, ARTIST_ALBUM_INITIAL_LIMIT).then(callbacks.onAlbums),
        fetchPtvMusicTracksByArtist(artistId, artistName, ARTIST_TRACK_INITIAL_LIMIT).then(callbacks.onTracks)
    ]);
}

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
        { active: route.view === 'playlists', href: '#/music/playlists', icon: 'playlists', id: 'music-playlists', label: 'Playlists' }
    ];
}

function shouldShowMusicToolbarTitle(view: MusicView) {
    return !['albums', 'artists', 'library', 'playlists', 'songs'].includes(view);
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
    subtitle?: string;
    title?: string;
}>;

function QuickPicks({ items, subtitle = 'Library radio', title = 'Quick picks' }: QuickPicksProps) {
    const playbackActions = useMusicPlaybackActions();
    const tracks = uniquePtvMusicItems(items).slice(0, 12);

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
    libraryIndexLoadState: MusicLibraryIndexLoadState;
    onGenerated: (result: PtvMusicPlaylistResult) => void;
}>;

function MusicHomeHero({ homeData, items, libraryIndexLoadState, onGenerated }: MusicHomeHeroProps) {
    const playbackActions = useMusicPlaybackActions();
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
    limit?: number;
    title?: string;
}>;

function TrackTable({ items, limit = 12, title = 'Top songs' }: TrackTableProps) {
    const playbackActions = useMusicPlaybackActions();
    const tracks = uniquePtvMusicItems(items).slice(0, limit);
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
    libraryIndexLoadState: MusicLibraryIndexLoadState;
    onGenerated: (result: PtvMusicPlaylistResult) => void;
}>;

function MusicHomeView({ generated, homeData, libraryIndexLoadState, onGenerated }: MusicHomeViewProps) {
    const listenAgain = getListenAgainItems(homeData);
    const quickPicks = getQuickPicks(homeData);
    const continueListening = getSectionItems(homeData, 'continue-listening');
    const madeForYou = getSectionItems(homeData, 'recommended-for-you');
    const recommended = uniquePtvMusicItems([
        ...getSectionItems(homeData, 'high-quality'),
        ...homeData.sections
            .filter(section => section.id === 'similar-artists')
            .flatMap(section => section.items)
    ]);
    const recentlyPlayed = getSectionItems(homeData, 'recently-played');
    const genreSections = homeData.sections.filter(section => section.id.startsWith('genre-'));
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
            <MusicRow
                items={madeForYou.length ? madeForYou : quickPicks}
                onGenerated={onGenerated}
                subtitle='Personalized from your library'
                title='Made For You'
            />
            <MusicRow
                items={recommended.length ? recommended : quickPicks}
                onGenerated={onGenerated}
                subtitle='Smart picks'
                title='Recommended'
            />
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

type MusicCatalogViewProps = Readonly<{
    albums: PtvMusicItem[];
    artists: PtvMusicItem[];
    homeData: PtvMusicHomeData;
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
    const [visibleLimit, setVisibleLimit] = useState(48);
    const visibleItems = items.slice(0, visibleLimit);

    useEffect(() => {
        setVisibleLimit(48);
    }, [items, kind]);

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
                    <button type='button' onClick={() => setVisibleLimit(limit => limit + 48)}>
                        <PtvIcon name='more' />
                        <span>Show more</span>
                    </button>
                    <span>{visibleItems.length} of {items.length}</span>
                </div>
            ) : null}
        </section>
    );
}

function MusicCatalogView({
    albums,
    artists,
    homeData,
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
    const songItems = uniquePtvMusicItems([
        ...tracks,
        ...getAllHomeTracks(homeData),
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
            ...getSectionItems(homeData, 'top-artists')
        ]);
        const filteredItems = filterAndSortMusicCatalogItems(items, catalogSearch, catalogFilter, catalogSort);

        return (
            <div className='ptv-music-view ptv-music-catalog-view'>
                <MusicCatalogHeader
                    countLabel={`${filteredItems.length} of ${items.length} artists`}
                    filter={catalogFilter}
                    search={catalogSearch}
                    sort={catalogSort}
                    subtitle='Full artist library'
                    title='Artists'
                    onFilterChange={setCatalogFilter}
                    onSearchChange={setCatalogSearch}
                    onSortChange={setCatalogSort}
                />
                <MusicCatalogGrid
                    emptyLabel='artists'
                    items={filteredItems}
                    kind='artist'
                    onGenerated={onGenerated}
                    shape='artist'
                />
            </div>
        );
    }

    if (view === 'albums') {
        const items = uniquePtvMusicItems([
            ...albums,
            ...getSectionItems(homeData, 'top-albums')
        ]);
        const filteredItems = filterAndSortMusicCatalogItems(items, catalogSearch, catalogFilter, catalogSort);

        return (
            <div className='ptv-music-view ptv-music-catalog-view'>
                <MusicCatalogHeader
                    countLabel={`${filteredItems.length} of ${items.length} albums`}
                    filter={catalogFilter}
                    search={catalogSearch}
                    sort={catalogSort}
                    subtitle='Full album library'
                    title='Albums'
                    onFilterChange={setCatalogFilter}
                    onSearchChange={setCatalogSearch}
                    onSortChange={setCatalogSort}
                />
                <MusicCatalogGrid
                    emptyLabel='albums'
                    items={filteredItems}
                    kind='album'
                    onGenerated={onGenerated}
                />
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
                {!playlists.length ? (
                    <section className='ptv-music-empty-state'>
                        <PtvIcon name='playlists' />
                        <h2>No playlists yet</h2>
                        <p>Create a discovery mix or save a generated radio session to build your library.</p>
                    </section>
                ) : null}
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
                countLabel={`${filteredSongItems.length} of ${songItems.length} songs`}
                filter={catalogFilter}
                search={catalogSearch}
                sort={catalogSort}
                subtitle='Playable tracks from your music libraries'
                title='Songs'
                onFilterChange={setCatalogFilter}
                onSearchChange={setCatalogSearch}
                onSortChange={setCatalogSort}
            />
            <TrackTable items={filteredSongItems} limit={96} title='Songs' />
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

function hasMusicHomeFailedSections(homeData: PtvMusicHomeData) {
    return (homeData.sectionTimings || []).some(timing => timing.status === 'error');
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
    const musicDeferredTimersRef = useRef<number[]>([]);
    const musicLibraryIndexActiveRequestKeyRef = useRef('');
    const musicLibraryIndexRequestIdRef = useRef(0);
    const musicMountedRef = useRef(false);
    const musicRequestIdRef = useRef(0);
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

    useEffect(() => {
        routeViewRef.current = route.view;
    }, [route.view]);

    const clearDeferredMusicWork = useCallback((ownerRoute = 'music', recordRouteExit = true) => {
        musicDeferredTimersRef.current.forEach(timerId => {
            window.clearTimeout(timerId);
        });
        musicDeferredTimersRef.current = [];

        if (recordRouteExit) {
            musicDataCoordinator.cancelRouteWork(ownerRoute);
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

    const loadMusicLibraryIndex = useCallback((forceRefresh = false, ownerRequestId = musicRequestIdRef.current) => {
        const libraryRequestKey = `${ownerRequestId}:${forceRefresh ? 'refresh' : 'normal'}`;

        if (musicLibraryIndexActiveRequestKeyRef.current === libraryRequestKey) {
            recordPtvEvent('api', 'music-library-index-duplicate-suppressed', {
                forceRefresh,
                ownerRequestId
            });

            return Promise.resolve();
        }

        const libraryRequestId = ++musicLibraryIndexRequestIdRef.current;

        musicLibraryIndexActiveRequestKeyRef.current = libraryRequestKey;
        if (musicMountedRef.current && ownerRequestId === musicRequestIdRef.current) {
            setLibraryIndexLoadState('loading');
        }

        return musicDataCoordinator.loadLibraryIndex({ forceRefresh })
            .then(libraryIndex => {
                if (
                    !musicMountedRef.current
                    || ownerRequestId !== musicRequestIdRef.current
                    || libraryRequestId !== musicLibraryIndexRequestIdRef.current
                ) {
                    return;
                }

                setHomeData(previous => mergeMusicLibraryIndex(previous, libraryIndex));
                setLibraryIndexLoadState('ready');
                if (!libraryIndex.debug.failedSections.includes('playlists')) {
                    setPlaylists(libraryIndex.playlists.slice(0, PTV_MUSIC_LIBRARY_UI_RENDER_LIMIT));
                }

                if (!libraryIndex.debug.failedSections.includes('albums')) {
                    setAlbums(libraryIndex.albums.slice(0, PTV_MUSIC_LIBRARY_UI_RENDER_LIMIT));
                }

                if (!libraryIndex.debug.failedSections.includes('artists')) {
                    setArtists(libraryIndex.artists.slice(0, PTV_MUSIC_LIBRARY_UI_RENDER_LIMIT));
                }

                if (!libraryIndex.debug.failedSections.includes('tracks')) {
                    setTracks(libraryIndex.tracks.slice(0, PTV_MUSIC_LIBRARY_UI_RENDER_LIMIT));
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
                    tracksFetched: libraryIndex.tracks.length,
                    tracksRendered: Math.min(libraryIndex.tracks.length, PTV_MUSIC_LIBRARY_UI_RENDER_LIMIT)
                };

                recordPtvEvent('api', 'music-library-ui-counts-loaded', {
                    ...libraryUiDiagnostic,
                    debug: libraryIndex.debug
                });
                console.info('[PTV Music] music library UI counts', libraryUiDiagnostic);
            })
            .catch(error => {
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
    }, [musicDataCoordinator]);

    const loadMusicData = useCallback((forceRefresh = false) => {
        const routeEnteredAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
        const requestId = ++musicRequestIdRef.current;
        const isCurrentRequest = () => musicMountedRef.current && requestId === musicRequestIdRef.current;
        const activeRouteView = routeViewRef.current;
        const shouldLoadLibraryIndex = activeRouteView === 'library'
            || activeRouteView === 'artists'
            || activeRouteView === 'albums'
            || activeRouteView === 'songs'
            || activeRouteView === 'playlists';

        setLibraryIndexLoadState('scheduled');

        clearDeferredMusicWork(`music-${activeRouteView}-reload`, false);
        setLoading(true);
        setErrorMessage('');

        if (forceRefresh) {
            invalidatePtvMusicHomeCache();
        }

        const loadMusicVideos = () => {
            scheduleDeferredMusicWork(() => {
                if (!isCurrentRequest()) return;

                void recoverMusicPageItems('music-videos', fetchPtvMusicVideos(8))
                    .then(nextMusicVideos => {
                        if (isCurrentRequest()) {
                            setMusicVideos(nextMusicVideos);
                        }
                    });
            }, 3200);
        };
        const scheduleLibraryIndex = () => {
            scheduleDeferredMusicWork(() => {
                if (isCurrentRequest()) {
                    void loadMusicLibraryIndex(forceRefresh, requestId);
                }
            }, shouldLoadLibraryIndex ? 250 : PTV_MUSIC_LIBRARY_INDEX_LOAD_DELAY_MS);
        };
        const scheduleBackgroundHomeRefresh = (cachedHomeData: PtvMusicHomeData) => {
            const cacheAgeMs = Math.max(0, Date.now() - cachedHomeData.generatedAt);
            const completedDataAgeMs = cacheAgeMs;
            const completeness = cachedHomeData.completeness || (cachedHomeData.isPartial ? 'degraded' : 'complete');
            const hasFailedSections = hasMusicHomeFailedSections(cachedHomeData);
            const nextEligibleRefreshAt = cachedHomeData.nextEligibleRefreshAt || (cachedHomeData.generatedAt + PTV_MUSIC_STALE_HOME_REFRESH_AGE_MS);
            const isFreshEnough = cachedHomeData.generatedAt > 0 && Date.now() < nextEligibleRefreshAt;
            const isIntentionalInitialSnapshot = completeness === 'initial-usable' && !hasFailedSections;

            if (forceRefresh) {
                return;
            }

            if (isFreshEnough && (isIntentionalInitialSnapshot || completeness === 'complete')) {
                recordPtvEvent('render', 'music-background-refresh-suppressed', {
                    backgroundRefreshSuppressed: true,
                    backgroundRefreshSuppressionReason: isIntentionalInitialSnapshot ?
                        'initial-usable-fresh' :
                        'complete-fresh',
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

                void musicDataCoordinator.loadHomeSnapshot({ forceRefresh: true, initialOnly: true })
                    .then(refreshedHomeData => {
                        if (!isCurrentRequest()) return;

                        const nextAlbums = getSectionItems(refreshedHomeData, 'top-albums');
                        const nextArtists = getSectionItems(refreshedHomeData, 'top-artists');
                        const nextTracks = getSectionItems(refreshedHomeData, 'songs');

                        setHomeData(previous => mergeMusicHomeDataWithLibraryState(previous, refreshedHomeData));
                        if (nextAlbums.length) setAlbums(nextAlbums);
                        if (nextArtists.length) setArtists(nextArtists);
                        if (nextTracks.length) setTracks(nextTracks);
                        recordPtvEvent('render', 'music-background-refresh-completed', {
                            musicBackgroundRefreshCompleted: true,
                            musicBackgroundRefreshMs: Number(((typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()) - refreshStartedAt).toFixed(1)),
                            sectionCount: refreshedHomeData.sections.length
                        });
                    })
                    .catch(error => {
                        recordPtvEvent('render', 'music-background-refresh-failed', {
                            error: getMusicErrorMessage(error)
                        });
                    });
            }, 350);
        };

        return musicDataCoordinator.loadHomeSnapshot({ forceRefresh, initialOnly: true })
            .then(nextHomeData => {
                if (!isCurrentRequest()) return;

                const nextAlbums = getSectionItems(nextHomeData, 'top-albums');
                const nextArtists = getSectionItems(nextHomeData, 'top-artists');
                const nextTracks = getSectionItems(nextHomeData, 'songs');

                setHomeData(previous => mergeMusicHomeDataWithLibraryState(previous, nextHomeData));
                if (nextAlbums.length) setAlbums(nextAlbums);
                if (nextArtists.length) setArtists(nextArtists);
                if (nextTracks.length) setTracks(nextTracks);
                setLoading(false);
                recordPtvEvent('render', 'music-first-visible-content', {
                    cacheAgeMs: Math.max(0, Date.now() - nextHomeData.generatedAt),
                    musicCachedRenderMs: Number(((typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()) - routeEnteredAt).toFixed(1)),
                    musicFirstInteractiveMs: Number(((typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()) - routeEnteredAt).toFixed(1)),
                    musicFirstVisibleContentMs: Number(((typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()) - routeEnteredAt).toFixed(1)),
                    musicRouteEnteredAt: routeEnteredAt,
                    sectionCount: nextHomeData.sections.length
                });
                loadMusicVideos();
                scheduleBackgroundHomeRefresh(nextHomeData);
                if (shouldLoadLibraryIndex) scheduleLibraryIndex();
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
    }, [clearDeferredMusicWork, loadMusicLibraryIndex, musicDataCoordinator, scheduleDeferredMusicWork]);

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
            clearDeferredMusicWork(`music-${routeViewRef.current}-unmount`);
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
    }, [clearDeferredMusicWork, loadMusicData]);

    useEffect(() => subscribeToPtvLikedMusic(setLikedSongs), []);

    useEffect(() => {
        if (!musicMountedRef.current || route.view !== 'library' || !homeData.generatedAt) return;

        void loadMusicLibraryIndex(false, musicRequestIdRef.current);
    }, [homeData.generatedAt, loadMusicLibraryIndex, route.view]);

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
        const artistRouteEnteredAt = performance.now();

        if (route.view !== 'artist' || !route.id) {
            setArtistDetail(getInitialArtistDetail());
            return undefined;
        }

        const cachedDetail = artistDetailCache.get(route.id);

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
                if (!isMounted) return;

                const summaryDetail: ArtistDetailState = {
                    albums: cachedDetail?.albums || [],
                    artist,
                    error: '',
                    isLoading: false,
                    topSongs: cachedDetail?.topSongs || []
                };

                artistDetailCache.set(route.id, summaryDetail);
                setArtistDetail(summaryDetail);
                recordPtvEvent('render', 'music-artist-summary-visible', {
                    artistCacheHit: Boolean(cachedDetail),
                    artistId: route.id,
                    artistFirstInteractiveMs: Math.round((performance.now() - artistRouteEnteredAt) * 10) / 10,
                    artistSummaryVisibleMs: Math.round((performance.now() - artistRouteEnteredAt) * 10) / 10
                });
            },
            onAlbums: artistAlbums => {
                if (!isMounted) return;

                setArtistDetail(current => {
                    const next = { ...current, albums: artistAlbums };

                    artistDetailCache.set(route.id, next);
                    return next;
                });
                recordPtvEvent('render', 'music-artist-albums-visible', {
                    artistAlbumsVisibleMs: Math.round((performance.now() - artistRouteEnteredAt) * 10) / 10,
                    artistId: route.id,
                    artistQueryItemCount: artistAlbums.length
                });
            },
            onTracks: topSongs => {
                if (!isMounted) return;

                setArtistDetail(current => {
                    const next = { ...current, topSongs };

                    artistDetailCache.set(route.id, next);
                    return next;
                });
                recordPtvEvent('render', 'music-artist-tracks-visible', {
                    artistId: route.id,
                    artistQueryItemCount: topSongs.length,
                    artistTracksVisibleMs: Math.round((performance.now() - artistRouteEnteredAt) * 10) / 10
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
            if (isMounted) {
                recordPtvEvent('api', 'music-artist-request-cancelled', {
                    artistId: route.id,
                    artistRequestCancelled: true
                });
            }
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
        ]).then(([item, albumTracks]) => {
            if (isMounted) {
                setAlbumDetail({
                    error: '',
                    isLoading: false,
                    item,
                    tracks: albumTracks
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
        ]).then(([item, playlistTracks]) => {
            if (isMounted) {
                setPlaylistDetail({
                    error: '',
                    isLoading: false,
                    item,
                    tracks: playlistTracks
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
            case 'artists':
            case 'albums':
            case 'songs':
            case 'playlists':
                return (
                    <MusicCatalogView
                        albums={albums}
                        artists={artists}
                        homeData={homeData}
                        likedSongs={likedSongs}
                        onGenerated={setGenerated}
                        playlists={playlists}
                        tracks={tracks}
                        view={route.view}
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
                    <MusicPageBackdrop item={backdropItem} route={route.view} />
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
