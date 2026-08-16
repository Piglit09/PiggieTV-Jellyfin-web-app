import React, { useCallback, useMemo, useRef, useState } from 'react';

import ConfirmDialog from '../../../../../../components/ConfirmDialog';
import { useApi } from '../../../../../../hooks/useApi';
import {
    AdminConfigurationActions,
    AdminConfigurationError,
    type AdminConfigurationFeedback,
    AdminConfigurationNotice,
    AdminConfigurationNumber,
    AdminConfigurationPanel,
    AdminConfigurationSelect,
    AdminConfigurationSkeleton,
    AdminConfigurationText,
    AdminConfigurationToggle
} from '../../configuration/AdminConfigurationPrimitives';
import { useAdminConfigurationForm } from '../../configuration/useAdminConfigurationForm';
import { useAdminUnsavedChanges } from '../../configuration/useAdminUnsavedChanges';
import {
    AdminServerConfigurationError,
    type AdminServerGeneralSettings,
    type AdminServerPowerAction
} from '../adminServerConfigurationModel';
import { useAdminServerGeneral } from '../useAdminServerConfiguration';

type GeneralForm = Readonly<{
    cachePath: string;
    libraryScanFanoutConcurrency: string;
    metadataPath: string;
    parallelImageEncodingLimit: string;
    quickConnectAvailable: boolean;
    serverName: string;
    uiCulture: string;
}>;

const IDLE: AdminConfigurationFeedback = { message: '', tone: 'idle' };

function toForm(settings: AdminServerGeneralSettings): GeneralForm {
    return {
        ...settings,
        libraryScanFanoutConcurrency: String(settings.libraryScanFanoutConcurrency),
        parallelImageEncodingLimit: String(settings.parallelImageEncodingLimit)
    };
}

function formsEqual(left: GeneralForm, right: GeneralForm) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function parseWhole(value: string) {
    if (!/^\d+$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

/* eslint-disable no-void, react/jsx-no-bind, sonarjs/cognitive-complexity */
export default function AdminServerGeneralPage() {
    const { __legacyApiClient__: apiClient, api } = useApi();
    const state = useAdminServerGeneral(api, apiClient);
    const source = useMemo(() => state.snapshot ? toForm(state.snapshot.settings) : null, [ state.snapshot ]);
    const formState = useAdminConfigurationForm(source, formsEqual);
    const [ feedback, setFeedback ] = useState<AdminConfigurationFeedback>(IDLE);
    const [ confirmation, setConfirmation ] = useState<AdminServerPowerAction | null>(null);
    const saveFlight = useRef(false);
    const scanConcurrency = formState.form ? parseWhole(formState.form.libraryScanFanoutConcurrency) : null;
    const imageConcurrency = formState.form ? parseWhole(formState.form.parallelImageEncodingLimit) : null;
    const valid = scanConcurrency !== null && imageConcurrency !== null
        && Boolean(formState.form?.serverName.trim())
        && Boolean(formState.form?.uiCulture.trim());
    const available = Boolean(formState.form && formState.confirmed && state.snapshot);

    useAdminUnsavedChanges(formState.dirty, 'Leave without saving your General server changes?');

    const update = useCallback(<K extends keyof GeneralForm>(field: K, value: GeneralForm[K]) => {
        formState.update(field, value);
        setFeedback(IDLE);
    }, [ formState ]);
    const reset = useCallback(() => {
        formState.reset();
        setFeedback(IDLE);
    }, [ formState ]);
    const reload = useCallback(async () => {
        try {
            const loaded = await state.refetch();
            if (!loaded) throw new Error('Unavailable');
            formState.adopt(toForm(loaded.settings));
            setFeedback(IDLE);
        } catch {
            setFeedback({ message: 'Latest server values could not be loaded.', tone: 'error' });
        }
    }, [ formState, state ]);
    const save = useCallback(async () => {
        if (!formState.form || !formState.confirmed || !valid || saveFlight.current || state.saving) return;
        saveFlight.current = true;
        const desired: AdminServerGeneralSettings = {
            ...formState.form,
            libraryScanFanoutConcurrency: scanConcurrency,
            parallelImageEncodingLimit: imageConcurrency
        };
        const confirmed: AdminServerGeneralSettings = {
            ...formState.confirmed,
            libraryScanFanoutConcurrency: Number(formState.confirmed.libraryScanFanoutConcurrency),
            parallelImageEncodingLimit: Number(formState.confirmed.parallelImageEncodingLimit)
        };
        try {
            const saved = await state.save(desired, confirmed);
            formState.adopt(toForm(saved.settings));
            setFeedback({ message: 'General settings saved.', tone: 'saved' });
        } catch (error) {
            if (error instanceof AdminServerConfigurationError && error.code === 'general-conflict') {
                formState.setServerChanged(true);
                setFeedback({ message: 'These settings changed on the server while you were editing.', tone: 'error' });
            } else {
                setFeedback({ message: "We couldn't save General settings.", tone: 'error' });
            }
        } finally {
            saveFlight.current = false;
        }
    }, [ formState, imageConcurrency, scanConcurrency, state, valid ]);
    const confirmPowerAction = useCallback(async () => {
        const action = confirmation;
        setConfirmation(null);
        if (!action) return;
        try {
            await state.runPowerAction(action);
            setFeedback({
                message: action === 'restart' ? 'Restart request accepted.' : 'Shutdown request accepted.',
                tone: 'saved'
            });
        } catch {
            setFeedback({
                message: action === 'restart' ? 'The restart request failed.' : 'The shutdown request failed.',
                tone: 'error'
            });
        }
    }, [ confirmation, state ]);

    if (state.loading && !available) return <AdminConfigurationSkeleton />;
    if (!available || !formState.form) {
        return (
            <AdminConfigurationError
                loading={false}
                message="General settings couldn't be loaded."
                onRetry={() => void state.refetch()}
                retrying={state.fetching}
            />
        );
    }

    const system = state.snapshot?.system;
    let pendingRestart = 'Unknown';
    if (system?.pendingRestart === true) pendingRestart = 'Yes';
    if (system?.pendingRestart === false) pendingRestart = 'No';
    const controlsDisabled = state.saving || formState.serverChanged;
    return (
        <section aria-labelledby='ptv-server-general-title' className='ptv-admin-server-section'>
            <header className='ptv-admin-server-section-heading'>
                <div><h2 id='ptv-server-general-title'>General</h2><p>Core identity, language, storage paths and server behavior.</p></div>
                {state.fetching ? <span role='status'>Refreshing</span> : null}
            </header>

            {formState.serverChanged ? (
                <AdminConfigurationNotice action={<button onClick={() => void reload()} type='button'>Reload server values</button>} tone='warning'>
                    <strong>These settings changed on the server while you were editing.</strong>
                    <p>Your edits remain visible, but must be reloaded before saving.</p>
                </AdminConfigurationNotice>
            ) : null}
            {state.languagesError ? (
                <AdminConfigurationNotice action={<button onClick={() => void state.refetchLanguages()} type='button'>Retry languages</button>}>
                    <strong>Language choices are temporarily unavailable.</strong>
                    <p>The currently configured culture is preserved.</p>
                </AdminConfigurationNotice>
            ) : null}

            <div className='ptv-admin-configuration-grid'>
                <AdminConfigurationPanel description='How this server identifies itself and presents administrative language.' title='Identity & Language'>
                    <AdminConfigurationText description='Name displayed to clients that connect to this server.' disabled={controlsDisabled} id='ptv-server-name' label='Server name' onChange={value => update('serverName', value)} value={formState.form.serverName} />
                    <AdminConfigurationSelect description='Server administration display culture.' disabled={controlsDisabled || Boolean(state.languagesError)} id='ptv-server-culture' label='Display language' onChange={value => update('uiCulture', value)} value={formState.form.uiCulture}>
                        {state.languages.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </AdminConfigurationSelect>
                    <AdminConfigurationToggle checked={formState.form.quickConnectAvailable} description='Allow supported clients to use Quick Connect.' disabled={controlsDisabled} id='ptv-server-quick-connect' label='Quick Connect' onChange={value => update('quickConnectAvailable', value)} />
                </AdminConfigurationPanel>

                <AdminConfigurationPanel description='Authoritative server paths. Changes may require a restart.' title='Storage Paths'>
                    <AdminConfigurationText description='Directory used for server cache data.' disabled={controlsDisabled} id='ptv-server-cache-path' label='Cache path' onChange={value => update('cachePath', value)} value={formState.form.cachePath} />
                    <AdminConfigurationText description='Directory used for server metadata.' disabled={controlsDisabled} id='ptv-server-metadata-path' label='Metadata path' onChange={value => update('metadataPath', value)} value={formState.form.metadataPath} />
                </AdminConfigurationPanel>

                <AdminConfigurationPanel description='Limits used by library and image processing work.' title='Processing'>
                    <AdminConfigurationNumber description='Zero keeps Jellyfin automatic behavior.' disabled={controlsDisabled} error={scanConcurrency === null ? 'Enter a whole number, 0 or greater.' : ''} id='ptv-server-scan-concurrency' label='Library scan concurrency' min={0} onChange={value => update('libraryScanFanoutConcurrency', value)} value={formState.form.libraryScanFanoutConcurrency} />
                    <AdminConfigurationNumber description='Maximum parallel image encoding work. Zero preserves automatic behavior.' disabled={controlsDisabled} error={imageConcurrency === null ? 'Enter a whole number, 0 or greater.' : ''} id='ptv-server-image-concurrency' label='Parallel image encoding' min={0} onChange={value => update('parallelImageEncodingLimit', value)} value={formState.form.parallelImageEncodingLimit} />
                </AdminConfigurationPanel>

                <AdminConfigurationPanel description='Read-only information from the connected Jellyfin server.' title='Server Status'>
                    <dl className='ptv-admin-server-definition-list'>
                        <div><dt>Product</dt><dd>{system?.productName || 'Unavailable'}</dd></div>
                        <div><dt>Version</dt><dd>{system?.version || 'Unavailable'}</dd></div>
                        <div><dt>Operating system</dt><dd>{system?.operatingSystem || 'Unavailable'}</dd></div>
                        <div><dt>Pending restart</dt><dd>{pendingRestart}</dd></div>
                    </dl>
                    {state.systemError ? <p className='ptv-admin-server-muted'>System status is temporarily unavailable. Configuration remains usable.</p> : null}
                </AdminConfigurationPanel>

                <AdminConfigurationPanel description='These requests interrupt every connected client and active operation.' title='Server Power' wide>
                    <div className='ptv-admin-server-danger-row'>
                        <div><strong>Restart or shut down the server</strong><small>Use only when you are prepared for an immediate service interruption.</small></div>
                        <div>
                            <button disabled={Boolean(state.powerAction) || system?.canSelfRestart === false} onClick={() => setConfirmation('restart')} type='button'>Restart Server</button>
                            <button className='is-danger' disabled={Boolean(state.powerAction)} onClick={() => setConfirmation('shutdown')} type='button'>Shut Down</button>
                        </div>
                    </div>
                </AdminConfigurationPanel>
            </div>

            <AdminConfigurationActions dirty={formState.dirty} feedback={feedback} onReset={reset} onSave={() => void save()} saveDisabled={!formState.dirty || !valid || formState.serverChanged} saving={state.saving} />

            <ConfirmDialog
                confirmButtonColor='error'
                confirmButtonText={confirmation === 'restart' ? 'Restart Server' : 'Shut Down Server'}
                onCancel={() => setConfirmation(null)}
                onConfirm={() => void confirmPowerAction()}
                open={Boolean(confirmation)}
                text={confirmation === 'restart' ? 'Restart PiggieTV now? Active streams and administrative work will be interrupted.' : 'Shut down PiggieTV now? The server will remain unavailable until it is started outside this app.'}
                title={confirmation === 'restart' ? 'Restart server?' : 'Shut down server?'}
            />
        </section>
    );
}
/* eslint-enable no-void, react/jsx-no-bind, sonarjs/cognitive-complexity */
