import { PTV_PERFORMANCE } from './config';
import { getPtvFeatureSettings } from './featureSettings';
import {
    applyPtvRenderProfileClasses,
    getPtvRenderProfile,
    type PtvRenderProfileContract
} from './renderProfile';

type NavigatorWithHardwareHints = Navigator & {
    deviceMemory?: number;
    hardwareConcurrency?: number;
};

export type PtvClientKind = 'desktop' | 'firetv' | 'mobile' | 'tv' | 'webos';
export type PtvTvPlatform = 'android-tv' | 'fire-tv' | 'generic-tv' | 'none' | 'roku' | 'ten-foot' | 'tizen' | 'webos';

const PTV_TV_PLATFORM_CLASSES: Exclude<PtvTvPlatform, 'none'>[] = [
    'android-tv',
    'fire-tv',
    'generic-tv',
    'roku',
    'ten-foot',
    'tizen',
    'webos'
];
export type PtvLayoutMode = 'compact-mobile' | 'desktop' | 'mobile' | 'tablet' | 'ten-foot';
export type PtvPointerType = 'coarse' | 'fine' | 'none' | 'unknown';
export type PtvHoverCapability = 'hover' | 'none' | 'unknown';

export type PtvResponsiveSignals = {
    devicePixelRatio: number;
    hoverCapability: PtvHoverCapability;
    innerHeight: number;
    innerWidth: number;
    layoutMode: PtvLayoutMode;
    layoutModeReason: string;
    matchedMediaQuery: string;
    pointerType: PtvPointerType;
    visualViewportHeight: number;
    visualViewportWidth: number;
};

export type PtvClientProfile = {
    hasHover: boolean;
    isAndroidTv: boolean;
    isCoarsePointer: boolean;
    isConstrainedHardware: boolean;
    isFireTv: boolean;
    isLowPower: boolean;
    isMobile: boolean;
    isRoku: boolean;
    isTablet: boolean;
    isTenFootClient: boolean;
    isTizen: boolean;
    isTv: boolean;
    isWebOs: boolean;
    kind: PtvClientKind;
    layoutMode: PtvLayoutMode;
    renderProfile: PtvRenderProfileContract;
    responsive: PtvResponsiveSignals;
    supportsAspectRatio: boolean;
    supportsBackdropFilter: boolean;
    supportsContainerQueries: boolean;
    supportsContentVisibility: boolean;
    tvDetectionReason: string;
    tvPlatform: PtvTvPlatform;
    userAgent: string;
};

export type PtvTvDetection = {
    isAndroidTv: boolean;
    isFireTv: boolean;
    isRoku: boolean;
    isTizen: boolean;
    isTv: boolean;
    isWebOs: boolean;
    reason: string;
    tvPlatform: PtvTvPlatform;
};

type MutablePerformanceValue<T> =
    T extends boolean ? boolean :
        T extends number ? number :
            T;

type PtvPerformanceDefaults = {
    [Key in keyof typeof PTV_PERFORMANCE.default]: MutablePerformanceValue<typeof PTV_PERFORMANCE.default[Key]>;
};

export type PtvPerformanceProfile = PtvPerformanceDefaults & {
    clientKind: PtvClientKind;
    isFireTv: boolean;
    isLowPower: boolean;
    isWebOs: boolean;
    renderProfile: PtvRenderProfileContract;
};

const FIRE_TV_PATTERN = /(aft[a-z0-9]*|fire\s?tv|amazonwebappplatform)/i;
const WEB_OS_PATTERN = /(web0s|webos|netcast|lg\s?browser|lge)/i;
const ANDROID_TV_PATTERN = /(android\s?tv|google\s?tv|googletv|shield\s?android|nvidia\s?shield|mi\s?box|bravia.*android)/i;
const ROKU_PATTERN = /(roku|dvp)/i;
const TIZEN_PATTERN = /(tizen|smart-tv.*samsung|samsung.*smart-tv)/i;
const TV_CLIENT_PATTERNS = [
    /(aft[a-z0-9]*|fire\s?tv|roku|dvp|tizen|web0s|webos)/i,
    /(smart-tv|smarttv|hbbtv|netcast|viera|bravia|crkey|appletv|xbox|playstation)/i
];
const MOBILE_CLIENT_PATTERN = /(android|iphone|ipad|ipod|mobile)/i;
const TABLET_CLIENT_PATTERN = /(ipad|tablet|silk(?!.*mobile)|kindle|playbook)/i;

function getNavigator(): NavigatorWithHardwareHints | null {
    if (typeof navigator === 'undefined') return null;

    return navigator as NavigatorWithHardwareHints;
}

function supportsCssProperty(property: string, value: string) {
    if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
        return CSS.supports(property, value);
    }

    return false;
}

function supportsBackdropFilter() {
    if (typeof document === 'undefined') return false;

    const style = document.documentElement.style;

    return 'backdropFilter' in style
        || 'webkitBackdropFilter' in style
        || supportsCssProperty('backdrop-filter', 'blur(1px)')
        || supportsCssProperty('-webkit-backdrop-filter', 'blur(1px)');
}

export function detectPtvTvClient(userAgent: string, hasTenFootSignal = false): PtvTvDetection {
    const isFireTv = FIRE_TV_PATTERN.test(userAgent);
    const isWebOs = WEB_OS_PATTERN.test(userAgent);
    const isAndroidTv = ANDROID_TV_PATTERN.test(userAgent);
    const isRoku = ROKU_PATTERN.test(userAgent);
    const isTizen = TIZEN_PATTERN.test(userAgent);
    const hasGenericTvUserAgent = TV_CLIENT_PATTERNS.some(pattern => pattern.test(userAgent));
    const isTv = isFireTv
        || isWebOs
        || isAndroidTv
        || isRoku
        || isTizen
        || hasTenFootSignal
        || hasGenericTvUserAgent;
    let tvPlatform: PtvTvPlatform = 'none';
    let reason = 'no-tv-signal';

    if (isFireTv) {
        tvPlatform = 'fire-tv';
        reason = 'fire-tv-user-agent';
    } else if (isWebOs) {
        tvPlatform = 'webos';
        reason = 'webos-user-agent';
    } else if (isTizen) {
        tvPlatform = 'tizen';
        reason = 'tizen-user-agent';
    } else if (isAndroidTv) {
        tvPlatform = 'android-tv';
        reason = 'android-tv-user-agent';
    } else if (isRoku) {
        tvPlatform = 'roku';
        reason = 'roku-user-agent';
    } else if (hasTenFootSignal) {
        tvPlatform = 'ten-foot';
        reason = 'jellyfin-ten-foot-class';
    } else if (hasGenericTvUserAgent) {
        tvPlatform = 'generic-tv';
        reason = 'generic-tv-user-agent';
    }

    return {
        isAndroidTv,
        isFireTv,
        isRoku,
        isTizen,
        isTv,
        isWebOs,
        reason,
        tvPlatform
    };
}

function hasCoarsePointer() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;

    return window.matchMedia('(pointer: coarse)').matches
        || window.matchMedia('(hover: none)').matches;
}

function matchesMediaQuery(query: string) {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia(query).matches;
}

function getViewportNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function getPointerType(): PtvPointerType {
    if (matchesMediaQuery('(pointer: coarse)')) return 'coarse';
    if (matchesMediaQuery('(pointer: fine)')) return 'fine';
    if (matchesMediaQuery('(pointer: none)')) return 'none';

    return 'unknown';
}

function getHoverCapability(): PtvHoverCapability {
    if (matchesMediaQuery('(hover: hover)')) return 'hover';
    if (matchesMediaQuery('(hover: none)')) return 'none';

    return 'unknown';
}

function selectResponsiveLayout(
    hasTenFootSignal: boolean,
    hasMobileUserAgent: boolean,
    hasTabletUserAgent: boolean,
    pointerType: PtvPointerType,
    viewportWidth: number,
    viewportHeight: number
) {
    if (hasTenFootSignal) {
        return { layoutMode: 'ten-foot' as const, layoutModeReason: 'ten-foot-signal', matchedMediaQuery: 'tv-or-ten-foot' };
    }

    if (viewportWidth > 0 && viewportWidth <= 390) {
        return { layoutMode: 'compact-mobile' as const, layoutModeReason: 'viewport-width<=390', matchedMediaQuery: '(max-width: 390px)' };
    }

    if (viewportWidth > 0 && viewportWidth <= 600) {
        return { layoutMode: 'mobile' as const, layoutModeReason: 'viewport-width<=600', matchedMediaQuery: '(max-width: 600px)' };
    }

    if (viewportWidth > 0 && viewportWidth <= 1024) {
        return { layoutMode: 'tablet' as const, layoutModeReason: 'viewport-width<=1024', matchedMediaQuery: '(max-width: 1024px)' };
    }

    if (hasMobileUserAgent) {
        return { layoutMode: 'mobile' as const, layoutModeReason: 'mobile-user-agent', matchedMediaQuery: 'mobile-user-agent' };
    }

    if (hasTabletUserAgent) {
        return { layoutMode: 'tablet' as const, layoutModeReason: 'tablet-user-agent', matchedMediaQuery: 'tablet-user-agent' };
    }

    if (pointerType === 'coarse' && viewportWidth > 0 && viewportWidth <= 1366 && viewportHeight <= 1024) {
        return { layoutMode: 'tablet' as const, layoutModeReason: 'coarse-pointer-tablet-viewport', matchedMediaQuery: '(pointer: coarse) and (max-width: 1366px)' };
    }

    return { layoutMode: 'desktop' as const, layoutModeReason: 'desktop-default', matchedMediaQuery: '(min-width: 1025px)' };
}

function getResponsiveSignals(
    hasTenFootSignal: boolean,
    hasMobileUserAgent: boolean,
    hasTabletUserAgent: boolean
): PtvResponsiveSignals {
    const innerWidth = getViewportNumber(typeof window !== 'undefined' ? window.innerWidth : 0);
    const innerHeight = getViewportNumber(typeof window !== 'undefined' ? window.innerHeight : 0);
    const visualViewportWidth = getViewportNumber(typeof window !== 'undefined' ? window.visualViewport?.width : 0);
    const visualViewportHeight = getViewportNumber(typeof window !== 'undefined' ? window.visualViewport?.height : 0);
    const viewportWidth = visualViewportWidth || innerWidth;
    const viewportHeight = visualViewportHeight || innerHeight;
    const pointerType = getPointerType();
    const hoverCapability = getHoverCapability();
    const devicePixelRatio = getViewportNumber(typeof window !== 'undefined' ? window.devicePixelRatio : 0) || 1;
    const { layoutMode, layoutModeReason, matchedMediaQuery } = selectResponsiveLayout(
        hasTenFootSignal,
        hasMobileUserAgent,
        hasTabletUserAgent,
        pointerType,
        viewportWidth,
        viewportHeight
    );

    return {
        devicePixelRatio,
        hoverCapability,
        innerHeight,
        innerWidth,
        layoutMode,
        layoutModeReason,
        matchedMediaQuery,
        pointerType,
        visualViewportHeight,
        visualViewportWidth
    };
}

function isConstrainedHardware(nav: NavigatorWithHardwareHints | null) {
    if (!nav) return false;

    const memory = nav.deviceMemory;
    const cores = nav.hardwareConcurrency;

    return Boolean(
        (typeof memory === 'number' && memory > 0 && memory <= 2)
        || (typeof cores === 'number' && cores > 0 && cores <= 4)
    );
}

function getClientKind(
    isFireTv: boolean,
    isWebOs: boolean,
    isTv: boolean,
    isMobile: boolean,
    isTablet: boolean
): PtvClientKind {
    if (isFireTv) return 'firetv';
    if (isWebOs) return 'webos';
    if (isTv) return 'tv';
    if (isMobile || isTablet) return 'mobile';

    return 'desktop';
}

export function getPtvClientProfile(): PtvClientProfile {
    const nav = getNavigator();
    const userAgent = nav?.userAgent || '';
    const isTenFootClient = typeof document !== 'undefined'
        && (
            document.documentElement.classList.contains('layout-tv')
            || document.body?.classList.contains('layout-tv')
        );
    const tvDetection = detectPtvTvClient(userAgent, isTenFootClient);
    const {
        isAndroidTv,
        isFireTv,
        isRoku,
        isTizen,
        isTv,
        isWebOs
    } = tvDetection;
    const responsive = getResponsiveSignals(
        isFireTv || isWebOs || isAndroidTv || isRoku || isTenFootClient || isTv,
        MOBILE_CLIENT_PATTERN.test(userAgent),
        TABLET_CLIENT_PATTERN.test(userAgent)
    );
    const isTablet = !isTv && (
        TABLET_CLIENT_PATTERN.test(userAgent)
        || responsive.layoutMode === 'tablet'
    );
    const isMobile = !isTv && (
        MOBILE_CLIENT_PATTERN.test(userAgent)
        || responsive.layoutMode === 'compact-mobile'
        || responsive.layoutMode === 'mobile'
    );
    const isCoarsePointer = hasCoarsePointer();
    const hasHover = responsive.hoverCapability === 'hover';
    const constrainedHardware = isConstrainedHardware(nav);
    const isLowPower = isFireTv || isTv || (!isMobile && !isTablet && constrainedHardware);
    const baseProfile = {
        isAndroidTv,
        isCoarsePointer,
        isConstrainedHardware: constrainedHardware,
        isFireTv,
        isLowPower,
        isMobile,
        isRoku,
        isTablet,
        isTenFootClient,
        isTizen,
        isTv,
        isWebOs,
        layoutMode: responsive.layoutMode,
        responsive,
        supportsAspectRatio: supportsCssProperty('aspect-ratio', '1 / 1'),
        supportsBackdropFilter: supportsBackdropFilter(),
        supportsContainerQueries: supportsCssProperty('container-type', 'inline-size'),
        supportsContentVisibility: supportsCssProperty('content-visibility', 'auto')
    };

    return {
        ...baseProfile,
        hasHover,
        kind: getClientKind(isFireTv, isWebOs, isTv, isMobile, isTablet),
        renderProfile: getPtvRenderProfile(baseProfile),
        tvDetectionReason: tvDetection.reason,
        tvPlatform: tvDetection.tvPlatform,
        userAgent
    };
}

export function getPtvPerformanceProfile(): PtvPerformanceProfile {
    const client = getPtvClientProfile();
    const featureSettings = getPtvFeatureSettings();
    const shouldUseLowPowerProfile = featureSettings.tvLowPowerModeEnabled && client.isLowPower;
    const lowPowerOverrides = shouldUseLowPowerProfile ? PTV_PERFORMANCE.lowPower : {};
    const mobileOverrides = client.kind === 'mobile' ? PTV_PERFORMANCE.mobile : {};
    const webOsOverrides = featureSettings.tvLowPowerModeEnabled && client.isWebOs ? PTV_PERFORMANCE.webOs : {};
    const fireTvOverrides = featureSettings.tvLowPowerModeEnabled && client.isFireTv ? PTV_PERFORMANCE.fireTv : {};
    const performanceProfile = {
        ...PTV_PERFORMANCE.default,
        ...mobileOverrides,
        ...lowPowerOverrides,
        ...webOsOverrides,
        ...fireTvOverrides
    };

    return {
        ...performanceProfile,
        clientKind: client.kind,
        isFireTv: client.isFireTv,
        isLowPower: shouldUseLowPowerProfile,
        isWebOs: client.isWebOs,
        enableRowBackdrops: featureSettings.dynamicBackdropsEnabled && performanceProfile.enableRowBackdrops,
        renderProfile: client.renderProfile
    };
}

export function applyPtvClientProfileClasses(profile = getPtvClientProfile()) {
    if (typeof document === 'undefined') return profile;

    const root = document.documentElement;

    root.classList.toggle('ptv-client-firetv', profile.isFireTv);
    root.classList.toggle('ptv-client-webos', profile.isWebOs);
    root.classList.toggle('ptv-client-android-tv', profile.isAndroidTv);
    root.classList.toggle('ptv-client-roku', profile.isRoku);
    root.classList.toggle('ptv-client-tizen', profile.isTizen);
    root.classList.toggle('ptv-client-ten-foot', profile.isTenFootClient);
    root.classList.toggle('ptv-client-tv', profile.isTv);
    root.classList.toggle('ptv-client-mobile', profile.isMobile);
    root.classList.toggle('ptv-client-tablet', profile.isTablet);
    root.classList.toggle('ptv-client-coarse-pointer', profile.isCoarsePointer);
    root.classList.toggle('ptv-has-hover', profile.hasHover);
    root.classList.toggle('ptv-no-hover', !profile.hasHover);
    root.classList.toggle('ptv-client-low-power', profile.isLowPower);
    root.classList.toggle('ptv-client-constrained-hardware', profile.isConstrainedHardware);
    PTV_TV_PLATFORM_CLASSES.forEach(platform => {
        root.classList.toggle(`ptv-platform-${platform}`, profile.tvPlatform === platform);
    });
    root.classList.toggle('ptv-no-backdrop-filter', !profile.supportsBackdropFilter);
    root.classList.toggle('ptv-no-container-queries', !profile.supportsContainerQueries);
    root.classList.toggle('ptv-no-aspect-ratio', !profile.supportsAspectRatio);
    root.classList.toggle('ptv-no-content-visibility', !profile.supportsContentVisibility);
    (['compact-mobile', 'mobile', 'tablet', 'desktop', 'ten-foot'] as const).forEach(mode => {
        root.classList.toggle(`ptv-layout-${mode}`, profile.layoutMode === mode);
    });
    root.dataset.ptvClientProfile = profile.kind;
    root.dataset.ptvLayoutMode = profile.layoutMode;
    root.dataset.ptvLayoutReason = profile.responsive.layoutModeReason;
    root.dataset.ptvTvPlatform = profile.tvPlatform;
    root.dataset.ptvTvDetectionReason = profile.tvDetectionReason;
    root.dataset.ptvSupportsBackdropFilter = String(profile.supportsBackdropFilter);
    root.dataset.ptvSupportsContainerQueries = String(profile.supportsContainerQueries);
    root.dataset.ptvSupportsAspectRatio = String(profile.supportsAspectRatio);
    root.dataset.ptvSupportsContentVisibility = String(profile.supportsContentVisibility);
    applyPtvRenderProfileClasses(root, profile.renderProfile);

    return profile;
}
