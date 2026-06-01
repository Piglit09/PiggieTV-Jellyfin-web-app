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
    verificationBaseUrl?: string;
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

    return normalized.message || 'PiggieTV signup service is unavailable.';
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

export function getSignupSettings() {
    return getSignupPluginApi().getSignupSettings<PtvSignupAdminSettingsResponse>();
}

export function saveSignupSettings(request: PtvSignupAdminSettingsPatch) {
    return getSignupPluginApi().saveSignupSettings<PtvSignupAdminSettingsResponse, PtvSignupAdminSettingsPatch>(request);
}

export function sendSignupTestEmail(request: PtvSignupTestEmailRequest) {
    return getSignupPluginApi().sendSignupTestEmail<PtvSignupCreateUserResponse, PtvSignupTestEmailRequest>(request);
}

export function getSignupInvites() {
    return getSignupPluginApi().getSignupInvites<PtvSignupInviteListResponse>();
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
