import { describe, expect, it } from 'vitest';

import {
    createPtvNavigationIntent,
    parsePtvNavigationDeepLink
} from './navigationIntent';

describe('PTV Core navigation intents', () => {
    it('creates logical intents with back behavior and capability metadata', () => {
        const result = createPtvNavigationIntent({
            backBehavior: 'preserve',
            destination: 'library',
            libraryId: 'library-1',
            query: { tab: 'recent' },
            requiredCapabilities: ['reader', 'reader']
        });

        expect(result).toEqual({
            success: true,
            value: {
                backBehavior: 'preserve',
                contractVersion: '1.0',
                deepLink: undefined,
                destination: 'library',
                libraryId: 'library-1',
                mediaId: undefined,
                query: { tab: 'recent' },
                requiredCapabilities: ['reader']
            }
        });
    });

    it('parses hash and custom-scheme deep links', () => {
        expect(parsePtvNavigationDeepLink('https://app.test/#/details?id=item-1&tab=cast'))
            .toMatchObject({
                success: true,
                value: {
                    destination: 'details',
                    mediaId: 'item-1',
                    query: { tab: 'cast' }
                }
            });
        expect(parsePtvNavigationDeepLink('ptv://player/item-2')).toMatchObject({
            success: true,
            value: {
                destination: 'player',
                mediaId: 'item-2'
            }
        });
    });

    it('rejects invalid destinations and details/player intents without a media ID', () => {
        expect(createPtvNavigationIntent({ destination: 'future-screen' })).toMatchObject({
            error: { code: 'NAVIGATION_DESTINATION_INVALID' },
            success: false
        });
        expect(createPtvNavigationIntent({ destination: 'details' })).toMatchObject({
            error: { code: 'NAVIGATION_MEDIA_ID_REQUIRED' },
            success: false
        });
    });
});
