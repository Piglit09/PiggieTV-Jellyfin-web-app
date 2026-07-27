import { describe, expect, it } from 'vitest';

import { summarizeFeaturedContentPayload } from './featuredContentSemantics';

describe('featured content semantic usability', () => {
    it('classifies section definitions without content as configuration-only', () => {
        expect(summarizeFeaturedContentPayload({
            heroItems: [],
            sections: Array.from({ length: 6 }, (_value, index) => ({ id: `row-${index}` })),
            sectionItems: Object.fromEntries(Array.from({ length: 6 }, (_value, index) => [ `row-${index}`, [] ]))
        })).toMatchObject({
            emptySectionCount: 6,
            payloadClassification: 'configuration-only',
            sectionCount: 6,
            totalItemCount: 0,
            usableForDisplay: false,
            usableForPersistence: false
        });
    });

    it('accepts a hero or populated shelf as complete content', () => {
        expect(summarizeFeaturedContentPayload({ heroItems: [ {} ], sectionItems: {} }).usableForPersistence).toBe(true);
        expect(summarizeFeaturedContentPayload({ heroItems: [], sectionItems: { recent: [ {} ] } }).usableForPersistence).toBe(true);
    });

    it('allows only an explicitly confirmed empty library to persist empty content', () => {
        expect(summarizeFeaturedContentPayload({
            emptyLibraryConfirmed: true,
            heroItems: [],
            sectionItems: {}
        })).toMatchObject({
            payloadClassification: 'intentional-empty',
            usableForDisplay: true,
            usableForPersistence: true
        });
    });

    it('keeps timed-out populated generation displayable but not persistable', () => {
        expect(summarizeFeaturedContentPayload({
            generationState: 'timed-out',
            heroItems: [],
            sectionItems: { recent: [ {} ] }
        })).toMatchObject({
            payloadClassification: 'partial',
            usableForDisplay: true,
            usableForPersistence: false
        });
    });
});
