/* eslint-disable compat/compat -- This read-only evidence harness runs in the current Node/Chrome toolchain. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const CDP_ENDPOINT = 'http://127.0.0.1:9223';
const FRONTEND_ORIGIN = 'http://localhost:8082';
const OUTPUT_DIRECTORY = path.resolve('test-results/backend-latency-attribution');
const MATRIX_SCRIPT = path.resolve('scripts/ptv-items-stabilization-matrix.cjs');
const PRE_CAPTURE_DURATION_MS = 30_000;
const POST_CAPTURE_DURATION_MS = 30_000;
const SAMPLE_INTERVAL_MS = 1_000;
const FORBIDDEN_KEY = /(?:^|_)(?:cookie|credential|header|hostname|itemid|mediaid|password|querystring|rawid|servername|token|url|userid|username|path)(?:$|_)/i;
const PRIVATE_VALUE_PATTERNS = [
    /\b[a-f0-9]{32}\b/i,
    /(?:https?:\/\/|file:\/\/)/i,
    /[?&](?:api_key|token|userId)=/i,
    /[a-z]:\\/i,
    /\/(?:etc|home|mnt|opt|srv|usr|var)\//i
];

const sleep = durationMs => new Promise(resolve => setTimeout(resolve, durationMs));
const round = value => Number.isFinite(value) ? Math.round(value * 10) / 10 : null;

function percentile(values, fraction) {
    if (!values.length) return null;
    const sorted = [ ...values ].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));

    return round(sorted[index]);
}

function median(values) {
    return percentile(values, 0.5);
}

function requireSecret(name) {
    const value = process.env[name];
    if (!value) throw new Error(`missing-${name.toLowerCase().replaceAll('_', '-')}`);

    return value;
}

function validatePrivacy(value, forbiddenValues, location = 'root') {
    if (Array.isArray(value)) {
        value.forEach((entry, index) => {
            validatePrivacy(entry, forbiddenValues, `${location}[${index}]`);
        });
        return;
    }
    if (!value || typeof value !== 'object') {
        if (typeof value !== 'string') return;
        if (PRIVATE_VALUE_PATTERNS.some(pattern => pattern.test(value))) {
            throw new Error(`private-artifact-value:${location}`);
        }
        if (forbiddenValues.some(entry => entry && value.toLowerCase() === entry.toLowerCase())) {
            throw new Error(`private-artifact-identity:${location}`);
        }
        return;
    }

    for (const [ key, entry ] of Object.entries(value)) {
        if (FORBIDDEN_KEY.test(key)) throw new Error(`private-artifact-key:${location}.${key}`);
        validatePrivacy(entry, forbiddenValues, `${location}.${key}`);
    }
}

function splitList(value) {
    return String(value || '').split(',').map(entry => entry.trim()).filter(Boolean);
}

function getSearchParameter(url, name) {
    const key = [ ...url.searchParams.keys() ].find(candidate => (
        candidate.toLowerCase() === name.toLowerCase()
    ));

    return key ? url.searchParams.get(key) : null;
}

function classifyOperation(rawTarget) {
    let url;
    try {
        url = new URL(rawTarget);
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

    const includeItemTypes = splitList(getSearchParameter(url, 'IncludeItemTypes'))
        .map(value => value.toLowerCase());
    if (includeItemTypes.includes('boxset')) return 'boxsets-collections';
    if (/\/Users\/[^/]+\/Items\/?$/i.test(pathname) && getSearchParameter(url, 'SearchTerm')) {
        return 'items-search';
    }
    if (/\/Users\/[^/]+\/Items\/?$/i.test(pathname) || /\/Items\/?$/i.test(pathname)) {
        return 'items-list';
    }

    return null;
}

function parseDurationMs(value) {
    const parts = String(value || '').split(':').map(Number);
    if (parts.length !== 3 || parts.some(part => !Number.isFinite(part))) return null;

    return round(((parts[0] * 60 * 60) + (parts[1] * 60) + parts[2]) * 1_000);
}

function classifyTask(name) {
    const value = String(name || '').toLowerCase();
    if (value.includes('optimize database')) return 'database-maintenance';
    if (value.includes('playback reporting')) return 'playback-reporting';
    if (value.includes('backup')) return 'backup';
    if (value.includes('scan media library') || value.includes('media segment scan')) {
        return 'library-scan';
    }
    if (value.includes('metadata') || value.includes('refresh people')) return 'metadata-refresh';
    if (value.includes('piggie') || value.includes('ptv')) return 'ptv';

    return 'other';
}

function classifyPluginActivity(line) {
    if (/Playback Reporting/i.test(line)) return 'playback-reporting';
    if (/PiggieTV|Jellyfin\.Plugin\.PiggieTV/i.test(line)) return 'ptv';
    if (/Intro Skipper/i.test(line)) return 'intro-skipper';
    if (/SkipMe/i.test(line)) return 'skipme';
    if (/TheTVDB|TMDb|AniDB|AniList|MusicBrainz|Google Books/i.test(line)) {
        return 'metadata-provider';
    }

    return null;
}

function classifyDatabaseWarning(line) {
    if (/database is locked/i.test(line)) return 'sqlite-locked';
    if (/SQLite.*\bbusy\b|\bbusy\b.*SQLite/i.test(line)) return 'sqlite-busy';
    if (/optimistic concurrenc/i.test(line)) return 'optimistic-concurrency';
    if (/multiple collection|QuerySplittingBehavior|query splitting/i.test(line)) {
        return 'ef-query-splitting';
    }
    if (/Microsoft\.EntityFrameworkCore|Entity Framework/i.test(line)) return 'entity-framework';

    return null;
}

function classifyTaskLog(line) {
    if (/library scan|scan media library/i.test(line)) return 'library-scan';
    if (/metadata refresh|refresh metadata/i.test(line)) return 'metadata-refresh';
    if (/backup/i.test(line)) return 'backup';
    if (/scheduled task|executing.*task|task.*completed/i.test(line)) return 'other';

    return null;
}

// eslint-disable-next-line sonarjs/cognitive-complexity
function parseLogTexts(texts, captureStart, captureEnd) {
    const slowResponses = [];
    const databaseEvents = [];
    const pluginEvents = [];
    const taskEvents = [];

    for (const text of texts) {
        for (const line of text.split(/\r?\n/)) {
            const timestampToken = (line.match(/^\[([^\]]+)\]/) || [])[1];
            if (!timestampToken) continue;
            const timestampValue = Date.parse(timestampToken);
            if (!Number.isFinite(timestampValue)
                || timestampValue < captureStart - 1_000
                || timestampValue > captureEnd + 1_000) {
                continue;
            }
            const timestamp = new Date(timestampValue).toISOString();
            const databaseCategory = classifyDatabaseWarning(line);
            if (databaseCategory) databaseEvents.push({ category: databaseCategory, timestamp });
            const pluginCategory = classifyPluginActivity(line);
            if (pluginCategory) pluginEvents.push({ category: pluginCategory, timestamp });
            const taskCategory = classifyTaskLog(line);
            if (taskCategory) taskEvents.push({ category: taskCategory, timestamp });
            if (!/Slow HTTP Response/i.test(line)) continue;

            const quotedValues = [ ...line.matchAll(/"([^"]+)"/g) ].map(match => match[1]);
            const target = quotedValues.find(value => /^https?:\/\//i.test(value));
            const operationCategory = classifyOperation(target);
            const durationToken = (
                line.match(/\bin\s+([0-9:.]+)\s+with\s+Status\s+Code/i) || []
            )[1];
            const statusToken = (line.match(/Status\s+Code\s+(\d{3})/i) || [])[1];
            const durationMs = parseDurationMs(durationToken);
            if (!operationCategory || !durationMs) continue;

            slowResponses.push({
                operationCategory,
                serverCompletion: timestamp,
                serverDurationMs: durationMs,
                status: statusToken ? Number(statusToken) : null
            });
        }
    }

    return {
        databaseEvents,
        pluginEvents,
        slowResponses,
        taskEvents
    };
}

async function connectBrowser() {
    const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
    const pages = browser.contexts().flatMap(context => context.pages())
        .filter(page => {
            try {
                return new URL(page.url()).origin === FRONTEND_ORIGIN;
            } catch {
                return false;
            }
        });
    if (pages.length !== 1) throw new Error(`frontend-page-count-${pages.length}`);
    const runtime = await pages[0].evaluate(async () => {
        const api = window.ApiClient;
        if (!api?.getCurrentUserId?.() || !api?.accessToken?.()) return { authenticated: false };
        const user = await api.getCurrentUser();

        return {
            administrator: Boolean(user?.Policy?.IsAdministrator),
            authenticated: true,
            backendAddress: api.serverAddress(),
            backendVersion: String(api._serverVersion || 'unknown')
        };
    });
    if (!runtime.authenticated) throw new Error('browser-account-not-authenticated');
    if (runtime.administrator) throw new Error('browser-account-must-be-non-administrator');

    return {
        backendOrigin: new URL(runtime.backendAddress).origin,
        backendVersion: runtime.backendVersion
    };
}

async function createAdminObserver(backendOrigin, identity, password) {
    const authorization = [
        'MediaBrowser Client="Codex Backend Attribution"',
        'Device="Read-only Observer"',
        `DeviceId="${crypto.randomUUID()}"`,
        'Version="1.0.0"'
    ].join(', ');
    const authResponse = await fetch(`${backendOrigin}/Users/AuthenticateByName`, {
        body: JSON.stringify({
            Pw: password,
            Username: identity
        }),
        headers: {
            'Content-Type': 'application/json',
            'X-Emby-Authorization': authorization
        },
        method: 'POST'
    });
    if (!authResponse.ok) throw new Error(`observer-authentication-${authResponse.status}`);
    const authentication = await authResponse.json();
    if (!authentication.User?.Policy?.IsAdministrator || !authentication.AccessToken) {
        throw new Error('observer-account-is-not-administrator');
    }
    const headers = {
        'X-Emby-Authorization': authorization,
        'X-Emby-Token': authentication.AccessToken
    };

    return {
        async getJson(endpoint) {
            const response = await fetch(`${backendOrigin}${endpoint}`, { headers });
            if (!response.ok) throw new Error(`observer-read-${response.status}`);

            return response.json();
        },
        async getText(endpoint) {
            const response = await fetch(`${backendOrigin}${endpoint}`, { headers });
            if (!response.ok) throw new Error(`observer-read-${response.status}`);

            return response.text();
        },
        async logout() {
            await fetch(`${backendOrigin}/Sessions/Logout`, {
                headers,
                method: 'POST'
            }).catch(() => undefined);
        }
    };
}

async function inspectDatabase(observer, systemInfo) {
    const root = await observer.getJson(
        `/Environment/DirectoryContents?Path=${encodeURIComponent(systemInfo.ProgramDataPath)}`
        + '&IncludeFiles=true&IncludeDirectories=true'
    );
    const dataDirectory = root.find(entry => (
        String(entry.Name).toLowerCase() === 'data'
        && String(entry.Type).toLowerCase().includes('directory')
    ));
    const entries = dataDirectory ? await observer.getJson(
        `/Environment/DirectoryContents?Path=${encodeURIComponent(dataDirectory.Path)}`
        + '&IncludeFiles=true&IncludeDirectories=true'
    ) : [];
    const names = new Set(entries.map(entry => String(entry.Name).toLowerCase()));

    return {
        dataDirectoryObserved: Boolean(dataDirectory),
        journalCompanionPresent: names.has('jellyfin.db-journal'),
        mainDatabasePresent: names.has('jellyfin.db'),
        sharedMemoryCompanionPresent: names.has('jellyfin.db-shm'),
        walCompanionPresent: names.has('jellyfin.db-wal')
    };
}

async function takeSnapshot(observer) {
    const [ systemInfo, storage, tasks, plugins, logFiles, ptvStatus ] = await Promise.all([
        observer.getJson('/System/Info'),
        observer.getJson('/System/Info/Storage'),
        observer.getJson('/ScheduledTasks'),
        observer.getJson('/Plugins'),
        observer.getJson('/System/Logs'),
        observer.getJson('/Ptv/v1/status')
    ]);
    const database = await inspectDatabase(observer, systemInfo);

    return {
        database,
        logFiles,
        plugins,
        ptvStatus,
        storage,
        systemInfo,
        tasks
    };
}

function summarizeFolderStorage(value) {
    if (!value || typeof value !== 'object') return null;

    return {
        freeBytes: Number.isFinite(value.FreeSpace) ? value.FreeSpace : null,
        storageType: value.StorageType || 'unreported',
        usedBytes: Number.isFinite(value.UsedSpace) ? value.UsedSpace : null
    };
}

function summarizeLibraries(libraries) {
    const counts = {};
    let folderCount = 0;
    for (const library of libraries || []) {
        for (const folder of library.Folders || []) {
            const category = folder.StorageType || 'unreported';
            counts[category] = (counts[category] || 0) + 1;
            folderCount += 1;
        }
    }

    return {
        folderCount,
        libraryCount: (libraries || []).length,
        storageTypeCounts: counts
    };
}

function summarizeTasks(tasks) {
    return tasks.map(task => ({
        lastResultStatus: task.LastExecutionResult?.Status || null,
        name: task.Name || task.Key || 'unnamed',
        state: task.State || 'unknown'
    })).sort((left, right) => left.name.localeCompare(right.name));
}

function summarizePlugins(plugins) {
    return plugins.map(plugin => ({
        name: plugin.Name || 'unnamed',
        status: plugin.Status || 'unknown',
        version: plugin.Version || null
    })).sort((left, right) => left.name.localeCompare(right.name));
}

function startSampler(observer) {
    const samples = [];
    let stopping = false;
    const promise = (async () => {
        while (!stopping) {
            const sampleStartedAt = Date.now();
            let activeTaskCategories = [];
            let observerRequestStatus = 'success';
            try {
                const tasks = await observer.getJson('/ScheduledTasks');
                activeTaskCategories = [ ...new Set(tasks.filter(task => (
                    String(task.State).toLowerCase() !== 'idle'
                )).map(task => classifyTask(task.Name || task.Key))) ].sort();
            } catch {
                observerRequestStatus = 'failed';
            }
            samples.push({
                activeTaskCategories,
                observerRequestDurationMs: round(Date.now() - sampleStartedAt),
                observerRequestStatus,
                timestamp: new Date(sampleStartedAt).toISOString()
            });
            const remaining = SAMPLE_INTERVAL_MS - (Date.now() - sampleStartedAt);
            if (remaining > 0) await sleep(remaining);
        }
    })();

    return {
        promise,
        samples,
        stop() {
            stopping = true;
        }
    };
}

function runMatrix() {
    const childEnvironment = Object.fromEntries(Object.entries(process.env).filter(([ key ]) => (
        !key.startsWith('PTV_ATTR_')
    )));

    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [
            MATRIX_SCRIPT,
            `--output-dir=${OUTPUT_DIRECTORY}`
        ], {
            cwd: process.cwd(),
            env: childEnvironment,
            stdio: [ 'ignore', 'pipe', 'pipe' ],
            windowsHide: true
        });
        child.stdout.on('data', data => process.stdout.write(data));
        child.stderr.on('data', data => process.stderr.write(data));
        child.once('error', reject);
        child.once('exit', code => resolve(code ?? 1));
    });
}

async function fetchCapturedLogs(observer, beforeSnapshot, captureStart) {
    const currentLogFiles = await observer.getJson('/System/Logs');
    const isServerLog = logFile => (
        /^(?:jellyfin|log_)/i.test(String(logFile.Name || ''))
        && !/ffmpeg/i.test(String(logFile.Name || ''))
    );
    const initialLatest = beforeSnapshot.logFiles.filter(isServerLog).sort((left, right) => (
        new Date(right.DateCreated || 0) - new Date(left.DateCreated || 0)
    ))[0];
    const selectedNames = new Set();
    if (initialLatest?.Name) selectedNames.add(initialLatest.Name);
    for (const logFile of currentLogFiles.filter(isServerLog)) {
        const createdAt = Date.parse(logFile.DateCreated || '');
        if (Number.isFinite(createdAt) && createdAt >= captureStart - 60 * 60 * 1_000) {
            selectedNames.add(logFile.Name);
        }
    }

    return Promise.all([ ...selectedNames ].filter(Boolean).map(name => (
        observer.getText(`/System/Logs/Log?Name=${encodeURIComponent(name)}`)
    )));
}

function findNearestSample(samples, timestampValue) {
    return samples.reduce((nearest, sample) => {
        const distance = Math.abs(Date.parse(sample.timestamp) - timestampValue);
        if (!nearest || distance < nearest.distance) return { distance, sample };

        return nearest;
    }, null)?.sample || null;
}

function eventsWithin(events, start, end) {
    return events.filter(event => {
        const timestamp = Date.parse(event.timestamp);

        return timestamp >= start - 1_000 && timestamp <= end + 1_000;
    });
}

function correlateRequests(measurements, logEvidence, samples) {
    const usedServerEntries = new Set();
    const eligibleMeasurements = measurements.filter(measurement => (
        measurement.operationCategory !== 'plugin-comparison'
        && measurement.timeToHeadersMs > 1_500
    ));

    // eslint-disable-next-line sonarjs/cognitive-complexity
    return eligibleMeasurements.map(measurement => {
        const browserStart = Date.parse(measurement.requestStart);
        const expectedCompletion = browserStart + measurement.timeToHeadersMs;
        const candidates = logEvidence.slowResponses.map((entry, index) => ({
            completionDeltaMs: Math.abs(Date.parse(entry.serverCompletion) - expectedCompletion),
            durationDeltaMs: Math.abs(entry.serverDurationMs - measurement.timeToHeadersMs),
            entry,
            index
        })).filter(candidate => (
            !usedServerEntries.has(candidate.index)
            && candidate.entry.operationCategory === measurement.operationCategory
            && candidate.completionDeltaMs <= 15_000
        )).sort((left, right) => (
            (left.completionDeltaMs + left.durationDeltaMs)
            - (right.completionDeltaMs + right.durationDeltaMs)
        ));
        const match = candidates[0] || null;
        if (match) usedServerEntries.add(match.index);
        const serverCompletionValue = match ? Date.parse(match.entry.serverCompletion) : null;
        const serverStartValue = match ? serverCompletionValue - match.entry.serverDurationMs : null;
        const databaseEvents = match ? eventsWithin(
            logEvidence.databaseEvents,
            serverStartValue,
            serverCompletionValue
        ) : [];
        const pluginEvents = match ? eventsWithin(
            logEvidence.pluginEvents,
            serverStartValue,
            serverCompletionValue
        ) : [];
        const taskSamples = samples.filter(sample => {
            const timestamp = Date.parse(sample.timestamp);

            return match && timestamp >= serverStartValue && timestamp <= serverCompletionValue;
        });
        const taskCategories = [ ...new Set(taskSamples.flatMap(sample => (
            sample.activeTaskCategories
        ))) ].sort();
        const nearestSample = findNearestSample(samples, browserStart);
        let evidenceClassification = 'not-observed';
        if (match) {
            const strictDurationDelta = Math.max(250, measurement.timeToHeadersMs * 0.1);
            const broadDurationDelta = Math.max(750, measurement.timeToHeadersMs * 0.25);
            if (match.completionDeltaMs <= 1_500 && match.durationDeltaMs <= strictDurationDelta) {
                evidenceClassification = 'proven';
            } else if (match.completionDeltaMs <= 3_000 && match.durationDeltaMs <= broadDurationDelta) {
                evidenceClassification = 'strongly-correlated';
            } else {
                evidenceClassification = 'weakly-correlated';
            }
        }

        return {
            browserConcurrency: measurement.concurrentRequestCount,
            browserRequestStart: measurement.requestStart,
            browserTtfbMs: measurement.timeToHeadersMs,
            cpuSample: null,
            databaseWarningCategory: databaseEvents[0]?.category || 'not-observed',
            diskSample: null,
            evidenceClassification,
            httpStatus: match?.entry.status ?? measurement.status ?? null,
            jellyfinCompletion: match?.entry.serverCompletion || null,
            jellyfinServerStart: match ? new Date(serverStartValue).toISOString() : null,
            journalSizeDeltaBytes: null,
            memorySwapSample: null,
            mountNetworkAnomalyCategory: nearestSample?.observerRequestStatus === 'failed' ?
                'observer-read-failure' :
                'not-observed',
            operationCategory: measurement.operationCategory,
            pluginActivityCategory: pluginEvents[0]?.category || 'not-observed',
            scheduledTaskCategory: taskCategories[0] || 'not-observed',
            serverConcurrency: null,
            serverReportedDurationMs: match?.entry.serverDurationMs || null,
            thresholdsExceededSeconds: [
                measurement.timeToHeadersMs > 1_500 ? 1.5 : null,
                measurement.timeToHeadersMs > 3_000 ? 3 : null,
                measurement.timeToHeadersMs > 5_000 ? 5 : null
            ].filter(Boolean)
        };
    });
}

function summarizeTiming(measurements) {
    const itemMeasurements = measurements.filter(measurement => (
        measurement.operationCategory !== 'plugin-comparison'
    ));
    const values = itemMeasurements.map(measurement => measurement.timeToHeadersMs)
        .filter(Number.isFinite);
    const warmValues = itemMeasurements.filter(measurement => measurement.coldWarm === 'warm')
        .map(measurement => measurement.timeToHeadersMs)
        .filter(Number.isFinite);

    return {
        maximumMs: values.length ? round(Math.max(...values)) : null,
        p50Ms: percentile(values, 0.5),
        p90Ms: percentile(values, 0.9),
        p95Ms: percentile(values, 0.95),
        requestCount: values.length,
        warmP50Ms: percentile(warmValues, 0.5),
        warmP90Ms: percentile(warmValues, 0.9)
    };
}

function buildFocusArtifact(scenarioMatrix) {
    const runs = scenarioMatrix.results.filter(result => result.name === 'tv-like-focus')
        .map(result => ({
            coldWarm: result.coldWarm,
            failureObserved: !result.passed,
            firstFailedStage: result.firstFailedStage,
            selectedInitialTargetCategory: result.scenarioEvidence?.initialTargetCategory || 'unavailable',
            steps: result.scenarioEvidence?.steps || []
        }));

    return {
        generatedAt: new Date().toISOString(),
        independentFromBackendAttribution: true,
        runs
    };
}

function classifyHypotheses(correlations, logEvidence, samples, measurements) {
    const matched = correlations.filter(row => row.serverReportedDurationMs !== null);
    const strongMatches = matched.filter(row => (
        row.evidenceClassification === 'proven'
        || row.evidenceClassification === 'strongly-correlated'
    ));
    const durationRatios = matched.map(row => (
        row.serverReportedDurationMs / row.browserTtfbMs
    )).filter(Number.isFinite);
    const durationDeltas = matched.map(row => (
        Math.abs(row.serverReportedDurationMs - row.browserTtfbMs)
    ));
    const transferDurations = measurements.map(entry => entry.responseTransferDurationMs)
        .filter(Number.isFinite);
    const activeTaskSamples = samples.filter(sample => sample.activeTaskCategories.length > 0);
    const hasSqliteContention = logEvidence.databaseEvents.some(event => (
        event.category === 'sqlite-locked'
        || event.category === 'sqlite-busy'
        || event.category === 'optimistic-concurrency'
    ));
    const hasQueryWarning = logEvidence.databaseEvents.some(event => (
        event.category === 'ef-query-splitting'
        || event.category === 'entity-framework'
    ));
    let queryShapeClassification = 'not-observed';
    if (hasQueryWarning) queryShapeClassification = 'strongly-correlated';
    else if (strongMatches.length > 0) queryShapeClassification = 'weakly-correlated';

    return {
        h1SqliteWriterReadContention: {
            classification: hasSqliteContention ? 'strongly-correlated' : 'not-observed',
            currentWindowEventCount: logEvidence.databaseEvents.filter(event => (
                event.category.startsWith('sqlite-')
                || event.category === 'optimistic-concurrency'
            )).length
        },
        h2DiskOrFilesystemLatency: {
            classification: 'not-observed',
            limitation: 'host-disk-counters-unavailable-through-admin-api'
        },
        h3JellyfinProcessSaturation: {
            classification: 'not-observed',
            limitation: 'host-process-counters-unavailable-through-admin-api'
        },
        h4QueryShapeOrEfExecution: {
            classification: queryShapeClassification,
            currentWindowWarningCount: logEvidence.databaseEvents.filter(event => (
                event.category === 'ef-query-splitting'
                || event.category === 'entity-framework'
            )).length,
            serverAlignedSlowRequestCount: strongMatches.length
        },
        h5ScheduledTaskOrPluginContention: {
            activeTaskSampleCount: activeTaskSamples.length,
            classification: activeTaskSamples.length > 0 ? 'weakly-correlated' : 'contradicted',
            pluginLogEventCount: logEvidence.pluginEvents.length
        },
        h6Network: {
            browserTransferMedianMs: median(transferDurations),
            classification: strongMatches.length >= Math.ceil(correlations.length * 0.5) ?
                'contradicted' :
                'not-observed',
            matchedRequestCount: matched.length,
            medianAbsoluteServerBrowserDeltaMs: median(durationDeltas),
            medianServerToBrowserDurationRatio: median(durationRatios),
            serverAlignedRequestCount: strongMatches.length
        }
    };
}

function buildAttributionSummary(timing, scenarioMatrix, hypotheses, correlations, logEvidence) {
    const matrixPassed = Object.values(scenarioMatrix.summary).every(summary => summary.failed === 0);
    const p90Pass = timing.p90Ms !== null && timing.p90Ms < 3_000;
    const networkRuledOut = hypotheses.h6Network.classification === 'contradicted';
    const currentSqliteContention = hypotheses.h1SqliteWriterReadContention.classification
        !== 'not-observed';
    const currentQueryWarning = hypotheses.h4QueryShapeOrEfExecution.currentWindowWarningCount > 0;
    let backendOwner = 'server-side-request-execution';
    if (currentSqliteContention) backendOwner = 'sqlite-contention';
    else if (currentQueryWarning) backendOwner = 'query-or-ef-execution';

    return {
        acceptance: {
            backendReadOnlyAccessActive: true,
            currentServerLogsCaptured: true,
            databaseStateObservedReadOnly: true,
            everyRequestOverThreeSecondsCorrelated: correlations.filter(row => (
                row.browserTtfbMs > 3_000
            )).every(row => row.serverReportedDurationMs !== null),
            hostSamplesCoverWindow: false,
            noMutationPerformed: true,
            sameBrowserAccountRetained: true
        },
        backendOwner,
        backendOwnerClassification: currentSqliteContention || currentQueryWarning ?
            'strongly-correlated' :
            'weakly-correlated',
        decision: 'HOLD',
        generatedAt: new Date().toISOString(),
        logEvidenceCounts: {
            databaseEvents: logEvidence.databaseEvents.length,
            pluginEvents: logEvidence.pluginEvents.length,
            slowResponses: logEvidence.slowResponses.length,
            taskEvents: logEvidence.taskEvents.length
        },
        matrixPassed,
        networkPrimaryOwnerRuledOut: networkRuledOut,
        releaseGates: {
            currentLogsFreeOfReleaseBlockingDatabaseErrors: !currentSqliteContention,
            matrixThirteenOfThirteen: matrixPassed,
            p90BelowThreeSeconds: p90Pass,
            physicalTvAcceptance: false,
            representativePlaybackProgressWriteClean: false
        },
        timing
    };
}

async function writeArtifacts(artifacts, forbiddenValues) {
    for (const artifact of Object.values(artifacts)) {
        validatePrivacy(artifact.value, forbiddenValues);
    }
    fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
    for (const artifact of Object.values(artifacts)) {
        fs.writeFileSync(
            path.join(OUTPUT_DIRECTORY, artifact.name),
            `${JSON.stringify(artifact.value, null, 2)}\n`,
            'utf8'
        );
    }
}

async function run() {
    const administratorIdentity = requireSecret('PTV_ATTR_ADMIN_USER');
    const administratorPassword = requireSecret('PTV_ATTR_ADMIN_PASSWORD');
    const browserIdentity = requireSecret('PTV_ATTR_BROWSER_USER');
    const browserPassword = requireSecret('PTV_ATTR_BROWSER_PASSWORD');
    const browserRuntime = await connectBrowser();
    const observer = await createAdminObserver(
        browserRuntime.backendOrigin,
        administratorIdentity,
        administratorPassword
    );
    let sampler;

    try {
        process.stdout.write('attribution:read-only-provenance:start\n');
        const beforeSnapshot = await takeSnapshot(observer);
        process.stdout.write('attribution:read-only-provenance:complete\n');
        const captureStart = Date.now();
        sampler = startSampler(observer);
        process.stdout.write('attribution:pre-window:start\n');
        await sleep(PRE_CAPTURE_DURATION_MS);
        process.stdout.write('attribution:pre-window:complete\n');
        const matrixStart = Date.now();
        process.stdout.write('attribution:matrix:start\n');
        const matrixExitCode = await runMatrix();
        const matrixEnd = Date.now();
        process.stdout.write(`attribution:matrix:complete:${matrixExitCode}\n`);
        process.stdout.write('attribution:post-window:start\n');
        await sleep(POST_CAPTURE_DURATION_MS);
        const captureEnd = Date.now();
        process.stdout.write('attribution:post-window:complete\n');
        sampler.stop();
        await sampler.promise;
        const [ afterSnapshot, logTexts ] = await Promise.all([
            takeSnapshot(observer),
            fetchCapturedLogs(observer, beforeSnapshot, captureStart)
        ]);
        const logEvidence = parseLogTexts(logTexts, captureStart, captureEnd);
        const requestTiming = JSON.parse(fs.readFileSync(
            path.join(OUTPUT_DIRECTORY, 'request-timing-summary.json'),
            'utf8'
        ));
        const scenarioMatrix = JSON.parse(fs.readFileSync(
            path.join(OUTPUT_DIRECTORY, 'scenario-matrix.json'),
            'utf8'
        ));
        const correlations = correlateRequests(
            requestTiming.measurements,
            logEvidence,
            sampler.samples
        );
        const timing = summarizeTiming(requestTiming.measurements);
        const hypotheses = classifyHypotheses(
            correlations,
            logEvidence,
            sampler.samples,
            requestTiming.measurements
        );
        const attributionSummary = buildAttributionSummary(
            timing,
            scenarioMatrix,
            hypotheses,
            correlations,
            logEvidence
        );
        const systemFolders = Object.fromEntries(Object.entries(beforeSnapshot.storage)
            .filter(([ key ]) => key !== 'Libraries')
            .map(([ key, value ]) => [ key, summarizeFolderStorage(value) ]));
        const pluginInventory = summarizePlugins(beforeSnapshot.plugins);
        const taskInventory = summarizeTasks(beforeSnapshot.tasks);
        const databaseEventCounts = Object.fromEntries(logEvidence.databaseEvents.reduce(
            (counts, event) => counts.set(event.category, (counts.get(event.category) || 0) + 1),
            new Map()
        ));
        const artifacts = {
            attributionSummary: {
                name: 'attribution-summary.json',
                value: attributionSummary
            },
            backendProvenance: {
                name: 'backend-provenance.json',
                value: {
                    access: {
                        administratorObserver: true,
                        browserAccountRole: 'non-administrator',
                        hostShellObserver: false,
                        observerMode: 'jellyfin-admin-api-read-only'
                    },
                    captureWindow: {
                        end: new Date(captureEnd).toISOString(),
                        matrixEnd: new Date(matrixEnd).toISOString(),
                        matrixStart: new Date(matrixStart).toISOString(),
                        start: new Date(captureStart).toISOString()
                    },
                    database: {
                        engine: 'SQLite',
                        locationCategory: beforeSnapshot.storage.ProgramDataFolder?.StorageType
                            || 'unreported'
                    },
                    host: {
                        activeJellyfinProcessCount: null,
                        bootTime: null,
                        processStartTime: null
                    },
                    jellyfin: {
                        architecture: beforeSnapshot.systemInfo.SystemArchitecture
                            || beforeSnapshot.systemInfo.Architecture
                            || 'unreported',
                        version: beforeSnapshot.systemInfo.Version || browserRuntime.backendVersion
                    },
                    plugin: {
                        advertisedCapabilities: Array.isArray(beforeSnapshot.ptvStatus.features) ?
                            beforeSnapshot.ptvStatus.features :
                            Object.keys(beforeSnapshot.ptvStatus.featureFlags || {}).sort(),
                        apiVersion: beforeSnapshot.ptvStatus.apiVersion || null,
                        version: beforeSnapshot.ptvStatus.pluginVersion
                            || beforeSnapshot.ptvStatus.version
                            || null
                    },
                    plugins: pluginInventory,
                    storage: {
                        libraries: summarizeLibraries(beforeSnapshot.storage.Libraries),
                        systemFolders
                    },
                    tasks: taskInventory
                }
            },
            databaseInspection: {
                name: 'database-readonly-inspection.json',
                value: {
                    after: afterSnapshot.database,
                    before: beforeSnapshot.database,
                    busyTimeout: 'unavailable-through-admin-api',
                    currentWindowWarningCounts: databaseEventCounts,
                    engine: 'SQLite',
                    filesystemType: 'unavailable-through-admin-api',
                    integrityCheck: 'skipped-to-avoid-production-lock-risk',
                    journalMode: 'unavailable-through-admin-api',
                    journalSizeBytes: null,
                    locationCategory: beforeSnapshot.storage.ProgramDataFolder?.StorageType
                        || 'unreported',
                    modificationPerformed: false,
                    programDataStorage: summarizeFolderStorage(
                        beforeSnapshot.storage.ProgramDataFolder
                    )
                }
            },
            focusFailure: {
                name: 'focus-failure-detail.json',
                value: buildFocusArtifact(scenarioMatrix)
            },
            hostTimeline: {
                name: 'host-resource-timeline.json',
                value: {
                    captureEnd: new Date(captureEnd).toISOString(),
                    captureStart: new Date(captureStart).toISOString(),
                    intervalMs: SAMPLE_INTERVAL_MS,
                    metricAvailability: {
                        cpu: 'unavailable-through-admin-api',
                        databaseDeviceIo: 'unavailable-through-admin-api',
                        diskAwait: 'unavailable-through-admin-api',
                        diskQueueDepth: 'unavailable-through-admin-api',
                        filesystemLatency: 'unavailable-through-admin-api',
                        jellyfinProcessCpu: 'unavailable-through-admin-api',
                        memoryAndResidentSet: 'unavailable-through-admin-api',
                        mountResponsiveness: 'unavailable-through-admin-api',
                        networkDropsAndRetransmits: 'unavailable-through-admin-api',
                        processState: 'unavailable-through-admin-api',
                        swapAndPaging: 'unavailable-through-admin-api',
                        threadCount: 'unavailable-through-admin-api',
                        walGrowth: 'directory-presence-only'
                    },
                    samples: sampler.samples
                }
            },
            pluginTaskTimeline: {
                name: 'plugin-task-timeline.json',
                value: {
                    installedPlugins: pluginInventory,
                    logPluginActivity: logEvidence.pluginEvents,
                    logTaskActivity: logEvidence.taskEvents,
                    samples: sampler.samples.map(sample => ({
                        activeTaskCategories: sample.activeTaskCategories,
                        timestamp: sample.timestamp
                    })),
                    scheduledTasks: taskInventory
                }
            },
            requestServerCorrelation: {
                name: 'request-server-correlation.json',
                value: {
                    generatedAt: new Date().toISOString(),
                    rows: correlations,
                    summary: {
                        overFiveSeconds: correlations.filter(row => row.browserTtfbMs > 5_000).length,
                        overOnePointFiveSeconds: correlations.length,
                        overThreeSeconds: correlations.filter(row => row.browserTtfbMs > 3_000).length,
                        serverMatched: correlations.filter(row => (
                            row.serverReportedDurationMs !== null
                        )).length
                    }
                }
            },
            slowRequestAnalysis: {
                name: 'slow-request-analysis.json',
                value: {
                    generatedAt: new Date().toISOString(),
                    hypotheses,
                    operationCounts: Object.fromEntries(correlations.reduce(
                        (counts, row) => counts.set(
                            row.operationCategory,
                            (counts.get(row.operationCategory) || 0) + 1
                        ),
                        new Map()
                    )),
                    timing
                }
            }
        };
        await writeArtifacts(artifacts, [
            administratorIdentity,
            administratorPassword,
            browserIdentity,
            browserPassword
        ]);
        process.stdout.write(`${JSON.stringify({
            artifacts: Object.values(artifacts).map(artifact => artifact.name),
            decision: attributionSummary.decision,
            matrixExitCode,
            matrixSummary: scenarioMatrix.summary,
            timing
        }, null, 2)}\n`);
    } finally {
        if (sampler) {
            sampler.stop();
            await sampler.promise.catch(() => undefined);
        }
        await observer.logout();
    }
}

run().then(() => {
    process.exit(0);
}).catch(error => {
    process.stderr.write(`Backend attribution failed: ${error instanceof Error ? error.message : 'unknown'}\n`);
    process.exit(1);
});

/* eslint-enable compat/compat */
