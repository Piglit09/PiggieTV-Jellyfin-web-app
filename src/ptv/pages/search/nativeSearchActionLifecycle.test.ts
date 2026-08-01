import { describe, expect, it } from 'vitest';

import { PtvSearchActionLifecycle } from './nativeSearchActionLifecycle';

const firstIdentity = {
    itemId: 'item-1',
    serverId: 'server-1',
    userId: 'user-1'
};

describe('PtvSearchActionLifecycle', () => {
    it('rejects an operation after the user, server, or item identity changes', () => {
        const lifecycle = new PtvSearchActionLifecycle();
        const operation = lifecycle.begin(firstIdentity);

        expect(lifecycle.isCurrent(operation, {
            ...firstIdentity,
            userId: 'user-2'
        })).toBe(false);
        expect(lifecycle.isCurrent(operation, {
            ...firstIdentity,
            serverId: 'server-2'
        })).toBe(false);
        expect(lifecycle.isCurrent(operation, {
            ...firstIdentity,
            itemId: 'item-2'
        })).toBe(false);
    });

    it('aborts retired and superseded hydration without completing stale work', () => {
        const lifecycle = new PtvSearchActionLifecycle();
        const firstOperation = lifecycle.begin(firstIdentity);
        const secondOperation = lifecycle.begin(firstIdentity);

        expect(firstOperation.controller.signal.aborted).toBe(true);
        expect(lifecycle.complete(firstOperation)).toBe(false);
        expect(lifecycle.isCurrent(secondOperation, firstIdentity)).toBe(true);

        lifecycle.retire();

        expect(secondOperation.controller.signal.aborted).toBe(true);
        expect(lifecycle.complete(secondOperation)).toBe(false);
    });

    it('allows only the current operation to release render state', () => {
        const lifecycle = new PtvSearchActionLifecycle();
        const operation = lifecycle.begin(firstIdentity);

        expect(lifecycle.complete(operation)).toBe(true);
        expect(lifecycle.isCurrent(operation, firstIdentity)).toBe(false);
        expect(lifecycle.complete(operation)).toBe(false);
    });
});
