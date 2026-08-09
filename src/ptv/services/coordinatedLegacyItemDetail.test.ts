import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const coordinatorState = vi.hoisted(() => ({
    inFlight: new Map<string, {
        promise: Promise<unknown>;
        reuseSuccessfulForMs: number;
        settled: boolean;
    }>(),
    options: [] as Array<{ reuseSuccessfulForMs?: number }>
}));

vi.mock('../api/client', () => ({
    requestPtvJson: vi.fn()
}));

vi.mock('./requestCoordinator', () => ({
    coordinatePtvJsonRequest<T>(
        key: string,
        task: (signal: AbortSignal) => Promise<T>,
        options: { reuseSuccessfulForMs?: number; signal?: AbortSignal } = {}
    ): Promise<T> {
        coordinatorState.options.push(options);
        const existing = coordinatorState.inFlight.get(key);
        if (existing && (!existing.settled || existing.reuseSuccessfulForMs > 0)) {
            return existing.promise as Promise<T>;
        }

        const entry = {
            promise: undefined as unknown as Promise<T>,
            reuseSuccessfulForMs: Number(options.reuseSuccessfulForMs || 0),
            settled: false
        };
        const promise = task(options.signal as AbortSignal).then(value => {
            entry.settled = true;
            if (!entry.reuseSuccessfulForMs && coordinatorState.inFlight.get(key) === entry) {
                coordinatorState.inFlight.delete(key);
            }
            return value;
        }, error => {
            if (coordinatorState.inFlight.get(key) === entry) coordinatorState.inFlight.delete(key);
            throw error;
        });
        entry.promise = promise;
        coordinatorState.inFlight.set(key, entry);

        return promise;
    },
    getPtvRequestCoordinatorKey(method: string, identity: string, includeAuthorization: boolean) {
        return `${method} ${includeAuthorization ? 'auth' : 'anon'} ${identity}`;
    }
}));

import { requestPtvJson } from '../api/client';
import { createPtvAbortController } from '../core/abortController';
import { getCoordinatedLegacyItemDetail } from './coordinatedLegacyItemDetail';

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(complete => {
        resolve = complete;
    });

    return {
        promise,
        resolve
    };
}

describe('coordinated legacy item-detail reads', () => {
    beforeEach(() => {
        coordinatorState.inFlight.clear();
        coordinatorState.options.length = 0;
        vi.clearAllMocks();
    });

    it('shares an exact same-account request while it is in flight', async () => {
        const request = createDeferred<{ Id: string }>();
        const getItem = vi.fn(() => request.promise);
        const apiClient = {
            getCurrentUserId: () => 'user-a',
            getItem,
            serverId: () => 'server-a'
        };

        const first = getCoordinatedLegacyItemDetail(apiClient, 'item-a');
        const second = getCoordinatedLegacyItemDetail(apiClient, 'item-a');

        expect(second).toBe(first);
        expect(getItem).toHaveBeenCalledTimes(1);

        request.resolve({ Id: 'item-a' });

        await expect(first).resolves.toEqual({ Id: 'item-a' });
        await expect(second).resolves.toEqual({ Id: 'item-a' });
    });

    it('reuses a settled item detail through the existing coordinator validity window', async () => {
        const getItem = vi.fn(async (_userId: string, itemId: string) => ({
            Id: itemId
        }));
        const apiClient = {
            getCurrentUserId: () => 'user-b',
            getItem,
            serverId: () => 'server-a'
        };

        await getCoordinatedLegacyItemDetail(apiClient, 'item-b');
        await getCoordinatedLegacyItemDetail(apiClient, 'item-b');

        expect(getItem).toHaveBeenCalledTimes(1);
        expect(coordinatorState.options).toEqual([
            expect.objectContaining({ reuseSuccessfulForMs: 3000 }),
            expect.objectContaining({ reuseSuccessfulForMs: 3000 })
        ]);
    });

    it('isolates requests by item and account scope', async () => {
        const request = createDeferred<{ Id: string }>();
        const getItem = vi.fn(() => request.promise);
        const firstClient = {
            getCurrentUserId: () => 'user-c',
            getItem,
            serverId: () => 'server-a'
        };
        const secondClient = {
            getCurrentUserId: () => 'user-d',
            getItem,
            serverId: () => 'server-a'
        };

        const firstItem = getCoordinatedLegacyItemDetail(firstClient, 'item-c');
        const secondItem = getCoordinatedLegacyItemDetail(firstClient, 'item-d');
        const secondAccount = getCoordinatedLegacyItemDetail(secondClient, 'item-c');

        expect(getItem).toHaveBeenCalledTimes(3);

        request.resolve({ Id: 'complete' });
        await Promise.all([ firstItem, secondItem, secondAccount ]);
    });

    it('uses the abortable API transport when a route owns the request', async () => {
        const controller = createPtvAbortController();
        const getItem = vi.fn();
        const apiClient = {
            getCurrentUserId: () => 'user-e',
            getItem,
            serverId: () => 'server-a'
        };

        vi.mocked(requestPtvJson).mockResolvedValue({ Id: 'item-e' });

        await expect(getCoordinatedLegacyItemDetail(apiClient, 'item-e', {
            signal: controller.signal
        })).resolves.toEqual({ Id: 'item-e' });
        expect(requestPtvJson).toHaveBeenCalledWith('Users/user-e/Items/item-e', {
            serverId: 'server-a',
            signal: controller.signal
        });
        expect(getItem).not.toHaveBeenCalled();
    });
});
