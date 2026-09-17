import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type {
    PtvReadingHomeData,
    PtvReadingLibraryDebug,
    PtvReadingSection
} from './booksTypes';
import { getPtvReadingHomeState } from './readingHomeState';

function section(
    id: string,
    options: Partial<PtvReadingSection> = {}
): PtvReadingSection {
    return {
        id,
        items: [],
        title: id,
        ...options
    };
}

function homeData(
    sections: PtvReadingSection[],
    options: Partial<PtvReadingHomeData> = {}
): PtvReadingHomeData {
    return {
        generatedAt: 1,
        isPartial: false,
        kind: 'reading',
        libraries: [],
        sections,
        stats: {
            favoriteCount: 0,
            itemCount: sections.reduce((count, value) => count + value.items.length, 0),
            libraryCount: 1,
            metadata: {
                itemCount: 0,
                providerCounts: {
                    comicvine: 0,
                    googlebooks: 0,
                    openlibrary: 0
                }
            },
            resumedCount: 0
        },
        ...options
    };
}

function libraryDebug(overrides: Partial<PtvReadingLibraryDebug> = {}): PtvReadingLibraryDebug {
    return {
        dropReasons: [],
        droppedItemCount: 0,
        failedReadCount: 0,
        fetchedItemCount: 0,
        indexAccumulatedCount: 0,
        indexIsComplete: true,
        indexStage: 'complete',
        indexTotalPageCount: 0,
        jellyfinItemTotal: 0,
        jellyfinRouteItemTotal: 0,
        kindCounts: { book: 0, comic: 0, manga: 0 },
        lastReadingQueryUrl: '',
        libraryDiagnostics: [],
        pageCount: 0,
        pageSize: 50,
        readingLibraryNames: [],
        requestDurationMs: 1,
        routeKind: 'reading',
        sectionDiagnostics: [],
        selectedReadingLibraryIds: [],
        statusCode: 200,
        totalRecordCountFromApi: 0,
        ...overrides
    };
}

describe('getPtvReadingHomeState', () => {
    it('keeps an unresolved initial snapshot loading', () => {
        expect(getPtvReadingHomeState(homeData([
            section('recently-added', { isLoading: true })
        ], { isPartial: true }))).toBe('loading');
    });

    it('classifies a successful non-empty result as populated', () => {
        expect(getPtvReadingHomeState(homeData([
            section('library', { items: [ { Id: 'item-a', Name: 'Book' } ] })
        ]))).toBe('populated');
    });

    it('classifies mixed content and a failed shelf as partial', () => {
        expect(getPtvReadingHomeState(homeData([
            section('library', { items: [ { Id: 'item-a', Name: 'Book' } ] }),
            section('favorites', {
                diagnostics: {
                    error: 'timed out',
                    id: 'favorites',
                    itemCount: 0,
                    lastQueriedUrl: '',
                    requestDurationMs: 7_000,
                    source: 'jellyfin-items',
                    status: 'error',
                    statusCode: null,
                    timeoutReason: 'timeout',
                    title: 'Favorites',
                    updatedAt: 1
                },
                error: 'Favorites could not be loaded.'
            })
        ]))).toBe('partial');
    });

    it.each([
        'failed',
        'timed out'
    ])('classifies an all-reads %s result as failed rather than empty', error => {
        expect(getPtvReadingHomeState(homeData([
            section('continue-reading', { error }),
            section('recently-added', { error }),
            section('favorites', { error }),
            section('library', { error })
        ]))).toBe('failed');
    });

    it('classifies successfully confirmed zero content as authoritative empty', () => {
        expect(getPtvReadingHomeState(homeData([]))).toBe('authoritative-empty');
    });

    it('does not classify benign normalization drops as a failed read', () => {
        expect(getPtvReadingHomeState(homeData([], {
            libraryDebug: libraryDebug({
                dropReasons: [
                    'reading: 2 duplicate item(s) removed',
                    'reading: 3 item(s) excluded by reading kind filter'
                ],
                droppedItemCount: 5
            })
        }))).toBe('authoritative-empty');
    });

    it('classifies a structured library read failure independently of benign drops', () => {
        expect(getPtvReadingHomeState(homeData([], {
            libraryDebug: libraryDebug({
                dropReasons: [ 'reading: 2 duplicate item(s) removed' ],
                failedReadCount: 1,
                statusCode: null
            })
        }))).toBe('failed');
    });

    it('preserves cached content as partial when its refresh fails', () => {
        expect(getPtvReadingHomeState(homeData([
            section('library', { items: [ { Id: 'cached-item', Name: 'Cached book' } ] })
        ], {
            cacheDiagnostics: {
                itemCount: 1,
                payloadSize: 100,
                refreshDurationMs: 7_000,
                refreshError: 'timed out',
                sectionCount: 1,
                source: 'persistent',
                staleHit: true,
                status: 'stale-hit',
                updatedAt: 1
            }
        }))).toBe('partial');
    });

    it('turns initial loading placeholders into failure after the authoritative refresh fails', () => {
        expect(getPtvReadingHomeState(homeData([
            section('recently-added', { error: 'timed out' }),
            section('continue-reading', { isLoading: true }),
            section('favorites', { isLoading: true })
        ], {
            cacheDiagnostics: {
                itemCount: 0,
                payloadSize: 100,
                refreshDurationMs: 30_000,
                refreshError: 'timed out',
                sectionCount: 3,
                source: 'jellyfin-initial',
                staleHit: false,
                status: 'refresh',
                updatedAt: 1
            },
            isPartial: true
        }))).toBe('failed');
    });

    it('does not allow a late stale generation to replace an active loading state', () => {
        const staleTerminal = homeData([]);
        const currentLoading = homeData([], { generatedAt: 2, isPartial: true });

        expect(getPtvReadingHomeState(staleTerminal, { isLoading: true })).toBe('loading');
        expect(getPtvReadingHomeState(currentLoading)).toBe('loading');
    });

    it('wires failure and authoritative-empty to mutually exclusive page messages', () => {
        const source = readFileSync(
            resolve(process.cwd(), 'src/ptv/modules/books/booksPage.tsx'),
            'utf8'
        );

        expect(source).toContain("pageState === 'failed'");
        expect(source).toContain("pageState === 'authoritative-empty'");
        expect(source).not.toContain('!hasItems && !homeData.isPartial');
    });
});
