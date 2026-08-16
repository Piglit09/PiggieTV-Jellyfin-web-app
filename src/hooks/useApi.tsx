import type { Api } from '@jellyfin/sdk';
import type { UserDto } from '@jellyfin/sdk/lib/generated-client';
import type { ApiClient, Event } from 'jellyfin-apiclient';
import React, { type FC, type PropsWithChildren, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { ServerConnections } from 'lib/jellyfin-apiclient';
import { ptvSafeConsole } from 'ptv/core/safeConsole';
import events from 'utils/events';
import { toApi } from 'utils/jellyfin-apiclient/compat';

export interface JellyfinApiContext {
    __legacyApiClient__?: ApiClient
    api?: Api
    currentUserStatus?: 'error' | 'loading' | 'ready'
    retryCurrentUser?: () => Promise<void>
    user?: UserDto
}

export const ApiContext = createContext<JellyfinApiContext>({});
export const useApi = () => useContext(ApiContext);

export const ApiProvider: FC<PropsWithChildren<unknown>> = ({ children }) => {
    const [ legacyApiClient, setLegacyApiClient ] = useState<ApiClient>();
    const [ api, setApi ] = useState<Api>();
    const [ user, setUser ] = useState<UserDto>();
    const [ currentUserStatus, setCurrentUserStatus ] = useState<'error' | 'loading' | 'ready'>('loading');

    const updateApiUser = useCallback((_e: Event | undefined, newUser: UserDto) => {
        setUser(newUser);
        setCurrentUserStatus('ready');

        if (newUser.ServerId) {
            setLegacyApiClient(ServerConnections.getApiClient(newUser.ServerId));
        }
    }, []);

    const retryCurrentUser = useCallback(async () => {
        const currentApiClient = ServerConnections.currentApiClient();
        setUser(undefined);
        setCurrentUserStatus('loading');

        if (!currentApiClient) {
            setCurrentUserStatus('error');
            return;
        }

        try {
            updateApiUser(undefined, await currentApiClient.getCurrentUser());
        } catch (err) {
            ptvSafeConsole.info('[ApiProvider] Could not get current user', err);
            setCurrentUserStatus('error');
        }
    }, [updateApiUser]);

    const context = useMemo(() => ({
        __legacyApiClient__: legacyApiClient,
        api,
        currentUserStatus,
        retryCurrentUser,
        user
    }), [ api, currentUserStatus, legacyApiClient, retryCurrentUser, user ]);

    useEffect(() => {
        void retryCurrentUser();

        const resetApiUser = () => {
            setLegacyApiClient(undefined);
            setUser(undefined);
            setCurrentUserStatus('loading');
        };

        events.on(ServerConnections, 'localusersignedin', updateApiUser);
        events.on(ServerConnections, 'localusersignedout', resetApiUser);

        return () => {
            events.off(ServerConnections, 'localusersignedin', updateApiUser);
            events.off(ServerConnections, 'localusersignedout', resetApiUser);
        };
    }, [retryCurrentUser, updateApiUser]);

    useEffect(() => {
        setApi(legacyApiClient ? toApi(legacyApiClient) : undefined);
    }, [ legacyApiClient, setApi ]);

    return (
        <ApiContext.Provider value={context}>
            {children}
        </ApiContext.Provider>
    );
};
