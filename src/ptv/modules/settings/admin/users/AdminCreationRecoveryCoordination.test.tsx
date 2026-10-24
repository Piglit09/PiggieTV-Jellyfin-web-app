import type { Api } from '@jellyfin/sdk';
import type { ApiClient } from 'jellyfin-apiclient';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PtvAdminCreationRecovery from './PtvAdminCreationRecovery';
import PtvAdminUsersPage from './PtvAdminUsersPage';

const mocks = vi.hoisted(() => ({
    bind: vi.fn(),
    createBatch: vi.fn(),
    getBatch: vi.fn(),
    getCreations: vi.fn(),
    getOperationStatus: vi.fn(),
    getSummary: vi.fn(),
    recover: vi.fn(),
    reserve: vi.fn(),
    refreshUsers: vi.fn(async () => [])
}));

vi.mock('../../../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: () => ({
        bindHomeUserCreation: mocks.bind,
        createHomeUserVerificationBatch: mocks.createBatch,
        getCurrentHomeUserCreations: mocks.getCreations,
        getHomeUserCreationOperationStatus: mocks.getOperationStatus,
        getCurrentHomeUserVerificationBatch: mocks.getBatch,
        getHomeUserVerificationSummary: mocks.getSummary,
        matchesSdkApi: () => true,
        recoverHomeUserCreation: mocks.recover,
        reserveHomeUserCreation: mocks.reserve
    })
}));
vi.mock('../../../../../hooks/useApi', () => ({
    useApi: () => ({ __legacyApiClient__: { serverId: () => 'server-a' }, api: {} })
}));
vi.mock('./useAdminUsers', () => ({
    useAdminUsers: () => ({
        coreError: false,
        isInitialLoading: false,
        profileError: false,
        refresh: mocks.refreshUsers,
        sessionsError: false,
        users: []
    })
}));
vi.mock('../../../icons/PtvIcon', () => ({ default: () => <span /> }));
vi.mock('../../../../../components/ConfirmDialog', () => ({
    default: ({ onConfirm, open, title }: Readonly<{ onConfirm: () => void; open: boolean; title: string }>) =>
        open ? <div role='dialog'>{title}<button onClick={onConfirm} type='button'>Confirm action</button></div> : null
}));

// eslint-disable-next-line @typescript-eslint/naming-convention
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const reservationId = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const possibleUserId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const api = {} as Api;
const apiClient = { serverId: () => 'server-a' } as unknown as ApiClient;

function verificationSummary(pendingCreationReservations: number) {
    return {
        currentBatchId: null,
        held: true,
        legacyCohortStarted: false,
        migrationRecoveryRestricted: false,
        needsVerificationCount: 1,
        pendingCreationReservations,
        recoveryRequired: false,
        topologyEpoch: 'c'.repeat(64),
        totalCount: 1,
        verifiedCount: 0
    };
}

function pendingCreation(candidateNewUserIds: string[] = []) {
    return {
        pending: [ { candidateNewUserIds, creationOperationId: reservationId } ],
        pendingCount: 1
    };
}

function buttonWithText(node: ParentNode, label: string) {
    return Array.from(node.querySelectorAll('button')).find(button => button.textContent === label);
}

async function flushAsync() {
    await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
    });
}

describe('account creation recovery and verification coordination', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mocks.getBatch.mockRejectedValue({ status: 404 });
        mocks.getCreations.mockResolvedValue({ pending: [], pendingCount: 0 });
        mocks.getSummary.mockResolvedValue(verificationSummary(0));
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    async function render(children: React.ReactNode) {
        await act(async () => root.render(<MemoryRouter>{children}</MemoryRouter>));
        await flushAsync();
    }

    async function confirmRecovery() {
        await act(async () => buttonWithText(container, 'Mark creation request settled')?.click());
        await act(async () => {
            buttonWithText(container, 'Confirm action')?.click();
            await Promise.resolve();
        });
        await flushAsync();
    }

    it('holds batch creation while a reservation exists, then refreshes the sibling after recovery', async () => {
        mocks.getSummary
            .mockResolvedValueOnce(verificationSummary(1))
            .mockResolvedValueOnce(verificationSummary(0));
        mocks.getCreations
            .mockResolvedValueOnce(pendingCreation())
            .mockResolvedValueOnce({ pending: [], pendingCount: 0 });
        mocks.recover.mockResolvedValue({
            creationOperationId: reservationId,
            markedUserIds: [ possibleUserId ],
            state: 'recovered'
        });

        await render(<PtvAdminUsersPage />);
        expect(buttonWithText(container, 'Start verification batch')?.disabled).toBe(true);
        expect(container.textContent).toContain('creation reservation');
        expect(mocks.createBatch).not.toHaveBeenCalled();

        await confirmRecovery();
        expect(mocks.recover).toHaveBeenCalledOnce();
        expect(mocks.refreshUsers).toHaveBeenCalledOnce();
        expect(mocks.getSummary).toHaveBeenCalledTimes(2);
        expect(buttonWithText(container, 'Start verification batch')?.disabled).toBe(false);
        expect(container.querySelector(`a[href="/settings/admin/users/${possibleUserId}"]`)).not.toBeNull();
    });

    it('keeps a confirmed recovery clear when the subsequent status read fails and retries only the read', async () => {
        const onChanged = vi.fn();
        mocks.getCreations
            .mockResolvedValueOnce(pendingCreation())
            .mockRejectedValueOnce(new Error('read failed'))
            .mockResolvedValueOnce({ pending: [], pendingCount: 0 });
        mocks.recover.mockResolvedValue({
            creationOperationId: reservationId,
            markedUserIds: [],
            state: 'recovered'
        });

        await render(<PtvAdminCreationRecovery api={api} apiClient={apiClient} onChanged={onChanged} users={[]} />);
        await confirmRecovery();
        expect(onChanged).toHaveBeenCalledOnce();
        expect(container.textContent).toContain('settled request was recovered');
        expect(container.textContent).toContain('could not be refreshed');
        expect(container.textContent).not.toContain('reservation remains active');

        await act(async () => buttonWithText(container, 'Retry reservation status')?.click());
        await flushAsync();
        expect(mocks.getCreations).toHaveBeenCalledTimes(3);
        expect(mocks.recover).toHaveBeenCalledOnce();
    });

    it('keeps a confirmed binding clear when the subsequent status read fails', async () => {
        const onChanged = vi.fn();
        mocks.getCreations
            .mockResolvedValueOnce(pendingCreation([ possibleUserId ]))
            .mockRejectedValueOnce(new Error('read failed'));
        mocks.bind.mockResolvedValue({
            bootstrapRequired: true,
            creationOperationId: reservationId,
            migrationVerificationHeld: false,
            state: 'bound',
            userId: possibleUserId,
            version: 1
        });

        await render(<PtvAdminCreationRecovery api={api} apiClient={apiClient} onChanged={onChanged} users={[]} />);
        await act(async () => buttonWithText(container, 'Bind this account')?.click());
        await act(async () => {
            buttonWithText(container, 'Confirm action')?.click();
            await Promise.resolve();
        });
        await flushAsync();

        expect(onChanged).toHaveBeenCalledOnce();
        expect(container.textContent).toContain('was bound to controlled creation');
        expect(container.textContent).toContain('could not be refreshed');
        expect(container.textContent).not.toContain('Binding was not confirmed');
        expect(mocks.bind).toHaveBeenCalledOnce();
    });

    it('treats a rejected recovery response as uncertain until a fresh reservation read', async () => {
        mocks.getCreations
            .mockResolvedValueOnce(pendingCreation())
            .mockResolvedValueOnce(pendingCreation());
        mocks.recover.mockRejectedValue(new Error('connection lost'));

        await render(<PtvAdminCreationRecovery api={api} apiClient={apiClient} users={[]} />);
        await confirmRecovery();
        expect(container.textContent).toContain('outcome is unknown');
        expect(container.textContent).not.toContain('reservation remains active');
        expect(buttonWithText(container, 'Mark creation request settled')?.disabled).toBe(true);

        await act(async () => buttonWithText(container, 'Retry reservation status')?.click());
        await flushAsync();
        expect(mocks.getCreations).toHaveBeenCalledTimes(2);
        expect(mocks.recover).toHaveBeenCalledOnce();
        expect(buttonWithText(container, 'Mark creation request settled')?.disabled).toBe(false);
    });

    it('refreshes verification after an uncertain recovery is absent from a fresh pending list', async () => {
        mocks.getSummary
            .mockResolvedValueOnce(verificationSummary(1))
            .mockResolvedValueOnce(verificationSummary(0));
        mocks.getCreations
            .mockResolvedValueOnce(pendingCreation())
            .mockResolvedValueOnce({ pending: [], pendingCount: 0 });
        mocks.recover.mockRejectedValue(new Error('response lost'));

        await render(<PtvAdminUsersPage />);
        await confirmRecovery();
        expect(buttonWithText(container, 'Start verification batch')?.disabled).toBe(true);

        await act(async () => buttonWithText(container, 'Retry reservation status')?.click());
        await flushAsync();
        expect(mocks.getSummary).toHaveBeenCalledTimes(2);
        expect(buttonWithText(container, 'Start verification batch')?.disabled).toBe(false);
        expect(mocks.recover).toHaveBeenCalledOnce();
    });

    it('reconciles a local hint after another administrator bound the operation', async () => {
        const key = 'ptv-admin-new-user-creation:server-a';
        localStorage.setItem(key, JSON.stringify({
            administrator: false,
            allLibraries: true,
            creationOperationId: reservationId,
            selectedFolderIds: [],
            username: 'Nova'
        }));
        mocks.getOperationStatus.mockResolvedValue({
            version: 1,
            creationOperationId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
            state: 'bound',
            userId: possibleUserId,
            markedUserIds: []
        });

        await render(<PtvAdminCreationRecovery api={api} apiClient={apiClient} users={[]} />);
        expect(localStorage.getItem(key)).not.toBeNull();
        expect(container.textContent).toContain(reservationId);
        expect(buttonWithText(container, 'Check creation request')).toBeDefined();

        await act(async () => buttonWithText(container, 'Check creation request')?.click());
        await flushAsync();
        expect(mocks.getOperationStatus).toHaveBeenCalledWith(reservationId);
        expect(mocks.reserve).not.toHaveBeenCalled();
        expect(localStorage.getItem(key)).toBeNull();
        expect(container.textContent).toContain('Another administrator bound');
        expect(container.querySelector('a[href*="' + possibleUserId + '"]')).not.toBeNull();
    });

    it('keeps an unlisted local hint held when the operation-status read fails', async () => {
        const key = 'ptv-admin-new-user-creation:server-a';
        localStorage.setItem(key, JSON.stringify({
            administrator: false, allLibraries: true, creationOperationId: reservationId,
            selectedFolderIds: [], username: 'Nova'
        }));
        mocks.getOperationStatus.mockRejectedValue(new Error('Plugin unavailable'));

        await render(<PtvAdminCreationRecovery api={api} apiClient={apiClient} users={[]} />);
        await act(async () => buttonWithText(container, 'Check creation request')?.click());
        await flushAsync();

        expect(localStorage.getItem(key)).not.toBeNull();
        expect(container.textContent).toContain('creation hold remains');
        expect(mocks.reserve).not.toHaveBeenCalled();
    });

    it('shows affected account links when another administrator settled a request', async () => {
        const key = 'ptv-admin-new-user-creation:server-a';
        localStorage.setItem(key, JSON.stringify({
            administrator: false, allLibraries: true, creationOperationId: reservationId,
            selectedFolderIds: [], stage: 'create-started', username: 'Nova'
        }));
        mocks.getOperationStatus.mockResolvedValue({
            creationOperationId: reservationId, markedUserIds: [ possibleUserId ],
            state: 'recovered', userId: null, version: 1
        });

        await render(<PtvAdminCreationRecovery api={api} apiClient={apiClient} users={[]} />);
        await act(async () => buttonWithText(container, 'Check creation request')?.click());
        await flushAsync();

        expect(localStorage.getItem(key)).toBeNull();
        expect(container.textContent).toContain('Possible account from settled request');
        expect(container.querySelector(`a[href="/settings/admin/users/${possibleUserId}"]`)).not.toBeNull();
    });

    it('reloads the recovery list after a new reservation is created in the dialog', async () => {
        mocks.getCreations
            .mockResolvedValueOnce({ pending: [], pendingCount: 0 })
            .mockResolvedValueOnce(pendingCreation());

        await render(<PtvAdminCreationRecovery api={api} apiClient={apiClient} refreshRevision={0} users={[]} />);
        expect(buttonWithText(container, 'Mark creation request settled')).toBeUndefined();

        await render(<PtvAdminCreationRecovery api={api} apiClient={apiClient} refreshRevision={1} users={[]} />);
        expect(mocks.getCreations).toHaveBeenCalledTimes(2);
        expect(buttonWithText(container, 'Mark creation request settled')).toBeDefined();
    });

    it('holds verification for a locally prepared request and releases it only after Plugin confirms absence', async () => {
        const key = 'ptv-admin-new-user-creation:server-a';
        localStorage.setItem(key, JSON.stringify({
            administrator: false, allLibraries: true, creationOperationId: reservationId,
            selectedFolderIds: [], stage: 'prepared', username: 'Nova'
        }));
        mocks.getOperationStatus.mockResolvedValue({
            creationOperationId: reservationId, markedUserIds: [], state: 'absent',
            userId: null, version: 1
        });

        await render(<PtvAdminUsersPage />);
        expect(buttonWithText(container, 'Start verification batch')?.disabled).toBe(true);
        expect(container.textContent).toContain('Resolve the pending creation reservation or local request');

        await act(async () => buttonWithText(container, 'Check creation request')?.click());
        await flushAsync();

        expect(localStorage.getItem(key)).toBeNull();
        expect(buttonWithText(container, 'Start verification batch')?.disabled).toBe(false);
        expect(mocks.createBatch).not.toHaveBeenCalled();
    });

    it('offers the same reservation for a prepared request when no Plugin status can be read', async () => {
        const key = 'ptv-admin-new-user-creation:server-a';
        localStorage.setItem(key, JSON.stringify({
            administrator: false, allLibraries: false, creationOperationId: reservationId,
            selectedFolderIds: [ possibleUserId ], stage: 'prepared', username: 'Nova'
        }));
        mocks.getCreations
            .mockResolvedValueOnce({ pending: [], pendingCount: 0 })
            .mockResolvedValueOnce(pendingCreation());
        mocks.getOperationStatus.mockRejectedValue(new Error('No ledger file yet'));
        mocks.reserve.mockResolvedValue({
            bootstrapRequired: false, creationOperationId: reservationId,
            migrationVerificationHeld: true, state: 'reserved', userId: null, version: 1
        });

        await render(<PtvAdminCreationRecovery api={api} apiClient={apiClient} users={[]} />);
        await act(async () => buttonWithText(container, 'Check creation request')?.click());
        await flushAsync();

        expect(buttonWithText(container, 'Retry same reservation')).toBeDefined();
        expect(mocks.reserve).not.toHaveBeenCalled();
        expect(localStorage.getItem(key)).not.toBeNull();

        await act(async () => buttonWithText(container, 'Retry same reservation')?.click());
        await flushAsync();

        expect(mocks.reserve).toHaveBeenCalledWith({ creationOperationId: reservationId });
        expect(localStorage.getItem(key)).not.toBeNull();
        expect(container.textContent).toContain(`Reservation ${reservationId}`);
        expect(buttonWithText(container, 'Mark creation request settled')).toBeDefined();
    });

    it.each([ 'create-started', undefined ])('keeps a %s local hint held when Plugin reports absence', async stage => {
        const key = 'ptv-admin-new-user-creation:server-a';
        localStorage.setItem(key, JSON.stringify({
            administrator: false, allLibraries: true, creationOperationId: reservationId,
            selectedFolderIds: [], stage, username: 'Nova'
        }));
        mocks.getOperationStatus.mockResolvedValue({
            creationOperationId: reservationId, markedUserIds: [], state: 'absent',
            userId: null, version: 1
        });

        await render(<PtvAdminUsersPage />);
        expect(buttonWithText(container, 'Start verification batch')?.disabled).toBe(true);

        await act(async () => buttonWithText(container, 'Check creation request')?.click());
        await flushAsync();

        expect(localStorage.getItem(key)).not.toBeNull();
        expect(container.textContent).toContain('account creation may have started');
        expect(buttonWithText(container, 'Start verification batch')?.disabled).toBe(true);
    });
});
