import React, { useCallback, useState } from 'react';

import ConfirmDialog from '../../../../../../components/ConfirmDialog';
import { useApi } from '../../../../../../hooks/useApi';
import PtvIcon from '../../../../icons/PtvIcon';
import { AdminConfigurationError, AdminConfigurationSkeleton } from '../../configuration/AdminConfigurationPrimitives';
import type { PtvAdminApiKey, PtvAdminApiKeyReveal } from '../adminServerOperationsModel';
import { useAdminServerApiKeys } from '../useAdminServerOperations';

function formatDate(value: string | null) {
    if (!value) return 'Unknown';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

/* eslint-disable no-void, react/jsx-no-bind */
export default function AdminServerApiKeysPage() {
    const { __legacyApiClient__: apiClient, api } = useApi();
    const state = useAdminServerApiKeys(api, apiClient);
    const [ appName, setAppName ] = useState('');
    const [ selected, setSelected ] = useState<PtvAdminApiKey | null>(null);
    const [ reveal, setReveal ] = useState<PtvAdminApiKeyReveal | null>(null);
    const [ feedback, setFeedback ] = useState('');
    const create = useCallback(async () => {
        if (!appName.trim()) return;
        try {
            const result = await state.create(appName);
            setAppName('');
            setReveal(result.reveal);
            setFeedback(result.reveal ?
                'API key created. Copy the credential from the one-time reveal.' :
                'API key created, but PiggieTV could not uniquely identify the new credential for safe display.');
        } catch (error) {
            setFeedback(error instanceof Error ? error.message : 'The API key could not be created.');
        }
    }, [ appName, state ]);
    const revoke = useCallback(async () => {
        const row = selected;
        setSelected(null);
        if (!row) return;
        try {
            await state.revoke(row);
            setFeedback('API key revoked.');
        } catch (error) {
            setFeedback(error instanceof Error ? error.message : 'The API key could not be revoked.');
        }
    }, [ selected, state ]);
    const copyReveal = useCallback(() => {
        if (reveal) void navigator.clipboard?.writeText(reveal.token);
        setReveal(null);
        setFeedback('The one-time API key reveal is closed. PiggieTV will not display it again.');
    }, [ reveal ]);

    if (state.loading) return <AdminConfigurationSkeleton />;
    if (state.error) return <AdminConfigurationError loading={false} message="API keys couldn't be loaded." onRetry={() => void state.refetch()} retrying={state.fetching} />;

    return (
        <section aria-labelledby='ptv-server-api-keys-title' className='ptv-admin-server-section'>
            <header className='ptv-admin-server-section-heading'>
                <div><h2 id='ptv-server-api-keys-title'>API Keys</h2><p>Manage application credentials used by integrations.</p></div>
                <button disabled={state.fetching || Boolean(state.operation)} onClick={() => void state.refetch()} type='button'><PtvIcon name='refresh' size='16px' />Refresh</button>
            </header>

            <aside className='ptv-admin-server-security-note' role='status'>
                <PtvIcon name='apiKeys' size='22px' />
                <div><strong>Credentials stay protected</strong><p>Existing raw tokens are never rendered, copied, logged, or stored in PiggieTV query state.</p></div>
            </aside>

            <section className='ptv-admin-server-operation-panel'>
                <header><div><h3>Create API Key</h3><p>Name the application or integration that will use this credential.</p></div></header>
                <div className='ptv-admin-server-create-row'>
                    <label htmlFor='ptv-api-key-name'><span>Application name</span><input autoComplete='off' id='ptv-api-key-name' maxLength={100} onChange={event => setAppName(event.currentTarget.value)} placeholder='Example: Home Assistant' value={appName} /></label>
                    <button className='is-primary' disabled={!appName.trim() || Boolean(state.operation)} onClick={() => void create()} type='button'>{state.operation === 'create' ? 'Creating...' : 'Create Key'}</button>
                </div>
            </section>

            {feedback ? <p aria-live='polite' className='ptv-admin-server-feedback' role='status'>{feedback}</p> : null}
            <section className='ptv-admin-server-operation-panel'>
                <header><div><h3>Application Keys</h3><p>{state.rows.length} configured {state.rows.length === 1 ? 'credential' : 'credentials'}</p></div></header>
                {state.rows.length ? (
                    <div className='ptv-admin-server-table-wrap'>
                        <table><thead><tr><th>Application</th><th>Token</th><th>Created</th><th><span className='visually-hidden'>Actions</span></th></tr></thead>
                            <tbody>{state.rows.map(row => <tr key={row.id}><td>{row.appName || 'Unnamed application'}</td><td><code>{row.tokenMask}</code></td><td>{formatDate(row.createdAt)}</td><td><button className='is-danger' disabled={Boolean(state.operation)} onClick={() => setSelected(row)} type='button'>Revoke</button></td></tr>)}</tbody>
                        </table>
                    </div>
                ) : <div className='ptv-admin-server-empty'><PtvIcon name='apiKeys' size='30px' /><strong>No API keys configured</strong><span>Create one when a trusted integration needs server access.</span></div>}
            </section>

            <ConfirmDialog confirmButtonColor='error' confirmButtonText='Revoke Key' onCancel={() => setSelected(null)} onConfirm={() => void revoke()} open={Boolean(selected)} text={`Revoke the API key for ${selected?.appName || 'this application'}? The integration will immediately lose access and this cannot be undone.`} title='Revoke API key?' />
            <ConfirmDialog confirmButtonText='Copy & Close' onCancel={() => setReveal(null)} onConfirm={copyReveal} open={Boolean(reveal)} text={`Copy this API key now. It will not be shown again.\n\n${reveal?.token || ''}`} title={`API key created for ${reveal?.appName || 'application'}`} />
        </section>
    );
}
/* eslint-enable no-void, react/jsx-no-bind */
