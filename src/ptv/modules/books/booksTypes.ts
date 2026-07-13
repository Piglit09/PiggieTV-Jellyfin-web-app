import type { PtvItem, PtvItemUserData } from '../../api';

export type PtvReadingRouteKind = 'books' | 'comics' | 'manga' | 'reading';

export type PtvReadingItemKind = 'book' | 'comic' | 'manga';

export type PtvReadingFileFormat = 'book' | 'comic' | 'epub' | 'pdf' | 'unsupported';

export type PtvReadingMetadataProviderId = 'comicvine' | 'googlebooks' | 'openlibrary';

export type PtvReadingMetadataProvider = {
    id: PtvReadingMetadataProviderId;
    label: string;
    providerKey: string;
    url: string;
    value: string;
};

export type PtvReadingMetadataStats = {
    collectionStatus?: 'collected' | 'notCollected';
    itemCount: number;
    providerCounts: Record<PtvReadingMetadataProviderId, number>;
};

export type PtvReadingPerson = {
    Name?: string;
    Type?: string;
};

export type PtvReadingMediaSource = {
    Container?: string;
    Id?: string;
    MediaStreams?: Array<{
        MimeType?: string;
    }>;
    MimeType?: string;
    Path?: string;
    Size?: number;
};

export type PtvReadingItem = PtvItem & {
    Album?: string;
    CollectionName?: string;
    Container?: string;
    DateCreated?: string;
    GenreItems?: Array<{
        Name?: string;
    }>;
    IndexNumber?: number;
    MediaSources?: PtvReadingMediaSource[];
    ParentIndexNumber?: number;
    Path?: string;
    People?: PtvReadingPerson[];
    ProviderIds?: Record<string, string>;
    PtvReadingLibraryKindHint?: PtvReadingItemKind;
    PtvReadingLibraryName?: string;
    SortName?: string;
    UserData?: PtvItemUserData;
};

export type PtvReadingLibraryScope = {
    collectionType?: string;
    id: string;
    itemCount?: number;
    kind: PtvReadingItemKind;
    name: string;
};

export type PtvReadingCacheStatus = 'hit' | 'miss' | 'refresh' | 'stale-hit' | 'write-error';

export type PtvReadingCacheDiagnostic = {
    backgroundRefreshCompleted?: boolean;
    backgroundRefreshDurationMs?: number | null;
    backgroundRefreshStarted?: boolean;
    cacheAgeMs?: number | null;
    cacheFresh?: boolean;
    cacheKey?: string;
    freshCacheWritten?: boolean;
    freshRenderApplied?: boolean;
    itemCount: number;
    payloadSize: number;
    refreshError?: string;
    refreshDurationMs: number | null;
    sectionCount: number;
    source: string;
    staleHit: boolean;
    status: PtvReadingCacheStatus;
    updatedAt: number;
};

export type PtvReadingLibraryDiagnostic = {
    collectionType: string;
    error?: string;
    fileFormats: string[];
    id: string;
    itemCount: number;
    itemTypes: string[];
    kind: PtvReadingItemKind;
    lastQueriedUrl: string;
    name: string;
    requestDurationMs: number | null;
    statusCode: number | null;
    timeoutReason?: string;
    updatedAt: number;
};

export type PtvReadingSectionStatus = 'error' | 'loading' | 'ready' | 'stale';

export type PtvReadingSectionDiagnostic = {
    error?: string;
    id: string;
    itemCount: number;
    lastQueriedUrl: string;
    requestDurationMs: number | null;
    source: string;
    status: PtvReadingSectionStatus;
    statusCode: number | null;
    timeoutReason?: string;
    title: string;
    updatedAt: number;
};

export type PtvReadingSection = {
    diagnostics?: PtvReadingSectionDiagnostic;
    error?: string;
    id: string;
    isLoading?: boolean;
    items: PtvReadingItem[];
    kind?: PtvReadingItemKind;
    subtitle?: string;
    title: string;
};

export type PtvReadingLibraryDebug = {
    dropReasons: string[];
    droppedItemCount: number;
    fetchedItemCount: number;
    jellyfinItemTotal: number;
    jellyfinRouteItemTotal: number;
    kindCounts: Record<PtvReadingItemKind, number>;
    lastReadingQueryUrl: string;
    libraryDiagnostics: PtvReadingLibraryDiagnostic[];
    pageCount: number;
    pageSize: number;
    readingLibraryNames: string[];
    requestDurationMs: number | null;
    routeKind: PtvReadingRouteKind;
    selectedReadingLibraryIds: string[];
    sectionDiagnostics: PtvReadingSectionDiagnostic[];
    statusCode: number | null;
    timeoutReason?: string;
    totalRecordCountFromApi: number;
};

export type PtvReadingHomeData = {
    cacheDiagnostics?: PtvReadingCacheDiagnostic;
    generatedAt: number;
    isPartial?: boolean;
    kind: PtvReadingRouteKind;
    libraries: PtvReadingLibraryScope[];
    libraryDebug?: PtvReadingLibraryDebug;
    sectionDiagnostics?: PtvReadingSectionDiagnostic[];
    sections: PtvReadingSection[];
    stats: {
        favoriteCount: number;
        itemCount: number;
        libraryCount: number;
        metadata: PtvReadingMetadataStats;
        resumedCount: number;
    };
};

export type PtvReadingLibraryIndex = {
    debug: PtvReadingLibraryDebug;
    items: PtvReadingItem[];
    libraries: PtvReadingLibraryScope[];
};
