export const ADMIN_METADATA_QUALITY_PAGE_SIZE = 50;
export const ADMIN_METADATA_QUALITY_RUNNING_REFRESH_INTERVAL_MS = 8_000;
export const ADMIN_METADATA_QUALITY_OVERVIEW_REFRESH_INTERVAL_MS = 90_000;

export type AdminMetadataQualityScanMode = 'changed' | 'full';
export type AdminMetadataQualityResolutionAction = 'keep_current' | 'dismiss';
export type AdminMetadataQualityScanState =
    | 'idle'
    | 'scanning'
    | 'completed'
    | 'failed'
    | 'cancelled';
export type AdminMetadataQualityStatus =
    | 'healthy'
    | 'review'
    | 'likely_wrong'
    | 'incomplete'
    | 'unavailable'
    | 'dismissed'
    | 'resolved';

export type AdminMetadataQualityStatusFilter = AdminMetadataQualityStatus | 'all';

export type AdminMetadataQualityAiCredentialSource =
    | 'environment'
    | 'managed'
    | 'missing'
    | 'unknown';

export type AdminMetadataQualityAiModelSource =
    | 'default'
    | 'environment'
    | 'invalid'
    | 'settings'
    | 'unknown';

export type AdminMetadataQualityAiTestStatus =
    | 'success'
    | 'missing-credential'
    | 'invalid-credential'
    | 'permission-denied'
    | 'model-unavailable'
    | 'invalid-model'
    | 'quota-unavailable'
    | 'rate-limited'
    | 'timeout'
    | 'api-unavailable'
    | 'malformed-response'
    | 'response-too-large'
    | 'refused'
    | 'test-in-progress'
    | 'unknown-failure';

export type AdminMetadataQualityAiStatus = Readonly<{
    configuredModel: string;
    credentialConfigured: boolean;
    credentialSource: AdminMetadataQualityAiCredentialSource;
    effectiveModel: string;
    enabled: boolean;
    lastTestAt: string | null;
    lastTestErrorCode: AdminMetadataQualityAiTestStatus | null;
    lastTestModel: string | null;
    lastTestStatus: AdminMetadataQualityAiTestStatus | null;
    modelSource: AdminMetadataQualityAiModelSource;
}>;

export type AdminMetadataQualityAiTestResult = Readonly<{
    message: string;
    model: string;
    status: AdminMetadataQualityAiTestStatus;
    success: boolean;
    testedAt: string | null;
}>;

export type AdminMetadataQualityLibrary = Readonly<{
    id: string;
    name: string;
}>;

export type AdminMetadataQualityCounts = Readonly<{
    dismissed: number | null;
    healthy: number | null;
    incomplete: number | null;
    likelyIncorrect: number | null;
    needsReview: number | null;
    resolved: number | null;
    totalScanned: number | null;
    unavailable: number | null;
}>;

export type AdminMetadataQualityScanProgress = Readonly<{
    completedAt: string | null;
    errorMessage: string | null;
    itemCount: number | null;
    mode: AdminMetadataQualityScanMode | null;
    processedCount: number | null;
    runId: string | null;
    startedAt: string | null;
    state: AdminMetadataQualityScanState;
}>;

export type AdminMetadataQualitySummary = Readonly<{
    counts: AdminMetadataQualityCounts;
    lastScanAt: string | null;
    libraries: readonly AdminMetadataQualityLibrary[];
    ruleVersion: string | null;
    scan: AdminMetadataQualityScanProgress;
    scannerVersion: string | null;
}>;

export type AdminMetadataQualityReason = Readonly<{
    code: string;
    evidence: string | null;
    message: string;
    severity: 'error' | 'info' | 'warning';
}>;

export type AdminMetadataQualityMatch = Readonly<{
    issueNumber?: string | null;
    issuePublicationDate?: string | null;
    issuePublicationYear?: number | null;
    mediaClass?: 'book' | 'comic' | 'graphic-novel' | 'manga' | 'manhua' | 'manhwa' | 'unknown' | null;
    provider?: string | null;
    providerIds: Readonly<Record<string, string>>;
    publisher?: string | null;
    runtimeMinutes: number | null;
    seriesStartYear?: number | null;
    seriesTitle?: string | null;
    title: string;
    type: string | null;
    volumeId?: string | null;
    year: number | null;
}>;

export type AdminMetadataQualityResult = Readonly<{
    aiReviewed: boolean;
    completenessScore: number | null;
    currentMatch: AdminMetadataQualityMatch | null;
    fileName: string | null;
    folderName: string | null;
    itemId: string;
    itemType: string;
    libraryId: string | null;
    libraryName: string | null;
    matchConfidence: number | null;
    providerVerified: boolean;
    reasons: readonly AdminMetadataQualityReason[];
    resolutionState: 'corrected' | 'dismissed' | 'kept_current' | null;
    scannedAt: string | null;
    status: AdminMetadataQualityStatus;
    suggestedMatch: AdminMetadataQualityMatch | null;
    title: string;
}>;

export type AdminMetadataQualityCandidate = AdminMetadataQualityMatch & Readonly<{
    confidence?: 'excellent' | 'possible' | 'rejected' | 'strong' | 'weak' | null;
    hasHardConflict?: boolean;
    score: number | null;
    source: string | null;
}>;

export type AdminMetadataQualityDetail = AdminMetadataQualityResult & Readonly<{
    candidates: readonly AdminMetadataQualityCandidate[];
    signals: Readonly<Record<string, boolean | number | string | null>>;
}>;

export type AdminMetadataQualityResultPage = Readonly<{
    items: readonly AdminMetadataQualityResult[];
    limit: number;
    startIndex: number;
    totalRecordCount: number | null;
}>;

export type AdminMetadataQualityFilters = Readonly<{
    aiReviewed: 'all' | 'false' | 'true';
    itemType: string;
    libraryId: string;
    maxConfidence: number | null;
    minConfidence: number | null;
    provider: string;
    reason: string;
    search: string;
    sort: 'confidence' | 'library' | 'priority' | 'recent' | 'title';
    startIndex: number;
    status: AdminMetadataQualityStatusFilter;
}>;

export const DEFAULT_ADMIN_METADATA_QUALITY_FILTERS: AdminMetadataQualityFilters = {
    aiReviewed: 'all',
    itemType: '',
    libraryId: '',
    maxConfidence: null,
    minConfidence: null,
    provider: '',
    reason: '',
    search: '',
    sort: 'priority',
    startIndex: 0,
    status: 'review'
};

export type AdminMetadataQualitySettings = Readonly<{
    aiEnabled: boolean;
    aiMaxItemsPerRun: number;
    aiModel: string;
    aiThreshold: number;
    enabled: boolean;
    likelyWrongThreshold: number;
    aiMinimumConfidence: number;
    providerMaximumRequestsPerRun: number;
    providerVerificationEnabled: boolean;
    providerVerificationThreshold: number;
    reviewThreshold: number;
    revision: number;
    scheduledIncrementalScan: boolean;
    selectedLibraryIds: readonly string[];
}>;

export class AdminMetadataQualityServiceError extends Error {
    public readonly code:
        | 'action-unavailable'
        | 'conflict'
        | 'invalid-input'
        | 'load-unavailable'
        | 'not-found';

    public constructor(
        code: AdminMetadataQualityServiceError['code'],
        message: string
    ) {
        super(message);
        this.name = 'AdminMetadataQualityServiceError';
        this.code = code;
    }
}
