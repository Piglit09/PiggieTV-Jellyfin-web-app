import type { Api } from '@jellyfin/sdk';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import ConfirmDialog from '../../../../../components/ConfirmDialog';
import {
    getCurrentPtvPluginApiClient,
    type HomeUserAccess,
    type HomeUserAccessResponse,
    type HomeUserVerificationBatch
} from '../../../../core/pluginApi';
import type { AdminUserSummary } from './adminUsersModel';

/* eslint-disable react/jsx-no-bind, no-void */

type VerificationSummary = {
    verifiedCount: number;
    needsVerificationCount: number;
    totalCount: number;
    currentBatchId: string | null;
    topologyEpoch: string | null;
    held: boolean;
    recoveryRequired: boolean;
    migrationRecoveryRestricted: boolean;
};

type ReviewedCandidate = {
    access: HomeUserAccess;
    batchId: string;
    userId: string;
};

function canonicalGuid(value: string | null | undefined) {
    if (!value) return null;
    if (/^[a-f\d]{32}$/i.test(value)) return value.toLowerCase();
    if (/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value)) return value.replace(/-/g, '').toLowerCase();
    return null;
}

function exactReviewedAccess(view: HomeUserAccessResponse, userId: string): HomeUserAccess | null {
    const canonicalUser = canonicalGuid(userId);
    const access = view.currentAccess;
    if (!canonicalUser || view.version !== 1 || canonicalGuid(view.userId) !== canonicalUser
        || !access || canonicalGuid(access.userId) !== canonicalUser
        || typeof access.enableAllFolders !== 'boolean'
        || typeof access.isAdministrator !== 'boolean'
        || typeof access.isDisabled !== 'boolean'
        || !Array.isArray(access.enabledFolders)) return null;
    const folders = access.enabledFolders.map(canonicalGuid);
    if (folders.some(folder => !folder) || new Set(folders).size !== folders.length
        || (access.enableAllFolders && folders.length > 0)) return null;
    return { ...access, enabledFolders: folders as string[], userId: canonicalUser };
}

function folderAccessText(access: HomeUserAccess) {
    if (access.enableAllFolders) return 'All libraries';
    if (access.enabledFolders.length === 0) return 'No libraries';
    return `Selected libraries: ${access.enabledFolders.join(', ')}`;
}

function isMissing(error: unknown) {
    const candidate = error as { status?: number; response?: { status?: number } };
    return candidate?.status === 404 || candidate?.response?.status === 404;
}

/** Explicit administrator enrollment of a fixed existing-user cohort. No timer or automatic verification. */
export default function PtvAdminUserVerification({
    api,
    users
}: Readonly<{
    api?: Api;
    users: readonly AdminUserSummary[];
}>) {
    const [ summary, setSummary ] = useState<VerificationSummary | null>(null);
    const [ batch, setBatch ] = useState<HomeUserVerificationBatch | null>(null);
    const [ loading, setLoading ] = useState(true);
    const [ busyId, setBusyId ] = useState<string | null>(null);
    const [ message, setMessage ] = useState('');
    const [ confirmRecovery, setConfirmRecovery ] = useState(false);
    const [ reviewed, setReviewed ] = useState<ReviewedCandidate | null>(null);
    const [ policyConfirmed, setPolicyConfirmed ] = useState(false);
    const names = useMemo(() => new Map(users.map(user => [ user.id.toLowerCase(), user.username ])), [users]);

    const plugin = useCallback(() => {
        const client = getCurrentPtvPluginApiClient();
        if (!api || !client?.matchesSdkApi(api)) throw new Error('Plugin verification is unavailable for this server.');
        return client;
    }, [api]);
    const refresh = useCallback(async (signal?: AbortSignal) => {
        const client = plugin();
        const [ nextSummary, nextBatch ] = await Promise.all([
            client.getHomeUserVerificationSummary({ signal }),
            client.getCurrentHomeUserVerificationBatch({ signal }).catch((error: unknown) => {
                if (isMissing(error)) return null;
                throw error;
            })
        ]);
        if (signal?.aborted) return;
        setSummary(nextSummary);
        setBatch(nextBatch);
        setMessage('');
    }, [plugin]);

    useEffect(() => {
        // eslint-disable-next-line compat/compat
        const controller = new AbortController();
        setLoading(true);
        void refresh(controller.signal).catch(() => {
            if (!controller.signal.aborted) setMessage('Verification status could not be loaded. Retry to inspect current accounts.');
        }).finally(() => {
            if (!controller.signal.aborted) setLoading(false);
        });
        return () => controller.abort();
    }, [refresh]);

    const startBatch = useCallback(async (fresh: boolean) => {
        if (busyId || summary?.migrationRecoveryRestricted) return;
        setBusyId('batch');
        setMessage('');
        try {
            const client = plugin();
            const next = fresh ?
                await client.createFreshHomeUserVerificationBatch() :
                await client.createHomeUserVerificationBatch();
            setBatch(next);
            setReviewed(null);
            setPolicyConfirmed(false);
        } catch {
            setMessage('The verification batch could not be started. Retry when the Plugin is available.');
        } finally {
            setBusyId(null);
        }
    }, [busyId, plugin, summary?.migrationRecoveryRestricted]);
    const reviewCandidate = useCallback(async (userId: string) => {
        if (!batch || batch.stale || summary?.recoveryRequired || summary?.migrationRecoveryRestricted
            || !batch.candidateUserIds.includes(userId) || busyId) return;
        setBusyId(userId);
        setReviewed(null);
        setPolicyConfirmed(false);
        setMessage('');
        try {
            const view = await plugin().getCurrentHomeUserAccess(userId);
            const access = exactReviewedAccess(view, userId);
            if (!access) throw new Error('Current policy unavailable.');
            setReviewed({ access, batchId: batch.id, userId });
        } catch {
            setMessage('Current access could not be reviewed. Open this account and retry before verification.');
        } finally {
            setBusyId(null);
        }
    }, [batch, busyId, plugin, summary?.migrationRecoveryRestricted, summary?.recoveryRequired]);
    const verifyCandidate = useCallback(async (userId: string) => {
        if (!batch || batch.stale || summary?.recoveryRequired || summary?.migrationRecoveryRestricted || !batch.candidateUserIds.includes(userId)
            || !reviewed || reviewed.batchId !== batch.id || reviewed.userId !== userId
            || !policyConfirmed || busyId) return;
        setBusyId(userId);
        setMessage('');
        try {
            const client = plugin();
            await client.verifyHomeUserVerificationBatchCandidate(batch.id, userId, {
                confirmCurrentPolicy: true,
                intendedAccess: reviewed.access
            });
            await refresh();
            setReviewed(null);
            setPolicyConfirmed(false);
        } catch {
            setMessage('This account could not be verified. Review its current policy and retry.');
        } finally {
            setBusyId(null);
        }
    }, [batch, busyId, plugin, policyConfirmed, refresh, reviewed, summary?.migrationRecoveryRestricted, summary?.recoveryRequired]);
    const recoverCorrupt = useCallback(async () => {
        if (busyId || !summary?.recoveryRequired) return;
        setConfirmRecovery(false);
        setBusyId('recovery');
        setMessage('');
        try {
            const result = await plugin().recoverCorruptHomeUserAccessLedger();
            if (result.recovered !== true || result.requiresVerification !== true) {
                throw new Error('Plugin did not confirm recovery.');
            }
            await refresh();
        } catch {
            setMessage('The damaged verification record remains held. Retry recovery after the Plugin is available.');
        } finally {
            setBusyId(null);
        }
    }, [busyId, plugin, refresh, summary?.recoveryRequired]);

    return (
        <section aria-label='Home access verification' className='ptv-admin-users-verification' data-testid='ptv-admin-user-verification'>
            <h2>Home access verification</h2>
            <p>Review each eligible account before allowing its configured Home rows. The first verification batch fixes the eligible cohort; accounts created later require new-account bootstrap.</p>
            {summary && (
                <p aria-live='polite'>Verified {summary.verifiedCount} · Needs verification {summary.needsVerificationCount}</p>
            )}
            {loading && <p role='status'>Loading verification status…</p>}
            {message && <p aria-live='polite' role='alert'>{message}</p>}
            {summary?.recoveryRequired && (
                <div className='ptv-admin-users-verification-recovery'>
                    <p>The verification record is damaged. Recovery will quarantine the damaged record, reset owned Home access proofs to unverified, and require individual account verification again.</p>
                    <button disabled={Boolean(busyId)} onClick={() => setConfirmRecovery(true)} type='button'>Recover damaged verification record</button>
                </div>
            )}
            {summary?.migrationRecoveryRestricted && !summary.recoveryRequired && (
                <p>Legacy migration is closed after damaged-record recovery. Open each account for controlled policy verification; an administrator must choose restrictive intended access before Plugin readback can verify Home.</p>
            )}
            {!loading && !summary && (
                <button onClick={() => void refresh().catch(() => setMessage('Verification status is still unavailable.'))} type='button'>Retry verification status</button>
            )}
            {!loading && summary && !summary.recoveryRequired && !summary.migrationRecoveryRestricted && !batch && (
                <button disabled={Boolean(busyId)} onClick={() => void startBatch(false)} type='button'>Start verification batch</button>
            )}
            {batch?.stale && !summary?.recoveryRequired && !summary?.migrationRecoveryRestricted && (
                <p>
                    This batch belongs to an earlier library topology.{' '}
                    <button disabled={Boolean(busyId)} onClick={() => void startBatch(true)} type='button'>Refresh verification batch</button>
                </p>
            )}
            {batch && !batch.stale && !summary?.recoveryRequired && !summary?.migrationRecoveryRestricted && (
                <div className='ptv-admin-users-verification-candidates'>
                    <p>This batch contains {batch.candidateUserIds.length} accounts captured when it started.</p>
                    <p>Batch verified {batch.verifiedCount} · Batch needs verification {batch.needsVerificationCount}</p>
                    <button disabled={Boolean(busyId)} onClick={() => void startBatch(true)} type='button'>Refresh verification batch</button>
                    {batch.candidateUserIds.map(userId => (
                        <div className='ptv-admin-users-verification-candidate' key={userId}>
                            <span>{names.get(userId.toLowerCase()) || userId}</span>
                            <button disabled={Boolean(busyId)} onClick={() => void reviewCandidate(userId)} type='button'>Review access</button>
                            {reviewed?.batchId === batch.id && reviewed.userId === userId && (
                                <div className='ptv-admin-users-verification-review'>
                                    <p>Current role: {reviewed.access.isAdministrator ? 'Administrator' : 'Member'}.</p>
                                    <p>Current sign-in: {reviewed.access.isDisabled ? 'Disabled' : 'Enabled'}.</p>
                                    <p>{folderAccessText(reviewed.access)}.</p>
                                    <p>Confirm this policy only if it is the intended access for this account. Open the account to change access first.</p>
                                    <Link to={`/settings/admin/users/${encodeURIComponent(userId)}`}>Open account</Link>
                                    <label>
                                        <input
                                            aria-label={`Confirm current access for ${names.get(userId.toLowerCase()) || userId}`}
                                            checked={policyConfirmed}
                                            onChange={event => setPolicyConfirmed(event.currentTarget.checked)}
                                            type='checkbox'
                                        />
                                        I reviewed this policy and confirm it is intended.
                                    </label>
                                    <button disabled={Boolean(busyId) || !policyConfirmed} onClick={() => void verifyCandidate(userId)} type='button'>Verify user</button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
            <ConfirmDialog
                confirmButtonColor='error'
                confirmButtonText='Reset verification'
                onCancel={() => setConfirmRecovery(false)}
                onConfirm={() => void recoverCorrupt()}
                open={confirmRecovery}
                text='The Plugin will quarantine the damaged record and reset all owned Home access proofs to unverified. Each existing account will need individual verification before its Home rows return.'
                title='Reset Home access verification?'
            />
        </section>
    );
}

/* eslint-enable react/jsx-no-bind, no-void */
