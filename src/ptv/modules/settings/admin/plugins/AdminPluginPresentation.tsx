import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import PtvIcon from '../../../icons/PtvIcon';

import { ADMIN_PLUGINS_PATH } from './AdminPluginsRoute';

export type AdminPluginAction = 'disable' | 'enable' | 'install' | 'uninstall' | 'update';
export type AdminPluginStatusTone = 'danger' | 'info' | 'neutral' | 'success' | 'warning';

export type AdminPluginConfigurationLink = Readonly<{
    href: string;
    label: string;
}>;

/** Presentation-only projection that keeps raw plugin/package documents out of the DOM. */
export type AdminPluginCardView = Readonly<{
    availableVersion: string | null;
    canDisable: boolean;
    canEnable: boolean;
    canInstall: boolean;
    canUninstall: boolean;
    canUpdate: boolean;
    category: string | null;
    configurationLinks: readonly AdminPluginConfigurationLink[];
    description: string | null;
    enabled: boolean | null;
    id: string;
    imageUrl: string | null;
    installed: boolean;
    installedVersion: string | null;
    isPiggieTv: boolean;
    name: string;
    repository: string | null;
    restartRequired: boolean;
    statusLabel: string;
    statusTone: AdminPluginStatusTone;
    trustedSource: boolean;
}>;

export type AdminPluginRepositoryView = Readonly<{
    canEdit: boolean;
    displayUrl: string;
    enabled: boolean | null;
    key: string;
    name: string;
    url?: string;
}>;

function actionLabel(action: AdminPluginAction) {
    switch (action) {
        case 'disable': return 'Disabling…';
        case 'enable': return 'Enabling…';
        case 'install': return 'Installing…';
        case 'uninstall': return 'Uninstalling…';
        case 'update': return 'Updating…';
        default: return 'Working…';
    }
}

export function AdminPluginIcon({ plugin }: Readonly<{ plugin: AdminPluginCardView }>) {
    const [ imageFailed, setImageFailed ] = useState(false);
    useEffect(() => setImageFailed(false), [ plugin.imageUrl ]);
    const handleImageError = useCallback(() => setImageFailed(true), []);
    return (
        <div aria-hidden='true' className='ptv-admin-plugin-card-icon'>
            {plugin.imageUrl && !imageFailed ? (
                <img alt='' onError={handleImageError} src={plugin.imageUrl} />
            ) : (
                <PtvIcon name={plugin.isPiggieTv ? 'piggieHub' : 'plugins'} size='28px' />
            )}
        </div>
    );
}

function repositoryStatus(repository: AdminPluginRepositoryView) {
    if (repository.enabled === true) return 'Enabled';
    if (repository.enabled === false) return 'Disabled';
    return 'Status unavailable';
}

export function AdminPluginBadge({
    children,
    tone = 'neutral'
}: Readonly<{
    children: React.ReactNode;
    tone?: AdminPluginStatusTone;
}>) {
    return <span className='ptv-admin-plugin-badge' data-tone={tone}>{children}</span>;
}

function PluginConfigurationLinks({
    links,
    pluginName
}: Readonly<{
    links: readonly AdminPluginConfigurationLink[];
    pluginName: string;
}>) {
    if (links.length === 0) return null;

    return (
        <div aria-label={`Configuration pages for ${pluginName}`} className='ptv-admin-plugin-config-links'>
            {links.map(link => (
                <a href={link.href} key={`${link.href}:${link.label}`}>
                    <PtvIcon name='general' size='16px' />
                    {links.length === 1 ? 'Configure' : link.label}
                </a>
            ))}
        </div>
    );
}

export function AdminPluginCard({
    busyAction = null,
    mode,
    onRequestAction,
    plugin
}: Readonly<{
    busyAction?: AdminPluginAction | null;
    mode: 'catalog' | 'installed';
    onRequestAction: (action: AdminPluginAction, plugin: AdminPluginCardView) => void;
    plugin: AdminPluginCardView;
}>) {
    const busy = Boolean(busyAction);
    const requestInstall = useCallback(() => onRequestAction('install', plugin), [onRequestAction, plugin]);
    const requestUpdate = useCallback(() => onRequestAction('update', plugin), [onRequestAction, plugin]);
    const requestUninstall = useCallback(() => onRequestAction('uninstall', plugin), [onRequestAction, plugin]);
    const requestEnable = useCallback(() => onRequestAction('enable', plugin), [onRequestAction, plugin]);
    const requestDisable = useCallback(() => onRequestAction('disable', plugin), [onRequestAction, plugin]);
    const detailPath = `${ADMIN_PLUGINS_PATH}/${encodeURIComponent(plugin.id)}`;
    const version = plugin.installedVersion || plugin.availableVersion || 'Unavailable';

    return (
        <article
            aria-busy={busy || undefined}
            className='ptv-admin-plugin-card'
            data-plugin-id={plugin.id}
            data-plugin-kind={mode}
        >
            <AdminPluginIcon plugin={plugin} />
            <div className='ptv-admin-plugin-card-copy'>
                <div className='ptv-admin-plugin-card-title'>
                    <h2>{plugin.name}</h2>
                    <AdminPluginBadge tone={plugin.statusTone}>{plugin.statusLabel}</AdminPluginBadge>
                    {plugin.restartRequired ? <AdminPluginBadge tone='warning'>Restart required</AdminPluginBadge> : null}
                </div>
                {plugin.description ? <p title={plugin.description}>{plugin.description}</p> : null}
                <dl className='ptv-admin-plugin-card-meta'>
                    <div><dt>{plugin.installed ? 'Installed' : 'Latest compatible'}</dt><dd>{version}</dd></div>
                    {plugin.availableVersion && plugin.installedVersion ? (
                        <div><dt>Available</dt><dd>{plugin.availableVersion}</dd></div>
                    ) : null}
                    {plugin.category ? <div><dt>Category</dt><dd>{plugin.category}</dd></div> : null}
                    {plugin.repository ? <div><dt>Repository</dt><dd>{plugin.repository}</dd></div> : null}
                </dl>
                <PluginConfigurationLinks links={plugin.configurationLinks} pluginName={plugin.name} />
            </div>
            <div className='ptv-admin-plugin-card-actions'>
                {busyAction ? <span aria-live='polite' role='status'>{actionLabel(busyAction)}</span> : null}
                {plugin.canInstall ? (
                    <button aria-label={`Install ${plugin.name}`} className='is-primary' disabled={busy} onClick={requestInstall} type='button'>Install</button>
                ) : null}
                {plugin.canUpdate ? (
                    <button aria-label={`Update ${plugin.name}`} className='is-primary' disabled={busy} onClick={requestUpdate} type='button'>Update</button>
                ) : null}
                {plugin.canEnable ? (
                    <button aria-label={`Enable ${plugin.name}`} disabled={busy} onClick={requestEnable} type='button'>Enable</button>
                ) : null}
                {plugin.canDisable ? (
                    <button aria-label={`Disable ${plugin.name}`} disabled={busy} onClick={requestDisable} type='button'>Disable</button>
                ) : null}
                <Link aria-label={`View ${plugin.name}`} to={detailPath}>View</Link>
                {mode === 'installed' && plugin.canUninstall ? (
                    <button aria-label={`Uninstall ${plugin.name}`} className='is-danger' disabled={busy} onClick={requestUninstall} type='button'>Uninstall</button>
                ) : null}
            </div>
        </article>
    );
}

export function AdminPluginRepositoryRow({
    busy = false,
    onEdit,
    onRemove,
    repository
}: Readonly<{
    busy?: boolean;
    onEdit: (repository: AdminPluginRepositoryView) => void;
    onRemove: (repository: AdminPluginRepositoryView) => void;
    repository: AdminPluginRepositoryView;
}>) {
    const edit = useCallback(() => onEdit(repository), [onEdit, repository]);
    const remove = useCallback(() => onRemove(repository), [onRemove, repository]);

    return (
        <article aria-busy={busy || undefined} className='ptv-admin-plugin-repository'>
            <span aria-hidden='true' className='ptv-admin-plugin-repository-icon'>
                <PtvIcon name='plugins' size='22px' />
            </span>
            <div>
                <h2>{repository.name}</h2>
                <code title={repository.displayUrl}>{repository.displayUrl}</code>
            </div>
            <AdminPluginBadge tone={repository.enabled === false ? 'neutral' : 'success'}>
                {repositoryStatus(repository)}
            </AdminPluginBadge>
            <div className='ptv-admin-plugin-repository-actions'>
                <button aria-label={`Edit ${repository.name}`} disabled={busy || !repository.canEdit} onClick={edit} type='button'>Edit</button>
                <button aria-label={`Remove ${repository.name}`} className='is-danger' disabled={busy} onClick={remove} type='button'>Remove</button>
            </div>
        </article>
    );
}

export function AdminPluginListSkeleton({ label = 'Loading plugins' }: Readonly<{ label?: string }>) {
    return (
        <div aria-label={label} aria-live='polite' className='ptv-admin-plugin-list is-loading' role='status'>
            {Array.from({ length: 5 }, (_, index) => (
                <div className='ptv-admin-plugin-skeleton-row' key={index}>
                    <span />
                    <span />
                    <span />
                </div>
            ))}
        </div>
    );
}

export function AdminPluginState({
    action,
    description,
    title,
    tone = 'empty'
}: Readonly<{
    action?: React.ReactNode;
    description: string;
    title: string;
    tone?: 'empty' | 'error';
}>) {
    return (
        <section className={`ptv-admin-plugin-state is-${tone}`} role={tone === 'error' ? 'alert' : undefined}>
            <PtvIcon name={tone === 'error' ? 'alerts' : 'plugins'} size='31px' />
            <h2>{title}</h2>
            <p>{description}</p>
            {action}
        </section>
    );
}
