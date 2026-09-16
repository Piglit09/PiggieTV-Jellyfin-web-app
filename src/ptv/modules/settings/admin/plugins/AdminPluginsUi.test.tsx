import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    PtvAdminInstalledPlugin,
    PtvAdminPluginConfigurationPage,
    PtvAdminPluginDetail,
    PtvAdminPluginPackage,
    PtvAdminPluginRepository,
    PtvAdminPluginVersion
} from './adminPluginsModel';

/* eslint-disable @typescript-eslint/naming-convention */

const hookMocks = vi.hoisted(() => ({
    catalog: null as unknown as ReturnType<typeof catalogState>,
    detail: null as unknown as ReturnType<typeof detailState>,
    installed: null as unknown as ReturnType<typeof installedState>,
    repositories: null as unknown as ReturnType<typeof repositoriesState>
}));

vi.mock('../../../../../hooks/useApi', () => ({
    useApi: () => ({
        __legacyApiClient__: { serverId: () => 'server-a' },
        api: {}
    })
}));

vi.mock('./useAdminPlugins', () => ({
    useAdminInstalledPlugins: () => hookMocks.installed,
    useAdminPluginCatalog: () => hookMocks.catalog,
    useAdminPluginDetail: () => hookMocks.detail,
    useAdminPluginRepositories: () => hookMocks.repositories
}));

vi.mock('../../../icons/PtvIcon', () => ({
    default: ({ name }: Readonly<{ name: string }>) => <span data-icon={name} />
}));

import PtvAdminPluginsPage from './PtvAdminPluginsPage';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const REPORTS_ID = '11111111111111111111111111111111';
const CATALOG_ID = '22222222222222222222222222222222';

function configurationPage(
    displayName: string,
    name: string,
    pluginId = REPORTS_ID
): PtvAdminPluginConfigurationPage {
    return {
        displayName,
        enableInMainMenu: true,
        href: `#/configurationpage?name=${encodeURIComponent(name)}`,
        menuIcon: null,
        menuSection: null,
        name,
        pluginId
    };
}

function pluginVersion(overrides: Partial<PtvAdminPluginVersion> = {}): PtvAdminPluginVersion {
    return {
        changelog: null,
        key: '2.0.0:https://repo.example/plugin.zip',
        repositoryName: 'Example Repository',
        repositoryUrl: 'https://repo.example/plugin.zip',
        targetAbi: null,
        timestamp: '2026-08-01T00:00:00.000Z',
        version: '2.0.0',
        versionNumber: '2.0.0',
        ...overrides
    };
}

function pluginPackage(overrides: Partial<PtvAdminPluginPackage> = {}): PtvAdminPluginPackage {
    const latestVersion = pluginVersion();
    return {
        category: 'Administration',
        description: 'Adds compact server reports.',
        id: CATALOG_ID,
        imageUrl: 'https://untrusted.example/plugin.png',
        installedVersion: null,
        isInstalled: false,
        isPiggieTv: false,
        latestVersion,
        name: 'Catalog Tool',
        overview: null,
        owner: 'Example Author',
        updateVersion: null,
        versions: [ latestVersion ],
        ...overrides
    };
}

function installedPlugin(overrides: Partial<PtvAdminInstalledPlugin> = {}): PtvAdminInstalledPlugin {
    const pages = [
        configurationPage('General & Safety', 'reports/general'),
        configurationPage('Advanced', 'reports advanced')
    ];
    return {
        canConfigure: true,
        canDisable: true,
        canEnable: false,
        canUninstall: true,
        category: 'Administration',
        configurationPages: pages,
        description: 'Adds compact server reports.',
        hasImage: false,
        id: REPORTS_ID,
        imageUrl: null,
        isPiggieTv: false,
        key: `${REPORTS_ID}:1.0.0`,
        name: 'Reports',
        package: null,
        restartRequired: false,
        source: 'repository',
        status: 'active',
        statusLabel: 'Active',
        statusValue: 'Active',
        updateVersion: null,
        version: '1.0.0',
        ...overrides
    };
}

function mutationActions() {
    return {
        actionStateByPlugin: {},
        disablePlugin: vi.fn(async () => true),
        enablePlugin: vi.fn(async () => true),
        feedback: null,
        installPlugin: vi.fn(async () => true),
        uninstallPlugin: vi.fn(async () => true),
        updatePlugin: vi.fn(async () => true)
    };
}

function installedState(overrides: Record<string, unknown> = {}) {
    return {
        ...mutationActions(),
        catalogError: false,
        configurationPagesError: false,
        error: null,
        initialLoading: false,
        plugins: [ installedPlugin() ],
        refresh: vi.fn(async () => undefined),
        refreshError: false,
        refreshing: false,
        ...overrides
    };
}

function catalogState(overrides: Record<string, unknown> = {}) {
    return {
        ...mutationActions(),
        error: null,
        initialLoading: false,
        installedPlugins: [],
        installedSourceAvailable: true,
        installedSourceError: false,
        installedSourceLoading: false,
        packages: [ pluginPackage() ],
        refresh: vi.fn(async () => undefined),
        refreshError: false,
        refreshing: false,
        ...overrides
    };
}

function detailState(overrides: Record<string, unknown> = {}) {
    return {
        ...mutationActions(),
        actionState: undefined,
        catalogError: false,
        configurationPagesError: false,
        detail: null,
        error: null,
        installedSourceAvailable: true,
        installedSourceError: false,
        installedSourceLoading: false,
        loading: false,
        refresh: vi.fn(async () => undefined),
        refreshError: false,
        refreshing: false,
        ...overrides
    };
}

function repositoriesState(overrides: Record<string, unknown> = {}) {
    return {
        addRepository: vi.fn(async () => true),
        editRepository: vi.fn(async () => true),
        error: null,
        feedback: null,
        initialLoading: false,
        refresh: vi.fn(async () => undefined),
        refreshError: false,
        refreshing: false,
        removeRepository: vi.fn(async () => true),
        repositories: [],
        repositoryAction: null,
        ...overrides
    };
}

let container: HTMLDivElement;
let root: Root;

function render(route: Parameters<typeof PtvAdminPluginsPage>[0]['route']) {
    act(() => {
        root.render(
            <MemoryRouter>
                <PtvAdminPluginsPage route={route} />
            </MemoryRouter>
        );
    });
}

function click(element: Element | null) {
    expect(element).toBeTruthy();
    act(() => (element as HTMLElement).click());
}

function changeInput(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    hookMocks.installed = installedState();
    hookMocks.catalog = catalogState();
    hookMocks.detail = detailState();
    hookMocks.repositories = repositoriesState();
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
});

describe('native Plugin Administration UI', () => {
    it('renders installed plugins and all server-discovered configuration destinations without mutating on load', () => {
        render({ section: 'installed' });

        expect(container.textContent).toContain('Reports');
        expect(container.textContent).toContain('General & Safety');
        expect(container.textContent).toContain('Advanced');
        expect(container.querySelector('a[href="#/configurationpage?name=reports%2Fgeneral"]')).not.toBeNull();
        expect(container.querySelector('a[href="#/configurationpage?name=reports%20advanced"]')).not.toBeNull();
        expect(container.querySelector('img')).toBeNull();
        expect(hookMocks.installed.uninstallPlugin).not.toHaveBeenCalled();
        expect(hookMocks.installed.disablePlugin).not.toHaveBeenCalled();
        expect(hookMocks.installed.updatePlugin).not.toHaveBeenCalled();
    });

    it('filters installed plugins locally and exposes accessible route-backed tabs', async () => {
        hookMocks.installed = installedState({
            plugins: [ installedPlugin(), installedPlugin({
                description: 'Skips intros.',
                id: CATALOG_ID,
                key: `${CATALOG_ID}:1`,
                name: 'Intro Tool'
            }) ]
        });
        render({ section: 'installed' });

        const search = container.querySelector<HTMLInputElement>('input[aria-label="Search plugins"]');
        expect(search).not.toBeNull();
        act(() => {
            changeInput(search!, 'intro');
        });
        await act(async () => Promise.resolve());
        expect(container.textContent).toContain('Intro Tool');
        expect(container.textContent).not.toContain('ReportsActive');
        expect(container.querySelectorAll('[role="tab"]')).toHaveLength(3);
        expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Installed');
    });

    it('keeps catalog rows visible but disables installed-state claims and lifecycle actions until Plugins loads', () => {
        hookMocks.catalog = catalogState({
            installedSourceAvailable: false,
            installedSourceLoading: true
        });
        render({ section: 'catalog' });

        expect(container.textContent).toContain('Catalog Tool');
        expect(container.textContent).toContain('Status unavailable');
        expect(container.textContent).toContain('Installed state is unavailable');
        expect(container.querySelector('button[aria-label="Install Catalog Tool"]')).toBeNull();
        expect(container.querySelector('button[aria-label="Update Catalog Tool"]')).toBeNull();
        expect(container.querySelector('img')).toBeNull();
    });

    it('requires confirmation before uninstalling an installed plugin', async () => {
        render({ section: 'installed' });
        click(container.querySelector('button[aria-label="Uninstall Reports"]'));

        expect(document.body.textContent).toContain('Uninstall Reports?');
        expect(hookMocks.installed.uninstallPlugin).not.toHaveBeenCalled();
        const confirm = Array.from(document.body.querySelectorAll('button'))
            .find(button => button.textContent === 'Uninstall Plugin');
        click(confirm || null);
        await act(async () => Promise.resolve());
        expect(hookMocks.installed.uninstallPlugin).toHaveBeenCalledTimes(1);
    });

    it('never renders repository credentials and disables editing credential-bearing server state', () => {
        const repository: PtvAdminPluginRepository = {
            enabled: true,
            id: 'repository-a',
            index: 0,
            name: 'Private Source',
            raw: {
                Enabled: true,
                Name: 'Private Source',
                Url: 'https://admin:super-secret@example.com/manifest.json'
            },
            url: 'https://admin:super-secret@example.com/manifest.json'
        };
        hookMocks.repositories = repositoriesState({ repositories: [ repository ] });
        render({ section: 'repositories' });

        expect(container.textContent).toContain('https://example.com/manifest.json');
        expect(container.textContent).not.toContain('admin');
        expect(container.textContent).not.toContain('super-secret');
        expect(container.querySelector<HTMLButtonElement>('button[aria-label="Edit Private Source"]')?.disabled).toBe(true);
        expect(container.querySelector<HTMLButtonElement>('button[aria-label="Remove Private Source"]')?.disabled).toBe(false);
    });

    it('fails closed for a catalog-only detail while installed state is unavailable', () => {
        const packageInfo = pluginPackage();
        const detail: PtvAdminPluginDetail = {
            configurationPages: [],
            id: packageInfo.id,
            installed: null,
            installedVersions: [],
            isPiggieTv: false,
            name: packageInfo.name,
            package: packageInfo
        };
        hookMocks.detail = detailState({
            detail,
            installedSourceAvailable: false,
            installedSourceError: true
        });
        render({ pluginId: CATALOG_ID, section: 'detail' });

        expect(container.textContent).toContain('Catalog Tool');
        expect(container.textContent).toContain('Installed state is unavailable');
        expect(container.querySelector('button.is-primary')).toBeNull();
    });
});

/* eslint-enable @typescript-eslint/naming-convention */
