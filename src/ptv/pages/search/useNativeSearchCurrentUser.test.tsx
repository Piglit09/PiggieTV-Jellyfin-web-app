import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
    currentServerId: 'server-a',
    currentUserId: 'user-a',
    getCurrentUser: vi.fn()
}));
const reactActEnvironment = globalThis as typeof globalThis & {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};

vi.mock('../../api', () => ({
    getPtvCurrentUser: authState.getCurrentUser,
    getPtvCurrentUserId: () => authState.currentUserId,
    getPtvServerId: () => authState.currentServerId
}));

import { useNativeSearchCurrentUser } from './useNativeSearchCurrentUser';

function Harness({
    serverId = 'server-a',
    userId = 'user-a'
}: Readonly<{
    serverId?: string;
    userId?: string;
}>) {
    const { status, user } = useNativeSearchCurrentUser(serverId, userId);

    return <div data-status={status} data-user-id={user?.Id || ''} />;
}

describe('useNativeSearchCurrentUser', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
        authState.currentServerId = 'server-a';
        authState.currentUserId = 'user-a';
        authState.getCurrentUser.mockReset();
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    });

    it('loads the current user without blocking the Search component', async () => {
        authState.getCurrentUser.mockResolvedValue({ Id: 'user-a' });

        await act(async () => root.render(<Harness />));

        expect(container.firstElementChild?.getAttribute('data-status')).toBe('ready');
        expect(container.firstElementChild?.getAttribute('data-user-id')).toBe('user-a');
        expect(authState.getCurrentUser.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
    });

    it('aborts retired authentication work and rejects its stale completion', async () => {
        let resolveFirst: ((value: { Id: string }) => void) | undefined;
        let resolveSecond: ((value: { Id: string }) => void) | undefined;

        authState.getCurrentUser
            .mockImplementationOnce(() => new Promise(resolve => {
                resolveFirst = resolve;
            }))
            .mockImplementationOnce(() => new Promise(resolve => {
                resolveSecond = resolve;
            }));

        await act(async () => root.render(<Harness />));
        const firstSignal = authState.getCurrentUser.mock.calls[0][1] as AbortSignal;

        authState.currentServerId = 'server-b';
        authState.currentUserId = 'user-b';
        await act(async () => root.render(<Harness serverId='server-b' userId='user-b' />));

        await act(async () => {
            resolveFirst?.({ Id: 'user-a' });
            resolveSecond?.({ Id: 'user-b' });
            await Promise.resolve();
        });

        expect(firstSignal.aborted).toBe(true);
        expect(container.firstElementChild?.getAttribute('data-status')).toBe('ready');
        expect(container.firstElementChild?.getAttribute('data-user-id')).toBe('user-b');
    });

    it('keeps Search usable when the optional user lookup fails', async () => {
        authState.getCurrentUser.mockRejectedValue(new Error('offline'));

        await act(async () => root.render(<Harness />));

        expect(container.firstElementChild?.getAttribute('data-status')).toBe('unavailable');
        expect(container.firstElementChild?.getAttribute('data-user-id')).toBe('');
    });
});
