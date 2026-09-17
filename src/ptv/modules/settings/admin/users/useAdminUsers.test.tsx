import type { Api } from '@jellyfin/sdk';
import type { UserDto } from '@jellyfin/sdk/lib/generated-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
    getPtvAccountAdminUsers: vi.fn(),
    getPtvUserImageUrl: vi.fn(),
    loadAdminUser: vi.fn(),
    loadAdminUserLibraries: vi.fn(),
    loadAdminUsers: vi.fn(),
    loadAdminUserSessions: vi.fn()
}));

vi.mock('../../../account/AccountApi', () => ({
    getPtvAccountAdminUsers: hookMocks.getPtvAccountAdminUsers
}));

vi.mock('../../../../api/images', () => ({
    getPtvUserImageUrl: hookMocks.getPtvUserImageUrl
}));

vi.mock('./adminUsersService', () => ({
    loadAdminUser: hookMocks.loadAdminUser,
    loadAdminUserLibraries: hookMocks.loadAdminUserLibraries,
    loadAdminUsers: hookMocks.loadAdminUsers,
    loadAdminUserSessions: hookMocks.loadAdminUserSessions
}));

import {
    getAdminUsersQueryKeys,
    useAdminUser,
    useAdminUsers
} from './useAdminUsers';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

const api = {} as Api;
const apiClient = { serverId: () => 'server-a' } as unknown as ApiClient;

function user(index: number): UserDto {
    /* eslint-disable sonarjs/no-hardcoded-passwords */
    return {
        Id: `user-${index}`,
        Name: `Member ${index}`,
        Policy: {
            AuthenticationProviderId: 'default-auth',
            EnableAllFolders: true,
            IsAdministrator: index === 0,
            IsDisabled: false,
            PasswordResetProviderId: 'default-reset'
        },
        ServerId: 'server-a'
    };
    /* eslint-enable sonarjs/no-hardcoded-passwords */
}

type UsersHookState = ReturnType<typeof useAdminUsers>;
type UserHookState = ReturnType<typeof useAdminUser>;

function ListHarness({ client = apiClient, stateRef }: Readonly<{
    client?: ApiClient;
    stateRef: { current?: UsersHookState };
}>) {
    stateRef.current = useAdminUsers(api, client);
    return null;
}

function CombinedHarness({ stateRef }: Readonly<{
    stateRef: { current?: { detail: UserHookState; list: UsersHookState } };
}>) {
    const list = useAdminUsers(api, apiClient);
    const detail = useAdminUser(api, apiClient, 'user-0');
    stateRef.current = { detail, list };
    return null;
}

async function flushQueries() {
    await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
        await Promise.resolve();
    });
}

describe('administrator users hooks', () => {
    let container: HTMLDivElement;
    let queryClient: QueryClient;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        const users = Array.from({ length: 25 }, (_, index) => user(index));
        hookMocks.loadAdminUsers.mockResolvedValue(users);
        hookMocks.loadAdminUser.mockResolvedValue(users[0]);
        hookMocks.loadAdminUserSessions.mockResolvedValue([]);
        hookMocks.loadAdminUserLibraries.mockResolvedValue([
            { Id: 'movies', Name: 'Movies' },
            { Id: 'shows', Name: 'Shows' }
        ]);
        hookMocks.getPtvAccountAdminUsers.mockResolvedValue({
            users: users.map(item => ({
                emailStatus: 'missing',
                jellyfinUserId: item.Id,
                username: item.Name
            }))
        });
        hookMocks.getPtvUserImageUrl.mockImplementation((id: string) => `/users/${id}/avatar`);
        queryClient = new QueryClient({
            defaultOptions: {
                queries: { gcTime: Infinity, retry: false }
            }
        });
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        queryClient.clear();
        container.remove();
    });

    it('does not load administrator users before the server id resolves', async () => {
        const stateRef: { current?: UsersHookState } = {};
        const unresolved = { serverId: () => '' } as unknown as ApiClient;
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <ListHarness client={unresolved} stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(hookMocks.loadAdminUsers).not.toHaveBeenCalled();
        expect(hookMocks.getPtvAccountAdminUsers).not.toHaveBeenCalled();
        expect(hookMocks.loadAdminUserSessions).not.toHaveBeenCalled();
        await expect(stateRef.current?.refresh()).resolves.toBeNull();
    });

    it('loads a large list with exactly one core, profile, and session request', async () => {
        const stateRef: { current?: UsersHookState } = {};

        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <ListHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(stateRef.current?.users).toHaveLength(25);
        expect(hookMocks.loadAdminUsers).toHaveBeenCalledOnce();
        expect(hookMocks.getPtvAccountAdminUsers).toHaveBeenCalledOnce();
        expect(hookMocks.loadAdminUserSessions).toHaveBeenCalledOnce();
        expect(hookMocks.loadAdminUser).not.toHaveBeenCalled();
        expect(hookMocks.loadAdminUserLibraries).not.toHaveBeenCalled();
    });

    it('deduplicates shared profile and session sources when list and detail mount together', async () => {
        const stateRef: {
            current?: { detail: UserHookState; list: UsersHookState };
        } = {};

        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <CombinedHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(stateRef.current?.list.users).toHaveLength(25);
        expect(stateRef.current?.detail.detail?.username).toBe('Member 0');
        expect(hookMocks.loadAdminUsers).toHaveBeenCalledOnce();
        expect(hookMocks.loadAdminUser).toHaveBeenCalledOnce();
        expect(hookMocks.loadAdminUserLibraries).toHaveBeenCalledOnce();
        expect(hookMocks.getPtvAccountAdminUsers).toHaveBeenCalledOnce();
        expect(hookMocks.loadAdminUserSessions).toHaveBeenCalledOnce();
    });

    it('disables focus refetch for form authority and adopts only confirmed policy state', async () => {
        const stateRef: {
            current?: { detail: UserHookState; list: UsersHookState };
        } = {};
        const cancelQueries = vi.spyOn(queryClient, 'cancelQueries');
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <CombinedHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        const keys = getAdminUsersQueryKeys('server-a', 'user-0');
        const detailOptions = queryClient.getQueryCache().find({ exact: true, queryKey: keys.detail })
            ?.options as { refetchOnWindowFocus?: unknown };
        const libraryOptions = queryClient.getQueryCache().find({ exact: true, queryKey: keys.libraries })
            ?.options as { refetchOnWindowFocus?: unknown };
        expect(detailOptions.refetchOnWindowFocus).toBe(false);
        expect(libraryOptions.refetchOnWindowFocus).toBe(false);

        await act(async () => stateRef.current?.detail.cancelPolicyQueries());
        expect(cancelQueries).toHaveBeenCalledWith({ exact: true, queryKey: keys.detail });
        expect(cancelQueries).toHaveBeenCalledWith({ exact: true, queryKey: keys.libraries });

        const confirmedPolicy = {
            ...user(0).Policy!,
            EnableContentDownloading: false
        };
        act(() => stateRef.current?.detail.adoptPolicy(confirmedPolicy));
        expect(queryClient.getQueryData<UserDto>(keys.detail)?.Policy)
            .toEqual(confirmedPolicy);
    });

    it('scopes every query key to the server and includes request arguments', () => {
        const serverA = getAdminUsersQueryKeys('server-a', 'USER-A');
        const serverB = getAdminUsersQueryKeys('server-b', 'user-a');

        expect(serverA.core).toEqual([
            'PtvAdminUsers',
            'server-a',
            'core',
            { isDisabled: undefined, isHidden: undefined }
        ]);
        expect(serverA.sessions).toEqual([
            'PtvAdminPeople',
            'server-a',
            'sessions',
            { activeWithinSeconds: 960, deviceId: undefined }
        ]);
        expect(serverA.detail).toEqual([
            'PtvAdminUsers',
            'server-a',
            'detail',
            'usera'
        ]);
        expect(serverB.core).not.toEqual(serverA.core);
        expect(serverB.detail).not.toEqual(serverA.detail);
    });
});
