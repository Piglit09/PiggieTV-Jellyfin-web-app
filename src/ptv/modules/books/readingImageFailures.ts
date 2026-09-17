export type PtvReadingImageFailureState = {
    alternateImageUsedCount: number;
    cachedFailureHitCount: number;
    failedBackdropItemIds: Set<string>;
    failedCoverItemIds: Set<string>;
    failedUrls: Set<string>;
    fallbackPosterRenderedCount: number;
    missingPrimaryImageCount: number;
    reportedCachedFailureUrls: Set<string>;
};

function createPtvReadingImageFailureState(): PtvReadingImageFailureState {
    return {
        alternateImageUsedCount: 0,
        cachedFailureHitCount: 0,
        failedBackdropItemIds: new Set<string>(),
        failedCoverItemIds: new Set<string>(),
        failedUrls: new Set<string>(),
        fallbackPosterRenderedCount: 0,
        missingPrimaryImageCount: 0,
        reportedCachedFailureUrls: new Set<string>()
    };
}

export function normalizePtvReadingImageRoute(route: string | null | undefined) {
    return String(route || '').trim().toLowerCase() || 'unknown';
}

export function createPtvReadingImageFailureRegistry() {
    const states = new Map<string, PtvReadingImageFailureState>();
    const retryEpochs = new Map<string, Map<string, number>>();

    function get(route: string | null | undefined) {
        const routeKey = normalizePtvReadingImageRoute(route);
        let state = states.get(routeKey);

        if (!state) {
            state = createPtvReadingImageFailureState();
            states.set(routeKey, state);
        }

        return state;
    }

    function clearForItem(route: string | null | undefined, itemId: string | null | undefined) {
        const normalizedItemId = String(itemId || '').trim().toLowerCase();

        if (!normalizedItemId) return;

        const routeKey = normalizePtvReadingImageRoute(route);
        const state = get(routeKey);
        let routeRetryEpochs = retryEpochs.get(routeKey);

        if (!routeRetryEpochs) {
            routeRetryEpochs = new Map<string, number>();
            retryEpochs.set(routeKey, routeRetryEpochs);
        }
        routeRetryEpochs.set(normalizedItemId, (routeRetryEpochs.get(normalizedItemId) || 0) + 1);

        for (const id of Array.from(state.failedCoverItemIds)) {
            if (id.toLowerCase() === normalizedItemId) state.failedCoverItemIds.delete(id);
        }

        for (const id of Array.from(state.failedBackdropItemIds)) {
            if (id.toLowerCase() === normalizedItemId) state.failedBackdropItemIds.delete(id);
        }

        for (const url of Array.from(state.failedUrls)) {
            if (url.toLowerCase().includes(`/items/${normalizedItemId}/images/`)) {
                state.failedUrls.delete(url);
                state.reportedCachedFailureUrls.delete(url);
            }
        }
    }

    function getRetryEpoch(route: string | null | undefined, itemId: string | null | undefined) {
        const routeKey = normalizePtvReadingImageRoute(route);
        const normalizedItemId = String(itemId || '').trim().toLowerCase();

        return retryEpochs.get(routeKey)?.get(normalizedItemId) || 0;
    }

    return { clearForItem, get, getRetryEpoch };
}
