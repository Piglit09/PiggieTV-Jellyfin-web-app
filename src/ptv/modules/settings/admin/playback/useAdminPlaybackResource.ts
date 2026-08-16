import type { Api } from '@jellyfin/sdk';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import { useCallback, useMemo, useRef, useState } from 'react';

import { getResolvedAdminServerId } from '../adminServerIdentity';
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
    section,
    source
}: Readonly<{
    api?: Api;
    apiClient?: ApiClient;
    load: LoadPlaybackSnapshot<TSettings, TSnapshot>;
    save: SavePlaybackSnapshot<TSettings, TSnapshot>;
    section: AdminPlaybackResourceSection;
    source: 'System/Configuration' | 'System/Configuration/encoding';
}>) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const queryKey = useMemo(
        () => getAdminPlaybackQueryKey(serverKey || 'unresolved-server', section, source),
        [ section, serverKey, source ]
    );
    const queryClient = useQueryClient();
    const query = useQuery({
        enabled: Boolean(api && serverKey),
        queryFn: ({ signal }) => load(api!, signal),
        queryKey,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 60_000
    });
    const savePromiseRef = useRef<Promise<TSnapshot> | null>(null);
    const [ saving, setSaving ] = useState(false);

    const save = useCallback((desired: TSettings, confirmed?: TSettings) => {
        if (savePromiseRef.current) return savePromiseRef.current;

        const promise = (async () => {
            if (!api || !serverKey) {
                throw new AdminPlaybackServiceError(
                    'load-unavailable',
                    'Playback settings could not be loaded.'
                );
            }
            setSaving(true);
            await queryClient.cancelQueries({ exact: true, queryKey });
            const cached = queryClient.getQueryData<TSnapshot>(queryKey);
            const baseline = confirmed || cached?.settings;
            if (!baseline) {
                throw new AdminPlaybackServiceError(
                    'load-unavailable',
                    'Playback settings could not be loaded.'
                );
            }
            const saved = await saveResource(api, desired, baseline);
            queryClient.setQueryData(queryKey, saved);
            return saved;
        })().finally(() => {
            savePromiseRef.current = null;
            setSaving(false);
        });

        savePromiseRef.current = promise;
        return promise;
    }, [ api, queryClient, queryKey, saveResource, serverKey ]);

    const refetch = useCallback(async () => {
        if (savePromiseRef.current) return savePromiseRef.current;
        const result = await query.refetch({ cancelRefetch: true });
        return result.isSuccess ? result.data : null;
    }, [ query.refetch ]);

    const reset = useCallback(() => (
        queryClient.getQueryData<TSnapshot>(queryKey)?.settings || null
    ), [ queryClient, queryKey ]);

    return {
        error: query.error instanceof Error ? query.error : null,
        fetching: query.isFetching,
        loading: query.isPending && !query.data,
        queryKey,
        refetch,
        reset,
        save,
        saving,
        settings: query.data?.settings || null,
        snapshot: query.data || null
    } as const;
}
