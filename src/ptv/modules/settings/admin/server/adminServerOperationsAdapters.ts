import type { AuthenticationInfo } from '@jellyfin/sdk/lib/generated-client/models/authentication-info';
import type { BackupManifestDto } from '@jellyfin/sdk/lib/generated-client/models/backup-manifest-dto';
import type { LogFile } from '@jellyfin/sdk/lib/generated-client/models/log-file';

import type {
    PtvAccountBackupOperation,
    PtvAccountBackupStatus
} from '../../../account/AccountApi';
import {
    ADMIN_API_KEY_MASK,
    ADMIN_SERVER_LOG_RENDER_LIMIT_BYTES,
    AdminServerOperationsError,
    type PtvAdminAccountBackup,
    type PtvAdminAccountBackupOperation,
    type PtvAdminApiKey,
    type PtvAdminBackup,
    type PtvAdminBackupOptions,
    type PtvAdminServerLog,
    type PtvAdminServerLogDetail
} from './adminServerOperationsModel';

function textOrNull(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nonNegativeNumberOrNull(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function booleanOrNull(value: unknown) {
    return typeof value === 'boolean' ? value : null;
}

function requireOpaqueId(value: unknown) {
    const id = textOrNull(value);
    if (!id) {
        throw new AdminServerOperationsError(
            'invalid-response',
            'Server administration information was incomplete.'
        );
    }
    return id;
}

export function normalizeAdminApiKey(
    raw: AuthenticationInfo,
    opaqueId: string
): PtvAdminApiKey {
    if (!raw || typeof raw !== 'object') {
        throw new AdminServerOperationsError('invalid-response', 'API keys could not be read.');
    }
    return {
        appName: textOrNull(raw.AppName),
        createdAt: textOrNull(raw.DateCreated),
        id: requireOpaqueId(opaqueId),
        tokenMask: ADMIN_API_KEY_MASK
    };
}

export function normalizeAdminApiKeys(
    raw: readonly AuthenticationInfo[],
    opaqueIds: readonly string[]
): PtvAdminApiKey[] {
    if (!Array.isArray(raw) || !Array.isArray(opaqueIds) || raw.length !== opaqueIds.length) {
        throw new AdminServerOperationsError('invalid-response', 'API keys could not be loaded.');
    }
    return raw.map((item, index) => normalizeAdminApiKey(item, opaqueIds[index]));
}

function normalizeBackupOptions(raw: BackupManifestDto['Options']): PtvAdminBackupOptions {
    return {
        database: booleanOrNull(raw?.Database),
        metadata: booleanOrNull(raw?.Metadata),
        subtitles: booleanOrNull(raw?.Subtitles),
        trickplay: booleanOrNull(raw?.Trickplay)
    };
}

export function normalizeAdminBackup(
    raw: BackupManifestDto,
    opaqueId: string
): PtvAdminBackup {
    if (!raw || typeof raw !== 'object') {
        throw new AdminServerOperationsError('invalid-response', 'Backup information could not be read.');
    }
    return {
        backupEngineVersion: textOrNull(raw.BackupEngineVersion),
        createdAt: textOrNull(raw.DateCreated),
        id: requireOpaqueId(opaqueId),
        options: normalizeBackupOptions(raw.Options),
        serverVersion: textOrNull(raw.ServerVersion)
    };
}

export function normalizeAdminBackups(
    raw: readonly BackupManifestDto[],
    opaqueIds: readonly string[]
): PtvAdminBackup[] {
    if (!Array.isArray(raw) || !Array.isArray(opaqueIds) || raw.length !== opaqueIds.length) {
        throw new AdminServerOperationsError('invalid-response', 'Backups could not be loaded.');
    }
    return raw.map((item, index) => normalizeAdminBackup(item, opaqueIds[index]))
        .sort((left, right) => {
            const leftTime = left.createdAt ? Date.parse(left.createdAt) : Number.NaN;
            const rightTime = right.createdAt ? Date.parse(right.createdAt) : Number.NaN;
            return Number.isFinite(leftTime) && Number.isFinite(rightTime) ? rightTime - leftTime : 0;
        });
}

export function normalizePtvAccountBackupStatus(
    raw: PtvAccountBackupStatus
): PtvAdminAccountBackup {
    if (!raw || typeof raw !== 'object') {
        throw new AdminServerOperationsError(
            'invalid-response',
            'PiggieTV account backup status could not be read.'
        );
    }
    return {
        available: Boolean(textOrNull(raw.backupId)),
        durationMilliseconds: nonNegativeNumberOrNull(raw.durationMilliseconds),
        id: 'latest',
        lastRunAt: textOrNull(raw.lastRunAtUtc),
        lastSuccessAt: textOrNull(raw.lastSuccessAtUtc),
        message: textOrNull(raw.message),
        overdue: booleanOrNull(raw.overdue),
        pendingVerificationsBackedUp: nonNegativeNumberOrNull(raw.pendingVerificationsBackedUp),
        profilesBackedUp: nonNegativeNumberOrNull(raw.profilesBackedUp),
        result: textOrNull(raw.result),
        sizeBytes: nonNegativeNumberOrNull(raw.backupSizeBytes),
        verificationStatus: textOrNull(raw.verificationStatus),
        verifiedEmailsBackedUp: nonNegativeNumberOrNull(raw.verifiedEmailsBackedUp)
    };
}

export function normalizePtvAccountBackupOperation(
    raw: PtvAccountBackupOperation
): PtvAdminAccountBackupOperation {
    if (!raw || typeof raw !== 'object' || typeof raw.ok !== 'boolean'
        || typeof raw.verified !== 'boolean' || typeof raw.dryRun !== 'boolean') {
        throw new AdminServerOperationsError(
            'invalid-response',
            'PiggieTV account backup operation returned an incomplete response.'
        );
    }
    return {
        code: textOrNull(raw.code),
        dryRun: raw.dryRun,
        message: textOrNull(raw.message),
        ok: raw.ok,
        verified: raw.verified
    };
}

export function normalizeAdminServerLog(raw: LogFile, opaqueId: string): PtvAdminServerLog {
    if (!raw || typeof raw !== 'object') {
        throw new AdminServerOperationsError('invalid-response', 'Server log information could not be read.');
    }
    const name = typeof raw.Name === 'string' && raw.Name.trim() ? raw.Name : null;
    if (!name) {
        throw new AdminServerOperationsError('invalid-response', 'Server log information was incomplete.');
    }
    return {
        createdAt: textOrNull(raw.DateCreated),
        id: requireOpaqueId(opaqueId),
        modifiedAt: textOrNull(raw.DateModified),
        name,
        sizeBytes: nonNegativeNumberOrNull(raw.Size)
    };
}

export function normalizeAdminServerLogs(
    raw: readonly LogFile[],
    opaqueIds: readonly string[]
): PtvAdminServerLog[] {
    if (!Array.isArray(raw) || !Array.isArray(opaqueIds) || raw.length !== opaqueIds.length) {
        throw new AdminServerOperationsError('invalid-response', 'Server logs could not be loaded.');
    }
    return raw.map((item, index) => normalizeAdminServerLog(item, opaqueIds[index]));
}

function capUtf8Text(text: string, byteLimit: number) {
    const encoder = new TextEncoder();
    const totalBytes = encoder.encode(text).byteLength;
    if (totalBytes <= byteLimit) return { renderedText: text, totalBytes, truncated: false };

    let renderedText = '';
    let renderedBytes = 0;
    for (const character of text) {
        const characterBytes = encoder.encode(character).byteLength;
        if (renderedBytes + characterBytes > byteLimit) break;
        renderedText += character;
        renderedBytes += characterBytes;
    }
    return { renderedText, totalBytes, truncated: true };
}

export function normalizeAdminServerLogDetail(
    opaqueId: string,
    name: string,
    fullText: string,
    byteLimit = ADMIN_SERVER_LOG_RENDER_LIMIT_BYTES
): PtvAdminServerLogDetail {
    if (!Number.isSafeInteger(byteLimit) || byteLimit < 1 || typeof fullText !== 'string') {
        throw new AdminServerOperationsError('invalid-input', 'Choose a valid server log.');
    }
    return {
        id: requireOpaqueId(opaqueId),
        name: textOrNull(name) || 'Server log',
        ...capUtf8Text(fullText, byteLimit)
    };
}
