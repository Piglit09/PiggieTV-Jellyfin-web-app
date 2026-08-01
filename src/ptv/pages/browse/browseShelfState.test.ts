import { describe, expect, it } from 'vitest';

import {
    mergePtvBrowseShelfResult,
    preparePtvBrowseSectionsForRetry,
    type PtvBrowseShelfSnapshot
} from './browseShelfState';

type TestShelf = PtvBrowseShelfSnapshot & Readonly<{
    title: string;
}>;

function makeShelf(
    id: string,
    status: PtvBrowseShelfSnapshot['status'],
    itemIds: string[] = [],
    error = ''
): TestShelf {
    return {
        error,
        id,
        items: itemIds.map(itemId => ({ Id: itemId })),
        status,
        title: id
    };
}

describe('browse shelf state', () => {
    it('starts only the failed shelf loading while retaining ready shelf identity and items', () => {
        const focusedShelf = makeShelf('continue', 'ready', [ 'focused-item' ]);
        const failedShelf = makeShelf('recommendations', 'error', [], 'Timed out');

        const sections = preparePtvBrowseSectionsForRetry(
            [ focusedShelf, failedShelf ],
            failedShelf.id
        );

        expect(sections[0]).toBe(focusedShelf);
        expect(sections[0]?.items).toEqual([ { Id: 'focused-item' } ]);
        expect(sections[1]).toEqual({
            ...failedShelf,
            error: '',
            status: 'loading'
        });
    });

    it('does not downgrade an already ready target when a refresh starts', () => {
        const readyShelf = makeShelf('continue', 'ready', [ 'keep-me' ]);

        const sections = preparePtvBrowseSectionsForRetry([ readyShelf ], readyShelf.id);

        expect(sections[0]).toBe(readyShelf);
    });

    it.each([
        [ 'failed', makeShelf('continue', 'error', [], 'Server error') ],
        [ 'empty', makeShelf('continue', 'empty') ],
        [ 'nominally ready but empty', makeShelf('continue', 'ready') ],
        [ 'still loading', makeShelf('continue', 'loading') ]
    ])('keeps a ready shelf when a %s replacement arrives', (_label, incoming) => {
        const current = makeShelf('continue', 'ready', [ 'keep-me' ]);

        expect(mergePtvBrowseShelfResult(current, incoming)).toBe(current);
    });

    it('accepts a non-empty ready replacement', () => {
        const current = makeShelf('continue', 'ready', [ 'old-item' ]);
        const incoming = makeShelf('continue', 'ready', [ 'new-item' ]);

        expect(mergePtvBrowseShelfResult(current, incoming)).toBe(incoming);
    });
});
