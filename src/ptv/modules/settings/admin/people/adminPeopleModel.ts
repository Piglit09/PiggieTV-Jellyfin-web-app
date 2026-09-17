export type AdminPeopleSourceState = 'ready' | 'unavailable';

export type AdminPeoplePlaybackMethod =
    | 'direct-play'
    | 'direct-stream'
    | 'transcoding'
    | 'unknown';

export type AdminPeopleSessionStatus =
    | 'playing'
    | 'paused'
    | 'active'
    | 'inactive';

export type AdminPeopleDeviceStatus =
    | 'playing'
    | 'paused'
    | 'active'
    | 'not-active'
    | 'unavailable';

export type AdminPeopleUserReference = Readonly<{
    /** The exact immutable Jellyfin user id, when the source provides one. */
    id: string | null;
    /** True only when the current users response still contains this id. */
    isCurrentUser: boolean;
    username: string | null;
}>;

export type AdminPeopleSession = Readonly<{
    active: boolean;
    clientName: string | null;
    clientVersion: string | null;
    deviceId: string;
    deviceName: string | null;
    deviceType: string | null;
    lastActivityAt: string | null;
    mediaSubtitle: string | null;
    mediaTitle: string | null;
    mediaType: string | null;
    paused: boolean;
    playbackMethod: AdminPeoplePlaybackMethod;
    playbackMethodLabel: string;
    playing: boolean;
    sessionId: string | null;
    status: AdminPeopleSessionStatus;
    statusLabel: string;
    user: AdminPeopleUserReference | null;
}>;

export type AdminPeopleDevice = Readonly<{
    activeSessionCount: number | null;
    appName: string | null;
    appVersion: string | null;
    canRemove: boolean;
    current: boolean;
    /** Exact server-returned id used for a removal request. */
    id: string;
    lastSeenAt: string | null;
    name: string;
    pausedSessionCount: number | null;
    playingSessionCount: number | null;
    registered: boolean;
    /** Exact casing variants retained from registry rows for diagnostics/tests. */
    registrationIds: readonly string[];
    registryEntryCount: number;
    sessionSourceState: AdminPeopleSourceState;
    sessions: readonly AdminPeopleSession[];
    status: AdminPeopleDeviceStatus;
    statusLabel: string;
    userSourceState: AdminPeopleSourceState;
    users: readonly AdminPeopleUserReference[];
}>;

export type AdminPeopleDeviceFilter = 'all' | 'active' | 'playing' | 'inactive';

export type AdminPeopleDeviceSelection = Readonly<{
    filter?: AdminPeopleDeviceFilter;
    query?: string;
    userId?: string | null;
}>;

export type AdminPeopleActivitySeverity =
    | 'info'
    | 'warning'
    | 'error'
    | 'unknown';

export type AdminPeopleActivityCategory =
    | 'user'
    | 'playback'
    | 'library'
    | 'administration'
    | 'plugin'
    | 'other';

export type AdminPeopleActivityEntry = Readonly<{
    category: AdminPeopleActivityCategory;
    categoryLabel: string;
    createdAt: string | null;
    description: string | null;
    id: string | null;
    itemId: string | null;
    name: string;
    severity: AdminPeopleActivitySeverity;
    severityLabel: string;
    type: string | null;
    user: AdminPeopleUserReference | null;
}>;

export type AdminPeopleActivityPage = Readonly<{
    items: readonly AdminPeopleActivityEntry[];
    startIndex: number | null;
    totalRecordCount: number | null;
    userSourceState: AdminPeopleSourceState;
}>;

export type AdminPeopleActivitySelection = Readonly<{
    /** Local search over the bounded, currently loaded page. */
    query?: string;
    /** Local immutable-id filter over the bounded, currently loaded page. */
    userId?: string | null;
}>;
