type PtvDebugSanitizationReport = {
    omittedFields: number;
    redactedBlobUrls: number;
    redactedDataImages: number;
    redactedFields: number;
    redactedIdentifiers: number;
    redactedPaths: number;
    redactedUrls: number;
    truncatedArrays: number;
    truncatedDepth: number;
    truncatedObjects: number;
    truncatedStrings: number;
};

type PtvDebugSanitizationLimits = {
    maxArrayLength: number;
    maxDepth: number;
    maxObjectKeys: number;
    maxStringLength: number;
};

const DEFAULT_LIMITS: PtvDebugSanitizationLimits = {
    maxArrayLength: 120,
    maxDepth: 9,
    maxObjectKeys: 160,
    maxStringLength: 1600
};

const SECRET_FIELD_PATTERN = /^(?:api[_-]?key|authorization|cookie|credential|credentials|discogsToken|password|refreshToken|secret|set-cookie|smtpHost|smtpPassword|smtpPort|smtpUsername|tmdbApiToken|token|username)$/i;
const IDENTIFIER_FIELD_PATTERN = /^(?:deviceId|itemId|parentId|serverId|userId)$/i;
const LOCAL_PATH_FIELD_PATTERN = /^(?:cacheFilePath|cachePath|filePath|localPath|path)$/i;
const URL_FIELD_PATTERN = /(?:imageUrl|requestUrl|resolvedUrl|url)$/i;
const PRIVATE_HOST_FIELD_PATTERN = /^(?:host|hostname|origin|serverAddress|serverHost)$/i;
const OMITTED_SHAREABLE_FIELD_PATTERN = /^(?:credentialLength|smtpPasswordConfigured)$/i;
const VERSION_FIELD_PATTERN = /(?:^|(?:build|client|plugin|server|web))version$/i;
const BUILD_IDENTIFIER_FIELD_PATTERN = /(?:build|commit|revision)(?:hash|id|version)?$/i;
const SEMANTIC_VERSION_PATTERN = /^v?\d+(?:\.\d+){1,4}(?:[-+][0-9A-Za-z.-]+)?$/;
const SAFE_BUILD_IDENTIFIER_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,79}$/;
const DATA_IMAGE_PATTERN = /^data:image/i;
const BLOB_URL_PATTERN = /^blob:/i;
const PRIVATE_IPV4_PATTERNS = [
    /\b10(?:\.\d{1,3}){3}\b/gi,
    /\b127(?:\.\d{1,3}){3}\b/gi,
    /\b169\.254(?:\.\d{1,3}){2}\b/gi,
    /\b172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}\b/gi,
    /\b192\.168(?:\.\d{1,3}){2}\b/gi
];
const LOCAL_HOST_PATTERN = /\b(?:localhost|[a-z0-9-]+\.local)(?::\d+)?\b/gi;
const GUID_OR_LONG_HEX_PATTERN = /\b(?:[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{24,64})\b/gi;
const GUID_OR_LONG_HEX_SEGMENT_PATTERN = /^(?:[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{24,64})$/i;
const WINDOWS_PATH_PATTERN = /\b[A-Z]:\\(?:[^\s"'<>]+\\)*[^\s"'<>]*/gi;
const JELLYFIN_PATH_PATTERN = /\/(?:config|var\/lib|var\/cache|home)\/[^\s"'<>]*/gi;
const AUTH_VALUE_PATTERN = /\b(?:Bearer|Basic)\s+[^\s"',}]+/gi;
const SECRET_QUERY_PATTERN = /([?&](?:api[_-]?key|access_token|auth|authorization|key|password|secret|token)=)[^&#\s]*/gi;
const ABSOLUTE_URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi;
const API_PATH_PREFIX_PATTERN = /^\/?(?:Items|Plugins|Ptv|Sessions|System|Users)(?:\/|$)/i;

function createReport(): PtvDebugSanitizationReport {
    return {
        omittedFields: 0,
        redactedBlobUrls: 0,
        redactedDataImages: 0,
        redactedFields: 0,
        redactedIdentifiers: 0,
        redactedPaths: 0,
        redactedUrls: 0,
        truncatedArrays: 0,
        truncatedDepth: 0,
        truncatedObjects: 0,
        truncatedStrings: 0
    };
}

function sanitizeUrl(rawUrl: string, report: PtvDebugSanitizationReport) {
    const normalizedUrl = rawUrl.trim();
    if (!normalizedUrl || /^(?:n\/a|none|null|undefined)$/i.test(normalizedUrl)) return normalizedUrl;

    if (DATA_IMAGE_PATTERN.test(normalizedUrl)) {
        report.redactedDataImages += 1;
        report.redactedUrls += 1;
        return '[data-image-redacted]';
    }

    if (BLOB_URL_PATTERN.test(normalizedUrl)) {
        report.redactedBlobUrls += 1;
        report.redactedUrls += 1;
        return '[blob-url-redacted]';
    }

    try {
        const anchor = document.createElement('a');
        anchor.href = normalizedUrl;
        const pathSegments = anchor.pathname.split('/').map((segment, index, segments) => {
            if (!segment) return segment;

            const previous = String(segments[index - 1] || '').toLowerCase();
            if (previous === 'users') return '{userId}';
            if (previous === 'items' || GUID_OR_LONG_HEX_SEGMENT_PATTERN.test(segment)) return '{itemId}';
            return segment;
        });

        const queryNames = Array.from(new Set(
            anchor.search
                .slice(1)
                .split('&')
                .map(entry => entry.split('=', 1)[0])
                .filter(Boolean)
        ));
        const query = queryNames.length ? `?${queryNames.join('&')}` : '';
        report.redactedUrls += 1;
        return `[origin-redacted]${pathSegments.join('/')}${query}`;
    } catch {
        report.redactedUrls += 1;
        return '[url-redacted]';
    }
}

function sanitizeString(
    value: string,
    report: PtvDebugSanitizationReport,
    limits: PtvDebugSanitizationLimits
) {
    const normalizedValue = value.trim();

    if (DATA_IMAGE_PATTERN.test(normalizedValue) || BLOB_URL_PATTERN.test(normalizedValue)) {
        return sanitizeUrl(normalizedValue, report);
    }

    let sanitized = value.replace(ABSOLUTE_URL_PATTERN, match => sanitizeUrl(match, report));
    sanitized = sanitized.replace(/(\/?Users\/)[^/?#\s]+/gi, (_match, prefix: string) => {
        report.redactedIdentifiers += 1;
        return `${prefix}{userId}`;
    });
    sanitized = sanitized.replace(/(\/?Items\/)[^/?#\s]+/gi, (_match, prefix: string) => {
        report.redactedIdentifiers += 1;
        return `${prefix}{itemId}`;
    });
    sanitized = sanitized.replace(AUTH_VALUE_PATTERN, () => {
        report.redactedFields += 1;
        return '[authorization-redacted]';
    });
    sanitized = sanitized.replace(SECRET_QUERY_PATTERN, (_match, prefix: string) => {
        report.redactedFields += 1;
        return `${prefix}[redacted]`;
    });
    PRIVATE_IPV4_PATTERNS.forEach(pattern => {
        sanitized = sanitized.replace(pattern, () => {
            report.redactedUrls += 1;
            return '[private-host]';
        });
    });
    sanitized = sanitized.replace(LOCAL_HOST_PATTERN, () => {
        report.redactedUrls += 1;
        return '[private-host]';
    });
    sanitized = sanitized.replace(WINDOWS_PATH_PATTERN, () => {
        report.redactedPaths += 1;
        return '[local-path]';
    });
    sanitized = sanitized.replace(JELLYFIN_PATH_PATTERN, () => {
        report.redactedPaths += 1;
        return '[local-path]';
    });
    sanitized = sanitized.replace(GUID_OR_LONG_HEX_PATTERN, () => {
        report.redactedIdentifiers += 1;
        return '[redacted-id]';
    });

    if (sanitized.length > limits.maxStringLength) {
        report.truncatedStrings += 1;
        return `${sanitized.slice(0, limits.maxStringLength)}...[truncated]`;
    }

    return sanitized;
}

function sanitizeSignup(value: unknown, report: PtvDebugSanitizationReport) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;

    const signup = value as Record<string, unknown>;

    if (Object.prototype.hasOwnProperty.call(signup, 'smtpPasswordConfigured')) {
        report.omittedFields += 1;
    }

    return {
        emailConfigured: Boolean(signup.emailConfigured),
        emailEnabled: Boolean(signup.emailEnabled),
        enabled: Boolean(signup.enabled),
        nativeUserCount: Number(signup.nativeUserCount) || 0,
        pendingResetCount: Number(signup.pendingResetCount) || 0,
        pendingVerificationCount: Number(signup.pendingVerificationCount) || 0
    };
}

function sanitizeStringField(
    value: string,
    fieldName: string,
    report: PtvDebugSanitizationReport,
    limits: PtvDebugSanitizationLimits
) {
    const normalizedValue = value.trim();

    if (DATA_IMAGE_PATTERN.test(normalizedValue) || BLOB_URL_PATTERN.test(normalizedValue)) {
        return sanitizeUrl(normalizedValue, report);
    }

    if (
        (VERSION_FIELD_PATTERN.test(fieldName) && SEMANTIC_VERSION_PATTERN.test(normalizedValue))
        || (BUILD_IDENTIFIER_FIELD_PATTERN.test(fieldName) && SAFE_BUILD_IDENTIFIER_PATTERN.test(normalizedValue))
    ) {
        return normalizedValue;
    }

    const isLocalPath = value.includes('\\')
        || /^[A-Z]:/i.test(value)
        || (value.startsWith('/') && !API_PATH_PREFIX_PATTERN.test(value));
    if (LOCAL_PATH_FIELD_PATTERN.test(fieldName) && !URL_FIELD_PATTERN.test(fieldName) && isLocalPath) {
        report.redactedPaths += 1;
        return '[local-path-redacted]';
    }

    if (PRIVATE_HOST_FIELD_PATTERN.test(fieldName) && !/^https?:\/\//i.test(value)) {
        report.redactedUrls += 1;
        return '[private-host]';
    }

    if (URL_FIELD_PATTERN.test(fieldName)) return sanitizeUrl(value, report);
    return sanitizeString(value, report, limits);
}

function sanitizeArray(
    value: unknown[],
    fieldName: string,
    report: PtvDebugSanitizationReport,
    limits: PtvDebugSanitizationLimits,
    seen: WeakSet<object>,
    depth: number
) {
    const entries = value.slice(0, limits.maxArrayLength).map(entry => (
        sanitizeValue(entry, report, limits, seen, depth + 1, fieldName)
    ));

    if (value.length > limits.maxArrayLength) {
        report.truncatedArrays += 1;
        entries.push(`[${value.length - limits.maxArrayLength} more entries truncated]`);
    }

    return entries;
}

function sanitizeRecord(
    value: object,
    report: PtvDebugSanitizationReport,
    limits: PtvDebugSanitizationLimits,
    seen: WeakSet<object>,
    depth: number
) {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    const keys = Object.keys(input);

    for (const key of keys.slice(0, limits.maxObjectKeys)) {
        if (OMITTED_SHAREABLE_FIELD_PATTERN.test(key)) {
            report.omittedFields += 1;
            continue;
        }

        const normalizedValue = key.toLowerCase() === 'signup' ? sanitizeSignup(input[key], report) : input[key];
        output[key] = sanitizeValue(normalizedValue, report, limits, seen, depth + 1, key);
    }

    if (keys.length > limits.maxObjectKeys) {
        report.truncatedObjects += 1;
        output.__truncatedKeys = keys.length - limits.maxObjectKeys;
    }

    return output;
}

function sanitizeValue(
    value: unknown,
    report: PtvDebugSanitizationReport,
    limits: PtvDebugSanitizationLimits,
    seen: WeakSet<object>,
    depth: number,
    fieldName = ''
): unknown {
    if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
        return value;
    }

    if (SECRET_FIELD_PATTERN.test(fieldName)) {
        report.redactedFields += 1;
        return '[redacted]';
    }

    if (IDENTIFIER_FIELD_PATTERN.test(fieldName)) {
        report.redactedIdentifiers += 1;
        return '[redacted-id]';
    }

    if (typeof value === 'string') return sanitizeStringField(value, fieldName, report, limits);

    if (typeof value !== 'object') return String(value);

    if (depth >= limits.maxDepth) {
        report.truncatedDepth += 1;
        return '[maximum-depth-reached]';
    }

    if (seen.has(value)) return '[circular-reference]';
    seen.add(value);

    if (Array.isArray(value)) return sanitizeArray(value, fieldName, report, limits, seen, depth);
    return sanitizeRecord(value, report, limits, seen, depth);
}

export function sanitizePtvDebugExport(
    value: unknown,
    limitOverrides: Partial<PtvDebugSanitizationLimits> = {}
) {
    const report = createReport();
    const limits = {
        ...DEFAULT_LIMITS,
        ...limitOverrides
    };
    const sanitized = sanitizeValue(value, report, limits, new WeakSet<object>(), 0);
    const result = sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized) ? {
        ...(sanitized as Record<string, unknown>),
        sanitization: {
            limits,
            ...report
        }
    } : {
        data: sanitized,
        sanitization: {
            limits,
            ...report
        }
    };

    return result;
}

export function serializeSanitizedPtvDebugExport(value: unknown) {
    return JSON.stringify(sanitizePtvDebugExport(value), null, 2);
}
