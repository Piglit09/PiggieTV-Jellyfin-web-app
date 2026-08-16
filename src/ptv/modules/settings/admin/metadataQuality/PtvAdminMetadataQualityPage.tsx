import React, { lazy, Suspense, useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useApi } from '../../../../../hooks/useApi';
import PtvIcon from '../../../icons/PtvIcon';
import {
    MetadataQualityDetail,
    MetadataQualityQueue,
    MetadataQualitySummary
} from './AdminMetadataQualityPresentation';
import { ADMIN_METADATA_QUALITY_PATH } from './adminMetadataQualityRouting';
import {
    DEFAULT_ADMIN_METADATA_QUALITY_FILTERS,
    type AdminMetadataQualityResolutionAction
} from './adminMetadataQualityModel';
import { useAdminMetadataQuality } from './useAdminMetadataQuality';

/* eslint-disable no-void, react/jsx-no-bind */

const loadAdminMetadataQualityDialogs = () => import('./AdminMetadataQualityDialogs');
const AdminMetadataQualityFullAuditDialog = lazy(async () => ({
    default: (await loadAdminMetadataQualityDialogs()).AdminMetadataQualityFullAuditDialog
}));
const AdminMetadataQualityResolutionDialog = lazy(async () => ({
    default: (await loadAdminMetadataQualityDialogs()).AdminMetadataQualityResolutionDialog
}));
const AdminMetadataQualitySettingsDialog = lazy(async () => ({
    default: (await loadAdminMetadataQualityDialogs()).AdminMetadataQualitySettingsDialog
}));

function MetadataQualityDialogFallback() {
    return <p aria-live='polite' className='ptv-metadata-quality-feedback' role='status'>Loading controls…</p>;
}

export default function PtvAdminMetadataQualityPage({ itemId }: Readonly<{ itemId: string }>) {
    const navigate = useNavigate();
    const { __legacyApiClient__: apiClient } = useApi();
    const [ filters, setFilters ] = useState(DEFAULT_ADMIN_METADATA_QUALITY_FILTERS);
    const [ settingsOpen, setSettingsOpen ] = useState(false);
    const [ fullAuditOpen, setFullAuditOpen ] = useState(false);
    const [ resolutionAction, setResolutionAction ] = useState<AdminMetadataQualityResolutionAction | null>(null);
    const state = useAdminMetadataQuality(apiClient, itemId, filters, settingsOpen || fullAuditOpen);
    const scanRunning = state.summary?.scan.state === 'scanning';
    const actionBusy = Boolean(state.activeAction);
    const scanControlsUnavailable = !state.summary || Boolean(state.summaryError);
    const closeSettings = useCallback(() => {
        if (!state.activeAction) setSettingsOpen(false);
    }, [ state.activeAction ]);
    const retrySummary = useCallback(() => void state.refetchSummary(), [ state ]);
    const retryResults = useCallback(() => void state.refetchResults(), [ state ]);
    const retryDetail = useCallback(() => void state.refetchDetail(), [ state ]);
    const retrySettings = useCallback(() => {
        void Promise.allSettled([ state.refetchSettings(), state.refetchAiStatus() ]);
    }, [ state ]);
    const startChanged = useCallback(() => void state.startScan('changed'), [ state ]);
    const stopScan = useCallback(() => void state.cancelScan(), [ state ]);
    const confirmFullAudit = useCallback(() => {
        if (actionBusy) return;
        void state.startScan('full').then(started => {
            if (started) setFullAuditOpen(false);
        });
    }, [ actionBusy, state ]);
    const confirmResolution = useCallback(() => {
        const action = resolutionAction;
        if (!action || actionBusy) return;
        void state.resolveResult(action).then(saved => {
            if (!saved) return;
            setResolutionAction(null);
            navigate(ADMIN_METADATA_QUALITY_PATH);
        });
    }, [ actionBusy, navigate, resolutionAction, state ]);

    return (
        <div className='ptv-metadata-quality' data-testid='ptv-admin-metadata-quality'>
            <header className='ptv-metadata-quality-header'>
                <div>
                    {itemId ? <Link className='ptv-metadata-quality-back' to={ADMIN_METADATA_QUALITY_PATH}><PtvIcon name='back' size='16px' />Review queue</Link> : null}
                    <p className='ptv-metadata-quality-eyebrow'>Metadata Intelligence</p>
                    <h1>Metadata Quality</h1>
                    <p>Automatically audit PiggieTV metadata and surface items that deserve review.</p>
                </div>
                <div className='ptv-metadata-quality-header-actions'>
                    <button
                        disabled={actionBusy}
                        onClick={() => {
                            state.clearActionFeedback();
                            setSettingsOpen(true);
                        }}
                        type='button'
                    ><PtvIcon name='settings' size='17px' />Settings</button>
                    {scanRunning ? (
                        <button className='is-warning' disabled={actionBusy} onClick={stopScan} type='button'><PtvIcon name='stop' size='17px' />Stop Scan</button>
                    ) : (
                        <>
                            <button disabled={actionBusy || scanControlsUnavailable} onClick={startChanged} type='button'><PtvIcon name='refresh' size='17px' />Scan New &amp; Changed</button>
                            <button className='is-primary' disabled={actionBusy || scanControlsUnavailable} onClick={() => setFullAuditOpen(true)} type='button'><PtvIcon name='quality' size='17px' />Full Audit</button>
                        </>
                    )}
                </div>
            </header>

            {state.actionError ? <p className='ptv-metadata-quality-feedback is-error' role='alert'>{state.actionError}</p> : null}
            {state.actionMessage ? <p aria-live='polite' className='ptv-metadata-quality-feedback is-success' role='status'>{state.actionMessage}</p> : null}

            <MetadataQualitySummary
                error={Boolean(state.summaryError)}
                loading={state.summaryLoading}
                onRetry={retrySummary}
                summary={state.summary}
            />

            {itemId ? (
                <MetadataQualityDetail
                    busy={actionBusy}
                    detail={state.detail}
                    error={Boolean(state.detailError)}
                    loading={state.detailLoading}
                    onDismiss={() => setResolutionAction('dismiss')}
                    onKeepCurrent={() => setResolutionAction('keep_current')}
                    onRetry={retryDetail}
                />
            ) : (
                <MetadataQualityQueue
                    error={Boolean(state.resultsError)}
                    fetching={state.resultsFetching}
                    filters={filters}
                    libraries={state.summary?.libraries || []}
                    loading={state.resultsLoading}
                    onFiltersChange={setFilters}
                    onRetry={retryResults}
                    page={state.resultPage}
                />
            )}

            {fullAuditOpen ? (
                <Suspense fallback={<MetadataQualityDialogFallback />}>
                    <AdminMetadataQualityFullAuditDialog
                        aiStatus={state.aiStatus}
                        busy={state.activeAction === 'start-scan'}
                        onCancel={() => {
                            if (!actionBusy) setFullAuditOpen(false);
                        }}
                        onConfirm={confirmFullAudit}
                        open
                        settings={state.settings}
                    />
                </Suspense>
            ) : null}
            {resolutionAction ? (
                <Suspense fallback={<MetadataQualityDialogFallback />}>
                    <AdminMetadataQualityResolutionDialog
                        action={resolutionAction}
                        busy={state.activeAction === 'resolve'}
                        onCancel={() => {
                            if (!actionBusy) setResolutionAction(null);
                        }}
                        onConfirm={confirmResolution}
                        title={state.detail?.title || 'this item'}
                    />
                </Suspense>
            ) : null}
            {settingsOpen ? (
                <Suspense fallback={<MetadataQualityDialogFallback />}>
                    <AdminMetadataQualitySettingsDialog
                        aiStatus={state.aiStatus}
                        aiStatusError={Boolean(state.aiStatusError)}
                        aiStatusLoading={state.aiStatusLoading}
                        aiTestError={state.aiTestError}
                        aiTestResult={state.aiTestResult}
                        busy={actionBusy}
                        error={Boolean(state.settingsError)}
                        libraries={state.summary?.libraries || []}
                        loading={state.settingsLoading}
                        onClose={closeSettings}
                        onRetry={retrySettings}
                        onSave={state.saveSettings}
                        onTestAi={state.testAiConnection}
                        open
                        saveError={state.actionError}
                        saving={state.activeAction === 'save-settings'}
                        settings={state.settings}
                        testing={state.activeAction === 'test-ai'}
                    />
                </Suspense>
            ) : null}
        </div>
    );
}

/* eslint-enable no-void, react/jsx-no-bind */
