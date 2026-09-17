import type { AuthenticationInfo } from '@jellyfin/sdk/lib/generated-client/models/authentication-info';
import type { BackupManifestDto } from '@jellyfin/sdk/lib/generated-client/models/backup-manifest-dto';
import { describe, expect, it } from 'vitest';

import type { PtvAccountBackupStatus } from '../../../account/AccountApi';
import {
    normalizeAdminApiKey,
    normalizeAdminBackup,
    normalizeAdminServerLog,
    normalizeAdminServerLogDetail,
    normalizePtvAccountBackupStatus
} from './adminServerOperationsAdapters';
import { ADMIN_API_KEY_MASK } from './adminServerOperationsModel';

describe('server operations adapters', () => {
    it('normalizes API keys without exposing any part of the raw token', () => {
        const raw: AuthenticationInfo = {
            AccessToken: 'raw-token-value',
            AppName: 'Automation',
            DateCreated: '2026-08-13T00:00:00Z',
            Id: 12
        };
        const row = normalizeAdminApiKey(raw, 'key-a');

        expect(row).toEqual({
            appName: 'Automation',
            createdAt: '2026-08-13T00:00:00Z',
            id: 'key-a',
            tokenMask: ADMIN_API_KEY_MASK
        });
        expect(JSON.stringify(row)).not.toContain(raw.AccessToken);
    });

    it('omits the backup filesystem path and preserves unknown option values as null', () => {
        const raw: BackupManifestDto = {
            DateCreated: '2026-08-13T00:00:00Z',
            Options: { Database: true },
            Path: 'C:\\private\\backup.zip'
        };
        const backup = normalizeAdminBackup(raw, 'backup-a');

        expect(backup.options).toEqual({
            database: true,
            metadata: null,
            subtitles: null,
            trickplay: null
        });
        expect(JSON.stringify(backup)).not.toContain(raw.Path);
    });

    it('does not turn malformed sizes or timestamps into fake zero/empty values', () => {
        const log = normalizeAdminServerLog({
            DateCreated: '',
            Name: 'server.log',
            Size: Number.NaN
        }, 'log-a');
        expect(log).toMatchObject({ createdAt: null, sizeBytes: null });

        const status = normalizePtvAccountBackupStatus({
            backupId: 'backup-id',
            backupPath: 'C:\\private\\ptv.zip',
            backupSizeBytes: Number.NaN,
            durationMilliseconds: -1,
            lastRunAtUtc: '',
            message: '',
            overdue: undefined as never,
            pendingVerificationsBackedUp: Number.NaN,
            profilesBackedUp: -1,
            result: '',
            verificationStatus: '',
            verifiedEmailsBackedUp: Number.NaN
        } as PtvAccountBackupStatus);
        expect(status).toMatchObject({
            available: true,
            durationMilliseconds: null,
            lastRunAt: null,
            overdue: null,
            profilesBackedUp: null,
            sizeBytes: null
        });
        expect(JSON.stringify(status)).not.toContain('private');
        expect(JSON.stringify(status)).not.toContain('backup-id');
    });

    it('reports account-backup availability without exposing the backend identifier', () => {
        const status = normalizePtvAccountBackupStatus({
            backupId: '   ',
            backupPath: '',
            backupSizeBytes: 0,
            durationMilliseconds: 0,
            message: '',
            overdue: false,
            pendingVerificationsBackedUp: 0,
            profilesBackedUp: 0,
            result: 'never',
            verificationStatus: 'unknown',
            verifiedEmailsBackedUp: 0
        });

        expect(status.available).toBe(false);
        expect(status).not.toHaveProperty('backupId');
    });

    it('caps rendered log text by UTF-8 bytes without splitting multibyte characters', () => {
        const detail = normalizeAdminServerLogDetail('log-a', 'server.log', 'ééé', 5);

        expect(detail).toMatchObject({
            renderedText: 'éé',
            totalBytes: 6,
            truncated: true
        });
        expect(new TextEncoder().encode(detail.renderedText).byteLength).toBeLessThanOrEqual(5);
    });

    it('rejects malformed required identities instead of fabricating rows', () => {
        expect(() => normalizeAdminServerLog({ Name: '' }, 'log-a')).toThrowError(
            expect.objectContaining({ code: 'invalid-response' })
        );
        expect(() => normalizeAdminApiKey({}, '')).toThrowError(
            expect.objectContaining({ code: 'invalid-response' })
        );
    });
});
