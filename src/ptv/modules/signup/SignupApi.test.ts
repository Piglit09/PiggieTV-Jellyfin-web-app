import { beforeEach, describe, expect, it, vi } from 'vitest';

const signupApiMocks = vi.hoisted(() => ({
    getSettings: vi.fn(),
    getSignupSettings: vi.fn(),
    saveSignupSettings: vi.fn()
}));

vi.mock('../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: () => signupApiMocks,
    normalizePtvApiError: (error: unknown) => error instanceof Error ?
        { message: error.message } :
        { message: String(error) }
}));

import {
    getSignupErrorMessage,
    getSignupSettings,
    getSignupSettingsSnapshot,
    isAuthoritativeSignupAdminSettings,
    normalizeSignupAdminSettings,
    saveSignupSettings,
    type PtvSignupAdminSettingsResponse,
    type PtvSignupAdminSettingsPatch
} from './SignupApi';

function createCompleteSignupSettings(): PtvSignupAdminSettingsResponse {
    return {
        defaultEnabledFolderIds: [],
        defaultPolicyPresetId: 'standard',
        emailSettings: {
            enabled: false,
            fromAddress: '',
            fromName: 'PiggieTV',
            logoUrl: '/web/assets/logo/banner-light.png',
            passwordConfigured: false,
            publicBaseUrl: '',
            resetCodeMinutes: 15,
            resetSubject: 'Your PiggieTV password reset code',
            smtpHost: '',
            smtpPort: 587,
            useSsl: true,
            verificationLinkMinutes: 1440,
            verificationSubject: 'Verify your PiggieTV email'
        },
        enabled: true,
        ok: true,
        pendingResetCount: 0,
        pendingVerificationCount: 0,
        policyPresets: [{
            allowDownloads: false,
            allowLiveTv: false,
            allowRemoteControl: false,
            allowTranscoding: true,
            enableAllFolders: true,
            enabledFolderIds: [],
            id: 'standard',
            name: 'Standard User'
        }],
        users: []
    };
}

describe('signup administration settings normalization', () => {
    beforeEach(() => vi.clearAllMocks());

    it('supplies safe defaults for an incomplete plugin response', () => {
        const normalized = normalizeSignupAdminSettings({
            defaultPolicyPresetId: 'standard',
            enabled: true,
            ok: true
        });

        expect(normalized.defaultEnabledFolderIds).toEqual([]);
        expect(normalized.policyPresets).toEqual([]);
        expect(normalized.users).toEqual([]);
        expect(normalized.pendingResetCount).toBe(0);
        expect(normalized.emailSettings.publicBaseUrl).toBe('');
        expect(isAuthoritativeSignupAdminSettings(normalized)).toBe(false);
    });

    it('strips any password field returned by a malformed plugin response', () => {
        const normalized = normalizeSignupAdminSettings({
            emailSettings: {
                ...normalizeSignupAdminSettings().emailSettings,
                // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- malicious response fixture verifies that secrets are stripped.
                password: 'backend-secret'
            }
        });

        expect(normalized.emailSettings.password).toBeUndefined();
        expect(JSON.stringify(normalized)).not.toContain('backend-secret');
    });

    it('normalizes both loaded and saved responses at the API boundary', async () => {
        signupApiMocks.getSignupSettings.mockResolvedValue({ enabled: false });
        signupApiMocks.saveSignupSettings.mockResolvedValue({ ok: true });
        const request = {
            defaultEnabledFolderIds: [],
            defaultPolicyPresetId: 'standard',
            emailSettings: normalizeSignupAdminSettings().emailSettings,
            enabled: true
        } satisfies PtvSignupAdminSettingsPatch;

        await expect(getSignupSettings()).resolves.toMatchObject({
            enabled: false,
            policyPresets: [],
            users: []
        });
        await expect(saveSignupSettings(request)).resolves.toMatchObject({
            ok: true,
            policyPresets: [],
            users: []
        });
        expect(signupApiMocks.getSignupSettings).toHaveBeenCalledOnce();
        expect(signupApiMocks.getSettings).not.toHaveBeenCalled();
    });

    it('marks incomplete source documents unsafe for administrator writes', async () => {
        signupApiMocks.getSignupSettings.mockResolvedValue({ enabled: true });

        await expect(getSignupSettingsSnapshot({ bypassCache: true })).resolves.toMatchObject({
            authoritative: false,
            settings: { enabled: true }
        });
        expect(signupApiMocks.getSignupSettings).toHaveBeenCalledWith({ bypassCache: true });
    });

    it('allows an authoritative snapshot when the plugin omits an unset SMTP username', async () => {
        signupApiMocks.getSignupSettings.mockResolvedValue(createCompleteSignupSettings());

        await expect(getSignupSettingsSnapshot({ bypassCache: true })).resolves.toMatchObject({
            authoritative: true,
            settings: { emailSettings: { username: '' } }
        });
    });

    it.each([ null, '', 'admin@piggietv.com' ])('accepts an optional SMTP username of %s', username => {
        const response = createCompleteSignupSettings();
        response.emailSettings.username = username;

        expect(isAuthoritativeSignupAdminSettings(response)).toBe(true);
    });

    it.each([
        { label: 'number', username: 42 },
        { label: 'boolean', username: false },
        { label: 'object', username: {} },
        { label: 'array', username: [] }
    ])('rejects a $label SMTP username', async ({ username }) => {
        const response = createCompleteSignupSettings();
        signupApiMocks.getSignupSettings.mockResolvedValue({
            ...response,
            emailSettings: { ...response.emailSettings, username }
        });

        await expect(getSignupSettingsSnapshot()).resolves.toMatchObject({ authoritative: false });
    });

    it('keeps settings with a missing required SMTP field unsafe for administrator writes', async () => {
        const response = createCompleteSignupSettings();
        const emailSettings: Partial<PtvSignupAdminSettingsResponse['emailSettings']> = { ...response.emailSettings };
        delete emailSettings.smtpHost;
        signupApiMocks.getSignupSettings.mockResolvedValue({ ...response, emailSettings });

        await expect(getSignupSettingsSnapshot()).resolves.toMatchObject({ authoritative: false });
    });

    it('never returns raw backend error text to the UI', () => {
        expect(getSignupErrorMessage(new Error('token=secret C:\\private\\config.json')))
            .toBe('The signup action could not be completed.');
    });
});
