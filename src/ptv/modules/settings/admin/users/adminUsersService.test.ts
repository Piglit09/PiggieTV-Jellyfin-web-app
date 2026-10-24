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
const transitionMocks = vi.hoisted(() => ({
    activeUserId: '',
    acknowledgeUser: vi.fn(),
    begin: vi.fn(),
    clearUserHint: vi.fn(),
    complete: vi.fn(),
    current: vi.fn(),
    matchesSdkApi: vi.fn(() => true),
    retireUser: vi.fn()
}));

vi.mock('../../../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: () => ({
        beginHomeUserAccess: transitionMocks.begin,
        completeHomeUserAccess: transitionMocks.complete,
        getCurrentHomeUserAccess: transitionMocks.current,
        matchesSdkApi: transitionMocks.matchesSdkApi
    })
}));

vi.mock('../../../../pages/home/homeLibraryTransitionFreshness', () => ({
    acknowledgeHomeUserAccessBeginEpoch: transitionMocks.acknowledgeUser,
    clearHomeUserAccessRetirementHint: transitionMocks.clearUserHint,
    retireHomeLibraryAuthority: vi.fn(),
    retireHomeUserAccessAuthority: transitionMocks.retireUser
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
    loadCurrentHomeUserAccess,
    loadAdminUsers,
    loadAdminUserSessions,
    resetAdminUserPassword,
    retryExistingUserAccessCompletion,
    reverifyPreviouslyAttestedUserAccess,
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
        IsAdministrator: false,
        IsDisabled: false,
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
        transitionMocks.activeUserId = '';
        transitionMocks.matchesSdkApi.mockReturnValue(true);
        transitionMocks.begin.mockImplementation(async intent => {
            transitionMocks.activeUserId = intent.userId;
            return {
                version: 1,
                userId: intent.userId,
                accessEpoch: 'a'.repeat(64),
                held: true,
                operationId: intent.operationId,
                policyProven: false,
                state: 'pending',
                writeAllowed: true
            };
        });
        transitionMocks.complete.mockImplementation(async operationId => ({
            version: 1,
            userId: transitionMocks.activeUserId,
            accessEpoch: 'a'.repeat(64),
            held: false,
            operationId,
            policyProven: true,
            state: 'policy-attested',
            writeAllowed: false
        }));
        transitionMocks.current.mockResolvedValue({
            version: 1, userId: '11111111111111111111111111111111',
            accessEpoch: 'a'.repeat(64), held: true, policyProven: false,
            operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            state: 'pending', writeAllowed: false
        });
        sdkMocks.createUserByName.mockResolvedValue({ data: user() });
        sdkMocks.deleteUser.mockResolvedValue({ data: undefined });
        sdkMocks.getMediaFolders.mockResolvedValue({
            data: { Items: [{ Id: 'movies', Name: 'Movies' }, { Id: 'shows', Name: 'Shows' }] }
        });
        sdkMocks.getUserById.mockResolvedValue({ data: user() });
        sdkMocks.updateUser.mockResolvedValue({ data: undefined });
        sdkMocks.updateUserConfiguration.mockResolvedValue({ data: undefined });
        sdkMocks.updateUserPassword.mockResolvedValue({ data: undefined });
        sdkMocks.updateUserPolicy.mockImplementation(async ({ userId, userPolicy }) => {
            sdkMocks.getUserById.mockResolvedValue({ data: user({ Id: userId, Policy: userPolicy }) });
            return { data: undefined };
        });
    });

    it('holds an existing user before one policy write and completes only after exact readback', async () => {
        const id = '11111111111111111111111111111111';
        const events: string[] = [];
        const current = policy({ EnableAllFolders: false, EnabledFolders: [ 'movies' ], IsAdministrator: false, IsDisabled: false });
        const intended = policy({ EnableAllFolders: false, EnabledFolders: [ 'shows' ], IsAdministrator: false, IsDisabled: false });
        sdkMocks.getUserById.mockImplementation(async () => {
            events.push('read');
            return { data: user({ Id: id, Policy: events.includes('write') ? intended : current }) };
        });
        transitionMocks.begin.mockImplementation(async intent => {
            events.push('begin');
            transitionMocks.activeUserId = intent.userId;
            return { version: 1, userId: intent.userId, accessEpoch: 'a'.repeat(64), held: true,
                operationId: intent.operationId, policyProven: false, state: 'pending', writeAllowed: true };
        });
        transitionMocks.acknowledgeUser.mockImplementation(() => {
            events.push('ack');
        });
        sdkMocks.updateUserPolicy.mockImplementation(async () => {
            events.push('write');
            return { data: undefined };
        });
        transitionMocks.complete.mockImplementation(async operationId => {
            events.push('complete');
            return { version: 1, userId: transitionMocks.activeUserId, accessEpoch: 'a'.repeat(64), held: false,
                operationId, policyProven: true, state: 'policy-attested', writeAllowed: false };
        });

        const saved = await updateAdminUserLibraryAccessFromBaseline(
            api, id, { enableAllFolders: false, enabledFolderIds: [ 'movies' ] },
            { mode: 'selected', selectedFolderIds: [ 'shows' ] }
        );

        expect(events).toEqual([ 'read', 'begin', 'ack', 'write', 'read', 'complete' ]);
        expect(transitionMocks.retireUser).toHaveBeenCalledWith(id, 'controlled-user-access');
        expect(transitionMocks.retireUser).toHaveBeenCalledBefore(transitionMocks.begin);
        expect(transitionMocks.clearUserHint).toHaveBeenCalledWith(id);
        expect(transitionMocks.clearUserHint).toHaveBeenCalledAfter(transitionMocks.begin);
        expect(transitionMocks.acknowledgeUser).toHaveBeenCalledWith(id, 'a'.repeat(64));
        expect(transitionMocks.acknowledgeUser).toHaveBeenCalledBefore(sdkMocks.updateUserPolicy);
        expect(transitionMocks.begin).toHaveBeenCalledWith(expect.objectContaining({
            mode: 'existing',
            userId: id,
            expectedAccess: {
                userId: id, enableAllFolders: false, enabledFolders: [ 'movies' ],
                isAdministrator: false, isDisabled: false
            },
            intendedAccess: {
                userId: id, enableAllFolders: false, enabledFolders: [ 'shows' ],
                isAdministrator: false, isDisabled: false
            }
        }), { signal: undefined });
        expect(transitionMocks.complete).toHaveBeenCalledWith(expect.any(String), { signal: undefined });
        expect(saved.policy.EnabledFolders).toEqual([ 'shows' ]);
    });

    it('does not write if the durable pre-write hold fails', async () => {
        transitionMocks.begin.mockRejectedValue(new Error('ledger unavailable'));
        await expect(updateAdminUserLibraryAccessFromBaseline(
            api, '11111111111111111111111111111111',
            { enableAllFolders: true, enabledFolderIds: [] },
            { mode: 'selected', selectedFolderIds: [ 'shows' ] }
        )).rejects.toThrow();
        expect(sdkMocks.updateUserPolicy).not.toHaveBeenCalled();
        expect(transitionMocks.complete).not.toHaveBeenCalled();
    });

    it('does not complete a hold after readback returns another account identity', async () => {
        const id = '11111111111111111111111111111111';
        const oldPolicy = policy({ EnableAllFolders: true, EnabledFolders: [] });
        const newPolicy = policy({ EnableAllFolders: false, EnabledFolders: [ 'shows' ] });
        sdkMocks.getUserById
            .mockResolvedValueOnce({ data: user({ Id: id, Policy: oldPolicy }) })
            .mockResolvedValueOnce({ data: user({ Id: '22222222222222222222222222222222', Policy: newPolicy }) });
        sdkMocks.updateUserPolicy.mockResolvedValue({ data: undefined });

        await expect(updateAdminUserLibraryAccessFromBaseline(
            api, id, { enableAllFolders: true, enabledFolderIds: [] },
            { mode: 'selected', selectedFolderIds: [ 'shows' ] }
        )).rejects.toMatchObject({ code: 'transition-unavailable' });
        expect(sdkMocks.updateUserPolicy).toHaveBeenCalledOnce();
        expect(transitionMocks.complete).not.toHaveBeenCalled();
    });

    it('sends canonical account and folder IDs to the Plugin hold', async () => {
        const uppercaseId = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
        const uppercaseFolder = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
        const lowercaseFolder = 'cccccccccccccccccccccccccccccccc';
        const serverPolicy = policy({
            EnableAllFolders: false,
            EnabledFolders: [ uppercaseFolder ],
            IsAdministrator: false,
            IsDisabled: false
        });
        sdkMocks.getMediaFolders.mockResolvedValue({ data: { Items: [
            { Id: uppercaseFolder, Name: 'Movies' },
            { Id: lowercaseFolder, Name: 'Shows' }
        ] } });
        sdkMocks.getUserById.mockResolvedValue({ data: user({ Id: uppercaseId, Policy: serverPolicy }) });

        await updateAdminUserLibraryAccessFromBaseline(
            api, uppercaseId,
            { enableAllFolders: false, enabledFolderIds: [ uppercaseFolder ] },
            { mode: 'selected', selectedFolderIds: [ lowercaseFolder ] }
        );

        expect(transitionMocks.begin).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            expectedAccess: expect.objectContaining({
                userId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                enabledFolders: [ 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' ]
            }),
            intendedAccess: expect.objectContaining({ enabledFolders: [ lowercaseFolder ] })
        }), { signal: undefined });
    });

    it('treats an omitted Jellyfin folder list as empty for an all-folders policy', async () => {
        const id = '11111111111111111111111111111111';
        sdkMocks.getUserById.mockResolvedValue({ data: user({ Id: id, Policy: policy({
            EnableAllFolders: true,
            EnabledFolders: undefined
        }) }) });

        await updateAdminUserLibraryAccessFromBaseline(
            api, id, { enableAllFolders: true, enabledFolderIds: [] },
            { mode: 'selected', selectedFolderIds: [ 'shows' ] }
        );

        expect(transitionMocks.begin).toHaveBeenCalledWith(expect.objectContaining({
            expectedAccess: expect.objectContaining({ enabledFolders: [] })
        }), { signal: undefined });
    });

    it('reports a held recovery state when postwrite policy readback is unavailable', async () => {
        const id = '11111111111111111111111111111111';
        sdkMocks.getUserById
            .mockResolvedValueOnce({ data: user({ Id: id, Policy: policy() }) })
            .mockResolvedValueOnce({ data: user({ Id: id, Policy: undefined }) });
        sdkMocks.updateUserPolicy.mockResolvedValue({ data: undefined });

        await expect(updateAdminUserLibraryAccessFromBaseline(
            api, id, { enableAllFolders: true, enabledFolderIds: [] },
            { mode: 'selected', selectedFolderIds: [ 'shows' ] }
        )).rejects.toMatchObject({
            code: 'transition-unavailable',
            message: expect.stringContaining('remains held')
        });
        expect(sdkMocks.updateUserPolicy).toHaveBeenCalledOnce();
        expect(transitionMocks.complete).not.toHaveBeenCalled();
    });

    it('does not retry an uncertain stock policy write and reports the held recovery state', async () => {
        sdkMocks.updateUserPolicy.mockRejectedValue(new Error('connection ended after request'));

        await expect(updateAdminUserLibraryAccessFromBaseline(
            api, '11111111111111111111111111111111',
            { enableAllFolders: true, enabledFolderIds: [] },
            { mode: 'selected', selectedFolderIds: [ 'shows' ] }
        )).rejects.toMatchObject({
            code: 'transition-unavailable',
            message: expect.stringContaining('remains held')
        });
        expect(sdkMocks.updateUserPolicy).toHaveBeenCalledOnce();
        expect(transitionMocks.complete).not.toHaveBeenCalled();
    });

    it('does not adopt a policy when Plugin Complete is unavailable after readback', async () => {
        transitionMocks.complete.mockRejectedValue(new Error('Plugin unavailable'));

        await expect(updateAdminUserLibraryAccessFromBaseline(
            api, '11111111111111111111111111111111',
            { enableAllFolders: true, enabledFolderIds: [] },
            { mode: 'selected', selectedFolderIds: [ 'shows' ] }
        )).rejects.toMatchObject({
            code: 'transition-unavailable',
            message: expect.stringContaining('remains held')
        });
        expect(sdkMocks.updateUserPolicy).toHaveBeenCalledOnce();
        expect(transitionMocks.complete).toHaveBeenCalledOnce();
    });

    it('does not adopt a completion claiming another user or lacking proven policy', async () => {
        const id = '11111111111111111111111111111111';
        transitionMocks.complete.mockImplementationOnce(async operationId => ({
            version: 1, userId: '22222222222222222222222222222222',
            accessEpoch: 'a'.repeat(64), held: false, policyProven: true,
            operationId, state: 'policy-attested', writeAllowed: false
        }));
        await expect(updateAdminUserLibraryAccessFromBaseline(
            api, id, { enableAllFolders: true, enabledFolderIds: [] },
            { mode: 'selected', selectedFolderIds: [ 'shows' ] }
        )).rejects.toMatchObject({ code: 'transition-unavailable' });

        sdkMocks.getUserById.mockResolvedValue({ data: user({ Id: id, Policy: policy() }) });
        transitionMocks.complete.mockImplementationOnce(async operationId => ({
            version: 1, userId: id,
            accessEpoch: 'a'.repeat(64), held: false, policyProven: false,
            operationId, state: 'policy-attested', writeAllowed: false
        }));
        await expect(updateAdminUserLibraryAccessFromBaseline(
            api, id, { enableAllFolders: true, enabledFolderIds: [] },
            { mode: 'selected', selectedFolderIds: [ 'shows' ] }
        )).rejects.toMatchObject({ code: 'transition-unavailable' });
    });

    it('retries held existing access by same-operation Plugin readback without another Jellyfin write', async () => {
        const id = '11111111111111111111111111111111';
        transitionMocks.complete.mockResolvedValue({
            version: 1, userId: id, accessEpoch: 'a'.repeat(64), held: false, policyProven: true,
            operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            state: 'policy-attested', writeAllowed: false
        });

        const completed = await retryExistingUserAccessCompletion(api, id);

        expect(transitionMocks.current).toHaveBeenCalledWith(id, { signal: undefined });
        expect(transitionMocks.complete).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { signal: undefined });
        expect(sdkMocks.updateUserPolicy).not.toHaveBeenCalled();
        expect(completed.policyProven).toBe(true);
    });

    it('re-verifies stale topology from a prior attested policy only after confirmed current policy and a full PUT', async () => {
        const id = '11111111111111111111111111111111';
        const access = {
            enableAllFolders: false,
            enabledFolders: [ '22222222222222222222222222222222' ],
            isAdministrator: false,
            isDisabled: false,
            userId: id
        };
        transitionMocks.current.mockResolvedValue({
            version: 1, userId: id, accessEpoch: 'b'.repeat(64), held: true,
            policyProven: false, operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            state: 'policy-attested', writeAllowed: false,
            currentAccess: access, intendedAccess: access
        });
        sdkMocks.getUserById.mockResolvedValue({ data: user({
            Id: id,
            Policy: policy({ EnableAllFolders: false, EnabledFolders: access.enabledFolders })
        }) });

        await reverifyPreviouslyAttestedUserAccess(api, id, access);
        expect(transitionMocks.current).toHaveBeenCalledWith(id, { signal: undefined });
        expect(transitionMocks.begin).toHaveBeenCalledWith(expect.objectContaining({
            mode: 'preserve', expectedAccess: access, intendedAccess: access
        }), { signal: undefined });
        expect(sdkMocks.updateUserPolicy).toHaveBeenCalledOnce();
        expect(transitionMocks.complete).toHaveBeenCalledOnce();
    });

    it('reproves an explicitly reviewed out-of-band policy change only with prior attested lineage', async () => {
        const id = '11111111111111111111111111111111';
        const prior = {
            enableAllFolders: false,
            enabledFolders: [],
            isAdministrator: false,
            isDisabled: false,
            userId: id
        };
        const current = {
            ...prior,
            enableAllFolders: true,
            enabledFolders: [ '22222222222222222222222222222222' ],
            isAdministrator: true
        };
        transitionMocks.current.mockResolvedValue({
            version: 1, userId: id, accessEpoch: 'b'.repeat(64), held: true,
            policyProven: false, operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            state: 'policy-attested', writeAllowed: false,
            currentAccess: current, intendedAccess: prior
        });
        sdkMocks.getUserById.mockResolvedValue({ data: user({ Id: id, Policy: policy({
            EnableAllFolders: true, EnabledFolders: current.enabledFolders, IsAdministrator: true
        }) }) });

        await reverifyPreviouslyAttestedUserAccess(api, id, current);
        expect(transitionMocks.begin).toHaveBeenCalledWith(expect.objectContaining({
            mode: 'reproof', expectedAccess: current, intendedAccess: current
        }), { signal: undefined });
        expect(sdkMocks.updateUserPolicy).toHaveBeenCalledOnce();
    });

    it('refuses stale or unproven recovery previews before Begin and stock writes', async () => {
        const id = '11111111111111111111111111111111';
        const access = {
            enableAllFolders: true,
            enabledFolders: [],
            isAdministrator: false,
            isDisabled: false,
            userId: id
        };
        for (const diagnostic of [
            { state: 'unproven', currentAccess: access, intendedAccess: access },
            { state: 'policy-attested', currentAccess: { ...access, isAdministrator: true }, intendedAccess: access }
        ]) {
            transitionMocks.current.mockResolvedValueOnce({
                version: 1, userId: id, accessEpoch: 'b'.repeat(64), held: true,
                policyProven: false, operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                writeAllowed: false, ...diagnostic
            });
            await expect(reverifyPreviouslyAttestedUserAccess(api, id, access)).rejects.toThrow();
        }
        expect(transitionMocks.begin).not.toHaveBeenCalled();
        expect(sdkMocks.updateUserPolicy).not.toHaveBeenCalled();
    });

    it('shows no pending Plugin operation when the target has no current access record', async () => {
        transitionMocks.current.mockRejectedValue({ status: 404 });
        await expect(loadCurrentHomeUserAccess(
            api, '11111111111111111111111111111111'
        )).resolves.toBeNull();
        expect(sdkMocks.updateUserPolicy).not.toHaveBeenCalled();
    });

    it('puts existing role and sign-in changes behind a durable access hold', async () => {
        sdkMocks.getUserById.mockResolvedValue({ data: user({
            Policy: policy({ IsAdministrator: false, IsDisabled: false })
        }) });
        sdkMocks.updateUserPolicy.mockImplementation(async ({ userPolicy }) => {
            sdkMocks.getUserById.mockResolvedValue({ data: user({ Policy: userPolicy }) });
            return { data: undefined };
        });

        await setAdminUserAdministrator(api, 'user-a', true);
        expect(transitionMocks.begin).toHaveBeenCalledWith(expect.objectContaining({
            mode: 'existing',
            intendedAccess: expect.objectContaining({ isAdministrator: true, isDisabled: false })
        }), { signal: undefined });
        expect(transitionMocks.complete).toHaveBeenCalledOnce();

        await setAdminUserEnabled(api, 'user-a', false);
        expect(transitionMocks.begin).toHaveBeenCalledTimes(2);
        expect(transitionMocks.begin).toHaveBeenLastCalledWith(expect.objectContaining({
            mode: 'existing',
            intendedAccess: expect.objectContaining({ isAdministrator: true, isDisabled: true })
        }), { signal: undefined });
        expect(transitionMocks.complete).toHaveBeenCalledTimes(2);
    });

    it('rejects a generic folder-access patch before any Jellyfin write', async () => {
        await expect(updateAdminUserPolicy(api, 'user-a', {
            EnableAllFolders: true,
            EnabledFolders: []
        })).rejects.toMatchObject({ code: 'invalid-library-selection' });
        expect(sdkMocks.updateUserPolicy).not.toHaveBeenCalled();
    });

    it('holds a full policy write for a non-access patch until Plugin readback completes', async () => {
        const id = '11111111111111111111111111111111';
        const events: string[] = [];
        sdkMocks.getUserById.mockImplementation(async () => {
            events.push('read');
            return { data: user({ Id: id, Policy: policy({ EnableRemoteAccess: !events.includes('write') }) }) };
        });
        transitionMocks.begin.mockImplementation(async intent => {
            events.push('begin');
            transitionMocks.activeUserId = intent.userId;
            return { version: 1, userId: intent.userId, accessEpoch: 'a'.repeat(64), held: true,
                operationId: intent.operationId, policyProven: false, state: 'pending', writeAllowed: true };
        });
        transitionMocks.acknowledgeUser.mockImplementation(() => events.push('ack'));
        sdkMocks.updateUserPolicy.mockImplementation(async () => {
            events.push('write');
            return { data: undefined };
        });
        transitionMocks.complete.mockImplementation(async operationId => {
            events.push('complete');
            return { version: 1, userId: id, accessEpoch: 'a'.repeat(64), held: false,
                operationId, policyProven: true, state: 'policy-attested', writeAllowed: false };
        });

        await updateAdminUserPolicy(api, id, { EnableRemoteAccess: false });

        expect(events).toEqual([ 'read', 'begin', 'ack', 'write', 'read', 'complete' ]);
        expect(transitionMocks.begin).toHaveBeenCalledWith(expect.objectContaining({
            mode: 'preserve',
            expectedAccess: expect.objectContaining({ enableAllFolders: true, isAdministrator: false, isDisabled: false }),
            intendedAccess: expect.objectContaining({ enableAllFolders: true, isAdministrator: false, isDisabled: false })
        }), { signal: undefined });
        expect(transitionMocks.retireUser).toHaveBeenCalledWith(id, 'controlled-user-access');
    });

    it('blocks a playback full policy write when the Plugin hold is unavailable', async () => {
        const id = '11111111111111111111111111111111';
        const baseline = captureAdminUserPlaybackPolicy(policy())!;
        transitionMocks.begin.mockRejectedValue(new Error('Plugin hold unavailable'));
        sdkMocks.getUserById.mockResolvedValue({ data: user({ Id: id, Policy: policy() }) });

        await expect(updateAdminUserPlaybackPolicyFromBaseline(api, id, baseline, {
            ...baseline, EnableContentDownloading: false
        })).rejects.toThrow('Plugin hold unavailable');

        expect(transitionMocks.begin).toHaveBeenCalledWith(expect.objectContaining({ mode: 'preserve' }), { signal: undefined });
        expect(sdkMocks.updateUserPolicy).not.toHaveBeenCalled();
        expect(transitionMocks.complete).not.toHaveBeenCalled();
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
        expect(sdkMocks.getUserById).toHaveBeenCalledTimes(4);
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

    it('matches a canonical new-user folder selection against dashed Jellyfin folder IDs', async () => {
        const folderN = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
        const folderD = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
        sdkMocks.getMediaFolders.mockResolvedValue({ data: { Items: [ { Id: folderD, Name: 'Movies' } ] } });

        const saved = await updateAdminUserLibraryAccess(api, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', {
            mode: 'selected',
            selectedFolderIds: [ folderN ]
        });

        expect(saved.EnabledFolders).toEqual([ folderN ]);
        expect(sdkMocks.updateUserPolicy).toHaveBeenCalledWith({
            userId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            userPolicy: expect.objectContaining({ EnabledFolders: [ folderN ], EnableAllFolders: false })
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
