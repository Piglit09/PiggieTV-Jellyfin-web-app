/* eslint-disable @typescript-eslint/no-deprecated, no-nested-ternary, no-void, react/jsx-no-bind, sonarjs/cognitive-complexity, sonarjs/no-hardcoded-passwords, sonarjs/no-nested-conditional, sonarjs/no-nested-functions, sonarjs/slow-regex */
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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import ConfirmDialog from '../../../components/ConfirmDialog';

import { focusPtvTvElement } from '../../core/tvFocus';
import {
    cancelPtvAccountAdminVerification,
    getPtvAccountAdminHealth,
    type PtvAccountAdminHealth,
    type PtvAccountAdminUser
} from '../account/AccountApi';

import { getPtvMediaFolders } from '../../api';
import { getPtvDebugReport, registerPtvDebugSignupStatusProvider } from '../../core/observability';
import { serializeSanitizedPtvDebugExport } from '../dashboard/debugExportSanitizer';
import { useAdminUnsavedChanges } from '../settings/admin/configuration/useAdminUnsavedChanges';
import {
    createSignupInvite,
    deleteSignupInvite,
    disableSignupInvite,
    getSignupErrorMessage,
    getSignupInvites,
    getSignupSettingsSnapshot,
    normalizeSignupAdminSettings,
    saveSignupSettings,
    sendSignupTestEmail,
    type PtvSignupAdminSettingsResponse,
    type PtvSignupEmailSettings,
    type PtvSignupInvite
} from './SignupApi';

import './signup.scss';

type LibraryFolder = {
    Id?: string;
    Name?: string | null;
};

type LoadState = 'error' | 'loading' | 'ready';

type PendingInviteAction = Readonly<{
    invite: PtvSignupInvite;
    kind: 'delete' | 'disable';
}>;

function toWritableSignupSettings(
    value: PtvSignupAdminSettingsResponse
) {
    const emailSettings = { ...value.emailSettings };
    delete emailSettings.password;
    return {
        defaultEnabledFolderIds: [ ...value.defaultEnabledFolderIds ],
        defaultPolicyPresetId: value.defaultPolicyPresetId,
        emailSettings,
        enabled: value.enabled
    };
}

function sameWritableSignupSettings(
    left: PtvSignupAdminSettingsResponse,
    right: PtvSignupAdminSettingsResponse
) {
    return JSON.stringify(toWritableSignupSettings(left)) === JSON.stringify(toWritableSignupSettings(right));
}

function withoutInviteCode(invite: PtvSignupInvite): PtvSignupInvite {
    const safeInvite = { ...invite };
    delete safeInvite.code;
    return {
        ...safeInvite,
        usageRecords: []
    };
}

function formatDate(value?: string | null) {
    if (!value) return 'Never';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';

    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(date);
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
        publicBaseUrlConfigured: Boolean(email.publicBaseUrl),
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
    focusPtvTvElement(textarea, 'invite-link-selected');
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
}

const InviteAdminPage = () => {
    const [state, setState] = useState<PtvSignupAdminSettingsResponse>(() => normalizeSignupAdminSettings());
    const [confirmedSettings, setConfirmedSettings] = useState<PtvSignupAdminSettingsResponse | null>(null);
    const [libraries, setLibraries] = useState<LibraryFolder[]>([]);
    const [smtpPassword, setSmtpPassword] = useState('');
    const [testRecipient, setTestRecipient] = useState('');
    const [statusMessage, setStatusMessage] = useState('');
    const [statusSeverity, setStatusSeverity] = useState<'error' | 'info' | 'success'>('info');
    const [busy, setBusy] = useState(false);
    const [settingsReady, setSettingsReady] = useState(false);
    const [settingsConflict, setSettingsConflict] = useState(false);
    const [librariesState, setLibrariesState] = useState<LoadState>('loading');
    const [accountHealth, setAccountHealth] = useState<PtvAccountAdminHealth | null>(null);
    const [accountFilter, setAccountFilter] = useState<'all' | PtvAccountAdminUser['emailStatus']>('all');
    const [invites, setInvites] = useState<PtvSignupInvite[]>([]);
    const [invitesState, setInvitesState] = useState<LoadState>('loading');
    const [inviteLabel, setInviteLabel] = useState('PiggieTV Invite');
    const [invitePresetId, setInvitePresetId] = useState('standard');
    const [inviteMaxUses, setInviteMaxUses] = useState('1');
    const [inviteExpiresAt, setInviteExpiresAt] = useState('');
    const [inviteEmailRequired, setInviteEmailRequired] = useState(true);
    const [inviteFolderIds, setInviteFolderIds] = useState<string[]>([]);
    const [createdInviteCode, setCreatedInviteCode] = useState('');
    const [pendingInviteAction, setPendingInviteAction] = useState<PendingInviteAction | null>(null);
    const [pendingVerificationUser, setPendingVerificationUser] = useState<PtvAccountAdminUser | null>(null);
    const mountedRef = useRef(false);
    const mutationRef = useRef(false);
    const settingsRequestRef = useRef(0);
    const accountRequestRef = useRef(0);
    const librariesRequestRef = useRef(0);
    const invitesRequestRef = useRef(0);

    const selectedPreset = useMemo(
        () => state.policyPresets.find(preset => preset.id === state.defaultPolicyPresetId),
        [state.defaultPolicyPresetId, state.policyPresets]
    );
    const showLibraryPicker = Boolean(selectedPreset && !selectedPreset.enableAllFolders);
    const selectedInvitePreset = useMemo(
        () => state.policyPresets.find(preset => preset.id === invitePresetId),
        [invitePresetId, state.policyPresets]
    );
    const showInviteLibraryPicker = Boolean(selectedInvitePreset && !selectedInvitePreset.enableAllFolders);
    const librariesReadyForSave = !showLibraryPicker || librariesState === 'ready';
    const librariesReadyForInvite = !showInviteLibraryPicker || librariesState === 'ready';
    const inviteMaxUsesNumber = Number(inviteMaxUses);
    const inviteFormValid = Boolean(
        inviteLabel.trim()
        && selectedInvitePreset
        && Number.isInteger(inviteMaxUsesNumber)
        && inviteMaxUsesNumber >= 0
        && librariesReadyForInvite
    );
    const settingsDirty = Boolean(confirmedSettings
        && (!sameWritableSignupSettings(state, confirmedSettings) || smtpPassword));
    let saveButtonLabel = 'Waiting for policy presets';
    if (settingsReady) saveButtonLabel = busy ? 'Saving...' : 'Save Signup Settings';
    const signupDebugStatus = useMemo(() => getSignupDebugStatus(state), [state]);
    const filteredAccountUsers = useMemo(() => {
        const users = Array.isArray(accountHealth?.users) ? accountHealth.users : [];
        return users.filter(user => accountFilter === 'all' || user.emailStatus === accountFilter);
    }, [accountFilter, accountHealth?.users]);

    const showMessage = useCallback((severity: 'error' | 'info' | 'success', message: string) => {
        if (!mountedRef.current) return;
        setStatusSeverity(severity);
        setStatusMessage(message);
    }, []);

    const loadSettings = useCallback(async () => {
        const requestId = ++settingsRequestRef.current;
        setSettingsReady(false);
        try {
            const snapshot = await getSignupSettingsSnapshot({ bypassCache: true });
            const normalized = snapshot.settings;
            if (!mountedRef.current || requestId !== settingsRequestRef.current) return;
            const hasSelectedPreset = normalized.policyPresets.some(
                preset => preset.id === normalized.defaultPolicyPresetId
            );

            setState(normalized);
            setConfirmedSettings(snapshot.authoritative ? normalized : null);
            setSettingsReady(snapshot.authoritative && hasSelectedPreset);
            setSettingsConflict(false);
            setInvitePresetId(current => normalized.policyPresets.some(preset => preset.id === current) ?
                current : normalized.defaultPolicyPresetId);
            setInviteFolderIds(current => current.length ? current : normalized.defaultEnabledFolderIds);
            if (!snapshot.authoritative || !hasSelectedPreset) {
                showMessage('error', 'Signup settings could not be verified. Refresh this page before saving settings.');
            }
            setSmtpPassword('');
        } catch (error) {
            if (!mountedRef.current || requestId !== settingsRequestRef.current) return;
            setSettingsReady(false);
            setConfirmedSettings(null);
            showMessage('error', getSignupErrorMessage(error));
        }
    }, [showMessage]);

    useAdminUnsavedChanges(settingsDirty, 'Leave without saving your Signup settings?');

    const loadAccountHealth = useCallback(async () => {
        const requestId = ++accountRequestRef.current;
        try {
            const health = await getPtvAccountAdminHealth();
            if (mountedRef.current && requestId === accountRequestRef.current) setAccountHealth(health);
        } catch (error) {
            if (mountedRef.current && requestId === accountRequestRef.current) {
                showMessage('error', getSignupErrorMessage(error));
            }
        }
    }, [showMessage]);

    const loadLibraries = useCallback(async () => {
        const requestId = ++librariesRequestRef.current;
        setLibrariesState('loading');
        try {
            const result = await getPtvMediaFolders();
            if (!mountedRef.current || requestId !== librariesRequestRef.current) return;
            if (!Array.isArray(result?.Items)) throw new Error('Library access could not be verified.');
            setLibraries(result.Items);
            setLibrariesState('ready');
        } catch {
            if (!mountedRef.current || requestId !== librariesRequestRef.current) return;
            setLibraries([]);
            setLibrariesState('error');
        }
    }, []);

    const loadInvites = useCallback(async () => {
        const requestId = ++invitesRequestRef.current;
        setInvitesState('loading');
        try {
            const response = await getSignupInvites();
            if (!mountedRef.current || requestId !== invitesRequestRef.current) return;
            setInvites(Array.isArray(response?.invites) ? response.invites.map(withoutInviteCode) : []);
            setInvitesState('ready');
        } catch {
            if (!mountedRef.current || requestId !== invitesRequestRef.current) return;
            setInvitesState('error');
        }
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        void loadSettings();
        void loadAccountHealth();
        void loadLibraries();
        void loadInvites();

        return () => {
            mountedRef.current = false;
        };
    }, [loadAccountHealth, loadInvites, loadLibraries, loadSettings]);

    useEffect(() => {
        registerPtvDebugSignupStatusProvider(() => signupDebugStatus);

        return () => registerPtvDebugSignupStatusProvider(null);
    }, [signupDebugStatus]);

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

    const toggleInviteLibrary = useCallback((libraryId: string) => {
        setInviteFolderIds(previous => previous.includes(libraryId) ?
            previous.filter(id => id !== libraryId) :
            [...previous, libraryId]);
    }, []);

    const beginMutation = useCallback(() => {
        if (mutationRef.current) return false;
        mutationRef.current = true;
        setBusy(true);
        return true;
    }, []);

    const finishMutation = useCallback(() => {
        mutationRef.current = false;
        if (mountedRef.current) setBusy(false);
    }, []);

    const saveSettings = useCallback(() => {
        if (!settingsReady || !confirmedSettings || settingsConflict || !settingsDirty
            || !librariesReadyForSave || !beginMutation()) return;
        void (async () => {
            try {
                const latest = await getSignupSettingsSnapshot({ bypassCache: true });
                if (!latest.authoritative) {
                    showMessage('error', 'Signup settings could not be verified. No changes were made.');
                    return;
                }
                if (!sameWritableSignupSettings(latest.settings, confirmedSettings)) {
                    setSettingsConflict(true);
                    showMessage('error', 'These settings changed on the server while you were editing. Reload settings before saving.');
                    return;
                }

                await saveSignupSettings({
                    defaultEnabledFolderIds: selectedPreset?.enableAllFolders === true ? [] : state.defaultEnabledFolderIds,
                    defaultPolicyPresetId: state.defaultPolicyPresetId,
                    emailSettings: {
                        ...state.emailSettings,
                        password: smtpPassword || null
                    },
                    enabled: state.enabled
                });
                const verified = await getSignupSettingsSnapshot({ bypassCache: true });
                if (!mountedRef.current) return;
                if (!verified.authoritative) {
                    setSettingsReady(false);
                    setConfirmedSettings(null);
                    showMessage('error', 'Signup settings were submitted, but the saved values could not be verified. Reload settings.');
                    return;
                }
                setState(verified.settings);
                setConfirmedSettings(verified.settings);
                setSettingsConflict(false);
                showMessage('success', 'Signup settings saved.');
            } catch (error) {
                showMessage('error', getSignupErrorMessage(error));
            } finally {
                if (mountedRef.current) setSmtpPassword('');
                finishMutation();
            }
        })();
    }, [beginMutation, confirmedSettings, finishMutation, librariesReadyForSave, selectedPreset?.enableAllFolders, settingsConflict, settingsDirty, settingsReady, showMessage, smtpPassword, state.defaultEnabledFolderIds, state.defaultPolicyPresetId, state.emailSettings, state.enabled]);

    const resetSettings = useCallback(() => {
        if (!confirmedSettings || busy) return;
        setState(confirmedSettings);
        setSmtpPassword('');
        setSettingsConflict(false);
        setStatusMessage('');
    }, [ busy, confirmedSettings ]);

    const runAccountAction = useCallback((action: () => Promise<{ message: string; ok: boolean }>) => {
        if (!beginMutation()) return;
        void (async () => {
            try {
                const result = await action();
                showMessage(result.ok ? 'success' : 'error', result.message);
                const health = await getPtvAccountAdminHealth();
                if (mountedRef.current) setAccountHealth(health);
            } catch (error) {
                showMessage('error', getSignupErrorMessage(error));
            } finally {
                finishMutation();
            }
        })();
    }, [beginMutation, finishMutation, showMessage]);

    const testEmail = useCallback(() => {
        if (testRecipient.trim() && !isValidEmail(testRecipient)) {
            showMessage('error', 'Enter a valid test recipient email address.');
            return;
        }

        if (!beginMutation()) return;
        void (async () => {
            try {
                const result = await sendSignupTestEmail({
                    recipient: testRecipient.trim() || undefined,
                    referenceUrl: `${window.location.origin}${window.location.pathname}`
                });
                showMessage(result.ok ? 'success' : 'error', result.message);
            } catch (error) {
                showMessage('error', getSignupErrorMessage(error));
            } finally {
                finishMutation();
            }
        })();
    }, [beginMutation, finishMutation, showMessage, testRecipient]);

    const createInvite = useCallback(() => {
        if (!inviteFormValid || !beginMutation()) return;
        void (async () => {
            try {
                const created = await createSignupInvite({
                    emailRequired: inviteEmailRequired,
                    enabledFolderIds: selectedInvitePreset?.enableAllFolders ? [] : inviteFolderIds,
                    expiresAtUtc: inviteExpiresAt ? new Date(inviteExpiresAt).toISOString() : null,
                    label: inviteLabel.trim(),
                    maxUses: inviteMaxUsesNumber,
                    policyPresetId: invitePresetId
                });
                if (!mountedRef.current) return;
                const safeCreated = withoutInviteCode(created);
                setInvites(previous => [ safeCreated, ...previous.filter(invite => invite.id !== created.id) ]);
                setInvitesState('ready');
                setCreatedInviteCode(typeof created.code === 'string' ? created.code : '');
                showMessage(created.code ? 'success' : 'info', created.code ?
                    'Invite created. Copy the one-time code now.' :
                    'Invite created, but the one-time code was not returned.');
            } catch (error) {
                showMessage('error', getSignupErrorMessage(error));
            } finally {
                finishMutation();
            }
        })();
    }, [beginMutation, finishMutation, inviteEmailRequired, inviteExpiresAt, inviteFolderIds, inviteFormValid, inviteLabel, inviteMaxUsesNumber, invitePresetId, selectedInvitePreset?.enableAllFolders, showMessage]);

    const confirmInviteAction = useCallback(() => {
        const pending = pendingInviteAction;
        if (!pending || !beginMutation()) return;
        void (async () => {
            try {
                const authoritative = await getSignupInvites({ bypassCache: true });
                const current = authoritative.invites?.find(invite => invite.id === pending.invite.id);
                if (!current) {
                    showMessage('error', 'This invitation is no longer available. Refresh the list.');
                    return;
                }
                if (pending.kind === 'disable' && current.disabled) {
                    showMessage('error', 'This invitation is already disabled. Refresh the list.');
                    return;
                }
                if (pending.kind === 'disable') {
                    const updated = await disableSignupInvite(pending.invite.id);
                    if (mountedRef.current) {
                        setInvites(previous => previous.map(invite => invite.id === updated.id ? withoutInviteCode(updated) : invite));
                    }
                    showMessage('success', 'Invite disabled.');
                } else {
                    await deleteSignupInvite(pending.invite.id);
                    if (mountedRef.current) {
                        setInvites(previous => previous.filter(invite => invite.id !== pending.invite.id));
                    }
                    showMessage('success', 'Invite deleted.');
                }
                if (mountedRef.current) setPendingInviteAction(null);
            } catch (error) {
                showMessage('error', getSignupErrorMessage(error));
            } finally {
                finishMutation();
            }
        })();
    }, [beginMutation, finishMutation, pendingInviteAction, showMessage]);

    const copyCreatedInviteCode = useCallback(() => {
        if (!createdInviteCode) return;
        void copyTextToClipboard(createdInviteCode)
            .then(() => {
                if (mountedRef.current) setCreatedInviteCode('');
                showMessage('success', 'Invite code copied and hidden.');
            })
            .catch(error => showMessage('error', `Invite code copy failed: ${getSignupErrorMessage(error)}`));
    }, [createdInviteCode, showMessage]);

    const confirmCancelVerification = useCallback(() => {
        const user = pendingVerificationUser;
        if (!user) return;
        setPendingVerificationUser(null);
        runAccountAction(() => cancelPtvAccountAdminVerification(user.jellyfinUserId));
    }, [pendingVerificationUser, runAccountAction]);

    const copySignupDebug = useCallback(() => {
        copyTextToClipboard(serializeSanitizedPtvDebugExport({
            debugReport: getPtvDebugReport(),
            signup: signupDebugStatus,
            timestamp: new Date().toISOString()
        }))
            .then(() => showMessage('success', 'Signup debug copied.'))
            .catch(error => showMessage('error', `Signup debug copy failed: ${getSignupErrorMessage(error)}`));
    }, [showMessage, signupDebugStatus]);

    return (
        <section className='ptv-signup-invites-page' data-testid='ptv-admin-signup-invites'>
            <Box className='ptv-signup-invites-content'>
                <Stack spacing={2}>
                    <Box>
                        <Typography variant='h1'>Signup &amp; Invites</Typography>
                        <Typography variant='body1' color='text.secondary'>
                            Native PiggieTV account signup, email delivery, and password reset settings.
                        </Typography>
                    </Box>

                    {statusMessage ? (
                        <Alert
                            action={settingsConflict ? <Button color='inherit' onClick={() => void loadSettings()} size='small'>Reload Settings</Button> : undefined}
                            severity={statusSeverity}
                        >
                            {statusMessage}
                        </Alert>
                    ) : null}

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
                            className={`ptv-status-badge ${accountHealth?.verifiedEmails ? 'ptv-status-badge-success' : 'ptv-status-badge-info'}`}
                            label={`${accountHealth?.verifiedEmails || 0}/${accountHealth?.totalJellyfinUsers || 0} verified emails`}
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
                                        <TextField label='User policy preset' select value={selectedPreset ? state.defaultPolicyPresetId : ''} onChange={event => patchState({ defaultPolicyPresetId: event.target.value })} fullWidth>
                                            {state.policyPresets.length === 0 ? (
                                                <MenuItem value='' disabled>Policy presets unavailable</MenuItem>
                                            ) : null}
                                            {state.policyPresets.map(preset => (
                                                <MenuItem key={preset.id} value={preset.id}>{preset.name}</MenuItem>
                                            ))}
                                        </TextField>

                                        {showLibraryPicker ? (
                                            <Box className='ptv-signup-library-picker'>
                                                <Typography variant='h3'>Library access</Typography>
                                                {librariesState === 'loading' ? <Typography color='text.secondary'>Loading confirmed library access...</Typography> : null}
                                                {librariesState === 'error' ? (
                                                    <Alert
                                                        action={<Button color='inherit' onClick={() => void loadLibraries()} size='small'>Retry</Button>}
                                                        severity='warning'
                                                    >
                                                        Library access could not be verified. Saving is disabled to avoid changing access unexpectedly.
                                                    </Alert>
                                                ) : null}
                                                {librariesState === 'ready' && libraries.length === 0 ? (
                                                    <Typography color='text.secondary'>No configured libraries were returned by the server.</Typography>
                                                ) : libraries.map(library => library.Id ? (
                                                    <FormControlLabel
                                                        key={library.Id}
                                                        control={<Checkbox checked={state.defaultEnabledFolderIds.includes(library.Id)} onChange={() => toggleLibrary(library.Id!)} />}
                                                        label={library.Name || 'Unnamed library'}
                                                    />
                                                ) : null)}
                                            </Box>
                                        ) : null}

                                        <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap>
                                            <Button type='button' variant='contained' onClick={saveSettings} disabled={busy || !settingsReady || !settingsDirty || settingsConflict || !librariesReadyForSave}>
                                                {saveButtonLabel}
                                            </Button>
                                            <Button type='button' variant='outlined' onClick={resetSettings} disabled={busy || !settingsDirty}>
                                                Reset Changes
                                            </Button>
                                        </Stack>
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
                                                    label='Public PiggieTV URL'
                                                    value={state.emailSettings.publicBaseUrl}
                                                    onChange={event => patchEmail({ publicBaseUrl: event.target.value })}
                                                    fullWidth
                                                    placeholder='https://media.example.com'
                                                    helperText='Trusted public origin used for verification and recovery links. Do not include /web or a route.'
                                                />
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
                                <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent='space-between' alignItems={{ xs: 'flex-start', sm: 'center' }} spacing={1}>
                                    <Box>
                                        <Typography variant='h2'>Invitations</Typography>
                                        <Typography color='text.secondary'>Create bounded registration codes and review their current server state.</Typography>
                                    </Box>
                                    <Button type='button' variant='outlined' onClick={() => void loadInvites()} disabled={busy || invitesState === 'loading'}>Refresh</Button>
                                </Stack>
                                <Divider />

                                {createdInviteCode ? (
                                    <Alert severity='success' className='ptv-signup-created-code'>
                                        <Stack spacing={1}>
                                            <strong>Copy this one-time invite code now. It will not be shown again.</strong>
                                            <code>{createdInviteCode}</code>
                                            <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap>
                                                <Button color='inherit' onClick={copyCreatedInviteCode} size='small' variant='outlined'>Copy Code</Button>
                                                <Button color='inherit' onClick={() => setCreatedInviteCode('')} size='small'>Dismiss</Button>
                                            </Stack>
                                        </Stack>
                                    </Alert>
                                ) : null}

                                <Box className='ptv-signup-invite-form' component='form' onSubmit={event => {
                                    event.preventDefault();
                                    createInvite();
                                }}>
                                    <Grid container spacing={1.25}>
                                        <Grid size={{ xs: 12, md: 5 }}>
                                            <TextField label='Invite label' value={inviteLabel} onChange={event => setInviteLabel(event.target.value)} inputProps={{ maxLength: 80 }} fullWidth />
                                        </Grid>
                                        <Grid size={{ xs: 12, md: 4 }}>
                                            <TextField label='Policy preset' select value={selectedInvitePreset ? invitePresetId : ''} onChange={event => setInvitePresetId(event.target.value)} fullWidth>
                                                {state.policyPresets.length === 0 ? <MenuItem disabled value=''>Policy presets unavailable</MenuItem> : null}
                                                {state.policyPresets.map(preset => <MenuItem key={preset.id} value={preset.id}>{preset.name}</MenuItem>)}
                                            </TextField>
                                        </Grid>
                                        <Grid size={{ xs: 12, md: 3 }}>
                                            <TextField label='Maximum uses' type='number' value={inviteMaxUses} onChange={event => setInviteMaxUses(event.target.value)} inputProps={{ min: 0, step: 1 }} helperText='0 means unlimited' fullWidth />
                                        </Grid>
                                        <Grid size={{ xs: 12, md: 6 }}>
                                            <TextField label='Expires at (optional)' type='datetime-local' value={inviteExpiresAt} onChange={event => setInviteExpiresAt(event.target.value)} InputLabelProps={{ shrink: true }} fullWidth />
                                        </Grid>
                                        <Grid size={{ xs: 12, md: 6 }}>
                                            <FormControlLabel
                                                control={<Checkbox checked={inviteEmailRequired} onChange={event => setInviteEmailRequired(event.target.checked)} />}
                                                label='Require email address'
                                            />
                                        </Grid>
                                    </Grid>

                                    {showInviteLibraryPicker ? (
                                        <Box className='ptv-signup-library-picker'>
                                            <Typography variant='h3'>Invite library access</Typography>
                                            {librariesState === 'error' ? (
                                                <Alert severity='warning'>Library access is unavailable. Invite creation is disabled.</Alert>
                                            ) : librariesState === 'loading' ? (
                                                <Typography color='text.secondary'>Loading confirmed library access...</Typography>
                                            ) : libraries.length === 0 ? (
                                                <Typography color='text.secondary'>No configured libraries were returned by the server.</Typography>
                                            ) : libraries.map(library => library.Id ? (
                                                <FormControlLabel
                                                    key={library.Id}
                                                    control={<Checkbox checked={inviteFolderIds.includes(library.Id)} onChange={() => toggleInviteLibrary(library.Id!)} />}
                                                    label={library.Name || 'Unnamed library'}
                                                />
                                            ) : null)}
                                        </Box>
                                    ) : null}

                                    <Button disabled={busy || !settingsReady || !inviteFormValid} type='submit' variant='contained'>
                                        {busy ? 'Working...' : 'Create Invite'}
                                    </Button>
                                </Box>

                                {invitesState === 'loading' ? <Typography color='text.secondary' role='status'>Loading invitations...</Typography> : null}
                                {invitesState === 'error' ? (
                                    <Alert action={<Button color='inherit' onClick={() => void loadInvites()} size='small'>Retry</Button>} severity='warning'>Invitations could not be loaded. Signup settings remain available.</Alert>
                                ) : null}
                                {invitesState === 'ready' && invites.length === 0 ? <Typography color='text.secondary'>No invitations have been created.</Typography> : null}
                                {invitesState === 'ready' ? invites.map(invite => (
                                    <article className='ptv-signup-invite-row' key={invite.id}>
                                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} justifyContent='space-between' alignItems={{ xs: 'flex-start', md: 'center' }}>
                                            <Box>
                                                <Typography variant='h3'>{invite.label || 'PiggieTV Invite'}</Typography>
                                                <Typography color='text.secondary' className='ptv-signup-user-meta'>
                                                    Code {invite.codePreview || 'hidden'} - Created {formatDate(invite.createdAtUtc)}
                                                </Typography>
                                                <Typography color='text.secondary' className='ptv-signup-user-meta'>
                                                    {invite.maxUses === 0 ? `${invite.usedCount} uses - Unlimited` : `${invite.usedCount}/${invite.maxUses} uses`}
                                                    {invite.expiresAtUtc ? ` - Expires ${formatDate(invite.expiresAtUtc)}` : ' - No expiry'}
                                                </Typography>
                                            </Box>
                                            <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap>
                                                <Chip
                                                    className={`ptv-status-badge ${invite.usable ? 'ptv-status-badge-success' : 'ptv-status-badge-info'}`}
                                                    label={invite.disabled ? 'Disabled' : invite.usable ? 'Usable' : 'Unavailable'}
                                                    size='small'
                                                />
                                                {!invite.disabled ? <Button disabled={busy} onClick={() => setPendingInviteAction({ invite, kind: 'disable' })} size='small' variant='outlined'>Disable</Button> : null}
                                                <Button color='error' disabled={busy} onClick={() => setPendingInviteAction({ invite, kind: 'delete' })} size='small' variant='outlined'>Delete</Button>
                                            </Stack>
                                        </Stack>
                                    </article>
                                )) : null}
                            </Stack>
                        </CardContent>
                    </Card>

                    <Card className='ptv-dashboard-card ptv-control-card'>
                        <CardContent>
                            <Stack spacing={1.5}>
                                <Stack direction='row' justifyContent='space-between' alignItems='center'>
                                    <Box>
                                        <Typography variant='h2'>Account Profile Health</Typography>
                                        <Typography color='text.secondary'>
                                            Durable PiggieTV profiles keyed to immutable Jellyfin user IDs. Emails become recovery destinations only after verification.
                                        </Typography>
                                    </Box>
                                    <Button type='button' variant='outlined' onClick={loadAccountHealth} disabled={busy}>Refresh</Button>
                                </Stack>
                                <Divider />
                                {accountHealth?.profileCountMismatch ? (
                                    <Alert severity='warning'>Profile count differs from the Jellyfin user count. Refresh after startup synchronization and review orphan counts.</Alert>
                                ) : null}
                                {accountHealth?.backup?.overdue ? (
                                    <Alert severity='warning'>Account backups are overdue. Review the PiggieTV account backup in Server Backups.</Alert>
                                ) : null}
                                <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap>
                                    <Chip label={`${accountHealth?.totalJellyfinUsers || 0} Jellyfin users`} size='small' className='ptv-status-badge ptv-status-badge-info' />
                                    <Chip label={`${accountHealth?.totalProfiles || 0} profiles`} size='small' className='ptv-status-badge ptv-status-badge-info' />
                                    <Chip label={`${accountHealth?.verifiedEmails || 0} verified`} size='small' className='ptv-status-badge ptv-status-badge-success' />
                                    <Chip label={`${accountHealth?.missingEmails || 0} missing`} size='small' className='ptv-status-badge' />
                                    <Chip label={`${accountHealth?.pendingVerifications || 0} pending`} size='small' className='ptv-status-badge ptv-status-badge-info' />
                                    <Chip label={`${accountHealth?.expiredVerifications || 0} expired`} size='small' className='ptv-status-badge' />
                                    <Chip label={`${accountHealth?.failedVerifications || 0} failed`} size='small' className='ptv-status-badge' />
                                    <Chip label={`${accountHealth?.orphanedProfiles || 0} orphaned`} size='small' className='ptv-status-badge' />
                                </Stack>

                                {accountHealth?.migration ? (
                                    <Alert severity={accountHealth.migration.ambiguousRecordsSkipped || accountHealth.migration.orphanedRecordsFound ? 'warning' : 'info'}>
                                        Migration v{accountHealth.migration.version}: {accountHealth.migration.verifiedEmailsRecovered} verified recovered, {accountHealth.migration.unverifiedEmailsRecovered} requiring reverification, {accountHealth.migration.ambiguousRecordsSkipped} ambiguous skipped, {accountHealth.migration.usersStillMissingEmail} still missing.
                                    </Alert>
                                ) : null}

                                <Box className='ptv-signup-backup-health'>
                                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.25} justifyContent='space-between'>
                                        <Box>
                                            <Typography variant='h3'>Account backup</Typography>
                                            <Typography color='text.secondary'>
                                                {accountHealth?.backup?.lastSuccessAtUtc ? `Last success ${formatDate(accountHealth.backup.lastSuccessAtUtc)} · ${accountHealth.backup.verificationStatus}` : 'No successful backup recorded.'}
                                            </Typography>
                                        </Box>
                                        <Link className='ptv-signup-admin-link' to='/settings/admin/server/backups'>Manage Backups</Link>
                                    </Stack>
                                </Box>

                                <TextField label='Email status filter' select value={accountFilter} onChange={event => setAccountFilter(event.target.value as typeof accountFilter)} sx={{ maxWidth: 320 }}>
                                    <MenuItem value='all'>All users</MenuItem>
                                    <MenuItem value='verified'>Verified</MenuItem>
                                    <MenuItem value='missing'>Missing</MenuItem>
                                    <MenuItem value='pending'>Pending</MenuItem>
                                    <MenuItem value='expired'>Expired</MenuItem>
                                    <MenuItem value='failed'>Failed</MenuItem>
                                    <MenuItem value='reverification_required'>Reverification required</MenuItem>
                                </TextField>

                                {filteredAccountUsers.length === 0 ? <Typography color='text.secondary'>No accounts match this filter.</Typography> : null}
                                {filteredAccountUsers.map(user => (
                                    <Box key={user.jellyfinUserId} className='ptv-signup-user-row'>
                                        <Grid container spacing={1.25} alignItems='center'>
                                            <Grid size={{ xs: 12, md: 5 }}>
                                                <Typography variant='h3'>{user.username}</Typography>
                                            </Grid>
                                            <Grid size={{ xs: 12, md: 4 }}>
                                                <Typography>{user.maskedEmail || 'No email'}</Typography>
                                                <Typography color='text.secondary' className='ptv-signup-user-meta'>Last sync {formatDate(user.lastProfileSyncAtUtc || user.lastProfileSync)}</Typography>
                                            </Grid>
                                            <Grid size={{ xs: 12, md: 3 }}>
                                                <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap justifyContent={{ xs: 'flex-start', md: 'flex-end' }}>
                                                    <Chip label={user.emailStatus.replace(/_/g, ' ')} size='small' className={`ptv-status-badge ${user.emailStatus === 'verified' ? 'ptv-status-badge-success' : 'ptv-status-badge-info'}`} />
                                                    {(['pending', 'expired', 'failed'] as const).includes(user.emailStatus as 'pending' | 'expired' | 'failed') ? (
                                                        <Button size='small' type='button' variant='outlined' disabled={busy} onClick={() => setPendingVerificationUser(user)}>Cancel verification</Button>
                                                    ) : null}
                                                </Stack>
                                            </Grid>
                                        </Grid>
                                    </Box>
                                ))}
                            </Stack>
                        </CardContent>
                    </Card>
                </Stack>
            </Box>
            <ConfirmDialog
                confirmButtonColor={pendingInviteAction?.kind === 'delete' ? 'error' : 'warning'}
                confirmButtonText={pendingInviteAction?.kind === 'delete' ? 'Delete Invite' : 'Disable Invite'}
                onCancel={() => setPendingInviteAction(null)}
                onConfirm={confirmInviteAction}
                open={Boolean(pendingInviteAction)}
                text={pendingInviteAction?.kind === 'delete' ?
                    `Delete ${pendingInviteAction.invite.label || 'this invite'}? This removes its server record and cannot be undone.` :
                    `Disable ${pendingInviteAction?.invite.label || 'this invite'}? Its code will no longer accept new registrations.`}
                title={pendingInviteAction?.kind === 'delete' ? 'Delete invite?' : 'Disable invite?'}
            />
            <ConfirmDialog
                confirmButtonColor='warning'
                confirmButtonText='Cancel Verification'
                onCancel={() => setPendingVerificationUser(null)}
                onConfirm={confirmCancelVerification}
                open={Boolean(pendingVerificationUser)}
                text={`Cancel the pending email verification for ${pendingVerificationUser?.username || 'this account'}? A new verification will be required.`}
                title='Cancel email verification?'
            />
        </section>
    );
};

InviteAdminPage.displayName = 'InviteAdminPage';

export default InviteAdminPage;

/* eslint-enable @typescript-eslint/no-deprecated, no-nested-ternary, no-void, react/jsx-no-bind, sonarjs/cognitive-complexity, sonarjs/no-hardcoded-passwords, sonarjs/no-nested-conditional, sonarjs/no-nested-functions, sonarjs/slow-regex */
