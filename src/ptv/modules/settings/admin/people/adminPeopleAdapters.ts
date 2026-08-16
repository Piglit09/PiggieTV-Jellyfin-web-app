import type {
    ActivityLogEntry,
    ActivityLogEntryQueryResult,
    BaseItemDto,
    DeviceInfoDto,
    SessionInfoDto,
    UserDto
} from '@jellyfin/sdk/lib/generated-client';

import type {
    AdminPeopleActivitySelection,
    AdminPeopleActivityCategory,
    AdminPeopleActivityEntry,
    AdminPeopleActivityPage,
    AdminPeopleActivitySeverity,
    AdminPeopleDevice,
    AdminPeopleDeviceSelection,
    AdminPeopleDeviceStatus,
    AdminPeoplePlaybackMethod,
    AdminPeopleSession,
    AdminPeopleSourceState,
    AdminPeopleUserReference
} from './adminPeopleModel';

export type AdminPeopleUsersMap = ReadonlyMap<string, AdminPeopleUserReference>;
export type AdminPeopleUsersSource =
    | AdminPeopleUsersMap
    | readonly UserDto[]
    | null
    | undefined;

export type AdminPeopleDevicesNormalizationOptions = Readonly<{
    currentDeviceId?: string | null;
    sessionSourceState?: AdminPeopleSourceState;
    userSourceState?: AdminPeopleSourceState;
}>;

export type AdminPeopleActivityNormalizationOptions = Readonly<{
    userSourceState?: AdminPeopleSourceState;
}>;

const ZERO_GUID_KEY = '00000000000000000000000000000000';

const USER_ACTIVITY_TYPES = new Set([
    'authenticationsucceeded',
    'authenticationfailed',
    'sessionstarted',
    'sessionended',
    'usercreated',
    'userdeleted',
    'userlockedout',
    'userpasswordchanged'
]);

const PLAYBACK_ACTIVITY_TYPES = new Set([
    'audioplayback',
    'audioplaybackstopped',
    'playback',
    'playbackstart',
    'playbackstopped',
    'videoplayback',
    'videoplaybackstopped'
]);

const LIBRARY_ACTIVITY_TYPES = new Set([
    'lyricdownloadfailure',
    'subtitledownloadfailure',
    'userdownloadingcontent'
]);

const ADMINISTRATION_ACTIVITY_TYPES = new Set([
    'taskcompleted',
    'taskfailed'
]);

const PLUGIN_ACTIVITY_TYPES = new Set([
    'installationfailed',
    'plugininstallationfailed',
    'plugininstalled',
    'pluginupdateinstalled',
    'pluginuninstalled',
    'pluginupdated'
]);

/** Core Jellyfin events whose ShortOverview is populated with the remote endpoint. */
const IP_BEARING_SHORT_OVERVIEW_TYPES = new Set([
    'authenticationsucceeded',
    'authenticationfailed',
    'sessionstarted',
    'sessionended'
]);

function text(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized || null;
}

function nonNegativeInteger(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Normalizes Jellyfin's hyphenated/non-hyphenated GUID variants for joins. */
export function getAdminPeopleUserIdentityKey(value?: string | null) {
    const key = String(value || '').replace(/-/g, '').trim().toLowerCase();
    return key && key !== ZERO_GUID_KEY ? key : '';
}

function getDeviceIdentityKey(value?: string | null) {
    return String(value || '').trim().toLowerCase();
}

export function normalizeAdminPeopleDate(value?: string | null): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function createAdminPeopleUsersMap(
    users: readonly UserDto[] | null | undefined
): AdminPeopleUsersMap {
    const result = new Map<string, AdminPeopleUserReference>();
    if (!Array.isArray(users)) return result;

    users.forEach(user => {
        const id = text(user.Id);
        const key = getAdminPeopleUserIdentityKey(id);
        if (!id || !key || result.has(key)) return;
        result.set(key, {
            id,
            isCurrentUser: true,
            username: text(user.Name)
        });
    });

    return result;
}

function isUserDtoArray(source: AdminPeopleUsersSource): source is readonly UserDto[] {
    return Array.isArray(source);
}

function resolveUsersMap(source: AdminPeopleUsersSource): AdminPeopleUsersMap {
    if (isUserDtoArray(source)) return createAdminPeopleUsersMap(source);
    return source || new Map();
}

function normalizeUserReference(
    userId: string | null | undefined,
    username: string | null | undefined,
    users: AdminPeopleUsersMap
): AdminPeopleUserReference | null {
    const id = text(userId);
    const key = getAdminPeopleUserIdentityKey(id);
    const current = key ? users.get(key) : undefined;
    if (current) return current;

    const recordedUsername = text(username);
    if (!key && !recordedUsername) return null;

    return {
        id: key ? id : null,
        isCurrentUser: false,
        username: recordedUsername
    };
}

function normalizePlaybackMethod(value: unknown): AdminPeoplePlaybackMethod {
    switch (value) {
        case 'DirectPlay':
            return 'direct-play';
        case 'DirectStream':
            return 'direct-stream';
        case 'Transcode':
            return 'transcoding';
        default:
            return 'unknown';
    }
}

function playbackMethodLabel(method: AdminPeoplePlaybackMethod) {
    switch (method) {
        case 'direct-play':
            return 'Direct Play';
        case 'direct-stream':
            return 'Direct Stream';
        case 'transcoding':
            return 'Transcoding';
        default:
            return 'Unknown';
    }
}

function formatEpisodeCode(item: BaseItemDto) {
    const season = nonNegativeInteger(item.ParentIndexNumber);
    const episode = nonNegativeInteger(item.IndexNumber);
    if (season === null && episode === null) return null;
    if (season === null) return `E${String(episode).padStart(2, '0')}`;
    if (episode === null) return `S${String(season).padStart(2, '0')}`;
    return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
}

function normalizeMedia(item?: BaseItemDto) {
    if (!item) {
        return {
            mediaSubtitle: null,
            mediaTitle: null,
            mediaType: null
        };
    }

    const itemName = text(item.Name);
    if (item.Type === 'Episode') {
        const seriesName = text(item.SeriesName);
        const code = formatEpisodeCode(item);
        const subtitle = [ code, seriesName ? itemName : null ].filter(Boolean).join(' \u00b7 ');
        return {
            mediaSubtitle: subtitle || null,
            mediaTitle: seriesName || itemName,
            mediaType: 'episode'
        };
    }

    if (item.Type === 'Audio') {
        const artist = item.Artists?.map(text).find(Boolean)
            || text(item.AlbumArtist)
            || text(item.Album);
        return {
            mediaSubtitle: itemName,
            mediaTitle: artist || itemName,
            mediaType: 'music'
        };
    }

    return {
        mediaSubtitle: null,
        mediaTitle: itemName,
        mediaType: text(item.Type)?.toLowerCase() || null
    };
}

function normalizeSessionState(active: boolean, playing: boolean, paused: boolean) {
    if (paused) return { status: 'paused', statusLabel: 'Paused' } as const;
    if (playing) return { status: 'playing', statusLabel: 'Playing' } as const;
    if (active) return { status: 'active', statusLabel: 'Active' } as const;
    return { status: 'inactive', statusLabel: 'Not active' } as const;
}

export function normalizeAdminPeopleSession(
    session: SessionInfoDto,
    usersSource: AdminPeopleUsersSource = new Map()
): AdminPeopleSession | null {
    const users = resolveUsersMap(usersSource);
    const deviceId = text(session.DeviceId);
    if (!deviceId) return null;

    // IsActive is authoritative when present. Missing is unknown, never active.
    const active = session.IsActive === true;
    const hasActivePlayback = active && Boolean(session.NowPlayingItem && session.PlayState);
    const paused = hasActivePlayback && session.PlayState?.IsPaused === true;
    const playing = hasActivePlayback;
    const playbackMethod = normalizePlaybackMethod(session.PlayState?.PlayMethod);

    return {
        ...normalizeSessionState(active, playing, paused),
        ...normalizeMedia(session.NowPlayingItem),
        active,
        clientName: text(session.Client),
        clientVersion: text(session.ApplicationVersion),
        deviceId,
        deviceName: text(session.DeviceName),
        deviceType: text(session.DeviceType),
        lastActivityAt: normalizeAdminPeopleDate(session.LastActivityDate),
        paused,
        playbackMethod,
        playbackMethodLabel: playbackMethodLabel(playbackMethod),
        playing,
        sessionId: text(session.Id),
        user: normalizeUserReference(session.UserId, session.UserName, users)
    };
}

type IndexedDevice = Readonly<{
    index: number;
    source: DeviceInfoDto;
}>;

type DeviceGroup = {
    firstIndex: number;
    registry: IndexedDevice[];
    sessions: AdminPeopleSession[];
};

function dateTime(value: string | null | undefined) {
    const normalized = normalizeAdminPeopleDate(value);
    return normalized ? Date.parse(normalized) : -1;
}

function compareRegistryRows(left: IndexedDevice, right: IndexedDevice) {
    return dateTime(right.source.DateLastActivity) - dateTime(left.source.DateLastActivity)
        || left.index - right.index;
}

function compareSessions(left: AdminPeopleSession, right: AdminPeopleSession) {
    return Number(right.active) - Number(left.active)
        || dateTime(right.lastActivityAt) - dateTime(left.lastActivityAt)
        || (left.sessionId || '').localeCompare(right.sessionId || '');
}

function latestDate(values: readonly (string | null | undefined)[]) {
    return values
        .map(normalizeAdminPeopleDate)
        .filter((value): value is string => Boolean(value))
        .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;
}

function uniqueExact(values: readonly (string | null | undefined)[]) {
    const seen = new Set<string>();
    return values.flatMap(value => {
        const normalized = text(value);
        if (!normalized || seen.has(normalized)) return [];
        seen.add(normalized);
        return [ normalized ];
    });
}

function uniqueUsers(values: readonly (AdminPeopleUserReference | null)[]) {
    const seen = new Set<string>();
    return values.flatMap(user => {
        if (!user) return [];
        const key = getAdminPeopleUserIdentityKey(user.id)
            || `name:${String(user.username || '').toLowerCase()}`;
        if (!key || seen.has(key)) return [];
        seen.add(key);
        return [ user ];
    });
}

function deviceStatus(sessions: readonly AdminPeopleSession[], state: AdminPeopleSourceState): {
    status: AdminPeopleDeviceStatus;
    statusLabel: string;
} {
    if (state === 'unavailable') {
        return { status: 'unavailable', statusLabel: 'Session state unavailable' };
    }
    if (sessions.some(session => session.playing && !session.paused)) {
        return { status: 'playing', statusLabel: 'Playing' };
    }
    if (sessions.some(session => session.paused)) {
        return { status: 'paused', statusLabel: 'Paused' };
    }
    if (sessions.some(session => session.active)) {
        return { status: 'active', statusLabel: 'Active' };
    }
    return { status: 'not-active', statusLabel: 'Not active' };
}

function normalizeDeviceGroup(
    group: DeviceGroup,
    users: AdminPeopleUsersMap,
    options: Required<Pick<
        AdminPeopleDevicesNormalizationOptions,
        'sessionSourceState' | 'userSourceState'
    >>
        & Pick<AdminPeopleDevicesNormalizationOptions, 'currentDeviceId'>
): AdminPeopleDevice {
    const registry = [ ...group.registry ].sort(compareRegistryRows);
    const sessions = options.sessionSourceState === 'ready' ?
        [ ...group.sessions ].sort(compareSessions) : [];
    const primaryRegistry = registry[0]?.source;
    const primarySession = sessions[0];
    const mutationId = text(primaryRegistry?.Id) || primarySession!.deviceId;
    const current = getDeviceIdentityKey(mutationId) === getDeviceIdentityKey(options.currentDeviceId);
    const registered = registry.length > 0;
    const activeSessionCount = options.sessionSourceState === 'ready' ?
        sessions.filter(session => session.active).length : null;
    const playingSessionCount = options.sessionSourceState === 'ready' ?
        sessions.filter(session => session.playing && !session.paused).length : null;
    const pausedSessionCount = options.sessionSourceState === 'ready' ?
        sessions.filter(session => session.paused).length : null;
    const usersForDevice = uniqueUsers([
        ...sessions.map(session => session.user),
        ...registry.map(({ source }) => normalizeUserReference(source.LastUserId, source.LastUserName, users))
    ]);
    const state = deviceStatus(sessions, options.sessionSourceState);
    const customName = registry.map(({ source }) => text(source.CustomName)).find(Boolean);
    const registryName = registry.map(({ source }) => text(source.Name)).find(Boolean);

    return {
        ...state,
        activeSessionCount,
        appName: primarySession?.clientName || text(primaryRegistry?.AppName),
        appVersion: primarySession?.clientVersion || text(primaryRegistry?.AppVersion),
        canRemove: registered && !current,
        current,
        id: mutationId,
        lastSeenAt: latestDate([
            ...registry.map(({ source }) => source.DateLastActivity),
            ...sessions.map(session => session.lastActivityAt)
        ]),
        name: customName
            || primarySession?.deviceName
            || registryName
            || primarySession?.clientName
            || 'Unnamed device',
        pausedSessionCount,
        playingSessionCount,
        registered,
        registrationIds: uniqueExact(registry.map(({ source }) => source.Id)),
        registryEntryCount: registry.length,
        sessionSourceState: options.sessionSourceState,
        sessions,
        userSourceState: options.userSourceState,
        users: usersForDevice
    };
}

const DEVICE_STATUS_ORDER: Readonly<Record<AdminPeopleDeviceStatus, number>> = {
    playing: 0,
    paused: 1,
    active: 2,
    'not-active': 3,
    unavailable: 4
};

export function normalizeAdminDevices(
    registryRows: readonly DeviceInfoDto[] | null | undefined,
    sourceSessions: readonly SessionInfoDto[] | null | undefined,
    usersSource: AdminPeopleUsersSource = new Map(),
    options: AdminPeopleDevicesNormalizationOptions = {}
): AdminPeopleDevice[] {
    const sessionSourceState = options.sessionSourceState || 'ready';
    const userSourceState = options.userSourceState || 'ready';
    const users = resolveUsersMap(usersSource);
    const groups = new Map<string, DeviceGroup>();

    (Array.isArray(registryRows) ? registryRows : []).forEach((source, index) => {
        const id = text(source.Id);
        const key = getDeviceIdentityKey(id);
        if (!id || !key) return;
        const group = groups.get(key) || { firstIndex: index, registry: [], sessions: [] };
        group.registry.push({ index, source });
        groups.set(key, group);
    });

    if (sessionSourceState === 'ready') {
        (Array.isArray(sourceSessions) ? sourceSessions : []).forEach(source => {
            const session = normalizeAdminPeopleSession(source, users);
            if (!session) return;
            const key = getDeviceIdentityKey(session.deviceId);
            const existingGroup = groups.get(key);
            // /Devices is the authoritative inventory. The live server has
            // returned hundreds of unmatched /Sessions rows as IsActive=true,
            // so neither that field nor recency safely proves registration or
            // a current connection. Sessions only enrich a registered id.
            if (!existingGroup) return;
            existingGroup.sessions.push(session);
        });
    }

    return [ ...groups.values() ]
        .map(group => normalizeDeviceGroup(group, users, {
            currentDeviceId: options.currentDeviceId,
            sessionSourceState,
            userSourceState
        }))
        .sort((left, right) => DEVICE_STATUS_ORDER[left.status] - DEVICE_STATUS_ORDER[right.status]
            || dateTime(right.lastSeenAt) - dateTime(left.lastSeenAt)
            || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
            || left.id.localeCompare(right.id));
}

/** @deprecated Use normalizeAdminDevices. */
export const normalizeAdminPeopleDevices = normalizeAdminDevices;

function normalizeActivitySeverity(value: unknown): {
    severity: AdminPeopleActivitySeverity;
    severityLabel: string;
} {
    switch (text(value)?.toLowerCase()) {
        case 'trace':
        case 'debug':
        case 'information':
            return { severity: 'info', severityLabel: 'Info' };
        case 'warning':
            return { severity: 'warning', severityLabel: 'Warning' };
        case 'error':
        case 'critical':
            return { severity: 'error', severityLabel: 'Error' };
        default:
            return { severity: 'unknown', severityLabel: 'Unknown' };
    }
}

function normalizeActivityCategory(type: string | null): {
    category: AdminPeopleActivityCategory;
    categoryLabel: string;
} {
    const key = String(type || '').toLowerCase();
    if (USER_ACTIVITY_TYPES.has(key)) return { category: 'user', categoryLabel: 'User' };
    if (PLAYBACK_ACTIVITY_TYPES.has(key)) return { category: 'playback', categoryLabel: 'Playback' };
    if (LIBRARY_ACTIVITY_TYPES.has(key)) return { category: 'library', categoryLabel: 'Library' };
    if (ADMINISTRATION_ACTIVITY_TYPES.has(key)) {
        return { category: 'administration', categoryLabel: 'Administration' };
    }
    if (PLUGIN_ACTIVITY_TYPES.has(key)) return { category: 'plugin', categoryLabel: 'Plugin' };
    return { category: 'other', categoryLabel: 'Other' };
}

export function normalizeAdminPeopleActivityEntry(
    entry: ActivityLogEntry,
    usersSource: AdminPeopleUsersSource = new Map()
): AdminPeopleActivityEntry {
    const users = resolveUsersMap(usersSource);
    const type = text(entry.Type);
    const typeKey = String(type || '').toLowerCase();
    const userId = text(entry.UserId);
    const userKey = getAdminPeopleUserIdentityKey(userId);
    const description = IP_BEARING_SHORT_OVERVIEW_TYPES.has(typeKey) ?
        text(entry.Overview) :
        text(entry.ShortOverview) || text(entry.Overview);

    return {
        ...normalizeActivityCategory(type),
        ...normalizeActivitySeverity(entry.Severity),
        createdAt: normalizeAdminPeopleDate(entry.Date),
        description,
        id: typeof entry.Id === 'number' && Number.isFinite(entry.Id) ? String(entry.Id) : null,
        itemId: text(entry.ItemId),
        name: text(entry.Name) || 'Server event',
        type,
        user: userKey ? normalizeUserReference(userId, null, users) : null
    };
}

export function normalizeAdminActivityPage(
    result: ActivityLogEntryQueryResult | null | undefined = undefined,
    usersSource: AdminPeopleUsersSource = new Map(),
    options: AdminPeopleActivityNormalizationOptions = {}
): AdminPeopleActivityPage {
    const users = resolveUsersMap(usersSource);
    return {
        items: (Array.isArray(result?.Items) ? result.Items : [])
            .map(entry => normalizeAdminPeopleActivityEntry(entry, users)),
        startIndex: nonNegativeInteger(result?.StartIndex),
        totalRecordCount: nonNegativeInteger(result?.TotalRecordCount),
        userSourceState: options.userSourceState || 'ready'
    };
}

/** @deprecated Use normalizeAdminActivityPage. */
export const normalizeAdminPeopleActivityPage = normalizeAdminActivityPage;

function includesNormalized(haystack: string | null | undefined, needle: string) {
    return String(haystack || '').toLocaleLowerCase().includes(needle);
}

function deviceMatchesQuery(device: AdminPeopleDevice, query: string) {
    return includesNormalized(device.name, query)
        || includesNormalized(device.appName, query)
        || includesNormalized(device.appVersion, query)
        || device.users.some(user => includesNormalized(user.username, query))
        || device.sessions.some(session =>
            includesNormalized(session.clientName, query)
            || includesNormalized(session.deviceName, query)
            || includesNormalized(session.user?.username, query));
}

function deviceMatchesFilter(
    device: AdminPeopleDevice,
    filter: NonNullable<AdminPeopleDeviceSelection['filter']>
) {
    switch (filter) {
        case 'active':
            return device.status === 'active'
                || device.status === 'playing'
                || device.status === 'paused';
        case 'playing':
            return device.status === 'playing' || device.status === 'paused';
        case 'inactive':
            return device.status === 'not-active';
        default:
            return true;
    }
}

/**
 * Applies local filters to an already normalized device snapshot. The original
 * deterministic ordering is retained and no server-wide search is implied.
 */
export function selectAdminDevices(
    devices: readonly AdminPeopleDevice[],
    selection: AdminPeopleDeviceSelection = {}
): AdminPeopleDevice[] {
    const query = String(selection.query || '').trim().toLocaleLowerCase();
    const userKey = getAdminPeopleUserIdentityKey(selection.userId);
    const filter = selection.filter || 'all';

    return devices.filter(device =>
        (!query || deviceMatchesQuery(device, query))
        && (!userKey || device.users.some(user =>
            getAdminPeopleUserIdentityKey(user.id) === userKey))
        && deviceMatchesFilter(device, filter));
}

function activityMatchesQuery(entry: AdminPeopleActivityEntry, query: string) {
    return includesNormalized(entry.name, query)
        || includesNormalized(entry.description, query)
        || includesNormalized(entry.type, query)
        || includesNormalized(entry.categoryLabel, query)
        || includesNormalized(entry.user?.username, query);
}

/**
 * Applies local filters only to the bounded activity page supplied by the
 * caller. Pagination totals intentionally remain the server's responsibility.
 */
export function selectAdminActivityEntries(
    entries: readonly AdminPeopleActivityEntry[],
    selection: AdminPeopleActivitySelection = {}
): AdminPeopleActivityEntry[] {
    const query = String(selection.query || '').trim().toLocaleLowerCase();
    const userKey = getAdminPeopleUserIdentityKey(selection.userId);

    return entries.filter(entry =>
        (!query || activityMatchesQuery(entry, query))
        && (!userKey || getAdminPeopleUserIdentityKey(entry.user?.id) === userKey));
}
