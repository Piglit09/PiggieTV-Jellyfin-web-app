import type { Api } from '@jellyfin/sdk';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';

import type { ApiClient } from 'jellyfin-apiclient';

import { getResolvedAdminServerId } from '../adminServerIdentity';
import {
    enrichAdminPluginPackages,
    groupPrimaryAdminInstalledPlugins,
    normalizeAdminPluginGuid,
    normalizeAdminInstalledPlugins,
    normalizeAdminPluginConfigurationPages,
    normalizeAdminPluginDetail,
    normalizeAdminPluginPackages,
    normalizeAdminPluginRepositories
} from './adminPluginsAdapters';
import {
    AdminPluginsServiceError,
    type AdminPluginActionState,
    type AdminPluginMutationSnapshot,
    type AdminPluginRepositoryActionState,
    type AdminPluginRepositoryInput,
    type AdminPluginsFeedback,
    type PtvAdminInstalledPlugin,
    type PtvAdminPluginPackage,
    type PtvAdminPluginRepository,
    type PtvAdminPluginVersion,
    type RawAdminPluginRepository
} from './adminPluginsModel';
import { getAdminPluginsQueryKeys } from './adminPluginsQueryKeys';
import {
    addAdminPluginRepository,
    disableAdminPlugin,
    editAdminPluginRepository,
    enableAdminPlugin,
    installAdminPlugin,
    loadAdminInstalledPluginSource,
    loadAdminPluginCatalogSource,
    loadAdminPluginConfigurationPageSource,
    loadAdminPluginRepositorySource,
    removeAdminPluginRepository,
    uninstallAdminPlugin,
    updateAdminPlugin
} from './adminPluginsService';

function retryAdminPluginQuery(failureCount: number, error: unknown) {
    return failureCount < 1
        && error instanceof AdminPluginsServiceError
        && (error.code === 'source-unavailable' || error.code === 'repository-unavailable');
}

function safeFeedback(error: unknown, fallback: string): AdminPluginsFeedback {
    return {
        message: error instanceof AdminPluginsServiceError ? error.message : fallback,
        tone: 'error'
    };
}

function useSingleFlightRefresh(refresh: () => Promise<unknown>) {
    const flightRef = useRef<Promise<unknown> | null>(null);
    return useCallback(() => {
        if (flightRef.current) return flightRef.current;
        const flight = refresh().finally(() => {
            if (flightRef.current === flight) flightRef.current = null;
        });
        flightRef.current = flight;
        return flight;
    }, [ refresh ]);
}

type PluginSourceSelection = Readonly<{
    catalog: boolean;
    configurationPages: 'all' | 'main-menu' | false;
    installed: boolean;
}>;

function usePluginSources(
    api: Api | undefined,
    apiClient: ApiClient | undefined,
    selection: PluginSourceSelection
) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const keys = useMemo(
        () => getAdminPluginsQueryKeys(serverKey || 'unresolved-server'),
        [ serverKey ]
    );
    const installedQuery = useQuery({
        enabled: Boolean(api && serverKey && selection.installed),
        queryFn: ({ signal }) => loadAdminInstalledPluginSource(api!, signal),
        queryKey: keys.installed,
        refetchOnWindowFocus: false,
        retry: retryAdminPluginQuery,
        staleTime: 15_000
    });
    const catalogQuery = useQuery({
        enabled: Boolean(api && serverKey && selection.catalog),
        queryFn: ({ signal }) => loadAdminPluginCatalogSource(api!, signal),
        queryKey: keys.catalog,
        refetchOnWindowFocus: false,
        retry: retryAdminPluginQuery,
        staleTime: 15 * 60_000
    });
    const configurationPageParams = selection.configurationPages === 'main-menu' ?
        { enableInMainMenu: true } as const : {};
    const configurationPagesQuery = useQuery({
        enabled: Boolean(api && serverKey && selection.configurationPages),
        queryFn: ({ signal }) => loadAdminPluginConfigurationPageSource(
            api!,
            configurationPageParams,
            signal
        ),
        queryKey: selection.configurationPages === 'main-menu' ?
            keys.mainMenuConfigurationPages : keys.configurationPages,
        refetchOnWindowFocus: false,
        retry: retryAdminPluginQuery,
        staleTime: 60_000
    });

    const basePackages = useMemo(
        () => normalizeAdminPluginPackages(catalogQuery.data || []),
        [ catalogQuery.data ]
    );
    const configurationPages = useMemo(
        () => normalizeAdminPluginConfigurationPages(configurationPagesQuery.data || []),
        [ configurationPagesQuery.data ]
    );
    const installed = useMemo(() => normalizeAdminInstalledPlugins(
        installedQuery.data || [],
        basePackages,
        configurationPages,
        api ? (id, version) => api.getUri(`/Plugins/${id}/${version}/Image`) : undefined
    ), [ api, basePackages, configurationPages, installedQuery.data ]);
    const packages = useMemo(
        () => enrichAdminPluginPackages(basePackages, installed),
        [ basePackages, installed ]
    );
    const primaryInstalled = useMemo(
        () => groupPrimaryAdminInstalledPlugins(installed),
        [ installed ]
    );

    return {
        catalogQuery,
        configurationPages,
        configurationPagesQuery,
        installed,
        installedQuery,
        keys,
        packages,
        primaryInstalled,
        serverKey
    } as const;
}

function storeMutationSnapshot(
    queryClient: ReturnType<typeof useQueryClient>,
    serverKey: string,
    snapshot: AdminPluginMutationSnapshot
) {
    const keys = getAdminPluginsQueryKeys(serverKey);
    queryClient.setQueryData(keys.installed, snapshot.installed);
    const invalidateExact = (queryKey: readonly unknown[], refetchType: 'active' | 'none') => {
        void queryClient.invalidateQueries({ exact: true, queryKey, refetchType })
            .catch(() => undefined);
    };
    // Enrichment must never delay a server-confirmed lifecycle result.
    invalidateExact(keys.catalog, 'active');
    invalidateExact(keys.configurationPages, 'active');
    invalidateExact(keys.mainMenuConfigurationPages, 'active');
    void queryClient.invalidateQueries({ queryKey: [ 'Plugins' ], refetchType: 'none' })
        .catch(() => undefined);
    void queryClient.invalidateQueries({ queryKey: [ 'Packages' ], refetchType: 'none' })
        .catch(() => undefined);
}

function useAdminPluginActions(api?: Api, apiClient?: ApiClient) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const queryClient = useQueryClient();
    const flightsRef = useRef(new Map<string, Promise<boolean>>());
    const [ actionStateByPlugin, setActionStateByPlugin ] = useState<
        Record<string, AdminPluginActionState | undefined>
    >({});
    const [ feedback, setFeedback ] = useState<AdminPluginsFeedback | null>(null);

    const perform = useCallback((
        pluginId: string,
        actionState: AdminPluginActionState,
        action: () => Promise<AdminPluginMutationSnapshot>,
        successMessage: string,
        failureMessage: string
    ) => {
        const key = pluginId.trim().toLowerCase();
        if (!api || !serverKey || !key) {
            setFeedback({ message: failureMessage, tone: 'error' });
            return Promise.resolve(false);
        }
        const existing = flightsRef.current.get(key);
        if (existing) return existing;
        const flight = (async () => {
            setActionStateByPlugin(current => ({ ...current, [key]: actionState }));
            setFeedback(null);
            try {
                const snapshot = await action();
                storeMutationSnapshot(queryClient, serverKey, snapshot);
                setFeedback({ message: successMessage, tone: 'success' });
                return true;
            } catch (error) {
                setFeedback(safeFeedback(error, failureMessage));
                return false;
            } finally {
                setActionStateByPlugin(current => {
                    const next = { ...current };
                    delete next[key];
                    return next;
                });
                flightsRef.current.delete(key);
            }
        })();
        flightsRef.current.set(key, flight);
        return flight;
    }, [ api, queryClient, serverKey ]);

    const installPlugin = useCallback((
        packageInfo: PtvAdminPluginPackage,
        version: PtvAdminPluginVersion
    ) => perform(
        packageInfo.id,
        'installing',
        () => installAdminPlugin(api!, packageInfo, version),
        'Plugin installation was confirmed. PiggieTV refreshed the server-confirmed state.',
        "We couldn't install this plugin."
    ), [ api, perform ]);

    const updatePlugin = useCallback((
        packageInfo: PtvAdminPluginPackage,
        installed: PtvAdminInstalledPlugin,
        version: PtvAdminPluginVersion
    ) => perform(
        installed.id,
        'updating',
        () => updateAdminPlugin(api!, packageInfo, installed, version),
        'Plugin update was confirmed. PiggieTV refreshed the server-confirmed state.',
        "We couldn't update this plugin."
    ), [ api, perform ]);

    const uninstallPlugin = useCallback((installed: PtvAdminInstalledPlugin) => perform(
        installed.id,
        'uninstalling',
        () => uninstallAdminPlugin(api!, installed),
        'Plugin removal was confirmed. PiggieTV refreshed the server-confirmed state.',
        "We couldn't uninstall this plugin."
    ), [ api, perform ]);

    const enablePlugin = useCallback((installed: PtvAdminInstalledPlugin) => perform(
        installed.id,
        'enabling',
        () => enableAdminPlugin(api!, installed),
        'Plugin enablement is pending a server restart.',
        "We couldn't enable this plugin."
    ), [ api, perform ]);

    const disablePlugin = useCallback((installed: PtvAdminInstalledPlugin) => perform(
        installed.id,
        'disabling',
        () => disableAdminPlugin(api!, installed),
        'Plugin disablement is pending a server restart.',
        "We couldn't disable this plugin."
    ), [ api, perform ]);

    return {
        actionStateByPlugin,
        disablePlugin,
        enablePlugin,
        feedback,
        installPlugin,
        uninstallPlugin,
        updatePlugin
    } as const;
}

export function useAdminInstalledPlugins(api?: Api, apiClient?: ApiClient) {
    const sources = usePluginSources(api, apiClient, {
        catalog: false,
        configurationPages: 'main-menu',
        installed: true
    });
    const actions = useAdminPluginActions(api, apiClient);
    const refresh = useSingleFlightRefresh(useCallback(async () => {
        await Promise.allSettled([
            sources.installedQuery.refetch({ cancelRefetch: true }),
            sources.configurationPagesQuery.refetch({ cancelRefetch: true })
        ]);
    }, [ sources.configurationPagesQuery, sources.installedQuery ]));
    const hasInstalledData = sources.installedQuery.data !== undefined;
    return {
        ...actions,
        catalogError: sources.catalogQuery.isError,
        configurationPagesError: sources.configurationPagesQuery.isError,
        error: sources.installedQuery.isError && !hasInstalledData ? sources.installedQuery.error : null,
        initialLoading: sources.installedQuery.isPending && !hasInstalledData,
        plugins: sources.primaryInstalled,
        refresh,
        refreshError: sources.installedQuery.isError && hasInstalledData,
        refreshing: sources.installedQuery.isFetching && hasInstalledData
    } as const;
}

export function useAdminPluginCatalog(api?: Api, apiClient?: ApiClient) {
    const sources = usePluginSources(api, apiClient, {
        catalog: true,
        configurationPages: false,
        installed: true
    });
    const actions = useAdminPluginActions(api, apiClient);
    const refresh = useSingleFlightRefresh(useCallback(async () => {
        await Promise.allSettled([
            sources.catalogQuery.refetch({ cancelRefetch: true }),
            sources.installedQuery.refetch({ cancelRefetch: true })
        ]);
    }, [ sources.catalogQuery, sources.installedQuery ]));
    const hasCatalogData = sources.catalogQuery.data !== undefined;
    const hasInstalledData = sources.installedQuery.data !== undefined;
    return {
        ...actions,
        error: sources.catalogQuery.isError && !hasCatalogData ? sources.catalogQuery.error : null,
        initialLoading: sources.catalogQuery.isPending && !hasCatalogData,
        installedPlugins: sources.primaryInstalled,
        installedSourceAvailable: hasInstalledData,
        installedSourceError: sources.installedQuery.isError && !hasInstalledData,
        installedSourceLoading: sources.installedQuery.isPending && !hasInstalledData,
        packages: sources.packages,
        refresh,
        refreshError: sources.catalogQuery.isError && hasCatalogData,
        refreshing: sources.catalogQuery.isFetching && hasCatalogData
    } as const;
}

export function useAdminPluginDetail(
    api: Api | undefined,
    apiClient: ApiClient | undefined,
    pluginId: string
) {
    const normalizedPluginId = normalizeAdminPluginGuid(pluginId);
    const sources = usePluginSources(api, apiClient, {
        catalog: Boolean(normalizedPluginId),
        configurationPages: normalizedPluginId ? 'all' : false,
        installed: Boolean(normalizedPluginId)
    });
    const actions = useAdminPluginActions(api, apiClient);
    const detail = useMemo(() => normalizeAdminPluginDetail(
        pluginId,
        sources.installed,
        sources.packages,
        sources.configurationPages
    ), [ pluginId, sources.configurationPages, sources.installed, sources.packages ]);
    const refresh = useSingleFlightRefresh(useCallback(async () => {
        if (!normalizedPluginId) return;
        await Promise.allSettled([
            sources.installedQuery.refetch({ cancelRefetch: true }),
            sources.catalogQuery.refetch({ cancelRefetch: true }),
            sources.configurationPagesQuery.refetch({ cancelRefetch: true })
        ]);
    }, [ normalizedPluginId, sources.catalogQuery, sources.configurationPagesQuery, sources.installedQuery ]));
    const matchingInstalled = sources.installed.some(plugin => plugin.id === normalizedPluginId);
    const loading = Boolean(normalizedPluginId) && (
        (sources.installedQuery.isPending && !sources.installedQuery.data)
        || (!matchingInstalled && sources.catalogQuery.isPending && !sources.catalogQuery.data)
    );
    const queries = [ sources.installedQuery, sources.catalogQuery, sources.configurationPagesQuery ];
    const hasAnyData = queries.some(query => query.data !== undefined);
    const invalidIdError = normalizedPluginId ? null : new AdminPluginsServiceError(
        'invalid-input',
        'This plugin address is invalid.'
    );
    const installedSourceAvailable = sources.installedQuery.data !== undefined;
    const installedError = sources.installedQuery.isError && !installedSourceAvailable ?
        sources.installedQuery.error : null;
    const catalogSourceAvailable = sources.catalogQuery.data !== undefined;
    const catalogError = sources.catalogQuery.isError && !catalogSourceAvailable ?
        sources.catalogQuery.error : null;
    const error = invalidIdError || (detail ? null : installedError || catalogError);
    return {
        ...actions,
        actionState: actions.actionStateByPlugin[normalizedPluginId || ''],
        catalogError: sources.catalogQuery.isError,
        configurationPagesError: sources.configurationPagesQuery.isError,
        detail,
        error,
        installedSourceAvailable,
        installedSourceError: sources.installedQuery.isError,
        installedSourceLoading: sources.installedQuery.isPending && !installedSourceAvailable,
        loading,
        refresh,
        refreshError: !error && queries.some(query => query.isError),
        refreshing: hasAnyData && queries.some(query => query.isFetching)
    } as const;
}

export function useAdminPluginRepositories(api?: Api, apiClient?: ApiClient) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const queryClient = useQueryClient();
    const keys = useMemo(
        () => getAdminPluginsQueryKeys(serverKey || 'unresolved-server'),
        [ serverKey ]
    );
    const repositoryQuery = useQuery({
        enabled: Boolean(api && serverKey),
        queryFn: ({ signal }) => loadAdminPluginRepositorySource(api!, signal),
        queryKey: keys.repositories,
        refetchOnWindowFocus: false,
        retry: retryAdminPluginQuery,
        staleTime: 60_000
    });
    const repositories = useMemo(
        () => normalizeAdminPluginRepositories(repositoryQuery.data || []),
        [ repositoryQuery.data ]
    );
    const [ repositoryAction, setRepositoryAction ] = useState<AdminPluginRepositoryActionState | null>(null);
    const [ feedback, setFeedback ] = useState<AdminPluginsFeedback | null>(null);
    const flightsRef = useRef<Promise<boolean> | null>(null);
    const refresh = useSingleFlightRefresh(useCallback(
        () => repositoryQuery.refetch({ cancelRefetch: true }),
        [ repositoryQuery ]
    ));

    const perform = useCallback((
        action: AdminPluginRepositoryActionState,
        run: () => Promise<readonly RawAdminPluginRepository[]>
    ) => {
        if (!api || !serverKey) return Promise.resolve(false);
        if (flightsRef.current) return flightsRef.current;
        const flight = (async () => {
            setRepositoryAction(action);
            setFeedback(null);
            try {
                const confirmed = await run();
                queryClient.setQueryData(keys.repositories, confirmed);
                void queryClient.invalidateQueries({
                    exact: true,
                    queryKey: keys.catalog,
                    refetchType: 'active'
                }).catch(() => undefined);
                setFeedback({ message: 'Plugin repositories saved.', tone: 'success' });
                return true;
            } catch (error) {
                setFeedback(safeFeedback(error, "We couldn't save plugin repositories."));
                return false;
            } finally {
                setRepositoryAction(null);
                flightsRef.current = null;
            }
        })();
        flightsRef.current = flight;
        return flight;
    }, [ api, keys.catalog, keys.repositories, queryClient ]);

    const addRepository = useCallback((
        input: AdminPluginRepositoryInput,
        baseline: readonly PtvAdminPluginRepository[]
    ) => perform(
        { action: 'adding', repositoryId: null },
        () => addAdminPluginRepository(api!, input, baseline)
    ), [ api, perform ]);
    const editRepository = useCallback((
        target: PtvAdminPluginRepository,
        input: AdminPluginRepositoryInput,
        baseline: readonly PtvAdminPluginRepository[]
    ) => perform(
        { action: 'editing', repositoryId: target.id },
        () => editAdminPluginRepository(api!, target, input, baseline)
    ), [ api, perform ]);
    const removeRepository = useCallback((
        target: PtvAdminPluginRepository,
        baseline: readonly PtvAdminPluginRepository[]
    ) => perform(
        { action: 'removing', repositoryId: target.id },
        () => removeAdminPluginRepository(api!, target, baseline)
    ), [ api, perform ]);

    const hasData = repositoryQuery.data !== undefined;
    return {
        addRepository,
        editRepository,
        error: repositoryQuery.isError && !hasData ? repositoryQuery.error : null,
        feedback,
        initialLoading: repositoryQuery.isPending && !hasData,
        refresh,
        refreshError: repositoryQuery.isError && hasData,
        refreshing: repositoryQuery.isFetching && hasData,
        removeRepository,
        repositories,
        repositoryAction
    } as const;
}

export { getAdminPluginsQueryKeys } from './adminPluginsQueryKeys';
