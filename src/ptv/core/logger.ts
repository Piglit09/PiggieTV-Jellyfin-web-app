import { PTV_LOGGING } from './config';
import {
    redactPtvSensitiveText,
    redactPtvSensitiveValue
} from './diagnostics/redaction';
import { ptvSafeConsole } from './safeConsole';

type PtvLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

type PtvLogEntry = {
    at: string;
    detail?: string;
    level: PtvLogLevel;
    message: string;
    route: string;
    scope: string;
};

type PtvLoggerApi = {
    clear: () => void;
    debug: (message: string, detail?: unknown, scope?: string) => void;
    error: (message: string, detail?: unknown, scope?: string) => void;
    getEntries: () => PtvLogEntry[];
    info: (message: string, detail?: unknown, scope?: string) => void;
    log: (level: PtvLogLevel, message: string, detail?: unknown, scope?: string) => void;
    trace: (message: string, detail?: unknown, scope?: string) => void;
    warn: (message: string, detail?: unknown, scope?: string) => void;
};

type PtvGlobal = Record<string, unknown> & {
    duplicateInitializationSuppressed?: number;
    loggerCreateCount?: number;
    loggerReuseCount?: number;
    logger?: PtvLoggerApi;
};

type PtvWindow = Window & Record<string, unknown> & {
    PTV?: PtvGlobal;
};

const ptvWindow = window as unknown as PtvWindow;
const memoryEntries: PtvLogEntry[] = [];
const DEBUG_FLAG_KEY = 'PTV_DEBUG';
const INSTALLED_FLAG_KEY = '__PTV_LOGGER_INSTALLED__';

function isDebugEnabled() {
    return ptvWindow[DEBUG_FLAG_KEY] === true;
}

function trimEntries(entries: PtvLogEntry[]) {
    if (entries.length <= PTV_LOGGING.maxEntries) return entries;

    return entries.slice(entries.length - PTV_LOGGING.maxEntries);
}

function readStoredEntries() {
    return [...memoryEntries];
}

function writeStoredEntries(entries: PtvLogEntry[]) {
    const trimmedEntries = trimEntries(entries);

    memoryEntries.splice(0, memoryEntries.length, ...trimmedEntries);
}

function stringifyDetail(detail: unknown) {
    if (detail === undefined) return undefined;

    try {
        const serialized = JSON.stringify(redactPtvSensitiveValue(detail, {
            maxStringLength: PTV_LOGGING.maxDetailLength
        }));

        if (!serialized) return undefined;

        return serialized.length > PTV_LOGGING.maxDetailLength ?
            `${serialized.slice(0, PTV_LOGGING.maxDetailLength)}...` :
            serialized;
    } catch {
        return redactPtvSensitiveText(String(detail), PTV_LOGGING.maxDetailLength);
    }
}

function getPtvGlobal() {
    ptvWindow.PTV ||= {};

    return ptvWindow.PTV;
}

function appendEntry(level: PtvLogLevel, message: string, detail?: unknown, scope = 'PTV') {
    const safeDetail = detail === undefined ? undefined : redactPtvSensitiveValue(detail, {
        maxStringLength: PTV_LOGGING.maxDetailLength
    });
    const entry: PtvLogEntry = {
        at: new Date().toISOString(),
        detail: stringifyDetail(safeDetail),
        level,
        message: redactPtvSensitiveText(message),
        route: redactPtvSensitiveText(`${window.location.pathname}${window.location.hash}${window.location.search}`),
        scope: redactPtvSensitiveText(scope)
    };

    const entries = readStoredEntries();

    entries.push(entry);
    writeStoredEntries(entries);

    if (isDebugEnabled()) {
        ptvSafeConsole[level === 'trace' ? 'debug' : level](`[PiggieTV] ${message}`, safeDetail);
    }
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
    },

    debug(message, detail, scope) {
        appendEntry('debug', message, detail, scope);
    },

    error(message, detail, scope) {
        appendEntry('error', message, detail, scope);
    },

    getEntries() {
        return [...readStoredEntries()];
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
    const ptv = getPtvGlobal();

    if (ptvWindow[INSTALLED_FLAG_KEY] === true) {
        ptv.loggerReuseCount = (ptv.loggerReuseCount || 0) + 1;
        ptv.duplicateInitializationSuppressed = (ptv.duplicateInitializationSuppressed || 0) + 1;
        return ptv.logger || ptvLogger;
    }

    ptvWindow[INSTALLED_FLAG_KEY] = true;
    ptv.loggerCreateCount = (ptv.loggerCreateCount || 0) + 1;
    ptv.logger = ptvLogger;

    window.addEventListener('error', logBrowserError);
    window.addEventListener('unhandledrejection', logUnhandledRejection);

    appendEntry('info', 'PTV logging started', { mode: 'memory-only' }, 'Logger');

    return ptvLogger;
}

export function destroyPtvLogging() {
    window.removeEventListener('error', logBrowserError);
    window.removeEventListener('unhandledrejection', logUnhandledRejection);
    ptvWindow[INSTALLED_FLAG_KEY] = false;
}
