import React, { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { useApi } from '../../../../../hooks/useApi';
import PtvIcon from '../../../icons/PtvIcon';
import { AdminConfigurationError, AdminConfigurationNotice, AdminConfigurationPanel } from '../configuration/AdminConfigurationPrimitives';
import {
    AdminLiveTvDvrForm,
    AdminLiveTvSchedulesDirectForm,
    AdminLiveTvTunerForm,
    AdminLiveTvXmlTvForm
} from './AdminLiveTvForms';
import type { AdminLiveTvGuideProvider, AdminLiveTvTuner } from './adminLiveTvModel';
import {
    AdminLiveTvGuidePanel,
    AdminLiveTvSkeleton,
    AdminLiveTvSummary,
    AdminLiveTvTabs,
    AdminLiveTvTunerPanel
} from './AdminLiveTvPresentation';
import {
    ADMIN_LIVE_TV_DVR_PATH,
    ADMIN_LIVE_TV_PATH,
    type AdminLiveTvRouteState
} from './AdminLiveTvRoute';
import { useAdminLiveTv } from './useAdminLiveTv';

const ConfirmDialog = lazy(() => import('../../../../../components/ConfirmDialog'));

type PendingRemoval =
    | Readonly<{ kind: 'provider'; value: AdminLiveTvGuideProvider }>
    | Readonly<{ kind: 'tuner'; value: AdminLiveTvTuner }>;

function routeCopy(route: AdminLiveTvRouteState) {
    if (route.kind === 'tuners' || route.kind === 'tuner') {
        return 'Configure server-reported tuner devices without probing them until you ask.';
    }
    if (route.kind === 'guide' || route.kind === 'provider') {
        return 'Manage guide sources and request guide refreshes explicitly.';
    }
    if (route.kind === 'dvr') {
        return 'Set recording defaults and server-owned recording locations.';
    }
    return 'Monitor and configure the server Live TV pipeline from one control center.';
}

function ProviderTypeChooser() {
    return (
        <div className='ptv-admin-live-tv-form-grid'>
            <AdminConfigurationPanel
                description='Choose a provider supported by Jellyfin. No provider request is made until you submit its form.'
                title='Add Guide Provider'
                wide
            >
                <div className='ptv-admin-live-tv-provider-types'>
                    <Link to={`${ADMIN_LIVE_TV_PATH}/guide/new?type=xmltv`}>
                        <PtvIcon name='guide' size='23px' />
                        <span><strong>XMLTV</strong><small>Use an XMLTV file available to the server or an XMLTV URL.</small></span>
                    </Link>
                    <Link to={`${ADMIN_LIVE_TV_PATH}/guide/new?type=schedulesdirect`}>
                        <PtvIcon name='liveTv' size='23px' />
                        <span><strong>Schedules Direct</strong><small>Connect an account, then choose its country and lineup.</small></span>
                    </Link>
                </div>
            </AdminConfigurationPanel>
        </div>
    );
}

function UnknownProvider({ provider }: Readonly<{ provider: AdminLiveTvGuideProvider }>) {
    return (
        <div className='ptv-admin-live-tv-form-grid'>
            <AdminConfigurationNotice tone='warning'>
                <strong>This provider does not have a native editor yet.</strong>
                <p>PiggieTV has preserved the server-reported {provider.type} provider without guessing at plugin-specific fields.</p>
            </AdminConfigurationNotice>
            <AdminConfigurationPanel
                description='Only safe, redacted provider information is shown.'
                title={provider.label}
                wide
            >
                <dl className='ptv-admin-live-tv-safe-details'>
                    <div><dt>Status</dt><dd>Configured</dd></div>
                    <div><dt>Type</dt><dd>{provider.type}</dd></div>
                    <div><dt>Tuners</dt><dd>{provider.enableAllTuners ? 'All tuners' : `${provider.enabledTunerIds.length} selected`}</dd></div>
                </dl>
            </AdminConfigurationPanel>
        </div>
    );
}

function MissingResource({ kind, onRetry, retrying }: Readonly<{
    kind: 'guide provider' | 'tuner';
    onRetry: () => void;
    retrying: boolean;
}>) {
    return (
        <AdminConfigurationError
            loading={false}
            message={`This ${kind} is no longer available.`}
            onRetry={onRetry}
            retrying={retrying}
        />
    );
}

/* eslint-disable no-void, react/jsx-no-bind, sonarjs/cognitive-complexity */
export default function PtvAdminLiveTvPage({ route }: Readonly<{ route: AdminLiveTvRouteState }>) {
    const { __legacyApiClient__: apiClient, api } = useApi();
    const state = useAdminLiveTv(api, apiClient);
    const [ pendingRemoval, setPendingRemoval ] = useState<PendingRemoval | null>(null);
    const removalFlightRef = useRef(false);
    const focusedActionRef = useRef<HTMLElement | null>(null);
    const configuration = state.configuration;
    const provider = useMemo(() => (
        route.kind === 'provider' && route.providerId ?
            configuration?.providers.find(item => item.id.toLowerCase() === route.providerId?.toLowerCase()) || null :
            null
    ), [ configuration?.providers, route ]);

    const requestRemoval = useCallback((value: AdminLiveTvGuideProvider | AdminLiveTvTuner, kind: PendingRemoval['kind']) => {
        focusedActionRef.current = document.activeElement as HTMLElement | null;
        setPendingRemoval({ kind, value } as PendingRemoval);
    }, []);
    const cancelRemoval = useCallback(() => {
        setPendingRemoval(null);
        requestAnimationFrame(() => focusedActionRef.current?.focus());
    }, []);
    const confirmRemoval = useCallback(async () => {
        if (!pendingRemoval || removalFlightRef.current) return;
        removalFlightRef.current = true;
        try {
            if (pendingRemoval.kind === 'tuner') await state.removeTuner(pendingRemoval.value.id);
            else await state.removeProvider(pendingRemoval.value.id);
            setPendingRemoval(null);
            requestAnimationFrame(() => focusedActionRef.current?.focus());
        } catch {
            // The hook owns redacted, user-facing failure feedback.
        } finally {
            removalFlightRef.current = false;
        }
    }, [ pendingRemoval, state ]);
    const retry = useCallback(() => void state.refresh(), [ state ]);
    const runGuideRefresh = useCallback(() => void state.runGuideRefresh().catch(() => undefined), [ state ]);
    const removeTuner = useCallback((value: AdminLiveTvTuner) => requestRemoval(value, 'tuner'), [ requestRemoval ]);
    const removeProvider = useCallback((value: AdminLiveTvGuideProvider) => requestRemoval(value, 'provider'), [ requestRemoval ]);

    let workspace: React.ReactNode;
    if (route.kind === 'overview') {
        workspace = (
            <>
                {state.initialLoading ? <AdminLiveTvSkeleton /> : (
                    <AdminLiveTvSummary
                        availability={state.capability?.availability || 'unknown'}
                        configurationAvailable={Boolean(configuration)}
                        providerCount={configuration ? configuration.providers.length : null}
                        tunerCount={configuration ? configuration.tuners.length : null}
                    />
                )}
                <AdminLiveTvTunerPanel compact error={state.configurationError} onDelete={removeTuner} tuners={configuration?.tuners || []} />
                <AdminLiveTvGuidePanel
                    compact
                    error={state.configurationError}
                    guideTaskAvailable={Boolean(state.refreshGuideTask?.canRun)}
                    guideTaskRunning={state.refreshGuideTask?.state === 'running'}
                    onDelete={removeProvider}
                    onRefreshGuide={runGuideRefresh}
                    providers={configuration?.providers || []}
                    refreshingGuide={state.action === 'guide:refresh'}
                />
                <section className='ptv-admin-live-tv-dvr-cta'>
                    <span><PtvIcon name='record' size='23px' /></span>
                    <div><h2>DVR & Recordings</h2><p>Review guide range, padding, recording locations and sidecar defaults.</p></div>
                    <Link to={ADMIN_LIVE_TV_DVR_PATH}>Open DVR Settings</Link>
                </section>
            </>
        );
    } else if (route.kind === 'tuners') {
        workspace = state.initialLoading ? <AdminLiveTvSkeleton /> : (
            <AdminLiveTvTunerPanel error={state.configurationError} onDelete={removeTuner} tuners={configuration?.tuners || []} />
        );
    } else if (route.kind === 'tuner') {
        const missing = route.tunerId && !state.initialLoading && configuration && !configuration.tuners.some(item => item.id.toLowerCase() === route.tunerId?.toLowerCase());
        workspace = missing ? <MissingResource kind='tuner' onRetry={retry} retrying={state.refreshing} /> : (
            <AdminLiveTvTunerForm state={state} tunerId={route.tunerId} />
        );
    } else if (route.kind === 'guide') {
        workspace = state.initialLoading ? <AdminLiveTvSkeleton /> : (
            <AdminLiveTvGuidePanel
                error={state.configurationError}
                guideTaskAvailable={Boolean(state.refreshGuideTask?.canRun)}
                guideTaskRunning={state.refreshGuideTask?.state === 'running'}
                onDelete={removeProvider}
                onRefreshGuide={runGuideRefresh}
                providers={configuration?.providers || []}
                refreshingGuide={state.action === 'guide:refresh'}
            />
        );
    } else if (route.kind === 'provider') {
        if (!route.providerId && route.providerType === null) workspace = <ProviderTypeChooser />;
        else if (!route.providerId && route.providerType === 'xmltv') workspace = <AdminLiveTvXmlTvForm provider={null} state={state} />;
        else if (!route.providerId && route.providerType === 'schedules-direct') workspace = <AdminLiveTvSchedulesDirectForm provider={null} state={state} />;
        else if (state.initialLoading) workspace = <AdminLiveTvSkeleton />;
        else if (!provider) workspace = <MissingResource kind='guide provider' onRetry={retry} retrying={state.refreshing} />;
        else if (provider.editor === 'xmltv') workspace = <AdminLiveTvXmlTvForm provider={provider} state={state} />;
        else if (provider.editor === 'schedules-direct') workspace = <AdminLiveTvSchedulesDirectForm provider={provider} state={state} />;
        else workspace = <UnknownProvider provider={provider} />;
    } else {
        workspace = <AdminLiveTvDvrForm state={state} />;
    }

    const removalName = pendingRemoval?.value.label || 'this configuration';
    const removalBusy = Boolean(pendingRemoval && state.action === `${pendingRemoval.kind === 'tuner' ? 'tuner' : 'provider'}:delete:${pendingRemoval.value.id}`);
    let removalButtonLabel = pendingRemoval?.kind === 'tuner' ? 'Remove Tuner' : 'Remove Provider';
    if (removalBusy) removalButtonLabel = 'Removing...';

    return (
        <section className='ptv-admin-live-tv' data-testid='ptv-admin-live-tv'>
            <header className='ptv-admin-live-tv-header'>
                <div><p className='ptv-admin-live-tv-eyebrow'>PiggieTV Administration</p><h1>Live TV Control Center</h1><p>{routeCopy(route)}</p></div>
                <button aria-busy={state.refreshing} disabled={state.refreshing} onClick={() => void state.refresh()} type='button'>
                    <PtvIcon name='refresh' size='17px' />{state.refreshing ? 'Refreshing...' : 'Refresh'}
                </button>
            </header>
            <AdminLiveTvTabs route={route} />

            {state.feedback ? <aside aria-live={state.feedback.tone === 'error' ? 'assertive' : 'polite'} className='ptv-admin-live-tv-feedback' data-tone={state.feedback.tone} role={state.feedback.tone === 'error' ? 'alert' : 'status'}><PtvIcon name={state.feedback.tone === 'error' ? 'alerts' : 'check'} size='18px' /><span>{state.feedback.message}</span></aside> : null}
            {state.capabilityError ? <aside className='ptv-admin-live-tv-feedback' data-tone='info' role='status'><PtvIcon name='alerts' size='18px' /><span>Live TV capability status is unavailable. Configuration remains independent.</span></aside> : null}
            {state.taskError && (route.kind === 'overview' || route.kind === 'guide') ? <aside className='ptv-admin-live-tv-feedback' data-tone='info' role='status'><PtvIcon name='alerts' size='18px' /><span>Scheduled task status is unavailable. Guide providers remain usable.</span></aside> : null}

            {workspace}

            {pendingRemoval ? (
                <Suspense fallback={null}>
                    <ConfirmDialog
                        className='ptv-admin-live-tv-dialog'
                        confirmButtonColor='error'
                        confirmButtonText={removalButtonLabel}
                        onCancel={cancelRemoval}
                        onConfirm={() => void confirmRemoval()}
                        open
                        text={pendingRemoval.kind === 'tuner' ? 'Jellyfin will remove this tuner configuration. Existing recordings are not deleted.' : 'Jellyfin will remove this guide source. Existing media and recordings are not deleted.'}
                        title={`Remove ${removalName}?`}
                    />
                </Suspense>
            ) : null}
        </section>
    );
}
/* eslint-enable no-void, react/jsx-no-bind, sonarjs/cognitive-complexity */
