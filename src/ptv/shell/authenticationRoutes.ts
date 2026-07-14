export type PtvAuthenticationRouteKind = 'login' | 'signup';

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
