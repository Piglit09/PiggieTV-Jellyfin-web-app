import { PTV_CORE_CONTRACT_VERSION, type PtvCoreContractVersion } from '../contracts/version';
import {
    createPtvCoreError,
    ptvCoreFailure,
    ptvCoreSuccess,
    type PtvCoreResult
} from '../errors/coreError';

export const PTV_NAVIGATION_DESTINATIONS = [
    'home',
    'movies',
    'shows',
    'music',
    'reading',
    'live-tv',
    'search',
    'requests',
    'library',
    'details',
    'player',
    'settings',
    'profile',
    'diagnostics'
] as const;

export type PtvNavigationDestination = typeof PTV_NAVIGATION_DESTINATIONS[number];
export type PtvNavigationBackBehavior = 'default' | 'modal' | 'preserve' | 'replace';

export type PtvNavigationIntent = Readonly<{
    backBehavior: PtvNavigationBackBehavior;
    contractVersion: PtvCoreContractVersion;
    deepLink?: string;
    destination: PtvNavigationDestination;
    libraryId?: string;
    mediaId?: string;
    query: Readonly<Record<string, string>>;
    requiredCapabilities: readonly string[];
}>;

const DESTINATION_SET = new Set<string>(PTV_NAVIGATION_DESTINATIONS);
const DESTINATION_ALIASES: Record<string, PtvNavigationDestination> = {
    details: 'details',
    diagnostics: 'diagnostics',
    home: 'home',
    library: 'library',
    livetv: 'live-tv',
    liveTv: 'live-tv',
    movies: 'movies',
    music: 'music',
    player: 'player',
    profile: 'profile',
    reading: 'reading',
    recommendations: 'home',
    requests: 'requests',
    search: 'search',
    settings: 'settings',
    shows: 'shows'
};

function trimRouteSeparators(value: string) {
    let result = value;
    while (result.startsWith('/')) result = result.slice(1);
    while (result.endsWith('/')) result = result.slice(0, -1);

    return result;
}

function normalizeDestination(value: unknown): PtvNavigationDestination | null {
    if (typeof value !== 'string') return null;
    const trimmed = trimRouteSeparators(value.trim());

    return DESTINATION_SET.has(trimmed) ?
        trimmed as PtvNavigationDestination :
        DESTINATION_ALIASES[trimmed] || null;
}

function navigationError(code: string, message: string, detail?: string) {
    return createPtvCoreError({
        code,
        developerDetail: detail,
        kind: 'validation',
        message,
        operation: 'navigation-intent'
    });
}

export function createPtvNavigationIntent(options: Readonly<{
    backBehavior?: PtvNavigationBackBehavior;
    deepLink?: string;
    destination: PtvNavigationDestination | string;
    libraryId?: string;
    mediaId?: string;
    query?: Readonly<Record<string, string>>;
    requiredCapabilities?: readonly string[];
}>): PtvCoreResult<PtvNavigationIntent> {
    const destination = normalizeDestination(options.destination);
    if (!destination) {
        return ptvCoreFailure(navigationError(
            'NAVIGATION_DESTINATION_INVALID',
            'That destination is not available.',
            String(options.destination)
        ));
    }
    if ((destination === 'details' || destination === 'player') && !options.mediaId?.trim()) {
        return ptvCoreFailure(navigationError(
            'NAVIGATION_MEDIA_ID_REQUIRED',
            'A media item is required for that destination.',
            destination
        ));
    }

    return ptvCoreSuccess({
        backBehavior: options.backBehavior || 'default',
        contractVersion: PTV_CORE_CONTRACT_VERSION,
        deepLink: options.deepLink,
        destination,
        libraryId: options.libraryId?.trim() || undefined,
        mediaId: options.mediaId?.trim() || undefined,
        query: { ...options.query },
        requiredCapabilities: Array.from(new Set(options.requiredCapabilities || []))
    });
}

function isDeepLinkScheme(value: string) {
    if (!value) return false;
    const firstCharacter = value.charAt(0).toLowerCase();
    if (firstCharacter < 'a' || firstCharacter > 'z') return false;

    return Array.from(value.slice(1)).every(character => {
        const lowerCaseCharacter = character.toLowerCase();
        const isLetter = lowerCaseCharacter >= 'a' && lowerCaseCharacter <= 'z';
        const isNumber = character >= '0' && character <= '9';

        return isLetter || isNumber || ['+', '-', '.'].includes(character);
    });
}

function safeDecodeQueryComponent(value: string) {
    try {
        return decodeURIComponent(value.split('+').join(' '));
    } catch {
        return value;
    }
}

function parseQuery(value: string) {
    return value.split('&').reduce<Record<string, string>>((result, pair) => {
        if (!pair) return result;
        const separatorIndex = pair.indexOf('=');
        const rawKey = separatorIndex >= 0 ? pair.slice(0, separatorIndex) : pair;
        const rawValue = separatorIndex >= 0 ? pair.slice(separatorIndex + 1) : '';
        result[safeDecodeQueryComponent(rawKey)] = safeDecodeQueryComponent(rawValue);

        return result;
    }, {});
}

function parsePathAndQuery(value: string): {
    path: string;
    searchParams: Readonly<Record<string, string>>;
} | null {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const hashRoute = trimmed.includes('#') ? trimmed.slice(trimmed.indexOf('#') + 1) : '';
    let route = hashRoute || trimmed;
    if (route.startsWith('!')) route = route.slice(1);
    while (route.startsWith('/') || route.startsWith('#')) route = route.slice(1);
    const schemeSeparatorIndex = route.indexOf('://');
    if (schemeSeparatorIndex >= 0) {
        const scheme = route.slice(0, schemeSeparatorIndex);
        if (!isDeepLinkScheme(scheme)) return null;
        route = route.slice(schemeSeparatorIndex + 3);
    }

    const [path, query = ''] = route.split('?', 2);

    return {
        path: trimRouteSeparators(path),
        searchParams: parseQuery(query)
    };
}

export function parsePtvNavigationDeepLink(value: string): PtvCoreResult<PtvNavigationIntent> {
    const parsed = parsePathAndQuery(value);
    if (!parsed) {
        return ptvCoreFailure(navigationError(
            'NAVIGATION_DEEP_LINK_INVALID',
            'That link could not be opened.'
        ));
    }

    const segments = parsed.path.split('/').filter(Boolean);
    const destination = normalizeDestination(segments[0]);
    const mediaId = parsed.searchParams.mediaId
        || parsed.searchParams.itemId
        || parsed.searchParams.id
        || ((destination === 'details' || destination === 'player') ? segments[1] : null);
    const libraryId = parsed.searchParams.libraryId || parsed.searchParams.parentId;
    const query: Record<string, string> = {};
    Object.entries(parsed.searchParams).forEach(([key, entry]) => {
        if (!['id', 'itemId', 'libraryId', 'mediaId', 'parentId'].includes(key)) query[key] = entry;
    });

    return createPtvNavigationIntent({
        deepLink: value,
        destination: destination || segments[0] || '',
        libraryId: libraryId || undefined,
        mediaId: mediaId || undefined,
        query
    });
}
