import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

vi.mock('./client', () => ({
    cleanPtvQuery: (query: Record<string, unknown> | undefined) => {
        if (!query) return undefined;

        const entries = Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== '');

        return entries.length ? Object.fromEntries(entries) : undefined;
    },
    getPtvApiClient: vi.fn(),
    getPtvCurrentUserId: vi.fn(),
    requestPtvJson: vi.fn()
}));

import {
    buildPtvRecentlyAddedRequest,
    normalizeJellyfinItemListResponse
} from './items';

describe('Jellyfin Latest item response normalization', () => {
    it('retains every item from a raw Items/Latest array', () => {
        const items = Array.from({ length: 96 }, (_, index) => ({ Id: String(index), Name: `Movie ${index}` }));

        const result = normalizeJellyfinItemListResponse(items);

        expect(result.responseShape).toBe('array');
        expect(result.rawItemCount).toBe(96);
        expect(result.items).toHaveLength(96);
    });

    it('supports wrapped Jellyfin item responses without treating the wrapper as an item', () => {
        const result = normalizeJellyfinItemListResponse({
            Items: [{ Id: 'toy-story-5', Name: 'Toy Story 5' }],
            TotalRecordCount: 96
        });

        expect(result.responseShape).toBe('wrapped-items');
        expect(result.items).toEqual([{ Id: 'toy-story-5', Name: 'Toy Story 5' }]);
        expect(result.totalRecordCount).toBe(96);
    });

    it('returns an explicit invalid shape instead of inventing a candidate from an invalid response', () => {
        const result = normalizeJellyfinItemListResponse({ TotalRecordCount: 96 });

        expect(result.responseShape).toBe('invalid');
        expect(result.items).toEqual([]);
        expect(result.rawItemCount).toBe(0);
    });

    it('builds an unscoped, user-authorized Latest Movies request without ParentId', () => {
        const request = buildPtvRecentlyAddedRequest({
            IncludeItemTypes: 'Movie',
            Limit: 96,
            ParentId: undefined
        }, { userId: 'user-1' });

        expect(request.endpoint).toBe('Users/user-1/Items/Latest');
        expect(request.params).toEqual({ IncludeItemTypes: 'Movie', Limit: 96 });
        expect(request.params.ParentId).toBeUndefined();
    });
});
