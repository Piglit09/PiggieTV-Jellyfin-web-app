import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

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

import {
    createNativeRowFetch,
    dedupeNativeHomeItems,
    getNativeHomeItemVersionKey
} from './hooks';
import { createPtvAbortController } from '../../core/abortController';
import { resolveNativeHomeDerivedRowSourceValue } from './rowSourceValue';

function createAbortableHomeTask(captureSignal: (signal: AbortSignal) => void) {
    return (signal: AbortSignal) => {
        captureSignal(signal);

        return new Promise<string>((_resolve, reject) => {
            signal.addEventListener('abort', () => {
                const error = new Error('aborted');
                error.name = 'AbortError';
                reject(error);
            }, { once: true });
        });
    };
}

afterEach(() => {
    vi.useRealTimers();
});

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

describe('native home route-owned requests', () => {
    it('aborts the transport and returns the bounded fallback at the hard deadline', async () => {
        vi.useFakeTimers();
        const onTimeout = vi.fn();
        let transportSignal: AbortSignal | undefined;
        const request = createNativeRowFetch('slow-home-row', createAbortableHomeTask(signal => {
            transportSignal = signal;
        }), 'fallback', {
            onTimeout,
            timeoutMs: 50
        });

        await vi.advanceTimersByTimeAsync(50);

        await expect(request).resolves.toBe('fallback');
        expect(transportSignal?.aborted).toBe(true);
        expect(onTimeout).toHaveBeenCalledWith('slow-home-row');
    });

    it('retires a pending row immediately when the route owner leaves', async () => {
        const routeController = createPtvAbortController();
        let transportSignal: AbortSignal | undefined;
        const request = createNativeRowFetch('leaving-home-row', signal => {
            transportSignal = signal;
            return new Promise<string>(() => undefined);
        }, 'retired', {
            signal: routeController.signal
        });

        routeController.abort();

        await expect(request).resolves.toBe('retired');
        expect(transportSignal?.aborted).toBe(true);
    });
});
