/* eslint-disable @typescript-eslint/no-deprecated, compat/compat, no-nested-ternary, react/jsx-no-bind, sonarjs/cognitive-complexity, sonarjs/no-nested-conditional */
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React, { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import Page from 'components/Page';

import { PTV_ASSETS, PTV_BRANDING } from '../../core/config';
import { resolvePtvStaticAssetUrl } from '../../core/urlOrigins';

import {
    confirmSignupPasswordReset,
    createSignupUser,
    getSignupErrorMessage,
    requestSignupPasswordReset,
    verifySignupEmail
} from './SignupApi';

import './signup.scss';

type SignupMode = 'create' | 'reset-request' | 'reset-confirm' | 'verify';

function getSignupParams() {
    const hashQuery = window.location.hash.includes('?') ? window.location.hash.split('?').slice(1).join('?') : '';

    return new URLSearchParams(window.location.search || hashQuery);
}

function getInitialMode(): SignupMode {
    const params = getSignupParams();
    const mode = params.get('mode');

    if (params.get('verify')) {
        return 'verify';
    }

    return mode === 'reset' ? 'reset-request' : 'create';
}

function goToLogin() {
    window.location.replace(`${window.location.pathname}#/login`);
}

const SignupPage = () => {
    const [mode, setMode] = useState<SignupMode>(getInitialMode);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [email, setEmail] = useState('');
    const [resetCode, setResetCode] = useState('');
    const [message, setMessage] = useState('');
    const [messageSeverity, setMessageSeverity] = useState<'error' | 'info' | 'success'>('info');
    const [busy, setBusy] = useState(false);
    const [created, setCreated] = useState(false);
    const [awaitingVerification, setAwaitingVerification] = useState(false);
    const [verificationSucceeded, setVerificationSucceeded] = useState(false);
    const [redirectCountdown, setRedirectCountdown] = useState(10);
    const [verificationChecked, setVerificationChecked] = useState(false);
    const verificationToken = useMemo(() => getSignupParams().get('verify') || '', []);

    const showMessage = useCallback((severity: 'error' | 'info' | 'success', nextMessage: string) => {
        setMessageSeverity(severity);
        setMessage(nextMessage);
    }, []);

    const switchMode = useCallback((nextMode: SignupMode) => {
        setMode(nextMode);
        setMessage('');
        setCreated(false);
        setAwaitingVerification(false);
        setVerificationSucceeded(false);
        setRedirectCountdown(10);
    }, []);

    const submitSignup = useCallback((event: FormEvent) => {
        event.preventDefault();

        if (password !== confirmPassword) {
            showMessage('error', 'Passwords do not match.');
            return;
        }

        setBusy(true);
        createSignupUser({
            confirmPassword,
            email: email.trim(),
            password,
            username: username.trim()
        })
            .then(result => {
                if (!result.ok) {
                    showMessage('error', result.message);
                    return;
                }

                setCreated(Boolean(result.userId));
                setAwaitingVerification(!result.userId);
                setPassword('');
                setConfirmPassword('');
                showMessage('success', result.message);
            })
            .catch(error => showMessage('error', getSignupErrorMessage(error)))
            .finally(() => setBusy(false));
    }, [confirmPassword, email, password, showMessage, username]);

    useEffect(() => {
        if (mode !== 'verify' || verificationChecked) {
            return;
        }

        if (!verificationToken) {
            setVerificationChecked(true);
            showMessage('error', 'Verification link is missing a token.');
            return;
        }

        setBusy(true);
        setVerificationChecked(true);
        verifySignupEmail({ token: verificationToken })
            .then(result => {
                showMessage(result.ok ? 'success' : 'error', result.message);
                setCreated(result.ok);
                setVerificationSucceeded(result.ok);
                setRedirectCountdown(10);
            })
            .catch(error => showMessage('error', getSignupErrorMessage(error)))
            .finally(() => setBusy(false));
    }, [mode, showMessage, verificationChecked, verificationToken]);

    useEffect(() => {
        if (!verificationSucceeded) {
            return undefined;
        }

        const timer = window.setInterval(() => {
            setRedirectCountdown(previous => {
                if (previous <= 1) {
                    window.clearInterval(timer);
                    goToLogin();
                    return 0;
                }

                return previous - 1;
            });
        }, 1000);

        return () => window.clearInterval(timer);
    }, [verificationSucceeded]);

    const submitResetRequest = useCallback((event: FormEvent) => {
        event.preventDefault();
        setBusy(true);
        requestSignupPasswordReset({ email: email.trim() })
            .then(result => {
                showMessage(result.ok ? 'success' : 'error', result.message);

                if (result.ok) {
                    setMode('reset-confirm');
                }
            })
            .catch(error => showMessage('error', getSignupErrorMessage(error)))
            .finally(() => setBusy(false));
    }, [email, showMessage]);

    const submitResetConfirm = useCallback((event: FormEvent) => {
        event.preventDefault();

        if (password !== confirmPassword) {
            showMessage('error', 'Passwords do not match.');
            return;
        }

        setBusy(true);
        confirmSignupPasswordReset({
            code: resetCode.trim(),
            confirmPassword,
            email: email.trim(),
            password
        })
            .then(result => {
                showMessage(result.ok ? 'success' : 'error', result.message);

                if (result.ok) {
                    setPassword('');
                    setConfirmPassword('');
                    setResetCode('');
                    window.setTimeout(goToLogin, 900);
                }
            })
            .catch(error => showMessage('error', getSignupErrorMessage(error)))
            .finally(() => setBusy(false));
    }, [confirmPassword, email, password, resetCode, showMessage]);

    const title = mode === 'create' ? 'Join PiggieTV' : mode === 'verify' ? 'Verify Email' : 'Reset Password';
    const subtitle = mode === 'create' ?
        'Create your Jellyfin account with your email.' :
        mode === 'verify' ?
            'Finalizing your PiggieTV account.' :
            'Use the code sent to your email to reset your password.';

    return (
        <Page
            id='ptvNativeSignupPage'
            title='PiggieTV Signup'
            className='mainAnimatedPage type-interior ptv-native-signup-page'
        >
            <Box
                className='ptv-native-signup-backdrop'
                style={{
                    backgroundImage: `linear-gradient(105deg, rgba(6, 4, 14, 0.96), rgba(17, 7, 31, 0.78)), url("${resolvePtvStaticAssetUrl(PTV_ASSETS.backgrounds.login)}")`
                }}
            />
            <Box className='ptv-native-signup-content'>
                <Box className='ptv-native-signup-card'>
                    <Stack spacing={2.25}>
                        <Box>
                            <img
                                className='ptv-native-signup-logo'
                                src={resolvePtvStaticAssetUrl(PTV_ASSETS.logos.bannerLight)}
                                alt={PTV_BRANDING.appName}
                                width='226'
                                height='58'
                            />
                            <Typography variant='h1'>{title}</Typography>
                            <Typography className='ptv-native-signup-subtitle'>
                                {subtitle}
                            </Typography>
                        </Box>

                        {message ? <Alert severity={messageSeverity}>{message}</Alert> : null}

                        {created && !verificationSucceeded ? (
                            <Stack direction='row' spacing={1.5} flexWrap='wrap' useFlexGap>
                                <Button href='#/login' variant='contained'>Sign In</Button>
                                <Button href='#/home' variant='outlined'>Back Home</Button>
                            </Stack>
                        ) : null}

                        {!created && mode === 'verify' ? (
                            <Stack spacing={1.5}>
                                <Typography color='text.secondary'>
                                    {busy ? 'Checking your verification link...' : 'Verification could not be completed.'}
                                </Typography>
                                {!busy ? (
                                    <Button type='button' variant='outlined' onClick={() => switchMode('create')}>
                                        Back to signup
                                    </Button>
                                ) : null}
                            </Stack>
                        ) : null}

                        {verificationSucceeded && mode === 'verify' ? (
                            <Box className='ptv-native-signup-success'>
                                <Stack spacing={1.5} alignItems='center'>
                                    <Typography variant='h2'>Verification successful</Typography>
                                    <Typography color='text.secondary' textAlign='center'>
                                        Verification successful. You will be redirected to the login page in {redirectCountdown} seconds.
                                    </Typography>
                                    <Box className='ptv-native-signup-countdown' aria-label={`Redirecting in ${redirectCountdown} seconds`}>
                                        {redirectCountdown}
                                    </Box>
                                    <Button href='#/login' variant='contained'>
                                        Go to Login Now
                                    </Button>
                                </Stack>
                            </Box>
                        ) : null}

                        {awaitingVerification && mode === 'create' ? (
                            <Stack spacing={1.5}>
                                <Typography color='text.secondary'>
                                    Open the verification link in your email to finish creating the account.
                                </Typography>
                                <Button type='button' variant='outlined' onClick={() => setAwaitingVerification(false)}>
                                    Edit signup details
                                </Button>
                            </Stack>
                        ) : null}

                        {!created && !awaitingVerification && mode === 'create' ? (
                            <Box component='form' onSubmit={submitSignup}>
                                <Stack spacing={1.5}>
                                    <TextField
                                        label='Email'
                                        value={email}
                                        onChange={event => setEmail(event.target.value)}
                                        autoComplete='email'
                                        type='email'
                                        fullWidth
                                        required
                                    />
                                    <TextField
                                        label='Username'
                                        value={username}
                                        onChange={event => setUsername(event.target.value)}
                                        autoComplete='username'
                                        fullWidth
                                        required
                                    />
                                    <TextField
                                        label='Password'
                                        value={password}
                                        onChange={event => setPassword(event.target.value)}
                                        autoComplete='new-password'
                                        type='password'
                                        fullWidth
                                        required
                                    />
                                    <TextField
                                        label='Confirm password'
                                        value={confirmPassword}
                                        onChange={event => setConfirmPassword(event.target.value)}
                                        autoComplete='new-password'
                                        type='password'
                                        fullWidth
                                        required
                                    />
                                    <Button type='submit' variant='contained' disabled={busy}>
                                        {busy ? 'Creating...' : 'Create Account'}
                                    </Button>
                                    <Button type='button' variant='text' onClick={() => switchMode('reset-request')} disabled={busy}>
                                        Forgot password?
                                    </Button>
                                </Stack>
                            </Box>
                        ) : null}

                        {mode === 'reset-request' ? (
                            <Box component='form' onSubmit={submitResetRequest}>
                                <Stack spacing={1.5}>
                                    <TextField
                                        label='Email'
                                        value={email}
                                        onChange={event => setEmail(event.target.value)}
                                        autoComplete='email'
                                        type='email'
                                        fullWidth
                                        required
                                    />
                                    <Button type='submit' variant='contained' disabled={busy}>
                                        {busy ? 'Sending...' : 'Send Reset Code'}
                                    </Button>
                                    <Button type='button' variant='text' onClick={() => switchMode('create')} disabled={busy}>
                                        Back to signup
                                    </Button>
                                </Stack>
                            </Box>
                        ) : null}

                        {mode === 'reset-confirm' ? (
                            <Box component='form' onSubmit={submitResetConfirm}>
                                <Stack spacing={1.5}>
                                    <TextField
                                        label='Email'
                                        value={email}
                                        onChange={event => setEmail(event.target.value)}
                                        autoComplete='email'
                                        type='email'
                                        fullWidth
                                        required
                                    />
                                    <TextField
                                        label='Reset code'
                                        value={resetCode}
                                        onChange={event => setResetCode(event.target.value)}
                                        inputProps={{ inputMode: 'numeric' }}
                                        fullWidth
                                        required
                                    />
                                    <TextField
                                        label='New password'
                                        value={password}
                                        onChange={event => setPassword(event.target.value)}
                                        autoComplete='new-password'
                                        type='password'
                                        fullWidth
                                        required
                                    />
                                    <TextField
                                        label='Confirm new password'
                                        value={confirmPassword}
                                        onChange={event => setConfirmPassword(event.target.value)}
                                        autoComplete='new-password'
                                        type='password'
                                        fullWidth
                                        required
                                    />
                                    <Button type='submit' variant='contained' disabled={busy}>
                                        {busy ? 'Resetting...' : 'Reset Password'}
                                    </Button>
                                    <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap>
                                        <Button type='button' variant='text' onClick={() => switchMode('reset-request')} disabled={busy}>
                                            Send another code
                                        </Button>
                                        <Button type='button' variant='text' onClick={() => switchMode('create')} disabled={busy}>
                                            Back to signup
                                        </Button>
                                    </Stack>
                                </Stack>
                            </Box>
                        ) : null}
                    </Stack>
                </Box>
            </Box>
        </Page>
    );
};

SignupPage.displayName = 'SignupPage';

export default SignupPage;

/* eslint-enable @typescript-eslint/no-deprecated, compat/compat, no-nested-ternary, react/jsx-no-bind, sonarjs/cognitive-complexity, sonarjs/no-nested-conditional */
