import { describe, expect, it } from 'vitest';

import { shouldFocusVideoOsdOnReveal } from './videoOsdFocusPolicy';

describe('video OSD reveal focus policy', () => {
    it('leaves desktop pointer and touch reveals unfocused', () => {
        expect(shouldFocusVideoOsdOnReveal(false, false)).toBe(false);
    });

    it('preserves an explicit keyboard focus target', () => {
        expect(shouldFocusVideoOsdOnReveal(false, true)).toBe(true);
    });

    it('preserves TV focus when controls return', () => {
        expect(shouldFocusVideoOsdOnReveal(true, false)).toBe(true);
    });
});
