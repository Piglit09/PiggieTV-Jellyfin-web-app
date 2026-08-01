import { getPtvDisplayIdentityKey } from '../../services/displayIdentity';

type PtvSearchHistoryStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

const PTV_SEARCH_HISTORY_PREFIX = 'ptv:search:recent:v2';
const PTV_SEARCH_HISTORY_LIMIT = 8;
const PTV_SEARCH_QUERY_MAX_LENGTH = 160;

function getSearchHistoryStorage(storage?: PtvSearchHistoryStorage | null) {
    if (storage !== undefined) return storage;

    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function normalizeRecentSearch(value: unknown) {
    if (typeof value !== 'string') return '';

    return value.trim().slice(0, PTV_SEARCH_QUERY_MAX_LENGTH);
}

function normalizeRecentSearches(value: unknown) {
    if (!Array.isArray(value)) return null;

    const seen = new Set<string>();

    return value.reduce<string[]>((recent, entry) => {
        const normalized = normalizeRecentSearch(entry);
        const identity = normalized.toLowerCase();

        if (normalized.length < 2 || seen.has(identity) || recent.length >= PTV_SEARCH_HISTORY_LIMIT) {
            return recent;
        }

        seen.add(identity);
        recent.push(normalized);
        return recent;
    }, []);
}

export function getPtvSearchHistoryKey(serverId: unknown, userId: unknown) {
    const identity = getPtvDisplayIdentityKey(serverId, userId);

    return identity ? `${PTV_SEARCH_HISTORY_PREFIX}:${identity}` : null;
}

export function loadPtvRecentSearches(
    serverId: unknown,
    userId: unknown,
    storage?: PtvSearchHistoryStorage | null
) {
    const key = getPtvSearchHistoryKey(serverId, userId);
    const resolvedStorage = getSearchHistoryStorage(storage);

    if (!key || !resolvedStorage) return [];

    try {
        const raw = resolvedStorage.getItem(key);

        if (!raw) return [];

        const parsed = normalizeRecentSearches(JSON.parse(raw) as unknown);

        if (parsed) return parsed;

        resolvedStorage.removeItem(key);
        return [];
    } catch {
        try {
            resolvedStorage.removeItem(key);
        } catch {
            // Invalid optional history must never block Search.
        }

        return [];
    }
}

export function savePtvRecentSearch(
    query: string,
    serverId: unknown,
    userId: unknown,
    storage?: PtvSearchHistoryStorage | null
) {
    const normalized = normalizeRecentSearch(query);
    const key = getPtvSearchHistoryKey(serverId, userId);
    const resolvedStorage = getSearchHistoryStorage(storage);

    if (normalized.length < 2 || !key) return loadPtvRecentSearches(serverId, userId, resolvedStorage);

    const recent = loadPtvRecentSearches(serverId, userId, resolvedStorage);
    const next = [
        normalized,
        ...recent.filter(entry => entry.toLowerCase() !== normalized.toLowerCase())
    ].slice(0, PTV_SEARCH_HISTORY_LIMIT);

    try {
        resolvedStorage?.setItem(key, JSON.stringify(next));
    } catch {
        // Recent history remains usable in memory when optional persistence fails.
    }

    return next;
}

export function clearPtvRecentSearches(
    serverId: unknown,
    userId: unknown,
    storage?: PtvSearchHistoryStorage | null
) {
    const key = getPtvSearchHistoryKey(serverId, userId);
    const resolvedStorage = getSearchHistoryStorage(storage);

    if (!key || !resolvedStorage) return false;

    try {
        resolvedStorage.removeItem(key);
        return true;
    } catch {
        return false;
    }
}
