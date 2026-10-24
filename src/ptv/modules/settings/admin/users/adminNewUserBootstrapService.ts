import type { Api } from '@jellyfin/sdk';

import {
    getCurrentPtvPluginApiClient,
    type HomeUserAccess,
    type HomeUserAccessResponse
} from '../../../../core/pluginApi';
import {
    updateAdminUserLibraryAccess,
    updateNewAdminUserPolicy
} from './adminUsersService';

const USER_ID_PATTERN = /^[a-f\d]{32}$/i;
const DASHED_ID_PATTERN = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const EPOCH_PATTERN = /^[a-f\d]{64}$/i;
const PENDING_KEY_PREFIX = 'ptv-admin-new-user-bootstrap:';
const CREATION_KEY_PREFIX = 'ptv-admin-new-user-creation:';

export type PendingNewAdminCreation = {
    creationOperationId: string;
    username: string;
    administrator: boolean;
    allLibraries: boolean;
    selectedFolderIds: string[];
    /** Missing on older hints; never infer that stock Create was not started. */
    stage?: 'prepared' | 'create-started';
};

export type PendingNewAdminUser = {
    id: string;
    creationOperationId: string;
    username: string;
    operationId: string;
    administrator: boolean;
    allLibraries: boolean;
    selectedFolderIds: string[];
};

function isPendingNewAdminUser(value: unknown): value is PendingNewAdminUser {
    if (!value || typeof value !== 'object') return false;
    const record = value as Partial<PendingNewAdminUser>;
    return typeof record.id === 'string' && USER_ID_PATTERN.test(record.id)
        && typeof record.creationOperationId === 'string' && USER_ID_PATTERN.test(record.creationOperationId)
        && typeof record.username === 'string' && record.username.trim().length > 0
        && typeof record.operationId === 'string' && USER_ID_PATTERN.test(record.operationId)
        && typeof record.administrator === 'boolean'
        && typeof record.allLibraries === 'boolean'
        && Array.isArray(record.selectedFolderIds)
        && record.selectedFolderIds.every(id => typeof id === 'string' && USER_ID_PATTERN.test(id))
        && new Set(record.selectedFolderIds.map(id => id.toLowerCase())).size === record.selectedFolderIds.length
        && (!record.allLibraries || record.selectedFolderIds.length === 0);
}

function isPendingNewAdminCreation(value: unknown): value is PendingNewAdminCreation {
    if (!value || typeof value !== 'object') return false;
    const record = value as Partial<PendingNewAdminCreation>;
    return typeof record.creationOperationId === 'string' && USER_ID_PATTERN.test(record.creationOperationId)
        && typeof record.username === 'string' && record.username.trim().length > 0
        && typeof record.administrator === 'boolean'
        && typeof record.allLibraries === 'boolean'
        && Array.isArray(record.selectedFolderIds)
        && record.selectedFolderIds.every(id => typeof id === 'string' && USER_ID_PATTERN.test(id))
        && new Set(record.selectedFolderIds.map(id => id.toLowerCase())).size === record.selectedFolderIds.length
        && (!record.allLibraries || record.selectedFolderIds.length === 0)
        && (record.stage === undefined || record.stage === 'prepared' || record.stage === 'create-started');
}

function normalizeGuid(value: string | null | undefined): string | null {
    if (!value) return null;
    if (USER_ID_PATTERN.test(value)) return value.toLowerCase();
    if (DASHED_ID_PATTERN.test(value)) return value.replace(/-/g, '').toLowerCase();
    return null;
}

function storageKey(serverId: string) {
    return `${PENDING_KEY_PREFIX}${serverId}`;
}

function creationStorageKey(serverId: string) {
    return `${CREATION_KEY_PREFIX}${serverId}`;
}

export function readPendingNewAdminCreation(serverId: string | null): PendingNewAdminCreation | null {
    if (!serverId) return null;
    try {
        const stored = globalThis.localStorage.getItem(creationStorageKey(serverId));
        const value: unknown = stored ? JSON.parse(stored) : null;
        return isPendingNewAdminCreation(value) ? value : null;
    } catch {
        return null;
    }
}

export function savePendingNewAdminCreation(serverId: string, pending: PendingNewAdminCreation) {
    if (!serverId || !isPendingNewAdminCreation(pending)) throw new Error('Creation reservation details are invalid.');
    globalThis.localStorage.setItem(creationStorageKey(serverId), JSON.stringify(pending));
}

export function clearPendingNewAdminCreation(serverId: string, creationOperationId: string) {
    const storedId = readPendingNewAdminCreation(serverId)?.creationOperationId;
    if (storedId && normalizeGuid(storedId) === normalizeGuid(creationOperationId)) {
        globalThis.localStorage.removeItem(creationStorageKey(serverId));
    }
}

/** A browser hint for recovery only. Plugin readback remains the authority. */
export function readPendingNewAdminUser(serverId: string | null): PendingNewAdminUser | null {
    if (!serverId) return null;
    try {
        const stored = globalThis.localStorage.getItem(storageKey(serverId));
        const value: unknown = stored ? JSON.parse(stored) : null;
        return isPendingNewAdminUser(value) ? value : null;
    } catch {
        return null;
    }
}

export function savePendingNewAdminUser(serverId: string, pending: PendingNewAdminUser) {
    if (!serverId || !isPendingNewAdminUser(pending)) throw new Error('Created account recovery details are invalid.');
    globalThis.localStorage.setItem(storageKey(serverId), JSON.stringify(pending));
}

export function clearPendingNewAdminUser(serverId: string, userId: string) {
    if (readPendingNewAdminUser(serverId)?.id === userId) {
        globalThis.localStorage.removeItem(storageKey(serverId));
    }
}

export function createPendingNewAdminUser(input: Omit<PendingNewAdminUser, 'operationId'>): PendingNewAdminUser {
    const operationId = createOperationId();
    const pending = {
        ...input,
        creationOperationId: normalizeGuid(input.creationOperationId) || input.creationOperationId,
        id: normalizeGuid(input.id) || input.id,
        operationId,
        selectedFolderIds: input.selectedFolderIds.map(id => normalizeGuid(id) || id)
    };
    if (new Set(pending.selectedFolderIds).size !== pending.selectedFolderIds.length) {
        throw new Error('Selected library IDs must be unique.');
    }
    if (!isPendingNewAdminUser(pending)) throw new Error('Jellyfin returned an invalid account ID.');
    return pending;
}

export function createPendingNewAdminCreation(input: Omit<PendingNewAdminCreation, 'creationOperationId'>): PendingNewAdminCreation {
    const pending = {
        ...input,
        creationOperationId: createOperationId(),
        stage: 'prepared' as const,
        selectedFolderIds: input.selectedFolderIds.map(id => normalizeGuid(id) || id)
    };
    if (!isPendingNewAdminCreation(pending)) throw new Error('The selected library IDs are invalid or duplicated.');
    return pending;
}

function createOperationId() {
    const bytes = new Uint8Array(16);
    // eslint-disable-next-line compat/compat
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function intendedAccess(pending: PendingNewAdminUser): HomeUserAccess {
    return {
        enableAllFolders: pending.allLibraries,
        enabledFolders: pending.allLibraries ? [] : [ ...pending.selectedFolderIds ],
        isAdministrator: pending.administrator,
        isDisabled: false,
        userId: pending.id
    };
}

function clientFor(api: Api) {
    const client = getCurrentPtvPluginApiClient();
    if (!client?.matchesSdkApi(api)) {
        throw new Error('Plugin verification is unavailable for this server. The created account still needs administrator recovery.');
    }
    return client;
}

export async function reserveNewAdminUserCreation(api: Api, pending: PendingNewAdminCreation) {
    if (!isPendingNewAdminCreation(pending)) throw new Error('Creation reservation details are invalid.');
    const result = await clientFor(api).reserveHomeUserCreation({ creationOperationId: pending.creationOperationId });
    if (result.version !== 1 || normalizeGuid(result.creationOperationId) !== pending.creationOperationId
        || result.state !== 'reserved' || result.migrationVerificationHeld !== true
        || result.userId !== null || result.bootstrapRequired !== false) {
        throw new Error('Plugin did not confirm the creation reservation. No account can be created yet.');
    }
    return result;
}

function matchesPending(response: HomeUserAccessResponse, pending: PendingNewAdminUser) {
    return matchesOperation(response, pending.id, pending.operationId);
}

function matchesOperation(response: HomeUserAccessResponse, userId: string, operationId: string) {
    return response.version === 1 && normalizeGuid(response.userId) === userId.toLowerCase()
        && normalizeGuid(response.operationId) === operationId.toLowerCase()
        && typeof response.accessEpoch === 'string' && EPOCH_PATTERN.test(response.accessEpoch);
}

function requireVerified(response: HomeUserAccessResponse, pending: PendingNewAdminUser) {
    if (!matchesPending(response, pending)
        || response.held || !response.policyProven
        || response.state !== 'policy-attested' || response.writeAllowed) {
        throw new Error('The account exists, but Plugin policy verification is still pending. Open this account for administrator recovery.');
    }
    return response;
}

/** Begins the Plugin gate before either Jellyfin policy write, including equal default values. */
export async function bootstrapNewAdminUser(api: Api, pending: PendingNewAdminUser): Promise<HomeUserAccessResponse> {
    if (!isPendingNewAdminUser(pending)) throw new Error('Created account recovery details are invalid.');
    const client = clientFor(api);
    const binding = await client.bindHomeUserCreation(pending.creationOperationId, { userId: pending.id });
    if (binding.version !== 1 || normalizeGuid(binding.creationOperationId) !== pending.creationOperationId
        || normalizeGuid(binding.userId) !== pending.id || binding.state !== 'bound'
        || binding.migrationVerificationHeld !== false || binding.bootstrapRequired !== true) {
        throw new Error('Plugin did not bind the created account. Its access remains unverified.');
    }
    const begun = await client.beginHomeUserAccess({
        expectedAccess: null,
        intendedAccess: intendedAccess(pending),
        mode: 'bootstrap',
        operationId: pending.operationId,
        userId: pending.id
    });
    if (!matchesPending(begun, pending)
        || !begun.held || begun.policyProven || begun.state !== 'pending' || !begun.writeAllowed) {
        throw new Error('The account exists, but bootstrap cannot write its policy again. Use administrator recovery.');
    }
    await updateNewAdminUserPolicy(api, pending.id, {
        IsAdministrator: pending.administrator,
        IsDisabled: false
    });
    await updateAdminUserLibraryAccess(api, pending.id, pending.allLibraries ?
        { mode: 'all' } :
        { mode: 'selected', selectedFolderIds: pending.selectedFolderIds });
    return requireVerified(await client.completeHomeUserAccess(pending.operationId), pending);
}

/** Read-only status check after reload. Policy writes require explicit review on the account page. */
export async function resumePendingNewAdminUser(api: Api, pending: PendingNewAdminUser): Promise<HomeUserAccessResponse> {
    if (!isPendingNewAdminUser(pending)) throw new Error('Created account recovery details are invalid.');
    const client = clientFor(api);
    const current = await client.getCurrentHomeUserAccess(pending.id);
    if (current.version === 1 && normalizeGuid(current.userId) === pending.id
        && current.state === 'unproven' && current.held && !current.policyProven
        && !current.operationId && !current.accessEpoch && !current.writeAllowed) {
        throw new Error('The account is unverified. Open it to review and confirm its access before applying any policy.');
    }
    if (current.version === 1 && normalizeGuid(current.userId) === pending.id
        && normalizeGuid(current.supersededOperationId) === pending.operationId
        && normalizeGuid(current.operationId) !== null
        && typeof current.accessEpoch === 'string' && EPOCH_PATTERN.test(current.accessEpoch)
        && current.state === 'policy-attested' && !current.held
        && current.policyProven && !current.writeAllowed) {
        return current;
    }
    if (!matchesPending(current, pending)) {
        throw new Error('Plugin operation changed. The account needs administrator recovery.');
    }
    if (current.state === 'policy-attested' && !current.held) return requireVerified(current, pending);
    // A pending/failed Begin does not prove that either stock policy write ran.
    // The temporary Jellyfin default may already equal the intended policy, so
    // Complete could otherwise attest it after an uncertain or failed write.
    throw new Error('The account remains held. Open it for administrator recovery and a new verified policy write.');
}

function normalizeAccess(access: HomeUserAccess | null | undefined, userId: string): HomeUserAccess | null {
    if (!access || normalizeGuid(access.userId) !== userId
        || typeof access.enableAllFolders !== 'boolean'
        || typeof access.isAdministrator !== 'boolean'
        || typeof access.isDisabled !== 'boolean'
        || !Array.isArray(access.enabledFolders)) return null;
    const folders = access.enabledFolders.map(id => normalizeGuid(id));
    if (folders.some(id => !id) || new Set(folders).size !== folders.length) return null;
    return { ...access, enabledFolders: folders as string[], userId };
}

function sameAccess(left: HomeUserAccess, right: HomeUserAccess) {
    return left.userId === right.userId
        && left.enableAllFolders === right.enableAllFolders
        && left.isAdministrator === right.isAdministrator
        && left.isDisabled === right.isDisabled
        && [ ...left.enabledFolders ].sort((a, b) => a.localeCompare(b)).join('|')
            === [ ...right.enabledFolders ].sort((a, b) => a.localeCompare(b)).join('|');
}

/** Administrator-selected policy for a recovered, controlled-created account. */
export async function verifyUnprovenAdminUserAccess(
    api: Api,
    userId: string,
    selectedAccess: HomeUserAccess
): Promise<HomeUserAccessResponse> {
    const id = normalizeGuid(userId);
    if (!id) throw new Error('The account ID is invalid.');
    const intended = normalizeAccess(selectedAccess, id);
    if (!intended) throw new Error('Select a valid intended policy before verification.');
    const client = clientFor(api);
    const current = await client.getCurrentHomeUserAccess(id);
    if (current.version !== 1 || normalizeGuid(current.userId) !== id
        || (current.controlledCreated !== true && current.migrationRecoveryRestricted !== true && current.lateUnverified !== true)
        || current.state !== 'unproven'
        || !current.held || current.policyProven || current.operationId
        || current.accessEpoch || current.writeAllowed) {
        throw new Error('The account is not ready for controlled verification. Refresh its Plugin status.');
    }
    const bootstrap = current.controlledCreated === true;
    const expected = bootstrap ? null : normalizeAccess(current.currentAccess, id);
    if (!bootstrap && (!expected || intended.enableAllFolders || intended.isAdministrator)) {
        throw new Error('Choose a restrictive Member policy for recovery verification.');
    }
    let mode: 'bootstrap' | 'existing' | 'reproof' = 'bootstrap';
    if (!bootstrap) mode = sameAccess(expected!, intended) ? 'reproof' : 'existing';
    const operationId = createOperationId();
    const begun = await client.beginHomeUserAccess({
        expectedAccess: expected,
        intendedAccess: intended,
        mode,
        operationId,
        userId: id
    });
    if (!matchesOperation(begun, id, operationId)
        || !begun.held || begun.policyProven || begun.state !== 'pending' || !begun.writeAllowed) {
        throw new Error('Plugin did not authorize the bootstrap policy write.');
    }
    await updateNewAdminUserPolicy(api, id, {
        IsAdministrator: intended.isAdministrator,
        IsDisabled: intended.isDisabled
    });
    await updateAdminUserLibraryAccess(api, id, intended.enableAllFolders ?
        { mode: 'all' } :
        { mode: 'selected', selectedFolderIds: intended.enabledFolders });
    const completed = await client.completeHomeUserAccess(operationId);
    if (!matchesOperation(completed, id, operationId)
        || completed.held || !completed.policyProven
        || completed.state !== 'policy-attested' || completed.writeAllowed) {
        throw new Error('The policy was written, but Plugin verification remains pending.');
    }
    return completed;
}

/** Explicit admin recovery from a held Plugin operation, independent of local browser storage. */
export async function supersedeHeldAdminUserAccess(api: Api, userId: string): Promise<HomeUserAccessResponse> {
    const id = normalizeGuid(userId);
    if (!id) throw new Error('The account ID is invalid.');
    const client = clientFor(api);
    const current = await client.getCurrentHomeUserAccess(id);
    const oldOperationId = normalizeGuid(current.operationId);
    const currentAccess = normalizeAccess(current.currentAccess, id);
    const intended = normalizeAccess(current.intendedAccess, id);
    if (current.version !== 1 || normalizeGuid(current.userId) !== id
        || !current.held || current.policyProven
        || !oldOperationId || !currentAccess || !intended) {
        throw new Error('The held operation lacks a current policy and durable intent. Reload its Plugin status before recovery.');
    }
    const operationId = createOperationId();
    const begun = await client.beginHomeUserAccess({
        expectedAccess: currentAccess,
        intendedAccess: intended,
        mode: 'existing',
        operationId,
        supersedesOperationId: oldOperationId,
        userId: id
    });
    if (!matchesOperation(begun, id, operationId)
        || !begun.held || begun.policyProven || begun.state !== 'pending' || !begun.writeAllowed) {
        throw new Error('Plugin did not authorize a new policy write. The account remains held for administrator recovery.');
    }
    await updateNewAdminUserPolicy(api, id, {
        IsAdministrator: intended.isAdministrator,
        IsDisabled: intended.isDisabled
    });
    await updateAdminUserLibraryAccess(api, id, intended.enableAllFolders ?
        { mode: 'all' } :
        { mode: 'selected', selectedFolderIds: intended.enabledFolders });
    const completed = await client.completeHomeUserAccess(operationId);
    if (!matchesOperation(completed, id, operationId)
        || completed.held || !completed.policyProven
        || completed.state !== 'policy-attested' || completed.writeAllowed) {
        throw new Error('The retry was written, but Plugin verification is still pending. Recheck this account before using Home.');
    }
    return completed;
}
