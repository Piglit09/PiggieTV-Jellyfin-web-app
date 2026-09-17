import type {
    BaseItemDto,
    SessionInfoDto,
    UserDto,
    UserPolicy
} from '@jellyfin/sdk/lib/generated-client';

import type {
    AdminUserActionGuard,
    AdminUserContentPolicy,
    AdminUserDangerousAction,
    AdminUserDetail,
    AdminUserEmailStatus,
    AdminUserEditablePlaybackPolicy,
    AdminUserFilter,
    AdminUserLibraryAccess,
    AdminUserPlaybackPolicy,
    AdminUserProfileSourceState,
    AdminUserSelection,
    AdminUserSessionSourceState,
    AdminUserSession,
    AdminUserSort,
    AdminUserSummary,
    PtvAccountAdminUserSummary
} from './adminUsersModel';

const ACTIVE_SESSION_WINDOW_MS = 5 * 60_000;
const EMAIL_STATUSES: ReadonlySet<AdminUserEmailStatus> = new Set([
    'expired',
    'failed',
    'missing',
    'pending',
    'reverification_required',
    'unavailable',
    'verified'
]);

export type AdminUsersNormalizationOptions = Readonly<{
    activeSessionWindowMs?: number;
    now?: number;
    profileSourceState?: AdminUserProfileSourceState;
    sessionSourceState?: AdminUserSessionSourceState;
    resolveAvatarUrl?: (user: UserDto) => string | null | undefined;
}>;

function text(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized || null;
}

function finiteNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
}

/** Normalizes Jellyfin's hyphenated/non-hyphenated GUID variants for joins. */
export function getAdminUserIdentityKey(value?: string | null) {
    return String(value || '').replace(/-/g, '').trim().toLowerCase();
}

/** Returns an ISO timestamp only when the source contains a valid date. */
export function normalizeAdminUserDate(value?: string | null): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeEmailStatus(
    profile: PtvAccountAdminUserSummary | undefined,
    sourceState: AdminUserProfileSourceState
): AdminUserEmailStatus {
    if (sourceState === 'unavailable') return 'unavailable';
    const status = text(profile?.emailStatus)?.toLowerCase() as AdminUserEmailStatus | undefined;
    return status && EMAIL_STATUSES.has(status) ? status : 'missing';
}

function normalizeMediaTitle(session: SessionInfoDto) {
    const item = session.NowPlayingItem;
    if (!item) return null;

    if (item.Type === 'Episode') {
        const seriesName = text(item.SeriesName);
        const episodeName = text(item.Name);
        if (seriesName && episodeName) return `${seriesName} · ${episodeName}`;
        return seriesName || episodeName;
    }

    if (item.Type === 'Audio') {
        const artist = item.Artists?.map(text).find(Boolean);
        const track = text(item.Name);
        if (artist && track) return `${artist} · ${track}`;
        return artist || track;
    }

    return text(item.Name);
}

function isActiveSession(session: SessionInfoDto, now: number, activeWindowMs: number) {
    if (session.IsActive === false) return false;
    if (session.NowPlayingItem) return true;

    const lastActivityAt = normalizeAdminUserDate(session.LastActivityDate);
    return lastActivityAt !== null
        && now - Date.parse(lastActivityAt) <= activeWindowMs
        && now - Date.parse(lastActivityAt) >= 0;
}

export function normalizeAdminUserSessions(
    sessions: readonly SessionInfoDto[] | null | undefined,
    userId: string,
    options: Pick<AdminUsersNormalizationOptions, 'activeSessionWindowMs' | 'now'> = {}
): AdminUserSession[] {
    const identityKey = getAdminUserIdentityKey(userId);
    if (!identityKey || !Array.isArray(sessions)) return [];
    const now = options.now ?? Date.now();
    const activeWindowMs = options.activeSessionWindowMs ?? ACTIVE_SESSION_WINDOW_MS;

    return sessions
        .filter(session => getAdminUserIdentityKey(session.UserId) === identityKey)
        .filter(session => isActiveSession(session, now, activeWindowMs))
        .map(session => ({
            client: text(session.Client),
            deviceName: text(session.DeviceName),
            lastActivityAt: normalizeAdminUserDate(session.LastActivityDate),
            mediaTitle: normalizeMediaTitle(session),
            paused: Boolean(session.PlayState?.IsPaused),
            playing: Boolean(session.NowPlayingItem)
        }))
        .sort((left, right) => {
            const leftTime = left.lastActivityAt ? Date.parse(left.lastActivityAt) : -1;
            const rightTime = right.lastActivityAt ? Date.parse(right.lastActivityAt) : -1;
            return rightTime - leftTime;
        });
}

function getAvatarUrl(user: UserDto, resolver?: AdminUsersNormalizationOptions['resolveAvatarUrl']) {
    if (!resolver || !user.PrimaryImageTag) return null;
    try {
        return text(resolver(user));
    } catch {
        return null;
    }
}

export function normalizeAdminUserSummary(
    user: UserDto,
    profile?: PtvAccountAdminUserSummary,
    sessions?: readonly SessionInfoDto[] | null,
    options: AdminUsersNormalizationOptions = {}
): AdminUserSummary | null {
    const id = text(user.Id);
    if (!id) return null;
    const normalizedSessions = normalizeAdminUserSessions(sessions, id, options);
    const sourceState = options.profileSourceState || 'ready';
    const emailStatus = normalizeEmailStatus(profile, sourceState);
    const verifiedEmail = sourceState === 'ready'
        && profile?.emailVerified === true ? text(profile.email) : null;
    const authorizationState = user.Policy ? 'ready' : 'unavailable';
    const enabled = user.Policy ? !user.Policy.IsDisabled : false;
    const isAdministrator = user.Policy ? Boolean(user.Policy.IsAdministrator) : false;

    return {
        accountStatus: enabled ? 'active' : 'disabled',
        activeSessionCount: normalizedSessions.length,
        authorizationState,
        avatarUrl: getAvatarUrl(user, options.resolveAvatarUrl),
        email: verifiedEmail,
        emailStatus,
        emailVerifiedAt: verifiedEmail ? normalizeAdminUserDate(profile?.emailVerifiedAt) : null,
        enabled,
        id,
        isAdministrator,
        lastActivityAt: normalizeAdminUserDate(user.LastActivityDate),
        lastLoginAt: normalizeAdminUserDate(user.LastLoginDate),
        maskedEmail: sourceState === 'ready' ? text(profile?.maskedEmail) : null,
        profileSourceState: sourceState,
        role: isAdministrator ? 'administrator' : 'member',
        sessionSourceState: options.sessionSourceState || 'ready',
        sessions: normalizedSessions,
        username: text(user.Name) || 'Unnamed member'
    };
}

export function mergeAdminUsers(
    users: readonly UserDto[] | null | undefined,
    profileRows: readonly PtvAccountAdminUserSummary[] | null | undefined,
    sessions: readonly SessionInfoDto[] | null | undefined,
    options: AdminUsersNormalizationOptions = {}
): AdminUserSummary[] {
    if (!Array.isArray(users)) return [];
    const profilesByUserId = new Map<string, PtvAccountAdminUserSummary>();
    if (Array.isArray(profileRows)) {
        profileRows.forEach(profile => {
            const key = getAdminUserIdentityKey(profile.jellyfinUserId);
            if (key && !profilesByUserId.has(key)) profilesByUserId.set(key, profile);
        });
    }

    return users.flatMap(user => {
        const key = getAdminUserIdentityKey(user.Id);
        const summary = normalizeAdminUserSummary(
            user,
            profilesByUserId.get(key),
            sessions,
            options
        );
        return summary ? [ summary ] : [];
    });
}

function normalizePlaybackPolicy(policy?: UserPolicy): AdminUserPlaybackPolicy {
    return {
        allowAudioTranscoding: booleanOrNull(policy?.EnableAudioPlaybackTranscoding),
        allowDownloads: booleanOrNull(policy?.EnableContentDownloading),
        allowLiveTv: booleanOrNull(policy?.EnableLiveTvAccess),
        allowMediaPlayback: booleanOrNull(policy?.EnableMediaPlayback),
        allowRemoteAccess: booleanOrNull(policy?.EnableRemoteAccess),
        allowRemuxing: booleanOrNull(policy?.EnablePlaybackRemuxing),
        allowVideoTranscoding: booleanOrNull(policy?.EnableVideoPlaybackTranscoding),
        maxActiveSessions: finiteNumber(policy?.MaxActiveSessions),
        remoteBitrateLimit: finiteNumber(policy?.RemoteClientBitrateLimit)
    };
}

function normalizeEditablePlaybackPolicy(policy?: UserPolicy): AdminUserEditablePlaybackPolicy | null {
    if (!policy) return null;
    const values = {
        allowAudioTranscoding: policy.EnableAudioPlaybackTranscoding,
        allowDownloads: policy.EnableContentDownloading,
        allowLiveTv: policy.EnableLiveTvAccess,
        allowMediaPlayback: policy.EnableMediaPlayback,
        allowRemoteAccess: policy.EnableRemoteAccess,
        allowRemuxing: policy.EnablePlaybackRemuxing,
        allowVideoTranscoding: policy.EnableVideoPlaybackTranscoding
    };
    if (Object.values(values).some(value => typeof value !== 'boolean')) return null;
    return values as AdminUserEditablePlaybackPolicy;
}

function normalizeContentPolicy(policy?: UserPolicy): AdminUserContentPolicy {
    return {
        accessScheduleCount: Array.isArray(policy?.AccessSchedules) ? policy.AccessSchedules.length : null,
        allowedTagCount: Array.isArray(policy?.AllowedTags) ? policy.AllowedTags.length : null,
        blockedTagCount: Array.isArray(policy?.BlockedTags) ? policy.BlockedTags.length : null,
        blockedUnratedItemCount: Array.isArray(policy?.BlockUnratedItems) ? policy.BlockUnratedItems.length : null,
        maxParentalRating: finiteNumber(policy?.MaxParentalRating)
    };
}

export function normalizeAdminUserDetail(
    user: UserDto,
    profile?: PtvAccountAdminUserSummary,
    sessions?: readonly SessionInfoDto[] | null,
    options: AdminUsersNormalizationOptions = {}
): AdminUserDetail | null {
    const summary = normalizeAdminUserSummary(user, profile, sessions, options);
    if (!summary) return null;
    const policy = user.Policy;

    return {
        ...summary,
        contentPolicy: normalizeContentPolicy(policy),
        editablePlaybackPolicy: normalizeEditablePlaybackPolicy(policy),
        hasConfiguredPassword: booleanOrNull(user.HasConfiguredPassword),
        hiddenFromLogin: booleanOrNull(policy?.IsHidden),
        invalidLoginAttemptCount: finiteNumber(policy?.InvalidLoginAttemptCount),
        playbackPolicy: normalizePlaybackPolicy(policy),
        policyAvailable: Boolean(policy)
    };
}

function uniqueIds(values: readonly (string | null | undefined)[] | null | undefined) {
    const result: string[] = [];
    const seen = new Set<string>();
    (values || []).forEach(value => {
        const id = text(value);
        if (!id || seen.has(id)) return;
        seen.add(id);
        result.push(id);
    });
    return result;
}

export function createUnavailableAdminUserLibraryAccess(
    reason: 'folders-unavailable' | 'policy-unavailable' | 'user-unavailable'
): AdminUserLibraryAccess {
    return {
        folders: [],
        mode: 'unavailable',
        preservedFolderIds: [],
        reason,
        selectedFolderIds: []
    };
}

export function normalizeAdminUserLibraryAccess(
    user: UserDto | null | undefined,
    folders: readonly BaseItemDto[] | null | undefined
): AdminUserLibraryAccess {
    if (!user?.Id) return createUnavailableAdminUserLibraryAccess('user-unavailable');
    if (!user.Policy) return createUnavailableAdminUserLibraryAccess('policy-unavailable');
    if (!Array.isArray(folders)) return createUnavailableAdminUserLibraryAccess('folders-unavailable');

    const allFolders = Boolean(user.Policy.EnableAllFolders);
    const selectedFolderIds = allFolders ? [] : uniqueIds(user.Policy.EnabledFolders);
    const selected = new Set(selectedFolderIds);
    const folderIds = new Set<string>();
    const normalizedFolders = folders.flatMap(folder => {
        const id = text(folder.Id);
        if (!id || folderIds.has(id)) return [];
        folderIds.add(id);
        return [{
            id,
            name: text(folder.Name) || 'Unnamed library',
            selected: allFolders || selected.has(id)
        }];
    });

    return {
        folders: normalizedFolders,
        mode: allFolders ? 'all' : 'selected',
        preservedFolderIds: selectedFolderIds.filter(id => !folderIds.has(id)),
        selectedFolderIds
    };
}

function compareUsername(left: AdminUserSummary, right: AdminUserSummary) {
    const byName = left.username.localeCompare(right.username, undefined, {
        numeric: true,
        sensitivity: 'base'
    });
    return byName || left.id.localeCompare(right.id);
}

export function searchAdminUsers(users: readonly AdminUserSummary[], query = '') {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return [ ...users ];

    return users.filter(user => (
        user.username.toLocaleLowerCase().includes(normalizedQuery)
        || Boolean(user.email?.toLocaleLowerCase().includes(normalizedQuery))
        || Boolean(user.maskedEmail?.toLocaleLowerCase().includes(normalizedQuery))
    ));
}

export function filterAdminUsers(users: readonly AdminUserSummary[], filter: AdminUserFilter = 'all') {
    switch (filter) {
        case 'administrators':
            return users.filter(user => user.isAdministrator);
        case 'members':
            return users.filter(user => !user.isAdministrator);
        case 'disabled':
            return users.filter(user => !user.enabled);
        case 'all':
        default:
            return [ ...users ];
    }
}

export function sortAdminUsers(users: readonly AdminUserSummary[], sort: AdminUserSort = 'username') {
    return [ ...users ].sort((left, right) => {
        if (sort === 'last-activity') {
            const leftTime = left.lastActivityAt ? Date.parse(left.lastActivityAt) : -1;
            const rightTime = right.lastActivityAt ? Date.parse(right.lastActivityAt) : -1;
            return rightTime - leftTime || compareUsername(left, right);
        }

        if (sort === 'role') {
            const byRole = Number(right.isAdministrator) - Number(left.isAdministrator);
            return byRole || compareUsername(left, right);
        }

        return compareUsername(left, right);
    });
}

export function selectAdminUsers(
    users: readonly AdminUserSummary[],
    selection: AdminUserSelection = {}
) {
    return sortAdminUsers(
        filterAdminUsers(searchAdminUsers(users, selection.query), selection.filter),
        selection.sort
    );
}

export function getAdminUserActionGuard(
    action: AdminUserDangerousAction,
    target: AdminUserSummary,
    currentUserId: string | null | undefined,
    users: readonly AdminUserSummary[] | null | undefined
): AdminUserActionGuard {
    const currentKey = getAdminUserIdentityKey(currentUserId);
    const targetKey = getAdminUserIdentityKey(target.id);
    if (!currentKey || !targetKey || !Array.isArray(users)
        || target.authorizationState !== 'ready'
        || users.some(user => user.authorizationState !== 'ready')) {
        return {
            allowed: false,
            code: 'state-unavailable',
            reason: 'Administrator account state could not be verified.'
        };
    }

    if (currentKey === targetKey) {
        const labels: Record<AdminUserDangerousAction, string> = {
            delete: 'delete',
            demote: 'remove administrator access from',
            disable: 'disable'
        };
        return {
            allowed: false,
            code: 'current-user',
            reason: `You cannot ${labels[action]} the account you are currently using.`
        };
    }

    const enabledAdministratorCount = users.filter(user => user.enabled && user.isAdministrator).length;
    if (target.enabled && target.isAdministrator && enabledAdministratorCount <= 1) {
        return {
            allowed: false,
            code: 'last-enabled-administrator',
            reason: 'At least one enabled administrator account must remain.'
        };
    }

    return { allowed: true, code: 'allowed', reason: null };
}
