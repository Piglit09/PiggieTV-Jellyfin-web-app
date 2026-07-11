/* eslint-disable @typescript-eslint/no-deprecated, react/jsx-no-bind, sonarjs/cognitive-complexity, sonarjs/no-hardcoded-passwords, sonarjs/slow-regex */
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid2';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import Page from 'components/Page';

import { getPtvMediaFolders } from '../../api';
import { getPtvDebugReport, registerPtvDebugSignupStatusProvider } from '../../core/observability';
import {
    getSignupErrorMessage,
    getSignupSettings,
    saveSignupSettings,
    sendSignupTestEmail,
    type PtvSignupAdminSettingsResponse,
    type PtvSignupEmailSettings,
    type PtvSignupPolicyPreset
} from './SignupApi';

import '../dashboard/dashboard.scss';
import './signup.scss';

type LibraryFolder = {
    Id?: string;
    Name?: string | null;
};

const DEFAULT_EMAIL_SETTINGS: PtvSignupEmailSettings = {
    enabled: false,
    fromAddress: '',
    fromName: 'PiggieTV',
    logoUrl: '/web/assets/logo/banner-light.png',
    passwordConfigured: false,
    resetCodeMinutes: 15,
    resetSubject: 'Your PiggieTV password reset code',
    smtpHost: '',
    smtpPort: 587,
    useSsl: true,
    username: '',
    verificationLinkMinutes: 30,
    verificationSubject: 'Verify your PiggieTV email'
};

const DEFAULT_ADMIN_STATE: PtvSignupAdminSettingsResponse = {
    defaultEnabledFolderIds: [],
    defaultPolicyPresetId: 'standard',
    emailSettings: DEFAULT_EMAIL_SETTINGS,
    enabled: true,
    ok: true,
    pendingResetCount: 0,
    pendingVerificationCount: 0,
    policyPresets: [],
    users: []
};

function formatDate(value?: string | null) {
    if (!value) return 'Never';

    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(new Date(value));
}

function getPresetName(presets: PtvSignupPolicyPreset[], presetId: string) {
    return presets.find(preset => preset.id === presetId)?.name || presetId;
}

function isValidEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function getEmailDomain(value?: string | null) {
    if (!value) return null;

    const atIndex = value.lastIndexOf('@');

    return atIndex >= 0 && atIndex < value.length - 1 ? value.slice(atIndex + 1).toLowerCase() : null;
}

function getSignupDebugStatus(state: PtvSignupAdminSettingsResponse) {
    const email = state.emailSettings;
    const users = state.users || [];
    const mappedUsers = users.filter(user => user.emailConfigured || Boolean(user.email?.trim()));
    const nativeUsers = users.filter(user => user.source === 'ptv');

    return {
        defaultEnabledFolderCount: state.defaultEnabledFolderIds.length,
        defaultPolicyPresetId: state.defaultPolicyPresetId,
        email: {
            configured: Boolean(email.smtpHost && email.fromAddress && email.passwordConfigured),
            enabled: email.enabled,
            fromAddressConfigured: Boolean(email.fromAddress),
            fromDomain: getEmailDomain(email.fromAddress),
            logoUrlConfigured: Boolean(email.logoUrl),
            resetCodeMinutes: email.resetCodeMinutes,
            smtpHostConfigured: Boolean(email.smtpHost),
            smtpPasswordConfigured: email.passwordConfigured,
            smtpPort: email.smtpPort,
            smtpUsernameConfigured: Boolean(email.username),
            useSsl: email.useSsl,
            verificationLinkMinutes: email.verificationLinkMinutes
        },
        emailRequired: true,
        enabled: state.enabled,
        jellyfinUserCount: users.length,
        lastNativeUserCreatedAtUtc: nativeUsers.length ?
            nativeUsers.reduce((latest, user) => user.createdAtUtc > latest ? user.createdAtUtc : latest, nativeUsers[0].createdAtUtc) :
            null,
        mappedResetUserCount: mappedUsers.length,
        nativeUserCount: nativeUsers.length,
        pendingResetCount: state.pendingResetCount,
        pendingVerificationCount: state.pendingVerificationCount,
        policyPresetCount: state.policyPresets.length,
        routes: {
            adminSettings: '/Ptv/v1/signup/admin/settings',
            adminTestEmail: '/Ptv/v1/signup/admin/email/test',
            createUser: '/Ptv/v1/signup/create-user',
            passwordResetConfirm: '/Ptv/v1/signup/password-reset/confirm',
            passwordResetRequest: '/Ptv/v1/signup/password-reset/request',
            verifyEmail: '/Ptv/v1/signup/verify-email'
        }
    };
}

async function copyTextToClipboard(text: string) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
}

const InviteAdminPage = () => {
    const [state, setState] = useState<PtvSignupAdminSettingsResponse>(DEFAULT_ADMIN_STATE);
    const [libraries, setLibraries] = useState<LibraryFolder[]>([]);
    const [smtpPassword, setSmtpPassword] = useState('');
    const [testRecipient, setTestRecipient] = useState('');
    const [statusMessage, setStatusMessage] = useState('');
    const [statusSeverity, setStatusSeverity] = useState<'error' | 'info' | 'success'>('info');
    const [busy, setBusy] = useState(false);

    const selectedPreset = useMemo(
        () => state.policyPresets.find(preset => preset.id === state.defaultPolicyPresetId),
        [state.defaultPolicyPresetId, state.policyPresets]
    );
    const showLibraryPicker = Boolean(selectedPreset && !selectedPreset.enableAllFolders);
    const signupDebugStatus = useMemo(() => getSignupDebugStatus(state), [state]);
    const userEmailIssues = useMemo(() => {
        const issues = new Map<string, string>();
        const emailOwners = new Map<string, string>();

        state.users.forEach(user => {
            const email = user.email.trim();

            if (!email) {
                return;
            }

            if (!isValidEmail(email)) {
                issues.set(user.userId, 'Use a valid email address.');
                return;
            }

            const key = email.toLowerCase();
            const existingOwner = emailOwners.get(key);

            if (existingOwner) {
                issues.set(existingOwner, 'This email is assigned to more than one user.');
                issues.set(user.userId, 'This email is assigned to more than one user.');
                return;
            }

            emailOwners.set(key, user.userId);
        });

        return issues;
    }, [state.users]);
    const mappedUserCount = useMemo(
        () => state.users.filter(user => user.email.trim()).length,
        [state.users]
    );

    const showMessage = useCallback((severity: 'error' | 'info' | 'success', message: string) => {
        setStatusSeverity(severity);
        setStatusMessage(message);
    }, []);

    const loadSettings = useCallback(() => {
        setBusy(true);
        getSignupSettings()
            .then(response => {
                setState({
                    ...response,
                    emailSettings: {
                        ...DEFAULT_EMAIL_SETTINGS,
                        ...response.emailSettings
                    }
                });
                setSmtpPassword('');
            })
            .catch(error => showMessage('error', getSignupErrorMessage(error)))
            .finally(() => setBusy(false));
    }, [showMessage]);

    useEffect(() => {
        loadSettings();
    }, [loadSettings]);

    useEffect(() => {
        registerPtvDebugSignupStatusProvider(() => signupDebugStatus);

        return () => registerPtvDebugSignupStatusProvider(null);
    }, [signupDebugStatus]);

    useEffect(() => {
        getPtvMediaFolders()
            .then(result => setLibraries(result.Items || []))
            .catch(() => setLibraries([]));
    }, []);

    const patchState = useCallback((patch: Partial<PtvSignupAdminSettingsResponse>) => {
        setState(previous => ({
            ...previous,
            ...patch
        }));
    }, []);

    const patchEmail = useCallback((patch: Partial<PtvSignupEmailSettings>) => {
        setState(previous => ({
            ...previous,
            emailSettings: {
                ...previous.emailSettings,
                ...patch
            }
        }));
    }, []);

    const toggleLibrary = useCallback((libraryId: string) => {
        setState(previous => ({
            ...previous,
            defaultEnabledFolderIds: previous.defaultEnabledFolderIds.includes(libraryId) ?
                previous.defaultEnabledFolderIds.filter(id => id !== libraryId) :
                [...previous.defaultEnabledFolderIds, libraryId]
        }));
    }, []);

    const patchUserEmail = useCallback((userId: string, email: string) => {
        setState(previous => ({
            ...previous,
            users: previous.users.map(user => user.userId === userId ?
                {
                    ...user,
                    email,
                    emailConfigured: Boolean(email.trim())
                } :
                user)
        }));
    }, []);

    const saveSettings = useCallback(() => {
        if (userEmailIssues.size > 0) {
            showMessage('error', 'Fix the user email mappings before saving.');
            return;
        }

        setBusy(true);
        saveSignupSettings({
            defaultEnabledFolderIds: showLibraryPicker ? state.defaultEnabledFolderIds : [],
            defaultPolicyPresetId: state.defaultPolicyPresetId,
            emailSettings: {
                ...state.emailSettings,
                password: smtpPassword || null
            },
            enabled: state.enabled,
            users: state.users.map(user => ({
                email: user.email.trim(),
                userId: user.userId
            }))
        })
            .then(response => {
                setState({
                    ...response,
                    emailSettings: {
                        ...DEFAULT_EMAIL_SETTINGS,
                        ...response.emailSettings
                    }
                });
                setSmtpPassword('');
                showMessage('success', 'Signup settings saved.');
            })
            .catch(error => showMessage('error', getSignupErrorMessage(error)))
            .finally(() => setBusy(false));
    }, [showLibraryPicker, showMessage, smtpPassword, state.defaultEnabledFolderIds, state.defaultPolicyPresetId, state.emailSettings, state.enabled, state.users, userEmailIssues]);

    const testEmail = useCallback(() => {
        if (testRecipient.trim() && !isValidEmail(testRecipient)) {
            showMessage('error', 'Enter a valid test recipient email address.');
            return;
        }

        setBusy(true);
        sendSignupTestEmail({ recipient: testRecipient.trim() || undefined })
            .then(result => showMessage(result.ok ? 'success' : 'error', result.message))
            .catch(error => showMessage('error', getSignupErrorMessage(error)))
            .finally(() => setBusy(false));
    }, [showMessage, testRecipient]);

    const copySignupDebug = useCallback(() => {
        copyTextToClipboard(JSON.stringify({
            debugReport: getPtvDebugReport(),
            signup: signupDebugStatus,
            timestamp: new Date().toISOString()
        }, null, 2))
            .then(() => showMessage('success', 'Signup debug copied.'))
            .catch(error => showMessage('error', `Signup debug copy failed: ${getSignupErrorMessage(error)}`));
    }, [showMessage, signupDebugStatus]);

    return (
        <Page
            id='ptvSignupInvitesPage'
            title='Signup / Invites'
            className='mainAnimatedPage type-interior ptv-dashboard-control-page ptv-signup-invites-page'
        >
            <Box className='content-primary ptv-dashboard-control-content ptv-signup-invites-content'>
                <Stack spacing={2}>
                    <Box>
                        <Typography variant='h1'>Signup / Invites</Typography>
                        <Typography variant='body1' color='text.secondary'>
                            Native PiggieTV account signup, email delivery, and password reset settings.
                        </Typography>
                    </Box>

                    {statusMessage ? <Alert severity={statusSeverity}>{statusMessage}</Alert> : null}

                    <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap>
                        <Chip
                            className={`ptv-status-badge ${state.enabled ? 'ptv-status-badge-success' : ''}`}
                            label={state.enabled ? 'Signup enabled' : 'Signup disabled'}
                            size='small'
                        />
                        <Chip
                            className={`ptv-status-badge ${state.emailSettings.passwordConfigured ? 'ptv-status-badge-success' : 'ptv-status-badge-info'}`}
                            label={state.emailSettings.passwordConfigured ? 'SMTP password configured' : 'SMTP password missing'}
                            size='small'
                        />
                        <Chip
                            className='ptv-status-badge ptv-status-badge-info'
                            label={`${state.pendingResetCount} pending reset codes`}
                            size='small'
                        />
                        <Chip
                            className='ptv-status-badge ptv-status-badge-info'
                            label={`${state.pendingVerificationCount} pending verifications`}
                            size='small'
                        />
                        <Chip
                            className={`ptv-status-badge ${mappedUserCount ? 'ptv-status-badge-success' : 'ptv-status-badge-info'}`}
                            label={`${mappedUserCount}/${state.users.length} reset emails mapped`}
                            size='small'
                        />
                        <Button type='button' variant='outlined' size='small' onClick={copySignupDebug}>
                            Copy Signup Debug
                        </Button>
                    </Stack>

                    <Grid container spacing={2}>
                        <Grid size={{ xs: 12, lg: 5 }}>
                            <Card className='ptv-dashboard-card ptv-control-card'>
                                <CardContent>
                                    <Stack spacing={1.5}>
                                        <Stack direction='row' justifyContent='space-between' alignItems='center'>
                                            <Typography variant='h2'>Signup Defaults</Typography>
                                            <Chip className='ptv-status-badge ptv-status-badge-info' label='native PTV' size='small' />
                                        </Stack>
                                        <Divider />
                                        <FormControlLabel
                                            control={<Checkbox checked={state.enabled} onChange={event => patchState({ enabled: event.target.checked })} />}
                                            label='Enable native signup'
                                        />
                                        <TextField label='User policy preset' select value={state.defaultPolicyPresetId} onChange={event => patchState({ defaultPolicyPresetId: event.target.value })} fullWidth>
                                            {state.policyPresets.map(preset => (
                                                <MenuItem key={preset.id} value={preset.id}>{preset.name}</MenuItem>
                                            ))}
                                        </TextField>

                                        {showLibraryPicker ? (
                                            <Box className='ptv-signup-library-picker'>
                                                <Typography variant='h3'>Library access</Typography>
                                                {libraries.length === 0 ? (
                                                    <Typography color='text.secondary'>No library list available. The preset will decide access.</Typography>
                                                ) : libraries.map(library => library.Id ? (
                                                    <FormControlLabel
                                                        key={library.Id}
                                                        control={<Checkbox checked={state.defaultEnabledFolderIds.includes(library.Id)} onChange={() => toggleLibrary(library.Id!)} />}
                                                        label={library.Name || library.Id}
                                                    />
                                                ) : null)}
                                            </Box>
                                        ) : null}

                                        <Button type='button' variant='contained' onClick={saveSettings} disabled={busy}>
                                            {busy ? 'Saving...' : 'Save Signup Settings'}
                                        </Button>
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid size={{ xs: 12, lg: 7 }}>
                            <Card className='ptv-dashboard-card ptv-control-card'>
                                <CardContent>
                                    <Stack spacing={1.5}>
                                        <Stack direction='row' justifyContent='space-between' alignItems='center'>
                                            <Typography variant='h2'>Email Engine</Typography>
                                            <Chip className='ptv-status-badge ptv-status-badge-info' label='SMTP' size='small' />
                                        </Stack>
                                        <Divider />
                                        <FormControlLabel
                                            control={<Checkbox checked={state.emailSettings.enabled} onChange={event => patchEmail({ enabled: event.target.checked })} />}
                                            label='Enable signup verification and password reset emails'
                                        />
                                        <Grid container spacing={1.25}>
                                            <Grid size={{ xs: 12, md: 8 }}>
                                                <TextField label='SMTP host' value={state.emailSettings.smtpHost} onChange={event => patchEmail({ smtpHost: event.target.value })} fullWidth />
                                            </Grid>
                                            <Grid size={{ xs: 12, md: 4 }}>
                                                <TextField label='SMTP port' type='number' value={state.emailSettings.smtpPort} onChange={event => patchEmail({ smtpPort: Number(event.target.value) })} fullWidth inputProps={{ min: 1, max: 65535 }} />
                                            </Grid>
                                            <Grid size={{ xs: 12, md: 6 }}>
                                                <TextField label='SMTP username' value={state.emailSettings.username || ''} onChange={event => patchEmail({ username: event.target.value })} fullWidth />
                                            </Grid>
                                            <Grid size={{ xs: 12, md: 6 }}>
                                                <TextField
                                                    label={state.emailSettings.passwordConfigured ? 'SMTP password (configured)' : 'SMTP password'}
                                                    value={smtpPassword}
                                                    onChange={event => setSmtpPassword(event.target.value)}
                                                    type='password'
                                                    fullWidth
                                                    placeholder={state.emailSettings.passwordConfigured ? 'Leave blank to keep existing password' : ''}
                                                />
                                            </Grid>
                                            <Grid size={{ xs: 12, md: 6 }}>
                                                <TextField label='From address' type='email' value={state.emailSettings.fromAddress} onChange={event => patchEmail({ fromAddress: event.target.value })} fullWidth />
                                            </Grid>
                                            <Grid size={{ xs: 12, md: 6 }}>
                                                <TextField label='From name' value={state.emailSettings.fromName} onChange={event => patchEmail({ fromName: event.target.value })} fullWidth />
                                            </Grid>
                                            <Grid size={{ xs: 12 }}>
                                                <TextField
                                                    label='Verification email logo URL'
                                                    value={state.emailSettings.logoUrl}
                                                    onChange={event => patchEmail({ logoUrl: event.target.value })}
                                                    fullWidth
                                                    helperText='Leave as the default PiggieTV logo, or use a public HTTPS image URL.'
                                                />
                                            </Grid>
                                            <Grid size={{ xs: 12, md: 8 }}>
                                                <TextField label='Reset email subject' value={state.emailSettings.resetSubject} onChange={event => patchEmail({ resetSubject: event.target.value })} fullWidth />
                                            </Grid>
                                            <Grid size={{ xs: 12, md: 4 }}>
                                                <TextField label='Code expires minutes' type='number' value={state.emailSettings.resetCodeMinutes} onChange={event => patchEmail({ resetCodeMinutes: Number(event.target.value) })} fullWidth inputProps={{ min: 5, max: 120 }} />
                                            </Grid>
                                            <Grid size={{ xs: 12, md: 8 }}>
                                                <TextField label='Verification email subject' value={state.emailSettings.verificationSubject} onChange={event => patchEmail({ verificationSubject: event.target.value })} fullWidth />
                                            </Grid>
                                            <Grid size={{ xs: 12, md: 4 }}>
                                                <TextField label='Verify link expires minutes' type='number' value={state.emailSettings.verificationLinkMinutes} onChange={event => patchEmail({ verificationLinkMinutes: Number(event.target.value) })} fullWidth inputProps={{ min: 10, max: 1440 }} />
                                            </Grid>
                                        </Grid>
                                        <FormControlLabel
                                            control={<Checkbox checked={state.emailSettings.useSsl} onChange={event => patchEmail({ useSsl: event.target.checked })} />}
                                            label='Use SSL/TLS'
                                        />
                                        <Alert severity='info'>
                                            For Gmail SMTP, the From address must be a verified Send mail as alias or Gmail may rewrite it. For Cloudflare Email Routing, test with a recipient that does not forward back to the same Gmail account that sends the message.
                                        </Alert>
                                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.25}>
                                            <TextField
                                                label='Test recipient email'
                                                type='email'
                                                value={testRecipient}
                                                onChange={event => setTestRecipient(event.target.value)}
                                                fullWidth
                                                error={Boolean(testRecipient.trim()) && !isValidEmail(testRecipient)}
                                                helperText={Boolean(testRecipient.trim()) && !isValidEmail(testRecipient) ? 'Use a real email address.' : 'Leave blank to send to the From address.'}
                                            />
                                            <Button type='button' variant='outlined' onClick={testEmail} disabled={busy}>
                                                Test Email
                                            </Button>
                                        </Stack>
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>
                    </Grid>

                    <Card className='ptv-dashboard-card ptv-control-card'>
                        <CardContent>
                            <Stack spacing={1.5}>
                                <Stack direction='row' justifyContent='space-between' alignItems='center'>
                                    <Box>
                                        <Typography variant='h2'>Jellyfin User Email Mappings</Typography>
                                        <Typography color='text.secondary'>
                                            Add email addresses for existing Jellyfin users so the native PiggieTV password reset engine can reset their accounts.
                                        </Typography>
                                    </Box>
                                    <Button type='button' variant='outlined' onClick={loadSettings} disabled={busy}>Refresh</Button>
                                </Stack>
                                <Divider />
                                {userEmailIssues.size > 0 ? (
                                    <Alert severity='error'>Some user email mappings are invalid or duplicated.</Alert>
                                ) : null}
                                {state.users.length === 0 ? (
                                    <Typography color='text.secondary'>No Jellyfin users are available from the server yet.</Typography>
                                ) : null}
                                {state.users.map(user => (
                                    <Box key={user.userId} className='ptv-signup-user-row'>
                                        <Grid container spacing={1.25} alignItems='center'>
                                            <Grid size={{ xs: 12, md: 4 }}>
                                                <Typography variant='h3'>{user.username}</Typography>
                                                <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap>
                                                    <Chip
                                                        label={user.source === 'ptv' ? 'PTV managed' : 'Jellyfin user'}
                                                        size='small'
                                                        className={`ptv-status-badge ${user.source === 'ptv' ? 'ptv-status-badge-success' : 'ptv-status-badge-info'}`}
                                                    />
                                                    <Chip
                                                        label={getPresetName(state.policyPresets, user.policyPresetId)}
                                                        size='small'
                                                        className='ptv-status-badge ptv-status-badge-info'
                                                    />
                                                </Stack>
                                            </Grid>
                                            <Grid size={{ xs: 12, md: 6 }}>
                                                <TextField
                                                    label='Password reset email'
                                                    type='email'
                                                    value={user.email}
                                                    onChange={event => patchUserEmail(user.userId, event.target.value)}
                                                    error={userEmailIssues.has(user.userId)}
                                                    helperText={userEmailIssues.get(user.userId) || (user.emailConfigured ? 'PTV can send password reset codes to this address.' : 'Leave blank to disable password reset by email for this user.')}
                                                    fullWidth
                                                />
                                            </Grid>
                                            <Grid size={{ xs: 12, md: 2 }}>
                                                <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap justifyContent={{ xs: 'flex-start', md: 'flex-end' }}>
                                                    <Chip
                                                        label={user.email.trim() ? 'reset ready' : 'no email'}
                                                        size='small'
                                                        className={`ptv-status-badge ${user.email.trim() ? 'ptv-status-badge-success' : ''}`}
                                                    />
                                                </Stack>
                                            </Grid>
                                        </Grid>
                                        {user.source === 'ptv' ? (
                                            <Box>
                                                <Typography color='text.secondary' className='ptv-signup-user-meta'>
                                                    Native signup record created {formatDate(user.createdAtUtc)}.
                                                </Typography>
                                            </Box>
                                        ) : null}
                                    </Box>
                                ))}
                                <Button type='button' variant='contained' onClick={saveSettings} disabled={busy || userEmailIssues.size > 0}>
                                    {busy ? 'Saving...' : 'Save User Emails'}
                                </Button>
                            </Stack>
                        </CardContent>
                    </Card>
                </Stack>
            </Box>
        </Page>
    );
};

InviteAdminPage.displayName = 'InviteAdminPage';

export default InviteAdminPage;

/* eslint-enable @typescript-eslint/no-deprecated, react/jsx-no-bind, sonarjs/cognitive-complexity, sonarjs/no-hardcoded-passwords, sonarjs/slow-regex */
