const isDev = window.location.hostname === 'localhost';

export const PTV_BRANDING = {
    appName: 'PiggieTV',
    loginDescription: 'Movies, shows, anime, and late-night comfort in one place.',
    loginTaglineHtml: 'MOVIES &bull; TV SHOWS &bull; ANIME',
    loginWelcome: 'Welcome back',
    requestPortalTitle: 'PiggieTV Request Portal',
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
    signUpUrl: 'https://signup.piggietv.com/invite/ysBDodSMPv5fFMz9GPMxUL'
} as const;

export const PTV_ROUTES = {
    displayPreferences: '#/mypreferencesdisplay',
    favorites: '#/home?tab=1',
    favoritesLegacy: '#/favorites',
    home: '#/home',
    homeHtml: '#/home.html',
    profilePreferences: '#/mypreferencesmenu',
    randomItem: '#/list?sortBy=Random',
    request: '#/ptv/request',
    requestFallback: '#/request',
    requestSafe: '#/home',
    search: '#/search'
} as const;

export const PTV_EVENTS = {
    debugChange: 'ptv:debug:change',
    featuredCacheUpdated: 'ptv-featured-cache-updated',
    requestClose: 'ptv:request:close',
    requestOpen: 'ptv:request:open',
    requestStateChange: 'ptv:request:statechange',
    themeChange: 'ptv:themechange'
} as const;

export const PTV_DEBUG = {
    maxEvents: 120,
    maxTimings: 240,
    resourceTimingBufferSize: 600,
    storageKey: 'ptv:debug'
} as const;

export const PTV_CACHE = {
    featuredContentKey: 'ptv:featured-content:v6',
    featuredContentServerConfigName: 'ptv',
    featuredContentSettingsKey: 'ptv:featured-content:settings:v1',
    featuredContentTtlMs: 12 * 60 * 60 * 1000,
    featuredContentVersion: 6,
    maxFeaturedContentTtlMs: 7 * 24 * 60 * 60 * 1000,
    minFeaturedContentTtlMs: 60 * 60 * 1000
} as const;

export const PTV_PLUGIN_API = {
    enabled: true,
    endpoints: {
        backdropPreprocess: 'Ptv/v1/Backdrops/Preprocess',
        featuredContent: 'Ptv/v1/FeaturedContent',
        featuredContentRefresh: 'Ptv/v1/FeaturedContent/Refresh',
        heroBatches: 'Ptv/v1/HeroBatches',
        imageProxy: 'Ptv/v1/ImageProxy',
        recommendations: 'Ptv/v1/Recommendations',
        status: 'Ptv/v1/Status'
    },
    version: 1,
    unavailableRetryMs: 5 * 60 * 1000
} as const;

export const PTV_PERFORMANCE = {
    default: {
        enableHeroAutoRotate: true,
        enableRowBackdrops: true,
        featuredFetchConcurrency: 6,
        featuredRowLimit: 20,
        forceLoadRowImages: true,
        heroBackdropMaxWidth: 1920,
        heroBucketQueryLimit: 48,
        heroLogoMaxWidth: 800,
        heroRecommendationPoolLimit: 24,
        heroSeasonalSearchTermLimit: 5,
        recommendationLookupTimeoutMs: 2500,
        rowBackdropMaxWidth: 1280,
        homeRowLimit: 0,
        rowItemLimit: 16,
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
        featuredRowLimit: 8,
        forceLoadRowImages: false,
        heroBackdropMaxWidth: 960,
        heroBucketQueryLimit: 18,
        heroLogoMaxWidth: 420,
        heroRecommendationPoolLimit: 10,
        heroSeasonalSearchTermLimit: 3,
        recommendationLookupTimeoutMs: 1600,
        rowBackdropMaxWidth: 720,
        homeRowLimit: 12,
        rowItemLimit: 8,
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
        homeRowLimit: 14,
        rowItemLimit: 10,
        rowPrimaryMaxWidth: 640,
        searchTermLimit: 6,
        seasonalLookupTimeoutMs: 1600,
        sectionResumeBatchDelayMs: 100,
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
    serverUrl: isDev ?
        // eslint-disable-next-line sonarjs/no-clear-text-protocols
        'http://10.16.0.50:8096' :
        window.location.origin,
    services: PTV_SERVICES,
    timers: PTV_TIMERS
} as const;
