/* eslint-disable react/jsx-no-bind -- The code field setter is scoped to this short-lived form. */
import { getQuickConnectApi } from '@jellyfin/sdk/lib/utils/api/quick-connect-api';
import type { Api } from '@jellyfin/sdk';
import type { ApiClient } from 'jellyfin-apiclient';
import React, { type FormEvent, useCallback, useEffect, useState } from 'react';

import PtvIcon from '../../icons/PtvIcon';
import {
    loadPtvConnectedDevices,
    type PtvConnectedDevice
} from '../settingsAdapters';
import {
    SettingsEmptyState,
    SettingsGroup,
    SettingsPageHeader
} from '../SettingsPrimitives';

type DeviceSettingsProps = Readonly<{
    api?: Api;
    apiClient?: ApiClient;
    quickConnectEnabled?: boolean;
    userId?: string;
}>;

export default function DeviceSettings({
    api,
    apiClient,
    quickConnectEnabled,
    userId
}: DeviceSettingsProps) {
    const [code, setCode] = useState('');
    const [devices, setDevices] = useState<PtvConnectedDevice[]>([]);
    const [deviceError, setDeviceError] = useState('');
    const [message, setMessage] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!apiClient || !userId) return;
        let active = true;

        void loadPtvConnectedDevices(apiClient, userId)
            .then(value => {
                if (active) setDevices(value);
            })
            .catch(() => {
                if (active) setDeviceError('Connected device history is unavailable right now.');
            });

        return () => {
            active = false;
        };
    }, [apiClient, userId]);

    const submitCode = useCallback((event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const normalizedCode = code.replace(/\s/g, '');
        if (!api || !userId || !/^\d{6,}$/.test(normalizedCode)) {
            setMessage('Enter the code shown on the device.');
            return;
        }

        setSubmitting(true);
        setMessage('');
        void getQuickConnectApi(api).authorizeQuickConnect({
            code: normalizedCode,
            userId
        })
            .then(() => {
                setCode('');
                setMessage('Device connected. You can return to the other screen.');
            })
            .catch(() => setMessage('We could not connect that device. Check the code and try again.'))
            .finally(() => setSubmitting(false));
    }, [api, code, userId]);

    return (
        <div className='ptv-settings-section-page'>
            <SettingsPageHeader
                description='Sign in elsewhere and review the devices using your PiggieTV account.'
                title='Devices & Quick Connect'
            />

            {quickConnectEnabled ? (
                <SettingsGroup
                    description='Enter the code displayed by PiggieTV on the other device.'
                    title='Quick Connect'
                >
                    <form className='ptv-settings-quick-connect' onSubmit={submitCode}>
                        <label htmlFor='ptv-quick-connect-code'>Device code</label>
                        <div>
                            <input
                                autoComplete='off'
                                id='ptv-quick-connect-code'
                                inputMode='numeric'
                                minLength={6}
                                onChange={event => setCode(event.currentTarget.value)}
                                pattern='[0-9\s]*'
                                placeholder='000 000'
                                required
                                type='text'
                                value={code}
                            />
                            <button disabled={submitting} type='submit'>
                                {submitting ? 'Connecting...' : 'Connect Device'}
                            </button>
                        </div>
                        {message ? <p aria-live='polite' role='status'>{message}</p> : null}
                    </form>
                </SettingsGroup>
            ) : (
                <SettingsEmptyState
                    description='Device connection codes are not enabled for this PiggieTV server.'
                    title='Quick Connect is unavailable'
                />
            )}

            <SettingsGroup title='Connected devices'>
                {deviceError ? <p className='ptv-settings-inline-error'>{deviceError}</p> : null}
                {!deviceError && devices.length === 0 ? (
                    <p className='ptv-settings-muted'>No recent devices were returned for this account.</p>
                ) : null}
                <div className='ptv-settings-device-list'>
                    {devices.map(device => (
                        <article key={device.id}>
                            <PtvIcon name='devices' size='24px' />
                            <span>
                                <strong>{device.name}</strong>
                                <small>{device.app}</small>
                            </span>
                            <span>
                                {device.current ? <strong>Current device</strong> : null}
                                <small>{device.lastActive}</small>
                            </span>
                        </article>
                    ))}
                </div>
            </SettingsGroup>
        </div>
    );
}
/* eslint-enable react/jsx-no-bind */
