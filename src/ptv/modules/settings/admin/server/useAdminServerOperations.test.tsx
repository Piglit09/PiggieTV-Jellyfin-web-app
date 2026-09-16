import type { Api } from '@jellyfin/sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    PtvAdminAccountBackup,
    PtvAdminApiKey,
    PtvAdminBackup,
    PtvAdminServerLog
} from './adminServerOperationsModel';

const service = vi.hoisted(() => ({
    createAdminApiKey: vi.fn(),
    createAdminBackup: vi.fn(),
    createLatestPtvAccountBackup: vi.fn(),
    downloadAdminServerLog: vi.fn(),
    loadAdminApiKeys: vi.fn(),
    loadAdminBackupManifest: vi.fn(),
    loadAdminBackups: vi.fn(),
    loadAdminServerLog: vi.fn(),
    loadAdminServerLogs: vi.fn(),
    loadPtvLatestAccountBackup: vi.fn(),
    restoreAdminBackup: vi.fn(),
    restoreLatestPtvAccountBackup: vi.fn(),
    revokeAdminApiKey: vi.fn(),
    verifyLatestPtvAccountBackup: vi.fn()
}));

vi.mock('./adminServerOperationsService', () => service);

import {
    useAdminServerApiKeys,
    useAdminServerBackups,
    useAdminServerLogs
} from './useAdminServerOperations';

const api = {} as Api;
const apiClient = { serverId: () => 'server-a' } as unknown as ApiClient;

const apiKey: PtvAdminApiKey = {
    appName: 'Automation',
    createdAt: null,
    id: 'key-opaque',
    tokenMask: '••••••••'
};
const backup: PtvAdminBackup = {
    backupEngineVersion: null,
    createdAt: null,
    id: 'backup-opaque',
    options: { database: true, metadata: null, subtitles: null, trickplay: null },
    serverVersion: null
};
const accountBackup: PtvAdminAccountBackup = {
    available: true,
    durationMilliseconds: null,
    id: 'latest',
    lastRunAt: null,
    lastSuccessAt: null,
    message: null,
    overdue: null,
    pendingVerificationsBackedUp: null,
    profilesBackedUp: null,
    result: null,
    sizeBytes: null,
    verificationStatus: null,
    verifiedEmailsBackedUp: null
};
const log: PtvAdminServerLog = {
    createdAt: null,
    id: 'log-opaque',
    modifiedAt: null,
    name: ' server.log ',
    sizeBytes: null
};

type KeysState = ReturnType<typeof useAdminServerApiKeys>;
type BackupsState = ReturnType<typeof useAdminServerBackups>;
type LogsState = ReturnType<typeof useAdminServerLogs>;

function KeysHarness({ state }: Readonly<{ state: { current?: KeysState } }>) {
    state.current = useAdminServerApiKeys(api, apiClient);
    return null;
}

function BackupsHarness({ state }: Readonly<{ state: { current?: BackupsState } }>) {
    state.current = useAdminServerBackups(api, apiClient);
    return null;
}

function LogsHarness({ routeFileName = ' server.log ', state }: Readonly<{
    routeFileName?: string;
    state: { current?: LogsState };
}>) {
    state.current = useAdminServerLogs(routeFileName, api, apiClient);
    return null;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(next => {
        resolve = next;
    });
    return { promise, resolve };
}

describe('server operations hooks', () => {
    let container: HTMLDivElement;
    let queryClient: QueryClient;
    let root: Root;

    async function render(element: React.ReactElement) {
        await act(async () => {
            root.render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>);
        });
        await act(async () => {
            await new Promise(resolve => globalThis.setTimeout(resolve, 0));
            await new Promise(resolve => globalThis.setTimeout(resolve, 0));
        });
    }

    beforeEach(() => {
        /* eslint-disable @typescript-eslint/naming-convention */
        Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
        /* eslint-enable @typescript-eslint/naming-convention */
        vi.clearAllMocks();
        service.loadAdminApiKeys.mockResolvedValue([ apiKey ]);
        service.createAdminApiKey.mockResolvedValue({
            reveal: { appName: 'Automation', token: 'ephemeral-token' },
            rows: [ apiKey ]
        });
        service.loadAdminBackups.mockResolvedValue([ backup ]);
        service.loadPtvLatestAccountBackup.mockResolvedValue(accountBackup);
        service.loadAdminServerLogs.mockResolvedValue([ log ]);
        service.loadAdminServerLog.mockResolvedValue({
            id: log.id,
            name: log.name,
            renderedText: 'content',
            totalBytes: 7,
            truncated: false
        });
        service.restoreAdminBackup.mockResolvedValue(undefined);
        service.restoreLatestPtvAccountBackup.mockResolvedValue({
            code: 'ok', dryRun: true, message: null, ok: true, verified: true
        });
        service.revokeAdminApiKey.mockResolvedValue(undefined);
        queryClient = new QueryClient({
            defaultOptions: { queries: { gcTime: Infinity, retry: false } }
        });
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        queryClient.clear();
        container.remove();
        Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    });

    it('passes only the opaque row id to revoke and refreshes the server-scoped cache', async () => {
        const state: { current?: KeysState } = {};
        await render(<KeysHarness state={state} />);
        service.loadAdminApiKeys.mockResolvedValueOnce([]);

        await act(async () => state.current!.revoke(apiKey));

        expect(service.revokeAdminApiKey).toHaveBeenCalledWith(api, 'key-opaque');
        expect(JSON.stringify(service.revokeAdminApiKey.mock.calls)).not.toContain('AccessToken');
        expect(state.current!.rows).toEqual([]);
    });

    it('returns a one-time key reveal without placing it in the query cache', async () => {
        const state: { current?: KeysState } = {};
        await render(<KeysHarness state={state} />);

        let result!: Awaited<ReturnType<KeysState['create']>>;
        await act(async () => {
            result = await state.current!.create('Automation');
        });

        expect(result.reveal?.token).toBe('ephemeral-token');
        expect(JSON.stringify(state.current!.rows)).not.toContain('ephemeral-token');
        expect(JSON.stringify(queryClient.getQueryCache().getAll().map(query => query.state.data)))
            .not.toContain('ephemeral-token');
    });

    it('rejects a second unlike operation instead of returning the first operation promise', async () => {
        const state: { current?: BackupsState } = {};
        const pending = deferred<PtvAdminBackup>();
        service.loadAdminBackupManifest.mockReturnValueOnce(pending.promise);
        await render(<BackupsHarness state={state} />);

        let inspectPromise!: Promise<PtvAdminBackup>;
        await act(async () => {
            inspectPromise = state.current!.inspect(backup);
            await expect(state.current!.restore(backup)).rejects.toThrow(
                'Another server operation is already in progress.'
            );
        });
        expect(service.restoreAdminBackup).not.toHaveBeenCalled();

        pending.resolve(backup);
        await act(async () => inspectPromise);
    });

    it('exposes distinct dry-run and confirmed live latest-account restore calls', async () => {
        const state: { current?: BackupsState } = {};
        await render(<BackupsHarness state={state} />);

        await act(async () => state.current!.dryRunRestoreAccount());
        await act(async () => state.current!.restoreAccount());

        expect(service.restoreLatestPtvAccountBackup).toHaveBeenNthCalledWith(1, true, false);
        expect(service.restoreLatestPtvAccountBackup).toHaveBeenNthCalledWith(2, true, false);
        expect(service.restoreLatestPtvAccountBackup).toHaveBeenNthCalledWith(3, false, true);
    });

    it('blocks live account restore when its immediate dry-run preflight fails', async () => {
        const state: { current?: BackupsState } = {};
        service.restoreLatestPtvAccountBackup.mockResolvedValueOnce({
            code: 'verification-failed',
            dryRun: true,
            message: 'Verification failed',
            ok: false,
            verified: false
        });
        await render(<BackupsHarness state={state} />);

        let failure: unknown;
        await act(async () => {
            try {
                await state.current!.restoreAccount();
            } catch (error) {
                failure = error;
            }
        });
        expect(failure).toMatchObject({ code: 'operation-failed' });
        expect(service.restoreLatestPtvAccountBackup).toHaveBeenCalledOnce();
        expect(service.restoreLatestPtvAccountBackup).toHaveBeenCalledWith(true, false);
    });

    it('matches the exact route filename but loads and downloads by opaque id', async () => {
        const state: { current?: LogsState } = {};
        service.downloadAdminServerLog.mockResolvedValue({
            content: 'content',
            fileName: 'server.log',
            mimeType: 'text/plain;charset=utf-8'
        });
        await render(<LogsHarness state={state} />);

        expect(service.loadAdminServerLog).toHaveBeenCalledWith(api, 'log-opaque', expect.anything());
        await state.current!.download();
        expect(service.downloadAdminServerLog).toHaveBeenCalledWith(api, 'log-opaque');
    });

    it.each([
        '../server.log',
        '%2e%2e/server.log',
        '..%2fserver.log',
        '..\\server.log',
        'C:\\private\\server.log',
        '/var/log/server.log'
    ])('does not fetch log content for a non-authoritative route filename %s', async routeFileName => {
        const state: { current?: LogsState } = {};
        await render(<LogsHarness routeFileName={routeFileName} state={state} />);

        expect(state.current!.routeNotFound).toBe(true);
        expect(service.loadAdminServerLog).not.toHaveBeenCalled();
        expect(service.downloadAdminServerLog).not.toHaveBeenCalled();
    });
});
