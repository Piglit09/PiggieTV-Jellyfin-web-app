import { describe, expect, it, vi } from 'vitest';

import {
    executePtvVideoSeekAction,
    executePtvVideoSeekKey,
    getPtvVideoSeekAction,
    isPtvVideoPlayerControlFocused,
    registerPtvVideoControlsVisibilityHandler,
    requestPtvVideoControlsVisibility,
    shouldYieldVideoKeyToPtvFocusOwner
} from './videoInputOwnership';

describe('video input ownership', () => {
    it.each([
        ['ArrowLeft', 'seek-back'],
        ['Left', 'seek-back'],
        ['ArrowRight', 'seek-forward'],
        ['Right', 'seek-forward']
    ])('maps %s to the existing seek action %s', (key, expected) => {
        expect(getPtvVideoSeekAction(key)).toBe(expected);
    });

    it('executes exactly one seek action for each direction', () => {
        const seekBack = vi.fn();
        const seekForward = vi.fn();

        expect(executePtvVideoSeekAction('seek-back', {
            seekBack,
            seekForward
        })).toBe(true);
        expect(seekBack).toHaveBeenCalledTimes(1);
        expect(seekForward).not.toHaveBeenCalled();

        seekBack.mockClear();
        expect(executePtvVideoSeekAction('seek-forward', {
            seekBack,
            seekForward
        })).toBe(true);
        expect(seekBack).not.toHaveBeenCalled();
        expect(seekForward).toHaveBeenCalledTimes(1);
    });

    it('routes each original normalized key directly to one correctly directed seek', () => {
        const seekBack = vi.fn();
        const seekForward = vi.fn();

        expect(executePtvVideoSeekKey('ArrowRight', {
            seekBack,
            seekForward
        })).toBe(true);
        expect(seekBack).not.toHaveBeenCalled();
        expect(seekForward).toHaveBeenCalledTimes(1);

        seekForward.mockClear();
        expect(executePtvVideoSeekKey('ArrowLeft', {
            seekBack,
            seekForward
        })).toBe(true);
        expect(seekBack).toHaveBeenCalledTimes(1);
        expect(seekForward).not.toHaveBeenCalled();
    });

    it('does not execute seek and focus movement for an unrelated key', () => {
        const seekBack = vi.fn();
        const seekForward = vi.fn();

        expect(executePtvVideoSeekAction(getPtvVideoSeekAction('ArrowUp'), {
            seekBack,
            seekForward
        })).toBe(false);
        expect(seekBack).not.toHaveBeenCalled();
        expect(seekForward).not.toHaveBeenCalled();
    });

    it('makes the legacy video listener yield after the capture focus owner handled a key', () => {
        expect(shouldYieldVideoKeyToPtvFocusOwner(true)).toBe(true);
        expect(shouldYieldVideoKeyToPtvFocusOwner(false)).toBe(false);
    });

    it('retains controls while focus remains in either native or PTV player chrome', () => {
        const nativeControls = document.createElement('div');
        const nativeButton = document.createElement('button');
        const videoPage = document.createElement('section');
        const ptvChrome = document.createElement('div');
        const ptvButton = document.createElement('button');
        const pageButton = document.createElement('button');
        nativeControls.className = 'videoOsdBottom';
        videoPage.id = 'videoOsdPage';
        ptvChrome.className = 'ptv-player-chrome-root';
        nativeControls.append(nativeButton);
        videoPage.append(nativeControls);
        ptvChrome.append(ptvButton);
        document.body.append(videoPage, ptvChrome, pageButton);

        expect(isPtvVideoPlayerControlFocused(nativeButton)).toBe(true);
        expect(isPtvVideoPlayerControlFocused(ptvButton)).toBe(true);
        expect(isPtvVideoPlayerControlFocused(pageButton)).toBe(false);

        videoPage.remove();
        ptvChrome.remove();
        pageButton.remove();
    });

    it('routes visibility requests to one native video-controller owner', () => {
        const first = vi.fn();
        const competitor = vi.fn();
        const unregister = registerPtvVideoControlsVisibilityHandler('jellyfin-video-controller', first);
        const unregisterCompetitor = registerPtvVideoControlsVisibilityHandler('competing-controller', competitor);

        expect(requestPtvVideoControlsVisibility(false)).toBe(true);
        expect(first).toHaveBeenCalledExactlyOnceWith(false);
        expect(competitor).not.toHaveBeenCalled();

        unregisterCompetitor();
        unregister();
        expect(requestPtvVideoControlsVisibility(true)).toBe(false);
    });

    it('safely replaces a recreated native controller without stale disposal', () => {
        const first = vi.fn();
        const second = vi.fn();
        const unregisterFirst = registerPtvVideoControlsVisibilityHandler('jellyfin-video-controller', first);
        const unregisterSecond = registerPtvVideoControlsVisibilityHandler('jellyfin-video-controller', second);

        unregisterFirst();
        expect(requestPtvVideoControlsVisibility(false)).toBe(true);
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledExactlyOnceWith(false);

        unregisterSecond();
        expect(requestPtvVideoControlsVisibility(false)).toBe(false);
    });
});
