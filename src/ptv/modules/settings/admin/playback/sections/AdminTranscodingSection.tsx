import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useApi } from '../../../../../../hooks/useApi';
import {
    AdminConfigurationActions,
    AdminConfigurationError,
    type AdminConfigurationFeedback,
    AdminConfigurationNotice,
    AdminConfigurationSkeleton
} from '../../configuration/AdminConfigurationPrimitives';
import { useAdminConfigurationForm } from '../../configuration/useAdminConfigurationForm';
import { useAdminUnsavedChanges } from '../../configuration/useAdminUnsavedChanges';
import { useAdminTranscoding } from '../useAdminPlayback';
import type { AdminPlaybackGuardRegistration } from '../PtvAdminPlaybackPage';
import { ADMIN_TRANSCODING_HARDWARE_ACCELERATION_OPTIONS } from '../adminTranscodingAdapters';
import { AdminPlaybackSectionHeading, isConflictError } from './AdminPlaybackSectionSupport';
import AdminTranscodingFields from './AdminTranscodingFields';
import {
    areAdminTranscodingFormsEqual,
    parseAdminTranscodingForm,
    toAdminTranscodingForm,
    type AdminTranscodingForm
} from './adminTranscodingForm';

const IDLE_FEEDBACK: AdminConfigurationFeedback = { message: '', tone: 'idle' };

function TranscodingSummary({ form }: Readonly<{ form: AdminTranscodingForm }>) {
    const hardware = ADMIN_TRANSCODING_HARDWARE_ACCELERATION_OPTIONS.find(
        option => option.value === form.hardwareAccelerationType
    );

    return (
        <dl aria-label='Transcoding summary' className='ptv-admin-playback-transcoding-summary'>
            <div>
                <dt>Hardware acceleration</dt>
                <dd>{hardware?.label ?? `${form.hardwareAccelerationType} (configured)`}</dd>
            </div>
            <div>
                <dt>Transcode path</dt>
                <dd>{form.transcodingTempPath || 'Server default'}</dd>
            </div>
            <div>
                <dt>Throttle</dt>
                <dd>{form.enableThrottling ? 'Enabled' : 'Disabled'}</dd>
            </div>
        </dl>
    );
}

/* eslint-disable no-void, react/jsx-no-bind */
export default function AdminTranscodingSection({
    onGuardChange
}: Readonly<{ onGuardChange: AdminPlaybackGuardRegistration }>) {
    const { __legacyApiClient__: apiClient, api } = useApi();
    const state = useAdminTranscoding(api, apiClient);
    const source = useMemo(
        () => state.settings ? toAdminTranscodingForm(state.settings) : null,
        [ state.settings ]
    );
    const formState = useAdminConfigurationForm(source, areAdminTranscodingFormsEqual);
    const [ feedback, setFeedback ] = useState<AdminConfigurationFeedback>(IDLE_FEEDBACK);
    const saveFlight = useRef(false);
    const reloadFlight = useRef(false);
    const parsed = formState.form ? parseAdminTranscodingForm(formState.form) : null;
    const hasSettings = Boolean(formState.form && formState.confirmed && state.settings);
    const reset = useCallback(() => {
        const latest = formState.serverChanged ? state.reset() : null;
        formState.reset(latest ? toAdminTranscodingForm(latest) : undefined);
        setFeedback(IDLE_FEEDBACK);
    }, [ formState, state ]);
    const isBusy = useCallback(() => saveFlight.current || state.saving, [ state.saving ]);

    useAdminUnsavedChanges(formState.dirty, 'Leave without saving your Transcoding changes?');
    useEffect(
        () => onGuardChange(formState.dirty, isBusy, reset),
        [ formState.dirty, isBusy, onGuardChange, reset ]
    );

    const update = useCallback(<K extends keyof AdminTranscodingForm>(
        field: K,
        value: AdminTranscodingForm[K]
    ) => {
        formState.update(field, value);
        setFeedback(IDLE_FEEDBACK);
    }, [ formState ]);
    const reload = useCallback(async () => {
        if (reloadFlight.current || state.saving) return;
        reloadFlight.current = true;
        setFeedback(IDLE_FEEDBACK);
        try {
            const latest = await state.refetch();
            if (!latest) throw new Error('Unavailable');
            formState.adopt(toAdminTranscodingForm(latest.settings));
        } catch {
            setFeedback({
                message: 'Latest server settings could not be loaded. Your edits are still here.',
                tone: 'error'
            });
        } finally {
            reloadFlight.current = false;
        }
    }, [ formState, state ]);
    const save = useCallback(async () => {
        const confirmed = formState.confirmed ? parseAdminTranscodingForm(formState.confirmed) : null;
        if (
            !parsed
            || !confirmed
            || !formState.dirty
            || formState.serverChanged
            || state.saving
            || saveFlight.current
        ) return;
        saveFlight.current = true;
        setFeedback(IDLE_FEEDBACK);
        try {
            const saved = await state.save(parsed, confirmed);
            formState.adopt(toAdminTranscodingForm(saved.settings));
            setFeedback({ message: 'Transcoding settings saved.', tone: 'saved' });
        } catch (error) {
            if (isConflictError(error)) {
                formState.setServerChanged(true);
                setFeedback({
                    message: 'These settings changed on the server while you were editing.',
                    tone: 'error'
                });
            } else {
                setFeedback({ message: "We couldn't save Transcoding settings.", tone: 'error' });
            }
        } finally {
            saveFlight.current = false;
        }
    }, [ formState, parsed, state ]);

    return (
        <section className='ptv-admin-configuration' data-testid='ptv-admin-transcoding'>
            <AdminPlaybackSectionHeading
                description='Configure server-side encoding, acceleration, storage, and processing.'
                fetching={state.fetching && hasSettings}
                title='Transcoding'
            />

            {formState.serverChanged ? (
                <AdminConfigurationNotice
                    action={<button disabled={state.fetching || state.saving} onClick={() => void reload()} type='button'>Reload server values</button>}
                    tone='warning'
                >
                    <strong>These settings changed on the server while you were editing.</strong>
                    <p>Your edits are still here. Reload the latest server values before saving.</p>
                </AdminConfigurationNotice>
            ) : null}
            {formState.form && !parsed ? (
                <AdminConfigurationNotice tone='warning'>
                    <strong>Review the values in this section.</strong>
                    <p>Save remains unavailable until every numeric value is within its supported range.</p>
                </AdminConfigurationNotice>
            ) : null}

            {state.loading && !hasSettings ? <AdminConfigurationSkeleton /> : null}
            {!state.loading && !hasSettings ? (
                <AdminConfigurationError
                    loading={false}
                    message="Transcoding settings couldn't be loaded."
                    onRetry={() => void state.refetch()}
                    retrying={state.fetching}
                />
            ) : null}

            {hasSettings && formState.form ? (
                <>
                    <TranscodingSummary form={formState.form} />
                    <AdminConfigurationNotice tone='info'>
                        <strong>Server playback processing</strong>
                        <p>Hardware, codec, quality, and path changes primarily apply to newly created transcodes. Throttling and segment cleanup can affect active jobs.</p>
                    </AdminConfigurationNotice>
                    <AdminTranscodingFields
                        disabled={state.saving || formState.serverChanged}
                        form={formState.form}
                        update={update}
                    />
                    <AdminConfigurationActions
                        dirty={formState.dirty}
                        feedback={feedback}
                        onReset={reset}
                        onSave={() => void save()}
                        saveDisabled={!parsed || !formState.dirty || formState.serverChanged || state.saving}
                        saving={state.saving}
                    />
                    <p className='ptv-admin-configuration-note'>Saving configuration does not start a transcode, stop a session, or restart the server.</p>
                </>
            ) : null}
        </section>
    );
}
/* eslint-enable no-void, react/jsx-no-bind */
