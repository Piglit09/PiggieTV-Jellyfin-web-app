import type { PtvBrowseDirectoryEntry } from './browseData';

export type PtvBrowseDirectorySection = Readonly<{
    entries: PtvBrowseDirectoryEntry[];
    letter: string;
}>;

function normalizeDirectoryValue(value: unknown) {
    return String(value || '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ');
}

export function getPtvBrowseDirectoryComparisonKey(value: unknown) {
    return normalizeDirectoryValue(value).toLocaleLowerCase('en-US');
}

export function getPtvBrowseDirectoryLetter(value: unknown) {
    const normalized = normalizeDirectoryValue(value);
    const latinLetter = /[A-Za-z0-9]/.exec(normalized)?.[0];
    const firstLetter = latinLetter || Array.from(normalized)[0] || '#';

    return firstLetter.toLocaleUpperCase('en-US');
}

export function filterPtvBrowseDirectoryEntries(
    entries: readonly PtvBrowseDirectoryEntry[],
    options: Readonly<{ hideEmpty: boolean; query: string }>
) {
    const query = getPtvBrowseDirectoryComparisonKey(options.query);

    return entries.filter(entry => (
        (!options.hideEmpty || entry.count > 0)
        && (!query || getPtvBrowseDirectoryComparisonKey(entry.name).includes(query))
    ));
}

export function groupPtvBrowseDirectoryEntries(
    entries: readonly PtvBrowseDirectoryEntry[]
) {
    const sections = new Map<string, PtvBrowseDirectoryEntry[]>();

    entries.forEach(entry => {
        const letter = getPtvBrowseDirectoryLetter(entry.name);
        const current = sections.get(letter) || [];

        current.push(entry);
        sections.set(letter, current);
    });

    return [...sections.entries()].map(([letter, sectionEntries]) => ({
        entries: sectionEntries,
        letter
    })).sort((left, right) => left.letter.localeCompare(right.letter, 'en-US'));
}

export function mergePtvBrowseDirectoryRecents(
    current: readonly string[],
    selected: string,
    limit = 8
) {
    const normalizedSelected = normalizeDirectoryValue(selected);
    const selectedKey = getPtvBrowseDirectoryComparisonKey(normalizedSelected);

    if (!selectedKey) return current.slice(0, limit);

    return [
        normalizedSelected,
        ...current.filter(value => getPtvBrowseDirectoryComparisonKey(value) !== selectedKey)
    ].slice(0, limit);
}

