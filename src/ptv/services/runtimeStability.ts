import { recordPtvEvent } from '../core/observability';

import {
    incrementPtvPerformanceCounter,
    recordPtvPerformanceEntry,
    setPtvPerformanceCounter
} from './performanceMonitor';

type PtvRuntimeShellInstance = {
    mountedAt: number;
    route: string;
    section: string;
};

type PtvRuntimeStorageWriteOptions = {
    maxBytes?: number;
    namespace?: string;
};

type PtvRuntimeWindow = Window & {
    PTV?: Record<string, unknown> & {
        runtimeStability?: {
            clearClientCaches: () => number;
            report: typeof getPtvRuntimeStabilityReport;
        };
    };
};

const PTV_RUNTIME_MIGRATION_KEY = 'ptv.runtimeStability.v1.legacyCachesMigrated';
const DEFAULT_LOCAL_STORAGE_MAX_BYTES = 180_000;
const OVERSIZED_LEGACY_PREFIXES = [
    'ptv.music.liked.',
    'ptv:reading-home:',
    'ptv:reading-summary',
    'ptv:reading-full',
    'ptv.reading.'
];

const activeRuntimeInstances = new Map<string, PtvRuntimeShellInstance>();
const activeNativeShellInstances = new Map<string, PtvRuntimeShellInstance>();
const knownQuotaFailureKeys = new Set<string>();
let runtimeInstanceSequence = 0;
let shellInstanceSequence = 0;
let migrationRan = false;

function getStorage(): Storage | null {
    try {
        return window.localStorage || null;
    } catch {
        return null;
    }
}

function now() {
    return Number(performance.now().toFixed(1));
}

function normalizeRouteSegment(value: string) {
    const trimmed = String(value || '').trim();

    if (!trimmed) return '';

    const withoutOrigin = trimmed.replace(/^https?:\/\/[^/]+/i, '');
    const pathOnly = withoutOrigin.split(/[?#]/)[0] || '';

    if (!pathOnly || pathOnly === '/') return '/';

    return pathOnly.startsWith('/') ? pathOnly : `/${pathOnly}`;
}

export function normalizePtvRouteLocation(locationLike: Pick<Location, 'hash' | 'pathname'> = window.location) {
    const hash = locationLike.hash || '';
    const pathname = normalizeRouteSegment(locationLike.pathname || '');
    const hashValue = hash.replace(/^#/, '');
    const hashPath = normalizeRouteSegment(hashValue);
    const canonicalPath = hashPath && hashPath !== '/' ? hashPath : pathname || '/';
    const full = `${pathname || ''}${hash}`;

    return {
        canonicalPath,
        full,
        hash,
        hashPath,
        path: pathname || '/',
        routeKey: `${canonicalPath}${hash.includes('?') ? `?${hash.split('?').slice(1).join('?')}` : ''}`
    };
}

export function estimatePtvPayloadBytes(value: unknown) {
    try {
        if (typeof value === 'string') return value.length;

        return JSON.stringify(value).length;
    } catch {
        return 0;
    }
}

function isQuotaError(error: unknown) {
    if (!(error instanceof Error)) return false;

    return error.name === 'QuotaExceededError'
        || error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
        || /quota|storage/i.test(error.message);
}

function shouldRemoveLegacyKey(key: string, rawValue: string | null) {
    if (OVERSIZED_LEGACY_PREFIXES.some(prefix => key.startsWith(prefix))) return true;

    return key.startsWith('ptv:')
        && Boolean(rawValue)
        && rawValue!.length > 512_000;
}

export function removePtvLocalStorageKey(key: string) {
    const storage = getStorage();

    if (!storage) return false;

    try {
        storage.removeItem(key);
        knownQuotaFailureKeys.delete(key);
        return true;
    } catch {
        return false;
    }
}

export function readPtvLocalStorageJson<T>(key: string, fallback: T): T {
    const storage = getStorage();

    if (!storage) return fallback;

    try {
        const rawValue = storage.getItem(key);

        if (!rawValue) return fallback;

        return JSON.parse(rawValue) as T;
    } catch (error) {
        recordPtvEvent('cache', 'ptv-local-storage-read-failed', {
            error: error instanceof Error ? error.message : String(error),
            key
        });
        return fallback;
    }
}

export function writePtvLocalStorageJson(
    key: string,
    value: unknown,
    options: PtvRuntimeStorageWriteOptions = {}
) {
    const storage = getStorage();
    const namespace = options.namespace || key.split(':')[0] || 'ptv';

    if (!storage || knownQuotaFailureKeys.has(key)) {
        if (knownQuotaFailureKeys.has(key)) {
            recordPtvPerformanceEntry('request', 'local-storage-write-skipped-known-quota-failure', {
                key,
                namespace
            });
        }
        return false;
    }

    let payload = '';

    try {
        payload = JSON.stringify(value);
    } catch (error) {
        recordPtvEvent('cache', 'ptv-local-storage-serialize-failed', {
            error: error instanceof Error ? error.message : String(error),
            key,
            namespace
        });
        return false;
    }

    const maxBytes = options.maxBytes ?? DEFAULT_LOCAL_STORAGE_MAX_BYTES;
    const payloadBytes = estimatePtvPayloadBytes(payload);

    if (payloadBytes > maxBytes) {
        knownQuotaFailureKeys.add(key);
        removePtvLocalStorageKey(key);
        incrementPtvPerformanceCounter('storageEvictionCount', {
            key,
            maxBytes,
            namespace,
            payloadBytes,
            reason: 'local-storage-payload-too-large'
        });
        recordPtvEvent('cache', 'ptv-local-storage-write-skipped-large-payload', {
            key,
            maxBytes,
            namespace,
            payloadBytes
        });
        return false;
    }

    const startedAt = now();

    try {
        storage.setItem(key, payload);
        recordPtvPerformanceEntry('request', 'local-storage-write', {
            key,
            namespace,
            payloadBytes
        }, Number((now() - startedAt).toFixed(1)));
        return true;
    } catch (error) {
        knownQuotaFailureKeys.add(key);
        if (isQuotaError(error)) {
            incrementPtvPerformanceCounter('localStorageQuotaFailureCount', {
                key,
                namespace,
                payloadBytes
            });
        }
        recordPtvEvent('cache', 'ptv-local-storage-write-failed', {
            error: error instanceof Error ? error.message : String(error),
            isQuotaError: isQuotaError(error),
            key,
            namespace,
            payloadBytes
        });
        return false;
    }
}

export function clearPtvLocalStorageByPrefix(prefixes: readonly string[]) {
    const storage = getStorage();

    if (!storage) return 0;

    const keys: string[] = [];

    try {
        for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);

            if (key && prefixes.some(prefix => key.startsWith(prefix))) keys.push(key);
        }

        keys.forEach(key => {
            storage.removeItem(key);
            knownQuotaFailureKeys.delete(key);
        });

        if (keys.length) {
            incrementPtvPerformanceCounter('storageEvictionCount', {
                count: keys.length,
                reason: 'clear-prefix',
                prefixes: prefixes.join(',')
            });
        }

        return keys.length;
    } catch (error) {
        recordPtvEvent('cache', 'ptv-local-storage-clear-prefix-failed', {
            error: error instanceof Error ? error.message : String(error),
            prefixes: prefixes.join(',')
        });
        return keys.length;
    }
}

export function runPtvClientCacheMigration() {
    if (migrationRan) return 0;

    migrationRan = true;
    const storage = getStorage();

    if (!storage) return 0;
    if (storage.getItem(PTV_RUNTIME_MIGRATION_KEY) === '1') return 0;

    const removedKeys: string[] = [];

    try {
        for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);

            if (!key) continue;

            const rawValue = storage.getItem(key);

            if (shouldRemoveLegacyKey(key, rawValue)) removedKeys.push(key);
        }

        removedKeys.forEach(key => storage.removeItem(key));
        storage.setItem(PTV_RUNTIME_MIGRATION_KEY, '1');

        if (removedKeys.length) {
            incrementPtvPerformanceCounter('storageEvictionCount', {
                count: removedKeys.length,
                reason: 'legacy-ptv-cache-migration'
            });
            recordPtvEvent('cache', 'ptv-legacy-client-cache-migrated', {
                legacyKeysRemoved: removedKeys.length
            });
        }

        return removedKeys.length;
    } catch (error) {
        recordPtvEvent('cache', 'ptv-legacy-client-cache-migration-failed', {
            error: error instanceof Error ? error.message : String(error),
            removedKeyCount: removedKeys.length
        });
        return removedKeys.length;
    }
}

export function registerPtvPersistentRuntimeRoot(source = 'ptv-runtime-root') {
    runPtvClientCacheMigration();

    const id = `runtime-${Date.now()}-${runtimeInstanceSequence += 1}`;
    const route = normalizePtvRouteLocation();

    activeRuntimeInstances.set(id, {
        mountedAt: Date.now(),
        route: route.routeKey,
        section: source
    });

    const activeCount = activeRuntimeInstances.size;
    setPtvPerformanceCounter('activeShellCount', activeCount, {
        route: route.routeKey,
        section: source
    });
    incrementPtvPerformanceCounter('persistentRuntimeMountCount', {
        route: route.routeKey,
        section: source
    });

    if (activeCount > 1) {
        incrementPtvPerformanceCounter('duplicateShellCount', {
            activeShellCount: activeCount,
            route: route.routeKey,
            section: source
        });
        recordPtvEvent('render', 'ptv-duplicate-runtime-root-detected', {
            activeShellCount: activeCount,
            route: route.routeKey,
            section: source
        });
    }

    return () => {
        activeRuntimeInstances.delete(id);
        setPtvPerformanceCounter('activeShellCount', activeRuntimeInstances.size, {
            route: normalizePtvRouteLocation().routeKey,
            section: source
        });
    };
}

export function registerPtvNativeShellInstance(section: string) {
    runPtvClientCacheMigration();

    const id = `native-shell-${Date.now()}-${shellInstanceSequence += 1}`;
    const route = normalizePtvRouteLocation();

    activeNativeShellInstances.set(id, {
        mountedAt: Date.now(),
        route: route.routeKey,
        section
    });

    incrementPtvPerformanceCounter('nativeShellMountCount', {
        activeNativeShellCount: activeNativeShellInstances.size,
        route: route.routeKey,
        section
    });
    incrementPtvPerformanceCounter('shellMountCount', {
        activeNativeShellCount: activeNativeShellInstances.size,
        route: route.routeKey,
        section
    });

    if (activeNativeShellInstances.size > 1) {
        recordPtvEvent('render', 'ptv-duplicate-native-shell-detected', {
            activeNativeShellCount: activeNativeShellInstances.size,
            route: route.routeKey,
            section
        });
    }

    return () => {
        activeNativeShellInstances.delete(id);
    };
}

export const registerPtvShellInstance = registerPtvNativeShellInstance;

export function getPtvRuntimeStabilityReport() {
    return {
        activeNativeShellCount: activeNativeShellInstances.size,
        activeShellCount: activeRuntimeInstances.size,
        knownQuotaFailureKeyCount: knownQuotaFailureKeys.size,
        legacyMigrationRan: migrationRan,
        nativeShellInstances: Array.from(activeNativeShellInstances.entries()).map(([id, instance]) => ({
            id,
            ...instance
        })),
        route: normalizePtvRouteLocation(),
        shellInstances: Array.from(activeRuntimeInstances.entries()).map(([id, instance]) => ({
            id,
            ...instance
        }))
    };
}

function installRuntimeStabilityNamespace() {
    const root = (window as PtvRuntimeWindow).PTV || ((window as PtvRuntimeWindow).PTV = {});

    root.runtimeStability = {
        clearClientCaches: () => clearPtvLocalStorageByPrefix(OVERSIZED_LEGACY_PREFIXES),
        report: getPtvRuntimeStabilityReport
    };
}

installRuntimeStabilityNamespace();
