import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MediaSessionHandler = (details: MediaSessionActionDetails) => unknown;

vi.mock('apps/stable/features/playback/utils/image', () => ({
    getImageUrl: vi.fn(() => '')
}));
vi.mock('apps/stable/features/playback/utils/itemText', () => ({
    getItemTextLines: vi.fn(() => [])
}));
vi.mock('apps/stable/features/playback/utils/playbackSubscriber', () => ({
    PlaybackSubscriber: class {
        protected readonly playbackManager;
        protected player;

        constructor(playbackManager: { getCurrentPlayer: () => unknown }) {
            this.playbackManager = playbackManager;
            this.player = playbackManager.getCurrentPlayer();
        }
    }
}));
vi.mock('scripts/browser', () => ({
    default: {
        iOS: false
    }
}));
vi.mock('scripts/shell', () => ({
    default: {
        hideMediaSession: vi.fn(),
        updateMediaSession: vi.fn()
    }
}));

describe('PiggieTV projection through the existing MediaSession owner', () => {
    const handlers = new Map<MediaSessionAction, MediaSessionHandler | null>();
    const mediaSession = {
        metadata: null as MediaMetadata | null,
        playbackState: 'none' as MediaSessionPlaybackState,
        setActionHandler: vi.fn((action: MediaSessionAction, handler: MediaSessionHandler | null) => {
            handlers.set(action, handler);
        }),
        setPositionState: vi.fn()
    };

    beforeEach(() => {
        vi.resetModules();
        handlers.clear();
        mediaSession.metadata = null;
        mediaSession.playbackState = 'none';
        mediaSession.setActionHandler.mockClear();
        mediaSession.setPositionState.mockClear();
        Object.defineProperty(navigator, 'mediaSession', {
            configurable: true,
            value: mediaSession
        });
        vi.stubGlobal('MediaMetadata', class {
            album?: string;
            artist?: string;
            artwork: MediaImage[];
            title?: string;

            constructor(init: MediaMetadataInit = {}) {
                this.album = init.album;
                this.artist = init.artist;
                this.artwork = init.artwork || [];
                this.title = init.title;
            }
        });
    });

    afterEach(() => {
        Reflect.deleteProperty(navigator, 'mediaSession');
        vi.unstubAllGlobals();
    });

    it('routes external Music controls through the one subscribed handler set, then restores stock controls', async () => {
        const stockPlay = vi.fn();
        const externalPlay = vi.fn();
        const externalSeek = vi.fn();
        const playbackManager = {
            fastForward: vi.fn(),
            getCurrentPlayer: vi.fn(() => undefined),
            pause: vi.fn(),
            previousTrack: vi.fn(),
            nextTrack: vi.fn(),
            rewind: vi.fn(),
            seekMs: vi.fn(),
            stop: vi.fn(),
            unpause: stockPlay
        };
        const {
            bindMediaSessionSubscriber,
            updatePtvExternalMediaSession
        } = await import('./mediaSessionSubscriber');

        bindMediaSessionSubscriber(playbackManager as never);
        expect(mediaSession.setActionHandler).toHaveBeenCalledTimes(8);

        updatePtvExternalMediaSession({
            active: true,
            durationTicks: 120 * 10_000_000,
            name: 'Track',
            paused: true,
            positionTicks: 30 * 10_000_000
        }, {
            next: vi.fn(),
            pause: vi.fn(),
            play: externalPlay,
            previous: vi.fn(),
            seekTo: externalSeek,
            stop: vi.fn()
        });

        handlers.get('play')?.({ action: 'play' });
        handlers.get('seekto')?.({ action: 'seekto', seekTime: 42 });
        expect(externalPlay).toHaveBeenCalledTimes(1);
        expect(externalSeek).toHaveBeenCalledWith(42);
        expect(stockPlay).not.toHaveBeenCalled();
        expect(mediaSession.metadata?.title).toBe('Track');

        updatePtvExternalMediaSession(null);
        handlers.get('play')?.({ action: 'play' });
        expect(stockPlay).toHaveBeenCalledTimes(1);
    });
});
