import React, { useCallback, useEffect, useSyncExternalStore } from 'react';

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

export default function PTVMediaDock() {
    const state = useSyncExternalStore(
        subscribeToPtvGlobalPlaybackState,
        getPtvGlobalPlaybackState,
        getPtvGlobalPlaybackState
    );
    const progressPercent = ticksToPercent(state.positionTicks, state.durationTicks);
    const title = state.name || 'Now Playing';
    const kicker = getPlaybackKicker(state);
    const queueLabel = state.queueLength && state.queueLength > 1 ? `${state.queueLength} in queue` : '';

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

    if (!state.active || !state.itemId) return null;

    return (
        <aside
            className={`ptv-media-dock ptv-media-dock-${state.source}`}
            aria-label='Current playback'
            data-ptv-dock-item-id={state.itemId}
            data-ptv-dock-route={state.routeHref || ''}
            data-ptv-dock-source={state.source}
        >
            <button
                aria-label={`Open ${title}`}
                className='ptv-media-dock-art'
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
                <button type='button' onClick={handleDetails} aria-label={`Open ${title} player`}>
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
                    <button aria-label='Previous track' type='button' onClick={handlePrevious}>
                        <PtvIcon name='skipPrevious' />
                    </button>
                ) : null}
                <button className='ptv-media-dock-primary' type='button' onClick={handlePrimary}>
                    <PtvIcon name={state.paused ? 'playback' : 'pause'} />
                    <span>{getPrimaryLabel(state)}</span>
                </button>
                {state.source === 'ptv-music' ? (
                    <button aria-label='Next track' type='button' onClick={handleNext}>
                        <PtvIcon name='skipNext' />
                    </button>
                ) : null}
                <button type='button' onClick={handleDetails}>
                    {state.source === 'ptv-music' ? 'Player' : 'Details'}
                </button>
                <button aria-label='Stop playback' type='button' onClick={handleStop}>
                    Stop
                </button>
            </div>
        </aside>
    );
}
