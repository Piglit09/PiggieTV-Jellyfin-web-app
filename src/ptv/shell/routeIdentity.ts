import { parsePtvQueryString, serializePtvQueryString } from '../core/queryString';

function normalizeRoutePath(path: string) {
    const value = String(path || '').trim().replace(/^#/, '').split('?')[0];

    if (!value) return '';

    return (value.startsWith('/') ? value : `/${value}`).toLowerCase();
}

export function getPtvCanonicalRouteIdentity(hash: string, fallbackPath = '') {
    const normalizedHash = String(hash || '').replace(/^#/, '');
    const queryIndex = normalizedHash.indexOf('?');
    const path = normalizeRoutePath(queryIndex >= 0 ? normalizedHash.slice(0, queryIndex) : normalizedHash)
        || normalizeRoutePath(fallbackPath);
    const entries = parsePtvQueryString(queryIndex >= 0 ? normalizedHash.slice(queryIndex + 1) : '');
    const search = serializePtvQueryString(entries, true);
    const suffix = search ? `?${search}` : '';

    return `${path}${suffix}`;
}
