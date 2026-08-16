import type { Api } from '@jellyfin/sdk';
import { BackupApi } from '@jellyfin/sdk/lib/generated-client/api/backup-api';
import type { AuthenticationInfo } from '@jellyfin/sdk/lib/generated-client/models/authentication-info';
import type { BackupManifestDto } from '@jellyfin/sdk/lib/generated-client/models/backup-manifest-dto';
import type { LogFile } from '@jellyfin/sdk/lib/generated-client/models/log-file';
import { getApiKeyApi } from '@jellyfin/sdk/lib/utils/api/api-key-api';
import { getSystemApi } from '@jellyfin/sdk/lib/utils/api/system-api';

import {
    createPtvAccountBackup,
    getPtvAccountAdminHealth,
    restorePtvAccountBackup,
    verifyPtvAccountBackup
} from '../../../account/AccountApi';
import {
    normalizeAdminApiKeys,
    normalizeAdminBackup,
    normalizeAdminBackups,
    normalizeAdminServerLogDetail,
    normalizeAdminServerLogs,
    normalizePtvAccountBackupOperation,
    normalizePtvAccountBackupStatus
} from './adminServerOperationsAdapters';
import {
    AdminServerOperationsError,
    type PtvAdminAccountBackup,
    type PtvAdminAccountBackupOperation,
    type PtvAdminApiKey,
    type PtvAdminApiKeyCreationResult,
    type PtvAdminBackup,
    type PtvAdminBackupCreateOptions,
    type PtvAdminServerLog,
    type PtvAdminServerLogDetail,
    type PtvAdminServerLogDownload
} from './adminServerOperationsModel';

type ApiKeySecret = {
    fingerprint: string;
    token: string;
};

type BackupSecret = {
    fingerprint: string;
    path: string;
};

type OperationsVault = {
    apiKeys: Map<string, ApiKeySecret>;
    backups: Map<string, BackupSecret>;
    logs: Map<string, string>;
    sequence: number;
};

const vaults = new WeakMap<Api, OperationsVault>();

function getVault(api: Api) {
    let vault = vaults.get(api);
    if (!vault) {
        vault = {
            apiKeys: new Map(),
            backups: new Map(),
            logs: new Map(),
            sequence: 0
        };
        vaults.set(api, vault);
    }
    return vault;
}

function nextOpaqueId(vault: OperationsVault, prefix: 'key' | 'backup' | 'log') {
    vault.sequence += 1;
    return `${prefix}-${vault.sequence.toString(36)}`;
}

function text(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Retains exact server identifiers while rejecting absent/whitespace-only values. */
function exactServerText(value: unknown) {
    return typeof value === 'string' && value.trim() ? value : null;
}

function findOpaqueId<T>(items: Map<string, T>, matches: (item: T) => boolean) {
    for (const [ id, item ] of items) {
        if (matches(item)) return id;
    }
    return null;
}

function requireSelection(rowId: string, kind: string) {
    const id = text(rowId);
    if (!id) {
        throw new AdminServerOperationsError('invalid-input', `Choose a valid ${kind}.`);
    }
    return id;
}

function isAbortError(error: unknown) {
    return typeof error === 'object' && error !== null && (
        Reflect.get(error, 'name') === 'AbortError'
        || Reflect.get(error, 'name') === 'CanceledError'
        || Reflect.get(error, 'code') === 'ERR_CANCELED'
    );
}

function loadFailure(error: unknown, message: string): never {
    if (error instanceof AdminServerOperationsError || isAbortError(error)) throw error;
    throw new AdminServerOperationsError('load-unavailable', message);
}

function operationFailure(error: unknown, message: string): never {
    if (error instanceof AdminServerOperationsError || isAbortError(error)) throw error;
    throw new AdminServerOperationsError('operation-failed', message);
}

function keyFingerprint(raw: AuthenticationInfo) {
    return JSON.stringify([ raw.Id ?? null, raw.AppName ?? null, raw.DateCreated ?? null ]);
}

function synchronizeApiKeys(api: Api, raw: readonly AuthenticationInfo[]) {
    const vault = getVault(api);
    const nextKeys = new Map<string, ApiKeySecret>();
    const opaqueIds = raw.map(item => {
        const token = exactServerText(item?.AccessToken);
        if (!token) {
            throw new AdminServerOperationsError('invalid-response', 'API key information was incomplete.');
        }
        const id = findOpaqueId(vault.apiKeys, secret => secret.token === token)
            || nextOpaqueId(vault, 'key');
        nextKeys.set(id, { fingerprint: keyFingerprint(item), token });
        return id;
    });
    vault.apiKeys = nextKeys;
    return opaqueIds;
}

async function fetchRawApiKeys(api: Api, signal?: AbortSignal) {
    const response = await getApiKeyApi(api).getKeys({ signal });
    if (!Array.isArray(response.data?.Items)) {
        throw new AdminServerOperationsError('invalid-response', 'API keys could not be loaded.');
    }
    return response.data.Items;
}

/** Returns only masked API-key rows; raw tokens remain in the private per-Api vault. */
export async function loadAdminApiKeys(api: Api, signal?: AbortSignal): Promise<PtvAdminApiKey[]> {
    try {
        const raw = await fetchRawApiKeys(api, signal);
        return normalizeAdminApiKeys(raw, synchronizeApiKeys(api, raw));
    } catch (error) {
        return loadFailure(error, 'API keys could not be loaded.');
    }
}

/** Jellyfin returns no created token, so success is followed by an authoritative list read. */
export async function createAdminApiKey(
    api: Api,
    appName: string,
    signal?: AbortSignal
): Promise<PtvAdminApiKeyCreationResult> {
    const app = text(appName);
    if (!app) throw new AdminServerOperationsError('invalid-input', 'Enter an application name.');
    try {
        const before = await fetchRawApiKeys(api, signal);
        synchronizeApiKeys(api, before);
        const existingTokens = new Set(before.map(item => exactServerText(item.AccessToken)));
        await getApiKeyApi(api).createKey({ app }, { signal });
        const after = await fetchRawApiKeys(api, signal);
        const rows = normalizeAdminApiKeys(after, synchronizeApiKeys(api, after));
        const added = after.filter(item => {
            const token = exactServerText(item.AccessToken);
            return token !== null && !existingTokens.has(token);
        });
        const addedToken = added.length === 1 ? exactServerText(added[0].AccessToken) : null;
        const addedApp = added.length === 1 ? text(added[0].AppName) : null;
        const reveal = addedToken && addedApp === app ? { appName: app, token: addedToken } : null;
        return { reveal, rows };
    } catch (error) {
        return operationFailure(error, 'The API key could not be created.');
    }
}

/** Fresh-checks the exact protected token and stable metadata before revocation. */
export async function revokeAdminApiKey(
    api: Api,
    rowId: string,
    signal?: AbortSignal
): Promise<void> {
    const id = requireSelection(rowId, 'API key');
    const vault = getVault(api);
    const selected = vault.apiKeys.get(id);
    if (!selected) throw new AdminServerOperationsError('not-found', 'This API key is no longer available.');

    try {
        const raw = await fetchRawApiKeys(api, signal);
        synchronizeApiKeys(api, raw);
        const current = vault.apiKeys.get(id);
        if (!current || current.token !== selected.token || current.fingerprint !== selected.fingerprint) {
            throw new AdminServerOperationsError(
                'state-changed',
                'This API key changed on the server. Reload before revoking it.'
            );
        }
        await getApiKeyApi(api).revokeKey({ key: current.token }, { signal });
        vault.apiKeys.delete(id);
    } catch (error) {
        return operationFailure(error, 'The API key could not be revoked.');
    }
}

function backupFingerprint(raw: BackupManifestDto) {
    return JSON.stringify([
        raw.ServerVersion ?? null,
        raw.BackupEngineVersion ?? null,
        raw.DateCreated ?? null,
        raw.Options?.Database ?? null,
        raw.Options?.Metadata ?? null,
        raw.Options?.Subtitles ?? null,
        raw.Options?.Trickplay ?? null
    ]);
}

function synchronizeBackups(api: Api, raw: readonly BackupManifestDto[]) {
    const vault = getVault(api);
    const nextBackups = new Map<string, BackupSecret>();
    const opaqueIds = raw.map(item => {
        const path = exactServerText(item?.Path);
        if (!path) {
            throw new AdminServerOperationsError('invalid-response', 'Backup information was incomplete.');
        }
        const id = findOpaqueId(vault.backups, backup => backup.path === path)
            || nextOpaqueId(vault, 'backup');
        nextBackups.set(id, { fingerprint: backupFingerprint(item), path });
        return id;
    });
    vault.backups = nextBackups;
    return opaqueIds;
}

function backupApi(api: Api) {
    return new BackupApi(api.configuration, undefined, api.axiosInstance);
}

async function fetchRawBackups(api: Api, signal?: AbortSignal) {
    const response = await backupApi(api).listBackups({ signal });
    if (!Array.isArray(response.data)) {
        throw new AdminServerOperationsError('invalid-response', 'Backups could not be loaded.');
    }
    return response.data;
}

export async function loadAdminBackups(api: Api, signal?: AbortSignal): Promise<PtvAdminBackup[]> {
    try {
        const raw = await fetchRawBackups(api, signal);
        return normalizeAdminBackups(raw, synchronizeBackups(api, raw));
    } catch (error) {
        return loadFailure(error, 'Backups could not be loaded.');
    }
}

function validateBackupOptions(options: PtvAdminBackupCreateOptions) {
    if (!options || [
        options.database,
        options.metadata,
        options.subtitles,
        options.trickplay
    ].some(value => typeof value !== 'boolean') || options.database !== true) {
        throw new AdminServerOperationsError('invalid-input', 'Choose valid backup contents.');
    }
}

export async function createAdminBackup(
    api: Api,
    options: PtvAdminBackupCreateOptions,
    signal?: AbortSignal
): Promise<PtvAdminBackup> {
    validateBackupOptions(options);
    try {
        const response = await backupApi(api).createBackup({
            backupOptionsDto: {
                Database: options.database,
                Metadata: options.metadata,
                Subtitles: options.subtitles,
                Trickplay: options.trickplay
            }
        }, { signal });
        const path = exactServerText(response.data?.Path);
        if (!path) {
            throw new AdminServerOperationsError('invalid-response', 'The created backup was incomplete.');
        }
        const vault = getVault(api);
        const id = findOpaqueId(vault.backups, backup => backup.path === path)
            || nextOpaqueId(vault, 'backup');
        vault.backups.set(id, { fingerprint: backupFingerprint(response.data), path });
        return normalizeAdminBackup(response.data, id);
    } catch (error) {
        return operationFailure(error, 'The backup could not be created.');
    }
}

async function requireFreshBackup(api: Api, rowId: string, signal?: AbortSignal) {
    const id = requireSelection(rowId, 'backup');
    const vault = getVault(api);
    const selected = vault.backups.get(id);
    if (!selected) throw new AdminServerOperationsError('not-found', 'This backup is no longer available.');

    const raw = await fetchRawBackups(api, signal);
    synchronizeBackups(api, raw);
    const current = vault.backups.get(id);
    if (!current || current.path !== selected.path || current.fingerprint !== selected.fingerprint) {
        throw new AdminServerOperationsError(
            'state-changed',
            'This backup changed on the server. Reload before continuing.'
        );
    }
    return { id, ...current };
}

export async function loadAdminBackupManifest(
    api: Api,
    rowId: string,
    signal?: AbortSignal
): Promise<PtvAdminBackup> {
    try {
        const selected = await requireFreshBackup(api, rowId, signal);
        const response = await backupApi(api).getBackup({ path: selected.path }, { signal });
        if (exactServerText(response.data?.Path) !== selected.path) {
            throw new AdminServerOperationsError('state-changed', 'The selected backup is no longer available.');
        }
        return normalizeAdminBackup(response.data, selected.id);
    } catch (error) {
        return loadFailure(error, 'Backup information could not be loaded.');
    }
}

/** Starts Jellyfin's server-restarting restore using only a fresh server-returned path. */
export async function restoreAdminBackup(
    api: Api,
    rowId: string,
    signal?: AbortSignal
): Promise<void> {
    try {
        const selected = await requireFreshBackup(api, rowId, signal);
        const manifest = await backupApi(api).getBackup({ path: selected.path }, { signal });
        if (exactServerText(manifest.data?.Path) !== selected.path
            || backupFingerprint(manifest.data) !== selected.fingerprint) {
            throw new AdminServerOperationsError(
                'state-changed',
                'This backup changed on the server. Reload before restoring it.'
            );
        }
        await backupApi(api).startRestoreBackup({
            backupRestoreRequestDto: { ArchiveFileName: selected.path }
        }, { signal });
    } catch (error) {
        return operationFailure(error, 'The backup restore could not be started.');
    }
}

export async function loadPtvLatestAccountBackup(): Promise<PtvAdminAccountBackup> {
    try {
        const health = await getPtvAccountAdminHealth();
        return normalizePtvAccountBackupStatus(health.backup);
    } catch (error) {
        return loadFailure(error, 'PiggieTV account backup status could not be loaded.');
    }
}

export async function createLatestPtvAccountBackup(): Promise<PtvAdminAccountBackupOperation> {
    try {
        return normalizePtvAccountBackupOperation(await createPtvAccountBackup());
    } catch (error) {
        return operationFailure(error, 'The PiggieTV account backup could not be created.');
    }
}

async function getLatestPtvAccountBackupId() {
    const health = await getPtvAccountAdminHealth();
    const backupId = exactServerText(health?.backup?.backupId);
    if (!backupId) {
        throw new AdminServerOperationsError('not-found', 'No PiggieTV account backup is available.');
    }
    return backupId;
}

export async function verifyLatestPtvAccountBackup(): Promise<PtvAdminAccountBackupOperation> {
    try {
        const backupId = await getLatestPtvAccountBackupId();
        return normalizePtvAccountBackupOperation(await verifyPtvAccountBackup(backupId));
    } catch (error) {
        return operationFailure(error, 'The PiggieTV account backup could not be verified.');
    }
}

export async function restoreLatestPtvAccountBackup(
    dryRun = true,
    confirm = false
): Promise<PtvAdminAccountBackupOperation> {
    if (!dryRun && !confirm) {
        throw new AdminServerOperationsError(
            'invalid-input',
            'Confirm the live PiggieTV account restore before continuing.'
        );
    }
    try {
        const backupId = await getLatestPtvAccountBackupId();
        return normalizePtvAccountBackupOperation(
            await restorePtvAccountBackup(backupId, dryRun, confirm)
        );
    } catch (error) {
        return operationFailure(error, 'The PiggieTV account backup could not be restored.');
    }
}

function synchronizeLogs(api: Api, raw: readonly LogFile[]) {
    const vault = getVault(api);
    const nextLogs = new Map<string, string>();
    const opaqueIds = raw.map(item => {
        const name = exactServerText(item?.Name);
        if (!name) {
            throw new AdminServerOperationsError('invalid-response', 'Server log information was incomplete.');
        }
        const id = findOpaqueId(vault.logs, storedName => storedName === name)
            || nextOpaqueId(vault, 'log');
        nextLogs.set(id, name);
        return id;
    });
    vault.logs = nextLogs;
    return opaqueIds;
}

async function fetchRawLogs(api: Api, signal?: AbortSignal) {
    const response = await getSystemApi(api).getServerLogs({ signal });
    if (!Array.isArray(response.data)) {
        throw new AdminServerOperationsError('invalid-response', 'Server logs could not be loaded.');
    }
    return response.data;
}

export async function loadAdminServerLogs(
    api: Api,
    signal?: AbortSignal
): Promise<PtvAdminServerLog[]> {
    try {
        const raw = await fetchRawLogs(api, signal);
        return normalizeAdminServerLogs(raw, synchronizeLogs(api, raw));
    } catch (error) {
        return loadFailure(error, 'Server logs could not be loaded.');
    }
}

async function requireFreshLog(api: Api, rowId: string, signal?: AbortSignal) {
    const id = requireSelection(rowId, 'server log');
    const vault = getVault(api);
    const selectedName = vault.logs.get(id);
    if (!selectedName) {
        throw new AdminServerOperationsError('not-found', 'This server log is no longer available.');
    }
    const raw = await fetchRawLogs(api, signal);
    synchronizeLogs(api, raw);
    if (vault.logs.get(id) !== selectedName || !raw.some(item => item.Name === selectedName)) {
        throw new AdminServerOperationsError('state-changed', 'This server log is no longer available.');
    }
    return { id, name: selectedName };
}

async function readLogText(data: unknown) {
    if (typeof data === 'string') return data;
    if (typeof Blob !== 'undefined' && data instanceof Blob) return data.text();
    if (data && typeof data === 'object') return JSON.stringify(data, null, 2);
    throw new AdminServerOperationsError('invalid-response', 'Server log content could not be read.');
}

async function fetchSelectedLogText(api: Api, rowId: string, signal?: AbortSignal) {
    const selected = await requireFreshLog(api, rowId, signal);
    const response = await getSystemApi(api).getLogFile({ name: selected.name }, { signal });
    return { ...selected, text: await readLogText(response.data) };
}

export async function loadAdminServerLog(
    api: Api,
    rowId: string,
    signal?: AbortSignal
): Promise<PtvAdminServerLogDetail> {
    try {
        const selected = await fetchSelectedLogText(api, rowId, signal);
        return normalizeAdminServerLogDetail(selected.id, selected.name, selected.text);
    } catch (error) {
        return loadFailure(error, 'Server log content could not be loaded.');
    }
}

function safeDownloadName(name: string) {
    const forbidden = '<>:"/\\|?*';
    const sanitized = Array.from(name, character => (
        character.charCodeAt(0) < 32 || forbidden.includes(character) ? '_' : character
    )).join('');
    return sanitized || 'server-log.txt';
}

/** Fetches one selected full log on demand and does not retain the content in a module cache. */
export async function downloadAdminServerLog(
    api: Api,
    rowId: string,
    signal?: AbortSignal
): Promise<PtvAdminServerLogDownload> {
    try {
        const selected = await fetchSelectedLogText(api, rowId, signal);
        return {
            content: selected.text,
            fileName: safeDownloadName(selected.name),
            mimeType: 'text/plain;charset=utf-8'
        };
    } catch (error) {
        return loadFailure(error, 'Server log content could not be downloaded.');
    }
}
