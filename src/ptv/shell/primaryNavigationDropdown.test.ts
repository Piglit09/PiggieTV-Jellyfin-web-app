import { describe, expect, it } from 'vitest';

import {
    getPtvDropdownOverlayPosition,
    hasPtvDropdownPointerMoved
} from './primaryNavigationDropdown';

const trigger = {
    bottom: 104,
    height: 44,
    left: 320,
    right: 440,
    top: 60,
    width: 120
};

describe('primary navigation dropdown positioning', () => {
    it('clamps the overlay inside a narrow visual viewport', () => {
        const position = getPtvDropdownOverlayPosition(trigger, {
            height: 740,
            left: 18,
            top: 42,
            width: 360
        }, 180);

        expect(position.left).toBe(144);
        expect(position.left).toBeGreaterThanOrEqual(32);
        expect(position.left + position.width).toBeLessThanOrEqual(364);
        expect(position.top).toBeGreaterThanOrEqual(56);
        expect(position.top + 180).toBeLessThanOrEqual(768);
    });

    it('places the overlay above the trigger when the lower viewport is clipped', () => {
        const position = getPtvDropdownOverlayPosition({
            ...trigger,
            bottom: 704,
            top: 660
        }, {
            height: 720,
            left: 0,
            top: 0,
            width: 390
        }, 180);

        expect(position.top).toBe(470);
    });

    it('recomputes against orientation and visual viewport offsets deterministically', () => {
        const portrait = getPtvDropdownOverlayPosition(trigger, {
            height: 720,
            left: 0,
            top: 0,
            width: 390
        }, 180);
        const landscape = getPtvDropdownOverlayPosition(trigger, {
            height: 360,
            left: 40,
            top: 20,
            width: 720
        }, 180);

        expect(landscape).not.toEqual(portrait);
        expect(landscape.left).toBe(320);
        expect(landscape.top).toBe(114);
    });

    it('distinguishes a tap from a navigation-row swipe', () => {
        expect(hasPtvDropdownPointerMoved(20, 20, 25, 24)).toBe(false);
        expect(hasPtvDropdownPointerMoved(20, 20, 45, 22)).toBe(true);
        expect(hasPtvDropdownPointerMoved(20, 20, 21, 35)).toBe(true);
    });
});
