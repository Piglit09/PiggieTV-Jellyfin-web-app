/* eslint-disable compat/compat */

export type PtvWebpackRuntime = {
    miniCssF?: (chunkId: number | string) => string;
    u?: (chunkId: number | string) => string;
    __ptvChunkAssetVersioningInstalled?: boolean;
};

type PtvChunkRecoveryLocation = Pick<Location, 'href' | 'origin'> & {
    replace: (url: string) => void;
};

type PtvChunkRecoveryHistory = Pick<History, 'replaceState' | 'state'>;

type PtvChunkRecoveryStorage = Pick<Storage, 'getItem' | 'setItem'>;

type PtvChunkRecoveryOptions = {
    buildId?: string;
    location?: PtvChunkRecoveryLocation;
    storage?: PtvChunkRecoveryStorage;
};

const ASSET_VERSION_PARAM = 'ptv_asset';
const RECOVERY_PARAM = 'ptv_chunk_recovery';
const RECOVERY_STORAGE_PREFIX = 'ptv:chunk-recovery:';
const CHUNK_FILE_PATTERN = /(?:^|\/)[^/?#]+\.(?:chunk\.js|css)(?:[?#]|$)/i;

function getErrorText(error: unknown) {
    if (error instanceof Error) return `${error.name} ${error.message}`;
    if (typeof error === 'object' && error) {
        const value = error as { code?: unknown; message?: unknown; name?: unknown; request?: unknown };
        return [ value.name, value.code, value.message, value.request ].filter(Boolean).join(' ');
    }
    return String(error || '');
}

function getChunkRequest(error: unknown) {
    if (typeof error !== 'object' || !error) return '';
    const request = (error as { request?: unknown }).request;
    return typeof request === 'string' ? request : '';
}

function stableHash(value: string) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}

function normalizeBuildId(value: string) {
    const normalized = String(value || '').trim().replace(/[^0-9A-Za-z._-]+/g, '-');
    return normalized.slice(0, 96) || 'build';
}

export function appendPtvChunkAssetVersion(assetUrl: string, buildId: string) {
    if (!assetUrl || !CHUNK_FILE_PATTERN.test(assetUrl)) return assetUrl;

    const [withoutHash, hash = ''] = assetUrl.split('#', 2);
    const separator = withoutHash.includes('?') ? '&' : '?';
    const versioned = `${withoutHash}${separator}${ASSET_VERSION_PARAM}=${encodeURIComponent(normalizeBuildId(buildId))}`;
    return hash ? `${versioned}#${hash}` : versioned;
}

export function installPtvChunkAssetVersioning(runtime: PtvWebpackRuntime, buildId: string) {
    if (!runtime || runtime.__ptvChunkAssetVersioningInstalled) return false;

    const normalizedBuildId = normalizeBuildId(buildId);
    const originalScriptFilename = runtime.u;
    const originalStyleFilename = runtime.miniCssF;

    if (originalScriptFilename) {
        runtime.u = chunkId => appendPtvChunkAssetVersion(originalScriptFilename(chunkId), normalizedBuildId);
    }
    if (originalStyleFilename) {
        runtime.miniCssF = chunkId => appendPtvChunkAssetVersion(originalStyleFilename(chunkId), normalizedBuildId);
    }

    runtime.__ptvChunkAssetVersioningInstalled = true;
    return Boolean(originalScriptFilename || originalStyleFilename);
}

export function isPtvChunkLoadError(error: unknown, pageOrigin = window.location.origin) {
    const errorText = getErrorText(error);
    if (!/(?:ChunkLoadError|Loading (?:CSS )?chunk|CSS_CHUNK_LOAD_FAILED)/i.test(errorText)) return false;

    const request = getChunkRequest(error);
    if (!request) return true;

    try {
        const requestUrl = new URL(request, pageOrigin);
        return requestUrl.origin === pageOrigin && CHUNK_FILE_PATTERN.test(requestUrl.pathname);
    } catch {
        return false;
    }
}

export function tryRecoverPtvChunkLoadError(error: unknown, options: PtvChunkRecoveryOptions = {}) {
    const location = options.location || window.location;
    if (!isPtvChunkLoadError(error, location.origin)) return false;

    const buildId = normalizeBuildId(options.buildId || 'build');
    const requestIdentity = getChunkRequest(error) || getErrorText(error);
    const storageKey = `${RECOVERY_STORAGE_PREFIX}${buildId}:${stableHash(requestIdentity)}`;
    const storage = options.storage || window.sessionStorage;

    try {
        if (storage.getItem(storageKey) === 'attempted') return false;
        storage.setItem(storageKey, 'attempted');
    } catch {
        // Storage is an optimization. The URL marker still bounds recovery after reload.
        const currentUrl = new URL(location.href);
        if (currentUrl.searchParams.get(RECOVERY_PARAM) === buildId) return false;
    }

    const recoveryUrl = new URL(location.href);
    recoveryUrl.searchParams.set(RECOVERY_PARAM, buildId);
    location.replace(recoveryUrl.toString());
    return true;
}

export function clearPtvChunkRecoveryQuery(
    location: Pick<Location, 'href'> = window.location,
    history: PtvChunkRecoveryHistory = window.history
) {
    const currentUrl = new URL(location.href);
    if (!currentUrl.searchParams.has(RECOVERY_PARAM)) return false;

    currentUrl.searchParams.delete(RECOVERY_PARAM);
    history.replaceState(history.state, '', currentUrl.toString());
    return true;
}

/* eslint-enable compat/compat */
