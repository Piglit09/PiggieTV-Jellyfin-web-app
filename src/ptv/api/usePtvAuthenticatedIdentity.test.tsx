import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const identityState = vi.hoisted(() => ({
    context: {} as Record<string, unknown>,
    fallbackServerId: '',
    fallbackUserId: ''
}));
const reactActEnvironment = globalThis as typeof globalThis & {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};

vi.mock('../../hooks/useApi', () => ({
    useApi: () => identityState.context
}));
vi.mock('./client', () => ({
    getPtvCurrentUserId: () => identityState.fallbackUserId,
    getPtvServerId: () => identityState.fallbackServerId
}));

import { usePtvAuthenticatedIdentity } from './usePtvAuthenticatedIdentity';

function Harness() {
    const identity = usePtvAuthenticatedIdentity();

    return <div data-identity={identity.identityKey} data-status={identity.status} />;
}

describe('usePtvAuthenticatedIdentity', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
        identityState.context = {};
        identityState.fallbackServerId = '';
        identityState.fallbackUserId = '';
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    });

    it('changes from restoring to ready when the authoritative ApiProvider restores the client', async () => {
        await act(async () => root.render(<Harness />));
        expect(container.firstElementChild?.getAttribute('data-status')).toBe('restoring');

        identityState.context = {
            __legacyApiClient__: {
                getCurrentUserId: () => 'user-a',
                serverId: () => 'server-a'
            },
            user: { Id: 'user-a', ServerId: 'server-a' }
        };
        await act(async () => root.render(<Harness />));

        expect(container.firstElementChild?.getAttribute('data-status')).toBe('ready');
        expect(container.firstElementChild?.getAttribute('data-identity')).toBe('server-a\u001fuser-a');
    });

    it('retires the prior identity when ApiProvider changes users', async () => {
        identityState.context = {
            __legacyApiClient__: {
                getCurrentUserId: () => 'user-a',
                serverId: () => 'server-a'
            },
            user: { Id: 'user-a', ServerId: 'server-a' }
        };
        await act(async () => root.render(<Harness />));
        const firstIdentity = container.firstElementChild?.getAttribute('data-identity');

        identityState.context = {
            __legacyApiClient__: {
                getCurrentUserId: () => 'user-b',
                serverId: () => 'server-a'
            },
            user: { Id: 'user-b', ServerId: 'server-a' }
        };
        await act(async () => root.render(<Harness />));

        expect(container.firstElementChild?.getAttribute('data-identity')).not.toBe(firstIdentity);
        expect(container.firstElementChild?.getAttribute('data-identity')).toBe('server-a\u001fuser-b');
    });
});
