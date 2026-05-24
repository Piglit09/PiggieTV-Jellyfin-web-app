import { getClientLogApi } from '@jellyfin/sdk/lib/utils/api/client-log-api';

import { ServerConnections } from 'lib/jellyfin-apiclient';

import { PTV_LOGGING } from './config';

type PtvLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

type PtvLogEntry = {
    at: string;
    detail?: string;
    level: PtvLogLevel;
    message: string;
    route: string;
    scope: string;
};

type PtvFlushResult = {
    entryCount: number;
    fileName: string;
    saved: boolean;
    serverFileName?: string;
};

type PtvLoggerApi = {
    clear: () => void;
    debug: (message: string, detail?: unknown, scope?: string) => void;
    error: (message: string, detail?: unknown, scope?: string) => void;
    flush: () => Promise<PtvFlushResult>;
    getEntries: () => PtvLogEntry[];
    getFileName: () => string;
    info: (message: string, detail?: unknown, scope?: string) => void;
    log: (level: PtvLogLevel, message: string, detail?: unknown, scope?: string) => void;
    trace: (message: string, detail?: unknown, scope?: string) => void;
    warn: (message: string, detail?: unknown, scope?: string) => void;
};

type PtvGlobal = Record<string, unknown> & {
    flushLogs?: () => Promise<PtvFlushResult>;
    logger?: PtvLoggerApi;
};

type PtvWindow = Window & Record<string, unknown> & {
    PTV?: PtvGlobal;
};

const ptvWindow = window as unknown as PtvWindow;
const memoryEntries: PtvLogEntry[] = [];
const DEBUG_FLAG_KEY = 'PTV_DEBUG';
const INSTALLED_FLAG_KEY = '__PTV_LOGGER_INSTALLED__';

let flushTimer: number | null = null;
let autoFlushTimer: number | null = null;
let flushPromise: Promise<PtvFlushResult> | null = null;
let lastUploadError: string | null = null;

function isDebugEnabled() {
    return ptvWindow[DEBUG_FLAG_KEY] === true;
}

function debugConsole(message: string, detail?: unknown) {
    if (!isDebugEnabled()) return;

    console.debug(`[PiggieTV Logger] ${message}`, detail);
}

function getDateSlug(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

function getLogFileName(date = new Date()) {
    return `${PTV_LOGGING.filePrefix}_(${getDateSlug(date)}).log`;
}

function getStorageKey(date = new Date()) {
    return `${PTV_LOGGING.storagePrefix}:${getDateSlug(date)}`;
}

function getStorage() {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function trimEntries(entries: PtvLogEntry[]) {
    if (entries.length <= PTV_LOGGING.maxEntries) return entries;

    return entries.slice(entries.length - PTV_LOGGING.maxEntries);
}

function readStoredEntries() {
    const storage = getStorage();
    if (!storage) return memoryEntries;

    try {
        const parsed = JSON.parse(storage.getItem(getStorageKey()) || '[]') as unknown;

        if (!Array.isArray(parsed)) return memoryEntries;

        return parsed.filter((entry): entry is PtvLogEntry => (
            Boolean(entry)
            && typeof entry === 'object'
            && typeof (entry as PtvLogEntry).at === 'string'
            && typeof (entry as PtvLogEntry).level === 'string'
            && typeof (entry as PtvLogEntry).message === 'string'
            && typeof (entry as PtvLogEntry).route === 'string'
            && typeof (entry as PtvLogEntry).scope === 'string'
        ));
    } catch {
        return memoryEntries;
    }
}

function writeStoredEntries(entries: PtvLogEntry[]) {
    const trimmedEntries = trimEntries(entries);

    memoryEntries.splice(0, memoryEntries.length, ...trimmedEntries);

    const storage = getStorage();
    if (!storage) return;

    try {
        storage.setItem(getStorageKey(), JSON.stringify(trimmedEntries));
    } catch (err) {
        lastUploadError = err instanceof Error ? err.message : 'Unable to store PTV logs locally.';
        debugConsole('failed to persist local log buffer', err);
    }
}

function cleanupOldLogBuffers() {
    const storage = getStorage();
    if (!storage) return;

    const todayKey = getStorageKey();

    try {
        for (let index = storage.length - 1; index >= 0; index -= 1) {
            const key = storage.key(index);

            if (key?.startsWith(`${PTV_LOGGING.storagePrefix}:`) && key !== todayKey) {
                storage.removeItem(key);
            }
        }
    } catch (err) {
        debugConsole('failed to clean old log buffers', err);
    }
}

function stringifyDetail(detail: unknown) {
    if (detail === undefined) return undefined;

    const seen = typeof WeakSet === 'function' ? new WeakSet<object>() : null;

    try {
        const serialized = JSON.stringify(detail, (_key: string, value: unknown) => {
            if (value instanceof Error) {
                return {
                    message: value.message,
                    name: value.name,
                    stack: value.stack
                };
            }

            if (typeof value === 'string' && value.length > PTV_LOGGING.maxDetailLength) {
                return `${value.slice(0, PTV_LOGGING.maxDetailLength)}...`;
            }

            if (value && typeof value === 'object') {
                if (seen?.has(value)) return '[Circular]';
                seen?.add(value);
            }

            return value;
        });

        if (!serialized) return undefined;

        return serialized.length > PTV_LOGGING.maxDetailLength ?
            `${serialized.slice(0, PTV_LOGGING.maxDetailLength)}...` :
            serialized;
    } catch {
        return String(detail).slice(0, PTV_LOGGING.maxDetailLength);
    }
}

function formatEntry(entry: PtvLogEntry) {
    const detail = entry.detail ? ` ${entry.detail}` : '';

    return `[${entry.at}] [${entry.level.toUpperCase()}] [${entry.scope}] ${entry.message} route=${entry.route}${detail}`;
}

function createLogDocument(entries: PtvLogEntry[]) {
    const header = [
        'PiggieTV Client Log',
        `File: ${getLogFileName()}`,
        `GeneratedAt: ${new Date().toISOString()}`,
        `Build: ${typeof __PACKAGE_JSON_VERSION__ === 'string' ? __PACKAGE_JSON_VERSION__ : 'unknown'}`,
        `Commit: ${typeof __COMMIT_SHA__ === 'string' ? __COMMIT_SHA__ : 'unknown'}`,
        `Location: ${window.location.href}`,
        `UserAgent: ${navigator.userAgent}`,
        lastUploadError ? `PreviousUploadError: ${lastUploadError}` : '',
        ''
    ].filter(Boolean);

    return `${header.join('\n')}\n${entries.map(formatEntry).join('\n')}\n`;
}

function createLogFile(content: string, fileName: string) {
    if (typeof File === 'function') {
        return new File([content], fileName, { type: 'text/plain' });
    }

    const blob = new Blob([content], { type: 'text/plain' });

    return Object.assign(blob, {
        lastModified: Date.now(),
        name: fileName
    }) as File;
}

function getPtvGlobal() {
    ptvWindow.PTV ||= {};

    return ptvWindow.PTV;
}

function scheduleFlush() {
    if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
    }

    flushTimer = window.setTimeout(() => {
        flushTimer = null;
        void flushPtvLogs();
    }, PTV_LOGGING.uploadDebounceMs);
}

function appendEntry(level: PtvLogLevel, message: string, detail?: unknown, scope = 'PTV') {
    const entry: PtvLogEntry = {
        at: new Date().toISOString(),
        detail: stringifyDetail(detail),
        level,
        message,
        route: `${window.location.pathname}${window.location.hash}${window.location.search}`,
        scope
    };

    const entries = readStoredEntries();

    entries.push(entry);
    writeStoredEntries(entries);

    if (isDebugEnabled()) {
        console[level === 'trace' ? 'debug' : level](`[PiggieTV] ${message}`, detail);
    }

    scheduleFlush();
}

function getContentDisposition(fileName: string) {
    const safeName = fileName.replace(/["\r\n]/g, '');

    return `attachment; filename="${safeName}"`;
}

export function flushPtvLogs() {
    if (flushPromise) return flushPromise;

    const entries = readStoredEntries();
    const fileName = getLogFileName();

    if (!entries.length) {
        return Promise.resolve({
            entryCount: 0,
            fileName,
            saved: false
        });
    }

    const api = ServerConnections.getCurrentApi?.();

    if (!api) {
        debugConsole('skipping upload until a Jellyfin API connection is available');

        return Promise.resolve({
            entryCount: entries.length,
            fileName,
            saved: false
        });
    }

    const content = createLogDocument(entries);
    const file = createLogFile(content, fileName);

    flushPromise = getClientLogApi(api)
        .logFile({
            body: file
        }, {
            headers: {
                'Content-Disposition': getContentDisposition(fileName),
                'X-PiggieTV-Log-File': fileName
            }
        })
        .then(response => {
            lastUploadError = null;

            return {
                entryCount: entries.length,
                fileName,
                saved: true,
                serverFileName: response.data.FileName
            };
        })
        .catch((err: unknown) => {
            lastUploadError = err instanceof Error ? err.message : 'Unable to upload PTV log.';
            debugConsole('upload failed', err);

            return {
                entryCount: entries.length,
                fileName,
                saved: false
            };
        })
        .finally(() => {
            flushPromise = null;
        });

    return flushPromise;
}

function logBrowserError(event: ErrorEvent) {
    appendEntry('error', 'Unhandled browser error', {
        column: event.colno,
        error: event.error,
        file: event.filename,
        line: event.lineno,
        message: event.message
    }, 'Browser');
}

function logUnhandledRejection(event: PromiseRejectionEvent) {
    appendEntry('error', 'Unhandled promise rejection', {
        reason: event.reason
    }, 'Browser');
}

export const ptvLogger: PtvLoggerApi = {
    clear() {
        writeStoredEntries([]);
        lastUploadError = null;
    },

    debug(message, detail, scope) {
        appendEntry('debug', message, detail, scope);
    },

    error(message, detail, scope) {
        appendEntry('error', message, detail, scope);
    },

    flush: flushPtvLogs,

    getEntries() {
        return [...readStoredEntries()];
    },

    getFileName() {
        return getLogFileName();
    },

    info(message, detail, scope) {
        appendEntry('info', message, detail, scope);
    },

    log(level, message, detail, scope) {
        appendEntry(level, message, detail, scope);
    },

    trace(message, detail, scope) {
        appendEntry('trace', message, detail, scope);
    },

    warn(message, detail, scope) {
        appendEntry('warn', message, detail, scope);
    }
};

export function initPtvLogging() {
    if (ptvWindow[INSTALLED_FLAG_KEY] === true) return ptvLogger;

    ptvWindow[INSTALLED_FLAG_KEY] = true;
    cleanupOldLogBuffers();

    const ptv = getPtvGlobal();
    ptv.logger = ptvLogger;
    ptv.flushLogs = flushPtvLogs;

    window.addEventListener('error', logBrowserError);
    window.addEventListener('unhandledrejection', logUnhandledRejection);
    window.addEventListener('online', () => {
        void flushPtvLogs();
    });
    window.addEventListener('pagehide', () => {
        void flushPtvLogs();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            void flushPtvLogs();
        }
    });

    autoFlushTimer = window.setInterval(() => {
        void flushPtvLogs();
    }, PTV_LOGGING.autoFlushMs);

    appendEntry('info', 'PTV logging started', {
        fileName: getLogFileName()
    }, 'Logger');

    return ptvLogger;
}

export function destroyPtvLogging() {
    if (flushTimer !== null) {
        window.clearTimeout(flushTimer);
        flushTimer = null;
    }

    if (autoFlushTimer !== null) {
        window.clearInterval(autoFlushTimer);
        autoFlushTimer = null;
    }

    window.removeEventListener('error', logBrowserError);
    window.removeEventListener('unhandledrejection', logUnhandledRejection);
    ptvWindow[INSTALLED_FLAG_KEY] = false;
}
