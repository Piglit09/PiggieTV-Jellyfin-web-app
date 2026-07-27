import { PTV_CORE_CONTRACT_VERSION, type PtvCoreContractVersion } from '../contracts/version';
import type { PtvCoreError, PtvCoreResult } from '../errors/coreError';

export type PtvPlaybackStatus =
    | 'buffering'
    | 'ended'
    | 'error'
    | 'idle'
    | 'loading'
    | 'paused'
    | 'playing';
export type PtvRepeatMode = 'all' | 'off' | 'one';
export type PtvPlaybackMediaKind = 'audio' | 'video';

export type PtvPlaybackState = Readonly<{
    audioTrackId?: string;
    completed: boolean;
    contractVersion: PtvCoreContractVersion;
    durationMs?: number;
    error?: PtvCoreError;
    mediaId?: string;
    mediaKind?: PtvPlaybackMediaKind;
    positionMs: number;
    queue: readonly string[];
    queueIndex: number;
    repeatMode: PtvRepeatMode;
    shuffled: boolean;
    status: PtvPlaybackStatus;
    subtitleTrackId?: string;
}>;

export type PtvPlaybackCommand =
    | Readonly<{ type: 'add-to-queue'; mediaIds: readonly string[] }>
    | Readonly<{ type: 'next' }>
    | Readonly<{ type: 'pause' }>
    | Readonly<{ type: 'play' }>
    | Readonly<{ type: 'play-next'; mediaIds: readonly string[] }>
    | Readonly<{ type: 'previous' }>
    | Readonly<{ type: 'replace-queue'; mediaIds: readonly string[]; startIndex?: number }>
    | Readonly<{ type: 'seek'; positionMs: number }>
    | Readonly<{ type: 'select-audio-track'; trackId?: string }>
    | Readonly<{ type: 'select-subtitle-track'; trackId?: string }>
    | Readonly<{ type: 'set-repeat'; repeatMode: PtvRepeatMode }>
    | Readonly<{ type: 'set-shuffle'; shuffled: boolean }>;

export interface PtvPlaybackAdapter {
    execute(command: PtvPlaybackCommand): Promise<PtvCoreResult<PtvPlaybackState>>;
    getState(): PtvPlaybackState;
    subscribe(listener: (state: PtvPlaybackState) => void): () => void;
}

export function createInitialPtvPlaybackState(
    overrides: Partial<Omit<PtvPlaybackState, 'contractVersion'>> = {}
): PtvPlaybackState {
    return {
        completed: false,
        contractVersion: PTV_CORE_CONTRACT_VERSION,
        positionMs: 0,
        queue: [],
        queueIndex: -1,
        repeatMode: 'off',
        shuffled: false,
        status: 'idle',
        ...overrides
    };
}

function normalizeQueue(mediaIds: readonly string[]) {
    return mediaIds.map(id => id.trim()).filter(Boolean);
}

function withQueueIndex(state: PtvPlaybackState, queue: readonly string[], queueIndex: number): PtvPlaybackState {
    const normalizedIndex = queue.length ? Math.min(Math.max(0, queueIndex), queue.length - 1) : -1;

    return {
        ...state,
        completed: false,
        mediaId: normalizedIndex >= 0 ? queue[normalizedIndex] : undefined,
        positionMs: normalizedIndex === state.queueIndex ? state.positionMs : 0,
        queue,
        queueIndex: normalizedIndex,
        status: normalizedIndex >= 0 ? state.status : 'idle'
    };
}

function seekPtvPlaybackState(state: PtvPlaybackState, positionMs: number): PtvPlaybackState {
    const maxPosition = state.durationMs ?? Number.MAX_SAFE_INTEGER;

    return {
        ...state,
        completed: false,
        positionMs: Math.min(Math.max(0, Math.round(positionMs)), maxPosition)
    };
}

function nextPtvPlaybackState(state: PtvPlaybackState): PtvPlaybackState {
    if (!state.queue.length) return state;
    if (state.repeatMode === 'one') return { ...state, completed: false, positionMs: 0 };
    const nextIndex = state.queueIndex + 1;
    if (nextIndex < state.queue.length) return withQueueIndex(state, state.queue, nextIndex);
    if (state.repeatMode === 'all') return withQueueIndex(state, state.queue, 0);

    return { ...state, completed: true, status: 'ended' };
}

function previousPtvPlaybackState(state: PtvPlaybackState): PtvPlaybackState {
    if (!state.queue.length) return state;
    if (state.positionMs > 5000) return { ...state, completed: false, positionMs: 0 };
    const previousIndex = state.queueIndex - 1;
    if (previousIndex >= 0) return withQueueIndex(state, state.queue, previousIndex);
    if (state.repeatMode === 'all') return withQueueIndex(state, state.queue, state.queue.length - 1);

    return { ...state, positionMs: 0 };
}

function playNextPtvPlaybackState(
    state: PtvPlaybackState,
    mediaIds: readonly string[]
): PtvPlaybackState {
    const normalizedMediaIds = normalizeQueue(mediaIds);
    const insertionIndex = Math.max(0, state.queueIndex + 1);
    const queue = [
        ...state.queue.slice(0, insertionIndex),
        ...normalizedMediaIds,
        ...state.queue.slice(insertionIndex)
    ];

    return withQueueIndex(state, queue, state.queueIndex);
}

export function reducePtvPlaybackState(
    state: PtvPlaybackState,
    command: PtvPlaybackCommand
): PtvPlaybackState {
    switch (command.type) {
        case 'play':
            return { ...state, completed: false, status: state.mediaId ? 'playing' : state.status };
        case 'pause':
            return { ...state, status: state.mediaId ? 'paused' : state.status };
        case 'seek':
            return seekPtvPlaybackState(state, command.positionMs);
        case 'next':
            return nextPtvPlaybackState(state);
        case 'previous':
            return previousPtvPlaybackState(state);
        case 'replace-queue': {
            const queue = normalizeQueue(command.mediaIds);
            return withQueueIndex(state, queue, command.startIndex ?? 0);
        }
        case 'add-to-queue':
            return withQueueIndex(state, [...state.queue, ...normalizeQueue(command.mediaIds)], state.queueIndex);
        case 'play-next':
            return playNextPtvPlaybackState(state, command.mediaIds);
        case 'set-repeat':
            return { ...state, repeatMode: command.repeatMode };
        case 'set-shuffle':
            return { ...state, shuffled: command.shuffled };
        case 'select-audio-track':
            return { ...state, audioTrackId: command.trackId };
        case 'select-subtitle-track':
            return { ...state, subtitleTrackId: command.trackId };
        default:
            return state;
    }
}

export function completePtvPlaybackState(state: PtvPlaybackState): PtvPlaybackState {
    return {
        ...state,
        completed: true,
        positionMs: state.durationMs ?? state.positionMs,
        status: 'ended'
    };
}

export function shouldPtvAutoplayNext(options: Readonly<{
    backgroundPlaybackSupported?: boolean;
    completionReason: 'completed' | 'error' | 'stopped';
    enabled: boolean;
    hasNext: boolean;
    userCancelled?: boolean;
}>): boolean {
    return options.enabled
        && options.hasNext
        && options.completionReason === 'completed'
        && options.userCancelled !== true
        && options.backgroundPlaybackSupported !== false;
}
