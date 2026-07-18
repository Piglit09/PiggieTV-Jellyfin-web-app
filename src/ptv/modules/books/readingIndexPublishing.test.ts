import { describe, expect, it } from 'vitest';

import type {
    PtvReadingHomeData,
    PtvReadingLibraryIndex
} from './booksTypes';
import {
    getReadingPageRenderIdentity,
    shouldPublishReadingIndexProgress
} from './readingIndexPublishing';

function createIndex(count: number, total = 2_911, complete = count >= total): PtvReadingLibraryIndex {
    return {
        debug: {
            dropReasons: [],
            droppedItemCount: 0,
            fetchedItemCount: count,
            indexAccumulatedCount: count,
            indexIsComplete: complete,
            indexStage: complete ? 'complete' : 'background',
            indexTotalPageCount: Math.ceil(total / 50),
            jellyfinItemTotal: total,
            jellyfinRouteItemTotal: total,
            kindCounts: { book: 0, comic: 0, manga: count },
            lastReadingQueryUrl: '',
            libraryDiagnostics: [],
            pageCount: Math.ceil(count / 50),
            pageSize: 50,
            readingLibraryNames: ['Manga'],
            requestDurationMs: 10,
            routeKind: 'manga',
            sectionDiagnostics: [],
            selectedReadingLibraryIds: [],
            statusCode: 200,
            totalRecordCountFromApi: total
        },
        items: [],
        libraries: []
    };
}

function createHomeData(itemCount: number, complete: boolean): PtvReadingHomeData {
    return {
        generatedAt: 1,
        isPartial: !complete,
        kind: 'manga',
        libraries: [],
        sections: [{
            id: 'library',
            items: Array.from({ length: itemCount }, (_, index) => ({ Id: String(index) })),
            title: 'Library'
        }],
        stats: {
            favoriteCount: 0,
            itemCount,
            libraryCount: 1,
            metadata: {
                itemCount,
                providerCounts: {
                    comicvine: 0,
                    googlebooks: 0,
                    openlibrary: 0
                }
            },
            resumedCount: 0
        }
    };
}

describe('Reading background index publishing', () => {
    it('coalesces page-sized progress and always publishes completion', () => {
        const initial = createIndex(200);

        expect(shouldPublishReadingIndexProgress(null, initial)).toBe(true);
        expect(shouldPublishReadingIndexProgress(initial, createIndex(250))).toBe(false);
        expect(shouldPublishReadingIndexProgress(initial, createIndex(500))).toBe(true);
        expect(shouldPublishReadingIndexProgress(createIndex(2_900), createIndex(2_911))).toBe(true);
    });

    it('does not treat accumulated item growth as a new page-render lifecycle stage', () => {
        const partialIdentity = getReadingPageRenderIdentity(createHomeData(200, false), 'manga', 'library');

        expect(getReadingPageRenderIdentity(createHomeData(500, false), 'manga', 'library')).toBe(partialIdentity);
        expect(getReadingPageRenderIdentity(createHomeData(2_911, true), 'manga', 'library')).not.toBe(partialIdentity);
    });
});
