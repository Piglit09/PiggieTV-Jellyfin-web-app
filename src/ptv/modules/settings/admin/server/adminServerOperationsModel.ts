export const ADMIN_SERVER_LOG_RENDER_LIMIT_BYTES = 512 * 1024;
export const ADMIN_API_KEY_MASK = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';

export type AdminServerOperationsErrorCode =
    | 'invalid-input'
    | 'invalid-response'
    | 'load-unavailable'
    | 'not-found'
    | 'operation-failed'
    | 'state-changed';

export class AdminServerOperationsError extends Error {
    readonly code: AdminServerOperationsErrorCode;

    constructor(code: AdminServerOperationsErrorCode, message: string) {
        super(message);
        this.name = 'AdminServerOperationsError';
        this.code = code;
    }
}

export type PtvAdminApiKey = {
    appName: string | null;
    createdAt: string | null;
    id: string;
    tokenMask: typeof ADMIN_API_KEY_MASK;
};

/**
 * One-time mutation output only. Callers must not place this value in query
 * state, persistent storage, logs, DOM attributes, or long-lived UI state.
 */
export type PtvAdminApiKeyReveal = {
    appName: string;
    token: string;
};

export type PtvAdminApiKeyCreationResult = {
    reveal: PtvAdminApiKeyReveal | null;
    rows: PtvAdminApiKey[];
};

export type PtvAdminBackupOptions = {
    database: boolean | null;
    metadata: boolean | null;
    subtitles: boolean | null;
    trickplay: boolean | null;
};

export type PtvAdminBackupCreateOptions = {
    database: boolean;
    metadata: boolean;
    subtitles: boolean;
    trickplay: boolean;
};

/** Deliberately excludes Jellyfin's server filesystem Path. */
export type PtvAdminBackup = {
    backupEngineVersion: string | null;
    createdAt: string | null;
    id: string;
    options: PtvAdminBackupOptions;
    serverVersion: string | null;
};

/** The account service exposes only the latest PiggieTV account backup. */
export type PtvAdminAccountBackup = {
    available: boolean;
    durationMilliseconds: number | null;
    id: 'latest';
    lastRunAt: string | null;
    lastSuccessAt: string | null;
    message: string | null;
    overdue: boolean | null;
    pendingVerificationsBackedUp: number | null;
    profilesBackedUp: number | null;
    result: string | null;
    sizeBytes: number | null;
    verificationStatus: string | null;
    verifiedEmailsBackedUp: number | null;
};

export type PtvAdminAccountBackupOperation = {
    code: string | null;
    dryRun: boolean;
    message: string | null;
    ok: boolean;
    verified: boolean;
};

export type PtvAdminServerLog = {
    createdAt: string | null;
    id: string;
    modifiedAt: string | null;
    name: string;
    sizeBytes: number | null;
};

/** Only a capped rendering is suitable for query/UI state. */
export type PtvAdminServerLogDetail = {
    id: string;
    name: string;
    renderedText: string;
    totalBytes: number;
    truncated: boolean;
};

/** Full content is returned only to an explicit download/copy call and is not cached. */
export type PtvAdminServerLogDownload = {
    content: string;
    fileName: string;
    mimeType: 'text/plain;charset=utf-8';
};
