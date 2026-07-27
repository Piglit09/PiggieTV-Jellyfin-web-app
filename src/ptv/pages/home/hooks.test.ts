import { describe, expect, it, vi } from 'vitest';

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        currentApiClient: () => null,
        getApiClient: () => null
    }
}));

vi.mock('../../api', () => ({
    getCurrentPtvApiClient: () => null,
    getPtvCurrentUser: vi.fn(async () => null),
    getPtvItems: vi.fn(async () => ({ Items: [], TotalRecordCount: 0 })),
    getPtvRecentlyAdded: vi.fn(async () => []),
    getPtvResumeItems: vi.fn(async () => []),
    isPtvAdminUser: () => false
}));

import { dedupeNativeHomeItems, getNativeHomeItemVersionKey } from './hooks';
import { resolveNativeHomeDerivedRowSourceValue } from './rowSourceValue';

describe('resolveNativeHomeDerivedRowSourceValue', () => {
    it('keeps expanded genre titles paired with their derived source values', () => {
        const parentRuleSourceValue = 'Horror';

        ['Horror', 'Comedy', 'Action', 'Adventure'].forEach(title => {
            expect(resolveNativeHomeDerivedRowSourceValue({
                ruleSourceValue: parentRuleSourceValue,
                sourceType: 'genre',
                title
            })).toBe(title);
        });
    });

    it('prefers explicit section source values over parent rule values', () => {
        expect(resolveNativeHomeDerivedRowSourceValue({
            ruleSourceValue: 'Horror',
            sectionSourceValue: 'Supernatural',
            sourceType: 'genre',
            title: 'Comedy'
        })).toBe('Supernatural');
    });
});

describe('native home item dedupe', () => {
    it('uses a stable composite version key for equivalent movies', () => {
        const firstMovie = {
            Type: 'Movie',
            Name: 'Sample Movie',
            ProductionYear: 2024,
            ProviderIds: {
                Tmdb: 'tmdb-movie-sample'
            },
            Id: 'b045b246f007f0433fe4fea474b57960'
        };
        const secondMovie = {
            Type: 'Movie',
            Name: 'Sample Movie',
            ProductionYear: 2024,
            ProviderIds: {
                Tmdb: 'tmdb-movie-sample'
            },
            Id: 'dd9c3ffb8df43402d88a627695ec5725'
        };

        expect(getNativeHomeItemVersionKey(firstMovie)).toBe(getNativeHomeItemVersionKey(secondMovie));
        expect(dedupeNativeHomeItems([firstMovie, secondMovie])).toHaveLength(1);
    });

    it('keeps distinct movies with different names', () => {
        const firstMovie = {
            Type: 'Movie',
            Name: 'Sample Movie',
            ProductionYear: 2024,
            Id: '11111111111111111111111111111111'
        };
        const secondMovie = {
            Type: 'Movie',
            Name: 'Another Movie',
            ProductionYear: 2024,
            Id: '22222222222222222222222222222222'
        };

        expect(dedupeNativeHomeItems([firstMovie, secondMovie])).toHaveLength(2);
    });
});
