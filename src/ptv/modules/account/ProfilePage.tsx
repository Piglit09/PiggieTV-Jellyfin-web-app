import React, { useCallback, useEffect, useRef, useState } from 'react';

import Page from 'components/Page';

import {
    getAccountErrorMessage,
    verifyPtvAccountEmail,
    type PtvAccountProfile
} from './AccountApi';
import {
    cancelPtvAccountEmail,
    refreshPtvAccountProfile,
    requestPtvAccountEmail,
    resendPtvAccountEmail,
    startPtvAccountProfileService,
    usePtvAccountProfile
} from './accountProfileStore';
import PasswordResetCard from './PasswordResetCard';

import './account.scss';

type AccountMessageKind = 'error' | 'success' | 'info';

function getVerificationToken() {
    const query = window.location.hash.split('?')[1] || '';
    for (const part of query.split('&')) {
        const separator = part.indexOf('=');
        const key = separator < 0 ? part : part.slice(0, separator);
        try {
            if (decodeURIComponent(key) !== 'verify') continue;
        } catch {
            continue;
        }
        const value = separator < 0 ? '' : part.slice(separator + 1).split('+').join(' ');
        try {
            return decodeURIComponent(value).trim();
        } catch {
            return '';
        }
    }
    return '';
}

function formatTimestamp(value?: string | null) {
    if (!value) return 'Not available';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString();
}

function validEmail(value: string) {
    const cleaned = value.trim();
    const at = cleaned.lastIndexOf('@');
    return at > 0
        && at < cleaned.length - 3
        && cleaned.slice(at + 1).includes('.')
        && !cleaned.split('').some(character => character.trim() === '');
}

function getEmailStatus(profile: PtvAccountProfile) {
    if (profile.emailVerified) return 'Verified';
    if (profile.pendingEmail) return 'Pending verification';
    return 'Not added';
}

function useVerificationLink(
    setBusy: React.Dispatch<React.SetStateAction<boolean>>,
    setMessage: React.Dispatch<React.SetStateAction<string>>,
    setMessageKind: React.Dispatch<React.SetStateAction<AccountMessageKind>>
) {
    const verificationAttempted = useRef(false);
    useEffect(() => {
        const token = getVerificationToken();
        if (!token || verificationAttempted.current) return;
        verificationAttempted.current = true;
        window.history.replaceState(window.history.state, document.title, `${window.location.pathname}${window.location.search}#/settings/profile`);
        setBusy(true);
        verifyPtvAccountEmail(token)
            .then(result => {
                setMessage(result.message);
                setMessageKind(result.ok ? 'success' : 'error');
                return refreshPtvAccountProfile();
            })
            .catch(error => {
                setMessage(getAccountErrorMessage(error));
                setMessageKind('error');
            })
            .finally(() => setBusy(false));
    }, [setBusy, setMessage, setMessageKind]);
}

function useRecoveredEmail(profile: PtvAccountProfile | null, email: string, setEmail: React.Dispatch<React.SetStateAction<string>>) {
    useEffect(() => {
        const recoveryEmail = profile?.recoveryEmail;
        if (recoveryEmail && !email) setEmail(recoveryEmail);
    }, [email, profile?.recoveryEmail, setEmail]);
}

function useEmailSubmission(
    email: string,
    runOperation: (operation: () => Promise<{ message: string; ok: boolean }>) => Promise<void>,
    setMessage: React.Dispatch<React.SetStateAction<string>>,
    setMessageKind: React.Dispatch<React.SetStateAction<AccountMessageKind>>
) {
    return useCallback((event: React.FormEvent) => {
        event.preventDefault();
        if (!validEmail(email)) {
            setMessage('Enter a valid email address.');
            setMessageKind('error');
            return;
        }
        void runOperation(() => requestPtvAccountEmail(email.trim()));
    }, [email, runOperation, setMessage, setMessageKind]);
}

type ProfilePageProps = Readonly<{
    avatarUrl?: string;
    embedded?: boolean;
    isAdministrator?: boolean;
}>;

// eslint-disable-next-line sonarjs/cognitive-complexity -- Distinct loading, owner email, verification, and pending states share one page boundary.
export default function ProfilePage({ avatarUrl = '', embedded = false, isAdministrator = false }: ProfilePageProps) {
    const account = usePtvAccountProfile();
    const [busy, setBusy] = useState(false);
    const [email, setEmail] = useState('');
    const [message, setMessage] = useState('');
    const [messageKind, setMessageKind] = useState<AccountMessageKind>('info');

    useEffect(() => {
        startPtvAccountProfileService();
        void refreshPtvAccountProfile(false);
    }, []);

    useRecoveredEmail(account.profile, email, setEmail);

    useVerificationLink(setBusy, setMessage, setMessageKind);

    const runOperation = useCallback(async (operation: () => Promise<{ message: string; ok: boolean }>) => {
        setBusy(true);
        setMessage('');
        try {
            const result = await operation();
            setMessage(result.message);
            setMessageKind(result.ok ? 'success' : 'error');
        } catch (error) {
            setMessage(getAccountErrorMessage(error));
            setMessageKind('error');
        } finally {
            setBusy(false);
        }
    }, []);

    const submitEmail = useEmailSubmission(email, runOperation, setMessage, setMessageKind);

    const handleEmailChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setEmail(event.target.value);
    }, []);
    const handleResend = useCallback(() => {
        void runOperation(resendPtvAccountEmail);
    }, [runOperation]);
    const handleCancel = useCallback(() => {
        void runOperation(cancelPtvAccountEmail);
    }, [runOperation]);

    const profile = account.profile;
    const emailStatus = profile ? getEmailStatus(profile) : 'Not added';

    const content = (
        <main className={`ptv-account-profile${embedded ? ' is-embedded' : ''}`}>
            <header>
                <div className='ptv-account-profile-heading'>
                    <span aria-hidden='true' className='ptv-account-profile-avatar'>
                        {avatarUrl ? <img alt='' src={avatarUrl} /> : (profile?.username || 'P').charAt(0).toUpperCase()}
                    </span>
                    <div>
                        <span className='ptv-account-eyebrow'>PiggieTV account</span>
                        <h1>Profile</h1>
                        <p>Manage your identity, verified recovery email and password.</p>
                    </div>
                </div>
            </header>

            {message ? <div aria-live='polite' className={`ptv-account-banner is-${messageKind}`}>{message}</div> : null}
            {account.status === 'error' ? <div className='ptv-account-banner is-error'>{account.error}</div> : null}
            {account.status === 'loading' && !profile ? <div className='ptv-account-loading' role='status'>Loading profile…</div> : null}

            {profile ? (
                <div className='ptv-account-profile-grid'>
                    <section className='ptv-account-card'>
                        <div className='ptv-account-card-heading'>
                            <div>
                                <span>Signed in as</span>
                                <h2>{profile.username}</h2>
                            </div>
                            <strong className={`ptv-account-status is-${profile.emailVerified ? 'verified' : 'missing'}`}>{emailStatus}</strong>
                        </div>
                        <dl>
                            <div><dt>Verified email</dt><dd>{profile.email || 'None'}</dd></div>
                            <div><dt>Verified</dt><dd>{formatTimestamp(profile.emailVerifiedAt)}</dd></div>
                            <div><dt>Role</dt><dd>{isAdministrator ? 'Administrator' : 'Member'}</dd></div>
                        </dl>
                    </section>

                    <section className='ptv-account-card'>
                        <h2>{profile.emailVerified ? 'Change verified email' : 'Add a recovery email'}</h2>
                        <p>The current verified email stays active until the new address completes verification.</p>
                        <form onSubmit={submitEmail}>
                            <label htmlFor='ptv-account-profile-email'>New email address</label>
                            <input
                                autoComplete='email'
                                id='ptv-account-profile-email'
                                onChange={handleEmailChange}
                                placeholder='you@example.com'
                                type='email'
                                value={email}
                            />
                            <button disabled={busy} type='submit'>{busy ? 'Working…' : 'Send verification'}</button>
                        </form>
                        {profile.recoveryEmail ? (
                            <p className='ptv-account-recovery-note'>Recovered mapping: {profile.recoveryEmail}. Verify it before it can be used.</p>
                        ) : null}
                    </section>

                    <PasswordResetCard
                        email={profile.email}
                        emailVerified={profile.emailVerified}
                    />

                    {profile.pendingEmail ? (
                        <section className='ptv-account-card ptv-account-pending-card'>
                            <div className='ptv-account-card-heading'>
                                <div><span>Pending address</span><h2>{profile.pendingEmail}</h2></div>
                                <strong className={`ptv-account-status is-${profile.pendingEmailStatus || 'pending'}`}>{profile.pendingEmailStatus || 'pending'}</strong>
                            </div>
                            <p>Expires {formatTimestamp(profile.pendingEmailExpiresAt)}. Verification links are single-use.</p>
                            <div className='ptv-account-actions'>
                                <button disabled={busy} onClick={handleResend} type='button'>Resend</button>
                                <button className='is-secondary' disabled={busy} onClick={handleCancel} type='button'>Cancel pending change</button>
                            </div>
                        </section>
                    ) : null}
                </div>
            ) : null}
        </main>
    );

    if (embedded) return content;

    return (
        <Page
            className='mainAnimatedPage noSecondaryNavPage ptv-account-profile-page'
            id='ptvAccountProfilePage'
            isBackButtonEnabled={false}
            isMenuButtonEnabled
            title='Profile'
        >
            {content}
        </Page>
    );
}
