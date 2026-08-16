import type { Api } from '@jellyfin/sdk';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import { useCallback, useMemo, useRef, useState } from 'react';

import { getResolvedAdminServerId } from '../adminServerIdentity';
import {
    createAdminServerGeneralSnapshot,
    normalizeAdminServerLocalizationOptions
} from './adminServerConfigurationAdapters';
import { getAdminServerConfigurationQueryKeys } from './adminServerConfigurationQueryKeys';
import {
    AdminServerConfigurationError,
    type AdminServerBrandingSettings,
    type AdminServerCertificatePasswordChange,
    type AdminServerGeneralSettings,
    type AdminServerGeneralSnapshot,
    type AdminServerNetworkingSaveResult,
    type AdminServerNetworkingSettings,
    type AdminServerNetworkingSnapshot,
    type AdminServerPowerAction
} from './adminServerConfigurationModel';
import {
    deleteAdminServerSplashscreen,
    loadAdminServerBranding,
    loadAdminServerGeneral,
    loadAdminServerLocalizationOptions,
    loadAdminServerNetworking,
    loadAdminServerSystemInfo,
    runAdminServerPowerAction,
    saveAdminServerBranding,
    saveAdminServerGeneral,
    saveAdminServerNetworking,
    uploadAdminServerSplashscreen
} from './adminServerConfigurationService';

function unavailable(message: string) {
    return new AdminServerConfigurationError('general-load-failed', message);
}

export function useAdminServerGeneral(api?: Api, apiClient?: ApiClient) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const keys = useMemo(
        () => getAdminServerConfigurationQueryKeys(serverKey || 'unresolved-server'),
        [ serverKey ]
    );
    const enabled = Boolean(api && serverKey);
    const queryClient = useQueryClient();
    const [ saving, setSaving ] = useState(false);
    const [ powerAction, setPowerAction ] = useState<AdminServerPowerAction | null>(null);
    const saveFlight = useRef<Promise<AdminServerGeneralSnapshot> | null>(null);
    const configurationQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminServerGeneral(api!, signal),
        queryKey: keys.general,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 60_000
    });
    const systemQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminServerSystemInfo(api!, signal),
        queryKey: keys.system,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 30_000
    });
    const localizationQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminServerLocalizationOptions(api!, signal),
        queryKey: keys.localization,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 5 * 60_000
    });
    const source = configurationQuery.data;
    const snapshot = useMemo(() => source ? createAdminServerGeneralSnapshot(
        {
            CachePath: source.settings.cachePath,
            LibraryScanFanoutConcurrency: source.settings.libraryScanFanoutConcurrency,
            MetadataPath: source.settings.metadataPath,
            ParallelImageEncodingLimit: source.settings.parallelImageEncodingLimit,
            QuickConnectAvailable: source.settings.quickConnectAvailable,
            ServerName: source.settings.serverName,
            UICulture: source.settings.uiCulture
        },
        systemQuery.data
    ) : null, [ source, systemQuery.data ]);
    const languages = useMemo(() => snapshot ? normalizeAdminServerLocalizationOptions(
        localizationQuery.data || [],
        snapshot.settings.uiCulture
    ) : [], [ localizationQuery.data, snapshot ]);

    const save = useCallback((desired: AdminServerGeneralSettings, confirmed: AdminServerGeneralSettings) => {
        if (saveFlight.current) return saveFlight.current;
        const promise = (async () => {
            if (!api || !serverKey) throw unavailable('General settings could not be loaded.');
            setSaving(true);
            await queryClient.cancelQueries({ exact: true, queryKey: keys.general });
            const saved = await saveAdminServerGeneral(
                api,
                desired,
                confirmed,
                systemQuery.data || null
            );
            queryClient.setQueryData(keys.general, {
                settings: saved.settings,
                system: null
            } satisfies AdminServerGeneralSnapshot);
            return saved;
        })().finally(() => {
            saveFlight.current = null;
            setSaving(false);
        });
        saveFlight.current = promise;
        return promise;
    }, [ api, keys.general, queryClient, serverKey, systemQuery.data ]);
    const runPowerAction = useCallback(async (action: AdminServerPowerAction) => {
        if (!api || powerAction) throw unavailable('Server controls are unavailable.');
        setPowerAction(action);
        try {
            await runAdminServerPowerAction(api, action);
        } finally {
            setPowerAction(null);
        }
    }, [ api, powerAction ]);

    return {
        error: configurationQuery.error instanceof Error ? configurationQuery.error : null,
        fetching: configurationQuery.isFetching || systemQuery.isFetching,
        languages,
        languagesError: localizationQuery.error instanceof Error ? localizationQuery.error : null,
        loading: configurationQuery.isPending && !configurationQuery.data,
        powerAction,
        refetch: async () => {
            const result = await configurationQuery.refetch({ cancelRefetch: true });
            await Promise.allSettled([
                systemQuery.refetch({ cancelRefetch: true }),
                localizationQuery.refetch({ cancelRefetch: true })
            ]);
            return result.isSuccess ? result.data : null;
        },
        refetchLanguages: () => localizationQuery.refetch({ cancelRefetch: true }),
        runPowerAction,
        save,
        saving,
        snapshot,
        systemError: systemQuery.error instanceof Error ? systemQuery.error : null
    } as const;
}

export function useAdminServerBranding(api?: Api, apiClient?: ApiClient) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const keys = useMemo(
        () => getAdminServerConfigurationQueryKeys(serverKey || 'unresolved-server'),
        [ serverKey ]
    );
    const enabled = Boolean(api && serverKey);
    const queryClient = useQueryClient();
    const [ busyAction, setBusyAction ] = useState<'delete' | 'save' | 'upload' | null>(null);
    const [ splashRevision, setSplashRevision ] = useState(() => Date.now());
    const actionFlight = useRef<Promise<unknown> | null>(null);
    const query = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminServerBranding(api!, signal),
        queryKey: keys.branding,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 60_000
    });
    const singleFlight = useCallback(function runSingleFlight<T>(action: 'delete' | 'save' | 'upload', task: () => Promise<T>) {
        if (actionFlight.current) return actionFlight.current as Promise<T>;
        setBusyAction(action);
        const promise = task().finally(() => {
            actionFlight.current = null;
            setBusyAction(null);
        });
        actionFlight.current = promise;
        return promise;
    }, []);
    const save = useCallback((desired: AdminServerBrandingSettings, confirmed: AdminServerBrandingSettings) => singleFlight(
        'save',
        async () => {
            if (!api || !serverKey) throw unavailable('Branding settings could not be loaded.');
            await queryClient.cancelQueries({ exact: true, queryKey: keys.branding });
            const saved = await saveAdminServerBranding(api, desired, confirmed);
            queryClient.setQueryData(keys.branding, saved);
            return saved;
        }
    ), [ api, keys.branding, queryClient, serverKey, singleFlight ]);
    const upload = useCallback((file: File) => singleFlight('upload', async () => {
        if (!api || !serverKey) throw unavailable('Branding settings could not be loaded.');
        await uploadAdminServerSplashscreen(api, file);
        setSplashRevision(Date.now());
    }), [ api, serverKey, singleFlight ]);
    const removeSplash = useCallback(() => singleFlight('delete', async () => {
        if (!api || !serverKey) throw unavailable('Branding settings could not be loaded.');
        await deleteAdminServerSplashscreen(api);
        setSplashRevision(Date.now());
    }), [ api, serverKey, singleFlight ]);

    return {
        busyAction,
        error: query.error instanceof Error ? query.error : null,
        fetching: query.isFetching,
        loading: query.isPending && !query.data,
        refetch: async () => {
            const result = await query.refetch({ cancelRefetch: true });
            return result.isSuccess ? result.data : null;
        },
        removeSplash,
        save,
        snapshot: query.data || null,
        splashRevision,
        upload
    } as const;
}

export function useAdminServerNetworking(api?: Api, apiClient?: ApiClient) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const keys = useMemo(
        () => getAdminServerConfigurationQueryKeys(serverKey || 'unresolved-server'),
        [ serverKey ]
    );
    const enabled = Boolean(api && serverKey);
    const queryClient = useQueryClient();
    const [ saving, setSaving ] = useState(false);
    const saveFlight = useRef<Promise<AdminServerNetworkingSaveResult> | null>(null);
    const query = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminServerNetworking(api!, signal),
        queryKey: keys.networking,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 60_000
    });
    const save = useCallback((
        desired: AdminServerNetworkingSettings,
        confirmed: AdminServerNetworkingSnapshot,
        passwordChange: AdminServerCertificatePasswordChange
    ) => {
        if (saveFlight.current) return saveFlight.current;
        const promise = (async () => {
            if (!api || !serverKey) throw unavailable('Networking settings could not be loaded.');
            setSaving(true);
            await queryClient.cancelQueries({ exact: true, queryKey: keys.networking });
            const saved = await saveAdminServerNetworking(api, desired, confirmed, passwordChange);
            queryClient.setQueryData(keys.networking, saved.snapshot);
            return saved;
        })().finally(() => {
            saveFlight.current = null;
            setSaving(false);
        });
        saveFlight.current = promise;
        return promise;
    }, [ api, keys.networking, queryClient, serverKey ]);

    return {
        error: query.error instanceof Error ? query.error : null,
        fetching: query.isFetching,
        loading: query.isPending && !query.data,
        refetch: async () => {
            const result = await query.refetch({ cancelRefetch: true });
            return result.isSuccess ? result.data : null;
        },
        save,
        saving,
        snapshot: query.data || null
    } as const;
}
