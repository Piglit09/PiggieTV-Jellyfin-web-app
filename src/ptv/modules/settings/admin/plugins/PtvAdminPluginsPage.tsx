import React, {
    useCallback,
    useDeferredValue,
    useMemo,
    useRef,
    useState
} from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useApi } from '../../../../../hooks/useApi';
import PtvIcon from '../../../icons/PtvIcon';

import {
    AdminPluginActionDialog,
    AdminPluginRepositoryDialog,
    AdminPluginRepositoryRemoveDialog,
    type AdminPluginRepositoryDraft,
    type PendingAdminPluginAction
} from './AdminPluginDialogs';
import {
    AdminPluginBadge,
    AdminPluginCard,
    AdminPluginIcon,
    AdminPluginListSkeleton,
    AdminPluginRepositoryRow,
    AdminPluginState,
    type AdminPluginAction,
    type AdminPluginCardView,
    type AdminPluginConfigurationLink,
    type AdminPluginRepositoryView,
    type AdminPluginStatusTone
} from './AdminPluginPresentation';
import { findPrimaryAdminInstalledPlugin, normalizeAdminPluginGuid } from './adminPluginsAdapters';
import type {
    AdminPluginActionState,
    AdminPluginsFeedback,
    PtvAdminInstalledPlugin,
    PtvAdminPluginDetail,
    PtvAdminPluginPackage,
    PtvAdminPluginRepository
} from './adminPluginsModel';
import {
    ADMIN_PLUGINS_PATH,
    type AdminPluginsRouteState
} from './AdminPluginsRoute';
import {
    useAdminInstalledPlugins,
    useAdminPluginCatalog,
    useAdminPluginDetail,
    useAdminPluginRepositories
} from './useAdminPlugins';

import './adminPlugins.scss';

/* eslint-disable react/jsx-no-bind, no-void, no-nested-ternary, sonarjs/cognitive-complexity, sonarjs/no-nested-conditional */

const PTV_PLUGIN_CONFIGURATION_PATH = '#/settings/admin/piggietv';

const PLUGIN_TABS = [
    { label: 'Installed', path: `${ADMIN_PLUGINS_PATH}/installed`, section: 'installed' },
    { label: 'Catalog', path: `${ADMIN_PLUGINS_PATH}/catalog`, section: 'catalog' },
    { label: 'Repositories', path: `${ADMIN_PLUGINS_PATH}/repositories`, section: 'repositories' }
] as const;

type PluginListSection = typeof PLUGIN_TABS[number]['section'];
type InstalledFilter = 'all' | 'configurable' | 'other' | 'piggietv' | 'restart';
type CatalogFilter = 'all' | 'available' | 'installed' | 'updates';

const INSTALLED_FILTERS: readonly Readonly<{ id: InstalledFilter; label: string }>[] = [
    { id: 'all', label: 'All' },
    { id: 'restart', label: 'Restart Required' },
    { id: 'configurable', label: 'Configurable' },
    { id: 'piggietv', label: 'PiggieTV' },
    { id: 'other', label: 'Other' }
];

const CATALOG_FILTERS: readonly Readonly<{ id: CatalogFilter; label: string }>[] = [
    { id: 'all', label: 'All' },
    { id: 'available', label: 'Available' },
    { id: 'installed', label: 'Installed' },
    { id: 'updates', label: 'Updates' }
];

function pluginConfigurationLinks(
    plugin: Pick<PtvAdminInstalledPlugin, 'configurationPages' | 'isPiggieTv'>
): readonly AdminPluginConfigurationLink[] {
    if (plugin.isPiggieTv) {
        return [ { href: PTV_PLUGIN_CONFIGURATION_PATH, label: 'PiggieTV settings' } ];
    }
    const labelCounts = new Map<string, number>();
    plugin.configurationPages.forEach(page => {
        const key = page.displayName.toLocaleLowerCase();
        labelCounts.set(key, (labelCounts.get(key) || 0) + 1);
    });
    return plugin.configurationPages.map(page => ({
        href: page.href,
        label: (labelCounts.get(page.displayName.toLocaleLowerCase()) || 0) > 1 ?
            (page.name.toLocaleLowerCase() === page.displayName.toLocaleLowerCase() ?
                page.displayName : `${page.displayName} — ${page.name}`) : page.displayName
    }));
}

function installedStatusTone(plugin: PtvAdminInstalledPlugin): AdminPluginStatusTone {
    if (plugin.restartRequired) return 'warning';
    switch (plugin.status) {
        case 'active': return 'success';
        case 'malfunctioned':
        case 'not-supported':
        case 'deleted': return 'danger';
        case 'disabled': return 'neutral';
        case 'superseded': return 'info';
        default: return 'neutral';
    }
}

function installedEnabledState(plugin: PtvAdminInstalledPlugin) {
    if (plugin.status === 'active') return true;
    if (plugin.status === 'disabled') return false;
    return null;
}

function pluginRepositoryLabel(plugin: PtvAdminInstalledPlugin) {
    if (plugin.source === 'piggietv') return 'PiggieTV';
    if (plugin.source === 'bundled') return 'Bundled with Jellyfin';
    return plugin.package?.latestVersion?.repositoryName || null;
}

export function installedPluginToCard(plugin: PtvAdminInstalledPlugin): AdminPluginCardView {
    return {
        availableVersion: plugin.updateVersion?.version || null,
        canDisable: plugin.canDisable,
        canEnable: plugin.canEnable,
        canInstall: false,
        canUninstall: plugin.canUninstall && !plugin.isPiggieTv,
        canUpdate: Boolean(plugin.package && plugin.updateVersion),
        category: plugin.category,
        configurationLinks: pluginConfigurationLinks(plugin),
        description: plugin.description,
        enabled: installedEnabledState(plugin),
        id: plugin.id,
        imageUrl: plugin.hasImage ? plugin.imageUrl : null,
        installed: true,
        installedVersion: plugin.version,
        isPiggieTv: plugin.isPiggieTv,
        name: plugin.name,
        repository: pluginRepositoryLabel(plugin),
        restartRequired: plugin.restartRequired,
        statusLabel: plugin.statusLabel,
        statusTone: installedStatusTone(plugin),
        trustedSource: false
    };
}

export function catalogPluginToCard(
    plugin: PtvAdminPluginPackage,
    installed: PtvAdminInstalledPlugin | null,
    installedSourceAvailable = true
): AdminPluginCardView {
    const installStateKnown = installedSourceAvailable;
    const updateAvailable = Boolean(
        installStateKnown && installed && plugin.updateVersion?.repositoryUrl
    );
    const installedState = Boolean(installStateKnown && plugin.isInstalled);
    const installAvailable = Boolean(plugin.latestVersion?.repositoryUrl);
    const availableVersion = plugin.updateVersion?.version || plugin.latestVersion?.version || null;
    let statusLabel = 'Unavailable';
    let statusTone: AdminPluginStatusTone = 'danger';
    if (!installStateKnown) {
        statusLabel = 'Status unavailable';
        statusTone = 'neutral';
    } else if (updateAvailable) {
        statusLabel = 'Update available';
        statusTone = 'info';
    } else if (installedState) {
        statusLabel = 'Installed';
        statusTone = 'success';
    } else if (installAvailable) {
        statusLabel = 'Available';
        statusTone = 'neutral';
    }
    return {
        availableVersion,
        canDisable: false,
        canEnable: false,
        canInstall: installStateKnown && !installedState && installAvailable,
        canUninstall: false,
        canUpdate: updateAvailable,
        category: plugin.category,
        configurationLinks: installed ? pluginConfigurationLinks(installed) : [],
        description: plugin.description || plugin.overview,
        enabled: null,
        id: plugin.id,
        imageUrl: null,
        installed: installedState,
        installedVersion: installStateKnown ? plugin.installedVersion : null,
        isPiggieTv: plugin.isPiggieTv,
        name: plugin.name,
        repository: plugin.latestVersion?.repositoryName || null,
        restartRequired: installed?.restartRequired || false,
        statusLabel,
        statusTone,
        trustedSource: false
    };
}

function actionStateToAction(state?: AdminPluginActionState): AdminPluginAction | null {
    switch (state) {
        case 'disabling': return 'disable';
        case 'enabling': return 'enable';
        case 'installing': return 'install';
        case 'uninstalling': return 'uninstall';
        case 'updating': return 'update';
        default: return null;
    }
}

function normalizeSearchText(value: string | null) {
    return value?.toLocaleLowerCase().trim() || '';
}

function matchesPluginSearch(plugin: AdminPluginCardView, query: string) {
    const needle = normalizeSearchText(query);
    if (!needle) return true;
    return [ plugin.name, plugin.description, plugin.category, plugin.repository ]
        .some(value => normalizeSearchText(value).includes(needle));
}

function dynamicCategories(plugins: readonly AdminPluginCardView[]) {
    return Array.from(new Set(plugins.map(plugin => plugin.category).filter((value): value is string => Boolean(value))))
        .sort((left, right) => left.localeCompare(right));
}

function PluginTabs({ section }: Readonly<{ section: PluginListSection }>) {
    const navigate = useNavigate();
    const moveTab = useCallback((event: React.KeyboardEvent<HTMLAnchorElement>, currentIndex: number) => {
        const last = PLUGIN_TABS.length - 1;
        let nextIndex: number;
        switch (event.key) {
            case 'ArrowLeft':
                nextIndex = currentIndex === 0 ? last : currentIndex - 1;
                break;
            case 'ArrowRight':
                nextIndex = currentIndex === last ? 0 : currentIndex + 1;
                break;
            case 'Home':
                nextIndex = 0;
                break;
            case 'End':
                nextIndex = last;
                break;
            default: return;
        }
        event.preventDefault();
        navigate(PLUGIN_TABS[nextIndex].path);
        window.requestAnimationFrame(() => {
            document.getElementById(`ptv-admin-plugin-tab-${PLUGIN_TABS[nextIndex].section}`)?.focus();
        });
    }, [ navigate ]);

    return (
        <div aria-label='Plugin administration sections' className='ptv-admin-plugin-tabs' role='tablist'>
            {PLUGIN_TABS.map((tab, index) => {
                const selected = tab.section === section;
                return (
                    <Link
                        aria-controls='ptv-admin-plugin-panel'
                        aria-selected={selected}
                        id={`ptv-admin-plugin-tab-${tab.section}`}
                        key={tab.section}
                        onKeyDown={event => moveTab(event, index)}
                        role='tab'
                        tabIndex={selected ? 0 : -1}
                        to={tab.path}
                    >
                        {tab.label}
                    </Link>
                );
            })}
        </div>
    );
}

function PluginsHeader({
    onRefresh,
    refreshing,
    title = 'Plugins'
}: Readonly<{
    onRefresh: () => void;
    refreshing: boolean;
    title?: string;
}>) {
    return (
        <header className='ptv-admin-plugins-header'>
            <div>
                <h1>{title}</h1>
                <p>Manage installed plugins, updates, repositories and configuration.</p>
            </div>
            <button aria-busy={refreshing || undefined} disabled={refreshing} onClick={onRefresh} type='button'>
                <PtvIcon name='refresh' size='17px' />
                {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
        </header>
    );
}

function PluginFeedback({ feedback }: Readonly<{ feedback: AdminPluginsFeedback | null }>) {
    if (!feedback) return null;
    return (
        <p
            aria-live={feedback.tone === 'error' ? 'assertive' : 'polite'}
            className={`ptv-admin-plugin-feedback is-${feedback.tone}`}
            role={feedback.tone === 'error' ? 'alert' : 'status'}
        >
            {feedback.message}
        </p>
    );
}

function PluginRestartBanner() {
    return (
        <aside className='ptv-admin-plugin-restart-banner' role='status'>
            <PtvIcon name='alerts' size='20px' />
            <div>
                <strong>Server restart required</strong>
                <p>Restart the server to finish the plugin changes reported by Jellyfin.</p>
            </div>
        </aside>
    );
}

function PluginSourceNotice({ children, title }: Readonly<{ children: React.ReactNode; title: string }>) {
    return (
        <aside className='ptv-admin-plugin-notice' role='status'>
            <PtvIcon name='alerts' size='20px' />
            <div><strong>{title}</strong><p>{children}</p></div>
        </aside>
    );
}

function PluginToolbar<TFilter extends string>({
    categories,
    category,
    count,
    filter,
    filters,
    onCategoryChange,
    onFilterChange,
    onQueryChange,
    query
}: Readonly<{
    categories: readonly string[];
    category: string;
    count: number;
    filter: TFilter;
    filters: readonly Readonly<{ id: TFilter; label: string }>[];
    onCategoryChange: (value: string) => void;
    onFilterChange: (value: TFilter) => void;
    onQueryChange: (value: string) => void;
    query: string;
}>) {
    return (
        <div className='ptv-admin-plugin-toolbar'>
            <label className='ptv-admin-plugin-search' htmlFor='ptv-admin-plugin-search'>
                <PtvIcon name='search' size='18px' />
                <input
                    aria-label='Search plugins'
                    id='ptv-admin-plugin-search'
                    onChange={event => onQueryChange(event.currentTarget.value)}
                    placeholder='Search plugins…'
                    type='search'
                    value={query}
                />
            </label>
            <div aria-label='Filter plugins' className='ptv-admin-plugin-filter-group' role='group'>
                {filters.map(option => (
                    <button
                        aria-pressed={filter === option.id}
                        key={option.id}
                        onClick={() => onFilterChange(option.id)}
                        type='button'
                    >
                        {option.label}
                    </button>
                ))}
            </div>
            <label className='ptv-admin-plugin-category'>
                <span>Category</span>
                <select onChange={event => onCategoryChange(event.currentTarget.value)} value={category}>
                    <option value='all'>All categories</option>
                    {categories.map(value => <option key={value} value={value}>{value}</option>)}
                </select>
            </label>
            <span aria-live='polite' className='ptv-admin-plugin-result-count'>
                {count} {count === 1 ? 'plugin' : 'plugins'}
            </span>
        </div>
    );
}

function usePluginActionConfirmation(
    execute: (pending: PendingAdminPluginAction) => Promise<boolean>
) {
    const [ pending, setPending ] = useState<PendingAdminPluginAction | null>(null);
    const [ busy, setBusy ] = useState(false);
    const flightRef = useRef(false);
    const request = useCallback((action: AdminPluginAction, plugin: AdminPluginCardView) => {
        if (!flightRef.current) setPending({ action, plugin });
    }, []);
    const cancel = useCallback(() => {
        if (!flightRef.current) setPending(null);
    }, []);
    const confirm = useCallback(() => {
        if (!pending || flightRef.current) return;
        flightRef.current = true;
        setBusy(true);
        void execute(pending).then(success => {
            if (success) setPending(null);
        }).finally(() => {
            flightRef.current = false;
            setBusy(false);
        });
    }, [ execute, pending ]);
    return { busy, cancel, confirm, pending, request } as const;
}

function InstalledPluginsWorkspace() {
    const { __legacyApiClient__: apiClient, api } = useApi();
    const state = useAdminInstalledPlugins(api, apiClient);
    const [ query, setQuery ] = useState('');
    const deferredQuery = useDeferredValue(query);
    const [ filter, setFilter ] = useState<InstalledFilter>('all');
    const [ category, setCategory ] = useState('all');
    const cards = useMemo(() => state.plugins.map(plugin => ({
        plugin,
        view: installedPluginToCard(plugin)
    })), [ state.plugins ]);
    const categories = useMemo(() => dynamicCategories(cards.map(card => card.view)), [ cards ]);
    const visible = useMemo(() => cards.filter(({ view }) => {
        const filterMatch = filter === 'all'
            || (filter === 'restart' && view.restartRequired)
            || (filter === 'configurable' && view.configurationLinks.length > 0)
            || (filter === 'piggietv' && view.isPiggieTv)
            || (filter === 'other' && !view.isPiggieTv);
        return filterMatch
            && (category === 'all' || view.category === category)
            && matchesPluginSearch(view, deferredQuery);
    }), [ cards, category, deferredQuery, filter ]);
    const execute = useCallback(async (pending: PendingAdminPluginAction) => {
        const target = state.plugins.find(plugin => (
            plugin.id === pending.plugin.id && plugin.version === pending.plugin.installedVersion
        ));
        if (!target) return false;
        switch (pending.action) {
            case 'disable': return state.disablePlugin(target);
            case 'enable': return state.enablePlugin(target);
            case 'uninstall': return state.uninstallPlugin(target);
            case 'update': return target.package && target.updateVersion ?
                state.updatePlugin(target.package, target, target.updateVersion) : false;
            default: return false;
        }
    }, [ state ]);
    const actionDialog = usePluginActionConfirmation(execute);

    return (
        <section className='ptv-admin-plugins' data-testid='ptv-admin-plugins-installed'>
            <PluginsHeader onRefresh={() => void state.refresh()} refreshing={state.refreshing} />
            <PluginTabs section='installed' />
            {state.plugins.some(plugin => plugin.restartRequired) ? <PluginRestartBanner /> : null}
            <PluginFeedback feedback={state.feedback} />
            {state.catalogError ? (
                <PluginSourceNotice title='Update information is unavailable'>
                    Installed plugins remain manageable, but catalog versions and update actions may be unavailable.
                </PluginSourceNotice>
            ) : null}
            {state.configurationPagesError ? (
                <PluginSourceNotice title='Configuration discovery is unavailable'>
                    Installed plugins remain visible. Configure links will return after this source is available.
                </PluginSourceNotice>
            ) : null}
            {state.refreshError ? (
                <PluginSourceNotice title='Refresh incomplete'>
                    PiggieTV is showing the last confirmed installed plugin state.
                </PluginSourceNotice>
            ) : null}
            <div
                aria-labelledby='ptv-admin-plugin-tab-installed'
                className='ptv-admin-plugin-panel'
                id='ptv-admin-plugin-panel'
                role='tabpanel'
            >
                {!state.initialLoading && !state.error ? (
                    <PluginToolbar
                        categories={categories}
                        category={category}
                        count={visible.length}
                        filter={filter}
                        filters={INSTALLED_FILTERS}
                        onCategoryChange={setCategory}
                        onFilterChange={setFilter}
                        onQueryChange={setQuery}
                        query={query}
                    />
                ) : null}
                {state.initialLoading ? <AdminPluginListSkeleton label='Loading installed plugins' /> :
                    state.error ? (
                        <AdminPluginState
                            action={<button onClick={() => void state.refresh()} type='button'>Retry</button>}
                            description='Administration navigation remains available while you retry.'
                            title="Installed plugins couldn't be loaded."
                            tone='error'
                        />
                    ) : visible.length ? (
                        <div className='ptv-admin-plugin-list'>
                            {visible.map(({ plugin, view }) => (
                                <AdminPluginCard
                                    busyAction={actionStateToAction(state.actionStateByPlugin[plugin.id])}
                                    key={plugin.key}
                                    mode='installed'
                                    onRequestAction={actionDialog.request}
                                    plugin={view}
                                />
                            ))}
                        </div>
                    ) : (
                        <AdminPluginState
                            description={query || filter !== 'all' || category !== 'all' ?
                                'Try another search or filter.' : 'No installed plugins were reported by Jellyfin.'}
                            title={query || filter !== 'all' || category !== 'all' ?
                                'No plugins match this view.' : 'No installed plugins found.'}
                        />
                    )}
            </div>
            <AdminPluginActionDialog
                busy={actionDialog.busy}
                onCancel={actionDialog.cancel}
                onConfirm={actionDialog.confirm}
                pending={actionDialog.pending}
            />
        </section>
    );
}

function CatalogPluginsWorkspace() {
    const { __legacyApiClient__: apiClient, api } = useApi();
    const state = useAdminPluginCatalog(api, apiClient);
    const [ query, setQuery ] = useState('');
    const deferredQuery = useDeferredValue(query);
    const [ filter, setFilter ] = useState<CatalogFilter>('all');
    const [ category, setCategory ] = useState('all');
    const cards = useMemo(() => state.packages.map(plugin => {
        const matches = state.installedPlugins.filter(installed => installed.id === plugin.id);
        const installed = findPrimaryAdminInstalledPlugin(matches);
        return {
            plugin,
            view: catalogPluginToCard(plugin, installed, state.installedSourceAvailable)
        };
    }), [ state.installedPlugins, state.installedSourceAvailable, state.packages ]);
    const categories = useMemo(() => dynamicCategories(cards.map(card => card.view)), [ cards ]);
    const visible = useMemo(() => cards.filter(({ view }) => {
        const filterMatch = filter === 'all'
            || (filter === 'available' && !view.installed && view.canInstall)
            || (filter === 'installed' && view.installed)
            || (filter === 'updates' && view.canUpdate);
        return filterMatch
            && (category === 'all' || view.category === category)
            && matchesPluginSearch(view, deferredQuery);
    }), [ cards, category, deferredQuery, filter ]);
    const execute = useCallback(async (pending: PendingAdminPluginAction) => {
        const packageInfo = state.packages.find(plugin => plugin.id === pending.plugin.id);
        if (!packageInfo) return false;
        if (pending.action === 'install' && packageInfo.latestVersion) {
            return state.installPlugin(packageInfo, packageInfo.latestVersion);
        }
        if (pending.action === 'update' && packageInfo.updateVersion) {
            const installed = findPrimaryAdminInstalledPlugin(
                state.installedPlugins.filter(plugin => plugin.id === packageInfo.id)
            );
            return installed ? state.updatePlugin(packageInfo, installed, packageInfo.updateVersion) : false;
        }
        return false;
    }, [ state ]);
    const actionDialog = usePluginActionConfirmation(execute);

    return (
        <section className='ptv-admin-plugins' data-testid='ptv-admin-plugins-catalog'>
            <PluginsHeader onRefresh={() => void state.refresh()} refreshing={state.refreshing} />
            <PluginTabs section='catalog' />
            <PluginFeedback feedback={state.feedback} />
            {state.installedSourceLoading || state.installedSourceError ? (
                <PluginSourceNotice title='Installed state is unavailable'>
                    The catalog remains visible, but install and update actions are disabled until Jellyfin confirms installed plugins.
                </PluginSourceNotice>
            ) : null}
            {state.refreshError ? (
                <PluginSourceNotice title='Refresh incomplete'>
                    PiggieTV is showing the last confirmed catalog state.
                </PluginSourceNotice>
            ) : null}
            <PluginSourceNotice title='Jellyfin selects compatible versions'>
                Catalog versions are selected by Jellyfin. Automatic plugin updates are managed in{' '}
                <Link to='/settings/admin/tasks'>Scheduled Tasks</Link>.
            </PluginSourceNotice>
            <div
                aria-labelledby='ptv-admin-plugin-tab-catalog'
                className='ptv-admin-plugin-panel'
                id='ptv-admin-plugin-panel'
                role='tabpanel'
            >
                {!state.initialLoading && !state.error ? (
                    <PluginToolbar
                        categories={categories}
                        category={category}
                        count={visible.length}
                        filter={filter}
                        filters={CATALOG_FILTERS}
                        onCategoryChange={setCategory}
                        onFilterChange={setFilter}
                        onQueryChange={setQuery}
                        query={query}
                    />
                ) : null}
                {state.initialLoading ? <AdminPluginListSkeleton label='Loading plugin catalog' /> :
                    state.error ? (
                        <AdminPluginState
                            action={<button onClick={() => void state.refresh()} type='button'>Retry</button>}
                            description='Check the configured repositories, then retry this source.'
                            title="Plugin catalog couldn't be loaded."
                            tone='error'
                        />
                    ) : visible.length ? (
                        <div className='ptv-admin-plugin-list is-catalog'>
                            {visible.map(({ plugin, view }) => (
                                <AdminPluginCard
                                    busyAction={actionStateToAction(state.actionStateByPlugin[plugin.id])}
                                    key={plugin.id}
                                    mode='catalog'
                                    onRequestAction={actionDialog.request}
                                    plugin={view}
                                />
                            ))}
                        </div>
                    ) : (
                        <AdminPluginState
                            description={query || filter !== 'all' || category !== 'all' ?
                                'Try another search or filter.' : 'No packages were reported by the configured repositories.'}
                            title={query || filter !== 'all' || category !== 'all' ?
                                'No plugins match this view.' : 'The catalog is empty.'}
                        />
                    )}
            </div>
            <AdminPluginActionDialog
                busy={actionDialog.busy}
                onCancel={actionDialog.cancel}
                onConfirm={actionDialog.confirm}
                pending={actionDialog.pending}
            />
        </section>
    );
}

function repositoryToView(repository: PtvAdminPluginRepository): AdminPluginRepositoryView {
    let displayUrl = 'Repository URL hidden';
    let canEdit = false;
    try {
        // eslint-disable-next-line compat/compat
        const parsed = new URL(repository.url);
        canEdit = !parsed.username && !parsed.password;
        parsed.username = '';
        parsed.password = '';
        displayUrl = parsed.toString();
    } catch {
        // Preserve/remove opaque server state without exposing or editing it.
    }
    return {
        canEdit,
        displayUrl,
        enabled: repository.enabled,
        key: repository.id,
        name: repository.name,
        url: canEdit ? repository.url : undefined
    };
}

function RepositoriesWorkspace() {
    const { __legacyApiClient__: apiClient, api } = useApi();
    const state = useAdminPluginRepositories(api, apiClient);
    const [ repositoryDialog, setRepositoryDialog ] = useState<Readonly<{
        baseline: readonly PtvAdminPluginRepository[];
        repository: AdminPluginRepositoryView | 'new';
    }> | null>(null);
    const [ removeDialog, setRemoveDialog ] = useState<Readonly<{
        baseline: readonly PtvAdminPluginRepository[];
        repository: AdminPluginRepositoryView;
    }> | null>(null);
    const views = useMemo(() => state.repositories.map(repositoryToView), [ state.repositories ]);
    const busy = Boolean(state.repositoryAction);
    const closeRepositoryDialog = useCallback(() => {
        if (!busy) setRepositoryDialog(null);
    }, [ busy ]);
    const closeRemoveDialog = useCallback(() => {
        if (!busy) setRemoveDialog(null);
    }, [ busy ]);
    const submitRepository = useCallback((draft: AdminPluginRepositoryDraft) => {
        const pending = repositoryDialog;
        if (!pending) return;
        let flight: Promise<boolean>;
        if (pending.repository === 'new') {
            flight = state.addRepository(draft, pending.baseline);
        } else {
            const repositoryView = pending.repository;
            const target = pending.baseline.find(repository => repository.id === repositoryView.key);
            flight = target ? state.editRepository(target, draft, pending.baseline) : Promise.resolve(false);
        }
        void flight.then(success => {
            if (success) setRepositoryDialog(null);
        });
    }, [ repositoryDialog, state ]);
    const removeRepository = useCallback(() => {
        const pending = removeDialog;
        if (!pending) return;
        const target = pending.baseline.find(repository => repository.id === pending.repository.key);
        if (!target) return;
        void state.removeRepository(target, pending.baseline).then(success => {
            if (success) setRemoveDialog(null);
        });
    }, [ removeDialog, state ]);

    return (
        <section className='ptv-admin-plugins' data-testid='ptv-admin-plugin-repositories'>
            <PluginsHeader onRefresh={() => void state.refresh()} refreshing={state.refreshing} />
            <PluginTabs section='repositories' />
            <PluginFeedback feedback={state.feedback} />
            {state.refreshError ? (
                <PluginSourceNotice title='Refresh incomplete'>
                    PiggieTV is showing the last confirmed repository list.
                </PluginSourceNotice>
            ) : null}
            <div
                aria-labelledby='ptv-admin-plugin-tab-repositories'
                className='ptv-admin-plugin-panel'
                id='ptv-admin-plugin-panel'
                role='tabpanel'
            >
                {!state.initialLoading && !state.error ? (
                    <div className='ptv-admin-plugin-toolbar is-repositories'>
                        <p className='ptv-admin-plugin-result-count'>
                            {views.length} {views.length === 1 ? 'repository' : 'repositories'}
                        </p>
                        <button className='is-primary' onClick={() => setRepositoryDialog({ baseline: state.repositories, repository: 'new' })} type='button'>
                            <PtvIcon name='plugins' size='17px' /> Add Repository
                        </button>
                    </div>
                ) : null}
                {state.initialLoading ? <AdminPluginListSkeleton label='Loading plugin repositories' /> :
                    state.error ? (
                        <AdminPluginState
                            action={<button onClick={() => void state.refresh()} type='button'>Retry</button>}
                            description='Installed plugins remain available in their own section.'
                            title="Plugin repositories couldn't be loaded."
                            tone='error'
                        />
                    ) : views.length ? (
                        <div className='ptv-admin-plugin-list'>
                            {views.map(repository => (
                                <AdminPluginRepositoryRow
                                    busy={state.repositoryAction?.repositoryId === repository.key}
                                    key={repository.key}
                                    onEdit={selectedRepository => setRepositoryDialog({ baseline: state.repositories, repository: selectedRepository })}
                                    onRemove={selectedRepository => setRemoveDialog({ baseline: state.repositories, repository: selectedRepository })}
                                    repository={repository}
                                />
                            ))}
                        </div>
                    ) : (
                        <AdminPluginState
                            action={<button className='is-primary' onClick={() => setRepositoryDialog({ baseline: state.repositories, repository: 'new' })} type='button'>Add Repository</button>}
                            description='Add a server-supported package source to populate the catalog.'
                            title='No plugin repositories configured.'
                        />
                    )}
            </div>
            <AdminPluginRepositoryDialog
                busy={busy}
                onCancel={closeRepositoryDialog}
                onSubmit={submitRepository}
                repository={repositoryDialog?.repository || null}
            />
            <AdminPluginRepositoryRemoveDialog
                busy={busy}
                onCancel={closeRemoveDialog}
                onConfirm={removeRepository}
                repository={removeDialog?.repository || null}
            />
        </section>
    );
}

function DetailConfigurationLinks({ detail }: Readonly<{ detail: PtvAdminPluginDetail }>) {
    const links = detail.isPiggieTv ?
        [ { href: PTV_PLUGIN_CONFIGURATION_PATH, label: 'PiggieTV settings' } ] :
        pluginConfigurationLinks({
            configurationPages: detail.configurationPages,
            isPiggieTv: false
        });
    if (!links.length) return <p>No configuration page is currently reported by this plugin.</p>;
    return (
        <div aria-label={`Configuration pages for ${detail.name}`} className='ptv-admin-plugin-config-links'>
            {links.map(link => (
                <a href={link.href} key={`${link.href}:${link.label}`}>
                    <PtvIcon name='general' size='16px' /> {links.length === 1 ? 'Configure' : link.label}
                </a>
            ))}
        </div>
    );
}

function PluginDetailWorkspace({ pluginId }: Readonly<{ pluginId: string }>) {
    const { __legacyApiClient__: apiClient, api } = useApi();
    const state = useAdminPluginDetail(api, apiClient, pluginId);
    const detail = state.detail;
    const view = useMemo(() => {
        if (detail?.installed) {
            return {
                ...installedPluginToCard(detail.installed),
                availableVersion: detail.package?.latestVersion?.version || null
            };
        }
        return detail?.package ?
            catalogPluginToCard(detail.package, null, state.installedSourceAvailable) : null;
    }, [ detail, state.installedSourceAvailable ]);
    const execute = useCallback(async (pending: PendingAdminPluginAction) => {
        if (!detail || !view) return false;
        const installed = detail.installed;
        const packageInfo = detail.package;
        switch (pending.action) {
            case 'install': return packageInfo?.latestVersion ? state.installPlugin(packageInfo, packageInfo.latestVersion) : false;
            case 'update': return packageInfo && installed && packageInfo.updateVersion ?
                state.updatePlugin(packageInfo, installed, packageInfo.updateVersion) : false;
            case 'uninstall': return installed ? state.uninstallPlugin(installed) : false;
            case 'enable': return installed ? state.enablePlugin(installed) : false;
            case 'disable': return installed ? state.disablePlugin(installed) : false;
            default: return false;
        }
    }, [ detail, state, view ]);
    const actionDialog = usePluginActionConfirmation(execute);

    if (state.loading) {
        return (
            <section className='ptv-admin-plugins ptv-admin-plugin-detail'>
                <Link className='ptv-admin-plugin-detail-back' to={`${ADMIN_PLUGINS_PATH}/installed`}>
                    <PtvIcon name='back' size='16px' /> Back to Plugins
                </Link>
                <AdminPluginListSkeleton label='Loading plugin details' />
            </section>
        );
    }
    if (!detail || !view) {
        return (
            <section className='ptv-admin-plugins ptv-admin-plugin-detail'>
                <Link className='ptv-admin-plugin-detail-back' to={`${ADMIN_PLUGINS_PATH}/installed`}>
                    <PtvIcon name='back' size='16px' /> Back to Plugins
                </Link>
                <AdminPluginState
                    action={state.error ? <button onClick={() => void state.refresh()} type='button'>Retry</button> : undefined}
                    description='The plugin may have been removed or the link may no longer be valid.'
                    title="Plugin couldn't be loaded."
                    tone='error'
                />
            </section>
        );
    }

    return (
        <section className='ptv-admin-plugins ptv-admin-plugin-detail' data-testid='ptv-admin-plugin-detail'>
            <Link className='ptv-admin-plugin-detail-back' to={`${ADMIN_PLUGINS_PATH}/installed`}>
                <PtvIcon name='back' size='16px' /> Back to Plugins
            </Link>
            <header className='ptv-admin-plugin-detail-header'>
                <AdminPluginIcon plugin={view} />
                <div>
                    <h1>{view.name}</h1>
                    <p>{view.description || 'No description was provided by this plugin.'}</p>
                </div>
                <div className='ptv-admin-plugin-detail-statuses'>
                    <AdminPluginBadge tone={view.statusTone}>{view.statusLabel}</AdminPluginBadge>
                    {view.restartRequired ? <AdminPluginBadge tone='warning'>Restart required</AdminPluginBadge> : null}
                </div>
            </header>
            {view.restartRequired ? <PluginRestartBanner /> : null}
            <PluginFeedback feedback={state.feedback} />
            {state.installedSourceLoading || state.installedSourceError ? (
                <PluginSourceNotice title='Installed state is unavailable'>
                    Install and update actions are disabled until Jellyfin confirms installed plugins.
                </PluginSourceNotice>
            ) : null}
            {state.refreshError || state.error ? (
                <PluginSourceNotice title='Some plugin information is unavailable'>
                    PiggieTV is showing the sources Jellyfin could confirm. Refresh to retry the remaining details.
                </PluginSourceNotice>
            ) : null}
            <div className='ptv-admin-plugin-detail-grid'>
                <section className='ptv-admin-plugin-detail-panel'>
                    <h2>Overview</h2>
                    <dl className='ptv-admin-plugin-detail-list'>
                        <div><dt>Category</dt><dd>{view.category || 'Not provided'}</dd></div>
                        <div><dt>Source</dt><dd>{view.repository || 'Not provided'}</dd></div>
                        {detail.package?.owner ? <div><dt>Owner</dt><dd>{detail.package.owner}</dd></div> : null}
                    </dl>
                </section>
                <section className='ptv-admin-plugin-detail-panel'>
                    <h2>Version</h2>
                    <dl className='ptv-admin-plugin-detail-list'>
                        <div><dt>Installed</dt><dd>{view.installedVersion || 'Not installed'}</dd></div>
                        <div><dt>Available</dt><dd>{view.availableVersion || 'Unavailable'}</dd></div>
                        <div><dt>Status</dt><dd>{view.statusLabel}</dd></div>
                    </dl>
                </section>
                <section className='ptv-admin-plugin-detail-panel'>
                    <h2>Configuration</h2>
                    <DetailConfigurationLinks detail={detail} />
                </section>
                <section className='ptv-admin-plugin-detail-panel'>
                    <h2>Actions</h2>
                    <div className='ptv-admin-plugin-detail-actions'>
                        {view.canInstall ? <button className='is-primary' onClick={() => actionDialog.request('install', view)} type='button'>Install</button> : null}
                        {view.canUpdate ? <button className='is-primary' onClick={() => actionDialog.request('update', view)} type='button'>Update</button> : null}
                        {view.canEnable ? <button onClick={() => actionDialog.request('enable', view)} type='button'>Enable</button> : null}
                        {view.canDisable ? <button onClick={() => actionDialog.request('disable', view)} type='button'>Disable</button> : null}
                        {view.canUninstall ? <button className='is-danger' onClick={() => actionDialog.request('uninstall', view)} type='button'>Uninstall</button> : null}
                        {!view.canInstall && !view.canUpdate && !view.canEnable && !view.canDisable && !view.canUninstall ?
                            <p>No lifecycle actions are currently available.</p> : null}
                    </div>
                </section>
                <section className='ptv-admin-plugin-detail-panel is-wide'>
                    <h2>Advanced</h2>
                    <dl className='ptv-admin-plugin-detail-list'>
                        <div><dt>Plugin ID</dt><dd><code>{detail.id}</code></dd></div>
                        {detail.installedVersions.length > 1 ? (
                            <div><dt>Installed revisions</dt><dd>{detail.installedVersions.map(plugin => plugin.version).join(', ')}</dd></div>
                        ) : null}
                    </dl>
                </section>
            </div>
            <AdminPluginActionDialog
                busy={actionDialog.busy}
                onCancel={actionDialog.cancel}
                onConfirm={actionDialog.confirm}
                pending={actionDialog.pending}
            />
        </section>
    );
}

function InvalidPluginRoute() {
    return (
        <section className='ptv-admin-plugins ptv-admin-plugin-detail'>
            <Link className='ptv-admin-plugin-detail-back' to={`${ADMIN_PLUGINS_PATH}/installed`}>
                <PtvIcon name='back' size='16px' /> Back to Plugins
            </Link>
            <AdminPluginState
                description='This Plugin Administration address is not valid.'
                title="Plugin couldn't be loaded."
                tone='error'
            />
        </section>
    );
}

export default function PtvAdminPluginsPage({ route }: Readonly<{ route: AdminPluginsRouteState }>) {
    if (route.section === 'installed') return <InstalledPluginsWorkspace />;
    if (route.section === 'catalog') return <CatalogPluginsWorkspace />;
    if (route.section === 'repositories') return <RepositoriesWorkspace />;
    if (route.section === 'detail') {
        const pluginId = normalizeAdminPluginGuid(route.pluginId);
        return pluginId ? <PluginDetailWorkspace pluginId={pluginId} /> : <InvalidPluginRoute />;
    }
    return <InvalidPluginRoute />;
}

/* eslint-enable react/jsx-no-bind, no-void, no-nested-ternary, sonarjs/cognitive-complexity, sonarjs/no-nested-conditional */
