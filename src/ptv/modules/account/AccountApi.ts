import { getCurrentPtvPluginApiClient, normalizePtvApiError } from '../../core/pluginApi';

export type PtvAccountProfile = {
    email?: string | null;
    emailVerified: boolean;
    emailVerifiedAt?: string | null;
    enrollmentPromptEligible: boolean;
    jellyfinUserId: string;
    ok: boolean;
    pendingEmail?: string | null;
    pendingEmailExpiresAt?: string | null;
    pendingEmailStatus?: string | null;
    recoveryEmail?: string | null;
    username: string;
};

export type PtvAccountOperation = {
    code: string;
    message: string;
    ok: boolean;
    profile?: PtvAccountProfile | null;
};

export type PtvAccountPasswordResetOperation = {
    message: string;
    ok: boolean;
};

export type PtvAccountPasswordResetConfirmRequest = {
    code: string;
    confirmPassword: string;
    email: string;
    password: string;
};

export type PtvAccountBackupStatus = {
    backupId: string;
    backupPath: string;
    backupSizeBytes: number;
    durationMilliseconds: number;
    lastRunAtUtc?: string | null;
    lastSuccessAtUtc?: string | null;
    message: string;
    overdue: boolean;
    pendingVerificationsBackedUp: number;
    profilesBackedUp: number;
    result: string;
    verificationStatus: string;
    verifiedEmailsBackedUp: number;
};

export type PtvAccountMigration = {
    ambiguousRecordsSkipped: number;
    completedAtUtc?: string | null;
    existingProfiles: number;
    jellyfinUsersDiscovered: number;
    orphanedRecordsFound: number;
    unverifiedEmailsRecovered: number;
    usersStillMissingEmail: number;
    verifiedEmailsRecovered: number;
    version: number;
};

export type PtvAccountAdminUser = {
    emailStatus: 'verified' | 'missing' | 'pending' | 'expired' | 'failed' | 'reverification_required';
    jellyfinUserId: string;
    lastProfileSync?: string | null;
    lastProfileSyncAtUtc?: string | null;
    maskedEmail?: string | null;
    profileStatus: 'present' | 'missing';
    username: string;
};

export type PtvAccountAdminUserSummary = {
    email?: string | null;
    emailStatus: 'verified' | 'missing' | 'pending' | 'expired' | 'failed' | 'reverification_required';
    emailVerified: boolean;
    emailVerifiedAt?: string | null;
    jellyfinUserId: string;
    maskedEmail?: string | null;
    profileStatus: 'present' | 'missing';
};

export type PtvAccountAdminUsersResponse = {
    ok: boolean;
    users: PtvAccountAdminUserSummary[];
};

export type PtvAccountAdminHealth = {
    backup: PtvAccountBackupStatus;
    expiredVerifications: number;
    failedVerifications: number;
    migration: PtvAccountMigration;
    missingEmails: number;
    orphanedProfiles: number;
    pendingVerifications: number;
    profileCountMismatch: boolean;
    totalJellyfinUsers: number;
    totalProfiles: number;
    users: PtvAccountAdminUser[];
    verifiedEmails: number;
};

export type PtvAccountBackupOperation = {
    backupId: string;
    code: string;
    dryRun: boolean;
    message: string;
    ok: boolean;
    verified: boolean;
};

function getAccountPluginApi() {
    const api = getCurrentPtvPluginApiClient();
    if (!api) throw new Error('PiggieTV account service is unavailable until a service is connected.');
    return api;
}

export function getAccountErrorMessage(error: unknown) {
    return normalizePtvApiError(error).message || 'PiggieTV account service is unavailable.';
}

export function getPtvAccountIdentityKey() {
    const api = getAccountPluginApi();
    const serverId = api.getCurrentServerId() || 'current-server';
    const userId = api.getCurrentUserId() || '';
    return userId ? `${serverId}:${userId}` : '';
}

export function getPtvAccountProfile() {
    return getAccountPluginApi().getAccountProfile<PtvAccountProfile>();
}

export function startPtvAccountEmailVerification(email: string) {
    return getAccountPluginApi().startAccountEmailVerification<PtvAccountOperation, { email: string }>({ email });
}

export function resendPtvAccountEmailVerification() {
    return getAccountPluginApi().resendAccountEmailVerification<PtvAccountOperation>();
}

export function cancelPtvAccountEmailVerification() {
    return getAccountPluginApi().cancelAccountEmailVerification<PtvAccountOperation>();
}

export function verifyPtvAccountEmail(token: string) {
    return getAccountPluginApi().verifyAccountEmail<PtvAccountOperation, { token: string }>({ token });
}

export function requestPtvAccountPasswordReset(email: string) {
    return getAccountPluginApi().requestSignupPasswordReset<PtvAccountPasswordResetOperation, { email: string }>({ email });
}

export function confirmPtvAccountPasswordReset(request: PtvAccountPasswordResetConfirmRequest) {
    return getAccountPluginApi().confirmSignupPasswordReset<
        PtvAccountPasswordResetOperation,
        PtvAccountPasswordResetConfirmRequest
    >(request);
}

export function getPtvAccountAdminHealth() {
    return getAccountPluginApi().getAccountAdminHealth<PtvAccountAdminHealth>();
}

export function getPtvAccountAdminUsers(options?: { signal?: AbortSignal }) {
    return getAccountPluginApi().getAccountAdminUsers<PtvAccountAdminUsersResponse>(options);
}

export function cancelPtvAccountAdminVerification(jellyfinUserId: string) {
    return getAccountPluginApi().cancelAccountAdminVerification<PtvAccountOperation>(jellyfinUserId);
}

export function createPtvAccountBackup() {
    return getAccountPluginApi().createAccountBackup<PtvAccountBackupOperation>();
}

export function verifyPtvAccountBackup(backupId: string) {
    return getAccountPluginApi().verifyAccountBackup<PtvAccountBackupOperation, { backupId: string }>({ backupId });
}

export function restorePtvAccountBackup(backupId: string, dryRun = true, confirm = false) {
    return getAccountPluginApi().restoreAccountBackup<PtvAccountBackupOperation, {
        backupId: string;
        confirm: boolean;
        dryRun: boolean;
    }>({ backupId, confirm, dryRun });
}
