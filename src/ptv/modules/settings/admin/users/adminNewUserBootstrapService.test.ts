import type { Api } from '@jellyfin/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    bootstrapNewAdminUser,
    clearPendingNewAdminUser,
    clearPendingNewAdminCreation,
    createPendingNewAdminCreation,
    createPendingNewAdminUser,
    readPendingNewAdminUser,
    readPendingNewAdminCreation,
    reserveNewAdminUserCreation,
    resumePendingNewAdminUser,
    savePendingNewAdminUser,
    savePendingNewAdminCreation,
    supersedeHeldAdminUserAccess,
    verifyUnprovenAdminUserAccess,
    type PendingNewAdminUser
} from './adminNewUserBootstrapService';

const USER_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const OPERATION_ID = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const CREATION_ID = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const EPOCH = 'c'.repeat(64);
const api = {} as Api;
const calls: string[] = [];
const mocks = vi.hoisted(() => ({
    begin: vi.fn(),
    bind: vi.fn(),
    complete: vi.fn(),
    current: vi.fn(),
    matchesSdkApi: vi.fn(() => true),
    reserve: vi.fn(),
    updateLibraries: vi.fn(),
    updatePolicy: vi.fn()
}));

vi.mock('../../../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: () => ({
        beginHomeUserAccess: mocks.begin,
        bindHomeUserCreation: mocks.bind,
        completeHomeUserAccess: mocks.complete,
        getCurrentHomeUserAccess: mocks.current,
        matchesSdkApi: mocks.matchesSdkApi,
        reserveHomeUserCreation: mocks.reserve
    })
}));

vi.mock('./adminUsersService', () => ({
    updateAdminUserLibraryAccess: mocks.updateLibraries,
    updateNewAdminUserPolicy: mocks.updatePolicy
}));

function pending(): PendingNewAdminUser {
    return {
        administrator: false,
        allLibraries: true,
        creationOperationId: CREATION_ID,
        id: USER_ID,
        operationId: OPERATION_ID,
        selectedFolderIds: [],
        username: 'Nova'
    };
}

function view(overrides: Record<string, unknown> = {}) {
    return {
        accessEpoch: EPOCH,
        held: false,
        operationId: OPERATION_ID,
        policyProven: true,
        state: 'policy-attested',
        userId: USER_ID,
        version: 1,
        writeAllowed: false,
        ...overrides
    };
}

describe('new administrator user bootstrap', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        calls.length = 0;
        localStorage.clear();
        mocks.reserve.mockImplementation(async request => {
            calls.push('reserve');
            return {
                bootstrapRequired: false,
                creationOperationId: request.creationOperationId,
                migrationVerificationHeld: true,
                state: 'reserved',
                userId: null,
                version: 1
            };
        });
        mocks.bind.mockImplementation(async (creationOperationId, request) => {
            calls.push('bind');
            return {
                bootstrapRequired: true,
                creationOperationId,
                migrationVerificationHeld: false,
                state: 'bound',
                userId: request.userId,
                version: 1
            };
        });
        mocks.begin.mockImplementation(async () => {
            calls.push('begin');
            return view({ held: true, policyProven: false, state: 'pending', writeAllowed: true });
        });
        mocks.updatePolicy.mockImplementation(async () => {
            calls.push('policy');
        });
        mocks.updateLibraries.mockImplementation(async () => {
            calls.push('libraries');
        });
        mocks.complete.mockImplementation(async () => {
            calls.push('complete');
            return view();
        });
    });

    it('begins before both stock policy writes and accepts only Plugin terminal readback', async () => {
        const result = await bootstrapNewAdminUser(api, pending());

        expect(calls).toEqual([ 'bind', 'begin', 'policy', 'libraries', 'complete' ]);
        expect(mocks.bind).toHaveBeenCalledWith(CREATION_ID, { userId: USER_ID });
        expect(mocks.begin).toHaveBeenCalledWith({
            expectedAccess: null,
            intendedAccess: {
                enableAllFolders: true,
                enabledFolders: [],
                isAdministrator: false,
                isDisabled: false,
                userId: USER_ID
            },
            mode: 'bootstrap',
            operationId: OPERATION_ID,
            userId: USER_ID
        });
        expect(mocks.updatePolicy).toHaveBeenCalledWith(api, USER_ID, { IsAdministrator: false, IsDisabled: false });
        expect(mocks.updateLibraries).toHaveBeenCalledWith(api, USER_ID, { mode: 'all' });
        expect(result).toEqual(view());
    });

    it('does not issue another stock write when Begin replays without write permission', async () => {
        mocks.begin.mockResolvedValue(view({ held: true, policyProven: false, state: 'pending', writeAllowed: false }));

        await expect(bootstrapNewAdminUser(api, pending())).rejects.toThrow();
        expect(mocks.updatePolicy).not.toHaveBeenCalled();
        expect(mocks.updateLibraries).not.toHaveBeenCalled();
        expect(mocks.complete).not.toHaveBeenCalled();
    });

    it('manually bootstraps a controlled-created ID only after fresh Plugin proof and explicit intended policy', async () => {
        mocks.current.mockResolvedValue(view({
            accessEpoch: null,
            controlledCreated: true,
            held: true,
            operationId: null,
            policyProven: false,
            state: 'unproven',
            writeAllowed: false
        }));
        mocks.begin.mockImplementation(async request => {
            calls.push('begin');
            return view({ held: true, operationId: request.operationId, policyProven: false, state: 'pending', writeAllowed: true });
        });
        mocks.complete.mockImplementation(async operationId => {
            calls.push('complete');
            return view({ operationId });
        });
        const intended = {
            enableAllFolders: false,
            enabledFolders: [ 'dddddddddddddddddddddddddddddddd' ],
            isAdministrator: true,
            isDisabled: true,
            userId: USER_ID
        };

        await expect(verifyUnprovenAdminUserAccess(api, USER_ID, intended)).resolves.toMatchObject({ policyProven: true });
        expect(calls).toEqual([ 'begin', 'policy', 'libraries', 'complete' ]);
        expect(mocks.begin.mock.calls[0][0]).toMatchObject({
            expectedAccess: null,
            intendedAccess: intended,
            mode: 'bootstrap',
            userId: USER_ID
        });
        expect(mocks.updatePolicy).toHaveBeenCalledWith(api, USER_ID, { IsAdministrator: true, IsDisabled: true });
        expect(mocks.updateLibraries).toHaveBeenCalledWith(api, USER_ID, {
            mode: 'selected', selectedFolderIds: intended.enabledFolders
        });
    });

    it('does not bootstrap a legacy or already-held ID from a browser policy choice', async () => {
        for (const unsafe of [
            { controlledCreated: false, operationId: null, state: 'unproven' },
            { controlledCreated: true, operationId: OPERATION_ID, state: 'pending' }
        ]) {
            mocks.current.mockResolvedValueOnce(view({
                accessEpoch: null,
                held: true,
                policyProven: false,
                writeAllowed: false,
                ...unsafe
            }));
            await expect(verifyUnprovenAdminUserAccess(api, USER_ID, {
                enableAllFolders: false,
                enabledFolders: [],
                isAdministrator: false,
                isDisabled: false,
                userId: USER_ID
            })).rejects.toThrow();
        }
        expect(mocks.begin).not.toHaveBeenCalled();
        expect(mocks.updatePolicy).not.toHaveBeenCalled();
    });

    it('reproves a restrictive existing account only after Plugin marks migration recovery', async () => {
        const restrictive = {
            enableAllFolders: false,
            enabledFolders: [ 'dddddddddddddddddddddddddddddddd' ],
            isAdministrator: false,
            isDisabled: false,
            userId: USER_ID
        };
        mocks.current.mockResolvedValue(view({
            accessEpoch: null,
            controlledCreated: false,
            currentAccess: restrictive,
            held: true,
            migrationRecoveryRestricted: true,
            operationId: null,
            policyProven: false,
            state: 'unproven',
            writeAllowed: false
        }));
        mocks.begin.mockImplementation(async request => {
            calls.push('begin');
            return view({ held: true, operationId: request.operationId, policyProven: false, state: 'pending', writeAllowed: true });
        });
        mocks.complete.mockImplementation(async operationId => {
            calls.push('complete');
            return view({ operationId });
        });

        await expect(verifyUnprovenAdminUserAccess(api, USER_ID, restrictive)).resolves.toMatchObject({ policyProven: true });
        expect(calls).toEqual([ 'begin', 'policy', 'libraries', 'complete' ]);
        expect(mocks.begin.mock.calls[0][0]).toMatchObject({
            expectedAccess: restrictive,
            intendedAccess: restrictive,
            mode: 'reproof',
            userId: USER_ID
        });
    });

    it('uses controlled existing-user change before reproof when the recovered current policy is broad', async () => {
        const broad = {
            enableAllFolders: true,
            enabledFolders: [],
            isAdministrator: false,
            isDisabled: false,
            userId: USER_ID
        };
        const restrictive = { ...broad, enableAllFolders: false };
        mocks.current.mockResolvedValue(view({
            accessEpoch: null,
            controlledCreated: false,
            currentAccess: broad,
            held: true,
            migrationRecoveryRestricted: true,
            operationId: null,
            policyProven: false,
            state: 'unproven',
            writeAllowed: false
        }));
        mocks.begin.mockImplementation(async request => view({
            held: true, operationId: request.operationId, policyProven: false, state: 'pending', writeAllowed: true
        }));
        mocks.complete.mockImplementation(async operationId => view({ operationId }));

        await verifyUnprovenAdminUserAccess(api, USER_ID, restrictive);
        expect(mocks.begin.mock.calls[0][0]).toMatchObject({
            expectedAccess: broad,
            intendedAccess: restrictive,
            mode: 'existing'
        });
        expect(mocks.updatePolicy).toHaveBeenCalledOnce();
    });

    it('changes a late unverified broad account to explicit restrictive access before proving it', async () => {
        const broad = {
            enableAllFolders: true,
            enabledFolders: [],
            isAdministrator: false,
            isDisabled: false,
            userId: USER_ID
        };
        const restrictive = { ...broad, enableAllFolders: false };
        mocks.current.mockResolvedValue(view({
            accessEpoch: null,
            controlledCreated: false,
            currentAccess: broad,
            held: true,
            lateUnverified: true,
            migrationRecoveryRestricted: false,
            operationId: null,
            policyProven: false,
            state: 'unproven',
            writeAllowed: false
        }));
        mocks.begin.mockImplementation(async request => view({
            held: true, operationId: request.operationId, policyProven: false, state: 'pending', writeAllowed: true
        }));
        mocks.complete.mockImplementation(async operationId => view({ operationId }));

        await verifyUnprovenAdminUserAccess(api, USER_ID, restrictive);
        expect(mocks.begin.mock.calls[0][0]).toMatchObject({
            expectedAccess: broad,
            intendedAccess: restrictive,
            mode: 'existing'
        });
        expect(mocks.updatePolicy).toHaveBeenCalledOnce();
    });

    it('reproves an already-restrictive late account through a deliberate full write', async () => {
        const restrictive = {
            enableAllFolders: false,
            enabledFolders: [],
            isAdministrator: false,
            isDisabled: false,
            userId: USER_ID
        };
        mocks.current.mockResolvedValue(view({
            accessEpoch: null,
            controlledCreated: false,
            currentAccess: restrictive,
            held: true,
            lateUnverified: true,
            migrationRecoveryRestricted: false,
            operationId: null,
            policyProven: false,
            state: 'unproven',
            writeAllowed: false
        }));
        mocks.begin.mockImplementation(async request => view({
            held: true, operationId: request.operationId, policyProven: false, state: 'pending', writeAllowed: true
        }));
        mocks.complete.mockImplementation(async operationId => view({ operationId }));

        await verifyUnprovenAdminUserAccess(api, USER_ID, restrictive);
        expect(mocks.begin.mock.calls[0][0]).toMatchObject({
            expectedAccess: restrictive,
            intendedAccess: restrictive,
            mode: 'reproof'
        });
        expect(mocks.updatePolicy).toHaveBeenCalledOnce();
    });

    it('rejects broad or administrator policy reproof before stock writes', async () => {
        const currentAccess = {
            enableAllFolders: false,
            enabledFolders: [],
            isAdministrator: false,
            isDisabled: false,
            userId: USER_ID
        };
        mocks.current.mockResolvedValue(view({
            accessEpoch: null,
            controlledCreated: false,
            currentAccess,
            held: true,
            migrationRecoveryRestricted: true,
            operationId: null,
            policyProven: false,
            state: 'unproven',
            writeAllowed: false
        }));
        for (const intended of [
            { ...currentAccess, enableAllFolders: true },
            { ...currentAccess, isAdministrator: true }
        ]) {
            await expect(verifyUnprovenAdminUserAccess(api, USER_ID, intended)).rejects.toThrow();
        }
        expect(mocks.begin).not.toHaveBeenCalled();
        expect(mocks.updatePolicy).not.toHaveBeenCalled();
    });

    it('keeps a created ID across reload and directs a pending operation to administrator recovery', async () => {
        savePendingNewAdminUser('server-a', pending());
        expect(readPendingNewAdminUser('server-a')).toEqual(pending());
        mocks.current.mockResolvedValue(view({ held: true, policyProven: false, state: 'pending' }));

        await expect(resumePendingNewAdminUser(api, readPendingNewAdminUser('server-a')!)).rejects.toThrow();

        expect(mocks.current).toHaveBeenCalledWith(USER_ID);
        expect(mocks.complete).not.toHaveBeenCalled();
        expect(mocks.updatePolicy).not.toHaveBeenCalled();
        expect(mocks.updateLibraries).not.toHaveBeenCalled();
        clearPendingNewAdminUser('server-a', USER_ID);
        expect(readPendingNewAdminUser('server-a')).toBeNull();
    });

    it('keeps a pending bootstrap held after an uncertain stock policy write', async () => {
        mocks.updatePolicy.mockRejectedValueOnce(new Error('stock write response lost'));
        await expect(bootstrapNewAdminUser(api, pending())).rejects.toThrow('stock write response lost');
        mocks.current.mockResolvedValue(view({ held: true, policyProven: false, state: 'pending' }));

        await expect(resumePendingNewAdminUser(api, pending())).rejects.toThrow();

        expect(mocks.complete).not.toHaveBeenCalled();
    });

    it('starts the saved bootstrap on explicit retry when Plugin reports no operation for the created ID', async () => {
        mocks.current.mockResolvedValue(view({
            accessEpoch: null,
            held: true,
            operationId: null,
            policyProven: false,
            state: 'unproven'
        }));

        await expect(resumePendingNewAdminUser(api, pending())).resolves.toEqual(view());
        expect(calls).toEqual([ 'bind', 'begin', 'policy', 'libraries', 'complete' ]);
    });

    it('clears a stale browser hint after Plugin proves an explicit successor recovery operation', async () => {
        const successorOperation = 'dddddddddddddddddddddddddddddddd';
        const successor = view({
            operationId: successorOperation,
            supersededOperationId: OPERATION_ID
        });
        mocks.current.mockResolvedValue(successor);

        await expect(resumePendingNewAdminUser(api, pending())).resolves.toEqual(successor);
        expect(mocks.begin).not.toHaveBeenCalled();
        expect(mocks.complete).not.toHaveBeenCalled();
        expect(mocks.updatePolicy).not.toHaveBeenCalled();
    });

    it('rejects mismatched, held or unproven Complete responses', async () => {
        for (const invalid of [
            { operationId: 'dddddddddddddddddddddddddddddddd' },
            { userId: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' },
            { held: true },
            { policyProven: false },
            { accessEpoch: 'bad' }
        ]) {
            mocks.complete.mockResolvedValueOnce(view(invalid));
            await expect(bootstrapNewAdminUser(api, pending())).rejects.toThrow();
        }
        expect(mocks.updatePolicy).toHaveBeenCalledTimes(5);
    });

    it('accepts Plugin D-format GUID readback and normalizes a Jellyfin D-format created ID', async () => {
        const created = createPendingNewAdminUser({
            administrator: false,
            allLibraries: true,
            creationOperationId: CREATION_ID,
            id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            selectedFolderIds: [],
            username: 'Nova'
        });
        expect(created.id).toBe(USER_ID);
        mocks.begin.mockImplementation(async request => view({
            held: true,
            operationId: `${request.operationId.slice(0, 8)}-${request.operationId.slice(8, 12)}-${request.operationId.slice(12, 16)}-${request.operationId.slice(16, 20)}-${request.operationId.slice(20)}`,
            policyProven: false,
            state: 'pending',
            userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
            writeAllowed: true
        }));
        mocks.complete.mockImplementation(async operationId => view({
            operationId: `${operationId.slice(0, 8)}-${operationId.slice(8, 12)}-${operationId.slice(12, 16)}-${operationId.slice(16, 20)}-${operationId.slice(20)}`,
            userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
        }));

        await expect(bootstrapNewAdminUser(api, created)).resolves.toMatchObject({ state: 'policy-attested' });
    });

    it('normalizes selected CollectionFolder IDs before Plugin intent and stock writes', async () => {
        const folderId = 'dddddddddddddddddddddddddddddddd';
        const created = createPendingNewAdminUser({
            administrator: true,
            allLibraries: false,
            creationOperationId: CREATION_ID,
            id: USER_ID,
            selectedFolderIds: [ 'dddddddd-dddd-dddd-dddd-dddddddddddd' ],
            username: 'Nova'
        });
        expect(created.selectedFolderIds).toEqual([ folderId ]);
        mocks.begin.mockImplementation(async request => view({
            held: true,
            operationId: request.operationId,
            policyProven: false,
            state: 'pending',
            writeAllowed: true
        }));
        mocks.complete.mockImplementation(async operationId => view({ operationId }));
        await bootstrapNewAdminUser(api, created);
        expect(mocks.begin.mock.calls[0][0].intendedAccess.enabledFolders).toEqual([ folderId ]);
        expect(mocks.updateLibraries).toHaveBeenCalledWith(api, USER_ID, {
            mode: 'selected', selectedFolderIds: [ folderId ]
        });
        expect(() => createPendingNewAdminUser({
            ...created,
            selectedFolderIds: [ folderId, 'dddddddd-dddd-dddd-dddd-dddddddddddd' ]
        })).toThrow();
        expect(() => createPendingNewAdminUser({ ...created, selectedFolderIds: [ 'not-a-guid' ] })).toThrow();
    });

    it('explicitly supersedes a held operation from fresh Plugin current and writes only after new Begin', async () => {
        const currentAccess = {
            enableAllFolders: true,
            enabledFolders: [],
            isAdministrator: false,
            isDisabled: false,
            userId: USER_ID
        };
        const intendedAccess = {
            ...currentAccess,
            enableAllFolders: false,
            enabledFolders: [ 'dddddddddddddddddddddddddddddddd' ],
            isAdministrator: true
        };
        mocks.current.mockResolvedValue(view({
            currentAccess,
            held: true,
            intendedAccess,
            policyProven: false,
            state: 'failed'
        }));
        mocks.begin.mockImplementation(async request => {
            calls.push('begin');
            return view({
                held: true,
                operationId: request.operationId,
                policyProven: false,
                state: 'pending',
                writeAllowed: true
            });
        });
        mocks.complete.mockImplementation(async operationId => {
            calls.push('complete');
            return view({ operationId });
        });

        const result = await supersedeHeldAdminUserAccess(api, USER_ID);
        expect(result.state).toBe('policy-attested');
        expect(calls).toEqual([ 'begin', 'policy', 'libraries', 'complete' ]);
        expect(mocks.begin.mock.calls[0][0]).toMatchObject({
            expectedAccess: currentAccess,
            intendedAccess,
            mode: 'existing',
            supersedesOperationId: OPERATION_ID,
            userId: USER_ID
        });
        expect(mocks.begin.mock.calls[0][0].operationId).not.toBe(OPERATION_ID);
        expect(mocks.updatePolicy).toHaveBeenCalledWith(api, USER_ID, { IsAdministrator: true, IsDisabled: false });
        expect(mocks.updateLibraries).toHaveBeenCalledWith(api, USER_ID, {
            mode: 'selected', selectedFolderIds: intendedAccess.enabledFolders
        });
    });

    it('does not write when superseding Begin is a replay or Plugin intent is unavailable', async () => {
        const access = {
            enableAllFolders: true,
            enabledFolders: [],
            isAdministrator: false,
            isDisabled: false,
            userId: USER_ID
        };
        mocks.current.mockResolvedValue(view({
            currentAccess: access,
            held: true,
            intendedAccess: access,
            policyProven: false,
            state: 'failed'
        }));
        mocks.begin.mockImplementation(async request => view({
            held: true,
            operationId: request.operationId,
            policyProven: false,
            state: 'pending',
            writeAllowed: false
        }));
        await expect(supersedeHeldAdminUserAccess(api, USER_ID)).rejects.toThrow();
        expect(mocks.updatePolicy).not.toHaveBeenCalled();
        expect(mocks.updateLibraries).not.toHaveBeenCalled();

        mocks.current.mockResolvedValue(view({
            currentAccess: null,
            held: true,
            intendedAccess: access,
            policyProven: false,
            state: 'failed'
        }));
        await expect(supersedeHeldAdminUserAccess(api, USER_ID)).rejects.toThrow();
        expect(mocks.begin).toHaveBeenCalledOnce();
    });

    it('persists an unbound creation hint and verifies reservation before stock creation', async () => {
        const creation = createPendingNewAdminCreation({
            administrator: false,
            allLibraries: true,
            selectedFolderIds: [],
            username: 'Nova'
        });
        savePendingNewAdminCreation('server-a', creation);
        expect(readPendingNewAdminCreation('server-a')).toEqual(creation);

        await expect(reserveNewAdminUserCreation(api, creation)).resolves.toMatchObject({ state: 'reserved' });
        expect(mocks.reserve).toHaveBeenCalledWith({ creationOperationId: creation.creationOperationId });
        clearPendingNewAdminCreation('server-a', creation.creationOperationId);
        expect(readPendingNewAdminCreation('server-a')).toBeNull();
    });

    it('refuses policy writes when the Plugin does not confirm binding the created ID', async () => {
        mocks.bind.mockResolvedValue({
            bootstrapRequired: false,
            creationOperationId: CREATION_ID,
            migrationVerificationHeld: true,
            state: 'reserved',
            userId: null,
            version: 1
        });

        await expect(bootstrapNewAdminUser(api, pending())).rejects.toThrow();
        expect(mocks.begin).not.toHaveBeenCalled();
        expect(mocks.updatePolicy).not.toHaveBeenCalled();
        expect(mocks.updateLibraries).not.toHaveBeenCalled();
    });
});
