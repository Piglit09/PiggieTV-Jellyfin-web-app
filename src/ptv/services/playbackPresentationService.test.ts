import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PtvGlobalPlaybackState } from './playbackStateService';

const presentationMocks = vi.hoisted(() => ({
    listener: null as ((state: PtvGlobalPlaybackState) => void) | null,
    state: null as PtvGlobalPlaybackState | null,
    subscribe: vi.fn(),
    unsubscribe: vi.fn()
}));

vi.mock('../core/observability', () => ({
    recordPtvEvent: vi.fn()
}));

vi.mock('./playbackStateService', () => ({
    getPtvGlobalPlaybackState: () => presentationMocks.state,
    subscribeToPtvGlobalPlaybackState: presentationMocks.subscribe
}));

import {
    derivePtvPlaybackPresentation,
    disposePtvPlaybackPresentationServiceForTests,
    getPtvPlaybackPresentationSnapshot,
    setPtvFullScreenMusicPresentationAvailable,
    setPtvVideoPlaybackPresentation,
    startPtvPlaybackPresentationService
} from './playbackPresentationService';

function playbackState(
    overrides: Partial<PtvGlobalPlaybackState> = {}
): PtvGlobalPlaybackState {
    return {
        active: false,
        canSeek: false,
        lastUpdatedAt: 1,
        paused: true,
        source: 'none',
        ...overrides
    };
}

function musicState(paused = false) {
    return playbackState({
        active: true,
        itemId: 'private-track-id',
        itemType: 'Audio',
        mediaType: 'Audio',
        paused,
        source: 'ptv-music'
    });
}

function videoState(paused = false) {
    return playbackState({
        active: true,
        itemId: 'private-video-id',
        itemType: 'Movie',
        mediaType: 'Video',
        paused,
        source: 'jellyfin-player'
    });
}

describe('playback presentation ownership', () => {
    beforeEach(() => {
        window.location.hash = '#/home';
        presentationMocks.state = playbackState();
        presentationMocks.listener = null;
        presentationMocks.subscribe.mockReset();
        presentationMocks.unsubscribe.mockReset();
        presentationMocks.subscribe.mockImplementation((listener: (state: PtvGlobalPlaybackState) => void) => {
            presentationMocks.listener = listener;
            listener(presentationMocks.state as PtvGlobalPlaybackState);
            return presentationMocks.unsubscribe;
        });
    });

    afterEach(() => {
        disposePtvPlaybackPresentationServiceForTests();
    });

    it('guarantees a mini-player for playing or paused loaded audio on normal routes', () => {
        expect(derivePtvPlaybackPresentation(musicState(false), {
            routeHash: '#/home'
        })).toMatchObject({
            audioLoaded: true,
            state: 'audio-mini',
            surface: 'mini-player'
        });
        expect(derivePtvPlaybackPresentation(musicState(true), {
            routeHash: '#/settings'
        })).toMatchObject({
            audioLoaded: true,
            paused: true,
            state: 'audio-mini',
            surface: 'mini-player'
        });
    });

    it.each([
        '#/home',
        '#/music',
        '#/music/artists',
        '#/music/albums',
        '#/music/songs',
        '#/music/playlists',
        '#/search',
        '#/mypreferencesmenu'
    ])('keeps one mini-player invariant on %s', routeHash => {
        expect(derivePtvPlaybackPresentation(musicState(), {
            routeHash
        })).toMatchObject({
            state: 'audio-mini',
            surface: 'mini-player'
        });
    });

    it('keeps the mini-player during full-screen mount transition and then makes the surfaces exclusive', () => {
        expect(derivePtvPlaybackPresentation(musicState(), {
            fullScreenMusicAvailable: false,
            routeHash: '#/music/player'
        })).toMatchObject({
            state: 'transitioning',
            surface: 'mini-player'
        });
        expect(derivePtvPlaybackPresentation(musicState(), {
            fullScreenMusicAvailable: true,
            routeHash: '#/music/player'
        })).toMatchObject({
            state: 'audio-fullscreen',
            surface: 'full-screen-player'
        });
        expect(derivePtvPlaybackPresentation(musicState(), {
            fullScreenMusicAvailable: true,
            routeHash: '#/home'
        })).toMatchObject({
            state: 'transitioning',
            surface: 'full-screen-player'
        });
        expect(derivePtvPlaybackPresentation(musicState(), {
            fullScreenMusicAvailable: false,
            routeHash: '#/home'
        })).toMatchObject({
            state: 'audio-mini',
            surface: 'mini-player'
        });
    });

    it('does not force full-screen presentation on track changes', () => {
        const first = derivePtvPlaybackPresentation(musicState(), {
            routeHash: '#/music'
        });
        const second = derivePtvPlaybackPresentation({
            ...musicState(),
            itemId: 'another-private-track-id'
        }, {
            routeHash: '#/music'
        });

        expect(first.state).toBe('audio-mini');
        expect(second.state).toBe('audio-mini');
    });

    it('derives all video control states from engine and UI state', () => {
        expect(derivePtvPlaybackPresentation(videoState(false), {
            routeHash: '#/video',
            videoAvailable: true,
            videoControlsVisible: false
        }).state).toBe('video-playing-controls-hidden');
        expect(derivePtvPlaybackPresentation(videoState(false), {
            routeHash: '#/video',
            videoAvailable: true,
            videoControlsVisible: true
        }).state).toBe('video-playing-controls-visible');
        expect(derivePtvPlaybackPresentation(videoState(true), {
            routeHash: '#/video',
            videoAvailable: true,
            videoControlsVisible: false
        })).toMatchObject({
            controlsVisible: true,
            state: 'video-paused-controls-visible',
            surface: 'player-controls'
        });
        expect(derivePtvPlaybackPresentation(playbackState(), {
            routeHash: '#/video',
            videoAvailable: false
        }).state).toBe('unavailable');
    });

    it('installs one subscription and one route-listener pair across repeated starts', () => {
        const addEventListener = vi.spyOn(window, 'addEventListener');

        startPtvPlaybackPresentationService();
        startPtvPlaybackPresentationService();

        expect(presentationMocks.subscribe).toHaveBeenCalledTimes(1);
        expect(addEventListener.mock.calls.filter(([name]) => name === 'hashchange')).toHaveLength(1);
        expect(addEventListener.mock.calls.filter(([name]) => name === 'popstate')).toHaveLength(1);

        setPtvVideoPlaybackPresentation({
            available: true,
            controlsVisible: true,
            paused: false
        });
        setPtvFullScreenMusicPresentationAvailable(true);

        disposePtvPlaybackPresentationServiceForTests();
        expect(presentationMocks.unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('publishes the initial idle state to the document even when the derived snapshot is unchanged', () => {
        startPtvPlaybackPresentationService();

        expect(document.documentElement.dataset.ptvPlaybackPresentation).toBe('idle');
        expect(document.documentElement.dataset.ptvPlaybackSurface).toBe('none');
    });

    it('publishes route and UI transitions without exposing media identity in the snapshot', () => {
        presentationMocks.state = musicState();
        startPtvPlaybackPresentationService();

        expect(getPtvPlaybackPresentationSnapshot()).toMatchObject({
            state: 'audio-mini',
            surface: 'mini-player'
        });
        expect(JSON.stringify(getPtvPlaybackPresentationSnapshot())).not.toContain('private-track-id');

        window.location.hash = '#/music/player';
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        expect(getPtvPlaybackPresentationSnapshot()).toMatchObject({
            state: 'transitioning',
            surface: 'mini-player'
        });

        setPtvFullScreenMusicPresentationAvailable(true);
        expect(getPtvPlaybackPresentationSnapshot()).toMatchObject({
            state: 'audio-fullscreen',
            surface: 'full-screen-player'
        });

        presentationMocks.state = playbackState();
        presentationMocks.listener?.(presentationMocks.state);
        expect(getPtvPlaybackPresentationSnapshot()).toMatchObject({
            state: 'idle',
            surface: 'none'
        });
    });
});
