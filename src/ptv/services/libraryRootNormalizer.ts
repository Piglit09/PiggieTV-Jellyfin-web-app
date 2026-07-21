type PtvLibraryRootInput = Record<string, unknown>;

export type PtvNormalizedLibraryRoot = Readonly<{
    libraryId: string;
    logicalRoot: string;
    physicalRoot: string;
    source: 'collection-name' | 'collection-type' | 'library-id' | 'path' | 'type' | 'unknown';
}>;

export type PtvLibraryRootDiagnostic = Readonly<{
    itemCount: number;
    libraryIds: string[];
    logicalRoot: string;
    physicalRoots: string[];
}>;

export type PtvLibraryRootDiagnostics = Readonly<{
    deduplicatedCount: number;
    groups: PtvLibraryRootDiagnostic[];
    inputCount: number;
    outputCount: number;
}>;

const ROOT_LABELS: Record<string, string> = {
    anime: 'Anime',
    animemovies: 'Anime Movies',
    books: 'Books',
    cartoons: 'Cartoons',
    comics: 'Comics',
    manga: 'Manga',
    movies: 'Movies',
    music: 'Music',
    shows: 'Shows',
    tv: 'Shows'
};
const rootMappingCache = new Map<string, PtvNormalizedLibraryRoot>();
const MAX_ROOT_MAPPING_CACHE_ENTRIES = 512;

function getText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function getFirstText(item: PtvLibraryRootInput, fields: string[]) {
    for (const field of fields) {
        const value = getText(item[field]);

        if (value) return value;
    }

    return '';
}

function normalizeKey(value: string) {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizePath(value: string) {
    return value.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
}

function getRootLabel(value: string) {
    return ROOT_LABELS[normalizeKey(value)] || '';
}

function getPathRoot(path: string) {
    const normalizedPath = normalizePath(path);
    const segments = normalizedPath.split('/').map(segment => segment.trim()).filter(Boolean);

    for (let index = segments.length - 1; index >= 0; index--) {
        const logicalRoot = getRootLabel(segments[index]);

        if (logicalRoot) {
            const prefix = segments.slice(0, index + 1).join('/');
            const physicalRoot = normalizedPath.startsWith('//') ? `//${prefix}` : normalizedPath.startsWith('/') ? `/${prefix}` : prefix;

            return { logicalRoot, physicalRoot };
        }
    }

    return { logicalRoot: '', physicalRoot: '' };
}

function getTypeRoot(item: PtvLibraryRootInput) {
    const type = normalizeKey(getFirstText(item, ['CollectionType', 'MediaType', 'Type']));

    if (type === 'movie' || type === 'movies') return 'Movies';
    if (type === 'series' || type === 'episode' || type === 'tvshows') return 'Shows';
    if (type === 'audio' || type === 'musicalbum' || type === 'musicartist' || type === 'music') return 'Music';
    if (type === 'book') return 'Books';

    return getRootLabel(type);
}

function getLibraryRootCacheKey(item: PtvLibraryRootInput) {
    return [
        getFirstText(item, ['TopParentId', 'LibraryId', 'CollectionFolderId']),
        getFirstText(item, ['CollectionFolderName', 'CollectionName', 'LibraryName']),
        getFirstText(item, ['CollectionType', 'MediaType', 'Type']),
        getFirstText(item, ['Path'])
    ].join('|');
}

function cacheRootMapping(key: string, root: PtvNormalizedLibraryRoot) {
    if (!key) return;

    rootMappingCache.set(key, root);

    while (rootMappingCache.size > MAX_ROOT_MAPPING_CACHE_ENTRIES) {
        const oldestKey = rootMappingCache.keys().next().value as string | undefined;

        if (!oldestKey) return;
        rootMappingCache.delete(oldestKey);
    }
}

export function normalizePtvLibraryRoot(item: PtvLibraryRootInput): PtvNormalizedLibraryRoot {
    const cacheKey = getLibraryRootCacheKey(item);
    const cached = rootMappingCache.get(cacheKey);

    if (cached) return cached;

    const libraryId = getFirstText(item, ['TopParentId', 'LibraryId', 'CollectionFolderId', 'ParentId']);
    const collectionName = getFirstText(item, ['CollectionFolderName', 'CollectionName', 'LibraryName']);
    const namedRoot = getRootLabel(collectionName) || collectionName;
    const pathRoot = getPathRoot(getFirstText(item, ['Path']));
    const collectionTypeRoot = getRootLabel(getFirstText(item, ['CollectionType']));
    const typeRoot = getTypeRoot(item);
    const root = namedRoot ? {
        libraryId,
        logicalRoot: namedRoot,
        physicalRoot: pathRoot.physicalRoot,
        source: 'collection-name' as const
    } : pathRoot.logicalRoot ? {
        libraryId,
        logicalRoot: pathRoot.logicalRoot,
        physicalRoot: pathRoot.physicalRoot,
        source: 'path' as const
    } : collectionTypeRoot ? {
        libraryId,
        logicalRoot: collectionTypeRoot,
        physicalRoot: '',
        source: 'collection-type' as const
    } : libraryId ? {
        libraryId,
        logicalRoot: `Library ${libraryId}`,
        physicalRoot: '',
        source: 'library-id' as const
    } : typeRoot ? {
        libraryId: '',
        logicalRoot: typeRoot,
        physicalRoot: '',
        source: 'type' as const
    } : {
        libraryId: '',
        logicalRoot: 'Unknown',
        physicalRoot: '',
        source: 'unknown' as const
    };

    cacheRootMapping(cacheKey, root);
    return root;
}

function getPathHash(value: string) {
    let hash = 2_166_136_261;

    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16_777_619);
    }

    return (hash >>> 0).toString(36);
}

function getMediaIdentityType(item: PtvLibraryRootInput) {
    return normalizeKey(getFirstText(item, ['Type', 'MediaType', 'CollectionType'])) || 'unknown';
}

function getProviderIdentities(item: PtvLibraryRootInput) {
    const providerIds = item.ProviderIds;

    if (!providerIds || typeof providerIds !== 'object' || Array.isArray(providerIds)) return [];

    const mediaType = getMediaIdentityType(item);

    return Object.entries(providerIds as Record<string, unknown>)
        .map(([provider, value]) => {
            const providerId = getText(value);

            return providerId ? `provider:${mediaType}:${normalizeKey(provider)}:${providerId.toLowerCase()}` : '';
        })
        .filter(Boolean)
        .sort((left, right) => {
            const leftPriority = /:(?:tmdb|imdb):/.test(left) ? 0 : 1;
            const rightPriority = /:(?:tmdb|imdb):/.test(right) ? 0 : 1;

            return leftPriority - rightPriority || left.localeCompare(right);
        });
}

export function getPtvLogicalRelativeMediaPath(item: PtvLibraryRootInput) {
    const path = getFirstText(item, ['Path']);

    if (!path) return '';

    const normalizedPath = normalizePath(path).toLowerCase();
    const segments = normalizedPath.split('/').map(segment => segment.trim()).filter(Boolean);

    for (let index = segments.length - 1; index >= 0; index--) {
        const logicalRoot = getRootLabel(segments[index]);

        if (logicalRoot) {
            return [logicalRoot.toLowerCase(), ...segments.slice(index + 1)].join('/');
        }
    }

    return normalizedPath;
}

export function getPtvLibraryItemIdentityCandidates(item: PtvLibraryRootInput) {
    const identities: string[] = [];
    const itemId = getFirstText(item, ['Id', 'ItemId']);

    if (itemId) identities.push(`item:${itemId}`);

    identities.push(...getProviderIdentities(item));

    const presentationUniqueKey = getFirstText(item, ['PresentationUniqueKey']);

    if (presentationUniqueKey) identities.push(`presentation:${presentationUniqueKey}`);

    const relativePath = getPtvLogicalRelativeMediaPath(item);

    if (relativePath) identities.push(`path:${getPathHash(relativePath)}`);

    return identities;
}

export function getPtvLibraryItemIdentity(item: PtvLibraryRootInput) {
    return getPtvLibraryItemIdentityCandidates(item)[0] || '';
}

export function normalizePtvLibraryItems<TItem extends PtvLibraryRootInput>(items: TItem[]) {
    const seen = new Set<string>();
    const groups = new Map<string, {
        itemCount: number;
        libraryIds: Set<string>;
        logicalRoot: string;
        physicalRoots: Set<string>;
    }>();
    const normalizedItems: TItem[] = [];

    items.forEach((item, index) => {
        const identities = getPtvLibraryItemIdentityCandidates(item);
        const identity = identities[0] || `unidentified:${index}`;

        if (identities.some(candidate => seen.has(candidate))) return;

        seen.add(identity);
        identities.forEach(candidate => seen.add(candidate));
        normalizedItems.push(item);

        const root = normalizePtvLibraryRoot(item);
        const groupKey = root.logicalRoot.toLowerCase();
        const group = groups.get(groupKey) || {
            itemCount: 0,
            libraryIds: new Set<string>(),
            logicalRoot: root.logicalRoot,
            physicalRoots: new Set<string>()
        };

        group.itemCount += 1;
        if (root.libraryId) group.libraryIds.add(root.libraryId);
        if (root.physicalRoot) group.physicalRoots.add(root.physicalRoot);
        groups.set(groupKey, group);
    });

    return {
        diagnostics: {
            deduplicatedCount: items.length - normalizedItems.length,
            groups: [...groups.values()].map(group => ({
                itemCount: group.itemCount,
                libraryIds: [...group.libraryIds].sort(),
                logicalRoot: group.logicalRoot,
                physicalRoots: [...group.physicalRoots].sort()
            })).sort((left, right) => left.logicalRoot.localeCompare(right.logicalRoot)),
            inputCount: items.length,
            outputCount: normalizedItems.length
        } satisfies PtvLibraryRootDiagnostics,
        items: normalizedItems
    };
}

export function resetPtvLibraryRootNormalizerForTests() {
    rootMappingCache.clear();
}
