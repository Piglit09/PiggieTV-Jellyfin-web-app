import { recordPtvEvent } from '../core/observability';
import {
    createPtvCacheEnvelope,
    inspectPtvCacheEnvelope,
    type PtvCacheEnvelope,
    type PtvCacheInspection
} from '../core/cache/cacheEnvelope';
import type { PtvCoreScope } from '../core/contracts/version';

const DB_NAME = 'ptv-library-index-cache';
const DB_VERSION = 1;
const STORE_NAME = 'libraryIndexes';

export const PTV_LIBRARY_INDEX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const PTV_LIBRARY_INDEX_CACHE_STALE_MS = 6 * 60 * 60 * 1000;

export type PtvLegacyLibraryIndexCacheEntry<TData> = {
    createdAt: number;
    data: TData;
    expiresAt: number;
    key: string;
    schemaVersion: number;
};

let databasePromise: Promise<IDBDatabase | null> | null = null;

export type PtvLibraryIndexCacheReadOptions = {
    allowStale?: boolean;
    now?: number;
    scope?: PtvCoreScope;
};

export type PtvLibraryIndexCacheWriteOptions = {
    shouldWrite?: () => boolean;
    scope?: PtvCoreScope;
    staleWhileRevalidateMs?: number;
};

export type PtvLibraryIndexCacheUpdateResult =
    | 'deleted-invalid'
    | 'failed'
    | 'missing'
    | 'retired'
    | 'unchanged'
    | 'updated';

export type PtvLibraryIndexCacheUpdateOptions = PtvLibraryIndexCacheReadOptions & {
    shouldWrite?: () => boolean;
};

function getIndexedDb(): IDBFactory | null {
    if (typeof window === 'undefined') return null;

    return window.indexedDB || null;
}

function openLibraryIndexDatabase(): Promise<IDBDatabase | null> {
    if (databasePromise) return databasePromise;

    const indexedDb = getIndexedDb();

    if (!indexedDb) {
        databasePromise = Promise.resolve(null);
        return databasePromise;
    }

    databasePromise = new Promise(resolve => {
        const request = indexedDb.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const database = request.result;

            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, { keyPath: 'key' });
            }
        };

        request.onerror = () => {
            recordPtvEvent('cache', 'library-index-db-open-failed', {
                error: request.error?.message || 'IndexedDB open failed'
            });
            resolve(null);
        };

        request.onsuccess = () => {
            const database = request.result;

            database.onversionchange = () => {
                database.close();
                databasePromise = null;
            };
            resolve(database);
        };
    });

    return databasePromise;
}

export async function initializePtvLibraryIndexCache() {
    return Boolean(await openLibraryIndexDatabase());
}

function requestResult<TResult>(request: IDBRequest<TResult>): Promise<TResult> {
    return new Promise((resolve, reject) => {
        request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
        request.onsuccess = () => resolve(request.result);
    });
}

async function getStore(mode: IDBTransactionMode): Promise<IDBObjectStore | null> {
    const database = await openLibraryIndexDatabase();

    if (!database) return null;

    return database.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

function inferScopeFromKey(key: string): PtvCoreScope {
    const parts = key.split(':');
    const offset = parts[0] === 'reading' || parts[0] === 'music' ? 1 : 0;
    const serverId = parts[offset];
    const userId = parts[offset + 1];

    if (serverId && userId) return { kind: 'user', serverId, userId };

    return { kind: 'global' };
}

function getSerializedPayloadBytes(value: unknown) {
    try {
        return new Blob([JSON.stringify(value)]).size;
    } catch {
        return undefined;
    }
}

function isLegacyEntry<TData>(value: unknown): value is PtvLegacyLibraryIndexCacheEntry<TData> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const candidate = value as Partial<PtvLegacyLibraryIndexCacheEntry<TData>>;

    return typeof candidate.createdAt === 'number'
        && typeof candidate.expiresAt === 'number'
        && typeof candidate.key === 'string'
        && typeof candidate.schemaVersion === 'number'
        && Object.prototype.hasOwnProperty.call(candidate, 'data');
}

function readLegacyEnvelope<TData>(
    value: unknown,
    scope: PtvCoreScope
): PtvCacheEnvelope<TData> | null {
    if (!isLegacyEntry<TData>(value)) return null;

    return createPtvCacheEnvelope({
        createdAt: new Date(value.createdAt).toISOString(),
        expiresAt: new Date(value.expiresAt).toISOString(),
        key: value.key,
        payload: value.data,
        payloadBytes: getSerializedPayloadBytes(value.data),
        schemaVersion: value.schemaVersion,
        scope,
        staleWhileRevalidateUntil: new Date(
            value.expiresAt + PTV_LIBRARY_INDEX_CACHE_STALE_MS
        ).toISOString()
    });
}

export function inspectPtvLibraryIndexCacheRecord<TData>(
    value: unknown,
    key: string,
    schemaVersion: number,
    options: PtvLibraryIndexCacheReadOptions = {}
): PtvCacheInspection<TData> {
    const scope = options.scope || inferScopeFromKey(key);

    return inspectPtvCacheEnvelope(value, {
        allowStale: options.allowStale,
        key,
        legacyReader: legacyValue => readLegacyEnvelope<TData>(legacyValue, scope),
        now: options.now,
        schemaVersion,
        scope
    });
}

// The branches deliberately mirror each cache outcome for distinct migration diagnostics.
// eslint-disable-next-line sonarjs/cognitive-complexity
export async function readPtvLibraryIndexCache<TData>(
    key: string,
    schemaVersion: number,
    options: PtvLibraryIndexCacheReadOptions = {}
): Promise<TData | null> {
    try {
        const store = await getStore('readonly');

        if (!store) return null;

        const entry = await requestResult(store.get(key)) as unknown;

        if (!entry) {
            recordPtvEvent('cache', 'library-index-cache-miss', { key });
            return null;
        }

        const inspection = inspectPtvLibraryIndexCacheRecord<TData>(entry, key, schemaVersion, options);
        const migratedLegacyEntry = isLegacyEntry<TData>(entry)
            && (inspection.outcome === 'hit' || inspection.outcome === 'stale');

        if (inspection.outcome === 'hit' || inspection.outcome === 'stale') {
            if (migratedLegacyEntry && inspection.envelope) {
                const writeStore = await getStore('readwrite');
                if (writeStore) await requestResult(writeStore.put(inspection.envelope));
                recordPtvEvent('cache', 'library-index-cache-migrated', {
                    from: 'legacy',
                    key,
                    to: 'cache-envelope-v1'
                });
            }
            const eventName = inspection.outcome === 'stale' ?
                'library-index-cache-stale-hit' :
                'library-index-cache-hit';
            const ageMs = inspection.envelope ?
                (options.now ?? Date.now()) - Date.parse(inspection.envelope.createdAt) :
                undefined;
            recordPtvEvent('cache', eventName, {
                ageMs,
                key,
                migratedLegacyEntry
            });

            return inspection.envelope?.payload ?? null;
        }

        if (inspection.outcome === 'miss') {
            recordPtvEvent('cache', 'library-index-cache-scope-miss', { key });
            return null;
        }

        if (inspection.outcome === 'expired'
            || inspection.outcome === 'version-mismatch'
            || inspection.outcome === 'corrupt') {
            await deletePtvLibraryIndexCache(key);
            recordPtvEvent('cache', `library-index-cache-${inspection.outcome}`, {
                errorCode: inspection.error?.code,
                key,
                schemaVersion
            });
            return null;
        }

        recordPtvEvent('cache', 'library-index-cache-read-rejected', {
            errorCode: inspection.error?.code,
            key,
            outcome: inspection.outcome
        });
        return null;
    } catch (error) {
        recordPtvEvent('cache', 'library-index-cache-read-failed', {
            error: error instanceof Error ? error.message : String(error),
            key
        });

        return null;
    }
}

export async function writePtvLibraryIndexCache<TData>(
    key: string,
    schemaVersion: number,
    data: TData,
    ttlMs = PTV_LIBRARY_INDEX_CACHE_TTL_MS,
    options: PtvLibraryIndexCacheWriteOptions = {}
): Promise<void> {
    try {
        const store = await getStore('readwrite');

        if (!store || options.shouldWrite?.() === false) return;

        const createdAtMs = Date.now();
        const expiresAtMs = createdAtMs + ttlMs;
        const envelope = createPtvCacheEnvelope({
            createdAt: new Date(createdAtMs).toISOString(),
            expiresAt: new Date(expiresAtMs).toISOString(),
            key,
            payload: data,
            payloadBytes: getSerializedPayloadBytes(data),
            schemaVersion,
            scope: options.scope || inferScopeFromKey(key),
            staleWhileRevalidateUntil: new Date(
                expiresAtMs + (options.staleWhileRevalidateMs ?? PTV_LIBRARY_INDEX_CACHE_STALE_MS)
            ).toISOString()
        });

        await requestResult(store.put(envelope));
        recordPtvEvent('cache', 'library-index-cache-written', {
            contractVersion: envelope.contractVersion,
            key,
            ttlMs
        });
    } catch (error) {
        recordPtvEvent('cache', 'library-index-cache-write-failed', {
            error: error instanceof Error ? error.message : String(error),
            key
        });
    }
}

export async function updatePtvLibraryIndexCache<TData>(
    key: string,
    schemaVersion: number,
    update: (current: TData) => TData,
    options: PtvLibraryIndexCacheUpdateOptions = {}
): Promise<PtvLibraryIndexCacheUpdateResult> {
    try {
        if (options.shouldWrite?.() === false) return 'retired';

        const store = await getStore('readwrite');

        if (!store) return 'missing';

        const value = await requestResult(store.get(key)) as unknown;

        if (!value) return 'missing';
        if (options.shouldWrite?.() === false) return 'retired';

        const inspection = inspectPtvLibraryIndexCacheRecord<TData>(
            value,
            key,
            schemaVersion,
            { ...options, allowStale: true }
        );

        if (
            (inspection.outcome !== 'hit' && inspection.outcome !== 'stale')
            || !inspection.envelope
        ) {
            if (options.shouldWrite?.() === false) return 'retired';
            await requestResult(store.delete(key));
            recordPtvEvent('cache', 'library-index-cache-update-invalid-deleted', {
                outcome: inspection.outcome
            });
            return 'deleted-invalid';
        }

        const nextPayload = update(inspection.envelope.payload);

        if (nextPayload === inspection.envelope.payload) return 'unchanged';

        const nextEnvelope = createPtvCacheEnvelope({
            createdAt: inspection.envelope.createdAt,
            expiresAt: inspection.envelope.expiresAt,
            key: inspection.envelope.key,
            payload: nextPayload,
            payloadBytes: getSerializedPayloadBytes(nextPayload),
            schemaVersion: inspection.envelope.schemaVersion,
            scope: inspection.envelope.scope,
            staleWhileRevalidateUntil: inspection.envelope.staleWhileRevalidateUntil
        });

        if (options.shouldWrite?.() === false) return 'retired';
        await requestResult(store.put(nextEnvelope));
        recordPtvEvent('cache', 'library-index-cache-updated', {
            result: 'updated'
        });
        return 'updated';
    } catch (error) {
        if (options.shouldWrite?.() === false) return 'retired';
        await deletePtvLibraryIndexCache(key);
        recordPtvEvent('cache', 'library-index-cache-update-failed', {
            reason: error instanceof Error ? 'indexed-db-error' : 'unknown-error'
        });
        return 'failed';
    }
}

export async function deletePtvLibraryIndexCache(key: string): Promise<void> {
    try {
        const store = await getStore('readwrite');

        if (!store) return;

        await requestResult(store.delete(key));
    } catch (error) {
        recordPtvEvent('cache', 'library-index-cache-delete-failed', {
            error: error instanceof Error ? error.message : String(error),
            key
        });
    }
}

export async function deletePtvLibraryIndexCacheByPrefix(prefix: string): Promise<void> {
    try {
        const store = await getStore('readwrite');

        if (!store) return;

        await new Promise<void>((resolve, reject) => {
            const cursorRequest = store.openCursor();

            cursorRequest.onerror = () => reject(cursorRequest.error || new Error('IndexedDB cursor failed'));
            cursorRequest.onsuccess = () => {
                const cursor = cursorRequest.result;

                if (!cursor) {
                    resolve();
                    return;
                }

                if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
                    cursor.delete();
                }

                cursor.continue();
            };
        });
    } catch (error) {
        recordPtvEvent('cache', 'library-index-cache-prefix-delete-failed', {
            error: error instanceof Error ? error.message : String(error),
            prefix
        });
    }
}
