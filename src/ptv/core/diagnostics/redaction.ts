export const PTV_REDACTED_VALUE = '[REDACTED]';

const SENSITIVE_KEYS = new Set([
    'accesstoken',
    'accesskey',
    'apikey',
    'authenticationtoken',
    'authorization',
    'authtoken',
    'bearer',
    'clientsecret',
    'certificatepassword',
    'cookie',
    'credential',
    'credentials',
    'discogstoken',
    'exchangetoken',
    'googlebooksapikey',
    'idtoken',
    'invitecode',
    'musicdiscogstoken',
    'openaiapikey',
    'password',
    'passwordresetcode',
    'privatekey',
    'proxyauthorization',
    'quickconnectcode',
    'quickconnectsecret',
    'refreshtoken',
    'resetcode',
    'secret',
    'sessiontoken',
    'setcookie',
    'smtppassword',
    'tmdbapitoken',
    'tmdbapikey',
    'tmdbreadaccesstoken',
    'token',
    'verificationcode',
    'verificationtoken',
    'xembyauthorization',
    'xembytoken',
    'xapikey',
    'xauthenticationtoken',
    'xauthtoken',
    'xmediabrowsertoken'
]);
const SENSITIVE_QUERY_KEYS = new Set([
    'auth',
    'code',
    'key'
]);
const CREDENTIAL_ASSIGNMENT_KEYS = [
    'access[-_ ]?(?:key|token)', 'api[-_ ]?key', 'apikey', 'authentication[-_ ]?token',
    'auth[-_ ]?token', 'certificate[-_ ]?password', 'client[-_ ]?secret', 'discogs[-_ ]?token',
    'exchange[-_ ]?token', 'google[-_ ]?books[-_ ]?api[-_ ]?key', 'id[-_ ]?token',
    'invite[-_ ]?code', 'openai[-_ ]?api[-_ ]?key', 'password', 'private[-_ ]?key',
    'quick[-_ ]?connect[-_ ]?(?:code|secret)', 'refresh[-_ ]?token', 'reset[-_ ]?code',
    'secret', 'session[-_ ]?token', 'smtp[-_ ]?password', 'tmdb[-_ ]?api[-_ ]?token',
    'token', 'verification[-_ ]?(?:code|token)'
].join('|');
const CREDENTIAL_ASSIGNMENT_PATTERN = new RegExp(
    `(["']?(?:${CREDENTIAL_ASSIGNMENT_KEYS})["']?\\s*[:=]\\s*)(["']?)([^\\s"',;&#}]+)(["']?)`,
    'gi'
);
const AUTHORIZATION_VALUE_PATTERN = /\b(Bearer|Basic)\s+[^\s"',;]+/gi;
const SENSITIVE_HEADER_PATTERN = /((?:Authorization|Proxy-Authorization|X-Api-Key|X-Auth-Token|X-Emby-Authorization|X-Emby-Token|X-MediaBrowser-Token|Cookie|Set-Cookie)\s*[:=]\s*)[^\r\n]+/gi;
const SENSITIVE_QUERY_KEYS_PATTERN = [
    'access[-_]?(?:key|token)', 'api[-_]?key', 'apikey', 'auth', 'authentication[-_]?token',
    'authorization', 'auth[-_]?token', 'client[-_]?secret', 'code', 'exchange[-_]?token',
    'id[-_]?token', 'key', 'password', 'quick[-_]?connect[-_]?(?:code|secret)',
    'refresh[-_]?token', 'secret', 'session[-_]?token', 'token'
].join('|');
const SENSITIVE_QUERY_PATTERN = new RegExp(
    `([?&](?:${SENSITIVE_QUERY_KEYS_PATTERN})=)[^&#\\s]*`,
    'gi'
);
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL_QUERY_PATTERN = /(https?:\/\/[^\s?#]+)[?#][^\s]*/gi;
const WINDOWS_PRIVATE_PATH_PATTERN = /\b[a-z]:\\(?:Users|ProgramData)\\[^\s,;]+/gi;
const WINDOWS_LEGACY_PRIVATE_PATH_PATTERN = /\b[a-z]:\\Documents and Settings\\[^\s,;]+/gi;
const UNIX_PRIVATE_PATH_PATTERN = /\/(?:home|Users|var\/lib)\/[^\s,;]+/g;

const DEFAULT_LIMITS = Object.freeze({
    maxArrayItems: 32,
    maxDepth: 5,
    maxObjectKeys: 64,
    maxStringLength: 500
});

export type PtvSensitiveDataLimits = Readonly<{
    maxArrayItems: number;
    maxDepth: number;
    maxObjectKeys: number;
    maxStringLength: number;
}>;

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
    return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...[truncated]`;
}

function normalizeKey(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function isPtvSensitiveKey(value: string) {
    return SENSITIVE_KEYS.has(normalizeKey(value));
}

function isPtvSensitiveQueryKey(value: string) {
    const normalized = normalizeKey(value);

    return SENSITIVE_KEYS.has(normalized) || SENSITIVE_QUERY_KEYS.has(normalized);
}

function redactCredentialAssignments(value: string) {
    return value.replace(
        CREDENTIAL_ASSIGNMENT_PATTERN,
        (_match, prefix: string, openingQuote: string, _secret: string, closingQuote: string) => {
            const quote = openingQuote && closingQuote ? openingQuote : '';

            return `${prefix}${quote}${PTV_REDACTED_VALUE}${quote}`;
        }
    );
}

export function redactPtvSensitiveText(
    value: unknown,
    maxLength: number = DEFAULT_LIMITS.maxStringLength
): string {
    if (typeof value !== 'string') return '';

    const redacted = redactCredentialAssignments(value)
        .replace(SENSITIVE_HEADER_PATTERN, `$1${PTV_REDACTED_VALUE}`)
        .replace(AUTHORIZATION_VALUE_PATTERN, `$1 ${PTV_REDACTED_VALUE}`)
        .replace(SENSITIVE_QUERY_PATTERN, `$1${PTV_REDACTED_VALUE}`);

    return truncate(redacted, Math.max(0, maxLength));
}

export function redactPtvCoreText(
    value: unknown,
    maxLength: number = DEFAULT_LIMITS.maxStringLength
): string {
    if (typeof value !== 'string') return '';

    return truncate(
        redactPtvSensitiveText(value, Number.MAX_SAFE_INTEGER)
            .replace(EMAIL_PATTERN, '[redacted-email]')
            .replace(URL_QUERY_PATTERN, '$1?[redacted]')
            .replace(WINDOWS_PRIVATE_PATH_PATTERN, '[redacted-path]')
            .replace(WINDOWS_LEGACY_PRIVATE_PATH_PATTERN, '[redacted-path]')
            .replace(UNIX_PRIVATE_PATH_PATTERN, '[redacted-path]'),
        Math.max(0, maxLength)
    );
}

function isInstanceOf(value: object, constructorName: 'Blob' | 'Headers' | 'Node' | 'Request' | 'Response' | 'URLSearchParams') {
    const constructor = (globalThis as Record<string, unknown>)[constructorName];

    return typeof constructor === 'function' && value instanceof (constructor as new (...args: never[]) => object);
}

function sanitizeHeaders(value: Headers, limits: PtvSensitiveDataLimits, privacyMode: boolean) {
    const output: Record<string, PtvCoreDiagnosticValue> = {};
    let count = 0;

    value.forEach((headerValue, headerName) => {
        if (count >= limits.maxObjectKeys) return;
        output[headerName] = isPtvSensitiveKey(headerName) ?
            PTV_REDACTED_VALUE :
            sanitizeText(headerValue, limits, privacyMode);
        count += 1;
    });

    if (count >= limits.maxObjectKeys) output.__truncated = true;
    return output;
}

function sanitizeSearchParams(value: URLSearchParams, limits: PtvSensitiveDataLimits, privacyMode: boolean) {
    const output: Record<string, PtvCoreDiagnosticValue> = {};
    let count = 0;

    value.forEach((parameterValue, parameterName) => {
        if (count >= limits.maxObjectKeys) return;
        const nextValue = isPtvSensitiveQueryKey(parameterName) ?
            PTV_REDACTED_VALUE :
            sanitizeText(parameterValue, limits, privacyMode);
        const hasCurrentValue = Object.prototype.hasOwnProperty.call(output, parameterName);
        const currentValue = output[parameterName];

        if (!hasCurrentValue) {
            output[parameterName] = nextValue;
        } else if (Array.isArray(currentValue)) {
            output[parameterName] = [...currentValue, nextValue];
        } else {
            output[parameterName] = [currentValue, nextValue];
        }
        count += 1;
    });

    if (count >= limits.maxObjectKeys) output.__truncated = true;
    return output;
}

function sanitizeText(value: string, limits: PtvSensitiveDataLimits, privacyMode: boolean) {
    return privacyMode ?
        redactPtvCoreText(value, limits.maxStringLength) :
        redactPtvSensitiveText(value, limits.maxStringLength);
}

function sanitizeError(
    value: Error,
    depth: number,
    limits: PtvSensitiveDataLimits,
    seen: WeakSet<object>,
    privacyMode: boolean
) {
    let message = '[unavailable]';
    let name = 'Error';
    let stack = '';

    try {
        message = sanitizeText(value.message, limits, privacyMode);
        name = sanitizeText(value.name, limits, privacyMode);
        stack = value.stack ? sanitizeText(value.stack, limits, privacyMode) : '';
    } catch {
        // A hostile error getter must not bypass or break the logging boundary.
    }

    const output: Record<string, PtvCoreDiagnosticValue> = {
        message,
        name
    };

    if (stack) output.stack = stack;

    try {
        if ('cause' in value) {
            const sanitizedCause = sanitizeValue(
                (value as Error & { cause?: unknown }).cause,
                depth + 1,
                limits,
                seen,
                privacyMode
            );

            if (sanitizedCause.present) output.cause = sanitizedCause.value;
        }
    } catch {
        output.cause = '[unavailable]';
    }

    Object.keys(value).slice(0, limits.maxObjectKeys).forEach(key => {
        if (key === 'cause' || key === 'message' || key === 'name' || key === 'stack') return;
        if (isPtvSensitiveKey(key)) {
            output[key] = PTV_REDACTED_VALUE;
            return;
        }

        let nestedValue: unknown;

        try {
            nestedValue = (value as Error & Record<string, unknown>)[key];
        } catch {
            output[key] = '[unavailable]';
            return;
        }

        const sanitized = sanitizeValue(
            nestedValue,
            depth + 1,
            limits,
            seen,
            privacyMode
        );

        if (sanitized.present) output[key] = sanitized.value;
    });

    return output;
}

function sanitizeRecord(
    value: object,
    depth: number,
    limits: PtvSensitiveDataLimits,
    seen: WeakSet<object>,
    privacyMode: boolean
) {
    const output: Record<string, PtvCoreDiagnosticValue> = {};
    const keys = Object.keys(value);

    keys.slice(0, limits.maxObjectKeys).forEach(key => {
        if (isPtvSensitiveKey(key)) {
            output[key] = PTV_REDACTED_VALUE;
            return;
        }

        let nestedValue: unknown;

        try {
            nestedValue = (value as Record<string, unknown>)[key];
        } catch {
            output[key] = '[unavailable]';
            return;
        }

        const sanitized = sanitizeValue(nestedValue, depth + 1, limits, seen, privacyMode);
        if (sanitized.present) output[key] = sanitized.value;
    });

    if (keys.length > limits.maxObjectKeys) output.__truncatedKeys = keys.length - limits.maxObjectKeys;
    return output;
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- The bounded type dispatcher is explicit by design at the security boundary.
function sanitizeValue(
    value: unknown,
    depth: number,
    limits: PtvSensitiveDataLimits,
    seen: WeakSet<object>,
    privacyMode: boolean
): SanitizedValue {
    if (value === null || typeof value === 'boolean') return { present: true, value };
    if (typeof value === 'number') {
        return Number.isFinite(value) ? { present: true, value } : { present: false, value: null };
    }
    if (typeof value === 'string') return { present: true, value: sanitizeText(value, limits, privacyMode) };
    if (typeof value === 'bigint') return { present: true, value: String(value) };
    if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
        return { present: false, value: null };
    }
    if (!value || typeof value !== 'object') return { present: false, value: null };
    if (depth >= limits.maxDepth) return { present: true, value: '[truncated]' };
    if (seen.has(value)) return { present: true, value: '[circular-reference]' };
    seen.add(value);

    if (value instanceof Error) {
        return { present: true, value: sanitizeError(value, depth, limits, seen, privacyMode) };
    }
    if (isInstanceOf(value, 'Headers')) {
        return { present: true, value: sanitizeHeaders(value as Headers, limits, privacyMode) };
    }
    if (isInstanceOf(value, 'URLSearchParams')) {
        return { present: true, value: sanitizeSearchParams(value as URLSearchParams, limits, privacyMode) };
    }
    if (value instanceof Date) return { present: true, value: value.toISOString() };
    if (value instanceof RegExp) return { present: true, value: value.toString() };
    if (isInstanceOf(value, 'Blob')) return { present: true, value: '[Blob omitted]' };
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        return { present: true, value: '[binary data omitted]' };
    }
    if (isInstanceOf(value, 'Node')) return { present: true, value: '[DOM node omitted]' };
    if (isInstanceOf(value, 'Request')) {
        const request = value as Request;

        return {
            present: true,
            value: {
                headers: sanitizeHeaders(request.headers, limits, privacyMode),
                method: request.method,
                url: sanitizeText(request.url, limits, privacyMode)
            }
        };
    }
    if (isInstanceOf(value, 'Response')) {
        const response = value as Response;

        return {
            present: true,
            value: {
                headers: sanitizeHeaders(response.headers, limits, privacyMode),
                status: response.status,
                statusText: sanitizeText(response.statusText, limits, privacyMode),
                url: sanitizeText(response.url, limits, privacyMode)
            }
        };
    }
    if (Array.isArray(value)) {
        const entryLimit = value.length > limits.maxArrayItems ? limits.maxArrayItems - 1 : limits.maxArrayItems;
        const entries = value.slice(0, entryLimit)
            .map(entry => sanitizeValue(entry, depth + 1, limits, seen, privacyMode))
            .filter(entry => entry.present)
            .map(entry => entry.value);

        if (value.length > limits.maxArrayItems) {
            entries.push(`[${value.length - entryLimit} entries truncated]`);
        }

        return { present: true, value: entries };
    }

    return { present: true, value: sanitizeRecord(value, depth, limits, seen, privacyMode) };
}

function getLimits(overrides: Partial<PtvSensitiveDataLimits> = {}): PtvSensitiveDataLimits {
    return {
        maxArrayItems: Math.max(1, overrides.maxArrayItems ?? DEFAULT_LIMITS.maxArrayItems),
        maxDepth: Math.max(1, overrides.maxDepth ?? DEFAULT_LIMITS.maxDepth),
        maxObjectKeys: Math.max(1, overrides.maxObjectKeys ?? DEFAULT_LIMITS.maxObjectKeys),
        maxStringLength: Math.max(0, overrides.maxStringLength ?? DEFAULT_LIMITS.maxStringLength)
    };
}

// eslint-disable-next-line sonarjs/function-return-type -- The public diagnostic value is intentionally a recursive tagged union.
export function redactPtvSensitiveValue(
    value: unknown,
    limitOverrides: Partial<PtvSensitiveDataLimits> = {}
): PtvCoreDiagnosticValue {
    const sanitized = sanitizeValue(value, 0, getLimits(limitOverrides), new WeakSet<object>(), false);

    let result: PtvCoreDiagnosticValue = null;

    if (sanitized.present) result = sanitized.value;

    return result;
}

export function sanitizePtvCoreMetadata(value: unknown): Record<string, PtvCoreDiagnosticValue> {
    const sanitized = sanitizeValue(value, 0, getLimits(), new WeakSet<object>(), true);

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
