import { describe, expect, it, vi } from 'vitest';

import { createNotoFontLoader } from './notoFontLoader';
import type { NotoFontProfile } from './notoFontProfile';

function deferred() {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

describe('Noto font loader', () => {
    it('loads and caches only the profiles selected by live culture changes', async () => {
        let locale = 'en-US';
        const applied: string[] = [];
        const loadBase = vi.fn(async () => undefined);
        const loadLocale = vi.fn<(profile: NotoFontProfile) => Promise<void>>()
            .mockResolvedValue(undefined);
        const loadFonts = createNotoFontLoader({
            getLocale: () => locale,
            loadBase,
            loadLocale,
            applyProfile: profile => applied.push(profile)
        });

        await loadFonts();
        locale = 'ja-JP';
        await loadFonts();
        locale = 'ko-KR';
        await loadFonts();
        locale = 'en-US';
        await loadFonts();

        expect(applied).toEqual(['base', 'jp', 'kr', 'base']);
        expect(loadBase).toHaveBeenCalledTimes(1);
        expect(loadLocale.mock.calls.map(([profile]) => profile)).toEqual(['jp', 'kr']);
    });

    it('does not let slower stale imports replace the newest culture profile', async () => {
        let locale = 'ja-JP';
        const applied: string[] = [];
        const localeLoads = {
            jp: deferred(),
            kr: deferred()
        };
        const loadFonts = createNotoFontLoader({
            getLocale: () => locale,
            loadBase: async () => undefined,
            loadLocale: profile => localeLoads[profile as 'jp' | 'kr'].promise,
            applyProfile: profile => applied.push(profile)
        });

        const japaneseLoad = loadFonts();
        await Promise.resolve();
        await Promise.resolve();

        locale = 'ko-KR';
        const koreanLoad = loadFonts();
        await Promise.resolve();
        await Promise.resolve();

        locale = 'en-US';
        await loadFonts();
        localeLoads.kr.resolve();
        localeLoads.jp.resolve();
        await Promise.all([japaneseLoad, koreanLoad]);

        expect(applied).toEqual(['base']);
    });

    it('keeps the applied profile unchanged after an import failure and allows retry', async () => {
        let attempts = 0;
        const applied: string[] = [];
        const onError = vi.fn();
        const loadFonts = createNotoFontLoader({
            getLocale: () => 'ja-JP',
            loadBase: async () => undefined,
            loadLocale: async () => {
                attempts += 1;
                if (attempts === 1) throw new Error('chunk unavailable');
            },
            applyProfile: profile => applied.push(profile),
            onError
        });

        await expect(loadFonts()).resolves.toBe(false);
        expect(applied).toEqual([]);
        expect(onError).toHaveBeenCalledTimes(1);

        await expect(loadFonts()).resolves.toBe(true);
        expect(applied).toEqual(['jp']);
        expect(attempts).toBe(2);
    });
});
