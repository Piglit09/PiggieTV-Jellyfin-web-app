import { getCurrentPtvPluginApiClient, normalizePtvApiError } from '../../core/pluginApi';

export type PtvSignupPolicyPreset = {
    allowDownloads: boolean;
    allowLiveTv: boolean;
    allowRemoteControl: boolean;
    allowTranscoding: boolean;
    enableAllFolders: boolean;
    enabledFolderIds: string[];
    id: string;
    name: string;
};

export type PtvSignupInviteUsageRecord = {
    email?: string | null;
    remoteAddress: string;
    usedAtUtc: string;
    userId: string;
    username: string;
};

export type PtvSignupInvite = {
    code?: string | null;
    codePreview: string;
    createdAtUtc: string;
    disabled: boolean;
    emailRequired: boolean;
    enabledFolderIds: string[];
    expiresAtUtc?: string | null;
    id: string;
    label: string;
    lockedUntilUtc?: string | null;
    maxUses: number;
    policyPresetId: string;
    usable: boolean;
    usageRecords: PtvSignupInviteUsageRecord[];
    usedCount: number;
};

export type PtvSignupInviteListResponse = {
    enabled: boolean;
    invites: PtvSignupInvite[];
    ok: boolean;
    policyPresets: PtvSignupPolicyPreset[];
};

export type PtvSignupEmailSettings = {
    enabled: boolean;
    fromAddress: string;
    fromName: string;
    logoUrl: string;
    password?: string | null;
    passwordConfigured: boolean;
    publicBaseUrl: string;
    resetCodeMinutes: number;
    resetSubject: string;
    smtpHost: string;
    smtpPort: number;
    useSsl: boolean;
    username?: string | null;
    verificationLinkMinutes: number;
    verificationSubject: string;
};

export type PtvSignupUser = {
    createdAtUtc: string;
    email: string;
    emailConfigured: boolean;
    policyPresetId: string;
    source: string;
    userId: string;
    username: string;
};

export type PtvSignupAdminSettingsResponse = {
    defaultEnabledFolderIds: string[];
    defaultPolicyPresetId: string;
    emailSettings: PtvSignupEmailSettings;
    enabled: boolean;
    ok: boolean;
    pendingResetCount: number;
    pendingVerificationCount: number;
    policyPresets: PtvSignupPolicyPreset[];
    users: PtvSignupUser[];
};

export type PtvSignupAdminSettingsSnapshot = Readonly<{
    authoritative: boolean;
    settings: PtvSignupAdminSettingsResponse;
}>;

const DEFAULT_SIGNUP_EMAIL_SETTINGS: PtvSignupEmailSettings = {
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
    username: '',
    verificationLinkMinutes: 1440,
    verificationSubject: 'Verify your PiggieTV email'
};

/**
 * Keeps the administration UI safe while the web client and plugin are being
 * upgraded independently. Older or partially initialized plugin responses may
 * omit collection fields that the current UI expects to iterate.
 */
export function normalizeSignupAdminSettings(
    response?: Partial<PtvSignupAdminSettingsResponse> | null
): PtvSignupAdminSettingsResponse {
    const defaultPolicyPresetId = typeof response?.defaultPolicyPresetId === 'string'
        && response.defaultPolicyPresetId.trim() ? response.defaultPolicyPresetId : 'standard';
    const safeEmailSettings = { ...(response?.emailSettings || {}) };
    // SMTP passwords are write-only. Never retain a password returned by a
    // malformed or older plugin response in component state.
    delete safeEmailSettings.password;

    return {
        defaultEnabledFolderIds: Array.isArray(response?.defaultEnabledFolderIds) ? response.defaultEnabledFolderIds : [],
        defaultPolicyPresetId,
        emailSettings: {
            ...DEFAULT_SIGNUP_EMAIL_SETTINGS,
            ...safeEmailSettings
        },
        enabled: response?.enabled ?? true,
        ok: response?.ok ?? true,
        pendingResetCount: typeof response?.pendingResetCount === 'number' ? response.pendingResetCount : 0,
        pendingVerificationCount: typeof response?.pendingVerificationCount === 'number' ? response.pendingVerificationCount : 0,
        policyPresets: Array.isArray(response?.policyPresets) ? response.policyPresets : [],
        users: Array.isArray(response?.users) ? response.users : []
    };
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function hasAuthoritativeEmailSettings(value: unknown): value is PtvSignupEmailSettings {
    if (!value || typeof value !== 'object') return false;
    const email = value as Partial<PtvSignupEmailSettings>;

    return typeof email.enabled === 'boolean'
        && typeof email.fromAddress === 'string'
        && typeof email.fromName === 'string'
        && typeof email.logoUrl === 'string'
        && typeof email.passwordConfigured === 'boolean'
        && typeof email.publicBaseUrl === 'string'
        && typeof email.resetCodeMinutes === 'number'
        && typeof email.resetSubject === 'string'
        && typeof email.smtpHost === 'string'
        && typeof email.smtpPort === 'number'
        && typeof email.useSsl === 'boolean'
        && (email.username === undefined || email.username === null || typeof email.username === 'string')
        && typeof email.verificationLinkMinutes === 'number'
        && typeof email.verificationSubject === 'string';
}

/**
 * A normalized legacy response is safe to render, but only a complete source
 * document is safe to use as the baseline for an administrator write.
 */
export function isAuthoritativeSignupAdminSettings(
    response?: Partial<PtvSignupAdminSettingsResponse> | null
) {
    if (!response || typeof response.enabled !== 'boolean'
        || typeof response.defaultPolicyPresetId !== 'string'
        || !isStringArray(response.defaultEnabledFolderIds)
        || !hasAuthoritativeEmailSettings(response.emailSettings)
        || !Array.isArray(response.policyPresets)) return false;

    return response.policyPresets.some(preset => preset
        && typeof preset.id === 'string'
        && preset.id === response.defaultPolicyPresetId
        && typeof preset.name === 'string'
        && typeof preset.allowDownloads === 'boolean'
        && typeof preset.allowLiveTv === 'boolean'
        && typeof preset.allowRemoteControl === 'boolean'
        && typeof preset.allowTranscoding === 'boolean'
        && typeof preset.enableAllFolders === 'boolean'
        && isStringArray(preset.enabledFolderIds));
}

export type PtvSignupValidationResponse = {
    emailRequired: boolean;
    label?: string | null;
    message: string;
    ok: boolean;
    policyPresetName?: string | null;
    valid: boolean;
};

export type PtvSignupCreateUserResponse = {
    message: string;
    ok: boolean;
    userId?: string | null;
    username?: string | null;
};

export type PtvSignupCreateInviteRequest = {
    emailRequired: boolean;
    enabledFolderIds: string[];
    expiresAtUtc?: string | null;
    label: string;
    maxUses: number;
    policyPresetId: string;
};

export type PtvSignupCreateUserRequest = {
    confirmPassword: string;
    email: string;
    inviteCode?: string;
    password: string;
    username: string;
};

export type PtvSignupEmailVerificationRequest = {
    token: string;
};

export type PtvSignupPasswordResetRequest = {
    email: string;
};

export type PtvSignupPasswordResetConfirmRequest = {
    code: string;
    confirmPassword: string;
    email: string;
    password: string;
};

export type PtvSignupAdminSettingsPatch = {
    defaultEnabledFolderIds: string[];
    defaultPolicyPresetId: string;
    emailSettings: PtvSignupEmailSettings;
    enabled: boolean;
    users?: Array<{
        email: string;
        userId: string;
    }>;
};

export type PtvSignupTestEmailRequest = {
    recipient?: string;
    referenceUrl?: string;
};

function getSignupPluginApi() {
    const pluginApi = getCurrentPtvPluginApiClient();

    if (!pluginApi) {
        throw new Error('PiggieTV signup service is unavailable until a Jellyfin server is selected.');
    }

    return pluginApi;
}

export function getSignupErrorMessage(error: unknown) {
    const normalized = normalizePtvApiError(error);

    switch (normalized.kind) {
        case 'unauthorized':
        case 'forbidden':
            return 'Administrator permission is required for this signup action.';
        case 'missing':
            return 'PiggieTV signup is not available on this server.';
        case 'network':
        case 'timeout':
            return 'PiggieTV signup is temporarily unavailable. Try again.';
        default:
            return normalized.status === 400 ?
                'The signup request was rejected. Review the entered values and try again.' :
                'The signup action could not be completed.';
    }
}

export function createSignupUser(request: PtvSignupCreateUserRequest) {
    return getSignupPluginApi().createSignupUser<PtvSignupCreateUserResponse, PtvSignupCreateUserRequest>(request);
}

export function verifySignupEmail(request: PtvSignupEmailVerificationRequest) {
    return getSignupPluginApi().verifySignupEmail<PtvSignupCreateUserResponse, PtvSignupEmailVerificationRequest>(request);
}

export function requestSignupPasswordReset(request: PtvSignupPasswordResetRequest) {
    return getSignupPluginApi().requestSignupPasswordReset<PtvSignupCreateUserResponse, PtvSignupPasswordResetRequest>(request);
}

export function confirmSignupPasswordReset(request: PtvSignupPasswordResetConfirmRequest) {
    return getSignupPluginApi().confirmSignupPasswordReset<PtvSignupCreateUserResponse, PtvSignupPasswordResetConfirmRequest>(request);
}

export async function getSignupSettingsSnapshot(
    options: Readonly<{ bypassCache?: boolean }> = {}
): Promise<PtvSignupAdminSettingsSnapshot> {
    const response = await getSignupPluginApi().getSignupSettings<Partial<PtvSignupAdminSettingsResponse>>(options);
    return {
        authoritative: isAuthoritativeSignupAdminSettings(response),
        settings: normalizeSignupAdminSettings(response)
    };
}

export async function getSignupSettings() {
    return (await getSignupSettingsSnapshot()).settings;
}

export async function saveSignupSettings(request: PtvSignupAdminSettingsPatch) {
    const response = await getSignupPluginApi().saveSignupSettings<Partial<PtvSignupAdminSettingsResponse>, PtvSignupAdminSettingsPatch>(request);
    return normalizeSignupAdminSettings(response);
}

export function sendSignupTestEmail(request: PtvSignupTestEmailRequest) {
    return getSignupPluginApi().sendSignupTestEmail<PtvSignupCreateUserResponse, PtvSignupTestEmailRequest>(request);
}

export function getSignupInvites(options: Readonly<{ bypassCache?: boolean }> = {}) {
    return getSignupPluginApi().getSignupInvites<PtvSignupInviteListResponse>(options);
}

export function createSignupInvite(request: PtvSignupCreateInviteRequest) {
    return getSignupPluginApi().createSignupInvite<PtvSignupInvite, PtvSignupCreateInviteRequest>(request);
}

export function disableSignupInvite(inviteId: string) {
    return getSignupPluginApi().disableSignupInvite<PtvSignupInvite>(inviteId);
}

export function deleteSignupInvite(inviteId: string) {
    return getSignupPluginApi().deleteSignupInvite<void>(inviteId);
}
