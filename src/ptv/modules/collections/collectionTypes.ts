import type { PtvItem } from '../../api';

export type PtvCollectionSourceType = 'cross-library' | 'curated' | 'dynamic' | 'jellyfin';

export type PtvCollectionRelationshipReason =
    | 'configured-franchise'
    | 'creator'
    | 'jellyfin-collection'
    | 'provider-series'
    | 'reading-series'
    | 'seasonal-rule'
    | 'shared-tag'
    | 'soundtrack'
    | 'studio-brand'
    | 'user-history';

export type PtvCollectionMediaCategory =
    | 'books'
    | 'comics'
    | 'manga'
    | 'movies'
    | 'music'
    | 'series'
    | 'specials'
    | 'unknown';

export type PtvCollectionOrderMode =
    | 'collection'
    | 'release'
    | 'recently-added'
    | 'timeline'
    | 'title';

export type PtvCollectionSectionId =
    | 'animation-anime'
    | 'continue'
    | 'cross-library'
    | 'featured'
    | 'jellyfin'
    | 'movie-universes'
    | 'pinned'
    | 'recently-added'
    | 'seasonal'
    | 'tv-universes';

export const PTV_COLLECTION_SECTION_IDS: readonly PtvCollectionSectionId[] = [
    'continue',
    'pinned',
    'featured',
    'jellyfin',
    'movie-universes',
    'tv-universes',
    'animation-anime',
    'seasonal',
    'cross-library',
    'recently-added'
];

export type PtvCollectionCapabilityFlags = Readonly<{
    canFavorite: boolean;
    canHide: boolean;
    canOpenMembers: boolean;
    canPin: boolean;
    canPlayNext: boolean;
    canReorder: boolean;
}>;

export type PtvCollectionMemberProgress = Readonly<{
    completed: boolean;
    percent: number;
    positionTicks: number;
    started: boolean;
}>;

export type PtvCollectionMemberSummary = Readonly<{
    collectionOrder: number;
    dateCreated: string;
    key: string;
    mediaCategory: PtvCollectionMediaCategory;
    progress: PtvCollectionMemberProgress;
    raw: PtvItem;
    relationshipReason: PtvCollectionRelationshipReason;
    releaseDate: string;
    section: string;
    timelineOrder: number | null;
    title: string;
}>;

export type PtvCollectionProgressSummary = Readonly<{
    completedCount: number;
    inProgressCount: number;
    nextMember: PtvCollectionMemberSummary | null;
    percent: number;
    status: 'completed' | 'in-progress' | 'not-started';
    totalCount: number;
}>;

export type PtvPortableCollection = Readonly<{
    artworkCandidates: readonly PtvItem[];
    backdropCandidates: readonly PtvItem[];
    capabilities: PtvCollectionCapabilityFlags;
    key: string;
    memberCount: number;
    members: readonly PtvCollectionMemberSummary[];
    overview: string;
    progress: PtvCollectionProgressSummary;
    raw: PtvItem | null;
    relationshipReason: PtvCollectionRelationshipReason;
    section: string;
    sourceType: PtvCollectionSourceType;
    subtitle: string;
    tagline: string;
    title: string;
}>;

export type PtvCollectionRule = Readonly<{
    field: 'genre' | 'provider' | 'reading-series' | 'studio' | 'tag';
    providerKey?: string;
    reason: PtvCollectionRelationshipReason;
    value: string;
}>;

export type PtvCuratedCollectionDefinition = Readonly<{
    key: string;
    match: 'all' | 'any';
    minimumMembers?: number;
    overview?: string;
    rules: readonly PtvCollectionRule[];
    section: string;
    subtitle?: string;
    title: string;
}>;

export type PtvCollectionLandingSection = Readonly<{
    collections: readonly PtvPortableCollection[];
    id: PtvCollectionSectionId;
    kicker: string;
    title: string;
}>;

export type PtvCollectionSourceStatus = Readonly<{
    count: number;
    errorCategory: 'cancelled' | 'none' | 'server' | 'unknown';
    sourceType: PtvCollectionSourceType;
    status: 'empty' | 'failed' | 'ready';
}>;
