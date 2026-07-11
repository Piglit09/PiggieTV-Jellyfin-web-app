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

export type PtvClientProfile = {
    isAndroidTv: boolean;
    isCoarsePointer: boolean;
    isConstrainedHardware: boolean;
    isFireTv: boolean;
    isLowPower: boolean;
    isMobile: boolean;
    isRoku: boolean;
    isTablet: boolean;
    isTenFootClient: boolean;
    isTv: boolean;
    isWebOs: boolean;
    kind: PtvClientKind;
    renderProfile: PtvRenderProfileContract;
    supportsBackdropFilter: boolean;
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

function supportsBackdropFilter() {
    if (typeof document === 'undefined') return false;

    const style = document.documentElement.style;

    return 'backdropFilter' in style || 'webkitBackdropFilter' in style;
}

function hasCoarsePointer() {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;

    return window.matchMedia('(pointer: coarse)').matches
        || window.matchMedia('(hover: none)').matches;
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
    const isFireTv = FIRE_TV_PATTERN.test(userAgent);
    const isWebOs = WEB_OS_PATTERN.test(userAgent);
    const isAndroidTv = ANDROID_TV_PATTERN.test(userAgent);
    const isRoku = ROKU_PATTERN.test(userAgent);
    const isTenFootClient = typeof document !== 'undefined'
        && (
            document.documentElement.classList.contains('layout-tv')
            || document.body?.classList.contains('layout-tv')
        );
    const isTv = isWebOs
        || isAndroidTv
        || isRoku
        || isTenFootClient
        || TV_CLIENT_PATTERNS.some(pattern => pattern.test(userAgent));
    const isTablet = TABLET_CLIENT_PATTERN.test(userAgent);
    const isMobile = !isTv && MOBILE_CLIENT_PATTERN.test(userAgent);
    const isCoarsePointer = hasCoarsePointer();
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
        isTv,
        isWebOs,
        supportsBackdropFilter: supportsBackdropFilter()
    };

    return {
        ...baseProfile,
        kind: getClientKind(isFireTv, isWebOs, isTv, isMobile, isTablet),
        renderProfile: getPtvRenderProfile(baseProfile)
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
    root.classList.toggle('ptv-client-ten-foot', profile.isTenFootClient);
    root.classList.toggle('ptv-client-tv', profile.isTv);
    root.classList.toggle('ptv-client-mobile', profile.isMobile);
    root.classList.toggle('ptv-client-tablet', profile.isTablet);
    root.classList.toggle('ptv-client-coarse-pointer', profile.isCoarsePointer);
    root.classList.toggle('ptv-client-low-power', profile.isLowPower);
    root.classList.toggle('ptv-client-constrained-hardware', profile.isConstrainedHardware);
    root.classList.toggle('ptv-no-backdrop-filter', !profile.supportsBackdropFilter);
    root.dataset.ptvClientProfile = profile.kind;
    applyPtvRenderProfileClasses(root, profile.renderProfile);

    return profile;
}
