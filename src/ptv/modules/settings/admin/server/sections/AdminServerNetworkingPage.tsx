import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
    commaSeparated,
    parseCommaSeparated,
    requireAdminServerNetworkingSettings
} from '../adminServerConfigurationAdapters';
import {
    AdminServerConfigurationError,
    type AdminServerCertificatePasswordChange,
    type AdminServerNetworkingSettings,
    type AdminServerNetworkingSnapshot
} from '../adminServerConfigurationModel';
import { useAdminServerNetworking } from '../useAdminServerConfiguration';

type NetworkingForm = Omit<AdminServerNetworkingSettings,
    'internalHttpPort' | 'internalHttpsPort' | 'knownProxies' | 'localNetworkAddresses'
        | 'localNetworkSubnets' | 'publicHttpPort' | 'publicHttpsPort'
        | 'publishedServerUriBySubnet' | 'remoteIPFilter'> & Readonly<{
            internalHttpPort: string;
            internalHttpsPort: string;
            knownProxies: string;
            localNetworkAddresses: string;
            localNetworkSubnets: string;
            publicHttpPort: string;
            publicHttpsPort: string;
            publishedServerUriBySubnet: string;
            remoteIPFilter: string;
        }>;

const IDLE: AdminConfigurationFeedback = { message: '', tone: 'idle' };

function toForm(settings: AdminServerNetworkingSettings): NetworkingForm {
    return {
        ...settings,
        internalHttpPort: String(settings.internalHttpPort),
        internalHttpsPort: String(settings.internalHttpsPort),
        knownProxies: commaSeparated(settings.knownProxies),
        localNetworkAddresses: commaSeparated(settings.localNetworkAddresses),
        localNetworkSubnets: commaSeparated(settings.localNetworkSubnets),
        publicHttpPort: String(settings.publicHttpPort),
        publicHttpsPort: String(settings.publicHttpsPort),
        publishedServerUriBySubnet: commaSeparated(settings.publishedServerUriBySubnet),
        remoteIPFilter: commaSeparated(settings.remoteIPFilter)
    };
}

function equal(left: NetworkingForm, right: NetworkingForm) {
    return JSON.stringify(left) === JSON.stringify(right);
}

function parsePort(value: string) {
    if (!/^\d+$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}

function toSettings(form: NetworkingForm): AdminServerNetworkingSettings | null {
    const internalHttpPort = parsePort(form.internalHttpPort);
    const internalHttpsPort = parsePort(form.internalHttpsPort);
    const publicHttpPort = parsePort(form.publicHttpPort);
    const publicHttpsPort = parsePort(form.publicHttpsPort);
    if ([ internalHttpPort, internalHttpsPort, publicHttpPort, publicHttpsPort ].some(value => value === null)) return null;
    return {
        ...form,
        internalHttpPort: internalHttpPort!,
        internalHttpsPort: internalHttpsPort!,
        knownProxies: parseCommaSeparated(form.knownProxies),
        localNetworkAddresses: parseCommaSeparated(form.localNetworkAddresses),
        localNetworkSubnets: parseCommaSeparated(form.localNetworkSubnets),
        publicHttpPort: publicHttpPort!,
        publicHttpsPort: publicHttpsPort!,
        publishedServerUriBySubnet: parseCommaSeparated(form.publishedServerUriBySubnet),
        remoteIPFilter: parseCommaSeparated(form.remoteIPFilter)
    };
}

export function isAdminServerConnectionSensitiveChange(
    current: NetworkingForm,
    confirmed: NetworkingForm,
    passwordMode: AdminServerCertificatePasswordChange['mode']
) {
    return passwordMode !== 'unchanged'
        || current.baseUrl !== confirmed.baseUrl
        || current.certificatePath !== confirmed.certificatePath
        || current.enableHttps !== confirmed.enableHttps
        || current.enableIPv4 !== confirmed.enableIPv4
        || current.enableIPv6 !== confirmed.enableIPv6
        || current.enableRemoteAccess !== confirmed.enableRemoteAccess
        || current.internalHttpPort !== confirmed.internalHttpPort
        || current.internalHttpsPort !== confirmed.internalHttpsPort
        || current.localNetworkAddresses !== confirmed.localNetworkAddresses
        || current.publicHttpPort !== confirmed.publicHttpPort
        || current.publicHttpsPort !== confirmed.publicHttpsPort
        || current.requireHttps !== confirmed.requireHttps;
}

/* eslint-disable no-void, react/jsx-no-bind, sonarjs/cognitive-complexity */
export default function AdminServerNetworkingPage() {
    const { __legacyApiClient__: apiClient, api } = useApi();
    const state = useAdminServerNetworking(api, apiClient);
    const source = useMemo(() => state.snapshot ? toForm(state.snapshot.settings) : null, [ state.snapshot ]);
    const formState = useAdminConfigurationForm(source, equal);
    const baseline = useRef<AdminServerNetworkingSnapshot | null>(null);
    const [ feedback, setFeedback ] = useState<AdminConfigurationFeedback>(IDLE);
    const [ confirmSave, setConfirmSave ] = useState(false);
    const [ passwordMode, setPasswordMode ] = useState<AdminServerCertificatePasswordChange['mode']>('unchanged');
    const [ password, setPassword ] = useState('');
    const available = Boolean(formState.form && formState.confirmed && state.snapshot);
    const desired = formState.form ? toSettings(formState.form) : null;
    const validationError = useMemo(() => {
        if (!desired) return 'Ports must be whole numbers from 1 through 65535.';
        try {
            requireAdminServerNetworkingSettings(desired);
            if (passwordMode === 'replace' && !password) return 'Enter a replacement certificate password.';
            return '';
        } catch (error) {
            return error instanceof Error ? error.message : 'Review the networking values.';
        }
    }, [ desired, password, passwordMode ]);
    const dirty = formState.dirty || passwordMode !== 'unchanged';
    const connectionSensitiveChange = Boolean(formState.form && formState.confirmed
        && isAdminServerConnectionSensitiveChange(formState.form, formState.confirmed, passwordMode));

    useEffect(() => {
        if (state.snapshot && (!baseline.current || !dirty)) baseline.current = state.snapshot;
    }, [ dirty, state.snapshot ]);
    useAdminUnsavedChanges(dirty, 'Leave without saving your Networking changes?');

    const update = useCallback(<K extends keyof NetworkingForm>(field: K, value: NetworkingForm[K]) => {
        formState.update(field, value);
        setFeedback(IDLE);
    }, [ formState ]);
    const reset = useCallback(() => {
        formState.reset();
        setPasswordMode('unchanged');
        setPassword('');
        setFeedback(IDLE);
    }, [ formState ]);
    const changePasswordMode = useCallback((value: string) => {
        setPasswordMode(value as AdminServerCertificatePasswordChange['mode']);
        setPassword('');
    }, []);
    const reload = useCallback(async () => {
        try {
            const latest = await state.refetch();
            if (!latest) throw new Error('Unavailable');
            baseline.current = latest;
            formState.adopt(toForm(latest.settings));
            setPasswordMode('unchanged');
            setPassword('');
            setFeedback(IDLE);
        } catch {
            setFeedback({ message: 'Latest networking values could not be loaded.', tone: 'error' });
        }
    }, [ formState, state ]);
    const save = useCallback(async () => {
        setConfirmSave(false);
        if (!desired || !baseline.current || validationError || !dirty || formState.serverChanged) return;
        try {
            // A replacement secret is single-use UI state. Clear it as soon as
            // the request owns its value so failures and navigation cannot
            // leave it in the rendered form.
            const passwordChange = { mode: passwordMode, value: password } as const;
            if (passwordMode === 'replace') setPassword('');
            const saved = await state.save(desired, baseline.current, passwordChange);
            baseline.current = saved.snapshot;
            formState.adopt(toForm(saved.snapshot.settings));
            setPasswordMode('unchanged');
            setPassword('');
            setFeedback(saved.verification === 'confirmed' ?
                { message: 'Networking settings saved and confirmed.', tone: 'saved' } :
                { message: 'The server accepted the networking update, but the new connection could not be verified. Reconnect using the configured address.', tone: 'error' });
        } catch (error) {
            if (error instanceof AdminServerConfigurationError && error.code === 'networking-conflict') {
                formState.setServerChanged(true);
                setFeedback({ message: 'These settings changed on the server while you were editing.', tone: 'error' });
            } else {
                setFeedback({ message: error instanceof Error ? error.message : "We couldn't save Networking settings.", tone: 'error' });
            }
        }
    }, [ desired, dirty, formState, password, passwordMode, state, validationError ]);

    if (state.loading && !available) return <AdminConfigurationSkeleton />;
    if (!available || !formState.form) {
        return <AdminConfigurationError loading={false} message="Networking settings couldn't be loaded." onRetry={() => void state.refetch()} retrying={state.fetching} />;
    }

    const disabled = state.saving || formState.serverChanged;
    const portError = desired ? '' : 'Enter a whole-number port.';
    return (
        <section aria-labelledby='ptv-server-networking-title' className='ptv-admin-server-section'>
            <header className='ptv-admin-server-section-heading'>
                <div><h2 id='ptv-server-networking-title'>Networking</h2><p>Configure listener protocols, ports, trusted networks and remote access.</p></div>
                {state.fetching ? <span role='status'>Refreshing</span> : null}
            </header>

            {connectionSensitiveChange ? (
                <AdminConfigurationNotice tone='warning'>
                    <strong>This change can interrupt your current connection.</strong>
                    <p>Listener, protocol, port, base URL, certificate, bind, or remote-access changes can disconnect this browser. Some require a restart.</p>
                </AdminConfigurationNotice>
            ) : null}
            {formState.serverChanged ? (
                <AdminConfigurationNotice action={<button onClick={() => void reload()} type='button'>Reload server values</button>} tone='warning'>
                    <strong>Networking changed on the server while you were editing.</strong>
                    <p>Reload the authoritative configuration before saving.</p>
                </AdminConfigurationNotice>
            ) : null}

            <div className='ptv-admin-configuration-grid'>
                <AdminConfigurationPanel description='Protocols and server discovery visible to clients.' title='Connectivity'>
                    <AdminConfigurationToggle checked={formState.form.enableIPv4} description='Listen for IPv4 connections.' disabled={disabled} id='ptv-network-ipv4' label='Enable IPv4' onChange={value => update('enableIPv4', value)} />
                    <AdminConfigurationToggle checked={formState.form.enableIPv6} description='Listen for IPv6 connections.' disabled={disabled} id='ptv-network-ipv6' label='Enable IPv6' onChange={value => update('enableIPv6', value)} />
                    <AdminConfigurationToggle checked={formState.form.autoDiscovery} description='Advertise this server to compatible clients on the local network.' disabled={disabled} id='ptv-network-discovery' label='Automatic discovery' onChange={value => update('autoDiscovery', value)} />
                    <AdminConfigurationToggle checked={formState.form.enableRemoteAccess} description='Allow connections classified as remote by Jellyfin.' disabled={disabled} id='ptv-network-remote' label='Remote access' onChange={value => update('enableRemoteAccess', value)} />
                </AdminConfigurationPanel>

                <AdminConfigurationPanel description='Listener and externally published port values.' title='Ports'>
                    <AdminConfigurationNumber description='Local HTTP listener port.' disabled={disabled} error={portError} id='ptv-network-internal-http' label='Internal HTTP port' max={65535} min={1} onChange={value => update('internalHttpPort', value)} value={formState.form.internalHttpPort} />
                    <AdminConfigurationNumber description='Local HTTPS listener port.' disabled={disabled} error={portError} id='ptv-network-internal-https' label='Internal HTTPS port' max={65535} min={1} onChange={value => update('internalHttpsPort', value)} value={formState.form.internalHttpsPort} />
                    <AdminConfigurationNumber description='HTTP port advertised outside the server.' disabled={disabled} error={portError} id='ptv-network-public-http' label='Public HTTP port' max={65535} min={1} onChange={value => update('publicHttpPort', value)} value={formState.form.publicHttpPort} />
                    <AdminConfigurationNumber description='HTTPS port advertised outside the server.' disabled={disabled} error={portError} id='ptv-network-public-https' label='Public HTTPS port' max={65535} min={1} onChange={value => update('publicHttpsPort', value)} value={formState.form.publicHttpsPort} />
                </AdminConfigurationPanel>

                <AdminConfigurationPanel description='TLS certificate behavior for direct HTTPS connections.' title='HTTPS & Certificate'>
                    <AdminConfigurationToggle checked={formState.form.enableHttps} description='Enable the Jellyfin HTTPS listener.' disabled={disabled} id='ptv-network-https' label='Enable HTTPS' onChange={value => update('enableHttps', value)} />
                    <AdminConfigurationToggle checked={formState.form.requireHttps} description='Require HTTPS for remote connections.' disabled={disabled || !formState.form.enableHttps} id='ptv-network-require-https' label='Require HTTPS' onChange={value => update('requireHttps', value)} />
                    <AdminConfigurationText description='Path to the server certificate file.' disabled={disabled} id='ptv-network-certificate' label='Certificate path' onChange={value => update('certificatePath', value)} value={formState.form.certificatePath} />
                    <AdminConfigurationSelect description={formState.form.certificatePasswordConfigured ? 'A password is configured. PiggieTV never loads or displays it.' : 'No certificate password is currently configured.'} disabled={disabled} id='ptv-network-password-mode' label='Certificate password' onChange={changePasswordMode} value={passwordMode}>
                        <option value='unchanged'>Keep existing</option>
                        <option value='replace'>Replace password</option>
                        {formState.form.certificatePasswordConfigured ? <option value='clear'>Clear password</option> : null}
                    </AdminConfigurationSelect>
                    {passwordMode === 'replace' ? (
                        <div className='ptv-admin-server-password-field'>
                            <span><label htmlFor='ptv-network-password'><strong>New certificate password</strong></label><small id='ptv-network-password-description'>Entered only for this save and cleared immediately afterward.</small></span>
                            <input aria-describedby='ptv-network-password-description' autoComplete='new-password' disabled={disabled} id='ptv-network-password' onChange={event => setPassword(event.currentTarget.value)} type='password' value={password} />
                        </div>
                    ) : null}
                </AdminConfigurationPanel>

                <AdminConfigurationPanel description='Address classification, bind targets and proxy trust.' title='Addresses & Proxies'>
                    <AdminConfigurationText description='URL path prefix used by reverse-proxy deployments.' disabled={disabled} id='ptv-network-base-url' label='Base URL' onChange={value => update('baseUrl', value)} value={formState.form.baseUrl} />
                    <AdminConfigurationText description='Comma-separated local IP addresses. Listener changes require a restart.' disabled={disabled} id='ptv-network-bind' label='Local bind addresses' onChange={value => update('localNetworkAddresses', value)} value={formState.form.localNetworkAddresses} />
                    <AdminConfigurationText description='Comma-separated IP or IP/netmask values treated as LAN.' disabled={disabled} id='ptv-network-subnets' label='LAN networks' onChange={value => update('localNetworkSubnets', value)} value={formState.form.localNetworkSubnets} />
                    <AdminConfigurationText description='Comma-separated IP addresses or hostnames. Restart after changing.' disabled={disabled} id='ptv-network-proxies' label='Known proxies' onChange={value => update('knownProxies', value)} value={formState.form.knownProxies} />
                    <AdminConfigurationText description='Comma-separated mappings such as internal=http://host, external=https://host, or all=https://host.' disabled={disabled} id='ptv-network-published-uri' label='Published server URIs' onChange={value => update('publishedServerUriBySubnet', value)} value={formState.form.publishedServerUriBySubnet} />
                    <AdminConfigurationSelect description='Choose whether matching remote entries are allowed or blocked.' disabled={disabled} id='ptv-network-filter-mode' label='Remote IP filter mode' onChange={value => update('isRemoteIPFilterBlacklist', value === 'blacklist')} value={formState.form.isRemoteIPFilterBlacklist ? 'blacklist' : 'whitelist'}>
                        <option value='blacklist'>Block listed addresses</option>
                        <option value='whitelist'>Allow only listed addresses</option>
                    </AdminConfigurationSelect>
                    <AdminConfigurationText description='Comma-separated IP or IP/netmask entries.' disabled={disabled} id='ptv-network-filter' label='Remote IP filter' onChange={value => update('remoteIPFilter', value)} value={formState.form.remoteIPFilter} />
                </AdminConfigurationPanel>
            </div>

            {validationError && dirty ? <AdminConfigurationNotice tone='warning'><strong>Review Networking</strong><p>{validationError}</p></AdminConfigurationNotice> : null}
            <AdminConfigurationActions dirty={dirty} feedback={feedback} onReset={reset} onSave={() => connectionSensitiveChange ? setConfirmSave(true) : void save()} saveDisabled={!dirty || Boolean(validationError) || formState.serverChanged} saving={state.saving} />

            <ConfirmDialog confirmButtonColor='warning' confirmButtonText='Save Networking' onCancel={() => setConfirmSave(false)} onConfirm={() => void save()} open={confirmSave} text='Save these networking settings? Listener, port, certificate, or remote-access changes may disconnect this browser immediately. PiggieTV will verify the update only if the server remains reachable.' title='Apply connectivity changes?' />
        </section>
    );
}
/* eslint-enable no-void, react/jsx-no-bind, sonarjs/cognitive-complexity */
