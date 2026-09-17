const ADMIN_SERVER_OPERATIONS_QUERY_SCOPE = 'PtvAdminServerOperations';

export function getAdminServerOperationsQueryKeys(serverKey: string, rowId?: string) {
    const server = serverKey.trim() || 'current-server';
    const scope = [ ADMIN_SERVER_OPERATIONS_QUERY_SCOPE, server ] as const;
    const id = rowId?.trim() || 'unselected';

    return {
        apiKeys: [ ...scope, 'api-keys' ] as const,
        backupManifest: [ ...scope, 'backup-manifest', id ] as const,
        backups: [ ...scope, 'backups' ] as const,
        logDetail: [ ...scope, 'log-detail', id ] as const,
        logs: [ ...scope, 'logs' ] as const,
        ptvAccountBackup: [ ...scope, 'ptv-account-backup', 'latest' ] as const,
        root: scope
    };
}
