/* eslint-disable sonarjs/no-hardcoded-passwords -- UserPolicy requires a password-provider fixture. */
import type {
    BaseItemDto,
    SessionInfoDto,
    UserDto,
    UserPolicy
} from '@jellyfin/sdk/lib/generated-client';
import { describe, expect, it } from 'vitest';

import {
    filterAdminUsers,
    getAdminUserActionGuard,
    mergeAdminUsers,
    normalizeAdminUserDate,
    normalizeAdminUserDetail,
    normalizeAdminUserLibraryAccess,
    normalizeAdminUserSessions,
    searchAdminUsers,
    selectAdminUsers,
    sortAdminUsers
} from './adminUsersAdapters';
import type { AdminUserSummary, PtvAccountAdminUserSummary } from './adminUsersModel';

const NOW = Date.UTC(2026, 7, 12, 12, 0, 0);

function policy(overrides: Partial<UserPolicy> = {}): UserPolicy {
    return {
        AuthenticationProviderId: 'default-auth',
        PasswordResetProviderId: 'default-reset',
        ...overrides
    };
}

function user(id: string, name: string, overrides: Partial<UserDto> = {}): UserDto {
    return {
        Id: id,
        Name: name,
        Policy: policy(),
        ...overrides
    };
}

function session(overrides: Partial<SessionInfoDto> = {}): SessionInfoDto {
    return {
        Client: 'PiggieTV Web',
        DeviceName: 'Living Room TV',
        IsActive: true,
        LastActivityDate: new Date(NOW - 60_000).toISOString(),
        UserId: 'user-a',
        ...overrides
    };
}

function profile(overrides: Partial<PtvAccountAdminUserSummary> = {}): PtvAccountAdminUserSummary {
    return {
        email: 'piggie@example.com',
        emailStatus: 'verified',
        emailVerified: true,
        emailVerifiedAt: '2026-08-10T09:00:00Z',
        jellyfinUserId: 'user-a',
        maskedEmail: 'p***@example.com',
        profileStatus: 'present',
        username: 'Piggie',
        ...overrides
    };
}

function summary(overrides: Partial<AdminUserSummary> = {}): AdminUserSummary {
    return {
        accountStatus: 'active',
        activeSessionCount: 0,
        authorizationState: 'ready',
        avatarUrl: null,
        email: null,
        emailStatus: 'missing',
        emailVerifiedAt: null,
        enabled: true,
        id: 'user-a',
        isAdministrator: false,
        lastActivityAt: null,
        lastLoginAt: null,
        maskedEmail: null,
        profileSourceState: 'ready',
        role: 'member',
        sessionSourceState: 'ready',
        sessions: [],
        username: 'Piggie',
        ...overrides
    };
}

describe('admin user normalization', () => {
    it('joins Jellyfin users to PiggieTV profile summaries across GUID formats', () => {
        const users = mergeAdminUsers([
            user('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 'Piggie', {
                LastActivityDate: '2026-08-12T11:30:00Z',
                Policy: policy({ IsAdministrator: true })
            })
        ], [ profile({ jellyfinUserId: 'aaaaaaaabbbbccccddddeeeeeeeeeeee' }) ], [], {
            resolveAvatarUrl: () => 'https://example.test/avatar',
            now: NOW
        });

        expect(users[0]).toMatchObject({
            accountStatus: 'active',
            email: 'piggie@example.com',
            emailStatus: 'verified',
            emailVerifiedAt: '2026-08-10T09:00:00.000Z',
            isAdministrator: true,
            lastActivityAt: '2026-08-12T11:30:00.000Z',
            maskedEmail: 'p***@example.com',
            role: 'administrator'
        });
    });

    it('keeps unavailable profile data distinct from a known missing email', () => {
        const [ unavailable ] = mergeAdminUsers([ user('user-a', 'Piggie') ], undefined, [], {
            profileSourceState: 'unavailable'
        });
        const [ missing ] = mergeAdminUsers([ user('user-a', 'Piggie') ], [], []);

        expect(unavailable).toMatchObject({
            email: null,
            emailStatus: 'unavailable',
            maskedEmail: null,
            profileSourceState: 'unavailable'
        });
        expect(missing.emailStatus).toBe('missing');
    });

    it('does not expose an unverified canonical email', () => {
        const [ pending ] = mergeAdminUsers([ user('user-a', 'Piggie') ], [ profile({
            emailStatus: 'pending',
            emailVerified: false
        }) ], []);

        expect(pending).toMatchObject({
            email: null,
            emailStatus: 'pending',
            emailVerifiedAt: null,
            maskedEmail: 'p***@example.com'
        });
    });

    it('keeps a verified canonical email while a replacement address is pending', () => {
        const [ pendingReplacement ] = mergeAdminUsers([ user('user-a', 'Piggie') ], [ profile({
            emailStatus: 'pending',
            emailVerified: true,
            maskedEmail: 'n***@example.com'
        }) ], []);

        expect(pendingReplacement).toMatchObject({
            email: 'piggie@example.com',
            emailStatus: 'pending',
            emailVerifiedAt: '2026-08-10T09:00:00.000Z',
            maskedEmail: 'n***@example.com'
        });
    });

    it('drops invalid timestamps instead of exposing Invalid Date', () => {
        expect(normalizeAdminUserDate('not-a-date')).toBeNull();
        expect(normalizeAdminUserDate()).toBeNull();

        const detail = normalizeAdminUserDetail(user('user-a', 'Piggie', {
            HasConfiguredPassword: true,
            LastActivityDate: 'not-a-date',
            LastLoginDate: '2026-08-11T10:00:00Z',
            Policy: policy({
                EnableContentDownloading: true,
                InvalidLoginAttemptCount: 2,
                MaxParentalRating: 13
            })
        }));

        expect(detail).toMatchObject({
            hasConfiguredPassword: true,
            lastActivityAt: null,
            lastLoginAt: '2026-08-11T10:00:00.000Z',
            playbackPolicy: { allowDownloads: true },
            contentPolicy: { maxParentalRating: 13 },
            invalidLoginAttemptCount: 2,
            policyAvailable: true
        });
    });
});

describe('admin user session normalization', () => {
    it('keeps recent or playing sessions for the selected user and excludes stale/other/inactive sessions', () => {
        const sessions = normalizeAdminUserSessions([
            session(),
            session({
                LastActivityDate: new Date(NOW - 60 * 60_000).toISOString()
            }),
            session({
                LastActivityDate: undefined,
                NowPlayingItem: { Name: 'Movie', Type: 'Movie' },
                PlayState: { IsPaused: true }
            }),
            session({ UserId: 'user-b' }),
            session({ IsActive: false })
        ], 'user-a', { now: NOW });

        expect(sessions).toHaveLength(2);
        expect(sessions.some(item => item.mediaTitle === 'Movie' && item.paused)).toBe(true);
    });

    it('groups a single sessions response into per-user active counts', () => {
        const users = mergeAdminUsers([
            user('user-a', 'Alpha'),
            user('user-b', 'Bravo')
        ], [], [
            session({ UserId: 'user-a' }),
            session({ UserId: 'user-b', NowPlayingItem: { Name: 'Show', Type: 'Episode' } }),
            session({ UserId: 'user-b', IsActive: false })
        ], { now: NOW });

        expect(users.map(item => [ item.username, item.activeSessionCount ])).toEqual([
            [ 'Alpha', 1 ],
            [ 'Bravo', 1 ]
        ]);
    });
});

describe('admin user selection helpers', () => {
    const users = [
        summary({
            id: '2',
            isAdministrator: true,
            lastActivityAt: '2026-08-12T10:00:00.000Z',
            maskedEmail: 'a***@example.com',
            role: 'administrator',
            username: 'Zelda'
        }),
        summary({
            accountStatus: 'disabled',
            enabled: false,
            id: '3',
            lastActivityAt: null,
            username: 'Bravo'
        }),
        summary({
            id: '1',
            lastActivityAt: '2026-08-12T11:00:00.000Z',
            username: 'alpha'
        })
    ];

    it('searches username, canonical email, and privacy-safe masked email locally', () => {
        expect(searchAdminUsers(users, 'ALP').map(item => item.id)).toEqual([ '1' ]);
        expect(searchAdminUsers(users, 'example.com').map(item => item.id)).toEqual([ '2' ]);
        expect(searchAdminUsers([
            summary({ email: 'owner@piggie.tv', id: 'email-user' })
        ], 'OWNER@').map(item => item.id)).toEqual([ 'email-user' ]);
    });

    it('filters account state without changing source order', () => {
        expect(filterAdminUsers(users, 'administrators').map(item => item.id)).toEqual([ '2' ]);
        expect(filterAdminUsers(users, 'members').map(item => item.id)).toEqual([ '3', '1' ]);
        expect(filterAdminUsers(users, 'disabled').map(item => item.id)).toEqual([ '3' ]);
    });

    it('sorts deterministically by username, role, or newest activity', () => {
        expect(sortAdminUsers(users, 'username').map(item => item.username)).toEqual([ 'alpha', 'Bravo', 'Zelda' ]);
        expect(sortAdminUsers(users, 'role').map(item => item.id)).toEqual([ '2', '1', '3' ]);
        expect(sortAdminUsers(users, 'last-activity').map(item => item.id)).toEqual([ '1', '2', '3' ]);
        expect(selectAdminUsers(users, {
            filter: 'members',
            query: 'a',
            sort: 'last-activity'
        }).map(item => item.id)).toEqual([ '1', '3' ]);
    });
});

describe('admin user library access normalization', () => {
    const folders: BaseItemDto[] = [
        { Id: 'movies', Name: 'Movies' },
        { Id: 'shows', Name: 'Shows' }
    ];

    it('distinguishes all folders from an explicit selected list', () => {
        expect(normalizeAdminUserLibraryAccess(user('user-a', 'Piggie', {
            Policy: policy({ EnableAllFolders: true, EnabledFolders: [] })
        }), folders)).toMatchObject({
            mode: 'all',
            folders: [ { id: 'movies', selected: true }, { id: 'shows', selected: true } ]
        });

        expect(normalizeAdminUserLibraryAccess(user('user-a', 'Piggie', {
            Policy: policy({ EnableAllFolders: false, EnabledFolders: [ 'movies', 'removed-folder' ] })
        }), folders)).toMatchObject({
            mode: 'selected',
            preservedFolderIds: [ 'removed-folder' ],
            selectedFolderIds: [ 'movies', 'removed-folder' ]
        });
    });

    it('fails closed when policy or folder data is unavailable', () => {
        expect(normalizeAdminUserLibraryAccess(user('user-a', 'Piggie', { Policy: undefined }), folders)).toMatchObject({
            mode: 'unavailable',
            reason: 'policy-unavailable'
        });
        expect(normalizeAdminUserLibraryAccess(user('user-a', 'Piggie'), undefined)).toMatchObject({
            mode: 'unavailable',
            reason: 'folders-unavailable'
        });
    });
});

describe('admin user dangerous-action guards', () => {
    const currentAdmin = summary({ id: 'admin-a', isAdministrator: true, role: 'administrator' });
    const otherAdmin = summary({ id: 'admin-b', isAdministrator: true, role: 'administrator' });
    const member = summary({ id: 'member-a' });

    it('blocks self deletion, disabling, and demotion', () => {
        for (const action of [ 'delete', 'disable', 'demote' ] as const) {
            expect(getAdminUserActionGuard(action, currentAdmin, currentAdmin.id, [ currentAdmin, otherAdmin ])).toMatchObject({
                allowed: false,
                code: 'current-user'
            });
        }
    });

    it('blocks changing the last enabled administrator', () => {
        expect(getAdminUserActionGuard('demote', currentAdmin, member.id, [ currentAdmin, member ])).toMatchObject({
            allowed: false,
            code: 'last-enabled-administrator'
        });
    });

    it('allows guarded actions when another enabled administrator remains', () => {
        expect(getAdminUserActionGuard('disable', otherAdmin, currentAdmin.id, [ currentAdmin, otherAdmin, member ])).toEqual({
            allowed: true,
            code: 'allowed',
            reason: null
        });
    });
});

/* eslint-enable sonarjs/no-hardcoded-passwords */
