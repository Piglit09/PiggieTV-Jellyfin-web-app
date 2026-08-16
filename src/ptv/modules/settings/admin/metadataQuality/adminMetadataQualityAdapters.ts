import {
    ADMIN_METADATA_QUALITY_PAGE_SIZE,
    type AdminMetadataQualityAiCredentialSource,
    type AdminMetadataQualityAiModelSource,
    type AdminMetadataQualityAiStatus,
    type AdminMetadataQualityAiTestResult,
    type AdminMetadataQualityAiTestStatus,
    type AdminMetadataQualityCandidate,
    type AdminMetadataQualityCounts,
    type AdminMetadataQualityDetail,
    type AdminMetadataQualityLibrary,
    type AdminMetadataQualityMatch,
    type AdminMetadataQualityReason,
    type AdminMetadataQualityResult,
    type AdminMetadataQualityResultPage,
    type AdminMetadataQualityScanMode,
    type AdminMetadataQualityScanState,
    type AdminMetadataQualitySettings,
    type AdminMetadataQualityStatus,
    type AdminMetadataQualitySummary
} from './adminMetadataQualityModel';
import { decodeAdminRouteSegment } from '../adminRouteSegments';

type UnknownRecord = Record<string, unknown>;

/* eslint-disable @typescript-eslint/naming-convention */
const REASON_MESSAGES: Readonly<Record<string, string>> = {
    AI_AMBIGUOUS: 'AI analysis could not distinguish between the provider candidates.',
    BETTER_PROVIDER_CANDIDATE: 'A provider candidate matches the available evidence more closely.',
    DUPLICATE_PROVIDER_ID: 'The same provider identifier appears on another unrelated item.',
    EPISODE_NUMBER_CONFLICT: 'The episode number conflicts with the available file or provider evidence.',
    FILENAME_CONFLICT: 'The file name does not agree with the current metadata match.',
    FOLDER_CONFLICT: 'The folder name does not agree with the current metadata match.',
    ITEM_ANALYSIS_FAILED: 'This item could not be analyzed safely.',
    MEDIA_TYPE_CONFLICT: 'The current provider record uses a different media type.',
    MISSING_ARTWORK: 'Primary artwork is missing.',
    MISSING_OVERVIEW: 'The overview is missing.',
    PROVIDER_ID_MISSING: 'No supported metadata provider identifier is present.',
    MISSING_YEAR: 'The production year is missing.',
    PROVIDER_ID_CONFLICT: 'The provider identifier conflicts with the current title, year, or media type.',
    PROVIDER_LOOKUP_FAILED: 'The metadata provider could not verify this item.',
    RUNTIME_MISMATCH: 'The media runtime differs substantially from the current match.',
    SEASON_NUMBER_CONFLICT: 'The season number conflicts with the available file or provider evidence.',
    TITLE_MISMATCH: 'The current title conflicts with the available file or provider evidence.',
    YEAR_MISMATCH: 'The production year conflicts with the available file or provider evidence.'
};

const AI_TEST_MESSAGES: Readonly<Record<AdminMetadataQualityAiTestStatus, string>> = {
    'api-unavailable': 'The OpenAI API is currently unavailable.',
    'invalid-credential': 'OpenAI authentication failed. Check the configured API key.',
    'invalid-model': 'The configured OpenAI model ID is invalid.',
    'malformed-response': 'OpenAI returned an unexpected response.',
    'missing-credential': 'No OpenAI API credential is configured.',
    'model-unavailable': 'Configured OpenAI model is unavailable.',
    'permission-denied': 'The OpenAI API key does not have permission to use this request.',
    'quota-unavailable': 'OpenAI API quota is unavailable for this project.',
    'rate-limited': 'OpenAI rate limit reached.',
    refused: 'OpenAI declined the synthetic connection-test request.',
    'response-too-large': 'The OpenAI response exceeded the safe size limit.',
    success: 'OpenAI connection succeeded.',
    timeout: 'The OpenAI connection test timed out.',
    'test-in-progress': 'Another OpenAI connection test is already running.',
    'unknown-failure': 'The OpenAI connection test could not be completed.'
};
/* eslint-enable @typescript-eslint/naming-convention */

function asRecord(value: unknown): UnknownRecord | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function first(record: UnknownRecord | null, ...keys: string[]) {
    if (!record) return undefined;
    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(record, key)) return record[key];
    }
    return undefined;
}

function text(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function nullableText(value: unknown) {
    return text(value) || null;
}

function nullableScalarText(value: unknown) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return nullableText(value);
}

function finiteNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value: unknown) {
    const number = finiteNumber(value);
    return number !== null && number >= 0 ? Math.floor(number) : null;
}

function score(value: unknown) {
    const number = finiteNumber(value);
    return number === null ? null : Math.min(100, Math.max(0, number));
}

function candidateConfidence(value: unknown): AdminMetadataQualityCandidate['confidence'] {
    switch (text(value).toLowerCase().replace(/[_ ]+/g, '-')) {
        case 'excellent': return 'excellent';
        case 'strong': return 'strong';
        case 'possible': return 'possible';
        case 'weak': return 'weak';
        case 'rejected': return 'rejected';
        default: return null;
    }
}

function boolean(value: unknown) {
    return value === true;
}

function normalizeAiCredentialSource(value: unknown): AdminMetadataQualityAiCredentialSource {
    switch (text(value).toLowerCase().replace(/[_ ]+/g, '-')) {
        case 'environment': return 'environment';
        case 'managed':
        case 'server-managed': return 'managed';
        case 'missing':
        case 'none': return 'missing';
        default: return 'unknown';
    }
}

function normalizeAiModelSource(value: unknown): AdminMetadataQualityAiModelSource {
    switch (text(value).toLowerCase().replace(/[_ ]+/g, '-')) {
        case 'default': return 'default';
        case 'environment': return 'environment';
        case 'invalid': return 'invalid';
        case 'settings':
        case 'server-settings': return 'settings';
        default: return 'unknown';
    }
}

function normalizeAiTestStatus(value: unknown): AdminMetadataQualityAiTestStatus | null {
    switch (text(value).toLowerCase().replace(/[_ ]+/g, '-')) {
        case 'success': return 'success';
        case 'missing-credential': return 'missing-credential';
        case 'invalid-auth':
        case 'invalid-credential': return 'invalid-credential';
        case 'permission-denied': return 'permission-denied';
        case 'model-not-found':
        case 'model-unavailable': return 'model-unavailable';
        case 'invalid-model': return 'invalid-model';
        case 'billing-unavailable':
        case 'quota-unavailable': return 'quota-unavailable';
        case 'rate-limit':
        case 'rate-limited': return 'rate-limited';
        case 'timeout': return 'timeout';
        case 'api-unavailable':
        case 'network-api-unavailable':
        case 'network-unavailable': return 'api-unavailable';
        case 'malformed-api-response':
        case 'malformed-response': return 'malformed-response';
        case 'response-too-large': return 'response-too-large';
        case 'refused': return 'refused';
        case 'test-in-progress': return 'test-in-progress';
        case 'failure':
        case 'unknown':
        case 'unknown-failure': return 'unknown-failure';
        default: return null;
    }
}

export function adminMetadataQualityAiTestMessage(status: AdminMetadataQualityAiTestStatus) {
    return AI_TEST_MESSAGES[status];
}

function array(value: unknown) {
    return Array.isArray(value) ? value : [];
}

function normalizeStatus(value: unknown): AdminMetadataQualityStatus {
    switch (text(value).toLowerCase().replace(/[ -]+/g, '_')) {
        case 'healthy': return 'healthy';
        case 'review':
        case 'needs_review': return 'review';
        case 'likely_incorrect':
        case 'likely_wrong': return 'likely_wrong';
        case 'incomplete': return 'incomplete';
        case 'dismissed': return 'dismissed';
        case 'resolved': return 'resolved';
        default: return 'unavailable';
    }
}

function normalizeReadingMediaClass(value: unknown): AdminMetadataQualityMatch['mediaClass'] {
    switch (text(value).toLowerCase().replace(/[_ ]+/g, '-')) {
        case 'book': return 'book';
        case 'comic': return 'comic';
        case 'graphic-novel': return 'graphic-novel';
        case 'manga': return 'manga';
        case 'manhua': return 'manhua';
        case 'manhwa': return 'manhwa';
        case 'unknown': return 'unknown';
        default: return null;
    }
}

function normalizeScanState(value: unknown): AdminMetadataQualityScanState {
    switch (text(value).toLowerCase()) {
        case 'running':
        case 'scanning': return 'scanning';
        case 'completed': return 'completed';
        case 'failed': return 'failed';
        case 'cancelled':
        case 'canceled': return 'cancelled';
        case 'interrupted': return 'failed';
        default: return 'idle';
    }
}

function normalizeScanMode(value: unknown): AdminMetadataQualityScanMode | null {
    const normalized = text(value).toLowerCase();
    if (normalized === 'changed' || normalized === 'incremental') return 'changed';
    if (normalized === 'full') return 'full';
    return null;
}

function providerIds(value: unknown) {
    const record = asRecord(value);
    if (!record) return {};

    return Object.fromEntries(
        Object.entries(record)
            .map(([ key, entry ]) => [ text(key), text(entry) ] as const)
            .filter(([ key, entry ]) => Boolean(key && entry))
    );
}

function normalizeMatch(value: unknown): AdminMetadataQualityMatch | null {
    const record = asRecord(value);
    if (!record) return null;
    const title = text(first(record, 'title', 'Title', 'name', 'Name'));
    if (!title) return null;

    return {
        issueNumber: nullableScalarText(first(
            record,
            'issueNumber',
            'IssueNumber',
            'normalizedIssueNumber',
            'NormalizedIssueNumber'
        )),
        issuePublicationDate: nullableText(first(record, 'issuePublicationDate', 'IssuePublicationDate', 'publicationDate', 'PublicationDate')),
        issuePublicationYear: nonNegativeInteger(first(record, 'issuePublicationYear', 'IssuePublicationYear', 'publicationYear', 'PublicationYear')),
        mediaClass: normalizeReadingMediaClass(first(record, 'mediaClass', 'MediaClass')),
        provider: nullableText(first(record, 'provider', 'Provider', 'providerName', 'ProviderName', 'source', 'Source')),
        providerIds: providerIds(first(record, 'providerIds', 'ProviderIds')),
        publisher: nullableText(first(record, 'publisher', 'Publisher')),
        runtimeMinutes: finiteNumber(first(record, 'runtimeMinutes', 'RuntimeMinutes')),
        seriesStartYear: nonNegativeInteger(first(record, 'seriesStartYear', 'SeriesStartYear', 'startYear', 'StartYear')),
        seriesTitle: nullableText(first(record, 'seriesTitle', 'SeriesTitle', 'volumeName', 'VolumeName')),
        title,
        type: nullableText(first(record, 'type', 'Type', 'itemType', 'ItemType')),
        volumeId: nullableScalarText(first(record, 'volumeId', 'VolumeId')),
        year: nonNegativeInteger(first(record, 'year', 'Year', 'productionYear', 'ProductionYear'))
    };
}

function normalizeReason(value: unknown): AdminMetadataQualityReason | null {
    const record = asRecord(value);
    if (!record) return null;
    const code = text(first(record, 'code', 'Code', 'ruleId', 'RuleId')).toUpperCase() || 'UNKNOWN';
    const rawSeverity = text(first(record, 'severity', 'Severity')).toLowerCase();
    let severity: AdminMetadataQualityReason['severity'] = 'warning';
    if (rawSeverity === 'error') severity = 'error';
    else if (rawSeverity === 'info') severity = 'info';
    const message = text(first(record, 'message', 'Message', 'reason', 'Reason'))
        || REASON_MESSAGES[code]
        || 'Additional metadata evidence deserves review.';

    return {
        code,
        evidence: nullableText(first(record, 'evidence', 'Evidence')),
        message,
        severity
    };
}

function uniqueReasons(reasons: readonly AdminMetadataQualityReason[]) {
    const seen = new Set<string>();
    return reasons.filter(reason => {
        const identity = JSON.stringify([
            reason.code,
            reason.message,
            reason.evidence,
            reason.severity
        ]);
        if (seen.has(identity)) return false;
        seen.add(identity);
        return true;
    });
}

function normalizeResolution(value: unknown): AdminMetadataQualityResult['resolutionState'] {
    const resolution = asRecord(value);
    const state = text(resolution ? first(resolution, 'state', 'State') : value).toLowerCase();
    if (state === 'corrected' || state === 'dismissed' || state === 'kept_current') return state;
    return null;
}

export function normalizeAdminMetadataQualityResult(value: unknown): AdminMetadataQualityResult | null {
    const record = asRecord(value);
    if (!record) return null;
    const itemId = text(first(record, 'itemId', 'ItemId'));
    // Result identities become route segments and action targets. Reject values
    // that cannot round-trip through the shared administrator-route contract.
    if (!itemId || decodeAdminRouteSegment(encodeURIComponent(itemId)) !== itemId) return null;
    const currentMatch = normalizeMatch(first(record, 'currentMatch', 'CurrentMatch'));
    const reasons = uniqueReasons(array(first(record, 'reasons', 'Reasons'))
        .map(normalizeReason)
        .filter((reason): reason is AdminMetadataQualityReason => Boolean(reason)));
    const resolutionState = normalizeResolution(first(record, 'resolution', 'Resolution', 'resolutionState', 'ResolutionState'));
    const isDismissed = boolean(first(record, 'dismissed', 'Dismissed')) || resolutionState === 'dismissed';
    const normalizedStatus = normalizeStatus(first(record, 'status', 'Status'));
    let status: AdminMetadataQualityStatus = normalizedStatus;
    if (isDismissed) status = 'dismissed';
    else if (resolutionState) status = 'resolved';

    return {
        aiReviewed: boolean(first(record, 'aiReviewed', 'AiReviewed')),
        completenessScore: score(first(record, 'completenessScore', 'CompletenessScore')),
        currentMatch,
        fileName: nullableText(first(record, 'fileName', 'FileName')),
        folderName: nullableText(first(record, 'folderName', 'FolderName')),
        itemId,
        itemType: text(first(record, 'itemType', 'ItemType')) || currentMatch?.type || 'Unknown',
        libraryId: nullableText(first(record, 'libraryId', 'LibraryId')),
        libraryName: nullableText(first(record, 'libraryName', 'LibraryName')),
        matchConfidence: score(first(record, 'matchConfidence', 'MatchConfidence', 'confidence', 'Confidence')),
        providerVerified: boolean(first(record, 'providerVerified', 'ProviderVerified')),
        reasons,
        resolutionState,
        scannedAt: nullableText(first(record, 'scannedAt', 'ScannedAt')),
        status,
        suggestedMatch: normalizeMatch(first(record, 'suggestedMatch', 'SuggestedMatch')),
        title: text(first(record, 'title', 'Title', 'name', 'Name')) || currentMatch?.title || 'Untitled item'
    };
}

function normalizeCandidate(value: unknown): AdminMetadataQualityCandidate | null {
    const record = asRecord(value);
    const match = normalizeMatch(record);
    if (!record || !match) return null;
    return {
        ...match,
        confidence: candidateConfidence(first(record, 'confidence', 'Confidence', 'confidenceBand', 'ConfidenceBand', 'matchConfidence', 'MatchConfidence')),
        hasHardConflict: boolean(first(record, 'hasHardConflict', 'HasHardConflict')),
        score: score(first(record, 'score', 'Score', 'confidence', 'Confidence')),
        source: nullableText(first(record, 'source', 'Source', 'provider', 'Provider'))
    };
}

function normalizeSignals(value: unknown): AdminMetadataQualityDetail['signals'] {
    const record = asRecord(value);
    if (!record) return {};
    return Object.fromEntries(
        Object.entries(record).filter(([, entry ]) => (
            entry === null
            || typeof entry === 'boolean'
            || typeof entry === 'string'
            || (typeof entry === 'number' && Number.isFinite(entry))
        ))
    ) as AdminMetadataQualityDetail['signals'];
}

export function normalizeAdminMetadataQualityDetail(value: unknown): AdminMetadataQualityDetail | null {
    const record = asRecord(value);
    const result = normalizeAdminMetadataQualityResult(record);
    if (!record || !result) return null;

    return {
        ...result,
        candidates: array(first(record, 'candidates', 'Candidates'))
            .map(normalizeCandidate)
            .filter((candidate): candidate is AdminMetadataQualityCandidate => Boolean(candidate)),
        signals: normalizeSignals(first(record, 'signals', 'Signals'))
    };
}

function normalizeCounts(value: unknown): AdminMetadataQualityCounts {
    const record = asRecord(value);
    return {
        dismissed: nonNegativeInteger(first(record, 'dismissed', 'Dismissed')),
        healthy: nonNegativeInteger(first(record, 'healthy', 'Healthy')),
        incomplete: nonNegativeInteger(first(record, 'incomplete', 'Incomplete')),
        likelyIncorrect: nonNegativeInteger(first(record, 'likelyIncorrect', 'LikelyIncorrect', 'likelyWrong', 'LikelyWrong')),
        needsReview: nonNegativeInteger(first(record, 'needsReview', 'NeedsReview', 'review', 'Review')),
        resolved: nonNegativeInteger(first(record, 'resolved', 'Resolved')),
        totalScanned: nonNegativeInteger(first(record, 'totalScanned', 'TotalScanned', 'scanned', 'Scanned')),
        unavailable: nonNegativeInteger(first(record, 'unavailable', 'Unavailable'))
    };
}

function normalizeLibrary(value: unknown): AdminMetadataQualityLibrary | null {
    const record = asRecord(value);
    if (!record) return null;
    const id = text(first(record, 'id', 'Id', 'libraryId', 'LibraryId'));
    if (!id) return null;
    return { id, name: text(first(record, 'name', 'Name')) || 'Unnamed library' };
}

export function normalizeAdminMetadataQualitySummary(value: unknown): AdminMetadataQualitySummary {
    const record = asRecord(value);
    const scanRecord = asRecord(first(record, 'scan', 'Scan', 'currentRun', 'CurrentRun'));

    return {
        counts: normalizeCounts(first(record, 'counts', 'Counts', 'summary', 'Summary')),
        lastScanAt: nullableText(first(record, 'lastScanAt', 'LastScanAt', 'lastFullScan', 'LastFullScan', 'lastIncrementalScan', 'LastIncrementalScan')),
        libraries: array(first(record, 'libraries', 'Libraries'))
            .map(normalizeLibrary)
            .filter((library): library is AdminMetadataQualityLibrary => Boolean(library)),
        ruleVersion: nullableText(first(record, 'ruleVersion', 'RuleVersion')),
        scan: {
            completedAt: nullableText(first(scanRecord, 'completedAt', 'CompletedAt')),
            errorMessage: nullableText(first(scanRecord, 'errorMessage', 'ErrorMessage', 'message', 'Message')),
            itemCount: nonNegativeInteger(first(scanRecord, 'itemCount', 'ItemCount', 'totalItems', 'TotalItems')),
            mode: normalizeScanMode(first(scanRecord, 'mode', 'Mode')),
            processedCount: nonNegativeInteger(first(scanRecord, 'processedCount', 'ProcessedCount', 'itemsProcessed', 'ItemsProcessed')),
            runId: nullableText(first(scanRecord, 'runId', 'RunId')),
            startedAt: nullableText(first(scanRecord, 'startedAt', 'StartedAt')),
            state: normalizeScanState(first(scanRecord, 'state', 'State'))
        },
        scannerVersion: nullableText(first(record, 'scannerVersion', 'ScannerVersion'))
    };
}

function aiProjectionValue(
    record: UnknownRecord | null,
    aiRecord: UnknownRecord | null,
    nestedKeys: readonly string[],
    flatKeys: readonly string[]
) {
    const nested = first(aiRecord, ...nestedKeys);
    return nested === undefined ? first(record, ...flatKeys) : nested;
}

export function normalizeAdminMetadataQualityAiStatus(value: unknown): AdminMetadataQualityAiStatus {
    const record = asRecord(value);
    const aiRecord = asRecord(first(record, 'ai', 'Ai'));
    const credentialConfigured = boolean(aiProjectionValue(
        record,
        aiRecord,
        [ 'credentialConfigured', 'CredentialConfigured', 'configured', 'Configured' ],
        [ 'aiCredentialConfigured', 'AiCredentialConfigured', 'aiConfigured', 'AiConfigured' ]
    ));
    const rawCredentialSource = normalizeAiCredentialSource(aiProjectionValue(
        record,
        aiRecord,
        [ 'credentialSource', 'CredentialSource' ],
        [ 'aiCredentialSource', 'AiCredentialSource' ]
    ));
    let credentialSource = rawCredentialSource;
    if (!credentialConfigured) credentialSource = 'missing';
    else if (rawCredentialSource === 'missing') credentialSource = 'unknown';
    const lastTestStatus = normalizeAiTestStatus(aiProjectionValue(
        record,
        aiRecord,
        [ 'lastTestStatus', 'LastTestStatus' ],
        [ 'aiLastTestStatus', 'AiLastTestStatus' ]
    ));
    const lastTestErrorCode = normalizeAiTestStatus(aiProjectionValue(
        record,
        aiRecord,
        [ 'lastTestErrorCode', 'LastTestErrorCode' ],
        [ 'aiLastTestErrorCode', 'AiLastTestErrorCode' ]
    ));

    return {
        configuredModel: text(aiProjectionValue(
            record,
            aiRecord,
            [ 'configuredModel', 'ConfiguredModel' ],
            [ 'aiConfiguredModel', 'AiConfiguredModel' ]
        )),
        credentialConfigured,
        credentialSource,
        effectiveModel: text(aiProjectionValue(
            record,
            aiRecord,
            [ 'effectiveModel', 'EffectiveModel', 'model', 'Model' ],
            [ 'aiEffectiveModel', 'AiEffectiveModel', 'aiModel', 'AiModel' ]
        )),
        enabled: boolean(aiProjectionValue(
            record,
            aiRecord,
            [ 'enabled', 'Enabled' ],
            [ 'aiEnabled', 'AiEnabled' ]
        )),
        lastTestAt: nullableText(aiProjectionValue(
            record,
            aiRecord,
            [ 'lastTestAt', 'LastTestAt' ],
            [ 'aiLastTestAt', 'AiLastTestAt' ]
        )),
        lastTestErrorCode,
        lastTestModel: nullableText(aiProjectionValue(
            record,
            aiRecord,
            [ 'lastTestModel', 'LastTestModel' ],
            [ 'aiLastTestModel', 'AiLastTestModel' ]
        )),
        lastTestStatus: lastTestStatus === 'success' ? 'success' : lastTestErrorCode || lastTestStatus,
        modelSource: normalizeAiModelSource(aiProjectionValue(
            record,
            aiRecord,
            [ 'modelSource', 'ModelSource' ],
            [ 'aiModelSource', 'AiModelSource' ]
        ))
    };
}

export function normalizeAdminMetadataQualityAiTestResult(value: unknown): AdminMetadataQualityAiTestResult {
    const record = asRecord(value);
    const declaredSuccess = boolean(first(record, 'success', 'Success'));
    const normalizedStatus = normalizeAiTestStatus(first(record, 'errorCode', 'ErrorCode', 'status', 'Status'));
    let status: AdminMetadataQualityAiTestStatus = normalizedStatus || 'unknown-failure';
    if (declaredSuccess && (!normalizedStatus || normalizedStatus === 'success')) status = 'success';
    else if (!declaredSuccess && status === 'success') status = 'unknown-failure';

    return {
        message: adminMetadataQualityAiTestMessage(status),
        model: text(first(record, 'model', 'Model')),
        status,
        success: status === 'success',
        testedAt: nullableText(first(record, 'testedAt', 'TestedAt'))
    };
}

export function normalizeAdminMetadataQualityResultPage(value: unknown): AdminMetadataQualityResultPage {
    const record = asRecord(value);
    const items = array(first(record, 'items', 'Items', 'results', 'Results'))
        .map(normalizeAdminMetadataQualityResult)
        .filter((item): item is AdminMetadataQualityResult => Boolean(item));
    const startIndex = nonNegativeInteger(first(record, 'startIndex', 'StartIndex')) || 0;
    const rawLimit = nonNegativeInteger(first(record, 'limit', 'Limit'));

    return {
        items,
        limit: rawLimit && rawLimit <= ADMIN_METADATA_QUALITY_PAGE_SIZE ? rawLimit : ADMIN_METADATA_QUALITY_PAGE_SIZE,
        startIndex,
        totalRecordCount: nonNegativeInteger(first(record, 'totalRecordCount', 'TotalRecordCount', 'total', 'Total'))
    };
}

function integerSetting(record: UnknownRecord | null, fallback: number, ...keys: string[]) {
    return nonNegativeInteger(first(record, ...keys)) ?? fallback;
}

export function normalizeAdminMetadataQualitySettings(value: unknown): AdminMetadataQualitySettings {
    const record = asRecord(value);
    return {
        aiEnabled: boolean(first(record, 'aiEnabled', 'AiEnabled')),
        aiMaxItemsPerRun: integerSetting(record, 100, 'aiMaxItemsPerRun', 'AiMaxItemsPerRun'),
        aiMinimumConfidence: integerSetting(record, 35, 'aiMinimumConfidence', 'AiMinimumConfidence'),
        aiModel: text(first(record, 'aiModel', 'AiModel')),
        aiThreshold: integerSetting(record, 70, 'aiThreshold', 'AiThreshold'),
        enabled: first(record, 'enabled', 'Enabled') !== false,
        likelyWrongThreshold: integerSetting(record, 50, 'likelyWrongThreshold', 'LikelyWrongThreshold'),
        providerMaximumRequestsPerRun: integerSetting(record, 250, 'providerMaximumRequestsPerRun', 'ProviderMaximumRequestsPerRun'),
        providerVerificationEnabled: first(record, 'providerVerificationEnabled', 'ProviderVerificationEnabled') !== false,
        providerVerificationThreshold: integerSetting(record, 85, 'providerVerificationThreshold', 'ProviderVerificationThreshold'),
        reviewThreshold: integerSetting(record, 70, 'reviewThreshold', 'ReviewThreshold'),
        revision: integerSetting(record, 0, 'revision', 'Revision'),
        scheduledIncrementalScan: first(record, 'scheduledIncrementalScan', 'ScheduledIncrementalScan') !== false,
        selectedLibraryIds: array(first(record, 'selectedLibraryIds', 'SelectedLibraryIds'))
            .map(text)
            .filter(Boolean)
    };
}
