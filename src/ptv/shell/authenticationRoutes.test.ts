import { describe, expect, it } from 'vitest';

import {
    getPtvAuthenticationRouteKind,
    isPtvAuthenticationRoute,
    isPtvLoginRoute,
    shouldMountPtvAuthenticatedHeader
} from './authenticationRoutes';

function location(pathname: string, search = '') {
    return {
        hash: '',
        pathname,
        search
    };
}

describe('PTV authentication route ownership', () => {
    it.each([
        ['/login', ''],
        ['/login', '?serverid=server&url=%2Fhome'],
        ['/selectserver', ''],
        ['/addserver', ''],
        ['/forgotpassword', ''],
        ['/forgotpasswordpin', ''],
        ['/quickconnect', '']
    ])('classifies %s%s as a login-flow route', (pathname, search) => {
        const routeLocation = location(pathname, search);

        expect(isPtvLoginRoute(routeLocation)).toBe(true);
        expect(isPtvAuthenticationRoute(routeLocation)).toBe(true);
        expect(shouldMountPtvAuthenticatedHeader(routeLocation)).toBe(false);
    });

    it.each([
        '/signup',
        '/ptv/signup'
    ])('classifies %s as a signup route', pathname => {
        const routeLocation = location(pathname);

        expect(getPtvAuthenticationRouteKind(routeLocation)).toBe('signup');
        expect(shouldMountPtvAuthenticatedHeader(routeLocation)).toBe(false);
    });

    it('ignores authentication query parameters when classifying login', () => {
        const firstQuery = location('/login', '?serverid=first&url=%2Fmovies');
        const secondQuery = location('/login', '?serverid=second&url=%2Fshows');

        expect(getPtvAuthenticationRouteKind(firstQuery)).toBe('login');
        expect(getPtvAuthenticationRouteKind(secondQuery)).toBe('login');
        expect(shouldMountPtvAuthenticatedHeader(firstQuery)).toBe(false);
        expect(shouldMountPtvAuthenticatedHeader(secondQuery)).toBe(false);
    });

    it.each([
        '#/login',
        '#/login?serverid=server&url=%2Fhome',
        '/web/#/login?serverid=server&url=%2Fhome',
        '#!/login',
        '#/LOGIN'
    ])('normalizes the supported hash form %s', route => {
        expect(isPtvAuthenticationRoute(route)).toBe(true);
        expect(shouldMountPtvAuthenticatedHeader(route)).toBe(false);
    });

    it('restores authenticated header ownership after successful login navigation', () => {
        const navigation = [
            location('/login', '?serverid=server&url=%2Fhome'),
            location('/home')
        ];

        expect(navigation.map(shouldMountPtvAuthenticatedHeader)).toEqual([false, true]);
    });

    it('tracks logout and browser back/forward transitions without retaining auth state', () => {
        const history = [
            location('/home'),
            location('/login', '?serverid=server&url=%2Fhome'),
            location('/home'),
            location('/login', '?serverid=server&url=%2Fhome')
        ];

        expect(history.map(shouldMountPtvAuthenticatedHeader)).toEqual([true, false, true, false]);
    });

    it.each([
        '/home',
        '/movies',
        '/shows',
        '/music',
        '/reading',
        '/dashboard',
        '/mypreferencesmenu'
    ])('keeps the authenticated header eligible on %s', pathname => {
        expect(shouldMountPtvAuthenticatedHeader(location(pathname))).toBe(true);
    });

    it('does not classify a login-looking query value as an authentication route', () => {
        expect(isPtvAuthenticationRoute(location('/home', '?url=%2Flogin'))).toBe(false);
        expect(shouldMountPtvAuthenticatedHeader(location('/home', '?url=%2Flogin'))).toBe(true);
    });
});
