import type { Api } from '@jellyfin/sdk';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { getResolvedAdminServerId } from '../adminServerIdentity';
import {
    ADMIN_CONFIGURATION_SAVE_TIMEOUT_MESSAGE,
    ADMIN_CONFIGURATION_SAVE_TIMEOUT_MS,
    getAdminConfigurationSaveResourceKey,
    throwIfAdminConfigurationSaveRetired,
    useAdminConfigurationSave
} from '../configuration/useAdminConfigurationSave';
import { AdminPlaybackServiceError } from './adminPlaybackSettingsModel';

export type AdminPlaybackResourceSection =
    | 'resume'
    | 'streaming'
    | 'transcoding'
    | 'trickplay';

type PlaybackSnapshot<TSettings extends object> = Readonly<{
    settings: TSettings;
}>;

type LoadPlaybackSnapshot<TSettings extends object, TSnapshot extends PlaybackSnapshot<TSettings>> = (
    api: Api,
    signal?: AbortSignal
) => Promise<TSnapshot>;

type SavePlaybackSnapshot<TSettings extends object, TSnapshot extends PlaybackSnapshot<TSettings>> = (
    api: Api,
    desired: TSettings,
    confirmed: TSettings,
    signal?: AbortSignal
) => Promise<TSnapshot>;

const ADMIN_PLAYBACK_QUERY_SCOPE = 'PtvAdminPlayback';
export const ADMIN_PLAYBACK_SAVE_TIMEOUT_MS = ADMIN_CONFIGURATION_SAVE_TIMEOUT_MS;

const createAdminPlaybackSaveTimeoutError = (message: string) => (
    new AdminPlaybackServiceError('save-timeout', message)
);

export function getAdminPlaybackQueryKey(
    serverKey: string,
    section: AdminPlaybackResourceSection,
    source: 'System/Configuration' | 'System/Configuration/encoding'
) {
    return [ ADMIN_PLAYBACK_QUERY_SCOPE, serverKey, section, source ] as const;
}

/**
 * Coordinates one active Playback resource. Each route section owns a distinct,
 * server-scoped cache identity and a single-flight explicit-save workflow.
 */
export function useAdminPlaybackResource<
    TSettings extends object,
    TSnapshot extends PlaybackSnapshot<TSettings>
>({
    api,
    apiClient,
    load,
    save: saveResource,
    saveTimeoutMs = ADMIN_PLAYBACK_SAVE_TIMEOUT_MS,
    section,
    source
}: Readonly<{
    api?: Api;
    apiClient?: ApiClient;
    load: LoadPlaybackSnapshot<TSettings, TSnapshot>;
    save: SavePlaybackSnapshot<TSettings, TSnapshot>;
    saveTimeoutMs?: number;
    section: AdminPlaybackResourceSection;
    source: 'System/Configuration' | 'System/Configuration/encoding';
}>) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const queryKey = useMemo(
        () => getAdminPlaybackQueryKey(serverKey || 'unresolved-server', section, source),
        [ section, serverKey, source ]
    );
    const saveResourceKeys = useMemo(() => [
        getAdminConfigurationSaveResourceKey(
            serverKey || 'unresolved-server',
            source
        )
    ], [ serverKey, source ]);
    const queryClient = useQueryClient();
    const query = useQuery({
        enabled: Boolean(api && serverKey),
        queryFn: ({ signal }) => load(api!, signal),
        queryKey,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 60_000
    });
    const {
        getCurrent: getCurrentSave,
        run: runSave,
        runResourceOperation,
        saving
    } = useAdminConfigurationSave<TSnapshot>({
        createTimeoutError: createAdminPlaybackSaveTimeoutError,
        resourceKeys: saveResourceKeys,
        timeoutMessage: ADMIN_CONFIGURATION_SAVE_TIMEOUT_MESSAGE,
        timeoutMs: saveTimeoutMs
    });
    const [ readyQueryKey, setReadyQueryKey ] = useState<typeof queryKey | null>(null);
    const readyFromSettledQuery = Boolean(
        query.data && !query.isFetching && !query.error
    );
    const editableReady = Boolean(query.data)
        && (readyQueryKey === queryKey || readyFromSettledQuery);

    useEffect(() => {
        if (query.data && !query.isFetching && !query.error) {
            setReadyQueryKey(queryKey);
        }
    }, [ query.data, query.error, query.isFetching, queryKey ]);

    const save = useCallback((desired: TSettings, confirmed?: TSettings) => (
        runSave(async signal => {
            if (!api || !serverKey) {
                throw new AdminPlaybackServiceError(
                    'load-unavailable',
                    'Playback settings could not be loaded.'
                );
            }
            await queryClient.cancelQueries({ exact: true, queryKey });
            throwIfAdminConfigurationSaveRetired(signal);
            const cached = queryClient.getQueryData<TSnapshot>(queryKey);
            const baseline = confirmed || cached?.settings;
            if (!baseline) {
                throw new AdminPlaybackServiceError(
                    'load-unavailable',
                    'Playback settings could not be loaded.'
                );
            }
            const saved = await runResourceOperation(signal, writeSignal => (
                saveResource(api, desired, baseline, writeSignal)
            ));
            throwIfAdminConfigurationSaveRetired(signal);
            queryClient.setQueryData(queryKey, saved);
            return saved;
        })
    ), [
        api,
        queryClient,
        queryKey,
        runResourceOperation,
        runSave,
        saveResource,
        serverKey
    ]);

    const refetch = useCallback(async () => {
        const currentSave = getCurrentSave();
        if (currentSave) return currentSave;
        const result = await query.refetch({ cancelRefetch: true });
        return result.isSuccess ? result.data : null;
    }, [ getCurrentSave, query.refetch ]);

    const reset = useCallback(() => (
        queryClient.getQueryData<TSnapshot>(queryKey)?.settings || null
    ), [ queryClient, queryKey ]);

    return {
        error: query.error instanceof Error ? query.error : null,
        fetching: query.isFetching,
        loading: Boolean(api && serverKey) && !editableReady
            && (query.isPending || query.isFetching),
        queryKey,
        refetch,
        reset,
        save,
        saving,
        settings: editableReady ? query.data?.settings || null : null,
        snapshot: editableReady ? query.data || null : null
    } as const;
}
