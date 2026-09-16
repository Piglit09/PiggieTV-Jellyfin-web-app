import {
    getPtvItem,
    getPtvItems,
    type PtvItem
} from '../../api';
import { recordPtvEvent } from '../../core/observability';

import {
    getPtvCollectionItemText,
    getPtvCollectionStringList,
    normalizeJellyfinCollection
} from './collectionModel';
import {
    buildPtvCrossLibraryCollections,
    buildPtvCuratedCollections,
    getPtvRelationshipReasonCounts
} from './collectionRelationships';
import type {
    PtvCollectionLandingSection,
    PtvCollectionSectionId,
    PtvCollectionSourceStatus,
    PtvCuratedCollectionDefinition,
    PtvPortableCollection
} from './collectionTypes';
import type { PtvCollectionPreferences } from './collectionPreferences';

const COLLECTION_FIELDS = [
    'BackdropImageTags',
    'ChildCount',
    'CommunityRating',
    'DateCreated',
    'Genres',
    'Overview',
    'PrimaryImageAspectRatio',
    'ProviderIds',
    'RecursiveItemCount',
    'Studios',
    'Tags',
    'UserData'
].join(',');
const MEMBER_FIELDS = [
    COLLECTION_FIELDS,
    'AlbumArtists',
    'ArtistItems',
    'CollectionName',
    'MediaSources',
    'ParentId',
    'People',
    'PremiereDate',
    'SeriesName'
].join(',');
const MAX_JELLYFIN_COLLECTIONS = 200;
const MAX_DISCOVERY_ITEMS = 400;
const MAX_SECTION_COLLECTIONS = 14;

export const DEFAULT_PTV_CURATED_COLLECTION_DEFINITIONS: readonly PtvCuratedCollectionDefinition[] = [
    {
        key: 'animation-worlds',
        match: 'any',
        minimumMembers: 3,
        overview: 'Animation and anime connected by explicit library metadata.',
        rules: [
            { field: 'genre', reason: 'configured-franchise', value: 'Animation' },
            { field: 'genre', reason: 'configured-franchise', value: 'Anime' }
        ],
        section: 'animation-anime',
        subtitle: 'Curated from your metadata',
        title: 'Animation Worlds'
    },
    {
        key: 'seasonal-halloween',
        match: 'any',
        minimumMembers: 3,
        overview: 'A seasonal collection built from explicit Halloween metadata.',
        rules: [
            { field: 'genre', reason: 'seasonal-rule', value: 'Halloween' },
            { field: 'tag', reason: 'seasonal-rule', value: 'Halloween' }
        ],
        section: 'seasonal',
        subtitle: 'Seasonal collection',
        title: 'Halloween Collection'
    },
    {
        key: 'seasonal-holidays',
        match: 'any',
        minimumMembers: 3,
        overview: 'Holiday stories grouped from explicit genres and tags.',
        rules: [
            { field: 'genre', reason: 'seasonal-rule', value: 'Christmas' },
            { field: 'tag', reason: 'seasonal-rule', value: 'Christmas' },
            { field: 'tag', reason: 'seasonal-rule', value: 'Holiday' }
        ],
        section: 'seasonal',
        subtitle: 'Seasonal collection',
        title: 'Holiday Collection'
    },
    {
        key: 'award-winners',
        match: 'any',
        minimumMembers: 3,
        overview: 'Recognized titles grouped only when award metadata is present.',
        rules: [
            { field: 'tag', reason: 'shared-tag', value: 'Award Winner' },
            { field: 'tag', reason: 'shared-tag', value: 'Oscar Winner' }
        ],
        section: 'featured',
        subtitle: 'Metadata-curated',
        title: 'Award Winners'
    }
];

export type PtvCollectionCriticalResult = Readonly<{
    collections: readonly PtvPortableCollection[];
    source: PtvCollectionSourceStatus;
}>;

export type PtvCollectionDeferredResult = Readonly<{
    crossLibrary: readonly PtvPortableCollection[];
    curated: readonly PtvPortableCollection[];
    relationshipReasonCounts: Readonly<Record<string, number>>;
    sources: readonly PtvCollectionSourceStatus[];
}>;

function getItems(result: { Items?: PtvItem[] }) {
    return Array.isArray(result.Items) ? result.Items : [];
}

function recordSource(
    sourceType: PtvCollectionSourceStatus['sourceType'],
    count: number,
    status: PtvCollectionSourceStatus['status'],
    errorCategory: PtvCollectionSourceStatus['errorCategory'] = 'none'
) {
    const source = { count, errorCategory, sourceType, status } as const;

    recordPtvEvent('route', 'collections-source-settled', source);
    return source;
}

export async function loadPtvCollectionCritical(
    signal: AbortSignal
): Promise<PtvCollectionCriticalResult> {
    const response = await getPtvItems({
        EnableImages: true,
        EnableImageTypes: 'Primary,Backdrop,Thumb,Logo',
        Fields: COLLECTION_FIELDS,
        ImageTypeLimit: 2,
        IncludeItemTypes: 'BoxSet',
        Limit: MAX_JELLYFIN_COLLECTIONS,
        Recursive: true,
        SortBy: 'SortName',
        SortOrder: 'Ascending'
    }, { signal });
    const collections = getItems(response)
        .map(item => normalizeJellyfinCollection(item))
        .filter((collection): collection is PtvPortableCollection => Boolean(collection));
    const source = recordSource('jellyfin', collections.length, collections.length ? 'ready' : 'empty');

    return { collections, source };
}

export async function loadPtvCollectionDeferred(
    signal: AbortSignal,
    definitions = DEFAULT_PTV_CURATED_COLLECTION_DEFINITIONS
): Promise<PtvCollectionDeferredResult> {
    const response = await getPtvItems({
        EnableImages: true,
        EnableImageTypes: 'Primary,Backdrop,Thumb',
        Fields: MEMBER_FIELDS,
        ImageTypeLimit: 1,
        IncludeItemTypes: 'Movie,Series,Episode,Video,MusicAlbum,Audio,Book,AudioBook',
        Limit: MAX_DISCOVERY_ITEMS,
        Recursive: true,
        SortBy: 'DateCreated',
        SortOrder: 'Descending'
    }, { signal });
    const items = getItems(response);
    const curated = buildPtvCuratedCollections(items, definitions);
    const crossLibrary = buildPtvCrossLibraryCollections(items);
    const allDerived = [...curated, ...crossLibrary];

    recordPtvEvent('route', 'collections-relationships-generated', {
        collectionCount: allDerived.length,
        memberCount: allDerived.reduce((count, collection) => count + collection.memberCount, 0),
        reasonCounts: getPtvRelationshipReasonCounts(allDerived)
    });

    return {
        crossLibrary,
        curated,
        relationshipReasonCounts: getPtvRelationshipReasonCounts(allDerived),
        sources: [
            recordSource('curated', curated.length, curated.length ? 'ready' : 'empty'),
            recordSource('cross-library', crossLibrary.length, crossLibrary.length ? 'ready' : 'empty')
        ]
    };
}

function getJellyfinId(collectionKey: string) {
    return collectionKey.startsWith('jellyfin:') ? collectionKey.slice('jellyfin:'.length) : collectionKey;
}

export async function loadPtvCollectionDetails(
    collectionKey: string,
    signal: AbortSignal
): Promise<PtvPortableCollection | null> {
    if (!collectionKey) return null;

    if (!collectionKey.startsWith('curated:') && !collectionKey.startsWith('cross:')) {
        const itemId = getJellyfinId(collectionKey);
        const [raw, membersResult] = await Promise.all([
            getPtvItem<PtvItem>(itemId, { signal }),
            getPtvItems({
                EnableImages: true,
                EnableImageTypes: 'Primary,Backdrop,Thumb',
                Fields: MEMBER_FIELDS,
                ImageTypeLimit: 1,
                Limit: MAX_JELLYFIN_COLLECTIONS,
                ParentId: itemId,
                Recursive: true
            }, { signal })
        ]);
        const members = getItems(membersResult);
        const directCollection = normalizeJellyfinCollection(raw, members);

        if (directCollection) return directCollection;

        const verificationResult = await getPtvItems({
            EnableImages: true,
            EnableImageTypes: 'Primary,Backdrop,Thumb,Logo',
            Fields: COLLECTION_FIELDS,
            Ids: itemId,
            ImageTypeLimit: 2,
            IncludeItemTypes: 'BoxSet',
            Limit: 1,
            Recursive: true
        }, { signal });
        const verifiedCollection = getItems(verificationResult)[0];

        return verifiedCollection ? normalizeJellyfinCollection(verifiedCollection, members) : null;
    }

    const deferred = await loadPtvCollectionDeferred(signal);

    return [...deferred.curated, ...deferred.crossLibrary]
        .find(collection => collection.key === collectionKey) || null;
}

function getCollectionMetadata(collection: PtvPortableCollection) {
    const raw = collection.raw;

    return [
        collection.title,
        collection.subtitle,
        collection.section,
        ...getPtvCollectionStringList(raw?.Genres),
        ...getPtvCollectionStringList(raw?.Tags),
        ...getPtvCollectionStringList(raw?.Studios)
    ].join(' ').toLocaleLowerCase('en-US');
}

function dedupeCollections(collections: readonly PtvPortableCollection[]) {
    const seen = new Set<string>();

    return collections.flatMap(collection => {
        if (seen.has(collection.key)) return [];

        seen.add(collection.key);
        return [collection];
    });
}

function getDateCreated(collection: PtvPortableCollection) {
    return Date.parse(getPtvCollectionItemText(collection.raw, 'DateCreated', 'dateCreated')) || 0;
}

function getRating(collection: PtvPortableCollection) {
    const value = Number(collection.raw?.CommunityRating);

    return Number.isFinite(value) ? value : 0;
}

function makeSection(
    id: PtvCollectionSectionId,
    title: string,
    kicker: string,
    collections: readonly PtvPortableCollection[]
): PtvCollectionLandingSection | null {
    const bounded = dedupeCollections(collections).slice(0, MAX_SECTION_COLLECTIONS);

    return bounded.length ? { collections: bounded, id, kicker, title } : null;
}

function isVisibleCollection(collection: PtvPortableCollection, preferences: PtvCollectionPreferences) {
    return !preferences.hiddenCollectionKeys.includes(collection.key)
        && !preferences.showFewerReasonCategories.includes(collection.relationshipReason);
}

export function buildPtvCollectionLandingSections(input: {
    critical: readonly PtvPortableCollection[];
    deferred?: PtvCollectionDeferredResult | null;
    genre?: string;
    preferences: PtvCollectionPreferences;
    query?: string;
    view?: string;
}) {
    const deferredCollections = input.deferred ?
        [...input.deferred.curated, ...input.deferred.crossLibrary] :
        [];
    const all = dedupeCollections([...input.critical, ...deferredCollections])
        .filter(collection => isVisibleCollection(collection, input.preferences));
    const query = (input.query || '').trim().toLocaleLowerCase('en-US');
    const genre = (input.genre || '').trim().toLocaleLowerCase('en-US');
    const filtered = all.filter(collection => {
        const metadata = getCollectionMetadata(collection);

        return (!query || metadata.includes(query)) && (!genre || metadata.includes(genre));
    });
    const pinned = filtered.filter(collection => input.preferences.pinnedCollectionKeys.includes(collection.key));
    const continueCollections = filtered.filter(collection => collection.progress.status === 'in-progress');
    const featured = [...filtered].sort((left, right) => (
        getRating(right) - getRating(left)
        || right.memberCount - left.memberCount
        || left.title.localeCompare(right.title)
    ));
    const movieUniverses = filtered.filter(collection => {
        const metadata = getCollectionMetadata(collection);

        return collection.sourceType === 'jellyfin' || /\b(movie|cinema|film)\b/.test(metadata);
    });
    const tvUniverses = filtered.filter(collection => /\b(series|television|tv|episode)\b/.test(getCollectionMetadata(collection)));
    const animation = filtered.filter(collection => /\b(animation|anime|cartoon)\b/.test(getCollectionMetadata(collection)));
    const seasonal = filtered.filter(collection => (
        collection.section === 'seasonal'
        || /\b(seasonal|halloween|christmas|holiday)\b/.test(getCollectionMetadata(collection))
    ));
    const crossLibrary = filtered.filter(collection => collection.sourceType === 'cross-library');
    const recentlyAdded = [...filtered].sort((left, right) => getDateCreated(right) - getDateCreated(left));
    const sectionCandidates = [
        input.preferences.personalizedEnabled ?
            makeSection('continue', 'Continue This Collection', 'Pick up the next chapter', continueCollections) :
            null,
        makeSection('pinned', 'Pinned Collections', 'Saved for this profile', pinned),
        makeSection('featured', 'Featured Collections', 'Cinematic destinations', featured),
        makeSection('jellyfin', 'Your Jellyfin Collections', 'Owned by your Jellyfin library', input.critical),
        makeSection('movie-universes', 'Movie Universes', 'Franchises on the big screen', movieUniverses),
        makeSection('tv-universes', 'TV Universes', 'Connected series and specials', tvUniverses),
        makeSection('animation-anime', 'Animation and Anime', 'Illustrated worlds', animation),
        makeSection('seasonal', 'Seasonal Collections', 'Timely library stories', seasonal),
        input.preferences.crossLibraryEnabled ?
            makeSection('cross-library', 'Cross-Library Worlds', 'Movies, shows, music, and reading', crossLibrary) :
            null,
        makeSection('recently-added', 'Recently Added to Collections', 'Newly expanded worlds', recentlyAdded)
    ].filter((section): section is PtvCollectionLandingSection => Boolean(section));
    const byId = new Map(sectionCandidates.map(section => [section.id, section]));
    const ordered = input.preferences.sectionOrder
        .map(id => byId.get(id))
        .filter((section): section is PtvCollectionLandingSection => (
            Boolean(section) && input.preferences.sectionVisibility[section!.id] !== false
        ));

    if (input.view === 'featured') return ordered.filter(section => section.id === 'featured');
    if (input.view === 'all' || input.view === 'genre') {
        const section = makeSection(
            'jellyfin',
            genre ? (input.genre || 'Collection genre') : 'All Collections',
            genre ? 'Explicit metadata match' : 'Jellyfin and PiggieTV collections',
            filtered
        );

        return section ? [section] : [];
    }

    return ordered;
}

export function getPtvCollectionGenres(collections: readonly PtvPortableCollection[]) {
    const counts = new Map<string, number>();

    collections.forEach(collection => {
        getPtvCollectionStringList(collection.raw?.Genres).forEach(genre => {
            counts.set(genre, (counts.get(genre) || 0) + 1);
        });
    });

    return [...counts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 60)
        .map(([name, count]) => ({ count, name }));
}

export function getPtvCollectionHero(
    collections: readonly PtvPortableCollection[],
    preferences: PtvCollectionPreferences
) {
    if (!preferences.heroEnabled) return null;

    const visible = collections.filter(collection => isVisibleCollection(collection, preferences));

    return [...visible].sort((left, right) => (
        Number(Boolean(right.raw?.BackdropImageTags?.length)) - Number(Boolean(left.raw?.BackdropImageTags?.length))
        || getRating(right) - getRating(left)
        || right.memberCount - left.memberCount
    ))[0] || null;
}
