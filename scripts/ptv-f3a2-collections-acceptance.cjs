#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const {
    assertShareSafeEvidence,
    classifyRequest,
    createOneShotFailureGate,
    exactRequestKey,
    safeErrorCategory,
    summarizeRequestRecords
} = require('./ptv-f3a2-harness-utils.cjs');

const cdpUrl = process.env.PTV_DISCOVERY_CDP_URL || 'http://127.0.0.1:9222';
const outputPath = path.resolve(process.env.PTV_F3A2_EVIDENCE_PATH || 'test-results/f3a2/collections-acceptance.json');
const cycleCount = Math.max(1, Number.parseInt(process.env.PTV_F3A2_CYCLES || '3', 10));
const injectFailure = process.env.PTV_F3A2_INJECT_ONCE === '1';
const buildMode = process.env.PTV_F3A2_BUILD_MODE === 'production' ? 'production' : 'development';

const visibleReadySelector = [
    '.ptv-collection-card',
    '.ptv-collection-empty',
    '.ptv-collection-error',
    '.ptv-collections-error'
].join(',');

const routeCategory = (hash) => {
    if (hash.startsWith('#/collections')) return 'collections';
    if (hash.startsWith('#/details')) return 'details';
    if (hash.startsWith('#/search')) return 'search';
    if (hash.startsWith('#/home')) return 'home';
    return 'other';
};

const instrumentNextDocument = async (page) => {
    await page.addInitScript(() => {
        const state = window.__PTV_F3A2_EVIDENCE__ = {
            listenerAdds: 0,
            listenerRemoves: 0,
            longTasks: [],
            mutationActive: 0,
            mutationCreated: 0,
            socketActive: { jellyfin: 0, hmr: 0, other: 0 },
            socketCreated: { jellyfin: 0, hmr: 0, other: 0 }
        };

        const classifySocket = (rawUrl) => {
            try {
                const pathname = new URL(rawUrl, location.href).pathname.toLowerCase();
                if (pathname.includes('/socket')) return 'jellyfin';
                if (pathname === '/ws' || pathname.includes('webpack')) return 'hmr';
            } catch {
                // Category remains private and bounded.
            }
            return 'other';
        };

        const NativeWebSocket = window.WebSocket;
        class ObservedWebSocket extends NativeWebSocket {
            constructor(...args) {
                super(...args);
                const category = classifySocket(args[0]);
                state.socketCreated[category] += 1;
                state.socketActive[category] += 1;
                this.addEventListener('close', () => {
                    state.socketActive[category] = Math.max(0, state.socketActive[category] - 1);
                }, { once: true });
            }
        }
        Object.defineProperties(ObservedWebSocket, {
            CLOSED: { value: NativeWebSocket.CLOSED },
            CLOSING: { value: NativeWebSocket.CLOSING },
            CONNECTING: { value: NativeWebSocket.CONNECTING },
            OPEN: { value: NativeWebSocket.OPEN }
        });
        window.WebSocket = ObservedWebSocket;

        const nativeAdd = EventTarget.prototype.addEventListener;
        const nativeRemove = EventTarget.prototype.removeEventListener;
        EventTarget.prototype.addEventListener = function (...args) {
            state.listenerAdds += 1;
            return nativeAdd.apply(this, args);
        };
        EventTarget.prototype.removeEventListener = function (...args) {
            state.listenerRemoves += 1;
            return nativeRemove.apply(this, args);
        };

        const NativeMutationObserver = window.MutationObserver;
        window.MutationObserver = class extends NativeMutationObserver {
            constructor(callback) {
                state.mutationCreated += 1;
                state.mutationActive += 1;
                super(callback);
            }
            disconnect() {
                state.mutationActive = Math.max(0, state.mutationActive - 1);
                return super.disconnect();
            }
        };

        try {
            new PerformanceObserver((list) => {
                state.longTasks.push(...list.getEntries().map((entry) => Math.round(entry.duration * 10) / 10));
            }).observe({ buffered: true, type: 'longtask' });
        } catch {
            // Long-task observation is optional browser evidence.
        }
    });
};

const getCheckpoint = async (page) => page.evaluate(() => {
    const evidence = window.__PTV_F3A2_EVIDENCE__ || {};
    const runtime = window.__PTV_RUNTIME_STATE__ || {};
    const app = window.__PTV_RUNTIME_APP_STATE__ || {};
    const bootstrap = window.__PTV_WEB_APP_BOOTSTRAP__ || {};
    return {
        appCreateCount: Number(app.createCount || 0),
        bootstrapCount: Number(bootstrap.initializationCount || 0),
        brokenVisibleImageCount: [...document.images].filter((image) => (
            image.getClientRects().length && image.complete && image.naturalWidth === 0
        )).length,
        collectionCardCount: document.querySelectorAll('.ptv-collection-card').length,
        domCount: document.getElementsByTagName('*').length,
        listenerBalance: Number(evidence.listenerAdds || 0) - Number(evidence.listenerRemoves || 0),
        longTasks: [...(evidence.longTasks || [])],
        mutationActive: Number(evidence.mutationActive || 0),
        route: routeCategory(location.hash),
        runtimeCreateCount: Number(runtime.runtimeCreateCount || 0),
        runtimeListenerCount: Number(runtime.listenerRegistrationCount || 0),
        sockets: evidence.socketActive || { jellyfin: 0, hmr: 0, other: 0 }
    };
});

const run = async () => {
    const browser = await chromium.connectOverCDP(cdpUrl);
    const context = browser.contexts()[0];
    const pages = context?.pages() || [];
    const page = pages.find((candidate) => !/(?:login|selectserver)/i.test(candidate.url())) || pages[0];
    if (!page) throw new Error('No browser page is available on the configured CDP endpoint');

    await instrumentNextDocument(page);

    const records = [];
    const pending = new WeakMap();
    let activeRequests = 0;
    let peakConcurrency = 0;
    let stageName = 'bootstrap';

    page.on('request', (request) => {
        if (!['fetch', 'xhr'].includes(request.resourceType())) return;
        const record = {
            category: classifyRequest(request.url()),
            durationMs: null,
            failed: false,
            keyHash: exactRequestKey(request.method(), request.url()),
            stage: stageName,
            startMs: performance.now(),
            status: null
        };
        records.push(record);
        pending.set(request, record);
        activeRequests += 1;
        peakConcurrency = Math.max(peakConcurrency, activeRequests);
    });
    const finishRequest = (request, status, failed) => {
        const record = pending.get(request);
        if (!record || record.durationMs !== null) return;
        record.durationMs = Math.round((performance.now() - record.startMs) * 10) / 10;
        record.status = status;
        record.failed = failed;
        activeRequests = Math.max(0, activeRequests - 1);
    };
    page.on('response', (response) => finishRequest(response.request(), response.status(), false));
    page.on('requestfailed', (request) => finishRequest(request, null, true));

    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForFunction(() => (
        !/(?:login|selectserver)/i.test(location.hash) && Boolean(window.ApiClient)
    ), null, { timeout: 60_000 });

    const navigate = async (hash, timeout = 45_000) => {
        const startedAt = performance.now();
        await page.evaluate((nextHash) => { location.hash = nextHash; }, hash);
        await page.locator(visibleReadySelector).first().waitFor({ state: 'visible', timeout });
        const state = await page.evaluate(() => ({
            cards: document.querySelectorAll('.ptv-collection-card').length,
            empty: Boolean(document.querySelector('.ptv-collection-empty')),
            error: Boolean(document.querySelector('.ptv-collection-error, .ptv-collections-error'))
        }));
        return { ...state, durationMs: Math.round((performance.now() - startedAt) * 10) / 10 };
    };

    const runStage = async (stages, name, action) => {
        stageName = name;
        const startedAt = performance.now();
        try {
            const result = await action();
            stages.push({ durationMs: Math.round((performance.now() - startedAt) * 10) / 10, name, pass: true, result });
            return result;
        } catch (error) {
            stages.push({ durationMs: Math.round((performance.now() - startedAt) * 10) / 10, error: safeErrorCategory(error), name, pass: false });
            return null;
        }
    };

    let retry = { enabled: false };
    if (injectFailure) {
        const gate = createOneShotFailureGate();
        const handler = async (route) => {
            const category = classifyRequest(route.request().url());
            if (gate.tryConsume(category)) return route.abort('connectionfailed');
            return route.continue();
        };
        await page.route('**/*', handler);
        const stages = [];
        const first = await runStage(stages, 'retry-failure', () => navigate('#/collections'));
        let recovered = false;
        if (!first || first.error || first.empty) {
            const retryButton = page.getByRole('button', { name: /retry/i }).filter({ visible: true }).first();
            if (await retryButton.count()) {
                await retryButton.click();
                await page.locator('.ptv-collection-card').first().waitFor({ state: 'visible', timeout: 45_000 });
                recovered = true;
            }
        }
        await page.unroute('**/*', handler);
        retry = { enabled: true, gate: gate.summary(), recovered, stages };
    }

    const cycles = [];
    for (let cycle = 1; cycle <= cycleCount; cycle += 1) {
        const before = await getCheckpoint(page);
        const stages = [];
        let selectedTitle = '';
        let searchResultOpened = false;

        await runStage(stages, 'landing', () => navigate('#/collections'));
        await runStage(stages, 'featured', () => navigate('#/collections?view=featured'));
        await runStage(stages, 'all', async () => {
            const result = await navigate('#/collections?view=all');
            const card = page.locator('.ptv-collection-card[data-ptv-collection-source="jellyfin"]').first();
            await card.waitFor({ state: 'visible', timeout: 30_000 });
            selectedTitle = (await card.innerText()).split('\n')[0].trim();
            return result;
        });
        const details = await runStage(stages, 'collection-details', async () => {
            await page.locator('.ptv-collection-card[data-ptv-collection-source="jellyfin"] a').first().click();
            await page.locator('.ptv-collection-details, .ptv-collection-details-page').first().waitFor({ state: 'visible', timeout: 30_000 });
            return { ready: true };
        });
        const member = details && await runStage(stages, 'member-details', async () => {
            await page.locator('.ptv-collection-details a[href*="#/details"], .ptv-collection-details-page a[href*="#/details"]').first().click();
            await page.waitForFunction(() => location.hash.startsWith('#/details'), null, { timeout: 30_000 });
            return { ready: true };
        });
        if (member) await runStage(stages, 'back-to-collection', async () => {
            await page.goBack({ timeout: 30_000 }).catch(() => undefined);
            await page.locator('.ptv-collection-details, .ptv-collection-details-page').first().waitFor({ state: 'visible', timeout: 30_000 });
            return { restored: true };
        });
        if (details) await runStage(stages, 'back-to-collections', async () => {
            await page.goBack({ timeout: 30_000 }).catch(() => undefined);
            await page.locator('.ptv-collections-page').waitFor({ state: 'visible', timeout: 30_000 });
            return { restored: true };
        });
        await runStage(stages, 'search-collection', async () => {
            await page.evaluate(() => { location.hash = '#/search'; });
            const input = page.locator('input[type="search"]:visible').first();
            await input.waitFor({ state: 'visible', timeout: 15_000 });
            await input.fill(selectedTitle);
            await page.getByRole('button', { name: 'Collections', exact: true }).filter({ visible: true }).first().click();
            const result = page.locator('a[href*="#/collections/"]:visible').first();
            await result.waitFor({ state: 'visible', timeout: 15_000 });
            await result.click();
            await page.locator('.ptv-collection-details, .ptv-collection-details-page').first().waitFor({ state: 'visible', timeout: 30_000 });
            searchResultOpened = true;
            return { resultOpened: true };
        });
        if (searchResultOpened) await runStage(stages, 'back-to-search', async () => {
            await page.goBack({ timeout: 30_000 }).catch(() => undefined);
            await page.locator('input[type="search"]:visible').first().waitFor({ state: 'visible', timeout: 30_000 });
            return { restored: true };
        });
        await runStage(stages, 'home', async () => {
            await page.evaluate(() => { location.hash = '#/home'; });
            await page.waitForFunction(() => location.hash.startsWith('#/home'), null, { timeout: 15_000 });
            return { ready: true };
        });
        await runStage(stages, 'collections-return', () => navigate('#/collections'));

        const after = await getCheckpoint(page);
        cycles.push({
            cycle,
            ownershipDelta: {
                app: after.appCreateCount - before.appCreateCount,
                bootstrap: after.bootstrapCount - before.bootstrapCount,
                dom: after.domCount - before.domCount,
                mutation: after.mutationActive - before.mutationActive,
                runtime: after.runtimeCreateCount - before.runtimeCreateCount,
                runtimeListeners: after.runtimeListenerCount - before.runtimeListenerCount
            },
            pass: stages.every((stage) => stage.pass),
            stages
        });
    }

    const finalCheckpoint = await getCheckpoint(page);
    const evidence = {
        buildMode,
        cycles,
        finalCheckpoint,
        peakConcurrency,
        requestSummary: summarizeRequestRecords(records),
        retry,
        schemaVersion: 1
    };
    assertShareSafeEvidence(evidence);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

    await browser.close();
    process.stdout.write(`${JSON.stringify({ cycles: cycles.length, output: 'sanitized-evidence', pass: cycles.every((cycle) => cycle.pass) })}\n`);
};

run().catch((error) => {
    process.stderr.write(`F3A2 harness failed: ${safeErrorCategory(error)}\n`);
    process.exitCode = 1;
});
