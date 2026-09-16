import type {
    ActivityLogEntry,
    DeviceInfoDto,
    SessionInfoDto,
    UserDto
} from '@jellyfin/sdk/lib/generated-client';
import { describe, expect, it } from 'vitest';

import {
    createAdminPeopleUsersMap,
    getAdminPeopleUserIdentityKey,
    normalizeAdminActivityPage,
    normalizeAdminDevices,
    normalizeAdminPeopleActivityEntry,
    normalizeAdminPeopleDate,
    normalizeAdminPeopleSession,
    selectAdminActivityEntries,
    selectAdminDevices
} from './adminPeopleAdapters';

const USER_A = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const USER_A_COMPACT = 'aaaaaaaabbbbccccddddeeeeeeeeeeee';
const USER_B = '11111111-2222-3333-4444-555555555555';

function user(id: string, name: string): UserDto {
    return { Id: id, Name: name };
}

function device(overrides: Partial<DeviceInfoDto> = {}): DeviceInfoDto {
    return {
        AppName: 'PiggieTV Web',
        AppVersion: '0.5.13',
        DateLastActivity: '2026-08-12T11:00:00Z',
        Id: 'device-a',
        LastUserId: USER_A,
        LastUserName: 'Recorded Piggie',
        Name: 'Living Room TV',
        ...overrides
    };
}

function session(overrides: Partial<SessionInfoDto> = {}): SessionInfoDto {
    return {
        ApplicationVersion: '0.5.13',
        Client: 'PiggieTV Web',
        DeviceId: 'device-a',
        DeviceName: 'Living Room TV',
        Id: 'session-a',
        IsActive: true,
        LastActivityDate: '2026-08-12T11:30:00Z',
        UserId: USER_A_COMPACT,
        UserName: 'Recorded Piggie',
        ...overrides
    };
}

function activity(overrides: Partial<ActivityLogEntry> = {}): ActivityLogEntry {
    return {
        Date: '2026-08-12T11:45:00Z',
        Id: 42,
        Name: 'Server event',
        Severity: 'Information',
        Type: 'TaskCompleted',
        ...overrides
    };
}

describe('admin People identities', () => {
    it('joins immutable user ids across GUID formats and ignores the empty GUID', () => {
        const users = createAdminPeopleUsersMap([
            user(USER_A, 'Piggie'),
            user('00000000-0000-0000-0000-000000000000', 'System')
        ]);

        expect(getAdminPeopleUserIdentityKey(USER_A_COMPACT)).toBe(
            getAdminPeopleUserIdentityKey(USER_A)
        );
        expect(users.get(USER_A_COMPACT)).toMatchObject({
            id: USER_A,
            isCurrentUser: true,
            username: 'Piggie'
        });
        expect(users.size).toBe(1);
        expect(getAdminPeopleUserIdentityKey('00000000-0000-0000-0000-000000000000')).toBe('');
    });

    it('normalizes valid dates and preserves unknown dates as null', () => {
        expect(normalizeAdminPeopleDate('2026-08-12T11:45:00Z')).toBe(
            '2026-08-12T11:45:00.000Z'
        );
        expect(normalizeAdminPeopleDate('not-a-date')).toBeNull();
        expect(normalizeAdminPeopleDate()).toBeNull();
    });
});

describe('admin device normalization', () => {
    it('groups duplicate registry rows and sessions by case-insensitive device id', () => {
        const result = normalizeAdminDevices([
            device({
                AccessToken: [ 'sensitive', 'fixture' ].join('-'),
                Capabilities: {},
                DateLastActivity: '2026-08-12T10:00:00Z',
                Id: 'DEVICE-A',
                Name: 'Older name'
            }),
            device({
                CustomName: 'Family Room',
                DateLastActivity: '2026-08-12T11:00:00Z',
                Id: 'device-a'
            })
        ], [
            session({
                NowPlayingItem: {
                    IndexNumber: 4,
                    Name: 'The Episode',
                    ParentIndexNumber: 2,
                    SeriesName: 'The Series',
                    Type: 'Episode'
                },
                PlayState: { IsPaused: false, PlayMethod: 'DirectPlay' },
                RemoteEndPoint: '192.0.2.5'
            }),
            session({
                DeviceId: 'DEVICE-A',
                Id: 'session-b',
                PlayState: undefined,
                UserId: USER_B,
                UserName: 'Bravo'
            })
        ], [ user(USER_A, 'Piggie'), user(USER_B, 'Bravo') ]);

        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            activeSessionCount: 2,
            id: 'device-a',
            name: 'Family Room',
            playingSessionCount: 1,
            registered: true,
            registryEntryCount: 2,
            registrationIds: [ 'device-a', 'DEVICE-A' ],
            status: 'playing',
            userSourceState: 'ready'
        });
        expect(result[0].sessions[0]).toMatchObject({
            mediaSubtitle: 'S02E04 \u00b7 The Episode',
            mediaTitle: 'The Series',
            playbackMethod: 'direct-play',
            user: { id: USER_A, username: 'Piggie' }
        });
        expect(result[0].users.map(item => item.username)).toEqual([ 'Piggie', 'Bravo' ]);
        expect(JSON.stringify(result)).not.toContain('192.0.2.5');
        expect(JSON.stringify(result)).not.toContain('sensitive-fixture');
        expect(JSON.stringify(result)).not.toContain('Capabilities');
    });

    it('keeps paused media active while excluding stopped playback', () => {
        const paused = normalizeAdminPeopleSession(session({
            NowPlayingItem: { Name: 'Paused movie', Type: 'Movie' },
            PlayState: { IsPaused: true, PlayMethod: 'Transcode' }
        }));
        const stopped = normalizeAdminPeopleSession(session({
            IsActive: false,
            NowPlayingItem: { Name: 'Stopped movie', Type: 'Movie' },
            PlayState: { IsPaused: false, PlayMethod: 'DirectStream' }
        }));

        expect(paused).toMatchObject({
            paused: true,
            playbackMethod: 'transcoding',
            playing: true,
            status: 'paused'
        });
        expect(stopped).toMatchObject({
            active: false,
            paused: false,
            playing: false,
            status: 'inactive'
        });
    });

    it('never treats an omitted IsActive value as active or playing', () => {
        const unknown = normalizeAdminPeopleSession(session({
            IsActive: undefined,
            NowPlayingItem: { Name: 'Historical movie', Type: 'Movie' },
            PlayState: { IsPaused: false, PlayMethod: 'DirectPlay' }
        }));

        expect(unknown).toMatchObject({
            active: false,
            paused: false,
            playing: false,
            status: 'inactive',
            statusLabel: 'Not active'
        });
    });

    it('uses the device registry as inventory and drops every unmatched session row', () => {
        const devices = normalizeAdminDevices([
            device({ Id: 'registered-device' })
        ], [
            session({ DeviceId: 'registered-device', IsActive: undefined }),
            session({ DeviceId: 'historical-unknown', IsActive: undefined }),
            session({ DeviceId: 'historical-inactive', IsActive: false }),
            session({ DeviceId: 'current-unmatched', IsActive: true })
        ]);

        expect(devices.map(item => item.id)).toEqual([ 'registered-device' ]);
        expect(devices.find(item => item.id === 'registered-device')).toMatchObject({
            activeSessionCount: 0,
            registered: true,
            sessions: [ { active: false } ],
            status: 'not-active'
        });
    });

    it('does not turn multiple exact-active unmatched sessions into a device card', () => {
        const devices = normalizeAdminDevices([], [
            session({ DeviceId: 'UNMATCHED', Id: 'one', IsActive: true }),
            session({ DeviceId: 'unmatched', Id: 'two', IsActive: true, UserId: USER_B })
        ]);

        expect(devices).toEqual([]);
    });

    it('does not claim inactivity when the session source is unavailable', () => {
        const [ result ] = normalizeAdminDevices(
            [ device() ],
            [ session() ],
            [ user(USER_A, 'Piggie') ],
            { sessionSourceState: 'unavailable', userSourceState: 'unavailable' }
        );

        expect(result).toMatchObject({
            activeSessionCount: null,
            pausedSessionCount: null,
            playingSessionCount: null,
            sessionSourceState: 'unavailable',
            sessions: [],
            status: 'unavailable',
            statusLabel: 'Session state unavailable',
            userSourceState: 'unavailable'
        });
    });

    it('uses Not active only for a successful empty session response', () => {
        const [ result ] = normalizeAdminDevices([ device() ], [], []);

        expect(result).toMatchObject({
            activeSessionCount: 0,
            pausedSessionCount: 0,
            playingSessionCount: 0,
            status: 'not-active',
            statusLabel: 'Not active'
        });
    });

    it('prevents current-device removal and does not offer removal for session-only devices', () => {
        const [ current ] = normalizeAdminDevices(
            [ device({ Id: 'Device-A' }) ],
            [],
            [],
            { currentDeviceId: 'device-a' }
        );
        const sessionOnly = normalizeAdminDevices([], [ session({ DeviceId: 'session-only' }) ]);

        expect(current).toMatchObject({ canRemove: false, current: true, registered: true });
        expect(sessionOnly).toEqual([]);
    });

    it('searches locally and filters by state and exact immutable user id', () => {
        const devices = normalizeAdminDevices([
            device(),
            device({
                AppName: 'Swiftfin',
                Id: 'device-b',
                LastUserId: USER_B,
                LastUserName: 'Bravo',
                Name: 'Bedroom iPad'
            })
        ], [
            session({
                NowPlayingItem: { Name: 'Movie', Type: 'Movie' },
                PlayState: { IsPaused: true, PlayMethod: 'DirectStream' }
            })
        ], [ user(USER_A, 'Piggie'), user(USER_B, 'Bravo') ]);

        expect(selectAdminDevices(devices, { query: 'swift' }).map(item => item.id)).toEqual([ 'device-b' ]);
        expect(selectAdminDevices(devices, { filter: 'playing' }).map(item => item.id)).toEqual([ 'device-a' ]);
        expect(selectAdminDevices(devices, { userId: USER_B }).map(item => item.id)).toEqual([ 'device-b' ]);
        expect(selectAdminDevices(devices, { userId: 'missing-user' })).toEqual([]);
    });
});

describe('admin activity normalization', () => {
    it('normalizes known categories/severities and unknown event values safely', () => {
        const page = normalizeAdminActivityPage({
            Items: [
                activity({ Name: 'Playback began', Severity: 'Warning', Type: 'VideoPlayback' }),
                activity({ Name: 'Maintenance failed', Severity: 'Error', Type: 'TaskFailed' }),
                activity({ Name: 'Plugin installed', Type: 'PluginUpdateInstalled' }),
                activity({ Name: undefined, Severity: 'None', Type: 'FuturePluginEvent' })
            ],
            StartIndex: 0,
            TotalRecordCount: 40
        }, [], { userSourceState: 'unavailable' });

        expect(page).toMatchObject({
            startIndex: 0,
            totalRecordCount: 40,
            userSourceState: 'unavailable'
        });
        expect(page.items.map(item => [ item.category, item.severity ])).toEqual([
            [ 'playback', 'warning' ],
            [ 'administration', 'error' ],
            [ 'plugin', 'info' ],
            [ 'other', 'unknown' ]
        ]);
        expect(page.items[3]).toMatchObject({
            categoryLabel: 'Other',
            name: 'Server event',
            severityLabel: 'Unknown'
        });
    });

    it('preserves known and deleted-user identities without per-entry requests', () => {
        const known = normalizeAdminPeopleActivityEntry(activity({ UserId: USER_A_COMPACT }), [
            user(USER_A, 'Piggie')
        ]);
        const deleted = normalizeAdminPeopleActivityEntry(activity({ UserId: USER_B }), []);
        const system = normalizeAdminPeopleActivityEntry(activity({
            UserId: '00000000-0000-0000-0000-000000000000'
        }), []);

        expect(known.user).toMatchObject({ id: USER_A, isCurrentUser: true, username: 'Piggie' });
        expect(deleted.user).toEqual({ id: USER_B, isCurrentUser: false, username: null });
        expect(system.user).toBeNull();
    });

    it('does not expose remote endpoints stored in authentication short overviews', () => {
        const result = normalizeAdminPeopleActivityEntry(activity({
            Name: 'Piggie signed in',
            Overview: 'A user signed in.',
            ShortOverview: '198.51.100.42',
            Type: 'AuthenticationSucceeded'
        }));

        expect(result.description).toBe('A user signed in.');
        expect(JSON.stringify(result)).not.toContain('198.51.100.42');
    });

    it('preserves unknown paging values instead of inventing zeros', () => {
        expect(normalizeAdminActivityPage()).toEqual({
            items: [],
            startIndex: null,
            totalRecordCount: null,
            userSourceState: 'ready'
        });
    });

    it('searches and filters only the supplied bounded page', () => {
        const entries = normalizeAdminActivityPage({
            Items: [
                activity({ Name: 'Piggie started playback', Type: 'AudioPlayback', UserId: USER_A }),
                activity({ Name: 'Bravo signed in', Type: 'AuthenticationSucceeded', UserId: USER_B })
            ]
        }, [ user(USER_A, 'Piggie'), user(USER_B, 'Bravo') ]).items;

        expect(selectAdminActivityEntries(entries, { query: 'playback' }).map(item => item.id)).toEqual([ '42' ]);
        expect(selectAdminActivityEntries(entries, { userId: USER_B }).map(item => item.name)).toEqual([
            'Bravo signed in'
        ]);
        expect(selectAdminActivityEntries(entries, { userId: 'missing-user' })).toEqual([]);
    });
});
