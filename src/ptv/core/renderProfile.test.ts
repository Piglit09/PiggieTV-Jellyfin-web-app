import { describe, expect, it } from 'vitest';

import { getPtvRenderProfile, type PtvRenderClientSignals } from './renderProfile';

function createSignals(overrides: Partial<PtvRenderClientSignals> = {}) {
    return {
        isAndroidTv: undefined,
        isCoarsePointer: false,
        isConstrainedHardware: false,
        isFireTv: false,
        isLowPower: false,
        isMobile: false,
        isRoku: undefined,
        isTablet: false,
        isTenFootClient: false,
        isTizen: undefined,
        isTv: false,
        isWebOs: false,
        supportsBackdropFilter: true,
        ...overrides
    } as PtvRenderClientSignals;
}

describe('PTV render profile selection', () => {
    it('selects TV profile for ten-foot signals', () => {
        const profile = getPtvRenderProfile(createSignals({
            isTv: true
        }));

        expect(profile.id).toBe('PTV_TV');
        expect(profile.selectionReason).toBe('tv');
        expect(profile.matchReason).toBe('tv-signal');
    });

    it('selects WebOS optimized profile for webOS signal', () => {
        const profile = getPtvRenderProfile(createSignals({
            isWebOs: true
        }));

        expect(profile.id).toBe('PTV_WEBOS_OPTIMIZED');
        expect(profile.selectionReason).toBe('webos');
        expect(profile.matchReason).toBe('webos-signal');
    });

    it('selects mobile profile when mobile/tablet posture is present', () => {
        const profile = getPtvRenderProfile(createSignals({
            isMobile: true
        }));

        expect(profile.id).toBe('PTV_MOBILE');
        expect(profile.selectionReason).toBe('mobile');
        expect(profile.matchReason).toBe('mobile-signal');
    });

    it('selects low-power profile when low-power signals match', () => {
        const profile = getPtvRenderProfile(createSignals({
            isConstrainedHardware: true
        }));

        expect(profile.id).toBe('PTV_LOWPOWER');
        expect(profile.selectionReason).toBe('low-power');
        expect(profile.matchReason).toBe('constrained-hardware');
    });

    it('falls back to desktop profile by default', () => {
        const profile = getPtvRenderProfile(createSignals());

        expect(profile.id).toBe('PTV_DESKTOP');
        expect(profile.selectionReason).toBe('desktop');
        expect(profile.matchReason).toBe('desktop-default');
    });
});
