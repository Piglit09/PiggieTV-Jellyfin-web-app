const fs = require('node:fs');
const path = require('node:path');
const { URL: NodeUrl } = require('node:url');
const { chromium } = require(path.resolve(process.cwd(), 'node_modules', 'playwright'));

const baseUrl = process.env.PTV_SOAK_BASE_URL || 'http://localhost:8082/';
const durationMinutes = Number(process.env.PTV_SOAK_MINUTES || 30);
const dwellMs = Number(process.env.PTV_SOAK_DWELL_MS || 2500);
const reportTag = process.env.PTV_SOAK_REPORT_TAG || 'current';
const outputDir = path.resolve(process.cwd(), 'test-results', 'authenticated-soak');
const outputPath = path.join(outputDir, `soak-report-${reportTag}.json`);
const routeSteps = [
    { hash: '#/home', id: 'home', native: true },
    { hash: '#/movies', id: 'movies', native: true, openDetails: true },
    { hash: '#/shows', id: 'shows', native: true, openDetails: true },
    { hash: '#/music', id: 'music', native: true },
    { hash: '#/music/artists', id: 'artists', native: true },
    { hash: '#/music/albums', id: 'albums', native: true },
    { hash: '#/search', id: 'search', native: true },
    { hash: '#/mypreferencesmenu', id: 'settings' }
];

function percentile(values, percentileValue) {
    if (!values.length) return 0;

    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1)
    );

    return Math.round(sorted[index] * 10) / 10;
}

function sanitizeUrl(rawUrl) {
    try {
        const url = new NodeUrl(rawUrl);

        return url.pathname;
    } catch {
        return '[invalid-url]';
    }
}

function nativeOwnerRoute(rawHash) {
    const pathValue = rawHash.replace(/^#/, '').split('?')[0];

    for (const root of ['/movies', '/shows', '/music', '/reading', '/collections']) {
        if (pathValue === root || pathValue.startsWith(`${root}/`)) return root;
    }

    return pathValue;
}

async function findPtvPage(browser) {
    let fallbackPage = null;

    for (const context of browser.contexts()) {
        for (const page of context.pages()) {
            if (!page.url().startsWith(baseUrl)) continue;
            fallbackPage ||= page;

            const authenticated = await page.evaluate(() => Boolean(
                window.ApiClient?.getCurrentUserId?.() && window.ApiClient?.accessToken?.()
            )).catch(() => false);

            if (authenticated) return page;
        }
    }

    if (fallbackPage) return fallbackPage;
    throw new Error('PiggieTV Chrome page was not found.');
}

async function waitForAuthenticatedClient(page, timeout = 30_000) {
    return page.waitForFunction(() => Boolean(
        window.ApiClient?.getCurrentUserId?.() && window.ApiClient?.accessToken?.()
    ), null, { timeout }).then(() => true).catch(() => false);
}

async function restoreSavedServerSession(page) {
    if (await waitForAuthenticatedClient(page, 2000)) return;

    await page.evaluate(() => {
        window.location.hash = '#/selectserver';
    });
    const selectedServer = await page.waitForFunction(() => {
        const isVisible = element => {
            const bounds = element.getBoundingClientRect();
            const style = getComputedStyle(element);

            return bounds.width > 0
                && bounds.height > 0
                && style.display !== 'none'
                && style.visibility !== 'hidden';
        };
        const serverButton = [...document.querySelectorAll('button')]
            .filter(isVisible)
            .find(button => {
                const text = button.textContent?.trim();

                return text && text !== 'Connect' && text !== 'Delete';
            });

        serverButton?.click();
        return Boolean(serverButton);
    }, null, { timeout: 15_000 }).then(() => true).catch(() => false);

    if (!selectedServer) throw new Error('Saved Jellyfin server was not available for reconnect.');

    const connectReady = await page.waitForFunction(() => (
        [...document.querySelectorAll('button')].some(button => (
            button.textContent?.trim() === 'Connect'
            && button.getBoundingClientRect().width > 0
            && button.getBoundingClientRect().height > 0
        ))
    ), null, { timeout: 15_000 }).then(() => true).catch(() => false);

    if (!connectReady) throw new Error('Saved Jellyfin server connect action did not become ready.');

    await page.evaluate(() => {
        const connectButton = [...document.querySelectorAll('button')]
            .find(button => button.textContent?.trim() === 'Connect');

        connectButton?.click();
    });

    if (!await waitForAuthenticatedClient(page)) {
        throw new Error('Saved Jellyfin server session could not be restored.');
    }
}

async function readListenerCounts(context, page) {
    try {
        const session = await context.newCDPSession(page);
        const result = await session.send('Runtime.evaluate', {
            expression: `(() => {
                const classify = target => {
                    const groups = getEventListeners(target);
                    let automation = 0;
                    let raw = 0;

                    for (const [type, listeners] of Object.entries(groups)) {
                        raw += listeners.length;

                        for (const entry of listeners) {
                            const listenerSource = String(entry.listener);
                            const isPlaywrightListener = type === '__playwright_global_listeners_check__'
                                || (
                                    entry.useCapture
                                    && entry.listener?.name === 'listener'
                                    && listenerSource.includes('_hitTargetInterceptor')
                                );

                            if (isPlaywrightListener) automation += 1;
                        }
                    }

                    return {
                        application: raw - automation,
                        automation,
                        raw
                    };
                };
                const documentCounts = classify(document);
                const windowCounts = classify(window);

                return {
                    automationDocument: documentCounts.automation,
                    automationWindow: windowCounts.automation,
                    document: documentCounts.application,
                    rawDocument: documentCounts.raw,
                    rawWindow: windowCounts.raw,
                    window: windowCounts.application
                };
            })()`,
            includeCommandLineAPI: true,
            returnByValue: true
        });
        await session.detach();

        return result.result.value || null;
    } catch {
        return null;
    }
}

async function readSnapshot(page, cycle, step) {
    return page.evaluate(({ cycleNumber, stepId }) => {
        const memory = Reflect.get(performance, 'memory');
        const runtime = window.PTV?.runtime?.report?.() || null;
        const stability = window.PTV?.runtimeStability?.report?.() || null;
        const requests = window.PTV?.requestCoordinator?.report?.() || null;
        const images = window.PTV?.imageManager?.report?.() || null;
        const performanceReport = window.PTV?.performanceMonitor?.report?.() || null;
        const timers = window.__ptvSoakTimerProbe?.report?.() || null;
        const frames = window.__ptvSoakFrameProbe?.report?.() || null;

        return {
            activeImageRequests: images?.activeRequests ?? null,
            activeNativeShellCount: stability?.activeNativeShellCount ?? null,
            activeShellCount: stability?.activeShellCount ?? null,
            cycle: cycleNumber,
            domNodes: document.getElementsByTagName('*').length,
            duplicateListenerSuppressedCount: runtime?.duplicateListenerSuppressedCount ?? null,
            duplicateRuntimeSuppressedCount: runtime?.duplicateFeatureRegistrationSuppressedCount ?? null,
            frameProbe: frames,
            hash: window.location.hash,
            heapUsed: memory?.usedJSHeapSize ?? null,
            inFlightRequests: requests?.inFlightCount ?? null,
            listenerRegistrationCount: runtime?.listenerRegistrationCount ?? null,
            longTaskCount: performanceReport?.longTaskCount ?? null,
            queuedImageRequests: images?.queuedRequests ?? null,
            routePageMountCount: performanceReport?.counters?.routePageMountCount ?? null,
            runtimeCreateCount: runtime?.runtimeCreateCount ?? null,
            shellMountCount: performanceReport?.counters?.shellMountCount ?? null,
            step: stepId,
            timeoutCount: performanceReport?.counters?.timeoutCount ?? null,
            timerProbe: timers,
            visibleShellCount: [...document.querySelectorAll('.ptv-shell-header')]
                .filter(element => {
                    const bounds = element.getBoundingClientRect();
                    const style = getComputedStyle(element);

                    return bounds.width > 0
                        && bounds.height > 0
                        && style.display !== 'none'
                        && style.visibility !== 'hidden';
                }).length
        };
    }, { cycleNumber: cycle, stepId: step });
}

async function navigate(page, hash, native = false) {
    const startedAt = performance.now();

    await page.evaluate(nextHash => {
        window.location.hash = nextHash;
    }, hash);
    await page.waitForFunction(
        expectedHash => window.location.hash === expectedHash,
        hash,
        { timeout: 15_000 }
    );
    let ownerReady = true;

    if (native) {
        const expectedRoute = nativeOwnerRoute(hash);

        ownerReady = await page.waitForFunction(route => (
            (window.PTV?.runtimeStability?.report?.().nativeShellInstances || [])
                .some(instance => {
                    const ownerPath = String(instance.route || '').replace(/^#/, '').split('?')[0];
                    const ownerRoot = ['/movies', '/shows', '/music', '/reading', '/collections']
                        .find(root => ownerPath === root || ownerPath.startsWith(`${root}/`));

                    return (ownerRoot || ownerPath) === route;
                })
        ), expectedRoute, { timeout: 15_000 }).then(() => true).catch(() => false);
    }

    const ownerReadyMs = Math.round((performance.now() - startedAt) * 10) / 10;
    await page.waitForTimeout(dwellMs);

    return {
        ownerReady,
        ownerReadyMs,
        observedDurationMs: Math.round((performance.now() - startedAt) * 10) / 10
    };
}

async function openDetailsAndReturn(page, sourceHash) {
    const detailsSelector = [
        'a.ptv-browse-card[href*="/details?"]',
        'a.ptv-browse-primary-action[href*="/details?"]'
    ].join(', ');

    await page.waitForFunction(selector => (
        [...document.querySelectorAll(selector)].some(element => {
            const bounds = element.getBoundingClientRect();
            const style = getComputedStyle(element);

            return bounds.width > 0
                && bounds.height > 0
                && style.display !== 'none'
                && style.visibility !== 'hidden';
        })
    ), detailsSelector, { timeout: 15_000 }).catch(() => undefined);

    const href = await page.evaluate(() => {
        const anchors = [...document.querySelectorAll(
            'a.ptv-browse-card[href*="/details?"], a.ptv-browse-primary-action[href*="/details?"]'
        )];
        const visibleAnchor = anchors.find(element => {
            const bounds = element.getBoundingClientRect();

            return bounds.width > 0 && bounds.height > 0;
        });

        return visibleAnchor?.getAttribute('href') || null;
    });

    if (!href) {
        return {
            backFallback: false,
            detailsOpened: false,
            detailsRouteDurationMs: null,
            returnDurationMs: null
        };
    }

    const detailsStartedAt = performance.now();
    await page.evaluate(nextHash => {
        window.location.hash = nextHash;
    }, href);
    await page.waitForFunction(
        () => window.location.hash.includes('/details?'),
        null,
        { timeout: 15_000 }
    );
    await page.waitForFunction(() => (
        [...document.querySelectorAll('#itemDetailPage, .itemDetailPage')]
            .some(element => {
                const bounds = element.getBoundingClientRect();
                const style = getComputedStyle(element);

                return bounds.width > 0
                    && bounds.height > 0
                    && style.display !== 'none'
                    && style.visibility !== 'hidden';
            })
    ), null, { timeout: 20_000 });
    await page.waitForTimeout(dwellMs);
    const detailsRouteDurationMs = Math.round((performance.now() - detailsStartedAt) * 10) / 10;

    const returnStartedAt = performance.now();
    await page.evaluate(() => window.history.back());
    let backFallback = false;

    try {
        await page.waitForFunction(
            expectedHash => window.location.hash === expectedHash,
            sourceHash,
            { timeout: 10_000 }
        );
    } catch {
        backFallback = true;
        await page.evaluate(nextHash => {
            window.location.hash = nextHash;
        }, sourceHash);
        await page.waitForFunction(
            expectedHash => window.location.hash === expectedHash,
            sourceHash,
            { timeout: 15_000 }
        );
    }

    await page.waitForTimeout(dwellMs);

    return {
        backFallback,
        detailsOpened: true,
        detailsRouteDurationMs,
        returnDurationMs: Math.round((performance.now() - returnStartedAt) * 10) / 10
    };
}

async function main() {
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
        throw new Error('PTV_SOAK_MINUTES must be a positive number.');
    }

    fs.mkdirSync(outputDir, { recursive: true });
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
    const page = await findPtvPage(browser);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await restoreSavedServerSession(page);
    const context = page.context();
    const startedAt = Date.now();
    const deadline = startedAt + durationMinutes * 60_000;
    const snapshots = [];
    const routeDurations = [];
    const detailsResults = [];
    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    let cycle = 0;

    page.on('console', message => {
        if (message.type() === 'error') {
            consoleErrors.push({
                hash: page.url().split('#')[1] || '',
                text: message.text().slice(0, 500)
            });
        }
    });
    page.on('pageerror', error => {
        pageErrors.push(String(error?.message || error).slice(0, 500));
    });
    page.on('requestfailed', request => {
        failedRequests.push({
            error: request.failure()?.errorText || 'unknown',
            path: sanitizeUrl(request.url()),
            resourceType: request.resourceType()
        });
    });

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.evaluate(() => {
        if (window.__ptvSoakTimerProbe) return;

        const nativeSetTimeout = window.setTimeout.bind(window);
        const nativeClearTimeout = window.clearTimeout.bind(window);
        const nativeSetInterval = window.setInterval.bind(window);
        const nativeClearInterval = window.clearInterval.bind(window);
        const timeouts = new Set();
        const intervals = new Set();
        let createdTimeouts = 0;
        let createdIntervals = 0;

        window.setTimeout = (callback, delay, ...args) => {
            const wrappedCallback = (...callbackArgs) => {
                timeouts.delete(handle);

                if (typeof callback === 'function') {
                    return callback(...callbackArgs);
                }

                return undefined;
            };
            const handle = nativeSetTimeout(wrappedCallback, delay, ...args);
            timeouts.add(handle);
            createdTimeouts += 1;

            return handle;
        };
        window.clearTimeout = handle => {
            timeouts.delete(handle);
            intervals.delete(handle);
            nativeClearTimeout(handle);
        };
        window.setInterval = (callback, delay, ...args) => {
            const handle = nativeSetInterval(callback, delay, ...args);
            intervals.add(handle);
            createdIntervals += 1;

            return handle;
        };
        window.clearInterval = handle => {
            timeouts.delete(handle);
            intervals.delete(handle);
            nativeClearInterval(handle);
        };
        window.__ptvSoakTimerProbe = {
            report: () => ({
                activeIntervals: intervals.size,
                activeTimeouts: timeouts.size,
                createdIntervals,
                createdTimeouts
            })
        };

        if (!window.__ptvSoakFrameProbe) {
            const histogram = new Uint32Array(1001);
            let active = true;
            let frameCount = 0;
            let lastFrameAt = null;
            let maximumGapMs = 0;
            let over50MsCount = 0;
            let requestId = 0;
            const report = () => {
                const percentileTarget = Math.ceil(frameCount * 0.95);
                let cumulative = 0;
                let p95GapMs = 0;

                for (let index = 0; index < histogram.length; index += 1) {
                    cumulative += histogram[index];

                    if (cumulative >= percentileTarget) {
                        p95GapMs = index;
                        break;
                    }
                }

                return {
                    frameCount,
                    maximumGapMs: Math.round(maximumGapMs * 10) / 10,
                    over50MsCount,
                    p95GapMs
                };
            };
            const sample = timestamp => {
                if (!active) return;

                if (lastFrameAt !== null) {
                    const gap = Math.max(0, timestamp - lastFrameAt);
                    const bucket = Math.min(histogram.length - 1, Math.round(gap));

                    histogram[bucket] += 1;
                    frameCount += 1;
                    maximumGapMs = Math.max(maximumGapMs, gap);

                    if (gap > 50) over50MsCount += 1;
                }

                lastFrameAt = timestamp;
                requestId = window.requestAnimationFrame(sample);
            };

            requestId = window.requestAnimationFrame(sample);
            window.__ptvSoakFrameProbe = {
                report,
                stop: () => {
                    active = false;
                    window.cancelAnimationFrame(requestId);
                }
            };
        }
    });
    await navigate(page, '#/home', true);
    const listenersBefore = await readListenerCounts(context, page);
    const initial = await readSnapshot(page, 0, 'initial');

    while (Date.now() < deadline || cycle < 10) {
        cycle += 1;

        for (const step of routeSteps) {
            const timing = await navigate(page, step.hash, step.native);
            routeDurations.push({ cycle, route: step.id, ...timing });
            snapshots.push(await readSnapshot(page, cycle, step.id));

            if (step.openDetails) {
                const details = await openDetailsAndReturn(page, step.hash);
                detailsResults.push({ cycle, route: step.id, ...details });
                snapshots.push(await readSnapshot(page, cycle, `${step.id}-after-back`));
            }
        }

        console.log(`cycle=${cycle} elapsedMinutes=${((Date.now() - startedAt) / 60_000).toFixed(1)}`);
    }

    await navigate(page, '#/home', true);
    await page.waitForTimeout(Math.max(dwellMs, 5000));
    const final = await readSnapshot(page, cycle, 'final');
    const listenersAfter = await readListenerCounts(context, page);
    await page.evaluate(() => window.__ptvSoakFrameProbe?.stop?.());
    const heapSamples = snapshots.map(snapshot => snapshot.heapUsed).filter(Number.isFinite);
    const nodeSamples = snapshots.map(snapshot => snapshot.domNodes).filter(Number.isFinite);
    const durations = routeDurations.map(result => result.ownerReadyMs);
    const report = {
        completedAt: new Date().toISOString(),
        durationMinutes: Math.round(((Date.now() - startedAt) / 60_000) * 10) / 10,
        environment: {
            authenticated: true,
            baseUrl,
            browser: 'desktop Chrome via CDP',
            physicalDevice: false,
            playbackUsed: false
        },
        errors: {
            consoleErrors,
            failedRequests,
            pageErrors
        },
        lifecycle: {
            final,
            initial,
            listenerDelta: listenersBefore && listenersAfter ? {
                document: listenersAfter.document - listenersBefore.document,
                window: listenersAfter.window - listenersBefore.window
            } : null,
            listenersAfter,
            listenersBefore,
            timerDelta: initial.timerProbe && final.timerProbe ? {
                activeIntervals: final.timerProbe.activeIntervals - initial.timerProbe.activeIntervals,
                activeTimeouts: final.timerProbe.activeTimeouts - initial.timerProbe.activeTimeouts
            } : null,
            timerProbeNote: 'Counts cover timers created after the in-page soak probe was installed.'
        },
        summary: {
            backFallbackCount: detailsResults.filter(result => result.backFallback).length,
            cycles: cycle,
            detailsAttemptCount: detailsResults.length,
            detailsOpenedCount: detailsResults.filter(result => result.detailsOpened).length,
            domNodeMaximum: nodeSamples.length ? Math.max(...nodeSamples) : null,
            framePacing: final.frameProbe,
            heapDelta: initial.heapUsed === null || final.heapUsed === null ?
                null :
                final.heapUsed - initial.heapUsed,
            heapMaximum: heapSamples.length ? Math.max(...heapSamples) : null,
            routeDurationMaximumMs: durations.length ? Math.max(...durations) : null,
            routeDurationMedianMs: percentile(durations, 50),
            routeDurationP95Ms: percentile(durations, 95),
            routeOwnerTimeoutCount: routeDurations.filter(result => !result.ownerReady).length
        },
        detailsResults,
        routeDurations,
        snapshots
    };

    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`report=${outputPath}`);
    process.exit(0);
}

main().catch(error => {
    console.error(error?.stack || error);
    process.exit(1);
});
