import type { PtvItem } from '../../../api';

export type PtvRecommendationMediaType =
    | 'anime'
    | 'audiobook'
    | 'book'
    | 'comic'
    | 'game'
    | 'manga'
    | 'movie'
    | 'music'
    | 'show'
    | 'unknown';

export type PtvRecommendationSourceType =
    | 'candidate'
    | 'favorite'
    | 'history'
    | 'recently-added'
    | 'recently-viewed'
    | 'resume';

export type PtvTasteCategory =
    | 'actors'
    | 'artists'
    | 'authors'
    | 'bookGenres'
    | 'collections'
    | 'decades'
    | 'directors'
    | 'genres'
    | 'mediaTypes'
    | 'musicGenres'
    | 'series'
    | 'studios'
    | 'tags';

export type PtvTasteSignal = {
    category: PtvTasteCategory;
    count: number;
    label: string;
    score: number;
    sources: Partial<Record<PtvRecommendationSourceType, number>>;
};

export type PtvTasteProfile = {
    crossMediaTerms: Record<string, PtvTasteSignal>;
    favoriteActors: Record<string, PtvTasteSignal>;
    favoriteArtists: Record<string, PtvTasteSignal>;
    favoriteAuthors: Record<string, PtvTasteSignal>;
    favoriteBookGenres: Record<string, PtvTasteSignal>;
    favoriteCollections: Record<string, PtvTasteSignal>;
    favoriteDecades: Record<string, PtvTasteSignal>;
    favoriteDirectors: Record<string, PtvTasteSignal>;
    favoriteGenres: Record<string, PtvTasteSignal>;
    favoriteMusicGenres: Record<string, PtvTasteSignal>;
    favoriteSeries: Record<string, PtvTasteSignal>;
    favoriteStudios: Record<string, PtvTasteSignal>;
    mediaTypes: Record<string, PtvTasteSignal>;
    profileVersion: number;
    serverId: string;
    sourceCounts: Partial<Record<PtvRecommendationSourceType, number>>;
    updatedAt: number;
    userId: string;
};

export type PtvRecommendationItem = PtvItem & {
    Album?: string;
    AlbumArtist?: string;
    AlbumPrimaryImageItemId?: string;
    AlbumPrimaryImageTag?: string;
    AlbumArtists?: Array<{ Name?: string }>;
    AlbumId?: string;
    Artist?: string;
    ArtistItems?: Array<{ Id?: string; Name?: string }>;
    Artists?: string[];
    CollectionName?: string;
    DateCreated?: string;
    GenreItems?: Array<{ Name?: string }>;
    MusicBrainzArtistName?: string;
    MusicBrainzArtistNames?: string[];
    MusicBrainzTitle?: string;
    ParentPrimaryImageItemId?: string;
    ParentPrimaryImageTag?: string;
    People?: Array<{ Name?: string; Role?: string; Type?: string }>;
    ProviderIds?: Record<string, string>;
    PtvRecommendationReasonText?: string;
    PtvRecommendationReasons?: string[];
    SeriesName?: string;
    Studios?: string[];
};

export type PtvRecommendationInputItem = {
    item: PtvRecommendationItem;
    source: PtvRecommendationSourceType;
};

export type PtvRecommendationReason = {
    category: PtvTasteCategory | 'cross-media' | 'discovery' | 'quality';
    label: string;
    score: number;
    source?: PtvRecommendationSourceType;
};

export type PtvRecommendationScore = {
    affinityScore: number;
    discoveryWeight: number;
    item: PtvRecommendationItem;
    mediaType: PtvRecommendationMediaType;
    reasons: PtvRecommendationReason[];
    score: number;
    source: string;
};

export type PtvRecommendationRowDiagnostics = {
    candidateCount: number;
    dedupeRemovals: number;
    discoveryFallbackCount?: number;
    finalRenderedCount: number;
    hydrationRemovals: number;
    primaryCandidateCount?: number;
    secondaryFallbackCount?: number;
};

export type PtvRecommendationRow = {
    diagnostics?: PtvRecommendationRowDiagnostics;
    explanation: string;
    id: string;
    items: PtvRecommendationScore[];
    mediaType?: PtvRecommendationMediaType | 'mixed';
    title: string;
};

export type PtvRecommendationMix = {
    description: string;
    id: string;
    items: PtvRecommendationScore[];
    title: string;
};

export type PtvRecommendationDebugItem = {
    affinityMatch: string[];
    discoveryWeight: number;
    itemId: string;
    mediaType: PtvRecommendationMediaType;
    reasons: PtvRecommendationReason[];
    score: number;
    source: string;
    title: string;
};

export type PtvRecommendationDebugSignal = {
    count: number;
    label: string;
    score: number;
};

export type PtvRecommendationDropReason = {
    id: string;
    itemCount: number;
    reason: string;
    title: string;
};

export type PtvRecommendationScoreDistribution = {
    buckets: Array<{ count: number; label: string }>;
    max: number;
    median: number;
    min: number;
    p25: number;
    p75: number;
    p90: number;
};

export type PtvRecommendationQualityDebug = {
    duplicateItemsRemoved: number;
    rowDiagnostics?: PtvRecommendationRowDiagnostics[];
    rowOverlapPercentage: number;
    scoreDistribution: PtvRecommendationScoreDistribution;
    unresolvedArtistCount: number;
};

export type PtvRecommendationSurfaceDebug = {
    duplicateItemsRemoved: number;
    recommendationDropReasons: PtvRecommendationDropReason[];
    recommendationRowsDropped: number;
    recommendationRowsLoaded: number;
    recommendationRowsRendered: number;
    rowOverlapPercentage: number;
    scoreDistribution: PtvRecommendationScoreDistribution;
    unresolvedArtistCount: number;
};

export type PtvRecommendationSourceFailure = {
    durationMs?: number;
    endpoint?: string;
    error: string;
    failureReason?: string;
    libraryId?: string | null;
    responseBodySummary?: string;
    source: string;
    statusCode?: number | null;
    url?: string;
    userId?: string | null;
};

export type PtvRecommendationSourceTiming = {
    candidateCount?: number;
    clientProcessingMs?: number;
    durationMs: number;
    endpoint?: string;
    error?: string;
    failureReason?: string;
    itemCount: number;
    libraryId?: string | null;
    query?: Record<string, unknown> | string;
    requestMs?: number;
    responseBodySummary?: string;
    responseSizeBytes?: number;
    serverTimeMs?: number | null;
    slow: boolean;
    source: string;
    statusCode?: number | null;
    status: 'empty' | 'failed' | 'success';
    subqueries?: Array<{
        endpoint?: string;
        error?: string;
        failureReason?: string;
        itemCount?: number;
        label?: string;
        libraryId?: string | null;
        parameterUnderTest?: string;
        query?: Record<string, unknown> | string;
        requestMs?: number;
        responseBodySummary?: string;
        responseSizeBytes?: number;
        serverTimeMs?: number | null;
        status?: 'empty' | 'failed' | 'success';
        statusCode?: number | null;
        source?: string;
        url?: string;
        usable?: boolean;
        used?: boolean;
        userId?: string | null;
    }>;
    url?: string;
    userId?: string | null;
};

export type PtvRecommendationDebugReport = {
    generatedAt: number;
    items: PtvRecommendationDebugItem[];
    profile: {
        serverId: string;
        topArtists: PtvRecommendationDebugSignal[];
        topAuthors: PtvRecommendationDebugSignal[];
        topBookGenres: PtvRecommendationDebugSignal[];
        topCollections: PtvRecommendationDebugSignal[];
        topCrossMediaTerms: PtvRecommendationDebugSignal[];
        topGenres: PtvRecommendationDebugSignal[];
        topStudios: PtvRecommendationDebugSignal[];
        updatedAt: number;
        userId: string;
    };
    profileVersion: number;
    quality: PtvRecommendationQualityDebug;
    sourceCounts: Partial<Record<PtvRecommendationSourceType, number>>;
    sourceFailures: PtvRecommendationSourceFailure[];
    sourceTimings: PtvRecommendationSourceTiming[];
};

export type PtvRecommendationEngineResult = {
    candidates: PtvRecommendationScore[];
    debug: PtvRecommendationDebugReport;
    mixes: PtvRecommendationMix[];
    profile: PtvTasteProfile;
    rows: PtvRecommendationRow[];
};

export type PtvRecommendationDataBundle = {
    candidates: PtvRecommendationInputItem[];
    profileSignals: PtvRecommendationInputItem[];
    serverId: string;
    sourceFailures: PtvRecommendationSourceFailure[];
    sourceTimings: PtvRecommendationSourceTiming[];
    userId: string;
};

export type PtvRecommendationRunOptions = {
    includeHomeScans?: boolean;
    now?: number;
    signal?: AbortSignal;
    sourceFailures?: PtvRecommendationSourceFailure[];
    sourceTimings?: PtvRecommendationSourceTiming[];
};

export type PtvRecommendationHomeData = {
    candidates: PtvRecommendationScore[];
    generatedAt: number;
    mixes: PtvRecommendationMix[];
    profileUpdatedAt: number;
    quality: PtvRecommendationQualityDebug;
    rows: PtvRecommendationRow[];
};

export type PtvRecommendationDashboardData = PtvRecommendationEngineResult & {
    generatedAt: number;
    metrics: {
        crossMediaMatches: number;
        discoveryPercentage: number;
        duplicateItemsRemoved: number;
        recommendationCount: number;
        rowOverlapPercentage: number;
        scoreDistribution: PtvRecommendationScoreDistribution;
        sourceFailures: PtvRecommendationSourceFailure[];
        sourceTimings: PtvRecommendationSourceTiming[];
        sourceCount: number;
        failedSourceCount: number;
        topRecommendationSources: Array<{ label: string; score: number }>;
        unresolvedArtistCount: number;
    };
};
