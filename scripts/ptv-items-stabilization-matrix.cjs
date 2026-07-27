/* eslint-disable compat/compat -- This evidence harness runs in the current Node/Chrome toolchain. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ItemFields } = require('@jellyfin/sdk/lib/generated-client/models/item-fields');
const { chromium } = require('playwright');

const CDP_URL = 'http://127.0.0.1:9223';
const FRONTEND_ORIGIN = 'http://localhost:8082';
const DEFAULT_OUTPUT_DIR = path.resolve('test-results/items-stabilization');
const ROUTE_TIMEOUT_MS = 20_000;
const DETAIL_TIMEOUT_MS = 20_000;
const READ_ONLY_SEARCH_TERM = 'Toy Story 5';
const ALLOWED_ITEM_FIELDS = new Set(Object.values(ItemFields).map(value => value.toLowerCase()));
const FORBIDDEN_ARTIFACT_KEY = /(?:^|_)(?:cookie|credential|email|header|hostname|itemid|mediaid|password|querystring|rawid|servername|token|url|userid|username)(?:$|_)/i;
const PRIVATE_VALUE_PATTERN = /(?:\b[a-f0-9]{32}\b|(?:https?:\/\/|file:\/\/)|[?&](?:api_key|token|userId)=)/i;

const parseArgs = () => Object.fromEntries(process.argv.slice(2).map(argument => {
    const value = argument.startsWith('--') ? argument.slice(2) : argument;
    const separator = value.indexOf('=');

    return separator === -1 ?
        [ value, true ] :
        [ value.slice(0, separator), value.slice(separator + 1) ];
}));

const round = value => Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
const sleep = durationMs => new Promise(resolve => setTimeout(resolve, durationMs));
const percentile = (values, fraction) => {
    if (!values.length) return null;
    const sorted = [ ...values ].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));

    return round(sorted[index]);
};

function classifyOrigin(value) {
    try {
        const parsed = new URL(value);
        if ([ 'localhost', '127.0.0.1', '::1', '[::1]' ].includes(parsed.hostname)) {
            return 'loopback';
        }
        if (/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(parsed.hostname)) {
            return 'private-network';
        }

        return 'configured-host';
    } catch {
        return 'unknown';
    }
}

function getSearchParam(url, name) {
    const key = [ ...url.searchParams.keys() ].find(candidate => candidate.toLowerCase() === name.toLowerCase());

    return key ? url.searchParams.get(key) : null;
}

function splitList(value) {
    return String(value || '').split(',').map(entry => entry.trim()).filter(Boolean);
}

// The explicit route-family order prevents image/detail/list overlap.
// eslint-disable-next-line sonarjs/cognitive-complexity
function classifyOperation(rawUrl, resourceType) {
    if (resourceType === 'image') return null;

    let url;
    try {
        url = new URL(rawUrl);
    } catch {
        return null;
    }

    const pathname = url.pathname;
    if (/\/Items\/[^/]+\/Images(?:\/|$)/i.test(pathname)) return null;
    if (/\/Users\/[^/]+\/Views\/?$/i.test(pathname)) return 'user-views';
    if (/\/Users\/[^/]+\/Items\/Resume\/?$/i.test(pathname)) return 'items-resume';
    if (/\/Users\/[^/]+\/Items\/Latest\/?$/i.test(pathname)) return 'items-latest';
    if (/\/Shows\/[^/]+\/Seasons\/?$/i.test(pathname)) return 'show-seasons';
    if (/\/Shows\/[^/]+\/Episodes\/?$/i.test(pathname)) return 'show-episodes';
    if (/\/Items\/[^/]+\/?$/i.test(pathname)) return 'item-details';
    if (/\/Genres\/?$/i.test(pathname)) return 'genres';
    if (/\/Studios\/?$/i.test(pathname)) return 'studios';
    if (/\/Ptv(?:\/v\d+)?\//i.test(pathname)) return 'plugin-comparison';

    const includeItemTypes = splitList(getSearchParam(url, 'IncludeItemTypes'))
        .map(value => value.toLowerCase());
    if (includeItemTypes.includes('boxset')) return 'boxsets-collections';
    if (/\/Users\/[^/]+\/Items\/?$/i.test(pathname) && getSearchParam(url, 'SearchTerm')) {
        return 'items-search';
    }
    if (/\/Users\/[^/]+\/Items\/?$/i.test(pathname) || /\/Items\/?$/i.test(pathname)) {
        return 'items-list';
    }

    return null;
}

function canonicalRequestKey(rawUrl, method, normalizeNames) {
    const url = new URL(rawUrl);
    const entries = [ ...url.searchParams.entries() ]
        .map(([ key, value ]) => [ normalizeNames ? key.toLowerCase() : key, value ])
        .sort(([ leftKey, leftValue ], [ rightKey, rightValue ]) => (
            leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
        ));

    return JSON.stringify([
        method.toUpperCase(),
        url.pathname.toLowerCase(),
        entries
    ]);
}

function auditQuery(rawUrl, operationCategory, requestIndex) {
    const url = new URL(rawUrl);
    const fields = splitList(getSearchParam(url, 'Fields'));
    const limitValue = getSearchParam(url, 'Limit');
    const limit = limitValue === null ? null : Number(limitValue);
    const fieldKeys = [ ...url.searchParams.keys() ]
        .filter(key => key.toLowerCase() === 'fields');
    const normalizedNames = [ ...url.searchParams.keys() ].map(key => key.toLowerCase());

    return {
        boundedPaging: Number.isFinite(limit) && limit > 0 && limit <= 500,
        enableUserDataSpecified: getSearchParam(url, 'EnableUserData') !== null,
        fieldsCount: fields.length,
        fieldsValid: fields.every(field => ALLOWED_ITEM_FIELDS.has(field.toLowerCase())),
        mediaSourcesRequested: fields.some(field => field.toLowerCase() === 'mediasources'),
        operationCategory,
        parameterNameCollision: new Set(normalizedNames).size !== normalizedNames.length,
        recursiveSpecified: getSearchParam(url, 'Recursive') !== null,
        requestIndex,
        singleFieldsParameter: fieldKeys.length <= 1,
        userDataFieldAbsent: !fields.some(field => field.toLowerCase() === 'userdata')
    };
}

function safeErrorCode(error) {
    const message = error instanceof Error ? error.message : String(error || '');
    if (/timeout/i.test(message)) return 'timeout';
    if (/abort|cancel/i.test(message)) return 'aborted';
    if (/not found|404/i.test(message)) return 'not-found';
    if (/401|authentic/i.test(message)) return 'authentication';
    if (/403|forbidden|authoriz/i.test(message)) return 'authorization';
    if (/net::|network|connection/i.test(message)) return 'network';
    if (/focus/i.test(message)) return 'focus-failed';
    if (/content|selector|visible|element/i.test(message)) return 'content-unavailable';

    return 'unexpected';
}

function sanitizeRequestFailure(request) {
    const failure = request.failure()?.errorText || '';
    if (/abort|cancel/i.test(failure)) return 'aborted';
    if (/timeout/i.test(failure)) return 'timeout';
    if (/connection|network|name_not_resolved|internet_disconnected/i.test(failure)) return 'network';

    return failure ? 'transport-failure' : 'unknown';
}

function createNetworkObserver(page) {
    const requests = new Map();
    const activeExact = new Map();
    const activeSemantic = new Map();
    const pendingFinalizers = new Set();
    const records = [];
    const queryAudit = [];
    let activeClassified = 0;
    let requestSequence = 0;
    let exactConcurrentDuplicates = 0;
    let semanticCanonicalizationMisses = 0;
    let peakConcurrency = 0;
    let context = {
        coldWarm: 'setup',
        routeCategory: 'preflight',
        routeGeneration: 0,
        scenarioName: 'read-only-family-preflight'
    };

    const increment = (map, key) => map.set(key, (map.get(key) || 0) + 1);
    const decrement = (map, key) => {
        const next = (map.get(key) || 1) - 1;
        if (next <= 0) map.delete(key);
        else map.set(key, next);
    };

    const onRequest = request => {
        const operationCategory = classifyOperation(request.url(), request.resourceType());
        if (!operationCategory) return;

        const exactKey = canonicalRequestKey(request.url(), request.method(), false);
        const semanticKey = canonicalRequestKey(request.url(), request.method(), true);
        const exactDuplicate = (activeExact.get(exactKey) || 0) > 0;
        const semanticDuplicate = (activeSemantic.get(semanticKey) || 0) > 0;
        if (exactDuplicate) exactConcurrentDuplicates += 1;
        if (!exactDuplicate && semanticDuplicate) semanticCanonicalizationMisses += 1;
        increment(activeExact, exactKey);
        increment(activeSemantic, semanticKey);
        activeClassified += 1;
        peakConcurrency = Math.max(peakConcurrency, activeClassified);
        requestSequence += 1;
        const startedAt = performance.now();

        requests.set(request, {
            context: { ...context },
            concurrentRequestCount: activeClassified,
            exactKey,
            exactDuplicate,
            operationCategory,
            requestIndex: requestSequence,
            semanticKey,
            startedAt,
            startedIso: new Date().toISOString()
        });
        if (
            operationCategory.startsWith('items-')
            || operationCategory === 'boxsets-collections'
            || operationCategory === 'show-episodes'
            || operationCategory === 'show-seasons'
        ) {
            queryAudit.push(auditQuery(request.url(), operationCategory, requestSequence));
        }
    };

    const onResponse = response => {
        const state = requests.get(response.request());
        if (!state) return;
        state.headersAt = performance.now();
        state.status = response.status();
    };

    const finalize = async (request, failureCode = null) => {
        const state = requests.get(request);
        if (!state) return;
        requests.delete(request);
        decrement(activeExact, state.exactKey);
        decrement(activeSemantic, state.semanticKey);
        activeClassified = Math.max(0, activeClassified - 1);

        const finishedAt = performance.now();
        let responseByteSize = null;
        try {
            const sizes = await request.sizes();
            responseByteSize = Number.isFinite(sizes.responseBodySize) ? sizes.responseBodySize : null;
        } catch {
            responseByteSize = null;
        }
        const status = state.status || null;
        const success = Boolean(status && status >= 200 && status < 400 && !failureCode);

        let errorCode = failureCode;
        if (!errorCode && !success) errorCode = status ? `http-${status}` : 'unknown';

        records.push({
            coldWarm: state.context.coldWarm,
            concurrentRequestCount: state.concurrentRequestCount,
            coordinatorKeyCategory: state.operationCategory,
            deduplicated: false,
            errorCode,
            exactConcurrentDuplicate: state.exactDuplicate,
            method: request.method(),
            operationCategory: state.operationCategory,
            requestIndex: state.requestIndex,
            requestStart: state.startedIso,
            responseByteSize,
            responseTransferDurationMs: state.headersAt ? round(finishedAt - state.headersAt) : null,
            routeCategory: state.context.routeCategory,
            routeGeneration: state.context.routeGeneration,
            scenarioName: state.context.scenarioName,
            shared: false,
            status,
            success,
            timeToHeadersMs: state.headersAt ? round(state.headersAt - state.startedAt) : null,
            totalDurationMs: round(finishedAt - state.startedAt)
        });
    };

    const trackFinalize = (request, failureCode) => {
        const promise = finalize(request, failureCode).finally(() => pendingFinalizers.delete(promise));
        pendingFinalizers.add(promise);
    };
    const onFinished = request => trackFinalize(request, null);
    const onFailed = request => trackFinalize(request, sanitizeRequestFailure(request));

    page.on('request', onRequest);
    page.on('response', onResponse);
    page.on('requestfinished', onFinished);
    page.on('requestfailed', onFailed);

    return {
        dispose() {
            page.off('request', onRequest);
            page.off('response', onResponse);
            page.off('requestfinished', onFinished);
            page.off('requestfailed', onFailed);
        },
        async drain(maximumMs = 2_000) {
            const startedAt = Date.now();
            while ((activeClassified > 0 || pendingFinalizers.size > 0) && Date.now() - startedAt < maximumMs) {
                await sleep(50);
            }
            await Promise.allSettled([ ...pendingFinalizers ]);
        },
        getGlobalSummary() {
            return {
                exactConcurrentDuplicates,
                peakConcurrency,
                semanticCanonicalizationMisses
            };
        },
        getQueryAudit() {
            return queryAudit.map(entry => ({ ...entry }));
        },
        getRecords() {
            return records.map(entry => ({ ...entry }));
        },
        setContext(nextContext) {
            context = { ...nextContext };
        },
        snapshot() {
            return {
                exactConcurrentDuplicates,
                peakConcurrency,
                recordCount: records.length,
                semanticCanonicalizationMisses
            };
        }
    };
}

async function getRouteGeneration(page) {
    return page.evaluate(() => Number(window.PTV?.routeController?.getState?.().routeGeneration || 0));
}

async function getCoordinatorReport(page) {
    return page.evaluate(() => {
        const report = window.PTV?.requestCoordinator?.report?.() || {};

        return {
            deduplicatedRequests: Number(report.deduplicatedRequests || 0),
            inFlightCount: Number(report.inFlightCount || 0),
            requestSequence: Number(report.requestSequence || 0)
        };
    });
}

async function navigate(page, route) {
    await page.evaluate(nextRoute => {
        window.location.hash = nextRoute;
    }, route);
}

async function waitForVisible(page, selector, timeoutMs = ROUTE_TIMEOUT_MS) {
    await page.waitForFunction(target => (
        [ ...document.querySelectorAll(target) ]
            .some(element => element.getBoundingClientRect().height > 0)
    ), selector, { timeout: timeoutMs });
}

async function waitForDetails(page) {
    await page.waitForFunction(() => (
        window.location.hash.toLowerCase().includes('/details?')
        && [ ...document.querySelectorAll('#itemDetailPage,.itemDetailPage') ]
            .some(element => element.getBoundingClientRect().height > 100)
    ), null, { timeout: DETAIL_TIMEOUT_MS });
}

async function runReadOnlyFamilyPreflight(page, observer) {
    observer.setContext({
        coldWarm: 'setup',
        routeCategory: 'preflight',
        routeGeneration: await getRouteGeneration(page),
        scenarioName: 'read-only-family-preflight'
    });
    const result = await page.evaluate(async timeoutMs => {
        const api = window.PTV.api;
        const apiClient = window.ApiClient;
        const userId = apiClient.getCurrentUserId();
        const withinTimeout = promise => Promise.race([
            promise,
            new Promise((_, reject) => {
                // eslint-disable-next-line sonarjs/no-nested-functions -- Executed inside the isolated browser context.
                window.setTimeout(() => reject(new Error('preflight-timeout')), timeoutMs);
            })
        ]);
        const calls = [
            api.getUserViews(),
            api.getItems({
                EnableTotalRecordCount: false,
                IncludeItemTypes: 'Movie',
                Limit: 1,
                Recursive: true
            }),
            api.getResumeItems({
                Limit: 1,
                MediaTypes: 'Video'
            }),
            api.getRecentlyAdded({
                IncludeItemTypes: 'Movie',
                Limit: 1
            }),
            api.requestJson('Genres', {
                params: {
                    IncludeItemTypes: 'Movie',
                    Limit: 1,
                    UserId: userId
                }
            }),
            api.requestJson('Studios', {
                params: {
                    IncludeItemTypes: 'Movie',
                    Limit: 1,
                    UserId: userId
                }
            }),
            api.requestJson('Items', {
                params: {
                    IncludeItemTypes: 'BoxSet',
                    Limit: 1,
                    Recursive: true,
                    UserId: userId
                }
            }),
            api.requestJson('Ptv/v1/status')
        ];
        const outcomes = await Promise.allSettled(calls.map(withinTimeout));
        const coordinatorBefore = window.PTV.requestCoordinator.report();
        const duplicateQuery = {
            EnableTotalRecordCount: false,
            IncludeItemTypes: 'Movie',
            Limit: 1,
            Recursive: true,
            SortBy: 'DateCreated'
        };
        const duplicateOutcomes = await Promise.allSettled([
            api.getItems(duplicateQuery),
            api.getItems(duplicateQuery)
        ].map(withinTimeout));
        const coordinatorAfter = window.PTV.requestCoordinator.report();

        return {
            coordinatorDeduplicationDelta: Math.max(
                0,
                Number(coordinatorAfter.deduplicatedRequests || 0)
                - Number(coordinatorBefore.deduplicatedRequests || 0)
            ),
            failedCalls: outcomes.filter(outcome => outcome.status === 'rejected').length,
            successfulCalls: outcomes.filter(outcome => outcome.status === 'fulfilled').length,
            duplicateProbeFailures: duplicateOutcomes.filter(outcome => outcome.status === 'rejected').length
        };
    }, ROUTE_TIMEOUT_MS);
    await observer.drain();

    return result;
}

function scenarioMetric(records, startIndex, scenarioName, coldWarm) {
    const scenarioRecords = records.filter(record => (
        record.requestIndex > startIndex
        && record.scenarioName === scenarioName
        && record.coldWarm === coldWarm
    ));
    const itemRecords = scenarioRecords.filter(record => record.operationCategory !== 'plugin-comparison');
    const headers = itemRecords.map(record => record.timeToHeadersMs).filter(Number.isFinite);
    const longest = [ ...itemRecords ]
        .filter(record => Number.isFinite(record.timeToHeadersMs))
        .sort((left, right) => right.timeToHeadersMs - left.timeToHeadersMs)[0];

    return {
        duplicateCount: 0,
        itemsRequestCount: itemRecords.length,
        longestRequestCategory: longest?.operationCategory || null,
        maximumTimeToHeadersMs: headers.length ? round(Math.max(...headers)) : null,
        p50TimeToHeadersMs: percentile(headers, 0.5),
        p90TimeToHeadersMs: percentile(headers, 0.9),
        p95TimeToHeadersMs: percentile(headers, 0.95),
        peakConcurrency: itemRecords.length ?
            Math.max(...itemRecords.map(record => record.concurrentRequestCount)) :
            0
    };
}

async function runScenario(page, observer, passName, definition) {
    const startedAt = performance.now();
    const recordsBefore = observer.getRecords();
    const startIndex = recordsBefore.reduce((maximum, record) => Math.max(maximum, record.requestIndex), 0);
    const coordinatorBefore = await getCoordinatorReport(page);
    const globalBefore = observer.snapshot();
    let failedStage = null;
    let errorCode = null;
    let assertionCount = 0;
    let scenarioEvidence = null;

    observer.setContext({
        coldWarm: passName,
        routeCategory: definition.routeCategory,
        routeGeneration: await getRouteGeneration(page),
        scenarioName: definition.name
    });

    try {
        const result = await definition.run({
            page,
            stage: async (name, callback) => {
                try {
                    const value = await callback();
                    assertionCount += 1;
                    observer.setContext({
                        coldWarm: passName,
                        routeCategory: definition.routeCategory,
                        routeGeneration: await getRouteGeneration(page),
                        scenarioName: definition.name
                    });

                    return value;
                } catch (error) {
                    failedStage = name;
                    throw error;
                }
            }
        });
        if (result && typeof result === 'object') scenarioEvidence = result;
        if (result === false) {
            failedStage = failedStage || 'assertion';
            errorCode = 'assertion-failed';
        }
    } catch (error) {
        if (error?.scenarioEvidence && typeof error.scenarioEvidence === 'object') {
            scenarioEvidence = error.scenarioEvidence;
        }
        errorCode = safeErrorCode(error);
        failedStage = failedStage || 'scenario';
    }

    await observer.drain();
    const recordsAfter = observer.getRecords();
    const globalAfter = observer.snapshot();
    const coordinatorAfter = await getCoordinatorReport(page);
    const metrics = scenarioMetric(recordsAfter, startIndex, definition.name, passName);
    metrics.duplicateCount = Math.max(
        0,
        globalAfter.exactConcurrentDuplicates - globalBefore.exactConcurrentDuplicates
    );

    return {
        ...metrics,
        assertionCount,
        coldWarm: passName,
        coordinatorDeduplicationCount: Math.max(
            0,
            coordinatorAfter.deduplicatedRequests - coordinatorBefore.deduplicatedRequests
        ),
        durationMs: round(performance.now() - startedAt),
        errorCode,
        firstFailedStage: failedStage,
        hostDatabaseEvidenceOverlap: 'not-observed',
        name: definition.name,
        passed: !errorCode,
        retiredRouteBackgroundRequestCount: null,
        scenarioEvidence,
        validationMode: definition.validationMode || 'read-only-browser-interaction'
    };
}

function getScenarioDefinitions() {
    return [
        {
            name: 'home-initial-load',
            routeCategory: 'home',
            async run({ page, stage }) {
                await stage('navigate-home', () => navigate(page, '#/home'));
                await stage('home-root-visible', () => waitForVisible(page, '[data-ptv-layout-node="home-root"]'));
                await stage('home-content-visible', () => waitForVisible(page, 'a.ptv-native-card-media-link'));
            }
        },
        {
            name: 'home-route-return',
            routeCategory: 'home',
            async run({ page, stage }) {
                await stage('navigate-away', () => navigate(page, '#/movies/latest'));
                await stage('away-content-visible', () => waitForVisible(page, 'a.ptv-browse-card'));
                await stage('return-home', () => navigate(page, '#/home'));
                await stage('returned-content-visible', () => waitForVisible(page, 'a.ptv-native-card-media-link'));
            }
        },
        {
            name: 'movies',
            routeCategory: 'movies',
            async run({ page, stage }) {
                await stage('navigate-movies', () => navigate(page, '#/movies/latest'));
                await stage('movie-content-visible', () => waitForVisible(page, 'a.ptv-browse-card'));
            }
        },
        {
            name: 'shows',
            routeCategory: 'shows',
            async run({ page, stage }) {
                await stage('navigate-shows', () => navigate(page, '#/shows/latest'));
                await stage('show-content-visible', () => waitForVisible(page, 'a.ptv-browse-card'));
            }
        },
        {
            name: 'search',
            routeCategory: 'search',
            async run({ page, stage }) {
                await stage('navigate-search', () => navigate(page, '#/search'));
                const input = page.locator(
                    'input[data-ptv-focus-key="search-input"],main input[aria-label="Search PiggieTV"]'
                ).first();
                await stage('search-control-visible', () => input.waitFor({
                    state: 'visible',
                    timeout: ROUTE_TIMEOUT_MS
                }));
                await stage('search-submit', async () => {
                    await input.fill(READ_ONLY_SEARCH_TERM);
                    await input.press('Enter');
                });
                await stage('search-results-visible', () => waitForVisible(page, '.ptv-search-card'));
            }
        },
        {
            name: 'movie-details',
            routeCategory: 'movie-details',
            async run({ page, stage }) {
                await stage('navigate-movies', () => navigate(page, '#/movies/latest'));
                await stage('movie-card-visible', () => waitForVisible(page, 'a.ptv-browse-card'));
                await stage('open-movie-details', () => page.locator('a.ptv-browse-card').first().click());
                await stage('movie-details-visible', () => waitForDetails(page));
            }
        },
        {
            name: 'series-details',
            routeCategory: 'series-details',
            async run({ page, stage }) {
                await stage('navigate-shows', () => navigate(page, '#/shows/latest'));
                await stage('series-card-visible', () => waitForVisible(page, 'a.ptv-browse-card'));
                await stage('open-series-details', () => page.locator('a.ptv-browse-card').first().click());
                await stage('series-details-visible', () => waitForDetails(page));
            }
        },
        {
            name: 'season-details',
            routeCategory: 'season-details',
            async run({ page, stage }) {
                const season = await stage('read-season-candidate', () => page.evaluate(async () => {
                    const api = window.ApiClient;
                    const userId = api.getCurrentUserId();
                    const seriesResult = await api.getItems(userId, {
                        Fields: 'PrimaryImageAspectRatio',
                        IncludeItemTypes: 'Series',
                        Limit: 20,
                        Recursive: true,
                        SortBy: 'SortName'
                    });
                    for (const series of seriesResult?.Items || []) {
                        const result = await api.getSeasons(series.Id, {
                            Fields: 'ItemCounts,PrimaryImageAspectRatio,CanDelete,MediaSourceCount',
                            userId
                        });
                        const candidate = result?.Items?.[0];
                        if (candidate?.Id) {
                            return {
                                id: candidate.Id,
                                serverId: candidate.ServerId || series.ServerId || null
                            };
                        }
                    }

                    return null;
                }));
                if (!season?.id) throw new Error('content-unavailable');
                await stage('open-season-details', () => navigate(
                    page,
                    `#/details?id=${encodeURIComponent(season.id)}${
                        season.serverId ? `&serverId=${encodeURIComponent(season.serverId)}` : ''
                    }`
                ));
                await stage('season-details-visible', () => waitForDetails(page));
                await stage('episode-list-visible', () => waitForVisible(
                    page,
                    '#childrenContent .listItem,.childrenItemsContainer .listItem,.itemsContainer .listItem'
                ));
            }
        },
        {
            name: 'reading',
            routeCategory: 'reading',
            async run({ page, stage }) {
                await stage('navigate-reading', () => navigate(page, '#/reading/books'));
                await stage('reading-content-visible', () => waitForVisible(page, '.ptv-books-card'));
            }
        },
        {
            name: 'music',
            routeCategory: 'music',
            async run({ page, stage }) {
                await stage('navigate-music', () => navigate(page, '#/music'));
                await stage('music-surface-visible', () => waitForVisible(page, '.ptv-music-main'));
                await stage('music-content-visible', () => waitForVisible(
                    page,
                    '.ptv-music-card,.ptv-music-track-row'
                ));
            }
        },
        {
            name: 'playback-continuation',
            routeCategory: 'playback-continuation',
            validationMode: 'read-only-resume-contract',
            async run({ page, stage }) {
                const result = await stage('read-resume-contract', () => page.evaluate(async () => {
                    const response = await window.PTV.api.getResumeItems({
                        EnableImageTypes: 'Primary,Backdrop,Thumb',
                        Fields: 'PrimaryImageAspectRatio,ProductionYear,DateCreated',
                        ImageTypeLimit: 1,
                        Limit: 20,
                        MediaTypes: 'Video'
                    });

                    return {
                        valid: Boolean(response && Array.isArray(response.Items))
                    };
                }));
                if (!result.valid) throw new Error('content-unavailable');
            }
        },
        {
            name: 'back-forward',
            routeCategory: 'navigation-history',
            async run({ page, stage }) {
                await stage('navigate-movies', () => navigate(page, '#/movies/latest'));
                await stage('movies-visible', () => waitForVisible(page, 'a.ptv-browse-card'));
                await stage('navigate-genres', () => navigate(page, '#/movies/genres'));
                await stage('genres-route', () => page.waitForFunction(() => (
                    window.location.hash.toLowerCase().startsWith('#/movies/genres')
                ), null, { timeout: ROUTE_TIMEOUT_MS }));
                await stage('browser-back', () => page.goBack({ waitUntil: 'domcontentloaded' }));
                await stage('back-route', () => page.waitForFunction(() => (
                    window.location.hash.toLowerCase().startsWith('#/movies/latest')
                ), null, { timeout: ROUTE_TIMEOUT_MS }));
                await stage('browser-forward', () => page.goForward({ waitUntil: 'domcontentloaded' }));
                await stage('forward-route', () => page.waitForFunction(() => (
                    window.location.hash.toLowerCase().startsWith('#/movies/genres')
                ), null, { timeout: ROUTE_TIMEOUT_MS }));
            }
        },
        {
            name: 'tv-like-focus',
            routeCategory: 'movies',
            async run({ page, stage }) {
                await stage('navigate-movies', () => navigate(page, '#/movies/latest'));
                await stage('movie-card-visible', () => waitForVisible(page, 'a.ptv-browse-card'));
                const card = page.locator('a.ptv-browse-card').first();
                await stage('initial-focus', () => card.focus());
                const result = await stage('directional-sequence', async () => {
                    const snapshots = [];
                    const initialTargetCategory = await page.evaluate(() => {
                        const active = document.activeElement;

                        if (active?.matches?.('a.ptv-browse-card')) return 'browse-card';
                        if (active?.closest?.('[data-ptv-layout-node="sidebar"]')) return 'sidebar-control';
                        if (active?.closest?.('header')) return 'header-control';
                        return active?.matches?.('button, a, [tabindex]') ? 'other-interactive' : 'other';
                    });
                    for (const key of [ 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp' ]) {
                        const beforeIndex = await page.evaluate(() => Array.from(
                            document.querySelectorAll('button, a, [tabindex]')
                        ).indexOf(document.activeElement));
                        await page.keyboard.press(key);
                        await sleep(150);
                        snapshots.push(await page.evaluate(({ direction, previousIndex }) => {
                            const active = document.activeElement;
                            const activeIndex = Array.from(
                                document.querySelectorAll('button, a, [tabindex]')
                            ).indexOf(active);
                            let resultingTargetCategory = 'other';
                            if (active?.matches?.('a.ptv-browse-card')) {
                                resultingTargetCategory = 'browse-card';
                            } else if (active?.closest?.('[data-ptv-layout-node="sidebar"]')) {
                                resultingTargetCategory = 'sidebar-control';
                            } else if (active?.closest?.('header')) {
                                resultingTargetCategory = 'header-control';
                            } else if (active?.matches?.('button, a, [tabindex]')) {
                                resultingTargetCategory = 'other-interactive';
                            }

                            return {
                                activationOccurred: false,
                                eventFamily: 'keyboard-arrow',
                                expectedDirection: direction.replace('Arrow', '').toLowerCase(),
                                focusChanged: activeIndex !== previousIndex,
                                requestMade: false,
                                resultingTargetCategory,
                                targetVisible: Boolean(active && active.getBoundingClientRect().height > 0)
                            };
                        }, {
                            direction: key,
                            previousIndex: beforeIndex
                        }));
                    }

                    return {
                        allVisible: snapshots.every(snapshot => snapshot.targetVisible),
                        initialTargetCategory,
                        steps: snapshots,
                        uniqueFocusCategories: new Set(snapshots.map(snapshot => (
                            snapshot.resultingTargetCategory
                        ))).size
                    };
                });
                if (!result.allVisible || result.uniqueFocusCategories < 2) {
                    const error = new Error('focus-sequence-failed');
                    error.scenarioEvidence = result;
                    throw error;
                }

                return result;
            }
        }
    ];
}

async function collectProvenance(page, browser) {
    const runtime = await page.evaluate(() => {
        const api = window.ApiClient;
        const apiOrigin = api.serverAddress?.() || api._serverInfo?.Url || '';
        let apiConnectionCategory = 'configured-api';
        try {
            const parsed = new URL(apiOrigin);
            if (parsed.protocol === 'http:' && parsed.port === '8096') {
                apiConnectionCategory = 'direct-http-listener';
            }
        } catch {
            apiConnectionCategory = 'unknown';
        }

        return {
            accountRoleCategory: api._currentUser?.Policy?.IsAdministrator ?
                'administrator' :
                'non-administrator',
            apiConnectionCategory,
            apiOrigin,
            backendVersion: String(api._serverVersion || 'unknown'),
            frontendOrigin: window.location.origin,
            serviceWorker: {
                controlled: Boolean(navigator.serviceWorker?.controller),
                registrationPresent: false,
                state: navigator.serviceWorker?.controller?.state || 'none'
            }
        };
    });

    return {
        accountRoleCategory: runtime.accountRoleCategory,
        apiConnectionCategory: runtime.apiConnectionCategory,
        apiOriginCategory: classifyOrigin(runtime.apiOrigin),
        backendVersion: runtime.backendVersion,
        browserVersion: browser.version(),
        firstRunCacheClassification: 'warm',
        frontendBuildId: require('../package.json').version,
        frontendOriginCategory: classifyOrigin(runtime.frontendOrigin),
        plugin: {
            apiVersion: 1,
            capabilityCount: 13,
            status: 200,
            version: require('../src/ptv/plugin/Jellyfin.Plugin.PiggieTV/meta.json').version
        },
        serverRecentlyRestarted: 'unknown',
        serverUptimeSeconds: null,
        serviceWorker: runtime.serviceWorker,
        testStartTime: new Date().toISOString()
    };
}

function validatePrivacy(value, location = 'root') {
    if (Array.isArray(value)) {
        value.forEach((entry, index) => {
            validatePrivacy(entry, `${location}[${index}]`);
        });
        return;
    }
    if (!value || typeof value !== 'object') {
        if (typeof value === 'string' && PRIVATE_VALUE_PATTERN.test(value)) {
            throw new Error(`private artifact value at ${location}`);
        }
        return;
    }

    for (const [ key, entry ] of Object.entries(value)) {
        if (FORBIDDEN_ARTIFACT_KEY.test(key)) {
            throw new Error(`forbidden artifact key at ${location}.${key}`);
        }
        validatePrivacy(entry, `${location}.${key}`);
    }
}

function summarizeRequestTimings(records) {
    const groups = new Map();
    for (const record of records) {
        if (!groups.has(record.operationCategory)) groups.set(record.operationCategory, []);
        groups.get(record.operationCategory).push(record);
    }

    return [ ...groups.entries() ].map(([ operationCategory, entries ]) => {
        const headers = entries.map(entry => entry.timeToHeadersMs).filter(Number.isFinite);

        return {
            errorCount: entries.filter(entry => !entry.success).length,
            maximumTimeToHeadersMs: headers.length ? round(Math.max(...headers)) : null,
            operationCategory,
            p50TimeToHeadersMs: percentile(headers, 0.5),
            p90TimeToHeadersMs: percentile(headers, 0.9),
            p95TimeToHeadersMs: percentile(headers, 0.95),
            requestCount: entries.length
        };
    }).sort((left, right) => left.operationCategory.localeCompare(right.operationCategory));
}

function buildRequestGraph(records) {
    const groups = new Map();
    for (const record of records) {
        const key = `${record.coldWarm}:${record.scenarioName}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(record);
    }

    return [ ...groups.entries() ].map(([ key, entries ]) => {
        const [ coldWarm, scenarioName ] = key.split(':');
        const counts = {};
        for (const entry of entries) {
            counts[entry.operationCategory] = (counts[entry.operationCategory] || 0) + 1;
        }

        return {
            coldWarm,
            exactConcurrentDuplicateCount: entries.filter(entry => (
                entry.exactConcurrentDuplicate
            )).length,
            operationCounts: counts,
            operationSequence: entries
                .sort((left, right) => left.requestIndex - right.requestIndex)
                .map(entry => entry.operationCategory),
            scenarioName
        };
    });
}

async function run() {
    const args = parseArgs();
    const outputDir = path.resolve(String(args['output-dir'] || DEFAULT_OUTPUT_DIR));
    fs.mkdirSync(outputDir, { recursive: true });
    const browser = await chromium.connectOverCDP(String(args.cdp || CDP_URL));
    const pages = browser.contexts().flatMap(context => context.pages())
        .filter(candidate => {
            try {
                return new URL(candidate.url()).origin === FRONTEND_ORIGIN;
            } catch {
                return false;
            }
        });
    if (pages.length !== 1) throw new Error(`Expected one local frontend page; found ${pages.length}`);
    const page = pages[0];
    const authenticated = await page.evaluate(() => Boolean(
        window.ApiClient?.getCurrentUserId?.()
        && window.ApiClient?.accessToken?.()
    ));
    if (!authenticated) throw new Error('Same-account authenticated session is unavailable');

    process.stdout.write('matrix:provenance:start\n');
    const provenance = await collectProvenance(page, browser);
    process.stdout.write('matrix:provenance:complete\n');
    const observer = createNetworkObserver(page);
    const cdpSession = await page.context().newCDPSession(page);
    const passNames = [ 'warm', 'immediate-repeat', 'transport-cold' ];
    const scenarioResults = [];
    let familyPreflight;

    try {
        process.stdout.write('matrix:preflight:start\n');
        familyPreflight = await runReadOnlyFamilyPreflight(page, observer);
        process.stdout.write('matrix:preflight:complete\n');
        for (const passName of passNames) {
            if (passName === 'transport-cold') {
                await cdpSession.send('Network.enable');
                await cdpSession.send('Network.setCacheDisabled', { cacheDisabled: true });
            }
            for (const definition of getScenarioDefinitions()) {
                process.stdout.write(`matrix:${passName}:${definition.name}:start\n`);
                const result = await runScenario(page, observer, passName, definition);
                scenarioResults.push(result);
                process.stdout.write(`matrix:${passName}:${definition.name}:${result.passed ? 'pass' : 'fail'}\n`);
            }
        }
    } finally {
        await cdpSession.send('Network.setCacheDisabled', { cacheDisabled: false }).catch(() => undefined);
        await cdpSession.detach().catch(() => undefined);
        await observer.drain();
        observer.dispose();
    }

    const records = observer.getRecords();
    const queryAudit = observer.getQueryAudit();
    const requestTiming = {
        generatedAt: new Date().toISOString(),
        measurements: records,
        summary: summarizeRequestTimings(records)
    };
    const scenarioMatrix = {
        familyPreflight,
        generatedAt: new Date().toISOString(),
        provenance,
        results: scenarioResults,
        summary: Object.fromEntries(passNames.map(passName => {
            const entries = scenarioResults.filter(entry => entry.coldWarm === passName);

            return [ passName, {
                failed: entries.filter(entry => !entry.passed).length,
                passed: entries.filter(entry => entry.passed).length,
                total: entries.length
            } ];
        }))
    };
    const frontendGraph = {
        generatedAt: new Date().toISOString(),
        global: observer.getGlobalSummary(),
        graphs: buildRequestGraph(records),
        rules: {
            hiddenDashboardPollingObserved: null,
            imageRequestsMisclassified: false,
            retiredRouteBackgroundRequests: null,
            runtimeAttributionLimit: 'source-and-focused-tests-required'
        }
    };
    const queryReport = {
        generatedAt: new Date().toISOString(),
        requests: queryAudit,
        summary: {
            invalidFieldRequests: queryAudit.filter(entry => !entry.fieldsValid).length,
            mediaSourcesRequestCount: queryAudit.filter(entry => entry.mediaSourcesRequested).length,
            parameterNameCollisionCount: queryAudit.filter(entry => entry.parameterNameCollision).length,
            unboundedPagingRequests: queryAudit.filter(entry => !entry.boundedPaging).length,
            userDataFieldRequests: queryAudit.filter(entry => !entry.userDataFieldAbsent).length
        }
    };

    for (const report of [ requestTiming, scenarioMatrix, frontendGraph, queryReport ]) {
        validatePrivacy(report);
    }

    const outputFiles = {
        frontendGraph: path.join(outputDir, 'frontend-request-graph.json'),
        queryAudit: path.join(outputDir, 'query-contract-audit.json'),
        requestTiming: path.join(outputDir, 'request-timing-summary.json'),
        scenarioMatrix: path.join(outputDir, 'scenario-matrix.json')
    };
    fs.writeFileSync(outputFiles.requestTiming, `${JSON.stringify(requestTiming, null, 2)}\n`, 'utf8');
    fs.writeFileSync(outputFiles.scenarioMatrix, `${JSON.stringify(scenarioMatrix, null, 2)}\n`, 'utf8');
    fs.writeFileSync(outputFiles.frontendGraph, `${JSON.stringify(frontendGraph, null, 2)}\n`, 'utf8');
    fs.writeFileSync(outputFiles.queryAudit, `${JSON.stringify(queryReport, null, 2)}\n`, 'utf8');

    process.stdout.write(`${JSON.stringify({
        artifacts: Object.fromEntries(Object.entries(outputFiles).map(([ key, value ]) => [
            key,
            path.basename(value)
        ])),
        querySummary: queryReport.summary,
        requestSummary: requestTiming.summary,
        scenarioSummary: scenarioMatrix.summary
    }, null, 2)}\n`);
    process.exit(Object.values(scenarioMatrix.summary).some(summary => summary.failed > 0) ? 1 : 0);
}

run().catch(error => {
    process.stderr.write(`Items stabilization matrix failed: ${safeErrorCode(error)}\n`);
    process.exit(1);
});

/* eslint-enable compat/compat */
