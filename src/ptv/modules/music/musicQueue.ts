import {
    getPtvApiClient,
    getPtvCurrentUserId,
    getPtvServerId
} from '../../api';
import { recordPtvEvent } from '../../core/observability';

import { savePtvMusicPlaylist } from './musicPlaylists';
import { isPlayablePtvMusicTrack } from './musicPlaybackItem';
import type {
    PtvMusicItem,
    PtvMusicQueueItem,
    PtvMusicQueueSnapshot
} from './musicTypes';

type QueueListener = (snapshot: PtvMusicQueueSnapshot) => void;
type PlayOptions = {
    preserveVirtualQueue?: boolean;
    queueSourceLabel?: string;
    rejectOnPlaybackError?: boolean;
    startPositionTicks?: number;
};
type NativeMusicApiClient = NonNullable<ReturnType<typeof getPtvApiClient>> & {
    accessToken?: () => string | null;
    deviceId?: () => string;
    getItemDownloadUrl?: (itemId: string) => string;
    reportPlaybackProgress?: (options: Record<string, unknown>) => Promise<unknown>;
    reportPlaybackStart?: (options: Record<string, unknown>) => Promise<unknown>;
    reportPlaybackStopped?: (options: Record<string, unknown>) => Promise<unknown>;
};
type StreamMode = 'download' | 'universal';
type PlaybackReportContext = {
    item: PtvMusicItem;
    isMuted: boolean;
    isPaused: boolean;
    playSessionId: string;
    positionTicks: number;
    runtimeTicks: number;
    volumeLevel: number;
};
type PreloadedMusicTrack = {
    audio: HTMLAudioElement;
    format: string;
    itemKey: string;
    playSessionId: string;
};

const TICKS_PER_SECOND = 10000000;
const MUSIC_PLAYER_HASH = '#/music/player';
const MUSIC_QUEUE_ACTIVITY_EVENT = 'ptv:music-queue-activity';
const DEFAULT_PTV_MUSIC_VOLUME_LEVEL = 50;
const DEFAULT_PTV_MUSIC_VOLUME = DEFAULT_PTV_MUSIC_VOLUME_LEVEL / 100;
const MUSIC_QUEUE_PROGRESS_PUBLISH_INTERVAL_MS = 1000;
const MUSIC_NEXT_TRACK_PRELOAD_DELAY_MS = 180;
const DIRECT_AUDIO_CONTAINERS = [
    'mp3',
    'flac',
    'opus',
    'ogg',
    'oga',
    'webma',
    'webm',
    'm4a',
    'aac',
    'wav'
].join(',');

const listeners = new Set<QueueListener>();
const noisyQueueUpdateActions = new Set([
    'timeupdate'
]);
type QueueNextOutcome = 'repeat-one' | 'playlist-next' | 'virtual-next' | 'none';

let audioElement: HTMLAudioElement | null = null;
let cachedPlaylistSnapshot: ReadonlyArray<PtvMusicQueueItem> = [];
let cachedPlaylistSnapshotRevision = -1;
let autoQueueSeedItem: PtvMusicItem | null = null;
let autoQueueSeedRevision = 0;
let currentIndex = -1;
let currentItem: PtvMusicItem | null = null;
let currentPlayPromise: Promise<unknown> | null = null;
let currentPlaySessionId = '';
let currentStreamMode: StreamMode = 'universal';
let hasTriedDownloadFallback = false;
let isLoading = false;
let isShuffled = false;
let lastProgressReportAt = 0;
let lastQueueProgressPublishAt = 0;
let nativePlaySessionSeed = Date.now();
let playbackRunToken = 0;
let playlist: PtvMusicQueueItem[] = [];
let queueIdentityKey = '';
let queueSourceLabel = 'Active session';
let repeatMode = 'RepeatNone';
let sourcePlaylist: PtvMusicQueueItem[] = [];
let virtualQueue: PtvMusicItem[] = [];
let virtualQueueCursor = 0;
let virtualQueueSeedId = '';
let lastEndedAt = 0;
let lastEndedNavigationToken = 0;
let continuityModulePromise: Promise<typeof import('./musicContinuity')> | null = null;
let continuityWriteTimerId = 0;
let continuityRetirementGeneration = 0;
let continuityWriteGeneration = 0;
let lastContinuityRestoreIdentityKey = '';
let lastPlaybackError: string | null = null;
let pendingContinuityIdentityKey = '';
let pendingContinuitySnapshot: PtvMusicQueueSnapshot | null = null;
let playlistRevision = 0;
let preloadedMusicTrack: PreloadedMusicTrack | null = null;
let preloadTimerId = 0;

type MusicPlaybackNavigationContext = {
    index: number;
    itemId: string;
    playlistItemId: string;
    runToken: number;
    sourceSessionId: string;
};
let activePlaybackContext: MusicPlaybackNavigationContext | null = null;

function getMusicItemKey(item: PtvMusicItem) {
    return item.Id
        || item.ProviderIds?.MusicBrainzTrack
        || item.ProviderIds?.MusicBrainzRecording
        || `${item.Name || ''}-${item.Album || ''}-${item.IndexNumber || ''}`;
}

function getExistingPlaylistItemId(item: PtvMusicItem) {
    const playlistItemId = item.PlaylistItemId;

    return typeof playlistItemId === 'string' ? playlistItemId : '';
}

function normalizeQueueItem(item: PtvMusicItem, index = 0): PtvMusicQueueItem {
    return {
        ...item,
        PlaylistItemId: getExistingPlaylistItemId(item) || `${getMusicItemKey(item)}-${Date.now()}-${index}`
    };
}

function uniqueVirtualItems(items: PtvMusicItem[], seedId = '') {
    const seen = new Set<string>();
    const nextItems: PtvMusicItem[] = [];

    items.forEach(item => {
        if (!isPlayablePtvMusicTrack(item)) return;

        const key = getMusicItemKey(item);

        if (!key || key === seedId || seen.has(key)) return;

        seen.add(key);
        nextItems.push(item);
    });

    return nextItems;
}

function isSameMusicItem(left: PtvMusicItem | null | undefined, right: PtvMusicItem | null | undefined) {
    if (!left || !right) return false;

    return getMusicItemKey(left) === getMusicItemKey(right);
}

function cloneQueueSnapshotItem<T extends PtvMusicItem | PtvMusicQueueItem>(item: T): T {
    const mediaSources = item.MediaSources?.map(mediaSource => Object.freeze({ ...mediaSource }));
    const userData = item.UserData ? Object.freeze({ ...item.UserData }) : item.UserData;

    return Object.freeze({
        ...item,
        MediaSources: mediaSources,
        UserData: userData
    }) as T;
}

function invalidatePlaylistSnapshot() {
    playlistRevision += 1;
}

function getPlaylistSnapshot() {
    if (cachedPlaylistSnapshotRevision !== playlistRevision) {
        cachedPlaylistSnapshot = playlist.map(cloneQueueSnapshotItem);
        cachedPlaylistSnapshotRevision = playlistRevision;
    }

    return cachedPlaylistSnapshot.slice() as PtvMusicQueueItem[];
}

function getMusicPlaybackFormat(item: PtvMusicItem | null | undefined) {
    const audioStream = item?.MediaSources
        ?.flatMap(source => source.MediaStreams || [])
        .find(stream => String(stream.Type || '').toLowerCase() === 'audio');

    return String(
        audioStream?.Codec
        || item?.Container
        || item?.MediaSources?.[0]?.Container
        || ''
    ).split(',')[0].trim().toLowerCase();
}

function areGaplessMusicTracksCompatible(left: PtvMusicItem | null, right: PtvMusicItem) {
    const leftFormat = getMusicPlaybackFormat(left);
    const rightFormat = getMusicPlaybackFormat(right);

    return leftFormat === rightFormat;
}

function clearPreloadedMusicTrack() {
    if (preloadTimerId) {
        window.clearTimeout(preloadTimerId);
        preloadTimerId = 0;
    }

    const preload = preloadedMusicTrack;

    preloadedMusicTrack = null;
    if (!preload) return;

    try {
        preload.audio.pause();
        preload.audio.removeAttribute('src');
        preload.audio.remove();
    } catch {
        // Preloading is opportunistic and must never interrupt playback.
    }
}

function setPlaybackLoading(nextLoading: boolean) {
    if (isLoading === nextLoading) return false;

    isLoading = nextLoading;

    return true;
}

function publishPlaybackLoading(nextLoading: boolean, action: string) {
    if (nextLoading && (!currentItem || !audioElement?.getAttribute('src'))) return;

    if (setPlaybackLoading(nextLoading)) {
        emitQueueUpdated(action);
    }
}

function isActiveAudioEvent(event: Event) {
    return event.currentTarget === audioElement;
}

function onActiveAudioDurationChange(event: Event) {
    if (isActiveAudioEvent(event)) emitQueueUpdated('duration');
}

function onActiveAudioCanPlay(event: Event) {
    if (isActiveAudioEvent(event)) publishPlaybackLoading(false, 'canplay');
}

function onActiveAudioLoadStart(event: Event) {
    if (isActiveAudioEvent(event)) publishPlaybackLoading(true, 'loadstart');
}

function onActiveAudioPause(event: Event) {
    if (!isActiveAudioEvent(event)) return;

    setPlaybackLoading(false);
    emitQueueUpdated('pause');
}

function onActiveAudioPlay(event: Event) {
    if (isActiveAudioEvent(event)) emitQueueUpdated('play');
}

function onActiveAudioPlaying(event: Event) {
    if (!isActiveAudioEvent(event)) return;

    setPlaybackLoading(false);
    emitQueueUpdated('playing');
}

function onActiveAudioStalled(event: Event) {
    if (isActiveAudioEvent(event)) publishPlaybackLoading(true, 'stalled');
}

function onActiveAudioTimeUpdate(event: Event) {
    if (!isActiveAudioEvent(event)) return;

    reportPlaybackProgressThrottled();
    const now = Date.now();

    if (now - lastQueueProgressPublishAt >= MUSIC_QUEUE_PROGRESS_PUBLISH_INTERVAL_MS) {
        lastQueueProgressPublishAt = now;
        emitQueueUpdated('timeupdate');
    }
}

function onActiveAudioVolumeChange(event: Event) {
    if (isActiveAudioEvent(event)) emitQueueUpdated('volume');
}

function onActiveAudioWaiting(event: Event) {
    if (isActiveAudioEvent(event)) publishPlaybackLoading(true, 'waiting');
}

function bindActiveAudioEvents(audio: HTMLAudioElement) {
    audio.addEventListener('durationchange', onActiveAudioDurationChange);
    audio.addEventListener('canplay', onActiveAudioCanPlay);
    audio.addEventListener('ended', onNativeEnded);
    audio.addEventListener('error', onNativeError);
    audio.addEventListener('loadstart', onActiveAudioLoadStart);
    audio.addEventListener('pause', onActiveAudioPause);
    audio.addEventListener('play', onActiveAudioPlay);
    audio.addEventListener('playing', onActiveAudioPlaying);
    audio.addEventListener('stalled', onActiveAudioStalled);
    audio.addEventListener('timeupdate', onActiveAudioTimeUpdate);
    audio.addEventListener('volumechange', onActiveAudioVolumeChange);
    audio.addEventListener('waiting', onActiveAudioWaiting);
}

function unbindActiveAudioEvents(audio: HTMLAudioElement) {
    audio.removeEventListener('durationchange', onActiveAudioDurationChange);
    audio.removeEventListener('canplay', onActiveAudioCanPlay);
    audio.removeEventListener('ended', onNativeEnded);
    audio.removeEventListener('error', onNativeError);
    audio.removeEventListener('loadstart', onActiveAudioLoadStart);
    audio.removeEventListener('pause', onActiveAudioPause);
    audio.removeEventListener('play', onActiveAudioPlay);
    audio.removeEventListener('playing', onActiveAudioPlaying);
    audio.removeEventListener('stalled', onActiveAudioStalled);
    audio.removeEventListener('timeupdate', onActiveAudioTimeUpdate);
    audio.removeEventListener('volumechange', onActiveAudioVolumeChange);
    audio.removeEventListener('waiting', onActiveAudioWaiting);
}

function createHiddenMusicAudioElement() {
    const audio = document.createElement('audio');

    audio.preload = 'auto';
    audio.volume = DEFAULT_PTV_MUSIC_VOLUME;
    audio.style.display = 'none';
    document.body.append(audio);

    return audio;
}

function getAudioElement() {
    if (audioElement) return audioElement;

    audioElement = createHiddenMusicAudioElement();
    audioElement.dataset.ptvMusicNativePlayer = 'true';
    bindActiveAudioEvents(audioElement);

    recordPtvEvent('render', 'music-native-player-created', {
        engine: 'html-audio'
    });

    return audioElement;
}

function getPlaybackItemToken(item: PtvMusicQueueItem, index: number, runToken: number) {
    return {
        index,
        itemId: item.Id || item.PlaylistItemId || '',
        playlistItemId: item.PlaylistItemId || item.Id || '',
        runToken,
        sourceSessionId: currentPlaySessionId
    };
}

function capturePlaybackContext(item: PtvMusicQueueItem | null | undefined, index: number, runToken: number) {
    if (!item) {
        activePlaybackContext = null;
        return;
    }

    activePlaybackContext = getPlaybackItemToken(item, index, runToken);
}

function isActivePlaybackContext(context: MusicPlaybackNavigationContext | null) {
    return Boolean(
        context
        && activePlaybackContext
        && context.runToken === activePlaybackContext.runToken
        && context.itemId === activePlaybackContext.itemId
        && context.playlistItemId === activePlaybackContext.playlistItemId
        && context.index === activePlaybackContext.index
    );
}

function getCurrentQueueIdentityKey() {
    const serverId = getPtvServerId();
    const userId = serverId ? getPtvCurrentUserId(serverId) : '';

    return serverId && userId ? `${serverId}:${userId}` : '';
}

function resetQueueState() {
    clearPreloadedMusicTrack();
    autoQueueSeedItem = null;
    autoQueueSeedRevision += 1;
    currentIndex = -1;
    currentItem = null;
    currentPlayPromise = null;
    currentPlaySessionId = '';
    currentStreamMode = 'universal';
    hasTriedDownloadFallback = false;
    isLoading = false;
    isShuffled = false;
    lastEndedAt = 0;
    lastEndedNavigationToken = 0;
    lastProgressReportAt = 0;
    lastPlaybackError = null;
    playlist = [];
    queueIdentityKey = '';
    queueSourceLabel = 'Active session';
    repeatMode = 'RepeatNone';
    sourcePlaylist = [];
    virtualQueue = [];
    virtualQueueCursor = 0;
    virtualQueueSeedId = '';
    activePlaybackContext = null;
    invalidatePlaylistSnapshot();
}

function retireQueueForIdentityChange(reason: string) {
    const hadQueue = Boolean(currentItem || playlist.length);

    playbackRunToken += 1;
    continuityRetirementGeneration += 1;
    continuityWriteGeneration += 1;
    lastContinuityRestoreIdentityKey = '';
    pendingContinuitySnapshot = null;
    pendingContinuityIdentityKey = '';
    if (continuityWriteTimerId) {
        window.clearTimeout(continuityWriteTimerId);
        continuityWriteTimerId = 0;
    }

    if (audioElement) {
        try {
            audioElement.pause();
            audioElement.removeAttribute('src');
            audioElement.load();
        } catch {
            // Identity retirement must finish even when a platform media
            // element is already being torn down.
        }
    }

    resetQueueState();

    if (hadQueue) {
        recordPtvEvent('playback', 'music-queue-identity-retired', {
            reason
        });
    }

    return hadQueue;
}

function validateQueueIdentity() {
    if (!queueIdentityKey) return false;

    const currentIdentityKey = getCurrentQueueIdentityKey();

    if (currentIdentityKey === queueIdentityKey) return false;

    return retireQueueForIdentityChange('identity-changed');
}

function bindQueueIdentity() {
    const currentIdentityKey = getCurrentQueueIdentityKey();

    if (currentIdentityKey) {
        queueIdentityKey = currentIdentityKey;
    }
}

function getMusicContinuityModule() {
    continuityModulePromise ||= import('./musicContinuity');

    return continuityModulePromise;
}

function getMusicContinuityScope() {
    const serverId = getPtvServerId();
    const userId = serverId ? getPtvCurrentUserId(serverId) : '';

    return {
        serverId,
        userId
    };
}

function scheduleQueueContinuityWrite(action: string, snapshot: PtvMusicQueueSnapshot) {
    if ([
        'duration',
        'pause',
        'play',
        'playing',
        'timeupdate',
        'volume'
    ].includes(action)) {
        return;
    }

    pendingContinuitySnapshot = snapshot;
    pendingContinuityIdentityKey = getCurrentQueueIdentityKey();
    const writeGeneration = ++continuityWriteGeneration;

    if (continuityWriteTimerId) {
        window.clearTimeout(continuityWriteTimerId);
    }

    continuityWriteTimerId = window.setTimeout(() => {
        continuityWriteTimerId = 0;
        const nextSnapshot = pendingContinuitySnapshot;
        const scheduledIdentityKey = pendingContinuityIdentityKey;

        pendingContinuitySnapshot = null;
        pendingContinuityIdentityKey = '';
        if (
            !nextSnapshot
            || !scheduledIdentityKey
            || writeGeneration !== continuityWriteGeneration
            || getCurrentQueueIdentityKey() !== scheduledIdentityKey
        ) {
            return;
        }

        const scope = getMusicContinuityScope();

        if (!scope.serverId || !scope.userId) return;

        void getMusicContinuityModule().then(module => {
            if (
                writeGeneration !== continuityWriteGeneration
                || getCurrentQueueIdentityKey() !== scheduledIdentityKey
            ) {
                recordPtvEvent('playback', 'music-continuity-stale-write-suppressed', {
                    action
                });
                return;
            }

            if (nextSnapshot.playlist.length) {
                module.savePtvMusicQueueContinuity(scope, nextSnapshot);
            } else {
                module.clearPtvMusicQueueContinuity(scope);
            }
        }).catch(error => {
            recordPtvEvent('playback', 'music-continuity-write-failed', {
                action,
                errorName: error instanceof Error ? error.name : typeof error
            });
        });
    }, 120);
}

function recordMeaningfulPlaybackHistory(context: PlaybackReportContext | null, completed = false) {
    if (!context?.item.Id) return;

    const scope = getMusicContinuityScope();
    const identityKey = getCurrentQueueIdentityKey();
    const retirementGeneration = continuityRetirementGeneration;

    if (!scope.serverId || !scope.userId || !identityKey) return;

    void getMusicContinuityModule().then(module => {
        if (
            retirementGeneration !== continuityRetirementGeneration
            || getCurrentQueueIdentityKey() !== identityKey
        ) {
            recordPtvEvent('playback', 'music-history-stale-write-suppressed', {});
            return;
        }

        module.recordPtvMusicRecentTrack(scope, context.item, {
            completed,
            positionTicks: context.positionTicks,
            runtimeTicks: context.runtimeTicks
        });
    }).catch(error => {
        recordPtvEvent('playback', 'music-history-write-failed', {
            errorName: error instanceof Error ? error.name : typeof error
        });
    });
}

async function restorePtvMusicQueueContinuity() {
    const identityKey = getCurrentQueueIdentityKey();

    if (!identityKey || identityKey === lastContinuityRestoreIdentityKey || currentItem || playlist.length) return false;

    lastContinuityRestoreIdentityKey = identityKey;
    const retirementGeneration = continuityRetirementGeneration;

    try {
        const scope = getMusicContinuityScope();
        const module = await getMusicContinuityModule();
        const document = module.loadPtvMusicContinuity(scope);
        const restoredQueue = document?.queue;

        if (
            !restoredQueue?.items.length
            || retirementGeneration !== continuityRetirementGeneration
            || getCurrentQueueIdentityKey() !== identityKey
            || currentItem
            || playlist.length
        ) {
            return false;
        }

        const restoredItems = restoredQueue.items.filter(isPlayablePtvMusicTrack);

        if (!restoredItems.length) {
            module.clearPtvMusicQueueContinuity(scope);
            return false;
        }

        playlist = restoredItems.map((item, index) => normalizeQueueItem(item, index));
        sourcePlaylist = playlist.slice();
        invalidatePlaylistSnapshot();
        const restoredCurrentIndex = playlist.findIndex(item => item.Id === restoredQueue.currentItemId);

        currentIndex = restoredCurrentIndex >= 0 ?
            restoredCurrentIndex :
            Math.max(0, Math.min(restoredQueue.currentIndex, playlist.length - 1));
        repeatMode = restoredQueue.repeatMode;
        isShuffled = restoredQueue.shuffled;
        queueSourceLabel = restoredQueue.context.source || 'Restored session';
        autoQueueSeedItem = playlist[currentIndex] || null;
        autoQueueSeedRevision += 1;
        bindQueueIdentity();

        await loadCurrentItem(false, restoredQueue.positionTicks);
        if (
            retirementGeneration !== continuityRetirementGeneration
            || getCurrentQueueIdentityKey() !== identityKey
        ) {
            retireQueueForIdentityChange('identity-changed-during-restore');
            return false;
        }

        recordPtvEvent('playback', 'music-queue-continuity-restored', {
            queueCount: playlist.length
        });

        return true;
    } catch (error) {
        if (getCurrentQueueIdentityKey() === identityKey) {
            lastContinuityRestoreIdentityKey = '';
        }
        recordPtvEvent('playback', 'music-queue-continuity-restore-failed', {
            errorName: error instanceof Error ? error.name : typeof error
        });
        return false;
    }
}

function setMusicStartupVolume() {
    const audio = getAudioElement();

    audio.volume = DEFAULT_PTV_MUSIC_VOLUME;
}

function getCurrentApiClient(item = currentItem): NativeMusicApiClient | null {
    return getPtvApiClient(item?.ServerId || null) as NativeMusicApiClient | null;
}

function getCurrentPositionTicks() {
    const audio = getAudioElement();

    return Math.max(0, Math.round((audio.currentTime || 0) * TICKS_PER_SECOND));
}

function getCurrentRuntimeTicks() {
    const audio = getAudioElement();

    if (Number.isFinite(audio.duration) && audio.duration > 0) {
        return Math.round(audio.duration * TICKS_PER_SECOND);
    }

    return Number(currentItem?.RunTimeTicks || 0);
}

function createNativePlaySessionId() {
    return String(++nativePlaySessionSeed);
}

function getAudioStreamUrl(
    item: PtvMusicItem,
    startTicks = 0,
    mode: StreamMode = 'universal',
    playSessionId = currentPlaySessionId || createNativePlaySessionId()
) {
    if (!item.Id) {
        throw new Error('Cannot play a Jellyfin music item without an Id.');
    }

    const apiClient = getCurrentApiClient(item);

    if (!apiClient?.getUrl) {
        throw new Error('Jellyfin API client cannot build music stream URLs.');
    }

    if (mode === 'download' && apiClient.getItemDownloadUrl) {
        return apiClient.getItemDownloadUrl(item.Id);
    }

    return apiClient.getUrl(`Audio/${item.Id}/universal`, {
        ApiKey: apiClient.accessToken?.() || '',
        AudioCodec: 'mp3,aac,opus,flac',
        Container: DIRECT_AUDIO_CONTAINERS,
        DeviceId: apiClient.deviceId?.() || 'ptv-music-native',
        EnableAudioVbrEncoding: true,
        EnableRedirection: true,
        EnableRemoteMedia: true,
        MaxStreamingBitrate: 140000000,
        PlaySessionId: playSessionId,
        StartTimeTicks: Math.max(0, Math.round(startTicks)),
        TranscodingContainer: 'mp3',
        TranscodingProtocol: 'http',
        UserId: apiClient.getCurrentUserId?.() || getPtvCurrentUserId(item.ServerId)
    });
}

function getNextMusicPreloadItem() {
    if (repeatMode === 'RepeatOne') return null;

    const nextIndex = getNextPlaylistIndex();

    if (nextIndex >= 0) return playlist[nextIndex] || null;

    return virtualQueue[virtualQueueCursor] || null;
}

function prepareNextMusicTrack() {
    preloadTimerId = 0;
    const nextItem = getNextMusicPreloadItem();

    if (!currentItem || !nextItem?.Id || currentStreamMode !== 'universal') {
        clearPreloadedMusicTrack();
        return;
    }

    const itemKey = getMusicItemKey(nextItem);

    if (preloadedMusicTrack?.itemKey === itemKey) return;

    clearPreloadedMusicTrack();
    const preloadAudio = createHiddenMusicAudioElement();
    const playSessionId = createNativePlaySessionId();

    preloadAudio.dataset.ptvMusicNativePreload = 'true';
    preloadAudio.muted = true;

    try {
        preloadAudio.src = getAudioStreamUrl(nextItem, 0, 'universal', playSessionId);
        preloadedMusicTrack = {
            audio: preloadAudio,
            format: getMusicPlaybackFormat(nextItem),
            itemKey,
            playSessionId
        };
        preloadAudio.load();
        recordPtvEvent('playback', 'music-next-track-preload-started', {
            format: preloadedMusicTrack.format || null,
            surface: 'music-native-player'
        });
    } catch (error) {
        preloadAudio.remove();
        preloadedMusicTrack = null;
        recordPtvEvent('playback', 'music-next-track-preload-failed', {
            reason: error instanceof Error ? error.name : 'unknown-error',
            surface: 'music-native-player'
        });
    }
}

function scheduleNextMusicTrackPreload() {
    if (preloadTimerId) window.clearTimeout(preloadTimerId);

    preloadTimerId = window.setTimeout(prepareNextMusicTrack, MUSIC_NEXT_TRACK_PRELOAD_DELAY_MS);
}

function takePreloadedMusicTrack(item: PtvMusicItem, outgoingItem: PtvMusicItem | null) {
    const preload = preloadedMusicTrack;

    if (!preload || preload.itemKey !== getMusicItemKey(item)) return null;
    if (
        preload.audio.error
        || preload.audio.readyState < 2
        || !areGaplessMusicTracksCompatible(outgoingItem, item)
    ) {
        clearPreloadedMusicTrack();
        return null;
    }

    preloadedMusicTrack = null;
    const previousAudio = audioElement;
    const previousVolume = previousAudio?.volume ?? DEFAULT_PTV_MUSIC_VOLUME;
    const previousMuted = previousAudio?.muted ?? false;

    if (previousAudio && previousAudio !== preload.audio) {
        unbindActiveAudioEvents(previousAudio);
        try {
            previousAudio.pause();
            previousAudio.removeAttribute('src');
            previousAudio.remove();
        } catch {
            // The prepared element remains usable if the old element is already gone.
        }
    }

    audioElement = preload.audio;
    delete audioElement.dataset.ptvMusicNativePreload;
    audioElement.dataset.ptvMusicNativePlayer = 'true';
    audioElement.muted = previousMuted;
    audioElement.volume = previousVolume;
    bindActiveAudioEvents(audioElement);
    currentPlaySessionId = preload.playSessionId;
    recordPtvEvent('playback', 'music-next-track-preload-promoted', {
        format: preload.format || null,
        surface: 'music-native-player'
    });

    return audioElement;
}

function emitQueueUpdated(action: string) {
    const snapshot = getPtvMusicQueueSnapshot();

    if (!noisyQueueUpdateActions.has(action)) {
        recordPtvEvent('render', 'music-queue-updated', {
            action,
            currentItemId: snapshot.currentItem?.Id || null,
            engine: 'native-audio',
            queueCount: snapshot.playlist.length
        });

        if (snapshot.currentItem) {
            window.dispatchEvent(new CustomEvent(MUSIC_QUEUE_ACTIVITY_EVENT, {
                detail: {
                    action,
                    itemId: snapshot.currentItem.Id || null
                }
            }));
        }
    }

    listeners.forEach(listener => {
        listener(snapshot);
    });
    scheduleQueueContinuityWrite(action, snapshot);

    return snapshot;
}

function capturePlaybackReportContext(item = currentItem): PlaybackReportContext | null {
    if (!item?.Id) return null;

    const audio = getAudioElement();

    return {
        item,
        isMuted: audio.muted,
        isPaused: audio.paused,
        playSessionId: currentPlaySessionId,
        positionTicks: getCurrentPositionTicks(),
        runtimeTicks: getCurrentRuntimeTicks(),
        volumeLevel: Math.round(audio.volume * 100)
    };
}

function reportPlayback(
    method: 'reportPlaybackProgress' | 'reportPlaybackStart' | 'reportPlaybackStopped',
    item = currentItem,
    capturedContext: PlaybackReportContext | null = null
) {
    const context = capturedContext || capturePlaybackReportContext(item);

    if (!context?.item.Id) return;
    if (method === 'reportPlaybackStopped') {
        recordMeaningfulPlaybackHistory(context, getAudioElement().ended);
    }

    const apiClient = getCurrentApiClient(context.item);
    const report = apiClient?.[method];

    if (typeof report !== 'function') return;

    void report.call(apiClient, {
        AudioStreamIndex: 0,
        CanSeek: true,
        IsMuted: context.isMuted,
        IsPaused: context.isPaused,
        ItemId: context.item.Id,
        MediaSourceId: context.item.MediaSources?.[0]?.Id || context.item.Id,
        PlayMethod: 'DirectStream',
        PlaySessionId: context.playSessionId,
        PositionTicks: context.positionTicks,
        VolumeLevel: context.volumeLevel
    }).catch(error => {
        recordPtvEvent('render', 'music-native-report-failed', {
            error: error instanceof Error ? error.message : String(error),
            itemId: context.item.Id,
            method
        });
    });
}

function reportPlaybackProgressThrottled() {
    const now = Date.now();

    if (now - lastProgressReportAt < 10000) return;

    lastProgressReportAt = now;
    reportPlayback('reportPlaybackProgress');
}

function getNextPlaylistIndex() {
    if (!playlist.length) return -1;
    if (currentIndex + 1 < playlist.length) return currentIndex + 1;
    if (repeatMode === 'RepeatAll') return 0;

    return -1;
}

function getPreviousPlaylistIndex() {
    if (!playlist.length) return -1;
    if (currentIndex > 0) return currentIndex - 1;
    if (repeatMode === 'RepeatAll') return playlist.length - 1;

    return -1;
}

function getVirtualQueueRemaining() {
    return virtualQueue.slice(virtualQueueCursor);
}

function takeNextVirtualQueueItem(reason: string) {
    const currentItemId = currentItem?.Id || '';

    while (virtualQueueCursor < virtualQueue.length) {
        const item = virtualQueue[virtualQueueCursor];

        virtualQueueCursor += 1;

        if (item?.Id && item.Id !== currentItemId) {
            recordPtvEvent('render', 'music-virtual-queue-next', {
                itemId: item.Id,
                reason,
                remaining: Math.max(0, virtualQueue.length - virtualQueueCursor),
                seedId: virtualQueueSeedId || null
            });

            return item;
        }
    }

    return null;
}

function appendVirtualQueueToPlaylist(item: PtvMusicItem) {
    const nextItems = [
        item,
        ...getVirtualQueueRemaining()
    ].map(normalizeQueueItem);
    virtualQueueCursor = virtualQueue.length;

    playlist = [
        ...playlist.slice(0, Math.max(currentIndex + 1, 0)),
        ...nextItems
    ];
    sourcePlaylist = playlist.slice();
    currentIndex = Math.max(0, currentIndex + 1);
    invalidatePlaylistSnapshot();
}

function promoteVirtualQueueToAutoplay(seedItem: PtvMusicItem | null, source: string) {
    if (source !== 'player-related' || !isSameMusicItem(seedItem, currentItem)) return false;
    if (currentIndex >= 0 && currentIndex + 1 < playlist.length) return false;

    const currentQueueItem = playlist[currentIndex] || (currentItem ? normalizeQueueItem(currentItem) : null);

    if (!currentQueueItem) return false;

    playlist = [
        currentQueueItem,
        ...virtualQueue.map(normalizeQueueItem)
    ];
    sourcePlaylist = playlist.slice();
    currentIndex = 0;
    queueSourceLabel = 'Related autoplay';
    virtualQueueCursor = virtualQueue.length;
    invalidatePlaylistSnapshot();

    recordPtvEvent('render', 'music-related-autoplay-queue-set', {
        count: Math.max(0, playlist.length - 1),
        currentItemId: currentItem?.Id || null,
        seedId: virtualQueueSeedId || null
    });
    emitQueueUpdated('related-autoplay');

    return true;
}

function loadCurrentItem(autoplay = true, startTicks = 0, mode: StreamMode = 'universal', options: PlayOptions = {}): Promise<unknown> {
    const item = playlist[currentIndex];
    let audio = getAudioElement();
    const playToken = ++playbackRunToken;
    const playbackRequestedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ?
        performance.now() :
        Date.now();
    let usedPreloadedTrack = false;
    const outgoingItem = currentItem;
    const outgoingContext = currentItem && item && !isSameMusicItem(currentItem, item) ?
        capturePlaybackReportContext(currentItem) :
        null;

    if (!item) {
        clearPreloadedMusicTrack();
        currentItem = null;
        lastPlaybackError = null;
        setPlaybackLoading(false);
        audio.pause();
        audio.removeAttribute('src');
        audio.load();

        return Promise.resolve(emitQueueUpdated('empty'));
    }

    if (outgoingContext) {
        reportPlayback('reportPlaybackStopped', outgoingContext.item, outgoingContext);
    }

    currentItem = item;
    lastPlaybackError = null;
    currentStreamMode = mode;
    hasTriedDownloadFallback = mode === 'download';
    lastProgressReportAt = 0;

    try {
        const preparedAudio = startTicks === 0 && mode === 'universal' ?
            takePreloadedMusicTrack(item, outgoingItem) :
            null;

        if (preparedAudio) {
            audio = preparedAudio;
            usedPreloadedTrack = true;
            setPlaybackLoading(false);
        } else {
            clearPreloadedMusicTrack();
            currentPlaySessionId = createNativePlaySessionId();
            audio.pause();
            audio.src = getAudioStreamUrl(item, startTicks, mode, currentPlaySessionId);
            setPlaybackLoading(true);
            audio.load();
        }
    } catch (error) {
        return handleNativePlaybackError(error, 'load', options, playToken, item, autoplay);
    }

    capturePlaybackContext(item, currentIndex, playToken);
    emitQueueUpdated('load');

    if (!autoplay) {
        return Promise.resolve(emitQueueUpdated('loaded-paused'));
    }

    const playPromise: Promise<unknown> = audio.play()
        .then(() => {
            if (playToken !== playbackRunToken || currentItem?.Id !== item.Id) {
                return emitQueueUpdated('play-start-ignored');
            }

            setPlaybackLoading(false);
            reportPlayback('reportPlaybackStart', item);
            recordPtvEvent('render', 'music-player-started', {
                codec: String(item.Container || ''),
                engine: 'native-audio',
                itemId: item.Id || null,
                queueCount: playlist.length
            });
            const playbackStartedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ?
                performance.now() :
                Date.now();

            recordPtvEvent('playback', 'music-premium-playback-started', {
                fallbackReason: mode === 'download' ? 'download-fallback' : 'none',
                itemCount: playlist.length,
                latencyMs: Number((playbackStartedAt - playbackRequestedAt).toFixed(1)),
                playbackPolicyId: 'ptv-music-preload-v1',
                preloadPromoted: usedPreloadedTrack,
                surface: 'music-native-player'
            });
            scheduleNextMusicTrackPreload();
            return emitQueueUpdated('play-started');
        })
        .catch(error => handleNativePlaybackError(error, 'play', options, playToken, item))
        .finally(() => {
            if (currentPlayPromise === playPromise) {
                currentPlayPromise = null;
            }
        });
    currentPlayPromise = playPromise;

    return currentPlayPromise;
}

function handleNativePlaybackError(
    error: unknown,
    stage: string,
    options: PlayOptions = {},
    expectedRunToken = playbackRunToken,
    expectedItem = currentItem,
    expectedAutoplay = true
): Promise<unknown> {
    if (
        expectedRunToken !== playbackRunToken
        || !isSameMusicItem(expectedItem, currentItem)
    ) {
        recordPtvEvent('playback', 'music-playback-error-stale-suppressed', {
            stage
        });
        return Promise.resolve();
    }

    setPlaybackLoading(false);

    const item = currentItem;
    const message = error instanceof Error ? error.message : String(error);

    if (item && currentStreamMode === 'universal' && !hasTriedDownloadFallback) {
        hasTriedDownloadFallback = true;
        recordPtvEvent('render', 'music-native-player-fallback', {
            error: message,
            itemId: item.Id || null,
            stage,
            target: 'download'
        });

        return loadCurrentItem(expectedAutoplay, getCurrentPositionTicks(), 'download', options);
    }

    lastPlaybackError = item ?
        `${item.Name || 'This track'} is unavailable. Choose another track or try again.` :
        'Music playback is unavailable. Choose another track or try again.';

    recordPtvEvent('render', 'music-playback-error', {
        engine: 'native-audio',
        error: message,
        itemId: item?.Id || null,
        stage
    });

    emitQueueUpdated('error');

    if (options.rejectOnPlaybackError) {
        return Promise.reject(new Error(message || 'Native audio playback failed.'));
    }

    return Promise.resolve();
}

function onNativeError() {
    const context = activePlaybackContext;

    void handleNativePlaybackError(
        getAudioElement().error || new Error('Native audio playback failed.'),
        'audio-element',
        {},
        context?.runToken ?? playbackRunToken,
        currentItem
    );
}

function onNativeEnded() {
    const endedItem = currentItem;
    const endedContext = activePlaybackContext;
    const endedRunToken = endedContext?.runToken ?? 0;
    const now = Date.now();

    if (!endedItem || !endedContext || !isActivePlaybackContext(endedContext)) {
        recordPtvEvent('playback', 'music-playback-ended-stale-context-suppressed', {
            reason: 'missing-context',
            endedItemId: endedItem?.Id || null,
            reasonRoute: window.location.hash
        });
        return;
    }

    if (now - lastEndedAt < 280) {
        recordPtvEvent('playback', 'music-playback-ended-duplicate-suppressed', {
            endedItemId: endedItem?.Id || null,
            itemRunToken: endedRunToken,
            previousRunToken: lastEndedNavigationToken,
            queueIndex: endedContext.index
        });
        return;
    }

    setPlaybackLoading(false);
    lastEndedNavigationToken = endedRunToken;
    lastEndedAt = now;

    emitQueueUpdated('ended');
    recordPtvEvent('playback', 'music-playback-ended', {
        endedItemId: endedItem?.Id || null,
        queueCount: playlist.length,
        queueIndex: endedContext.index,
        runToken: endedRunToken
    });

    const resolveNextTrackResult = (): QueueNextOutcome => {
        recordPtvEvent('playback', 'music-queue-advance-requested', {
            runToken: endedRunToken,
            queueCount: playlist.length,
            queueIndex: currentIndex,
            reason: 'ended'
        });

        if (repeatMode === 'RepeatOne') {
            const endedReportContext = capturePlaybackReportContext(endedItem);

            reportPlayback('reportPlaybackStopped', endedItem, endedReportContext);
            recordPtvEvent('playback', 'music-queue-next-resolved', {
                nextReason: 'repeat-one',
                queueIndex: currentIndex,
                queueItemCount: playlist.length
            });
            void loadCurrentItem(true, 0);
            return 'repeat-one';
        }

        const nextIndex = getNextPlaylistIndex();

        if (nextIndex >= 0) {
            currentIndex = nextIndex;
            recordPtvEvent('playback', 'music-queue-next-resolved', {
                nextReason: 'playlist-next',
                nextQueueIndex: nextIndex,
                queueItemCount: playlist.length
            });
            void loadCurrentItem(true, 0);
            return 'playlist-next';
        }

        const virtualItem = takeNextVirtualQueueItem('ended');

        if (virtualItem) {
            appendVirtualQueueToPlaylist(virtualItem);
            recordPtvEvent('playback', 'music-queue-next-resolved', {
                nextReason: 'virtual-next',
                nextQueueIndex: playlist.length - virtualQueue.length - 1,
                queueItemCount: playlist.length
            });
            void loadCurrentItem(true, 0);
            return 'virtual-next';
        }

        return 'none';
    };

    const nextOutcome = resolveNextTrackResult();

    if (nextOutcome === 'none') {
        reportPlayback('reportPlaybackStopped', endedItem);
        recordPtvEvent('playback', 'music-queue-next-unavailable', {
            queueIndex: currentIndex,
            queueCount: playlist.length
        });
        emitQueueUpdated('ended');
    }
}

let shuffleSeed = Date.now() >>> 0;

function getShuffleRandomValue() {
    const cryptoApi = window['crypto'] as Crypto | undefined;

    if (typeof cryptoApi?.getRandomValues === 'function') {
        const values = new Uint32Array(1);

        cryptoApi.getRandomValues(values);
        return values[0] / 0xffffffff;
    }

    shuffleSeed = (shuffleSeed * 1664525 + 1013904223) >>> 0;
    return shuffleSeed / 0xffffffff;
}

function shuffleItems(items: PtvMusicQueueItem[]) {
    const shuffledItems = [...items];

    for (let index = shuffledItems.length - 1; index > 0; index -= 1) {
        const targetIndex = Math.floor(getShuffleRandomValue() * (index + 1));
        const swappedItem = shuffledItems[index];

        shuffledItems[index] = shuffledItems[targetIndex];
        shuffledItems[targetIndex] = swappedItem;
    }

    return shuffledItems;
}

export function getPtvMusicQueueSnapshot(): PtvMusicQueueSnapshot {
    validateQueueIdentity();
    const audio = getAudioElement();
    const cloneItem = <T extends PtvMusicItem | PtvMusicQueueItem | null>(item: T): T => {
        if (!item) return item;

        return {
            ...item,
            MediaSources: item.MediaSources?.map(mediaSource => ({ ...mediaSource })),
            UserData: item.UserData ? { ...item.UserData } : item.UserData
        } as T;
    };

    return {
        autoQueueSeedItem: cloneItem(autoQueueSeedItem),
        autoQueueSeedRevision,
        currentIndex,
        currentItem: cloneItem(currentItem),
        isAudio: Boolean(currentItem),
        isLoading,
        isMuted: audio.muted,
        isPlaying: Boolean(currentItem && !audio.paused && !audio.ended),
        isShuffled,
        playbackError: lastPlaybackError,
        playlist: getPlaylistSnapshot(),
        positionTicks: getCurrentPositionTicks(),
        queueRevision: playlistRevision,
        queueSourceLabel,
        repeatMode,
        runtimeTicks: getCurrentRuntimeTicks(),
        volumeLevel: Math.round(audio.volume * 100)
    } as PtvMusicQueueSnapshot & { queueRevision: number };
}

export function getPtvMusicVirtualQueue() {
    validateQueueIdentity();
    return getVirtualQueueRemaining();
}

export function setPtvMusicVirtualQueue(seedItem: PtvMusicItem | null, items: PtvMusicItem[], source = 'unknown') {
    validateQueueIdentity();
    bindQueueIdentity();
    const seedId = seedItem?.Id || '';
    const rejectedNonTrackCount = items.filter(item => !isPlayablePtvMusicTrack(item)).length;

    virtualQueueSeedId = seedId;
    virtualQueue = uniqueVirtualItems(items, seedId);
    virtualQueueCursor = 0;

    recordPtvEvent('render', 'music-virtual-queue-set', {
        count: virtualQueue.length,
        rejectedNonTrackCount,
        seedId: virtualQueueSeedId || null,
        source
    });

    promoteVirtualQueueToAutoplay(seedItem, source);
    scheduleNextMusicTrackPreload();

    return getVirtualQueueRemaining();
}

export function openPtvMusicPlayer(source = 'unknown') {
    recordPtvEvent('render', 'music-player-open-requested', {
        engine: 'native-audio',
        hash: window.location.hash,
        navigationReason: 'explicit-user-action',
        source
    });

    if (window.location.hash !== MUSIC_PLAYER_HASH) {
        window.location.hash = MUSIC_PLAYER_HASH;
    }
}

export function openPtvMusicQueuePanel(source = 'unknown') {
    recordPtvEvent('render', 'music-queue-open-requested', {
        engine: 'native-audio',
        navigationReason: 'explicit-user-action',
        source
    });

    if (window.location.hash !== `${MUSIC_PLAYER_HASH}?panel=queue`) {
        window.location.hash = `${MUSIC_PLAYER_HASH}?panel=queue`;
    }
}

export function subscribeToPtvMusicQueue(listener: QueueListener) {
    getAudioElement();
    listeners.add(listener);
    listener(getPtvMusicQueueSnapshot());
    void restorePtvMusicQueueContinuity();

    return () => {
        listeners.delete(listener);
    };
}

export function playPtvMusicTracks(items: PtvMusicItem[], startIndex = 0, options: PlayOptions = {}) {
    validateQueueIdentity();

    if (!items.length) {
        recordPtvEvent('render', 'music-play-request-empty', {
            engine: 'native-audio',
            startIndex
        });

        return options.rejectOnPlaybackError ?
            Promise.reject(new Error('Music queue is empty.')) :
            Promise.resolve();
    }

    const normalizedItems = items.map(normalizeQueueItem);
    const safeStartIndex = Math.max(0, Math.min(startIndex, normalizedItems.length - 1));

    bindQueueIdentity();
    setMusicStartupVolume();
    playlist = normalizedItems;
    sourcePlaylist = normalizedItems.slice();
    currentIndex = safeStartIndex;
    queueSourceLabel = options.queueSourceLabel?.trim() || 'Now Playing';
    invalidatePlaylistSnapshot();

    if (!options.preserveVirtualQueue) {
        autoQueueSeedItem = normalizedItems[safeStartIndex] || null;
        autoQueueSeedRevision += 1;
        virtualQueueSeedId = autoQueueSeedItem?.Id || '';
        virtualQueue = [];
        virtualQueueCursor = 0;

        recordPtvEvent('render', 'music-virtual-queue-set', {
            count: 0,
            seedId: virtualQueueSeedId || null,
            source: 'play-request'
        });
    }

    recordPtvEvent('render', 'music-play-request', {
        engine: 'native-audio',
        itemId: normalizedItems[safeStartIndex]?.Id || null,
        queueCount: normalizedItems.length,
        startIndex: safeStartIndex
    });

    return loadCurrentItem(true, options.startPositionTicks || 0, 'universal', options);
}

export function playPtvMusicNext(item: PtvMusicItem) {
    validateQueueIdentity();
    bindQueueIdentity();

    if (!currentItem) {
        return playPtvMusicTracks([item], 0, {
            queueSourceLabel: 'Play Next'
        });
    }

    playlist.splice(currentIndex + 1, 0, normalizeQueueItem(item));
    if (isShuffled) sourcePlaylist = playlist.slice();
    invalidatePlaylistSnapshot();
    scheduleNextMusicTrackPreload();

    return Promise.resolve(emitQueueUpdated('play-next'));
}

export function addPtvMusicToQueue(item: PtvMusicItem) {
    validateQueueIdentity();
    bindQueueIdentity();
    playlist.push(normalizeQueueItem(item, playlist.length));
    if (isShuffled) sourcePlaylist = playlist.slice();
    invalidatePlaylistSnapshot();
    scheduleNextMusicTrackPreload();

    return Promise.resolve(emitQueueUpdated('add'));
}

export function addPtvMusicItemsToQueue(items: PtvMusicItem[]) {
    validateQueueIdentity();
    bindQueueIdentity();
    const playableItems = items.filter(isPlayablePtvMusicTrack);

    if (!playableItems.length) return Promise.resolve(getPtvMusicQueueSnapshot());

    playlist.push(...playableItems.map((item, index) => normalizeQueueItem(item, playlist.length + index)));
    if (isShuffled) sourcePlaylist = playlist.slice();
    invalidatePlaylistSnapshot();
    scheduleNextMusicTrackPreload();

    return Promise.resolve(emitQueueUpdated('add-many'));
}

export function playPtvMusicItemsNext(items: PtvMusicItem[]) {
    validateQueueIdentity();
    bindQueueIdentity();
    const playableItems = items.filter(isPlayablePtvMusicTrack);

    if (!playableItems.length) return Promise.resolve(getPtvMusicQueueSnapshot());
    if (!currentItem) {
        return playPtvMusicTracks(playableItems, 0, {
            queueSourceLabel: 'Play Next'
        });
    }

    playlist.splice(
        currentIndex + 1,
        0,
        ...playableItems.map((item, index) => normalizeQueueItem(item, currentIndex + 1 + index))
    );
    if (isShuffled) sourcePlaylist = playlist.slice();
    invalidatePlaylistSnapshot();
    scheduleNextMusicTrackPreload();

    return Promise.resolve(emitQueueUpdated('play-next-many'));
}

export function removePtvMusicQueueItem(playlistItemId: string) {
    validateQueueIdentity();
    if (!playlistItemId) return Promise.resolve(getPtvMusicQueueSnapshot());

    const removeIndex = playlist.findIndex(item => item.PlaylistItemId === playlistItemId);

    if (removeIndex < 0) return Promise.resolve(getPtvMusicQueueSnapshot());

    if (removeIndex === currentIndex) {
        return Promise.resolve(emitQueueUpdated('remove-current-blocked'));
    }

    playlist.splice(removeIndex, 1);
    if (removeIndex < currentIndex) currentIndex -= 1;
    if (isShuffled) sourcePlaylist = playlist.slice();
    invalidatePlaylistSnapshot();
    scheduleNextMusicTrackPreload();

    return Promise.resolve(emitQueueUpdated('remove'));
}

export function movePtvMusicQueueItem(playlistItemId: string, newIndex: number) {
    validateQueueIdentity();
    if (!playlistItemId) return Promise.resolve(getPtvMusicQueueSnapshot());

    const oldIndex = playlist.findIndex(item => item.PlaylistItemId === playlistItemId);

    if (oldIndex < 0) return Promise.resolve(getPtvMusicQueueSnapshot());

    const [item] = playlist.splice(oldIndex, 1);
    const targetIndex = Math.max(0, Math.min(newIndex, playlist.length));

    playlist.splice(targetIndex, 0, item);

    if (oldIndex === currentIndex) {
        currentIndex = targetIndex;
    } else if (oldIndex < currentIndex && targetIndex >= currentIndex) {
        currentIndex -= 1;
    } else if (oldIndex > currentIndex && targetIndex <= currentIndex) {
        currentIndex += 1;
    }

    if (isShuffled) sourcePlaylist = playlist.slice();
    invalidatePlaylistSnapshot();
    scheduleNextMusicTrackPreload();

    return Promise.resolve(emitQueueUpdated('reorder'));
}

export function clearPtvMusicQueue() {
    validateQueueIdentity();
    playlist = currentItem ? [normalizeQueueItem(currentItem)] : [];
    currentIndex = currentItem ? 0 : -1;
    sourcePlaylist = playlist.slice();
    invalidatePlaylistSnapshot();
    scheduleNextMusicTrackPreload();

    return Promise.resolve(emitQueueUpdated('clear'));
}

export function playPtvMusicQueueItem(playlistItemId: string) {
    validateQueueIdentity();
    const nextIndex = playlist.findIndex(item => item.PlaylistItemId === playlistItemId);

    if (nextIndex < 0 || nextIndex === currentIndex) {
        return Promise.resolve(getPtvMusicQueueSnapshot());
    }

    currentIndex = nextIndex;

    return loadCurrentItem(true, 0).then(() => emitQueueUpdated('play-queue-item'));
}

export function pausePtvMusicPlayback(reason = 'unknown') {
    validateQueueIdentity();
    const item = currentItem;

    if (!item) return Promise.resolve(getPtvMusicQueueSnapshot());

    const audio = getAudioElement();

    currentPlayPromise = null;

    try {
        audio.pause();
        const reportContext = capturePlaybackReportContext(item);

        reportPlayback('reportPlaybackProgress', item, reportContext);
        recordMeaningfulPlaybackHistory(reportContext);
    } catch (error) {
        recordPtvEvent('render', 'music-playback-error', {
            engine: 'native-audio',
            error: error instanceof Error ? error.message : String(error),
            itemId: item.Id || null,
            stage: 'pause-for-owner-handoff'
        });
    }

    recordPtvEvent('playback', 'music-player-paused-for-owner-handoff', {
        itemId: item.Id || null,
        queueCount: playlist.length,
        reason
    });

    return Promise.resolve(emitQueueUpdated('owner-handoff-pause'));
}

export function stopPtvMusicPlayback(reason = 'unknown') {
    validateQueueIdentity();
    const item = currentItem;
    const audio = getAudioElement();

    playbackRunToken += 1;

    if (item) {
        reportPlayback('reportPlaybackStopped', item);
    }

    try {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
    } catch (error) {
        recordPtvEvent('render', 'music-playback-error', {
            engine: 'native-audio',
            error: error instanceof Error ? error.message : String(error),
            itemId: item?.Id || null,
            stage: 'stop'
        });
    }

    resetQueueState();

    recordPtvEvent('render', 'music-player-stopped', {
        itemId: item?.Id || null,
        reason
    });

    return Promise.resolve(emitQueueUpdated('stop'));
}

export function setPtvMusicRepeatMode(mode: string) {
    const supportedModes = new Set([
        'RepeatNone',
        'RepeatOne',
        'RepeatAll'
    ]);

    repeatMode = supportedModes.has(mode) ? mode : 'RepeatNone';
    scheduleNextMusicTrackPreload();

    return emitQueueUpdated('repeat');
}

export function togglePtvMusicShuffle() {
    validateQueueIdentity();
    if (!playlist.length) {
        isShuffled = !isShuffled;
        return emitQueueUpdated('shuffle');
    }

    if (!isShuffled) {
        sourcePlaylist = playlist.slice();
        const current = playlist[currentIndex];
        const rest = playlist.filter((_, index) => index !== currentIndex);

        playlist = current ? [current, ...shuffleItems(rest)] : shuffleItems(rest);
        currentIndex = current ? 0 : -1;
        isShuffled = true;
    } else {
        const currentKey = playlist[currentIndex]?.PlaylistItemId;

        playlist = sourcePlaylist.length ? sourcePlaylist.slice() : playlist;
        currentIndex = Math.max(0, playlist.findIndex(item => item.PlaylistItemId === currentKey));
        isShuffled = false;
    }

    invalidatePlaylistSnapshot();
    scheduleNextMusicTrackPreload();

    return emitQueueUpdated('shuffle');
}

export function togglePtvMusicPlayPause() {
    validateQueueIdentity();
    const audio = getAudioElement();

    if (!currentItem) return Promise.resolve(emitQueueUpdated('play-pause-empty'));

    if (audio.paused) {
        return audio.play()
            .then(() => {
                reportPlayback('reportPlaybackStart');
                return emitQueueUpdated('play-pause');
            })
            .catch(error => handleNativePlaybackError(error, 'play-pause'));
    }

    audio.pause();
    const reportContext = capturePlaybackReportContext();

    reportPlayback('reportPlaybackProgress', currentItem, reportContext);
    recordMeaningfulPlaybackHistory(reportContext);

    return Promise.resolve(emitQueueUpdated('play-pause'));
}

export function seekPtvMusicPercent(percent: number) {
    validateQueueIdentity();
    const audio = getAudioElement();

    if (!currentItem || !getCurrentRuntimeTicks()) {
        return emitQueueUpdated('seek-empty');
    }

    const normalizedPercent = Math.max(0, Math.min(100, Number(percent) || 0));
    const durationSeconds = Number.isFinite(audio.duration) && audio.duration > 0 ?
        audio.duration :
        Number(currentItem.RunTimeTicks || 0) / TICKS_PER_SECOND;

    if (!durationSeconds) return emitQueueUpdated('seek-no-duration');

    try {
        audio.currentTime = (durationSeconds * normalizedPercent) / 100;
        reportPlayback('reportPlaybackProgress');
    } catch (error) {
        recordPtvEvent('render', 'music-playback-error', {
            engine: 'native-audio',
            error: error instanceof Error ? error.message : String(error),
            itemId: currentItem.Id || null,
            stage: 'seek'
        });
    }

    return emitQueueUpdated('seek');
}

export function seekPtvMusicFromClientX(clientX: number, element: Element) {
    const rect = element.getBoundingClientRect();

    if (!rect.width) return emitQueueUpdated('seek-empty-rect');

    const percent = ((clientX - rect.left) / rect.width) * 100;

    return seekPtvMusicPercent(percent);
}

export function previousPtvMusicTrack() {
    validateQueueIdentity();
    const audio = getAudioElement();

    if (audio.currentTime > 3) {
        audio.currentTime = 0;
        return Promise.resolve(emitQueueUpdated('previous-restart'));
    }

    const previousIndex = getPreviousPlaylistIndex();

    if (previousIndex >= 0) {
        currentIndex = previousIndex;
        return loadCurrentItem(true, 0).then(() => emitQueueUpdated('previous'));
    }

    return Promise.resolve(emitQueueUpdated('previous-empty'));
}

export function nextPtvMusicTrack() {
    validateQueueIdentity();
    const nextIndex = getNextPlaylistIndex();

    if (nextIndex >= 0) {
        currentIndex = nextIndex;
        return loadCurrentItem(true, 0).then(() => emitQueueUpdated('next'));
    }

    const virtualItem = takeNextVirtualQueueItem('next-button');

    if (virtualItem) {
        appendVirtualQueueToPlaylist(virtualItem);
        return loadCurrentItem(true, 0).then(() => emitQueueUpdated('next-virtual'));
    }

    return Promise.resolve(emitQueueUpdated('next-empty'));
}

export function setPtvMusicVolume(volumeLevel: number) {
    validateQueueIdentity();
    const normalizedVolume = Math.max(0, Math.min(100, Math.round(volumeLevel)));
    const audio = getAudioElement();

    audio.volume = normalizedVolume / 100;

    return emitQueueUpdated('volume');
}

export function togglePtvMusicMute() {
    validateQueueIdentity();
    const audio = getAudioElement();

    audio.muted = !audio.muted;

    return emitQueueUpdated('mute');
}

export function savePtvMusicQueueAsPlaylist(name: string) {
    const snapshot = getPtvMusicQueueSnapshot();

    return savePtvMusicPlaylist(name, snapshot.playlist);
}

export function restorePtvMusicContinuity() {
    return restorePtvMusicQueueContinuity();
}

export function updatePtvMusicQueueItemUserData(
    itemId: string,
    userData: PtvMusicItem['UserData']
) {
    if (!itemId) return getPtvMusicQueueSnapshot();

    let changed = false;
    const updateItem = <T extends PtvMusicItem>(item: T): T => {
        if (item.Id !== itemId) return item;

        changed = true;
        return {
            ...item,
            UserData: userData ? { ...userData } : userData
        };
    };

    playlist = playlist.map(updateItem);
    sourcePlaylist = sourcePlaylist.map(updateItem);
    virtualQueue = virtualQueue.map(updateItem);
    currentItem = currentItem ? updateItem(currentItem) : null;
    autoQueueSeedItem = autoQueueSeedItem ? updateItem(autoQueueSeedItem) : null;

    if (changed) invalidatePlaylistSnapshot();

    return changed ? emitQueueUpdated('user-data') : getPtvMusicQueueSnapshot();
}

export function retirePtvMusicIdentityState(reason = 'identity-retired') {
    const retired = retireQueueForIdentityChange(reason);

    if (retired) {
        emitQueueUpdated('identity-retired');
    }

    return retired;
}
