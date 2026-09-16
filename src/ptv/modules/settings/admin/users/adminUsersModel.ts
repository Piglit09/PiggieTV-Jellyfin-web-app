export type AdminUserEmailStatus =
    | 'verified'
    | 'pending'
    | 'missing'
    | 'expired'
    | 'failed'
    | 'reverification_required'
    | 'unavailable';

export type AdminUserRole = 'administrator' | 'member';
export type AdminUserAccountStatus = 'active' | 'disabled';
export type AdminUserAuthorizationState = 'ready' | 'unavailable';
export type AdminUserProfileSourceState = 'ready' | 'unavailable';
export type AdminUserSessionSourceState = 'ready' | 'unavailable';

/** PiggieTV profile row returned by the administrator-only summary source. */
export type PtvAccountAdminUserSummary = Readonly<{
    email?: string | null;
    emailStatus?: string | null;
    emailVerified?: boolean;
    emailVerifiedAt?: string | null;
    jellyfinUserId: string;
    lastProfileSync?: string | null;
    lastProfileSyncAtUtc?: string | null;
    maskedEmail?: string | null;
    profileStatus?: string | null;
    username?: string | null;
}>;

export type AdminUserSession = Readonly<{
    client: string | null;
    deviceName: string | null;
    lastActivityAt: string | null;
    mediaTitle: string | null;
    paused: boolean;
    playing: boolean;
}>;

/** UI-facing user summary. The immutable Jellyfin id is the only raw id. */
export type AdminUserSummary = Readonly<{
    accountStatus: AdminUserAccountStatus;
    activeSessionCount: number;
    avatarUrl: string | null;
    /** Canonical email is exposed only when the plugin marks it verified. */
    email: string | null;
    emailStatus: AdminUserEmailStatus;
    emailVerifiedAt: string | null;
    enabled: boolean;
    id: string;
    isAdministrator: boolean;
    lastActivityAt: string | null;
    lastLoginAt: string | null;
    maskedEmail: string | null;
    profileSourceState: AdminUserProfileSourceState;
    authorizationState: AdminUserAuthorizationState;
    role: AdminUserRole;
    sessionSourceState: AdminUserSessionSourceState;
    sessions: readonly AdminUserSession[];
    username: string;
}>;

export type AdminUserPlaybackPolicy = Readonly<{
    allowAudioTranscoding: boolean | null;
    allowDownloads: boolean | null;
    allowLiveTv: boolean | null;
    allowMediaPlayback: boolean | null;
    allowRemoteAccess: boolean | null;
    allowRemuxing: boolean | null;
    allowVideoTranscoding: boolean | null;
    maxActiveSessions: number | null;
    remoteBitrateLimit: number | null;
}>;

export type AdminUserEditablePlaybackPolicy = Readonly<{
    allowAudioTranscoding: boolean;
    allowDownloads: boolean;
    allowLiveTv: boolean;
    allowMediaPlayback: boolean;
    allowRemoteAccess: boolean;
    allowRemuxing: boolean;
    allowVideoTranscoding: boolean;
}>;

export type AdminUserContentPolicy = Readonly<{
    accessScheduleCount: number | null;
    allowedTagCount: number | null;
    blockedTagCount: number | null;
    blockedUnratedItemCount: number | null;
    maxParentalRating: number | null;
}>;

export type AdminUserDetail = AdminUserSummary & Readonly<{
    contentPolicy: AdminUserContentPolicy;
    hasConfiguredPassword: boolean | null;
    hiddenFromLogin: boolean | null;
    invalidLoginAttemptCount: number | null;
    playbackPolicy: AdminUserPlaybackPolicy;
    editablePlaybackPolicy: AdminUserEditablePlaybackPolicy | null;
    policyAvailable: boolean;
}>;

export type AdminUserLibraryFolder = Readonly<{
    id: string;
    name: string;
    selected: boolean;
}>;

type AdminUserAvailableLibraryAccess = Readonly<{
    folders: readonly AdminUserLibraryFolder[];
    /** Folder ids retained even when the folder source no longer describes them. */
    preservedFolderIds: readonly string[];
    selectedFolderIds: readonly string[];
}>;

export type AdminUserLibraryAccess =
    | (AdminUserAvailableLibraryAccess & Readonly<{ mode: 'all' }>)
    | (AdminUserAvailableLibraryAccess & Readonly<{ mode: 'selected' }>)
    | Readonly<{
        folders: readonly [];
        mode: 'unavailable';
        preservedFolderIds: readonly [];
        reason: 'folders-unavailable' | 'policy-unavailable' | 'user-unavailable';
        selectedFolderIds: readonly [];
    }>;

export type AdminUserFilter = 'all' | 'administrators' | 'members' | 'disabled';
export type AdminUserSort = 'username' | 'last-activity' | 'role';

export type AdminUserSelection = Readonly<{
    filter?: AdminUserFilter;
    query?: string;
    sort?: AdminUserSort;
}>;

export type AdminUserDangerousAction = 'delete' | 'disable' | 'demote';

export type AdminUserActionGuard = Readonly<{
    allowed: boolean;
    code: 'allowed' | 'current-user' | 'last-enabled-administrator' | 'state-unavailable';
    reason: string | null;
}>;

export type AdminUserLibrarySelection = Readonly<{
    mode: 'all' | 'selected';
    selectedFolderIds?: readonly string[];
}>;

export type CreateAdminUserInput = Readonly<{
    password?: string;
    username: string;
}>;

export type UpdateAdminUserPasswordInput = Readonly<{
    currentPassword?: string;
    newPassword: string;
}>;
