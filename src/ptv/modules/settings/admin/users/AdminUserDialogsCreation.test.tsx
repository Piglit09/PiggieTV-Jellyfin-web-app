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
        matchesSdkApi: () => true,
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

describe('Add User creation reservation and library policy', () => {
    let container: HTMLDivElement;
    let queryClient: QueryClient;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mocks.libraries.mockResolvedValue([
            { Id: moviesId, Name: 'Movies' },
            { Id: booksId, Name: 'Books' }
        ]);
        mocks.reserve.mockImplementation(async request => ({
            bootstrapRequired: false,
            creationOperationId: request.creationOperationId,
            migrationVerificationHeld: true,
            state: 'reserved',
            userId: null,
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

    function render(open = true, onReservationChanged?: () => void) {
        return act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>
                    <AddAdminUserDialog api={api} apiClient={apiClient} onClose={vi.fn()} onCreated={vi.fn()} onReservationChanged={onReservationChanged} open={open} />
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
