import { beforeEach, describe, expect, it } from 'vitest';

import type { PtvReadingItem } from './booksTypes';
import { createPtvReadingMetadataOverlayLifecycle } from './readingMetadataOverlayLifecycle';

function item(id: string, name: string): PtvReadingItem {
    return {
        Id: id,
        Name: name,
        ServerId: 'server-one',
        Type: 'Book'
    };
}

describe('Reading authoritative metadata overlays', () => {
    let lifecycle: ReturnType<typeof createPtvReadingMetadataOverlayLifecycle>;

    beforeEach(() => {
        lifecycle = createPtvReadingMetadataOverlayLifecycle(() => 'server:user');
    });

    it('protects an in-flight list without replacing unaffected items', () => {
        const stale = item('book-1', 'Before Identify');
        const unaffected = item('book-2', 'Keep me');
        const authoritative = {
            ...stale,
            ImageTags: { Primary: 'fresh-image-tag' },
            Name: 'Server-normalized title'
        };

        lifecycle.record(authoritative);

        const overlaidItems = lifecycle.apply([ stale, unaffected ]);

        expect(overlaidItems[0]).toMatchObject(authoritative);
        expect(overlaidItems[1]).toBe(unaffected);
    });

    it('retires the overlay when a request started after the metadata update returns', () => {
        const serverItem = item('book-1', 'Newer server edit');

        lifecycle.record(item('book-1', 'Identify result'));
        const postUpdateRequestEpoch = lifecycle.getEpoch();

        lifecycle.retire([ serverItem ], postUpdateRequestEpoch);

        expect(lifecycle.apply([ serverItem ])[0]).toBe(serverItem);
    });

    it('clears overlays during a full refresh', () => {
        const stale = item('book-1', 'Before Identify');

        lifecycle.record(item('book-1', 'Identify result'));
        lifecycle.clear();

        expect(lifecycle.apply([ stale ])[0]).toBe(stale);
    });

    it('prevents a cache write from an operation superseded by metadata invalidation', () => {
        const writeOptions = lifecycle.getWriteOptions();

        lifecycle.record(item('book-1', 'Identify result'));

        expect(writeOptions.shouldWrite()).toBe(false);
    });
});
