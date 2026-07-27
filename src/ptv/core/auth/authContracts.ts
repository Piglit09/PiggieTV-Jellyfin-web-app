import type { PtvCoreError, PtvCoreResult } from '../errors/coreError';

export type PtvAuthenticationState =
    | 'authenticated'
    | 'error'
    | 'expired'
    | 'restoring'
    | 'signed-out';

export type PtvServerConnection = Readonly<{
    baseUrl: string;
    name?: string;
    serverId: string;
    version?: string;
}>;

export type PtvSessionSnapshot = Readonly<{
    connection?: PtvServerConnection;
    error?: PtvCoreError;
    state: PtvAuthenticationState;
    userId?: string;
    userName?: string;
}>;

export type PtvAuthenticationEvent =
    | Readonly<{ reason: string; type: 'auth-expired' }>
    | Readonly<{ reason: string; type: 'auth-required' }>;

export interface PtvCoreSessionService {
    getSnapshot(): PtvSessionSnapshot;
    getTokenForApi(): Promise<PtvCoreResult<string | null>>;
    invalidateToken(reason: string): Promise<PtvCoreResult<void>>;
    logout(): Promise<PtvCoreResult<void>>;
    restore(): Promise<PtvCoreResult<PtvSessionSnapshot>>;
    subscribe(listener: (event: PtvAuthenticationEvent) => void): () => void;
    switchServer(serverId: string): Promise<PtvCoreResult<PtvSessionSnapshot>>;
    switchUser(userId: string): Promise<PtvCoreResult<PtvSessionSnapshot>>;
}

export interface PtvQuickConnectHooks {
    initiate(): Promise<PtvCoreResult<{ code: string; secret: string }>>;
    isSupported(): Promise<boolean>;
    poll(secret: string): Promise<PtvCoreResult<PtvSessionSnapshot | null>>;
}
