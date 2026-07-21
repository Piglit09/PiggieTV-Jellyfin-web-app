import {
    getPtvApiClient,
    getPtvCurrentUserId
} from '../../api';
import { recordPtvEvent } from '../../core/observability';

import { savePtvMusicPlaylist } from './musicPlaylists';
import type {
    PtvMusicItem,
    PtvMusicQueueItem,
    PtvMusicQueueSnapshot
} from './musicTypes';

type QueueListener = (snapshot: PtvMusicQueueSnapshot) => void;
type PlayOptions = {
    preserveVirtualQueue?: boolean;
    rejectOnPlaybackError?: boolean;
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

const TICKS_PER_SECOND = 10000000;
const MUSIC_PLAYER_HASH = '#/music/player';
const MUSIC_QUEUE_ACTIVITY_EVENT = 'ptv:music-queue-activity';
const DEFAULT_PTV_MUSIC_VOLUME_LEVEL = 50;
const DEFAULT_PTV_MUSIC_VOLUME = DEFAULT_PTV_MUSIC_VOLUME_LEVEL / 100;
const MUSIC_QUEUE_PROGRESS_PUBLISH_INTERVAL_MS = 1000;
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
let autoQueueSeedItem: PtvMusicItem | null = null;
let autoQueueSeedRevision = 0;
let currentIndex = -1;
let currentItem: PtvMusicItem | null = null;
let currentPlayPromise: Promise<unknown> | null = null;
let currentPlaySessionId = '';
let currentStreamMode: StreamMode = 'universal';
let hasTriedDownloadFallback = false;
let isShuffled = false;
let lastProgressReportAt = 0;
let lastQueueProgressPublishAt = 0;
let nativePlaySessionSeed = Date.now();
let playbackRunToken = 0;
let playlist: PtvMusicQueueItem[] = [];
let repeatMode = 'RepeatNone';
let sourcePlaylist: PtvMusicQueueItem[] = [];
let virtualQueue: PtvMusicItem[] = [];
let virtualQueueCursor = 0;
let virtualQueueSeedId = '';
let lastEndedAt = 0;
let lastEndedNavigationToken = 0;

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

function getAudioElement() {
    if (audioElement) return audioElement;

    audioElement = document.createElement('audio');
    audioElement.dataset.ptvMusicNativePlayer = 'true';
    audioElement.preload = 'auto';
    audioElement.volume = DEFAULT_PTV_MUSIC_VOLUME;
    audioElement.style.display = 'none';
    document.body.append(audioElement);

    audioElement.addEventListener('durationchange', () => emitQueueUpdated('duration'));
    audioElement.addEventListener('ended', onNativeEnded);
    audioElement.addEventListener('error', onNativeError);
    audioElement.addEventListener('pause', () => emitQueueUpdated('pause'));
    audioElement.addEventListener('play', () => emitQueueUpdated('play'));
    audioElement.addEventListener('playing', () => emitQueueUpdated('playing'));
    audioElement.addEventListener('timeupdate', () => {
        reportPlaybackProgressThrottled();
        const now = Date.now();

        if (now - lastQueueProgressPublishAt >= MUSIC_QUEUE_PROGRESS_PUBLISH_INTERVAL_MS) {
            lastQueueProgressPublishAt = now;
            emitQueueUpdated('timeupdate');
        }
    });
    audioElement.addEventListener('volumechange', () => emitQueueUpdated('volume'));

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
    return Boolean(context && activePlaybackContext && context.runToken === activePlaybackContext.runToken);
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

function getAudioStreamUrl(item: PtvMusicItem, startTicks = 0, mode: StreamMode = 'universal') {
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

    currentPlaySessionId = String(++nativePlaySessionSeed);

    return apiClient.getUrl(`Audio/${item.Id}/universal`, {
        ApiKey: apiClient.accessToken?.() || '',
        AudioCodec: 'mp3,aac,opus,flac',
        Container: DIRECT_AUDIO_CONTAINERS,
        DeviceId: apiClient.deviceId?.() || 'ptv-music-native',
        EnableAudioVbrEncoding: true,
        EnableRedirection: true,
        EnableRemoteMedia: true,
        MaxStreamingBitrate: 140000000,
        PlaySessionId: currentPlaySessionId,
        StartTimeTicks: Math.max(0, Math.round(startTicks)),
        TranscodingContainer: 'mp3',
        TranscodingProtocol: 'http',
        UserId: apiClient.getCurrentUserId?.() || getPtvCurrentUserId(item.ServerId)
    });
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

    return snapshot;
}

function reportPlayback(method: 'reportPlaybackProgress' | 'reportPlaybackStart' | 'reportPlaybackStopped', item = currentItem) {
    if (!item?.Id) return;

    const apiClient = getCurrentApiClient(item);
    const report = apiClient?.[method];

    if (typeof report !== 'function') return;

    void report.call(apiClient, {
        AudioStreamIndex: 0,
        CanSeek: true,
        IsMuted: getAudioElement().muted,
        IsPaused: getAudioElement().paused,
        ItemId: item.Id,
        MediaSourceId: item.MediaSources?.[0]?.Id || item.Id,
        PlayMethod: 'DirectStream',
        PlaySessionId: currentPlaySessionId,
        PositionTicks: getCurrentPositionTicks(),
        VolumeLevel: Math.round(getAudioElement().volume * 100)
    }).catch(error => {
        recordPtvEvent('render', 'music-native-report-failed', {
            error: error instanceof Error ? error.message : String(error),
            itemId: item.Id,
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
    currentIndex = Math.max(0, currentIndex + 1);
}

function promoteVirtualQueueToAutoplay(seedItem: PtvMusicItem | null, source: string) {
    if (source !== 'player-related' || !isSameMusicItem(seedItem, currentItem)) return false;

    const currentQueueItem = playlist[currentIndex] || (currentItem ? normalizeQueueItem(currentItem) : null);

    if (!currentQueueItem) return false;

    playlist = [
        currentQueueItem,
        ...virtualQueue.map(normalizeQueueItem)
    ];
    sourcePlaylist = playlist.slice();
    currentIndex = 0;
    virtualQueueCursor = virtualQueue.length;

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
    const audio = getAudioElement();
    const playToken = ++playbackRunToken;

    if (!item) {
        currentItem = null;
        audio.pause();
        audio.removeAttribute('src');
        audio.load();

        return Promise.resolve(emitQueueUpdated('empty'));
    }

    currentItem = item;
    currentStreamMode = mode;
    hasTriedDownloadFallback = mode === 'download';
    lastProgressReportAt = 0;

    try {
        audio.pause();
        audio.src = getAudioStreamUrl(item, startTicks, mode);
        audio.load();
    } catch (error) {
        return handleNativePlaybackError(error, 'load', options);
    }

    capturePlaybackContext(item, currentIndex, playToken);
    emitQueueUpdated('load');

    if (!autoplay) {
        return Promise.resolve(emitQueueUpdated('loaded-paused'));
    }

    currentPlayPromise = audio.play()
        .then(() => {
            if (playToken !== playbackRunToken || currentItem?.Id !== item.Id) {
                return emitQueueUpdated('play-start-ignored');
            }

            reportPlayback('reportPlaybackStart', item);
            recordPtvEvent('render', 'music-player-started', {
                codec: String(item.Container || ''),
                engine: 'native-audio',
                itemId: item.Id || null,
                queueCount: playlist.length
            });
            return emitQueueUpdated('play-started');
        })
        .catch(error => handleNativePlaybackError(error, 'play', options))
        .finally(() => {
            currentPlayPromise = null;
        });

    return currentPlayPromise;
}

function handleNativePlaybackError(error: unknown, stage: string, options: PlayOptions = {}): Promise<unknown> {
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

        return loadCurrentItem(true, getCurrentPositionTicks(), 'download', options);
    }

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
    void handleNativePlaybackError(getAudioElement().error || new Error('Native audio playback failed.'), 'audio-element');
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

    if (endedContext.runToken === lastEndedNavigationToken && now - lastEndedAt < 280) {
        recordPtvEvent('playback', 'music-playback-ended-duplicate-suppressed', {
            endedItemId: endedItem?.Id || null,
            itemRunToken: endedRunToken,
            queueIndex: endedContext.index
        });
        return;
    }

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
        return;
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
    const audio = getAudioElement();

    return {
        autoQueueSeedItem,
        autoQueueSeedRevision,
        currentIndex,
        currentItem,
        isAudio: Boolean(currentItem),
        isMuted: audio.muted,
        isPlaying: Boolean(currentItem && !audio.paused && !audio.ended),
        isShuffled,
        playlist,
        positionTicks: getCurrentPositionTicks(),
        repeatMode,
        runtimeTicks: getCurrentRuntimeTicks(),
        volumeLevel: Math.round(audio.volume * 100)
    };
}

export function getPtvMusicVirtualQueue() {
    return getVirtualQueueRemaining();
}

export function setPtvMusicVirtualQueue(seedItem: PtvMusicItem | null, items: PtvMusicItem[], source = 'unknown') {
    const seedId = seedItem?.Id || '';

    virtualQueueSeedId = seedId;
    virtualQueue = uniqueVirtualItems(items, seedId);
    virtualQueueCursor = 0;

    recordPtvEvent('render', 'music-virtual-queue-set', {
        count: virtualQueue.length,
        seedId: virtualQueueSeedId || null,
        source
    });

    promoteVirtualQueueToAutoplay(seedItem, source);

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

export function subscribeToPtvMusicQueue(listener: QueueListener) {
    getAudioElement();
    listeners.add(listener);
    listener(getPtvMusicQueueSnapshot());

    return () => {
        listeners.delete(listener);
    };
}

export function playPtvMusicTracks(items: PtvMusicItem[], startIndex = 0, options: PlayOptions = {}) {
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

    reportPlayback('reportPlaybackStopped');
    setMusicStartupVolume();
    playlist = normalizedItems;
    sourcePlaylist = normalizedItems;
    currentIndex = safeStartIndex;

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

    return loadCurrentItem(true, 0, 'universal', options);
}

export function playPtvMusicNext(item: PtvMusicItem) {
    if (!currentItem) {
        return playPtvMusicTracks([item], 0);
    }

    playlist.splice(currentIndex + 1, 0, normalizeQueueItem(item));

    return Promise.resolve(emitQueueUpdated('play-next'));
}

export function addPtvMusicToQueue(item: PtvMusicItem) {
    playlist.push(normalizeQueueItem(item, playlist.length));

    return Promise.resolve(emitQueueUpdated('add'));
}

export function removePtvMusicQueueItem(playlistItemId: string) {
    if (!playlistItemId) return Promise.resolve(getPtvMusicQueueSnapshot());

    const removeIndex = playlist.findIndex(item => item.PlaylistItemId === playlistItemId);

    if (removeIndex < 0) return Promise.resolve(getPtvMusicQueueSnapshot());

    playlist.splice(removeIndex, 1);

    if (removeIndex < currentIndex) {
        currentIndex -= 1;
    } else if (removeIndex === currentIndex) {
        if (playlist[currentIndex]) {
            void loadCurrentItem(true, 0);
        } else {
            currentIndex = playlist.length - 1;
            if (currentIndex >= 0) {
                void loadCurrentItem(true, 0);
            } else {
                currentItem = null;
                getAudioElement().pause();
            }
        }
    }

    return Promise.resolve(emitQueueUpdated('remove'));
}

export function movePtvMusicQueueItem(playlistItemId: string, newIndex: number) {
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

    return Promise.resolve(emitQueueUpdated('reorder'));
}

export function clearPtvMusicQueue() {
    playlist = currentItem ? [normalizeQueueItem(currentItem)] : [];
    currentIndex = currentItem ? 0 : -1;

    return Promise.resolve(emitQueueUpdated('clear'));
}

export function pausePtvMusicPlayback(reason = 'unknown') {
    const item = currentItem;

    if (!item) return Promise.resolve(getPtvMusicQueueSnapshot());

    const audio = getAudioElement();

    currentPlayPromise = null;

    try {
        audio.pause();
        reportPlayback('reportPlaybackProgress', item);
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

    autoQueueSeedItem = null;
    autoQueueSeedRevision += 1;
    currentIndex = -1;
    currentItem = null;
    currentPlayPromise = null;
    currentPlaySessionId = '';
    currentStreamMode = 'universal';
    hasTriedDownloadFallback = false;
    isShuffled = false;
    lastProgressReportAt = 0;
    playlist = [];
    repeatMode = 'RepeatNone';
    sourcePlaylist = [];
    virtualQueue = [];
    virtualQueueCursor = 0;
    virtualQueueSeedId = '';

    recordPtvEvent('render', 'music-player-stopped', {
        itemId: item?.Id || null,
        reason
    });

    return Promise.resolve(emitQueueUpdated('stop'));
}

export function setPtvMusicRepeatMode(mode: string) {
    repeatMode = mode;

    return emitQueueUpdated('repeat');
}

export function togglePtvMusicShuffle() {
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

    return emitQueueUpdated('shuffle');
}

export function togglePtvMusicPlayPause() {
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
    reportPlayback('reportPlaybackProgress');

    return Promise.resolve(emitQueueUpdated('play-pause'));
}

export function seekPtvMusicPercent(percent: number) {
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
    const normalizedVolume = Math.max(0, Math.min(100, Math.round(volumeLevel)));
    const audio = getAudioElement();

    audio.volume = normalizedVolume / 100;

    return emitQueueUpdated('volume');
}

export function togglePtvMusicMute() {
    const audio = getAudioElement();

    audio.muted = !audio.muted;

    return emitQueueUpdated('mute');
}

export function savePtvMusicQueueAsPlaylist(name: string) {
    const snapshot = getPtvMusicQueueSnapshot();

    return savePtvMusicPlaylist(name, snapshot.playlist);
}
