/* eslint-disable compat/compat, sonarjs/cognitive-complexity, no-restricted-globals, no-nested-ternary, sonarjs/no-nested-conditional, @stylistic/operator-linebreak, sonarjs/no-nested-functions -- This authenticated evidence harness runs only in the current Node/Chrome toolchain. */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DEFAULT_CDP_URL = 'http://127.0.0.1:9223';
const DEFAULT_TIMEOUT_MS = 30_000;

const parseArgs = () => Object.fromEntries(process.argv.slice(2).map((arg) => {
    const value = arg.startsWith('--') ? arg.slice(2) : arg;
    const separator = value.indexOf('=');
    return separator === -1 ? [value, true] : [value.slice(0, separator), value.slice(separator + 1)];
}));

const args = parseArgs();
const mode = String(args.mode || 'quick');
const timeoutMs = Number(args['timeout-ms'] || DEFAULT_TIMEOUT_MS);
const iterations = Number(args.iterations || (mode === 'full' ? 5 : 2));
const idleMs = Number(args['idle-ms'] || (mode === 'full' ? 30_000 : 0));
const repeat5Ms = Number(args['repeat-5-ms'] || (mode === 'full' ? 5_000 : 0));
const repeat30Ms = Number(args['repeat-30-ms'] || (mode === 'full' ? 30_000 : 0));
const requestedPaths = String(args.paths || (mode === 'full' ? 'shared,browser,direct,api-client' : 'shared,browser,direct'))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

const sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration));
const percentile = (values, fraction) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
};
const round = (value) => Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
const standardDeviation = (values) => {
    if (!values.length) return null;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return Math.sqrt(values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length);
};
const cardFields = [
    'PrimaryImageAspectRatio',
    'ProductionYear',
    'DateCreated'
].join(',');

const readingFields = [
    'PrimaryImageAspectRatio',
    'DateCreated',
    'ProductionYear',
    'SeriesName',
    'IndexNumber',
    'ParentIndexNumber',
    'ProviderIds',
    'Path',
    'Genres',
    'Tags'
].join(',');

const cases = {
    minimal: {
        endpoint: (userId) => `Users/${userId}/Items`,
        family: 'Users/{user}/Items',
        params: {
            Limit: '1',
            Recursive: 'true',
            IncludeItemTypes: 'Movie'
        }
    },
    minimal_no_total: {
        endpoint: (userId) => `Users/${userId}/Items`,
        family: 'Users/{user}/Items',
        params: {
            Limit: '1',
            Recursive: 'true',
            IncludeItemTypes: 'Movie',
            EnableTotalRecordCount: 'false'
        }
    },
    minimal_no_user_data: {
        endpoint: (userId) => `Users/${userId}/Items`,
        family: 'Users/{user}/Items',
        params: {
            Limit: '1',
            Recursive: 'true',
            IncludeItemTypes: 'Movie',
            EnableUserData: 'false'
        }
    },
    movie_card: {
        endpoint: (userId) => `Users/${userId}/Items`,
        family: 'Users/{user}/Items',
        params: {
            Limit: '20',
            Recursive: 'true',
            IncludeItemTypes: 'Movie',
            Fields: cardFields,
            ImageTypeLimit: '1',
            EnableImageTypes: 'Primary,Backdrop,Thumb',
            EnableUserData: 'true',
            EnableTotalRecordCount: 'false'
        }
    },
    movie_browse: {
        endpoint: (userId) => `Users/${userId}/Items`,
        family: 'Users/{user}/Items',
        params: {
            Limit: '50',
            StartIndex: '0',
            Recursive: 'true',
            IncludeItemTypes: 'Movie',
            SortBy: 'DateCreated',
            SortOrder: 'Descending',
            Fields: cardFields,
            ImageTypeLimit: '1',
            EnableImageTypes: 'Primary,Backdrop,Thumb',
            EnableUserData: 'true',
            EnableTotalRecordCount: 'true'
        }
    },
    search: {
        endpoint: (userId) => `Users/${userId}/Items`,
        family: 'Users/{user}/Items',
        params: {
            Limit: '14',
            Recursive: 'true',
            IncludeItemTypes: 'Movie',
            SearchTerm: process.env.PTV_PROFILE_SEARCH_TERM || 'Toy Story',
            Fields: cardFields,
            ImageTypeLimit: '1',
            EnableImageTypes: 'Primary,Thumb',
            EnableUserData: 'true',
            EnableTotalRecordCount: 'false'
        }
    },
    music_artists: {
        endpoint: (userId) => `Users/${userId}/Items`,
        family: 'Users/{user}/Items',
        params: {
            Limit: '50',
            Recursive: 'true',
            IncludeItemTypes: 'MusicArtist',
            SortBy: 'SortName',
            SortOrder: 'Ascending',
            Fields: 'PrimaryImageAspectRatio',
            ImageTypeLimit: '1',
            EnableImageTypes: 'Primary',
            EnableUserData: 'true',
            EnableTotalRecordCount: 'false'
        }
    },
    reading: {
        endpoint: (userId) => `Users/${userId}/Items`,
        family: 'Users/{user}/Items',
        params: {
            Limit: '50',
            Recursive: 'true',
            IncludeItemTypes: 'Book',
            SortBy: 'SortName',
            SortOrder: 'Ascending',
            Fields: readingFields,
            ImageTypeLimit: '1',
            EnableImageTypes: 'Primary,Thumb',
            EnableUserData: 'true',
            EnableTotalRecordCount: 'true'
        }
    },
    resume: {
        endpoint: (userId) => `Users/${userId}/Items/Resume`,
        family: 'Users/{user}/Items/Resume',
        params: {
            Limit: '20',
            MediaTypes: 'Video',
            Fields: cardFields,
            ImageTypeLimit: '1',
            EnableImageTypes: 'Primary,Backdrop,Thumb',
            EnableUserData: 'true'
        }
    },
    views: {
        endpoint: (userId) => `Users/${userId}/Views`,
        family: 'Users/{user}/Views',
        params: {}
    }
};

const fullCaseNames = ['minimal', 'movie_card', 'movie_browse', 'search', 'music_artists', 'reading', 'resume', 'views'];
const quickCaseNames = ['minimal', 'minimal_no_total', 'minimal_no_user_data'];
const selectedCaseNames = String(args.cases || (mode === 'full' ? fullCaseNames.join(',') : quickCaseNames.join(',')))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

for (const caseName of selectedCaseNames) {
    if (!cases[caseName]) throw new Error(`Unknown benchmark case: ${caseName}`);
}
for (const pathName of requestedPaths) {
    if (!['shared', 'browser', 'direct', 'api-client'].includes(pathName)) throw new Error(`Unknown request path: ${pathName}`);
}

const parsePayload = (buffer) => {
    let payload = null;
    try {
        payload = JSON.parse(Buffer.from(buffer).toString('utf8'));
    } catch {
        return { returnedItemCount: null, totalRecordCount: null };
    }
    if (Array.isArray(payload)) {
        return { returnedItemCount: payload.length, totalRecordCount: null };
    }
    return {
        returnedItemCount: Array.isArray(payload?.Items) ? payload.Items.length : null,
        totalRecordCount: Number.isFinite(payload?.TotalRecordCount) ? payload.TotalRecordCount : null
    };
};

const outputPath = path.resolve(args.output || path.join(
    'test-results',
    'authenticated-discovery',
    `items-latency-profile-${mode}.json`
));

let activeRequests = 0;
const timeline = [];

const run = async () => {
    const browser = await chromium.connectOverCDP(String(args.cdp || DEFAULT_CDP_URL));
    const pages = browser.contexts().flatMap((context) => context.pages());
    const page = pages.find((candidate) => candidate.url().startsWith('http://localhost:8082/')) || pages[0];
    if (!page) throw new Error('No browser page is available through CDP');

    const runtime = await page.evaluate(() => {
        const api = globalThis.ApiClient;
        return {
            authenticated: Boolean(api?.isLoggedIn?.()),
            userId: api?.getCurrentUserId?.() || null,
            token: api?.accessToken?.() || null,
            route: location.hash,
            frontendOrigin: location.origin
        };
    });
    if (!runtime.authenticated || !runtime.userId || !runtime.token) {
        throw new Error('The shared browser is not authenticated');
    }

    const makeTarget = async (definition) => page.evaluate(({ endpoint, params }) => {
        return globalThis.ApiClient.getUrl(endpoint, params);
    }, {
        endpoint: definition.endpoint(runtime.userId),
        params: definition.params
    });

    const executeBrowser = async (targetUrl) => page.evaluate(async ({ url, token, timeout }) => {
        const entriesBefore = performance.getEntriesByName(url).length;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        const started = performance.now();
        let firstByte = null;
        try {
            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    Accept: 'application/json',
                    'X-Emby-Token': token
                }
            });
            firstByte = performance.now();
            const buffer = await response.arrayBuffer();
            const completed = performance.now();
            const entries = performance.getEntriesByName(url);
            const resource = entries.length > entriesBefore ? entries[entries.length - 1] : null;
            let payload = null;
            try {
                payload = JSON.parse(new TextDecoder().decode(buffer));
            } catch {
                payload = null;
            }
            return {
                status: response.status,
                responseSize: buffer.byteLength,
                returnedItemCount: Array.isArray(payload) ? payload.length : (Array.isArray(payload?.Items) ? payload.Items.length : null),
                totalRecordCount: Number.isFinite(payload?.TotalRecordCount) ? payload.TotalRecordCount : null,
                firstByteMs: firstByte - started,
                completionMs: completed - started,
                connectionMs: resource && resource.connectEnd > resource.connectStart ? resource.connectEnd - resource.connectStart : null,
                dnsMs: resource && resource.domainLookupEnd > resource.domainLookupStart ? resource.domainLookupEnd - resource.domainLookupStart : null,
                transferMs: resource && resource.responseEnd > resource.responseStart ? resource.responseEnd - resource.responseStart : null,
                cacheEvidence: resource ? {
                    transferSize: resource.transferSize,
                    encodedBodySize: resource.encodedBodySize,
                    decodedBodySize: resource.decodedBodySize,
                    likelyCached: resource.transferSize === 0 && resource.decodedBodySize > 0
                } : null,
                connectionReused: resource ? resource.connectStart === resource.connectEnd : null
            };
        } catch (error) {
            return {
                error: error.name,
                firstByteMs: firstByte == null ? null : firstByte - started,
                completionMs: performance.now() - started
            };
        } finally {
            clearTimeout(timer);
        }
    }, { url: targetUrl, token: runtime.token, timeout: timeoutMs });

    const executeDirect = async (targetUrl) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const started = performance.now();
        let firstByte = null;
        try {
            const response = await fetch(targetUrl, {
                signal: controller.signal,
                headers: {
                    Accept: 'application/json',
                    'X-Emby-Token': runtime.token
                }
            });
            firstByte = performance.now();
            const buffer = await response.arrayBuffer();
            const completed = performance.now();
            return {
                status: response.status,
                responseSize: buffer.byteLength,
                ...parsePayload(buffer),
                firstByteMs: firstByte - started,
                completionMs: completed - started,
                connectionMs: null,
                dnsMs: null,
                transferMs: completed - firstByte,
                cacheEvidence: null,
                connectionReused: null
            };
        } catch (error) {
            return {
                error: error.name,
                firstByteMs: firstByte == null ? null : firstByte - started,
                completionMs: performance.now() - started
            };
        } finally {
            clearTimeout(timer);
        }
    };

    const executeApiClient = async (targetUrl) => page.evaluate(async ({ url, timeout }) => {
        const started = performance.now();
        let timer;
        try {
            const payload = await Promise.race([
                globalThis.ApiClient.getJSON(url),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(Object.assign(new Error('Timed out'), { name: 'TimeoutError' })), timeout);
                })
            ]);
            const completed = performance.now();
            const serialized = JSON.stringify(payload);
            return {
                status: 200,
                responseSize: new TextEncoder().encode(serialized).byteLength,
                returnedItemCount: Array.isArray(payload) ? payload.length : (Array.isArray(payload?.Items) ? payload.Items.length : null),
                totalRecordCount: Number.isFinite(payload?.TotalRecordCount) ? payload.TotalRecordCount : null,
                firstByteMs: null,
                completionMs: completed - started,
                connectionMs: null,
                dnsMs: null,
                transferMs: null,
                cacheEvidence: null,
                connectionReused: null
            };
        } catch (error) {
            return { error: error.name, firstByteMs: null, completionMs: performance.now() - started };
        } finally {
            if (timer) clearTimeout(timer);
        }
    }, { url: targetUrl, timeout: timeoutMs });

    const executeShared = async (definition, targetUrl) => page.evaluate(async ({
        endpoint,
        params,
        timeout,
        url
    }) => {
        const entriesBefore = performance.getEntriesByName(url).length;
        const started = performance.now();
        let timer;

        try {
            const payload = await Promise.race([
                window.PTV.api.requestJson(endpoint, { params }),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(Object.assign(new Error('Timed out'), {
                        name: 'TimeoutError'
                    })), timeout);
                })
            ]);
            const completed = performance.now();
            const serialized = JSON.stringify(payload);
            const entries = performance.getEntriesByName(url);
            const resource = entries.length > entriesBefore ? entries[entries.length - 1] : null;

            return {
                status: 200,
                responseSize: new TextEncoder().encode(serialized).byteLength,
                returnedItemCount: Array.isArray(payload) ? payload.length : (Array.isArray(payload?.Items) ? payload.Items.length : null),
                totalRecordCount: Number.isFinite(payload?.TotalRecordCount) ? payload.TotalRecordCount : null,
                firstByteMs: resource?.responseStart ? resource.responseStart - started : null,
                completionMs: completed - started,
                connectionMs: resource && resource.connectEnd > resource.connectStart ? resource.connectEnd - resource.connectStart : null,
                dnsMs: resource && resource.domainLookupEnd > resource.domainLookupStart ? resource.domainLookupEnd - resource.domainLookupStart : null,
                transferMs: resource && resource.responseEnd > resource.responseStart ? resource.responseEnd - resource.responseStart : null,
                cacheEvidence: resource ? {
                    transferSize: resource.transferSize,
                    encodedBodySize: resource.encodedBodySize,
                    decodedBodySize: resource.decodedBodySize,
                    likelyCached: resource.transferSize === 0 && resource.decodedBodySize > 0
                } : null,
                connectionReused: resource ? resource.connectStart === resource.connectEnd : null,
                sharedWithoutNewTransport: !resource
            };
        } catch (error) {
            return {
                error: error.name,
                firstByteMs: null,
                completionMs: performance.now() - started
            };
        } finally {
            if (timer) clearTimeout(timer);
        }
    }, {
        endpoint: definition.endpoint(runtime.userId),
        params: definition.params,
        timeout: timeoutMs,
        url: targetUrl
    });

    const execute = async (caseName, pathName, classification, batchName) => {
        const definition = cases[caseName];
        const targetUrl = await makeTarget(definition);
        activeRequests += 1;
        const concurrencyAtStart = activeRequests;
        const requestStart = new Date().toISOString();
        try {
            const measurement = pathName === 'shared'
                ? await executeShared(definition, targetUrl)
                : pathName === 'browser'
                    ? await executeBrowser(targetUrl)
                    : pathName === 'direct'
                        ? await executeDirect(targetUrl)
                        : await executeApiClient(targetUrl);
            timeline.push({
                case: caseName,
                requestPath: pathName,
                requestStart,
                coldWarm: classification,
                batch: batchName,
                concurrentRequestCountAtStart: concurrencyAtStart,
                requestReused: false,
                deduplicated: false,
                connectionMs: round(measurement.connectionMs),
                connectionReused: measurement.connectionReused ?? null,
                dnsMs: round(measurement.dnsMs),
                errorCode: measurement.error || null,
                method: 'GET',
                responseByteSize: round(measurement.responseSize),
                responseTransferDurationMs: round(measurement.transferMs),
                sharedWithoutNewTransport: measurement.sharedWithoutNewTransport ?? false,
                status: measurement.status || null,
                success: Boolean(measurement.status >= 200 && measurement.status < 400),
                timeToHeadersMs: round(measurement.firstByteMs),
                totalDurationMs: round(measurement.completionMs)
            });
        } finally {
            activeRequests -= 1;
        }
    };

    const serialLabels = mode === 'full'
        ? ['first-after-idle', 'immediate-repeat', 'repeat-after-5s', 'repeat-after-30s', 'fifth-repeat']
        : Array.from({ length: iterations }, (_, index) => index === 0 ? 'first' : `repeat-${index + 1}`);

    for (const caseName of selectedCaseNames) {
        for (const pathName of requestedPaths) {
            for (let index = 0; index < serialLabels.length; index += 1) {
                if (index === 0 && idleMs > 0) await sleep(idleMs);
                if (index === 2 && repeat5Ms > 0) await sleep(repeat5Ms);
                if (index === 3 && repeat30Ms > 0) await sleep(repeat30Ms);
                await execute(caseName, pathName, index === 0 ? 'cold' : 'warm', serialLabels[index]);
            }
            if (mode === 'full') {
                await Promise.all(Array.from({ length: 2 }, () => execute(caseName, pathName, 'concurrent', 'concurrency-2')));
                await Promise.all(Array.from({ length: 4 }, () => execute(caseName, pathName, 'concurrent', 'concurrency-4')));
            }
        }
    }

    if (mode === 'full') {
        const startupCases = ['movie_card', 'resume', 'views', 'music_artists'].filter((caseName) => selectedCaseNames.includes(caseName));
        for (const pathName of requestedPaths) {
            await Promise.all(startupCases.map((caseName) => execute(caseName, pathName, 'startup', 'realistic-page-startup')));
        }
    }

    const grouped = new Map();
    for (const measurement of timeline) {
        const key = `${measurement.case}:${measurement.requestPath}`;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(measurement);
    }
    const statistics = [...grouped.entries()].map(([key, measurements]) => {
        const durations = measurements.filter((item) => item.success).map((item) => item.totalDurationMs);
        return {
            key,
            case: measurements[0].case,
            requestPath: measurements[0].requestPath,
            minimumMs: durations.length ? round(Math.min(...durations)) : null,
            medianMs: round(percentile(durations, 0.5)),
            p75Ms: round(percentile(durations, 0.75)),
            p95Ms: round(percentile(durations, 0.95)),
            maximumMs: durations.length ? round(Math.max(...durations)) : null,
            standardDeviationMs: round(standardDeviation(durations)),
            responseCount: durations.length,
            timeoutCount: measurements.filter((item) => item.errorCode === 'AbortError' || item.errorCode === 'TimeoutError').length,
            errorCount: measurements.filter((item) => item.errorCode && item.errorCode !== 'AbortError' && item.errorCode !== 'TimeoutError').length
        };
    });

    const report = {
        generatedAt: new Date().toISOString(),
        environment: {
            authenticated: true,
            accountAlias: 'dedicated-non-admin',
            frontendOriginAlias: 'local-development-frontend',
            backendAlias: 'configured-jellyfin-api',
            browser: 'desktop Chrome via CDP',
            physicalDevice: false,
            mode,
            timeoutMs,
            idleMs,
            requestPaths: requestedPaths,
            selectedCases: selectedCaseNames
        },
        statistics,
        timeline
    };

    const serialized = `${JSON.stringify(report, null, 2)}\n`;
    for (const secret of [runtime.token, runtime.userId, runtime.frontendOrigin, new URL(await makeTarget(cases.minimal)).origin]) {
        if (secret && serialized.includes(secret)) throw new Error('Refusing to persist private runtime data');
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');

    process.stdout.write(`${JSON.stringify({
        output: outputPath,
        measurements: timeline.length,
        successful: timeline.filter((item) => item.success).length,
        timeouts: timeline.filter((item) => item.errorCode === 'AbortError' || item.errorCode === 'TimeoutError').length,
        statistics
    }, null, 2)}\n`);
    process.exit(0);
};

run().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
});

/* eslint-enable compat/compat, sonarjs/cognitive-complexity, no-restricted-globals, no-nested-ternary, sonarjs/no-nested-conditional, @stylistic/operator-linebreak, sonarjs/no-nested-functions */
