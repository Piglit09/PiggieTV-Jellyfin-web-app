import type { Api } from '@jellyfin/sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* eslint-disable @typescript-eslint/naming-convention */

const mocks = vi.hoisted(() => ({
    begin: vi.fn(),
    bind: vi.fn(),
    complete: vi.fn(),
    create: vi.fn(),
    getCreations: vi.fn(),
    libraries: vi.fn(),
    matchesSdkApi: vi.fn(),
    reserve: vi.fn(),
    updateLibraries: vi.fn(),
    updatePolicy: vi.fn()
}));

vi.mock('../../../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: () => ({
        beginHomeUserAccess: mocks.begin,
        bindHomeUserCreation: mocks.bind,
        completeHomeUserAccess: mocks.complete,
        getCurrentHomeUserCreations: mocks.getCreations,
        matchesSdkApi: mocks.matchesSdkApi,
        reserveHomeUserCreation: mocks.reserve
    })
}));

vi.mock('./adminUsersService', () => ({
    AdminUsersServiceError: class AdminUsersServiceError extends Error {},
    createAdminUser: mocks.create,
    loadAdminUserLibraries: mocks.libraries,
    updateAdminUserLibraryAccess: mocks.updateLibraries,
    updateAdminUserPassword: vi.fn(),
    updateNewAdminUserPolicy: mocks.updatePolicy
}));

vi.mock('@mui/material/Dialog/Dialog', () => ({
    default: ({ children, open }: Readonly<{ children: React.ReactNode; open: boolean }>) =>
        open ? <div role='dialog'>{children}</div> : null
}));
vi.mock('@mui/material/DialogActions/DialogActions', () => ({
    default: ({ children }: Readonly<{ children: React.ReactNode }>) => <div>{children}</div>
}));
vi.mock('@mui/material/DialogContent/DialogContent', () => ({
    default: ({ children }: Readonly<{ children: React.ReactNode }>) => <div>{children}</div>
}));
vi.mock('@mui/material/DialogTitle/DialogTitle', () => ({
    default: ({ children, id }: Readonly<{ children: React.ReactNode; id?: string }>) => <h2 id={id}>{children}</h2>
}));
vi.mock('../../../../../components/ConfirmDialog', () => ({
    default: () => null
}));

import { AddAdminUserDialog } from './AdminUserDialogs';
import {
    createPendingNewAdminCreation,
    readPendingNewAdminCreation,
    readPendingNewAdminUser,
    savePendingNewAdminCreation
} from './adminNewUserBootstrapService';
import PtvAdminCreationRecovery from './PtvAdminCreationRecovery';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const userId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const moviesId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const booksId = 'cccccccccccccccccccccccccccccccc';
const api = {} as Api;
const apiClient = { serverId: () => 'server-a' } as unknown as ApiClient;

function changeInput(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function flushAsync() {
    await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
        await Promise.resolve();
    });
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(done => {
        resolve = done;
    });
    return { promise, resolve };
}

function failStorageWrite(shouldFail: (key: string, value: string) => boolean) {
    const original = Storage.prototype.setItem;
    return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
        if (shouldFail(key, value)) throw new Error('private storage failure');
        original.call(this, key, value);
    });
}

describe('Add User creation reservation and library policy', () => {
    let container: HTMLDivElement;
    let queryClient: QueryClient;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mocks.matchesSdkApi.mockReturnValue(true);
        mocks.libraries.mockResolvedValue([
            { Id: moviesId, Name: 'Movies' },
            { Id: booksId, Name: 'Books' }
        ]);
        mocks.reserve.mockImplementation(async request => ({
            bootstrapRequired: false,
            creationOperationId: request.creationOperationId,
            migrationVerificationHeld: true,
            state: 'reserved',
            version: 1
        }));
        mocks.create.mockResolvedValue({ Id: userId, Name: 'Limited' });
        mocks.getCreations.mockResolvedValue({ pending: [], pendingCount: 0 });
        mocks.bind.mockImplementation(async (creationOperationId, request) => ({
            bootstrapRequired: true,
            creationOperationId,
            migrationVerificationHeld: false,
            state: 'bound',
            userId: request.userId,
            version: 1
        }));
        mocks.begin.mockImplementation(async request => ({
            accessEpoch: 'd'.repeat(64),
            held: true,
            operationId: request.operationId,
            policyProven: false,
            state: 'pending',
            userId,
            version: 1,
            writeAllowed: true
        }));
        mocks.complete.mockImplementation(async operationId => ({
            accessEpoch: 'd'.repeat(64),
            held: false,
            operationId,
            policyProven: true,
            state: 'policy-attested',
            userId,
            version: 1,
            writeAllowed: false
        }));
        mocks.updatePolicy.mockResolvedValue(undefined);
        mocks.updateLibraries.mockResolvedValue(undefined);
        queryClient = new QueryClient({
            defaultOptions: { queries: { gcTime: Infinity, retry: false } }
        });
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        queryClient.clear();
        container.remove();
    });

    function render(
        open = true,
        onReservationChanged?: () => void,
        onCreated = vi.fn(),
        activeApi = api,
        activeApiClient = apiClient,
        adminUserId = 'admin-a'
    ) {
        return act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <AddAdminUserDialog adminUserId={adminUserId} api={activeApi} apiClient={activeApiClient} onClose={vi.fn()} onCreated={onCreated} onReservationChanged={onReservationChanged} open={open} />
                </MemoryRouter>
            </QueryClientProvider>
        ));
    }

    function renderRecovery() {
        return act(async () => root.render(
            <MemoryRouter>
                <PtvAdminCreationRecovery api={api} apiClient={apiClient} users={[]} />
            </MemoryRouter>
        ));
    }

    async function submit() {
        await act(async () => {
            container.querySelector('#ptv-add-user-form')?.dispatchEvent(
                new Event('submit', { bubbles: true, cancelable: true })
            );
            await Promise.resolve();
        });
        await flushAsync();
    }

    it('treats a rejected reservation as uncertain, retains its hint, and never starts stock Create', async () => {
        mocks.reserve.mockRejectedValueOnce(new Error('reservation response lost'));
        await render();
        await flushAsync();
        await act(async () => changeInput(container.querySelector<HTMLInputElement>('#ptv-add-user-form input:not([type])')!, 'Limited'));
        await submit();

        expect(mocks.reserve).toHaveBeenCalledOnce();
        expect(mocks.create).not.toHaveBeenCalled();
        const savedReservation = readPendingNewAdminCreation('server-a');
        expect(savedReservation).toMatchObject({ username: 'Limited' });
        expect(container.textContent).toContain('The Plugin did not confirm the creation reservation');
        expect(container.textContent).toContain('outcome is unknown');
        expect(container.textContent).toContain('No account creation was started');

        await renderRecovery();
        await flushAsync();
        expect(mocks.getCreations).toHaveBeenCalledOnce();
        expect(readPendingNewAdminCreation('server-a')).toEqual(savedReservation);

        await render(false);
        await render();
        await flushAsync();
        expect(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Create User')?.disabled).toBe(true);
        expect(container.textContent).toContain('creation request for Limited is unresolved');
        expect(container.textContent).not.toContain('reservation for Limited remains active');
        await submit();
        expect(readPendingNewAdminCreation('server-a')).toEqual(savedReservation);
        expect(mocks.reserve).toHaveBeenCalledOnce();
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it('sends only the selected library policy through restricted account bootstrap', async () => {
        await render();
        await flushAsync();
        await act(async () => {
            changeInput(container.querySelector<HTMLInputElement>('#ptv-add-user-form input:not([type])')!, 'Limited');
            container.querySelectorAll<HTMLInputElement>('input[name="new-user-library-access"]')[1].click();
            const movie = Array.from(container.querySelectorAll('label'))
                .find(label => label.textContent?.includes('Movies'))?.querySelector<HTMLInputElement>('input');
            movie?.click();
        });
        await submit();

        expect(mocks.reserve).toHaveBeenCalledOnce();
        expect(mocks.create).toHaveBeenCalledOnce();
        expect(mocks.begin.mock.calls[0][0].intendedAccess).toEqual({
            enableAllFolders: false,
            enabledFolders: [ moviesId ],
            isAdministrator: false,
            isDisabled: false,
            userId
        });
        expect(mocks.updateLibraries).toHaveBeenCalledWith(api, userId, {
            mode: 'selected', selectedFolderIds: [ moviesId ]
        });
        expect(mocks.complete).toHaveBeenCalledOnce();
    });

    it('shows creation, permission, and Home progress until the verified account is complete', async () => {
        const reservation = deferred();
        const creation = deferred();
        const permissions = deferred();
        const homeProof = deferred();
        const onCreated = vi.fn();
        mocks.reserve.mockImplementationOnce(async request => {
            await reservation.promise;
            return {
                bootstrapRequired: false,
                creationOperationId: request.creationOperationId,
                migrationVerificationHeld: true,
                state: 'reserved',
                version: 1
            };
        });
        mocks.create.mockImplementationOnce(async () => {
            await creation.promise;
            return { Id: userId, Name: 'Limited' };
        });
        mocks.updatePolicy.mockImplementationOnce(async () => {
            await permissions.promise;
        });
        mocks.complete.mockImplementationOnce(async operationId => {
            await homeProof.promise;
            return {
                accessEpoch: 'd'.repeat(64),
                held: false,
                operationId,
                policyProven: true,
                state: 'policy-attested',
                userId,
                version: 1,
                writeAllowed: false
            };
        });

        await render(true, undefined, onCreated);
        await flushAsync();
        await act(async () => changeInput(container.querySelector<HTMLInputElement>('#ptv-add-user-form input:not([type])')!, 'Limited'));
        await act(async () => {
            container.querySelector('#ptv-add-user-form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            await Promise.resolve();
        });
        expect(container.textContent).toMatch(/reserving.*creation/i);
        expect(mocks.create).not.toHaveBeenCalled();

        await act(async () => {
            reservation.resolve();
            await reservation.promise;
        });
        await flushAsync();
        expect(container.textContent).toMatch(/reservation created/i);
        expect(container.textContent).toMatch(/creating Jellyfin account/i);
        expect(readPendingNewAdminCreation('server-a')?.stage).toBe('create-started');

        await act(async () => {
            creation.resolve();
            await creation.promise;
        });
        await flushAsync();
        expect(container.textContent).toMatch(/applying permissions/i);

        await act(async () => {
            permissions.resolve();
            await permissions.promise;
        });
        await flushAsync();
        expect(container.textContent).toMatch(/configuring Home access/i);

        await act(async () => {
            homeProof.resolve();
            await homeProof.promise;
        });
        await flushAsync();
        expect(onCreated).toHaveBeenCalledExactlyOnceWith(userId);
        expect(readPendingNewAdminCreation('server-a')).toBeNull();
    });

    it.each([ 'create', 'permissions', 'home-proof' ] as const)(
        'identifies a failed %s phase and keeps the correct recovery identity',
        async phase => {
            const privateFailure = new Error('private backend details');
            if (phase === 'create') mocks.create.mockRejectedValueOnce(privateFailure);
            else if (phase === 'permissions') mocks.updatePolicy.mockRejectedValueOnce(privateFailure);
            else mocks.complete.mockRejectedValueOnce(privateFailure);

            await render();
            await flushAsync();
            await act(async () => changeInput(container.querySelector<HTMLInputElement>('#ptv-add-user-form input:not([type])')!, 'Limited'));
            await submit();

            const error = container.querySelector('.ptv-admin-user-status-message.is-error')?.textContent || '';
            expect(error).toMatch(/failed.*recovery required/i);
            const phasePattern = {
                create: /creating Jellyfin account/i,
                permissions: /applying permissions/i,
                'home-proof': /configuring Home access/i
            }[phase];
            expect(error).toMatch(phasePattern);
            expect(error).not.toContain('private backend details');
            expect(readPendingNewAdminCreation('server-a')?.stage).toBe('create-started');
            expect(readPendingNewAdminUser('server-a')?.id || null).toBe(phase === 'create' ? null : userId);
        }
    );

    it('reports a saved-stage failure before Jellyfin Create without losing the reservation hint', async () => {
        let creationWrites = 0;
        const storageWrite = failStorageWrite(key => {
            if (key !== 'ptv-admin-new-user-creation:server-a') return false;
            creationWrites++;
            return creationWrites === 2;
        });
        try {
            await render();
            await flushAsync();
            await act(async () => changeInput(container.querySelector<HTMLInputElement>('#ptv-add-user-form input:not([type])')!, 'Limited'));
            await submit();

            const error = container.querySelector('.ptv-admin-user-status-message.is-error')?.textContent || '';
            expect(error).toMatch(/failed.*recovery required/i);
            expect(error).toMatch(/before.*Jellyfin account creation/i);
            expect(error).not.toContain('private storage failure');
            expect(mocks.reserve).toHaveBeenCalledOnce();
            expect(mocks.create).not.toHaveBeenCalled();
            expect(readPendingNewAdminCreation('server-a')?.stage).toBe('prepared');

            await render(false);
            await render();
            await flushAsync();
            await submit();
            expect(mocks.create).not.toHaveBeenCalled();
        } finally {
            storageWrite.mockRestore();
        }
    });

    it('reports a confirmed Jellyfin ID when its recovery hint cannot be saved', async () => {
        const storageWrite = failStorageWrite(key => key === 'ptv-admin-new-user-bootstrap:server-a');
        try {
            await render();
            await flushAsync();
            await act(async () => changeInput(container.querySelector<HTMLInputElement>('#ptv-add-user-form input:not([type])')!, 'Limited'));
            await submit();

            const error = container.querySelector('.ptv-admin-user-status-message.is-error')?.textContent || '';
            expect(error).toMatch(/failed.*recovery required/i);
            expect(error).toMatch(/after Jellyfin confirmed/i);
            expect(error).toContain(userId);
            expect(error).not.toContain('private storage failure');
            expect(mocks.create).toHaveBeenCalledOnce();
            expect(mocks.bind).not.toHaveBeenCalled();
            expect(readPendingNewAdminCreation('server-a')?.stage).toBe('create-started');
            expect(readPendingNewAdminUser('server-a')).toBeNull();

            await render(false);
            await render();
            await flushAsync();
            await submit();
            expect(mocks.create).toHaveBeenCalledOnce();
            expect(readPendingNewAdminCreation('server-a')?.stage).toBe('create-started');
        } finally {
            storageWrite.mockRestore();
        }
    });

    it('shows a Jellyfin username conflict while retaining the confirmed reservation for review', async () => {
        const onCreated = vi.fn();
        mocks.create.mockRejectedValueOnce(Object.assign(new Error('private backend details'), { status: 409 }));

        await render(true, undefined, onCreated);
        await flushAsync();
        await act(async () => changeInput(container.querySelector<HTMLInputElement>('#ptv-add-user-form input:not([type])')!, 'Limited'));
        await submit();

        const error = container.querySelector('.ptv-admin-user-status-message.is-error')?.textContent || '';
        expect(error).toMatch(/username.*already in use/i);
        expect(error).toMatch(/recovery required/i);
        expect(error).not.toContain('private backend details');
        expect(readPendingNewAdminCreation('server-a')?.stage).toBe('create-started');
        expect(mocks.create).toHaveBeenCalledOnce();
        expect(onCreated).not.toHaveBeenCalled();

        await render(false);
        await render();
        await flushAsync();
        await submit();
        expect(mocks.create).toHaveBeenCalledOnce();
    });

    it('holds the sibling immediately and records Create start before invoking Jellyfin', async () => {
        const readsAtCallback: number[] = [];
        const onReservationChanged = vi.fn(() => {
            expect(readPendingNewAdminCreation('server-a')?.stage).toBe('prepared');
            readsAtCallback.push(mocks.reserve.mock.calls.length);
        });
        mocks.create.mockImplementation(async () => {
            expect(readPendingNewAdminCreation('server-a')?.stage).toBe('create-started');
            return { Id: userId, Name: 'Limited' };
        });

        await render(true, onReservationChanged);
        await flushAsync();
        await act(async () => changeInput(container.querySelector<HTMLInputElement>('#ptv-add-user-form input:not([type])')!, 'Limited'));
        await submit();

        expect(onReservationChanged).toHaveBeenCalledTimes(2);
        expect(readsAtCallback).toEqual([ 0, 1 ]);
        expect(mocks.reserve).toHaveBeenCalledOnce();
        expect(mocks.create).toHaveBeenCalledOnce();
    });

    it('allows only one reservation and Create while two submit events overlap', async () => {
        const reservation = deferred();
        mocks.reserve.mockImplementationOnce(async request => {
            await reservation.promise;
            return {
                bootstrapRequired: false,
                creationOperationId: request.creationOperationId,
                migrationVerificationHeld: true,
                state: 'reserved',
                version: 1
            };
        });

        await render();
        await flushAsync();
        await act(async () => changeInput(container.querySelector<HTMLInputElement>('#ptv-add-user-form input:not([type])')!, 'Limited'));
        await submit();
        await submit();

        expect(mocks.reserve).toHaveBeenCalledOnce();
        expect(mocks.create).not.toHaveBeenCalled();
        expect(readPendingNewAdminCreation('server-a')?.stage).toBe('prepared');

        await act(async () => {
            reservation.resolve();
            await reservation.promise;
        });
        await flushAsync();

        expect(mocks.reserve).toHaveBeenCalledOnce();
        expect(mocks.create).toHaveBeenCalledOnce();
    });

    it('stops before Jellyfin Create when the active server changes during reservation', async () => {
        const reservation = deferred();
        const otherApi = {} as Api;
        const otherApiClient = { serverId: () => 'server-b' } as unknown as ApiClient;
        const onCreatedOriginal = vi.fn();
        const onCreatedOther = vi.fn();
        mocks.reserve.mockImplementationOnce(async request => {
            await reservation.promise;
            return {
                bootstrapRequired: false,
                creationOperationId: request.creationOperationId,
                migrationVerificationHeld: true,
                state: 'reserved',
                version: 1
            };
        });
        await render(true, undefined, onCreatedOriginal);
        await flushAsync();
        await act(async () => changeInput(container.querySelector<HTMLInputElement>('#ptv-add-user-form input:not([type])')!, 'Limited'));
        await submit();
        expect(readPendingNewAdminCreation('server-a')?.stage).toBe('prepared');
        expect(readPendingNewAdminCreation('server-b')).toBeNull();

        await render(true, undefined, onCreatedOther, otherApi, otherApiClient);
        await flushAsync();
        await act(async () => {
            reservation.resolve();
            await reservation.promise;
        });
        await flushAsync();

        expect(mocks.create).not.toHaveBeenCalled();
        expect(readPendingNewAdminCreation('server-a')?.stage).toBe('prepared');
        expect(readPendingNewAdminCreation('server-b')).toBeNull();
        expect(readPendingNewAdminUser('server-b')).toBeNull();
        expect(mocks.bind).not.toHaveBeenCalled();
        expect(onCreatedOriginal).not.toHaveBeenCalled();
        expect(onCreatedOther).not.toHaveBeenCalled();
        expect(container.textContent).not.toContain('Limited was created');
    });

    it('stops before Jellyfin Create when the authenticated Plugin session changes during reservation', async () => {
        const reservation = deferred();
        mocks.reserve.mockImplementationOnce(async request => {
            await reservation.promise;
            return {
                bootstrapRequired: false,
                creationOperationId: request.creationOperationId,
                migrationVerificationHeld: true,
                state: 'reserved',
                version: 1
            };
        });

        await render();
        await flushAsync();
        await act(async () => changeInput(container.querySelector<HTMLInputElement>('#ptv-add-user-form input:not([type])')!, 'Limited'));
        await submit();
        mocks.matchesSdkApi.mockReturnValue(false);
        await act(async () => {
            reservation.resolve();
            await reservation.promise;
        });
        await flushAsync();

        expect(mocks.create).not.toHaveBeenCalled();
        expect(readPendingNewAdminCreation('server-a')?.stage).toBe('prepared');
        expect(mocks.bind).not.toHaveBeenCalled();
    });

    it('does not navigate to the created account when the Plugin session changes during Home proof', async () => {
        const homeProof = deferred();
        const onCreated = vi.fn();
        mocks.complete.mockImplementationOnce(async operationId => {
            await homeProof.promise;
            return {
                accessEpoch: 'd'.repeat(64),
                held: false,
                operationId,
                policyProven: true,
                state: 'policy-attested',
                userId,
                version: 1,
                writeAllowed: false
            };
        });

        await render(true, undefined, onCreated);
        await flushAsync();
        await act(async () => changeInput(container.querySelector<HTMLInputElement>('#ptv-add-user-form input:not([type])')!, 'Limited'));
        await submit();
        expect(mocks.complete).toHaveBeenCalledOnce();
        mocks.matchesSdkApi.mockReturnValue(false);
        await act(async () => {
            homeProof.resolve();
            await homeProof.promise;
        });
        await flushAsync();

        expect(onCreated).not.toHaveBeenCalled();
    });

    it('keeps the account held for recovery when the Plugin session changes during bootstrap begin', async () => {
        const begin = deferred();
        mocks.begin.mockImplementationOnce(async request => {
            await begin.promise;
            return {
                accessEpoch: 'd'.repeat(64),
                held: true,
                operationId: request.operationId,
                policyProven: false,
                state: 'pending',
                userId,
                version: 1,
                writeAllowed: true
            };
        });

        await render();
        await flushAsync();
        await act(async () => changeInput(container.querySelector<HTMLInputElement>('#ptv-add-user-form input:not([type])')!, 'Limited'));
        await submit();
        expect(mocks.begin).toHaveBeenCalledOnce();
        mocks.matchesSdkApi.mockReturnValue(false);
        await act(async () => {
            begin.resolve();
            await begin.promise;
        });
        await flushAsync();

        expect(mocks.updatePolicy).not.toHaveBeenCalled();
        expect(mocks.updateLibraries).not.toHaveBeenCalled();
        expect(mocks.complete).not.toHaveBeenCalled();
        expect(readPendingNewAdminUser('server-a')?.id).toBe(userId);
    });

    it('writes selected libraries before enabling the account and stops after a session change', async () => {
        mocks.updateLibraries.mockImplementationOnce(async () => {
            mocks.matchesSdkApi.mockReturnValue(false);
        });

        await render();
        await flushAsync();
        await act(async () => {
            changeInput(container.querySelector<HTMLInputElement>('#ptv-add-user-form input:not([type])')!, 'Limited');
            container.querySelectorAll<HTMLInputElement>('input[name="new-user-library-access"]')[1].click();
            const movie = Array.from(container.querySelectorAll('label'))
                .find(label => label.textContent?.includes('Movies'))?.querySelector<HTMLInputElement>('input');
            movie?.click();
        });
        await submit();

        expect(mocks.updateLibraries).toHaveBeenCalledWith(api, userId, {
            mode: 'selected', selectedFolderIds: [ moviesId ]
        });
        expect(mocks.updatePolicy).not.toHaveBeenCalled();
        expect(mocks.complete).not.toHaveBeenCalled();
        expect(readPendingNewAdminUser('server-a')?.id).toBe(userId);
    });

    it('stops before Jellyfin Create when the authenticated administrator changes on the same server', async () => {
        const reservation = deferred();
        const onCreatedA = vi.fn();
        const onCreatedB = vi.fn();
        mocks.reserve.mockImplementationOnce(async request => {
            await reservation.promise;
            return {
                bootstrapRequired: false,
                creationOperationId: request.creationOperationId,
                migrationVerificationHeld: true,
                state: 'reserved',
                version: 1
            };
        });

        await render(true, undefined, onCreatedA);
        await flushAsync();
        await act(async () => changeInput(container.querySelector<HTMLInputElement>('#ptv-add-user-form input:not([type])')!, 'Limited'));
        await submit();
        expect(readPendingNewAdminCreation('server-a')?.stage).toBe('prepared');

        await render(true, undefined, onCreatedB, api, apiClient, 'admin-b');
        await flushAsync();
        await act(async () => {
            reservation.resolve();
            await reservation.promise;
        });
        await flushAsync();

        expect(mocks.create).not.toHaveBeenCalled();
        expect(readPendingNewAdminCreation('server-a')?.stage).toBe('prepared');
        expect(mocks.bind).not.toHaveBeenCalled();
        expect(onCreatedA).not.toHaveBeenCalled();
        expect(onCreatedB).not.toHaveBeenCalled();
        expect(container.textContent).not.toContain('Limited was created');
    });

    it('keeps server B busy when server A reserve finishes before server B reserve', async () => {
        const reservationA = deferred();
        const reservationB = deferred();
        const otherApi = {} as Api;
        const otherApiClient = { serverId: () => 'server-b' } as unknown as ApiClient;
        const onCreatedA = vi.fn();
        const onCreatedB = vi.fn();
        mocks.reserve
            .mockImplementationOnce(async request => {
                await reservationA.promise;
                return {
                    bootstrapRequired: false, creationOperationId: request.creationOperationId,
                    migrationVerificationHeld: true, state: 'reserved', version: 1
                };
            })
            .mockImplementationOnce(async request => {
                await reservationB.promise;
                return {
                    bootstrapRequired: false, creationOperationId: request.creationOperationId,
                    migrationVerificationHeld: true, state: 'reserved', version: 1
                };
            });

        await render(true, undefined, onCreatedA);
        await flushAsync();
        await act(async () => changeInput(container.querySelector<HTMLInputElement>('#ptv-add-user-form input:not([type])')!, 'Alpha'));
        await submit();
        expect(mocks.reserve).toHaveBeenCalledOnce();

        await render(true, undefined, onCreatedB, otherApi, otherApiClient);
        await flushAsync();
        await act(async () => changeInput(container.querySelector<HTMLInputElement>('#ptv-add-user-form input:not([type])')!, 'Beta'));
        await submit();
        expect(mocks.reserve).toHaveBeenCalledTimes(2);
        expect(readPendingNewAdminCreation('server-b')?.stage).toBe('prepared');

        await act(async () => {
            reservationA.resolve();
            await reservationA.promise;
        });
        await flushAsync();

        const submitButton = container.querySelector<HTMLButtonElement>('button[form="ptv-add-user-form"]');
        expect(submitButton?.disabled).toBe(true);
        expect(submitButton?.textContent).toBe('Saving…');
        await submit();
        expect(mocks.reserve).toHaveBeenCalledTimes(2);
        expect(mocks.create).not.toHaveBeenCalled();
        expect(readPendingNewAdminCreation('server-a')?.stage).toBe('prepared');
        expect(readPendingNewAdminCreation('server-b')?.stage).toBe('prepared');

        await act(async () => {
            reservationB.resolve();
            await reservationB.promise;
        });
        await flushAsync();

        expect(mocks.create).toHaveBeenCalledOnce();
        expect(mocks.create).toHaveBeenCalledWith(otherApi, { password: undefined, username: 'Beta' });
        expect(onCreatedA).not.toHaveBeenCalled();
        expect(onCreatedB).toHaveBeenCalledExactlyOnceWith(userId);
    });

    it('leaves the original reservation recoverable when the dialog unmounts during reserve', async () => {
        const reservation = deferred();
        const onCreated = vi.fn();
        mocks.reserve.mockImplementationOnce(async request => {
            await reservation.promise;
            return {
                bootstrapRequired: false,
                creationOperationId: request.creationOperationId,
                migrationVerificationHeld: true,
                state: 'reserved',
                version: 1
            };
        });

        await render(true, undefined, onCreated);
        await flushAsync();
        await act(async () => changeInput(container.querySelector<HTMLInputElement>('#ptv-add-user-form input:not([type])')!, 'Limited'));
        await submit();
        expect(readPendingNewAdminCreation('server-a')?.stage).toBe('prepared');

        await act(async () => root.render(<div>Another page</div>));
        await act(async () => {
            reservation.resolve();
            await reservation.promise;
        });
        await flushAsync();

        expect(mocks.create).not.toHaveBeenCalled();
        expect(readPendingNewAdminCreation('server-a')?.stage).toBe('prepared');
        expect(mocks.bind).not.toHaveBeenCalled();
        expect(onCreated).not.toHaveBeenCalled();
        expect(container.textContent).toBe('Another page');
    });

    it('retains the created ID without bootstrap or callbacks when unmounted during Jellyfin Create', async () => {
        const creation = deferred();
        const onCreated = vi.fn();
        mocks.create.mockImplementationOnce(async () => {
            await creation.promise;
            return { Id: userId, Name: 'Limited' };
        });

        await render(true, undefined, onCreated);
        await flushAsync();
        await act(async () => changeInput(container.querySelector<HTMLInputElement>('#ptv-add-user-form input:not([type])')!, 'Limited'));
        await submit();
        expect(mocks.create).toHaveBeenCalledOnce();
        expect(readPendingNewAdminCreation('server-a')?.stage).toBe('create-started');

        await act(async () => root.render(<div>Another page</div>));
        await act(async () => {
            creation.resolve();
            await creation.promise;
        });
        await flushAsync();

        expect(mocks.bind).not.toHaveBeenCalled();
        expect(mocks.begin).not.toHaveBeenCalled();
        expect(readPendingNewAdminCreation('server-a')?.stage).toBe('create-started');
        expect(readPendingNewAdminUser('server-a')?.id).toBe(userId);
        expect(onCreated).not.toHaveBeenCalled();
        expect(container.textContent).toBe('Another page');
    });

    it('blocks stock Create when a saved reservation appears after the dialog opens', async () => {
        await render();
        await flushAsync();
        const otherRequest = createPendingNewAdminCreation({
            administrator: false,
            allLibraries: false,
            selectedFolderIds: [ booksId ],
            username: 'Earlier request'
        });
        savePendingNewAdminCreation('server-a', otherRequest);

        await act(async () => changeInput(container.querySelector<HTMLInputElement>('#ptv-add-user-form input:not([type])')!, 'Limited'));
        await submit();

        expect(mocks.reserve).not.toHaveBeenCalled();
        expect(mocks.create).not.toHaveBeenCalled();
        expect(readPendingNewAdminCreation('server-a')).toEqual(otherRequest);
        expect(container.textContent).toContain('Earlier request');
    });
});

/* eslint-enable @typescript-eslint/naming-convention */
