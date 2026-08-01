const PTV_READING_CATALOG_VIEWS = new Set([
    'library'
]);

export function isPtvReadingCatalogView(view: string) {
    return PTV_READING_CATALOG_VIEWS.has(view);
}

export function shouldStartPtvReadingLibraryIndexImmediately(view: string) {
    return isPtvReadingCatalogView(view);
}

export type PtvReadingRouteHomeGate = 'error' | 'loading' | 'ready';

export function getPtvReadingRouteHomeGate(
    view: string,
    options: {
        hasError: boolean;
        hasHomeSections: boolean;
        isLoading: boolean;
    }
): PtvReadingRouteHomeGate {
    if (isPtvReadingCatalogView(view) && options.isLoading) return 'ready';
    if (options.hasHomeSections) return 'ready';
    if (options.hasError) return 'error';
    if (isPtvReadingCatalogView(view)) return 'ready';
    if (options.isLoading) return 'loading';

    return 'ready';
}
