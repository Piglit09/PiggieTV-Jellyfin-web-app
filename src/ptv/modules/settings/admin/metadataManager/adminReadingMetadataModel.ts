export const ADMIN_READING_PROVIDER_AUTO = 'auto';

export type AdminReadingMediaClass =
    | 'book'
    | 'comic'
    | 'graphic-novel'
    | 'manga'
    | 'manhua'
    | 'manhwa'
    | 'unknown';

export type AdminReadingProviderFailureKind =
    | 'authentication'
    | 'bad-request'
    | 'cancelled'
    | 'network'
    | 'parse'
    | 'rate-limit'
    | 'timeout'
    | 'unavailable'
    | 'unknown';

export type AdminReadingProviderState =
    | 'available'
    | 'disabled'
    | 'misconfigured'
    | 'rate-limited'
    | 'unreachable'
    | 'unknown';

export type AdminReadingLocalInspectionState =
    | 'inspected'
    | 'not-found'
    | 'rejected'
    | 'unavailable'
    | 'unknown'
    | 'unsupported';

export type AdminReadingLocalMetadataSummary = Readonly<{
    sources: readonly string[];
    state: AdminReadingLocalInspectionState;
    warnings: readonly string[];
}>;

export type AdminReadingProviderIdentifier = Readonly<{
    id: string;
    provider: string;
}>;

export type AdminReadingIdentityEvidenceSource = 'unknown' | 'filename' | 'folder' | 'existing-metadata' | 'local-metadata' | 'administrator' | 'provider';
export type AdminReadingIdentitySource = 'FileName' | 'ImmediateFolder' | 'ComicInfo' | 'CurrentItem' | 'Provider';
export type AdminReadingRunEvidenceKind = 'Unknown' | 'ExplicitRun' | 'ExplicitVolume';
export type AdminReadingArchiveState = 'inspected' | 'absent' | 'unverified' | 'not-attempted';
export type AdminReadingScopedProviderId = Readonly<{ namespace: string; scope: 'Unknown' | 'Issue' | 'Series'; value: string }>;
export type AdminReadingIdentityRecord = Readonly<{
    hasRedactedIdentity: boolean;
    seriesTitle: string | null;
    issueNumber: string | null;
    volumeOrRunLabel: string | null;
    issuePublicationYear: number | null;
    issuePublicationDate: string | null;
    runEvidenceKind: AdminReadingRunEvidenceKind;
    source: AdminReadingIdentitySource;
    providerIds: readonly AdminReadingScopedProviderId[];
}>;
export type AdminReadingIdentitySources = Readonly<{
    archiveState: AdminReadingArchiveState;
    archiveReasonCode: string | null;
    fileName: AdminReadingIdentityRecord;
    immediateFolder: AdminReadingIdentityRecord;
    comicInfo: AdminReadingIdentityRecord;
    currentItem: AdminReadingIdentityRecord;
}>;
export type AdminReadingIdentityFinding = Readonly<{
    code: string;
    field: string;
    leftSource: AdminReadingIdentitySource;
    leftValue: string | null;
    rightSource: AdminReadingIdentitySource;
    rightValue: string | null;
    isConflict: boolean;
    isMaterialUncertainty: boolean;
}>;
export type AdminReadingIdentityAssessment = Readonly<{
    itemId: string;
    provider: string;
    providerId: string;
    searchGeneration: string;
    archiveRevision: string;
    revisionChanged: boolean;
    sources: AdminReadingIdentitySources;
    candidate: AdminReadingIdentityRecord;
    findings: readonly AdminReadingIdentityFinding[];
    requiresConflictAcknowledgment: boolean;
    requiresUnverifiedAcknowledgment: boolean;
    assessmentDigest: string;
}>;
export type AdminReadingIdentityReassessRequest = Readonly<{
    itemId: string;
    candidateContext: string;
    displayedRevision: string | null;
}>;
export type AdminReadingIdentityConflict = Readonly<{
    field: string;
    preferredSource: AdminReadingIdentityEvidenceSource;
    preferredValue: string | null;
    conflictingSource: AdminReadingIdentityEvidenceSource;
    conflictingValue: string | null;
}>;

export type AdminReadingMediaClassification = Readonly<{
    confidence: number;
    mediaClass: AdminReadingMediaClass;
    reasons: readonly string[];
}>;

export type AdminReadingStructuredQuery = Readonly<{
    alternateTitles: readonly string[];
    author: string | null;
    chapterNumber: string | null;
    classification: AdminReadingMediaClassification;
    cleanedTitle: string;
    editionKind: 'annual' | 'omnibus' | 'special' | 'standard' | 'trade-paperback';
    existingProviderIds: Readonly<Record<string, string>>;
    ignoredFilenameTokens: readonly string[];
    isbn: string | null;
    issueNumber: string | null;
    mediaClass: AdminReadingMediaClass;
    originalLanguage: string | null;
    providerId: AdminReadingProviderIdentifier | null;
    rawFileName: string;
    rawTitle: string;
    seriesTitle: string | null;
    volumeNumber: string | null;
    year: number | null;
    seriesTitleEvidence?: AdminReadingIdentityEvidenceSource;
    issueNumberEvidence?: AdminReadingIdentityEvidenceSource;
    seriesStartYear?: number | null;
    seriesStartYearEvidence?: AdminReadingIdentityEvidenceSource;
    issuePublicationYear?: number | null;
    issuePublicationDate?: string | null;
    issuePublicationEvidence?: AdminReadingIdentityEvidenceSource;
    folderCorroboratesSeriesTitle?: boolean;
    folderCorroboratesSeriesStartYear?: boolean;
    identityConflicts?: readonly AdminReadingIdentityConflict[];
}>;

export type AdminReadingPersonCredit = Readonly<{
    name: string;
    providerId: string | null;
    role: string | null;
}>;

export type AdminReadingScoreReason = Readonly<{
    code: string;
    evidence: string | null;
    impact: number;
    isPositive: boolean;
    message: string;
}>;

export type AdminReadingMetadataCandidate = Readonly<{
    assessmentContext?: string | null;
    archiveRevision?: string | null;
    assessmentDigest?: string | null;
    identityAssessment?: AdminReadingIdentityAssessment | null;
    hasRedactedIdentity?: boolean;
    runEvidenceKind?: AdminReadingRunEvidenceKind;
    identityProviderIds?: readonly AdminReadingScopedProviderId[];
    seriesTitleEvidence?: AdminReadingIdentityEvidenceSource;
    issueNumberEvidence?: AdminReadingIdentityEvidenceSource;
    seriesStartYearEvidence?: AdminReadingIdentityEvidenceSource;
    issuePublicationYear?: number | null;
    issuePublicationDate?: string | null;
    issuePublicationEvidence?: AdminReadingIdentityEvidenceSource;
    alternateTitles: readonly string[];
    artists: readonly AdminReadingPersonCredit[];
    authors: readonly AdminReadingPersonCredit[];
    bannerUrl: string | null;
    chapterNumber: string | null;
    countryOfOrigin: string | null;
    coverUrl: string | null;
    description: string | null;
    endYear: number | null;
    externalIds: Readonly<Record<string, string>>;
    genres: readonly string[];
    isbn10: string | null;
    isbn13: string | null;
    issueNumber: string | null;
    language: string | null;
    localizedTitles: Readonly<Record<string, string>>;
    mediaClass: AdminReadingMediaClass;
    provider: string;
    providerId: string;
    publisher: string | null;
    score: number | null;
    scoreReasons: readonly AdminReadingScoreReason[];
    seriesTitle: string | null;
    sourceUrl: string | null;
    startYear: number | null;
    status: string | null;
    tags: readonly string[];
    title: string;
    totalChapters: number | null;
    totalVolumes: number | null;
    volumeNumber: string | null;
    year: number | null;
}>;

export type AdminReadingProviderFailure = Readonly<{
    code: string;
    kind: AdminReadingProviderFailureKind;
    message: string;
    provider: string;
    retryAfterSeconds: number | null;
}>;

export type AdminReadingProviderSearchResult = Readonly<{
    cacheHit: boolean;
    candidates: readonly AdminReadingMetadataCandidate[];
    durationMilliseconds: number;
    failure: AdminReadingProviderFailure | null;
    provider: string;
    state: AdminReadingProviderState;
}>;

export type AdminReadingProviderStatus = Readonly<{
    displayName: string;
    message: string | null;
    provider: string;
    retryAfterSeconds: number | null;
    state: AdminReadingProviderState;
}>;

export type AdminReadingMetadataSearchRequest = Readonly<{
    searchGeneration?: string;
    author?: string | null;
    chapterNumber?: string | null;
    itemId: string;
    isbn?: string | null;
    issueNumber?: string | null;
    mediaClass?: AdminReadingMediaClass | null;
    provider?: string | null;
    providerId?: string | null;
    seriesTitle?: string | null;
    title?: string | null;
    volumeNumber?: string | null;
    year?: number | null;
}>;

export type AdminReadingMetadataSearchResponse = Readonly<{
    searchGeneration?: string | null;
    identitySources?: AdminReadingIdentitySources;
    candidates: readonly AdminReadingMetadataCandidate[];
    localMetadata: AdminReadingLocalMetadataSummary;
    providerResults: readonly AdminReadingProviderSearchResult[];
    query: AdminReadingStructuredQuery;
}>;

export type AdminReadingMetadataProvidersResponse = Readonly<{
    providers: readonly AdminReadingProviderStatus[];
}>;

export type AdminReadingApplyApproval = Readonly<{
    assessmentContext: string;
    assessmentDigest: string;
    archiveRevision: string;
    searchGeneration: string;
    acknowledgedConflictCodes: readonly string[];
    acknowledgedUnverifiedCodes: readonly string[];
}>;
