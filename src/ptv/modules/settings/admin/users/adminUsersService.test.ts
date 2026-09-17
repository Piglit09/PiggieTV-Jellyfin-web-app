/* eslint-disable sonarjs/no-hardcoded-passwords -- Test-only SDK password request fixtures. */
import type { Api } from '@jellyfin/sdk';
import type { UserDto, UserPolicy } from '@jellyfin/sdk/lib/generated-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdkMocks = vi.hoisted(() => ({
    createUserByName: vi.fn(),
    deleteUser: vi.fn(),
    getMediaFolders: vi.fn(),
    getSessions: vi.fn(),
    getUserById: vi.fn(),
    getUsers: vi.fn(),
    updateUser: vi.fn(),
    updateUserConfiguration: vi.fn(),
    updateUserPassword: vi.fn(),
    updateUserPolicy: vi.fn()
}));

vi.mock('@jellyfin/sdk/lib/utils/api/library-api', () => ({
    getLibraryApi: () => ({ getMediaFolders: sdkMocks.getMediaFolders })
}));

vi.mock('@jellyfin/sdk/lib/utils/api/session-api', () => ({
    getSessionApi: () => ({ getSessions: sdkMocks.getSessions })
}));

vi.mock('@jellyfin/sdk/lib/utils/api/user-api', () => ({
    getUserApi: () => ({
        createUserByName: sdkMocks.createUserByName,
        deleteUser: sdkMocks.deleteUser,
        getUserById: sdkMocks.getUserById,
        getUsers: sdkMocks.getUsers,
        updateUser: sdkMocks.updateUser,
        updateUserConfiguration: sdkMocks.updateUserConfiguration,
        updateUserPassword: sdkMocks.updateUserPassword,
        updateUserPolicy: sdkMocks.updateUserPolicy
    })
}));

import {
    AdminUsersServiceError,
    captureAdminUserLibraryAccess,
    captureAdminUserPlaybackPolicy,
    createAdminUser,
    deleteAdminUser,
    loadAdminUserLibraries,
    loadAdminUsers,
    loadAdminUserSessions,
    resetAdminUserPassword,
    setAdminUserAdministrator,
    setAdminUserEnabled,
    updateAdminUserConfiguration,
    updateAdminUserLibraryAccess,
    updateAdminUserLibraryAccessFromBaseline,
    updateAdminUserPassword,
    updateAdminUserPlaybackPolicyFromBaseline,
    updateAdminUserPolicy,
    updateAdminUsername
} from './adminUsersService';

const api = {} as Api;

function policy(overrides: Partial<UserPolicy> = {}): UserPolicy {
    return {
        AuthenticationProviderId: 'default-auth',
        EnableAllFolders: true,
        EnableAudioPlaybackTranscoding: true,
        EnableContentDownloading: true,
        EnabledFolders: [],
        EnableLiveTvAccess: true,
        EnableMediaPlayback: true,
        EnablePlaybackRemuxing: true,
        EnableRemoteAccess: true,
        EnableVideoPlaybackTranscoding: true,
        PasswordResetProviderId: 'default-reset',
        ...overrides
    };
}

function user(overrides: Partial<UserDto> = {}): UserDto {
    return {
        Configuration: { EnableLocalPassword: false },
        Id: 'user-a',
        Name: 'Piggie',
        Policy: policy(),
        ...overrides
    };
}

describe('admin users service reads', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sdkMocks.getUsers.mockResolvedValue({ data: [] });
        sdkMocks.getSessions.mockResolvedValue({ data: [] });
        sdkMocks.getMediaFolders.mockResolvedValue({ data: { Items: [] } });
    });

    it('forwards AbortSignal while loading the authoritative users list', async () => {
        const signal = { aborted: false } as AbortSignal;
        sdkMocks.getUsers.mockResolvedValue({ data: [ user() ] });

        await expect(loadAdminUsers(api, signal)).resolves.toHaveLength(1);
        expect(sdkMocks.getUsers).toHaveBeenCalledWith({}, { signal });
    });

    it('loads one server-bounded recent session response', async () => {
        const signal = { aborted: false } as AbortSignal;
        sdkMocks.getSessions.mockResolvedValue({
            data: [{
                IsActive: true,
                LastActivityDate: '2026-08-12T10:00:00Z',
                NowPlayingItem: { Name: 'Paused movie', Type: 'Movie' },
                PlayState: { IsPaused: true },
                UserId: 'user-a'
            }]
        });

        await expect(loadAdminUserSessions(api, signal)).resolves.toHaveLength(1);
        expect(sdkMocks.getSessions).toHaveBeenCalledWith({
            activeWithinSeconds: 960,
            deviceId: undefined
        }, { signal });
    });

    it('distinguishes an unavailable folder response from zero configured libraries', async () => {
        sdkMocks.getMediaFolders.mockResolvedValue({ data: {} });

        await expect(loadAdminUserLibraries(api)).rejects.toMatchObject({
            code: 'folders-unavailable'
        });
    });
});

describe('admin users service mutations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sdkMocks.createUserByName.mockResolvedValue({ data: user() });
        sdkMocks.deleteUser.mockResolvedValue({ data: undefined });
        sdkMocks.getMediaFolders.mockResolvedValue({
            data: { Items: [{ Id: 'movies', Name: 'Movies' }, { Id: 'shows', Name: 'Shows' }] }
        });
        sdkMocks.getUserById.mockResolvedValue({ data: user() });
        sdkMocks.updateUser.mockResolvedValue({ data: undefined });
        sdkMocks.updateUserConfiguration.mockResolvedValue({ data: undefined });
        sdkMocks.updateUserPassword.mockResolvedValue({ data: undefined });
        sdkMocks.updateUserPolicy.mockResolvedValue({ data: undefined });
    });

    it('refetches and preserves the complete policy before patching a role or enabled flag', async () => {
        sdkMocks.getUserById.mockResolvedValue({
            data: user({
                Policy: policy({
                    AllowedTags: [ 'family' ],
                    BlockedTags: [ 'spoiler' ],
                    EnableRemoteAccess: false,
                    IsAdministrator: false,
                    IsDisabled: false
                })
            })
        });

        await setAdminUserAdministrator(api, 'user-a', true);

        expect(sdkMocks.updateUserPolicy).toHaveBeenLastCalledWith({
            userId: 'user-a',
            userPolicy: expect.objectContaining({
                AllowedTags: [ 'family' ],
                BlockedTags: [ 'spoiler' ],
                EnableRemoteAccess: false,
                IsAdministrator: true,
                IsDisabled: false
            })
        }, { signal: undefined });

        await setAdminUserEnabled(api, 'user-a', false);
        expect(sdkMocks.updateUserPolicy).toHaveBeenLastCalledWith({
            userId: 'user-a',
            userPolicy: expect.objectContaining({ IsDisabled: true })
        }, { signal: undefined });
        expect(sdkMocks.getUserById).toHaveBeenCalledTimes(2);
    });

    it('fails closed without a full authoritative policy', async () => {
        sdkMocks.getUserById.mockResolvedValue({ data: user({ Policy: undefined }) });

        await expect(updateAdminUserPolicy(api, 'user-a', {
            IsAdministrator: true
        })).rejects.toBeInstanceOf(AdminUsersServiceError);
        expect(sdkMocks.updateUserPolicy).not.toHaveBeenCalled();
    });

    it('compares only playback-owned fields and returns an immutable confirmed baseline', async () => {
        const openingPolicy = policy({
            BlockedTags: [ 'opening-tag' ],
            EnableContentDownloading: true
        });
        const baseline = captureAdminUserPlaybackPolicy(openingPolicy)!;
        const edited = {
            ...baseline,
            EnableContentDownloading: false
        };
        sdkMocks.getUserById.mockResolvedValue({
            data: user({
                Policy: policy({
                    BlockedTags: [ 'changed-elsewhere' ],
                    EnableContentDownloading: true
                })
            })
        });

        const saved = await updateAdminUserPlaybackPolicyFromBaseline(
            api,
            'user-a',
            baseline,
            edited
        );

        expect(saved.confirmedBaseline.EnableContentDownloading).toBe(false);
        expect(Object.isFrozen(saved.confirmedBaseline)).toBe(true);
        expect(saved.policy.BlockedTags).toEqual([ 'changed-elsewhere' ]);
        expect(sdkMocks.updateUserPolicy).toHaveBeenCalledWith({
            userId: 'user-a',
            userPolicy: expect.objectContaining({
                BlockedTags: [ 'changed-elsewhere' ],
                EnableContentDownloading: false
            })
        }, { signal: undefined });
    });

    it('blocks a stale playback baseline without overwriting managed server changes', async () => {
        const baseline = captureAdminUserPlaybackPolicy(policy({
            EnableRemoteAccess: true
        }))!;
        sdkMocks.getUserById.mockResolvedValue({
            data: user({
                Policy: policy({ EnableRemoteAccess: false })
            })
        });

        await expect(updateAdminUserPlaybackPolicyFromBaseline(api, 'user-a', baseline, {
            ...baseline,
            EnableContentDownloading: false
        })).rejects.toMatchObject({
            code: 'managed-state-conflict',
            message: expect.stringContaining('changed on the server')
        });
        expect(sdkMocks.updateUserPolicy).not.toHaveBeenCalled();
    });

    it('preserves unknown selected folder ids and unrelated policy fields', async () => {
        sdkMocks.getUserById.mockResolvedValue({
            data: user({
                Policy: policy({
                    BlockedMediaFolders: [ 'blocked-library' ],
                    EnableAllFolders: false,
                    EnabledFolders: [ 'movies', 'retired-library' ]
                })
            })
        });

        const saved = await updateAdminUserLibraryAccess(api, 'user-a', {
            mode: 'selected',
            selectedFolderIds: [ 'shows' ]
        });

        expect(saved.EnabledFolders).toEqual([ 'shows', 'retired-library' ]);
        expect(saved.BlockedMediaFolders).toEqual([ 'blocked-library' ]);
        expect(sdkMocks.updateUserPolicy).toHaveBeenCalledWith({
            userId: 'user-a',
            userPolicy: expect.objectContaining({
                EnableAllFolders: false,
                EnabledFolders: [ 'shows', 'retired-library' ]
            })
        }, { signal: undefined });
    });

    it('saves library access from an opening baseline and adopts preserved server state', async () => {
        const openingPolicy = policy({
            EnableAllFolders: false,
            EnabledFolders: [ 'movies', 'retired-library' ]
        });
        const baseline = captureAdminUserLibraryAccess(openingPolicy)!;
        expect(Object.isFrozen(baseline)).toBe(true);
        expect(Object.isFrozen(baseline.enabledFolderIds)).toBe(true);
        openingPolicy.EnabledFolders?.push('later-local-mutation');
        expect(baseline.enabledFolderIds).toEqual([ 'movies', 'retired-library' ]);
        sdkMocks.getUserById.mockResolvedValue({
            data: user({
                Policy: policy({
                    BlockedTags: [ 'changed-elsewhere' ],
                    EnableAllFolders: false,
                    EnabledFolders: [ 'movies', 'retired-library' ]
                })
            })
        });

        const saved = await updateAdminUserLibraryAccessFromBaseline(
            api,
            'user-a',
            baseline,
            { mode: 'selected', selectedFolderIds: [ 'shows' ] }
        );

        expect(saved.confirmedBaseline).toEqual({
            enableAllFolders: false,
            enabledFolderIds: [ 'shows', 'retired-library' ]
        });
        expect(saved.policy.BlockedTags).toEqual([ 'changed-elsewhere' ]);
    });

    it('blocks a stale library-access baseline without writing', async () => {
        const baseline = captureAdminUserLibraryAccess(policy({
            EnableAllFolders: false,
            EnabledFolders: [ 'movies' ]
        }))!;
        sdkMocks.getUserById.mockResolvedValue({
            data: user({
                Policy: policy({
                    EnableAllFolders: false,
                    EnabledFolders: [ 'shows' ]
                })
            })
        });

        await expect(updateAdminUserLibraryAccessFromBaseline(
            api,
            'user-a',
            baseline,
            { mode: 'all' }
        )).rejects.toMatchObject({
            code: 'managed-state-conflict',
            message: expect.stringContaining('changed on the server')
        });
        expect(sdkMocks.updateUserPolicy).not.toHaveBeenCalled();
    });

    it('blocks stale or malformed library selections before mutation', async () => {
        await expect(updateAdminUserLibraryAccess(api, 'user-a', {
            mode: 'selected',
            selectedFolderIds: [ 'unknown-library' ]
        })).rejects.toMatchObject({ code: 'invalid-library-selection' });
        expect(sdkMocks.updateUserPolicy).not.toHaveBeenCalled();
    });

    it('refetches full account shapes before updating identity and configuration', async () => {
        await updateAdminUsername(api, 'user-a', ' New Name ');
        expect(sdkMocks.updateUser).toHaveBeenCalledWith({
            userDto: expect.objectContaining({
                Configuration: { EnableLocalPassword: false },
                Name: 'New Name',
                Policy: expect.objectContaining({ AuthenticationProviderId: 'default-auth' })
            }),
            userId: 'user-a'
        }, { signal: undefined });

        await updateAdminUserConfiguration(api, 'user-a', { EnableNextEpisodeAutoPlay: true });
        expect(sdkMocks.updateUserConfiguration).toHaveBeenCalledWith({
            userConfiguration: {
                EnableLocalPassword: false,
                EnableNextEpisodeAutoPlay: true
            },
            userId: 'user-a'
        }, { signal: undefined });
    });

    it('uses existing SDK contracts for create, delete, set password, and reset password', async () => {
        const temporaryCredential = [ 'temporary', 'fixture' ].join('-');
        const currentCredential = [ 'current', 'fixture' ].join('-');
        const replacementCredential = [ 'replacement', 'fixture' ].join('-');

        await createAdminUser(api, { password: temporaryCredential, username: ' New User ' });
        expect(sdkMocks.createUserByName).toHaveBeenCalledWith({
            createUserByName: { Name: 'New User', Password: temporaryCredential }
        }, { signal: undefined });

        await updateAdminUserPassword(api, 'user-a', {
            currentPassword: currentCredential,
            newPassword: replacementCredential
        });
        expect(sdkMocks.updateUserPassword).toHaveBeenCalledWith({
            updateUserPassword: {
                CurrentPw: currentCredential,
                NewPw: replacementCredential,
                ResetPassword: false
            },
            userId: 'user-a'
        }, { signal: undefined });

        await resetAdminUserPassword(api, 'user-a');
        expect(sdkMocks.updateUserPassword).toHaveBeenLastCalledWith({
            updateUserPassword: { ResetPassword: true },
            userId: 'user-a'
        }, { signal: undefined });

        await deleteAdminUser(api, 'user-a');
        expect(sdkMocks.deleteUser).toHaveBeenCalledWith({ userId: 'user-a' }, { signal: undefined });
    });
});

/* eslint-enable sonarjs/no-hardcoded-passwords */
