import { getPtvCoreAliasedField } from '../api/apiContracts';
import { PTV_CORE_CONTRACT_VERSION, type PtvCoreContractVersion } from '../contracts/version';
import { sanitizePtvCoreMetadata, type PtvCoreDiagnosticValue } from '../diagnostics/redaction';
import {
    createPtvCoreError,
    ptvCoreFailure,
    ptvCoreSuccess,
    type PtvCoreResult
} from '../errors/coreError';
import { normalizePtvCoreMediaType, type PtvCoreMediaType } from '../media/mediaContracts';

export type PtvRecommendationClassification = 'affinity' | 'discovery' | 'mixed';

export type PtvCoreRecommendationReason = Readonly<{
    code?: string;
    score?: number;
    text: string;
}>;

export type PtvCoreRecommendationItem = Readonly<{
    classification: PtvRecommendationClassification;
    debug?: Record<string, PtvCoreDiagnosticValue>;
    id: string;
    mediaType: PtvCoreMediaType;
    reasons: readonly PtvCoreRecommendationReason[];
    score: number;
    source: string;
    title: string;
}>;

export type PtvCoreRecommendationRow = Readonly<{
    debug?: Record<string, PtvCoreDiagnosticValue>;
    explanation?: string;
    id: string;
    items: readonly PtvCoreRecommendationItem[];
    mediaType?: PtvCoreMediaType | 'mixed';
    source?: string;
    title: string;
}>;

export type PtvCoreRecommendationResponse = Readonly<{
    cacheVersion: number;
    contractVersion: PtvCoreContractVersion;
    debug?: Record<string, PtvCoreDiagnosticValue>;
    generatedAt: string;
    rows: readonly PtvCoreRecommendationRow[];
    serverId: string;
    userId: string;
}>;

export type PtvRecommendationNormalizationDefaults = Readonly<{
    cacheVersion?: number;
    generatedAt?: string | number;
    serverId?: string;
    userId?: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getField(value: unknown, key: string) {
    return getPtvCoreAliasedField(value, key);
}

function getString(value: unknown, ...keys: string[]) {
    for (const key of keys) {
        const candidate = getField(value, key);
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }

    return '';
}

function getNumber(value: unknown, ...keys: string[]) {
    for (const key of keys) {
        const candidate = getField(value, key);
        if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
    }

    return undefined;
}

function toIsoTimestamp(value: unknown, fallback = new Date().toISOString()) {
    if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
    if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();

    return fallback;
}

function stableHash(value: string) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(36);
}

function stableLegacyRowId(title: string, source: string, mediaType: string) {
    const identity = [title.toLowerCase(), source.toLowerCase(), mediaType].join('|');

    return `legacy-${stableHash(identity)}`;
}

function normalizeClassification(value: unknown, scoreValue: unknown): PtvRecommendationClassification {
    const explicit = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (explicit === 'affinity' || explicit === 'discovery' || explicit === 'mixed') return explicit;

    const affinityScore = getNumber(scoreValue, 'affinityScore') || 0;
    const discoveryWeight = getNumber(scoreValue, 'discoveryWeight') || 0;
    if (affinityScore > 0 && discoveryWeight > 0) return 'mixed';
    if (discoveryWeight > affinityScore) return 'discovery';

    return 'affinity';
}

function normalizeReason(value: unknown): PtvCoreRecommendationReason | null {
    if (typeof value === 'string' && value.trim()) return { text: value.trim() };
    if (!isRecord(value)) return null;
    const text = getString(value, 'text', 'label', 'reason', 'explanation');
    if (!text) return null;

    return {
        code: getString(value, 'code') || undefined,
        score: getNumber(value, 'score'),
        text
    };
}

function normalizeReasons(scoreValue: unknown, itemValue: unknown) {
    const rawReasons = getField(scoreValue, 'reasons')
        ?? getField(itemValue, 'recommendationReasons')
        ?? getField(itemValue, 'ptvRecommendationReasons');
    const reasons = Array.isArray(rawReasons) ?
        rawReasons.map(normalizeReason).filter((reason): reason is PtvCoreRecommendationReason => Boolean(reason)) :
        [];
    const reasonText = getString(
        itemValue,
        'recommendationReasonText',
        'ptvRecommendationReasonText'
    );
    if (!reasons.length && reasonText) reasons.push({ text: reasonText });

    return reasons;
}

function normalizeItem(value: unknown, row: {
    mediaType?: PtvCoreMediaType | 'mixed';
    source?: string;
}): PtvCoreRecommendationItem | null {
    if (!isRecord(value)) return null;
    const nestedItem = getField(value, 'item');
    const item = isRecord(nestedItem) ? nestedItem : value;
    const id = getString(item, 'id');
    if (!id) return null;

    const title = getString(item, 'title', 'name', 'seriesName', 'album') || id;
    const rawMediaType = getString(item, 'mediaType', 'type')
        || (row.mediaType === 'mixed' ? '' : row.mediaType)
        || 'unknown';
    const score = getNumber(value, 'score') ?? getNumber(item, 'score') ?? 0;
    const source = getString(value, 'source')
        || getString(item, 'source')
        || row.source
        || 'jellyfin';
    const debugValue = getField(value, 'debug');

    return {
        classification: normalizeClassification(
            getField(value, 'classification') ?? getField(item, 'classification'),
            value
        ),
        debug: isRecord(debugValue) ? sanitizePtvCoreMetadata(debugValue) : undefined,
        id,
        mediaType: normalizePtvCoreMediaType(rawMediaType),
        reasons: normalizeReasons(value, item),
        score,
        source,
        title
    };
}

function normalizeRow(value: unknown): PtvCoreRecommendationRow | null {
    if (!isRecord(value)) return null;
    const title = getString(value, 'title', 'name', 'rowTitle');
    if (!title) return null;
    const source = getString(value, 'source', 'sourceType') || undefined;
    const rawMediaType = getString(value, 'mediaType');
    const normalizedMediaType = rawMediaType.toLowerCase() === 'mixed' ?
        'mixed' :
        normalizePtvCoreMediaType(rawMediaType);
    const rawItems = getField(value, 'items');
    const items = Array.isArray(rawItems) ?
        rawItems
            .map(item => normalizeItem(item, { mediaType: normalizedMediaType, source }))
            .filter((item): item is PtvCoreRecommendationItem => Boolean(item)) :
        [];
    const debugValue = getField(value, 'debug') ?? getField(value, 'diagnostics');
    const id = getString(value, 'id', 'rowId')
        || stableLegacyRowId(title, source || '', normalizedMediaType);

    return {
        debug: isRecord(debugValue) ? sanitizePtvCoreMetadata(debugValue) : undefined,
        explanation: getString(value, 'explanation', 'description') || undefined,
        id,
        items,
        mediaType: rawMediaType ? normalizedMediaType : undefined,
        source,
        title
    };
}

function parsingFailure(code: string, detail: string) {
    return ptvCoreFailure<PtvCoreRecommendationResponse>(createPtvCoreError({
        code,
        developerDetail: detail,
        kind: 'parsing',
        message: 'Recommendations could not be read.',
        operation: 'recommendation-response'
    }));
}

export function normalizePtvRecommendationResponse(
    value: unknown,
    defaults: PtvRecommendationNormalizationDefaults = {}
): PtvCoreResult<PtvCoreRecommendationResponse> {
    if (!isRecord(value)) return parsingFailure('RECOMMENDATION_RESPONSE_INVALID', 'Expected an object.');

    const contractVersion = getString(value, 'contractVersion');
    if (contractVersion && contractVersion !== PTV_CORE_CONTRACT_VERSION) {
        return parsingFailure(
            'RECOMMENDATION_CONTRACT_VERSION_MISMATCH',
            `Expected ${PTV_CORE_CONTRACT_VERSION}; received ${contractVersion}.`
        );
    }

    const serverId = getString(value, 'serverId') || defaults.serverId || '';
    const userId = getString(value, 'userId') || defaults.userId || '';
    if (!serverId || !userId) {
        return parsingFailure('RECOMMENDATION_SCOPE_REQUIRED', 'Server and user scope are required.');
    }

    const cacheVersion = getNumber(value, 'cacheVersion', 'schemaVersion')
        ?? defaults.cacheVersion
        ?? 1;
    if (!Number.isInteger(cacheVersion) || cacheVersion < 1) {
        return parsingFailure('RECOMMENDATION_CACHE_VERSION_INVALID', String(cacheVersion));
    }

    const rawRows = getField(value, 'rows');
    if (!Array.isArray(rawRows)) return parsingFailure('RECOMMENDATION_ROWS_REQUIRED', 'Rows must be an array.');
    const rows = rawRows
        .map(normalizeRow)
        .filter((row): row is PtvCoreRecommendationRow => Boolean(row));
    const debugValue = getField(value, 'debug');
    const defaultGeneratedAt = toIsoTimestamp(defaults.generatedAt);

    return ptvCoreSuccess({
        cacheVersion,
        contractVersion: PTV_CORE_CONTRACT_VERSION,
        debug: isRecord(debugValue) ? sanitizePtvCoreMetadata(debugValue) : undefined,
        generatedAt: toIsoTimestamp(getField(value, 'generatedAt'), defaultGeneratedAt),
        rows,
        serverId,
        userId
    });
}
