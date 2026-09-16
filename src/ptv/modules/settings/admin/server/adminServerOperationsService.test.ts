import type { Api } from '@jellyfin/sdk';
import type { AuthenticationInfo } from '@jellyfin/sdk/lib/generated-client/models/authentication-info';
import type { BackupManifestDto } from '@jellyfin/sdk/lib/generated-client/models/backup-manifest-dto';
import type { LogFile } from '@jellyfin/sdk/lib/generated-client/models/log-file';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    account: {
        create: vi.fn(),
        health: vi.fn(),
        restore: vi.fn(),
        verify: vi.fn()
    },
    apiKeys: {
        createKey: vi.fn(),
        getKeys: vi.fn(),
        revokeKey: vi.fn()
    },
    backups: {
        createBackup: vi.fn(),
        getBackup: vi.fn(),
        listBackups: vi.fn(),
        startRestoreBackup: vi.fn()
    },
    system: {
        getLogFile: vi.fn(),
        getServerLogs: vi.fn()
    }
}));

vi.mock('@jellyfin/sdk/lib/utils/api/api-key-api', () => ({
    getApiKeyApi: () => mocks.apiKeys
}));
vi.mock('@jellyfin/sdk/lib/utils/api/system-api', () => ({
    getSystemApi: () => mocks.system
}));
vi.mock('@jellyfin/sdk/lib/generated-client/api/backup-api', () => ({
    BackupApi: class {
        constructor() {
            return mocks.backups;
        }
    }
}));
vi.mock('../../../account/AccountApi', () => ({
    createPtvAccountBackup: mocks.account.create,
    getPtvAccountAdminHealth: mocks.account.health,
    restorePtvAccountBackup: mocks.account.restore,
    verifyPtvAccountBackup: mocks.account.verify
}));

import {
    createAdminApiKey,
    createAdminBackup,
    createLatestPtvAccountBackup,
    downloadAdminServerLog,
    loadAdminApiKeys,
    loadAdminBackupManifest,
    loadAdminBackups,
    loadAdminServerLog,
    loadAdminServerLogs,
    loadPtvLatestAccountBackup,
    restoreAdminBackup,
    restoreLatestPtvAccountBackup,
    revokeAdminApiKey,
    verifyLatestPtvAccountBackup
} from './adminServerOperationsService';

function api() {
    return { configuration: {}, axiosInstance: {} } as Api;
}

function rawKey(overrides: Partial<AuthenticationInfo> = {}): AuthenticationInfo {
    return {
        AccessToken: 'raw-token-a',
        AppName: 'Automation',
        DateCreated: '2026-08-13T00:00:00Z',
        Id: 1,
        ...overrides
    };
}

function rawBackup(overrides: Partial<BackupManifestDto> = {}): BackupManifestDto {
    return {
        BackupEngineVersion: '1',
        DateCreated: '2026-08-13T00:00:00Z',
        Options: { Database: true },
        Path: 'C:\\private\\backup.zip',
        ServerVersion: '10.11.11',
        ...overrides
    };
}

function rawLog(overrides: Partial<LogFile> = {}): LogFile {
    return {
        DateCreated: '2026-08-13T00:00:00Z',
        Name: 'server.log',
        Size: 10,
        ...overrides
    };
}

function accountOperation() {
    return {
        backupId: 'ptv-backup-id',
        code: 'ok',
        dryRun: true,
        message: 'Complete',
        ok: true,
        verified: true
    };
}

function accountHealth() {
    return {
        backup: {
            backupId: 'ptv-backup-id',
            backupPath: 'C:\\private\\ptv.zip',
            backupSizeBytes: 100,
            durationMilliseconds: 25,
            message: 'Complete',
            overdue: false,
            pendingVerificationsBackedUp: 2,
            profilesBackedUp: 3,
            result: 'success',
            verificationStatus: 'verified',
            verifiedEmailsBackedUp: 1
        }
    };
}

describe('server operations service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.apiKeys.createKey.mockResolvedValue({ data: undefined });
        mocks.apiKeys.getKeys.mockResolvedValue({ data: { Items: [ rawKey() ] } });
        mocks.apiKeys.revokeKey.mockResolvedValue({ data: undefined });
        mocks.backups.createBackup.mockResolvedValue({ data: rawBackup() });
        mocks.backups.getBackup.mockResolvedValue({ data: rawBackup() });
        mocks.backups.listBackups.mockResolvedValue({ data: [ rawBackup() ] });
        mocks.backups.startRestoreBackup.mockResolvedValue({ data: undefined });
        mocks.system.getLogFile.mockResolvedValue({ data: 'log content' });
        mocks.system.getServerLogs.mockResolvedValue({ data: [ rawLog() ] });
        mocks.account.create.mockResolvedValue(accountOperation());
        mocks.account.health.mockResolvedValue(accountHealth());
        mocks.account.restore.mockResolvedValue(accountOperation());
        mocks.account.verify.mockResolvedValue(accountOperation());
    });

    it('loads masked keys with the exact SDK call and never returns a raw token', async () => {
        const client = api();
        const signal = {} as AbortSignal;
        const rows = await loadAdminApiKeys(client, signal);

        expect(mocks.apiKeys.getKeys).toHaveBeenCalledWith({ signal });
        expect(rows[0]).toMatchObject({ appName: 'Automation', tokenMask: '••••••••' });
        expect(JSON.stringify(rows)).not.toContain('raw-token-a');
    });

    it('reveals a uniquely proven new key only after before-and-after authoritative reads', async () => {
        const client = api();
        const signal = {} as AbortSignal;
        mocks.apiKeys.getKeys
            .mockResolvedValueOnce({ data: { Items: [ rawKey() ] } })
            .mockResolvedValueOnce({
                data: {
                    Items: [
                        rawKey(),
                        rawKey({ AccessToken: 'new-token', AppName: 'Automation', Id: 2 })
                    ]
                }
            });
        const result = await createAdminApiKey(client, ' Automation ', signal);

        expect(mocks.apiKeys.createKey).toHaveBeenCalledWith({ app: 'Automation' }, { signal });
        expect(mocks.apiKeys.getKeys).toHaveBeenCalledTimes(2);
        expect(result.reveal).toEqual({ appName: 'Automation', token: 'new-token' });
        expect(result.rows).toHaveLength(2);
        expect(JSON.stringify(result.rows)).not.toContain('new-token');
    });

    it('withholds one-time reveal when concurrent creation makes the new token ambiguous', async () => {
        const client = api();
        mocks.apiKeys.getKeys
            .mockResolvedValueOnce({ data: { Items: [ rawKey() ] } })
            .mockResolvedValueOnce({
                data: {
                    Items: [
                        rawKey(),
                        rawKey({ AccessToken: 'new-token-a', AppName: 'Automation', Id: 2 }),
                        rawKey({ AccessToken: 'new-token-b', AppName: 'Other', Id: 3 })
                    ]
                }
            });

        const result = await createAdminApiKey(client, 'Automation');

        expect(result.reveal).toBeNull();
        expect(result.rows).toHaveLength(3);
    });

    it('fresh-checks the protected token before exact revocation and rejects stale metadata', async () => {
        const client = api();
        const [ row ] = await loadAdminApiKeys(client);
        await revokeAdminApiKey(client, row.id);
        expect(mocks.apiKeys.revokeKey).toHaveBeenCalledWith(
            { key: 'raw-token-a' },
            { signal: undefined }
        );

        const staleClient = api();
        const [ staleRow ] = await loadAdminApiKeys(staleClient);
        mocks.apiKeys.getKeys.mockResolvedValueOnce({
            data: { Items: [ rawKey({ AppName: 'Externally changed' }) ] }
        });
        await expect(revokeAdminApiKey(staleClient, staleRow.id)).rejects.toMatchObject({
            code: 'state-changed'
        });
        expect(mocks.apiKeys.revokeKey).toHaveBeenCalledOnce();
    });

    it('redacts backup paths and sends every exact backup option', async () => {
        const client = api();
        const listed = await loadAdminBackups(client);
        const created = await createAdminBackup(client, {
            database: true,
            metadata: false,
            subtitles: true,
            trickplay: false
        });

        expect(JSON.stringify([ listed, created ])).not.toContain('private');
        expect(mocks.backups.createBackup).toHaveBeenCalledWith({
            backupOptionsDto: {
                Database: true,
                Metadata: false,
                Subtitles: true,
                Trickplay: false
            }
        }, { signal: undefined });
    });

    it('requires the Jellyfin database in every backup before any request', async () => {
        const client = api();

        await expect(createAdminBackup(client, {
            database: false,
            metadata: true,
            subtitles: true,
            trickplay: true
        })).rejects.toMatchObject({ code: 'invalid-input' });
        expect(mocks.backups.createBackup).not.toHaveBeenCalled();
    });

    it('uses a fresh server-returned path for manifest reads and server-restarting restore', async () => {
        const client = api();
        const [ backup ] = await loadAdminBackups(client);
        const manifest = await loadAdminBackupManifest(client, backup.id);
        await restoreAdminBackup(client, backup.id);

        expect(JSON.stringify(manifest)).not.toContain('private');
        expect(mocks.backups.getBackup).toHaveBeenCalledWith(
            { path: 'C:\\private\\backup.zip' },
            { signal: undefined }
        );
        expect(mocks.backups.startRestoreBackup).toHaveBeenCalledWith({
            backupRestoreRequestDto: { ArchiveFileName: 'C:\\private\\backup.zip' }
        }, { signal: undefined });
        expect(mocks.backups.getBackup).toHaveBeenCalledTimes(2);
        expect(mocks.backups.listBackups).toHaveBeenCalledTimes(3);
    });

    it('blocks restore when the authoritative manifest changed after list validation', async () => {
        const client = api();
        const [ backup ] = await loadAdminBackups(client);
        mocks.backups.getBackup.mockResolvedValueOnce({
            data: rawBackup({ Options: { Database: true, Metadata: true } })
        });

        await expect(restoreAdminBackup(client, backup.id)).rejects.toMatchObject({
            code: 'state-changed'
        });
        expect(mocks.backups.startRestoreBackup).not.toHaveBeenCalled();
    });

    it('supports latest-only PiggieTV backup operations without exposing id or path', async () => {
        const status = await loadPtvLatestAccountBackup();
        await createLatestPtvAccountBackup();
        await verifyLatestPtvAccountBackup();
        await restoreLatestPtvAccountBackup(true, false);

        expect(JSON.stringify(status)).not.toContain('ptv-backup-id');
        expect(JSON.stringify(status)).not.toContain('private');
        expect(mocks.account.verify).toHaveBeenCalledWith('ptv-backup-id');
        expect(mocks.account.restore).toHaveBeenCalledWith('ptv-backup-id', true, false);
        await expect(restoreLatestPtvAccountBackup(false, false)).rejects.toMatchObject({
            code: 'invalid-input'
        });
    });

    it('verifies the exact current log name, caps rendered content, and downloads only on demand', async () => {
        const client = api();
        mocks.system.getServerLogs.mockResolvedValue({ data: [ rawLog({ Name: ' server.log ' }) ] });
        const [ log ] = await loadAdminServerLogs(client);
        const longContent = 'a'.repeat(512 * 1024 + 10);
        mocks.system.getLogFile.mockResolvedValue({ data: longContent });
        const detail = await loadAdminServerLog(client, log.id);
        const download = await downloadAdminServerLog(client, log.id);

        expect(detail.renderedText).toHaveLength(512 * 1024);
        expect(detail).toMatchObject({ totalBytes: 512 * 1024 + 10, truncated: true });
        expect(download.content).toBe(longContent);
        expect(mocks.system.getLogFile).toHaveBeenCalledWith(
            { name: ' server.log ' },
            { signal: undefined }
        );
        expect(mocks.system.getLogFile).toHaveBeenCalledTimes(2);
        expect(mocks.system.getServerLogs).toHaveBeenCalledTimes(3);
    });

    it('does not request content after a selected log disappears from a fresh list', async () => {
        const client = api();
        const [ log ] = await loadAdminServerLogs(client);
        mocks.system.getServerLogs.mockResolvedValueOnce({ data: [ rawLog({ Name: 'new.log' }) ] });

        await expect(loadAdminServerLog(client, log.id)).rejects.toMatchObject({
            code: 'state-changed'
        });
        expect(mocks.system.getLogFile).not.toHaveBeenCalled();
    });

    it('fails closed on malformed collections rather than fabricating empty states', async () => {
        const client = api();
        mocks.apiKeys.getKeys.mockResolvedValueOnce({ data: {} });
        mocks.backups.listBackups.mockResolvedValueOnce({ data: {} });
        mocks.system.getServerLogs.mockResolvedValueOnce({ data: {} });

        await expect(loadAdminApiKeys(client)).rejects.toMatchObject({ code: 'invalid-response' });
        await expect(loadAdminBackups(client)).rejects.toMatchObject({ code: 'invalid-response' });
        await expect(loadAdminServerLogs(client)).rejects.toMatchObject({ code: 'invalid-response' });
    });
});
