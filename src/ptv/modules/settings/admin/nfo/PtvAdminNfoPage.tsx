import React, { useCallback, useMemo, useRef, useState } from 'react';

import { useApi } from '../../../../../hooks/useApi';
import {
    AdminConfigurationActions,
    AdminConfigurationError,
    type AdminConfigurationFeedback,
    AdminConfigurationHeader,
    AdminConfigurationNotice,
    AdminConfigurationPanel,
    AdminConfigurationRelatedLink,
    AdminConfigurationSelect,
    AdminConfigurationSkeleton,
    AdminConfigurationToggle
} from '../configuration/AdminConfigurationPrimitives';
import { useAdminConfigurationForm } from '../configuration/useAdminConfigurationForm';
import { useAdminUnsavedChanges } from '../configuration/useAdminUnsavedChanges';
import { areAdminNfoSettingsEqual } from './adminNfoAdapters';
import { AdminNfoServiceError, type AdminNfoSettings } from './adminNfoModel';
import { useAdminNfo } from './useAdminNfo';

const IDLE_FEEDBACK: AdminConfigurationFeedback = { message: '', tone: 'idle' };

function copyNfoSettings(settings: AdminNfoSettings): AdminNfoSettings {
    return { ...settings };
}

/* eslint-disable no-void, react/jsx-no-bind */
export default function PtvAdminNfoPage() {
    const { __legacyApiClient__: apiClient, api } = useApi();
    const state = useAdminNfo(api, apiClient);
    const source = useMemo(
        () => state.settings ? copyNfoSettings(state.settings) : null,
        [ state.settings ]
    );
    const formState = useAdminConfigurationForm(source, areAdminNfoSettingsEqual);
    const [ feedback, setFeedback ] = useState<AdminConfigurationFeedback>(IDLE_FEEDBACK);
    const saveFlightRef = useRef(false);
    const reloadFlightRef = useRef(false);
    const hasAuthoritativeSettings = Boolean(formState.form && formState.confirmed && state.settings);

    useAdminUnsavedChanges(formState.dirty, 'Leave without saving your NFO Settings changes?');

    const clearFeedback = useCallback(() => setFeedback(IDLE_FEEDBACK), []);
    const updateField = useCallback(<K extends keyof AdminNfoSettings>(field: K, value: AdminNfoSettings[K]) => {
        formState.update(field, value);
        clearFeedback();
    }, [ clearFeedback, formState ]);
    const resetChanges = useCallback(() => {
        const latest = formState.serverChanged ? state.reset() : null;
        formState.reset(latest ? copyNfoSettings(latest) : undefined);
        clearFeedback();
    }, [ clearFeedback, formState, state ]);
    const reloadServerValues = useCallback(async () => {
        if (reloadFlightRef.current || state.saving) return;
        reloadFlightRef.current = true;
        clearFeedback();
        try {
            const latest = await state.refetch();
            if (!latest) throw new Error('Unavailable');
            formState.adopt(copyNfoSettings(latest.settings));
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
            || !formState.dirty
            || formState.serverChanged
            || state.saving
            || saveFlightRef.current
        ) return;

        saveFlightRef.current = true;
        clearFeedback();
        try {
            const saved = await state.save(formState.form, formState.confirmed);
            formState.adopt(copyNfoSettings(saved.settings));
            setFeedback({ message: 'NFO settings saved.', tone: 'saved' });
        } catch (error) {
            if (error instanceof AdminNfoServiceError && error.code === 'conflict') {
                formState.setServerChanged(true);
                setFeedback({
                    message: 'These settings changed on the server while you were editing.',
                    tone: 'error'
                });
            } else {
                setFeedback({ message: "We couldn't save NFO settings.", tone: 'error' });
            }
        } finally {
            saveFlightRef.current = false;
        }
    }, [ clearFeedback, formState, state ]);
    const retryLoad = useCallback(() => {
        void state.refetch().catch(() => undefined);
    }, [ state ]);

    const controlsDisabled = state.saving || formState.serverChanged;
    const saveDisabled = !hasAuthoritativeSettings
        || !formState.dirty
        || formState.serverChanged
        || state.saving;

    return (
        <section className='ptv-admin-configuration' data-testid='ptv-admin-nfo'>
            <AdminConfigurationHeader
                fetching={state.fetching && hasAuthoritativeSettings}
                subtitle='Control NFO metadata writing and compatibility behavior.'
                title='NFO Settings'
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
                    message="NFO settings couldn't be loaded."
                    onRetry={retryLoad}
                    retrying={state.fetching}
                />
            ) : null}

            {hasAuthoritativeSettings && formState.form ? (
                <>
                    {state.usersError ? (
                        <AdminConfigurationNotice
                            action={<button disabled={state.usersLoading} onClick={() => void state.refetchUsers()} type='button'>Retry users</button>}
                        >
                            <strong>Watch-data users are temporarily unavailable.</strong>
                            <p>The configured user remains preserved. Writer options can still be saved safely.</p>
                        </AdminConfigurationNotice>
                    ) : null}

                    <div className='ptv-admin-configuration-grid'>
                        <AdminConfigurationPanel
                            description='Choose which Jellyfin user supplies watched-state data when NFO files are written.'
                            title='Watch Data'
                        >
                            <AdminConfigurationSelect
                                description='None omits user-specific watched data from newly written NFO files.'
                                disabled={controlsDisabled || state.usersLoading || Boolean(state.usersError)}
                                id='ptv-nfo-user'
                                label='NFO metadata user'
                                onChange={value => updateField('userId', value || null)}
                                value={formState.form.userId || ''}
                            >
                                <option value=''>None</option>
                                {state.users.map(user => (
                                    <option key={user.id} value={user.id}>
                                        {user.unavailable ? `${user.label} (unavailable)` : user.label}
                                    </option>
                                ))}
                            </AdminConfigurationSelect>
                        </AdminConfigurationPanel>

                        <AdminConfigurationPanel
                            description='Control how image references are represented in future NFO output.'
                            title='Image References'
                        >
                            <AdminConfigurationToggle
                                checked={formState.form.saveImagePathsInNfo}
                                description="Store image paths in NFO files when file names do not follow Kodi's conventions."
                                disabled={controlsDisabled}
                                id='ptv-nfo-image-paths'
                                label='Save image paths in NFO files'
                                onChange={value => updateField('saveImagePathsInNfo', value)}
                            />
                            <AdminConfigurationToggle
                                checked={formState.form.enablePathSubstitution}
                                description="Use the server's path-substitution settings for image paths where supported."
                                disabled={controlsDisabled}
                                id='ptv-nfo-path-substitution'
                                label='Enable path substitution'
                                onChange={value => updateField('enablePathSubstitution', value)}
                            />
                        </AdminConfigurationPanel>

                        <AdminConfigurationPanel
                            description='Compatibility options for media applications that consume Jellyfin NFO files.'
                            title='Kodi Compatibility'
                        >
                            <AdminConfigurationToggle
                                checked={formState.form.enableExtraThumbsDuplication}
                                description='Save downloaded images to both extrafanart and extrathumbs for broader Kodi skin compatibility.'
                                disabled={controlsDisabled}
                                id='ptv-nfo-extra-thumbs'
                                label='Copy extrafanart to extrathumbs'
                                onChange={value => updateField('enableExtraThumbsDuplication', value)}
                            />
                        </AdminConfigurationPanel>

                        <AdminConfigurationPanel
                            description='NFO writer behavior is global; whether a library uses the NFO saver remains library-specific.'
                            title='Library Enablement'
                        >
                            <div className='ptv-admin-configuration-related'>
                                <span>
                                    <strong>NFO metadata saver</strong>
                                    <small>Manage individual libraries to inspect their server-reported metadata saver configuration.</small>
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
                    <p className='ptv-admin-configuration-note'>Saving changes future NFO behavior only. It does not enable NFO for a library, generate files, scan media, or refresh metadata.</p>
                </>
            ) : null}
        </section>
    );
}
/* eslint-enable no-void, react/jsx-no-bind */
