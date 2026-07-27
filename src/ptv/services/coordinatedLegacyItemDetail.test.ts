import {
    beforeEach,
    describe,
    expect,
    it,
    vi
} from 'vitest';

const coordinatorState = vi.hoisted(() => ({
    inFlight: new Map<string, Promise<unknown>>()
}));

vi.mock('./requestCoordinator', () => ({
    coordinatePtvJsonRequest<T>(key: string, task: () => Promise<T>): Promise<T> {
        const existing = coordinatorState.inFlight.get(key) as Promise<T> | undefined;
        if (existing) return existing;

        const promise = task().finally(() => {
            if (coordinatorState.inFlight.get(key) === promise) {
                coordinatorState.inFlight.delete(key);
            }
        });
        coordinatorState.inFlight.set(key, promise);

        return promise;
    },
    getPtvRequestCoordinatorKey(method: string, identity: string, includeAuthorization: boolean) {
        return `${method} ${includeAuthorization ? 'auth' : 'anon'} ${identity}`;
    }
}));

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

    it('starts a new request after the shared request settles', async () => {
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

        expect(getItem).toHaveBeenCalledTimes(2);
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
});
