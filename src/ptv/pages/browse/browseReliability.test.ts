import { describe, expect, it, vi } from 'vitest';

import { createPtvAbortController } from '../../core/abortController';
import {
    assertPtvBrowseLoadOwnerCurrent,
    createPtvBrowseCancellationError,
    getMissingPtvBrowseRetryTaskId,
    isPtvBrowseCancellation,
    recoverPtvBrowseRequestWithFallback
} from './browseReliability';

describe('browse reliability', () => {
    it.each([
        createPtvBrowseCancellationError(),
        Object.assign(new Error('request cancelled'), { name: 'CanceledError' }),
        { coreError: { kind: 'cancelled' } },
        new Error('request was superseded'),
        'transport cancelled'
    ])('recognizes cancellation without turning it into a shelf failure', error => {
        expect(isPtvBrowseCancellation(error)).toBe(true);
    });

    it('does not launch recommendation fallback after cancellation', async () => {
        const fallback = vi.fn().mockResolvedValue({ items: [] });

        await expect(recoverPtvBrowseRequestWithFallback(
            createPtvBrowseCancellationError(),
            fallback
        )).rejects.toMatchObject({ name: 'AbortError' });
        expect(fallback).not.toHaveBeenCalled();
    });

    it('still launches recommendation fallback for a real request failure', async () => {
        const fallbackResult = { items: [ { Id: 'fallback' } ] };
        const fallback = vi.fn().mockResolvedValue(fallbackResult);

        await expect(recoverPtvBrowseRequestWithFallback(
            new Error('server unavailable'),
            fallback
        )).resolves.toBe(fallbackResult);
        expect(fallback).toHaveBeenCalledTimes(1);
    });

    it('rejects stale, unmounted, and aborted directory-stage owners', () => {
        const activeController = createPtvAbortController();
        const activeOwner = {
            currentRouteGeneration: 7,
            expectedRouteGeneration: 7,
            isMounted: true,
            signal: activeController.signal
        };

        expect(() => assertPtvBrowseLoadOwnerCurrent(activeOwner)).not.toThrow();
        expect(() => assertPtvBrowseLoadOwnerCurrent({
            ...activeOwner,
            currentRouteGeneration: 8
        })).toThrowError(expect.objectContaining({ name: 'AbortError' }));
        expect(() => assertPtvBrowseLoadOwnerCurrent({
            ...activeOwner,
            isMounted: false
        })).toThrowError(expect.objectContaining({ name: 'AbortError' }));

        activeController.abort();
        expect(() => assertPtvBrowseLoadOwnerCurrent(activeOwner))
            .toThrowError(expect.objectContaining({ name: 'AbortError' }));
    });

    it('identifies a retry whose dynamic directory task disappeared', () => {
        expect(getMissingPtvBrowseRetryTaskId(
            'genre-drama-1',
            [ 'featured', 'continue', 'recommendations' ]
        )).toBe('genre-drama-1');
        expect(getMissingPtvBrowseRetryTaskId(
            'continue',
            [ 'featured', 'continue', 'recommendations' ]
        )).toBe('');
        expect(getMissingPtvBrowseRetryTaskId('', [ 'featured' ])).toBe('');
    });
});
