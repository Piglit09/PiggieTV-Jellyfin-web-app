import { describe, expect, it, vi } from 'vitest';

vi.mock('../core/observability', () => ({ recordPtvEvent: vi.fn() }));

import { createPtvCacheEnvelope } from '../core/cache/cacheEnvelope';
import {
    inspectPtvLibraryIndexCacheRecord,
    PTV_LIBRARY_INDEX_CACHE_STALE_MS,
    type PtvLegacyLibraryIndexCacheEntry,
    updatePtvLibraryIndexCache
} from './libraryIndexCache';

const key = 'reading:server-a:user-a:books:library-index';
const scope = { kind: 'user', serverId: 'server-a', userId: 'user-a' } as const;
const now = Date.parse('2026-07-22T12:00:00.000Z');

function envelope(overrides: Record<string, unknown> = {}) {
    return {
        ...createPtvCacheEnvelope({
            createdAt: new Date(now - 1_000).toISOString(),
            expiresAt: new Date(now + 60_000).toISOString(),
            key,
            payload: { ids: ['one'] },
            schemaVersion: 4,
            scope
        }),
        ...overrides
    };
}

function resolvedRequest<TResult>(result: TResult): IDBRequest<TResult> {
    const request = {
        error: null,
        onerror: null,
        onsuccess: null,
        result
    } as unknown as IDBRequest<TResult>;

    void Promise.resolve().then(() => request.onsuccess?.call(request, new Event('success')));
    return request;
}

function createMemoryIndexedDb(records: Map<IDBValidKey, unknown>): IDBFactory {
    const store = {
        delete: (recordKey: IDBValidKey) => {
            records.delete(recordKey);
            return resolvedRequest(undefined);
        },
        get: (recordKey: IDBValidKey) => resolvedRequest(records.get(recordKey)),
        put: (value: unknown) => {
            const recordKey = (value as { key: IDBValidKey }).key;

            records.set(recordKey, value);
            return resolvedRequest(recordKey);
        }
    } as unknown as IDBObjectStore;
    const database = {
        close: () => undefined,
        objectStoreNames: { contains: () => true },
        onversionchange: null,
        transaction: () => ({ objectStore: () => store })
    } as unknown as IDBDatabase;

    return {
        open: () => {
            const request = {
                error: null,
                onerror: null,
                onsuccess: null,
                onupgradeneeded: null,
                result: database
            } as unknown as IDBOpenDBRequest;

            void Promise.resolve().then(() => request.onsuccess?.call(request, new Event('success')));
            return request;
        }
    } as unknown as IDBFactory;
}

describe('library index cache envelope boundary', () => {
    it('reads a current v1 envelope', () => {
        const result = inspectPtvLibraryIndexCacheRecord(envelope(), key, 4, { now, scope });

        expect(result.outcome).toBe('hit');
        expect(result.envelope?.payload).toEqual({ ids: ['one'] });
    });

    it('retains the legacy record fallback', () => {
        const legacy: PtvLegacyLibraryIndexCacheEntry<{ ids: string[] }> = {
            createdAt: now - 1_000,
            data: { ids: ['legacy'] },
            expiresAt: now + 60_000,
            key,
            schemaVersion: 4
        };
        const result = inspectPtvLibraryIndexCacheRecord(legacy, key, 4, { now, scope });

        expect(result.outcome).toBe('hit');
        expect(result.envelope?.contractVersion).toBe('1.0');
        expect(result.envelope?.payload).toEqual({ ids: ['legacy'] });
    });

    it('isolates scopes', () => {
        const result = inspectPtvLibraryIndexCacheRecord(envelope(), key, 4, {
            now,
            scope: { kind: 'user', serverId: 'server-a', userId: 'user-b' }
        });

        expect(result.outcome).toBe('miss');
    });

    it('handles corruption and version mismatches', () => {
        expect(inspectPtvLibraryIndexCacheRecord({ key }, key, 4, { now, scope }).outcome)
            .toBe('corrupt');
        expect(inspectPtvLibraryIndexCacheRecord(envelope({ schemaVersion: 3 }), key, 4, { now, scope }).outcome)
            .toBe('version-mismatch');
    });

    it('returns stale only within the opt-in stale window', () => {
        const stale = envelope({
            expiresAt: new Date(now - 1).toISOString(),
            staleWhileRevalidateUntil: new Date(now + PTV_LIBRARY_INDEX_CACHE_STALE_MS).toISOString()
        });

        expect(inspectPtvLibraryIndexCacheRecord(stale, key, 4, { now, scope }).outcome)
            .toBe('expired');
        expect(inspectPtvLibraryIndexCacheRecord(stale, key, 4, { allowStale: true, now, scope }).outcome)
            .toBe('stale');
    });

    it('updates only payload data while preserving cache envelope authority fields', async () => {
        const untouched = { label: 'preserve me' };
        const current = envelope({
            payload: { ids: [ 'one' ], untouched },
            staleWhileRevalidateUntil: new Date(now + 120_000).toISOString()
        });
        const records = new Map<IDBValidKey, unknown>([ [ key, current ] ]);
        const indexedDbDescriptor = Object.getOwnPropertyDescriptor(window, 'indexedDB');

        Object.defineProperty(window, 'indexedDB', {
            configurable: true,
            value: createMemoryIndexedDb(records)
        });

        try {
            const result = await updatePtvLibraryIndexCache<{
                ids: string[];
                untouched: { label: string };
            }>(
                key,
                4,
                payload => ({ ...payload, ids: [ 'two' ] }),
                { now, scope }
            );
            const updated = records.get(key) as typeof current;

            expect(result).toBe('updated');
            expect(updated.payload).toEqual({ ids: [ 'two' ], untouched });
            expect(updated.createdAt).toBe(current.createdAt);
            expect(updated.expiresAt).toBe(current.expiresAt);
            expect(updated.staleWhileRevalidateUntil).toBe(current.staleWhileRevalidateUntil);
            expect(updated.key).toBe(current.key);
            expect(updated.schemaVersion).toBe(current.schemaVersion);
            expect(updated.scope).toEqual(current.scope);

            records.set(key, current);
            const shouldWrite = vi.fn()
                .mockReturnValueOnce(true)
                .mockReturnValueOnce(true)
                .mockReturnValue(false);
            const retiredResult = await updatePtvLibraryIndexCache<{
                ids: string[];
                untouched: { label: string };
            }>(
                key,
                4,
                payload => ({ ...payload, ids: [ 'must-not-persist' ] }),
                { now, scope, shouldWrite }
            );

            expect(retiredResult).toBe('retired');
            expect(records.get(key)).toBe(current);
        } finally {
            if (indexedDbDescriptor) {
                Object.defineProperty(window, 'indexedDB', indexedDbDescriptor);
            } else {
                Reflect.deleteProperty(window, 'indexedDB');
            }
        }
    });
});
