import { redactPtvSensitiveValue } from './diagnostics/redaction';

type PtvSafeConsoleMethod = 'debug' | 'error' | 'info' | 'log' | 'warn';

function sanitizeArguments(values: unknown[]) {
    return values.map(value => redactPtvSensitiveValue(value));
}

function write(method: PtvSafeConsoleMethod, values: unknown[]) {
    console[method](...sanitizeArguments(values));
}

/**
 * Console boundary for request, authentication, and diagnostics code. Values are
 * structurally redacted without mutating the objects used by the application.
 */
export const ptvSafeConsole = Object.freeze({
    debug(...values: unknown[]) {
        write('debug', values);
    },
    error(...values: unknown[]) {
        write('error', values);
    },
    info(...values: unknown[]) {
        write('info', values);
    },
    log(...values: unknown[]) {
        write('log', values);
    },
    warn(...values: unknown[]) {
        write('warn', values);
    }
});
