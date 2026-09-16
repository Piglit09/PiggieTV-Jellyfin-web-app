import type { Api } from '@jellyfin/sdk';
import type { DeviceInfoDto, SessionInfoDto } from '@jellyfin/sdk/lib/generated-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
    deleteDevice: vi.fn(),
    getDeviceInfo: vi.fn(),
    getDevices: vi.fn(),
    getLogEntries: vi.fn(),
    getSessions: vi.fn(),
    getUsers: vi.fn()
}));

vi.mock('@jellyfin/sdk/lib/utils/api/activity-log-api', () => ({
    getActivityLogApi: () => apiMocks
}));
vi.mock('@jellyfin/sdk/lib/utils/api/devices-api', () => ({
    getDevicesApi: () => apiMocks
}));
vi.mock('@jellyfin/sdk/lib/utils/api/session-api', () => ({
    getSessionApi: () => apiMocks
}));
vi.mock('@jellyfin/sdk/lib/utils/api/user-api', () => ({
    getUserApi: () => apiMocks
}));

import {
    ADMIN_PEOPLE_ACTIVE_WITHIN_SECONDS,
    confirmAdminDeviceRemoval,
    getAdminActivityRequest,
    loadAdminActivityPage,
    loadAdminDeviceRegistry,
    loadAdminPeopleSessions,
    loadAdminPeopleUsers,
    prepareAdminDeviceRemoval
} from './adminPeopleService';

const api = { deviceInfo: { id: 'current-device' } } as Api;

function device(overrides: Partial<DeviceInfoDto> = {}): DeviceInfoDto {
    return { Id: 'device-a', Name: 'Living Room', ...overrides };
}

function session(overrides: Partial<SessionInfoDto> = {}): SessionInfoDto {
    return { DeviceId: 'device-a', Id: 'session-a', IsActive: true, ...overrides };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

describe('administrator People service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiMocks.deleteDevice.mockResolvedValue({ data: undefined });
        apiMocks.getDeviceInfo.mockResolvedValue({ data: device() });
        apiMocks.getDevices.mockResolvedValue({ data: { Items: [ device() ] } });
        apiMocks.getLogEntries.mockResolvedValue({
            data: { Items: [], StartIndex: 0, TotalRecordCount: 0 }
        });
        apiMocks.getSessions.mockResolvedValue({ data: [] });
        apiMocks.getUsers.mockResolvedValue({ data: [] });
    });

    it('uses the exact summary reads and forwards AbortSignals', async () => {
        const signal = {} as AbortSignal;

        await Promise.all([
            loadAdminDeviceRegistry(api, signal),
            loadAdminPeopleSessions(api, signal),
            loadAdminPeopleUsers(api, signal),
            loadAdminActivityPage(api, 2, 'user', signal)
        ]);

        expect(apiMocks.getDevices).toHaveBeenCalledWith({}, { signal });
        expect(apiMocks.getSessions).toHaveBeenCalledWith({
            activeWithinSeconds: ADMIN_PEOPLE_ACTIVE_WITHIN_SECONDS,
            deviceId: undefined
        }, { signal });
        expect(apiMocks.getUsers).toHaveBeenCalledWith({}, { signal });
        expect(apiMocks.getLogEntries).toHaveBeenCalledWith({
            hasUserId: true,
            limit: 50,
            startIndex: 100
        }, { signal });
    });

    it('stores only the fields required by the People presentation model', async () => {
        const sessionSecret = [ 'session', 'secret' ].join('-');
        apiMocks.getSessions.mockResolvedValueOnce({
            data: [ session({
                Capabilities: { SupportsMediaControl: true },
                NowPlayingItem: {
                    Id: 'private-item-id',
                    MediaSources: [ { Id: 'private-source' } ],
                    Name: 'Movie',
                    Type: 'Movie'
                },
                PlayState: {
                    IsPaused: false,
                    MediaSourceId: 'private-source',
                    PlayMethod: 'DirectPlay',
                    PositionTicks: 120
                },
                RemoteEndPoint: '192.0.2.44',
                ServerId: sessionSecret,
                TranscodingInfo: { Framerate: 24 }
            }) ]
        });

        const result = await loadAdminPeopleSessions(api);
        expect(result[0]).toMatchObject({
            NowPlayingItem: { Name: 'Movie', Type: 'Movie' },
            PlayState: { IsPaused: false, PlayMethod: 'DirectPlay' }
        });
        expect(JSON.stringify(result)).not.toContain('192.0.2.44');
        expect(JSON.stringify(result)).not.toContain('private-source');
        expect(JSON.stringify(result)).not.toContain('private-item-id');
        expect(JSON.stringify(result)).not.toContain(sessionSecret);
        expect(result[0]).not.toHaveProperty('Capabilities');
        expect(result[0]).not.toHaveProperty('TranscodingInfo');
    });

    it('maps activity views and normalizes an invalid page index', () => {
        expect(getAdminActivityRequest(-1, 'all')).toEqual({
            hasUserId: undefined,
            limit: 50,
            startIndex: 0
        });
        expect(getAdminActivityRequest(1, 'system')).toEqual({
            hasUserId: false,
            limit: 50,
            startIndex: 50
        });
    });

    it('rejects malformed source responses instead of inventing empty values', async () => {
        apiMocks.getDevices.mockResolvedValueOnce({ data: {} });
        apiMocks.getSessions.mockResolvedValueOnce({ data: {} });
        apiMocks.getUsers.mockResolvedValueOnce({ data: {} });
        apiMocks.getLogEntries.mockResolvedValueOnce({ data: { Items: [] } });

        await expect(loadAdminDeviceRegistry(api)).rejects.toMatchObject({
            code: 'devices-unavailable'
        });
        await expect(loadAdminPeopleSessions(api)).rejects.toMatchObject({
            code: 'sessions-unavailable'
        });
        await expect(loadAdminPeopleUsers(api)).rejects.toMatchObject({
            code: 'users-unavailable'
        });
        await expect(loadAdminActivityPage(api, 0, 'all')).rejects.toMatchObject({
            code: 'activity-unavailable'
        });
    });

    it('blocks the current device before issuing any removal reads', async () => {
        await expect(prepareAdminDeviceRemoval(api, 'CURRENT-DEVICE')).rejects.toMatchObject({
            code: 'device-is-current'
        });
        expect(apiMocks.getDeviceInfo).not.toHaveBeenCalled();
        expect(apiMocks.getSessions).not.toHaveBeenCalled();
    });

    it('prepares a DTO-free warning from fresh device and session state', async () => {
        apiMocks.getDeviceInfo.mockResolvedValueOnce({
            data: device({ CustomName: 'Den TV' })
        });
        apiMocks.getSessions.mockResolvedValueOnce({
            data: [ session(), session({ Id: 'inactive', IsActive: false }) ]
        });

        await expect(prepareAdminDeviceRemoval(api, 'device-a')).resolves.toEqual({
            activeSessionCount: 1,
            deviceId: 'device-a',
            deviceName: 'Den TV',
            hasActiveSessions: true
        });
        expect(apiMocks.getDeviceInfo).toHaveBeenCalledWith(
            { id: 'device-a' },
            { signal: undefined }
        );
        expect(apiMocks.getSessions).toHaveBeenCalledWith(
            {
                activeWithinSeconds: ADMIN_PEOPLE_ACTIVE_WITHIN_SECONDS,
                deviceId: 'device-a'
            },
            { signal: undefined }
        );
    });

    it('does not warn for unknown-active sessions during removal confirmation', async () => {
        apiMocks.getSessions.mockResolvedValueOnce({
            data: [
                session({ Id: 'unknown', IsActive: undefined }),
                session({ Id: 'inactive', IsActive: false })
            ]
        });

        await expect(prepareAdminDeviceRemoval(api, 'device-a')).resolves.toMatchObject({
            activeSessionCount: 0,
            hasActiveSessions: false
        });
    });

    it('fresh-checks confirmation and keeps duplicate deletion single-flight', async () => {
        const deletion = deferred<{ data: undefined }>();
        apiMocks.deleteDevice.mockReturnValueOnce(deletion.promise);
        const confirmed = {
            activeSessionCount: 0,
            deviceId: 'device-a',
            deviceName: 'Living Room',
            hasActiveSessions: false
        } as const;

        const first = confirmAdminDeviceRemoval(api, confirmed);
        const second = confirmAdminDeviceRemoval(api, confirmed);

        expect(first).toBe(second);
        expect(apiMocks.getDeviceInfo).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(apiMocks.deleteDevice).toHaveBeenCalledOnce());
        deletion.resolve({ data: undefined });
        await first;
        expect(apiMocks.deleteDevice).toHaveBeenCalledWith(
            { id: 'device-a' },
            { signal: undefined }
        );
    });

    it('requires another confirmation when active session state changes', async () => {
        apiMocks.getSessions.mockResolvedValueOnce({ data: [ session() ] });

        await expect(confirmAdminDeviceRemoval(api, {
            activeSessionCount: 0,
            deviceId: 'device-a',
            deviceName: 'Living Room',
            hasActiveSessions: false
        })).rejects.toMatchObject({
            code: 'device-state-changed',
            latestSnapshot: {
                activeSessionCount: 1,
                hasActiveSessions: true
            }
        });
        expect(apiMocks.deleteDevice).not.toHaveBeenCalled();
    });
});
