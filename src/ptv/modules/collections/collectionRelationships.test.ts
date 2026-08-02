import { describe, expect, it } from 'vitest';

import {
    buildPtvCrossLibraryCollections,
    buildPtvCuratedCollections,
    itemMatchesPtvCollectionRule
} from './collectionRelationships';

describe('Collection relationship resolver', () => {
    it('accepts explicit configured metadata and rejects weak title similarity', () => {
        const tagged = { Id: '1', Name: 'A New Beginning', Tags: ['World:aurora'], Type: 'Movie' };
        const similarlyNamed = { Id: '2', Name: 'Aurora Returns', Type: 'Series' };

        expect(itemMatchesPtvCollectionRule(tagged, {
            field: 'tag',
            reason: 'configured-franchise',
            value: 'World:aurora'
        })).toBe(true);
        expect(buildPtvCrossLibraryCollections([tagged, similarlyNamed])).toEqual([]);
    });

    it('builds explainable cross-library groups only from strong shared identity', () => {
        const collections = buildPtvCrossLibraryCollections([
            { Id: 'movie', Name: 'Chapter', Tags: ['Franchise:aurora'], Type: 'Movie' },
            { Id: 'album', Name: 'Score', Tags: ['Franchise:aurora'], Type: 'MusicAlbum' },
            { Id: 'duplicate', Name: 'Chapter', Tags: ['Franchise:aurora'], Type: 'Movie' }
        ]);

        expect(collections).toHaveLength(1);
        expect(collections[0]).toMatchObject({
            relationshipReason: 'configured-franchise',
            sourceType: 'cross-library'
        });
        expect(new Set(collections[0]?.members.map(member => member.key)).size).toBe(collections[0]?.members.length);
    });

    it('normalizes curated rules without turning missing metadata into membership', () => {
        const collections = buildPtvCuratedCollections([
            { Genres: ['Animation'], Id: '1', Name: 'One', Type: 'Movie' },
            { Genres: ['Animation'], Id: '2', Name: 'Two', Type: 'Series' },
            { Genres: ['Drama'], Id: '3', Name: 'Three', Type: 'Movie' }
        ], [{
            key: 'animation',
            match: 'any',
            minimumMembers: 2,
            rules: [{ field: 'genre', reason: 'configured-franchise', value: 'Animation' }],
            section: 'animation-anime',
            title: 'Animation'
        }]);

        expect(collections).toHaveLength(1);
        expect(collections[0]?.members.map(member => member.key)).toEqual(['1', '2']);
    });
});
