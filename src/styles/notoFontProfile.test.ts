import { describe, expect, it } from 'vitest';

import { resolveNotoFontProfile } from './notoFontProfile';

describe('resolveNotoFontProfile', () => {
    it.each([
        ['ja', 'jp'],
        ['ja-JP', 'jp'],
        ['ko', 'kr'],
        ['ko_KR', 'kr'],
        ['zh-CN', 'sc'],
        ['zh-SG', 'sc'],
        ['zh-Hans', 'sc'],
        ['zh', 'sc'],
        ['zh-TW', 'tc'],
        ['zh-Hant-TW', 'tc'],
        ['zh-HK', 'hk'],
        ['zh-Hant-HK', 'hk'],
        ['zh-MO', 'hk']
    ] as const)('maps %s to the %s font chunk', (locale, expected) => {
        expect(resolveNotoFontProfile(locale)).toBe(expected);
    });

    it.each([undefined, null, '', 'en-US', 'fr', 'ar'])(
        'uses only the base font chunk for %s',
        locale => {
            expect(resolveNotoFontProfile(locale)).toBeNull();
        }
    );
});
