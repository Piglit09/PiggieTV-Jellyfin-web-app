import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../scripts/settings/appSettings', () => ({
    default: { get: vi.fn(), set: vi.fn() }
}));
vi.mock('../scripts/browser', () => ({ default: {} }));

import {
    bindEventsToHlsPlayer,
    handleHlsJsMediaError
} from './htmlMediaHelper';

class FakeHls {
    destroy = vi.fn();
    recoverMediaError = vi.fn();
    startLoad = vi.fn();
    swapAudioCodec = vi.fn();
    listeners = new Map();

    on(event, listener) {
        this.listeners.set(event, listener);
    }

    emit(event, data = {}) {
        this.listeners.get(event)?.(event, data);
    }
}

describe('shared HLS event ownership', () => {
    beforeEach(() => {
        globalThis.Hls = {
            ErrorTypes: Object.fromEntries([
                [ 'MEDIA_ERROR', 'media-error' ],
                [ 'NETWORK_ERROR', 'network-error' ]
            ]),
            Events: Object.fromEntries([
                [ 'ERROR', 'error' ],
                [ 'MANIFEST_PARSED', 'manifest-parsed' ]
            ])
        };
    });

    it('leaves nonfatal fragment and manifest retries to hls.js', () => {
        const hls = new FakeHls();
        const recover = vi.fn();
        const instance = {
            _hlsPlayer: hls,
            _ptvPlaybackSession: { recoverFromFatalNetwork: recover }
        };

        bindEventsToHlsPlayer(
            instance,
            hls,
            document.createElement('video'),
            vi.fn(),
            vi.fn(),
            vi.fn(),
            { isCurrentSource: () => true }
        );
        hls.emit('error', {
            fatal: false,
            response: { code: 504 },
            type: 'network-error'
        });

        expect(recover).not.toHaveBeenCalled();
        expect(hls.startLoad).not.toHaveBeenCalled();
        expect(hls.destroy).not.toHaveBeenCalled();
    });

    it('delegates fatal recovery exactly once to the active source session', () => {
        const hls = new FakeHls();
        const recover = vi.fn(() => true);
        const reject = vi.fn();
        const instance = {
            _hlsPlayer: hls,
            _ptvPlaybackSession: { recoverFromFatalNetwork: recover }
        };

        bindEventsToHlsPlayer(
            instance,
            hls,
            document.createElement('video'),
            vi.fn(),
            vi.fn(),
            reject,
            { isCurrentSource: () => true }
        );
        const errorData = {
            fatal: true,
            response: { code: 504 },
            type: 'network-error'
        };

        hls.emit('error', errorData);

        expect(recover).toHaveBeenCalledExactlyOnceWith(hls, 504, errorData);
        expect(hls.startLoad).not.toHaveBeenCalled();
        expect(hls.destroy).not.toHaveBeenCalled();
        expect(reject).not.toHaveBeenCalled();
    });

    it('ignores callbacks from a retired source generation', () => {
        const hls = new FakeHls();
        const media = document.createElement('video');

        media.play = vi.fn(() => Promise.resolve());
        const resolve = vi.fn();

        bindEventsToHlsPlayer(
            { _hlsPlayer: hls },
            hls,
            media,
            vi.fn(),
            resolve,
            vi.fn(),
            { isCurrentSource: () => false }
        );
        hls.emit('manifest-parsed');

        expect(media.play).not.toHaveBeenCalled();
        expect(resolve).not.toHaveBeenCalled();
    });

    it('settles a retired startup promise through its cancellation hook', () => {
        const hls = new FakeHls();
        const resolve = vi.fn();
        const cancel = bindEventsToHlsPlayer(
            { _hlsPlayer: hls },
            hls,
            document.createElement('video'),
            vi.fn(),
            resolve,
            vi.fn(),
            { isCurrentSource: () => true }
        );

        cancel();
        cancel();

        expect(resolve).toHaveBeenCalledTimes(1);
    });

    it('uses per-source media recovery instead of module-global retry timestamps', () => {
        const hls = new FakeHls();
        const recover = vi.fn(() => true);
        const instance = {
            _hlsPlayer: hls,
            _ptvPlaybackSession: { recoverFromMediaError: recover }
        };

        expect(handleHlsJsMediaError(instance)).toBe(true);
        expect(recover).toHaveBeenCalledExactlyOnceWith(hls);
        expect(hls.recoverMediaError).not.toHaveBeenCalled();
    });

    it('tears down the owned HLS instance when media recovery is exhausted', () => {
        const hls = new FakeHls();
        const reject = vi.fn();
        const markFailed = vi.fn();
        const instance = {
            _hlsPlayer: hls,
            _ptvPlaybackSession: {
                markFailed,
                recoverFromMediaError: vi.fn(() => false)
            }
        };

        expect(handleHlsJsMediaError(instance, reject)).toBe(false);
        expect(markFailed).toHaveBeenCalledExactlyOnceWith('media-recovery-exhausted');
        expect(hls.destroy).toHaveBeenCalledTimes(1);
        expect(instance._hlsPlayer).toBeNull();
        expect(reject).toHaveBeenCalledTimes(1);
    });
});
