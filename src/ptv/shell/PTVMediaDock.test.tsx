import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PtvGlobalPlaybackState } from '../services/playbackStateService';

const playbackMocks = vi.hoisted(() => ({
    favorite: vi.fn(async () => undefined),
    openDetails: vi.fn(),
    openQueue: vi.fn(),
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
        sessionId: 'music-session',
        source: 'ptv-music',
        itemType: 'Audio',
        mediaType: 'Audio'
    } as PtvGlobalPlaybackState
}));

const focusMocks = vi.hoisted(() => ({
    disposed: vi.fn(),
    ready: vi.fn()
}));

vi.mock('../core/tvFocus', () => ({
    notifyPtvTvPlaybackSurfaceDisposed: focusMocks.disposed,
    notifyPtvTvPlaybackSurfaceReady: focusMocks.ready
}));

vi.mock('../modules/icons', () => ({
    PtvIcon: ({ name }: { name: string }) => <span data-icon={name} />
}));

vi.mock('../services/playbackStateService', () => ({
    getPtvGlobalPlaybackState: () => playbackMocks.state,
    nextPtvGlobalPlaybackTrack: vi.fn(),
    openPtvGlobalPlaybackDetails: playbackMocks.openDetails,
    openPtvGlobalPlaybackPrimary: vi.fn(async () => undefined),
    openPtvGlobalPlaybackQueue: playbackMocks.openQueue,
    previousPtvGlobalPlaybackTrack: vi.fn(),
    stopPtvGlobalPlayback: vi.fn(),
    subscribeToPtvGlobalPlaybackState: () => () => undefined,
    togglePtvGlobalPlaybackFavorite: playbackMocks.favorite
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
            sessionId: 'music-session',
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
        playbackMocks.openQueue.mockReset();
        playbackMocks.favorite.mockReset();
        focusMocks.disposed.mockReset();
        focusMocks.ready.mockReset();
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

        const dock = container.querySelector('.ptv-media-dock');

        expect(container.querySelectorAll('.ptv-media-dock')).toHaveLength(1);
        expect(dock?.getAttribute('data-ptv-focus-escape-up')).toBe('page');
        expect(dock?.getAttribute('data-ptv-playback-paused')).toBe('false');
        expect(document.querySelector('.ptv-music-mini-player')).toBeNull();
        expect(document.documentElement.classList.contains('ptv-playback-presentation-owned')).toBe(true);
        expect(document.body.classList.contains('ptv-playback-presentation-owned')).toBe(true);
        expect(focusMocks.ready).toHaveBeenCalledTimes(1);

        flushSync(() => root.unmount());
        expect(document.documentElement.classList.contains('ptv-playback-presentation-owned')).toBe(false);
        expect(document.body.classList.contains('ptv-playback-presentation-owned')).toBe(false);
        root = createRoot(container);
    });

    it('renders one compact dock for Jellyfin-managed audio playback', () => {
        playbackMocks.state = {
            ...playbackMocks.state,
            sessionId: 'jellyfin-audio-session',
            source: 'jellyfin-player'
        };

        renderDock();

        const dock = container.querySelector('.ptv-media-dock');

        expect(container.querySelectorAll('.ptv-media-dock')).toHaveLength(1);
        expect(dock?.getAttribute('data-ptv-dock-source')).toBe('jellyfin-player');
        expect(container.querySelector('[data-ptv-focus-key="mini-player:primary"]')).not.toBeNull();
        expect(container.querySelector('[data-ptv-focus-key="mini-player:queue"]')).toBeNull();
        expect(container.querySelector('[data-ptv-focus-key="mini-player:favorite"]')).toBeNull();
        expect(document.documentElement.classList.contains('ptv-playback-presentation-owned')).toBe(true);
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
        expect(container.querySelector('.ptv-media-dock')?.getAttribute('data-ptv-playback-paused')).toBe('true');
        expect(container.querySelector('[data-ptv-focus-key="mini-player:primary"]')).not.toBeNull();
    });

    it('completes mini-player autofocus when a new track advances from queued to playing', () => {
        playbackMocks.state = {
            ...playbackMocks.state,
            active: false,
            itemId: undefined,
            paused: true,
            sessionId: undefined,
            source: 'none'
        };
        playbackMocks.presentation = {
            ...playbackMocks.presentation,
            audioLoaded: false,
            paused: true,
            state: 'idle',
            surface: 'none'
        };
        renderDock();
        expect(focusMocks.ready).not.toHaveBeenCalled();

        playbackMocks.state = {
            ...playbackMocks.state,
            active: true,
            itemId: 'new-track',
            mediaType: 'Audio',
            paused: true,
            sessionId: 'new-session',
            source: 'ptv-music'
        };
        playbackMocks.presentation = {
            ...playbackMocks.presentation,
            audioLoaded: true,
            paused: true,
            state: 'audio-mini',
            surface: 'mini-player'
        };
        renderDock();
        expect(focusMocks.ready).toHaveBeenCalledTimes(1);
        expect(container.querySelector('.ptv-media-dock')?.getAttribute('data-ptv-playback-paused')).toBe('true');

        playbackMocks.state = {
            ...playbackMocks.state,
            paused: false
        };
        playbackMocks.presentation = {
            ...playbackMocks.presentation,
            paused: false
        };
        renderDock();

        expect(focusMocks.ready).toHaveBeenCalledTimes(2);
        expect(container.querySelector('.ptv-media-dock')?.getAttribute('data-ptv-playback-paused')).toBe('false');
    });

    it('does not carry video suppression into a later first Music session', () => {
        window.location.hash = '#/video';
        playbackMocks.state = {
            ...playbackMocks.state,
            itemId: 'episode-item',
            itemType: 'Episode',
            mediaType: 'Video',
            sessionId: 'video-session',
            source: 'jellyfin-player'
        };
        playbackMocks.presentation = {
            ...playbackMocks.presentation,
            audioLoaded: false,
            routeFamily: 'video',
            state: 'video-playing-controls-hidden',
            surface: 'video-surface',
            videoAvailable: true
        };
        renderDock();
        expect(focusMocks.ready).not.toHaveBeenCalled();

        window.location.hash = '#/home';
        playbackMocks.state = {
            ...playbackMocks.state,
            active: false,
            itemId: undefined,
            paused: true,
            sessionId: undefined,
            source: 'none'
        };
        playbackMocks.presentation = {
            ...playbackMocks.presentation,
            audioLoaded: false,
            routeFamily: 'other',
            state: 'idle',
            surface: 'none',
            videoAvailable: false
        };
        renderDock();

        playbackMocks.state = {
            ...playbackMocks.state,
            active: true,
            itemId: 'new-track',
            itemType: 'Audio',
            mediaType: 'Audio',
            paused: true,
            sessionId: 'new-session',
            source: 'ptv-music'
        };
        playbackMocks.presentation = {
            ...playbackMocks.presentation,
            audioLoaded: true,
            paused: true,
            state: 'audio-mini',
            surface: 'mini-player'
        };
        renderDock();
        expect(focusMocks.ready).toHaveBeenCalledTimes(1);

        playbackMocks.state = {
            ...playbackMocks.state,
            paused: false
        };
        playbackMocks.presentation = {
            ...playbackMocks.presentation,
            paused: false
        };
        renderDock();

        expect(focusMocks.ready).toHaveBeenCalledTimes(2);
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

    it('projects queue, elapsed time, and like actions from the existing playback state', () => {
        playbackMocks.state = {
            ...playbackMocks.state,
            durationTicks: 120 * 10_000_000,
            isFavorite: true,
            positionTicks: 30 * 10_000_000,
            queueLength: 4,
            queueSourceLabel: 'Artist Mix'
        };

        renderDock();

        const queueButton = container.querySelector<HTMLButtonElement>('[data-ptv-focus-key="mini-player:queue"]');
        const favoriteButton = container.querySelector<HTMLButtonElement>('[data-ptv-focus-key="mini-player:favorite"]');

        expect(container.textContent).toContain('0:30 / 2:00');
        expect(container.textContent).toContain('Artist Mix · 4 tracks');
        expect(favoriteButton?.getAttribute('aria-pressed')).toBe('true');

        queueButton?.click();
        favoriteButton?.click();

        expect(playbackMocks.openQueue).toHaveBeenCalledTimes(1);
        expect(playbackMocks.favorite).toHaveBeenCalledTimes(1);
    });

    it('restores the Music dock after video playback hands back to PTV audio', () => {
        playbackMocks.state = {
            ...playbackMocks.state,
            sessionId: 'retained-music-session'
        };
        renderDock();
        expect(focusMocks.ready).toHaveBeenCalledTimes(1);

        window.location.hash = '#/video';
        playbackMocks.state = {
            ...playbackMocks.state,
            itemId: 'episode-item',
            itemType: 'Episode',
            mediaType: 'Video',
            sessionId: 'video-session',
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
            sessionId: 'retained-music-session',
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
        expect(container.querySelector('.ptv-media-dock')?.getAttribute('data-ptv-playback-paused')).toBe('true');
        expect(playbackMocks.state.paused).toBe(true);
        expect(document.documentElement.classList.contains('ptv-playback-presentation-owned')).toBe(true);

        const readyCountAfterPausedHandoff = focusMocks.ready.mock.calls.length;

        playbackMocks.state = {
            ...playbackMocks.state,
            paused: false
        };
        playbackMocks.presentation = {
            ...playbackMocks.presentation,
            paused: false
        };
        renderDock();

        expect(focusMocks.ready).toHaveBeenCalledTimes(readyCountAfterPausedHandoff);
    });

    it('autofocuses a new Music session after video instead of treating it as retained', () => {
        playbackMocks.state = {
            ...playbackMocks.state,
            sessionId: 'old-music-session'
        };
        renderDock();

        playbackMocks.state = {
            ...playbackMocks.state,
            itemId: 'episode-item',
            itemType: 'Episode',
            mediaType: 'Video',
            sessionId: 'video-session',
            source: 'jellyfin-player'
        };
        playbackMocks.presentation = {
            ...playbackMocks.presentation,
            audioLoaded: false,
            routeFamily: 'video',
            state: 'video-playing-controls-hidden',
            surface: 'video-surface',
            videoAvailable: true
        };
        renderDock();

        playbackMocks.state = {
            ...playbackMocks.state,
            itemId: 'new-track',
            itemType: 'Audio',
            mediaType: 'Audio',
            paused: true,
            sessionId: 'new-music-session',
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
        const readyCountWhileQueued = focusMocks.ready.mock.calls.length;

        playbackMocks.state = {
            ...playbackMocks.state,
            paused: false
        };
        playbackMocks.presentation = {
            ...playbackMocks.presentation,
            paused: false
        };
        renderDock();

        expect(focusMocks.ready).toHaveBeenCalledTimes(readyCountWhileQueued + 1);
    });

    it('keeps repeated same-session handoff mounts passive', () => {
        playbackMocks.state = {
            ...playbackMocks.state,
            sessionId: 'retained-music-session'
        };
        renderDock();

        playbackMocks.state = {
            ...playbackMocks.state,
            itemId: 'episode-item',
            itemType: 'Episode',
            mediaType: 'Video',
            sessionId: 'video-session',
            source: 'jellyfin-player'
        };
        playbackMocks.presentation = {
            ...playbackMocks.presentation,
            audioLoaded: false,
            routeFamily: 'video',
            state: 'video-playing-controls-hidden',
            surface: 'video-surface',
            videoAvailable: true
        };
        renderDock();

        playbackMocks.state = {
            ...playbackMocks.state,
            itemId: 'music-item',
            itemType: 'Audio',
            mediaType: 'Audio',
            paused: true,
            sessionId: 'retained-music-session',
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

        playbackMocks.presentation = {
            ...playbackMocks.presentation,
            audioLoaded: false,
            routeFamily: 'music-fullscreen',
            state: 'transitioning',
            surface: 'full-screen-player'
        };
        renderDock();
        playbackMocks.presentation = {
            ...playbackMocks.presentation,
            audioLoaded: true,
            paused: true,
            routeFamily: 'other',
            state: 'audio-mini',
            surface: 'mini-player'
        };
        renderDock();
        const readyCountAfterRemount = focusMocks.ready.mock.calls.length;

        playbackMocks.state = {
            ...playbackMocks.state,
            paused: false
        };
        playbackMocks.presentation = {
            ...playbackMocks.presentation,
            paused: false
        };
        renderDock();

        expect(focusMocks.ready).toHaveBeenCalledTimes(readyCountAfterRemount);
    });
});
