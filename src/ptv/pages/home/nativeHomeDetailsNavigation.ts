import { appRouter } from '../../../components/router/appRouter';

import {
    executePtvWebDetailsNavigation,
    type PtvWebNavigationDiagnostic
} from '../../core/navigation/webNavigationAdapter';
import { parsePtvNavigationDeepLink } from '../../core/navigation/navigationIntent';
import { recordPtvEvent } from '../../core/observability';

function recordNativeHomeNavigationDiagnostic(value: PtvWebNavigationDiagnostic) {
    try {
        recordPtvEvent('route', 'ptv-core-details-navigation', value);
    } catch {
        // Navigation must not depend on diagnostics.
    }
}

export async function openNativeHomeDetails(options: Readonly<{
    href: string;
    mediaId?: string;
}>) {
    const parsedRoute = parsePtvNavigationDeepLink(options.href);
    return executePtvWebDetailsNavigation({
        backBehavior: 'preserve',
        diagnostic: recordNativeHomeNavigationDiagnostic,
        libraryId: parsedRoute.success ? parsedRoute.value.libraryId : undefined,
        mediaId: options.mediaId,
        navigate: route => appRouter.show(route),
        query: parsedRoute.success ? parsedRoute.value.query : {},
        sourceFeature: 'native-home-card'
    });
}
