import React, { useCallback, useState } from 'react';

import {
    confirmPtvAccountPasswordReset,
    getAccountErrorMessage,
    requestPtvAccountPasswordReset
} from './AccountApi';

type PasswordResetStage = 'closed' | 'request' | 'confirm' | 'complete';
type PasswordResetMessageKind = 'error' | 'success' | 'info';

type PasswordResetCardProps = Readonly<{
    email?: string | null;
    emailVerified: boolean;
}>;

function validatePassword(password: string, confirmPassword: string) {
    if (!password) return 'Enter a new password.';
    if (password !== confirmPassword) return 'Passwords do not match.';
    if (password.length < 8) return 'Use at least 8 characters for the password.';
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Use at least one letter and one number in the password.';
    return '';
}

export default function PasswordResetCard({ email, emailVerified }: PasswordResetCardProps) {
    const [busy, setBusy] = useState(false);
    const [confirmPassword, setConfirmPassword] = useState('');
    const [message, setMessage] = useState('');
    const [messageKind, setMessageKind] = useState<PasswordResetMessageKind>('info');
    const [password, setPassword] = useState('');
    const [resetCode, setResetCode] = useState('');
    const [resetEmail, setResetEmail] = useState('');
    const [stage, setStage] = useState<PasswordResetStage>('closed');
    const resetAvailable = emailVerified && Boolean(email);

    const clearSecrets = useCallback(() => {
        setConfirmPassword('');
        setPassword('');
        setResetCode('');
    }, []);

    const openReset = useCallback(() => {
        if (!resetAvailable) return;
        clearSecrets();
        setMessage('');
        setStage('request');
    }, [clearSecrets, resetAvailable]);

    const closeReset = useCallback(() => {
        clearSecrets();
        setMessage('');
        setResetEmail('');
        setStage('closed');
    }, [clearSecrets]);

    const sendResetCode = useCallback(async () => {
        if (!email || !emailVerified || busy) return;
        setBusy(true);
        setMessage('');
        try {
            const result = await requestPtvAccountPasswordReset(email);
            setMessage(result.message);
            setMessageKind(result.ok ? 'success' : 'error');
            if (result.ok) {
                setResetEmail(email);
                setStage('confirm');
            }
        } catch (error) {
            setMessage(getAccountErrorMessage(error));
            setMessageKind('error');
        } finally {
            setBusy(false);
        }
    }, [busy, email, emailVerified]);

    const handleResetCodeChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setResetCode(event.target.value);
    }, []);
    const handlePasswordChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setPassword(event.target.value);
    }, []);
    const handleConfirmPasswordChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setConfirmPassword(event.target.value);
    }, []);

    const submitPasswordReset = useCallback(async (event: React.FormEvent) => {
        event.preventDefault();
        if (busy) return;
        const validationMessage = validatePassword(password, confirmPassword);
        if (validationMessage) {
            setMessage(validationMessage);
            setMessageKind('error');
            return;
        }
        if (!resetEmail || !resetCode.trim()) {
            setMessage('Enter the reset code from your email.');
            setMessageKind('error');
            return;
        }

        setBusy(true);
        setMessage('');
        try {
            const result = await confirmPtvAccountPasswordReset({
                code: resetCode.trim(),
                confirmPassword,
                email: resetEmail,
                password
            });
            setMessage(result.message);
            setMessageKind(result.ok ? 'success' : 'error');
            if (result.ok) {
                clearSecrets();
                setResetEmail('');
                setStage('complete');
            }
        } catch (error) {
            setMessage(getAccountErrorMessage(error));
            setMessageKind('error');
        } finally {
            setBusy(false);
        }
    }, [busy, clearSecrets, confirmPassword, password, resetCode, resetEmail]);

    return (
        <section className='ptv-account-card ptv-account-password-card'>
            <div className='ptv-account-card-heading'>
                <div>
                    <span>Account security</span>
                    <h2>Password reset</h2>
                </div>
                <strong className={`ptv-account-status is-${resetAvailable ? 'verified' : 'missing'}`}>
                    {resetAvailable ? 'Email ready' : 'Email required'}
                </strong>
            </div>
            <p>Use your verified recovery email to receive a one-time code, then choose a new PiggieTV password.</p>

            {!resetAvailable ? (
                <p className='ptv-account-message'>Add and verify a recovery email before using password reset.</p>
            ) : null}

            {message ? <div aria-live='polite' className={`ptv-account-banner is-${messageKind}`}>{message}</div> : null}

            {stage === 'closed' && resetAvailable ? (
                <button onClick={openReset} type='button'>Reset password</button>
            ) : null}

            {stage === 'request' ? (
                <div className='ptv-account-password-step'>
                    <p>A reset code will be sent to your verified profile email. The code is single-use and expires automatically.</p>
                    <div className='ptv-account-actions'>
                        <button disabled={busy} onClick={sendResetCode} type='button'>{busy ? 'Sending...' : 'Send reset code'}</button>
                        <button className='is-secondary' disabled={busy} onClick={closeReset} type='button'>Cancel</button>
                    </div>
                </div>
            ) : null}

            {stage === 'confirm' ? (
                <form onSubmit={submitPasswordReset}>
                    <label htmlFor='ptv-account-reset-code'>Reset code</label>
                    <input
                        autoComplete='one-time-code'
                        id='ptv-account-reset-code'
                        inputMode='numeric'
                        onChange={handleResetCodeChange}
                        value={resetCode}
                    />
                    <label htmlFor='ptv-account-new-password'>New password</label>
                    <input
                        autoComplete='new-password'
                        id='ptv-account-new-password'
                        onChange={handlePasswordChange}
                        type='password'
                        value={password}
                    />
                    <label htmlFor='ptv-account-confirm-password'>Confirm new password</label>
                    <input
                        autoComplete='new-password'
                        id='ptv-account-confirm-password'
                        onChange={handleConfirmPasswordChange}
                        type='password'
                        value={confirmPassword}
                    />
                    <p className='ptv-account-message'>Use at least 8 characters with at least one letter and one number.</p>
                    <div className='ptv-account-actions'>
                        <button disabled={busy} type='submit'>{busy ? 'Resetting...' : 'Set new password'}</button>
                        <button className='is-secondary' disabled={busy} onClick={closeReset} type='button'>Cancel</button>
                    </div>
                </form>
            ) : null}

            {stage === 'complete' ? (
                <div className='ptv-account-password-step'>
                    <p>Your password has been updated. Use the new password the next time PiggieTV asks you to sign in.</p>
                    <button className='is-secondary' onClick={closeReset} type='button'>Done</button>
                </div>
            ) : null}

            <p className='ptv-account-security-note'>PiggieTV never displays or sends your password by email.</p>
        </section>
    );
}
