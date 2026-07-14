import type { PtvBrowseDirectoryEntry } from './browseData';

export type PtvGenreDirectoryMode = 'all' | 'curated';

export type PtvGenreDirectoryGroup = Readonly<{
    count: number;
    displayName: string;
    entries: PtvBrowseDirectoryEntry[];
    key: string;
    letter: string;
    sensitive: boolean;
}>;

export type PtvGenreDirectorySection = Readonly<{
    groups: PtvGenreDirectoryGroup[];
    letter: string;
}>;

type PtvGenrePresentationGroup = Readonly<{
    displayName: string;
    key: string;
    values: readonly string[];
}>;

const PTV_GENRE_PRESENTATION_GROUPS: readonly PtvGenrePresentationGroup[] = [
    {
        displayName: 'Action & Adventure',
        key: 'action-adventure',
        values: ['action & adventure', 'action and adventure']
    },
    {
        displayName: 'Kids & Family',
        key: 'kids-family',
        values: ['kids & family', 'kids and family']
    },
    {
        displayName: 'Science Fiction',
        key: 'science-fiction',
        values: ['sci fi', 'sci-fi', 'science fiction', 'science-fiction']
    }
];

const PTV_SENSITIVE_GENRE_VALUES = new Set([
    'adult',
    'ecchi',
    'erotica',
    'hentai',
    'pornography',
    'sexploitation',
    'yaoi',
    'yuri'
]);

const PTV_GENRE_ACRONYMS: Readonly<Record<string, string>> = {
    'ai': 'AI',
    'lgbt': 'LGBT',
    'lgbtq': 'LGBTQ',
    'r&b': 'R&B',
    'tv': 'TV'
};

const PTV_GENRE_LOWERCASE_WORDS = new Set(['and', 'of', 'the']);

function normalizeGenreValue(value: unknown) {
    return String(value || '')
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ');
}

export function getPtvGenreExactIdentity(value: unknown) {
    return normalizeGenreValue(value).toLocaleLowerCase('en-US');
}

function getPresentationGroup(identity: string) {
    return PTV_GENRE_PRESENTATION_GROUPS.find(group => group.values.includes(identity)) || null;
}

function formatGenreWord(value: string, index: number) {
    const identity = value.toLocaleLowerCase('en-US');

    if (PTV_GENRE_ACRONYMS[identity]) return PTV_GENRE_ACRONYMS[identity];
    if (index > 0 && PTV_GENRE_LOWERCASE_WORDS.has(identity)) return identity;
    if (!identity) return value;

    return `${identity.charAt(0).toLocaleUpperCase('en-US')}${identity.slice(1)}`;
}

export function getPtvGenreDisplayName(value: unknown) {
    const normalized = normalizeGenreValue(value);
    const identity = getPtvGenreExactIdentity(normalized);
    const configured = getPresentationGroup(identity);

    if (configured) return configured.displayName;

    let wordIndex = 0;

    return normalized.split(/([\s/-]+)/).map(part => {
        if (/^[\s/-]+$/.test(part)) return part;

        const formatted = formatGenreWord(part, wordIndex);

        wordIndex += 1;
        return formatted;
    }).join('');
}

function preferGenreEntry(left: PtvBrowseDirectoryEntry, right: PtvBrowseDirectoryEntry) {
    if (right.count !== left.count) return right.count > left.count ? right : left;

    const leftLooksCanonical = left.name === getPtvGenreDisplayName(left.name);
    const rightLooksCanonical = right.name === getPtvGenreDisplayName(right.name);

    if (leftLooksCanonical !== rightLooksCanonical) return rightLooksCanonical ? right : left;

    return right.name.localeCompare(left.name, 'en-US') < 0 ? right : left;
}

function dedupeExactGenreEntries(entries: readonly PtvBrowseDirectoryEntry[]) {
    const byIdentity = new Map<string, PtvBrowseDirectoryEntry>();

    entries.forEach(entry => {
        const identity = getPtvGenreExactIdentity(entry.name);

        if (!identity) return;

        const current = byIdentity.get(identity);
        const preferred = current ? preferGenreEntry(current, entry) : entry;

        byIdentity.set(identity, {
            ...preferred,
            count: Math.max(current?.count || 0, entry.count)
        });
    });

    return [...byIdentity.values()];
}

function getGenreGroupIdentity(entry: PtvBrowseDirectoryEntry) {
    const identity = getPtvGenreExactIdentity(entry.name);
    const configured = getPresentationGroup(identity);

    return configured?.key || `exact:${identity}`;
}

function isSensitiveGenreEntry(entry: PtvBrowseDirectoryEntry) {
    return PTV_SENSITIVE_GENRE_VALUES.has(getPtvGenreExactIdentity(entry.name));
}

function getGenreDirectoryLetter(displayName: string) {
    const latinLetter = /[A-Za-z0-9]/.exec(displayName)?.[0];
    const firstLetter = latinLetter || Array.from(displayName)[0] || '#';

    return firstLetter.toLocaleUpperCase('en-US');
}

export function buildPtvGenreDirectoryGroups(
    entries: readonly PtvBrowseDirectoryEntry[],
    options: Readonly<{ includeSensitive: boolean; query?: string }>
) {
    const groups = new Map<string, PtvBrowseDirectoryEntry[]>();

    dedupeExactGenreEntries(entries).forEach(entry => {
        const key = getGenreGroupIdentity(entry);
        const current = groups.get(key) || [];

        current.push(entry);
        groups.set(key, current);
    });

    const query = getPtvGenreExactIdentity(options.query);

    return [...groups.entries()].map(([key, groupedEntries]) => {
        const sortedEntries = [...groupedEntries].sort((left, right) => (
            getPtvGenreDisplayName(left.name).localeCompare(getPtvGenreDisplayName(right.name), 'en-US')
        ));
        const configured = key.startsWith('exact:') ? null : PTV_GENRE_PRESENTATION_GROUPS.find(group => group.key === key) || null;
        const displayName = configured?.displayName || getPtvGenreDisplayName(sortedEntries[0]?.name);
        const sensitive = sortedEntries.some(isSensitiveGenreEntry);

        return {
            count: sortedEntries.reduce((total, entry) => total + Math.max(0, entry.count), 0),
            displayName,
            entries: sortedEntries,
            key,
            letter: getGenreDirectoryLetter(displayName),
            sensitive
        };
    }).filter(group => (
        (options.includeSensitive || !group.sensitive)
        && (!query || [group.displayName, ...group.entries.map(entry => entry.name)]
            .some(value => getPtvGenreExactIdentity(value).includes(query)))
    )).sort((left, right) => (
        left.displayName.localeCompare(right.displayName, 'en-US') || left.key.localeCompare(right.key, 'en-US')
    ));
}

export function groupPtvGenreDirectoryAlphabetically(groups: readonly PtvGenreDirectoryGroup[]) {
    const sections = new Map<string, PtvGenreDirectoryGroup[]>();

    groups.forEach(group => {
        const current = sections.get(group.letter) || [];

        current.push(group);
        sections.set(group.letter, current);
    });

    return [...sections.entries()].map(([letter, sectionGroups]) => ({
        groups: sectionGroups,
        letter
    })).sort((left, right) => left.letter.localeCompare(right.letter, 'en-US'));
}
