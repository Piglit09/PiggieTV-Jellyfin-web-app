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
import type { AdminResumeSettings } from '../adminPlaybackSettingsModel';
import { useAdminResume } from '../useAdminPlayback';
import type { AdminPlaybackGuardRegistration } from '../PtvAdminPlaybackPage';
import {
    AdminPlaybackSectionHeading,
    getAdminPlaybackSaveErrorMessage,
    isConflictError,
    parseWholeNumber
} from './AdminPlaybackSectionSupport';

type ResumeForm = { [K in keyof AdminResumeSettings]: string };
const IDLE_FEEDBACK: AdminConfigurationFeedback = { message: '', tone: 'idle' };

function toForm(settings: AdminResumeSettings): ResumeForm {
    return {
        audiobookCompletionRemainingMinutes: String(settings.audiobookCompletionRemainingMinutes),
        audiobookMinimumElapsedMinutes: String(settings.audiobookMinimumElapsedMinutes),
        maximumResumePercentage: String(settings.maximumResumePercentage),
        minimumEligibleDurationSeconds: String(settings.minimumEligibleDurationSeconds),
        minimumResumePercentage: String(settings.minimumResumePercentage)
    };
}

function formsEqual(left: ResumeForm, right: ResumeForm) {
    return Object.keys(left).every(key => left[key as keyof ResumeForm] === right[key as keyof ResumeForm]);
}

function parseForm(form: ResumeForm): AdminResumeSettings | null {
    const minimumResumePercentage = parseWholeNumber(form.minimumResumePercentage, 0, 100);
    const maximumResumePercentage = parseWholeNumber(form.maximumResumePercentage, 0, 100);
    const minimumEligibleDurationSeconds = parseWholeNumber(form.minimumEligibleDurationSeconds);
    const audiobookMinimumElapsedMinutes = parseWholeNumber(form.audiobookMinimumElapsedMinutes);
    const audiobookCompletionRemainingMinutes = parseWholeNumber(form.audiobookCompletionRemainingMinutes);
    if (
        minimumResumePercentage === null
        || maximumResumePercentage === null
        || minimumEligibleDurationSeconds === null
        || audiobookMinimumElapsedMinutes === null
        || audiobookCompletionRemainingMinutes === null
        || minimumResumePercentage >= maximumResumePercentage
    ) return null;
    return {
        audiobookCompletionRemainingMinutes,
        audiobookMinimumElapsedMinutes,
        maximumResumePercentage,
        minimumEligibleDurationSeconds,
        minimumResumePercentage
    };
}

function getResumeFormErrors(form: ResumeForm | null) {
    if (!form) {
        return {
            audiobookCompletion: '',
            audiobookMinimum: '',
            maximumResume: '',
            minimumDuration: '',
            minimumResume: '',
            resumeOrder: ''
        };
    }
    const minimumResume = parseWholeNumber(form.minimumResumePercentage, 0, 100) === null ?
        'Enter a whole percentage from 0 to 100.' : '';
    const maximumResume = parseWholeNumber(form.maximumResumePercentage, 0, 100) === null ?
        'Enter a whole percentage from 0 to 100.' : '';

    return {
        audiobookCompletion: parseWholeNumber(form.audiobookCompletionRemainingMinutes) === null ?
            'Enter a whole number of minutes, 0 or greater.' : '',
        audiobookMinimum: parseWholeNumber(form.audiobookMinimumElapsedMinutes) === null ?
            'Enter a whole number of minutes, 0 or greater.' : '',
        maximumResume,
        minimumDuration: parseWholeNumber(form.minimumEligibleDurationSeconds) === null ?
            'Enter a whole number of seconds, 0 or greater.' : '',
        minimumResume,
        resumeOrder: !minimumResume && !maximumResume
            && Number(form.minimumResumePercentage) >= Number(form.maximumResumePercentage) ?
            'Use whole percentages and keep the minimum below the completion point.' : ''
    };
}

/* eslint-disable no-void, react/jsx-no-bind */
export default function AdminResumeSection({ onGuardChange }: Readonly<{ onGuardChange: AdminPlaybackGuardRegistration }>) {
    const { __legacyApiClient__: apiClient, api } = useApi();
    const state = useAdminResume(api, apiClient);
    const source = useMemo(() => state.settings ? toForm(state.settings) : null, [ state.settings ]);
    const formState = useAdminConfigurationForm(source, formsEqual);
    const [ feedback, setFeedback ] = useState<AdminConfigurationFeedback>(IDLE_FEEDBACK);
    const saveFlight = useRef(false);
    const parsed = formState.form ? parseForm(formState.form) : null;
    const errors = getResumeFormErrors(formState.form);
    const hasSettings = Boolean(formState.form && formState.confirmed && state.settings);
    const reset = useCallback(() => {
        const latest = formState.serverChanged ? state.reset() : null;
        formState.reset(latest ? toForm(latest) : undefined);
        setFeedback(IDLE_FEEDBACK);
    }, [ formState, state ]);
    const isBusy = useCallback(() => saveFlight.current || state.saving, [ state.saving ]);
    useAdminUnsavedChanges(formState.dirty, 'Leave without saving your Resume changes?');
    useEffect(
        () => onGuardChange(formState.dirty, isBusy, reset),
        [ formState.dirty, isBusy, onGuardChange, reset ]
    );

    const update = useCallback((field: keyof ResumeForm, value: string) => {
        formState.update(field, value);
        setFeedback(IDLE_FEEDBACK);
    }, [ formState ]);
    const reload = useCallback(async () => {
        try {
            const latest = await state.refetch();
            if (!latest) throw new Error('Unavailable');
            formState.adopt(toForm(latest.settings));
            setFeedback(IDLE_FEEDBACK);
        } catch {
            setFeedback({ message: 'Latest server settings could not be loaded. Your edits are still here.', tone: 'error' });
        }
    }, [ formState, state ]);
    const save = useCallback(async () => {
        const confirmed = formState.confirmed ? parseForm(formState.confirmed) : null;
        if (!parsed || !confirmed || !formState.dirty || formState.serverChanged || state.saving || saveFlight.current) return;
        saveFlight.current = true;
        setFeedback(IDLE_FEEDBACK);
        try {
            const saved = await state.save(parsed, confirmed);
            formState.adopt(toForm(saved.settings));
            setFeedback({ message: 'Resume settings saved.', tone: 'saved' });
        } catch (error) {
            if (isConflictError(error)) {
                formState.setServerChanged(true);
                setFeedback({ message: 'These settings changed on the server while you were editing.', tone: 'error' });
            } else {
                setFeedback({
                    message: getAdminPlaybackSaveErrorMessage(
                        error,
                        "We couldn't save Resume settings."
                    ),
                    tone: 'error'
                });
            }
        } finally {
            saveFlight.current = false;
        }
    }, [ formState, parsed, state ]);
    const controlsDisabled = state.saving || formState.serverChanged;

    return (
        <section className='ptv-admin-configuration' data-testid='ptv-admin-resume'>
            <AdminPlaybackSectionHeading description='Choose when video and audiobook progress becomes resumable or complete.' fetching={state.fetching && hasSettings} title='Resume' />
            {formState.serverChanged ? <AdminConfigurationNotice action={<button onClick={() => void reload()} type='button'>Reload server values</button>} tone='warning'><strong>These settings changed on the server while you were editing.</strong><p>Reload the latest values before saving.</p></AdminConfigurationNotice> : null}
            {state.loading && !hasSettings ? <AdminConfigurationSkeleton /> : null}
            {!state.loading && !hasSettings ? <AdminConfigurationError loading={false} message="Resume settings couldn't be loaded." onRetry={() => void state.refetch()} retrying={state.fetching} /> : null}
            {hasSettings && formState.form ? (
                <>
                    <div className='ptv-admin-configuration-grid'>
                        <AdminConfigurationPanel description='Progress thresholds used for video resume points.' title='Video Resume'>
                            <AdminConfigurationNumber description='Progress below this percentage is not saved as a resume point.' disabled={controlsDisabled} error={errors.minimumResume || errors.resumeOrder} id='ptv-resume-minimum-percent' label='Minimum resume point' max={100} min={0} onChange={value => update('minimumResumePercentage', value)} suffix='%' value={formState.form.minimumResumePercentage} />
                            <AdminConfigurationNumber description='Progress at or above this percentage marks the item played.' disabled={controlsDisabled} error={errors.maximumResume || errors.resumeOrder} id='ptv-resume-maximum-percent' label='Completion point' max={100} min={0} onChange={value => update('maximumResumePercentage', value)} suffix='%' value={formState.form.maximumResumePercentage} />
                            <AdminConfigurationNumber description='Videos shorter than this total duration do not get resume points.' disabled={controlsDisabled} error={errors.minimumDuration} id='ptv-resume-minimum-duration' label='Minimum eligible video length' min={0} onChange={value => update('minimumEligibleDurationSeconds', value)} suffix='seconds' value={formState.form.minimumEligibleDurationSeconds} />
                        </AdminConfigurationPanel>
                        <AdminConfigurationPanel description='Time thresholds used for audiobook resume and completion.' title='Audiobook Resume'>
                            <AdminConfigurationNumber description='Elapsed listening time required before saving a resume point.' disabled={controlsDisabled} error={errors.audiobookMinimum} id='ptv-resume-audio-minimum' label='Minimum resume point' min={0} onChange={value => update('audiobookMinimumElapsedMinutes', value)} suffix='minutes elapsed' value={formState.form.audiobookMinimumElapsedMinutes} />
                            <AdminConfigurationNumber description='Mark complete when this many minutes or fewer remain.' disabled={controlsDisabled} error={errors.audiobookCompletion} id='ptv-resume-audio-completion' label='Completion threshold' min={0} onChange={value => update('audiobookCompletionRemainingMinutes', value)} suffix='minutes remaining' value={formState.form.audiobookCompletionRemainingMinutes} />
                        </AdminConfigurationPanel>
                    </div>
                    <AdminConfigurationActions dirty={formState.dirty} feedback={feedback} onReset={reset} onSave={() => void save()} saveDisabled={!parsed || !formState.dirty || formState.serverChanged || state.saving} saving={state.saving} />
                    <p className='ptv-admin-configuration-note'>These server-wide thresholds are applied when playback progress is updated.</p>
                </>
            ) : null}
        </section>
    );
}
/* eslint-enable no-void, react/jsx-no-bind */
