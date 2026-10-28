import { describe, expect, it } from 'vitest';
import {
    canRetryPtvSearch,
    getRetryablePtvSearchGroupIds,
    mergePtvFailedGroupRetry,
    restorePtvSearchRetryScope,
    shouldRenderPtvSearchGroups
} from './searchGroupRetryState';
import type { PtvSearchGroupStatus } from './nativeSearchState';

describe('failed Search group retry state', () => {
    it('targets only the requested failed visible group', () => {
        const visible = [
            { id: 'movies' as const, status: 'success' as const },
            { id: 'shows' as const, status: 'error' as const },
            { id: 'episodes' as const, status: 'timeout' as const }
        ];

        expect(getRetryablePtvSearchGroupIds(visible, 'shows')).toEqual(['shows']);
        expect(getRetryablePtvSearchGroupIds(visible, 'movies')).toEqual([]);
        expect(getRetryablePtvSearchGroupIds(visible, 'studios')).toEqual([]);
        expect(getRetryablePtvSearchGroupIds(visible)).toEqual(['shows', 'episodes']);
    });

    it('keeps failed groups visible when the search has no successful items', () => {
        expect(shouldRenderPtvSearchGroups(true, {
            failedGroupCount: 2,
            isPending: false,
            isSettled: true,
            itemCount: 0
        })).toBe(true);
        expect(shouldRenderPtvSearchGroups(true, {
            failedGroupCount: 0,
            isPending: false,
            isSettled: true,
            itemCount: 0
        })).toBe(false);
    });

    it('allows a second retry after the first failed retry settles in the same scope', () => {
        const settledKey = { current: 'server:user:all:digimon' as string | null };
        const requestId = { current: 7 };
        const scope = { current: 'server:user:all:digimon' };

        expect(canRetryPtvSearch(settledKey.current, scope.current)).toBe(true);
        settledKey.current = null;
        expect(restorePtvSearchRetryScope(settledKey, requestId, scope, {
            key: 'server:user:all:digimon',
            requestId: 7,
            scope: 'server:user:all:digimon',
            signalAborted: false
        })).toBe(true);
        expect(canRetryPtvSearch(settledKey.current, scope.current)).toBe(true);
        settledKey.current = null;
        expect(restorePtvSearchRetryScope(settledKey, requestId, scope, {
            key: 'server:user:all:digimon',
            requestId: 7,
            scope: 'server:user:all:digimon',
            signalAborted: false
        })).toBe(true);
        expect(canRetryPtvSearch(settledKey.current, scope.current)).toBe(true);
    });

    it('does not restore retry eligibility after a newer query takes over', () => {
        const settledKey = { current: null as string | null };
        const requestId = { current: 8 };
        const scope = { current: 'server:user:all:batman' };

        expect(restorePtvSearchRetryScope(settledKey, requestId, scope, {
            key: 'server:user:all:digimon',
            requestId: 7,
            scope: 'server:user:all:digimon',
            signalAborted: false
        })).toBe(false);
        expect(canRetryPtvSearch(settledKey.current, scope.current)).toBe(false);
    });

    it('keeps successful groups while applying a recovered group', () => {
        const current: Record<'movies' | 'episodes', { items: string[]; status: PtvSearchGroupStatus }> = {
            movies: { items: ['movie-1'], status: 'success' },
            episodes: { items: [], status: 'loading' }
        };
        const result = mergePtvFailedGroupRetry(current, {
            groups: { episodes: ['episode-1'] },
            failedGroupStatuses: {}
        }, (_groupId, items, status) => ({ items, status }));

        expect(result.movies).toBe(current.movies);
        expect(result.episodes).toEqual({ items: ['episode-1'], status: 'success' });
    });

    it('keeps successful groups when the retried group times out', () => {
        const current: Record<'movies' | 'episodes', { items: string[]; status: PtvSearchGroupStatus }> = {
            movies: { items: ['movie-1'], status: 'success' },
            episodes: { items: [], status: 'loading' }
        };
        const result = mergePtvFailedGroupRetry(current, {
            groups: {},
            failedGroupStatuses: { episodes: 'timeout' }
        }, (_groupId, items, status) => ({ items, status }));

        expect(result.movies).toBe(current.movies);
        expect(result.episodes).toEqual({ items: [], status: 'timeout' });
    });
});
