import { describe, expect, it } from 'vitest';

import { detectPtvTvClient } from './clientProfile';

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
});
