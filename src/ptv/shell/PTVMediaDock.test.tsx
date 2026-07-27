import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PtvGlobalPlaybackState } from '../services/playbackStateService';

const playbackMocks = vi.hoisted(() => ({
    openDetails: vi.fn(),
    presentation: {
        audioLoaded: true,
        controlsVisible: true,
        paused: false,
        routeFamily: 'other',
        state: 'audio-mini',
        surface: 'mini-player',
        videoAvailable: false
    },
    state: {
        active: true,
        canSeek: true,
        durationTicks: 100,
        itemId: 'music-item',
        lastUpdatedAt: 1,
        name: 'Test track',
        paused: false,
        positionTicks: 50,
        queueLength: 2,
        source: 'ptv-music',
        itemType: 'Audio',
        mediaType: 'Audio'
    } as PtvGlobalPlaybackState
}));

vi.mock('../core/tvFocus', () => ({
    notifyPtvTvPlaybackSurfaceDisposed: vi.fn(),
    notifyPtvTvPlaybackSurfaceReady: vi.fn()
}));

vi.mock('../modules/icons', () => ({
    PtvIcon: ({ name }: { name: string }) => <span data-icon={name} />
}));

vi.mock('../services/playbackStateService', () => ({
    getPtvGlobalPlaybackState: () => playbackMocks.state,
    nextPtvGlobalPlaybackTrack: vi.fn(),
    openPtvGlobalPlaybackDetails: playbackMocks.openDetails,
    openPtvGlobalPlaybackPrimary: vi.fn(async () => undefined),
    previousPtvGlobalPlaybackTrack: vi.fn(),
    stopPtvGlobalPlayback: vi.fn(),
    subscribeToPtvGlobalPlaybackState: () => () => undefined
}));

vi.mock('../services/playbackPresentationService', () => ({
    getPtvPlaybackPresentationSnapshot: () => playbackMocks.presentation,
    subscribeToPtvPlaybackPresentation: () => () => undefined
}));

vi.mock('../services/performanceMonitor', () => ({
    incrementPtvPerformanceCounter: vi.fn(),
    recordPtvPerformanceEntry: vi.fn()
}));

import PTVMediaDock from './PTVMediaDock';

describe('PTV global media dock ownership', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        window.location.hash = '#/music';
        playbackMocks.state = {
            active: true,
            canSeek: true,
            durationTicks: 100,
            itemId: 'music-item',
            itemType: 'Audio',
            lastUpdatedAt: 1,
            mediaType: 'Audio',
            name: 'Test track',
            paused: false,
            positionTicks: 50,
            queueLength: 2,
            source: 'ptv-music'
        };
        playbackMocks.presentation = {
            audioLoaded: true,
            controlsVisible: true,
            paused: false,
            routeFamily: 'other',
            state: 'audio-mini',
            surface: 'mini-player',
            videoAvailable: false
        };
        playbackMocks.openDetails.mockReset();
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        flushSync(() => root.unmount());
        container.remove();
        document.documentElement.classList.remove('ptv-playback-presentation-owned');
        document.body.classList.remove('ptv-playback-presentation-owned');
    });

    function renderDock() {
        flushSync(() => root.render(<PTVMediaDock />));
    }

    it('renders exactly one compact dock for PTV-owned audio playback', () => {
        renderDock();

        expect(container.querySelectorAll('.ptv-media-dock')).toHaveLength(1);
        expect(document.querySelector('.ptv-music-mini-player')).toBeNull();
        expect(document.documentElement.classList.contains('ptv-playback-presentation-owned')).toBe(true);
        expect(document.body.classList.contains('ptv-playback-presentation-owned')).toBe(true);

        flushSync(() => root.unmount());
        expect(document.documentElement.classList.contains('ptv-playback-presentation-owned')).toBe(false);
        expect(document.body.classList.contains('ptv-playback-presentation-owned')).toBe(false);
        root = createRoot(container);
    });

    it('keeps paused queue audio reachable when the Jellyfin item type is album-shaped', () => {
        playbackMocks.state = {
            ...playbackMocks.state,
            itemType: 'MusicAlbum',
            mediaType: 'Audio',
            paused: true
        };
        playbackMocks.presentation = {
            ...playbackMocks.presentation,
            paused: true
        };

        renderDock();

        expect(container.querySelectorAll('.ptv-media-dock')).toHaveLength(1);
        expect(container.querySelector('[data-ptv-focus-key="mini-player:primary"]')).not.toBeNull();
    });

    it.each([
        ['Movie', 'Video'],
        ['Episode', 'Video'],
        ['Series', 'Video'],
        ['Trailer', 'Video']
    ])('does not render for %s playback', (itemType, mediaType) => {
        playbackMocks.state = {
            ...playbackMocks.state,
            itemId: `video-${itemType}`,
            itemType,
            mediaType,
            source: 'jellyfin-player'
        };
        playbackMocks.presentation = {
            ...playbackMocks.presentation,
            audioLoaded: false,
            state: 'video-playing-controls-hidden',
            surface: 'video-surface',
            videoAvailable: true
        };

        renderDock();

        expect(container.querySelector('.ptv-media-dock')).toBeNull();
        expect(document.documentElement.classList.contains('ptv-playback-presentation-owned')).toBe(false);
    });

    it('hides immediately on a video route even before the music snapshot retires', () => {
        renderDock();
        expect(container.querySelector('.ptv-media-dock')).not.toBeNull();

        window.location.hash = '#/video';
        playbackMocks.presentation = {
            ...playbackMocks.presentation,
            state: 'video-playing-controls-hidden',
            surface: 'video-surface'
        };
        renderDock();

        expect(container.querySelector('.ptv-media-dock')).toBeNull();
        expect(document.body.classList.contains('ptv-playback-presentation-owned')).toBe(false);
    });

    it('hides the compact dock while the authoritative full-screen Music player owns the route', () => {
        window.location.hash = '#/music/player';
        playbackMocks.presentation = {
            ...playbackMocks.presentation,
            routeFamily: 'music-fullscreen',
            state: 'audio-fullscreen',
            surface: 'full-screen-player'
        };
        renderDock();

        expect(container.querySelector('.ptv-media-dock')).toBeNull();
        expect(document.body.classList.contains('ptv-playback-presentation-owned')).toBe(false);
    });

    it('keeps the mini-player during the full-screen mount transition', () => {
        window.location.hash = '#/music/player';
        playbackMocks.presentation = {
            ...playbackMocks.presentation,
            routeFamily: 'music-fullscreen',
            state: 'transitioning',
            surface: 'mini-player'
        };
        renderDock();

        expect(container.querySelectorAll('.ptv-media-dock')).toHaveLength(1);
    });

    it('opens the existing full-screen player action exactly once', () => {
        renderDock();
        const playerButton = container.querySelector<HTMLElement>('[data-ptv-focus-key="mini-player:player"]');

        playerButton?.click();

        expect(playbackMocks.openDetails).toHaveBeenCalledTimes(1);
    });

    it('restores the Music dock after video playback hands back to PTV audio', () => {
        window.location.hash = '#/video';
        playbackMocks.state = {
            ...playbackMocks.state,
            itemId: 'episode-item',
            itemType: 'Episode',
            mediaType: 'Video',
            source: 'jellyfin-player'
        };
        playbackMocks.presentation = {
            ...playbackMocks.presentation,
            audioLoaded: false,
            state: 'video-playing-controls-hidden',
            surface: 'video-surface'
        };
        renderDock();
        expect(container.querySelector('.ptv-media-dock')).toBeNull();

        window.location.hash = '#/music';
        playbackMocks.state = {
            ...playbackMocks.state,
            itemId: 'music-item',
            itemType: 'Audio',
            mediaType: 'Audio',
            paused: true,
            source: 'ptv-music'
        };
        playbackMocks.presentation = {
            ...playbackMocks.presentation,
            audioLoaded: true,
            paused: true,
            routeFamily: 'other',
            state: 'audio-mini',
            surface: 'mini-player',
            videoAvailable: false
        };
        renderDock();

        expect(container.querySelectorAll('.ptv-media-dock')).toHaveLength(1);
        expect(playbackMocks.state.paused).toBe(true);
        expect(document.documentElement.classList.contains('ptv-playback-presentation-owned')).toBe(true);
    });
});
