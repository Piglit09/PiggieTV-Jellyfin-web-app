import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useApi } from '../../../../../../hooks/useApi';
import {
    AdminConfigurationActions,
    AdminConfigurationError,
    type AdminConfigurationFeedback,
    AdminConfigurationNotice,
    AdminConfigurationNumber,
    AdminConfigurationPanel,
    AdminConfigurationSkeleton
} from '../../configuration/AdminConfigurationPrimitives';
import { useAdminConfigurationForm } from '../../configuration/useAdminConfigurationForm';
import { useAdminUnsavedChanges } from '../../configuration/useAdminUnsavedChanges';
import {
    adminStreamingFormToSettings,
    adminStreamingSettingsToForm
} from '../adminPlaybackSettingsAdapters';
import type { AdminStreamingSettings } from '../adminPlaybackSettingsModel';
import { useAdminStreaming } from '../useAdminPlayback';
import type { AdminPlaybackGuardRegistration } from '../PtvAdminPlaybackPage';
import {
    AdminPlaybackSectionHeading,
    getAdminPlaybackSaveErrorMessage,
    isConflictError
} from './AdminPlaybackSectionSupport';

type StreamingForm = Readonly<{ remoteBitrateLimitMbps: string }>;
const IDLE_FEEDBACK: AdminConfigurationFeedback = { message: '', tone: 'idle' };

function toForm(settings: AdminStreamingSettings): StreamingForm {
    const value = adminStreamingSettingsToForm(settings).remoteBitrateLimitMbps;
    return { remoteBitrateLimitMbps: String(value) };
}

function formsEqual(left: StreamingForm, right: StreamingForm) {
    return left.remoteBitrateLimitMbps === right.remoteBitrateLimitMbps;
}

function parseMbps(value: string) {
    if (!value.trim()) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/* eslint-disable no-void, react/jsx-no-bind */
export default function AdminStreamingSection({
    onGuardChange
}: Readonly<{ onGuardChange: AdminPlaybackGuardRegistration }>) {
    const { __legacyApiClient__: apiClient, api } = useApi();
    const state = useAdminStreaming(api, apiClient);
    const source = useMemo(() => state.settings ? toForm(state.settings) : null, [ state.settings ]);
    const formState = useAdminConfigurationForm(source, formsEqual);
    const [ feedback, setFeedback ] = useState<AdminConfigurationFeedback>(IDLE_FEEDBACK);
    const saveFlight = useRef(false);
    const reloadFlight = useRef(false);
    const mbps = formState.form ? parseMbps(formState.form.remoteBitrateLimitMbps) : null;
    const hasSettings = Boolean(formState.form && formState.confirmed && state.settings);
    const resetChanges = useCallback(() => {
        const latest = formState.serverChanged ? state.reset() : null;
        formState.reset(latest ? toForm(latest) : undefined);
        setFeedback(IDLE_FEEDBACK);
    }, [ formState, state ]);
    const isBusy = useCallback(() => saveFlight.current || state.saving, [ state.saving ]);

    useAdminUnsavedChanges(formState.dirty, 'Leave without saving your Streaming changes?');
    useEffect(
        () => onGuardChange(formState.dirty, isBusy, resetChanges),
        [ formState.dirty, isBusy, onGuardChange, resetChanges ]
    );

    const reload = useCallback(async () => {
        if (reloadFlight.current || state.saving) return;
        reloadFlight.current = true;
        setFeedback(IDLE_FEEDBACK);
        try {
            const latest = await state.refetch();
            if (!latest) throw new Error('Unavailable');
            formState.adopt(toForm(latest.settings));
        } catch {
            setFeedback({ message: 'Latest server settings could not be loaded. Your edits are still here.', tone: 'error' });
        } finally {
            reloadFlight.current = false;
        }
    }, [ formState, state ]);
    const save = useCallback(async () => {
        if (!formState.form || !formState.confirmed || mbps === null || !formState.dirty || formState.serverChanged || state.saving || saveFlight.current) return;
        saveFlight.current = true;
        setFeedback(IDLE_FEEDBACK);
        try {
            const desired = adminStreamingFormToSettings({ remoteBitrateLimitMbps: mbps });
            const confirmedMbps = parseMbps(formState.confirmed.remoteBitrateLimitMbps);
            if (confirmedMbps === null) throw new Error('Invalid baseline');
            const confirmed = adminStreamingFormToSettings({ remoteBitrateLimitMbps: confirmedMbps });
            const saved = await state.save(desired, confirmed);
            formState.adopt(toForm(saved.settings));
            setFeedback({ message: 'Streaming settings saved.', tone: 'saved' });
        } catch (error) {
            if (isConflictError(error)) {
                formState.setServerChanged(true);
                setFeedback({ message: 'These settings changed on the server while you were editing.', tone: 'error' });
            } else {
                setFeedback({
                    message: getAdminPlaybackSaveErrorMessage(
                        error,
                        "We couldn't save Streaming settings."
                    ),
                    tone: 'error'
                });
            }
        } finally {
            saveFlight.current = false;
        }
    }, [ formState, mbps, state ]);

    return (
        <section className='ptv-admin-configuration' data-testid='ptv-admin-streaming'>
            <AdminPlaybackSectionHeading
                description='Set the server-wide bitrate limit used for remote internet streams.'
                fetching={state.fetching && hasSettings}
                title='Streaming'
            />
            {formState.serverChanged ? (
                <AdminConfigurationNotice action={<button disabled={state.fetching || state.saving} onClick={() => void reload()} type='button'>Reload server values</button>} tone='warning'>
                    <strong>These settings changed on the server while you were editing.</strong>
                    <p>Your edits are still here. Reload the latest server value before saving.</p>
                </AdminConfigurationNotice>
            ) : null}
            {state.loading && !hasSettings ? <AdminConfigurationSkeleton /> : null}
            {!state.loading && !hasSettings ? (
                <AdminConfigurationError loading={false} message="Streaming settings couldn't be loaded." onRetry={() => void state.refetch()} retrying={state.fetching} />
            ) : null}
            {hasSettings && formState.form ? (
                <>
                    <div className='ptv-admin-configuration-grid'>
                        <AdminConfigurationPanel description='Limit remote playback without changing any member’s personal playback preferences.' title='Internet Streaming' wide>
                            <AdminConfigurationNumber
                                description='Maximum bitrate for each remote stream. Enter 0 for unlimited bandwidth.'
                                disabled={state.saving || formState.serverChanged}
                                error={mbps === null ? 'Enter a number of Mbps, 0 or greater.' : ''}
                                id='ptv-admin-streaming-bitrate'
                                label='Internet streaming bitrate limit'
                                min={0}
                                onChange={value => {
                                    formState.update('remoteBitrateLimitMbps', value);
                                    setFeedback(IDLE_FEEDBACK);
                                }}
                                step={0.25}
                                suffix='Mbps'
                                value={formState.form.remoteBitrateLimitMbps}
                            />
                            <AdminConfigurationNotice tone='info'>
                                <strong>Server-wide remote limit</strong>
                                <p>This affects new out-of-network streams. A member-specific limit can take precedence.</p>
                            </AdminConfigurationNotice>
                        </AdminConfigurationPanel>
                    </div>
                    <AdminConfigurationActions dirty={formState.dirty} feedback={feedback} onReset={resetChanges} onSave={() => void save()} saveDisabled={!formState.dirty || mbps === null || formState.serverChanged || state.saving} saving={state.saving} />
                    <p className='ptv-admin-configuration-note'>Saving changes does not start playback or disconnect active sessions.</p>
                </>
            ) : null}
        </section>
    );
}
/* eslint-enable no-void, react/jsx-no-bind */
