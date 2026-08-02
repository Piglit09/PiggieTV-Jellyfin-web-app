export type PtvDetailsDiscoveryKind =
    | 'artist'
    | 'creator'
    | 'franchise'
    | 'genre'
    | 'studio';

export type PtvDetailsDiscoveryLink = Readonly<{
    ariaLabel: string;
    href: string;
    key: string;
    kind: PtvDetailsDiscoveryKind;
    label: string;
    meta: string;
    query: string;
}>;

type PtvNamedValue = Readonly<{
    Name?: string | null;
}>;

type PtvDetailPerson = PtvNamedValue & Readonly<{
    Role?: string | null;
    Type?: string | null;
}>;

export type PtvDetailsDiscoveryItem = Readonly<{
    AlbumArtists?: readonly PtvNamedValue[] | null;
    ArtistItems?: readonly PtvNamedValue[] | null;
    Artists?: readonly string[] | null;
    CollectionName?: string | null;
    Franchise?: string | null;
    Genres?: readonly string[] | null;
    People?: readonly PtvDetailPerson[] | null;
    SeriesName?: string | null;
    Studios?: readonly PtvNamedValue[] | null;
    Type?: string | null;
}>;

const CREATOR_TYPES = new Set([
    'author',
    'composer',
    'creator',
    'director',
    'producer',
    'writer'
]);
const DISCOVERY_LINK_LIMIT = 8;
const DISCOVERY_VALUE_LIMIT = 80;

function normalizeValue(value: unknown) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, DISCOVERY_VALUE_LIMIT);
}

function getNamedValues(values: readonly PtvNamedValue[] | null | undefined) {
    return (values || [])
        .map(value => normalizeValue(value?.Name))
        .filter(Boolean);
}

function getSearchHref(query: string) {
    return `#/search?query=${encodeURIComponent(query)}&ptvGrouped=true`;
}

function getLink(
    kind: PtvDetailsDiscoveryKind,
    query: string,
    label: string,
    meta: string
): PtvDetailsDiscoveryLink {
    const collectionLink = kind === 'franchise';

    return {
        ariaLabel: collectionLink ?
            `Open the ${query} collection (${meta.toLowerCase()})` :
            `Search PiggieTV for ${query} (${meta.toLowerCase()})`,
        href: collectionLink ?
            `#/collections?view=all&query=${encodeURIComponent(query)}` :
            getSearchHref(query),
        key: `${kind}:${query.toLowerCase()}`,
        kind,
        label,
        meta,
        query
    };
}

function getFranchiseValues(item: PtvDetailsDiscoveryItem) {
    const values = [
        normalizeValue(item.CollectionName),
        normalizeValue(item.Franchise)
    ];

    if (item.Type === 'Episode' || item.Type === 'Season') {
        values.unshift(normalizeValue(item.SeriesName));
    }

    return values.filter(Boolean);
}

function getArtistValues(item: PtvDetailsDiscoveryItem) {
    return [
        ...getNamedValues(item.AlbumArtists),
        ...getNamedValues(item.ArtistItems),
        ...(item.Artists || []).map(normalizeValue).filter(Boolean)
    ];
}

function getCreatorValues(item: PtvDetailsDiscoveryItem) {
    return (item.People || []).reduce<Array<Readonly<{
        meta: string;
        value: string;
    }>>>((result, person) => {
        const type = normalizeValue(person.Type || person.Role);
        const value = normalizeValue(person.Name);

        if (!value || !CREATOR_TYPES.has(type.toLowerCase())) {
            return result;
        }

        result.push({
            meta: type || 'Creator',
            value
        });

        return result;
    }, []);
}

export function getPtvDetailsDiscoveryLinks(
    item: PtvDetailsDiscoveryItem,
    limit = DISCOVERY_LINK_LIMIT
) {
    const candidates: PtvDetailsDiscoveryLink[] = [];

    getFranchiseValues(item).forEach(value => {
        candidates.push(getLink(
            'franchise',
            value,
            `Explore ${value}`,
            item.Type === 'Episode' || item.Type === 'Season' ? 'Series context' : 'Franchise'
        ));
    });

    getArtistValues(item).forEach(value => {
        candidates.push(getLink('artist', value, `More from ${value}`, 'Artist'));
    });

    getCreatorValues(item).forEach(({ meta, value }) => {
        candidates.push(getLink('creator', value, `More from ${value}`, meta));
    });

    getNamedValues(item.Studios).forEach(value => {
        candidates.push(getLink('studio', value, `From ${value}`, 'Studio'));
    });

    (item.Genres || []).map(normalizeValue).filter(Boolean).forEach(value => {
        candidates.push(getLink('genre', value, `Browse ${value}`, 'Genre'));
    });

    const seenQueries = new Set<string>();
    const safeLimit = Math.max(0, Math.min(DISCOVERY_LINK_LIMIT, Math.floor(limit)));

    return candidates.filter(candidate => {
        const queryKey = candidate.query.toLowerCase();

        if (seenQueries.has(queryKey)) {
            return false;
        }

        seenQueries.add(queryKey);
        return true;
    }).slice(0, safeLimit);
}
