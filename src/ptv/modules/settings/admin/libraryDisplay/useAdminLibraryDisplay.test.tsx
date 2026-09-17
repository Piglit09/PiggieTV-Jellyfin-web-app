import type { Api } from '@jellyfin/sdk';
import type { MetadataConfiguration } from '@jellyfin/sdk/lib/generated-client/models/metadata-configuration';
import type { ServerConfiguration } from '@jellyfin/sdk/lib/generated-client/models/server-configuration';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
    loadAdminLibraryDisplay: vi.fn(),
    saveAdminLibraryDisplay: vi.fn()
}));

vi.mock('./adminLibraryDisplayService', () => ({
    loadAdminLibraryDisplay: serviceMocks.loadAdminLibraryDisplay,
    saveAdminLibraryDisplay: serviceMocks.saveAdminLibraryDisplay
}));

import { resetAdminConfigurationSaveSettlementsForTests } from '../configuration/useAdminConfigurationSave';

import {
    getAdminLibraryDisplayQueryKey,
    useAdminLibraryDisplay
} from './useAdminLibraryDisplay';
import {
    AdminLibraryDisplayServiceError,
    type AdminLibraryDisplaySettings,
    type AdminLibraryDisplaySnapshot
} from './adminLibraryDisplayModel';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

const api = {} as Api;
const apiClient = (serverId: string) => ({
    serverId: () => serverId
} as unknown as ApiClient);

const confirmed: AdminLibraryDisplaySettings = {
    displayFolderView: false,
    displaySpecialsWithinSeasons: true,
    groupMoviesIntoCollections: false,
    groupSeriesIntoCollections: false,
    includeExternalContentInSuggestions: true,
    useFileCreationTimeForDateAdded: true
};

function snapshot(settings: AdminLibraryDisplaySettings = confirmed): AdminLibraryDisplaySnapshot {
    return {
        metadataConfiguration: {
            UseFileCreationTimeForDateAdded: settings.useFileCreationTimeForDateAdded
        } as MetadataConfiguration,
        serverConfiguration: {
            DisplaySpecialsWithinSeasons: settings.displaySpecialsWithinSeasons,
            EnableExternalContentInSuggestions: settings.includeExternalContentInSuggestions,
            EnableFolderView: settings.displayFolderView,
            EnableGroupingMoviesIntoCollections: settings.groupMoviesIntoCollections,
            EnableGroupingShowsIntoCollections: settings.groupSeriesIntoCollections
        } as ServerConfiguration,
        settings
    };
}

function deferred<T>() {
    let reject!: (reason?: unknown) => void;
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

type HookState = ReturnType<typeof useAdminLibraryDisplay>;

function Harness({
    client = apiClient('server-a'),
    jellyfinApi = api,
    saveTimeoutMs,
    stateRef
}: Readonly<{
    client?: ApiClient;
    jellyfinApi?: Api;
    saveTimeoutMs?: number;
    stateRef: { current?: HookState };
}>) {
    stateRef.current = useAdminLibraryDisplay(jellyfinApi, client, saveTimeoutMs);
    return null;
}

async function flushQueries() {
    await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
        await Promise.resolve();
    });
}

describe('administrator Library Display hook', () => {
    let container: HTMLDivElement;
    let queryClient: QueryClient;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        serviceMocks.loadAdminLibraryDisplay.mockResolvedValue(snapshot());
        serviceMocks.saveAdminLibraryDisplay.mockResolvedValue(snapshot());
        queryClient = new QueryClient({
            defaultOptions: {
                queries: { gcTime: Infinity, retry: false }
            }
        });
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        resetAdminConfigurationSaveSettlementsForTests();
        queryClient.clear();
        container.remove();
    });

    it('uses a source-specific query identity isolated by server', () => {
        const serverA = getAdminLibraryDisplayQueryKey('server-a');
        const serverB = getAdminLibraryDisplayQueryKey('server-b');

        expect(serverA).toEqual([
            'PtvAdminLibraryDisplay',
            'server-a',
            'composite',
            { general: 'System/Configuration', named: 'metadata' }
        ]);
        expect(serverA).not.toEqual(serverB);
        expect(serverA).not.toEqual([ 'Configuration' ]);
        expect(serverA).not.toEqual([ 'NamedConfiguration', 'metadata' ]);
    });

    it('loads one composite query with an AbortSignal and does not poll', async () => {
        const stateRef: { current?: HookState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(stateRef.current?.settings).toEqual(confirmed);
        expect(serviceMocks.loadAdminLibraryDisplay).toHaveBeenCalledOnce();
        expect(serviceMocks.loadAdminLibraryDisplay).toHaveBeenCalledWith(
            api,
            expect.any(AbortSignal)
        );

        await new Promise(resolve => setTimeout(resolve, 20));
        expect(serviceMocks.loadAdminLibraryDisplay).toHaveBeenCalledOnce();
    });

    it('does not load before both API and stable server identity are available', async () => {
        const stateRef: { current?: HookState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness client={apiClient('')} stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(serviceMocks.loadAdminLibraryDisplay).not.toHaveBeenCalled();
        expect(stateRef.current?.settings).toBeNull();
    });

    it('keeps save single-flight, cancels reads, and installs success directly in cache', async () => {
        const stateRef: { current?: HookState } = {};
        const baseResult = snapshot({ ...confirmed, displayFolderView: true });
        const unknownNestedValue = { plugin: 'preserved' };
        const saveResult: AdminLibraryDisplaySnapshot = {
            ...baseResult,
            serverConfiguration: {
                ...baseResult.serverConfiguration,
                PluginField: unknownNestedValue
            } as ServerConfiguration
        };
        const pendingSave = deferred<AdminLibraryDisplaySnapshot>();
        serviceMocks.saveAdminLibraryDisplay.mockReturnValue(pendingSave.promise);
        const cancelSpy = vi.spyOn(queryClient, 'cancelQueries');
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        let first!: Promise<AdminLibraryDisplaySnapshot>;
        let second!: Promise<AdminLibraryDisplaySnapshot>;
        await act(async () => {
            first = stateRef.current!.save(saveResult.settings, confirmed);
            second = stateRef.current!.save(saveResult.settings, confirmed);
            await Promise.resolve();
        });

        expect(first).toBe(second);
        expect(serviceMocks.saveAdminLibraryDisplay).toHaveBeenCalledOnce();
        expect(serviceMocks.saveAdminLibraryDisplay).toHaveBeenCalledWith(
            api,
            saveResult.settings,
            confirmed,
            expect.any(AbortSignal)
        );
        expect(cancelSpy).toHaveBeenCalledWith({
            exact: true,
            queryKey: getAdminLibraryDisplayQueryKey('server-a')
        });

        await act(async () => {
            pendingSave.resolve(saveResult);
            await first;
        });

        const cached = queryClient.getQueryData<AdminLibraryDisplaySnapshot>(
            getAdminLibraryDisplayQueryKey('server-a')
        );
        expect(cached).toEqual(saveResult);
        expect(Reflect.get(cached!.serverConfiguration, 'PluginField')).toBe(unknownNestedValue);
        expect(stateRef.current?.settings).toEqual(saveResult.settings);
        expect(invalidateSpy).not.toHaveBeenCalled();
        expect(stateRef.current?.saving).toBe(false);
    });

    it('retains confirmed cache data after a failed save', async () => {
        const stateRef: { current?: HookState } = {};
        serviceMocks.saveAdminLibraryDisplay.mockRejectedValue(
            new AdminLibraryDisplayServiceError('save-failed', "We couldn't save Library Display settings.")
        );
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        await act(async () => {
            await expect(stateRef.current!.save({
                ...confirmed,
                displayFolderView: true
            }, confirmed)).rejects.toMatchObject({ code: 'save-failed' });
        });

        expect(stateRef.current?.settings).toEqual(confirmed);
        expect(stateRef.current?.saving).toBe(false);
    });

    it('waits for late compensation before allowing a retry to publish', async () => {
        const stateRef: { current?: HookState } = {};
        const firstDesired = { ...confirmed, displayFolderView: true };
        const retryDesired = { ...confirmed, groupMoviesIntoCollections: true };
        const lateCompensation = deferred<AdminLibraryDisplaySnapshot>();
        serviceMocks.saveAdminLibraryDisplay
            .mockReturnValueOnce(lateCompensation.promise)
            .mockResolvedValueOnce(snapshot(retryDesired));
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness saveTimeoutMs={30} stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        let timedOut!: Promise<AdminLibraryDisplaySnapshot>;
        await act(async () => {
            timedOut = stateRef.current!.save(firstDesired, confirmed);
            await Promise.resolve();
        });
        await act(async () => {
            await expect(timedOut).rejects.toMatchObject({ code: 'save-timeout' });
        });
        let retry!: Promise<AdminLibraryDisplaySnapshot>;
        await act(async () => {
            retry = stateRef.current!.save(retryDesired, confirmed);
            await Promise.resolve();
        });
        expect(serviceMocks.saveAdminLibraryDisplay).toHaveBeenCalledOnce();

        const canceled = Object.assign(new Error('retired compensation'), {
            name: 'AbortError'
        });
        await act(async () => {
            lateCompensation.reject(canceled);
            await expect(retry).resolves.toEqual(snapshot(retryDesired));
        });

        expect(queryClient.getQueryData<AdminLibraryDisplaySnapshot>(
            getAdminLibraryDisplayQueryKey('server-a')
        )?.settings).toEqual(retryDesired);
        expect(stateRef.current?.settings).toEqual(retryDesired);
        expect(stateRef.current?.saving).toBe(false);
        expect(serviceMocks.saveAdminLibraryDisplay).toHaveBeenCalledTimes(2);
    });

    it('prevents a cancelled stale read from replacing a newer saved snapshot', async () => {
        const stateRef: { current?: HookState } = {};
        const oldRead = deferred<AdminLibraryDisplaySnapshot>();
        const saved = snapshot({ ...confirmed, displayFolderView: true });
        serviceMocks.loadAdminLibraryDisplay.mockReturnValue(oldRead.promise);
        serviceMocks.saveAdminLibraryDisplay.mockResolvedValue(saved);
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness stateRef={stateRef} />
            </QueryClientProvider>
        ));

        await act(async () => {
            await stateRef.current!.save(saved.settings, confirmed);
        });
        await act(async () => {
            oldRead.resolve(snapshot(confirmed));
            await oldRead.promise;
            await Promise.resolve();
        });

        expect(stateRef.current?.settings).toEqual(saved.settings);
        expect(queryClient.getQueryData<AdminLibraryDisplaySnapshot>(
            getAdminLibraryDisplayQueryKey('server-a')
        )?.settings).toEqual(saved.settings);
    });
});
