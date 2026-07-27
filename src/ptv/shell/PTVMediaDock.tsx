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
    previousPtvGlobalPlaybackTrack,
    stopPtvGlobalPlayback,
    subscribeToPtvGlobalPlaybackState,
    type PtvGlobalPlaybackState
} from '../services/playbackStateService';
import {
    getPtvPlaybackPresentationSnapshot,
    subscribeToPtvPlaybackPresentation
} from '../services/playbackPresentationService';
import { incrementPtvPerformanceCounter, recordPtvPerformanceEntry } from '../services/performanceMonitor';

function ticksToPercent(positionTicks = 0, durationTicks = 0) {
    if (!positionTicks || !durationTicks) return 0;

    return Math.max(1, Math.min(100, Math.round((positionTicks / durationTicks) * 100)));
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

export function isPtvMusicDockPlayback(
    state: PtvGlobalPlaybackState,
    routeHash = getPlaybackRouteHash()
) {
    if (/^#\/(?:playback|video|livetv|nowplaying)(?:[/?]|$)/i.test(routeHash)) return false;
    if (/^#\/music\/player(?:[/?]|$)/i.test(routeHash)) return false;
    if (!state.active || !state.itemId || state.source !== 'ptv-music') return false;

    const mediaType = String(state.mediaType || '').trim().toLowerCase();

    return mediaType === 'audio';
}

export default function PTVMediaDock() {
    const dockRef = useRef<HTMLElement>(null);
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
    const queueLabel = state.queueLength && state.queueLength > 1 ? `${state.queueLength} in queue` : '';

    useEffect(() => {
        document.documentElement.classList.toggle('ptv-playback-presentation-owned', ownsPlaybackPresentation);
        document.body.classList.toggle('ptv-playback-presentation-owned', ownsPlaybackPresentation);

        return () => {
            document.documentElement.classList.remove('ptv-playback-presentation-owned');
            document.body.classList.remove('ptv-playback-presentation-owned');
        };
    }, [ownsPlaybackPresentation]);

    useEffect(() => {
        const dock = dockRef.current;

        if (!ownsPlaybackPresentation || !dock) return;

        notifyPtvTvPlaybackSurfaceReady(dock, 'mini-player');

        return () => {
            notifyPtvTvPlaybackSurfaceDisposed(dock, 'mini-player');
        };
    }, [ownsPlaybackPresentation]);

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

    if (!ownsPlaybackPresentation) return null;

    return (
        <aside
            ref={dockRef}
            className={`ptv-media-dock ptv-media-dock-${state.source}`}
            aria-label='Current playback'
            data-ptv-dock-item-id={state.itemId}
            data-ptv-dock-route={state.routeHref || ''}
            data-ptv-dock-source={state.source}
            data-ptv-focus-scope='mini-player'
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
                {queueLabel ? <small>{queueLabel}</small> : null}
            </div>
            <div className='ptv-media-dock-actions'>
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
        </aside>
    );
}
