import type { Api } from '@jellyfin/sdk';
import type {
    ActivityLogEntryQueryResult,
    DeviceInfoDto,
    SessionInfoDto,
    UserDto
} from '@jellyfin/sdk/lib/generated-client';
import { getActivityLogApi } from '@jellyfin/sdk/lib/utils/api/activity-log-api';
import { getDevicesApi } from '@jellyfin/sdk/lib/utils/api/devices-api';
import { getSessionApi } from '@jellyfin/sdk/lib/utils/api/session-api';
import { getUserApi } from '@jellyfin/sdk/lib/utils/api/user-api';

export const ADMIN_ACTIVITY_PAGE_SIZE = 50;
/**
 * Jellyfin's own dashboard uses a 960 second session window. Passing this to
 * /Sessions is important: an unfiltered administrator request can include the
 * server's entire in-memory connection history until those records are pruned.
 */
export const ADMIN_PEOPLE_ACTIVE_WITHIN_SECONDS = 960;

export type AdminActivityView = 'all' | 'user' | 'system';

export type AdminPeopleServiceErrorCode =
    | 'activity-unavailable'
    | 'current-device-unavailable'
    | 'device-is-current'
    | 'device-not-found'
    | 'device-state-changed'
    | 'devices-unavailable'
    | 'invalid-device'
    | 'sessions-unavailable'
    | 'users-unavailable';

export type AdminDeviceRemovalSnapshot = Readonly<{
    activeSessionCount: number;
    deviceId: string;
    deviceName: string;
    hasActiveSessions: boolean;
}>;

export class AdminPeopleServiceError extends Error {
    public readonly code: AdminPeopleServiceErrorCode;
    public readonly latestSnapshot?: AdminDeviceRemovalSnapshot;

    public constructor(
        code: AdminPeopleServiceErrorCode,
        message: string,
        latestSnapshot?: AdminDeviceRemovalSnapshot
    ) {
        super(message);
        this.code = code;
        this.latestSnapshot = latestSnapshot;
        this.name = 'AdminPeopleServiceError';
    }
}

function text(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function deviceIdentity(value: unknown) {
    return text(value).toLowerCase();
}

function requireDeviceId(deviceId: string) {
    const normalized = text(deviceId);
    if (!normalized) {
        throw new AdminPeopleServiceError('invalid-device', 'Choose a valid registered device.');
    }
    return normalized;
}

function requireNonCurrentDevice(api: Api, deviceId: string, currentDeviceId?: string | null) {
    const normalized = requireDeviceId(deviceId);
    const current = text(currentDeviceId) || text(api.deviceInfo?.id);
    if (!current) {
        throw new AdminPeopleServiceError(
            'current-device-unavailable',
            'The current device could not be verified. No device was removed.'
        );
    }
    if (deviceIdentity(normalized) === deviceIdentity(current)) {
        throw new AdminPeopleServiceError(
            'device-is-current',
            'The device currently running PiggieTV cannot be removed here.'
        );
    }
    return normalized;
}

function summarizeNowPlayingItem(item: SessionInfoDto['NowPlayingItem']) {
    if (!item) return undefined;
    return {
        Album: item.Album,
        AlbumArtist: item.AlbumArtist,
        Artists: item.Artists ? [ ...item.Artists ] : item.Artists,
        IndexNumber: item.IndexNumber,
        Name: item.Name,
        ParentIndexNumber: item.ParentIndexNumber,
        SeriesName: item.SeriesName,
        Type: item.Type
    };
}

function summarizePlayState(playState: SessionInfoDto['PlayState']) {
    if (!playState) return undefined;
    return {
        IsPaused: playState.IsPaused,
        PlayMethod: playState.PlayMethod
    };
}

export async function loadAdminDeviceRegistry(
    api: Api,
    signal?: AbortSignal
): Promise<DeviceInfoDto[]> {
    const response = await getDevicesApi(api).getDevices({}, { signal });
    if (!Array.isArray(response.data?.Items)) {
        throw new AdminPeopleServiceError('devices-unavailable', 'Devices could not be loaded.');
    }
    return response.data.Items.map(device => ({
        AppName: device.AppName,
        AppVersion: device.AppVersion,
        CustomName: device.CustomName,
        DateLastActivity: device.DateLastActivity,
        Id: device.Id,
        LastUserId: device.LastUserId,
        LastUserName: device.LastUserName,
        Name: device.Name
    }));
}

export async function loadAdminPeopleSessions(
    api: Api,
    signal?: AbortSignal,
    deviceId?: string,
    activeWithinSeconds = ADMIN_PEOPLE_ACTIVE_WITHIN_SECONDS
): Promise<SessionInfoDto[]> {
    const response = await getSessionApi(api).getSessions(
        {
            activeWithinSeconds,
            deviceId: deviceId ? requireDeviceId(deviceId) : undefined
        },
        { signal }
    );
    if (!Array.isArray(response.data)) {
        throw new AdminPeopleServiceError('sessions-unavailable', 'Session state could not be loaded.');
    }
    return response.data.map(session => ({
        ApplicationVersion: session.ApplicationVersion,
        Client: session.Client,
        DeviceId: session.DeviceId,
        DeviceName: session.DeviceName,
        DeviceType: session.DeviceType,
        Id: session.Id,
        IsActive: session.IsActive,
        LastActivityDate: session.LastActivityDate,
        NowPlayingItem: summarizeNowPlayingItem(session.NowPlayingItem),
        PlayState: summarizePlayState(session.PlayState),
        UserId: session.UserId,
        UserName: session.UserName
    }));
}

export async function loadAdminPeopleUsers(
    api: Api,
    signal?: AbortSignal
): Promise<UserDto[]> {
    const response = await getUserApi(api).getUsers({}, { signal });
    if (!Array.isArray(response.data)) {
        throw new AdminPeopleServiceError('users-unavailable', 'User information could not be loaded.');
    }
    return response.data.map(user => ({
        Id: user.Id,
        Name: user.Name
    }));
}

function normalizePageIndex(pageIndex: number) {
    return Number.isInteger(pageIndex) && pageIndex >= 0 ? pageIndex : 0;
}

export function getAdminActivityRequest(pageIndex: number, view: AdminActivityView) {
    let hasUserId: boolean | undefined;
    if (view === 'user') hasUserId = true;
    if (view === 'system') hasUserId = false;
    return {
        hasUserId,
        limit: ADMIN_ACTIVITY_PAGE_SIZE,
        startIndex: normalizePageIndex(pageIndex) * ADMIN_ACTIVITY_PAGE_SIZE
    } as const;
}

export async function loadAdminActivityPage(
    api: Api,
    pageIndex: number,
    view: AdminActivityView,
    signal?: AbortSignal
): Promise<ActivityLogEntryQueryResult> {
    const response = await getActivityLogApi(api).getLogEntries(
        getAdminActivityRequest(pageIndex, view),
        { signal }
    );
    if (!Array.isArray(response.data?.Items)
        || !Number.isInteger(response.data.TotalRecordCount)
        || Number(response.data.TotalRecordCount) < 0) {
        throw new AdminPeopleServiceError('activity-unavailable', 'Activity could not be loaded.');
    }
    return response.data;
}

async function loadRemovalSnapshot(
    api: Api,
    deviceId: string,
    currentDeviceId?: string | null,
    signal?: AbortSignal
): Promise<AdminDeviceRemovalSnapshot> {
    const id = requireNonCurrentDevice(api, deviceId, currentDeviceId);
    const [ deviceResponse, sessions ] = await Promise.all([
        getDevicesApi(api).getDeviceInfo({ id }, { signal }),
        loadAdminPeopleSessions(api, signal, id)
    ]);
    const registeredId = text(deviceResponse.data?.Id);
    if (!registeredId || deviceIdentity(registeredId) !== deviceIdentity(id)) {
        throw new AdminPeopleServiceError(
            'device-not-found',
            'This device is no longer registered.'
        );
    }
    const activeSessionCount = sessions.filter(session => session.IsActive === true).length;

    return {
        activeSessionCount,
        deviceId: registeredId,
        deviceName: text(deviceResponse.data.CustomName)
            || text(deviceResponse.data.Name)
            || text(deviceResponse.data.AppName)
            || 'Unnamed device',
        hasActiveSessions: activeSessionCount > 0
    };
}

/** Loads fresh device and session state for confirmation without mutating either source. */
export function prepareAdminDeviceRemoval(
    api: Api,
    deviceId: string,
    currentDeviceId?: string | null,
    signal?: AbortSignal
) {
    return loadRemovalSnapshot(api, deviceId, currentDeviceId, signal);
}

const removalFlights = new WeakMap<Api, Map<string, Promise<AdminDeviceRemovalSnapshot>>>();

/**
 * Rechecks the device and active-session warning immediately before deleting
 * the registered device record. A changed warning state requires a new confirmation.
 */
export function confirmAdminDeviceRemoval(
    api: Api,
    confirmed: AdminDeviceRemovalSnapshot,
    currentDeviceId?: string | null,
    signal?: AbortSignal
): Promise<AdminDeviceRemovalSnapshot> {
    const deviceId = requireNonCurrentDevice(api, confirmed.deviceId, currentDeviceId);
    let apiFlights = removalFlights.get(api);
    if (!apiFlights) {
        apiFlights = new Map();
        removalFlights.set(api, apiFlights);
    }
    const flightKey = deviceIdentity(deviceId);
    const existing = apiFlights.get(flightKey);
    if (existing) return existing;

    const flight = (async () => {
        const latest = await loadRemovalSnapshot(api, deviceId, currentDeviceId, signal);
        if (latest.activeSessionCount !== confirmed.activeSessionCount
            || latest.hasActiveSessions !== confirmed.hasActiveSessions) {
            throw new AdminPeopleServiceError(
                'device-state-changed',
                'This device session state changed. Review it again before removing the device.',
                latest
            );
        }
        await getDevicesApi(api).deleteDevice({ id: latest.deviceId }, { signal });
        return latest;
    })().finally(() => {
        apiFlights?.delete(flightKey);
    });

    apiFlights.set(flightKey, flight);
    return flight;
}
