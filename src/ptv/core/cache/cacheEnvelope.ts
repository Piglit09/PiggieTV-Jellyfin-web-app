import {
    PTV_CORE_CONTRACT_VERSION,
    type PtvCoreContractVersion,
    type PtvCoreScope
} from '../contracts/version';
import { createPtvCoreError, type PtvCoreError } from '../errors/coreError';

export type PtvCacheEnvelope<T> = Readonly<{
    contractVersion: PtvCoreContractVersion;
    createdAt: string;
    expiresAt: string;
    key: string;
    payload: T;
    payloadBytes?: number;
    schemaVersion: number;
    scope: PtvCoreScope;
    staleWhileRevalidateUntil?: string;
}>;

export type PtvCacheReadOutcome =
    | 'corrupt'
    | 'error'
    | 'expired'
    | 'hit'
    | 'miss'
    | 'stale'
    | 'version-mismatch';

export type PtvCacheInspection<T> = Readonly<{
    envelope?: PtvCacheEnvelope<T>;
    error?: PtvCoreError;
    outcome: PtvCacheReadOutcome;
}>;

export type PtvCacheExpectations<T> = Readonly<{
    allowStale?: boolean;
    key: string;
    legacyReader?: (value: unknown) => PtvCacheEnvelope<T> | null;
    maxPayloadBytes?: number;
    now?: number;
    schemaVersion: number;
    scope: PtvCoreScope;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isScope(value: unknown): value is PtvCoreScope {
    return isRecord(value)
        && typeof value.kind === 'string'
        && ['device', 'global', 'server', 'user'].includes(value.kind);
}

function hasExpectedScope(actual: PtvCoreScope, expected: PtvCoreScope) {
    return actual.kind === expected.kind
        && actual.serverId === expected.serverId
        && actual.userId === expected.userId
        && actual.deviceId === expected.deviceId;
}

function parseTimestamp(value: unknown): number | null {
    if (typeof value !== 'string') return null;
    const timestamp = Date.parse(value);

    return Number.isFinite(timestamp) ? timestamp : null;
}

export function createPtvCacheEnvelope<T>(options: Readonly<{
    createdAt?: string;
    expiresAt: string;
    key: string;
    payload: T;
    payloadBytes?: number;
    schemaVersion: number;
    scope: PtvCoreScope;
    staleWhileRevalidateUntil?: string;
}>): PtvCacheEnvelope<T> {
    return {
        contractVersion: PTV_CORE_CONTRACT_VERSION,
        createdAt: options.createdAt || new Date().toISOString(),
        expiresAt: options.expiresAt,
        key: options.key,
        payload: options.payload,
        payloadBytes: options.payloadBytes,
        schemaVersion: options.schemaVersion,
        scope: { ...options.scope },
        staleWhileRevalidateUntil: options.staleWhileRevalidateUntil
    };
}

function parsePtvCacheEnvelope<T>(value: unknown): PtvCacheEnvelope<T> | null {
    if (!isRecord(value)
        || value.contractVersion !== PTV_CORE_CONTRACT_VERSION
        || typeof value.schemaVersion !== 'number'
        || typeof value.key !== 'string'
        || !isScope(value.scope)
        || parseTimestamp(value.createdAt) === null
        || parseTimestamp(value.expiresAt) === null
        || !Object.prototype.hasOwnProperty.call(value, 'payload')) {
        return null;
    }

    return value as PtvCacheEnvelope<T>;
}

function cacheError(
    code: string,
    message: string,
    operation: string,
    developerDetail?: string
): PtvCoreError {
    return createPtvCoreError({
        code,
        developerDetail,
        kind: 'cache',
        message,
        operation,
        retryable: false
    });
}

export function inspectPtvCacheEnvelope<T>(
    value: unknown,
    expectations: PtvCacheExpectations<T>
): PtvCacheInspection<T> {
    if (value === undefined || value === null) return { outcome: 'miss' };

    let envelope = parsePtvCacheEnvelope<T>(value);
    if (!envelope && expectations.legacyReader) {
        try {
            envelope = expectations.legacyReader(value);
        } catch (error) {
            return {
                error: createPtvCoreError({
                    cause: error,
                    code: 'CACHE_MIGRATION_FAILED',
                    kind: 'cache',
                    message: 'Saved data could not be migrated.',
                    operation: expectations.key
                }),
                outcome: 'error'
            };
        }
    }
    if (!envelope) {
        return {
            error: cacheError(
                'CACHE_CORRUPT',
                'Saved data could not be read.',
                expectations.key
            ),
            outcome: 'corrupt'
        };
    }
    if (envelope.schemaVersion !== expectations.schemaVersion) {
        return {
            envelope,
            error: cacheError(
                'CACHE_VERSION_MISMATCH',
                'Saved data uses an incompatible version.',
                expectations.key,
                `Expected ${expectations.schemaVersion}; received ${envelope.schemaVersion}.`
            ),
            outcome: 'version-mismatch'
        };
    }
    if (envelope.key !== expectations.key || !hasExpectedScope(envelope.scope, expectations.scope)) {
        return { outcome: 'miss' };
    }
    if (expectations.maxPayloadBytes !== undefined
        && envelope.payloadBytes !== undefined
        && envelope.payloadBytes > expectations.maxPayloadBytes) {
        return {
            envelope,
            error: cacheError(
                'CACHE_PAYLOAD_TOO_LARGE',
                'Saved data exceeds the safe size limit.',
                expectations.key
            ),
            outcome: 'error'
        };
    }

    const now = expectations.now ?? Date.now();
    const expiresAt = parseTimestamp(envelope.expiresAt) || 0;
    if (expiresAt > now) return { envelope, outcome: 'hit' };

    const staleUntil = parseTimestamp(envelope.staleWhileRevalidateUntil);
    if (expectations.allowStale && staleUntil !== null && staleUntil > now) {
        return { envelope, outcome: 'stale' };
    }

    return { envelope, outcome: 'expired' };
}
