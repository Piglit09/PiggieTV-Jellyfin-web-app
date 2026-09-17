import { describe, expect, it } from 'vitest';

import {
    shouldArmPlayerChromeHide,
    shouldDeferPlayerChromeHide
} from './playerChromeTimer';

describe('player chrome auto-hide timer', () => {
    it('re-arms visible controls when playback resumes without an active timer', () => {
        expect(shouldArmPlayerChromeHide({
            controlsVisible: true,
            hasTimer: false,
            paused: false,
            playbackActive: true
        })).toBe(true);
    });

    it.each([
        ['paused', true, false, true, true],
        ['already armed', false, true, true, true],
        ['hidden', false, false, false, true],
        ['outside playback', false, false, true, false]
    ])('does not arm while %s', (_label, paused, hasTimer, controlsVisible, playbackActive) => {
        expect(shouldArmPlayerChromeHide({
            controlsVisible,
            hasTimer,
            paused,
            playbackActive
        })).toBe(false);
    });

    it('does not let pointer-focused web controls postpone hiding forever', () => {
        expect(shouldDeferPlayerChromeHide({
            controlFocused: true,
            isTv: false
        })).toBe(false);
    });

    it('preserves focused remote controls for a TV profile', () => {
        expect(shouldDeferPlayerChromeHide({
            controlFocused: true,
            isTv: true
        })).toBe(true);
    });
});
