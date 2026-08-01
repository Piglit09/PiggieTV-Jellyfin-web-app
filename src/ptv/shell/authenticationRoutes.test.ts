import { describe, expect, it, vi } from 'vitest';

import {
    createPtvPostLoginNavigationGuard,
    getPtvAuthenticationRouteKind,
    getPtvLoginRedirectDecision,
    getPtvPostLoginRoute,
    getPtvPostLoginRouteWithHashFallback,
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

    it('does not recognize the obsolete logout hash as a route or retain authenticated shell state', () => {
        expect(isPtvAuthenticationRoute('#/logout')).toBe(false);
        expect(isPtvLoginRoute('#/logout')).toBe(false);
        expect(isPtvAuthenticationRoute('#/selectserver')).toBe(true);
        expect(isPtvAuthenticationRoute('#/login')).toBe(true);
        expect([
            '#/home',
            '#/selectserver',
            '#/login',
            '#/home'
        ].map(shouldMountPtvAuthenticatedHeader)).toEqual([true, false, false, true]);
    });

    it.each([
        [undefined, '/home'],
        ['', '/home'],
        ['/home', '/home'],
        ['/details?id=item-one', '/details?id=item-one'],
        ['%2Fmusic%3Ftab%3Dalbums', '/music?tab=albums'],
        ['/search?query=music', '/search?query=music']
    ])('resolves the post-login route %s to %s', (target, expected) => {
        expect(getPtvPostLoginRoute(target)).toBe(expected);
    });

    it('uses a safe current hash when same-origin login has no redirect parameter', () => {
        expect(getPtvPostLoginRouteWithHashFallback(
            undefined,
            '#/details?id=item-one'
        )).toBe('/details?id=item-one');
        expect(getPtvPostLoginRouteWithHashFallback(
            '/search?query=music',
            '#/details?id=item-one'
        )).toBe('/search?query=music');
        expect(getPtvPostLoginRouteWithHashFallback(
            undefined,
            '#/mypreferencesmenu'
        )).toBe('/home');
    });

    it.each([
        '/login',
        '/logout',
        '/selectserver',
        '/queue',
        '/video',
        '/dashboard',
        '/dashboard/piggietv',
        '/diagnostics',
        '/definitely-not-a-route',
        'https://example.invalid/settings'
    ])('rejects unsafe, transient, administrative, or invalid target %s', target => {
        expect(getPtvPostLoginRoute(target)).toBe('/home');
    });

    it('rejects stale Settings while allowing a Settings request made in the current navigation attempt', () => {
        expect(getPtvLoginRedirectDecision('/mypreferencesmenu')).toMatchObject({
            reason: 'rejected-stale-settings',
            restoresCurrentSettings: false,
            route: '/home'
        });
        expect(getPtvLoginRedirectDecision('/mypreferencesmenu', {
            explicitCurrentAttempt: true
        })).toMatchObject({
            reason: 'explicit-current-settings',
            restoresCurrentSettings: true,
            route: '/mypreferencesmenu'
        });
    });

    it('commits exactly one post-login navigation across duplicate auth callbacks', () => {
        const navigate = vi.fn();
        const commit = createPtvPostLoginNavigationGuard();

        commit(() => navigate('/home'));
        commit(() => navigate('/mypreferencesmenu'));

        expect(navigate).toHaveBeenCalledExactlyOnceWith('/home');
    });
});
