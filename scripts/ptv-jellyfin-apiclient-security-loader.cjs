'use strict';

const IDENTIFIER = '[A-Za-z_$][\\w$]*';
const SECURITY_REPLACEMENTS = Object.freeze([
    {
        expected: 1,
        id: 'stored-credentials',
        pattern: new RegExp(`console\\.log\\("Stored JSON credentials: "\\.concat\\(${IDENTIFIER}\\)\\)`, 'g'),
        replacement: 'console.debug("Stored Jellyfin credentials restored: [REDACTED]")'
    },
    {
        expected: 1,
        id: 'websocket-url',
        pattern: new RegExp(`console\\.log\\("opening web socket with url: "\\.concat\\(${IDENTIFIER}\\)\\)`, 'g'),
        replacement: 'console.debug("Opening Jellyfin web socket")'
    },
    {
        expected: 1,
        id: 'websocket-keepalive-object',
        pattern: new RegExp(`console\\.debug\\("Clearing KeepAlive for",${IDENTIFIER}\\._webSocket\\)`, 'g'),
        replacement: 'console.debug("Clearing Jellyfin web socket keepalive")'
    },
    {
        expected: 1,
        id: 'request-url',
        pattern: new RegExp(`console\\.log\\("Requesting "\\.concat\\(${IDENTIFIER}\\.url\\)\\)`, 'g'),
        replacement: 'console.debug("Jellyfin API request started")'
    },
    {
        expected: 1,
        id: 'request-failure-url',
        pattern: new RegExp(`console\\.log\\("Request failed to "\\.concat\\(${IDENTIFIER}\\.url," "\\)\\.concat\\(${IDENTIFIER}\\.toString\\(\\)\\)\\)`, 'g'),
        replacement: 'console.warn("Jellyfin API request failed")'
    },
    {
        expected: 1,
        id: 'request-timeout-url',
        pattern: new RegExp(`console\\.log\\("Request timed out to "\\.concat\\(${IDENTIFIER}\\.url\\)\\)`, 'g'),
        replacement: 'console.warn("Jellyfin API request timed out")'
    },
    {
        expected: 1,
        id: 'automatic-networking-url',
        pattern: new RegExp(`console\\.log\\("Requesting url without automatic networking: "\\.concat\\(${IDENTIFIER}\\.url\\)\\)`, 'g'),
        replacement: 'console.debug("Jellyfin API request started without automatic networking")'
    },
    {
        expected: 1,
        id: 'bitrate-test-url',
        pattern: new RegExp(`console\\.log\\("Requesting "\\.concat\\(${IDENTIFIER}\\)\\)`, 'g'),
        replacement: 'console.debug("Jellyfin bitrate test request started")'
    },
    {
        expected: 1,
        id: 'connection-manager-request-url',
        pattern: new RegExp(`console\\.log\\("ConnectionManager requesting url: "\\.concat\\(${IDENTIFIER}\\.url\\)\\)`, 'g'),
        replacement: 'console.debug("ConnectionManager request started")'
    },
    {
        expected: 1,
        id: 'connection-manager-response-url',
        pattern: new RegExp(`console\\.log\\("ConnectionManager response status: "\\.concat\\((${IDENTIFIER})\\.status,", url: "\\)\\.concat\\(${IDENTIFIER}\\.url\\)\\)`, 'g'),
        replacement: 'console.debug("ConnectionManager response status: ".concat($1.status))'
    },
    {
        expected: 1,
        id: 'connection-manager-failure-url',
        pattern: new RegExp(`console\\.log\\("ConnectionManager request failed to url: "\\.concat\\(${IDENTIFIER}\\.url\\)\\)`, 'g'),
        replacement: 'console.warn("ConnectionManager request failed")'
    },
    {
        expected: 1,
        id: 'connection-timeout-url',
        pattern: new RegExp(`console\\.log\\("fetchWithTimeout: timeoutMs: "\\.concat\\((${IDENTIFIER}),", url: "\\)\\.concat\\(${IDENTIFIER}\\)\\)`, 'g'),
        replacement: 'console.debug("fetchWithTimeout: timeoutMs: ".concat($1))'
    },
    {
        expected: 1,
        id: 'connection-success-url',
        pattern: new RegExp(`console\\.log\\("fetchWithTimeout: succeeded connecting to url: "\\.concat\\(${IDENTIFIER}\\)\\)`, 'g'),
        replacement: 'console.debug("fetchWithTimeout: connection succeeded")'
    },
    {
        expected: 1,
        id: 'connection-failure-timeout-url',
        pattern: new RegExp(`console\\.log\\("fetchWithTimeout: timed out connecting to url: "\\.concat\\(${IDENTIFIER}\\)\\)`, 'g'),
        replacement: 'console.warn("fetchWithTimeout: connection timed out")'
    },
    {
        expected: 1,
        id: 'websocket-error-object',
        pattern: new RegExp(`console\\.log\\("Error opening web socket: "\\.concat\\(${IDENTIFIER}\\)\\)`, 'g'),
        replacement: 'console.warn("Error opening Jellyfin web socket")'
    },
    {
        expected: 1,
        id: 'server-info-error-object',
        pattern: new RegExp(`throw new Error\\("serverUrl cannot be null\\. serverInfo: "\\.concat\\(JSON\\.stringify\\(${IDENTIFIER}\\)\\)\\)`, 'g'),
        replacement: 'throw new Error("serverUrl cannot be null.")'
    }
]);

function getMatchCount(source, pattern) {
    pattern.lastIndex = 0;
    const matches = source.match(pattern);
    pattern.lastIndex = 0;

    return matches?.length || 0;
}

function transformJellyfinApiClientSource(source) {
    let transformed = String(source);

    SECURITY_REPLACEMENTS.forEach(({ expected, id, pattern, replacement }) => {
        const matchCount = getMatchCount(transformed, pattern);

        if (matchCount !== expected) {
            throw new Error(
                `PiggieTV security patch ${id} expected ${expected} jellyfin-apiclient match(es), found ${matchCount}. `
                + 'Review the upstream client before building.'
            );
        }

        transformed = transformed.replace(pattern, replacement);
    });

    return transformed;
}

function ptvJellyfinApiClientSecurityLoader(source) {
    this.cacheable?.();

    return transformJellyfinApiClientSource(source);
}

module.exports = ptvJellyfinApiClientSecurityLoader;
module.exports.SECURITY_REPLACEMENTS = SECURITY_REPLACEMENTS;
module.exports.transformJellyfinApiClientSource = transformJellyfinApiClientSource;
