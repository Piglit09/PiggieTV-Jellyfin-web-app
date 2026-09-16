import type { Api } from '@jellyfin/sdk';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import { useCallback, useMemo, useRef, useState } from 'react';

import { getResolvedAdminServerId } from '../adminServerIdentity';
import {
    getAdminConfigurationSaveResourceKey,
    throwIfAdminConfigurationSaveRetired,
    useAdminConfigurationSave
} from '../configuration/useAdminConfigurationSave';
import {
    getAdminTasksQueryKeys,
    getAdminTasksRefreshInterval
} from '../tasks/useAdminTasks';
import {
    loadAdminTasks,
    runAdminTask
} from '../tasks/adminTasksService';
import type { PtvAdminTask } from '../tasks/adminTasksModel';
import {
    AdminLiveTvServiceError,
    type AdminLiveTvConfigurationSnapshot,
    type AdminLiveTvDvrSettings,
    type AdminLiveTvGuideProvider,
    type AdminLiveTvSchedulesDirectAccountDraft,
    type AdminLiveTvSchedulesDirectListingDraft,
    type AdminLiveTvTuner,
    type AdminLiveTvTunerDraft,
    type AdminLiveTvXmlTvDraft
} from './adminLiveTvModel';
import {
    connectAdminSchedulesDirect,
    deleteAdminLiveTvProvider,
    deleteAdminLiveTvTuner,
    discoverAdminLiveTvTuners,
    loadAdminLiveTvCapability,
    loadAdminLiveTvConfiguration,
    loadAdminLiveTvTunerTypes,
    loadAdminSchedulesDirectCountries,
    loadAdminSchedulesDirectLineups,
    saveAdminLiveTvDvr,
    saveAdminLiveTvTuner,
    saveAdminSchedulesDirectListing,
    saveAdminXmlTvProvider
} from './adminLiveTvService';

const ADMIN_LIVE_TV_QUERY_SCOPE = 'PtvAdminLiveTv';

export type AdminLiveTvFeedback = Readonly<{
    message: string;
    tone: 'error' | 'info' | 'success';
}>;

export function getAdminLiveTvQueryKeys(serverKey: string) {
    const scope = [ ADMIN_LIVE_TV_QUERY_SCOPE, serverKey ] as const;
    return {
        capability: [ ...scope, 'capability', 'LiveTv/Info' ] as const,
        configuration: [ ...scope, 'configuration', 'System/Configuration/livetv' ] as const,
        countries: [ ...scope, 'explicit', 'schedules-direct-countries' ] as const,
        discovery: [ ...scope, 'explicit', 'tuner-discovery', { newDevicesOnly: true } ] as const,
        lineup: (providerId: string, country: string, postalCode: string) => [
            ...scope,
            'explicit',
            'lineups',
            providerId.trim().toLowerCase(),
            country.trim().toLowerCase(),
            postalCode.trim()
        ] as const,
        tunerTypes: [ ...scope, 'capability', 'LiveTv/TunerHosts/Types' ] as const
    };
}

function safeFeedback(error: unknown, fallback: string): AdminLiveTvFeedback {
    return {
        message: error instanceof AdminLiveTvServiceError ? error.message : fallback,
        tone: 'error'
    };
}

type SnapshotOperation = () => Promise<AdminLiveTvConfigurationSnapshot>;

export type UseAdminLiveTvOptions = Readonly<{
    dvrSaveTimeoutMs?: number;
}>;

function createAdminLiveTvSaveTimeoutError(message: string) {
    return new AdminLiveTvServiceError('save-timeout', message);
}

/** Coordinated native Live TV source ownership with explicit-only expensive lookups. */
export function useAdminLiveTv(
    api?: Api,
    apiClient?: ApiClient,
    options: UseAdminLiveTvOptions = {}
) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const unresolvedKey = serverKey || 'unresolved-server';
    const keys = useMemo(() => getAdminLiveTvQueryKeys(unresolvedKey), [ unresolvedKey ]);
    const taskKeys = useMemo(() => getAdminTasksQueryKeys(unresolvedKey), [ unresolvedKey ]);
    const dvrSaveResourceKeys = useMemo(() => [
        getAdminConfigurationSaveResourceKey(
            unresolvedKey,
            'System/Configuration/livetv'
        )
    ], [ unresolvedKey ]);
    const queryClient = useQueryClient();
    const enabled = Boolean(api && serverKey);
    const configurationQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminLiveTvConfiguration(api!, signal),
        queryKey: keys.configuration,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 30_000
    });
    const capabilityQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminLiveTvCapability(api!, signal),
        queryKey: keys.capability,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 120_000
    });
    const tunerTypesQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminLiveTvTunerTypes(api!, signal),
        queryKey: keys.tunerTypes,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 120_000
    });
    const tasksQuery = useQuery({
        enabled,
        queryFn: ({ signal }) => loadAdminTasks(api!, signal),
        queryKey: taskKeys.list,
        refetchInterval: query => getAdminTasksRefreshInterval(query.state.data),
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 4_000
    });
    const [ action, setAction ] = useState<string | null>(null);
    const [ feedback, setFeedback ] = useState<AdminLiveTvFeedback | null>(null);
    const actionFlights = useRef(new Map<string, Promise<unknown>>());
    const refreshFlight = useRef<Promise<unknown> | null>(null);
    const {
        run: runDvrSave,
        runResourceOperation: runDvrResourceOperation,
        saving: dvrSaving
    } = useAdminConfigurationSave<AdminLiveTvConfigurationSnapshot>({
        createTimeoutError: createAdminLiveTvSaveTimeoutError,
        resourceKeys: dvrSaveResourceKeys,
        timeoutMs: options.dvrSaveTimeoutMs
    });

    const commitSnapshot = useCallback((snapshot: AdminLiveTvConfigurationSnapshot) => {
        queryClient.setQueryData(keys.configuration, snapshot);
        return snapshot;
    }, [ keys.configuration, queryClient ]);

    const perform = useCallback(<T>(
        key: string,
        operation: () => Promise<T>,
        failure: string,
        success?: string
    ): Promise<T> => {
        const existing = actionFlights.current.get(key) as Promise<T> | undefined;
        if (existing) return existing;
        const flight = (async () => {
            setAction(key);
            setFeedback(null);
            try {
                const result = await operation();
                if (success) setFeedback({ message: success, tone: 'success' });
                return result;
            } catch (error) {
                setFeedback(safeFeedback(error, failure));
                throw error;
            } finally {
                actionFlights.current.delete(key);
                setAction(current => current === key ? null : current);
            }
        })();
        actionFlights.current.set(key, flight);
        return flight;
    }, []);

    const performSnapshot = useCallback((
        key: string,
        operation: SnapshotOperation,
        failure: string,
        success: string
    ) => perform(key, async () => {
        await queryClient.cancelQueries({ exact: true, queryKey: keys.configuration });
        return operation();
    }, failure, success).then(snapshot => {
        commitSnapshot(snapshot);
        void queryClient.invalidateQueries({ exact: true, queryKey: taskKeys.list });
        return snapshot;
    }), [ commitSnapshot, keys.configuration, perform, queryClient, taskKeys.list ]);

    const refresh = useCallback(() => {
        if (refreshFlight.current) return refreshFlight.current;
        const flight = Promise.allSettled([
            configurationQuery.refetch({ cancelRefetch: true }),
            capabilityQuery.refetch({ cancelRefetch: true }),
            tunerTypesQuery.refetch({ cancelRefetch: true }),
            tasksQuery.refetch({ cancelRefetch: true })
        ]).finally(() => {
            refreshFlight.current = null;
        });
        refreshFlight.current = flight;
        return flight;
    }, [ capabilityQuery.refetch, configurationQuery.refetch, tasksQuery.refetch, tunerTypesQuery.refetch ]);

    const refetchConfiguration = useCallback(async () => {
        const result = await configurationQuery.refetch({ cancelRefetch: true });
        if (result.error) throw result.error;
        return result.data || null;
    }, [ configurationQuery.refetch ]);

    const saveDvr = useCallback((desired: AdminLiveTvDvrSettings, confirmed: AdminLiveTvDvrSettings) => {
        setFeedback(null);
        return runDvrSave(async signal => {
            try {
                const currentApi = api;
                if (!currentApi) {
                    throw new AdminLiveTvServiceError('state-changed', 'DVR settings are unavailable.');
                }
                await queryClient.cancelQueries({ exact: true, queryKey: keys.configuration });
                throwIfAdminConfigurationSaveRetired(signal);
                const snapshot = await runDvrResourceOperation(
                    signal,
                    writeSignal => saveAdminLiveTvDvr(
                        currentApi,
                        desired,
                        confirmed,
                        writeSignal
                    )
                );
                throwIfAdminConfigurationSaveRetired(signal);
                commitSnapshot(snapshot);
                throwIfAdminConfigurationSaveRetired(signal);
                void queryClient.invalidateQueries({ exact: true, queryKey: taskKeys.list });
                setFeedback({ message: 'DVR settings saved.', tone: 'success' });
                return snapshot;
            } catch (error) {
                if (!signal.aborted) setFeedback(safeFeedback(error, "We couldn't save DVR settings."));
                throw error;
            }
        });
    }, [
        api,
        commitSnapshot,
        keys.configuration,
        queryClient,
        runDvrResourceOperation,
        runDvrSave,
        taskKeys.list
    ]);

    const saveTuner = useCallback((draft: AdminLiveTvTunerDraft, confirmed?: AdminLiveTvTuner) => (
        performSnapshot(
            `tuner:save:${draft.id || 'new'}`,
            () => saveAdminLiveTvTuner(api!, draft, confirmed),
            "We couldn't save this tuner.",
            'Tuner configuration saved.'
        )
    ), [ api, performSnapshot ]);

    const removeTuner = useCallback((id: string) => performSnapshot(
        `tuner:delete:${id}`,
        () => deleteAdminLiveTvTuner(api!, id),
        "We couldn't remove this tuner.",
        'Tuner removed.'
    ), [ api, performSnapshot ]);

    const saveXmlTv = useCallback((draft: AdminLiveTvXmlTvDraft, confirmed?: AdminLiveTvGuideProvider) => (
        performSnapshot(
            `provider:xmltv:${draft.id || 'new'}`,
            () => saveAdminXmlTvProvider(api!, draft, confirmed),
            "We couldn't save this XMLTV provider.",
            'XMLTV provider saved.'
        )
    ), [ api, performSnapshot ]);

    const connectSchedulesDirect = useCallback((
        draft: AdminLiveTvSchedulesDirectAccountDraft,
        confirmed?: AdminLiveTvGuideProvider
    ) => performSnapshot(
        `provider:sd-account:${draft.id || 'new'}`,
        () => connectAdminSchedulesDirect(api!, draft, confirmed),
        "We couldn't connect this Schedules Direct account.",
        'Schedules Direct account connected.'
    ), [ api, performSnapshot ]);

    const saveSchedulesDirectListing = useCallback((
        draft: AdminLiveTvSchedulesDirectListingDraft,
        confirmed: AdminLiveTvGuideProvider
    ) => performSnapshot(
        `provider:sd-listing:${draft.id}`,
        () => saveAdminSchedulesDirectListing(api!, draft, confirmed),
        "We couldn't save this Schedules Direct lineup.",
        'Schedules Direct lineup saved.'
    ), [ api, performSnapshot ]);

    const removeProvider = useCallback((id: string) => performSnapshot(
        `provider:delete:${id}`,
        () => deleteAdminLiveTvProvider(api!, id),
        "We couldn't remove this guide provider.",
        'Guide provider removed.'
    ), [ api, performSnapshot ]);

    const discoverTuners = useCallback(() => perform(
        'tuner:discover',
        () => queryClient.fetchQuery({
            queryFn: ({ signal }) => discoverAdminLiveTvTuners(api!, signal),
            queryKey: keys.discovery,
            staleTime: 0
        }),
        'Tuners could not be discovered.'
    ), [ api, keys.discovery, perform, queryClient ]);

    const loadCountries = useCallback(() => perform(
        'provider:countries',
        () => queryClient.fetchQuery({
            queryFn: ({ signal }) => loadAdminSchedulesDirectCountries(api!, signal),
            queryKey: keys.countries,
            staleTime: 24 * 60 * 60 * 1_000
        }),
        'Schedules Direct countries could not be loaded.'
    ), [ api, keys.countries, perform, queryClient ]);

    const loadLineups = useCallback((providerId: string, country: string, postalCode: string) => perform(
        'provider:lineups',
        () => queryClient.fetchQuery({
            queryFn: ({ signal }) => loadAdminSchedulesDirectLineups(api!, providerId, country, postalCode, signal),
            queryKey: keys.lineup(providerId, country, postalCode),
            staleTime: 0
        }),
        'Schedules Direct lineups could not be loaded.'
    ), [ api, keys, perform, queryClient ]);

    const refreshGuideTask = useMemo(() => tasksQuery.data?.find(task => task.key === 'RefreshGuide') || null, [ tasksQuery.data ]);
    const runGuideRefresh = useCallback(() => {
        const task = refreshGuideTask;
        if (!task) {
            const error = new AdminLiveTvServiceError('state-changed', 'The Refresh Guide task is unavailable.');
            setFeedback(safeFeedback(error, error.message));
            return Promise.reject(error);
        }
        return perform(
            'guide:refresh',
            () => runAdminTask(api!, task.id).then(async () => {
                await queryClient.invalidateQueries({ exact: true, queryKey: taskKeys.list });
            }),
            "We couldn't start the guide refresh.",
            'Guide refresh request accepted.'
        );
    }, [ api, perform, queryClient, refreshGuideTask, taskKeys.list ]);

    return {
        action: dvrSaving ? 'dvr:save' : action,
        capability: capabilityQuery.data || null,
        capabilityError: capabilityQuery.isError,
        configuration: configurationQuery.data || null,
        configurationError: configurationQuery.isError,
        connectSchedulesDirect,
        discoverTuners,
        feedback,
        initialLoading: configurationQuery.isPending && !configurationQuery.data,
        loadCountries,
        loadLineups,
        refresh,
        refetchConfiguration,
        refreshing: configurationQuery.isFetching || capabilityQuery.isFetching || tunerTypesQuery.isFetching || tasksQuery.isFetching,
        refreshGuideTask: refreshGuideTask as PtvAdminTask | null,
        removeProvider,
        removeTuner,
        runGuideRefresh,
        saveDvr,
        saveSchedulesDirectListing,
        saveTuner,
        saveXmlTv,
        taskError: tasksQuery.isError,
        tunerTypes: tunerTypesQuery.data || [],
        tunerTypesError: tunerTypesQuery.isError
    } as const;
}
