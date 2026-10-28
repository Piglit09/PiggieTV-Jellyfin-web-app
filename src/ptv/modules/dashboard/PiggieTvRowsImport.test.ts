import { describe, expect, it } from 'vitest';

import { parsePtvRowBuilderImport } from './rowBuilderImport';

function row(id: string) {
    return {
        generationMode: 'latest',
        id,
        itemLimit: 16,
        mediaType: 'movies',
        name: `Row ${id}`,
        sourceType: 'latest',
        sourceValue: 'movies'
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

    it('accepts schema-3 scopes without losing a pinned VirtualFolder ID', () => {
        const pinnedId = '6b4a947ebdc043789a544c95be2b0e19';
        const imported = parsePtvRowBuilderImport(JSON.stringify({
            enabled: true,
            rules: [
                { ...row('latest-movies'), libraryScope: { mode: 'defaultLibrary', defaultKey: 'movies', virtualFolderId: pinnedId } },
                { ...row('custom-movies'), libraryScope: { mode: 'virtualFolder', virtualFolderId: pinnedId } }
            ],
            schemaVersion: 3
        }));

        expect(imported.schemaVersion).toBe(3);
        expect(imported.rules).toEqual([
            expect.objectContaining({ libraryScope: { mode: 'defaultLibrary', defaultKey: 'movies', virtualFolderId: pinnedId } }),
            expect.objectContaining({ libraryScope: { mode: 'virtualFolder', virtualFolderId: pinnedId } })
        ]);
    });

    it.each([
        [ 'missing schema-3 scope', undefined ],
        [ 'unknown mode', { mode: 'unknown' } ],
        [ 'global with a library ID', { mode: 'global', virtualFolderId: '6b4a947ebdc043789a544c95be2b0e19' } ],
        [ 'wrong default key', { mode: 'defaultLibrary', defaultKey: 'shows' } ],
        [ 'malformed pinned ID', { mode: 'virtualFolder', virtualFolderId: 'Movies' } ],
        [ 'unbound explicit library', { mode: 'virtualFolder', virtualFolderId: '' } ]
    ])('rejects %s instead of importing it as global', (_label, libraryScope) => {
        expect(() => parsePtvRowBuilderImport(JSON.stringify({
            rules: [ { ...row('latest-movies'), libraryScope } ],
            schemaVersion: 3
        }))).toThrow(/library scope/i);
    });

    it('rejects a global scope for a sourceType library rule', () => {
        expect(() => parsePtvRowBuilderImport(JSON.stringify({
            rules: [ { ...row('custom-library'), sourceType: 'library', libraryScope: { mode: 'global' } } ],
            schemaVersion: 3
        }))).toThrow(/library scope/i);
    });

    it.each([
        [ 'custom rule', { ...row('custom-movies') } ],
        [ 'changed built-in tuple', { ...row('latest-movies'), sourceType: 'genre', sourceValue: 'Action' } ]
    ])('rejects a pinned defaultLibrary scope on a %s', (_label, candidate) => {
        expect(() => parsePtvRowBuilderImport(JSON.stringify({
            rules: [ {
                ...candidate,
                libraryScope: {
                    mode: 'defaultLibrary',
                    defaultKey: 'movies',
                    virtualFolderId: '6b4a947ebdc043789a544c95be2b0e19'
                }
            } ],
            schemaVersion: 3
        }))).toThrow(/library scope/i);
    });
});
