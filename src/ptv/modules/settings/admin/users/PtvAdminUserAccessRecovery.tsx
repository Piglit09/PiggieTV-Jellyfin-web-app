import type { Api } from '@jellyfin/sdk';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { HomeUserAccess, HomeUserAccessResponse } from '../../../../core/pluginApi';
import {
    supersedeHeldAdminUserAccess,
    verifyUnprovenAdminUserAccess
} from './adminNewUserBootstrapService';
import {
    loadAdminUserLibraries,
    loadCurrentHomeUserAccess,
    reverifyPreviouslyAttestedUserAccess,
    retryExistingUserAccessCompletion
} from './adminUsersService';

/* eslint-disable react/jsx-no-bind, no-void, sonarjs/cognitive-complexity */

const GUID_PATTERN = /^(?:[a-f\d]{32}|[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12})$/i;

function canonicalGuid(value: string | null | undefined) {
    return value && GUID_PATTERN.test(value) ? value.replace(/-/g, '').toLowerCase() : null;
}

function accessText(access: HomeUserAccess | null | undefined) {
    if (!access) return 'Unavailable';
    const role = access.isAdministrator ? 'Administrator' : 'Member';
    const enabled = access.isDisabled ? 'Disabled' : 'Enabled';
    let folders = 'No libraries';
    if (access.enableAllFolders) folders = 'All libraries';
    else if (access.enabledFolders.length > 0) folders = `Selected libraries: ${access.enabledFolders.join(', ')}`;
    return `${role} · ${enabled} · ${folders}`;
}

function sameAccess(left: HomeUserAccess, right: HomeUserAccess) {
    return canonicalGuid(left.userId) === canonicalGuid(right.userId)
        && left.enableAllFolders === right.enableAllFolders
        && left.isAdministrator === right.isAdministrator && left.isDisabled === right.isDisabled
        && [ ...left.enabledFolders ].sort((a, b) => a.localeCompare(b)).join('|')
            === [ ...right.enabledFolders ].sort((a, b) => a.localeCompare(b)).join('|');
}

export default function PtvAdminUserAccessRecovery({
    api,
    onVerified,
    userId
}: Readonly<{
    api?: Api;
    onVerified?: () => void;
    userId: string;
}>) {
    const [ current, setCurrent ] = useState<HomeUserAccessResponse | null>(null);
    const [ error, setError ] = useState('');
    const [ busy, setBusy ] = useState(false);
    const [ folders, setFolders ] = useState<Array<{ id: string; name: string }> | null>(null);
    const [ folderError, setFolderError ] = useState('');
    const [ administrator, setAdministrator ] = useState<boolean | null>(null);
    const [ disabled, setDisabled ] = useState<boolean | null>(null);
    const [ libraryMode, setLibraryMode ] = useState<'all' | 'selected' | null>(null);
    const [ selectedFolderIds, setSelectedFolderIds ] = useState<string[]>([]);
    const [ policyConfirmed, setPolicyConfirmed ] = useState(false);
    const toggleSelectedFolder = useCallback((folderId: string) => {
        setPolicyConfirmed(false);
        setSelectedFolderIds(previous => previous.includes(folderId) ?
            previous.filter(id => id !== folderId) : [ ...previous, folderId ]);
    }, []);
    const busyRef = useRef(false);
    const validId = GUID_PATTERN.test(userId);
    const refresh = useCallback(async (signal?: AbortSignal) => {
        if (!api || !validId) return;
        const view = await loadCurrentHomeUserAccess(api, userId, signal);
        if (signal?.aborted) return;
        setCurrent(view);
        setError('');
    }, [api, userId, validId]);

    useEffect(() => {
        if (!api || !validId) return;
        // eslint-disable-next-line compat/compat
        const controller = new AbortController();
        void refresh(controller.signal).catch(() => {
            if (!controller.signal.aborted) setError('Plugin access status is unavailable. Retry to inspect this account.');
        });
        return () => controller.abort();
    }, [api, refresh, validId]);

    useEffect(() => setPolicyConfirmed(false), [ current?.accessEpoch, current?.currentAccess, current?.intendedAccess, current?.operationId ]);

    const priorAttestedHold = current?.state === 'policy-attested' && current.held && !current.policyProven;
    const canReviewPrior = priorAttestedHold && !current.writeAllowed && current.currentAccess && current.intendedAccess
        && canonicalGuid(current.userId) === canonicalGuid(userId)
        && canonicalGuid(current.currentAccess.userId) === canonicalGuid(userId)
        && canonicalGuid(current.intendedAccess.userId) === canonicalGuid(userId);
    const priorAccessChanged = Boolean(canReviewPrior && !sameAccess(current.currentAccess!, current.intendedAccess!));

    const needsManualVerification = (current?.controlledCreated === true || current?.migrationRecoveryRestricted === true || current?.lateUnverified === true)
        && current?.state === 'unproven' && current.held && !current.policyProven
        && !current.operationId && canonicalGuid(current.userId) === canonicalGuid(userId);
    const needsLegacyReproof = needsManualVerification && current?.controlledCreated !== true;
    let manualVerificationDescription = 'This controlled-created account is not verified for Home. Choose its intended policy explicitly before Plugin bootstrap.';
    if (needsLegacyReproof) manualVerificationDescription = 'The damaged verification record was reset. Choose a restrictive Member policy with selected libraries before controlled Plugin reproof.';
    if (current?.lateUnverified === true) manualVerificationDescription = 'This account appeared after the fixed migration cohort. Review its current Jellyfin access and choose a restrictive Member policy for controlled verification.';

    useEffect(() => {
        if (!api || !needsManualVerification) return;
        // eslint-disable-next-line compat/compat
        const controller = new AbortController();
        void loadAdminUserLibraries(api, controller.signal).then(items => {
            if (controller.signal.aborted) return;
            const byId = new Map<string, string>();
            for (const item of items) {
                const id = canonicalGuid(item.Id);
                if (id) byId.set(id, item.Name?.trim() || 'Unnamed library');
            }
            setFolders(Array.from(byId, ([ id, name ]) => ({ id, name })));
            setFolderError('');
        }).catch(() => {
            if (!controller.signal.aborted) setFolderError('Available libraries could not be loaded. Retry the account status before verification.');
        });
        return () => controller.abort();
    }, [api, needsManualVerification]);

    const verifySelected = useCallback(async () => {
        if (!api || !needsManualVerification || administrator === null || disabled === null
            || libraryMode === null || !folders || busyRef.current) return;
        if (needsLegacyReproof && (administrator || libraryMode !== 'selected')) return;
        if (current?.lateUnverified === true && (!current.currentAccess || !policyConfirmed)) return;
        if (selectedFolderIds.some(id => !folders.some(folder => folder.id === id))) return;
        const id = canonicalGuid(userId);
        if (!id) return;
        busyRef.current = true;
        setBusy(true);
        setError('');
        setPolicyConfirmed(false);
        try {
            const verified = await verifyUnprovenAdminUserAccess(api, id, {
                enableAllFolders: libraryMode === 'all',
                enabledFolders: libraryMode === 'all' ? [] : selectedFolderIds,
                isAdministrator: administrator,
                isDisabled: disabled,
                userId: id
            });
            setCurrent(verified);
            onVerified?.();
        } catch {
            setError('This account remains unverified. Refresh its Plugin status before another policy choice.');
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }, [administrator, api, current, disabled, folders, libraryMode, needsLegacyReproof, needsManualVerification, onVerified, policyConfirmed, selectedFolderIds, userId]);

    const perform = useCallback(async (supersede: boolean) => {
        if (!api || busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        setError('');
        try {
            if (supersede) await supersedeHeldAdminUserAccess(api, userId);
            else await retryExistingUserAccessCompletion(api, userId);
            await refresh();
            onVerified?.();
        } catch {
            setError('The account is still held. Review its current and intended access, then retry or correct the policy.');
            try {
                await refresh();
            } catch {
                // Keep the last known held operation visible for recovery.
            }
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }, [api, onVerified, refresh, userId]);

    const reverifyCurrent = useCallback(async () => {
        if (!api || !canReviewPrior || !policyConfirmed || busyRef.current) return;
        const reviewed = current.currentAccess!;
        busyRef.current = true;
        setBusy(true);
        setError('');
        setPolicyConfirmed(false);
        try {
            await reverifyPreviouslyAttestedUserAccess(api, userId, reviewed);
            await refresh();
            onVerified?.();
        } catch {
            try {
                await refresh();
            } catch {
                // Retain the last verified diagnostic for review.
            }
            setError('Current access was not re-verified. Review the latest Plugin and Jellyfin policy before retrying.');
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    }, [api, canReviewPrior, current, onVerified, policyConfirmed, refresh, userId]);

    if (!validId || !api || (!current && !error)) return null;
    if (current?.state === 'unproven' && !current.operationId && !needsManualVerification && !error) return null;
    if (!current?.held && !error) {
        return current?.policyProven ? (
            <p className='ptv-admin-user-status-message is-success' data-testid='ptv-admin-user-access-recovery'>Home access verified.</p>
        ) : null;
    }

    return (
        <aside className='ptv-admin-users-notice' data-testid='ptv-admin-user-access-recovery' role='status'>
            <div>
                {needsManualVerification && (
                    <>
                        <strong>Choose intended access</strong>
                        <p>{manualVerificationDescription}</p>
                        {current?.currentAccess && <p>Current Jellyfin access: {accessText(current.currentAccess)}</p>}
                        {current?.lateUnverified === true && !current.currentAccess && <p>Current Jellyfin access is unavailable. Refresh account status before verification.</p>}
                        <fieldset disabled={busy}>
                            <legend>Role</legend>
                            <label><input aria-label='Member' checked={administrator === false} onChange={() => {
                                setAdministrator(false);
                                setPolicyConfirmed(false);
                            }} type='radio' />Member</label>
                            <label><input aria-label='Administrator' checked={administrator === true} disabled={needsLegacyReproof} onChange={() => {
                                setAdministrator(true);
                                setPolicyConfirmed(false);
                            }} type='radio' />Administrator</label>
                        </fieldset>
                        <fieldset disabled={busy}>
                            <legend>Sign-in</legend>
                            <label><input aria-label='Enabled sign-in' checked={disabled === false} onChange={() => {
                                setDisabled(false);
                                setPolicyConfirmed(false);
                            }} type='radio' />Enabled</label>
                            <label><input aria-label='Disabled sign-in' checked={disabled === true} onChange={() => {
                                setDisabled(true);
                                setPolicyConfirmed(false);
                            }} type='radio' />Disabled</label>
                        </fieldset>
                        <fieldset disabled={busy || !folders}>
                            <legend>Libraries</legend>
                            <label><input aria-label='All libraries' checked={libraryMode === 'all'} disabled={needsLegacyReproof} onChange={() => {
                                setLibraryMode('all');
                                setPolicyConfirmed(false);
                            }} type='radio' />All libraries</label>
                            <label><input aria-label='Selected libraries' checked={libraryMode === 'selected'} onChange={() => {
                                setLibraryMode('selected');
                                setPolicyConfirmed(false);
                            }} type='radio' />Selected libraries</label>
                            {libraryMode === 'selected' && folders?.map(folder => (
                                <label key={folder.id}>
                                    <input
                                        aria-label={`Include ${folder.name}`}
                                        checked={selectedFolderIds.includes(folder.id)}
                                        onChange={() => toggleSelectedFolder(folder.id)}
                                        type='checkbox'
                                    />
                                    {folder.name}
                                </label>
                            ))}
                        </fieldset>
                        {folderError && <p>{folderError}</p>}
                        {current?.lateUnverified === true && current.currentAccess && (
                            <label>
                                <input
                                    aria-label='Confirm late account policy'
                                    checked={policyConfirmed}
                                    disabled={busy}
                                    onChange={event => setPolicyConfirmed(event.currentTarget.checked)}
                                    type='checkbox'
                                />
                                I reviewed current Jellyfin access and confirm the selected restrictive Member policy is intended.
                            </label>
                        )}
                        <button disabled={busy || administrator === null || disabled === null || libraryMode === null || !folders || (needsLegacyReproof && (administrator || libraryMode !== 'selected')) || (current?.lateUnverified === true && (!current.currentAccess || !policyConfirmed))} onClick={() => void verifySelected()} type='button'>Verify intended access</button>
                    </>
                )}
                {!needsManualVerification && (
                    <>
                        <strong>Home access verification {current?.held ? 'held' : 'unavailable'}</strong>
                        {current && (
                            <>
                                <p>Plugin state: {current.state}. Operation: {current.operationId || 'Unavailable'}.</p>
                                <p>Current Jellyfin access: {accessText(current.currentAccess)}</p>
                                <p>{priorAttestedHold ? 'Previously verified access' : 'Intended access'}: {accessText(current.intendedAccess)}</p>
                                {priorAccessChanged && <p>Current Jellyfin policy differs from previously verified access. Confirm it only if the change is intended.</p>}
                            </>
                        )}
                        {error && <p aria-live='polite'>{error}</p>}
                        <button disabled={busy} onClick={() => void refresh().catch(() => setError('Plugin access status is unavailable.'))} type='button'>Refresh access status</button>
                        {current?.state === 'recovery-required' && (
                            <p>Open the Users page to repair the damaged verification record before re-verifying accounts.</p>
                        )}
                        {priorAttestedHold && canReviewPrior && (
                            <>
                                <label>
                                    <input
                                        aria-label='Confirm current policy as intended'
                                        checked={policyConfirmed}
                                        disabled={busy}
                                        onChange={event => setPolicyConfirmed(event.currentTarget.checked)}
                                        type='checkbox'
                                    />
                                    I reviewed the current Jellyfin policy and confirm it is intended for this account.
                                </label>
                                <button disabled={busy || !policyConfirmed} onClick={() => void reverifyCurrent()} type='button'>Re-verify current access</button>
                            </>
                        )}
                        {priorAttestedHold && !canReviewPrior && <p>Current policy cannot be reviewed yet. Refresh access status before re-verifying.</p>}
                        {current?.held && current.operationId && current.state !== 'recovery-required' && !priorAttestedHold && (
                            <>
                                <button disabled={busy} onClick={() => void perform(false)} type='button'>Recheck Plugin policy</button>
                                {current.currentAccess && current.intendedAccess && (
                                    <button disabled={busy} onClick={() => void perform(true)} type='button'>Retry intended access</button>
                                )}
                            </>
                        )}
                    </>
                )}
            </div>
        </aside>
    );
}

/* eslint-enable react/jsx-no-bind, no-void, sonarjs/cognitive-complexity */
