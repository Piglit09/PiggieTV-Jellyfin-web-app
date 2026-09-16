import type { Api } from '@jellyfin/sdk';
import type { ConfigurationPageInfo } from '@jellyfin/sdk/lib/generated-client/models/configuration-page-info';
import type { PackageInfo } from '@jellyfin/sdk/lib/generated-client/models/package-info';
import type { PluginInfo } from '@jellyfin/sdk/lib/generated-client/models/plugin-info';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
    addAdminPluginRepository: vi.fn(),
    disableAdminPlugin: vi.fn(),
    editAdminPluginRepository: vi.fn(),
    enableAdminPlugin: vi.fn(),
    installAdminPlugin: vi.fn(),
    loadAdminInstalledPluginSource: vi.fn(),
    loadAdminPluginCatalogSource: vi.fn(),
    loadAdminPluginConfigurationPageSource: vi.fn(),
    loadAdminPluginRepositorySource: vi.fn(),
    removeAdminPluginRepository: vi.fn(),
    uninstallAdminPlugin: vi.fn(),
    updateAdminPlugin: vi.fn()
}));

vi.mock('./adminPluginsService', () => serviceMocks);

import type {
    RawAdminPluginInfo,
    RawAdminPluginRepository
} from './adminPluginsModel';
import {
    getAdminPluginsQueryKeys,
    useAdminInstalledPlugins,
    useAdminPluginCatalog,
    useAdminPluginDetail,
    useAdminPluginRepositories
} from './useAdminPlugins';

/* Jellyfin plugin revision fixtures resemble IPv4 addresses. */
/* eslint-disable sonarjs/no-hardcoded-ip */

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

const PLUGIN_ID = '11111111222233334444555555555555';
const OTHER_PLUGIN_ID = 'aaaaaaaa222233334444555555555555';
const api = {
    getUri: (path: string) => path
} as unknown as Api;
const apiClient = {
    serverId: () => 'server-a'
} as unknown as ApiClient;

function pluginInfo(overrides: Partial<PluginInfo> = {}): PluginInfo {
    return {
        CanUninstall: true,
        Description: 'Installed plugin.',
        HasImage: true,
        Id: PLUGIN_ID,
        Name: 'Example',
        Status: 'Active',
        Version: '1.0.0.0',
        ...overrides
    };
}

function packageInfo(overrides: Partial<PackageInfo> = {}): PackageInfo {
    return {
        guid: PLUGIN_ID,
        name: 'Example',
        versions: [
            {
                repositoryName: 'Official',
                repositoryUrl: 'https://repo.test/manifest.json',
                version: '2.0.0.0'
            },
            {
                repositoryName: 'Official',
                repositoryUrl: 'https://repo.test/manifest.json',
                version: '1.0.0.0'
            }
        ],
        ...overrides
    };
}

const configurationPage: ConfigurationPageInfo = {
    DisplayName: 'Example settings',
    Name: 'example-settings',
    PluginId: PLUGIN_ID
};
const rawRepositories: RawAdminPluginRepository[] = [ {
    Enabled: true,
    Name: 'Official',
    Url: 'https://repo.test/manifest.json',
    VendorField: { preserve: true }
} ];

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

type InstalledState = ReturnType<typeof useAdminInstalledPlugins>;
type CatalogState = ReturnType<typeof useAdminPluginCatalog>;
type DetailState = ReturnType<typeof useAdminPluginDetail>;
type RepositoryState = ReturnType<typeof useAdminPluginRepositories>;

function InstalledHarness({ stateRef }: Readonly<{
    stateRef: { current?: InstalledState };
}>) {
    stateRef.current = useAdminInstalledPlugins(api, apiClient);
    return null;
}

function CatalogHarness({ stateRef }: Readonly<{
    stateRef: { current?: CatalogState };
}>) {
    stateRef.current = useAdminPluginCatalog(api, apiClient);
    return null;
}

function DetailHarness({ pluginId = PLUGIN_ID, stateRef }: Readonly<{
    pluginId?: string;
    stateRef: { current?: DetailState };
}>) {
    stateRef.current = useAdminPluginDetail(api, apiClient, pluginId);
    return null;
}

function RepositoryHarness({ stateRef }: Readonly<{
    stateRef: { current?: RepositoryState };
}>) {
    stateRef.current = useAdminPluginRepositories(api, apiClient);
    return null;
}

function UnresolvedHarness({ stateRef }: Readonly<{
    stateRef: { current?: InstalledState };
}>) {
    stateRef.current = useAdminInstalledPlugins(
        api,
        { serverId: () => '' } as unknown as ApiClient
    );
    return null;
}

async function flushQueries() {
    await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
        await Promise.resolve();
    });
}

describe('native Plugin Administration hooks', () => {
    let container: HTMLDivElement;
    let queryClient: QueryClient;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        serviceMocks.loadAdminInstalledPluginSource.mockResolvedValue([ pluginInfo() ]);
        serviceMocks.loadAdminPluginCatalogSource.mockResolvedValue([ packageInfo() ]);
        serviceMocks.loadAdminPluginConfigurationPageSource.mockResolvedValue([ configurationPage ]);
        serviceMocks.loadAdminPluginRepositorySource.mockResolvedValue(rawRepositories);
        serviceMocks.addAdminPluginRepository.mockResolvedValue(rawRepositories);
        serviceMocks.editAdminPluginRepository.mockResolvedValue(rawRepositories);
        serviceMocks.removeAdminPluginRepository.mockResolvedValue(rawRepositories);
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
    });

    it('isolates every source query by server and reuses the shared configuration-page key', () => {
        const serverA = getAdminPluginsQueryKeys('server-a', PLUGIN_ID);
        const serverB = getAdminPluginsQueryKeys('server-b', PLUGIN_ID);

        expect(serverA.installed).toEqual([ 'PtvAdminPlugins', 'server-a', 'installed' ]);
        expect(serverA.catalog).toEqual([ 'PtvAdminPlugins', 'server-a', 'catalog' ]);
        expect(serverA.repositories).toEqual([ 'PtvAdminPlugins', 'server-a', 'repositories' ]);
        expect(serverA.configurationPages).toEqual([ 'ConfigurationPages', 'server-a', undefined ]);
        expect(serverA.mainMenuConfigurationPages).toEqual([ 'ConfigurationPages', 'server-a', true ]);
        expect(serverA.detail).not.toEqual(serverB.detail);
    });

    it('loads only installed/configuration sources and groups retained revisions for list UI', async () => {
        serviceMocks.loadAdminInstalledPluginSource.mockResolvedValue([
            pluginInfo({ Status: 'Superseded', Version: '1.0.0.0' }),
            pluginInfo({ Name: 'Pending revision', Status: 'Restart', Version: '2.0.0.0' }),
            pluginInfo({ Id: OTHER_PLUGIN_ID, Name: 'Other plugin' })
        ]);
        const stateRef: { current?: InstalledState } = {};

        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <InstalledHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(serviceMocks.loadAdminInstalledPluginSource).toHaveBeenCalledOnce();
        expect(serviceMocks.loadAdminPluginConfigurationPageSource).toHaveBeenCalledOnce();
        expect(serviceMocks.loadAdminPluginConfigurationPageSource).toHaveBeenCalledWith(
            api,
            { enableInMainMenu: true },
            expect.any(AbortSignal)
        );
        expect(serviceMocks.loadAdminPluginCatalogSource).not.toHaveBeenCalled();
        expect(serviceMocks.loadAdminPluginRepositorySource).not.toHaveBeenCalled();
        expect(stateRef.current?.plugins).toHaveLength(2);
        expect(stateRef.current?.plugins[0]).toMatchObject({
            name: 'Pending revision',
            status: 'restart',
            version: '2.0.0.0'
        });
        expect(stateRef.current?.plugins[0].configurationPages).toHaveLength(1);
    });

    it('does not read or mutate before stable server identity is available', async () => {
        const stateRef: { current?: InstalledState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <UnresolvedHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(serviceMocks.loadAdminInstalledPluginSource).not.toHaveBeenCalled();
        expect(serviceMocks.loadAdminPluginConfigurationPageSource).not.toHaveBeenCalled();
        await act(async () => {
            expect(await stateRef.current!.disablePlugin({ id: PLUGIN_ID } as never)).toBe(false);
        });
        expect(serviceMocks.disableAdminPlugin).not.toHaveBeenCalled();
    });

    it('reuses the shell main-menu configuration-page cache without a duplicate request', async () => {
        const stateRef: { current?: InstalledState } = {};
        queryClient.setQueryData(
            getAdminPluginsQueryKeys('server-a').mainMenuConfigurationPages,
            [ configurationPage ]
        );

        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <InstalledHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(serviceMocks.loadAdminPluginConfigurationPageSource).not.toHaveBeenCalled();
        expect(stateRef.current?.plugins[0].configurationPages).toHaveLength(1);
    });

    it('loads catalog and installed inventory once without configuration or repository requests', async () => {
        const stateRef: { current?: CatalogState } = {};

        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <CatalogHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(serviceMocks.loadAdminPluginCatalogSource).toHaveBeenCalledOnce();
        expect(serviceMocks.loadAdminInstalledPluginSource).toHaveBeenCalledOnce();
        expect(serviceMocks.loadAdminPluginConfigurationPageSource).not.toHaveBeenCalled();
        expect(serviceMocks.loadAdminPluginRepositorySource).not.toHaveBeenCalled();
        expect(stateRef.current?.packages[0]).toMatchObject({
            installedVersion: '1.0.0.0',
            isInstalled: true
        });
        expect(stateRef.current?.packages[0].updateVersion?.version).toBe('2.0.0.0');
        expect(stateRef.current?.installedSourceAvailable).toBe(true);
        expect(stateRef.current?.installedSourceLoading).toBe(false);
    });

    it('marks installed state unavailable while a faster catalog result is already visible', async () => {
        const installed = deferred<PluginInfo[]>();
        serviceMocks.loadAdminInstalledPluginSource.mockReturnValueOnce(installed.promise);
        const stateRef: { current?: CatalogState } = {};

        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <CatalogHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(stateRef.current?.packages).toHaveLength(1);
        expect(stateRef.current?.installedSourceAvailable).toBe(false);
        expect(stateRef.current?.installedSourceLoading).toBe(true);

        await act(async () => {
            installed.resolve([ pluginInfo() ]);
            await installed.promise;
        });
        await flushQueries();
        expect(stateRef.current?.installedSourceAvailable).toBe(true);
    });

    it('keeps installed detail usable when optional configuration discovery fails', async () => {
        serviceMocks.loadAdminPluginConfigurationPageSource.mockRejectedValue(
            new Error('configuration endpoint unavailable')
        );
        const stateRef: { current?: DetailState } = {};

        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <DetailHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(serviceMocks.loadAdminInstalledPluginSource).toHaveBeenCalledOnce();
        expect(serviceMocks.loadAdminPluginCatalogSource).toHaveBeenCalledOnce();
        expect(serviceMocks.loadAdminPluginConfigurationPageSource).toHaveBeenCalledOnce();
        expect(stateRef.current?.detail?.installed?.id).toBe(PLUGIN_ID);
        expect(stateRef.current?.configurationPagesError).toBe(true);
        expect(stateRef.current?.error).toBeNull();
        expect(stateRef.current?.installedSourceAvailable).toBe(true);
    });

    it('renders catalog-only detail while marking failed installed authority unavailable', async () => {
        serviceMocks.loadAdminInstalledPluginSource.mockRejectedValue(
            new Error('installed registry unavailable')
        );
        const stateRef: { current?: DetailState } = {};

        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <DetailHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(stateRef.current?.detail?.package?.id).toBe(PLUGIN_ID);
        expect(stateRef.current?.detail?.installed).toBeNull();
        expect(stateRef.current?.installedSourceAvailable).toBe(false);
        expect(stateRef.current?.installedSourceError).toBe(true);
        expect(stateRef.current?.error).toBeNull();
    });

    it('does not start source requests for an invalid detail address', async () => {
        const stateRef: { current?: DetailState } = {};

        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <DetailHarness pluginId='not-a-guid' stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(serviceMocks.loadAdminInstalledPluginSource).not.toHaveBeenCalled();
        expect(serviceMocks.loadAdminPluginCatalogSource).not.toHaveBeenCalled();
        expect(serviceMocks.loadAdminPluginConfigurationPageSource).not.toHaveBeenCalled();
        expect(stateRef.current?.error).toMatchObject({ code: 'invalid-input' });
    });

    it('keeps manual refresh single-flight and refreshes only the current workspace sources', async () => {
        const stateRef: { current?: InstalledState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <InstalledHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();
        const installed = deferred<PluginInfo[]>();
        const pages = deferred<ConfigurationPageInfo[]>();
        serviceMocks.loadAdminInstalledPluginSource.mockReturnValueOnce(installed.promise);
        serviceMocks.loadAdminPluginConfigurationPageSource.mockReturnValueOnce(pages.promise);

        let first!: Promise<unknown>;
        let second!: Promise<unknown>;
        await act(async () => {
            first = stateRef.current!.refresh();
            second = stateRef.current!.refresh();
            await Promise.resolve();
        });

        expect(first).toBe(second);
        expect(serviceMocks.loadAdminInstalledPluginSource).toHaveBeenCalledTimes(2);
        expect(serviceMocks.loadAdminPluginConfigurationPageSource).toHaveBeenCalledTimes(2);
        expect(serviceMocks.loadAdminPluginCatalogSource).not.toHaveBeenCalled();

        await act(async () => {
            installed.resolve([ pluginInfo() ]);
            pages.resolve([ configurationPage ]);
            await first;
        });
    });

    it('keeps a plugin mutation single-flight and installs verified raw state in exact cache', async () => {
        const stateRef: { current?: InstalledState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <InstalledHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();
        const confirmed = [ pluginInfo({ Status: 'Restart' }) ] as RawAdminPluginInfo[];
        const mutation = deferred<{
            installed: readonly RawAdminPluginInfo[];
        }>();
        serviceMocks.disableAdminPlugin.mockReturnValue(mutation.promise);

        let first!: Promise<boolean>;
        let second!: Promise<boolean>;
        await act(async () => {
            const selected = stateRef.current!.plugins[0];
            first = stateRef.current!.disablePlugin(selected);
            second = stateRef.current!.disablePlugin(selected);
            await Promise.resolve();
        });

        expect(first).toBe(second);
        expect(serviceMocks.disableAdminPlugin).toHaveBeenCalledOnce();
        expect(stateRef.current?.actionStateByPlugin[PLUGIN_ID]).toBe('disabling');

        await act(async () => {
            mutation.resolve({ installed: confirmed });
            await first;
        });

        expect(queryClient.getQueryData(getAdminPluginsQueryKeys('server-a').installed))
            .toEqual(confirmed);
        expect(stateRef.current?.plugins[0].status).toBe('restart');
        expect(stateRef.current?.actionStateByPlugin[PLUGIN_ID]).toBeUndefined();
    });

    it('writes verified repository state to cache and invalidates the catalog', async () => {
        const stateRef: { current?: RepositoryState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <RepositoryHarness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();
        const keys = getAdminPluginsQueryKeys('server-a');
        queryClient.setQueryData(keys.catalog, [ packageInfo() ]);
        const confirmed: RawAdminPluginRepository[] = [
            ...rawRepositories,
            {
                Enabled: false,
                Name: 'Community',
                Url: 'custom+repo://host/manifest',
                Unknown: [ 'preserved' ]
            }
        ];
        serviceMocks.addAdminPluginRepository.mockResolvedValue(confirmed);

        await act(async () => {
            const result = await stateRef.current!.addRepository({
                enabled: false,
                name: 'Community',
                url: 'custom+repo://host/manifest'
            }, stateRef.current!.repositories);
            expect(result).toBe(true);
        });

        expect(serviceMocks.addAdminPluginRepository).toHaveBeenCalledOnce();
        expect(queryClient.getQueryData(keys.repositories)).toEqual(confirmed);
        expect(queryClient.getQueryState(keys.catalog)?.isInvalidated).toBe(true);
        expect(stateRef.current?.repositories[1].raw).toMatchObject({
            Unknown: [ 'preserved' ]
        });
    });
});

/* eslint-enable sonarjs/no-hardcoded-ip */
