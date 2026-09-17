import type { Api } from '@jellyfin/sdk';
import type { PackageInfo } from '@jellyfin/sdk/lib/generated-client/models/package-info';
import type { PluginInfo } from '@jellyfin/sdk/lib/generated-client/models/plugin-info';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    normalizeAdminInstalledPlugins,
    normalizeAdminPluginPackages,
    normalizeAdminPluginRepositories
} from './adminPluginsAdapters';
import type {
    PtvAdminInstalledPlugin,
    PtvAdminPluginPackage,
    PtvAdminPluginVersion,
    RawAdminPluginRepository
} from './adminPluginsModel';

/* Jellyfin plugin revision fixtures resemble IPv4 addresses. */
/* eslint-disable sonarjs/no-hardcoded-ip */

const apiMocks = vi.hoisted(() => ({
    disablePlugin: vi.fn(),
    enablePlugin: vi.fn(),
    getConfigurationPages: vi.fn(),
    getPackages: vi.fn(),
    getPlugins: vi.fn(),
    getRepositories: vi.fn(),
    installPackage: vi.fn(),
    setRepositories: vi.fn(),
    uninstallPluginByVersion: vi.fn()
}));

vi.mock('@jellyfin/sdk/lib/utils/api/dashboard-api', () => ({
    getDashboardApi: () => ({ getConfigurationPages: apiMocks.getConfigurationPages })
}));
vi.mock('@jellyfin/sdk/lib/utils/api/package-api', () => ({
    getPackageApi: () => ({
        getPackages: apiMocks.getPackages,
        getRepositories: apiMocks.getRepositories,
        installPackage: apiMocks.installPackage,
        setRepositories: apiMocks.setRepositories
    })
}));
vi.mock('@jellyfin/sdk/lib/utils/api/plugins-api', () => ({
    getPluginsApi: () => ({
        disablePlugin: apiMocks.disablePlugin,
        enablePlugin: apiMocks.enablePlugin,
        getPlugins: apiMocks.getPlugins,
        uninstallPluginByVersion: apiMocks.uninstallPluginByVersion
    })
}));

import {
    addAdminPluginRepository,
    disableAdminPlugin,
    editAdminPluginRepository,
    installAdminPlugin,
    loadAdminInstalledPluginSource,
    loadAdminPluginCatalogSource,
    loadAdminPluginConfigurationPageSource,
    removeAdminPluginRepository,
    uninstallAdminPlugin,
    updateAdminPlugin
} from './adminPluginsService';

const PLUGIN_ID = '11111111222233334444555555555555';
const api = {} as Api;

function rawPlugin(overrides: Partial<PluginInfo> = {}): PluginInfo {
    return {
        CanUninstall: true,
        Description: 'Example plugin.',
        HasImage: false,
        Id: PLUGIN_ID,
        Name: 'Example',
        Status: 'Active',
        Version: '1.0.0.0',
        ...overrides
    };
}

function rawPackage(overrides: Partial<PackageInfo> = {}): PackageInfo {
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

function normalizedPackage(raw = rawPackage()): PtvAdminPluginPackage {
    return normalizeAdminPluginPackages([ raw ])[0];
}

function normalizedVersion(packageInfo = normalizedPackage(), index = 0): PtvAdminPluginVersion {
    return packageInfo.versions[index];
}

function normalizedInstalled(overrides: Partial<PluginInfo> = {}): PtvAdminInstalledPlugin {
    return normalizeAdminInstalledPlugins([ rawPlugin(overrides) ], [ normalizedPackage() ])[0];
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(next => {
        resolve = next;
    });
    return { promise, resolve };
}

describe('native plugin service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiMocks.getPlugins.mockResolvedValue({ data: [] });
        apiMocks.getPackages.mockResolvedValue({ data: [ rawPackage() ] });
        apiMocks.getConfigurationPages.mockResolvedValue({ data: [] });
        apiMocks.getRepositories.mockResolvedValue({ data: [] });
        apiMocks.installPackage.mockResolvedValue({ data: undefined });
        apiMocks.enablePlugin.mockResolvedValue({ data: undefined });
        apiMocks.disablePlugin.mockResolvedValue({ data: undefined });
        apiMocks.uninstallPluginByVersion.mockResolvedValue({ data: undefined });
        apiMocks.setRepositories.mockResolvedValue({ data: undefined });
    });

    it('loads installed and catalog sources independently and sanitizes failures', async () => {
        apiMocks.getPlugins.mockResolvedValueOnce({ data: [ rawPlugin() ] });
        apiMocks.getPackages.mockRejectedValueOnce(new Error('secret repository response'));

        await expect(loadAdminInstalledPluginSource(api)).resolves.toHaveLength(1);
        await expect(loadAdminPluginCatalogSource(api)).rejects.toMatchObject({
            code: 'source-unavailable',
            message: 'The plugin catalog could not be loaded.'
        });
        expect(apiMocks.getPlugins).toHaveBeenCalledOnce();
        expect(apiMocks.getPackages).toHaveBeenCalledOnce();
    });

    it('passes exact main-menu discovery parameters and an AbortSignal to Jellyfin', async () => {
        // AbortController is already required by TanStack Query/Jellyfin runtime.
        // eslint-disable-next-line compat/compat
        const controller = new AbortController();

        await loadAdminPluginConfigurationPageSource(
            api,
            { enableInMainMenu: true },
            controller.signal
        );

        expect(apiMocks.getConfigurationPages).toHaveBeenCalledWith(
            { enableInMainMenu: true },
            { signal: controller.signal }
        );
    });

    it('installs an exact fresh GUID/version/repository selection and authoritatively verifies it', async () => {
        apiMocks.getPlugins
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [ rawPlugin({ Status: 'Restart', Version: '2.0.0.0' }) ] });
        const packageInfo = normalizedPackage();

        const result = await installAdminPlugin(api, packageInfo, normalizedVersion(packageInfo));

        expect(apiMocks.installPackage).toHaveBeenCalledWith({
            assemblyGuid: PLUGIN_ID,
            name: 'Example',
            repositoryUrl: 'https://repo.test/manifest.json',
            version: '2.0.0.0'
        }, { signal: undefined });
        expect(result.installed[0]).toMatchObject({ Status: 'Restart', Version: '2.0.0.0' });
        expect(apiMocks.getPlugins).toHaveBeenCalledTimes(2);
        expect(apiMocks.getPackages).toHaveBeenCalledOnce();
        expect(apiMocks.getConfigurationPages).not.toHaveBeenCalled();
    });

    it('does not request optional enrichment while confirming a lifecycle mutation', async () => {
        apiMocks.getPlugins
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [ rawPlugin({ Status: 'Restart', Version: '2.0.0.0' }) ] });

        const result = await installAdminPlugin(api, normalizedPackage(), normalizedVersion());

        expect(result.installed).toHaveLength(1);
        expect(apiMocks.getPackages).toHaveBeenCalledOnce();
        expect(apiMocks.getConfigurationPages).not.toHaveBeenCalled();
    });

    it('rejects a stale catalog revision or changed installed state before mutation', async () => {
        apiMocks.getPlugins.mockResolvedValueOnce({ data: [] });
        apiMocks.getPackages.mockResolvedValueOnce({
            data: [ rawPackage({
                versions: [ {
                    repositoryUrl: 'https://other.test/manifest.json',
                    version: '2.0.0.0'
                } ]
            }) ]
        });
        await expect(installAdminPlugin(api, normalizedPackage(), normalizedVersion()))
            .rejects.toMatchObject({ code: 'state-changed' });
        expect(apiMocks.installPackage).not.toHaveBeenCalled();

        apiMocks.getPlugins.mockResolvedValueOnce({ data: [ rawPlugin({ Status: 'Restart' }) ] });
        await expect(disableAdminPlugin(api, normalizedInstalled()))
            .rejects.toMatchObject({ code: 'state-changed' });
        expect(apiMocks.disablePlugin).not.toHaveBeenCalled();
    });

    it('updates only to a server-ordered revision before the exact installed version', async () => {
        apiMocks.getPlugins
            .mockResolvedValueOnce({ data: [ rawPlugin() ] })
            .mockResolvedValueOnce({ data: [ rawPlugin({ Status: 'Restart', Version: '2.0.0.0' }) ] });
        const packageInfo = normalizedPackage();

        await updateAdminPlugin(
            api,
            packageInfo,
            normalizedInstalled(),
            packageInfo.versions[0]
        );
        expect(apiMocks.installPackage).toHaveBeenCalledOnce();

        apiMocks.getPlugins.mockResolvedValueOnce({ data: [ rawPlugin() ] });
        await expect(updateAdminPlugin(
            api,
            packageInfo,
            normalizedInstalled(),
            packageInfo.versions[1]
        )).rejects.toMatchObject({ code: 'state-changed' });
        expect(apiMocks.installPackage).toHaveBeenCalledOnce();
    });

    it('permits disabling a non-uninstallable plugin and verifies pending restart', async () => {
        apiMocks.getPlugins
            .mockResolvedValueOnce({ data: [ rawPlugin({ CanUninstall: false }) ] })
            .mockResolvedValueOnce({
                data: [ rawPlugin({ CanUninstall: false, Status: 'Restart' }) ]
            });

        await disableAdminPlugin(api, normalizedInstalled({ CanUninstall: false }));

        expect(apiMocks.disablePlugin).toHaveBeenCalledWith({
            pluginId: PLUGIN_ID,
            version: '1.0.0.0'
        }, { signal: undefined });
    });

    it('keeps all actions for one plugin single-flight', async () => {
        const pending = deferred<{ data: PluginInfo[] }>();
        apiMocks.getPlugins.mockReturnValueOnce(pending.promise);
        const installed = normalizedInstalled();

        const first = disableAdminPlugin(api, installed);
        const second = uninstallAdminPlugin(api, installed);
        expect(first).toBe(second);
        expect(apiMocks.getPlugins).toHaveBeenCalledOnce();

        apiMocks.getPlugins.mockResolvedValueOnce({ data: [ rawPlugin({ Status: 'Restart' }) ] });
        pending.resolve({ data: [ rawPlugin() ] });
        await first;
        expect(apiMocks.disablePlugin).toHaveBeenCalledOnce();
        expect(apiMocks.uninstallPluginByVersion).not.toHaveBeenCalled();
    });

    it('fresh-checks uninstallability and verifies absence or Deleted state after removal', async () => {
        apiMocks.getPlugins
            .mockResolvedValueOnce({ data: [ rawPlugin() ] })
            .mockResolvedValueOnce({ data: [ rawPlugin({ Status: 'Deleted' }) ] });
        await uninstallAdminPlugin(api, normalizedInstalled());
        expect(apiMocks.uninstallPluginByVersion).toHaveBeenCalledOnce();

        apiMocks.getPlugins.mockResolvedValueOnce({ data: [ rawPlugin({ CanUninstall: false }) ] });
        await expect(uninstallAdminPlugin(api, normalizedInstalled()))
            .rejects.toMatchObject({ code: 'state-changed' });
        expect(apiMocks.uninstallPluginByVersion).toHaveBeenCalledOnce();
    });

    it('fresh-checks the full repository baseline and never writes on conflict', async () => {
        const raw: RawAdminPluginRepository[] = [ {
            Enabled: true,
            Name: 'One',
            Url: 'https://one.test/manifest.json',
            Vendor: { keep: true }
        } ];
        const baseline = normalizeAdminPluginRepositories(raw);
        apiMocks.getRepositories.mockResolvedValueOnce({
            data: [ { ...raw[0], Enabled: false } ]
        });

        await expect(addAdminPluginRepository(api, {
            name: 'Two',
            url: 'https://two.test/manifest.json'
        }, baseline)).rejects.toMatchObject({ code: 'repository-conflict' });
        expect(apiMocks.setRepositories).not.toHaveBeenCalled();
    });

    it('preserves raw unknown repository fields during edit and verifies the full replacement', async () => {
        const raw: RawAdminPluginRepository[] = [ {
            Enabled: false,
            Name: 'One',
            Url: 'custom+repo://host/manifest#channel',
            Vendor: { nested: [ 'keep' ] }
        } ];
        const baseline = normalizeAdminPluginRepositories(raw);
        const confirmed = [ {
            ...raw[0],
            Enabled: true,
            Name: 'Renamed'
        } ];
        apiMocks.getRepositories
            .mockResolvedValueOnce({ data: raw })
            .mockResolvedValueOnce({ data: confirmed });

        await editAdminPluginRepository(api, baseline[0], {
            enabled: true,
            name: 'Renamed',
            url: 'custom+repo://host/manifest#channel'
        }, baseline);

        const written = apiMocks.setRepositories.mock.calls[0][0]
            .repositoryInfo as RawAdminPluginRepository[];
        expect(written).toEqual(confirmed);
        expect(written[0].Vendor).toEqual({ nested: [ 'keep' ] });
        expect(apiMocks.getRepositories).toHaveBeenCalledTimes(2);
    });

    it('rejects credentials in new input without rewriting preserved raw repositories', async () => {
        const raw: RawAdminPluginRepository[] = [ {
            Enabled: true,
            Name: 'Existing credentialed source',
            Url: 'custom+repo://user:pass@host/manifest',
            Unknown: 'preserve'
        } ];
        const baseline = normalizeAdminPluginRepositories(raw);

        await expect(addAdminPluginRepository(api, {
            name: 'Unsafe',
            url: 'https://user:pass@example.test/manifest.json'
        }, baseline)).rejects.toMatchObject({
            code: 'invalid-input',
            message: 'Repository URLs cannot include credentials.'
        });

        expect(apiMocks.getRepositories).not.toHaveBeenCalled();
        expect(apiMocks.setRepositories).not.toHaveBeenCalled();
        expect(baseline[0].raw).toEqual(raw[0]);
    });

    it('uses a full verified write for removal and serializes concurrent repository actions', async () => {
        const raw: RawAdminPluginRepository[] = [
            { Enabled: true, Name: 'One', Url: 'https://one.test/manifest.json' },
            { Enabled: false, Name: 'Two', Url: 'https://two.test/manifest.json', Unknown: 9 }
        ];
        const baseline = normalizeAdminPluginRepositories(raw);
        const pending = deferred<{ data: RawAdminPluginRepository[] }>();
        apiMocks.getRepositories
            .mockReturnValueOnce(pending.promise)
            .mockResolvedValueOnce({ data: [ raw[1] ] });

        const first = removeAdminPluginRepository(api, baseline[0], baseline);
        const second = addAdminPluginRepository(api, {
            name: 'Three',
            url: 'file:///plugins/manifest.json'
        }, baseline);
        expect(first).toBe(second);
        pending.resolve({ data: raw });
        const result = await first;

        expect(apiMocks.setRepositories).toHaveBeenCalledOnce();
        expect(apiMocks.setRepositories.mock.calls[0][0].repositoryInfo).toEqual([ raw[1] ]);
        expect(result).toEqual([ raw[1] ]);
    });
});

/* eslint-enable sonarjs/no-hardcoded-ip */
