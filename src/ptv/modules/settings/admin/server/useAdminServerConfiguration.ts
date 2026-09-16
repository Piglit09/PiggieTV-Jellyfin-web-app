import type { Api } from '@jellyfin/sdk';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import { useCallback, useMemo, useRef, useState } from 'react';

import { getResolvedAdminServerId } from '../adminServerIdentity';
import {
    ADMIN_CONFIGURATION_SAVE_TIMEOUT_MESSAGE,
    ADMIN_CONFIGURATION_SAVE_TIMEOUT_MS,
    getAdminConfigurationSaveResourceKey,
    throwIfAdminConfigurationSaveRetired,
    useAdminConfigurationSave
} from '../configuration/useAdminConfigurationSave';
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

type AdminServerConfigurationHookOptions = Readonly<{
    saveTimeoutMs?: number;
}>;

const createAdminServerSaveTimeoutError = (message: string) => (
    new AdminServerConfigurationError('server-save-timeout', message)
);

export function useAdminServerGeneral(
    api?: Api,
    apiClient?: ApiClient,
    { saveTimeoutMs = ADMIN_CONFIGURATION_SAVE_TIMEOUT_MS }: AdminServerConfigurationHookOptions = {}
) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const keys = useMemo(
        () => getAdminServerConfigurationQueryKeys(serverKey || 'unresolved-server'),
        [ serverKey ]
    );
    const saveResourceKeys = useMemo(() => [
        getAdminConfigurationSaveResourceKey(
            serverKey || 'unresolved-server',
            'System/Configuration'
        )
    ], [ serverKey ]);
    const enabled = Boolean(api && serverKey);
    const queryClient = useQueryClient();
    const [ powerAction, setPowerAction ] = useState<AdminServerPowerAction | null>(null);
    const {
        getCurrent: getCurrentSave,
        run: runSave,
        runResourceOperation,
        saving
    } = useAdminConfigurationSave<AdminServerGeneralSnapshot>({
        createTimeoutError: createAdminServerSaveTimeoutError,
        resourceKeys: saveResourceKeys,
        timeoutMessage: ADMIN_CONFIGURATION_SAVE_TIMEOUT_MESSAGE,
        timeoutMs: saveTimeoutMs
    });
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

    const save = useCallback((desired: AdminServerGeneralSettings, confirmed: AdminServerGeneralSettings) => (
        runSave(async signal => {
            if (!api || !serverKey) throw unavailable('General settings could not be loaded.');
            await queryClient.cancelQueries({ exact: true, queryKey: keys.general });
            throwIfAdminConfigurationSaveRetired(signal);
            const saved = await runResourceOperation(
                signal,
                writeSignal => saveAdminServerGeneral(
                    api,
                    desired,
                    confirmed,
                    systemQuery.data || null,
                    writeSignal
                )
            );
            throwIfAdminConfigurationSaveRetired(signal);
            queryClient.setQueryData(keys.general, {
                settings: saved.settings,
                system: null
            } satisfies AdminServerGeneralSnapshot);
            return saved;
        })
    ), [
        api,
        keys.general,
        queryClient,
        runResourceOperation,
        runSave,
        serverKey,
        systemQuery.data
    ]);
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
            const currentSave = getCurrentSave();
            if (currentSave) return currentSave;
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

export function useAdminServerBranding(
    api?: Api,
    apiClient?: ApiClient,
    { saveTimeoutMs = ADMIN_CONFIGURATION_SAVE_TIMEOUT_MS }: AdminServerConfigurationHookOptions = {}
) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const keys = useMemo(
        () => getAdminServerConfigurationQueryKeys(serverKey || 'unresolved-server'),
        [ serverKey ]
    );
    const saveResourceKeys = useMemo(() => [
        getAdminConfigurationSaveResourceKey(
            serverKey || 'unresolved-server',
            'Branding/Configuration'
        )
    ], [ serverKey ]);
    const enabled = Boolean(api && serverKey);
    const queryClient = useQueryClient();
    const [ busyAction, setBusyAction ] = useState<'delete' | 'save' | 'upload' | null>(null);
    const [ splashRevision, setSplashRevision ] = useState(() => Date.now());
    const actionFlight = useRef<Promise<unknown> | null>(null);
    const {
        getCurrent: getCurrentSave,
        run: runSave,
        runResourceOperation,
        saving
    } = useAdminConfigurationSave<Awaited<ReturnType<typeof saveAdminServerBranding>>>({
        createTimeoutError: createAdminServerSaveTimeoutError,
        resourceKeys: saveResourceKeys,
        timeoutMessage: ADMIN_CONFIGURATION_SAVE_TIMEOUT_MESSAGE,
        timeoutMs: saveTimeoutMs
    });
    const query = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminServerBranding(api!, signal),
        queryKey: keys.branding,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 60_000
    });
    const singleFlight = useCallback(function runSingleFlight<T>(action: 'delete' | 'save' | 'upload', task: () => Promise<T>) {
        const currentSave = getCurrentSave();
        if (currentSave) return currentSave as Promise<T>;
        if (actionFlight.current) return actionFlight.current as Promise<T>;
        setBusyAction(action);
        const promise = task().finally(() => {
            actionFlight.current = null;
            setBusyAction(null);
        });
        actionFlight.current = promise;
        return promise;
    }, [ getCurrentSave ]);
    const save = useCallback((desired: AdminServerBrandingSettings, confirmed: AdminServerBrandingSettings) => {
        if (actionFlight.current) {
            return actionFlight.current as Promise<Awaited<ReturnType<typeof saveAdminServerBranding>>>;
        }
        return runSave(async signal => {
            if (!api || !serverKey) throw unavailable('Branding settings could not be loaded.');
            await queryClient.cancelQueries({ exact: true, queryKey: keys.branding });
            throwIfAdminConfigurationSaveRetired(signal);
            const saved = await runResourceOperation(
                signal,
                writeSignal => saveAdminServerBranding(
                    api,
                    desired,
                    confirmed,
                    writeSignal
                )
            );
            throwIfAdminConfigurationSaveRetired(signal);
            queryClient.setQueryData(keys.branding, saved);
            return saved;
        });
    }, [
        api,
        keys.branding,
        queryClient,
        runResourceOperation,
        runSave,
        serverKey
    ]);
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
        busyAction: saving ? 'save' : busyAction,
        error: query.error instanceof Error ? query.error : null,
        fetching: query.isFetching,
        loading: query.isPending && !query.data,
        refetch: async () => {
            const currentSave = getCurrentSave();
            if (currentSave) return currentSave;
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

export function useAdminServerNetworking(
    api?: Api,
    apiClient?: ApiClient,
    { saveTimeoutMs = ADMIN_CONFIGURATION_SAVE_TIMEOUT_MS }: AdminServerConfigurationHookOptions = {}
) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const keys = useMemo(
        () => getAdminServerConfigurationQueryKeys(serverKey || 'unresolved-server'),
        [ serverKey ]
    );
    const saveResourceKeys = useMemo(() => [
        getAdminConfigurationSaveResourceKey(
            serverKey || 'unresolved-server',
            'System/Configuration/network'
        )
    ], [ serverKey ]);
    const enabled = Boolean(api && serverKey);
    const queryClient = useQueryClient();
    const {
        getCurrent: getCurrentSave,
        run: runSave,
        runResourceOperation,
        saving
    } = useAdminConfigurationSave<AdminServerNetworkingSaveResult>({
        createTimeoutError: createAdminServerSaveTimeoutError,
        resourceKeys: saveResourceKeys,
        timeoutMessage: ADMIN_CONFIGURATION_SAVE_TIMEOUT_MESSAGE,
        timeoutMs: saveTimeoutMs
    });
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
    ) => (
        runSave(async signal => {
            if (!api || !serverKey) throw unavailable('Networking settings could not be loaded.');
            await queryClient.cancelQueries({ exact: true, queryKey: keys.networking });
            throwIfAdminConfigurationSaveRetired(signal);
            const saved = await runResourceOperation(
                signal,
                writeSignal => saveAdminServerNetworking(
                    api,
                    desired,
                    confirmed,
                    passwordChange,
                    writeSignal
                )
            );
            throwIfAdminConfigurationSaveRetired(signal);
            queryClient.setQueryData(keys.networking, saved.snapshot);
            return saved;
        })
    ), [
        api,
        keys.networking,
        queryClient,
        runResourceOperation,
        runSave,
        serverKey
    ]);

    return {
        error: query.error instanceof Error ? query.error : null,
        fetching: query.isFetching,
        loading: query.isPending && !query.data,
        refetch: async () => {
            const currentSave = getCurrentSave();
            if (currentSave) return (await currentSave).snapshot;
            const result = await query.refetch({ cancelRefetch: true });
            return result.isSuccess ? result.data : null;
        },
        save,
        saving,
        snapshot: query.data || null
    } as const;
}
