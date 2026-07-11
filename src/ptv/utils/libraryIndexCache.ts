import { recordPtvEvent } from '../core/observability';

const DB_NAME = 'ptv-library-index-cache';
const DB_VERSION = 1;
const STORE_NAME = 'libraryIndexes';

export const PTV_LIBRARY_INDEX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type PtvLibraryIndexCacheEntry<TData> = {
    createdAt: number;
    data: TData;
    expiresAt: number;
    key: string;
    schemaVersion: number;
};

let databasePromise: Promise<IDBDatabase | null> | null = null;

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

export async function readPtvLibraryIndexCache<TData>(
    key: string,
    schemaVersion: number
): Promise<TData | null> {
    try {
        const store = await getStore('readonly');

        if (!store) return null;

        const entry = await requestResult(store.get(key)) as PtvLibraryIndexCacheEntry<TData> | undefined;

        if (!entry) {
            recordPtvEvent('cache', 'library-index-cache-miss', { key });
            return null;
        }

        if (entry.schemaVersion !== schemaVersion || entry.expiresAt <= Date.now()) {
            await deletePtvLibraryIndexCache(key);
            recordPtvEvent('cache', 'library-index-cache-stale', {
                key,
                schemaVersion: entry.schemaVersion
            });
            return null;
        }

        recordPtvEvent('cache', 'library-index-cache-hit', {
            ageMs: Date.now() - entry.createdAt,
            key
        });

        return entry.data;
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
    ttlMs = PTV_LIBRARY_INDEX_CACHE_TTL_MS
): Promise<void> {
    try {
        const store = await getStore('readwrite');

        if (!store) return;

        const createdAt = Date.now();

        await requestResult(store.put({
            createdAt,
            data,
            expiresAt: createdAt + ttlMs,
            key,
            schemaVersion
        } satisfies PtvLibraryIndexCacheEntry<TData>));
        recordPtvEvent('cache', 'library-index-cache-written', {
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
