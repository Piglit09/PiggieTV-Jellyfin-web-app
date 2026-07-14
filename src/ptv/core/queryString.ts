export type PtvQueryStringEntry = readonly [string, string];

function decodePtvQueryValue(value: string) {
    try {
        return decodeURIComponent(value.replace(/\+/g, ' '));
    } catch {
        return value;
    }
}

export function parsePtvQueryString(search: string): PtvQueryStringEntry[] {
    const query = String(search || '').replace(/^\?/, '');

    if (!query) return [];

    return query.split('&').map(part => {
        const separatorIndex = part.indexOf('=');
        const rawKey = separatorIndex >= 0 ? part.slice(0, separatorIndex) : part;
        const rawValue = separatorIndex >= 0 ? part.slice(separatorIndex + 1) : '';

        return [decodePtvQueryValue(rawKey), decodePtvQueryValue(rawValue)] as const;
    });
}

export function getPtvQueryStringValue(entries: PtvQueryStringEntry[], key: string) {
    return entries.find(entry => entry[0] === key)?.[1] || '';
}

export function serializePtvQueryString(entries: PtvQueryStringEntry[], sort = false) {
    const filteredEntries = entries.filter(entry => entry[0] && entry[1]);
    const orderedEntries = sort ? [...filteredEntries].sort((left, right) => (
        left[0].localeCompare(right[0]) || left[1].localeCompare(right[1])
    )) : filteredEntries;

    return orderedEntries.map(([key, value]) => (
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )).join('&');
}
