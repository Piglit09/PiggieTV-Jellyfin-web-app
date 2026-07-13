export type PtvRequestOriginKind =
    | 'dev-static'
    | 'external'
    | 'jellyfin-media'
    | 'plugin-api';

export type PtvRequestOriginDetail = {
    origin: string;
    originKind: PtvRequestOriginKind;
    path: string;
};

type PtvUrlOriginOptions = {
    jellyfinRoot?: string | null;
    pluginRoot?: string | null;
};

const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const WEBPACK_DEV_PORTS = new Set(['8080', '8081']);

function getLocationOrigin() {
    return window.location.origin || `${window.location.protocol}//${window.location.host}`;
}

export function isPtvLocalDevHost(hostname = window.location.hostname) {
    return LOCAL_DEV_HOSTS.has(hostname.toLowerCase());
}

function isPrivateLanHost(hostname: string) {
    const normalizedHostname = hostname.toLowerCase();

    return /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalizedHostname)
        || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(normalizedHostname)
        || /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(normalizedHostname);
}

export function isPtvWebpackDevServerOrigin(
    hostname = window.location.hostname,
    port = window.location.port
) {
    const normalizedHostname = hostname.toLowerCase();

    return WEBPACK_DEV_PORTS.has(String(port || ''))
        && (
            isPtvLocalDevHost(normalizedHostname)
            || isPrivateLanHost(normalizedHostname)
        );
}

function normalizeAssetPath(assetPath: string) {
    return String(assetPath || '').trim().replace(/^\/+/, '');
}

function trimTrailingSlashes(value: string) {
    let nextValue = value;

    while (nextValue.endsWith('/')) {
        nextValue = nextValue.slice(0, -1);
    }

    return nextValue;
}

function isAbsoluteAssetUrl(url: string) {
    const lowerUrl = url.toLowerCase();

    return lowerUrl.startsWith('http://')
        || lowerUrl.startsWith('https://')
        || lowerUrl.startsWith('//')
        || lowerUrl.startsWith('data:')
        || lowerUrl.startsWith('blob:');
}

function getCurrentWebBasePath() {
    const pathname = window.location.pathname || '/';
    const webPathIndex = pathname.toLowerCase().indexOf('/web');

    if (webPathIndex === -1) return '/';

    return `${trimTrailingSlashes(pathname.slice(0, webPathIndex + '/web'.length))}/`;
}

export function getPtvStaticAssetBaseUrl() {
    if (!isPtvWebpackDevServerOrigin()) return '';

    return `${getLocationOrigin()}${getCurrentWebBasePath()}`;
}

export function resolvePtvStaticAssetUrl(assetUrl: string) {
    const value = String(assetUrl || '').trim();

    if (!value) return '';
    if (isAbsoluteAssetUrl(value) || value.startsWith('data:') || value.startsWith('blob:')) return value;

    const normalizedPath = normalizeAssetPath(value);
    const devStaticBaseUrl = getPtvStaticAssetBaseUrl();

    if (!devStaticBaseUrl) return normalizedPath;

    return `${trimTrailingSlashes(devStaticBaseUrl)}/${normalizedPath}`;
}

function getParsedUrl(url: string) {
    try {
        const anchor = document.createElement('a');

        anchor.href = url;

        return anchor;
    } catch {
        return null;
    }
}

function getAnchorOrigin(anchor: HTMLAnchorElement) {
    const port = anchor.port ? `:${anchor.port}` : '';

    return `${anchor.protocol}//${anchor.hostname}${port}`;
}

function haveSameOrigin(left: HTMLAnchorElement | null, right: HTMLAnchorElement | null) {
    return Boolean(left && right && getAnchorOrigin(left) === getAnchorOrigin(right));
}

function isPtvStaticAssetPath(pathname: string) {
    const path = pathname.toLowerCase();

    return path.includes('/assets/backgrounds/')
        || path.includes('/assets/icons/')
        || path.includes('/assets/logo/');
}

function isJellyfinMediaPath(pathname: string) {
    const path = pathname.toLowerCase();

    return path.startsWith('/items/')
        || path.startsWith('/users/')
        || path.startsWith('/videos/')
        || path.startsWith('/audio/')
        || path.startsWith('/web/')
        || path.startsWith('/assets/')
        || path.startsWith('/system/');
}

export function classifyPtvRequestUrl(url: string, options: PtvUrlOriginOptions = {}): PtvRequestOriginDetail {
    const parsedUrl = getParsedUrl(url);

    if (!parsedUrl) {
        return {
            origin: '',
            originKind: 'external',
            path: String(url || '')
        };
    }

    const pluginRoot = options.pluginRoot ? getParsedUrl(options.pluginRoot) : null;
    const jellyfinRoot = options.jellyfinRoot ? getParsedUrl(options.jellyfinRoot) : pluginRoot;
    const currentUrl = getParsedUrl(window.location.href);
    const pathname = parsedUrl.pathname || '';

    if (pathname.toLowerCase().includes('/ptv/')) {
        return {
            origin: getAnchorOrigin(parsedUrl),
            originKind: 'plugin-api',
            path: pathname
        };
    }

    if (haveSameOrigin(parsedUrl, pluginRoot) && pathname.toLowerCase().includes('/ptv/')) {
        return {
            origin: getAnchorOrigin(parsedUrl),
            originKind: 'plugin-api',
            path: pathname
        };
    }

    if (
        isPtvStaticAssetPath(pathname)
        && (
            isPtvLocalDevHost(parsedUrl.hostname)
            || isPtvWebpackDevServerOrigin(parsedUrl.hostname, parsedUrl.port)
            || (haveSameOrigin(parsedUrl, currentUrl) && isPtvWebpackDevServerOrigin(currentUrl?.hostname || '', currentUrl?.port || ''))
        )
    ) {
        return {
            origin: getAnchorOrigin(parsedUrl),
            originKind: 'dev-static',
            path: pathname
        };
    }

    if (
        isJellyfinMediaPath(pathname)
        && (
            haveSameOrigin(parsedUrl, jellyfinRoot)
            || !isPtvLocalDevHost(parsedUrl.hostname)
        )
    ) {
        return {
            origin: getAnchorOrigin(parsedUrl),
            originKind: 'jellyfin-media',
            path: pathname
        };
    }

    return {
        origin: getAnchorOrigin(parsedUrl),
        originKind: 'external',
        path: pathname
    };
}
