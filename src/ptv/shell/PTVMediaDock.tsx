import React, { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

import {
    notifyPtvTvPlaybackSurfaceDisposed,
    notifyPtvTvPlaybackSurfaceReady
} from '../core/tvFocus';
import { PtvIcon } from '../modules/icons';
import {
    getPtvGlobalPlaybackState,
    nextPtvGlobalPlaybackTrack,
    openPtvGlobalPlaybackDetails,
    openPtvGlobalPlaybackPrimary,
    openPtvGlobalPlaybackQueue,
    previousPtvGlobalPlaybackTrack,
    stopPtvGlobalPlayback,
    subscribeToPtvGlobalPlaybackState,
    togglePtvGlobalPlaybackFavorite,
    type PtvGlobalPlaybackState
} from '../services/playbackStateService';
import {
    getPtvPlaybackPresentationSnapshot,
    subscribeToPtvPlaybackPresentation,
    type PtvPlaybackPresentationSnapshot
} from '../services/playbackPresentationService';
import { incrementPtvPerformanceCounter, recordPtvPerformanceEntry } from '../services/performanceMonitor';

function ticksToPercent(positionTicks = 0, durationTicks = 0) {
    if (!positionTicks || !durationTicks) return 0;

    return Math.max(1, Math.min(100, Math.round((positionTicks / durationTicks) * 100)));
}

function formatPlaybackTicks(ticks = 0) {
    const totalSeconds = Math.max(0, Math.floor(ticks / 10_000_000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getPlaybackKicker(state: PtvGlobalPlaybackState) {
    if (state.source === 'ptv-music') return state.artist || state.album || 'Music';
    if (state.source === 'reading') return 'Reading';
    if (state.seriesName) return state.seriesName;

    return state.itemType || state.mediaType || 'Now Playing';
}

function getPrimaryLabel(state: PtvGlobalPlaybackState) {
    if (state.source === 'ptv-music') return state.paused ? 'Play' : 'Pause';
    if (state.paused) return 'Resume';

    return 'Pause';
}

function stopEvent(event: React.MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
}

function getPlaybackRouteHash() {
    return window.location.hash || '';
}

function isVideoPlaybackPresentation(presentation: PtvPlaybackPresentationSnapshot) {
    return presentation.routeFamily === 'video'
        || presentation.surface === 'player-controls'
        || presentation.surface === 'video-surface'
        || presentation.videoAvailable;
}

function getDeferredPlaybackSession(
    paused: boolean,
    sessionId: string | null,
    retainedVideoHandoffSessionId: string | null
) {
    if (!paused || !sessionId || sessionId === retainedVideoHandoffSessionId) return null;

    return sessionId;
}

function getLastOwnedMusicSession(
    previousSessionId: string | null,
    ownsPlaybackPresentation: boolean,
    sessionId: string | null
) {
    if (ownsPlaybackPresentation && sessionId) return sessionId;

    return previousSessionId;
}

function getQueueLabel(state: PtvGlobalPlaybackState) {
    if (!state.queueLength) return '';

    const trackLabel = state.queueLength === 1 ? 'track' : 'tracks';

    return [state.queueSourceLabel, `${state.queueLength} ${trackLabel}`].filter(Boolean).join(' · ');
}

function getQueueAriaLabel(queueLength = 0) {
    if (!queueLength) return 'Open queue';

    return `Open queue, ${queueLength} tracks`;
}

export function isPtvMusicDockPlayback(
    state: PtvGlobalPlaybackState,
    routeHash = getPlaybackRouteHash()
) {
    if (/^#\/(?:playback|video|livetv|nowplaying)(?:[/?]|$)/i.test(routeHash)) return false;
    if (/^#\/music\/player(?:[/?]|$)/i.test(routeHash)) return false;
    if (
        !state.active
        || !state.itemId
        || !['jellyfin-player', 'ptv-music'].includes(state.source)
    ) {
        return false;
    }

    const mediaType = String(state.mediaType || '').trim().toLowerCase();

    return mediaType === 'audio';
}

type PtvMediaDockViewProps = {
    dockRef: React.RefObject<HTMLElement>;
    handleDetails: React.MouseEventHandler<HTMLButtonElement | HTMLAnchorElement>;
    handleFavorite: React.MouseEventHandler<HTMLButtonElement>;
    handleNext: React.MouseEventHandler<HTMLButtonElement>;
    handlePrevious: React.MouseEventHandler<HTMLButtonElement>;
    handlePrimary: React.MouseEventHandler<HTMLButtonElement>;
    handleQueue: React.MouseEventHandler<HTMLButtonElement>;
    handleStop: React.MouseEventHandler<HTMLButtonElement>;
    kicker: string;
    progressPercent: number;
    queueLabel: string;
    state: PtvGlobalPlaybackState;
    title: string;
};

type PtvMediaDockActionsProps = Pick<
    PtvMediaDockViewProps,
    | 'handleDetails'
    | 'handleFavorite'
    | 'handleNext'
    | 'handlePrevious'
    | 'handlePrimary'
    | 'handleQueue'
    | 'handleStop'
    | 'state'
>;

function PtvMediaDockActions({
    handleDetails,
    handleFavorite,
    handleNext,
    handlePrevious,
    handlePrimary,
    handleQueue,
    handleStop,
    state
}: Readonly<PtvMediaDockActionsProps>) {
    return (
        <div className='ptv-media-dock-actions'>
            {state.source === 'ptv-music' ? (
                <button
                    aria-label={state.isFavorite ? 'Remove from Liked Songs' : 'Like song'}
                    aria-pressed={state.isFavorite}
                    className={state.isFavorite ? 'ptv-media-dock-action-active' : ''}
                    data-ptv-focus-key='mini-player:favorite'
                    type='button'
                    onClick={handleFavorite}
                >
                    <PtvIcon name='favorite' />
                </button>
            ) : null}
            {state.source === 'ptv-music' ? (
                <button
                    aria-label='Previous track'
                    data-ptv-focus-key='mini-player:previous'
                    type='button'
                    onClick={handlePrevious}
                >
                    <PtvIcon name='skipPrevious' />
                </button>
            ) : null}
            <button
                className='ptv-media-dock-primary'
                data-ptv-focus-key='mini-player:primary'
                data-ptv-initial-focus='mini-player-primary'
                type='button'
                onClick={handlePrimary}
            >
                <PtvIcon name={state.paused ? 'playback' : 'pause'} />
                <span>{getPrimaryLabel(state)}</span>
            </button>
            {state.source === 'ptv-music' ? (
                <button
                    aria-label='Next track'
                    data-ptv-focus-key='mini-player:next'
                    type='button'
                    onClick={handleNext}
                >
                    <PtvIcon name='skipNext' />
                </button>
            ) : null}
            {state.source === 'ptv-music' ? (
                <button
                    aria-label={getQueueAriaLabel(state.queueLength)}
                    data-ptv-focus-key='mini-player:queue'
                    type='button'
                    onClick={handleQueue}
                >
                    <PtvIcon name='playlists' />
                </button>
            ) : null}
            <button
                type='button'
                data-ptv-focus-key='mini-player:player'
                onClick={handleDetails}
            >
                {state.source === 'ptv-music' ? 'Player' : 'Details'}
            </button>
            <button
                aria-label='Stop playback'
                data-ptv-focus-key='mini-player:stop'
                type='button'
                onClick={handleStop}
            >
                Stop
            </button>
        </div>
    );
}

function PtvMediaDockView({
    dockRef,
    handleDetails,
    handleFavorite,
    handleNext,
    handlePrevious,
    handlePrimary,
    handleQueue,
    handleStop,
    kicker,
    progressPercent,
    queueLabel,
    state,
    title
}: Readonly<PtvMediaDockViewProps>) {
    return (
        <aside
            ref={dockRef}
            className={`ptv-media-dock ptv-media-dock-${state.source}`}
            aria-label='Current playback'
            data-ptv-dock-item-id={state.itemId}
            data-ptv-dock-route={state.routeHref || ''}
            data-ptv-dock-source={state.source}
            data-ptv-focus-escape-up='page'
            data-ptv-focus-scope='mini-player'
            data-ptv-playback-paused={state.paused ? 'true' : 'false'}
            data-ptv-playback-surface='mini-player'
        >
            <button
                aria-label={`Open ${title}`}
                className='ptv-media-dock-art'
                data-ptv-focus-key='mini-player:art'
                onClick={handleDetails}
                type='button'
            >
                {state.imageUrl ? (
                    <img alt='' decoding='async' loading='lazy' src={state.imageUrl} />
                ) : (
                    <span>{title.slice(0, 1)}</span>
                )}
            </button>
            <div className='ptv-media-dock-copy'>
                <span>{kicker}</span>
                <button
                    type='button'
                    data-ptv-focus-key='mini-player:track'
                    onClick={handleDetails}
                    aria-label={`Open ${title} player`}
                >
                    <strong>{title}</strong>
                    {state.artist && state.artist !== kicker ? <em>{state.artist}</em> : null}
                </button>
                {progressPercent ? (
                    <div
                        className='ptv-media-dock-progress'
                        aria-label={`${progressPercent}% complete`}
                    >
                        <span style={{ width: `${progressPercent}%` }} />
                    </div>
                ) : null}
                {state.durationTicks ? (
                    <span className='ptv-media-dock-time' aria-label={`${formatPlaybackTicks(state.positionTicks)} of ${formatPlaybackTicks(state.durationTicks)}`}>
                        {formatPlaybackTicks(state.positionTicks)} / {formatPlaybackTicks(state.durationTicks)}
                    </span>
                ) : null}
                {queueLabel ? <small>{queueLabel}</small> : null}
            </div>
            <PtvMediaDockActions
                handleDetails={handleDetails}
                handleFavorite={handleFavorite}
                handleNext={handleNext}
                handlePrevious={handlePrevious}
                handlePrimary={handlePrimary}
                handleQueue={handleQueue}
                handleStop={handleStop}
                state={state}
            />
        </aside>
    );
}

export default function PTVMediaDock() {
    const dockRef = useRef<HTMLElement>(null);
    const deferredNewPlaybackSessionRef = useRef<string | null>(null);
    const lastOwnedMusicSessionRef = useRef<string | null>(null);
    const pausedRef = useRef(true);
    const sessionIdRef = useRef<string | null>(null);
    const videoHandoffMusicSessionRef = useRef<string | null>(null);
    const state = useSyncExternalStore(
        subscribeToPtvGlobalPlaybackState,
        getPtvGlobalPlaybackState,
        getPtvGlobalPlaybackState
    );
    const presentation = useSyncExternalStore(
        subscribeToPtvPlaybackPresentation,
        getPtvPlaybackPresentationSnapshot,
        getPtvPlaybackPresentationSnapshot
    );
    const ownsPlaybackPresentation = presentation.surface === 'mini-player'
        && presentation.audioLoaded
        && isPtvMusicDockPlayback(state, '#/presentation/mini');
    const progressPercent = ticksToPercent(state.positionTicks, state.durationTicks);
    const title = state.name || 'Now Playing';
    const kicker = getPlaybackKicker(state);
    const queueLabel = getQueueLabel(state);
    const playbackSessionId = state.sessionId?.trim() || null;
    const videoPlaybackPresentation = isVideoPlaybackPresentation(presentation);

    pausedRef.current = state.paused;
    sessionIdRef.current = playbackSessionId;
    lastOwnedMusicSessionRef.current = getLastOwnedMusicSession(
        lastOwnedMusicSessionRef.current,
        ownsPlaybackPresentation,
        playbackSessionId
    );

    useEffect(() => {
        document.documentElement.classList.toggle('ptv-playback-presentation-owned', ownsPlaybackPresentation);
        document.body.classList.toggle('ptv-playback-presentation-owned', ownsPlaybackPresentation);

        return () => {
            document.documentElement.classList.remove('ptv-playback-presentation-owned');
            document.body.classList.remove('ptv-playback-presentation-owned');
        };
    }, [ownsPlaybackPresentation]);

    useEffect(() => {
        if (!ownsPlaybackPresentation && videoPlaybackPresentation) {
            videoHandoffMusicSessionRef.current = lastOwnedMusicSessionRef.current;
        }
    }, [ownsPlaybackPresentation, videoPlaybackPresentation]);

    useEffect(() => {
        const dock = dockRef.current;

        if (!ownsPlaybackPresentation || !dock) return;

        const sessionId = sessionIdRef.current;

        deferredNewPlaybackSessionRef.current = getDeferredPlaybackSession(
            pausedRef.current,
            sessionId,
            videoHandoffMusicSessionRef.current
        );
        notifyPtvTvPlaybackSurfaceReady(dock, 'mini-player');

        return () => {
            notifyPtvTvPlaybackSurfaceDisposed(dock, 'mini-player');
        };
    }, [ownsPlaybackPresentation]);

    useEffect(() => {
        const dock = dockRef.current;

        if (
            !ownsPlaybackPresentation
            || state.paused
            || !playbackSessionId
            || deferredNewPlaybackSessionRef.current !== playbackSessionId
            || !dock
        ) {
            return;
        }

        deferredNewPlaybackSessionRef.current = null;
        notifyPtvTvPlaybackSurfaceReady(dock, 'mini-player');
    }, [ownsPlaybackPresentation, playbackSessionId, state.paused]);

    useEffect(() => {
        incrementPtvPerformanceCounter('dockRenderCount', {
            activeItemId: state.itemId || null,
            playbackStoreSource: state.source
        });
        incrementPtvPerformanceCounter('playbackRenderCount', {
            activeItemId: state.itemId || null,
            playbackStoreSource: state.source
        });
    }, [state.itemId, state.source]);

    const handlePrimary = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        stopEvent(event);
        void openPtvGlobalPlaybackPrimary(state)
            .catch(error => {
                recordPtvPerformanceEntry('playback', 'global-dock-primary-failed', {
                    activeItemId: state.itemId || null,
                    error: error instanceof Error ? error.message : String(error),
                    playbackStoreSource: state.source
                });
            });
    }, [state]);

    const handleDetails = useCallback((event: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => {
        stopEvent(event);
        openPtvGlobalPlaybackDetails(state);
    }, [state]);

    const handlePrevious = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        stopEvent(event);
        void previousPtvGlobalPlaybackTrack(state);
    }, [state]);

    const handleNext = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        stopEvent(event);
        void nextPtvGlobalPlaybackTrack(state);
    }, [state]);

    const handleStop = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        stopEvent(event);
        void stopPtvGlobalPlayback(state);
    }, [state]);

    const handleQueue = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        stopEvent(event);
        openPtvGlobalPlaybackQueue(state);
    }, [state]);

    const handleFavorite = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        stopEvent(event);
        void togglePtvGlobalPlaybackFavorite(state)
            .catch(error => {
                recordPtvPerformanceEntry('playback', 'global-dock-favorite-failed', {
                    activeItemId: state.itemId || null,
                    error: error instanceof Error ? error.message : String(error),
                    playbackStoreSource: state.source
                });
            });
    }, [state]);

    if (!ownsPlaybackPresentation) return null;

    return (
        <PtvMediaDockView
            dockRef={dockRef}
            handleDetails={handleDetails}
            handleFavorite={handleFavorite}
            handleNext={handleNext}
            handlePrevious={handlePrevious}
            handlePrimary={handlePrimary}
            handleQueue={handleQueue}
            handleStop={handleStop}
            kicker={kicker}
            progressPercent={progressPercent}
            queueLabel={queueLabel}
            state={state}
            title={title}
        />
    );
}
