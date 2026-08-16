import { describe, expect, it } from 'vitest';

import { parsePtvRowBuilderImport } from './rowBuilderImport';

function row(id: string) {
    return {
        generationMode: 'latest',
        id,
        itemLimit: 16,
        mediaType: 'movies',
        name: `Row ${id}`,
        sourceType: 'latest'
    };
}

describe('PiggieTV Home Rows import validation', () => {
    it('normalizes a supported Row Builder document without persisting it', () => {
        const imported = parsePtvRowBuilderImport(JSON.stringify({
            enabled: true,
            rules: [ row('latest-movies') ],
            schemaVersion: 2
        }));

        expect(imported.schemaVersion).toBe(2);
        expect(imported.rules).toEqual([ expect.objectContaining({ id: 'latest-movies', name: 'Row latest-movies' }) ]);
    });

    it.each([
        [ 'malformed JSON', '{', /json/i ],
        [ 'unsupported schema', JSON.stringify({ rules: [], schemaVersion: 99 }), /schema version/i ],
        [ 'missing rule collection', JSON.stringify({ enabled: true, schemaVersion: 2 }), /rules or categories/i ],
        [ 'invalid rules', JSON.stringify({ rules: [ row('same'), row('same') ], schemaVersion: 2 }), /duplicate rule id/i ]
    ])('rejects %s atomically', (_label, input, expected) => {
        expect(() => parsePtvRowBuilderImport(input)).toThrow(expected);
    });

    it('rejects oversized imports before normalization', () => {
        const oversized = JSON.stringify({
            padding: 'x'.repeat(513 * 1024),
            rules: [],
            schemaVersion: 2
        });

        expect(() => parsePtvRowBuilderImport(oversized)).toThrow(/smaller than 512 KiB/i);
    });
});
