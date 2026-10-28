import type { Api } from '@jellyfin/sdk';
import React, { useEffect, useState } from 'react';

import type { HomeTransitionResponse } from '../../../../core/pluginApi';
import { loadAdminLibraryTransition, rebindAdminLibraryTransition, retryAdminLibraryTransitionConvergence, retryAdminLibraryTransitionGeneration } from './adminLibrariesService';

/* eslint-disable react/jsx-no-bind, no-void, no-nested-ternary, sonarjs/no-nested-conditional, sonarjs/no-nested-functions */

type Props = Readonly<{
    api?: Api;
    transition?: HomeTransitionResponse | null;
    transitionError?: boolean;
    onChanged?: () => void;
}>;

function convergenceMessage(response: HomeTransitionResponse, epoch: string) {
    if (!response.held && response.state === 'complete' && response.authority === 'bound'
        && response.affectedRuleIds.length === 0 && response.epoch === epoch) {
        return 'Home transition completed. Fresh Home verification is required before rows return.';
    }
    if (!response.held && response.state === 'complete' && response.authority === 'binding-required') {
        return 'Jellyfin convergence was verified. Affected Home rules still need binding.';
    }
    return 'Jellyfin convergence is still unverified. Home rows remain unavailable.';
}

function canRetryConvergence(current: HomeTransitionResponse | null | undefined) {
    return Boolean(typeof current?.operationId === 'string' && current.operationId.trim() && current.held === true
        && (current.state === 'pending' || current.state === 'failed') && current.authority === 'unresolved'
        && current.writeAllowed === false && /^[a-fA-F0-9]{64}$/.test(current.epoch) && Array.isArray(current.affectedRuleIds));
}

export default function PtvHomeTransitionRebind({ api, transition, transitionError, onChanged }: Props) {
    const [ current, setCurrent ] = useState(transition);
    const [ selectedRules, setSelectedRules ] = useState<string[]>([]);
    const [ selectedFolder, setSelectedFolder ] = useState('');
    const [ busy, setBusy ] = useState(false);
    const [ message, setMessage ] = useState('');

    useEffect(() => {
        setCurrent(transition);
        setSelectedRules([]);
        setSelectedFolder('');
    }, [transition]);

    const affected = Array.isArray(current?.affectedRuleIds) ? current.affectedRuleIds : [];
    const pendingBinding = Boolean(current?.operationId && affected.length > 0 && current.authority !== 'bound');
    const generationPending = Boolean(current?.operationId && current.state === 'complete' && !current.held
        && current.authority === 'generation-pending' && affected.length === 0);
    const convergenceRetryAvailable = canRetryConvergence(current);
    if (!current?.held && !pendingBinding && !generationPending && !transitionError && !message) return null;

    const folderId = current?.authority === 'binding-required' ? current.library?.ItemId : null;
    const verifiedFolder = current && pendingBinding && (current.held || current.state === 'complete')
        && /^[a-fA-F0-9]{64}$/.test(current.epoch)
        && typeof folderId === 'string' && /^[a-fA-F0-9]{32}$/.test(folderId) ? folderId : null;
    const canSubmit = Boolean(api && current?.operationId && verifiedFolder && selectedFolder === verifiedFolder
        && affected.length > 0 && new Set(affected).size === affected.length
        && selectedRules.length === affected.length && affected.every(ruleId => selectedRules.includes(ruleId)));

    const refresh = async () => {
        if (!api || busy) return;
        setBusy(true);
        setMessage('');
        try {
            setCurrent(await loadAdminLibraryTransition(api));
            setSelectedRules([]);
            setSelectedFolder('');
        } catch {
            setMessage('Current transition state could not be verified. Home rows remain unavailable.');
        } finally { setBusy(false); }
    };
    const submit = async () => {
        if (!api || !current || !verifiedFolder || !canSubmit || busy) return;
        setBusy(true);
        setMessage('');
        try {
            const response = await rebindAdminLibraryTransition(api, current,
                affected.map(ruleId => ({ ruleId, libraryId: verifiedFolder })));
            setCurrent(response);
            setSelectedRules([]);
            setSelectedFolder('');
            setMessage(!response.held && response.state === 'complete' && response.authority === 'bound'
                && (response.epoch !== current.epoch || (!current.held && current.state === 'complete')) ?
                'Home transition completed. Fresh Home verification is required before rows return.' :
                'Affected Home rules still need binding. Check the current state before trying again.');
            onChanged?.();
        } catch {
            setMessage('The binding could not be verified. Home rows remain unavailable.');
        } finally { setBusy(false); }
    };
    const retryGeneration = async () => {
        if (!api || !current || !generationPending || busy) return;
        setBusy(true);
        setMessage('');
        try {
            const response = await retryAdminLibraryTransitionGeneration(api, current);
            setCurrent(response);
            setMessage(!response.held && response.state === 'complete' && response.authority === 'bound'
                && response.epoch === current.epoch ?
                'Home transition completed. Fresh Home verification is required before rows return.' :
                'Home rows remain unavailable. Check the current state before trying again.');
            onChanged?.();
        } catch {
            setMessage('Home generation could not be verified. Home rows remain unavailable.');
        } finally { setBusy(false); }
    };
    const retryConvergence = async () => {
        if (!api || !current || !convergenceRetryAvailable || busy) return;
        setBusy(true);
        setMessage('');
        try {
            const response = await retryAdminLibraryTransitionConvergence(api, current);
            setCurrent(response);
            setSelectedRules([]);
            setSelectedFolder('');
            setMessage(convergenceMessage(response, current.epoch));
            onChanged?.();
        } catch {
            setMessage('Jellyfin convergence could not be verified. Home rows remain unavailable.');
        } finally { setBusy(false); }
    };

    return (
        <section aria-labelledby='ptv-home-transition-rebind-title' className='ptv-admin-library-section ptv-home-transition-rebind'>
            <header>
                <h2 id='ptv-home-transition-rebind-title'>Rebind Home rows</h2>
                <p>Choose each affected rule and the current server library. The Plugin verifies the binding before Home can use it.</p>
            </header>
            <div className='ptv-admin-library-section-body'>
                {current?.held && <p role='status'>Home library rows are held. Pending operation: {current.operationId || 'recovery required'}. Affected rules: {affected.join(', ') || 'none'}.</p>}
                {!current?.held && pendingBinding && <p role='status'>Affected Home rows still need binding. Operation: {current?.operationId}. Affected rules: {affected.join(', ')}.</p>}
                {generationPending && <p role='status'>Home generation is pending. Operation: {current?.operationId}. Home rows remain unavailable.</p>}
                {verifiedFolder && affected.length > 0 ? (
                    <fieldset disabled={busy}>
                        <legend>Affected Home rules</legend>
                        {affected.map(ruleId => (
                            <label key={ruleId}>
                                <input
                                    checked={selectedRules.includes(ruleId)}
                                    onChange={event => {
                                        const checked = event.currentTarget.checked;
                                        setSelectedRules(selected => checked ?
                                            [...selected, ruleId] : selected.filter(value => value !== ruleId));
                                    }}
                                    type='checkbox'
                                    value={ruleId}
                                />
                                {ruleId}
                            </label>
                        ))}
                        <fieldset>
                            <legend>Current CollectionFolder</legend>
                            <label>
                                <input
                                    checked={selectedFolder === verifiedFolder}
                                    onChange={() => setSelectedFolder(verifiedFolder)}
                                    type='radio'
                                    value={verifiedFolder}
                                />
                                {current?.library?.Name || 'Unnamed library'} · ID {verifiedFolder}
                            </label>
                        </fieldset>
                        <button className='is-primary' disabled={!canSubmit || busy} onClick={() => void submit()} type='button'>Confirm Home binding</button>
                    </fieldset>
                ) : current?.held || pendingBinding ? (
                    <p>Current library identity is not verified. A null, missing, or ambiguous folder cannot be rebound.</p>
                ) : null}
                {generationPending && <button disabled={!api || busy} onClick={() => void retryGeneration()} type='button'>Retry Home generation</button>}
                {convergenceRetryAvailable && <button disabled={!api || busy} onClick={() => void retryConvergence()} type='button'>Retry Jellyfin convergence</button>}
                {current?.held || pendingBinding || generationPending || transitionError ? <button disabled={!api || busy} onClick={() => void refresh()} type='button'>Check current state</button> : null}
                {message && <p aria-live='polite' className='ptv-admin-library-status-message'>{message}</p>}
            </div>
        </section>
    );
}

/* eslint-enable react/jsx-no-bind, no-void, no-nested-ternary, sonarjs/no-nested-conditional, sonarjs/no-nested-functions */
