import type { PtvBrowseRoute } from './browseRoute';

export type PtvFocusedBrowseLoaderScope = Readonly<{
    alias: string;
    libraryIds: string[];
    status: 'error' | 'resolved' | 'unscoped';
}>;

export type PtvFocusedBrowseLoadToken = Readonly<{
    key: string;
    sequence: number;
}>;

const SAFE_SCOPE_ALIASES = new Set(['anime', 'animemovies', 'cartoons']);

function normalizeDisplayValue(value: unknown) {
    return String(value || '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ');
}

function normalizeIdentityValue(value: unknown) {
    return normalizeDisplayValue(value).toLocaleLowerCase('en-US');
}

function normalizeIdentityList(values: readonly string[]) {
    return values
        .map(normalizeIdentityValue)
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right));
}

function getStableDiagnosticFingerprint(value: string) {
    let hash = 0x811c9dc5;

    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }

    return (hash >>> 0).toString(36);
}

function getSafeScopeLabel(route: PtvBrowseRoute, scope: PtvFocusedBrowseLoaderScope) {
    const alias = normalizeIdentityValue(route.scopeAlias || scope.alias);

    if (!alias) return 'unscoped';
    if (SAFE_SCOPE_ALIASES.has(alias)) return alias;
    if (scope.status === 'error') return 'scope-error';

    return 'scoped';
}

function getSafeFilterLabel(route: PtvBrowseRoute) {
    if (route.filterType === 'query') {
        const query = normalizeIdentityValue(route.query);

        return query ? `query-${getStableDiagnosticFingerprint(query)}` : 'none';
    }

    if (route.filterType === 'collection') {
        const collectionId = normalizeIdentityValue(route.collectionId);

        return collectionId ? `collection-${getStableDiagnosticFingerprint(collectionId)}` : 'none';
    }

    return normalizeDisplayValue(route.filterValue) || 'none';
}

function encodeLoaderSegment(value: unknown) {
    return encodeURIComponent(String(value));
}

/**
 * Internal request identity. Stable IDs are intentionally allowed here because
 * this value never leaves the browser runtime or focused-page cache.
 */
export function getPtvFocusedBrowseLoaderKey(
    route: PtvBrowseRoute,
    scope: PtvFocusedBrowseLoaderScope,
    resolvedMetadataIds: string | readonly string[] = []
) {
    const metadataIds = Array.isArray(resolvedMetadataIds) ? resolvedMetadataIds : [resolvedMetadataIds];

    return JSON.stringify([
        'focused-browse-v1',
        normalizeIdentityValue(route.kind),
        normalizeIdentityValue(route.view),
        normalizeIdentityValue(route.scopeAlias || scope.alias) || 'unscoped',
        scope.status,
        normalizeIdentityList(scope.libraryIds),
        normalizeIdentityValue(route.collectionId),
        normalizeIdentityValue(route.seasonParentId),
        normalizeIdentityValue(route.genre),
        normalizeIdentityValue(route.studio),
        normalizeIdentityValue(route.network),
        normalizeIdentityList(metadataIds),
        normalizeIdentityValue(route.query),
        normalizeIdentityValue(route.sortBy),
        normalizeIdentityValue(route.sortOrder),
        route.page,
        route.page * route.pageSize,
        route.pageSize
    ]);
}

/**
 * Shareable diagnostic identity. Exact named filters remain useful, while raw
 * Jellyfin library, collection, series, and resolved metadata IDs are omitted.
 */
export function getPtvFocusedBrowseDiagnosticLoaderKey(
    route: PtvBrowseRoute,
    scope: PtvFocusedBrowseLoaderScope
) {
    const segments: unknown[] = [
        route.kind,
        route.view,
        route.filterType,
        getSafeScopeLabel(route, scope),
        getSafeFilterLabel(route),
        route.sortBy,
        route.sortOrder,
        route.page * route.pageSize,
        route.pageSize
    ];

    return segments.map(encodeLoaderSegment).join(':');
}

/**
 * Owns the currently active focused load. Jellyfin's item API does not expose
 * an AbortSignal, so retired tokens provide deterministic stale-result
 * suppression when a route changes while an older request is still running.
 */
export class PtvFocusedBrowseLoadOwner {
    private activeToken: PtvFocusedBrowseLoadToken | null = null;
    private sequence = 0;

    begin(key: string): PtvFocusedBrowseLoadToken {
        this.sequence += 1;
        const token = {
            key,
            sequence: this.sequence
        };

        this.activeToken = token;
        return token;
    }

    isActive(token: PtvFocusedBrowseLoadToken) {
        return this.activeToken?.key === token.key
            && this.activeToken.sequence === token.sequence;
    }

    retire(token: PtvFocusedBrowseLoadToken) {
        if (this.isActive(token)) this.activeToken = null;
    }
}
