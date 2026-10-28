import type { Api } from '@jellyfin/sdk';
import type {
    BaseItemDto,
    SessionInfoDto,
    UserConfiguration,
    UserDto,
    UserPolicy
} from '@jellyfin/sdk/lib/generated-client';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { getUserApi } from '@jellyfin/sdk/lib/utils/api/user-api';

import { getCurrentPtvPluginApiClient, type HomeUserAccess, type HomeUserAccessResponse } from '../../../../core/pluginApi';
import { acknowledgeHomeUserAccessBeginEpoch, clearHomeUserAccessRetirementHint, retireHomeUserAccessAuthority } from '../../../../pages/home/homeLibraryTransitionFreshness';
import { loadAdminPeopleSessions } from '../people/adminPeopleService';

import type {
    AdminUserLibrarySelection,
    CreateAdminUserInput,
    UpdateAdminUserPasswordInput
} from './adminUsersModel';

export type AdminUsersServiceErrorCode =
    | 'folders-unavailable'
    | 'invalid-library-selection'
    | 'invalid-password'
    | 'invalid-user'
    | 'invalid-username'
    | 'managed-state-conflict'
    | 'policy-unavailable'
    | 'transition-unavailable'
    | 'user-configuration-unavailable'
    | 'users-unavailable';

export const ADMIN_USER_PLAYBACK_POLICY_FIELDS = [
    'EnableAudioPlaybackTranscoding',
    'EnableContentDownloading',
    'EnableLiveTvAccess',
    'EnableMediaPlayback',
    'EnablePlaybackRemuxing',
    'EnableRemoteAccess',
    'EnableVideoPlaybackTranscoding'
] as const;

export type AdminUserPlaybackPolicyField = typeof ADMIN_USER_PLAYBACK_POLICY_FIELDS[number];
export type AdminUserPlaybackPolicyValues = Readonly<Record<AdminUserPlaybackPolicyField, boolean>>;
export type AdminUserLibraryAccessBaseline = Readonly<{
    enableAllFolders: boolean;
    enabledFolderIds: readonly string[];
}>;
export type AdminUserPolicySaveResult<TBaseline> = Readonly<{
    confirmedBaseline: TBaseline;
    policy: UserPolicy;
}>;

export class AdminUsersServiceError extends Error {
    public readonly code: AdminUsersServiceErrorCode;

    public constructor(code: AdminUsersServiceErrorCode, message: string) {
        super(message);
        this.code = code;
        this.name = 'AdminUsersServiceError';
    }
}

function requireUserId(userId: string) {
    const normalized = userId.trim();
    if (!normalized) {
        throw new AdminUsersServiceError('invalid-user', 'Choose a valid PiggieTV member.');
    }
    return normalized;
}

function requireUsername(username: string) {
    const normalized = username.trim();
    if (!normalized) {
        throw new AdminUsersServiceError('invalid-username', 'Enter a username.');
    }
    return normalized;
}

function clonePolicy(policy: UserPolicy): UserPolicy {
    return {
        ...policy,
        AccessSchedules: policy.AccessSchedules?.map(schedule => ({ ...schedule })),
        AllowedTags: policy.AllowedTags ? [ ...policy.AllowedTags ] : policy.AllowedTags,
        BlockedChannels: policy.BlockedChannels ? [ ...policy.BlockedChannels ] : policy.BlockedChannels,
        BlockedMediaFolders: policy.BlockedMediaFolders ? [ ...policy.BlockedMediaFolders ] : policy.BlockedMediaFolders,
        BlockedTags: policy.BlockedTags ? [ ...policy.BlockedTags ] : policy.BlockedTags,
        BlockUnratedItems: policy.BlockUnratedItems ? [ ...policy.BlockUnratedItems ] : policy.BlockUnratedItems,
        EnableContentDeletionFromFolders: policy.EnableContentDeletionFromFolders ?
            [ ...policy.EnableContentDeletionFromFolders ] : policy.EnableContentDeletionFromFolders,
        EnabledChannels: policy.EnabledChannels ? [ ...policy.EnabledChannels ] : policy.EnabledChannels,
        EnabledDevices: policy.EnabledDevices ? [ ...policy.EnabledDevices ] : policy.EnabledDevices,
        EnabledFolders: policy.EnabledFolders ? [ ...policy.EnabledFolders ] : policy.EnabledFolders
    };
}

function requirePolicy(user: UserDto) {
    if (!user.Policy) {
        throw new AdminUsersServiceError(
            'policy-unavailable',
            'Account permissions could not be verified. No changes were made.'
        );
    }
    return clonePolicy(user.Policy);
}

function uniqueIds(values: readonly string[] | undefined) {
    const result: string[] = [];
    const seen = new Set<string>();
    (values || []).forEach(value => {
        const normalized = value.trim();
        if (!normalized || seen.has(normalized)) return;
        seen.add(normalized);
        result.push(normalized);
    });
    return result;
}

export function captureAdminUserPlaybackPolicy(
    policy: Readonly<Partial<UserPolicy>> | null | undefined
): AdminUserPlaybackPolicyValues | null {
    const values = {
        EnableAudioPlaybackTranscoding: policy?.EnableAudioPlaybackTranscoding,
        EnableContentDownloading: policy?.EnableContentDownloading,
        EnableLiveTvAccess: policy?.EnableLiveTvAccess,
        EnableMediaPlayback: policy?.EnableMediaPlayback,
        EnablePlaybackRemuxing: policy?.EnablePlaybackRemuxing,
        EnableRemoteAccess: policy?.EnableRemoteAccess,
        EnableVideoPlaybackTranscoding: policy?.EnableVideoPlaybackTranscoding
    };
    if (Object.values(values).some(value => typeof value !== 'boolean')) return null;
    return Object.freeze(values) as AdminUserPlaybackPolicyValues;
}

export function captureAdminUserLibraryAccess(
    policy: Readonly<Partial<UserPolicy>> | null | undefined
): AdminUserLibraryAccessBaseline | null {
    if (typeof policy?.EnableAllFolders !== 'boolean'
        || (policy.EnabledFolders !== undefined && !Array.isArray(policy.EnabledFolders))) return null;
    return Object.freeze({
        enableAllFolders: policy.EnableAllFolders,
        enabledFolderIds: Object.freeze(uniqueIds(policy.EnabledFolders))
    });
}

function samePlaybackPolicy(
    left: AdminUserPlaybackPolicyValues,
    right: AdminUserPlaybackPolicyValues
) {
    return ADMIN_USER_PLAYBACK_POLICY_FIELDS.every(field => left[field] === right[field]);
}

function sameFolderIds(left: readonly string[], right: readonly string[]) {
    if (left.length !== right.length) return false;
    const leftSorted = [ ...left ].sort((first, second) => first.localeCompare(second));
    const rightSorted = [ ...right ].sort((first, second) => first.localeCompare(second));
    return leftSorted.every((value, index) => value === rightSorted[index]);
}

function sameLibraryAccess(
    left: AdminUserLibraryAccessBaseline,
    right: AdminUserLibraryAccessBaseline
) {
    return left.enableAllFolders === right.enableAllFolders
        && sameFolderIds(left.enabledFolderIds, right.enabledFolderIds);
}

function canonicalAccessGuid(value: string) {
    const compact = value.replace(/-/g, '');
    return /^[a-fA-F0-9]{32}$/.test(compact) ? compact.toLowerCase() : value;
}

function captureHomeUserAccess(userId: string, policy: UserPolicy): HomeUserAccess | null {
    if (typeof policy.EnableAllFolders !== 'boolean'
        || policy.EnabledFolders !== undefined && !Array.isArray(policy.EnabledFolders)
        || typeof policy.IsAdministrator !== 'boolean' || typeof policy.IsDisabled !== 'boolean') return null;
    return {
        userId: canonicalAccessGuid(userId),
        enableAllFolders: policy.EnableAllFolders,
        enabledFolders: uniqueIds((policy.EnabledFolders || []).map(canonicalAccessGuid)).sort((left, right) => left.localeCompare(right)),
        isAdministrator: policy.IsAdministrator,
        isDisabled: policy.IsDisabled
    };
}

function sameHomeUserAccess(left: HomeUserAccess, right: HomeUserAccess) {
    return left.userId === right.userId && left.enableAllFolders === right.enableAllFolders
        && left.isAdministrator === right.isAdministrator && left.isDisabled === right.isDisabled
        && sameFolderIds(left.enabledFolders, right.enabledFolders);
}

function normalizedRecoveryAccess(access: HomeUserAccess | null | undefined, userId: string): HomeUserAccess | null {
    if (!access || canonicalAccessGuid(access.userId) !== userId
        || typeof access.enableAllFolders !== 'boolean'
        || typeof access.isAdministrator !== 'boolean' || typeof access.isDisabled !== 'boolean'
        || !Array.isArray(access.enabledFolders)) return null;
    const enabledFolders = access.enabledFolders.map(canonicalAccessGuid);
    if (enabledFolders.some(id => !/^[a-f0-9]{32}$/.test(id))
        || new Set(enabledFolders).size !== enabledFolders.length) return null;
    return { ...access, enabledFolders, userId };
}

function newAccessOperationId() {
    // eslint-disable-next-line compat/compat
    const cryptoApi = globalThis.crypto;
    if (!cryptoApi?.getRandomValues) throw new AdminUsersServiceError('transition-unavailable', 'Secure access transition identity is unavailable.');
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 15) | 64;
    bytes[8] = (bytes[8]! & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function homeUserAccessClient(api: Api) {
    const client = getCurrentPtvPluginApiClient();
    if (!client?.matchesSdkApi(api)) {
        throw new AdminUsersServiceError('transition-unavailable', 'The active server changed. Reload before changing access.');
    }
    return client;
}

export async function loadCurrentHomeUserAccess(api: Api, userId: string, signal?: AbortSignal): Promise<HomeUserAccessResponse | null> {
    const canonicalUserId = canonicalAccessGuid(requireUserId(userId));
    try {
        const current = await homeUserAccessClient(api).getCurrentHomeUserAccess(canonicalUserId, { signal });
        if (current.version !== 1 || current.userId !== canonicalUserId
            || typeof current.held !== 'boolean' || typeof current.policyProven !== 'boolean') {
            throw new AdminUsersServiceError('transition-unavailable', 'The account access state could not be verified.');
        }
        return current;
    } catch (error) {
        const failure = error as { status?: number; response?: { status?: number } };
        if (failure?.status === 404 || failure?.response?.status === 404) return null;
        throw error;
    }
}

/** Recheck the held operation; never issue another Jellyfin policy write. */
export async function retryExistingUserAccessCompletion(api: Api, userId: string, signal?: AbortSignal): Promise<HomeUserAccessResponse> {
    const current = await loadCurrentHomeUserAccess(api, userId, signal);
    if (!current || !current.held || current.policyProven || current.writeAllowed
        || current.state !== 'pending' && current.state !== 'failed'
        || !current.operationId || !/^[a-fA-F0-9]{8}-(?:[a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}$/.test(current.operationId)
        || !current.accessEpoch || !/^[a-fA-F0-9]{64}$/.test(current.accessEpoch)) {
        throw new AdminUsersServiceError('transition-unavailable', 'No held access operation can be verified for this account.');
    }
    const result = await homeUserAccessClient(api).completeHomeUserAccess(current.operationId, { signal });
    if (result.version !== 1 || result.userId !== current.userId || result.operationId !== current.operationId
        || result.accessEpoch !== current.accessEpoch || result.held || !result.policyProven
        || result.state !== 'policy-attested' || result.writeAllowed) {
        throw new AdminUsersServiceError('transition-unavailable', 'The account access operation remains held. Review Jellyfin policy before retrying verification.');
    }
    return result;
}

const controlledAccessFlights = new WeakSet<Api>();

/** A failed or uncertain stock write remains held for administrator recovery. */
async function writeExistingUserAccess(
    api: Api,
    userId: string,
    expectedPolicy: UserPolicy,
    intendedPolicy: UserPolicy,
    signal?: AbortSignal,
    modeOverride?: 'reproof'
): Promise<UserPolicy> {
    if (controlledAccessFlights.has(api)) {
        throw new AdminUsersServiceError('transition-unavailable', 'An access change is already pending.');
    }
    const canonicalUserId = canonicalAccessGuid(userId);
    const expectedAccess = captureHomeUserAccess(canonicalUserId, expectedPolicy);
    const intendedAccess = captureHomeUserAccess(canonicalUserId, intendedPolicy);
    if (!expectedAccess || !intendedAccess) {
        throw new AdminUsersServiceError('policy-unavailable', 'Account access could not be verified. No changes were made.');
    }
    const client = homeUserAccessClient(api);
    const operationId = newAccessOperationId();
    controlledAccessFlights.add(api);
    try {
        retireHomeUserAccessAuthority(canonicalUserId, 'controlled-user-access');
        let begun: Awaited<ReturnType<typeof client.beginHomeUserAccess>>;
        try {
            begun = await client.beginHomeUserAccess({
                operationId, userId: canonicalUserId,
                mode: modeOverride || (sameHomeUserAccess(expectedAccess, intendedAccess) ? 'preserve' : 'existing'),
                expectedAccess, intendedAccess
            }, { signal });
            if (begun.version !== 1 || begun.userId !== canonicalUserId || begun.operationId !== operationId
                || typeof begun.accessEpoch !== 'string' || !/^[a-fA-F0-9]{64}$/.test(begun.accessEpoch)
                || !begun.held || begun.policyProven || begun.state !== 'pending' || !begun.writeAllowed) {
                throw new AdminUsersServiceError('transition-unavailable', 'The access hold could not be verified. No changes were made.');
            }
            acknowledgeHomeUserAccessBeginEpoch(canonicalUserId, begun.accessEpoch);
        } finally {
            clearHomeUserAccessRetirementHint(canonicalUserId);
        }
        signal?.throwIfAborted();
        homeUserAccessClient(api);
        try {
            await getUserApi(api).updateUserPolicy({ userId, userPolicy: intendedPolicy }, { signal });
        } catch {
            throw new AdminUsersServiceError('transition-unavailable', 'The access write is uncertain. PTV Home remains held for this account. Review the pending operation before retrying.');
        }
        let readbackUser: UserDto;
        try {
            readbackUser = await loadAdminUser(api, userId, signal);
        } catch {
            throw new AdminUsersServiceError('transition-unavailable', 'The access readback is unavailable. PTV Home remains held for this account.');
        }
        if (!readbackUser.Id || canonicalAccessGuid(readbackUser.Id) !== canonicalUserId) {
            throw new AdminUsersServiceError('transition-unavailable', 'The account readback changed identity. PTV Home remains held for this account.');
        }
        if (!readbackUser.Policy) {
            throw new AdminUsersServiceError('transition-unavailable', 'The access readback is unavailable. PTV Home remains held for this account.');
        }
        const readback = clonePolicy(readbackUser.Policy);
        const actualAccess = captureHomeUserAccess(userId, readback);
        if (!actualAccess || !sameHomeUserAccess(actualAccess, intendedAccess)) {
            throw new AdminUsersServiceError('transition-unavailable', 'The access update could not be verified. PTV Home remains held for this account.');
        }
        let completed: Awaited<ReturnType<typeof client.completeHomeUserAccess>>;
        try {
            completed = await client.completeHomeUserAccess(operationId, { signal });
        } catch {
            throw new AdminUsersServiceError('transition-unavailable', 'Plugin access verification is unavailable. PTV Home remains held for this account.');
        }
        if (completed.version !== 1 || completed.userId !== canonicalUserId
            || completed.operationId !== operationId || completed.accessEpoch !== begun.accessEpoch
            || completed.held || !completed.policyProven || completed.state !== 'policy-attested' || completed.writeAllowed) {
            throw new AdminUsersServiceError('transition-unavailable', 'The access update is awaiting verification. PTV Home remains held for this account.');
        }
        return readback;
    } finally {
        controlledAccessFlights.delete(api);
    }
}

/** Deliberate administrator re-verification of a previously attested user. */
export async function reverifyPreviouslyAttestedUserAccess(
    api: Api,
    userId: string,
    reviewedAccess: HomeUserAccess,
    signal?: AbortSignal
): Promise<UserPolicy> {
    const id = canonicalAccessGuid(requireUserId(userId));
    if (!/^[a-f0-9]{32}$/.test(id)) {
        throw new AdminUsersServiceError('invalid-user', 'Choose a valid account for access verification.');
    }
    const reviewed = normalizedRecoveryAccess(reviewedAccess, id);
    const current = await loadCurrentHomeUserAccess(api, id, signal);
    const actual = normalizedRecoveryAccess(current?.currentAccess, id);
    const prior = normalizedRecoveryAccess(current?.intendedAccess, id);
    if (!reviewed || !actual || !prior || !current
        || current.state !== 'policy-attested' || !current.held || current.policyProven || current.writeAllowed
        || !current.operationId || !/^[a-fA-F0-9-]{32,36}$/.test(current.operationId)
        || !current.accessEpoch || !/^[a-fA-F0-9]{64}$/.test(current.accessEpoch)
        || !sameHomeUserAccess(reviewed, actual)) {
        throw new AdminUsersServiceError('transition-unavailable', 'The reviewed policy is no longer current. Refresh this account before re-verification.');
    }
    const user = await loadAdminUser(api, id, signal);
    if (!user.Id || canonicalAccessGuid(user.Id) !== id) {
        throw new AdminUsersServiceError('transition-unavailable', 'The account identity changed before verification.');
    }
    const policy = requirePolicy(user);
    const stockAccess = captureHomeUserAccess(id, policy);
    if (!stockAccess || !sameHomeUserAccess(stockAccess, reviewed)) {
        throw new AdminUsersServiceError('transition-unavailable', 'Jellyfin policy changed after review. No verification write was made.');
    }
    const modeOverride = sameHomeUserAccess(prior, reviewed) ? undefined : 'reproof';
    return writeExistingUserAccess(api, id, policy, policy, signal, modeOverride);
}

export async function loadAdminUsers(api: Api, signal?: AbortSignal): Promise<UserDto[]> {
    const response = await getUserApi(api).getUsers({}, { signal });
    if (!Array.isArray(response.data)) {
        throw new AdminUsersServiceError('users-unavailable', 'We could not load users.');
    }
    return response.data;
}

export async function loadAdminUser(api: Api, userId: string, signal?: AbortSignal): Promise<UserDto> {
    const response = await getUserApi(api).getUserById({
        userId: requireUserId(userId)
    }, { signal });
    if (!response.data?.Id) {
        throw new AdminUsersServiceError('invalid-user', 'This PiggieTV member could not be found.');
    }
    return response.data;
}

/** Loads all recent sessions once; adapters perform the per-user grouping. */
export async function loadAdminUserSessions(
    api: Api,
    signal?: AbortSignal,
    activeWithinSeconds?: number
): Promise<SessionInfoDto[]> {
    return loadAdminPeopleSessions(api, signal, undefined, activeWithinSeconds);
}

/**
 * Uses the media-folder API because UserPolicy.EnabledFolders references these
 * ids. Missing Items is a failure, not an empty server.
 */
export async function loadAdminUserLibraries(api: Api, signal?: AbortSignal): Promise<BaseItemDto[]> {
    const response = await getLibraryApi(api).getMediaFolders({ isHidden: false }, { signal });
    if (!Array.isArray(response.data?.Items)) {
        throw new AdminUsersServiceError(
            'folders-unavailable',
            'Library access could not be verified. No changes were made.'
        );
    }
    return response.data.Items;
}

export async function createAdminUser(
    api: Api,
    input: CreateAdminUserInput,
    signal?: AbortSignal
): Promise<UserDto> {
    const response = await getUserApi(api).createUserByName({
        createUserByName: {
            Name: requireUsername(input.username),
            Password: input.password || undefined
        }
    }, { signal });
    if (!response.data?.Id) {
        throw new AdminUsersServiceError(
            'invalid-user',
            'The account was created, but its details could not be loaded.'
        );
    }
    return response.data;
}

export async function deleteAdminUser(api: Api, userId: string, signal?: AbortSignal) {
    await getUserApi(api).deleteUser({ userId: requireUserId(userId) }, { signal });
}

/** Refetches the full UserDto before changing the Jellyfin-owned username. */
export async function updateAdminUsername(
    api: Api,
    userId: string,
    username: string,
    signal?: AbortSignal
) {
    const id = requireUserId(userId);
    const user = await loadAdminUser(api, id, signal);
    await getUserApi(api).updateUser({
        userDto: {
            ...user,
            Name: requireUsername(username)
        },
        userId: id
    }, { signal });
}

/**
 * Refetches and patches the complete authoritative policy so unrelated fields
 * are never replaced by a partial UI model.
 */
export async function updateAdminUserPolicy(
    api: Api,
    userId: string,
    patch: Readonly<Partial<UserPolicy>>,
    signal?: AbortSignal
): Promise<UserPolicy> {
    if (Object.prototype.hasOwnProperty.call(patch, 'EnableAllFolders')
        || Object.prototype.hasOwnProperty.call(patch, 'EnabledFolders')) {
        throw new AdminUsersServiceError('invalid-library-selection', 'Use the verified library access controls to change folders.');
    }
    const id = requireUserId(userId);
    const user = await loadAdminUser(api, id, signal);
    const expectedPolicy = requirePolicy(user);
    const policy = {
        ...expectedPolicy,
        ...patch
    } as UserPolicy;
    return writeExistingUserAccess(api, id, expectedPolicy, policy, signal);
}

/** Used only after Jellyfin has returned a newly created user ID; Plugin bootstrap gates Home. */
export async function updateNewAdminUserPolicy(
    api: Api,
    userId: string,
    patch: Readonly<Partial<UserPolicy>>,
    signal?: AbortSignal
): Promise<UserPolicy> {
    const id = requireUserId(userId);
    const policy = { ...requirePolicy(await loadAdminUser(api, id, signal)), ...patch } as UserPolicy;
    await getUserApi(api).updateUserPolicy({ userId: id, userPolicy: policy }, { signal });
    return policy;
}

/**
 * Saves only the playback fields owned by native User Detail. The complete
 * authoritative policy is refetched, while the immutable opening snapshot is
 * compared only against those managed fields before any write occurs.
 */
export async function updateAdminUserPlaybackPolicyFromBaseline(
    api: Api,
    userId: string,
    baseline: AdminUserPlaybackPolicyValues,
    edited: AdminUserPlaybackPolicyValues,
    signal?: AbortSignal
): Promise<AdminUserPolicySaveResult<AdminUserPlaybackPolicyValues>> {
    const id = requireUserId(userId);
    const user = await loadAdminUser(api, id, signal);
    const policy = requirePolicy(user);
    const authoritative = captureAdminUserPlaybackPolicy(policy);
    const validBaseline = captureAdminUserPlaybackPolicy(baseline);
    const validEdited = captureAdminUserPlaybackPolicy(edited);
    if (!authoritative || !validBaseline || !validEdited) {
        throw new AdminUsersServiceError(
            'policy-unavailable',
            'Playback permissions could not be verified. No changes were made.'
        );
    }
    if (!samePlaybackPolicy(authoritative, validBaseline)) {
        throw new AdminUsersServiceError(
            'managed-state-conflict',
            'Playback permissions changed on the server while you were editing. Reload the account before saving.'
        );
    }

    ADMIN_USER_PLAYBACK_POLICY_FIELDS.forEach(field => {
        policy[field] = validEdited[field];
    });
    await writeExistingUserAccess(api, id, requirePolicy(user), policy, signal);
    return {
        confirmedBaseline: captureAdminUserPlaybackPolicy(policy)!,
        policy
    };
}

export function setAdminUserEnabled(
    api: Api,
    userId: string,
    enabled: boolean,
    signal?: AbortSignal
) {
    return updateAdminUserPolicy(api, userId, { IsDisabled: !enabled }, signal);
}

export function setAdminUserAdministrator(
    api: Api,
    userId: string,
    isAdministrator: boolean,
    signal?: AbortSignal
) {
    return updateAdminUserPolicy(api, userId, { IsAdministrator: isAdministrator }, signal);
}

/**
 * Reloads both the full policy and folder inventory before saving. Existing
 * selected ids absent from the current folder response are retained.
 */
async function saveAdminUserLibraryAccess(
    api: Api,
    userId: string,
    selection: AdminUserLibrarySelection,
    baseline: AdminUserLibraryAccessBaseline | null,
    signal?: AbortSignal
): Promise<AdminUserPolicySaveResult<AdminUserLibraryAccessBaseline>> {
    const id = requireUserId(userId);
    const [ user, folders ] = await Promise.all([
        loadAdminUser(api, id, signal),
        loadAdminUserLibraries(api, signal)
    ]);
    const policy = requirePolicy(user);
    if (baseline) {
        const authoritative = captureAdminUserLibraryAccess(policy);
        if (!authoritative) {
            throw new AdminUsersServiceError(
                'policy-unavailable',
                'Library access could not be verified. No changes were made.'
            );
        }
        if (!sameLibraryAccess(authoritative, baseline)) {
            throw new AdminUsersServiceError(
                'managed-state-conflict',
                'Library access changed on the server while you were editing. Reload the account before saving.'
            );
        }
    }
    const knownFolderIds = new Set(folders.map(folder => folder.Id)
        .filter((value): value is string => Boolean(value)).map(canonicalAccessGuid));

    if (selection.mode === 'all') {
        policy.EnableAllFolders = true;
        policy.EnabledFolders = [];
    } else {
        if (!Array.isArray(selection.selectedFolderIds)) {
            throw new AdminUsersServiceError(
                'invalid-library-selection',
                'Choose the libraries this member can access.'
            );
        }

        const previouslySelected = uniqueIds(policy.EnabledFolders || []);
        const preservedUnknownIds = previouslySelected.filter(folderId => !knownFolderIds.has(canonicalAccessGuid(folderId)));
        const requestedIds = uniqueIds(selection.selectedFolderIds).map(canonicalAccessGuid);
        const preservedUnknownIdentity = new Set(preservedUnknownIds.map(canonicalAccessGuid));
        const invalidRequestedId = requestedIds.find(folderId => (
            !knownFolderIds.has(folderId) && !preservedUnknownIdentity.has(folderId)
        ));
        if (invalidRequestedId) {
            throw new AdminUsersServiceError(
                'invalid-library-selection',
                'Library access changed while this page was open. Refresh before saving.'
            );
        }

        policy.EnableAllFolders = false;
        const requestedIdentity = new Set(requestedIds);
        policy.EnabledFolders = uniqueIds([
            ...requestedIds.filter(folderId => knownFolderIds.has(folderId) || preservedUnknownIdentity.has(folderId)),
            ...preservedUnknownIds.filter(folderId => !requestedIdentity.has(canonicalAccessGuid(folderId)))
        ]);
    }

    const confirmedPolicy = baseline ?
        await writeExistingUserAccess(api, id, requirePolicy(user), policy, signal) :
        await updateNewAdminUserPolicy(api, id, {
            EnableAllFolders: policy.EnableAllFolders,
            EnabledFolders: policy.EnabledFolders
        }, signal);
    return {
        confirmedBaseline: captureAdminUserLibraryAccess(confirmedPolicy)!,
        policy: confirmedPolicy
    };
}

export async function updateAdminUserLibraryAccess(
    api: Api,
    userId: string,
    selection: AdminUserLibrarySelection,
    signal?: AbortSignal
): Promise<UserPolicy> {
    const result = await saveAdminUserLibraryAccess(api, userId, selection, null, signal);
    return result.policy;
}

export function updateAdminUserLibraryAccessFromBaseline(
    api: Api,
    userId: string,
    baseline: AdminUserLibraryAccessBaseline,
    selection: AdminUserLibrarySelection,
    signal?: AbortSignal
) {
    return saveAdminUserLibraryAccess(api, userId, selection, baseline, signal);
}

export async function updateAdminUserConfiguration(
    api: Api,
    userId: string,
    patch: Readonly<Partial<UserConfiguration>>,
    signal?: AbortSignal
): Promise<UserConfiguration> {
    const id = requireUserId(userId);
    const user = await loadAdminUser(api, id, signal);
    if (!user.Configuration) {
        throw new AdminUsersServiceError(
            'user-configuration-unavailable',
            'Account preferences could not be verified. No changes were made.'
        );
    }
    const configuration = { ...user.Configuration, ...patch };
    await getUserApi(api).updateUserConfiguration({
        userConfiguration: configuration,
        userId: id
    }, { signal });
    return configuration;
}

export async function updateAdminUserPassword(
    api: Api,
    userId: string,
    input: UpdateAdminUserPasswordInput,
    signal?: AbortSignal
) {
    if (!input.newPassword) {
        throw new AdminUsersServiceError('invalid-password', 'Enter a new password.');
    }
    await getUserApi(api).updateUserPassword({
        updateUserPassword: {
            CurrentPw: input.currentPassword || '',
            NewPw: input.newPassword,
            ResetPassword: false
        },
        userId: requireUserId(userId)
    }, { signal });
}

export async function resetAdminUserPassword(api: Api, userId: string, signal?: AbortSignal) {
    await getUserApi(api).updateUserPassword({
        updateUserPassword: {
            ResetPassword: true
        },
        userId: requireUserId(userId)
    }, { signal });
}
