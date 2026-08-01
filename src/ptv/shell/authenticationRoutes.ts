export type PtvAuthenticationRouteKind = 'login' | 'signup';
export const PTV_CURRENT_SETTINGS_REDIRECT = 'current-settings';

type PtvAuthenticationLocation = string | {
    full?: string;
    hash?: string;
    path?: string;
    pathname?: string;
    search?: string;
};

const LOGIN_ROUTE_PATHS = new Set([
    '/addserver',
    '/forgotpassword',
    '/forgotpasswordpin',
    '/login',
    '/manual',
    '/manuallogin',
    '/quickconnect',
    '/resetpassword',
    '/selectserver'
]);

const SIGNUP_ROUTE_PATHS = new Set([
    '/ptv/signup',
    '/signup'
]);

const SAFE_CONTENT_ROUTE_PATHS = new Set([
    '/books',
    '/comics',
    '/details',
    '/home',
    '/homevideos',
    '/list',
    '/livetv',
    '/maga',
    '/manga',
    '/movies',
    '/music',
    '/reading',
    '/recommendations',
    '/recomendations',
    '/search',
    '/tv'
]);

const TRANSIENT_ROUTE_PATHS = new Set([
    '/lyrics',
    '/logout',
    '/music/player',
    '/queue',
    '/video'
]);

const BLOCKED_ROUTE_PREFIXES = [
    '/configurationpage',
    '/dashboard',
    '/devices',
    '/diagnostics',
    '/logs',
    '/plugins',
    '/ptv/diagnostics',
    '/scheduledtasks',
    '/serveractivity',
    '/users'
];

const SETTINGS_ROUTE_PREFIXES = [
    '/mypreferences',
    '/settings',
    '/userprofile'
];

function decodeRoutePath(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function normalizeRoutePath(value: string): string {
    const path = decodeRoutePath(
        String(value || '')
            .trim()
            .replace(/^[#!]+/, '')
            .split(/[?#]/, 1)[0]
    )
        .replace(/\\/g, '/')
        .replace(/\/{2,}/g, '/')
        .replace(/\/$/, '')
        .toLowerCase();

    if (!path) return '/';

    const normalized = path.startsWith('/') ? path : `/${path}`;

    return normalized.replace(/\.html$/, '');
}

function matchesRoute(path: string, candidate: string) {
    return path === candidate || path.startsWith(`${candidate}/`);
}

function isSettingsRoute(path: string) {
    return SETTINGS_ROUTE_PREFIXES.some(prefix => (
        path === prefix || path.startsWith(prefix)
    ));
}

function isSafeContentRoute(path: string) {
    return [...SAFE_CONTENT_ROUTE_PATHS].some(candidate => matchesRoute(path, candidate));
}

function normalizePostLoginTarget(value?: string | null) {
    if (!value) return null;

    let decoded = String(value).trim();
    try {
        decoded = decodeURIComponent(decoded);
    } catch {
        return null;
    }

    if (
        !decoded
        || decoded.includes('\\')
        || decoded.includes('\0')
        || /^[a-z][a-z\d+.-]*:/i.test(decoded)
        || decoded.startsWith('//')
    ) {
        return null;
    }

    const hashIndex = decoded.indexOf('#');
    if (hashIndex >= 0) decoded = decoded.slice(hashIndex + 1);
    decoded = decoded.replace(/^!/, '');
    if (!decoded.startsWith('/')) decoded = `/${decoded}`;

    const queryIndex = decoded.indexOf('?');
    const rawPath = queryIndex >= 0 ? decoded.slice(0, queryIndex) : decoded;
    const search = queryIndex >= 0 ? decoded.slice(queryIndex) : '';
    const path = normalizeRoutePath(rawPath);

    return {
        full: `${path}${search}`,
        path
    };
}

export function getPtvPostLoginRoute(
    value?: string | null,
    options: Readonly<{ allowCurrentSettings?: boolean }> = {}
) {
    const target = normalizePostLoginTarget(value);

    if (!target) return '/home';
    if (target.path === '/home') return target.full;
    if (isSettingsRoute(target.path)) {
        return options.allowCurrentSettings ? target.full : '/home';
    }
    if (LOGIN_ROUTE_PATHS.has(target.path) || SIGNUP_ROUTE_PATHS.has(target.path)) return '/home';
    if (TRANSIENT_ROUTE_PATHS.has(target.path)) return '/home';
    if (BLOCKED_ROUTE_PREFIXES.some(prefix => matchesRoute(target.path, prefix))) return '/home';

    return isSafeContentRoute(target.path) ? target.full : '/home';
}

export function getPtvPostLoginRouteWithHashFallback(
    value?: string | null,
    currentHash?: string | null,
    options: Readonly<{ allowCurrentSettings?: boolean }> = {}
) {
    return getPtvPostLoginRoute(value || currentHash, options);
}

export function getPtvLoginRedirectDecision(
    value?: string | null,
    options: Readonly<{ explicitCurrentAttempt?: boolean }> = {}
) {
    const target = normalizePostLoginTarget(value);
    const restoresCurrentSettings = Boolean(
        target
        && isSettingsRoute(target.path)
        && options.explicitCurrentAttempt
    );
    const route = getPtvPostLoginRoute(value, {
        allowCurrentSettings: restoresCurrentSettings
    });
    let reason = 'safe-content-route';

    if (!target) reason = 'invalid-or-empty-route';
    else if (restoresCurrentSettings) reason = 'explicit-current-settings';
    else if (isSettingsRoute(target.path)) reason = 'rejected-stale-settings';
    else if (route === '/home' && target.path !== '/home') reason = 'rejected-protected-or-unknown-route';
    else if (target.path === '/home') reason = 'home-default';

    return {
        reason,
        restoresCurrentSettings,
        route
    } as const;
}

export function createPtvPostLoginNavigationGuard() {
    let committed = false;

    return <T>(navigate: () => T): T | undefined => {
        if (committed) return undefined;

        committed = true;
        return navigate();
    };
}

function collectRoutePaths(location: PtvAuthenticationLocation): string[] {
    const rawValues = typeof location === 'string' ?
        [location] :
        [location.pathname, location.path, location.hash, location.full];
    const paths = new Set<string>();

    rawValues.filter(Boolean).forEach(rawValue => {
        const value = String(rawValue);
        const hashIndex = value.indexOf('#');

        paths.add(normalizeRoutePath(hashIndex >= 0 ? value.slice(0, hashIndex) : value));

        if (hashIndex >= 0) {
            paths.add(normalizeRoutePath(value.slice(hashIndex + 1)));
        }
    });

    return [...paths];
}

export function getPtvAuthenticationRouteKind(
    location: PtvAuthenticationLocation
): PtvAuthenticationRouteKind | null {
    const paths = collectRoutePaths(location);

    if (paths.some(path => SIGNUP_ROUTE_PATHS.has(path))) {
        return 'signup';
    }

    if (paths.some(path => LOGIN_ROUTE_PATHS.has(path))) {
        return 'login';
    }

    return null;
}

export function isPtvAuthenticationRoute(location: PtvAuthenticationLocation): boolean {
    return getPtvAuthenticationRouteKind(location) !== null;
}

export function isPtvLoginRoute(location: PtvAuthenticationLocation): boolean {
    return getPtvAuthenticationRouteKind(location) === 'login';
}

export function shouldMountPtvAuthenticatedHeader(location: PtvAuthenticationLocation): boolean {
    return !isPtvAuthenticationRoute(location);
}
