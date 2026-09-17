import type { Api } from '@jellyfin/sdk';
import type { SessionInfoDto, UserDto, UserPolicy } from '@jellyfin/sdk/lib/generated-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';

import type { ApiClient } from 'jellyfin-apiclient';
import {
    getPtvAccountAdminUsers,
    type PtvAccountAdminUserSummary
} from '../../../account/AccountApi';
import { getPtvUserImageUrl } from '../../../../api/images';
import { getResolvedAdminServerId } from '../adminServerIdentity';
import { getAdminPeopleQueryKeys } from '../people/adminPeopleQueryKeys';
import {
    getAdminUserIdentityKey,
    mergeAdminUsers,
    normalizeAdminUserDetail,
    normalizeAdminUserLibraryAccess
} from './adminUsersAdapters';
import {
    loadAdminUser,
    loadAdminUserLibraries,
    loadAdminUsers,
    loadAdminUserSessions
} from './adminUsersService';
import type { AdminUserSummary } from './adminUsersModel';

const ADMIN_USERS_QUERY_SCOPE = 'PtvAdminUsers';

export function getAdminUsersQueryKeys(serverKey: string | null, userId?: string) {
    const scope = [ ADMIN_USERS_QUERY_SCOPE, serverKey ] as const;
    return {
        core: [ ...scope, 'core', { isDisabled: undefined, isHidden: undefined } ] as const,
        detail: [ ...scope, 'detail', getAdminUserIdentityKey(userId) ] as const,
        libraries: [ ...scope, 'libraries' ] as const,
        profiles: [ ...scope, 'profiles' ] as const,
        sessions: getAdminPeopleQueryKeys(serverKey).sessions
    };
}

function selectProfile(
    rows: readonly PtvAccountAdminUserSummary[] | undefined,
    userId: string
) {
    const key = getAdminUserIdentityKey(userId);
    return rows?.find(row => getAdminUserIdentityKey(row.jellyfinUserId) === key);
}

export function useAdminUsers(api?: Api, apiClient?: ApiClient) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const enabled = Boolean(api && serverKey);
    const keys = getAdminUsersQueryKeys(serverKey);
    const coreQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminUsers(api!, signal),
        queryKey: keys.core,
        retry: 1,
        staleTime: 30_000
    });
    const profileQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => getPtvAccountAdminUsers({ signal }),
        queryKey: keys.profiles,
        retry: 1,
        staleTime: 60_000
    });
    const sessionsQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminUserSessions(api!, signal),
        queryKey: keys.sessions,
        refetchInterval: 30_000,
        refetchIntervalInBackground: false,
        retry: 1,
        staleTime: 15_000
    });
    const users = useMemo(() => mergeAdminUsers(
        coreQuery.data,
        profileQuery.data?.users,
        sessionsQuery.data,
        {
            profileSourceState: profileQuery.isError ? 'unavailable' : 'ready',
            sessionSourceState: sessionsQuery.isError ? 'unavailable' : 'ready',
            resolveAvatarUrl: user => getPtvUserImageUrl(user.Id || '', {
                serverId: serverKey || undefined,
                tag: user.PrimaryImageTag
            })
        }
    ), [
        coreQuery.data,
        profileQuery.data?.users,
        profileQuery.isError,
        serverKey,
        sessionsQuery.data,
        sessionsQuery.isError
    ]);
    const refreshPromiseRef = useRef<Promise<AdminUserSummary[] | null> | null>(null);
    const refetchCore = coreQuery.refetch;
    const refetchProfiles = profileQuery.refetch;
    const refetchSessions = sessionsQuery.refetch;
    const refresh = useCallback(() => {
        if (!api || !serverKey) return Promise.resolve(null);
        if (refreshPromiseRef.current) return refreshPromiseRef.current;
        const promise = Promise.allSettled([
            refetchCore({ cancelRefetch: true }),
            refetchProfiles({ cancelRefetch: true }),
            refetchSessions({ cancelRefetch: true })
        ]).then(results => {
            const coreResult = results[0];
            if (coreResult.status !== 'fulfilled'
                || coreResult.value.isError
                || !coreResult.value.isSuccess
                || !coreResult.value.data) return null;
            return mergeAdminUsers(
                coreResult.value.data,
                profileQuery.data?.users,
                sessionsQuery.data,
                {
                    profileSourceState: profileQuery.isError ? 'unavailable' : 'ready',
                    sessionSourceState: sessionsQuery.isError ? 'unavailable' : 'ready'
                }
            );
        }).finally(() => {
            refreshPromiseRef.current = null;
        });
        refreshPromiseRef.current = promise;
        return promise;
    }, [api, refetchCore, refetchProfiles, refetchSessions, serverKey]);

    return {
        coreError: coreQuery.isError,
        isInitialLoading: coreQuery.isPending && !coreQuery.data,
        isRefreshing: coreQuery.isFetching || profileQuery.isFetching || sessionsQuery.isFetching,
        profileError: profileQuery.isError,
        refresh,
        sessionsError: sessionsQuery.isError,
        users
    } as const;
}

export function useAdminUser(
    api: Api | undefined,
    apiClient: ApiClient | undefined,
    userId: string
) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const enabled = Boolean(api && serverKey && userId);
    const keys = getAdminUsersQueryKeys(serverKey, userId);
    const queryClient = useQueryClient();
    const coreQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminUser(api!, userId, signal),
        queryKey: keys.detail,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 20_000
    });
    const profileQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => getPtvAccountAdminUsers({ signal }),
        queryKey: keys.profiles,
        retry: 1,
        staleTime: 60_000
    });
    const sessionsQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminUserSessions(api!, signal),
        queryKey: keys.sessions,
        refetchInterval: 30_000,
        refetchIntervalInBackground: false,
        retry: 1,
        staleTime: 15_000
    });
    const librariesQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminUserLibraries(api!, signal),
        queryKey: keys.libraries,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 60_000
    });
    const detail = useMemo(() => coreQuery.data ? normalizeAdminUserDetail(
        coreQuery.data,
        selectProfile(profileQuery.data?.users, userId),
        sessionsQuery.data,
        {
            profileSourceState: profileQuery.isError ? 'unavailable' : 'ready',
            sessionSourceState: sessionsQuery.isError ? 'unavailable' : 'ready',
            resolveAvatarUrl: user => getPtvUserImageUrl(user.Id || '', {
                serverId: serverKey || undefined,
                tag: user.PrimaryImageTag
            })
        }
    ) : null, [
        coreQuery.data,
        profileQuery.data?.users,
        profileQuery.isError,
        serverKey,
        sessionsQuery.data,
        sessionsQuery.isError,
        userId
    ]);
    const libraryAccess = useMemo(() => normalizeAdminUserLibraryAccess(
        coreQuery.data,
        librariesQuery.isError ? null : librariesQuery.data
    ), [coreQuery.data, librariesQuery.data, librariesQuery.isError]);
    const cancelPolicyQueries = useCallback(async () => {
        if (!serverKey) return;
        await Promise.all([
            queryClient.cancelQueries({ exact: true, queryKey: keys.detail }),
            queryClient.cancelQueries({ exact: true, queryKey: keys.libraries })
        ]);
    }, [keys.detail, keys.libraries, queryClient, serverKey]);
    const adoptPolicy = useCallback((policy: UserPolicy) => {
        if (!serverKey) return;
        queryClient.setQueryData<UserDto>(keys.detail, current => current ? {
            ...current,
            Policy: policy
        } : current);
    }, [keys.detail, queryClient, serverKey]);
    const invalidate = useCallback(async () => {
        if (!serverKey) return;
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: keys.core }),
            queryClient.invalidateQueries({ queryKey: keys.detail })
        ]);
    }, [keys.core, keys.detail, queryClient, serverKey]);

    return {
        adoptPolicy,
        cancelPolicyQueries,
        coreUser: coreQuery.data as UserDto | undefined,
        detail,
        error: coreQuery.isError,
        invalidate,
        librariesError: librariesQuery.isError,
        libraryAccess,
        loading: coreQuery.isPending && !coreQuery.data,
        profileError: profileQuery.isError,
        refetch: coreQuery.refetch,
        refetchLibraries: librariesQuery.refetch,
        sessions: (sessionsQuery.data || []) as readonly SessionInfoDto[],
        sessionsError: sessionsQuery.isError
    } as const;
}
