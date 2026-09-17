'use strict';

const crypto = require('node:crypto');

const PRIVATE_VALUE_PATTERN = /(?:https?:\/\/|wss?:\/\/|\b(?:10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\b192\.168\.\d{1,3}\.\d{1,3}\b|\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b|[A-Za-z]:\\)/i;
const SENSITIVE_KEY_PATTERN = /(?:password|credential|authorization|cookie|token|serverAddress|rawUrl|queryValue|mediaTitle|userId|itemId|providerId)/i;

const percentile = (values, fraction) => {
    const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
    if (!sorted.length) return null;
    return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
};

const classifyRequest = (rawUrl) => {
    try {
        const url = new URL(rawUrl);
        const path = url.pathname.toLowerCase();

        if (/\.(?:css|gif|jpe?g|js|json|png|svg|wasm|webp|woff2?)$/.test(path)) return 'asset';
        if (path.includes('/search/hints') || url.searchParams.has('SearchTerm')) return 'search';
        if (path.startsWith('/ptv/v1/')) return 'plugin';
        if (path.includes('/items')) {
            const types = url.searchParams.get('IncludeItemTypes')?.toLowerCase() || '';
            return types.includes('boxset') ? 'jellyfin-collections' : 'jellyfin-items';
        }
        if (path.includes('/useritems/resume')) return 'personalized';
        return 'other-api';
    } catch {
        return 'unknown';
    }
};

const exactRequestKey = (method, rawUrl) => {
    const url = new URL(rawUrl);
    const params = [...url.searchParams.entries()]
        .filter(([key]) => !/(?:api.?key|authorization|token)/i.test(key))
        .sort(([leftKey, leftValue], [rightKey, rightValue]) => (
            leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
        ));
    const canonical = `${method.toUpperCase()} ${url.origin}${url.pathname}?${params.map(([key, value]) => `${key}=${value}`).join('&')}`;
    return crypto.createHash('sha256').update(canonical).digest('hex');
};

const createOneShotFailureGate = (targetCategory = 'jellyfin-collections') => {
    let consumed = false;
    let attempts = 0;

    return {
        tryConsume(category) {
            attempts += 1;
            if (consumed || category !== targetCategory) return false;
            consumed = true;
            return true;
        },
        summary() {
            return { attempts, consumed, targetCategory };
        }
    };
};

const safeErrorCategory = (error) => {
    const message = String(error?.message || error || '').toLowerCase();
    if (message.includes('timeout')) return 'timeout';
    if (message.includes('abort') || message.includes('cancel')) return 'cancelled';
    if (message.includes('network') || message.includes('connection')) return 'network';
    if (message.includes('locator') || message.includes('selector')) return 'ui-boundary';
    return 'unknown';
};

const summarizeRequestRecords = (records) => {
    const groups = new Map();
    const byCategory = {};

    for (const record of records) {
        const category = record.category || 'unknown';
        const bucket = byCategory[category] ||= { count: 0, failures: 0, durations: [] };
        bucket.count += 1;
        if (record.failed || Number(record.status) >= 400) bucket.failures += 1;
        if (Number.isFinite(record.durationMs)) bucket.durations.push(record.durationMs);

        const group = groups.get(record.keyHash) || [];
        group.push(record);
        groups.set(record.keyHash, group);
    }

    let exactConcurrentDuplicates = 0;
    let failedRequestHandoffs = 0;
    for (const group of groups.values()) {
        group.sort((left, right) => left.startMs - right.startMs);
        for (let index = 1; index < group.length; index += 1) {
            const previous = group[index - 1];
            const current = group[index];
            const overlap = previous.startMs + previous.durationMs - current.startMs;
            if (overlap <= 0) continue;
            if (overlap <= 25 && (previous.failed || Number(previous.status) >= 400)) {
                failedRequestHandoffs += 1;
            } else {
                exactConcurrentDuplicates += 1;
            }
        }
    }

    for (const bucket of Object.values(byCategory)) {
        bucket.p50Ms = percentile(bucket.durations, 0.5);
        bucket.p95Ms = percentile(bucket.durations, 0.95);
        delete bucket.durations;
    }

    return {
        requestCount: records.length,
        exactConcurrentDuplicates,
        failedRequestHandoffs,
        byCategory
    };
};

const assertShareSafeEvidence = (value, path = 'evidence') => {
    if (Array.isArray(value)) {
        value.forEach((entry, index) => assertShareSafeEvidence(entry, `${path}[${index}]`));
        return value;
    }

    if (value && typeof value === 'object') {
        for (const [key, entry] of Object.entries(value)) {
            if (SENSITIVE_KEY_PATTERN.test(key)) throw new Error(`Sensitive evidence key rejected at ${path}.${key}`);
            assertShareSafeEvidence(entry, `${path}.${key}`);
        }
        return value;
    }

    if (typeof value === 'string' && PRIVATE_VALUE_PATTERN.test(value)) {
        throw new Error(`Private evidence value rejected at ${path}`);
    }
    return value;
};

module.exports = {
    assertShareSafeEvidence,
    classifyRequest,
    createOneShotFailureGate,
    exactRequestKey,
    percentile,
    safeErrorCategory,
    summarizeRequestRecords
};
