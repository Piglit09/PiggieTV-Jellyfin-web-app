import { describe, expect, it } from 'vitest';

import {
    ADMIN_LIVE_TV_DVR_PATH,
    ADMIN_LIVE_TV_PATH,
    readAdminLiveTvRoute
} from './AdminLiveTvRoute';

describe('readAdminLiveTvRoute', () => {
    it.each([
        [ ADMIN_LIVE_TV_PATH, { kind: 'overview' } ],
        [ `${ADMIN_LIVE_TV_PATH}/tuners`, { kind: 'tuners' } ],
        [ `${ADMIN_LIVE_TV_PATH}/guide`, { kind: 'guide' } ],
        [ ADMIN_LIVE_TV_DVR_PATH, { kind: 'dvr' } ],
        [ `${ADMIN_LIVE_TV_PATH}/recordings`, { kind: 'dvr' } ]
    ])('parses %s', (pathname, expected) => {
        expect(readAdminLiveTvRoute(pathname)).toEqual(expected);
    });

    it('parses encoded edit identifiers and trailing slashes', () => {
        expect(readAdminLiveTvRoute(`${ADMIN_LIVE_TV_PATH}/tuners/tuner%20one/`)).toEqual({
            kind: 'tuner',
            tunerId: 'tuner one'
        });
        expect(readAdminLiveTvRoute(`${ADMIN_LIVE_TV_PATH}/guide/provider%20one`)).toEqual({
            kind: 'provider',
            providerId: 'provider one',
            providerType: null
        });
    });

    it.each([
        [ '?type=xmltv', 'xmltv' ],
        [ '?type=schedulesdirect', 'schedules-direct' ],
        [ '?type=schedules-direct', 'schedules-direct' ],
        [ '', null ]
    ] as const)('parses a new provider query %s', (search, providerType) => {
        expect(readAdminLiveTvRoute(`${ADMIN_LIVE_TV_PATH}/guide/new`, search)).toEqual({
            kind: 'provider',
            providerId: null,
            providerType
        });
    });

    it('rejects unrelated or malformed paths', () => {
        expect(readAdminLiveTvRoute('/settings/admin/livetv-ish')).toBeNull();
        expect(readAdminLiveTvRoute(`${ADMIN_LIVE_TV_PATH}/unknown`)).toBeNull();
        expect(readAdminLiveTvRoute(`${ADMIN_LIVE_TV_PATH}/tuners/%E0%A4%A`)).toBeNull();
        expect(readAdminLiveTvRoute(`${ADMIN_LIVE_TV_PATH}/tuners/tuner-a/extra`)).toBeNull();
        expect(readAdminLiveTvRoute(`${ADMIN_LIVE_TV_PATH}/tuners/tuner%2Fa`)).toBeNull();
        expect(readAdminLiveTvRoute(`${ADMIN_LIVE_TV_PATH}/guide/provider%5Ca`)).toBeNull();
        expect(readAdminLiveTvRoute(`${ADMIN_LIVE_TV_PATH}/guide/provider%00a`)).toBeNull();
    });
});
