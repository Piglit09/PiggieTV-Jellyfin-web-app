/* eslint-disable compat/compat -- This measurement harness runs only in the current Node runtime. */

const fs = require('node:fs');
const path = require('node:path');
const { URL: NodeUrl } = require('node:url');
const { chromium } = require(path.resolve(process.cwd(), 'node_modules', 'playwright'));

const CDP_URL = process.env.PTV_DISCOVERY_CDP_URL || 'http://127.0.0.1:9223';
const BASE_URL = process.env.PTV_ALBUM_BASE_URL || 'http://localhost:8082/';
const REPORT_TAG = process.env.PTV_ALBUM_REPORT_TAG || 'current';
const OUTPUT_DIR = path.resolve(process.cwd(), 'test-results', 'authenticated-album');
const OUTPUT_FILE = path.join(OUTPUT_DIR, `album-cold-${REPORT_TAG}.json`);
const SCREENSHOT_FILE = path.join(OUTPUT_DIR, `album-cold-${REPORT_TAG}.png`);
const AUTH_WAIT_MS = 10 * 60 * 1000;
const ROUTE_SETTLE_LIMIT_MS = 35_000;
const ID_SEGMENT_PATTERN = /^[0-9a-f]{24,}$/i;
const IMAGE_DECODE_EVENT_PATTERN = /(?:Decode Image|DecodeImage|ImageDecodeTask)/i;

function getRequestKey(rawUrl) {
    try {
        const url = new NodeUrl(rawUrl);

        for (const name of ['api_key', 'access_token', 'X-Emby-Token']) {
            url.searchParams.delete(name);
        }
        url.searchParams.sort();
        return `${url.pathname}${url.search}`;
    } catch {
        return '[invalid-url]';
    }
}

function getSafeEndpoint(rawUrl) {
    try {
        const url = new NodeUrl(rawUrl);
        const pathname = url.pathname
            .split('/')
            .map(segment => ID_SEGMENT_PATTERN.test(segment) ? '{id}' : segment)
            .join('/');

        return pathname.replace(/\/+/g, '/');
    } catch {
        return '[invalid-url]';
    }
}

function isImageRequest(request) {
    if (request.resourceType() === 'image') return true;

    try {
        return /\/Images\//i.test(new NodeUrl(request.url()).pathname);
    } catch {
        return false;
    }
}

function getContentLength(response) {
    const value = Number(response.headers()['content-length']);

    return Number.isFinite(value) && value >= 0 ? value : null;
}

async function getAuthenticatedPage(browser) {
    const contexts = browser.contexts();
    const context = contexts[0];

    if (!context) {
        throw new Error('The dedicated browser has no default context.');
    }

    const pages = context.pages();
    const page = pages[0] || await context.newPage();

    await page.goto(new NodeUrl('#/home', BASE_URL).toString(), {
        waitUntil: 'domcontentloaded'
    });
    await page.waitForFunction(() => {
        const shell = document.querySelector('.ptv-shell-root, .ptv-shell-frame');
        const hasVisibleLoginForm = Array.from(
            document.querySelectorAll('.manualLoginForm, .loginPage')
        ).some(element => element.getClientRects().length > 0);

        return Boolean(shell) && !hasVisibleLoginForm;
    }, {
        timeout: AUTH_WAIT_MS
    });

    return page;
}

async function installPageProbe(page) {
    await page.evaluate(() => {
        const probe = {
            albumImageLoadEvents: 0,
            firstAlbumArtworkMs: null,
            firstMeaningfulContentMs: null,
            frameGaps: [],
            lastFrameAt: performance.now(),
            longTasks: [],
            observer: null,
            rafId: 0,
            startedAt: performance.now()
        };
        const updateMeaningfulContent = () => {
            if (probe.firstMeaningfulContentMs !== null) return;

            const heading = Array.from(document.querySelectorAll('h1'))
                .find(element => element.textContent?.trim() === 'Albums');
            const card = document.querySelector('.ptv-music-catalog-grid-album .ptv-music-card');

            if (heading && card) {
                probe.firstMeaningfulContentMs = performance.now() - probe.startedAt;
            }
        };
        const onImageLoad = event => {
            if (!(event.target instanceof HTMLImageElement)) return;
            if (!event.target.closest('.ptv-music-catalog-grid-album')) return;

            probe.albumImageLoadEvents += 1;
            if (probe.firstAlbumArtworkMs === null) {
                probe.firstAlbumArtworkMs = performance.now() - probe.startedAt;
            }
        };
        const onFrame = timestamp => {
            probe.frameGaps.push(timestamp - probe.lastFrameAt);
            probe.lastFrameAt = timestamp;
            probe.rafId = requestAnimationFrame(onFrame);
        };

        document.addEventListener('load', onImageLoad, true);
        probe.observer = new MutationObserver(updateMeaningfulContent);
        probe.observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
        probe.rafId = requestAnimationFrame(onFrame);

        try {
            const longTaskObserver = new PerformanceObserver(list => {
                list.getEntries().forEach(entry => {
                    probe.longTasks.push(Number(entry.duration.toFixed(1)));
                });
            });

            longTaskObserver.observe({ entryTypes: ['longtask'] });
            probe.longTaskObserver = longTaskObserver;
        } catch {
            probe.longTaskObserver = null;
        }

        probe.dispose = () => {
            cancelAnimationFrame(probe.rafId);
            document.removeEventListener('load', onImageLoad, true);
            probe.observer?.disconnect();
            probe.longTaskObserver?.disconnect();
        };
        window.__ptvR2AlbumProbe = probe;
        performance.clearResourceTimings();
        updateMeaningfulContent();
    });
}

async function readPageProbe(page) {
    return page.evaluate(() => {
        const probe = window.__ptvR2AlbumProbe;
        const cards = Array.from(document.querySelectorAll(
            '.ptv-music-catalog-grid-album .ptv-music-card'
        ));
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        const cardStates = cards.map(card => {
            const rect = card.getBoundingClientRect();
            const image = card.querySelector('img');
            const visible = (
                rect.bottom > 0
                && rect.right > 0
                && rect.top < viewportHeight
                && rect.left < viewportWidth
            );

            return {
                complete: Boolean(image?.complete && image.naturalWidth > 0),
                loading: image?.loading || '',
                visible
            };
        });
        const brokenVisibleImages = Array.from(document.images).filter(image => {
            if (!image.complete || image.naturalWidth > 0) return false;

            const rect = image.getBoundingClientRect();
            return (
                rect.bottom > 0
                && rect.right > 0
                && rect.top < viewportHeight
                && rect.left < viewportWidth
            );
        }).length;
        const frameGaps = probe?.frameGaps || [];
        const longTasks = probe?.longTasks || [];

        return {
            albumImageLoadEvents: probe?.albumImageLoadEvents || 0,
            belowFoldCardCount: cardStates.filter(card => !card.visible).length,
            belowFoldLoadedArtworkCount: cardStates.filter(card => !card.visible && card.complete).length,
            brokenVisibleImages,
            cardCount: cards.length,
            eagerArtworkCount: cardStates.filter(card => card.loading === 'eager').length,
            firstAlbumArtworkMs: probe?.firstAlbumArtworkMs ?? null,
            firstMeaningfulContentMs: probe?.firstMeaningfulContentMs ?? null,
            frameCount: frameGaps.length,
            frameMaximumMs: frameGaps.length ? Number(Math.max(...frameGaps).toFixed(1)) : 0,
            frameP95Ms: frameGaps.length ? frameGaps.slice().sort((left, right) => left - right)[
                Math.min(frameGaps.length - 1, Math.ceil(frameGaps.length * 0.95) - 1)
            ] : 0,
            lazyArtworkCount: cardStates.filter(card => card.loading === 'lazy').length,
            longTaskCount: longTasks.length,
            longTaskMaximumMs: longTasks.length ? Math.max(...longTasks) : 0,
            visibleCardCount: cardStates.filter(card => card.visible).length,
            visibleLoadedArtworkCount: cardStates.filter(card => card.visible && card.complete).length
        };
    });
}

async function main() {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const browser = await chromium.connectOverCDP(CDP_URL);
    const page = await getAuthenticatedPage(browser);
    const cdp = await page.context().newCDPSession(page);
    const imageRequests = new Map();
    const imageKeyCounts = new Map();
    const imageEndpointCounts = new Map();
    const failedRequestCategories = new Map();
    let activeImageRequests = 0;
    let completedImageRequests = 0;
    let knownResponseBytes = 0;
    let lastImageActivityAt = Date.now();
    let maximumConcurrentImageRequests = 0;
    let unknownResponseByteCount = 0;
    let measurementActive = false;
    const consoleErrorCategories = new Map();
    const pageErrors = [];

    const countCategory = (map, category) => {
        map.set(category, (map.get(category) || 0) + 1);
    };
    const onConsole = message => {
        if (!measurementActive || message.type() !== 'error') return;

        const text = message.text();
        let category = 'other';

        if (/\b404\b/.test(text)) {
            category = 'http-404';
        } else if (/abort|cancel/i.test(text)) {
            category = 'cancelled';
        }

        countCategory(consoleErrorCategories, category);
    };
    const onPageError = error => {
        if (!measurementActive) return;

        pageErrors.push(error?.name || 'Error');
    };
    const onRequest = request => {
        if (!measurementActive || !isImageRequest(request)) return;

        const key = getRequestKey(request.url());
        const endpoint = getSafeEndpoint(request.url());

        imageRequests.set(request, {
            key,
            startedAt: performance.now()
        });
        imageKeyCounts.set(key, (imageKeyCounts.get(key) || 0) + 1);
        imageEndpointCounts.set(endpoint, (imageEndpointCounts.get(endpoint) || 0) + 1);
        activeImageRequests += 1;
        maximumConcurrentImageRequests = Math.max(
            maximumConcurrentImageRequests,
            activeImageRequests
        );
        lastImageActivityAt = Date.now();
    };
    const settleRequest = request => {
        if (!imageRequests.has(request)) return;

        imageRequests.delete(request);
        activeImageRequests = Math.max(0, activeImageRequests - 1);
        completedImageRequests += 1;
        lastImageActivityAt = Date.now();
    };
    const onRequestFinished = async request => {
        if (!imageRequests.has(request)) return;

        try {
            const response = await request.response();
            const contentLength = response ? getContentLength(response) : null;

            if (contentLength === null) {
                unknownResponseByteCount += 1;
            } else {
                knownResponseBytes += contentLength;
            }
        } catch {
            unknownResponseByteCount += 1;
        }

        settleRequest(request);
    };
    const onRequestFailed = request => {
        if (!imageRequests.has(request)) return;

        const failureText = request.failure()?.errorText || '';
        const category = /abort|cancel/i.test(failureText) ? 'cancelled' : 'transport';

        countCategory(failedRequestCategories, category);
        settleRequest(request);
    };

    page.on('console', onConsole);
    page.on('pageerror', onPageError);
    page.on('request', onRequest);
    page.on('requestfailed', onRequestFailed);
    page.on('requestfinished', onRequestFinished);

    try {
        await page.evaluate(() => {
            window.location.hash = '#/settings';
        });
        await page.waitForFunction(() => window.location.hash.startsWith('#/settings'), {
            timeout: 10_000
        });
        await page.waitForTimeout(750);
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
        await cdp.send('Network.enable');
        await page.evaluate(async () => {
            const imageManager = window.PTV?.imageManager;

            imageManager?.dispose?.();
            imageManager?.clearMemory?.({ includeLoaded: true });

            if ('caches' in window) {
                const cacheNames = await window.caches.keys();

                await Promise.all(cacheNames.map(cacheName => window.caches.delete(cacheName)));
            }
        });
        await cdp.send('Network.clearBrowserCache');
        await page.waitForFunction(() => {
            const metrics = window.PTV?.imageManager?.report?.();

            return !metrics || (
                metrics.activeRequests === 0
                && metrics.queuedRequests === 0
            );
        }, {
            timeout: 5_000
        }).catch(() => undefined);
        const initialHeap = await cdp.send('Runtime.getHeapUsage');
        const initialDomNodes = await page.locator('*').count();
        const clientProfile = await page.evaluate(() => ({
            clientKind: document.documentElement.dataset.ptvClientKind || 'unknown',
            renderProfile: document.documentElement.dataset.ptvRenderProfile || 'unknown'
        }));
        const traceEvents = [];
        let resolveTraceComplete;
        const traceComplete = new Promise(resolve => {
            resolveTraceComplete = resolve;
        });

        cdp.on('Tracing.dataCollected', event => {
            traceEvents.push(...(event.value || []));
        });
        cdp.on('Tracing.tracingComplete', () => {
            resolveTraceComplete();
        });

        await installPageProbe(page);
        await cdp.send('Tracing.start', {
            categories: 'devtools.timeline,disabled-by-default-devtools.timeline',
            options: 'sampling-frequency=10000',
            transferMode: 'ReportEvents'
        });
        measurementActive = true;
        const routeStartedAt = performance.now();

        await page.evaluate(() => {
            window.location.hash = '#/music/albums';
        });
        await page.waitForFunction(() => (
            window.location.hash.startsWith('#/music/albums')
            && Array.from(document.querySelectorAll('h1')).some(
                element => element.textContent?.trim() === 'Albums'
            )
            && document.querySelectorAll('.ptv-music-catalog-grid-album .ptv-music-card').length > 0
        ), {
            timeout: 30_000
        });

        const settleDeadline = Date.now() + ROUTE_SETTLE_LIMIT_MS;

        while (Date.now() < settleDeadline) {
            const quietForMs = Date.now() - lastImageActivityAt;
            const imageManagerIdle = await page.evaluate(() => {
                const metrics = window.PTV?.imageManager?.report?.();

                return !metrics || (
                    metrics.activeRequests === 0
                    && metrics.queuedRequests === 0
                );
            });

            if (activeImageRequests === 0 && imageManagerIdle && quietForMs >= 1_250) {
                break;
            }

            await new Promise(resolve => setTimeout(resolve, 125));
        }

        await page.waitForTimeout(500);
        const routeSettledMs = Number((performance.now() - routeStartedAt).toFixed(1));
        const finalHeap = await cdp.send('Runtime.getHeapUsage');
        const finalDomNodes = await page.locator('*').count();
        const pageProbe = await readPageProbe(page);
        await cdp.send('Tracing.end');
        await Promise.race([
            traceComplete,
            new Promise(resolve => setTimeout(resolve, 5_000))
        ]);
        const imageDecodeTaskCount = traceEvents.filter(event => (
            event?.ph === 'X'
            && IMAGE_DECODE_EVENT_PATTERN.test(event.name || '')
        )).length;
        const requestCounts = Array.from(imageKeyCounts.values());
        const duplicateExactImageKeys = requestCounts
            .filter(count => count > 1)
            .reduce((total, count) => total + count - 1, 0);
        const report = {
            generatedAt: new Date().toISOString(),
            harnessVersion: 3,
            environment: {
                authenticated: true,
                browser: 'Chrome via dedicated CDP profile',
                cacheState: 'browser-cache, CacheStorage, and PTV image memory cleared',
                ...clientProfile,
                physicalDevice: false,
                playbackUsed: false
            },
            route: 'music-albums',
            measurement: {
                ...pageProbe,
                firstMeaningfulContentMs: pageProbe.firstMeaningfulContentMs === null ?
                    null :
                    Number(pageProbe.firstMeaningfulContentMs.toFixed(1)),
                frameP95Ms: Number(pageProbe.frameP95Ms.toFixed(1)),
                heapDeltaBytes: finalHeap.usedSize - initialHeap.usedSize,
                imageDecodeCount: imageDecodeTaskCount,
                imageDecodeMetric: 'Chrome trace decode tasks',
                imageRequestBytesKnown: knownResponseBytes,
                imageRequestBytesUnknownCount: unknownResponseByteCount,
                imageRequestCount: requestCounts.reduce((total, count) => total + count, 0),
                maximumConcurrentImageRequests,
                maximumDuplicateMultiplicity: requestCounts.length ? Math.max(...requestCounts) : 0,
                duplicateExactImageKeys,
                domNodeDelta: finalDomNodes - initialDomNodes,
                routeSettledMs
            },
            requestSummary: {
                completed: completedImageRequests,
                endpoints: Object.fromEntries(
                    [...imageEndpointCounts.entries()]
                        .sort((left, right) => right[1] - left[1])
                        .slice(0, 20)
                ),
                failures: Object.fromEntries(failedRequestCategories)
            },
            runtimeErrors: {
                console: Object.fromEntries(consoleErrorCategories),
                pageErrorCount: pageErrors.length,
                pageErrorTypes: [...new Set(pageErrors)]
            }
        };

        measurementActive = false;
        await page.evaluate(() => window.__ptvR2AlbumProbe?.dispose?.());
        await page.screenshot({
            fullPage: true,
            path: SCREENSHOT_FILE
        });
        fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(report, null, 2)}\n`, {
            encoding: 'utf8',
            mode: 0o600
        });

        if (
            report.measurement.firstMeaningfulContentMs === null
            || report.measurement.cardCount === 0
            || report.measurement.brokenVisibleImages > 0
            || report.runtimeErrors.pageErrorCount > 0
        ) {
            process.exitCode = 1;
        }

        process.stdout.write(`${JSON.stringify({
            artifact: path.basename(OUTPUT_FILE),
            summary: {
                brokenVisibleImages: report.measurement.brokenVisibleImages,
                cards: report.measurement.cardCount,
                duplicateExactImageKeys: report.measurement.duplicateExactImageKeys,
                imageRequests: report.measurement.imageRequestCount
            }
        }, null, 2)}\n`);
    } finally {
        measurementActive = false;
        page.off('console', onConsole);
        page.off('pageerror', onPageError);
        page.off('request', onRequest);
        page.off('requestfailed', onRequestFailed);
        page.off('requestfinished', onRequestFinished);
        await cdp.detach().catch(() => undefined);
        await browser.close();
    }
}

main().catch(error => {
    process.stderr.write(`Authenticated Album measurement failed: ${
        error instanceof Error ? error.message : 'unknown error'
    }\n`);
    process.exitCode = 1;
});

/* eslint-enable compat/compat */
