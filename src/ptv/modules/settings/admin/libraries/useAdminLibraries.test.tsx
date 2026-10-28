import type { Api } from '@jellyfin/sdk';
import type { LibraryOptionsResultDto } from '@jellyfin/sdk/lib/generated-client/models/library-options-result-dto';
import type { VirtualFolderInfo } from '@jellyfin/sdk/lib/generated-client/models/virtual-folder-info';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hookMocks = vi.hoisted(() => ({
    AdminLibrariesServiceError: class AdminLibrariesServiceError extends Error {
        public readonly code: string;

        public constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    },
    loadAdminLibraries: vi.fn(),
    loadAdminLibraryTransition: vi.fn(async () => ({ held: false, state: 'idle', affectedRuleIds: [] as string[] })),
    loadAdminLibraryOptionsInfo: vi.fn(),
    loadAdminLibraryTasks: vi.fn()
}));

vi.mock('./adminLibrariesService', () => ({
    AdminLibrariesServiceError: hookMocks.AdminLibrariesServiceError,
    loadAdminLibraries: hookMocks.loadAdminLibraries,
    loadAdminLibraryTransition: hookMocks.loadAdminLibraryTransition,
    loadAdminLibraryOptionsInfo: hookMocks.loadAdminLibraryOptionsInfo,
    loadAdminLibraryTasks: hookMocks.loadAdminLibraryTasks,
    resolveAdminLibrary: (
        libraries: readonly VirtualFolderInfo[],
        libraryId: string
    ) => {
        const match = libraries.find(value => value.ItemId === libraryId);
        if (!match) {
            throw new hookMocks.AdminLibrariesServiceError(
                'invalid-library',
                'This library could not be found.'
            );
        }
        return match;
    }
}));

import {
    getAdminLibrariesQueryKeys,
    shouldPollAdminLibraryScan,
    useAdminLibraries,
    useAdminLibrary,
    useAdminLibraryCreationOptions
} from './useAdminLibraries';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

const api = {} as Api;
const apiClient = { serverId: () => 'server-a' } as unknown as ApiClient;

function library(overrides: Partial<VirtualFolderInfo> = {}): VirtualFolderInfo {
    return {
        CollectionType: 'movies',
        ItemId: 'library-a',
        LibraryOptions: {
            Enabled: true,
            PathInfos: [{ Path: '/media/movies' }]
        },
        Locations: ['/media/movies'],
        Name: 'Movies',
        ...overrides
    };
}

type LibrariesHookState = ReturnType<typeof useAdminLibraries>;
type LibraryHookState = ReturnType<typeof useAdminLibrary>;
type CreationHookState = ReturnType<typeof useAdminLibraryCreationOptions>;

function ListHarness({ client = apiClient, stateRef }: Readonly<{
    client?: ApiClient;
    stateRef: { current?: LibrariesHookState };
}>) {
    stateRef.current = useAdminLibraries(api, client);
    return null;
}

function DisabledListHarness({ stateRef }: Readonly<{
    stateRef: { current?: LibrariesHookState };
}>) {
    stateRef.current = useAdminLibraries(undefined, apiClient);
    return null;
}

function DetailHarness({ stateRef }: Readonly<{
    stateRef: { current?: LibraryHookState };
}>) {
    stateRef.current = useAdminLibrary(api, apiClient, 'library-a');
    return null;
}

function CombinedHarness({ stateRef }: Readonly<{
    stateRef: {
        current?: {
            creation: CreationHookState;
            detail: LibraryHookState;
            list: LibrariesHookState;
        };
    };
}>) {
    const list = useAdminLibraries(api, apiClient);
    const detail = useAdminLibrary(api, apiClient, 'library-a');
    const creation = useAdminLibraryCreationOptions(api, apiClient, 'movies', true);
    stateRef.current = { creation, detail, list };
    return null;
}

async function flushQueries() {
    await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
    });
}

describe('administrator libraries hooks', () => {
    let container: HTMLDivElement;
    let queryClient: QueryClient;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        hookMocks.loadAdminLibraries.mockResolvedValue([library()]);
        hookMocks.loadAdminLibraryOptionsInfo.mockResolvedValue({
            MetadataSavers: [{ DefaultEnabled: true, Name: 'Nfo' }]
        } satisfies LibraryOptionsResultDto);
        hookMocks.loadAdminLibraryTasks.mockResolvedValue([
            { Id: 'scan-task', Key: 'RefreshLibrary', State: 'Idle' }
        ]);
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
        queryClient.clear();
        container.remove();
    });

    it('does not load administrator libraries before the server id resolves', async () => {
        const stateRef: { current?: LibrariesHookState } = {};
        const unresolved = { serverId: () => '' } as unknown as ApiClient;
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <ListHarness client={unresolved} stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(hookMocks.loadAdminLibraries).not.toHaveBeenCalled();
        expect(hookMocks.loadAdminLibraryTasks).not.toHaveBeenCalled();
        await expect(stateRef.current?.refresh()).resolves.toBeUndefined();
    });

    it('polls only during bounded observation or an authoritative active state and stops on error', () => {
        expect(shouldPollAdminLibraryScan(library(), false, 'success')).toBe(false);
        expect(shouldPollAdminLibraryScan(library(), true, 'success')).toBe(true);
        expect(shouldPollAdminLibraryScan(
            library({ RefreshStatus: 'Active' }),
            false,
            'success'
        )).toBe(true);
        expect(shouldPollAdminLibraryScan(
            library({ RefreshStatus: 'Active' }),
            true,
            'error'
        )).toBe(false);
    });

    it('loads a list with one virtual-folder request and one task request', async () => {
        const stateRef: { current?: LibrariesHookState } = {};

        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <ListHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(stateRef.current?.libraries).toHaveLength(1);
        expect(stateRef.current?.globalScanTask).toMatchObject({ Id: 'scan-task' });
        expect(hookMocks.loadAdminLibraries).toHaveBeenCalledOnce();
        expect(hookMocks.loadAdminLibraryTasks).toHaveBeenCalledOnce();
        expect(hookMocks.loadAdminLibraryOptionsInfo).not.toHaveBeenCalled();
    });

    it('deduplicates list and task sources while detail loads only its provider discovery', async () => {
        const stateRef: {
            current?: {
                creation: CreationHookState;
                detail: LibraryHookState;
                list: LibrariesHookState;
            };
        } = {};

        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <CombinedHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(stateRef.current?.list.libraries).toHaveLength(1);
        expect(stateRef.current?.detail.detail).toMatchObject({
            id: 'library-a',
            name: 'Movies'
        });
        expect(stateRef.current?.detail.configuredLocations).toEqual([ '/media/movies' ]);
        expect(stateRef.current?.creation.data).toMatchObject({
            MetadataSavers: [{ Name: 'Nfo' }]
        });
        expect(hookMocks.loadAdminLibraries).toHaveBeenCalledOnce();
        expect(hookMocks.loadAdminLibraryTasks).toHaveBeenCalledOnce();
        expect(hookMocks.loadAdminLibraryOptionsInfo).toHaveBeenCalledTimes(2);
        expect(hookMocks.loadAdminLibraryOptionsInfo).toHaveBeenCalledWith(
            api,
            'movies',
            false,
            expect.any(AbortSignal)
        );
        expect(hookMocks.loadAdminLibraryOptionsInfo).toHaveBeenCalledWith(
            api,
            'movies',
            true,
            expect.any(AbortSignal)
        );
    });

    it('does not request any source without an authenticated API', async () => {
        const stateRef: { current?: LibrariesHookState } = {};

        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <DisabledListHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(stateRef.current?.libraries).toEqual([]);
        expect(hookMocks.loadAdminLibraries).not.toHaveBeenCalled();
        expect(hookMocks.loadAdminLibraryTasks).not.toHaveBeenCalled();
    });

    it('does not leave provider discovery loading when authoritative options are absent', async () => {
        const stateRef: { current?: LibraryHookState } = {};
        hookMocks.loadAdminLibraries.mockResolvedValue([library({ LibraryOptions: undefined })]);

        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <DetailHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(stateRef.current?.detail?.rawOptions).toBeNull();
        expect(stateRef.current?.providerLoading).toBe(false);
        expect(hookMocks.loadAdminLibraryOptionsInfo).not.toHaveBeenCalled();
    });

    it('restores pending operation and affected rules from the administrator endpoint on mount', async () => {
        hookMocks.loadAdminLibraryTransition.mockResolvedValueOnce({ held: true, state: 'pending', affectedRuleIds: ['anime'] });
        const stateRef: { current?: LibraryHookState } = {};
        await act(async () => root.render(<QueryClientProvider client={queryClient}><DetailHarness stateRef={stateRef} /></QueryClientProvider>));
        await flushQueries();
        expect(stateRef.current?.transition).toMatchObject({ held: true, state: 'pending', affectedRuleIds: ['anime'] });
        expect(hookMocks.loadAdminLibraryTransition).toHaveBeenCalledOnce();
        await act(async () => stateRef.current?.refreshTransition());
        expect(hookMocks.loadAdminLibraryTransition).toHaveBeenCalledTimes(2);
    });

    it('does not cache an unresolved or different-identity mutation result', async () => {
        const stateRef: { current?: LibraryHookState } = {};
        await act(async () => root.render(<QueryClientProvider client={queryClient}><DetailHarness stateRef={stateRef} /></QueryClientProvider>));
        await flushQueries();
        const keys = getAdminLibrariesQueryKeys('server-a', 'library-a');
        await act(async () => stateRef.current?.adoptLibrary(library({ ItemId: null, Name: 'Films' })));
        expect(queryClient.getQueryData<VirtualFolderInfo>(keys.detail)?.Name).toBe('Movies');
        await act(async () => stateRef.current?.adoptLibrary(library({ ItemId: 'different-id', Name: 'Films' })));
        expect(queryClient.getQueryData<VirtualFolderInfo>(keys.detail)?.Name).toBe('Movies');
    });

    it('adopts a confirmed mutation into the exact detail and list caches', async () => {
        const stateRef: { current?: LibraryHookState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <DetailHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        const saved = library({
            LibraryOptions: {
                ...library().LibraryOptions,
                Enabled: false
            },
            Name: 'Renamed Movies'
        });
        await act(async () => stateRef.current?.adoptLibrary(saved));
        await flushQueries();

        expect(stateRef.current?.detail).toMatchObject({
            name: 'Renamed Movies',
            options: { enabled: false }
        });
        const keys = getAdminLibrariesQueryKeys('server-a', 'library-a');
        expect(queryClient.getQueryData(keys.detail)).toEqual(saved);
        expect(queryClient.getQueryData<VirtualFolderInfo[]>(keys.list)?.[0]).toEqual(saved);
    });

    it('observes an accepted individual scan from a fresh virtual-folder read', async () => {
        const stateRef: { current?: LibraryHookState } = {};
        hookMocks.loadAdminLibraries
            .mockResolvedValueOnce([library({ RefreshProgress: 0, RefreshStatus: 'Idle' })])
            .mockResolvedValueOnce([library({ RefreshProgress: 0, RefreshStatus: 'Queued' })]);
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <DetailHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(stateRef.current?.detail?.scanState).toBe('idle');
        await act(async () => {
            stateRef.current?.beginScanObservation();
            await Promise.resolve();
        });
        await flushQueries();

        expect(hookMocks.loadAdminLibraries).toHaveBeenCalledTimes(2);
        expect(stateRef.current?.detail).toMatchObject({
            id: 'library-a',
            refreshProgress: 0,
            scanState: 'running'
        });
        expect(hookMocks.loadAdminLibraryTasks).not.toHaveBeenCalled();
    });

    it('fails a deleted stable identity closed instead of adopting the library at its old position', async () => {
        const stateRef: { current?: LibraryHookState } = {};
        const libraryB = library({ ItemId: 'library-b', Name: 'Shows' });
        hookMocks.loadAdminLibraries
            .mockResolvedValueOnce([library(), libraryB])
            .mockResolvedValue([libraryB]);
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <DetailHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(stateRef.current?.detail?.id).toBe('library-a');
        await act(async () => {
            await stateRef.current?.refetch();
        });
        await flushQueries();

        expect(stateRef.current?.detail).toBeNull();
        expect(stateRef.current?.error).toBe(true);
        expect(queryClient.getQueryData<VirtualFolderInfo[]>(
            getAdminLibrariesQueryKeys('server-a', 'library-a').list
        )).toEqual([libraryB]);
    });

    it('keeps a running global task separate from an idle individual library', async () => {
        const stateRef: { current?: LibrariesHookState } = {};
        hookMocks.loadAdminLibraryTasks.mockResolvedValueOnce([
            { Id: 'scan-task', Key: 'RefreshLibrary', State: 'Running' }
        ]);
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <ListHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(stateRef.current?.globalScanTask?.State).toBe('Running');
        expect(stateRef.current?.libraries[0]?.scanState).toBe('idle');
    });

    it('keeps a manual refresh single-flight across list and task sources', async () => {
        const stateRef: { current?: LibrariesHookState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <ListHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        let first: Promise<unknown> | undefined;
        let second: Promise<unknown> | undefined;
        await act(async () => {
            first = stateRef.current?.refresh();
            second = stateRef.current?.refresh();
            expect(second).toBe(first);
            await first;
        });

        expect(hookMocks.loadAdminLibraries).toHaveBeenCalledTimes(2);
        expect(hookMocks.loadAdminLibraryTasks).toHaveBeenCalledTimes(2);
    });

    it('scopes every key by server, stable library id, type, and source arguments', () => {
        const serverA = getAdminLibrariesQueryKeys('server-a', ' LIBRARY-A ', ' Movies ', false);
        const serverB = getAdminLibrariesQueryKeys('server-b', 'library-a', 'movies', false);
        const create = getAdminLibrariesQueryKeys('server-a', undefined, 'movies', true);

        expect(serverA.list).toEqual([
            'PtvAdminLibraries',
            'server-a',
            'virtual-folders',
            { includeLibraryOptions: true }
        ]);
        expect(serverA.detail).toEqual([
            'PtvAdminLibraries',
            'server-a',
            'detail',
            'library-a'
        ]);
        expect(serverA.options).toEqual([
            'PtvAdminLibraries',
            'server-a',
            'available-options',
            'library-a',
            'movies',
            { isNewLibrary: false }
        ]);
        expect(serverA.tasks).toEqual([
            'PtvAdminLibraries',
            'server-a',
            'scan-task',
            { isHidden: false }
        ]);
        expect(create.options).toEqual([
            'PtvAdminLibraries',
            'server-a',
            'available-options',
            'new',
            'movies',
            { isNewLibrary: true }
        ]);
        expect(serverB.list).not.toEqual(serverA.list);
        expect(serverB.detail).not.toEqual(serverA.detail);
        expect(create.options).not.toEqual(serverA.options);
    });
});
