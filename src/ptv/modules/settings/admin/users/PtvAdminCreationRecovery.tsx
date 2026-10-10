import type { Api } from '@jellyfin/sdk';
import type { ApiClient } from 'jellyfin-apiclient';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import ConfirmDialog from '../../../../../components/ConfirmDialog';
import { getCurrentPtvPluginApiClient, type HomeUserCreationCurrent } from '../../../../core/pluginApi';
import { getResolvedAdminServerId } from '../adminServerIdentity';
import {
    clearPendingNewAdminCreation,
    readPendingNewAdminCreation
} from './adminNewUserBootstrapService';
import type { AdminUserSummary } from './adminUsersModel';

/* eslint-disable react/jsx-no-bind, no-void */

function sameGuid(left: string, right: string) {
    return left.replace(/-/g, '').toLowerCase() === right.replace(/-/g, '').toLowerCase();
}

function canonicalGuid(value: string) {
    if (!/^(?:[a-f\d]{32}|[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12})$/i.test(value)) return null;
    return value.replace(/-/g, '').toLowerCase();
}

/** Server-owned reservation review for an uncertain Jellyfin Create response. */
export default function PtvAdminCreationRecovery({
    api,
    apiClient,
    users
}: Readonly<{
    api?: Api;
    apiClient?: ApiClient;
    users: readonly AdminUserSummary[];
}>) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const [ current, setCurrent ] = useState<HomeUserCreationCurrent | null>(null);
    const [ confirmId, setConfirmId ] = useState<string | null>(null);
    const [ confirmBind, setConfirmBind ] = useState<{ creationOperationId: string; userId: string } | null>(null);
    const [ boundId, setBoundId ] = useState<string | null>(null);
    const [ busy, setBusy ] = useState(false);
    const [ message, setMessage ] = useState('');
    const names = useMemo(() => new Map(users.map(user => [ user.id.toLowerCase(), user.username ])), [users]);
    const localHint = readPendingNewAdminCreation(serverKey);
    const plugin = useCallback(() => {
        const client = getCurrentPtvPluginApiClient();
        if (!api || !client?.matchesSdkApi(api)) throw new Error('Plugin creation recovery is unavailable.');
        return client;
    }, [api]);
    const refresh = useCallback(async (signal?: AbortSignal) => {
        const next = await plugin().getCurrentHomeUserCreations({ signal });
        if (signal?.aborted) return;
        const hint = readPendingNewAdminCreation(serverKey);
        if (serverKey && hint && Array.isArray(next.pending)
            && !next.pending.some(entry => sameGuid(entry.creationOperationId, hint.creationOperationId))) {
            clearPendingNewAdminCreation(serverKey, hint.creationOperationId);
        }
        setCurrent(next);
    }, [plugin, serverKey]);

    useEffect(() => {
        if (!api || !serverKey) return;
        // eslint-disable-next-line compat/compat
        const controller = new AbortController();
        void refresh(controller.signal).catch(() => {
            if (!controller.signal.aborted) setMessage('Pending creation reservations could not be loaded.');
        });
        return () => controller.abort();
    }, [api, refresh, serverKey]);

    const recover = useCallback(async () => {
        if (!confirmId || busy || !current) return;
        const entry = current.pending.find(item => sameGuid(item.creationOperationId, confirmId));
        if (!entry) return;
        setBusy(true);
        setConfirmId(null);
        setMessage('');
        try {
            const result = await plugin().recoverHomeUserCreation(entry.creationOperationId, {
                confirmCreationRequestSettled: true
            });
            if (!sameGuid(result.creationOperationId, entry.creationOperationId)
                || result.state !== 'recovered' || !Array.isArray(result.markedUserIds)) {
                throw new Error('Plugin did not confirm recovery.');
            }
            if (serverKey) clearPendingNewAdminCreation(serverKey, entry.creationOperationId);
            setMessage('The settled request was recovered. Possible new accounts remain unverified until an administrator chooses their intended access.');
            await refresh();
        } catch {
            setMessage('The reservation remains active. Review the creation request before retrying.');
        } finally {
            setBusy(false);
        }
    }, [busy, confirmId, current, plugin, refresh, serverKey]);

    const bind = useCallback(async () => {
        if (!confirmBind || busy || !current) return;
        const entry = current.pending.find(item => sameGuid(item.creationOperationId, confirmBind.creationOperationId));
        const id = canonicalGuid(confirmBind.userId);
        if (!entry || !id || !entry.candidateNewUserIds.some(candidate => canonicalGuid(candidate) === id)) return;
        setBusy(true);
        setConfirmBind(null);
        setMessage('');
        try {
            const result = await plugin().bindHomeUserCreation(entry.creationOperationId, { userId: id });
            if (result.version !== 1 || !sameGuid(result.creationOperationId, entry.creationOperationId)
                || canonicalGuid(result.userId) !== id || result.state !== 'bound'
                || result.migrationVerificationHeld !== false || result.bootstrapRequired !== true) {
                throw new Error('Plugin did not confirm binding.');
            }
            if (serverKey) clearPendingNewAdminCreation(serverKey, entry.creationOperationId);
            setBoundId(id);
            setMessage('The possible account was bound to controlled creation. Choose its intended access on the account page; Home remains unverified.');
            await refresh();
        } catch {
            setMessage('Binding was not confirmed. Review the possible account and retry.');
        } finally {
            setBusy(false);
        }
    }, [busy, confirmBind, current, plugin, refresh, serverKey]);

    if (!api || !serverKey || (!current?.pendingCount && !message)) return null;

    return (
        <section className='ptv-admin-users-verification' data-testid='ptv-admin-creation-recovery'>
            <h2>Account creation recovery</h2>
            <p>An earlier creation request has an active Plugin reservation. Possible IDs below were absent before it began; review the Jellyfin account before choosing one. No account is verified by this reservation.</p>
            {message && <p aria-live='polite'>{message}</p>}
            {boundId && <Link to={`/settings/admin/users/${encodeURIComponent(boundId)}`}>Open bound account</Link>}
            {current?.pending.map(entry => (
                <div key={entry.creationOperationId}>
                    <p>Reservation {entry.creationOperationId}{localHint && sameGuid(localHint.creationOperationId, entry.creationOperationId) ? ` for ${localHint.username}` : ''}</p>
                    {entry.candidateNewUserIds.length === 0 && <p>No possible new account ID is currently visible.</p>}
                    {entry.candidateNewUserIds.map(id => (
                        <p key={id}>Possible account: {names.get(id.toLowerCase()) || id}{' '}
                            <Link to={`/settings/admin/users/${encodeURIComponent(id)}`}>View account</Link>
                            {' '}<button disabled={busy || !canonicalGuid(id)} onClick={() => setConfirmBind({ creationOperationId: entry.creationOperationId, userId: id })} type='button'>Bind this account</button>
                        </p>
                    ))}
                    <button disabled={busy} onClick={() => setConfirmId(entry.creationOperationId)} type='button'>Mark creation request settled</button>
                </div>
            ))}
            <ConfirmDialog
                confirmButtonColor='error'
                confirmButtonText='Mark request settled'
                onCancel={() => setConfirmId(null)}
                onConfirm={() => void recover()}
                open={Boolean(confirmId)}
                text='Confirm that the Jellyfin Create User request has finished. The Plugin will mark every possible new ID as controlled-created and keep its Home access unverified. This does not prove which account the request created.'
                title='Finish uncertain account creation?'
            />
            <ConfirmDialog
                confirmButtonText='Bind account'
                onCancel={() => setConfirmBind(null)}
                onConfirm={() => void bind()}
                open={Boolean(confirmBind)}
                text='Bind this possible account ID to the reservation only if you confirmed it is the account created by the settled request. The intended policy must still be chosen on its account page before Home access can be verified.'
                title='Bind possible account?'
            />
        </section>
    );
}

/* eslint-enable react/jsx-no-bind, no-void */
