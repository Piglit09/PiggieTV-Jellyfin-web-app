import {
    getPtvStaticAssetBaseUrl,
    isPtvWebpackDevServerOrigin,
    resolvePtvServerUrlForPage
} from './urlOrigins';

const isWebpackDevServer = typeof __WEBPACK_SERVE__ !== 'undefined' && __WEBPACK_SERVE__;
const isDev = isWebpackDevServer || isPtvWebpackDevServerOrigin();
const configuredDevJellyfinServerUrl = isDev
    && typeof __PTV_DEV_JELLYFIN_URL__ !== 'undefined' ?
    __PTV_DEV_JELLYFIN_URL__ :
    '';

function trimTrailingSlash(value: string) {
    let nextValue = value;

    while (nextValue.endsWith('/')) {
        nextValue = nextValue.slice(0, -1);
    }

    return nextValue;
}

function addRuntimeCandidate(candidates: string[], url: string) {
    const normalizedUrl = trimTrailingSlash(resolvePtvServerUrlForPage(url, {
        development: isDev,
        pageUrl: window.location.href
    }));

    if (!normalizedUrl || candidates.includes(normalizedUrl)) return;

    candidates.push(normalizedUrl);
}

function getStoredDevJellyfinServerUrl() {
    try {
        return window.localStorage.getItem('ptv:dev:jellyfinServerUrl')
            || window.localStorage.getItem('ptv:jellyfinServerUrl')
            || '';
    } catch {
        return '';
    }
}

function getJellyfinServerUrlCandidates() {
    const candidates: string[] = [];

    if (isDev) {
        addRuntimeCandidate(candidates, configuredDevJellyfinServerUrl);
        addRuntimeCandidate(candidates, getStoredDevJellyfinServerUrl());
    } else {
        addRuntimeCandidate(candidates, window.location.origin);
    }

    return candidates;
}

const jellyfinServerUrlCandidates = getJellyfinServerUrlCandidates();

export const PTV_RUNTIME = {
    devJellyfinServerUrl: isDev ? trimTrailingSlash(configuredDevJellyfinServerUrl) : '',
    devStaticAssetBaseUrl: isDev ? getPtvStaticAssetBaseUrl() : '',
    devStaticAssetOrigin: isDev ? window.location.origin : '',
    jellyfinServerUrl: jellyfinServerUrlCandidates[0] || (isDev ? '' : window.location.origin),
    jellyfinServerUrlCandidates,
    mode: isDev ? 'development' : 'production'
} as const;

export const PTV_BRANDING = {
    appName: 'PiggieTV',
    loginDescription: 'Movies, shows, anime, and late-night comfort in one place.',
    loginTaglineHtml: 'MOVIES &bull; TV SHOWS &bull; ANIME',
    loginWelcome: 'Welcome back',
    requestPortalTitle: 'PiggieTV Request Portal',
    signupPortalTitle: 'PiggieTV Signup',
    welcomeDescription: 'Welcome to PiggieTV'
} as const;

export const PTV_ASSETS = {
    backgrounds: {
        login: 'assets/backgrounds/PiggieTVBG.webp',
        loginFallback: 'assets/backgrounds/PiggieTVBG.png',
        loginLowPower: 'assets/backgrounds/PiggieTVBG-tv.webp',
        page: 'assets/backgrounds/login-bg.webp',
        pageFallback: 'assets/backgrounds/login-bg.png',
        pageLowPower: 'assets/backgrounds/login-bg-tv.webp'
    },
    backgroundsBase: 'assets/backgrounds',
    iconBase: 'assets/icons',
    icons: {
        discord: 'assets/icons/discord.svg'
    },
    logoBase: 'assets/logo',
    logos: {
        bannerLight: 'assets/logo/banner-light.webp',
        bannerLightFallback: 'assets/logo/banner-light.png',
        bannerLightLowPower: 'assets/logo/banner-light-tv.webp',
        favicon: 'assets/logo/favicon.png',
        icon: 'assets/logo/icon.png',
        sidebar: 'assets/logo/sidebar-logo.webp',
        sidebarFallback: 'assets/logo/sidebar-logo.png',
        sidebarLowPower: 'assets/logo/sidebar-logo-tv.webp'
    },
    responsive: {
        backgrounds: {
            login: {
                default: 'assets/backgrounds/PiggieTVBG.webp',
                fallback: 'assets/backgrounds/PiggieTVBG.png',
                fireTv: 'assets/backgrounds/PiggieTVBG-tv.webp',
                lowPower: 'assets/backgrounds/PiggieTVBG-tv.webp',
                tv: 'assets/backgrounds/PiggieTVBG-tv.webp',
                webOs: 'assets/backgrounds/PiggieTVBG-tv.webp'
            },
            page: {
                default: 'assets/backgrounds/login-bg.webp',
                fallback: 'assets/backgrounds/login-bg.png',
                fireTv: 'assets/backgrounds/login-bg-tv.webp',
                lowPower: 'assets/backgrounds/login-bg-tv.webp',
                tv: 'assets/backgrounds/login-bg-tv.webp',
                webOs: 'assets/backgrounds/login-bg-tv.webp'
            }
        },
        logos: {
            bannerLight: {
                default: 'assets/logo/banner-light.webp',
                fallback: 'assets/logo/banner-light.png',
                fireTv: 'assets/logo/banner-light-tv.webp',
                lowPower: 'assets/logo/banner-light-tv.webp',
                tv: 'assets/logo/banner-light-tv.webp',
                webOs: 'assets/logo/banner-light-tv.webp'
            },
            sidebar: {
                default: 'assets/logo/sidebar-logo.webp',
                fallback: 'assets/logo/sidebar-logo.png',
                fireTv: 'assets/logo/sidebar-logo-tv.webp',
                lowPower: 'assets/logo/sidebar-logo-tv.webp',
                tv: 'assets/logo/sidebar-logo-tv.webp',
                webOs: 'assets/logo/sidebar-logo-tv.webp'
            }
        }
    }
} as const;

export const PTV_SERVICES = {
    accountUrl: 'https://signup.piggietv.com/my/account',
    booksUrl: 'https://books.piggietv.com',
    discordUrl: 'https://discord.gg/FbtexGYau',
    gamesUrl: 'https://emu.piggietv.com',
    requestPortalUrl: 'https://request.piggietv.com',
    signupAdminUrl: 'https://signup.piggietv.com',
    signupInviteCode: '',
    signUpUrl: '#/signup'
} as const;

export const PTV_ROUTES = {
    books: '#/books',
    comics: '#/comics',
    collections: '#/collections',
    displayPreferences: '#/mypreferencesdisplay',
    favorites: '#/home?tab=1',
    favoritesLegacy: '#/favorites',
    home: '#/home',
    homeHtml: '#/home.html',
    animeMovies: '#/movies?topParentId=animemovies',
    animeShows: '#/shows?topParentId=anime',
    cartoons: '#/shows?topParentId=cartoons',
    manga: '#/manga',
    movies: '#/movies',
    music: '#/music',
    profilePreferences: '#/mypreferencesmenu',
    calendar: '#/calendar',
    randomItem: '#/list?sortBy=Random',
    reading: '#/reading',
    readingBooks: '#/reading/books',
    readingCollections: '#/reading/collections',
    readingComics: '#/reading/comics',
    readingExplore: '#/reading/explore',
    readingLibrary: '#/reading/books',
    readingManga: '#/reading/manga',
    recommendationsTypo: '#/recomendations',
    recommendations: '#/recommendations',
    request: '#/requests',
    requestFallback: '#/ptv/request',
    requestLegacy: '#/request',
    requestSafe: '#/home',
    search: '#/search',
    shows: '#/shows',
    signup: '#/signup',
    signupFallback: '#/login'
} as const;

export const PTV_EVENTS = {
    debugChange: 'ptv:debug:change',
    featuredCacheUpdated: 'ptv-featured-cache-updated',
    requestClose: 'ptv:request:close',
    requestOpen: 'ptv:request:open',
    requestStateChange: 'ptv:request:statechange',
    signupClose: 'ptv:signup:close',
    signupOpen: 'ptv:signup:open',
    signupStateChange: 'ptv:signup:statechange',
    themeChange: 'ptv:themechange'
} as const;

export const PTV_DEBUG = {
    legacyStorageKey: 'ptv:debug',
    maxEvents: 120,
    maxTimings: 240,
    resourceTimingBufferSize: 600,
    storageKey: 'ptv:debug:enabled'
} as const;

export const PTV_CACHE = {
    featuredContentKey: 'ptv:featured-content:v7',
    featuredContentSettingsKey: 'ptv:featured-content:settings:v1',
    featuredContentTtlMs: 12 * 60 * 60 * 1000,
    featuredContentVersion: 7,
    maxFeaturedContentTtlMs: 7 * 24 * 60 * 60 * 1000,
    minFeaturedContentTtlMs: 60 * 60 * 1000
} as const;

export const PTV_PLUGIN_API = {
    enabled: true,
    endpoints: {
        backdropPreprocess: 'Ptv/v1/Backdrops/Preprocess',
        featuredContent: 'Ptv/v1/featured',
        featuredContentRefresh: 'Ptv/v1/featured/refresh',
        heroBatches: 'Ptv/v1/HeroBatches',
        imageProxy: 'Ptv/v1/ImageProxy',
        integrationsStatus: 'Ptv/v1/integrations/status',
        integrationTestBase: 'Ptv/v1/integrations',
        googleBooksMetadataSearch: 'Ptv/v1/reading/metadata/googlebooks/search',
        readingSeriesOverrides: 'Ptv/v1/reading/series-overrides',
        musicMetadataSearch: 'Ptv/v1/music/metadata/search',
        seerrRequest: 'Ptv/v1/integrations/seerr/request',
        seerrRequests: 'Ptv/v1/integrations/seerr/requests',
        seerrSearch: 'Ptv/v1/integrations/seerr/search',
        seerrTest: 'Ptv/v1/integrations/seerr/test',
        signupAdminInvites: 'Ptv/v1/signup/admin/invites',
        signupAdminSettings: 'Ptv/v1/signup/admin/settings',
        signupAdminTestEmail: 'Ptv/v1/signup/admin/email/test',
        signupCreateUser: 'Ptv/v1/signup/create-user',
        // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Public route name, not a secret.
        signupPasswordResetConfirm: 'Ptv/v1/signup/password-reset/confirm',
        // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Public route name, not a secret.
        signupPasswordResetRequest: 'Ptv/v1/signup/password-reset/request',
        signupVerifyEmail: 'Ptv/v1/signup/verify-email',
        arrCalendar: 'Ptv/v1/calendar',
        arrDownloads: 'Ptv/v1/integrations/arr/downloads',
        randomAnime: 'Ptv/v1/random/anime',
        randomEpisode: 'Ptv/v1/random/episode',
        randomMovie: 'Ptv/v1/random/movie',
        rows: 'Ptv/v1/rows',
        rowsPreview: 'Ptv/v1/rows/preview',
        rowsValidate: 'Ptv/v1/rows/validate',
        tags: 'Ptv/v1/tags',
        tagRows: 'Ptv/v1/tags/rows',
        tmdbTest: 'Ptv/v1/tmdb/test',
        recommendations: 'Ptv/v1/Recommendations',
        settings: 'Ptv/v1/settings',
        settingsReset: 'Ptv/v1/settings/reset',
        status: 'Ptv/v1/status'
    },
    version: 1,
    unavailableRetryMs: 5 * 60 * 1000
} as const;

export const PTV_PERFORMANCE = {
    default: {
        enableHeroAutoRotate: true,
        enableRowBackdrops: true,
        featuredFetchConcurrency: 4,
        featuredRowLimit: 16,
        forceLoadRowImages: false,
        heroBackdropMaxWidth: 1920,
        heroBucketQueryLimit: 48,
        heroLogoMaxWidth: 800,
        heroRecommendationPoolLimit: 24,
        heroSeasonalSearchTermLimit: 5,
        recommendationLookupTimeoutMs: 2500,
        rowBackdropMaxWidth: 1280,
        homeInitialRowCount: 3,
        homeRowViewportRootMargin: '340px 0px',
        homeRowLimit: 0,
        rowItemLimit: 14,
        rowPrimaryMaxWidth: 900,
        searchTermLimit: 12,
        seasonalLookupTimeoutMs: 2200,
        sectionResumeBatchDelayMs: 0,
        sectionResumeBatchSize: 0
    },
    fireTv: {
        enableHeroAutoRotate: false,
        enableRowBackdrops: false,
        featuredFetchConcurrency: 2,
        featuredRowLimit: 6,
        forceLoadRowImages: false,
        heroBackdropMaxWidth: 960,
        heroBucketQueryLimit: 18,
        heroLogoMaxWidth: 420,
        heroRecommendationPoolLimit: 10,
        heroSeasonalSearchTermLimit: 3,
        recommendationLookupTimeoutMs: 1600,
        rowBackdropMaxWidth: 720,
        homeInitialRowCount: 2,
        homeRowViewportRootMargin: '260px 0px',
        homeRowLimit: 6,
        rowItemLimit: 12,
        rowPrimaryMaxWidth: 520,
        searchTermLimit: 5,
        seasonalLookupTimeoutMs: 1400,
        sectionResumeBatchDelayMs: 140,
        sectionResumeBatchSize: 2
    },
    lowPower: {
        enableHeroAutoRotate: false,
        enableRowBackdrops: false,
        featuredFetchConcurrency: 3,
        featuredRowLimit: 10,
        forceLoadRowImages: false,
        heroBackdropMaxWidth: 1180,
        heroBucketQueryLimit: 24,
        heroLogoMaxWidth: 520,
        heroRecommendationPoolLimit: 12,
        heroSeasonalSearchTermLimit: 3,
        recommendationLookupTimeoutMs: 1800,
        rowBackdropMaxWidth: 820,
        homeInitialRowCount: 3,
        homeRowViewportRootMargin: '320px 0px',
        homeRowLimit: 14,
        rowItemLimit: 10,
        rowPrimaryMaxWidth: 640,
        searchTermLimit: 6,
        seasonalLookupTimeoutMs: 1600,
        sectionResumeBatchDelayMs: 100,
        sectionResumeBatchSize: 3
    },
    mobile: {
        enableHeroAutoRotate: false,
        enableRowBackdrops: false,
        featuredFetchConcurrency: 3,
        featuredRowLimit: 10,
        forceLoadRowImages: false,
        heroBackdropMaxWidth: 1280,
        heroBucketQueryLimit: 24,
        heroLogoMaxWidth: 520,
        heroRecommendationPoolLimit: 12,
        heroSeasonalSearchTermLimit: 4,
        recommendationLookupTimeoutMs: 1800,
        rowBackdropMaxWidth: 760,
        homeInitialRowCount: 2,
        homeRowViewportRootMargin: '260px 0px',
        homeRowLimit: 12,
        rowItemLimit: 10,
        rowPrimaryMaxWidth: 620,
        searchTermLimit: 6,
        seasonalLookupTimeoutMs: 1600,
        sectionResumeBatchDelayMs: 80,
        sectionResumeBatchSize: 3
    },
    webOs: {
        enableHeroAutoRotate: false,
        enableRowBackdrops: false,
        featuredFetchConcurrency: 1,
        featuredRowLimit: 6,
        forceLoadRowImages: false,
        heroBackdropMaxWidth: 720,
        heroBucketQueryLimit: 12,
        heroLogoMaxWidth: 360,
        heroRecommendationPoolLimit: 8,
        heroSeasonalSearchTermLimit: 2,
        recommendationLookupTimeoutMs: 1200,
        rowBackdropMaxWidth: 520,
        homeInitialRowCount: 1,
        homeRowViewportRootMargin: '180px 0px',
        homeRowLimit: 9,
        rowItemLimit: 6,
        rowPrimaryMaxWidth: 420,
        searchTermLimit: 3,
        seasonalLookupTimeoutMs: 1000,
        sectionResumeBatchDelayMs: 220,
        sectionResumeBatchSize: 1
    }
} as const;

export const PTV_LOGGING = {
    autoFlushMs: 60 * 1000,
    filePrefix: 'PTV',
    maxDetailLength: 6000,
    maxEntries: 1800,
    storagePrefix: 'ptv:logs',
    uploadDebounceMs: 5000
} as const;

export const PTV_TIMERS = {
    requestLoadTimeoutMs: 8000
} as const;

export const PTV_FEATURE_FLAGS = {
    embeddedRequestPortal: true,
    featuredContentCache: true,
    ptvIconEngine: true
} as const;

export const PTV_CONFIG = {
    assets: PTV_ASSETS,
    branding: PTV_BRANDING,
    cache: PTV_CACHE,
    debug: PTV_DEBUG,
    events: PTV_EVENTS,
    featureFlags: PTV_FEATURE_FLAGS,
    logging: PTV_LOGGING,
    performance: PTV_PERFORMANCE,
    pluginApi: PTV_PLUGIN_API,
    routes: PTV_ROUTES,
    runtime: PTV_RUNTIME,
    serverUrl: PTV_RUNTIME.jellyfinServerUrl,
    services: PTV_SERVICES,
    timers: PTV_TIMERS
} as const;
