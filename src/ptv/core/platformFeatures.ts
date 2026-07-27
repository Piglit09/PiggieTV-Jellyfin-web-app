import { PTV_ROUTES } from './config';
import { getPtvClientProfile, type PtvClientProfile } from './clientProfile';

export type PtvPlatformFeature = 'reading' | 'request';

export type PtvPlatformFeaturePolicy = Readonly<{
    reading: boolean;
    request: boolean;
}>;

type PtvPlatformProfile = Pick<PtvClientProfile, 'isWebOs'>;

const WEBOS_EXCLUDED_ROUTE_PATTERN =
    /^#\/(?:books|calendar|comics|maga|manga|ptv\/request|reading|request|requests)(?:[/?]|$)/i;

const WEBOS_EXCLUDED_NAVIGATION_IDS = new Set([
    'calendar',
    'reading',
    'reading-library',
    'request',
    'request-calendar',
    'request-new'
]);

const WEBOS_ROUTE_GUARD_KEY = '__ptvWebOsRouteGuardInstalled';

type PtvPlatformWindow = Window & {
    [WEBOS_ROUTE_GUARD_KEY]?: boolean;
};

export function getPtvPlatformFeaturePolicy(
    profile: PtvPlatformProfile = getPtvClientProfile()
): PtvPlatformFeaturePolicy {
    const supportsExtendedWebFeatures = !profile.isWebOs;

    return {
        reading: supportsExtendedWebFeatures,
        request: supportsExtendedWebFeatures
    };
}

export function isPtvPlatformFeatureAvailable(
    feature: PtvPlatformFeature,
    profile: PtvPlatformProfile = getPtvClientProfile()
) {
    return getPtvPlatformFeaturePolicy(profile)[feature];
}

export function isPtvWebOsExcludedRoute(
    hash: string,
    profile: PtvPlatformProfile = getPtvClientProfile()
) {
    return profile.isWebOs && WEBOS_EXCLUDED_ROUTE_PATTERN.test(hash || '');
}

export function isPtvPlatformNavigationEntryAvailable(
    entry: Readonly<{ href?: string; id: string }>,
    profile: PtvPlatformProfile = getPtvClientProfile()
) {
    if (!profile.isWebOs) return true;
    if (WEBOS_EXCLUDED_NAVIGATION_IDS.has(entry.id)) return false;

    return !WEBOS_EXCLUDED_ROUTE_PATTERN.test(entry.href || '');
}

function redirectExcludedWebOsRoute() {
    if (!isPtvWebOsExcludedRoute(window.location.hash)) return;

    window.location.replace(PTV_ROUTES.home);
}

export function installPtvWebOsRouteGuard(
    profile: PtvPlatformProfile = getPtvClientProfile()
) {
    if (!profile.isWebOs || typeof window === 'undefined') return;

    const platformWindow = window as PtvPlatformWindow;

    if (!platformWindow[WEBOS_ROUTE_GUARD_KEY]) {
        platformWindow[WEBOS_ROUTE_GUARD_KEY] = true;
        window.addEventListener('hashchange', redirectExcludedWebOsRoute);
        window.addEventListener('popstate', redirectExcludedWebOsRoute);
    }

    redirectExcludedWebOsRoute();
}
