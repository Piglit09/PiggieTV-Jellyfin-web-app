import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const inviteAdminMocks = vi.hoisted(() => ({
    accountHealth: vi.fn(),
    cancelVerification: vi.fn(),
    createSignupInvite: vi.fn(),
    deleteSignupInvite: vi.fn(),
    debugReport: vi.fn(),
    disableSignupInvite: vi.fn(),
    getSignupInvites: vi.fn(),
    getSignupSettings: vi.fn(),
    mediaFolders: vi.fn(),
    saveSignupSettings: vi.fn(),
    sendSignupTestEmail: vi.fn()
}));

vi.mock('../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: () => ({
        createSignupInvite: inviteAdminMocks.createSignupInvite,
        deleteSignupInvite: inviteAdminMocks.deleteSignupInvite,
        disableSignupInvite: inviteAdminMocks.disableSignupInvite,
        getSignupInvites: inviteAdminMocks.getSignupInvites,
        getSignupSettings: inviteAdminMocks.getSignupSettings,
        saveSignupSettings: inviteAdminMocks.saveSignupSettings,
        sendSignupTestEmail: inviteAdminMocks.sendSignupTestEmail
    }),
    normalizePtvApiError: (error: unknown) => error instanceof Error ?
        { message: error.message } :
        { message: String(error) }
}));
vi.mock('../account/AccountApi', () => ({
    cancelPtvAccountAdminVerification: inviteAdminMocks.cancelVerification,
    getPtvAccountAdminHealth: inviteAdminMocks.accountHealth
}));
vi.mock('../../api', () => ({
    getPtvMediaFolders: inviteAdminMocks.mediaFolders
}));
vi.mock('../../core/observability', () => ({
    getPtvDebugReport: inviteAdminMocks.debugReport,
    registerPtvDebugSignupStatusProvider: vi.fn()
}));
vi.mock('../../core/tvFocus', () => ({
    focusPtvTvElement: vi.fn()
}));
vi.mock('../../../components/ConfirmDialog', () => ({
    default: ({ onCancel, onConfirm, open, text, title }: Readonly<{
        onCancel: () => void;
        onConfirm: () => void;
        open: boolean;
        text: string;
        title: string;
    }>) => open ? (
        <div role='dialog'>
            <h2>{title}</h2>
            <p>{text}</p>
            <button onClick={onCancel} type='button'>Cancel dialog</button>
            <button onClick={onConfirm} type='button'>Confirm action</button>
        </div>
    ) : null
}));

import InviteAdminPage from './InviteAdminPage';
import {
    normalizeSignupAdminSettings,
    type PtvSignupInvite,
    type PtvSignupPolicyPreset
} from './SignupApi';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

const standardPreset: PtvSignupPolicyPreset = {
    allowDownloads: true,
    allowLiveTv: false,
    allowRemoteControl: false,
    allowTranscoding: true,
    enableAllFolders: true,
    enabledFolderIds: [],
    id: 'standard',
    name: 'Standard'
};

function settingsFixture(preset: PtvSignupPolicyPreset = standardPreset) {
    return normalizeSignupAdminSettings({
        defaultPolicyPresetId: preset.id,
        enabled: true,
        ok: true,
        policyPresets: [ preset ]
    });
}

function inviteFixture(overrides: Partial<PtvSignupInvite> = {}): PtvSignupInvite {
    return {
        codePreview: 'ABCD...',
        createdAtUtc: '2026-08-13T12:00:00Z',
        disabled: false,
        emailRequired: true,
        enabledFolderIds: [],
        id: 'invite-a',
        label: 'Family invite',
        maxUses: 1,
        policyPresetId: 'standard',
        usable: true,
        usageRecords: [],
        usedCount: 0,
        ...overrides
    };
}

describe('Signup and Invites administration page', () => {
    let container: HTMLDivElement;
    let root: Root;
    let consoleWarn: ReturnType<typeof vi.spyOn>;
    const renderPage = async () => {
        const router = createMemoryRouter([{
            element: <InviteAdminPage />,
            path: '*'
        }], { initialEntries: [ '/settings/admin/users/signup-invites' ] });
        await act(async () => {
            root.render(<RouterProvider router={router} />);
            await Promise.resolve();
            await Promise.resolve();
        });
    };

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
        consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        inviteAdminMocks.mediaFolders.mockResolvedValue({ Items: [] });
        inviteAdminMocks.accountHealth.mockResolvedValue({ users: [] });
        inviteAdminMocks.cancelVerification.mockResolvedValue({ message: 'Cancelled', ok: true });
        inviteAdminMocks.createSignupInvite.mockResolvedValue(inviteFixture({ code: 'one-time-secret' }));
        inviteAdminMocks.deleteSignupInvite.mockResolvedValue(undefined);
        inviteAdminMocks.debugReport.mockReturnValue({});
        inviteAdminMocks.disableSignupInvite.mockImplementation(async (id: string) => inviteFixture({ disabled: true, id, usable: false }));
        inviteAdminMocks.getSignupInvites.mockResolvedValue({ enabled: true, invites: [], ok: true, policyPresets: [] });
        inviteAdminMocks.saveSignupSettings.mockResolvedValue({ ok: true });
        inviteAdminMocks.sendSignupTestEmail.mockResolvedValue({ message: 'Sent', ok: true });
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        consoleWarn.mockRestore();
        vi.clearAllMocks();
    });

    it('renders a controlled unavailable state for a legacy partial response', async () => {
        inviteAdminMocks.getSignupSettings.mockResolvedValue({
            defaultPolicyPresetId: 'standard',
            enabled: true,
            ok: true
        });

        await renderPage();

        expect(container.textContent).toContain('Signup & Invites');
        expect(container.textContent).toContain('Signup settings could not be verified');
        expect(container.textContent).toContain('Waiting for policy presets');
        expect(container.textContent).toContain('No accounts match this filter.');
        expect(inviteAdminMocks.saveSignupSettings).not.toHaveBeenCalled();
        expect(consoleWarn.mock.calls.flat().join(' ')).not.toContain('out-of-range value');
    });

    it('keeps saving disabled while signup settings are still loading', async () => {
        inviteAdminMocks.getSignupSettings.mockImplementation(() => new Promise(() => undefined));

        await renderPage();

        const saveButton = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent === 'Waiting for policy presets');

        expect(saveButton).toBeDefined();
        expect(saveButton?.disabled).toBe(true);
        expect(consoleWarn.mock.calls.flat().join(' ')).not.toContain('out-of-range value');
    });

    it('keeps backup operations in Server Backups and never renders immutable account identifiers', async () => {
        inviteAdminMocks.getSignupSettings.mockResolvedValue(settingsFixture());
        inviteAdminMocks.accountHealth.mockResolvedValue({
            backup: {
                backupId: 'private-backup-id',
                lastSuccessAtUtc: '2026-08-13T12:00:00Z',
                overdue: true,
                verificationStatus: 'verified'
            },
            users: [ {
                emailStatus: 'pending',
                jellyfinUserId: 'private-user-id',
                maskedEmail: 'a***@example.com',
                username: 'Alex'
            } ]
        });

        await renderPage();

        expect(container.querySelector('a[href="/settings/admin/server/backups"]')?.textContent).toBe('Manage Backups');
        expect(container.textContent).not.toContain('private-backup-id');
        expect(container.textContent).not.toContain('private-user-id');
        expect(container.textContent).not.toContain('Run Backup');
        expect(container.textContent).not.toContain('Restore Latest');
        expect(inviteAdminMocks.saveSignupSettings).not.toHaveBeenCalled();
        expect(inviteAdminMocks.createSignupInvite).not.toHaveBeenCalled();
        expect(inviteAdminMocks.cancelVerification).not.toHaveBeenCalled();
    });

    it('fails closed when restricted library access cannot be confirmed', async () => {
        const restrictedPreset = { ...standardPreset, enableAllFolders: false, id: 'restricted', name: 'Restricted' };
        inviteAdminMocks.getSignupSettings.mockResolvedValue(settingsFixture(restrictedPreset));
        inviteAdminMocks.mediaFolders.mockRejectedValue(new Error('Unavailable'));

        await renderPage();

        expect(container.textContent).toContain('Library access could not be verified');
        const saveButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Save Signup Settings');
        const createButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Create Invite');
        expect(saveButton?.disabled).toBe(true);
        expect(createButton?.disabled).toBe(true);
        expect(inviteAdminMocks.saveSignupSettings).not.toHaveBeenCalled();
        expect(inviteAdminMocks.createSignupInvite).not.toHaveBeenCalled();
    });

    it('keeps settings usable when the independent invitations source fails', async () => {
        inviteAdminMocks.getSignupSettings.mockResolvedValue(settingsFixture());
        inviteAdminMocks.getSignupInvites.mockRejectedValue(new Error('Invite list unavailable'));

        await renderPage();

        expect(container.textContent).toContain('Invitations could not be loaded');
        const saveButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Save Signup Settings');
        expect(saveButton?.disabled).toBe(true);
        const enabledCheckbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
        await act(async () => enabledCheckbox?.click());
        expect(saveButton?.disabled).toBe(false);
    });

    it('strips invite codes and unused usage-record PII before storing list rows', async () => {
        inviteAdminMocks.getSignupSettings.mockResolvedValue(settingsFixture());
        inviteAdminMocks.getSignupInvites.mockResolvedValue({
            enabled: true,
            invites: [ inviteFixture({
                code: 'full-secret-code',
                usageRecords: [ {
                    email: 'private@example.com',
                    remoteAddress: '192.0.2.20',
                    usedAtUtc: '2026-08-13T12:30:00Z',
                    userId: 'private-user-id',
                    username: 'Alex'
                } ],
                usedCount: 1
            }) ],
            ok: true,
            policyPresets: [ standardPreset ]
        });

        await renderPage();

        const row = container.querySelector('.ptv-signup-invite-row');
        expect(row?.textContent).toContain('Family invite');
        expect(row?.textContent).toContain('ABCD...');
        expect(row?.textContent).not.toContain('full-secret-code');
        expect(row?.textContent).not.toContain('private@example.com');
        expect(row?.textContent).not.toContain('192.0.2.20');
        expect(row?.textContent).not.toContain('private-user-id');
    });

    it('reveals a newly created code only ephemerally and blocks duplicate creation', async () => {
        inviteAdminMocks.getSignupSettings.mockResolvedValue(settingsFixture());
        const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

        await renderPage();

        const createButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Create Invite');
        await act(async () => {
            createButton?.click();
            createButton?.click();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(inviteAdminMocks.createSignupInvite).toHaveBeenCalledOnce();
        expect(container.textContent).toContain('one-time-secret');
        expect(container.querySelector('.ptv-signup-invite-row')?.textContent).not.toContain('one-time-secret');

        const copyButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Copy Code');
        await act(async () => {
            copyButton?.click();
            await Promise.resolve();
        });
        expect(writeText).toHaveBeenCalledWith('one-time-secret');
        expect(container.textContent).not.toContain('one-time-secret');
    });

    it('copies only sanitized signup diagnostics', async () => {
        const accessCanary = [ 'PTV_TEST', 'ACCESS_TOKEN', 'signup-debug' ].join('_');
        const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        inviteAdminMocks.getSignupSettings.mockResolvedValue(settingsFixture());
        inviteAdminMocks.debugReport.mockReturnValue({
            request: {
                endpoint: `https://server.invalid/Users/Me?api_key=${accessCanary}`,
                headers: { Authorization: `Bearer ${accessCanary}` }
            },
            tokenCount: 4
        });

        await renderPage();
        const copyButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
            .find(button => button.textContent === 'Copy Signup Debug');

        await act(async () => {
            copyButton?.click();
            await Promise.resolve();
        });

        expect(writeText).toHaveBeenCalledOnce();
        const copied = String(writeText.mock.calls[0]?.[0] || '');
        expect(copied).not.toContain(accessCanary);
        expect(copied).toContain('[REDACTED]');
        expect(copied).toContain('"tokenCount": 4');
    });

    it('requires accessible confirmation for invite and verification mutations', async () => {
        inviteAdminMocks.getSignupSettings.mockResolvedValue(settingsFixture());
        inviteAdminMocks.getSignupInvites.mockResolvedValue({
            enabled: true,
            invites: [ inviteFixture() ],
            ok: true,
            policyPresets: [ standardPreset ]
        });
        inviteAdminMocks.accountHealth.mockResolvedValue({
            users: [ {
                emailStatus: 'pending',
                jellyfinUserId: 'private-user-id',
                maskedEmail: 'a***@example.com',
                username: 'Alex'
            } ]
        });

        await renderPage();

        const disableButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Disable');
        await act(async () => disableButton?.click());
        expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Disable invite?');
        expect(inviteAdminMocks.disableSignupInvite).not.toHaveBeenCalled();
        await act(async () => {
            Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Confirm action')?.click();
            await Promise.resolve();
        });
        expect(inviteAdminMocks.disableSignupInvite).toHaveBeenCalledWith('invite-a');

        const cancelVerification = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Cancel verification');
        await act(async () => cancelVerification?.click());
        expect(container.querySelector('[role="dialog"]')?.textContent).toContain('Cancel email verification?');
        expect(inviteAdminMocks.cancelVerification).not.toHaveBeenCalled();
        await act(async () => {
            Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Confirm action')?.click();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(inviteAdminMocks.cancelVerification).toHaveBeenCalledWith('private-user-id');
    });

    it('single-flights a settings save', async () => {
        inviteAdminMocks.getSignupSettings.mockResolvedValue(settingsFixture());
        inviteAdminMocks.saveSignupSettings.mockImplementation(() => new Promise(() => undefined));

        await renderPage();

        const saveButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === 'Save Signup Settings');
        const enabledCheckbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
        await act(async () => {
            enabledCheckbox?.click();
            await Promise.resolve();
        });
        await act(async () => {
            saveButton?.click();
            saveButton?.click();
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(inviteAdminMocks.saveSignupSettings).toHaveBeenCalledOnce();
    });

    it('protects dirty settings and resets to the confirmed server values', async () => {
        inviteAdminMocks.getSignupSettings.mockResolvedValue(settingsFixture());
        await renderPage();

        const enabledCheckbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
        const resetButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
            .find(button => button.textContent === 'Reset Changes');
        await act(async () => enabledCheckbox?.click());

        const beforeUnload = new Event('beforeunload', { cancelable: true });
        expect(window.dispatchEvent(beforeUnload)).toBe(false);
        expect(beforeUnload.defaultPrevented).toBe(true);
        expect(resetButton?.disabled).toBe(false);

        await act(async () => resetButton?.click());
        expect(enabledCheckbox?.checked).toBe(true);
        expect(resetButton?.disabled).toBe(true);
    });

    it('rejects a save when the authoritative managed settings changed', async () => {
        const baseline = settingsFixture();
        inviteAdminMocks.getSignupSettings
            .mockResolvedValueOnce(baseline)
            .mockResolvedValueOnce({ ...baseline, enabled: false });
        await renderPage();

        const enabledCheckbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
        await act(async () => enabledCheckbox?.click());
        const saveButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
            .find(button => button.textContent === 'Save Signup Settings');
        await act(async () => {
            saveButton?.click();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(container.textContent).toContain('changed on the server');
        expect(container.textContent).toContain('Reload Settings');
        expect(inviteAdminMocks.saveSignupSettings).not.toHaveBeenCalled();
    });

    it('clears a transient SMTP password after a failed save without exposing the error', async () => {
        inviteAdminMocks.getSignupSettings.mockResolvedValue(settingsFixture());
        inviteAdminMocks.saveSignupSettings.mockRejectedValue(new Error('token=secret C:\\private\\smtp.json'));
        await renderPage();

        const passwordInput = container.querySelector<HTMLInputElement>('input[type="password"]');
        await act(async () => {
            const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            valueSetter?.call(passwordInput, 'transient-password');
            passwordInput?.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const saveButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
            .find(button => button.textContent === 'Save Signup Settings');
        await act(async () => {
            saveButton?.click();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(passwordInput?.value).toBe('');
        expect(container.textContent).toContain('signup action could not be completed');
        expect(container.textContent).not.toContain('token=secret');
        expect(container.textContent).not.toContain('smtp.json');
    });
});
