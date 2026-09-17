import React from 'react';
import { Link } from 'react-router-dom';

import PtvIcon from '../../../icons/PtvIcon';
import type {
    AdminLiveTvGuideProvider,
    AdminLiveTvTuner
} from './adminLiveTvModel';
import {
    ADMIN_LIVE_TV_DVR_PATH,
    ADMIN_LIVE_TV_PATH,
    type AdminLiveTvRouteState
} from './AdminLiveTvRoute';

type AdminLiveTvBadgeTone = 'healthy' | 'info' | 'warning';

function activeTab(route: AdminLiveTvRouteState) {
    if (route.kind === 'tuner') return 'tuners';
    if (route.kind === 'provider') return 'guide';
    return route.kind;
}

export function AdminLiveTvTabs({ route }: Readonly<{ route: AdminLiveTvRouteState }>) {
    const active = activeTab(route);
    const tabs = [
        { id: 'overview', label: 'Overview', to: ADMIN_LIVE_TV_PATH },
        { id: 'tuners', label: 'Tuners', to: `${ADMIN_LIVE_TV_PATH}/tuners` },
        { id: 'guide', label: 'Guide', to: `${ADMIN_LIVE_TV_PATH}/guide` },
        { id: 'dvr', label: 'DVR', to: ADMIN_LIVE_TV_DVR_PATH }
    ];
    return (
        <nav aria-label='Live TV administration sections' className='ptv-admin-live-tv-tabs'>
            {tabs.map(tab => (
                <Link aria-current={active === tab.id ? 'page' : undefined} key={tab.id} to={tab.to}>
                    {tab.label}
                </Link>
            ))}
        </nav>
    );
}

export function AdminLiveTvStatusBadge({ children, tone = 'info' }: Readonly<{
    children: React.ReactNode;
    tone?: AdminLiveTvBadgeTone;
}>) {
    return <span className='ptv-admin-live-tv-badge' data-tone={tone}>{children}</span>;
}

export function AdminLiveTvSkeleton() {
    return (
        <div aria-label='Loading Live TV administration' className='ptv-admin-live-tv-skeleton' role='status'>
            <span /><span /><span /><span />
        </div>
    );
}

function SummaryCard({ icon, label, note, tone, value }: Readonly<{
    icon: 'dvr' | 'guide' | 'liveTv' | 'record';
    label: string;
    note: string;
    tone: AdminLiveTvBadgeTone;
    value: string;
}>) {
    return (
        <article className='ptv-admin-live-tv-summary-card'>
            <span className={`ptv-admin-live-tv-summary-icon is-${tone}`}><PtvIcon name={icon} size='25px' /></span>
            <div><small>{label}</small><strong>{value}</strong></div>
            <p><AdminLiveTvStatusBadge tone={tone}>{note}</AdminLiveTvStatusBadge></p>
        </article>
    );
}

export function AdminLiveTvSummary({
    availability,
    configurationAvailable,
    providerCount,
    tunerCount
}: Readonly<{
    availability: 'available' | 'unavailable' | 'unknown';
    configurationAvailable: boolean;
    providerCount: number | null;
    tunerCount: number | null;
}>) {
    let availabilityValue = 'Unknown';
    let availabilityNote = 'Capability status unavailable';
    let availabilityTone: AdminLiveTvBadgeTone = 'info';
    if (availability === 'available') {
        availabilityValue = 'Available';
        availabilityNote = 'Server reports Live TV available';
        availabilityTone = 'healthy';
    } else if (availability === 'unavailable') {
        availabilityValue = 'Unavailable';
        availabilityNote = 'Server reports Live TV disabled';
        availabilityTone = 'warning';
    }
    const configurationNote = configurationAvailable ? 'Configured devices' : 'Configuration unavailable';
    const providerNote = configurationAvailable ? 'Configured sources' : 'Configuration unavailable';
    const recordingNote = configurationAvailable ? 'Defaults available' : 'Configuration unavailable';
    const configurationTone = configurationAvailable ? 'healthy' : 'warning';
    const recordingValue = configurationAvailable ? 'Configured' : 'Unknown';
    return (
        <div className='ptv-admin-live-tv-summary-grid'>
            <SummaryCard icon='liveTv' label='Live TV' note={availabilityNote} tone={availabilityTone} value={availabilityValue} />
            <SummaryCard icon='dvr' label='Tuners' note={configurationNote} tone={configurationTone} value={tunerCount === null ? '—' : String(tunerCount)} />
            <SummaryCard icon='guide' label='Guide Providers' note={providerNote} tone={configurationTone} value={providerCount === null ? '—' : String(providerCount)} />
            <SummaryCard icon='record' label='Recording' note={recordingNote} tone={configurationTone} value={recordingValue} />
        </div>
    );
}

function TunerRow({ onDelete, tuner }: Readonly<{
    onDelete: (tuner: AdminLiveTvTuner) => void;
    tuner: AdminLiveTvTuner;
}>) {
    const remove = React.useCallback(() => onDelete(tuner), [ onDelete, tuner ]);
    return (
        <div className='ptv-admin-live-tv-row ptv-admin-live-tv-tuner-row'>
            <div className='ptv-admin-live-tv-row-name'><span><PtvIcon name='dvr' size='19px' /></span><div><strong>{tuner.label}</strong><small>{tuner.friendlyName ? tuner.type : 'Configured tuner'}</small></div></div>
            <AdminLiveTvStatusBadge tone='healthy'>Configured</AdminLiveTvStatusBadge>
            <span>{tuner.type}</span>
            <span title={tuner.connectionSummary}>{tuner.connectionSummary}</span>
            <div className='ptv-admin-live-tv-row-actions'>
                <Link aria-label={`Edit ${tuner.label}`} to={`${ADMIN_LIVE_TV_PATH}/tuners/${encodeURIComponent(tuner.id)}`}>Edit</Link>
                <button aria-label={`Remove ${tuner.label}`} className='is-danger' onClick={remove} type='button'>Remove</button>
            </div>
        </div>
    );
}

function TunerPanelContent({ error, onDelete, tuners }: Readonly<{
    error: boolean;
    onDelete: (tuner: AdminLiveTvTuner) => void;
    tuners: readonly AdminLiveTvTuner[];
}>) {
    if (error) return <div className='ptv-admin-live-tv-panel-state' role='alert'>Tuner configuration is unavailable.</div>;
    if (!tuners.length) {
        return <div className='ptv-admin-live-tv-panel-state'><PtvIcon name='dvr' size='27px' /><strong>No tuners configured</strong><p>Add a supported tuner or discover compatible devices.</p></div>;
    }
    return (
        <div className='ptv-admin-live-tv-table'>
            <div aria-hidden='true' className='ptv-admin-live-tv-table-header'><span>Name</span><span>Status</span><span>Type</span><span>Connection</span><span>Actions</span></div>
            {tuners.map(tuner => <TunerRow key={tuner.id.toLowerCase()} onDelete={onDelete} tuner={tuner} />)}
        </div>
    );
}

export function AdminLiveTvTunerPanel({
    compact = false,
    error,
    onDelete,
    tuners
}: Readonly<{
    compact?: boolean;
    error: boolean;
    onDelete: (tuner: AdminLiveTvTuner) => void;
    tuners: readonly AdminLiveTvTuner[];
}>) {
    return (
        <section className={`ptv-admin-live-tv-panel${compact ? ' is-compact' : ''}`}>
            <header><div><h2>Tuner Devices</h2><p>Server-reported tuner configuration. Operational health is not inferred.</p></div><Link className='ptv-admin-live-tv-primary-link' to={`${ADMIN_LIVE_TV_PATH}/tuners/new`}>Add Tuner</Link></header>
            <TunerPanelContent error={error} onDelete={onDelete} tuners={tuners} />
        </section>
    );
}

function ProviderRow({ onDelete, provider }: Readonly<{
    onDelete: (provider: AdminLiveTvGuideProvider) => void;
    provider: AdminLiveTvGuideProvider;
}>) {
    const editorUnavailable = provider.editor === 'unknown';
    const remove = React.useCallback(() => onDelete(provider), [ onDelete, provider ]);
    return (
        <div className='ptv-admin-live-tv-row ptv-admin-live-tv-provider-row'>
            <div className='ptv-admin-live-tv-row-name'><span><PtvIcon name='guide' size='19px' /></span><div><strong>{provider.label}</strong><small>{provider.detail}</small></div></div>
            <AdminLiveTvStatusBadge tone={editorUnavailable ? 'warning' : 'healthy'}>{editorUnavailable ? 'Unavailable editor' : 'Configured'}</AdminLiveTvStatusBadge>
            <span>{provider.enableAllTuners ? 'All tuners' : `${provider.enabledTunerIds.length} selected`}</span>
            <div className='ptv-admin-live-tv-row-actions'>
                <Link aria-label={`Open ${provider.label}`} to={`${ADMIN_LIVE_TV_PATH}/guide/${encodeURIComponent(provider.id)}`}>{editorUnavailable ? 'View' : 'Edit'}</Link>
                <button aria-label={`Remove ${provider.label}`} className='is-danger' onClick={remove} type='button'>Remove</button>
            </div>
        </div>
    );
}

function GuidePanelContent({ error, onDelete, providers }: Readonly<{
    error: boolean;
    onDelete: (provider: AdminLiveTvGuideProvider) => void;
    providers: readonly AdminLiveTvGuideProvider[];
}>) {
    if (error) return <div className='ptv-admin-live-tv-panel-state' role='alert'>Guide provider configuration is unavailable.</div>;
    if (!providers.length) {
        return <div className='ptv-admin-live-tv-panel-state'><PtvIcon name='guide' size='27px' /><strong>No guide providers configured</strong><p>Add XMLTV or connect Schedules Direct when guide data is needed.</p></div>;
    }
    return (
        <div className='ptv-admin-live-tv-table'>
            <div aria-hidden='true' className='ptv-admin-live-tv-table-header is-provider'><span>Name</span><span>Status</span><span>Tuners</span><span>Actions</span></div>
            {providers.map(provider => <ProviderRow key={provider.id.toLowerCase()} onDelete={onDelete} provider={provider} />)}
        </div>
    );
}

export function AdminLiveTvGuidePanel({
    compact = false,
    error,
    guideTaskAvailable,
    guideTaskRunning,
    onDelete,
    onRefreshGuide,
    providers,
    refreshingGuide
}: Readonly<{
    compact?: boolean;
    error: boolean;
    guideTaskAvailable: boolean;
    guideTaskRunning: boolean;
    onDelete: (provider: AdminLiveTvGuideProvider) => void;
    onRefreshGuide: () => void;
    providers: readonly AdminLiveTvGuideProvider[];
    refreshingGuide: boolean;
}>) {
    const refreshRunning = guideTaskRunning || refreshingGuide;
    return (
        <section className={`ptv-admin-live-tv-panel${compact ? ' is-compact' : ''}`}>
            <header>
                <div><h2>Guide Providers</h2><p>Schedules Direct, XMLTV, and retained server providers.</p></div>
                <div className='ptv-admin-live-tv-panel-actions'>
                    <Link className='ptv-admin-live-tv-primary-link' to={`${ADMIN_LIVE_TV_PATH}/guide/new?type=xmltv`}>Add XMLTV</Link>
                    <Link to={`${ADMIN_LIVE_TV_PATH}/guide/new?type=schedulesdirect`}>Add Schedules Direct</Link>
                    <button disabled={!guideTaskAvailable || refreshRunning} onClick={onRefreshGuide} type='button'><PtvIcon name='refresh' size='16px' />{refreshRunning ? 'Refreshing…' : 'Refresh Guide'}</button>
                </div>
            </header>
            <GuidePanelContent error={error} onDelete={onDelete} providers={providers} />
        </section>
    );
}
