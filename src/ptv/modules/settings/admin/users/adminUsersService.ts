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
    const id = requireUserId(userId);
    const user = await loadAdminUser(api, id, signal);
    const policy = {
        ...requirePolicy(user),
        ...patch
    } as UserPolicy;
    await getUserApi(api).updateUserPolicy({
        userId: id,
        userPolicy: policy
    }, { signal });
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
    await getUserApi(api).updateUserPolicy({
        userId: id,
        userPolicy: policy
    }, { signal });
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
    const knownFolderIds = new Set(folders.map(folder => folder.Id).filter((value): value is string => Boolean(value)));

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
        const preservedUnknownIds = previouslySelected.filter(folderId => !knownFolderIds.has(folderId));
        const requestedIds = uniqueIds(selection.selectedFolderIds);
        const invalidRequestedId = requestedIds.find(folderId => (
            !knownFolderIds.has(folderId) && !preservedUnknownIds.includes(folderId)
        ));
        if (invalidRequestedId) {
            throw new AdminUsersServiceError(
                'invalid-library-selection',
                'Library access changed while this page was open. Refresh before saving.'
            );
        }

        policy.EnableAllFolders = false;
        policy.EnabledFolders = uniqueIds([
            ...requestedIds.filter(folderId => knownFolderIds.has(folderId)),
            ...preservedUnknownIds
        ]);
    }

    await getUserApi(api).updateUserPolicy({
        userId: id,
        userPolicy: policy
    }, { signal });
    return {
        confirmedBaseline: captureAdminUserLibraryAccess(policy)!,
        policy
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
