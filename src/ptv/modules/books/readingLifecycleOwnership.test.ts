import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const booksPageSource = readFileSync(
    resolve(process.cwd(), 'src/ptv/modules/books/booksPage.tsx'),
    'utf8'
);
const booksApiSource = readFileSync(
    resolve(process.cwd(), 'src/ptv/modules/books/booksApi.ts'),
    'utf8'
);
const libraryIndexCacheSource = readFileSync(
    resolve(process.cwd(), 'src/ptv/utils/libraryIndexCache.ts'),
    'utf8'
);
const itemIdentifierSource = readFileSync(
    resolve(process.cwd(), 'src/components/itemidentifier/itemidentifier.js'),
    'utf8'
);

describe('PiggieTV Reading catalog lifecycle', () => {
    it('serves the direct Library route from its progressive index without a broad Home request', () => {
        const immediateIndexStart = booksPageSource.indexOf('if (startsLibraryIndexImmediately) {');
        const directRouteReturn = booksPageSource.indexOf('return Promise.resolve();', immediateIndexStart);
        const initialHomeStart = booksPageSource.indexOf(
            'return getPtvReadingHome(route.kind, {'
        );

        expect(immediateIndexStart).toBeGreaterThan(-1);
        expect(directRouteReturn).toBeGreaterThan(immediateIndexStart);
        expect(initialHomeStart).toBeGreaterThan(directRouteReturn);
        expect(booksPageSource).not.toContain("if (route.view === 'library') {\n                    void fetchPtvReadingHomeSection");
        expect(booksPageSource).toContain(
            'loadReadingLibraryIndex(route.kind, forceRefresh, requestId, signal)'
        );
    });

    it('uses catalog-local loading instead of the global empty Home gate', () => {
        expect(booksPageSource).toContain(
            'const homeGate = getPtvReadingRouteHomeGate(route.view'
        );
        expect(booksPageSource).toContain(
            '(isLoading || homeData.isPartial) && !sourceItems.length'
        );
        expect(booksPageSource).not.toContain(
            'if (isLoading && !homeData.sections.length)'
        );
    });

    it('physically retires route, search, and item-detail consumers', () => {
        expect(booksPageSource).toContain('readingRouteWorkControllerRef.current?.abort();');
        expect(booksPageSource).toContain('signal: controller.signal');
        expect(booksPageSource.match(/controller\.abort\(\);/g)?.length).toBeGreaterThanOrEqual(2);
        expect(booksPageSource).toMatch(
            /if \(controller\.signal\.aborted \|\| isReadingRequestAbort\(error\)\) \{[\s\S]*?routeCriticalLifecycle\?\.retire\(\);[\s\S]*?return;/
        );
    });

    it('retires card-menu ownership when Home, search, or item-detail data changes', () => {
        expect(booksPageSource).toContain('const readingCardMenuContentVersion = useMemo(() => ({');
        expect(booksPageSource).toContain('homeData,\n        itemDetail,\n        searchResults');
        expect(booksPageSource).toContain('contentVersion={readingCardMenuContentVersion}');
    });

    it('keys grid-window resets to membership instead of metadata-only array replacement', () => {
        expect(booksPageSource).toContain('usePtvReadingGridVisibleLimit(');
        expect(booksPageSource).not.toContain('}, [allGridItems, routeKind]);');
    });

    it('reconciles Identify per item without rebuilding the Reading route', () => {
        const handlerStart = booksPageSource.indexOf('const openAdminAction = useCallback');
        const handlerEnd = booksPageSource.indexOf('const adminControls = useMemo', handlerStart);
        const handler = booksPageSource.slice(handlerStart, handlerEnd);

        expect(handlerStart).toBeGreaterThan(-1);
        expect(handler).toContain('ownerRequestId !== readingRequestIdRef.current');
        expect(handler).toContain('publishAuthoritativeReadingItem(refreshedItem);');
        expect(handler).toContain('refreshReadingMetadataItem(itemId');
        expect(handler).not.toContain('loadReadingData(');
        expect(handler).not.toContain('invalidatePtvReadingHomeCache(');
        expect(handler).not.toContain('window.setTimeout(');
        expect(booksPageSource).toContain('readingIdentifyReconciliation.requestReadback(itemId)');
        expect(booksPageSource).toContain('readingIdentifyReconciliation.cancelAll();');
        expect(booksPageSource).not.toContain('readingMetadataRefreshControllersRef');
    });

    it('never promotes an unconfirmed Identify event through a blind seventh readback', () => {
        const handlerStart = booksPageSource.indexOf('const handleMetadataUpdate = (event: Event) => {');
        const handlerEnd = booksPageSource.indexOf(
            'window.addEventListener(PTV_READING_ITEM_METADATA_UPDATED_EVENT',
            handlerStart
        );
        const handler = booksPageSource.slice(handlerStart, handlerEnd);

        expect(handlerStart).toBeGreaterThan(-1);
        expect(handler).toContain('readingIdentifyReconciliation.reconcileMutation(');
        expect(handler).not.toContain('refreshReadingMetadataItem(detail.itemId');
        expect(handler).not.toContain('publishAuthoritativeReadingItem(detail.item)');
    });

    it('bounds one Identify to six targeted reads with no broad-model request path', () => {
        expect(itemIdentifierSource).toContain(
            'const READING_IDENTIFY_READBACK_DELAYS_MS = [0, 300, 750, 1500, 3000, 5000];'
        );
        expect(itemIdentifierSource).toContain('delays: READING_IDENTIFY_READBACK_DELAYS_MS');

        const handlerStart = booksPageSource.indexOf('const handleMetadataUpdate = (event: Event) => {');
        const handlerEnd = booksPageSource.indexOf(
            'window.addEventListener(PTV_READING_ITEM_METADATA_UPDATED_EVENT',
            handlerStart
        );
        const handler = booksPageSource.slice(handlerStart, handlerEnd);

        expect(handler).not.toContain('getPtvUserViews');
        expect(handler).not.toContain('getPtvReadingHome');
        expect(handler).not.toContain('loadReadingData');
        expect(handler).not.toContain('navigate(');
        expect(handler).not.toContain('refreshReadingMetadataItem');
    });

    it('requires exact expected-effect confirmation for the generic Identify path too', () => {
        expect(itemIdentifierSource).toContain("const readbackCode = readbackConfirmed ? 'READBACK_CONFIRMED' : 'REFRESH_FAILED';");
        expect(itemIdentifierSource).toContain('confirmGenericIdentifyMutation({');
        expect(itemIdentifierSource).toContain(
            'Metadata changes were accepted, but the authoritative item could not be fully confirmed.'
        );
        expect(itemIdentifierSource).not.toContain('fetchAppliedItemWithSettledMetadata(');
    });

    it('records the new artwork-write failure without the inherited identity diagnostic envelope', () => {
        const diagnosticStart = itemIdentifierSource.indexOf(
            "recordPtvEvent('api', 'ptv-reading-identify-selective-artwork-failed'"
        );
        const diagnosticEnd = itemIdentifierSource.indexOf('});', diagnosticStart);
        const diagnostic = itemIdentifierSource.slice(diagnosticStart, diagnosticEnd);

        expect(diagnosticStart).toBeGreaterThan(-1);
        expect(diagnosticEnd).toBeGreaterThan(diagnosticStart);
        expect(diagnostic).toContain('errorCategory');
        expect(diagnostic).toContain('reason');
        expect(diagnostic).not.toContain('itemId');
        expect(diagnostic).not.toContain('itemName');
        expect(diagnostic).not.toContain('provider');
    });

    it('lets Identify cancellation exit before any reconciliation read starts', () => {
        const handlerStart = booksPageSource.indexOf('const openAdminAction = useCallback');
        const handlerEnd = booksPageSource.indexOf('const adminControls = useMemo', handlerStart);
        const handler = booksPageSource.slice(handlerStart, handlerEnd);
        const identifyReturn = handler.indexOf("if (closePolicy === 'identify-event') return;");
        const fallbackRead = handler.indexOf('refreshReadingMetadataItem(itemId');
        const catchStart = handler.indexOf('.catch(() => {');
        const catchEnd = handler.indexOf('\n            });\n    },', catchStart);
        const catchBlock = handler.slice(catchStart, catchEnd);

        expect(identifyReturn).toBeGreaterThan(-1);
        expect(fallbackRead).toBeGreaterThan(identifyReturn);
        expect(catchStart).toBeGreaterThan(-1);
        expect(catchEnd).toBeGreaterThan(catchStart);
        expect(catchBlock).not.toContain('refreshReadingMetadataItem');
    });

    it('keeps cover and backdrop fallback state local to explicit artwork generations', () => {
        expect(booksPageSource.match(/<ReadingArtwork /g)).toHaveLength(5);
        expect(booksPageSource.match(/<ReadingBackdropArtwork/g)).toHaveLength(2);
        expect(booksPageSource).toContain('const identity = `${routeKind}:cover:${stableId}`;');
        expect(booksPageSource).toContain('const identity = `${route}:backdrop:${stableId}`;');
        expect(booksPageSource).toContain("getPtvReadingArtworkResolution(item, profileSize, 'cover')");
        expect(booksPageSource).toContain("getPtvReadingArtworkResolution(item, profileSize, 'backdrop')");
        expect(booksPageSource).toContain('generation={JSON.stringify([ artwork.generation, retryEpoch ])}');
        expect(booksPageSource).toContain('readingImageFailures.getRetryEpoch(routeKind, item.Id || stableId)');
        expect(booksPageSource).toContain('readingImageFailures.getRetryEpoch(route, item?.Id || stableId)');
        expect(booksPageSource).toContain('sources={sources}');
        expect(booksPageSource).not.toContain('getReadingImageErrorHandler');
        expect(booksPageSource).not.toContain('getReadingBackdropErrorHandler');
        expect(booksPageSource).not.toContain('applyReadingImageFallbackToItem');
        expect(booksPageSource).not.toContain('data-ptv-fallback-applied');
    });

    it('renders one visible page-level Reading backdrop outside the CSS-hidden app container', () => {
        const shellStart = booksPageSource.lastIndexOf('<PTVShell');
        const mainStart = booksPageSource.indexOf('<main', shellStart);
        const pageBackdrop = booksPageSource.indexOf('<ReadingPageBackdrop', shellStart);
        const mainEnd = booksPageSource.indexOf('</main>', mainStart);

        expect(shellStart).toBeGreaterThan(-1);
        expect(pageBackdrop).toBeGreaterThan(shellStart);
        expect(pageBackdrop).toBeLessThan(mainStart);
        expect(booksPageSource.slice(mainStart, mainEnd)).not.toContain('<ReadingPageBackdrop');
        expect(booksPageSource).toContain("route.view === 'home' ? null");
    });

    it('invalidates metadata caches without retiring an active progressive index', () => {
        const metadataInvalidationStart = booksApiSource.indexOf(
            'export function invalidatePtvReadingMetadataCache('
        );
        const fullInvalidationStart = booksApiSource.indexOf(
            'export function invalidatePtvReadingHomeCache()'
        );
        const metadataInvalidation = booksApiSource.slice(metadataInvalidationStart, fullInvalidationStart);
        const itemBranchStart = metadataInvalidation.indexOf('if (item?.Id) {');
        const itemBranchEnd = metadataInvalidation.indexOf('\n        return;', itemBranchStart);
        const itemInvalidation = metadataInvalidation.slice(itemBranchStart, itemBranchEnd);
        const globalInvalidation = metadataInvalidation.slice(itemBranchEnd);

        expect(metadataInvalidationStart).toBeGreaterThan(-1);
        expect(fullInvalidationStart).toBeGreaterThan(metadataInvalidationStart);
        expect(metadataInvalidation).toContain('readingMetadataOverlays.record(item);');
        expect(itemBranchStart).toBeGreaterThan(-1);
        expect(itemInvalidation).toContain('deletePtvLibraryIndexCache(getReadingLibraryIndexCacheKey(routeKind))');
        expect(itemInvalidation).not.toContain('readingHomeCache.clear();');
        expect(itemInvalidation).not.toContain('deletePtvLibraryIndexCacheByPrefix');
        expect(itemInvalidation).not.toContain('getPtvReadingHome(');
        expect(itemInvalidation).not.toContain('getPtvReadingLibraries(');
        expect(globalInvalidation).toContain('readingHomeCache.clear();');
        expect(globalInvalidation).toContain('deletePtvLibraryIndexCacheByPrefix');
        expect(booksPageSource).toContain('invalidatePtvReadingMetadataCache(item);');
        expect(booksPageSource).toContain('item?.PrimaryImageItemId as string | undefined');
        expect(booksPageSource).toContain('item?.AlbumPrimaryImageItemId as string | undefined');
        expect(booksPageSource).toContain('item?.BackdropItemId as string | undefined');
        expect(booksApiSource).toContain('applyPtvReadingMetadataOverlays(uniqueItems, options.requestMetadataEpoch)');
        expect(booksApiSource).toContain('applyPtvReadingMetadataOverlaysToHomeData(data, requestMetadataEpoch)');
        expect(booksApiSource).toContain('retirePtvReadingMetadataOverlays(uniqueItems, options.requestMetadataEpoch);');
        expect(libraryIndexCacheSource).toContain('options.shouldWrite?.() === false');
    });
});
