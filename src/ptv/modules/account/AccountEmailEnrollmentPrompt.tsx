import React, { useCallback, useEffect, useState } from 'react';

import { getAccountErrorMessage } from './AccountApi';
import { requestPtvAccountEmail, usePtvAccountProfile } from './accountProfileStore';
import {
    markPtvAccountPromptShown,
    shouldOfferPtvAccountEmail,
    wasPtvAccountPromptShown
} from './accountPromptPolicy';

import './account.scss';

function validEmail(value: string) {
    const cleaned = value.trim();
    const at = cleaned.lastIndexOf('@');
    return at > 0
        && at < cleaned.length - 3
        && cleaned.slice(at + 1).includes('.')
        && !cleaned.split('').some(character => character.trim() === '');
}

export default function AccountEmailEnrollmentPrompt() {
    const account = usePtvAccountProfile();
    const [busy, setBusy] = useState(false);
    const [email, setEmail] = useState('');
    const [message, setMessage] = useState('');
    const [openIdentity, setOpenIdentity] = useState('');

    useEffect(() => {
        const eligible = account.status === 'ready' && shouldOfferPtvAccountEmail(account.profile);
        if (!eligible || !account.identityKey || wasPtvAccountPromptShown(account.identityKey)) return;
        markPtvAccountPromptShown(account.identityKey);
        setEmail(account.profile?.recoveryEmail || '');
        setMessage('');
        setOpenIdentity(account.identityKey);
    }, [account.identityKey, account.profile, account.status]);

    const open = Boolean(openIdentity && openIdentity === account.identityKey);
    const submit = useCallback(async (event: React.FormEvent) => {
        event.preventDefault();
        if (!validEmail(email)) {
            setMessage('Enter a valid email address.');
            return;
        }

        setBusy(true);
        setMessage('');
        try {
            const result = await requestPtvAccountEmail(email.trim());
            setMessage(result.message);
            if (result.ok) setOpenIdentity('');
        } catch (error) {
            setMessage(getAccountErrorMessage(error));
        } finally {
            setBusy(false);
        }
    }, [email]);

    const handleEmailChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setEmail(event.target.value);
    }, []);
    const handleDismiss = useCallback(() => setOpenIdentity(''), []);

    if (!open) return null;

    return (
        <div className='ptv-account-prompt-backdrop' role='presentation'>
            <section
                aria-describedby='ptv-account-prompt-description'
                aria-labelledby='ptv-account-prompt-title'
                aria-modal='true'
                className='ptv-account-prompt'
                role='dialog'
            >
                <span className='ptv-account-eyebrow'>Keep your account recoverable</span>
                <h2 id='ptv-account-prompt-title'>Add a verified email</h2>
                <p id='ptv-account-prompt-description'>
                    This is optional. PiggieTV will send a one-time link before adding the address to your profile.
                </p>
                <form onSubmit={submit}>
                    <label htmlFor='ptv-account-prompt-email'>Email address</label>
                    <input
                        autoComplete='email'
                        id='ptv-account-prompt-email'
                        onChange={handleEmailChange}
                        placeholder='you@example.com'
                        type='email'
                        value={email}
                    />
                    {message ? <p aria-live='polite' className='ptv-account-message'>{message}</p> : null}
                    <div className='ptv-account-actions'>
                        <button disabled={busy} type='submit'>{busy ? 'Sending…' : 'Send verification'}</button>
                        <button className='is-secondary' disabled={busy} onClick={handleDismiss} type='button'>Not now</button>
                    </div>
                </form>
                <a href='#/settings/profile' onClick={handleDismiss}>Open profile settings</a>
            </section>
        </div>
    );
}
