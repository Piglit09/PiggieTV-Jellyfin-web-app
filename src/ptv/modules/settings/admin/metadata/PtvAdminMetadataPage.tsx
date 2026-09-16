import { ImageResolution } from '@jellyfin/sdk/lib/generated-client/models/image-resolution';
import React, { useCallback, useMemo, useRef, useState } from 'react';

import { useApi } from '../../../../../hooks/useApi';
import {
    AdminConfigurationActions,
    AdminConfigurationError,
    type AdminConfigurationFeedback,
    AdminConfigurationHeader,
    AdminConfigurationNotice,
    AdminConfigurationNumber,
    AdminConfigurationPanel,
    AdminConfigurationRelatedLink,
    AdminConfigurationSelect,
    AdminConfigurationSkeleton
} from '../configuration/AdminConfigurationPrimitives';
import { useAdminConfigurationForm } from '../configuration/useAdminConfigurationForm';
import { useAdminUnsavedChanges } from '../configuration/useAdminUnsavedChanges';
import { AdminMetadataServiceError, type AdminMetadataSettings } from './adminMetadataModel';
import { useAdminMetadata } from './useAdminMetadata';

type MetadataForm = Readonly<{
    chapterImageResolution: ImageResolution;
    dummyChapterDurationSeconds: string;
    preferredCountryCode: string;
    preferredLanguage: string;
}>;

const IDLE_FEEDBACK: AdminConfigurationFeedback = { message: '', tone: 'idle' };
const IMAGE_RESOLUTION_OPTIONS: readonly Readonly<{ label: string; value: ImageResolution }>[] = [
    { label: 'Match source', value: ImageResolution.MatchSource },
    { label: '144p', value: ImageResolution.P144 },
    { label: '240p', value: ImageResolution.P240 },
    { label: '360p', value: ImageResolution.P360 },
    { label: '480p', value: ImageResolution.P480 },
    { label: '720p', value: ImageResolution.P720 },
    { label: '1080p', value: ImageResolution.P1080 },
    { label: '1440p', value: ImageResolution.P1440 },
    { label: '2160p', value: ImageResolution.P2160 }
] as const;

function toMetadataForm(settings: AdminMetadataSettings): MetadataForm {
    return {
        ...settings,
        dummyChapterDurationSeconds: String(settings.dummyChapterDurationSeconds)
    };
}

function metadataFormsEqual(left: MetadataForm, right: MetadataForm) {
    return left.chapterImageResolution === right.chapterImageResolution
        && left.dummyChapterDurationSeconds === right.dummyChapterDurationSeconds
        && left.preferredCountryCode === right.preferredCountryCode
        && left.preferredLanguage === right.preferredLanguage;
}

function parseDuration(value: string) {
    if (!/^\d+$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

function optionLabel(label: string, value: string, available: boolean) {
    if (!available && !value) return 'No configured value (unavailable)';
    return available ? label : `${label} (unavailable)`;
}

/* eslint-disable no-void, react/jsx-no-bind, sonarjs/cognitive-complexity */
export default function PtvAdminMetadataPage() {
    const { __legacyApiClient__: apiClient, api } = useApi();
    const state = useAdminMetadata(api, apiClient);
    const source = useMemo(
        () => state.settings ? toMetadataForm(state.settings) : null,
        [ state.settings ]
    );
    const formState = useAdminConfigurationForm(source, metadataFormsEqual);
    const [ feedback, setFeedback ] = useState<AdminConfigurationFeedback>(IDLE_FEEDBACK);
    const saveFlightRef = useRef(false);
    const reloadFlightRef = useRef(false);
    const duration = formState.form ? parseDuration(formState.form.dummyChapterDurationSeconds) : null;
    const durationError = formState.form && duration === null ?
        'Enter a whole number of seconds, 0 or greater.' :
        '';
    const hasAuthoritativeSettings = Boolean(formState.form && formState.confirmed && state.settings);

    useAdminUnsavedChanges(formState.dirty, 'Leave without saving your Metadata changes?');

    const clearFeedback = useCallback(() => setFeedback(IDLE_FEEDBACK), []);
    const updateField = useCallback(<K extends keyof MetadataForm>(field: K, value: MetadataForm[K]) => {
        formState.update(field, value);
        clearFeedback();
    }, [ clearFeedback, formState ]);
    const resetChanges = useCallback(() => {
        const latest = formState.serverChanged ? state.reset() : null;
        formState.reset(latest ? toMetadataForm(latest) : undefined);
        clearFeedback();
    }, [ clearFeedback, formState, state ]);
    const reloadServerValues = useCallback(async () => {
        if (reloadFlightRef.current || state.saving) return;
        reloadFlightRef.current = true;
        clearFeedback();
        try {
            const latest = await state.refetch();
            if (!latest) throw new Error('Unavailable');
            formState.adopt(toMetadataForm(latest.settings));
        } catch {
            setFeedback({
                message: 'Latest server settings could not be loaded. Your edits are still here.',
                tone: 'error'
            });
        } finally {
            reloadFlightRef.current = false;
        }
    }, [ clearFeedback, formState, state ]);
    const saveChanges = useCallback(async () => {
        if (
            !formState.form
            || !formState.confirmed
            || duration === null
            || !formState.dirty
            || formState.serverChanged
            || state.saving
            || saveFlightRef.current
        ) return;

        saveFlightRef.current = true;
        clearFeedback();
        const desired: AdminMetadataSettings = {
            chapterImageResolution: formState.form.chapterImageResolution,
            dummyChapterDurationSeconds: duration,
            preferredCountryCode: formState.form.preferredCountryCode,
            preferredLanguage: formState.form.preferredLanguage
        };
        const confirmed: AdminMetadataSettings = {
            chapterImageResolution: formState.confirmed.chapterImageResolution,
            dummyChapterDurationSeconds: Number(formState.confirmed.dummyChapterDurationSeconds),
            preferredCountryCode: formState.confirmed.preferredCountryCode,
            preferredLanguage: formState.confirmed.preferredLanguage
        };
        try {
            const saved = await state.save(desired, confirmed);
            formState.adopt(toMetadataForm(saved.settings));
            setFeedback({ message: 'Metadata settings saved.', tone: 'saved' });
        } catch (error) {
            if (error instanceof AdminMetadataServiceError && error.code === 'conflict') {
                formState.setServerChanged(true);
                setFeedback({
                    message: 'These settings changed on the server while you were editing.',
                    tone: 'error'
                });
            } else if (
                error instanceof AdminMetadataServiceError
                && (error.code === 'save-timeout' || error.code === 'save-unverified')
            ) {
                setFeedback({ message: error.message, tone: 'error' });
            } else {
                setFeedback({ message: "We couldn't save Metadata settings.", tone: 'error' });
            }
        } finally {
            saveFlightRef.current = false;
        }
    }, [ clearFeedback, duration, formState, state ]);
    const retryLoad = useCallback(() => {
        void state.refetch().catch(() => undefined);
    }, [ state ]);

    const controlsDisabled = state.saving || formState.serverChanged;
    const saveDisabled = !hasAuthoritativeSettings
        || !formState.dirty
        || duration === null
        || formState.serverChanged
        || state.saving;

    return (
        <section className='ptv-admin-configuration' data-testid='ptv-admin-metadata'>
            <AdminConfigurationHeader
                fetching={state.fetching && hasAuthoritativeSettings}
                subtitle='Configure server-wide metadata defaults used by PiggieTV libraries.'
                title='Metadata'
            />

            {formState.serverChanged ? (
                <AdminConfigurationNotice
                    action={(
                        <button disabled={state.fetching || state.saving} onClick={() => void reloadServerValues()} type='button'>
                            {state.fetching ? 'Reloading...' : 'Reload server values'}
                        </button>
                    )}
                    tone='warning'
                >
                    <strong>These settings changed on the server while you were editing.</strong>
                    <p>Your edits are still here. Reload the latest server values before saving.</p>
                </AdminConfigurationNotice>
            ) : null}

            {state.loading && !hasAuthoritativeSettings ? <AdminConfigurationSkeleton /> : null}
            {!state.loading && !hasAuthoritativeSettings ? (
                <AdminConfigurationError
                    loading={false}
                    message="Metadata settings couldn't be loaded."
                    onRetry={retryLoad}
                    retrying={state.fetching}
                />
            ) : null}

            {hasAuthoritativeSettings && formState.form ? (
                <>
                    {state.languagesError ? (
                        <AdminConfigurationNotice
                            action={<button disabled={state.languagesLoading} onClick={() => void state.refetchLanguages()} type='button'>Retry languages</button>}
                        >
                            <strong>Language choices are temporarily unavailable.</strong>
                            <p>Your configured language remains preserved. Other Metadata settings can still be saved.</p>
                        </AdminConfigurationNotice>
                    ) : null}
                    {state.countriesError ? (
                        <AdminConfigurationNotice
                            action={<button disabled={state.countriesLoading} onClick={() => void state.refetchCountries()} type='button'>Retry countries</button>}
                        >
                            <strong>Country choices are temporarily unavailable.</strong>
                            <p>Your configured country remains preserved. Other Metadata settings can still be saved.</p>
                        </AdminConfigurationNotice>
                    ) : null}

                    <div className='ptv-admin-configuration-grid'>
                        <AdminConfigurationPanel
                            description='Defaults used when libraries request metadata from compatible sources.'
                            title='Language & Region'
                        >
                            <AdminConfigurationSelect
                                description='Preferred language code supplied to metadata providers.'
                                disabled={controlsDisabled || state.languagesLoading || Boolean(state.languagesError)}
                                id='ptv-metadata-language'
                                label='Preferred metadata language'
                                onChange={value => updateField('preferredLanguage', value)}
                                value={formState.form.preferredLanguage}
                            >
                                {state.languages.map(option => (
                                    <option key={option.value || '__empty'} value={option.value}>
                                        {optionLabel(option.label, option.value, option.available)}
                                    </option>
                                ))}
                            </AdminConfigurationSelect>
                            <AdminConfigurationSelect
                                description='Preferred country code used for regional metadata results.'
                                disabled={controlsDisabled || state.countriesLoading || Boolean(state.countriesError)}
                                id='ptv-metadata-country'
                                label='Preferred metadata country'
                                onChange={value => updateField('preferredCountryCode', value)}
                                value={formState.form.preferredCountryCode}
                            >
                                {state.countries.map(option => (
                                    <option key={option.value || '__empty'} value={option.value}>
                                        {optionLabel(option.label, option.value, option.available)}
                                    </option>
                                ))}
                            </AdminConfigurationSelect>
                        </AdminConfigurationPanel>

                        <AdminConfigurationPanel
                            description='Defaults used when the server creates chapter markers and images.'
                            title='Chapters'
                        >
                            <AdminConfigurationNumber
                                description='Interval used for generated chapter markers. Zero disables dummy chapters.'
                                disabled={controlsDisabled}
                                error={durationError}
                                id='ptv-metadata-chapter-duration'
                                label='Dummy chapter duration'
                                min={0}
                                onChange={value => updateField('dummyChapterDurationSeconds', value)}
                                suffix='seconds'
                                value={formState.form.dummyChapterDurationSeconds}
                            />
                            <AdminConfigurationSelect
                                description='Resolution used for extracted chapter images. Existing dummy chapters are unchanged.'
                                disabled={controlsDisabled}
                                id='ptv-metadata-chapter-resolution'
                                label='Chapter image resolution'
                                onChange={value => updateField('chapterImageResolution', value as ImageResolution)}
                                value={formState.form.chapterImageResolution}
                            >
                                {IMAGE_RESOLUTION_OPTIONS.map(option => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </AdminConfigurationSelect>
                        </AdminConfigurationPanel>

                        <AdminConfigurationPanel
                            description='Metadata and image providers are reported by Jellyfin and configured for each library.'
                            title='Library Providers'
                            wide
                        >
                            <div className='ptv-admin-configuration-related'>
                                <span>
                                    <strong>Provider defaults and ordering</strong>
                                    <small>Manage a library to inspect its server-reported metadata and image provider configuration.</small>
                                </span>
                                <AdminConfigurationRelatedLink to='/settings/admin/libraries'>Manage Libraries</AdminConfigurationRelatedLink>
                            </div>
                        </AdminConfigurationPanel>
                    </div>

                    <AdminConfigurationActions
                        dirty={formState.dirty}
                        feedback={feedback}
                        onReset={resetChanges}
                        onSave={() => void saveChanges()}
                        saveDisabled={saveDisabled}
                        saving={state.saving}
                    />
                    <p className='ptv-admin-configuration-note'>Saving changes server defaults only. It does not scan libraries or refresh existing metadata.</p>
                </>
            ) : null}
        </section>
    );
}
/* eslint-enable no-void, react/jsx-no-bind, sonarjs/cognitive-complexity */
