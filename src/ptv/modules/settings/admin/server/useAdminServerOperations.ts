import type { Api } from '@jellyfin/sdk';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import { useCallback, useMemo, useRef, useState } from 'react';

import { getResolvedAdminServerId } from '../adminServerIdentity';
import { getAdminServerOperationsQueryKeys } from './adminServerOperationsQueryKeys';
import {
    AdminServerOperationsError,
    type PtvAdminAccountBackupOperation,
    type PtvAdminApiKey,
    type PtvAdminBackup,
    type PtvAdminBackupCreateOptions,
    type PtvAdminServerLogDownload
} from './adminServerOperationsModel';
import {
    createAdminApiKey,
    createAdminBackup,
    createLatestPtvAccountBackup,
    downloadAdminServerLog,
    loadAdminApiKeys,
    loadAdminBackupManifest,
    loadAdminBackups,
    loadAdminServerLog,
    loadAdminServerLogs,
    loadPtvLatestAccountBackup,
    restoreAdminBackup,
    restoreLatestPtvAccountBackup,
    revokeAdminApiKey,
    verifyLatestPtvAccountBackup
} from './adminServerOperationsService';

function requireApi(api?: Api): asserts api is Api {
    if (!api) throw new Error('Server administration is unavailable.');
}

function removeApiKeyRow(rowId: string) {
    return (current?: PtvAdminApiKey[]) => current?.filter(item => item.id !== rowId) || [];
}

function prependBackupRow(created: PtvAdminBackup) {
    return (current?: PtvAdminBackup[]) => [
        created,
        ...(current?.filter(item => item.id !== created.id) || [])
    ];
}

async function runConfirmedAccountRestore() {
    const preflight = await restoreLatestPtvAccountBackup(true, false);
    if (!preflight.ok || !preflight.verified || !preflight.dryRun) {
        throw new AdminServerOperationsError(
            'operation-failed',
            'The PiggieTV account restore dry run did not verify successfully.'
        );
    }
    return restoreLatestPtvAccountBackup(false, true);
}

function useSingleOperation() {
    const flight = useRef<Promise<unknown> | null>(null);
    const [ operation, setOperation ] = useState<string | null>(null);
    const run = useCallback(function runOperation<T>(name: string, task: () => Promise<T>) {
        if (flight.current) {
            return Promise.reject(new Error('Another server operation is already in progress.'));
        }
        setOperation(name);
        const promise = task().finally(() => {
            flight.current = null;
            setOperation(null);
        });
        flight.current = promise;
        return promise;
    }, []);
    return useMemo(() => ({ operation, run } as const), [ operation, run ]);
}

export function useAdminServerApiKeys(api?: Api, apiClient?: ApiClient) {
    const key = getResolvedAdminServerId(apiClient);
    const keys = useMemo(() => getAdminServerOperationsQueryKeys(key || 'unresolved-server'), [ key ]);
    const queryClient = useQueryClient();
    const mutation = useSingleOperation();
    const query = useQuery({
        enabled: Boolean(api && key),
        queryFn: ({ signal }) => loadAdminApiKeys(api!, signal),
        queryKey: keys.apiKeys,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 60_000
    });
    const create = useCallback((appName: string) => mutation.run('create', async () => {
        requireApi(api);
        await queryClient.cancelQueries({ exact: true, queryKey: keys.apiKeys });
        const result = await createAdminApiKey(api, appName);
        queryClient.setQueryData(keys.apiKeys, result.rows);
        return result;
    }), [ api, keys.apiKeys, mutation, queryClient ]);
    const revoke = useCallback((row: PtvAdminApiKey) => mutation.run(`revoke:${row.id}`, async () => {
        requireApi(api);
        await queryClient.cancelQueries({ exact: true, queryKey: keys.apiKeys });
        await revokeAdminApiKey(api, row.id);
        queryClient.setQueryData<PtvAdminApiKey[]>(keys.apiKeys, removeApiKeyRow(row.id));
        void queryClient.invalidateQueries({ exact: true, queryKey: keys.apiKeys });
    }), [ api, keys.apiKeys, mutation, queryClient ]);

    return {
        create,
        error: query.error instanceof Error ? query.error : null,
        fetching: query.isFetching,
        loading: query.isPending && !query.data,
        operation: mutation.operation,
        refetch: () => query.refetch({ cancelRefetch: true }),
        revoke,
        rows: query.data || []
    } as const;
}

export function useAdminServerBackups(api?: Api, apiClient?: ApiClient) {
    const key = getResolvedAdminServerId(apiClient);
    const keys = useMemo(() => getAdminServerOperationsQueryKeys(key || 'unresolved-server'), [ key ]);
    const queryClient = useQueryClient();
    const mutation = useSingleOperation();
    const backupsQuery = useQuery({
        enabled: Boolean(api && key),
        queryFn: ({ signal }) => loadAdminBackups(api!, signal),
        queryKey: keys.backups,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 60_000
    });
    const accountQuery = useQuery({
        enabled: Boolean(api && key),
        queryFn: () => loadPtvLatestAccountBackup(),
        queryKey: keys.ptvAccountBackup,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 60_000
    });
    const create = useCallback((options: PtvAdminBackupCreateOptions) => mutation.run(
        'create-jellyfin',
        async () => {
            requireApi(api);
            await queryClient.cancelQueries({ exact: true, queryKey: keys.backups });
            const created = await createAdminBackup(api, options);
            queryClient.setQueryData<PtvAdminBackup[]>(keys.backups, prependBackupRow(created));
            void queryClient.invalidateQueries({ exact: true, queryKey: keys.backups });
            return created;
        }
    ), [ api, keys.backups, mutation, queryClient ]);
    const inspect = useCallback((row: PtvAdminBackup) => mutation.run(
        `inspect:${row.id}`,
        async () => {
            requireApi(api);
            return loadAdminBackupManifest(api, row.id);
        }
    ), [ api, mutation ]);
    const restore = useCallback((row: PtvAdminBackup) => mutation.run(
        `restore:${row.id}`,
        async () => {
            requireApi(api);
            return restoreAdminBackup(api, row.id);
        }
    ), [ api, mutation ]);
    const accountOperation = useCallback((
        name: 'create' | 'restore' | 'verify',
        task: () => Promise<PtvAdminAccountBackupOperation>
    ) => mutation.run(`account-${name}`, async () => {
        const result = await task();
        void queryClient.invalidateQueries({
            exact: true,
            queryKey: keys.ptvAccountBackup
        });
        return result;
    }), [ keys.ptvAccountBackup, mutation, queryClient ]);

    return {
        account: accountQuery.data || null,
        accountError: accountQuery.error instanceof Error ? accountQuery.error : null,
        accountLoading: accountQuery.isPending && !accountQuery.data,
        create,
        createAccount: () => accountOperation('create', createLatestPtvAccountBackup),
        dryRunRestoreAccount: () => accountOperation(
            'restore',
            () => restoreLatestPtvAccountBackup(true, false)
        ),
        error: backupsQuery.error instanceof Error ? backupsQuery.error : null,
        fetching: backupsQuery.isFetching,
        inspect,
        loading: backupsQuery.isPending && !backupsQuery.data,
        operation: mutation.operation,
        refetch: () => backupsQuery.refetch({ cancelRefetch: true }),
        refetchAccount: () => accountQuery.refetch({ cancelRefetch: true }),
        restore,
        restoreAccount: () => accountOperation('restore', runConfirmedAccountRestore),
        rows: backupsQuery.data || [],
        verifyAccount: () => accountOperation('verify', verifyLatestPtvAccountBackup)
    } as const;
}

export function useAdminServerLogs(
    routeFileName: string | null,
    api?: Api,
    apiClient?: ApiClient
) {
    const key = getResolvedAdminServerId(apiClient);
    const baseKeys = useMemo(() => getAdminServerOperationsQueryKeys(key || 'unresolved-server'), [ key ]);
    const listQuery = useQuery({
        enabled: Boolean(api && key),
        queryFn: ({ signal }) => loadAdminServerLogs(api!, signal),
        queryKey: baseKeys.logs,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 30_000
    });
    const selected = useMemo(() => {
        if (!routeFileName || !listQuery.data) return null;
        return listQuery.data.find(row => row.name === routeFileName) || null;
    }, [ listQuery.data, routeFileName ]);
    const detailKeys = useMemo(
        () => getAdminServerOperationsQueryKeys(key || 'unresolved-server', selected?.id),
        [ key, selected?.id ]
    );
    const detailQuery = useQuery({
        enabled: Boolean(api && key && selected),
        queryFn: ({ signal }) => loadAdminServerLog(api!, selected!.id, signal),
        queryKey: detailKeys.logDetail,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 30_000
    });
    const download = useCallback(async (): Promise<PtvAdminServerLogDownload> => {
        requireApi(api);
        if (!selected) throw new Error('Choose an available server log.');
        return downloadAdminServerLog(api, selected.id);
    }, [ api, selected ]);

    return {
        detail: detailQuery.data || null,
        detailError: detailQuery.error instanceof Error ? detailQuery.error : null,
        detailLoading: Boolean(selected) && detailQuery.isPending && !detailQuery.data,
        download,
        listError: listQuery.error instanceof Error ? listQuery.error : null,
        listFetching: listQuery.isFetching,
        listLoading: listQuery.isPending && !listQuery.data,
        refetchDetail: () => detailQuery.refetch({ cancelRefetch: true }),
        refetchList: () => listQuery.refetch({ cancelRefetch: true }),
        routeNotFound: Boolean(routeFileName && listQuery.data && !selected),
        rows: listQuery.data || [],
        selected
    } as const;
}
