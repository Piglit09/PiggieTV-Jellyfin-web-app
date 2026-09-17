import React, { useCallback, useMemo, useRef, useState } from 'react';

import ConfirmDialog from '../../../../../../components/ConfirmDialog';
import { SPLASHSCREEN_URL } from '../../../../../../constants/branding';
import { useApi } from '../../../../../../hooks/useApi';
import {
    AdminConfigurationActions,
    AdminConfigurationError,
    type AdminConfigurationFeedback,
    AdminConfigurationNotice,
    AdminConfigurationPanel,
    AdminConfigurationSkeleton,
    AdminConfigurationToggle
} from '../../configuration/AdminConfigurationPrimitives';
import { useAdminConfigurationForm } from '../../configuration/useAdminConfigurationForm';
import { useAdminUnsavedChanges } from '../../configuration/useAdminUnsavedChanges';
import {
    AdminServerConfigurationError,
    type AdminServerBrandingSettings
} from '../adminServerConfigurationModel';
import { useAdminServerBranding } from '../useAdminServerConfiguration';

const IDLE: AdminConfigurationFeedback = { message: '', tone: 'idle' };

function equal(left: AdminServerBrandingSettings, right: AdminServerBrandingSettings) {
    return left.customCss === right.customCss
        && left.loginDisclaimer === right.loginDisclaimer
        && left.splashscreenEnabled === right.splashscreenEnabled;
}

function ConfigurationTextarea({
    description,
    disabled,
    id,
    label,
    monospace = false,
    onChange,
    value
}: Readonly<{
    description: string;
    disabled: boolean;
    id: string;
    label: string;
    monospace?: boolean;
    onChange: (value: string) => void;
    value: string;
}>) {
    const handleChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
        onChange(event.currentTarget.value);
    }, [ onChange ]);
    return (
        <div className='ptv-admin-server-textarea-field'>
            <span><label htmlFor={id}><strong>{label}</strong></label><small id={`${id}-description`}>{description}</small></span>
            <textarea
                aria-describedby={`${id}-description`}
                className={monospace ? 'is-monospace' : undefined}
                disabled={disabled}
                id={id}
                onChange={handleChange}
                rows={monospace ? 12 : 6}
                value={value}
            />
        </div>
    );
}

/* eslint-disable no-void, react/jsx-no-bind */
export default function AdminServerBrandingPage() {
    const { __legacyApiClient__: apiClient, api } = useApi();
    const state = useAdminServerBranding(api, apiClient);
    const source = useMemo(() => state.snapshot?.settings || null, [ state.snapshot ]);
    const formState = useAdminConfigurationForm(source, equal);
    const [ feedback, setFeedback ] = useState<AdminConfigurationFeedback>(IDLE);
    const [ confirmDelete, setConfirmDelete ] = useState(false);
    const [ previewError, setPreviewError ] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const available = Boolean(formState.form && formState.confirmed && state.snapshot);
    const splashUrl = api?.getUri(SPLASHSCREEN_URL, { t: state.splashRevision });

    useAdminUnsavedChanges(formState.dirty, 'Leave without saving your Branding changes?');

    const update = useCallback(<K extends keyof AdminServerBrandingSettings>(field: K, value: AdminServerBrandingSettings[K]) => {
        formState.update(field, value);
        setFeedback(IDLE);
    }, [ formState ]);
    const reload = useCallback(async () => {
        try {
            const loaded = await state.refetch();
            if (!loaded) throw new Error('Unavailable');
            formState.adopt(loaded.settings);
            setFeedback(IDLE);
        } catch {
            setFeedback({ message: 'Latest branding values could not be loaded.', tone: 'error' });
        }
    }, [ formState, state ]);
    const save = useCallback(async () => {
        if (!formState.form || !formState.confirmed || !formState.dirty || formState.serverChanged) return;
        try {
            const saved = await state.save(formState.form, formState.confirmed);
            formState.adopt(saved.settings);
            setFeedback({ message: 'Branding settings saved.', tone: 'saved' });
        } catch (error) {
            if (error instanceof AdminServerConfigurationError && error.code === 'branding-conflict') {
                formState.setServerChanged(true);
                setFeedback({ message: 'These settings changed on the server while you were editing.', tone: 'error' });
            } else {
                setFeedback({
                    message: error instanceof AdminServerConfigurationError
                        && error.code === 'server-save-timeout' ?
                        error.message : "We couldn't save Branding settings.",
                    tone: 'error'
                });
            }
        }
    }, [ formState, state ]);
    const upload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (!file) return;
        try {
            await state.upload(file);
            setPreviewError(false);
            setFeedback({ message: 'Splash screen image uploaded.', tone: 'saved' });
        } catch (error) {
            setFeedback({
                message: error instanceof Error ? error.message : 'The splash screen image could not be uploaded.',
                tone: 'error'
            });
        }
    }, [ state ]);
    const removeSplash = useCallback(async () => {
        setConfirmDelete(false);
        try {
            await state.removeSplash();
            setPreviewError(true);
            setFeedback({ message: 'Custom splash screen removed.', tone: 'saved' });
        } catch {
            setFeedback({ message: 'The splash screen image could not be deleted.', tone: 'error' });
        }
    }, [ state ]);

    if (state.loading && !available) return <AdminConfigurationSkeleton />;
    if (!available || !formState.form) {
        return <AdminConfigurationError loading={false} message="Branding settings couldn't be loaded." onRetry={() => void state.refetch()} retrying={state.fetching} />;
    }

    const controlsDisabled = Boolean(state.busyAction) || formState.serverChanged;
    return (
        <section aria-labelledby='ptv-server-branding-title' className='ptv-admin-server-section'>
            <header className='ptv-admin-server-section-heading'>
                <div><h2 id='ptv-server-branding-title'>Branding</h2><p>Customize the installation login experience and advanced web styling.</p></div>
                {state.fetching ? <span role='status'>Refreshing</span> : null}
            </header>

            <AdminConfigurationNotice tone='warning'>
                <strong>Advanced compatibility settings</strong>
                <p>Custom CSS can break layout or accessibility after web-client updates. Review changes carefully.</p>
            </AdminConfigurationNotice>
            {formState.serverChanged ? (
                <AdminConfigurationNotice action={<button onClick={() => void reload()} type='button'>Reload server values</button>} tone='warning'>
                    <strong>Branding changed on the server while you were editing.</strong>
                    <p>Reload the authoritative values before saving.</p>
                </AdminConfigurationNotice>
            ) : null}

            <div className='ptv-admin-configuration-grid'>
                <AdminConfigurationPanel description='Image displayed by compatible clients on their sign-in screen.' title='Splash Screen'>
                    <div className='ptv-admin-server-splash-preview'>
                        {!previewError && splashUrl ? <img alt='Current server splash screen' onError={() => setPreviewError(true)} src={splashUrl} /> : <span>No custom splash image is available.</span>}
                    </div>
                    <AdminConfigurationToggle checked={formState.form.splashscreenEnabled} description='Allow compatible clients to display the custom splash image.' disabled={controlsDisabled} id='ptv-server-splash-enabled' label='Enable splash screen' onChange={value => update('splashscreenEnabled', value)} />
                    <div className='ptv-admin-server-inline-actions'>
                        <input accept='image/*' hidden onChange={event => void upload(event)} ref={inputRef} type='file' />
                        <button disabled={Boolean(state.busyAction) || !formState.form.splashscreenEnabled} onClick={() => inputRef.current?.click()} type='button'>{state.busyAction === 'upload' ? 'Uploading...' : 'Upload Image'}</button>
                        <button className='is-danger' disabled={Boolean(state.busyAction) || !formState.form.splashscreenEnabled} onClick={() => setConfirmDelete(true)} type='button'>Delete Image</button>
                    </div>
                    <p className='ptv-admin-server-muted'>Images are limited to 10 MB. Upload and delete are explicit image operations; the enable switch is saved with the form.</p>
                </AdminConfigurationPanel>

                <AdminConfigurationPanel description='Text displayed by compatible clients before sign-in.' title='Login Disclaimer'>
                    <ConfigurationTextarea description='Use concise legal, support, or acceptable-use information.' disabled={controlsDisabled} id='ptv-server-login-disclaimer' label='Disclaimer text' onChange={value => update('loginDisclaimer', value)} value={formState.form.loginDisclaimer} />
                </AdminConfigurationPanel>

                <AdminConfigurationPanel description='Raw stylesheet applied by compatible Jellyfin Web clients.' title='Custom CSS' wide>
                    <ConfigurationTextarea description='This is intentionally an advanced control. PiggieTV does not rewrite or sanitize the configured stylesheet.' disabled={controlsDisabled} id='ptv-server-custom-css' label='Custom stylesheet' monospace onChange={value => update('customCss', value)} value={formState.form.customCss} />
                </AdminConfigurationPanel>
            </div>

            <AdminConfigurationActions dirty={formState.dirty} feedback={feedback} onReset={() => {
                formState.reset();
                setFeedback(IDLE);
            }} onSave={() => void save()} saveDisabled={!formState.dirty || formState.serverChanged} saving={state.busyAction === 'save'} />
            <p className='ptv-admin-configuration-note'>Branding is installation-scoped. It does not change the PiggieTV product identity or release version.</p>

            <ConfirmDialog confirmButtonColor='error' confirmButtonText='Delete Image' onCancel={() => setConfirmDelete(false)} onConfirm={() => void removeSplash()} open={confirmDelete} text='Delete the current custom splash screen image? Compatible clients will fall back to their default sign-in presentation.' title='Delete splash screen?' />
        </section>
    );
}
/* eslint-enable no-void, react/jsx-no-bind */
