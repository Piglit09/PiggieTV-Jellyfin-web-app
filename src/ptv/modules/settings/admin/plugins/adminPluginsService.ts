import type { Api } from '@jellyfin/sdk';
import type { PackageInfo } from '@jellyfin/sdk/lib/generated-client/models/package-info';
import type { PluginInfo } from '@jellyfin/sdk/lib/generated-client/models/plugin-info';
import { getDashboardApi } from '@jellyfin/sdk/lib/utils/api/dashboard-api';
import { getPackageApi } from '@jellyfin/sdk/lib/utils/api/package-api';
import { getPluginsApi } from '@jellyfin/sdk/lib/utils/api/plugins-api';

import {
    cloneAdminPluginRepositories,
    equalAdminPluginRepositories,
    findAdminPluginUpdateVersion,
    normalizeAdminInstalledPlugins,
    normalizeAdminPluginConfigurationPages,
    normalizeAdminPluginPackages,
    normalizeAdminPluginRepositories,
    normalizeAdminPluginGuid,
    requireAdminPluginGuid
} from './adminPluginsAdapters';
import {
    AdminPluginsServiceError,
    type AdminPluginRepositoryInput,
    type AdminPluginMutationSnapshot,
    type PtvAdminInstalledPlugin,
    type PtvAdminPluginPackage,
    type PtvAdminPluginRepository,
    type PtvAdminPluginVersion,
    type RawAdminPluginConfigurationPage,
    type RawAdminPluginInfo,
    type RawAdminPluginPackage,
    type RawAdminPluginRepository
} from './adminPluginsModel';

type PluginAction = 'disable' | 'enable' | 'install' | 'uninstall' | 'update';

const pluginActionFlights = new WeakMap<Api, Map<string, Promise<AdminPluginMutationSnapshot>>>();
const repositoryActionFlights = new WeakMap<Api, Promise<readonly RawAdminPluginRepository[]>>();

function isAbortError(error: unknown) {
    return (
        (typeof DOMException !== 'undefined'
            && error instanceof DOMException
            && error.name === 'AbortError')
        || (typeof error === 'object' && error !== null && (
            Reflect.get(error, 'code') === 'ERR_CANCELED'
            || Reflect.get(error, 'name') === 'CanceledError'
        ))
    );
}

function cloneRecords<T extends Record<string, unknown>>(records: readonly T[]) {
    return records.map(record => ({ ...record }));
}

function sourceError(error: unknown, source: 'catalog' | 'configuration' | 'installed' | 'repositories'): never {
    if (error instanceof AdminPluginsServiceError || isAbortError(error)) throw error;
    const messages = {
        catalog: 'The plugin catalog could not be loaded.',
        configuration: 'Plugin configuration links could not be loaded.',
        installed: 'Installed plugins could not be loaded.',
        repositories: 'Plugin repositories could not be loaded.'
    } as const;
    throw new AdminPluginsServiceError(
        source === 'repositories' ? 'repository-unavailable' : 'source-unavailable',
        messages[source]
    );
}

function operationError(error: unknown, action: PluginAction): never {
    if (error instanceof AdminPluginsServiceError || isAbortError(error)) throw error;
    const messages: Record<PluginAction, string> = {
        disable: 'The plugin could not be disabled.',
        enable: 'The plugin could not be enabled.',
        install: 'The plugin could not be installed.',
        uninstall: 'The plugin could not be uninstalled.',
        update: 'The plugin could not be updated.'
    };
    throw new AdminPluginsServiceError('operation-failed', messages[action]);
}

function repositoryError(error: unknown): never {
    if (error instanceof AdminPluginsServiceError || isAbortError(error)) throw error;
    throw new AdminPluginsServiceError(
        'operation-failed',
        'Plugin repositories could not be saved.'
    );
}

export async function loadAdminInstalledPluginSource(
    api: Api,
    signal?: AbortSignal
): Promise<RawAdminPluginInfo[]> {
    try {
        const response = await getPluginsApi(api).getPlugins({ signal });
        if (!Array.isArray(response.data)) {
            throw new AdminPluginsServiceError('invalid-response', 'Installed plugin information was invalid.');
        }
        normalizeAdminInstalledPlugins(response.data);
        return response.data as RawAdminPluginInfo[];
    } catch (error) {
        return sourceError(error, 'installed');
    }
}

export async function loadAdminPluginCatalogSource(
    api: Api,
    signal?: AbortSignal
): Promise<RawAdminPluginPackage[]> {
    try {
        const response = await getPackageApi(api).getPackages({ signal });
        if (!Array.isArray(response.data)) {
            throw new AdminPluginsServiceError('invalid-response', 'Plugin catalog information was invalid.');
        }
        normalizeAdminPluginPackages(response.data);
        return response.data as RawAdminPluginPackage[];
    } catch (error) {
        return sourceError(error, 'catalog');
    }
}

export async function loadAdminPluginRepositorySource(
    api: Api,
    signal?: AbortSignal
): Promise<RawAdminPluginRepository[]> {
    try {
        const response = await getPackageApi(api).getRepositories({ signal });
        if (!Array.isArray(response.data)) {
            throw new AdminPluginsServiceError('invalid-response', 'Plugin repository information was invalid.');
        }
        normalizeAdminPluginRepositories(response.data as RawAdminPluginRepository[]);
        return cloneAdminPluginRepositories(response.data as RawAdminPluginRepository[]);
    } catch (error) {
        return sourceError(error, 'repositories');
    }
}

export async function loadAdminPluginConfigurationPageSource(
    api: Api,
    params: Readonly<{ enableInMainMenu?: boolean }> = {},
    signal?: AbortSignal
): Promise<RawAdminPluginConfigurationPage[]> {
    try {
        const response = await getDashboardApi(api).getConfigurationPages(params, { signal });
        if (!Array.isArray(response.data)) {
            throw new AdminPluginsServiceError('invalid-response', 'Plugin configuration information was invalid.');
        }
        normalizeAdminPluginConfigurationPages(response.data);
        return response.data as RawAdminPluginConfigurationPage[];
    } catch (error) {
        return sourceError(error, 'configuration');
    }
}

function exactInstalledRevision(
    rawPlugins: readonly PluginInfo[],
    pluginId: string,
    version: string
) {
    const matches = rawPlugins.filter(plugin => (
        normalizeAdminPluginGuid(plugin.Id) === pluginId
        && plugin.Version === version
    ));
    if (matches.length !== 1) {
        throw new AdminPluginsServiceError(
            matches.length ? 'conflict' : 'not-found',
            matches.length ?
                'Plugin state is ambiguous. Restart the server and refresh before trying again.' :
                'This plugin revision is no longer installed.'
        );
    }
    return matches[0];
}

function exactCatalogSelection(
    rawPackages: readonly PackageInfo[],
    packageInfo: PtvAdminPluginPackage,
    selectedVersion: PtvAdminPluginVersion
) {
    const id = requireAdminPluginGuid(packageInfo.id);
    const currentPackage = rawPackages.find(candidate => normalizeAdminPluginGuid(candidate.guid) === id);
    if (!currentPackage?.name || !Array.isArray(currentPackage.versions)) {
        throw new AdminPluginsServiceError('not-found', 'This plugin is no longer available in the catalog.');
    }
    if (!selectedVersion.repositoryUrl) {
        throw new AdminPluginsServiceError(
            'invalid-input',
            'The selected plugin source is unavailable. Refresh the catalog.'
        );
    }
    const selectedRepositoryUrl = String(selectedVersion.repositoryUrl);
    const matches = currentPackage.versions.filter(version => (
        version.version === selectedVersion.version
        && String(version.repositoryUrl || '') === selectedRepositoryUrl
    ));
    if (matches.length !== 1) {
        throw new AdminPluginsServiceError(
            matches.length ? 'conflict' : 'state-changed',
            'The selected plugin revision changed in the catalog. Refresh before trying again.'
        );
    }
    return {
        id,
        name: currentPackage.name,
        repositoryUrl: selectedVersion.repositoryUrl,
        version: selectedVersion.version
    };
}

async function loadPluginMutationSnapshot(
    api: Api,
    signal?: AbortSignal
): Promise<AdminPluginMutationSnapshot> {
    return {
        installed: await loadAdminInstalledPluginSource(api, signal)
    };
}

function pluginSingleFlight(
    api: Api,
    pluginId: string,
    run: () => Promise<AdminPluginMutationSnapshot>
) {
    let flights = pluginActionFlights.get(api);
    if (!flights) {
        flights = new Map();
        pluginActionFlights.set(api, flights);
    }
    const current = flights.get(pluginId);
    if (current) return current;
    const flight = run().finally(() => {
        if (flights?.get(pluginId) === flight) flights.delete(pluginId);
    });
    flights.set(pluginId, flight);
    return flight;
}

function verifyInstalledRevision(
    snapshot: AdminPluginMutationSnapshot,
    pluginId: string,
    version: string
) {
    const match = snapshot.installed.find(plugin => (
        normalizeAdminPluginGuid(plugin.Id) === pluginId && plugin.Version === version
    ));
    if (!match) {
        throw new AdminPluginsServiceError(
            'verification-failed',
            'The server accepted the request, but the installed revision could not be confirmed.'
        );
    }
}

export function installAdminPlugin(
    api: Api,
    packageInfo: PtvAdminPluginPackage,
    selectedVersion: PtvAdminPluginVersion,
    signal?: AbortSignal
) {
    const id = requireAdminPluginGuid(packageInfo.id);
    return pluginSingleFlight(api, id, async () => {
        try {
            const [ rawPlugins, rawPackages ] = await Promise.all([
                loadAdminInstalledPluginSource(api, signal),
                loadAdminPluginCatalogSource(api, signal)
            ]);
            if (rawPlugins.some(plugin => normalizeAdminPluginGuid(plugin.Id) === id)) {
                throw new AdminPluginsServiceError(
                    'state-changed',
                    'This plugin is already installed. Refresh before choosing an update.'
                );
            }
            const selection = exactCatalogSelection(rawPackages, packageInfo, selectedVersion);
            await getPackageApi(api).installPackage({
                assemblyGuid: selection.id,
                name: selection.name,
                repositoryUrl: selection.repositoryUrl,
                version: selection.version
            }, { signal });
            const snapshot = await loadPluginMutationSnapshot(api, signal);
            verifyInstalledRevision(snapshot, id, selection.version);
            return snapshot;
        } catch (error) {
            return operationError(error, 'install');
        }
    });
}

export function updateAdminPlugin(
    api: Api,
    packageInfo: PtvAdminPluginPackage,
    installed: PtvAdminInstalledPlugin,
    selectedVersion: PtvAdminPluginVersion,
    signal?: AbortSignal
) {
    const id = requireAdminPluginGuid(installed.id);
    if (requireAdminPluginGuid(packageInfo.id) !== id) {
        return Promise.reject(new AdminPluginsServiceError('invalid-input', 'Choose a valid plugin update.'));
    }
    return pluginSingleFlight(api, id, async () => {
        try {
            const [ rawPlugins, rawPackages ] = await Promise.all([
                loadAdminInstalledPluginSource(api, signal),
                loadAdminPluginCatalogSource(api, signal)
            ]);
            exactInstalledRevision(rawPlugins, id, installed.version);
            const selection = exactCatalogSelection(rawPackages, packageInfo, selectedVersion);
            const currentPackage = normalizeAdminPluginPackages(rawPackages)
                .find(candidate => candidate.id === id);
            const installedIndex = currentPackage?.versions
                .findIndex(version => version.version === installed.version) ?? -1;
            const selectedIndex = currentPackage?.versions.findIndex(version => (
                version.version === selection.version
                && version.repositoryUrl === selection.repositoryUrl
            )) ?? -1;
            if (installedIndex <= 0 || selectedIndex < 0 || selectedIndex >= installedIndex
                || !findAdminPluginUpdateVersion(currentPackage?.versions || [], installed.version)) {
                throw new AdminPluginsServiceError(
                    'state-changed',
                    'A newer compatible revision could not be verified. Refresh the catalog.'
                );
            }
            await getPackageApi(api).installPackage({
                assemblyGuid: selection.id,
                name: selection.name,
                repositoryUrl: selection.repositoryUrl,
                version: selection.version
            }, { signal });
            const snapshot = await loadPluginMutationSnapshot(api, signal);
            verifyInstalledRevision(snapshot, id, selection.version);
            return snapshot;
        } catch (error) {
            return operationError(error, 'update');
        }
    });
}

function changeAdminPluginState(
    api: Api,
    installed: PtvAdminInstalledPlugin,
    action: 'enable' | 'disable',
    signal?: AbortSignal
) {
    const id = requireAdminPluginGuid(installed.id);
    return pluginSingleFlight(api, id, async () => {
        try {
            const rawPlugins = await loadAdminInstalledPluginSource(api, signal);
            const current = exactInstalledRevision(rawPlugins, id, installed.version);
            const expectedStatus = action === 'enable' ? 'Disabled' : 'Active';
            if (current.Status !== expectedStatus) {
                throw new AdminPluginsServiceError(
                    'state-changed',
                    `This plugin can no longer be ${action}d. Refresh before trying again.`
                );
            }
            const request = { pluginId: id, version: installed.version };
            if (action === 'enable') {
                await getPluginsApi(api).enablePlugin(request, { signal });
            } else {
                await getPluginsApi(api).disablePlugin(request, { signal });
            }
            const snapshot = await loadPluginMutationSnapshot(api, signal);
            const verified = exactInstalledRevision(snapshot.installed, id, installed.version);
            if (verified.Status !== 'Restart') {
                throw new AdminPluginsServiceError(
                    'verification-failed',
                    'The server accepted the request, but pending-restart state could not be confirmed.'
                );
            }
            return snapshot;
        } catch (error) {
            return operationError(error, action);
        }
    });
}

export function enableAdminPlugin(
    api: Api,
    installed: PtvAdminInstalledPlugin,
    signal?: AbortSignal
) {
    return changeAdminPluginState(api, installed, 'enable', signal);
}

export function disableAdminPlugin(
    api: Api,
    installed: PtvAdminInstalledPlugin,
    signal?: AbortSignal
) {
    return changeAdminPluginState(api, installed, 'disable', signal);
}

export function uninstallAdminPlugin(
    api: Api,
    installed: PtvAdminInstalledPlugin,
    signal?: AbortSignal
) {
    const id = requireAdminPluginGuid(installed.id);
    return pluginSingleFlight(api, id, async () => {
        try {
            const rawPlugins = await loadAdminInstalledPluginSource(api, signal);
            const current = exactInstalledRevision(rawPlugins, id, installed.version);
            if (current.CanUninstall !== true || current.Status === 'Deleted') {
                throw new AdminPluginsServiceError(
                    'state-changed',
                    'This plugin can no longer be uninstalled. Refresh before trying again.'
                );
            }
            await getPluginsApi(api).uninstallPluginByVersion({
                pluginId: id,
                version: installed.version
            }, { signal });
            const snapshot = await loadPluginMutationSnapshot(api, signal);
            const remaining = snapshot.installed.find(plugin => (
                normalizeAdminPluginGuid(plugin.Id) === id && plugin.Version === installed.version
            ));
            if (remaining && remaining.Status !== 'Deleted') {
                throw new AdminPluginsServiceError(
                    'verification-failed',
                    'The server accepted the request, but plugin removal could not be confirmed.'
                );
            }
            return snapshot;
        } catch (error) {
            return operationError(error, 'uninstall');
        }
    });
}

function validateRepositoryInput(input: AdminPluginRepositoryInput) {
    const name = typeof input?.name === 'string' ? input.name.trim() : '';
    const value = typeof input?.url === 'string' ? input.url.trim() : '';
    if (!name || !value) {
        throw new AdminPluginsServiceError('invalid-input', 'Enter a repository name and manifest URL.');
    }
    let parsed: URL;
    try {
        // URL is already required by the current Jellyfin browser runtime.
        // eslint-disable-next-line compat/compat
        parsed = new URL(value);
    } catch {
        throw new AdminPluginsServiceError('invalid-input', 'Enter a valid repository manifest URL.');
    }
    if (!parsed.protocol) {
        throw new AdminPluginsServiceError(
            'invalid-input',
            'Enter an absolute repository manifest URL.'
        );
    }
    if (parsed.username || parsed.password) {
        throw new AdminPluginsServiceError(
            'invalid-input',
            'Repository URLs cannot include credentials.'
        );
    }
    return { Enabled: input.enabled !== false, Name: name, Url: value };
}

function repositoryBaseline(baseline: readonly PtvAdminPluginRepository[]) {
    if (!Array.isArray(baseline)) {
        throw new AdminPluginsServiceError('invalid-input', 'Reload plugin repositories before saving.');
    }
    return cloneAdminPluginRepositories(baseline.map(repository => repository.raw));
}

function assertFreshRepositoryBaseline(
    authoritative: readonly RawAdminPluginRepository[],
    baseline: readonly RawAdminPluginRepository[]
) {
    if (!equalAdminPluginRepositories(authoritative, baseline)) {
        throw new AdminPluginsServiceError(
            'repository-conflict',
            'Plugin repositories changed on the server while you were editing. Reload before saving.'
        );
    }
}

function findRepositoryIndex(
    target: PtvAdminPluginRepository,
    baseline: readonly RawAdminPluginRepository[]
) {
    if (!Number.isInteger(target.index) || target.index < 0 || target.index >= baseline.length
        || !equalAdminPluginRepositories([ target.raw ], [ baseline[target.index] ])) {
        throw new AdminPluginsServiceError(
            'conflict',
            'This repository changed while the page was open. Reload before saving.'
        );
    }
    return target.index;
}

function assertUniqueRepositoryUrl(
    repositories: readonly RawAdminPluginRepository[],
    url: string,
    excludedIndex = -1
) {
    if (repositories.some((repository, index) => (
        index !== excludedIndex
        && typeof repository.Url === 'string'
        && repository.Url.trim().toLowerCase() === url.toLowerCase()
    ))) {
        throw new AdminPluginsServiceError('invalid-input', 'That repository URL is already configured.');
    }
}

function repositorySingleFlight(
    api: Api,
    run: () => Promise<readonly RawAdminPluginRepository[]>
) {
    const current = repositoryActionFlights.get(api);
    if (current) return current;
    const flight = run().finally(() => {
        if (repositoryActionFlights.get(api) === flight) repositoryActionFlights.delete(api);
    });
    repositoryActionFlights.set(api, flight);
    return flight;
}

async function writeAndVerifyRepositories(
    api: Api,
    desired: readonly RawAdminPluginRepository[],
    signal?: AbortSignal
) {
    const document = cloneAdminPluginRepositories(desired);
    await getPackageApi(api).setRepositories({ repositoryInfo: document }, { signal });
    const confirmed = await loadAdminPluginRepositorySource(api, signal);
    if (!equalAdminPluginRepositories(confirmed, document)) {
        throw new AdminPluginsServiceError(
            'verification-failed',
            'The server accepted the request, but the repository list could not be confirmed.'
        );
    }
    return confirmed;
}

export function addAdminPluginRepository(
    api: Api,
    input: AdminPluginRepositoryInput,
    baseline: readonly PtvAdminPluginRepository[],
    signal?: AbortSignal
) {
    return repositorySingleFlight(api, async () => {
        try {
            const nextRepository = validateRepositoryInput(input);
            const confirmedBaseline = repositoryBaseline(baseline);
            const authoritative = await loadAdminPluginRepositorySource(api, signal);
            assertFreshRepositoryBaseline(authoritative, confirmedBaseline);
            assertUniqueRepositoryUrl(authoritative, nextRepository.Url);
            return await writeAndVerifyRepositories(api, [ ...authoritative, nextRepository ], signal);
        } catch (error) {
            return repositoryError(error);
        }
    });
}

export function editAdminPluginRepository(
    api: Api,
    target: PtvAdminPluginRepository,
    input: AdminPluginRepositoryInput,
    baseline: readonly PtvAdminPluginRepository[],
    signal?: AbortSignal
) {
    return repositorySingleFlight(api, async () => {
        try {
            const patch = validateRepositoryInput(input);
            const confirmedBaseline = repositoryBaseline(baseline);
            const authoritative = await loadAdminPluginRepositorySource(api, signal);
            assertFreshRepositoryBaseline(authoritative, confirmedBaseline);
            const index = findRepositoryIndex(target, confirmedBaseline);
            assertUniqueRepositoryUrl(authoritative, patch.Url, index);
            const desired = cloneAdminPluginRepositories(authoritative);
            desired[index] = { ...desired[index], ...patch };
            return await writeAndVerifyRepositories(api, desired, signal);
        } catch (error) {
            return repositoryError(error);
        }
    });
}

export function removeAdminPluginRepository(
    api: Api,
    target: PtvAdminPluginRepository,
    baseline: readonly PtvAdminPluginRepository[],
    signal?: AbortSignal
) {
    return repositorySingleFlight(api, async () => {
        try {
            const confirmedBaseline = repositoryBaseline(baseline);
            const authoritative = await loadAdminPluginRepositorySource(api, signal);
            assertFreshRepositoryBaseline(authoritative, confirmedBaseline);
            const index = findRepositoryIndex(target, confirmedBaseline);
            return await writeAndVerifyRepositories(
                api,
                authoritative.filter((_, currentIndex) => currentIndex !== index),
                signal
            );
        } catch (error) {
            return repositoryError(error);
        }
    });
}

/** Primarily useful to tests and cache consumers that need an opaque clone. */
export function normalizeRepositorySourceForCache(raw: readonly RawAdminPluginRepository[]) {
    normalizeAdminPluginRepositories(raw);
    return cloneRecords(raw);
}
