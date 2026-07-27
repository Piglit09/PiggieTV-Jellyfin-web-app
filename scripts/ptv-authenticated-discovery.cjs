const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(path.resolve(process.cwd(), 'node_modules', 'playwright'));

const baseUrl = 'http://localhost:8082/';
const outputDir = path.resolve(process.cwd(), 'test-results', 'authenticated-discovery');
const reportTag = process.env.PTV_DISCOVERY_REPORT_TAG || 'current';
const reportFileName = reportTag === 'current' ? 'discovery-report.json' : `discovery-report-${reportTag}.json`;
const routes = [
    { id: 'home', hash: '#/home', screenshot: true },
    { id: 'movies', hash: '#/movies', screenshot: true },
    { id: 'movies-latest', hash: '#/movies/latest' },
    { id: 'movies-genres', hash: '#/movies/genres' },
    { id: 'movies-studios', hash: '#/movies/studios' },
    { id: 'movies-collections', hash: '#/collections' },
    { id: 'movies-trending', hash: '#/movies/trending' },
    { id: 'shows', hash: '#/shows', screenshot: true },
    { id: 'shows-latest', hash: '#/shows/latest' },
    { id: 'shows-genres', hash: '#/shows/genres' },
    { id: 'shows-networks', hash: '#/shows/networks' },
    { id: 'shows-trending', hash: '#/shows/trending' },
    { id: 'music', hash: '#/music', screenshot: true },
    { id: 'music-artists', hash: '#/music/artists' },
    { id: 'music-albums', hash: '#/music/albums' },
    { id: 'music-songs', hash: '#/music/songs' },
    { id: 'reading', hash: '#/reading', screenshot: true },
    { id: 'reading-books', hash: '#/reading/books' },
    { id: 'reading-comics', hash: '#/reading/comics' },
    { id: 'reading-manga', hash: '#/reading/manga' },
    { id: 'search', hash: '#/search' },
    { id: 'preferences', hash: '#/mypreferencesmenu' },
    { id: 'dashboard-authorization', hash: '#/dashboard/piggietv', expectedRedirect: '#/home', screenshot: true }
];

function percentile(values, percentileValue) {
    if (!values.length) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
    return Math.round(sorted[index] * 10) / 10;
}

function endpointPath(rawUrl) {
    try {
        return new URL(rawUrl).pathname;
    } catch {
        return '[invalid-url]';
    }
}

function requestKey(rawUrl) {
    try {
        const url = new URL(rawUrl);

        for (const name of ['api_key', 'access_token', 'X-Emby-Token']) {
            url.searchParams.delete(name);
        }

        url.searchParams.sort();
        return `${url.pathname}${url.search}`;
    } catch {
        return '[invalid-url]';
    }
}

async function main() {
    fs.mkdirSync(outputDir, { recursive: true });
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
    const context = browser.contexts()[0];
    let page = null;

    for (const candidate of context.pages()) {
        if (!candidate.url().startsWith(baseUrl)) continue;

        const authenticated = await candidate.evaluate(() => Boolean(
            window.ApiClient?.getCurrentUserId?.() && window.ApiClient?.accessToken?.()
        )).catch(() => false);

        if (authenticated) {
            page = candidate;
            break;
        }
    }

    if (!page) throw new Error('Authenticated Chrome page was not found.');

    await page.setViewportSize({ width: 1920, height: 1080 });

    const consoleErrors = [];
    const pageErrors = [];
    const failedRequests = [];
    const responseErrors = [];
    const requestStarts = new Map();
    const requestRecords = [];
    let activeRoute = 'initial';

    page.on('console', message => {
        if (message.type() === 'error') {
            consoleErrors.push({ route: activeRoute, text: message.text().slice(0, 500) });
        }
    });
    page.on('pageerror', error => {
        pageErrors.push({ route: activeRoute, text: String(error.message || error).slice(0, 500) });
    });
    page.on('request', request => {
        requestStarts.set(request, performance.now());
    });
    page.on('requestfailed', request => {
        failedRequests.push({
            error: request.failure()?.errorText || 'unknown',
            method: request.method(),
            path: endpointPath(request.url()),
            route: activeRoute
        });
    });
    page.on('response', response => {
        const request = response.request();
        const startedAt = requestStarts.get(request);
        const duration = startedAt === undefined ? 0 : performance.now() - startedAt;
        const record = {
            duration: Math.round(duration * 10) / 10,
            method: request.method(),
            path: endpointPath(response.url()),
            requestKey: request.resourceType() === 'image' ? requestKey(response.url()) : undefined,
            resourceType: request.resourceType(),
            route: activeRoute,
            status: response.status()
        };
        requestRecords.push(record);
        if (response.status() >= 400) responseErrors.push(record);
    });

    await page.evaluate(() => {
        if (window.__ptvCodexDiscovery) return;

        const state = {
            longTasks: [],
            playbackEvents: [],
            rejections: [],
            shellAdded: 0,
            shellRemoved: 0
        };
        const shellSelector = '.ptv-shell-header';
        const countShellNodes = node => {
            if (!(node instanceof Element)) return 0;
            return (node.matches(shellSelector) ? 1 : 0) + node.querySelectorAll(shellSelector).length;
        };

        new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) state.shellAdded += countShellNodes(node);
                for (const node of mutation.removedNodes) state.shellRemoved += countShellNodes(node);
            }
        }).observe(document.documentElement, { childList: true, subtree: true });

        if ('PerformanceObserver' in window) {
            try {
                const observer = new PerformanceObserver(list => {
                    for (const entry of list.getEntries()) {
                        state.longTasks.push({
                            duration: Math.round(entry.duration * 10) / 10,
                            startTime: Math.round(entry.startTime * 10) / 10
                        });
                    }
                });
                observer.observe({ entryTypes: ['longtask'] });
            } catch {
                // Long-task observation is optional in browsers that do not expose it.
            }
        }

        window.addEventListener('unhandledrejection', event => {
            state.rejections.push(String(event.reason?.message || event.reason || 'unknown').slice(0, 500));
        });

        for (const eventName of [
            'audio-ended',
            'queue-advance-requested',
            'queue-next-resolved',
            'queue-next-load-started',
            'queue-next-play-started'
        ]) {
            window.addEventListener(eventName, () => {
                state.playbackEvents.push({ event: eventName, time: Math.round(performance.now()) });
            }, true);
        }

        window.__ptvCodexDiscovery = state;
    });

    const routeResults = [];
    let previousHeap = null;

    for (const route of routes) {
        activeRoute = route.id;
        const startedAt = performance.now();
        const requestStartIndex = requestRecords.length;
        const consoleStartIndex = consoleErrors.length;
        const pageErrorStartIndex = pageErrors.length;
        const failedStartIndex = failedRequests.length;
        const responseErrorStartIndex = responseErrors.length;
        const runtimeBefore = await page.evaluate(() => ({
            longTasks: window.__ptvCodexDiscovery?.longTasks.length || 0,
            shellAdded: window.__ptvCodexDiscovery?.shellAdded || 0,
            shellRemoved: window.__ptvCodexDiscovery?.shellRemoved || 0
        }));

        await page.evaluate(hash => {
            window.location.hash = hash;
        }, route.hash);
        await page.waitForTimeout(3000);

        const snapshot = await page.evaluate(() => {
            const isVisible = element => {
                if (!(element instanceof HTMLElement)) return false;
                const style = getComputedStyle(element);
                const bounds = element.getBoundingClientRect();
                return style.display !== 'none'
                    && style.visibility !== 'hidden'
                    && Number(style.opacity || 1) !== 0
                    && bounds.width > 0
                    && bounds.height > 0;
            };
            const visibleElements = selector => [...document.querySelectorAll(selector)].filter(isVisible);
            const headerSelector = '.ptv-shell-header, .ptv-app-header-root > .skinHeader';
            const headers = [...new Set(visibleElements(headerSelector))]
                .filter(element => !element.parentElement?.closest(headerSelector));
            const headerBottom = headers.reduce((maximum, element) => Math.max(maximum, element.getBoundingClientRect().bottom), 0);
            const visiblePages = visibleElements('.mainAnimatedPage, [data-route-owner], main');
            const pageRoot = visiblePages.find(element => element.getBoundingClientRect().height > 100) || document.body;
            const firstContent = [...pageRoot.querySelectorAll('h1, h2, .pageTitle, .sectionTitle, .content-primary > :first-child')]
                .find(isVisible);
            const firstContentTop = firstContent?.getBoundingClientRect().top ?? null;
            const controlsWithoutName = visibleElements('button, a[href], input, select, textarea')
                .filter(element => {
                    if (element instanceof HTMLInputElement && element.type === 'hidden') return false;
                    return !(element.getAttribute('aria-label')
                        || element.getAttribute('aria-labelledby')
                        || element.getAttribute('title')
                        || element.textContent?.trim()
                        || element.closest('label')?.textContent?.trim()
                        || (element instanceof HTMLInputElement && element.placeholder));
                }).length;
            const images = [...document.images].filter(isVisible);
            const brokenVisibleImages = images.filter(image => image.complete && image.naturalWidth === 0).length;
            const missingAltImages = images.filter(image => !image.hasAttribute('alt')).length;
            const activeElement = document.activeElement;
            const memory = performance.memory;

            return {
                activeElement: activeElement ? {
                    id: activeElement.id || null,
                    name: activeElement.getAttribute('aria-label') || activeElement.textContent?.trim().slice(0, 80) || activeElement.tagName,
                    tag: activeElement.tagName
                } : null,
                audioElements: document.querySelectorAll('audio').length,
                bodyClass: document.body.className,
                brokenVisibleImages,
                controlsWithoutName,
                firstContentTop,
                hash: location.hash,
                headerBottom,
                heading: firstContent?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 160) || null,
                heapUsed: memory?.usedJSHeapSize || null,
                horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
                images: images.length,
                missingAltImages,
                overlayCount: document.querySelectorAll('webpack-dev-server-client-overlay').length,
                readyState: document.readyState,
                shellVisibleCount: headers.length,
                viewport: { height: innerHeight, width: innerWidth }
            };
        });
        const runtimeAfter = await page.evaluate(before => ({
            longTasks: window.__ptvCodexDiscovery?.longTasks.slice(before.longTasks) || [],
            rejections: window.__ptvCodexDiscovery?.rejections.slice() || [],
            shellAdded: (window.__ptvCodexDiscovery?.shellAdded || 0) - before.shellAdded,
            shellRemoved: (window.__ptvCodexDiscovery?.shellRemoved || 0) - before.shellRemoved
        }), runtimeBefore);
        const routeRequests = requestRecords.slice(requestStartIndex);
        const duration = Math.round((performance.now() - startedAt) * 10) / 10;
        const imageRequests = routeRequests.filter(record => record.resourceType === 'image');
        const routeResponseErrors = responseErrors.slice(responseErrorStartIndex);
        const expectedMissingArtwork = routeResponseErrors.filter(record => record.resourceType === 'image'
            && record.status === 404
            && /^\/Items\/[^/]+\/Images\//i.test(record.path));
        const functionalResponseErrors = routeResponseErrors.filter(record => !expectedMissingArtwork.includes(record));
        const routeConsoleErrors = consoleErrors.slice(consoleStartIndex);
        const functionalConsoleErrors = routeConsoleErrors.filter(error => !/Failed to load resource: the server responded with a status of 404/i.test(error.text));
        const redirectedAsExpected = route.expectedRedirect && snapshot.hash === route.expectedRedirect;
        const routeMismatch = Boolean(route.expectedRedirect) ? !redirectedAsExpected : snapshot.hash !== route.hash;
        const routeFailedRequests = failedRequests.slice(failedStartIndex);
        const expectedAbortedRequests = routeFailedRequests.filter(record => (
            redirectedAsExpected && record.error === 'net::ERR_ABORTED'
        ));
        const functionalFailedRequests = routeFailedRequests.filter(record => !expectedAbortedRequests.includes(record));
        const imageRequestCounts = new Map();
        const imagePathVariants = new Map();

        for (const record of imageRequests) {
            const exactKey = record.requestKey || record.path;
            imageRequestCounts.set(exactKey, (imageRequestCounts.get(exactKey) || 0) + 1);
            const variants = imagePathVariants.get(record.path) || new Set();
            variants.add(exactKey);
            imagePathVariants.set(record.path, variants);
        }

        const duplicateImageRequests = [...imageRequestCounts.values()].filter(count => count > 1).length;
        const imagePathsWithVariants = [...imagePathVariants.values()].filter(variants => variants.size > 1).length;
        const missingRequiredContent = !redirectedAsExpected && !snapshot.heading;
        const routeFailure = snapshot.overlayCount > 0
            || snapshot.shellVisibleCount !== 1
            || snapshot.horizontalOverflow
            || snapshot.brokenVisibleImages > 0
            || missingRequiredContent
            || routeMismatch
            || (snapshot.firstContentTop !== null && snapshot.firstContentTop < snapshot.headerBottom - 1)
            || functionalConsoleErrors.length > 0
            || pageErrors.length > pageErrorStartIndex
            || functionalFailedRequests.length > 0
            || functionalResponseErrors.length > 0
            || runtimeAfter.rejections.length > 0;
        const result = {
            ...snapshot,
            consoleErrors: routeConsoleErrors,
            duration,
            expectedAbortedRequests,
            failedRequests: routeFailedRequests,
            functionalFailedRequests,
            functionalResponseErrors,
            heapDelta: previousHeap === null || snapshot.heapUsed === null ? null : snapshot.heapUsed - previousHeap,
            imageRequests: imageRequests.length,
            duplicateImagePaths: duplicateImageRequests,
            duplicateImageRequests,
            expectedMissingArtwork,
            failedArtworkFallbacks: snapshot.brokenVisibleImages,
            functionalConsoleErrors,
            functionalResponseErrors,
            longTasks: runtimeAfter.longTasks,
            imagePathsWithVariants,
            missingRequiredContent,
            pageErrors: pageErrors.slice(pageErrorStartIndex),
            requestedHash: route.hash,
            routeMismatch,
            requestCount: routeRequests.length,
            responseErrors: routeResponseErrors,
            route: route.id,
            routeFailure,
            shellAdded: runtimeAfter.shellAdded,
            shellRemoved: runtimeAfter.shellRemoved,
            slowRequests: routeRequests.filter(record => record.duration >= 1000)
        };
        routeResults.push(result);
        previousHeap = snapshot.heapUsed;

        if (route.screenshot || routeFailure) {
            await page.screenshot({
                fullPage: true,
                path: path.join(outputDir, `${reportTag}-${route.id}.png`)
            });
        }

        console.log(`${route.id}: ${routeFailure ? 'FAIL' : 'PASS'} (${duration}ms, ${routeRequests.length} requests)`);
    }

    const responsiveProfiles = [
        { id: 'desktop-4k', height: 2160, width: 3840 },
        { id: 'tv-720p', height: 720, width: 1280 },
        { id: 'mobile-portrait', height: 844, width: 390 },
        { id: 'mobile-landscape', height: 390, width: 844 }
    ];
    const responsiveResults = [];

    activeRoute = 'responsive';
    await page.evaluate(() => {
        window.location.hash = '#/home';
    });
    await page.waitForTimeout(2000);

    for (const profile of responsiveProfiles) {
        await page.setViewportSize({ width: profile.width, height: profile.height });
        await page.waitForTimeout(800);
        const layout = await page.evaluate(() => {
            const visible = element => {
                const style = getComputedStyle(element);
                const bounds = element.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden' && bounds.width > 0 && bounds.height > 0;
            };
            const headers = [...new Set([...document.querySelectorAll('.ptv-app-header, .ptv-shell-header, .skinHeader, .headerTop')].filter(visible))];
            return {
                clientWidth: document.documentElement.clientWidth,
                horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
                scrollWidth: document.documentElement.scrollWidth,
                shellVisibleCount: headers.length,
                viewport: { height: innerHeight, width: innerWidth }
            };
        });
        responsiveResults.push({ ...profile, ...layout });
        await page.screenshot({ fullPage: true, path: path.join(outputDir, `${reportTag}-${profile.id}.png`) });
    }

    await page.setViewportSize({ width: 1920, height: 1080 });

    const endpointSummary = {};
    for (const record of requestRecords) {
        const key = `${record.method} ${record.path}`;
        const entry = endpointSummary[key] || { count: 0, durations: [], failures: 0, routes: new Set() };
        entry.count += 1;
        entry.durations.push(record.duration);
        entry.failures += record.status >= 400 ? 1 : 0;
        entry.routes.add(record.route);
        endpointSummary[key] = entry;
    }

    const report = {
        generatedAt: new Date().toISOString(),
        environment: {
            authenticated: true,
            baseUrl,
            browser: 'desktop Chrome via CDP',
            physicalDevice: false
        },
        endpointSummary: Object.fromEntries(Object.entries(endpointSummary).map(([key, entry]) => [key, {
            average: Math.round((entry.durations.reduce((sum, value) => sum + value, 0) / entry.durations.length) * 10) / 10,
            count: entry.count,
            failures: entry.failures,
            maximum: Math.max(...entry.durations),
            p95: percentile(entry.durations, 95),
            routes: [...entry.routes]
        }])),
        global: {
            consoleErrors,
            failedRequests,
            pageErrors,
            responseErrors
        },
        responsiveResults,
        routeResults
    };

    fs.writeFileSync(path.join(outputDir, reportFileName), JSON.stringify(report, null, 2));
    console.log(`report=${path.join(outputDir, reportFileName)}`);
    process.exit(0);
}

main().catch(error => {
    console.error(error?.stack || error);
    process.exit(1);
});
