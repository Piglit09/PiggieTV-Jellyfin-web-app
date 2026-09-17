import { describe, expect, it } from 'vitest';

import { getAdminServerOperationsQueryKeys } from './adminServerOperationsQueryKeys';

describe('server operations query keys', () => {
    it('isolates every source by server identity', () => {
        const first = getAdminServerOperationsQueryKeys('server-a', 'log-1');
        const second = getAdminServerOperationsQueryKeys('server-b', 'log-1');

        expect(first.apiKeys).not.toEqual(second.apiKeys);
        expect(first.backups).not.toEqual(first.logs);
        expect(first.ptvAccountBackup).toEqual([
            'PtvAdminServerOperations',
            'server-a',
            'ptv-account-backup',
            'latest'
        ]);
    });

    it('uses only opaque row ids for detail keys', () => {
        const serialized = JSON.stringify(getAdminServerOperationsQueryKeys('server-a', 'log-opaque'));

        expect(serialized).toContain('log-opaque');
        expect(serialized).not.toContain('server.log');
        expect(serialized).not.toContain('AccessToken');
        expect(serialized).not.toContain('backup.zip');
    });
});
