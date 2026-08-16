/* eslint-disable react/jsx-no-bind -- The development-only action is intentionally local to this page. */
import type { ApiClient } from 'jellyfin-apiclient';
import React, { useEffect, useState } from 'react';

import { appHost } from 'components/apphost';
import { AppFeature } from 'constants/appFeature';
import Dashboard from 'utils/dashboard';

import { PTV_RUNTIME } from '../../../core/config';
import PtvIcon from '../../icons/PtvIcon';
import {
    loadPtvConnectionInfo,
    type PtvConnectionInfo
} from '../settingsAdapters';
import {
    SettingsEmptyState,
    SettingsGroup,
    SettingsPageHeader
} from '../SettingsPrimitives';

type ConnectionSettingsProps = Readonly<{
    apiClient?: ApiClient;
}>;

export default function ConnectionSettings({ apiClient }: ConnectionSettingsProps) {
    const [connection, setConnection] = useState<PtvConnectionInfo | null>(null);
    const [loadError, setLoadError] = useState('');

    useEffect(() => {
        if (!apiClient) return;
        let active = true;

        void loadPtvConnectionInfo(apiClient)
            .then(value => {
                if (active) setConnection(value);
            })
            .catch(() => {
                if (active) setLoadError('PiggieTV could not read the current connection details.');
            });

        return () => {
            active = false;
        };
    }, [apiClient]);

    if (loadError) {
        return <SettingsEmptyState description={loadError} title='Connection details unavailable' />;
    }

    if (!connection) {
        return <div className='ptv-settings-loading' role='status'>Checking connection…</div>;
    }

    const canSelectServer = PTV_RUNTIME.mode === 'development'
        && appHost.supports(AppFeature.MultiServer);

    return (
        <div className='ptv-settings-section-page'>
            <SettingsPageHeader
                description='A concise view of the PiggieTV service behind this session.'
                title='Connection'
            />

            <section className='ptv-settings-connection-hero'>
                <span className='ptv-settings-connection-icon'><PtvIcon name='server' size='30px' /></span>
                <span>
                    <small>Connected to PiggieTV</small>
                    <strong>{connection.name}</strong>
                </span>
                <span className='ptv-settings-online-status'>Online</span>
            </section>

            <SettingsGroup title='Service details'>
                <dl className='ptv-settings-details-list'>
                    <div><dt>Status</dt><dd>Connected</dd></div>
                    <div><dt>Service version</dt><dd>{connection.version || 'Available'}</dd></div>
                    <div><dt>Deployment</dt><dd>Managed by PiggieTV</dd></div>
                    {PTV_RUNTIME.mode === 'development' ? (
                        <>
                            <div><dt>Development service ID</dt><dd>{connection.id || 'Not available'}</dd></div>
                            <div><dt>Development address</dt><dd>{apiClient?.serverAddress() || 'Not available'}</dd></div>
                        </>
                    ) : null}
                </dl>
            </SettingsGroup>

            {canSelectServer ? (
                <button className='ptv-settings-secondary-action' onClick={() => Dashboard.selectServer()} type='button'>
                    Select development server
                </button>
            ) : (
                <p className='ptv-settings-platform-note'>Connection selection is managed by your PiggieTV installation.</p>
            )}
        </div>
    );
}
/* eslint-enable react/jsx-no-bind */
