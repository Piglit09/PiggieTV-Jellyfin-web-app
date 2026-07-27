const SENSITIVE_KEYS = new Set([
    'accesskey',
    'apikey',
    'authorization',
    'cookie',
    'credential',
    'email',
    'mediapath',
    'password',
    'refreshkey',
    'secret',
    'token'
]);
const CREDENTIAL_KEY_PATTERNS = [
    'access[-_ ]?key',
    'api[-_ ]?key',
    'authorization',
    'cookie',
    'credential',
    'password',
    'refresh[-_ ]?key',
    'secret',
    'token'
];
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL_QUERY_PATTERN = /(https?:\/\/[^\s?#]+)[?#][^\s]*/gi;
const WINDOWS_PRIVATE_PATH_PATTERN = /\b[a-z]:\\(?:Users|ProgramData)\\[^\s,;]+/gi;
const WINDOWS_LEGACY_PRIVATE_PATH_PATTERN = /\b[a-z]:\\Documents and Settings\\[^\s,;]+/gi;
const UNIX_PRIVATE_PATH_PATTERN = /\/(?:home|Users|var\/lib)\/[^\s,;]+/g;

const MAX_METADATA_DEPTH = 4;
const MAX_METADATA_KEYS = 64;
const MAX_ARRAY_ITEMS = 32;
const MAX_STRING_LENGTH = 500;

export type PtvCoreDiagnosticPrimitive = boolean | number | string | null;
export type PtvCoreDiagnosticValue =
    | PtvCoreDiagnosticPrimitive
    | PtvCoreDiagnosticValue[]
    | { [key: string]: PtvCoreDiagnosticValue };

type SanitizedValue = Readonly<{
    present: boolean;
    value: PtvCoreDiagnosticValue;
}>;

function truncate(value: string, maxLength: number) {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function redactNamedCredentials(value: string) {
    return CREDENTIAL_KEY_PATTERNS.reduce((result, keyPattern) => {
        const pattern = new RegExp(
            `(${keyPattern}\\s*[:=]\\s*)(?:bearer\\s+|basic\\s+)?[^\\s"',;]+`,
            'gi'
        );

        return result.replace(pattern, '$1[redacted]');
    }, value);
}

function isSensitiveKey(value: string) {
    const normalized = value
        .toLowerCase()
        .split('-').join('')
        .split('_').join('')
        .split(' ').join('');

    return SENSITIVE_KEYS.has(normalized);
}

export function redactPtvCoreText(value: unknown, maxLength = MAX_STRING_LENGTH): string {
    if (typeof value !== 'string') return '';

    return truncate(
        redactNamedCredentials(value)
            .replace(EMAIL_PATTERN, '[redacted-email]')
            .replace(URL_QUERY_PATTERN, '$1?[redacted]')
            .replace(WINDOWS_PRIVATE_PATH_PATTERN, '[redacted-path]')
            .replace(WINDOWS_LEGACY_PRIVATE_PATH_PATTERN, '[redacted-path]')
            .replace(UNIX_PRIVATE_PATH_PATTERN, '[redacted-path]'),
        Math.max(0, maxLength)
    );
}

function sanitizeValue(value: unknown, depth: number): SanitizedValue {
    if (value === null || typeof value === 'boolean') return { present: true, value };
    if (typeof value === 'number') {
        return Number.isFinite(value) ?
            { present: true, value } :
            { present: false, value: null };
    }
    if (typeof value === 'string') return { present: true, value: redactPtvCoreText(value) };
    if (depth >= MAX_METADATA_DEPTH) return { present: true, value: '[truncated]' };

    if (Array.isArray(value)) {
        const sanitized = value
            .slice(0, MAX_ARRAY_ITEMS)
            .map(entry => sanitizeValue(entry, depth + 1))
            .filter(entry => entry.present)
            .map(entry => entry.value);

        return { present: true, value: sanitized };
    }

    if (!value || typeof value !== 'object') return { present: false, value: null };

    const sanitized = Object.entries(value)
        .slice(0, MAX_METADATA_KEYS)
        .reduce<Record<string, PtvCoreDiagnosticValue>>((result, [key, entry]) => {
            if (isSensitiveKey(key)) {
                result[key] = '[redacted]';
                return result;
            }

            const sanitizedEntry = sanitizeValue(entry, depth + 1);
            if (sanitizedEntry.present) result[key] = sanitizedEntry.value;

            return result;
        }, {});

    return { present: true, value: sanitized };
}

export function sanitizePtvCoreMetadata(value: unknown): Record<string, PtvCoreDiagnosticValue> {
    const sanitized = sanitizeValue(value, 0);

    return sanitized.present && !Array.isArray(sanitized.value) && typeof sanitized.value === 'object' ?
        sanitized.value as Record<string, PtvCoreDiagnosticValue> :
        {};
}

export function getPtvCoreSerializedSize(value: unknown): number {
    try {
        return new TextEncoder().encode(JSON.stringify(value)).byteLength;
    } catch {
        return Number.POSITIVE_INFINITY;
    }
}
