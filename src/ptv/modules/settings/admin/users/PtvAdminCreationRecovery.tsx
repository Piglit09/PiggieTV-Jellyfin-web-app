import type { Api } from '@jellyfin/sdk';
import type { ApiClient } from 'jellyfin-apiclient';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import ConfirmDialog from '../../../../../components/ConfirmDialog';
import { getCurrentPtvPluginApiClient, type HomeUserCreationCurrent, type HomeUserCreationOperationStatus } from '../../../../core/pluginApi';
import { getResolvedAdminServerId } from '../adminServerIdentity';
import {
    clearPendingNewAdminCreation,
    readPendingNewAdminCreation,
    reserveNewAdminUserCreation,
    type PendingNewAdminCreation
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

const UNCERTAIN_RECOVERY = 'The Plugin did not confirm recovery; its outcome is unknown. Refresh reservation status before retrying.';
const UNCERTAIN_BINDING = 'The Plugin did not confirm binding; its outcome is unknown. Refresh reservation status before retrying.';

function classifyCreationStatus(status: HomeUserCreationOperationStatus, hint: PendingNewAdminCreation) {
    if (status.version !== 1 || !sameGuid(status.creationOperationId, hint.creationOperationId)
        || !Array.isArray(status.markedUserIds)
        || status.markedUserIds.some(id => typeof id !== 'string' || !canonicalGuid(id))) {
        throw new Error('Plugin creation status is incomplete.');
    }
    if (status.state === 'bound') {
        const boundId = typeof status.userId === 'string' && canonicalGuid(status.userId);
        if (!boundId || status.markedUserIds.length) {
            throw new Error('Plugin binding status is incomplete.');
        }
        return {
            boundId,
            clearHold: true,
            message: 'Another administrator bound this creation request. Open the account to review its access; Home remains unverified until Plugin proof completes.'
        };
    }
    if (status.state === 'recovered' && status.userId === null) {
        return {
            boundId: null,
            clearHold: true,
            message: 'This creation request was already settled. Review any possible new accounts before choosing their intended access.'
        };
    }
    if (status.state === 'absent' && status.userId === null && status.markedUserIds.length === 0) {
        if (hint.stage === 'prepared') {
            return {
                boundId: null,
                clearHold: true,
                message: 'The Plugin has no reservation or completed operation for this request. No account creation was started from it; you can start a new request.'
            };
        }
        return {
            boundId: null,
            clearHold: false,
            message: 'The Plugin has no record of this request, but Jellyfin account creation may have started. The local creation hold remains until an administrator resolves the account outcome.'
        };
    }
    throw new Error('Plugin creation status is inconsistent with this request.');
}

/** Server-owned reservation review for an uncertain Jellyfin Create response. */
export default function PtvAdminCreationRecovery({
    api,
    apiClient,
    onChanged,
    refreshRevision,
    users
}: Readonly<{
    api?: Api;
    apiClient?: ApiClient;
    onChanged?: () => void;
    refreshRevision?: number;
    users: readonly AdminUserSummary[];
}>) {
    const serverKey = getResolvedAdminServerId(apiClient);
    const [ current, setCurrent ] = useState<HomeUserCreationCurrent | null>(null);
    const [ confirmId, setConfirmId ] = useState<string | null>(null);
    const [ confirmBind, setConfirmBind ] = useState<{ creationOperationId: string; userId: string } | null>(null);
    const [ boundId, setBoundId ] = useState<string | null>(null);
    const [ recoveredIds, setRecoveredIds ] = useState<string[]>([]);
    const [ busy, setBusy ] = useState(false);
    const [ message, setMessage ] = useState('');
    const [ readError, setReadError ] = useState(false);
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
        if (!Array.isArray(next.pending) || next.pendingCount !== next.pending.length
            || next.pending.some(entry => typeof entry?.creationOperationId !== 'string'
                || !canonicalGuid(entry.creationOperationId) || !Array.isArray(entry.candidateNewUserIds)
                || entry.candidateNewUserIds.some(id => typeof id !== 'string' || !canonicalGuid(id)))) {
            throw new Error('Plugin reservation status is incomplete.');
        }
        setCurrent(next);
        setReadError(false);
        return next;
    }, [plugin]);

    const retryStatus = useCallback(async () => {
        if (busy) return;
        setBusy(true);
        try {
            const next = await refresh();
            if (next && current?.pending.some(previous =>
                !next.pending.some(entry => sameGuid(entry.creationOperationId, previous.creationOperationId)))) {
                onChanged?.();
            }
            setMessage(previous => previous === 'Pending creation reservations could not be loaded.'
                || previous === UNCERTAIN_RECOVERY || previous === UNCERTAIN_BINDING ? '' : previous);
        } catch {
            setReadError(true);
        } finally {
            setBusy(false);
        }
    }, [busy, current, onChanged, refresh]);

    useEffect(() => {
        if (!api || !serverKey) return;
        // eslint-disable-next-line compat/compat
        const controller = new AbortController();
        void refresh(controller.signal).catch(() => {
            if (!controller.signal.aborted) {
                setMessage('Pending creation reservations could not be loaded.');
                setReadError(true);
            }
        });
        return () => controller.abort();
    }, [api, refresh, refreshRevision, serverKey]);

    const reconcileLocalHint = useCallback(async () => {
        if (!api || !localHint || busy || readError || !current
            || current.pending.some(entry => sameGuid(entry.creationOperationId, localHint.creationOperationId))) return;
        setBusy(true);
        setMessage('');
        setRecoveredIds([]);
        try {
            const status = await plugin().getHomeUserCreationOperationStatus(localHint.creationOperationId);
            const resolution = classifyCreationStatus(status, localHint);
            if (resolution.boundId) setBoundId(resolution.boundId);
            if (status.state === 'recovered') {
                setRecoveredIds(status.markedUserIds.map(id => canonicalGuid(id)!));
            }
            setMessage(resolution.message);
            if (resolution.clearHold) {
                if (serverKey) clearPendingNewAdminCreation(serverKey, localHint.creationOperationId);
                onChanged?.();
            }
        } catch {
            setReadError(true);
            setMessage('The Plugin could not confirm how this creation request ended. The creation hold remains. Retry after status is available.');
        } finally {
            setBusy(false);
        }
    }, [api, busy, current, localHint, onChanged, plugin, readError, serverKey]);

    const retryPreparedReservation = useCallback(async () => {
        if (!api || !localHint || localHint.stage !== 'prepared' || !current || busy
            || current.pending.some(entry => sameGuid(entry.creationOperationId, localHint.creationOperationId))) return;
        setBusy(true);
        try {
            await reserveNewAdminUserCreation(api, localHint);
        } catch {
            setReadError(true);
            setMessage('The same Plugin reservation was not confirmed. No account creation was started; the local hold remains. Check status or retry this request.');
            setBusy(false);
            return;
        }
        setMessage('The same Plugin reservation was confirmed. No account creation was started. Review or settle this request before creating another account.');
        onChanged?.();
        try {
            await refresh();
        } catch {
            setReadError(true);
        } finally {
            setBusy(false);
        }
    }, [api, busy, current, localHint, onChanged, refresh]);

    const recover = useCallback(async () => {
        if (!confirmId || busy || readError || !current) return;
        const entry = current.pending.find(item => sameGuid(item.creationOperationId, confirmId));
        if (!entry) return;
        setBusy(true);
        setConfirmId(null);
        setMessage('');
        setRecoveredIds([]);
        try {
            const result = await plugin().recoverHomeUserCreation(entry.creationOperationId, {
                confirmCreationRequestSettled: true
            });
            if (!sameGuid(result.creationOperationId, entry.creationOperationId)
                || result.state !== 'recovered' || !Array.isArray(result.markedUserIds)
                || result.markedUserIds.some(id => typeof id !== 'string' || !canonicalGuid(id))) {
                throw new Error('Plugin did not confirm recovery.');
            }
            setRecoveredIds(result.markedUserIds.map(id => canonicalGuid(id)!));
        } catch {
            setMessage(UNCERTAIN_RECOVERY);
            setReadError(true);
            setBusy(false);
            return;
        }
        if (serverKey) clearPendingNewAdminCreation(serverKey, entry.creationOperationId);
        setCurrent(previous => previous && ({
            pending: previous.pending.filter(item => !sameGuid(item.creationOperationId, entry.creationOperationId)),
            pendingCount: Math.max(0, previous.pendingCount - 1)
        }));
        setMessage('The settled request was recovered. Possible new accounts remain unverified until an administrator chooses their intended access.');
        onChanged?.();
        try {
            await refresh();
        } catch {
            setReadError(true);
        } finally {
            setBusy(false);
        }
    }, [busy, confirmId, current, onChanged, plugin, readError, refresh, serverKey]);

    const bind = useCallback(async () => {
        if (!confirmBind || busy || readError || !current) return;
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
        } catch {
            setMessage(UNCERTAIN_BINDING);
            setReadError(true);
            setBusy(false);
            return;
        }
        if (serverKey) clearPendingNewAdminCreation(serverKey, entry.creationOperationId);
        setCurrent(previous => previous && ({
            pending: previous.pending.filter(item => !sameGuid(item.creationOperationId, entry.creationOperationId)),
            pendingCount: Math.max(0, previous.pendingCount - 1)
        }));
        setBoundId(id);
        setMessage('The possible account was bound to controlled creation. Choose its intended access on the account page; Home remains unverified.');
        onChanged?.();
        try {
            await refresh();
        } catch {
            setReadError(true);
        } finally {
            setBusy(false);
        }
    }, [busy, confirmBind, current, onChanged, plugin, readError, refresh, serverKey]);

    if (!api || !serverKey || (!current?.pendingCount && !message && !localHint)) return null;

    const localHintUnlisted = localHint && current
        && !current.pending.some(entry => sameGuid(entry.creationOperationId, localHint.creationOperationId));

    return (
        <section className='ptv-admin-users-verification' data-testid='ptv-admin-creation-recovery'>
            <h2>Account creation recovery</h2>
            <p>Review unresolved creation requests and Plugin reservations. Possible IDs below were absent before a reservation began; review the Jellyfin account before choosing one. No account is verified by a reservation.</p>
            {localHint && <p>Unresolved creation request for {localHint.username} (ID: {localHint.creationOperationId}). A new account cannot be created until this request is resolved.</p>}
            {localHint && !current && !readError && <p>Checking the Plugin for this reservation…</p>}
            {localHintUnlisted && (
                <div>
                    <p>The Plugin does not list this operation among pending reservations. Read its durable status before releasing the local creation hold.</p>
                    <button disabled={busy || readError} onClick={() => void reconcileLocalHint()} type='button'>Check creation request</button>
                    {readError && localHint.stage === 'prepared' && (
                        <button disabled={busy} onClick={() => void retryPreparedReservation()} type='button'>Retry same reservation</button>
                    )}
                </div>
            )}
            {message && <p aria-live='polite'>{message}</p>}
            {readError && <p role='alert'>Reservation status could not be refreshed. Retry the status read before acting on another reservation.</p>}
            {readError && <button disabled={busy} onClick={() => void retryStatus()} type='button'>Retry reservation status</button>}
            {boundId && <Link to={`/settings/admin/users/${encodeURIComponent(boundId)}`}>Open bound account</Link>}
            {recoveredIds.map(id => (
                <p key={id}>Possible account from settled request: {names.get(id) || id}{' '}
                    <Link to={`/settings/admin/users/${encodeURIComponent(id)}`}>View account</Link>
                </p>
            ))}
            {current?.pending.map(entry => (
                <div key={entry.creationOperationId}>
                    <p>Reservation {entry.creationOperationId}{localHint && sameGuid(localHint.creationOperationId, entry.creationOperationId) ? ` for ${localHint.username}` : ''}</p>
                    {entry.candidateNewUserIds.length === 0 && <p>No possible new account ID is currently visible.</p>}
                    {entry.candidateNewUserIds.map(id => (
                        <p key={id}>Possible account: {names.get(id.toLowerCase()) || id}{' '}
                            <Link to={`/settings/admin/users/${encodeURIComponent(id)}`}>View account</Link>
                            {' '}<button disabled={busy || readError || !canonicalGuid(id)} onClick={() => setConfirmBind({ creationOperationId: entry.creationOperationId, userId: id })} type='button'>Bind this account</button>
                        </p>
                    ))}
                    <button disabled={busy || readError} onClick={() => setConfirmId(entry.creationOperationId)} type='button'>Mark creation request settled</button>
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
