import { describe, expect, it, vi } from 'vitest';

import {
    applyPtvClientProfileClasses,
    detectPtvTvClient,
    detectPtvTvClientFromSignals,
    getPtvPerformanceProfile
} from './clientProfile';

describe('PiggieTV TV client detection', () => {
    it.each([
        {
            expectedPlatform: 'webos',
            expectedReason: 'webos-user-agent',
            userAgent: 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.41 (KHTML, like Gecko) Large Screen WebAppManager Safari/537.41'
        },
        {
            expectedPlatform: 'tizen',
            expectedReason: 'tizen-user-agent',
            userAgent: 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 7.0) AppleWebKit/537.36 SamsungBrowser/5.0 TV Safari/537.36'
        },
        {
            expectedPlatform: 'android-tv',
            expectedReason: 'android-tv-user-agent',
            userAgent: 'Mozilla/5.0 (Linux; Android 11; SHIELD Android TV Build/RQ1A.210105.003) AppleWebKit/537.36 Chrome/96.0 Safari/537.36'
        },
        {
            expectedPlatform: 'fire-tv',
            expectedReason: 'fire-tv-user-agent',
            userAgent: 'Mozilla/5.0 (Linux; U; Android 9; AFTMM Build/PS7613) AppleWebKit/537.36 Silk/112.5 Safari/537.36'
        },
        {
            expectedPlatform: 'roku',
            expectedReason: 'roku-user-agent',
            userAgent: 'Roku/DVP-12.5 (519.50E04154A)'
        }
    ])('classifies $expectedPlatform clients as TV', ({ expectedPlatform, expectedReason, userAgent }) => {
        const detection = detectPtvTvClient(userAgent);

        expect(detection.isTv).toBe(true);
        expect(detection.tvPlatform).toBe(expectedPlatform);
        expect(detection.reason).toBe(expectedReason);
    });

    it('does not classify a normal desktop browser as TV based on viewport size alone', () => {
        const detection = detectPtvTvClient(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36'
        );

        expect(detection).toMatchObject({
            isTv: false,
            reason: 'no-tv-signal',
            tvPlatform: 'none'
        });
    });

    it('honors Jellyfin ten-foot ownership when the user agent has no TV marker', () => {
        const detection = detectPtvTvClient('Mozilla/5.0 (X11; Linux x86_64)', true);

        expect(detection).toMatchObject({
            isTv: true,
            reason: 'jellyfin-ten-foot-class',
            tvPlatform: 'ten-foot'
        });
    });

    it('classifies a Jellyfin Android TV runtime on Fire OS as Fire TV from safe device metadata', () => {
        const detection = detectPtvTvClientFromSignals({
            appName: 'Jellyfin Android TV',
            appVersion: '0.19.9',
            deviceName: "Jonathan's Fire TV",
            platform: 'Fire OS'
        });

        expect(detection).toMatchObject({
            isAndroidTv: false,
            isFireTv: true,
            isTv: true,
            reason: 'fire-tv-device-signal',
            tvPlatform: 'fire-tv'
        });
    });

    it('follows Fold viewport posture while retaining the Home row and image budget', () => {
        const originalWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
        const originalHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
        const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
        const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
        const originalClasses = document.documentElement.className;
        const originalDataset = { ...document.documentElement.dataset };
        const userAgent = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
            'Mozilla/5.0 (Linux; Android 14; SM-F946U) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36'
        );
        const setViewport = (width: number, height: number) => {
            Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
            Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
        };

        try {
            Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
            Object.defineProperty(window, 'matchMedia', {
                configurable: true,
                value: (query: string) => ({ matches: query === '(pointer: coarse)' || query === '(hover: none)' })
            });

            setViewport(390, 840);
            const outer = applyPtvClientProfileClasses();
            const outerBudget = getPtvPerformanceProfile();
            expect(outer).toMatchObject({ isMobile: true, isTablet: false, layoutMode: 'compact-mobile' });
            expect(document.documentElement.classList.contains('ptv-client-mobile')).toBe(true);

            setViewport(1080, 832);
            const inner = applyPtvClientProfileClasses();
            const innerBudget = getPtvPerformanceProfile();
            expect(inner).toMatchObject({ isMobile: true, isTablet: true, layoutMode: 'tablet' });
            expect(document.documentElement.classList.contains('ptv-layout-mobile')).toBe(false);
            expect(document.documentElement.classList.contains('ptv-layout-tablet')).toBe(true);
            expect(innerBudget).toMatchObject({
                clientKind: outerBudget.clientKind,
                featuredRowLimit: outerBudget.featuredRowLimit,
                heroBackdropMaxWidth: outerBudget.heroBackdropMaxWidth,
                homeRowLimit: outerBudget.homeRowLimit,
                rowItemLimit: outerBudget.rowItemLimit
            });

            setViewport(1440, 900);
            const wide = applyPtvClientProfileClasses();
            expect(wide.layoutMode).toBe('desktop');
            expect(getPtvPerformanceProfile().heroBackdropMaxWidth).toBe(outerBudget.heroBackdropMaxWidth);

            setViewport(390, 840);
            const foldedAgain = applyPtvClientProfileClasses();
            expect(foldedAgain).toMatchObject({ isMobile: true, isTablet: false, layoutMode: 'compact-mobile' });
            expect(document.documentElement.classList.contains('ptv-client-mobile')).toBe(true);
            expect(getPtvPerformanceProfile().heroBackdropMaxWidth).toBe(outerBudget.heroBackdropMaxWidth);
        } finally {
            userAgent.mockRestore();
            if (originalWidth) Object.defineProperty(window, 'innerWidth', originalWidth);
            if (originalHeight) Object.defineProperty(window, 'innerHeight', originalHeight);
            if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia);
            else Reflect.deleteProperty(window, 'matchMedia');
            if (originalVisualViewport) Object.defineProperty(window, 'visualViewport', originalVisualViewport);
            else Reflect.deleteProperty(window, 'visualViewport');
            document.documentElement.className = originalClasses;
            Object.keys(document.documentElement.dataset).forEach(key => {
                delete document.documentElement.dataset[key];
            });
            Object.assign(document.documentElement.dataset, originalDataset);
        }
    });
});
