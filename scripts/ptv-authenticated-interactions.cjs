/* eslint-disable compat/compat -- Phase 2D runs only in the current Node runtime and attached current Chrome. */

const fs = require('node:fs');
const path = require('node:path');

const { chromium } = require('playwright');
const {
    cleanupOwnedSession,
    getOwnedSessionStatus
} = require('./ptv-authenticated-cdp.cjs');
const {
    Phase2dStageError,
    classifyMissingItemOutcome,
    classifySafeHarnessError,
    createStageRecorder,
    findForbiddenArtifactPath,
    installPhase2dInstrumentation
} = require('./ptv-phase2d-harness-utils.cjs');

const CDP_URL = process.env.PTV_DISCOVERY_CDP_URL || 'http://127.0.0.1:9223';
const FRONTEND_ORIGIN = getOrigin(
    process.env.PTV_AUTH_FRONTEND_ORIGIN || 'http://localhost:8082'
);
const BACKEND_ORIGIN = getOrigin(
    process.env.PTV_AUTH_JELLYFIN_ORIGIN || 'http://localhost:8096'
);
const AUTH_WAIT_MS = getPositiveInteger(process.env.PTV_AUTH_WAIT_MS, 10 * 60 * 1000);
const OUTPUT_DIR = path.resolve('test-results/phase2d-authenticated');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'core-phase2d-authenticated-browser.json');
const EXPECTED_EPISODE_FIELDS = 'ItemCounts,PrimaryImageAspectRatio,CanDelete,MediaSourceCount,Overview,MediaSources';
const EXPECTED_SEASON_FIELDS = 'ItemCounts,PrimaryImageAspectRatio,CanDelete,MediaSourceCount';
const GENERIC_SEARCH_TYPES = [ 'Movie', 'Series', 'Episode' ];
const SPECIALIZED_SEARCH_TYPES = [ 'Book', 'Audio', 'MusicAlbum', 'MusicArtist' ];

function getPositiveInteger(value, fallback) {
    const parsed = Number.parseInt(String(value || ''), 10);

    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getOrigin(value) {
    const url = new URL(value);

    return url.origin;
}

function assertLoopbackCdp(value) {
    const url = new URL(value);
    const allowedHosts = new Set([ '127.0.0.1', 'localhost', '::1', '[::1]' ]);

    if (!allowedHosts.has(url.hostname)) {
        throw new Error('cdp-endpoint-is-not-loopback');
    }
}

function sanitizeOrigin(origin) {
    const url = new URL(origin);
    const hostCategory = [ '127.0.0.1', 'localhost', '::1', '[::1]' ].includes(url.hostname) ?
        'loopback' :
        'configured-host';

    return `${url.protocol}//${hostCategory}:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
}

function routeCategory(value) {
    try {
        const url = new URL(value, FRONTEND_ORIGIN);
        const route = `${url.pathname}${url.hash}`.toLowerCase();

        if (route.includes('/details?') || route.includes('#/details?')) return 'details';
        if (route.includes('/search') || route.includes('#/search')) return 'search';
        if (route.includes('/home') || route.includes('#/home')) return 'home';
        if (route.includes('/music')) return 'music';
        if (route.includes('/reading')) return 'reading';
        return 'other';
    } catch {
        return 'invalid';
    }
}

function safeFailureReason(error) {
    return classifySafeHarnessError(error);
}

function roundDuration(value) {
    return Math.max(0, Math.round(value * 10) / 10);
}

async function fetchStatus(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    try {
        const response = await fetch(url, {
            redirect: 'manual',
            signal: controller.signal
        });

        return {
            reachable: true,
            status: response.status
        };
    } catch {
        return {
            reachable: false,
            status: null
        };
    } finally {
        clearTimeout(timeout);
    }
}

// The explicit branches keep all private URL values transient and out of artifacts.
function classifyApiRequest(rawUrl) {
    let url;

    try {
        url = new URL(rawUrl);
    } catch {
        return null;
    }

    if (url.origin !== BACKEND_ORIGIN) return null;

    const pathname = url.pathname;
    let category = null;

    if (/\/Shows\/[^/]+\/Seasons\/?$/i.test(pathname)) category = 'getSeasons';
    else if (/\/Shows\/[^/]+\/Episodes\/?$/i.test(pathname)) category = 'getEpisodes';
    else if (/\/Users\/[^/]+\/Items\/[^/]+\/?$/i.test(pathname)) category = 'getItem';

    if (!category) return null;

    const queryKeys = [ ...url.searchParams.keys() ];
    const exactLowercaseSeasonId = queryKeys.includes('seasonId') && !queryKeys.includes('SeasonId');
    const exactLowercaseUserId = queryKeys.includes('userId') && !queryKeys.includes('UserId');
    let fieldsMatch = null;
    let hasUserId = null;
    let queryCasingMatch = null;

    if (category === 'getSeasons') {
        fieldsMatch = url.searchParams.get('Fields') === EXPECTED_SEASON_FIELDS;
        hasUserId = exactLowercaseUserId;
        queryCasingMatch = exactLowercaseUserId && queryKeys.includes('Fields');
    } else if (category === 'getEpisodes') {
        fieldsMatch = url.searchParams.get('Fields') === EXPECTED_EPISODE_FIELDS;
        hasUserId = exactLowercaseUserId;
        queryCasingMatch = exactLowercaseSeasonId
            && exactLowercaseUserId
            && queryKeys.includes('Fields');
    }

    return {
        category,
        fieldsMatch,
        hasFields: queryKeys.includes('Fields'),
        hasSeasonId: category === 'getEpisodes' ? exactLowercaseSeasonId : null,
        hasUserId,
        queryCasingMatch
    };
}

function createNetworkObserver(page) {
    const records = [];
    const starts = new WeakMap();
    const recordsByRequest = new WeakMap();

    const onRequest = request => {
        const classified = classifyApiRequest(request.url());
        if (!classified) return;

        const record = {
            ...classified,
            durationMs: null,
            method: request.method(),
            routeCategory: routeCategory(page.url()),
            status: null
        };
        starts.set(request, performance.now());
        recordsByRequest.set(request, record);
        records.push(record);
    };
    const onResponse = response => {
        const request = response.request();
        const record = recordsByRequest.get(request);
        if (!record) return;

        const startedAt = starts.get(request);
        record.durationMs = roundDuration(
            startedAt === undefined ? 0 : performance.now() - startedAt
        );
        record.status = response.status();
    };
    const onRequestFailed = request => {
        const record = recordsByRequest.get(request);
        if (!record) return;

        const startedAt = starts.get(request);
        record.durationMs = roundDuration(
            startedAt === undefined ? 0 : performance.now() - startedAt
        );
        record.status = null;
    };

    page.on('request', onRequest);
    page.on('response', onResponse);
    page.on('requestfailed', onRequestFailed);

    return {
        dispose() {
            page.off('request', onRequest);
            page.off('response', onResponse);
            page.off('requestfailed', onRequestFailed);
        },
        recordsSince(index) {
            return records.slice(index).map(record => ({ ...record }));
        },
        snapshot() {
            return records.length;
        }
    };
}

function summarizeApiRecords(records) {
    const categories = [ 'getItem', 'getSeasons', 'getEpisodes' ];

    return Object.fromEntries(categories.map(category => {
        const matches = records.filter(record => record.category === category);

        return [ category, {
            count: matches.length,
            methods: [ ...new Set(matches.map(record => record.method)) ],
            statuses: matches.map(record => record.status)
        } ];
    }));
}

async function installInstrumentation(page) {
    return page.evaluate(installPhase2dInstrumentation);
}

async function resetInstrumentation(page) {
    const installed = await page.evaluate(() => {
        window.__PTV_PHASE2D_VALIDATION__?.reset?.();

        return Boolean(window.__PTV_PHASE2D_VALIDATION__);
    });

    if (!installed) {
        const success = await installInstrumentation(page);
        if (!success) throw new Error('app-router-unavailable');
    }
}

async function getInstrumentationCounts(page) {
    return page.evaluate(() => window.__PTV_PHASE2D_VALIDATION__?.getCounts?.() || {
        appRouterTransitions: 0,
        coreApiDiagnostics: 0,
        coreEpisodeDiagnostics: 0,
        coreItemDiagnostics: 0,
        coreNavigationDiagnostics: 0,
        coreSeasonDiagnostics: 0,
        diagnosticsAvailable: false,
        hashTransitions: 0,
        historyTransitions: 0,
        primaryActivations: 0,
        primaryActivationsPrevented: 0,
        popStateTransitions: 0,
        routeCategoryTransitions: 0
    });
}

async function restoreInstrumentation(page) {
    await page.evaluate(() => window.__PTV_PHASE2D_VALIDATION__?.restore?.()).catch(() => undefined);
}

async function navigateWithRouter(page, route) {
    await page.evaluate(async nextRoute => {
        await window.Emby.Page.show(nextRoute);
    }, route);
}

async function waitForRoute(page, category, timeout = 20_000) {
    await page.waitForFunction(expected => {
        const route = `${window.location.pathname}${window.location.hash}`.toLowerCase();

        if (expected === 'details') return route.includes('/details?');
        if (expected === 'search') return route.includes('/search');
        if (expected === 'home') return route.includes('/home');
        if (expected === 'music') return route.includes('/music');
        if (expected === 'reading') return route.includes('/reading');
        return false;
    }, category, { timeout });
}

async function waitForDetails(page) {
    await waitForRoute(page, 'details');
    await page.waitForFunction(() => Boolean(
        [ ...document.querySelectorAll('#itemDetailPage,.itemDetailPage') ]
            .find(element => element.getBoundingClientRect().height > 100)
    ), null, { timeout: 20_000 });
}

async function waitForAuthenticatedPage(browser) {
    const startedAt = Date.now();
    let announced = false;

    while (Date.now() - startedAt < AUTH_WAIT_MS) {
        const matchingPages = browser.contexts()
            .flatMap(context => context.pages())
            .filter(candidate => {
                try {
                    return new URL(candidate.url()).origin === FRONTEND_ORIGIN;
                } catch {
                    return false;
                }
            });

        if (matchingPages.length > 1) throw new Error('multiple-frontend-pages');
        if (matchingPages.length === 1) {
            const page = matchingPages[0];
            const state = await page.evaluate(expectedBackend => {
                const apiClient = window.ApiClient;
                let serverMatches = false;

                try {
                    serverMatches = new URL(apiClient?.serverAddress?.() || '').origin === expectedBackend;
                } catch {
                    serverMatches = false;
                }

                return {
                    authenticated: Boolean(
                        apiClient?.getCurrentUserId?.()
                        && apiClient?.accessToken?.()
                    ),
                    serverMatches
                };
            }, BACKEND_ORIGIN).catch(() => ({
                authenticated: false,
                serverMatches: false
            }));

            if (state.authenticated && state.serverMatches) return page;
        }

        if (!announced) {
            process.stdout.write('Waiting for manual authentication in the dedicated Phase 2D browser.\n');
            announced = true;
        }
        await new Promise(resolve => setTimeout(resolve, 1_000));
    }

    throw new Error('authenticated-page-timeout');
}

async function runPreflight(browser, page) {
    const frontend = await fetchStatus(`${FRONTEND_ORIGIN}/`);
    const backend = await fetchStatus(`${BACKEND_ORIGIN}/System/Info/Public`);
    if (!frontend.reachable || frontend.status !== 200) throw new Error('frontend-unreachable');
    if (!backend.reachable || backend.status !== 200) throw new Error('backend-unreachable');

    await page.bringToFront();
    await page.waitForLoadState('domcontentloaded');
    const browserState = await page.evaluate(expected => {
        const apiClient = window.ApiClient;
        const routeController = window.PTV?.routeController;
        let serverMatches = false;

        try {
            serverMatches = new URL(apiClient?.serverAddress?.() || '').origin === expected.backend;
        } catch {
            serverMatches = false;
        }

        const serviceWorkerUrl = navigator.serviceWorker?.controller?.scriptURL || '';
        let serviceWorkerMatches = true;
        try {
            serviceWorkerMatches = !serviceWorkerUrl
                || new URL(serviceWorkerUrl).origin === expected.frontend;
        } catch {
            serviceWorkerMatches = false;
        }

        return {
            appRouterAvailable: typeof window.Emby?.Page?.show === 'function',
            authenticated: Boolean(
                apiClient?.getCurrentUserId?.()
                && apiClient?.accessToken?.()
            ),
            currentCoreRuntimeLoaded: Boolean(window.__PTV_CORE_RUNTIME_ADOPTION__),
            currentPtvBuildLoaded: Boolean(
                window.PTV
                && window.__PTV_RUNTIME_APP_STATE__?.started
                && document.documentElement.classList.contains('ptv-ready')
            ),
            frontendOriginMatches: window.location.origin === expected.frontend,
            routeControllerAvailable: Boolean(routeController),
            runtimeOverlayAbsent: !document.querySelector(
                '.webpack-dev-server-client-overlay,.uncaughtError'
            ),
            serverMatches,
            serviceWorkerMatches
        };
    }, {
        backend: BACKEND_ORIGIN,
        frontend: FRONTEND_ORIGIN
    });

    if (!Object.values(browserState).every(Boolean)) throw new Error('browser-preflight-failed');

    await navigateWithRouter(page, '#/home');
    await waitForRoute(page, 'home');
    await page.waitForSelector('[data-ptv-layout-node="home-root"]', {
        state: 'visible',
        timeout: 30_000
    });

    return {
        appRouterAvailable: browserState.appRouterAvailable,
        authenticated: browserState.authenticated,
        backend: {
            origin: sanitizeOrigin(BACKEND_ORIGIN),
            reachable: backend.reachable,
            status: backend.status
        },
        browser: browser.version(),
        conflictingFrontendPages: 0,
        currentCoreRuntimeLoaded: browserState.currentCoreRuntimeLoaded,
        currentPtvBuildLoaded: browserState.currentPtvBuildLoaded,
        frontend: {
            origin: sanitizeOrigin(FRONTEND_ORIGIN),
            reachable: frontend.reachable,
            status: frontend.status
        },
        homeReachable: true,
        runtimeOverlayAbsent: browserState.runtimeOverlayAbsent,
        serverOriginConfirmed: browserState.serverMatches,
        serviceWorkerOriginConfirmed: browserState.serviceWorkerMatches
    };
}

// Catalog discovery is intentionally read-only and keeps all item identity in memory.
async function getCatalogCandidates(page) {
    // eslint-disable-next-line sonarjs/cognitive-complexity
    return page.evaluate(async types => {
        const apiClient = window.ApiClient;
        const userId = apiClient.getCurrentUserId();
        const candidates = {};
        const getSearchTerm = (item, type) => {
            if (type !== 'Audio') return item.Name;
            if (Array.isArray(item.Artists) && item.Artists[0]) return item.Artists[0];

            return item.Album || item.Name;
        };

        for (const type of types) {
            const response = await apiClient.getItems(userId, {
                Fields: 'Album,Artists,SeriesId,SeasonId',
                IncludeItemTypes: type,
                Limit: type === 'Series' ? 20 : 10,
                Recursive: true,
                SortBy: 'SortName'
            });
            candidates[type] = (response?.Items || [])
                .filter(item => typeof item?.Id === 'string' && typeof item?.Name === 'string')
                .map(item => ({
                    Id: item.Id,
                    Name: item.Name,
                    SearchTerm: getSearchTerm(item, type),
                    ServerId: item.ServerId,
                    Type: item.Type
                }));
        }

        let selectedSeries = null;
        let selectedSeason = null;
        let selectedEpisode = null;
        let emptySeries = null;
        let emptySeason = null;

        for (const series of candidates.Series || []) {
            const seasons = await apiClient.getSeasons(series.Id, {
                Fields: 'ItemCounts,PrimaryImageAspectRatio,CanDelete,MediaSourceCount',
                userId
            });
            const seasonItems = seasons?.Items || [];
            if (!seasonItems.length && !emptySeries) emptySeries = series;

            for (const season of seasonItems.slice(0, 5)) {
                const episodes = await apiClient.getEpisodes(series.Id, {
                    Fields: 'ItemCounts,PrimaryImageAspectRatio,CanDelete,MediaSourceCount,Overview,MediaSources',
                    seasonId: season.Id,
                    userId
                });
                const episodeItems = episodes?.Items || [];
                if (!episodeItems.length && !emptySeason) {
                    emptySeason = {
                        Id: season.Id,
                        SeriesId: series.Id
                    };
                }
                if (!selectedEpisode && episodeItems.length) {
                    selectedSeries = series;
                    selectedSeason = season;
                    selectedEpisode = episodeItems[0];
                }
                if (selectedEpisode && emptySeason) break;
            }
            if (selectedEpisode && emptySeries && emptySeason) break;
        }

        if (selectedSeries) candidates.Series = [ selectedSeries ];
        if (selectedEpisode) {
            candidates.Episode = [{
                Id: selectedEpisode.Id,
                Name: selectedEpisode.Name,
                ServerId: selectedEpisode.ServerId,
                Type: selectedEpisode.Type
            }];
        }

        return {
            candidates,
            emptySeason,
            emptySeries,
            selectedSeason: selectedSeason ? {
                Id: selectedSeason.Id,
                Name: selectedSeason.Name,
                ServerId: selectedSeason.ServerId || selectedSeries.ServerId,
                SeriesId: selectedSeries.Id,
                Type: selectedSeason.Type
            } : null
        };
    }, [ ...GENERIC_SEARCH_TYPES, ...SPECIALIZED_SEARCH_TYPES ]);
}

function buildDetailsHref(candidate) {
    if (!candidate?.Id) throw new Error('details-route-data-unavailable');
    const serverParam = candidate.ServerId ?
        `&serverId=${encodeURIComponent(candidate.ServerId)}` :
        '';

    return `#/details?id=${encodeURIComponent(candidate.Id)}${serverParam}`;
}

async function openSearchResult(page, candidate) {
    await navigateWithRouter(page, '#/search');
    await waitForRoute(page, 'search');
    const input = page.locator('input[data-ptv-focus-key="search-input"]');
    await input.waitFor({ state: 'visible', timeout: 20_000 });
    await input.fill(candidate.SearchTerm || candidate.Name);
    await input.press('Enter');
    await page.waitForFunction(type => (
        [ ...document.querySelectorAll('.ptv-search-card') ]
            .some(card => card.dataset.ptvSearchItemType === type)
    ), candidate.Type, { timeout: 30_000 });

    const cards = page.locator(
        `.ptv-search-card[data-ptv-search-item-type="${candidate.Type}"]`
    );
    const index = await cards.evaluateAll((elements, id) => (
        elements.findIndex(element => element.dataset.ptvSearchItemId === id)
    ), candidate.Id);

    return cards.nth(index >= 0 ? index : 0);
}

async function waitForSearchRestoration(page, candidate) {
    await page.waitForFunction(({ id, query }) => {
        const input = document.querySelector('input[data-ptv-focus-key="search-input"]');
        const resultPresent = [ ...document.querySelectorAll('.ptv-search-card') ]
            .some(card => card.dataset.ptvSearchItemId === id);

        return input?.value === query && resultPresent;
    }, {
        id: candidate.Id,
        query: candidate.Name
    }, { timeout: 20_000 });

    return {
        queryRestored: true,
        resultRestored: true
    };
}

const HOME_CARD_SELECTOR = [
    'a.ptv-native-card-media-link[data-ptv-route-source="jellyfin-fallback"]',
    '[data-ptv-item-type="Movie"],',
    'a.ptv-native-card-media-link[data-ptv-route-source="jellyfin-fallback"]',
    '[data-ptv-item-type="Series"]'
].join('');

async function getDetailsOwnerState(page) {
    return page.evaluate(() => {
        const candidates = [ ...document.querySelectorAll('#itemDetailPage,.itemDetailPage') ];
        const current = candidates.find(element => element.classList.contains('page-active'))
            || candidates.find(element => element.getAttribute('aria-hidden') !== 'true')
            || candidates[0];
        const rect = current?.getBoundingClientRect();

        return {
            active: Boolean(current)
                && (current.classList.contains('page-active')
                    || current.getAttribute('aria-hidden') !== 'true'),
            contentBoundaryPresent: Boolean(current?.querySelector(
                '.detailPageWrapperContainer,.detailPagePrimaryContainer,.nameContainer'
            )),
            dataLoading: current?.classList.contains('ptv-detail-data-loading') ?? null,
            ownerCount: candidates.length,
            visible: Boolean(rect && rect.width > 0 && rect.height > 100)
        };
    });
}

async function getHomeCardState(page) {
    return page.evaluate(selector => {
        const anchors = [ ...document.querySelectorAll(selector) ];
        const anchor = anchors[0];
        const shelf = anchor?.closest('[data-ptv-layout-node="home-shelf"]');
        const shelves = [ ...document.querySelectorAll('[data-ptv-layout-node="home-shelf"]') ];
        const scroller = anchor?.closest('[data-ptv-layout-node="home-shelf-scroller"]');
        const cards = scroller ? [ ...scroller.querySelectorAll(selector) ] : [];
        const rect = anchor?.getBoundingClientRect();

        anchor?.scrollIntoView({ block: 'nearest', inline: 'center' });
        anchor?.focus();

        return {
            actionable: Boolean(anchor)
                && !anchor.hasAttribute('disabled')
                && anchor.getAttribute('aria-disabled') !== 'true',
            anchorIndex: anchors.indexOf(anchor),
            cardIndex: cards.indexOf(anchor),
            href: anchor?.getAttribute('href') || '',
            mediaType: anchor?.getAttribute('data-ptv-item-type') || null,
            rowCardCount: cards.length,
            rowIndex: shelves.indexOf(shelf),
            scrollLeft: scroller?.scrollLeft || 0,
            visible: Boolean(rect && rect.width > 0 && rect.height > 0)
        };
    }, HOME_CARD_SELECTOR);
}

async function runHomeAcceptance(page) {
    const stage = createStageRecorder();

    await stage.requireStage('home-ready', 'home-not-ready', async () => {
        if (routeCategory(page.url()) === 'home') {
            await navigateWithRouter(page, '#/search');
            await waitForRoute(page, 'search');
        }
        await navigateWithRouter(page, '#/home');
        await waitForRoute(page, 'home');
        await page.waitForSelector('[data-ptv-layout-node="home-root"]', {
            state: 'visible',
            timeout: 30_000
        });

        return {
            evidence: { routeCategory: routeCategory(page.url()) },
            value: routeCategory(page.url()) === 'home'
        };
    });
    const startingHistoryLength = await page.evaluate(() => window.history.length);
    await stage.requireStage('eligible-card-found', 'home-card-not-found', async () => {
        await page.waitForSelector(HOME_CARD_SELECTOR, {
            state: 'attached',
            timeout: 30_000
        }).catch(() => undefined);
        const count = await page.locator(HOME_CARD_SELECTOR).count();
        const modelState = await page.evaluate(() => ({
            heroPresent: Boolean(document.querySelector(
                '[data-ptv-layout-node="home-hero"]'
            )),
            loadingPresent: Boolean(document.querySelector('.ptv-native-home-loading')),
            mountedRowCount: Number(document.querySelector(
                '[data-ptv-layout-node="home-root"]'
            )?.getAttribute('data-ptv-mounted-rows') || 0),
            populatedShelfCount: [ ...document.querySelectorAll(
                '[data-ptv-layout-node="home-shelf"]'
            ) ].filter(shelf => shelf.querySelector('a.ptv-native-card-media-link')).length,
            totalCardCount: document.querySelectorAll(
                'a.ptv-native-card-media-link'
            ).length
        }));

        return {
            evidence: {
                candidateCount: count,
                heroPresent: modelState.heroPresent,
                loadingPresent: modelState.loadingPresent,
                mountedRowCount: modelState.mountedRowCount,
                populatedShelfCount: modelState.populatedShelfCount,
                totalCardCount: modelState.totalCardCount
            },
            value: count > 0
        };
    });
    const starting = await stage.requireStage(
        'card-visible-and-enabled',
        'home-card-not-actionable',
        async () => {
            const value = await getHomeCardState(page);

            return {
                evidence: {
                    cardOrdinal: value.cardIndex,
                    mediaType: value.mediaType,
                    shelfIndex: value.rowIndex
                },
                value
            };
        },
        value => value.actionable
            && value.visible
            && value.href.startsWith('#/details?')
            && [ 'Movie', 'Series' ].includes(value.mediaType)
    );

    await installInstrumentation(page);
    await resetInstrumentation(page);
    const pointerCard = page.locator(HOME_CARD_SELECTOR).nth(starting.anchorIndex);
    await stage.requireStage('activation-dispatched', 'home-activation-not-observed', async () => {
        await pointerCard.click();

        return {
            evidence: { activationMethod: 'playwright-pointer' },
            value: true
        };
    });
    await stage.requireStage('feature-handler-observed', 'home-activation-not-observed', async () => {
        await page.waitForFunction(() => (
            (window.__PTV_PHASE2D_VALIDATION__?.getCounts?.().primaryActivationsPrevented || 0) >= 1
        ), null, { timeout: 5_000 });
        const counts = await getInstrumentationCounts(page);

        return {
            evidence: {
                activationCount: counts.primaryActivations,
                defaultPreventedActivationCount: counts.primaryActivationsPrevented
            },
            value: counts.primaryActivations === 1
                && counts.primaryActivationsPrevented === 1
        };
    });
    await stage.requireStage('app-router-call-observed', 'home-app-router-not-called', async () => {
        await page.waitForFunction(() => (
            (window.__PTV_PHASE2D_VALIDATION__?.getCounts?.().appRouterTransitions || 0) >= 1
        ), null, { timeout: 5_000 });
        const counts = await getInstrumentationCounts(page);

        return {
            evidence: { appRouterInvocationCount: counts.appRouterTransitions },
            value: counts.appRouterTransitions === 1
        };
    });
    await stage.requireStage('details-hash-category-reached', 'home-details-hash-not-reached', async () => {
        await waitForRoute(page, 'details', 10_000);
        const counts = await getInstrumentationCounts(page);
        const historyLength = await page.evaluate(() => window.history.length);

        return {
            evidence: {
                actualHashTransitionCount: counts.hashTransitions,
                historyLengthDelta: historyLength - startingHistoryLength,
                historyTransitionCount: counts.historyTransitions,
                routeCategory: routeCategory(page.url()),
                routeCategoryTransitionCount: counts.routeCategoryTransitions
            },
            value: routeCategory(page.url()) === 'details'
                && counts.routeCategoryTransitions === 1
        };
    });
    await stage.requireStage('details-route-owner-observed', 'home-details-owner-not-ready', async () => {
        await page.waitForFunction(() => (
            [ ...document.querySelectorAll('#itemDetailPage,.itemDetailPage') ]
                .some(element => element.classList.contains('page-active')
                    || element.getAttribute('aria-hidden') !== 'true')
        ), null, { timeout: 10_000 });
        const value = await getDetailsOwnerState(page);

        return {
            evidence: {
                detailsOwnerActive: value.active,
                detailsOwnerCount: value.ownerCount,
                detailsOwnerVisible: value.visible
            },
            value
        };
    }, value => value.active && value.visible);
    await stage.requireStage('details-content-ready', 'home-details-content-not-ready', async () => {
        await page.waitForFunction(() => (
            [ ...document.querySelectorAll('#itemDetailPage,.itemDetailPage') ]
                .some(element => !element.classList.contains('ptv-detail-data-loading')
                    && Boolean(element.querySelector(
                        '.detailPageWrapperContainer,.detailPagePrimaryContainer,.nameContainer'
                    )))
        ), null, { timeout: 20_000 });
        const value = await getDetailsOwnerState(page);

        return {
            evidence: {
                contentBoundaryPresent: value.contentBoundaryPresent,
                detailsDataLoading: value.dataLoading
            },
            value
        };
    }, value => value.contentBoundaryPresent && value.dataLoading === false);

    const pointerCounts = await getInstrumentationCounts(page);
    await resetInstrumentation(page);
    await stage.requireStage('browser-back-invoked', 'home-back-hash-not-restored', async () => {
        await page.goBack();

        return { evidence: { backMethod: 'browser-history' }, value: true };
    });
    await stage.requireStage('home-hash-category-restored', 'home-back-hash-not-restored', async () => {
        await waitForRoute(page, 'home', 10_000);
        const counts = await getInstrumentationCounts(page);

        return {
            evidence: {
                popStateTransitionCount: counts.popStateTransitions,
                routeCategory: routeCategory(page.url())
            },
            value: routeCategory(page.url()) === 'home'
        };
    });
    await stage.requireStage('home-route-owner-restored', 'home-route-owner-not-restored', async () => {
        await page.waitForSelector('[data-ptv-layout-node="home-root"]', {
            state: 'visible',
            timeout: 20_000
        });
        const count = await page.locator('[data-ptv-layout-node="home-root"]').count();

        return { evidence: { homeOwnerCount: count }, value: count === 1 };
    });
    const restored = await stage.requireStage(
        'home-populated-model-restored',
        'home-model-not-restored',
        async () => {
            await page.waitForFunction(() => {
                const hero = document.querySelector('[data-ptv-layout-node="home-hero"]');
                const populatedShelf = [ ...document.querySelectorAll(
                    '[data-ptv-layout-node="home-shelf"]'
                ) ].some(shelf => shelf.querySelector('a.ptv-native-card-media-link'));

                return Boolean(hero || populatedShelf);
            }, null, { timeout: 20_000 });
            const value = await page.evaluate(expected => {
                const shelves = [ ...document.querySelectorAll(
                    '[data-ptv-layout-node="home-shelf"]'
                ) ];
                const shelf = shelves[expected.rowIndex];
                const scroller = shelf?.querySelector(
                    '[data-ptv-layout-node="home-shelf-scroller"]'
                );
                const cards = scroller ? [ ...scroller.querySelectorAll(
                    'a.ptv-native-card-media-link[data-ptv-route-source="jellyfin-fallback"]'
                ) ] : [];

                return {
                    cardPresentAtOrdinal: Boolean(cards[expected.cardIndex]),
                    heroPresent: Boolean(document.querySelector(
                        '[data-ptv-layout-node="home-hero"]'
                    )),
                    populatedShelfCount: shelves.filter(candidate => (
                        candidate.querySelector('a.ptv-native-card-media-link')
                    )).length,
                    rowCardCount: cards.length,
                    scrollPositionApproximate: Boolean(scroller)
                        && Math.abs((scroller.scrollLeft || 0) - expected.scrollLeft) <= 200
                };
            }, starting);

            return {
                evidence: {
                    cardPresentAtOrdinal: value.cardPresentAtOrdinal,
                    heroPresent: value.heroPresent,
                    populatedShelfCount: value.populatedShelfCount,
                    rowCardCount: value.rowCardCount
                },
                value
            };
        },
        value => (value.heroPresent || value.populatedShelfCount > 0)
            && value.cardPresentAtOrdinal
    );
    await stage.requireStage(
        'home-shelf-position-restored',
        'home-shelf-position-not-restored',
        async () => ({
            evidence: {
                cardOrdinalRestored: restored.cardPresentAtOrdinal,
                scrollPositionApproximate: restored.scrollPositionApproximate,
                shelfIndex: starting.rowIndex
            },
            value: restored.cardPresentAtOrdinal && restored.scrollPositionApproximate
        })
    );

    const keyboard = await getHomeCardState(page);
    await resetInstrumentation(page);
    const keyboardCard = page.locator(HOME_CARD_SELECTOR).nth(keyboard.anchorIndex);
    await stage.requireStage('keyboard-activation-dispatched', 'home-keyboard-activation-not-observed', async () => {
        await keyboardCard.focus();
        await keyboardCard.press('Enter');
        await waitForRoute(page, 'details', 10_000);
        const counts = await getInstrumentationCounts(page);

        return {
            evidence: {
                activationMethod: 'playwright-keyboard-enter',
                appRouterInvocationCount: counts.appRouterTransitions,
                coreNavigationEventCount: counts.coreNavigationDiagnostics
            },
            value: counts.appRouterTransitions === 1
                && counts.coreNavigationDiagnostics <= 1
        };
    });
    const keyboardCounts = await getInstrumentationCounts(page);
    await stage.requireStage('details-refresh-ready', 'home-details-refresh-not-ready', async () => {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForRoute(page, 'details', 10_000);
        await page.waitForFunction(() => (
            [ ...document.querySelectorAll('#itemDetailPage,.itemDetailPage') ]
                .some(element => !element.classList.contains('ptv-detail-data-loading')
                    && Boolean(element.querySelector(
                        '.detailPageWrapperContainer,.detailPagePrimaryContainer,.nameContainer'
                    )))
        ), null, { timeout: 20_000 });
        const owner = await getDetailsOwnerState(page);

        return {
            evidence: {
                contentBoundaryPresent: owner.contentBoundaryPresent,
                routeCategory: routeCategory(page.url())
            },
            value: owner.active && owner.contentBoundaryPresent
        };
    });

    return {
        passed: true,
        result: {
            backRestoredCardPosition: restored.cardPresentAtOrdinal,
            backRestoredHome: restored.heroPresent || restored.populatedShelfCount > 0,
            backRestoredScrollPosition: restored.scrollPositionApproximate,
            deepLinkRefreshPassed: true,
            keyboardCoreNavigationDiagnostics: keyboardCounts.coreNavigationDiagnostics,
            keyboardRouteTransitions: keyboardCounts.appRouterTransitions,
            pointerCoreNavigationDiagnostics: pointerCounts.coreNavigationDiagnostics,
            pointerHashTransitions: pointerCounts.hashTransitions,
            pointerHistoryTransitions: pointerCounts.historyTransitions,
            pointerRouteTransitions: pointerCounts.appRouterTransitions,
            stages: stage.snapshot()
        }
    };
}

async function runSearchAcceptance(page, catalog) {
    const stage = createStageRecorder();
    const availability = Object.fromEntries(
        [ ...GENERIC_SEARCH_TYPES, ...SPECIALIZED_SEARCH_TYPES ]
            .map(type => [ type, Boolean(catalog.candidates[type]?.[0]) ])
    );
    if (!GENERIC_SEARCH_TYPES.every(type => availability[type])) {
        throw new Error('required-generic-search-data-unavailable');
    }

    const movie = catalog.candidates.Movie[0];
    await stage.requireStage('search-route-ready', 'search-route-not-ready', async () => {
        await navigateWithRouter(page, '#/search');
        await waitForRoute(page, 'search');

        return {
            evidence: { routeCategory: routeCategory(page.url()) },
            value: routeCategory(page.url()) === 'search'
        };
    });
    const searchInput = await stage.requireStage(
        'query-control-available',
        'search-query-control-unavailable',
        async () => {
            const input = page.locator('input[data-ptv-focus-key="search-input"]');
            await input.waitFor({ state: 'visible', timeout: 20_000 });
            const count = await input.count();

            return { evidence: { controlCount: count }, value: input };
        },
        () => true
    );
    await stage.requireStage('query-submitted', 'search-query-submit-failed', async () => {
        await searchInput.fill(movie.Name);
        await searchInput.press('Enter');

        return { evidence: { submissionMethod: 'keyboard-enter' }, value: true };
    });
    const movieCard = await stage.requireStage(
        'generic-movie-result-available',
        'search-generic-movie-result-unavailable',
        async () => {
            await page.waitForFunction(({ id, type }) => (
                [ ...document.querySelectorAll('.ptv-search-card') ]
                    .some(card => card.dataset.ptvSearchItemId === id
                        && card.dataset.ptvSearchItemType === type)
            ), {
                id: movie.Id,
                type: movie.Type
            }, { timeout: 30_000 });
            const cards = page.locator(
                `.ptv-search-card[data-ptv-search-item-type="${movie.Type}"]`
            );
            const index = await cards.evaluateAll((elements, id) => (
                elements.findIndex(element => element.dataset.ptvSearchItemId === id)
            ), movie.Id);

            return {
                evidence: { mediaType: movie.Type, resultOrdinal: index },
                value: cards.nth(index)
            };
        },
        () => true
    );
    await stage.requireStage(
        'activation-target-available',
        'search-activation-target-unavailable',
        async () => {
            const href = await movieCard.getAttribute('href');
            const visible = await movieCard.isVisible();

            return {
                evidence: {
                    hrefCategory: href?.startsWith('#/details?') ? 'details' : 'other',
                    mediaType: movie.Type,
                    visible
                },
                value: visible && Boolean(href?.startsWith('#/details?'))
            };
        }
    );
    await installInstrumentation(page);
    await resetInstrumentation(page);
    await stage.requireStage('activation-observed', 'search-activation-not-observed', async () => {
        await movieCard.click();

        return { evidence: { activationMethod: 'playwright-pointer' }, value: true };
    });
    await stage.requireStage('feature-handler-observed', 'search-activation-not-observed', async () => {
        await page.waitForFunction(() => (
            (window.__PTV_PHASE2D_VALIDATION__?.getCounts?.().primaryActivationsPrevented || 0) >= 1
        ), null, { timeout: 5_000 });
        const counts = await getInstrumentationCounts(page);

        return {
            evidence: {
                activationCount: counts.primaryActivations,
                defaultPreventedActivationCount: counts.primaryActivationsPrevented
            },
            value: counts.primaryActivations === 1
                && counts.primaryActivationsPrevented === 1
        };
    });
    await stage.requireStage('app-router-observed', 'search-app-router-not-called', async () => {
        await page.waitForFunction(() => (
            (window.__PTV_PHASE2D_VALIDATION__?.getCounts?.().appRouterTransitions || 0) >= 1
        ), null, { timeout: 5_000 });
        const counts = await getInstrumentationCounts(page);

        return {
            evidence: {
                appRouterInvocationCount: counts.appRouterTransitions,
                coreNavigationEventCount: counts.coreNavigationDiagnostics
            },
            value: counts.appRouterTransitions === 1
                && counts.coreNavigationDiagnostics <= 1
        };
    });
    await stage.requireStage('details-route-reached', 'search-details-route-not-reached', async () => {
        await waitForRoute(page, 'details', 10_000);
        const counts = await getInstrumentationCounts(page);

        return {
            evidence: {
                actualHashTransitionCount: counts.hashTransitions,
                historyTransitionCount: counts.historyTransitions,
                routeCategory: routeCategory(page.url()),
                routeCategoryTransitionCount: counts.routeCategoryTransitions
            },
            value: routeCategory(page.url()) === 'details'
        };
    });
    await stage.requireStage('details-route-owner-ready', 'search-details-owner-not-ready', async () => {
        await page.waitForFunction(() => (
            [ ...document.querySelectorAll('#itemDetailPage,.itemDetailPage') ]
                .some(element => !element.classList.contains('ptv-detail-data-loading')
                    && Boolean(element.querySelector(
                        '.detailPageWrapperContainer,.detailPagePrimaryContainer,.nameContainer'
                    )))
        ), null, { timeout: 20_000 });
        const owner = await getDetailsOwnerState(page);

        return {
            evidence: {
                contentBoundaryPresent: owner.contentBoundaryPresent,
                detailsOwnerActive: owner.active
            },
            value: owner.active && owner.contentBoundaryPresent
        };
    });
    const movieCounts = await getInstrumentationCounts(page);
    await stage.requireStage('back-restored-search', 'search-back-not-restored', async () => {
        await page.goBack();
        await waitForRoute(page, 'search', 10_000);

        return {
            evidence: { routeCategory: routeCategory(page.url()) },
            value: routeCategory(page.url()) === 'search'
        };
    });
    await stage.requireStage(
        'query-and-results-restored',
        'search-query-results-not-restored',
        async () => {
            const value = await waitForSearchRestoration(page, movie);

            return { evidence: value, value };
        },
        value => value.queryRestored && value.resultRestored
    );

    const genericResults = {};
    genericResults.Movie = {
        coreNavigationDiagnostics: movieCounts.coreNavigationDiagnostics,
        detailsRoute: true,
        queryRestored: true,
        resultRestored: true,
        routeTransitions: movieCounts.appRouterTransitions
    };
    for (const type of GENERIC_SEARCH_TYPES.filter(candidateType => candidateType !== 'Movie')) {
        const candidate = catalog.candidates[type][0];
        const card = await stage.requireStage(
            `generic-${type.toLowerCase()}-result-available`,
            `search-generic-${type.toLowerCase()}-result-unavailable`,
            async () => ({
                evidence: { mediaType: type },
                value: await openSearchResult(page, candidate)
            }),
            () => true
        );
        const href = await card.getAttribute('href');
        const selectedItemId = await card.getAttribute('data-ptv-search-item-id');
        if (!href?.startsWith('#/details?')) throw new Error('generic-search-route-invalid');
        if (!selectedItemId) throw new Error('search-result-identity-unavailable');

        await installInstrumentation(page);
        await resetInstrumentation(page);
        const counts = await stage.requireStage(
            `generic-${type.toLowerCase()}-details-route`,
            `search-generic-${type.toLowerCase()}-details-route-failed`,
            async () => {
                await card.click();
                await waitForDetails(page);
                const value = await getInstrumentationCounts(page);

                return {
                    evidence: {
                        appRouterInvocationCount: value.appRouterTransitions,
                        mediaType: type,
                        routeCategory: routeCategory(page.url())
                    },
                    value
                };
            },
            value => routeCategory(page.url()) === 'details'
                && value.appRouterTransitions === 1
        );
        genericResults[type] = {
            coreNavigationDiagnostics: counts.coreNavigationDiagnostics,
            detailsRoute: routeCategory(page.url()) === 'details',
            routeTransitions: counts.appRouterTransitions
        };

        const restored = await stage.requireStage(
            `generic-${type.toLowerCase()}-back-restored`,
            `search-generic-${type.toLowerCase()}-back-not-restored`,
            async () => {
                await page.goBack();
                await waitForRoute(page, 'search');
                const value = await waitForSearchRestoration(page, {
                    Id: selectedItemId,
                    Name: candidate.SearchTerm || candidate.Name
                });

                return { evidence: { mediaType: type, ...value }, value };
            },
            value => value.queryRestored && value.resultRestored
        );
        genericResults[type].queryRestored = restored.queryRestored;
        genericResults[type].resultRestored = restored.resultRestored;
    }

    let card = await stage.requireStage(
        'modifier-movie-result-available',
        'search-modifier-result-unavailable',
        async () => ({ value: await openSearchResult(page, movie) }),
        () => true
    );
    await installInstrumentation(page);
    await resetInstrumentation(page);
    const originalPageCount = page.context().pages().length;
    const newPagePromise = page.context().waitForEvent('page', { timeout: 5_000 })
        .catch(() => null);
    await card.click({ button: 'middle' });
    const openedPage = await newPagePromise;
    if (openedPage) await openedPage.close();
    const nativeAnchorCounts = await getInstrumentationCounts(page);
    const nativeAnchorBehavior = routeCategory(page.url()) === 'search'
        && nativeAnchorCounts.appRouterTransitions === 0
        && page.context().pages().length === originalPageCount;
    await stage.requireStage(
        'modifier-middle-click-behavior-verified',
        'search-modifier-behavior-changed',
        async () => ({
            evidence: { appRouterInvocationCount: nativeAnchorCounts.appRouterTransitions },
            value: nativeAnchorBehavior
        })
    );

    card = await stage.requireStage(
        'keyboard-movie-result-available',
        'search-keyboard-result-unavailable',
        async () => ({ value: await openSearchResult(page, movie) }),
        () => true
    );
    await installInstrumentation(page);
    await resetInstrumentation(page);
    const keyboardCounts = await stage.requireStage(
        'keyboard-details-route',
        'search-keyboard-details-route-failed',
        async () => {
            await card.focus();
            await card.press('Enter');
            await waitForDetails(page);
            const value = await getInstrumentationCounts(page);

            return {
                evidence: {
                    appRouterInvocationCount: value.appRouterTransitions,
                    routeCategory: routeCategory(page.url())
                },
                value
            };
        },
        value => routeCategory(page.url()) === 'details'
            && value.appRouterTransitions === 1
    );

    await page.goBack();
    await waitForRoute(page, 'search');
    card = await stage.requireStage(
        'double-activation-movie-result-available',
        'search-double-activation-result-unavailable',
        async () => ({ value: await openSearchResult(page, movie) }),
        () => true
    );
    await installInstrumentation(page);
    await resetInstrumentation(page);
    await card.evaluate(element => {
        const init = {
            bubbles: true,
            button: 0,
            cancelable: true
        };
        element.dispatchEvent(new MouseEvent('click', init));
        element.dispatchEvent(new MouseEvent('click', init));
    });
    const doubleCounts = await stage.requireStage(
        'double-activation-details-route',
        'search-double-activation-route-failed',
        async () => {
            await waitForDetails(page);
            const value = await getInstrumentationCounts(page);

            return {
                evidence: {
                    appRouterInvocationCount: value.appRouterTransitions,
                    routeCategory: routeCategory(page.url())
                },
                value
            };
        },
        value => routeCategory(page.url()) === 'details'
            && value.appRouterTransitions === 1
    );

    const specializedResults = {};
    for (const type of SPECIALIZED_SEARCH_TYPES) {
        const candidate = catalog.candidates[type]?.[0];
        if (!candidate) {
            specializedResults[type] = {
                available: false,
                specializedRouteRetained: null
            };
            continue;
        }

        const specializedCard = await stage.requireStage(
            `specialized-${type.toLowerCase()}-result-available`,
            `search-specialized-${type.toLowerCase()}-result-unavailable`,
            async () => ({
                evidence: { mediaType: type },
                value: await openSearchResult(page, candidate)
            }),
            () => true
        );
        const expectedHref = await specializedCard.getAttribute('href');
        await installInstrumentation(page);
        await resetInstrumentation(page);
        const specializedOutcome = await stage.requireStage(
            `specialized-${type.toLowerCase()}-route-retained`,
            `search-specialized-${type.toLowerCase()}-route-changed`,
            async () => {
                await specializedCard.click();
                await page.waitForTimeout(1_200);
                const counts = await getInstrumentationCounts(page);
                const routeMatched = await page.evaluate(
                    expected => window.location.hash === expected,
                    expectedHref
                );

                return {
                    evidence: {
                        appRouterInvocationCount: counts.appRouterTransitions,
                        genericDetailsRouteUsed: expectedHref?.startsWith('#/details?') || false,
                        mediaType: type
                    },
                    value: { counts, routeMatched }
                };
            },
            value => value.routeMatched && !expectedHref?.startsWith('#/details?')
        );

        specializedResults[type] = {
            appRouterTransitions: specializedOutcome.counts.appRouterTransitions,
            available: true,
            genericDetailsRouteUsed: expectedHref?.startsWith('#/details?') || false,
            specializedRouteRetained: specializedOutcome.routeMatched
                && !expectedHref?.startsWith('#/details?')
        };
    }

    const genericPassed = Object.values(genericResults).every(result => (
        result.coreNavigationDiagnostics <= 1
        && result.detailsRoute
        && result.queryRestored
        && result.resultRestored
        && result.routeTransitions === 1
    ));
    const specializedPassed = Object.values(specializedResults).every(result => (
        !result.available || result.specializedRouteRetained
    ));
    const passed = genericPassed
        && nativeAnchorBehavior
        && keyboardCounts.appRouterTransitions === 1
        && keyboardCounts.coreNavigationDiagnostics <= 1
        && doubleCounts.appRouterTransitions === 1
        && doubleCounts.coreNavigationDiagnostics <= 1
        && specializedPassed;

    return {
        passed,
        result: {
            availability,
            doubleActivationCoreNavigationDiagnostics: doubleCounts.coreNavigationDiagnostics,
            doubleActivationRouteTransitions: doubleCounts.appRouterTransitions,
            genericResults,
            keyboardCoreNavigationDiagnostics: keyboardCounts.coreNavigationDiagnostics,
            keyboardRouteTransitions: keyboardCounts.appRouterTransitions,
            nativeAnchorBehavior,
            specializedResults,
            stages: stage.snapshot()
        }
    };
}

async function waitForApiResponse(page, category, action) {
    const responsePromise = page.waitForResponse(response => (
        classifyApiRequest(response.url())?.category === category
    ), { timeout: 20_000 });
    await action();

    return responsePromise;
}

async function getResponseListMetadata(response) {
    const value = await response.json();
    const items = Array.isArray(value?.Items) ? value.Items : [];

    return {
        ids: items.map(item => item?.Id).filter(id => typeof id === 'string'),
        itemCount: items.length,
        items
    };
}

async function getSeriesDomMetadata(page) {
    return page.evaluate(() => {
        const cards = [ ...document.querySelectorAll(
            '#listChildrenCollapsible .itemsContainer .card[data-type="Season"]'
        ) ];

        return {
            artworkCount: cards.filter(card => Boolean(
                card.querySelector('.cardImageContainer,[data-src]')
            )).length,
            ids: cards.map(card => card.getAttribute('data-id')).filter(Boolean),
            seasonCount: cards.length
        };
    });
}

async function runSeriesAcceptance(page, catalog, observer) {
    const stage = createStageRecorder();
    const series = catalog.candidates.Series?.[0];
    const seriesHref = buildDetailsHref(series);

    await installInstrumentation(page);
    await resetInstrumentation(page);
    const firstSnapshot = observer.snapshot();
    const firstResponse = await stage.requireStage(
        'series-independent-setup',
        'series-independent-setup-failed',
        async () => ({
            evidence: { startingRouteCategory: routeCategory(page.url()) },
            value: await waitForApiResponse(page, 'getSeasons', () => (
                navigateWithRouter(page, seriesHref)
            ))
        }),
        () => true
    );
    const firstRaw = await getResponseListMetadata(firstResponse);
    const firstDom = await stage.requireStage(
        'series-renderer-ready',
        'series-renderer-not-ready',
        async () => {
            await waitForDetails(page);
            await page.waitForFunction(expectedCount => (
                document.querySelectorAll(
                    '#listChildrenCollapsible .itemsContainer .card[data-type="Season"]'
                ).length === expectedCount
            ), firstRaw.itemCount, { timeout: 20_000 });
            const value = await getSeriesDomMetadata(page);

            return {
                evidence: {
                    rawItemCount: firstRaw.itemCount,
                    renderedItemCount: value.seasonCount
                },
                value
            };
        },
        value => value.seasonCount === firstRaw.itemCount
    );
    const firstCounts = await getInstrumentationCounts(page);
    const firstRecords = observer.recordsSince(firstSnapshot)
        .filter(record => record.category === 'getSeasons');
    const firstRequest = firstRecords[0] || {};
    const usableSeasonRoute = await page.locator(
        '#listChildrenCollapsible .itemsContainer .card[data-type="Season"] a.itemAction'
    ).first().getAttribute('href');

    await installInstrumentation(page);
    await resetInstrumentation(page);
    const refreshSnapshot = observer.snapshot();
    const refreshResponse = await stage.requireStage(
        'series-refresh-request',
        'series-refresh-request-failed',
        async () => ({
            evidence: { operationCategory: 'getSeasons' },
            value: await waitForApiResponse(page, 'getSeasons', () => (
                page.reload({ waitUntil: 'domcontentloaded' })
            ))
        }),
        () => true
    );
    const refreshRaw = await getResponseListMetadata(refreshResponse);
    await waitForDetails(page);
    await page.waitForFunction(expectedCount => (
        document.querySelectorAll(
            '#listChildrenCollapsible .itemsContainer .card[data-type="Season"]'
        ).length === expectedCount
    ), refreshRaw.itemCount, { timeout: 20_000 });
    const refreshRecords = observer.recordsSince(refreshSnapshot)
        .filter(record => record.category === 'getSeasons');
    const refreshCounts = await getInstrumentationCounts(page);

    const orderMatches = firstDom.ids.length === firstRaw.ids.length
        && firstDom.ids.every((id, index) => id === firstRaw.ids[index]);
    const passed = firstRecords.length === 1
        && refreshRecords.length === 1
        && firstRequest.fieldsMatch === true
        && firstRequest.hasUserId === true
        && firstRequest.queryCasingMatch === true
        && firstDom.seasonCount === firstRaw.itemCount
        && orderMatches
        && firstCounts.coreSeasonDiagnostics <= 1
        && refreshCounts.coreSeasonDiagnostics <= 1
        && Boolean(usableSeasonRoute);
    await stage.requireStage(
        'series-contract-verified',
        'series-contract-mismatch',
        async () => ({
            evidence: {
                initialRequestCount: firstRecords.length,
                refreshRequestCount: refreshRecords.length,
                rendererOrderRetained: orderMatches
            },
            value: passed
        })
    );

    return {
        passed: true,
        result: {
            artworkCardCount: firstDom.artworkCount,
            coreDiagnosticsInitial: firstCounts.coreSeasonDiagnostics,
            coreDiagnosticsRefresh: refreshCounts.coreSeasonDiagnostics,
            emptySeriesAvailable: Boolean(catalog.emptySeries),
            fieldsRetained: firstRequest.fieldsMatch === true,
            initialRequestCount: firstRecords.length,
            queryCasingRetained: firstRequest.queryCasingMatch === true,
            rawItemCountMatchedRenderer: firstDom.seasonCount === firstRaw.itemCount,
            refreshRequestCount: refreshRecords.length,
            seasonOrderRetained: orderMatches,
            stages: stage.snapshot(),
            userScopeRetained: firstRequest.hasUserId === true
        }
    };
}

async function getEpisodeDomMetadata(page) {
    return page.evaluate(() => {
        const items = [ ...document.querySelectorAll(
            '#listChildrenCollapsible .itemsContainer .listItem[data-type="Episode"]'
        ) ];

        return {
            artworkCount: items.filter(item => Boolean(
                item.querySelector('.listItemImage')
            )).length,
            ids: items.map(item => item.getAttribute('data-id')).filter(Boolean),
            itemCount: items.length,
            overviewCount: items.filter(item => Boolean(
                item.querySelector('.listItem-overview,.listItem-bottomoverview')
            )).length,
            playedCount: items.filter(item => Boolean(
                item.querySelector('.playedIndicator,[data-played="true"]')
            )).length,
            progressCount: items.filter(item => Boolean(
                item.querySelector('.listItemProgressBar')
            )).length
        };
    });
}

async function runEpisodeAcceptance(page, catalog, observer) {
    const stage = createStageRecorder();
    const series = catalog.candidates.Series?.[0];
    const season = catalog.selectedSeason;
    if (!series || !season) throw new Error('season-route-unavailable');
    const seriesHref = buildDetailsHref(series);

    await stage.requireStage(
        'season-independent-series-setup',
        'season-independent-setup-failed',
        async () => {
            await navigateWithRouter(page, seriesHref);
            await waitForDetails(page);
            await page.waitForSelector(
                '#listChildrenCollapsible .itemsContainer .card[data-type="Season"]',
                { state: 'visible', timeout: 20_000 }
            );

            return {
                evidence: { routeCategory: routeCategory(page.url()) },
                value: true
            };
        }
    );

    await installInstrumentation(page);
    await resetInstrumentation(page);
    const firstSnapshot = observer.snapshot();
    const firstResponse = await stage.requireStage(
        'season-episode-request',
        'season-episode-request-failed',
        async () => ({
            evidence: { activationMethod: 'playwright-pointer' },
            value: await waitForApiResponse(page, 'getEpisodes', async () => {
                const seasonLink = page.locator(
                    `#listChildrenCollapsible .itemsContainer .card[data-type="Season"][data-id="${season.Id}"] a.itemAction.textActionButton`
                ).first();
                await seasonLink.click();
            })
        }),
        () => true
    );
    const firstRaw = await getResponseListMetadata(firstResponse);
    const firstDom = await stage.requireStage(
        'episode-renderer-ready',
        'episode-renderer-not-ready',
        async () => {
            await waitForDetails(page);
            await page.waitForFunction(expectedCount => (
                document.querySelectorAll(
                    '#listChildrenCollapsible .itemsContainer .listItem[data-type="Episode"]'
                ).length === expectedCount
            ), firstRaw.itemCount, { timeout: 20_000 });
            const value = await getEpisodeDomMetadata(page);

            return {
                evidence: {
                    rawItemCount: firstRaw.itemCount,
                    renderedItemCount: value.itemCount
                },
                value
            };
        },
        value => value.itemCount === firstRaw.itemCount
    );
    const firstCounts = await getInstrumentationCounts(page);
    const firstRecords = observer.recordsSince(firstSnapshot)
        .filter(record => record.category === 'getEpisodes');
    const firstRequest = firstRecords[0] || {};

    const rawWithArtwork = firstRaw.items.filter(item => Boolean(
        item?.ImageTags?.Primary || item?.imageTags?.primary
    )).length;
    const rawWithOverview = firstRaw.items.filter(item => Boolean(
        item?.Overview || item?.overview
    )).length;
    const rawWithPlayed = firstRaw.items.filter(item => Boolean(
        item?.UserData?.Played || item?.userData?.played
    )).length;
    const rawWithProgress = firstRaw.items.filter(item => Number(
        item?.UserData?.PlayedPercentage
        ?? item?.userData?.playedPercentage
        ?? 0
    ) > 0 && Number(
        item?.UserData?.PlayedPercentage
        ?? item?.userData?.playedPercentage
        ?? 0
    ) < 100).length;

    await installInstrumentation(page);
    await resetInstrumentation(page);
    const refreshSnapshot = observer.snapshot();
    const refreshResponse = await stage.requireStage(
        'episode-refresh-request',
        'episode-refresh-request-failed',
        async () => ({
            evidence: { operationCategory: 'getEpisodes' },
            value: await waitForApiResponse(page, 'getEpisodes', () => (
                page.reload({ waitUntil: 'domcontentloaded' })
            ))
        }),
        () => true
    );
    const refreshRaw = await getResponseListMetadata(refreshResponse);
    await waitForDetails(page);
    await page.waitForFunction(expectedCount => (
        document.querySelectorAll(
            '#listChildrenCollapsible .itemsContainer .listItem[data-type="Episode"]'
        ).length === expectedCount
    ), refreshRaw.itemCount, { timeout: 20_000 });
    const refreshRecords = observer.recordsSince(refreshSnapshot)
        .filter(record => record.category === 'getEpisodes');
    const refreshCounts = await getInstrumentationCounts(page);

    await page.goBack();
    await waitForDetails(page);
    await page.waitForSelector(
        '#listChildrenCollapsible .itemsContainer .card[data-type="Season"]',
        { state: 'visible', timeout: 20_000 }
    ).catch(() => undefined);
    const backUsable = await page.locator(
        '#listChildrenCollapsible .itemsContainer .card[data-type="Season"]'
    ).count() > 0;
    await page.goForward();
    await waitForDetails(page);
    await page.waitForFunction(expectedCount => (
        document.querySelectorAll(
            '#listChildrenCollapsible .itemsContainer .listItem[data-type="Episode"]'
        ).length === expectedCount
    ), firstRaw.itemCount, { timeout: 20_000 }).catch(() => undefined);
    const forwardUsable = await page.locator(
        '#listChildrenCollapsible .itemsContainer .listItem[data-type="Episode"]'
    ).count() === firstRaw.itemCount;

    const orderMatches = firstDom.ids.length === firstRaw.ids.length
        && firstDom.ids.every((id, index) => id === firstRaw.ids[index]);
    const artworkRetained = rawWithArtwork === 0 || firstDom.artworkCount > 0;
    const overviewRetained = rawWithOverview === 0 || firstDom.overviewCount > 0;
    const playedRetained = rawWithPlayed === 0 || firstDom.playedCount > 0;
    const progressRetained = rawWithProgress === 0 || firstDom.progressCount > 0;
    const passed = firstRecords.length === 1
        && refreshRecords.length === 1
        && firstRequest.fieldsMatch === true
        && firstRequest.hasSeasonId === true
        && firstRequest.hasUserId === true
        && firstRequest.queryCasingMatch === true
        && firstDom.itemCount === firstRaw.itemCount
        && orderMatches
        && artworkRetained
        && overviewRetained
        && playedRetained
        && progressRetained
        && firstCounts.coreEpisodeDiagnostics <= 1
        && refreshCounts.coreEpisodeDiagnostics <= 1
        && backUsable
        && forwardUsable;
    await stage.requireStage(
        'season-episode-contract-verified',
        'season-episode-contract-mismatch',
        async () => ({
            evidence: {
                backUsable,
                forwardUsable,
                initialRequestCount: firstRecords.length,
                refreshRequestCount: refreshRecords.length,
                rendererOrderRetained: orderMatches
            },
            value: passed
        })
    );

    return {
        passed: true,
        result: {
            artworkRetained,
            backUsable,
            coreDiagnosticsInitial: firstCounts.coreEpisodeDiagnostics,
            coreDiagnosticsRefresh: refreshCounts.coreEpisodeDiagnostics,
            emptySeasonAvailable: Boolean(catalog.emptySeason),
            episodeOrderRetained: orderMatches,
            fieldsRetained: firstRequest.fieldsMatch === true,
            forwardUsable,
            initialRequestCount: firstRecords.length,
            lowerCaseSeasonIdRetained: firstRequest.hasSeasonId === true,
            overviewRetained,
            playedStateRetained: playedRetained,
            progressRetained,
            queryCasingRetained: firstRequest.queryCasingMatch === true,
            rawItemCountMatchedRenderer: firstDom.itemCount === firstRaw.itemCount,
            refreshRequestCount: refreshRecords.length,
            stages: stage.snapshot(),
            userScopeRetained: firstRequest.hasUserId === true
        }
    };
}

async function runErrorCompatibility(page, observer) {
    const anonymous = await fetchStatus(`${BACKEND_ORIGIN}/Users`);
    // Guid.Empty is Jellyfin's UserRootFolder sentinel and legitimately resolves
    // with HTTP 200. A non-empty unallocated GUID exercises the actual missing
    // item contract without colliding with that platform convention.
    const missingId = 'ffffffffffffffffffffffffffffffff';
    await installInstrumentation(page);
    await resetInstrumentation(page);
    const missingSnapshot = observer.snapshot();
    const missing = await page.evaluate(async id => {
        try {
            await window.PTV.api.getItem(id);
            return {
                coreErrorCode: null,
                rejected: false,
                status: null
            };
        } catch (error) {
            const status = Number(error?.status || error?.statusCode || error?.response?.status || 0);

            return {
                coreErrorCode: typeof error?.coreError?.code === 'string' ?
                    error.coreError.code :
                    null,
                rejected: true,
                status: Number.isFinite(status) && status ? status : null
            };
        }
    }, missingId);
    const missingRecords = observer.recordsSince(missingSnapshot)
        .filter(record => record.category === 'getItem');
    const missingTransportStatus = missingRecords[0]?.status ?? null;
    const missingCounts = await getInstrumentationCounts(page);
    const missingClassification = classifyMissingItemOutcome({
        clientRejected: missing.rejected,
        coreErrorCode: missing.coreErrorCode,
        transportStatus: missingTransportStatus
    });

    const networkId = '11111111111111111111111111111111';
    const networkPattern = new RegExp(`/Items/${networkId}/?(?:\\?|$)`, 'i');
    let abortedRequests = 0;
    const abortRoute = async route => {
        abortedRequests += 1;
        await route.abort('connectionfailed');
    };
    await page.route(networkPattern, abortRoute);
    const networkSnapshot = observer.snapshot();
    const network = await page.evaluate(async id => {
        try {
            await window.PTV.api.getItem(id);
            return { rejected: false };
        } catch {
            return { rejected: true };
        }
    }, networkId);
    await page.unroute(networkPattern, abortRoute);
    const networkRecords = observer.recordsSince(networkSnapshot)
        .filter(record => record.category === 'getItem');

    const forbiddenStatus = await page.evaluate(async () => {
        const apiClient = window.ApiClient;
        const response = await fetch(apiClient.getUrl('/Ptv/v1/settings'), {
            headers: {
                'X-Emby-Token': apiClient.accessToken()
            }
        });

        return response.status;
    }).catch(() => null);

    const passed = anonymous.status === 401
        && missing.rejected
        && missingRecords.length === 1
        && missingTransportStatus === 404
        && missingClassification === 'transport-404-client-rejection'
        && missingCounts.coreItemDiagnostics <= 1
        && network.rejected
        && networkRecords.length === 1
        && abortedRequests === 1
        && [ 200, 403 ].includes(forbiddenStatus);

    return {
        passed,
        result: {
            anonymousAuthenticationStatus: anonymous.status,
            authorizationProbeStatus: forbiddenStatus,
            authorizationProbeWasReadOnly: true,
            loginOwnershipMutated: false,
            missingItemRejected: missing.rejected,
            missingItemRequestCount: missingRecords.length,
            missingItemResponseClassification: missingClassification,
            missingItemStatus: missing.status || missingTransportStatus,
            missingItemCoreDiagnosticCount: missingCounts.coreItemDiagnostics,
            networkFailureRejected: network.rejected,
            networkFailureRequestCount: networkRecords.length,
            networkRetries: Math.max(0, networkRecords.length - 1),
            sessionExpirationNotForced: true
        }
    };
}

async function runScenario(report, name, callback) {
    const startedAt = performance.now();

    try {
        const outcome = await callback();
        const entry = {
            durationMs: roundDuration(performance.now() - startedAt),
            name,
            passed: Boolean(outcome.passed),
            result: outcome.result
        };
        report.scenarios.push(entry);

        return entry;
    } catch (error) {
        const stagedFailure = error instanceof Phase2dStageError;
        const entry = {
            durationMs: roundDuration(performance.now() - startedAt),
            name,
            passed: false,
            result: {
                failureReason: safeFailureReason(error),
                ...(stagedFailure ? {
                    failedStage: error.failedStage,
                    safeCauseCategory: error.safeCauseCategory,
                    stages: error.stages
                } : {
                    safeCauseCategory: classifySafeHarnessError(error)
                })
            }
        };
        report.scenarios.push(entry);

        return entry;
    }
}

async function run() {
    assertLoopbackCdp(CDP_URL);
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const report = {
        artifacts: {
            failureScreenshots: 0,
            storageStateCaptured: false,
            traceCaptured: false
        },
        authentication: {
            credentialsLogged: false,
            method: 'external-loopback-cdp',
            profileKind: 'dedicated-temporary',
            statePersistedInRepository: false
        },
        generatedAt: new Date().toISOString(),
        harnessReportVersion: 2,
        preflight: null,
        scenarios: [],
        summary: {
            failed: 0,
            passed: 0,
            total: 0
        }
    };
    let browser;
    let page;
    let observer;

    try {
        browser = await chromium.connectOverCDP(CDP_URL);
        page = await waitForAuthenticatedPage(browser);
        report.preflight = await runPreflight(browser, page);
        const catalog = await getCatalogCandidates(page);
        report.catalog = {
            emptySeasonAvailable: Boolean(catalog.emptySeason),
            emptySeriesAvailable: Boolean(catalog.emptySeries),
            typesAvailable: Object.fromEntries(
                [ ...GENERIC_SEARCH_TYPES, ...SPECIALIZED_SEARCH_TYPES ]
                    .map(type => [ type, Boolean(catalog.candidates[type]?.[0]) ])
            ),
            usableSeriesSeasonEpisodeChain: Boolean(
                catalog.candidates.Series?.[0]
                && catalog.selectedSeason
                && catalog.candidates.Episode?.[0]
            )
        };
        if (!report.catalog.usableSeriesSeasonEpisodeChain) {
            throw new Error('series-season-episode-data-unavailable');
        }

        observer = createNetworkObserver(page);

        await runScenario(report, 'home-details-back', () => runHomeAcceptance(page));
        await runScenario(report, 'search-details-navigation', () => (
            runSearchAcceptance(page, catalog)
        ));
        await runScenario(report, 'series-seasons-request', () => (
            runSeriesAcceptance(page, catalog, observer)
        ));
        await runScenario(report, 'season-episodes-request', () => (
            runEpisodeAcceptance(page, catalog, observer)
        ));
        await runScenario(report, 'error-compatibility', () => (
            runErrorCompatibility(page, observer)
        ));

        report.apiCallTotals = summarizeApiRecords(observer.recordsSince(0));
        report.summary = {
            failed: report.scenarios.filter(entry => !entry.passed).length,
            passed: report.scenarios.filter(entry => entry.passed).length,
            total: report.scenarios.length
        };
    } catch (error) {
        report.scenarios.push({
            durationMs: 0,
            name: 'preflight',
            passed: false,
            result: {
                failureReason: safeFailureReason(error)
            }
        });
        report.summary = {
            failed: 1,
            passed: 0,
            total: 1
        };
    } finally {
        observer?.dispose();
        if (page) await restoreInstrumentation(page);
        report.cleanup = {
            browserConnectionClosedByHarness: false,
            ownedTemporaryProfileRemoved: false
        };

        const ownership = getOwnedSessionStatus();
        if (ownership.owned) {
            try {
                const cleanup = cleanupOwnedSession();
                report.cleanup.ownedTemporaryProfileRemoved = cleanup.cleaned;
            } catch {
                report.cleanup.ownedTemporaryProfileRemoved = false;
            }
        }

        const forbiddenArtifactPath = findForbiddenArtifactPath(report);
        if (forbiddenArtifactPath) {
            report.scenarios = [{
                durationMs: 0,
                name: 'artifact-privacy',
                passed: false,
                result: {
                    failureReason: 'private-artifact-field-detected'
                }
            }];
            report.summary = {
                failed: 1,
                passed: 0,
                total: 1
            };
        } else {
            fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(report, null, 2)}\n`, {
                encoding: 'utf8'
            });
        }
        process.stdout.write(`${JSON.stringify({
            artifact: path.basename(OUTPUT_FILE),
            summary: report.summary
        }, null, 2)}\n`);
    }

    // Exiting the Node client disconnects CDP without sending Browser.close to
    // an externally owned session. Helper-owned browsers have already been
    // stopped and removed above.
    process.exit(report.summary.failed > 0 ? 1 : 0);
}

run().catch(error => {
    process.stderr.write(`Phase 2D browser validation failed: ${safeFailureReason(error)}\n`);
    process.exitCode = 1;
});

/* eslint-enable compat/compat */
