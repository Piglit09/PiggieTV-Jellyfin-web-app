import { describe, expect, it, vi } from 'vitest';

vi.mock('./tvFocus', () => ({ syncPtvTvFocusEngine: () => undefined }));

describe('PTV compatibility profile refresh', () => {
    it('updates the real layout classes after resize, orientation, and visual viewport events', async () => {
        const root = document.documentElement;
        const originalClasses = root.className;
        const originalDataset = { ...root.dataset };
        const originalWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
        const originalHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
        const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
        const originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
        const userAgent = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
            'Mozilla/5.0 (Linux; Android 14; SM-F946U) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36'
        );
        let innerWidth = 390;
        let innerHeight = 840;
        let visualWidth = 390;
        let visualHeight = 840;
        const visualViewport = new EventTarget();

        Object.defineProperties(visualViewport, {
            width: { get: () => visualWidth },
            height: { get: () => visualHeight }
        });
        Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => innerWidth });
        Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => innerHeight });
        Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport });
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: (query: string) => ({ matches: query === '(pointer: coarse)' || query === '(hover: none)' })
        });
        vi.useFakeTimers();

        try {
            vi.resetModules();
            await import('./compatibility');
            expect(root.classList.contains('ptv-layout-compact-mobile')).toBe(true);
            expect(root.dataset.ptvClientProfile).toBe('mobile');

            innerWidth = visualWidth = 1080;
            innerHeight = visualHeight = 832;
            window.dispatchEvent(new Event('resize'));
            expect(root.classList.contains('ptv-layout-compact-mobile')).toBe(true);
            await vi.advanceTimersByTimeAsync(121);
            expect(root.classList.contains('ptv-layout-tablet')).toBe(true);
            expect(root.classList.contains('ptv-layout-compact-mobile')).toBe(false);
            expect(root.dataset.ptvClientProfile).toBe('mobile');

            innerWidth = visualWidth = 1440;
            innerHeight = visualHeight = 900;
            window.dispatchEvent(new Event('orientationchange'));
            await vi.advanceTimersByTimeAsync(121);
            expect(root.classList.contains('ptv-layout-desktop')).toBe(true);
            expect(root.dataset.ptvClientProfile).toBe('mobile');

            visualWidth = 390;
            visualHeight = 840;
            visualViewport.dispatchEvent(new Event('resize'));
            await vi.advanceTimersByTimeAsync(121);
            expect(root.classList.contains('ptv-layout-compact-mobile')).toBe(true);
            expect(root.classList.contains('ptv-layout-desktop')).toBe(false);
            expect(root.dataset.ptvClientProfile).toBe('mobile');
        } finally {
            vi.useRealTimers();
            userAgent.mockRestore();
            if (originalWidth) Object.defineProperty(window, 'innerWidth', originalWidth);
            if (originalHeight) Object.defineProperty(window, 'innerHeight', originalHeight);
            if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia);
            else Reflect.deleteProperty(window, 'matchMedia');
            if (originalVisualViewport) Object.defineProperty(window, 'visualViewport', originalVisualViewport);
            else Reflect.deleteProperty(window, 'visualViewport');
            root.className = originalClasses;
            Object.keys(root.dataset).forEach(key => {
                delete root.dataset[key];
            });
            Object.assign(root.dataset, originalDataset);
        }
    });
});
