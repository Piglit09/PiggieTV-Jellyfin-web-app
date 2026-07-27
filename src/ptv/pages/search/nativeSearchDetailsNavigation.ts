import { appRouter } from '../../../components/router/appRouter';

import {
    executePtvWebDetailsNavigation,
    type PtvWebNavigationDiagnostic
} from '../../core/navigation/webNavigationAdapter';
import { parsePtvNavigationDeepLink } from '../../core/navigation/navigationIntent';
import {
    recordPtvItemRouteClick,
    type PtvItemRouteResult
} from '../../core/itemRoutes';
import { recordPtvEvent } from '../../core/observability';

type PtvSearchRouteItem = Record<string, unknown> | null | undefined;

export type PtvSearchCardActivationEvent = Readonly<{
    altKey: boolean;
    button: number;
    ctrlKey: boolean;
    defaultPrevented: boolean;
    metaKey: boolean;
    preventDefault: () => void;
    shiftKey: boolean;
}>;

const PTV_SEARCH_GENERIC_DETAILS_TYPES = new Set([
    'boxset',
    'episode',
    'movie',
    'season',
    'series'
]);
const inFlightSearchDetailsNavigation = new Map<string, Promise<unknown>>();

function getRecordString(item: PtvSearchRouteItem, ...keys: string[]) {
    if (!item) return '';

    for (const key of keys) {
        const value = item[key];

        if (typeof value === 'string' && value.trim()) return value.trim();
    }

    return '';
}

function isDetailsHref(href: string) {
    const parsed = parsePtvNavigationDeepLink(href);

    return parsed.success ?
        parsed.value.destination === 'details' :
        /^#\/details(?:\?|$)/i.test(href.trim());
}

function isUnmodifiedPrimaryActivation(event: PtvSearchCardActivationEvent) {
    return !event.defaultPrevented
        && event.button === 0
        && !event.altKey
        && !event.ctrlKey
        && !event.metaKey
        && !event.shiftKey;
}

function recordNativeSearchNavigationDiagnostic(value: PtvWebNavigationDiagnostic) {
    try {
        recordPtvEvent('route', 'ptv-core-details-navigation', value);
    } catch {
        // Navigation must not depend on diagnostics.
    }
}

export function shouldUsePtvSearchDetailsNavigation(
    item: PtvSearchRouteItem,
    route: PtvItemRouteResult
) {
    const itemType = getRecordString(item, 'Type', 'type').toLowerCase();

    return route.routeSource === 'jellyfin-fallback'
        && PTV_SEARCH_GENERIC_DETAILS_TYPES.has(itemType)
        && isDetailsHref(route.href);
}

export async function openNativeSearchDetails(options: Readonly<{
    href: string;
    mediaId?: string;
}>) {
    const parsedRoute = parsePtvNavigationDeepLink(options.href);

    return executePtvWebDetailsNavigation({
        backBehavior: 'preserve',
        diagnostic: recordNativeSearchNavigationDiagnostic,
        libraryId: parsedRoute.success ? parsedRoute.value.libraryId : undefined,
        mediaId: options.mediaId,
        navigate: route => appRouter.show(route),
        query: parsedRoute.success ? parsedRoute.value.query : {},
        sourceFeature: 'native-search-card'
    });
}

export function activateNativeSearchCard(options: Readonly<{
    event: PtvSearchCardActivationEvent;
    item: PtvSearchRouteItem;
    route: PtvItemRouteResult;
    sourceGroup: string;
}>): Promise<unknown> | null {
    const context = {
        action: 'search-card',
        source: 'ptv-search'
    } as const;
    const useCoreDetailsNavigation = shouldUsePtvSearchDetailsNavigation(options.item, options.route);

    if (!useCoreDetailsNavigation || !isUnmodifiedPrimaryActivation(options.event)) {
        recordPtvItemRouteClick(options.item, options.route, context);
        return null;
    }

    options.event.preventDefault();
    const mediaId = getRecordString(options.item, 'Id', 'id');
    const navigationKey = [
        options.sourceGroup,
        mediaId,
        options.route.href
    ].join(':');
    const existing = inFlightSearchDetailsNavigation.get(navigationKey);
    if (existing) return existing;

    recordPtvItemRouteClick(options.item, options.route, context);
    const navigation = openNativeSearchDetails({
        href: options.route.href,
        mediaId
    });
    const trackedNavigation = navigation.finally(() => {
        if (inFlightSearchDetailsNavigation.get(navigationKey) === trackedNavigation) {
            inFlightSearchDetailsNavigation.delete(navigationKey);
        }
    });

    inFlightSearchDetailsNavigation.set(navigationKey, trackedNavigation);

    return trackedNavigation;
}
