import type { ConfigurationPageInfo } from '@jellyfin/sdk/lib/generated-client/models/configuration-page-info';
import type { PackageInfo } from '@jellyfin/sdk/lib/generated-client/models/package-info';
import type { PluginInfo } from '@jellyfin/sdk/lib/generated-client/models/plugin-info';
import { describe, expect, it } from 'vitest';

import {
    cloneAdminPluginRepositories,
    equalAdminPluginRepositories,
    findAdminPluginUpdateVersion,
    groupPrimaryAdminInstalledPlugins,
    normalizeAdminPluginGuid,
    normalizeAdminPluginInventory,
    normalizeAdminPluginRepositories
} from './adminPluginsAdapters';
import { PTV_PLUGIN_GUID } from './adminPluginsModel';

/* Plugin revisions resemble IP addresses; unsafe-scheme input is intentional sanitization coverage. */
/* eslint-disable sonarjs/no-hardcoded-ip, sonarjs/code-eval */

const OTHER_GUID = '11111111222233334444555555555555';

function packageInfo(overrides: Partial<PackageInfo> = {}): PackageInfo {
    return {
        category: 'General',
        description: 'A server plugin.',
        guid: OTHER_GUID,
        imageUrl: 'https://example.test/plugin.png',
        name: 'Example',
        owner: 'Vendor',
        versions: [
            {
                repositoryName: 'Repository B',
                repositoryUrl: 'https://repo-b.test/manifest.json',
                targetAbi: '10.11.0.0',
                version: '2.0.0.0'
            },
            {
                repositoryName: 'Repository A',
                repositoryUrl: 'https://repo-a.test/manifest.json',
                targetAbi: '10.10.0.0',
                version: '10.0.0.0'
            }
        ],
        ...overrides
    };
}

function pluginInfo(status: PluginInfo['Status'], overrides: Partial<PluginInfo> = {}): PluginInfo {
    return {
        CanUninstall: true,
        Description: 'Installed description.',
        HasImage: true,
        Id: OTHER_GUID,
        Name: 'Example',
        Status: status,
        Version: '10.0.0.0',
        ...overrides
    };
}

describe('native plugin adapters', () => {
    it('normalizes compact, dashed and braced GUIDs to one immutable identity', () => {
        expect(normalizeAdminPluginGuid('27C90EE7-7D56-4591-98F8-B0EBCDA8C5FD'))
            .toBe(PTV_PLUGIN_GUID);
        expect(normalizeAdminPluginGuid('{27c90ee7-7d56-4591-98f8-b0ebcda8c5fd}'))
            .toBe(PTV_PLUGIN_GUID);
        expect(normalizeAdminPluginGuid('not-a-guid')).toBeNull();
    });

    it.each([
        [ 'Active', 'active', 'Active', false, true, false ],
        [ 'Restart', 'restart', 'Pending Restart', true, false, false ],
        [ 'Deleted', 'deleted', 'Removal Pending', true, false, false ],
        [ 'Superseded', 'superseded', 'Superseded', true, false, false ],
        [ 'Superceded', 'superseded', 'Superseded', true, false, false ],
        [ 'Malfunctioned', 'malfunctioned', 'Malfunctioned', false, false, false ],
        [ 'NotSupported', 'not-supported', 'Not Supported', false, false, false ],
        [ 'Disabled', 'disabled', 'Disabled', false, false, true ],
        [ 'FutureStatus', 'unknown', 'Unknown', false, false, false ]
    ] as const)(
        'preserves Jellyfin status %s instead of collapsing it to enabled',
        (rawStatus, status, label, restartRequired, canDisable, canEnable) => {
            const result = normalizeAdminPluginInventory([
                pluginInfo(rawStatus as PluginInfo['Status'], { CanUninstall: false })
            ], [], []);
            expect(result.installed[0]).toMatchObject({
                canDisable,
                canEnable,
                canUninstall: false,
                restartRequired,
                status,
                statusLabel: label,
                statusValue: rawStatus
            });
        }
    );

    it('matches every dynamic configuration page by normalized PluginId without N+1 data', () => {
        const pages: ConfigurationPageInfo[] = [
            {
                DisplayName: 'Settings',
                EnableInMainMenu: true,
                Name: 'example-settings',
                PluginId: `{${OTHER_GUID}}`
            },
            {
                DisplayName: 'Diagnostics',
                EnableInMainMenu: false,
                Name: 'example-diagnostics',
                PluginId: OTHER_GUID
            }
        ];
        const result = normalizeAdminPluginInventory(
            [ pluginInfo('Active') ],
            [ packageInfo() ],
            pages,
            (id, version) => `/Plugins/${id}/${version}/Image`
        );

        expect(result.installed[0].configurationPages).toHaveLength(2);
        expect(result.installed[0].configurationPages.map(page => page.href)).toEqual([
            '#/configurationpage?name=example-settings',
            '#/configurationpage?name=example-diagnostics'
        ]);
        expect(result.installed[0].imageUrl)
            .toBe(`/Plugins/${OTHER_GUID}/10.0.0.0/Image`);
    });

    it('groups retained revisions into one stable primary row per plugin GUID', () => {
        const firstGuid = 'aaaaaaaa111122223333444444444444';
        const result = normalizeAdminPluginInventory([
            pluginInfo('Superseded', {
                Id: firstGuid,
                Name: 'First old revision',
                Version: '1.0.0.0'
            }),
            pluginInfo('Active', {
                Id: OTHER_GUID,
                Name: 'Second plugin',
                Version: '1.0.0.0'
            }),
            pluginInfo('Restart', {
                Id: firstGuid,
                Name: 'First pending revision',
                Version: '2.0.0.0'
            })
        ], [], []);

        const grouped = groupPrimaryAdminInstalledPlugins(result.installed);

        expect(grouped).toHaveLength(2);
        expect(grouped.map(plugin => plugin.id)).toEqual([ firstGuid, OTHER_GUID ]);
        expect(grouped[0]).toMatchObject({
            key: `${firstGuid}:2.0.0.0`,
            name: 'First pending revision',
            status: 'restart',
            version: '2.0.0.0'
        });
    });

    it('never promotes a remote catalog image into installed-plugin authority', () => {
        const withoutServerImage = normalizeAdminPluginInventory(
            [ pluginInfo('Active', { HasImage: false }) ],
            [ packageInfo() ],
            [],
            (id, version) => `/Plugins/${id}/${version}/Image`
        );
        const withoutImageBuilder = normalizeAdminPluginInventory(
            [ pluginInfo('Active', { HasImage: true }) ],
            [ packageInfo() ],
            []
        );

        expect(withoutServerImage.installed[0].imageUrl).toBeNull();
        expect(withoutImageBuilder.installed[0].imageUrl).toBeNull();
    });

    it('uses server-returned version order and only offers an entry before the exact installed revision', () => {
        const result = normalizeAdminPluginInventory(
            [ pluginInfo('Active') ],
            [ packageInfo() ],
            []
        );
        const revisions = result.packages[0].versions;

        // Lexically, 10 is greater than 2; the adapter intentionally trusts server ordering.
        expect(revisions.map(version => version.version)).toEqual([ '2.0.0.0', '10.0.0.0' ]);
        expect(findAdminPluginUpdateVersion(revisions, '10.0.0.0')?.version).toBe('2.0.0.0');
        expect(findAdminPluginUpdateVersion(revisions, '2.0.0.0')).toBeNull();
        expect(findAdminPluginUpdateVersion(revisions, '1.0.0.0')).toBeNull();
        expect(result.installed[0].updateVersion?.version).toBe('2.0.0.0');
    });

    it('recognizes PiggieTV by GUID rather than its mutable display name', () => {
        const result = normalizeAdminPluginInventory([
            pluginInfo('Active', { Id: PTV_PLUGIN_GUID, Name: 'Renamed extension' })
        ], [], []);
        expect(result.installed[0]).toMatchObject({
            isPiggieTv: true,
            source: 'piggietv'
        });
    });

    it('preserves complete repository documents, ordering and nested unknown fields', () => {
        const raw = [
            {
                Enabled: false,
                Name: 'One',
                PluginExtension: { nested: [ 'keep' ] },
                Url: 'custom+repo://host/manifest#fragment'
            },
            { Enabled: true, Name: null, Url: null, VendorFlag: 7 }
        ];
        const normalized = normalizeAdminPluginRepositories(raw);
        const cloned = cloneAdminPluginRepositories(normalized.map(repository => repository.raw));

        expect(normalized.map(repository => repository.index)).toEqual([ 0, 1 ]);
        expect(normalized[0].enabled).toBe(false);
        expect(cloned).toEqual(raw);
        expect(cloned).not.toBe(raw);
        expect(cloned[0].PluginExtension).not.toBe(raw[0].PluginExtension);
        expect(equalAdminPluginRepositories(raw, cloned)).toBe(true);
        (cloned[0].PluginExtension as { nested: string[] }).nested.push('changed');
        expect(equalAdminPluginRepositories(raw, cloned)).toBe(false);
    });

    it('sanitizes unsafe catalog image schemes without failing catalog data', () => {
        const result = normalizeAdminPluginInventory([], [
            packageInfo({ imageUrl: 'javascript:alert(1)' })
        ], []);
        expect(result.packages[0].imageUrl).toBeNull();
        expect(result.packages[0].name).toBe('Example');
    });
});

/* eslint-enable sonarjs/no-hardcoded-ip, sonarjs/code-eval */
