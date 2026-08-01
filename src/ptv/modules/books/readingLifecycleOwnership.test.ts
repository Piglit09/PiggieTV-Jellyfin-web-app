import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const booksPageSource = readFileSync(
    resolve(process.cwd(), 'src/ptv/modules/books/booksPage.tsx'),
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
        expect(booksPageSource).toContain('if (controller.signal.aborted || isReadingRequestAbort(error)) return;');
    });
});
