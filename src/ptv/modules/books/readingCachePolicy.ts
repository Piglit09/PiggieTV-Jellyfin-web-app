export type PtvReadingCacheLookupOptions = Readonly<{
    cachedLibrarySetIdentity?: string | null;
    cachedRouteKind?: string | null;
    forceRefresh?: boolean;
    librarySetIdentity?: string | null;
    staleHit?: boolean;
    routeKind?: string | null;
}>;

export function isPtvReadingFullHomeCache(data: { isPartial?: boolean } | null | undefined) {
    return data !== null && data !== undefined && !data.isPartial;
}

/**
 * A Reading cache key is provisional until library discovery supplies a stable
 * library-set identity. Unscoped entries must never render first. A scoped,
 * stale full entry remains eligible for immediate display, but is identified by
 * its cache diagnostics and revalidated in the background.
 */
export function canUsePtvReadingHomeCache(options: PtvReadingCacheLookupOptions = {}) {
    const librarySetIdentity = String(options.librarySetIdentity || '').trim();
    const cachedLibrarySetIdentity = String(options.cachedLibrarySetIdentity || '').trim();

    return !options.forceRefresh
        && !options.staleHit
        && Boolean(librarySetIdentity)
        && librarySetIdentity !== 'unscoped'
        && librarySetIdentity === cachedLibrarySetIdentity
        && String(options.routeKind || '') === String(options.cachedRouteKind || '');
}
