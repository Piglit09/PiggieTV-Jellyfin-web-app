import React, { useCallback, useState } from 'react';

import ConfirmDialog from '../../../../../../components/ConfirmDialog';
import { useApi } from '../../../../../../hooks/useApi';
import PtvIcon from '../../../../icons/PtvIcon';
import { AdminConfigurationError, AdminConfigurationNotice, AdminConfigurationSkeleton } from '../../configuration/AdminConfigurationPrimitives';
import type { PtvAdminBackup, PtvAdminBackupCreateOptions } from '../adminServerOperationsModel';
import { useAdminServerBackups } from '../useAdminServerOperations';

const DEFAULT_OPTIONS: PtvAdminBackupCreateOptions = {
    database: true,
    metadata: false,
    subtitles: false,
    trickplay: false
};

function formatDate(value: string | null) {
    if (!value) return 'Unknown';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
}

function formatBytes(value: number | null) {
    if (value === null) return 'Unknown';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function optionSummary(row: PtvAdminBackup) {
    const enabled = Object.entries(row.options).filter(([, value ]) => value).map(([ key ]) => key);
    return enabled.length ? enabled.join(', ') : 'Server defaults';
}

function AccountBackupStatus({ state }: Readonly<{
    state: ReturnType<typeof useAdminServerBackups>;
}>) {
    if (state.accountError) {
        return <p className='ptv-admin-server-muted'>Account backup status is unavailable. Jellyfin backups remain usable.</p>;
    }
    if (!state.account) {
        return <p className='ptv-admin-server-muted'>No latest account backup status is available.</p>;
    }
    return (
        <dl className='ptv-admin-server-definition-list'>
            <div><dt>Last success</dt><dd>{formatDate(state.account.lastSuccessAt)}</dd></div>
            <div><dt>Verification</dt><dd>{state.account.verificationStatus || 'Unknown'}</dd></div>
            <div><dt>Profiles</dt><dd>{state.account.profilesBackedUp ?? 'Unknown'}</dd></div>
            <div><dt>Size</dt><dd>{formatBytes(state.account.sizeBytes)}</dd></div>
        </dl>
    );
}

/* eslint-disable no-void, react/jsx-no-bind */
export default function AdminServerBackupsPage() {
    const { __legacyApiClient__: apiClient, api } = useApi();
    const state = useAdminServerBackups(api, apiClient);
    const [ options, setOptions ] = useState(DEFAULT_OPTIONS);
    const [ selected, setSelected ] = useState<PtvAdminBackup | null>(null);
    const [ inspected, setInspected ] = useState<PtvAdminBackup | null>(null);
    const [ confirmRestore, setConfirmRestore ] = useState(false);
    const [ confirmAccountRestore, setConfirmAccountRestore ] = useState(false);
    const [ accountDryRunPassed, setAccountDryRunPassed ] = useState(false);
    const [ feedback, setFeedback ] = useState('');
    const busy = Boolean(state.operation);
    const setOption = useCallback((name: keyof PtvAdminBackupCreateOptions, value: boolean) => {
        if (name === 'database') return;
        setOptions(current => ({ ...current, [name]: value }));
    }, []);
    const create = useCallback(async () => {
        try {
            await state.create(options);
            setFeedback('Jellyfin backup created.');
        } catch (error) {
            setFeedback(error instanceof Error ? error.message : 'The backup could not be created.');
        }
    }, [ options, state ]);
    const inspect = useCallback(async (row: PtvAdminBackup) => {
        setSelected(row);
        try {
            setInspected(await state.inspect(row));
        } catch (error) {
            setInspected(null);
            setFeedback(error instanceof Error ? error.message : 'Backup information could not be loaded.');
        }
    }, [ state ]);
    const restore = useCallback(async () => {
        const row = selected;
        setConfirmRestore(false);
        if (!row) return;
        try {
            await state.restore(row);
            setFeedback('Backup restore accepted. The Jellyfin server may restart.');
        } catch (error) {
            setFeedback(error instanceof Error ? error.message : 'The backup restore could not be started.');
        }
    }, [ selected, state ]);
    const runAccount = useCallback(async (action: 'create' | 'dry-run' | 'restore' | 'verify') => {
        if (action !== 'restore') setAccountDryRunPassed(false);
        try {
            let result;
            if (action === 'create') result = await state.createAccount();
            else if (action === 'verify') result = await state.verifyAccount();
            else if (action === 'dry-run') result = await state.dryRunRestoreAccount();
            else result = await state.restoreAccount();
            if (action === 'dry-run') setAccountDryRunPassed(Boolean(result.ok && result.verified && result.dryRun));
            if (action === 'restore') {
                setConfirmAccountRestore(false);
                setAccountDryRunPassed(false);
            }
            setFeedback(result.message || (result.ok ? 'PiggieTV account backup operation completed.' : 'PiggieTV account backup operation did not complete.'));
        } catch (error) {
            if (action === 'dry-run') setAccountDryRunPassed(false);
            setFeedback(error instanceof Error ? error.message : 'The PiggieTV account backup operation failed.');
        }
    }, [ state ]);
    const refreshAll = useCallback(() => {
        setAccountDryRunPassed(false);
        Promise.allSettled([ state.refetch(), state.refetchAccount() ]).catch(() => undefined);
    }, [ state ]);

    if (state.loading && state.accountLoading) return <AdminConfigurationSkeleton />;
    return (
        <section aria-labelledby='ptv-server-backups-title' className='ptv-admin-server-section'>
            <header className='ptv-admin-server-section-heading'>
                <div><h2 id='ptv-server-backups-title'>Backups</h2><p>Create and restore supported Jellyfin and PiggieTV account backups.</p></div>
                <button disabled={state.fetching || busy} onClick={refreshAll} type='button'><PtvIcon name='refresh' size='16px' />Refresh</button>
            </header>

            <AdminConfigurationNotice tone='warning'>
                <strong>Restores replace server data and may restart services.</strong>
                <p>Review the selected manifest. PiggieTV validates it again immediately before a Jellyfin restore.</p>
            </AdminConfigurationNotice>
            {feedback ? <p aria-live='polite' className='ptv-admin-server-feedback' role='status'>{feedback}</p> : null}

            <div className='ptv-admin-server-backup-grid'>
                <section className='ptv-admin-server-operation-panel'>
                    <header><div><h3>Jellyfin Server Backup</h3><p>Select contents and create an archive managed by Jellyfin.</p></div><span className='ptv-admin-server-status-chip'>Jellyfin</span></header>
                    <div className='ptv-admin-server-check-grid'>
                        {(Object.keys(options) as (keyof PtvAdminBackupCreateOptions)[]).map(name => <label key={name}><input checked={options[name]} disabled={busy || name === 'database'} onChange={event => setOption(name, event.currentTarget.checked)} type='checkbox' /><span>{name[0].toUpperCase() + name.slice(1)}</span></label>)}
                    </div>
                    <button className='is-primary' disabled={busy} onClick={() => void create()} type='button'>{state.operation === 'create-jellyfin' ? 'Creating...' : 'Create Server Backup'}</button>
                </section>

                <section className='ptv-admin-server-operation-panel'>
                    <header><div><h3>PiggieTV Account Backup</h3><p>Latest-only account profile and verification backup managed by the PTV plugin.</p></div><span className='ptv-admin-server-status-chip'>PTV</span></header>
                    <AccountBackupStatus state={state} />
                    <div className='ptv-admin-server-inline-actions'>
                        <button disabled={busy} onClick={() => void runAccount('create')} type='button'>Create Latest</button>
                        <button disabled={busy || !state.account?.available} onClick={() => void runAccount('verify')} type='button'>Verify</button>
                        <button disabled={busy || !state.account?.available} onClick={() => void runAccount('dry-run')} type='button'>Test Restore</button>
                        <button className='is-danger' disabled={busy || !state.account?.available || !accountDryRunPassed} onClick={() => setConfirmAccountRestore(true)} type='button'>Restore Latest</button>
                    </div>
                    {!accountDryRunPassed ? <p className='ptv-admin-server-muted'>A successful dry-run is required immediately before live PiggieTV account restore.</p> : null}
                </section>
            </div>

            {state.error ? <AdminConfigurationError loading={false} message="Jellyfin backups couldn't be loaded." onRetry={() => void state.refetch()} retrying={state.fetching} /> : (
                <section className='ptv-admin-server-operation-panel'>
                    <header><div><h3>Available Jellyfin Backups</h3><p>Server filesystem paths are intentionally hidden.</p></div></header>
                    {state.rows.length ? <div className='ptv-admin-server-backup-list'>{state.rows.map(row => (
                        <article key={row.id}>
                            <div><strong>{formatDate(row.createdAt)}</strong><span>{row.serverVersion ? `Server ${row.serverVersion}` : 'Server version unknown'} / {optionSummary(row)}</span></div>
                            <div><button disabled={busy} onClick={() => void inspect(row)} type='button'>View Manifest</button><button className='is-danger' disabled={busy} onClick={() => {
                                setInspected(null);
                                setSelected(row);
                                setConfirmRestore(true);
                            }} type='button'>Restore</button></div>
                        </article>
                    ))}</div> : <div className='ptv-admin-server-empty'><PtvIcon name='backups' size='30px' /><strong>No backups reported</strong><span>Create a supported Jellyfin backup to begin.</span></div>}
                </section>
            )}

            {inspected ? <aside className='ptv-admin-server-manifest' aria-label='Backup manifest'><div><strong>Backup manifest</strong><span>{formatDate(inspected.createdAt)} / {optionSummary(inspected)}</span><small>Server {inspected.serverVersion || 'unknown'} / Engine {inspected.backupEngineVersion || 'unknown'}</small></div><button onClick={() => {
                setSelected(null);
                setInspected(null);
            }} type='button'>Close</button></aside> : null}

            <ConfirmDialog confirmButtonColor='error' confirmButtonText='Restore & Restart' onCancel={() => setConfirmRestore(false)} onConfirm={() => void restore()} open={confirmRestore} text='Restore this Jellyfin backup? PiggieTV will revalidate its manifest, then Jellyfin may restart and replace current server data.' title='Restore Jellyfin backup?' />
            <ConfirmDialog confirmButtonColor='error' confirmButtonText='Restore Accounts' onCancel={() => setConfirmAccountRestore(false)} onConfirm={() => void runAccount('restore')} open={confirmAccountRestore} text='Restore the latest PiggieTV account backup now? A dry-run passed, but this live action can replace account profile and verification data.' title='Restore PiggieTV accounts?' />
        </section>
    );
}
/* eslint-enable no-void, react/jsx-no-bind */
