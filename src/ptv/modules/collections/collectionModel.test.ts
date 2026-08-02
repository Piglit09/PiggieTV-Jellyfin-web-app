import { describe, expect, it } from 'vitest';

import {
    dedupePtvCollectionMembers,
    normalizeJellyfinCollection,
    normalizePtvCollectionMember,
    orderPtvCollectionMembers
} from './collectionModel';

describe('portable Collection model', () => {
    it('normalizes Jellyfin collections while preserving raw identity and unknown fields', () => {
        const raw = {
            ChildCount: 2,
            Id: 'box-1',
            Name: 'The Saga',
            Type: 'BoxSet',
            UnknownFutureField: { additive: true }
        };
        const member = {
            Id: 'movie-1',
            Name: 'Chapter One',
            Type: 'Movie',
            UserData: { Played: true }
        };
        const collection = normalizeJellyfinCollection(raw, [member]);

        expect(collection).toMatchObject({
            key: 'jellyfin:box-1',
            memberCount: 1,
            relationshipReason: 'jellyfin-collection',
            sourceType: 'jellyfin',
            title: 'The Saga'
        });
        expect(collection?.raw).toBe(raw);
        expect(collection?.members[0]?.raw).toBe(member);
        expect(collection?.raw?.UnknownFutureField).toEqual({ additive: true });
    });

    it('rejects invalid collections and members', () => {
        expect(normalizeJellyfinCollection({ Id: 'missing-title', Type: 'BoxSet' })).toBeNull();
        expect(normalizeJellyfinCollection({ Id: 'movie', Name: 'Not a set', Type: 'Movie' })).toBeNull();
        expect(normalizePtvCollectionMember({ Name: 'Missing id' }, 'shared-tag')).toBeNull();
    });

    it('deduplicates members and provides stable supported ordering', () => {
        const first = normalizePtvCollectionMember({
            DateCreated: '2026-01-01',
            Id: 'a',
            Name: 'Zulu',
            PremiereDate: '2002-01-01',
            PtvTimelineOrder: 2,
            Type: 'Movie'
        }, 'configured-franchise', 0);
        const second = normalizePtvCollectionMember({
            DateCreated: '2026-02-01',
            Id: 'b',
            Name: 'Alpha',
            PremiereDate: '2001-01-01',
            PtvTimelineOrder: 1,
            Type: 'Movie'
        }, 'configured-franchise', 1);
        const members = dedupePtvCollectionMembers([first, second, first]);

        expect(members).toHaveLength(2);
        expect(orderPtvCollectionMembers(members, 'collection').map(item => item.key)).toEqual(['a', 'b']);
        expect(orderPtvCollectionMembers(members, 'release').map(item => item.key)).toEqual(['b', 'a']);
        expect(orderPtvCollectionMembers(members, 'timeline').map(item => item.key)).toEqual(['b', 'a']);
        expect(orderPtvCollectionMembers(members, 'title').map(item => item.key)).toEqual(['b', 'a']);
        expect(orderPtvCollectionMembers(members, 'recently-added').map(item => item.key)).toEqual(['b', 'a']);
    });
});
