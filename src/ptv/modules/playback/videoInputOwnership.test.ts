import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    beginPtvHiddenVideoDirectionalGesture,
    executePtvHiddenVideoDirectionalGestureKey,
    executePtvVideoSeekAction,
    executePtvVideoSeekKey,
    getPtvVideoSeekAction,
    hidePtvVideoControls,
    isPtvVideoPlayerControlFocused,
    reconcilePtvVideoControlSurface,
    registerPtvVideoControlsVisibilityHandler,
    requestPtvVideoControlsVisibility,
    resetPtvHiddenVideoDirectionalGesture,
    resetPtvHiddenVideoDirectionalGestureForLease,
    shouldContinuePtvHiddenVideoDirectionalGesture,
    shouldTreatPtvVideoControlsAsHidden,
    shouldYieldVideoKeyToPtvFocusOwner
} from './videoInputOwnership';

describe('video input ownership', () => {
    afterEach(() => {
        resetPtvHiddenVideoDirectionalGesture();
    });

    it.each([
        ['ArrowLeft', 'seek-back'],
        ['Left', 'seek-back'],
        ['left', 'seek-back'],
        ['ArrowRight', 'seek-forward'],
        ['Right', 'seek-forward'],
        ['right', 'seek-forward']
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

    it('keeps matching LG repeat events inside a hidden-origin seek gesture', () => {
        expect(beginPtvHiddenVideoDirectionalGesture('ArrowRight')).toBe(true);
        expect(shouldContinuePtvHiddenVideoDirectionalGesture('right', true)).toBe(true);

        expect(beginPtvHiddenVideoDirectionalGesture('right')).toBe(true);
        expect(shouldContinuePtvHiddenVideoDirectionalGesture('ArrowRight', true)).toBe(true);
    });

    it('allows arbitrarily slow matching repeats until release or a direction change', () => {
        expect(beginPtvHiddenVideoDirectionalGesture('ArrowRight')).toBe(true);
        expect(shouldContinuePtvHiddenVideoDirectionalGesture('ArrowRight', true)).toBe(true);
        expect(shouldContinuePtvHiddenVideoDirectionalGesture('ArrowRight', true)).toBe(true);
        expect(shouldContinuePtvHiddenVideoDirectionalGesture('ArrowRight', false)).toBe(false);
        expect(shouldContinuePtvHiddenVideoDirectionalGesture('ArrowRight', true)).toBe(false);

        expect(beginPtvHiddenVideoDirectionalGesture('ArrowRight')).toBe(true);
        expect(shouldContinuePtvHiddenVideoDirectionalGesture('ArrowLeft', true)).toBe(false);
    });

    it('executes one stock seek for the hidden press and every accepted repeat', () => {
        const seekBack = vi.fn();
        const seekForward = vi.fn();
        const handlers = {
            seekBack,
            seekForward
        };

        expect(executePtvHiddenVideoDirectionalGestureKey({
            controlsHidden: true,
            key: 'ArrowRight',
            repeat: false
        }, handlers)).toBe(true);
        Array.from({ length: 6 }).forEach(() => {
            expect(executePtvHiddenVideoDirectionalGestureKey({
                controlsHidden: false,
                key: 'ArrowRight',
                repeat: true
            }, handlers)).toBe(true);
        });

        expect(seekBack).not.toHaveBeenCalled();
        expect(seekForward).toHaveBeenCalledTimes(7);
        expect(executePtvHiddenVideoDirectionalGestureKey({
            controlsHidden: false,
            key: 'ArrowRight',
            repeat: false
        }, handlers)).toBe(false);
        expect(seekForward).toHaveBeenCalledTimes(7);
    });

    it.each([
        {
            currentVisibleMenu: null,
            presentation: {
                playbackActive: true,
                controlsVisible: false
            },
            expected: true,
            scenario: 'the native controller has no visible menu'
        },
        {
            currentVisibleMenu: 'osd',
            presentation: {
                playbackActive: true,
                controlsVisible: true
            },
            expected: false,
            scenario: 'both controllers report the OSD visible'
        },
        {
            currentVisibleMenu: 'osd',
            presentation: {
                playbackActive: true,
                controlsVisible: false
            },
            expected: true,
            scenario: 'the native OSD is stale while PTV reports hidden controls'
        },
        {
            currentVisibleMenu: 'upnext',
            presentation: {
                playbackActive: true,
                controlsVisible: false
            },
            expected: false,
            scenario: 'another native menu owns the player'
        }
    ])('treats controls as hidden when $scenario', ({
        currentVisibleMenu,
        presentation,
        expected
    }) => {
        expect(shouldTreatPtvVideoControlsAsHidden(currentVisibleMenu, presentation)).toBe(expected);
    });

    it('retains controls while focus remains in either native or PTV player chrome', () => {
        const nativeControls = document.createElement('div');
        const nativeButton = document.createElement('button');
        const videoPage = document.createElement('section');
        const ptvPauseStage = document.createElement('div');
        const ptvButton = document.createElement('button');
        const pageButton = document.createElement('button');
        nativeControls.className = 'videoOsdBottom';
        videoPage.id = 'videoOsdPage';
        ptvPauseStage.className = 'ptv-player-pause-stage';
        ptvPauseStage.setAttribute('aria-hidden', 'false');
        nativeControls.append(nativeButton);
        videoPage.append(nativeControls);
        ptvPauseStage.append(ptvButton);
        document.body.append(videoPage, ptvPauseStage, pageButton);

        expect(isPtvVideoPlayerControlFocused(nativeButton)).toBe(true);
        expect(isPtvVideoPlayerControlFocused(ptvButton)).toBe(true);
        expect(isPtvVideoPlayerControlFocused(pageButton)).toBe(false);

        ptvPauseStage.setAttribute('aria-hidden', 'true');
        expect(isPtvVideoPlayerControlFocused(ptvButton)).toBe(false);

        nativeControls.classList.add('videoOsdBottom-hidden');
        expect(isPtvVideoPlayerControlFocused(nativeButton)).toBe(false);

        videoPage.remove();
        ptvPauseStage.remove();
        pageButton.remove();
    });

    it('claims one active video OSD and removes a stale PTV control bar during route transitions', () => {
        const firstPage = document.createElement('section');
        const secondPage = document.createElement('section');
        const staleTopBar = document.createElement('div');

        staleTopBar.className = 'ptv-player-topbar';
        document.body.append(firstPage, secondPage, staleTopBar);

        expect(reconcilePtvVideoControlSurface(firstPage)).toBe(1);
        expect(staleTopBar.isConnected).toBe(false);
        expect(document.querySelectorAll('[data-ptv-playback-surface="video-controls"]')).toHaveLength(1);

        expect(reconcilePtvVideoControlSurface(secondPage)).toBe(1);
        expect(firstPage.hasAttribute('data-ptv-playback-surface')).toBe(false);
        expect(secondPage.dataset.ptvPlaybackSurface).toBe('video-controls');
        expect(document.querySelectorAll('[data-ptv-playback-surface="video-controls"]')).toHaveLength(1);

        expect(reconcilePtvVideoControlSurface(null)).toBe(0);
        expect(document.querySelector('[data-ptv-playback-surface="video-controls"]')).toBeNull();
        firstPage.remove();
        secondPage.remove();
    });

    it('routes visibility requests to one native video-controller owner', () => {
        const first = vi.fn();
        const competitor = vi.fn();
        const lease = registerPtvVideoControlsVisibilityHandler('jellyfin-video-controller', first);
        const competitorLease = registerPtvVideoControlsVisibilityHandler('competing-controller', competitor);

        expect(requestPtvVideoControlsVisibility(false)).toBe(true);
        expect(first).toHaveBeenCalledExactlyOnceWith(false);
        expect(competitor).not.toHaveBeenCalled();
        expect(lease.isActive()).toBe(true);
        expect(competitorLease.isActive()).toBe(false);

        expect(competitorLease.release()).toBe(false);
        expect(lease.release()).toBe(true);
        expect(requestPtvVideoControlsVisibility(true)).toBe(false);
    });

    it('hides through the native owner and only uses the presentation fallback when no owner exists', () => {
        const nativeOwner = vi.fn();
        const fallback = vi.fn();
        const lease = registerPtvVideoControlsVisibilityHandler('jellyfin-video-controller', nativeOwner);

        expect(hidePtvVideoControls(fallback)).toBe(true);
        expect(nativeOwner).toHaveBeenCalledExactlyOnceWith(false);
        expect(fallback).not.toHaveBeenCalled();

        expect(lease.release()).toBe(true);
        expect(hidePtvVideoControls(fallback)).toBe(false);
        expect(fallback).toHaveBeenCalledTimes(1);
    });

    it('safely replaces a recreated native controller without stale disposal', () => {
        const first = vi.fn();
        const second = vi.fn();
        const firstLease = registerPtvVideoControlsVisibilityHandler('jellyfin-video-controller', first);
        const secondLease = registerPtvVideoControlsVisibilityHandler('jellyfin-video-controller', second);

        expect(firstLease.release()).toBe(false);
        expect(requestPtvVideoControlsVisibility(false)).toBe(true);
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledExactlyOnceWith(false);

        expect(secondLease.release()).toBe(true);
        expect(requestPtvVideoControlsVisibility(false)).toBe(false);
    });

    it('does not let an inactive cached controller reset the active seek gesture', () => {
        const firstLease = registerPtvVideoControlsVisibilityHandler(
            'jellyfin-video-controller',
            vi.fn()
        );
        const activeLease = registerPtvVideoControlsVisibilityHandler(
            'jellyfin-video-controller',
            vi.fn()
        );

        beginPtvHiddenVideoDirectionalGesture('ArrowRight');
        expect(resetPtvHiddenVideoDirectionalGestureForLease(firstLease)).toBe(false);
        expect(shouldContinuePtvHiddenVideoDirectionalGesture('ArrowRight', true)).toBe(true);
        expect(resetPtvHiddenVideoDirectionalGestureForLease(activeLease)).toBe(true);
        expect(shouldContinuePtvHiddenVideoDirectionalGesture('ArrowRight', true)).toBe(false);

        expect(firstLease.release()).toBe(false);
        expect(activeLease.release()).toBe(true);
    });

    it('tracks the active cached video view across hide and restore lifecycle changes', () => {
        const firstCachedView = vi.fn();
        const secondCachedView = vi.fn();
        const restoredFirstView = vi.fn();
        const firstViewLease = registerPtvVideoControlsVisibilityHandler(
            'jellyfin-video-controller',
            firstCachedView
        );
        const secondViewLease = registerPtvVideoControlsVisibilityHandler(
            'jellyfin-video-controller',
            secondCachedView
        );

        expect(firstViewLease.release()).toBe(false);
        expect(requestPtvVideoControlsVisibility(false)).toBe(true);
        expect(firstCachedView).not.toHaveBeenCalled();
        expect(secondCachedView).toHaveBeenCalledExactlyOnceWith(false);

        expect(secondViewLease.release()).toBe(true);
        expect(requestPtvVideoControlsVisibility(false)).toBe(false);

        const restoredFirstViewLease = registerPtvVideoControlsVisibilityHandler(
            'jellyfin-video-controller',
            restoredFirstView
        );

        expect(requestPtvVideoControlsVisibility(true)).toBe(true);
        expect(restoredFirstView).toHaveBeenCalledExactlyOnceWith(true);

        expect(restoredFirstViewLease.release()).toBe(true);
        expect(restoredFirstViewLease.release()).toBe(false);
        expect(requestPtvVideoControlsVisibility(false)).toBe(false);
    });
});
