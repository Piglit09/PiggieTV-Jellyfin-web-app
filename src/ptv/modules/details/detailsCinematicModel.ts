import type {
    PtvRecommendationHomeData,
    PtvRecommendationItem,
    PtvRecommendationRow,
    PtvRecommendationScore
} from '../recommendations/types/recommendationTypes';
import type { PtvDetailsDiscoveryLink } from './detailsDiscoveryModel';

export type PtvCinematicMediaFamily = 'music' | 'other' | 'reading' | 'series' | 'video';
export type PtvCinematicCardKind = 'entity' | 'media';
export type PtvCinematicPresentation = 'cards' | 'entities' | 'timeline';
export type PtvCinematicOrderSource =
    | 'administrator'
    | 'collection'
    | 'provider-chronology'
    | 'release'
    | 'series';

export type PtvCinematicRelationship =
    | 'authoritative-recommendation'
    | 'cross-library'
    | 'explicit-collection'
    | 'explicit-provider'
    | 'explicit-tag'
    | 'shared-creator'
    | 'shared-genre'
    | 'shared-series'
    | 'shared-studio';

export type PtvCinematicEntityType =
    | 'Artist'
    | 'Collection'
    | 'Franchise'
    | 'Genre'
    | 'Network'
    | 'Person'
    | 'Studio';

export type PtvCinematicDetailsItem = Readonly<Record<string, unknown>> & Readonly<{
    Id?: string;
    Name?: string;
    ServerId?: string;
    Type?: string;
}>;

export type PtvAuthoritativeRelationshipCategory =
    | 'adaptation'
    | 'based-on'
    | 'companion-reading'
    | 'companion-video'
    | 'related-book'
    | 'related-comic'
    | 'related-game'
    | 'soundtrack'
    | 'spin-off';

export type PtvCinematicAuthoritativeRelationship = Readonly<{
    category: PtvAuthoritativeRelationshipCategory;
    direction: 'bidirectional' | 'source-to-target';
    displayOrder: number;
    item: PtvRecommendationItem;
}>;

export type PtvCinematicCard = Readonly<{
    entityType?: PtvCinematicEntityType;
    href?: string;
    item: PtvRecommendationItem;
    itemId: string;
    kind?: PtvCinematicCardKind;
    reason: string;
    reasonChips?: readonly string[];
    sequence?: number;
    subtitle: string;
    title: string;
}>;

export type PtvCinematicShelf = Readonly<{
    description: string;
    id: string;
    items: readonly PtvCinematicCard[];
    orderExplanation?: string;
    orderLabel: string;
    orderSource?: PtvCinematicOrderSource;
    presentation?: PtvCinematicPresentation;
    relationship: PtvCinematicRelationship;
    title: string;
}>;

export type PtvCinematicGatewayAction = Readonly<{
    label: string;
    shelfId: string;
}>;

export type PtvCinematicGateway = Readonly<{
    actions: readonly PtvCinematicGatewayAction[];
    description: string;
    metadata: readonly string[];
    stats: readonly string[];
    title: string;
}>;

export type PtvCinematicDetailsModel = Readonly<{
    candidateCount: number;
    dedupedCandidateCount: number;
    facts: readonly string[];
    family: PtvCinematicMediaFamily;
    gateway?: PtvCinematicGateway;
    kicker: string;
    shelves: readonly PtvCinematicShelf[];
    summary: string;
    title: string;
}>;

type PtvRecord = Readonly<Record<string, unknown>>;
type PtvNamedEntity = Readonly<{
    id: string;
    item: PtvRecommendationItem;
    name: string;
    role: string;
    roleKey: string;
}>;
type PtvOrderPlan = Readonly<{
    compare: (left: PtvRecommendationScore, right: PtvRecommendationScore) => number;
    explanation: string;
    label: string;
    source: PtvCinematicOrderSource;
}>;

const CINEMATIC_CARD_LIMIT = 12;
const CINEMATIC_SHELF_LIMIT = 5;
const ENTITY_CARD_LIMIT = 8;
const MUSIC_TYPES = new Set(['audio', 'musicalbum', 'musicartist', 'playlist']);
const READING_TYPES = new Set(['audiobook', 'book', 'comic', 'manga']);
const SERIES_TYPES = new Set(['episode', 'season', 'series']);
const VIDEO_TYPES = new Set(['boxset', 'movie', 'musicvideo', 'video']);
const PEOPLE_ROLES = new Set([
    'actor',
    'artist',
    'author',
    'composer',
    'creator',
    'director',
    'gueststar',
    'producer',
    'writer'
]);
const EXPLICIT_LINK_KEYS = [
    'AdaptationIds',
    'AdaptedFromIds',
    'LinkedItemIds',
    'PtvRelationshipIds',
    'RelatedItemIds',
    'RelatedSoundtrackIds',
    'SoundtrackForIds'
] as const;
const AUTHORITATIVE_RELATIONSHIP_LABELS: Readonly<Record<PtvAuthoritativeRelationshipCategory, string>> = {
    adaptation: 'Adaptation',
    'based-on': 'Based On',
    'companion-reading': 'Companion Reading',
    'companion-video': 'Companion Video',
    'related-book': 'Related Book',
    'related-comic': 'Related Comic',
    'related-game': 'Related Game',
    soundtrack: 'Soundtrack',
    'spin-off': 'Spin-off'
};

function asRecord(value: unknown): PtvRecord | null {
    return Boolean(value) && typeof value === 'object' ? value as PtvRecord : null;
}

function normalizeText(value: unknown) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function normalizeKey(value: unknown) {
    return normalizeText(value).toLocaleLowerCase('en-US');
}

function getText(item: PtvRecord, ...keys: string[]) {
    for (const key of keys) {
        const value = normalizeText(item[key]);

        if (value) return value;
    }

    return '';
}

function getNumber(item: PtvRecord, ...keys: string[]) {
    for (const key of keys) {
        const value = Number(item[key]);

        if (Number.isFinite(value)) return value;
    }

    return 0;
}

function getOptionalNumber(item: PtvRecord, ...keys: string[]) {
    for (const key of keys) {
        if (item[key] === '' || item[key] === null || item[key] === undefined) continue;

        const value = Number(item[key]);

        if (Number.isFinite(value)) return value;
    }

    return null;
}

function getNamedDisplayValues(item: PtvRecord, ...keys: string[]) {
    const values: string[] = [];

    keys.forEach(key => {
        const raw = item[key];

        if (!Array.isArray(raw)) return;

        raw.forEach(entry => {
            const value = typeof entry === 'string' ? normalizeText(entry) : getText(asRecord(entry) || {}, 'Name', 'name');

            if (value) values.push(value);
        });
    });

    const seen = new Set<string>();

    return values.filter(value => {
        const key = normalizeKey(value);

        if (!key || seen.has(key)) return false;

        seen.add(key);
        return true;
    });
}

function getNamedValues(item: PtvRecord, ...keys: string[]) {
    return getNamedDisplayValues(item, ...keys).map(normalizeKey);
}

function getSharedNamedValues(seed: PtvRecord, candidate: PtvRecord, ...keys: string[]) {
    const candidateKeys = new Set(getNamedValues(candidate, ...keys));

    return getNamedDisplayValues(seed, ...keys).filter(value => candidateKeys.has(normalizeKey(value)));
}

function getNamedEntities(item: PtvRecord, keys: readonly string[], type: PtvCinematicEntityType) {
    return keys.flatMap(key => {
        const raw = item[key];

        if (!Array.isArray(raw)) return [];

        return raw.flatMap(value => {
            const record = asRecord(value);
            const id = record ? getText(record, 'Id', 'id') : '';
            const name = typeof value === 'string' ? normalizeText(value) : getText(record || {}, 'Name', 'name');

            if (!id || !name) return [];

            return [{
                id,
                item: {
                    ...record,
                    Id: id,
                    Name: name,
                    ServerId: getText(record || {}, 'ServerId', 'serverId') || getText(item, 'ServerId', 'serverId'),
                    Type: type
                } as PtvRecommendationItem,
                name,
                role: type,
                roleKey: normalizeKey(type)
            }];
        });
    });
}

function getPeople(item: PtvRecord): PtvNamedEntity[] {
    const rawPeople = item.People;

    if (!Array.isArray(rawPeople)) return [];

    return rawPeople.flatMap(personValue => {
        const person = asRecord(personValue);
        const id = person ? getText(person, 'Id', 'id') : '';
        const name = person ? getText(person, 'Name', 'name') : '';
        const role = person ? getText(person, 'Type', 'type', 'Role', 'role') : '';
        const roleKey = normalizeKey(role).replace(/\s+/g, '');

        if (!name || !PEOPLE_ROLES.has(roleKey)) return [];

        return [{
            id,
            item: {
                ...person,
                Id: id,
                Name: name,
                ServerId: getText(person || {}, 'ServerId', 'serverId') || getText(item, 'ServerId', 'serverId'),
                Type: 'Person'
            } as PtvRecommendationItem,
            name,
            role: role || 'Creator',
            roleKey
        }];
    });
}

function intersect(left: readonly string[], right: readonly string[]) {
    const rightValues = new Set(right);

    return left.filter(value => rightValues.has(value));
}

function getType(item: PtvRecord) {
    return normalizeKey(getText(item, 'Type', 'type'));
}

export function getPtvCinematicMediaFamily(item: PtvRecord): PtvCinematicMediaFamily {
    const type = getType(item);
    const mediaType = normalizeKey(getText(item, 'MediaType', 'mediaType'));
    const collectionType = normalizeKey(getText(item, 'CollectionType', 'collectionType'));
    const container = normalizeKey(getText(item, 'Container', 'container'));

    if (MUSIC_TYPES.has(type) || mediaType === 'audio') return 'music';
    if (
        READING_TYPES.has(type)
        || mediaType === 'book'
        || collectionType === 'books'
        || ['cb7', 'cbr', 'cbt', 'cbz', 'epub', 'pdf'].includes(container)
    ) return 'reading';
    if (SERIES_TYPES.has(type)) return 'series';
    if (VIDEO_TYPES.has(type) || mediaType === 'video') return 'video';

    return 'other';
}

function getCollectionKeys(item: PtvRecord) {
    const named = [
        getText(item, 'CollectionName', 'collectionName'),
        getText(item, 'Franchise', 'franchise'),
        getText(item, 'PtvCollectionKey', 'ptvCollectionKey'),
        getText(item, 'PtvFranchiseKey', 'ptvFranchiseKey')
    ].filter(Boolean).map(value => `name:${normalizeKey(value)}`);
    const ids = ['BoxSetIds', 'CollectionIds', 'PtvCollectionIds'].flatMap(key => {
        const raw = item[key];

        return Array.isArray(raw) ? raw.map(value => `id:${normalizeKey(value)}`).filter(value => value !== 'id:') : [];
    });

    return [...new Set([...named, ...ids])];
}

function getSeriesKeys(item: PtvRecord) {
    return [
        normalizeKey(item.SeriesId),
        normalizeKey(item.SeriesName),
        normalizeKey(item.ReadingSeriesId),
        normalizeKey(item.ProviderSeriesId)
    ].filter(Boolean);
}

function getArtistKeys(item: PtvRecord) {
    const type = getType(item);
    const values = [
        normalizeKey(item.AlbumArtist),
        normalizeKey(item.Artist),
        ...getNamedValues(item, 'AlbumArtists', 'ArtistItems', 'Artists')
    ];

    if (type === 'musicartist' || type === 'artist') values.unshift(normalizeKey(item.Name));

    return [...new Set(values.filter(Boolean))];
}

function getExplicitLinkIds(item: PtvRecord) {
    return EXPLICIT_LINK_KEYS.flatMap(key => {
        const raw = item[key];

        if (Array.isArray(raw)) {
            return raw.map(value => typeof value === 'string' ? normalizeKey(value) : normalizeKey(asRecord(value)?.Id)).filter(Boolean);
        }

        return normalizeKey(raw) ? [normalizeKey(raw)] : [];
    });
}

function sharesExplicitCollection(seed: PtvRecord, candidate: PtvRecord) {
    return intersect(getCollectionKeys(seed), getCollectionKeys(candidate)).length > 0;
}

function sharesSeries(seed: PtvRecord, candidate: PtvRecord) {
    return intersect(getSeriesKeys(seed), getSeriesKeys(candidate)).length > 0;
}

function sharesArtist(seed: PtvRecord, candidate: PtvRecord) {
    return intersect(getArtistKeys(seed), getArtistKeys(candidate)).length > 0;
}

function getSharedPeople(seed: PtvRecord, candidate: PtvRecord, requireIds = false) {
    const candidatePeople = getPeople(candidate);

    return getPeople(seed).filter(person => candidatePeople.some(candidatePerson => {
        if (requireIds) return Boolean(person.id && candidatePerson.id && person.id === candidatePerson.id);
        if (person.id && candidatePerson.id) return person.id === candidatePerson.id;

        return normalizeKey(person.name) === normalizeKey(candidatePerson.name);
    }));
}

function sharesStudio(seed: PtvRecord, candidate: PtvRecord) {
    return getSharedNamedValues(seed, candidate, 'Studios', 'Networks', 'Labels', 'Publishers');
}

function sharesGenre(seed: PtvRecord, candidate: PtvRecord) {
    return getSharedNamedValues(seed, candidate, 'Genres', 'GenreItems');
}

function sharesTag(seed: PtvRecord, candidate: PtvRecord) {
    return getSharedNamedValues(seed, candidate, 'Tags', 'TagItems');
}

function getDirectRelationship(seed: PtvRecord, candidate: PtvRecord) {
    const seedId = normalizeKey(getText(seed, 'Id', 'id'));
    const candidateId = normalizeKey(getText(candidate, 'Id', 'id'));
    const seedLinks = new Set(getExplicitLinkIds(seed));
    const candidateLinks = new Set(getExplicitLinkIds(candidate));

    if (!seedId || !candidateId || (!seedLinks.has(candidateId) && !candidateLinks.has(seedId))) return '';

    const soundtrackKeys = ['RelatedSoundtrackIds', 'SoundtrackForIds'];
    const adaptationKeys = ['AdaptationIds', 'AdaptedFromIds'];
    const hasLinkedId = (source: PtvRecord, keys: readonly string[], targetId: string) => keys.some(key => {
        const raw = source[key];

        return Array.isArray(raw) && raw.some(value => normalizeKey(typeof value === 'string' ? value : asRecord(value)?.Id) === targetId);
    });

    if (hasLinkedId(seed, soundtrackKeys, candidateId) || hasLinkedId(candidate, soundtrackKeys, seedId)) return 'Soundtrack Connection';
    if (hasLinkedId(seed, adaptationKeys, candidateId) || hasLinkedId(candidate, adaptationKeys, seedId)) return 'Adapted From';

    return 'Configured Connection';
}

function getScoreItemId(score: PtvRecommendationScore) {
    return getText(score.item as PtvRecord, 'Id', 'id');
}

function compareRecommendationScores(left: PtvRecommendationScore, right: PtvRecommendationScore) {
    return right.score - left.score
        || right.affinityScore - left.affinityScore
        || getText(left.item as PtvRecord, 'Name', 'name').localeCompare(getText(right.item as PtvRecord, 'Name', 'name'));
}

function getReleaseOrderValue(item: PtvRecord) {
    const premiereDate = Date.parse(getText(item, 'PremiereDate', 'premiereDate'));
    const productionYear = getNumber(item, 'ProductionYear', 'productionYear');

    if (Number.isFinite(premiereDate)) return premiereDate;
    if (productionYear) return Date.UTC(productionYear, 0, 1);

    return Number.MAX_SAFE_INTEGER;
}

function getOrderPlan(scores: readonly PtvRecommendationScore[], family: PtvCinematicMediaFamily): PtvOrderPlan {
    const getAllValues = (keys: string[]) => scores.map(score => getOptionalNumber(score.item as PtvRecord, ...keys));
    const getNumericPlan = (
        values: readonly (number | null)[],
        source: PtvCinematicOrderSource,
        label: string,
        explanation: string
    ): PtvOrderPlan | null => {
        if (!values.length || values.some(value => value === null)) return null;

        const byId = new Map(scores.map((score, index) => [getScoreItemId(score), values[index] as number]));

        return {
            compare: (left, right) => (byId.get(getScoreItemId(left)) || 0) - (byId.get(getScoreItemId(right)) || 0),
            explanation,
            label,
            source
        };
    };
    const administrator = getNumericPlan(
        getAllValues(['PtvWatchOrder', 'WatchOrder', 'AdministratorOrder']),
        'administrator',
        'Administrator order',
        'Using the administrator-configured watch order.'
    );

    if (administrator) return administrator;

    const collection = getNumericPlan(
        getAllValues(['CollectionIndexNumber', 'BoxSetIndexNumber']),
        'collection',
        'Collection order',
        'Using the existing Jellyfin collection order.'
    );

    if (collection) return collection;

    if (family === 'series') {
        const seriesValues = scores.map(score => {
            const item = score.item as PtvRecord;
            const season = getOptionalNumber(item, 'ParentIndexNumber', 'parentIndexNumber');
            const episode = getOptionalNumber(item, 'IndexNumber', 'indexNumber');

            return season === null || episode === null ? null : season * 10000 + episode;
        });
        const series = getNumericPlan(seriesValues, 'series', 'Series order', 'Using Jellyfin season and episode order.');

        if (series) return series;
    }

    const provider = getNumericPlan(
        getAllValues(['ProviderChronologyIndex', 'ChronologyIndex']),
        'provider-chronology',
        'Provider chronology',
        'Using chronology already present in approved provider metadata.'
    );

    if (provider) return provider;

    return {
        compare: (left, right) => getReleaseOrderValue(left.item as PtvRecord) - getReleaseOrderValue(right.item as PtvRecord)
            || getText(left.item as PtvRecord, 'Name', 'name').localeCompare(getText(right.item as PtvRecord, 'Name', 'name')),
        explanation: 'Ordered by release date.',
        label: 'Release order',
        source: 'release'
    };
}

function getCandidateScores(seed: PtvRecord, data: PtvRecommendationHomeData) {
    const seedId = getText(seed, 'Id', 'id');
    const byId = new Map<string, PtvRecommendationScore>();
    let sourceCount = 0;

    const addScore = (score: PtvRecommendationScore) => {
        sourceCount += 1;
        const itemId = getScoreItemId(score);

        if (!itemId || itemId === seedId) return;

        const current = byId.get(itemId);

        if (!current || compareRecommendationScores(score, current) < 0) byId.set(itemId, score);
    };

    data.candidates.forEach(addScore);
    data.rows.forEach(row => {
        row.items.forEach(addScore);
    });

    return {
        scores: [...byId.values()].sort(compareRecommendationScores),
        sourceCount
    };
}

function getItemTypeLabel(item: PtvRecord) {
    const type = getText(item, 'Type', 'type');

    return ({
        Audio: 'Track',
        Book: 'Book',
        BoxSet: 'Collection',
        Comic: 'Comic',
        Episode: 'Episode',
        Manga: 'Manga',
        Movie: 'Movie',
        MusicAlbum: 'Album',
        MusicArtist: 'Artist',
        Person: 'Person',
        Playlist: 'Playlist',
        Season: 'Season',
        Series: 'Series'
    } as Record<string, string>)[type] || type || 'Media';
}

function getCardSubtitle(item: PtvRecord) {
    const type = getItemTypeLabel(item);
    const year = getNumber(item, 'ProductionYear', 'productionYear');
    const context = getText(item, 'SeriesName', 'seriesName', 'Album', 'album');

    return [type, year || '', context].filter(Boolean).join(' \u00b7 ');
}

function getPersonChip(person: PtvNamedEntity) {
    if (person.roleKey === 'director') return 'Same Director';
    if (person.roleKey === 'actor' || person.roleKey === 'gueststar') return 'Shared Cast';

    return 'Same Creator';
}

export function getPtvCinematicEvidenceChips(seed: PtvRecord, candidate: PtvRecord) {
    const chips: string[] = [];
    const crossFamily = getPtvCinematicMediaFamily(seed) !== getPtvCinematicMediaFamily(candidate);
    const add = (value: string) => {
        if (value && !chips.includes(value) && chips.length < 3) chips.push(value);
    };

    add(getDirectRelationship(seed, candidate));
    if (sharesExplicitCollection(seed, candidate)) add('Same Collection');
    if (sharesSeries(seed, candidate)) add('Part of This Series');
    getSharedPeople(seed, candidate, crossFamily).forEach(person => {
        add(getPersonChip(person));
    });
    if (!crossFamily && sharesStudio(seed, candidate).length) add('Same Studio');
    if (!crossFamily && sharesTag(seed, candidate).length) add('Shared Tag');
    if (!crossFamily && sharesGenre(seed, candidate).length) add('Same Genre');

    return chips;
}

function createMediaShelf(
    definition: Omit<PtvCinematicShelf, 'items'>,
    scores: readonly PtvRecommendationScore[],
    usedItemIds: Set<string>,
    seed: PtvRecord,
    fallbackReason: string,
    compare: ((left: PtvRecommendationScore, right: PtvRecommendationScore) => number) | null = compareRecommendationScores,
    extraChip = ''
): PtvCinematicShelf | null {
    const cards: PtvCinematicCard[] = [];
    const orderedScores = compare ? [...scores].sort(compare) : [...scores];

    orderedScores.forEach(score => {
        if (cards.length >= CINEMATIC_CARD_LIMIT) return;

        const item = score.item as PtvRecord;
        const itemId = getScoreItemId(score);

        if (!itemId || usedItemIds.has(itemId)) return;

        const reasonChips = getPtvCinematicEvidenceChips(seed, item);

        if (extraChip && reasonChips.length < 3) reasonChips.push(extraChip);
        usedItemIds.add(itemId);
        cards.push({
            item: score.item,
            itemId,
            kind: 'media',
            reason: reasonChips.join(' \u00b7 ') || fallbackReason,
            reasonChips: reasonChips.length ? reasonChips : [fallbackReason],
            sequence: definition.presentation === 'timeline' ? cards.length + 1 : undefined,
            subtitle: getCardSubtitle(item),
            title: getText(item, 'Name', 'name') || 'Untitled'
        });
    });

    return cards.length ? { ...definition, items: cards } : null;
}

function createAuthoritativeRelationshipShelf(
    relationships: readonly PtvCinematicAuthoritativeRelationship[],
    usedItemIds: Set<string>,
    seed: PtvRecord
): PtvCinematicShelf | null {
    const seedFamily = getPtvCinematicMediaFamily(seed);
    const cards: PtvCinematicCard[] = [];
    const orderedRelationships = [...relationships].sort((left, right) => (
        left.displayOrder - right.displayOrder
        || left.category.localeCompare(right.category)
        || getText(left.item as PtvRecord, 'Id', 'id').localeCompare(getText(right.item as PtvRecord, 'Id', 'id'))
    ));

    orderedRelationships.forEach(relationship => {
        if (cards.length >= CINEMATIC_CARD_LIMIT) return;

        const target = relationship.item as PtvRecord;
        const itemId = getText(target, 'Id', 'id');

        if (
            !itemId
            || usedItemIds.has(itemId)
            || getPtvCinematicMediaFamily(target) === seedFamily
        ) return;

        const reason = AUTHORITATIVE_RELATIONSHIP_LABELS[relationship.category];

        usedItemIds.add(itemId);
        cards.push({
            item: relationship.item,
            itemId,
            kind: 'media',
            reason,
            reasonChips: [reason],
            subtitle: getCardSubtitle(target),
            title: getText(target, 'Name', 'name') || 'Untitled'
        });
    });

    return cards.length ? {
        description: 'Connected across video, Music, and Reading by an explicit administrator mapping.',
        id: 'cross-library',
        items: cards,
        orderExplanation: 'Administrator-defined relationship and display order.',
        orderLabel: 'Explicit relationship',
        orderSource: 'administrator',
        presentation: 'cards',
        relationship: 'cross-library',
        title: 'Across your libraries'
    } : null;
}

function getTimelineId(family: PtvCinematicMediaFamily) {
    if (family === 'series') return 'series-timeline';
    if (family === 'music') return 'artist-timeline';
    if (family === 'reading') return 'reading-order';

    return 'franchise-order';
}

function getDefaultTimelineTitle(family: PtvCinematicMediaFamily) {
    if (family === 'series') return 'Series timeline';
    if (family === 'music') return 'Artist timeline';
    if (family === 'reading') return 'Reading order';

    return 'Release timeline';
}

function getTimelineTitle(family: PtvCinematicMediaFamily, order: PtvOrderPlan) {
    if (order.source === 'administrator') return 'Watch order';
    if (order.source === 'provider-chronology') return 'Chronological timeline';

    return getDefaultTimelineTitle(family);
}

function getTimelineDefinition(family: PtvCinematicMediaFamily, order: PtvOrderPlan): Omit<PtvCinematicShelf, 'items'> {
    const relationship = family === 'series' ? 'shared-series' : 'explicit-collection';

    return {
        description: order.explanation,
        id: getTimelineId(family),
        orderExplanation: order.explanation,
        orderLabel: order.label,
        orderSource: order.source,
        presentation: 'timeline',
        relationship,
        title: getTimelineTitle(family, order)
    };
}

function getPreferredRecommendationRow(family: PtvCinematicMediaFamily, rows: readonly PtvRecommendationRow[]) {
    const preferredIds = ({
        music: ['because-you-listen', 'made-for-you-music', 'recommended-for-you'],
        other: ['recommended-for-you', 'ptv-discovery'],
        reading: ['recommended-books', 'recommended-comics', 'recommended-manga', 'recommended-for-you'],
        series: ['because-you-watched', 'recommended-shows', 'recommended-anime', 'recommended-for-you'],
        video: ['because-you-watched', 'recommended-movies', 'recommended-for-you']
    } as const)[family];

    for (const preferredId of preferredIds) {
        const row = rows.find(candidate => candidate.id === preferredId || candidate.id.startsWith(`${preferredId}-`));

        if (row?.items.length) return row;
    }

    return null;
}

function getRecommendationCopy(seed: PtvRecord, row: PtvRecommendationRow) {
    const rowRecord = row as unknown as PtvRecord;
    const seedId = normalizeKey(getText(seed, 'Id', 'id'));
    const seedName = normalizeKey(getText(seed, 'Name', 'name'));
    const explicitSubjectId = normalizeKey(getText(rowRecord, 'SubjectItemId', 'subjectItemId'));
    const claimsSubject = /because you (?:watched|listened|read)/i.test(row.title);
    const subjectIsCurrent = Boolean(
        (seedId && explicitSubjectId === seedId)
        || (seedName && normalizeKey(row.title).includes(seedName))
    );

    if (claimsSubject && !subjectIsCurrent) {
        return {
            description: 'Personalized by the existing PiggieTV recommendation owner.',
            title: 'Recommended for you'
        };
    }

    return { description: row.explanation, title: row.title };
}

function getConnectedTitleCountLabel(count: number) {
    if (!count) return 'Open details';

    const noun = count === 1 ? 'title' : 'titles';

    return `${count} connected ${noun}`;
}

function getEntityCards(seed: PtvRecord, scores: readonly PtvRecommendationScore[], usedItemIds: Set<string>) {
    const entities = [
        ...getPeople(seed),
        ...getNamedEntities(seed, ['Studios'], 'Studio'),
        ...getNamedEntities(seed, ['Networks'], 'Network'),
        ...getNamedEntities(seed, ['Collections', 'CollectionItems'], 'Collection'),
        ...getNamedEntities(seed, ['Franchises', 'FranchiseItems'], 'Franchise')
    ];
    const seen = new Set<string>();

    return entities.flatMap(entity => {
        if (!entity.id || seen.has(entity.id) || usedItemIds.has(entity.id)) return [];

        seen.add(entity.id);
        usedItemIds.add(entity.id);
        const relatedCount = scores.filter(score => {
            const candidate = score.item as PtvRecord;

            if (entity.item.Type === 'Person') {
                return getPeople(candidate).some(person => (
                    person.id && entity.id ? person.id === entity.id : normalizeKey(person.name) === normalizeKey(entity.name)
                ));
            }

            return getNamedValues(candidate, `${entity.item.Type}s`, 'Studios', 'Networks', 'Collections', 'Franchises')
                .includes(normalizeKey(entity.name));
        }).length;
        const countLabel = getConnectedTitleCountLabel(relatedCount);

        return [{
            entityType: entity.item.Type as PtvCinematicEntityType,
            item: entity.item,
            itemId: entity.id,
            kind: 'entity' as const,
            reason: countLabel,
            reasonChips: [entity.role],
            subtitle: [entity.role, countLabel].join(' \u00b7 '),
            title: entity.name
        }];
    }).slice(0, ENTITY_CARD_LIMIT);
}

function getMetadataEntityType(link: PtvDetailsDiscoveryLink): PtvCinematicEntityType {
    if (link.kind === 'artist') return 'Artist';
    if (link.kind === 'creator') return 'Person';
    if (link.kind === 'franchise') return 'Franchise';
    if (link.kind === 'genre') return 'Genre';

    return 'Studio';
}

function getMetadataEntityCards(
    links: readonly PtvDetailsDiscoveryLink[],
    usedItemIds: Set<string>,
    usedNames: Set<string>
) {
    return links.flatMap(link => {
        const itemId = `metadata:${link.key}`;
        const nameKey = normalizeKey(link.query);

        if (!nameKey || usedNames.has(nameKey) || usedItemIds.has(itemId)) return [];

        usedNames.add(nameKey);
        usedItemIds.add(itemId);

        return [{
            entityType: getMetadataEntityType(link),
            href: link.href,
            item: {
                Id: itemId,
                Name: link.query,
                Type: getMetadataEntityType(link)
            } as PtvRecommendationItem,
            itemId,
            kind: 'entity' as const,
            reason: link.meta,
            reasonChips: [link.meta],
            subtitle: `${link.meta} \u00b7 Open discovery`,
            title: link.query
        }];
    });
}

function getFacts(item: PtvRecord) {
    const facts = [getItemTypeLabel(item)];
    const year = getNumber(item, 'ProductionYear', 'productionYear');
    const officialRating = getText(item, 'OfficialRating', 'officialRating');
    const communityRating = getNumber(item, 'CommunityRating', 'communityRating');
    const runTimeTicks = getNumber(item, 'RunTimeTicks', 'runTimeTicks');

    if (year) facts.push(String(year));
    if (officialRating) facts.push(officialRating);
    if (runTimeTicks) {
        const minutes = Math.max(1, Math.round(runTimeTicks / 600000000));
        facts.push(minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`);
    }
    if (communityRating) facts.push(`${communityRating.toFixed(1)} rated`);

    return [...new Set(facts)].slice(0, 5);
}

function getFamilyCopy(family: PtvCinematicMediaFamily) {
    return ({
        music: { kicker: 'Listen deeper', summary: 'Follow explicit artist, release, creator, and soundtrack relationships.' },
        other: { kicker: 'Explore this world', summary: 'Continue through explicit library relationships and recommendations.' },
        reading: { kicker: 'Read beyond the page', summary: 'Follow series order, authors, publishers, and explicit adaptations.' },
        series: { kicker: 'Stay in the story', summary: 'Move through the series, its creators, network, and connected media.' },
        video: { kicker: 'Explore this universe', summary: 'Continue through explicit collections, filmmakers, studios, and connected media.' }
    } as const)[family];
}

function getGatewayActionLabel(shelf: PtvCinematicShelf) {
    if (shelf.presentation === 'timeline') return shelf.orderLabel;
    if (shelf.presentation === 'entities') return 'Explore people and places';

    return 'Explore connections';
}

function createGateway(item: PtvRecord, family: PtvCinematicMediaFamily, shelves: readonly PtvCinematicShelf[]): PtvCinematicGateway {
    const explicitContext = getText(
        item,
        'Franchise',
        'CollectionName',
        'SeriesName',
        'AlbumArtist',
        'ReadingSeriesName',
        'Name'
    ) || 'Media universe';
    const mediaCards = shelves.flatMap(shelf => shelf.items).filter(card => card.kind !== 'entity');
    const entityCards = shelves.flatMap(shelf => shelf.items).filter(card => card.kind === 'entity');
    const familyCounts = new Map<PtvCinematicMediaFamily, number>();

    mediaCards.forEach(card => {
        const cardFamily = getPtvCinematicMediaFamily(card.item as PtvRecord);

        familyCounts.set(cardFamily, (familyCounts.get(cardFamily) || 0) + 1);
    });

    const familyLabels: Record<PtvCinematicMediaFamily, string> = {
        music: 'music',
        other: 'related',
        reading: 'reading',
        series: 'series',
        video: 'video'
    };
    const stats = [...familyCounts.entries()]
        .filter(([, count]) => count > 0)
        .map(([cardFamily, count]) => `${count} ${familyLabels[cardFamily]}`)
        .slice(0, 3);

    if (entityCards.length) stats.push(`${entityCards.length} ${entityCards.length === 1 ? 'entity' : 'entities'}`);

    const metadata = [
        ...getNamedDisplayValues(item, 'Genres').slice(0, 2),
        ...getNamedDisplayValues(item, 'Studios', 'Networks', 'Labels', 'Publishers').slice(0, 1)
    ].slice(0, 3);
    const actions = shelves.slice(0, 2).map(shelf => ({
        label: getGatewayActionLabel(shelf),
        shelfId: shelf.id
    }));
    const copy = getFamilyCopy(family);

    return {
        actions,
        description: copy.summary,
        metadata,
        stats: stats.slice(0, 4),
        title: explicitContext
    };
}

function hasExplicitConnection(seed: PtvRecord, candidate: PtvRecord) {
    if (getPtvCinematicMediaFamily(seed) !== getPtvCinematicMediaFamily(candidate)) {
        return false;
    }

    return Boolean(
        getDirectRelationship(seed, candidate)
        || sharesExplicitCollection(seed, candidate)
        || sharesSeries(seed, candidate)
        || sharesArtist(seed, candidate)
        || getSharedPeople(seed, candidate).length
        || sharesStudio(seed, candidate).length
        || sharesTag(seed, candidate).length
        || sharesGenre(seed, candidate).length
    );
}

function getExplicitShelfRelationship(seed: PtvRecord, scores: readonly PtvRecommendationScore[]): PtvCinematicRelationship {
    const first = scores[0]?.item as PtvRecord | undefined;

    return first && getSharedPeople(seed, first).length ? 'shared-creator' : 'shared-studio';
}

function getExplicitShelfTitle(family: PtvCinematicMediaFamily) {
    if (family === 'music') return 'Creators and connected releases';
    if (family === 'reading') return 'Authors and connected stories';

    return 'Connected titles';
}

export function buildPtvCinematicDetailsModel(
    item: PtvCinematicDetailsItem,
    data: PtvRecommendationHomeData,
    discoveryLinks: readonly PtvDetailsDiscoveryLink[] = [],
    authoritativeRelationships: readonly PtvCinematicAuthoritativeRelationship[] = []
): PtvCinematicDetailsModel {
    const family = getPtvCinematicMediaFamily(item);
    const { scores, sourceCount } = getCandidateScores(item, data);
    const usedItemIds = new Set<string>();
    const shelves: PtvCinematicShelf[] = [];
    const pushShelf = (shelf: PtvCinematicShelf | null) => {
        if (shelf && shelves.length < CINEMATIC_SHELF_LIMIT) shelves.push(shelf);
    };
    const timelineScores = scores.filter(score => {
        const candidate = score.item as PtvRecord;

        if (getPtvCinematicMediaFamily(candidate) !== family) return false;
        if (family === 'series') return sharesSeries(item, candidate);
        if (family === 'music') return sharesArtist(item, candidate);
        if (family === 'reading') return sharesSeries(item, candidate) || sharesExplicitCollection(item, candidate);

        return sharesExplicitCollection(item, candidate);
    });

    if (timelineScores.length) {
        const order = getOrderPlan(timelineScores, family);

        pushShelf(createMediaShelf(
            getTimelineDefinition(family, order),
            timelineScores,
            usedItemIds,
            item,
            family === 'series' ? 'Part of This Series' : 'Same Collection',
            order.compare
        ));
    }

    const directEntityCards = getEntityCards(item, scores, usedItemIds);
    const usedEntityNames = new Set(directEntityCards.map(card => normalizeKey(card.title)));
    const entityCards = [
        ...directEntityCards,
        ...getMetadataEntityCards(discoveryLinks, usedItemIds, usedEntityNames)
    ].slice(0, ENTITY_CARD_LIMIT);

    if (entityCards.length) {
        pushShelf({
            description: 'Open authoritative people, studio, network, collection, and franchise destinations.',
            id: 'universe-entities',
            items: entityCards,
            orderLabel: 'Explicit metadata',
            presentation: 'entities',
            relationship: 'shared-creator',
            title: 'Explore this universe'
        });
    }

    pushShelf(createAuthoritativeRelationshipShelf(authoritativeRelationships, usedItemIds, item));

    const preferredRow = getPreferredRecommendationRow(family, data.rows);

    if (preferredRow) {
        const copy = getRecommendationCopy(item, preferredRow);

        pushShelf(createMediaShelf({
            description: copy.description,
            id: `personalized-${preferredRow.id}`,
            orderLabel: 'Best match',
            presentation: 'cards',
            relationship: 'authoritative-recommendation',
            title: copy.title
        }, preferredRow.items, usedItemIds, item, 'Similar Watch History', null, 'Similar Watch History'));
    }

    const explicitScores = scores.filter(score => hasExplicitConnection(item, score.item as PtvRecord));
    pushShelf(createMediaShelf({
        description: 'Related through exact creator, studio, network, tag, genre, artist, or series metadata.',
        id: 'explicit-connections',
        orderLabel: 'Evidence match',
        presentation: 'cards',
        relationship: getExplicitShelfRelationship(item, explicitScores),
        title: getExplicitShelfTitle(family)
    }, explicitScores, usedItemIds, item, 'Explicit metadata connection'));

    const hiddenGems = data.rows.find(row => row.id === 'hidden-gems');

    if (hiddenGems && shelves.length < CINEMATIC_SHELF_LIMIT) {
        pushShelf(createMediaShelf({
            description: hiddenGems.explanation,
            id: 'hidden-gems',
            orderLabel: 'Discovery match',
            presentation: 'cards',
            relationship: 'authoritative-recommendation',
            title: hiddenGems.title
        }, hiddenGems.items, usedItemIds, item, 'Hidden Gem', null, 'Hidden Gem'));
    }

    const copy = getFamilyCopy(family);

    return {
        candidateCount: scores.length,
        dedupedCandidateCount: Math.max(0, sourceCount - scores.length),
        facts: getFacts(item),
        family,
        gateway: createGateway(item, family, shelves),
        kicker: copy.kicker,
        shelves,
        summary: copy.summary,
        title: getText(item, 'Name', 'name') || 'this title'
    };
}
