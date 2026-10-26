import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    serverId: 'server-a',
    userId: 'user-a',
    clientServerId: 'server-a',
    clientInfoId: 'server-a',
    clientUserId: 'user-a',
    getUser: vi.fn(),
    getViews: vi.fn()
}));

vi.mock('../api/usePtvAuthenticatedIdentity', () => ({
    usePtvAuthenticatedIdentity: () => ({
        identityKey: mocks.serverId && mocks.userId ? `${mocks.serverId}\u001f${mocks.userId}` : '',
        serverId: mocks.serverId,
        status: mocks.serverId && mocks.userId ? 'ready' : 'restoring',
        userId: mocks.userId
    })
}));
vi.mock('../api/client', () => ({
    getCurrentPtvApiClient: () => ({
        getCurrentUserId: () => mocks.clientUserId,
        serverId: () => mocks.clientServerId,
        serverInfo: () => ({ Id: mocks.clientInfoId })
    })
}));
vi.mock('../api/libraries', () => ({ getPtvUserViews: mocks.getViews }));
vi.mock('../api/auth', () => ({ getPtvCurrentUser: mocks.getUser }));

import { usePtvNavigationAccess } from './usePtvNavigationAccess';

const reactActEnvironment = globalThis as typeof globalThis & {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((accept, fail) => {
        resolve = accept;
        reject = fail;
    });

    return { promise, reject, resolve };
}

function Harness() {
    const { access, identityKey, status } = usePtvNavigationAccess();

    return <div
        data-status={status}
        data-identity={identityKey}
        data-movies={access?.movies.map(view => view.id).join(',') || ''}
        data-music={access?.music.map(view => view.id).join(',') || ''}
        data-admin={String(access?.isAdmin === true)}
    />;
}

describe('usePtvNavigationAccess', () => {
    let container: HTMLDivElement;
    let root: Root;
    let unmounted: boolean;

    const render = async () => {
        await act(async () => root.render(<Harness />));
    };
    const attribute = (name: string) => container.firstElementChild?.getAttribute(`data-${name}`);

    beforeEach(() => {
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
        mocks.serverId = 'server-a';
        mocks.userId = 'user-a';
        mocks.clientServerId = 'server-a';
        mocks.clientInfoId = 'server-a';
        mocks.clientUserId = 'user-a';
        mocks.getUser.mockReset();
        mocks.getViews.mockReset();
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        unmounted = false;
    });

    afterEach(() => {
        if (!unmounted) act(() => root.unmount());
        container.remove();
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    });

    it('fails closed during loading, then projects only authenticated user views', async () => {
        const views = deferred<{ Items: { Id: string; Name: string; CollectionType: string }[] }>();
        mocks.getViews.mockReturnValue(views.promise);
        mocks.getUser.mockResolvedValue({ Id: 'user-a', Policy: { IsAdministrator: false } });

        await render();
        expect(attribute('status')).toBe('loading');
        expect(attribute('movies')).toBe('');
        expect(attribute('identity')).toBe('server-a:user-a');
        expect(mocks.getViews).toHaveBeenCalledWith(expect.objectContaining({
            serverId: 'server-a', userId: 'user-a', signal: expect.any(AbortSignal)
        }));

        await act(async () => {
            views.resolve({ Items: [
                { Id: 'movies-a', Name: 'Movies A', CollectionType: 'movies' },
                { Id: 'music-a', Name: 'Music A', CollectionType: 'music' }
            ] });
            await Promise.resolve();
        });

        expect(attribute('status')).toBe('ready');
        expect(attribute('movies')).toBe('movies-a');
        expect(attribute('music')).toBe('music-a');
        expect(attribute('admin')).toBe('false');

        await render();
        expect(mocks.getViews).toHaveBeenCalledTimes(1);
    });

    it('never exposes navigation when identity is incomplete, mismatched, or lookups fail', async () => {
        mocks.clientInfoId = 'another-server';
        await render();
        expect(attribute('status')).toBe('unavailable');
        expect(mocks.getViews).not.toHaveBeenCalled();

        mocks.clientInfoId = 'server-a';
        mocks.getUser.mockResolvedValue({ Id: 'someone-else', Policy: { IsAdministrator: true } });
        mocks.getViews.mockResolvedValue({ Items: [{ Id: 'movies-a', CollectionType: 'movies' }] });
        await act(async () => window.dispatchEvent(new Event('focus')));
        expect(attribute('status')).toBe('unavailable');
        expect(attribute('movies')).toBe('');

        mocks.serverId = '';
        mocks.userId = '';
        await render();
        expect(attribute('status')).toBe('loading');
        expect(attribute('identity')).toBe('');
        expect(attribute('movies')).toBe('');
    });

    it('keeps media links unavailable when the authenticated views request fails', async () => {
        mocks.getUser.mockResolvedValue({ Id: 'user-a', Policy: { IsAdministrator: true } });
        mocks.getViews.mockRejectedValue(new Error('service unavailable'));

        await render();

        expect(attribute('status')).toBe('unavailable');
        expect(attribute('movies')).toBe('');
        expect(attribute('admin')).toBe('false');
    });

    it('aborts and discards an old account response when the server and user change', async () => {
        const oldViews = deferred<{ Items: { Id: string; CollectionType: string }[] }>();
        const newViews = deferred<{ Items: { Id: string; CollectionType: string }[] }>();
        mocks.getViews.mockReturnValueOnce(oldViews.promise).mockReturnValueOnce(newViews.promise);
        mocks.getUser.mockImplementation(() => Promise.resolve({
            Id: mocks.clientUserId,
            Policy: { IsAdministrator: false }
        }));

        await render();
        const oldSignal = mocks.getViews.mock.calls[0][0].signal as AbortSignal;

        mocks.serverId = 'server-b';
        mocks.userId = 'user-b';
        mocks.clientServerId = 'server-b';
        mocks.clientInfoId = 'server-b';
        mocks.clientUserId = 'user-b';
        await render();

        expect(oldSignal.aborted).toBe(true);
        expect(attribute('identity')).toBe('server-b:user-b');
        expect(attribute('status')).toBe('loading');
        expect(attribute('movies')).toBe('');

        await act(async () => {
            oldViews.resolve({ Items: [{ Id: 'secret-old', CollectionType: 'movies' }] });
            newViews.resolve({ Items: [{ Id: 'allowed-new', CollectionType: 'movies' }] });
            await Promise.resolve();
        });
        expect(attribute('status')).toBe('ready');
        expect(attribute('movies')).toBe('allowed-new');
    });

    it('keeps proven same-identity access stable during refresh and retires revoked views on readback', async () => {
        mocks.getUser.mockResolvedValue({ Id: 'user-a', Policy: { IsAdministrator: false } });
        mocks.getViews.mockResolvedValueOnce({ Items: [{ Id: 'old-movies', CollectionType: 'movies' }] });
        const refreshed = deferred<{ Items: { Id: string; CollectionType: string }[] }>();
        mocks.getViews.mockReturnValueOnce(refreshed.promise);
        await render();
        expect(attribute('movies')).toBe('old-movies');

        await act(async () => window.dispatchEvent(new Event('focus')));
        expect(attribute('status')).toBe('ready');
        expect(attribute('movies')).toBe('old-movies');

        await act(async () => {
            refreshed.resolve({ Items: [] });
            await Promise.resolve();
        });
        expect(attribute('status')).toBe('ready');
        expect(attribute('movies')).toBe('');
        expect(mocks.getViews).toHaveBeenCalledTimes(2);
    });

    it('retires proven access when a same-identity refresh fails', async () => {
        mocks.getUser.mockResolvedValue({ Id: 'user-a', Policy: { IsAdministrator: false } });
        mocks.getViews.mockResolvedValueOnce({ Items: [{ Id: 'old-movies', CollectionType: 'movies' }] });
        const refreshed = deferred<{ Items: { Id: string; CollectionType: string }[] }>();
        mocks.getViews.mockReturnValueOnce(refreshed.promise);
        await render();

        await act(async () => window.dispatchEvent(new Event('focus')));
        expect(attribute('status')).toBe('ready');
        expect(attribute('movies')).toBe('old-movies');

        await act(async () => {
            refreshed.reject(new Error('403 after policy update'));
            await Promise.resolve();
        });
        expect(attribute('status')).toBe('unavailable');
        expect(attribute('movies')).toBe('');
    });

    it('discards an aborted same-identity refresh and aborts pending work on unmount', async () => {
        mocks.getUser.mockResolvedValue({ Id: 'user-a', Policy: { IsAdministrator: false } });
        mocks.getViews.mockResolvedValueOnce({ Items: [{ Id: 'old-movies', CollectionType: 'movies' }] });
        const stale = deferred<{ Items: { Id: string; CollectionType: string }[] }>();
        const pending = deferred<{ Items: { Id: string; CollectionType: string }[] }>();
        mocks.getViews.mockReturnValueOnce(stale.promise).mockReturnValueOnce(pending.promise);
        await render();

        await act(async () => window.dispatchEvent(new Event('focus')));
        const staleSignal = mocks.getViews.mock.calls[1][0].signal as AbortSignal;
        await act(async () => window.dispatchEvent(new Event('focus')));
        const pendingSignal = mocks.getViews.mock.calls[2][0].signal as AbortSignal;

        expect(staleSignal.aborted).toBe(true);
        await act(async () => {
            stale.resolve({ Items: [{ Id: 'stale-movies', CollectionType: 'movies' }] });
            await Promise.resolve();
        });
        expect(attribute('status')).toBe('ready');
        expect(attribute('movies')).toBe('old-movies');

        act(() => root.unmount());
        unmounted = true;
        expect(pendingSignal.aborted).toBe(true);
        await act(async () => {
            pending.resolve({ Items: [{ Id: 'late-movies', CollectionType: 'movies' }] });
            await Promise.resolve();
            window.dispatchEvent(new Event('focus'));
        });
        expect(container.childElementCount).toBe(0);
        expect(mocks.getViews).toHaveBeenCalledTimes(3);
    });

    it('keeps a freshly verified shell stable across immediate route changes', async () => {
        mocks.getUser.mockResolvedValue({ Id: 'user-a', Policy: { IsAdministrator: false } });
        mocks.getViews.mockResolvedValue({ Items: [{ Id: 'movies-a', CollectionType: 'movies' }] });
        await render();
        expect(attribute('status')).toBe('ready');

        await act(async () => window.dispatchEvent(new HashChangeEvent('hashchange')));

        expect(attribute('status')).toBe('ready');
        expect(attribute('movies')).toBe('movies-a');
        expect(mocks.getViews).toHaveBeenCalledTimes(1);
    });
});
