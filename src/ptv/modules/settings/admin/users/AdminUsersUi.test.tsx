import type { Api } from '@jellyfin/sdk';
import type { UserDto, UserPolicy } from '@jellyfin/sdk/lib/generated-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* eslint-disable @stylistic/max-statements-per-line, @typescript-eslint/naming-convention, sonarjs/no-hardcoded-passwords */

import type {
    AdminUserDetail,
    AdminUserLibraryAccess,
    AdminUserSummary
} from './adminUsersModel';

const uiMocks = vi.hoisted(() => ({
    createAdminUser: vi.fn(),
    currentUser: { Id: 'admin-a', Name: 'Piggie' },
    deleteAdminUser: vi.fn(),
    loadAdminUserLibraries: vi.fn(),
    resetAdminUserPassword: vi.fn(),
    setAdminUserAdministrator: vi.fn(),
    setAdminUserEnabled: vi.fn(),
    updateAdminUserLibraryAccess: vi.fn(),
    updateAdminUserLibraryAccessFromBaseline: vi.fn(),
    updateAdminUserPassword: vi.fn(),
    updateAdminUserPlaybackPolicyFromBaseline: vi.fn(),
    updateAdminUserPolicy: vi.fn(),
    updateAdminUsername: vi.fn(),
    userState: null as unknown,
    usersState: null as unknown
}));

vi.mock('../../../../../hooks/useApi', () => ({
    useApi: () => ({
        __legacyApiClient__: { serverId: () => 'server-a' },
        api: {},
        user: uiMocks.currentUser
    })
}));

vi.mock('./useAdminUsers', () => ({
    useAdminUser: () => uiMocks.userState,
    useAdminUsers: () => uiMocks.usersState
}));

vi.mock('./adminUsersService', () => ({
    AdminUsersServiceError: class AdminUsersServiceError extends Error {
        public readonly code: string;

        public constructor(code: string, message: string) {
            super(message);
            this.code = code;
        }
    },
    captureAdminUserLibraryAccess: (policy?: UserPolicy) => (
        typeof policy?.EnableAllFolders === 'boolean' ? {
            enableAllFolders: policy.EnableAllFolders,
            enabledFolderIds: [ ...(policy.EnabledFolders || []) ]
        } : null
    ),
    captureAdminUserPlaybackPolicy: (policy?: UserPolicy) => {
        if (!policy) return null;
        const values = {
            EnableAudioPlaybackTranscoding: policy.EnableAudioPlaybackTranscoding,
            EnableContentDownloading: policy.EnableContentDownloading,
            EnableLiveTvAccess: policy.EnableLiveTvAccess,
            EnableMediaPlayback: policy.EnableMediaPlayback,
            EnablePlaybackRemuxing: policy.EnablePlaybackRemuxing,
            EnableRemoteAccess: policy.EnableRemoteAccess,
            EnableVideoPlaybackTranscoding: policy.EnableVideoPlaybackTranscoding
        };
        return Object.values(values).every(value => typeof value === 'boolean') ? values : null;
    },
    createAdminUser: uiMocks.createAdminUser,
    deleteAdminUser: uiMocks.deleteAdminUser,
    loadAdminUserLibraries: uiMocks.loadAdminUserLibraries,
    resetAdminUserPassword: uiMocks.resetAdminUserPassword,
    setAdminUserAdministrator: uiMocks.setAdminUserAdministrator,
    setAdminUserEnabled: uiMocks.setAdminUserEnabled,
    updateAdminUserLibraryAccess: uiMocks.updateAdminUserLibraryAccess,
    updateAdminUserLibraryAccessFromBaseline: uiMocks.updateAdminUserLibraryAccessFromBaseline,
    updateAdminUserPassword: uiMocks.updateAdminUserPassword,
    updateAdminUserPlaybackPolicyFromBaseline: uiMocks.updateAdminUserPlaybackPolicyFromBaseline,
    updateAdminUserPolicy: uiMocks.updateAdminUserPolicy,
    updateAdminUsername: uiMocks.updateAdminUsername
}));

vi.mock('../../../icons/PtvIcon', () => ({
    default: ({ name }: Readonly<{ name: string }>) => <span data-icon={name} />
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
    default: ({ onConfirm, open, title }: Readonly<{ onConfirm: () => void; open: boolean; title: string }>) =>
        open ? <div role='dialog'>{title}<button onClick={onConfirm} type='button'>Confirm action</button></div> : null
}));

vi.mock('react-router-dom', async importOriginal => {
    const actual = await importOriginal<typeof import('react-router-dom')>();
    return {
        ...actual,
        unstable_usePrompt: vi.fn()
    };
});

import {
    AddAdminUserDialog,
    AdminUserPasswordDialog
} from './AdminUserDialogs';
import { AdminUsersServiceError } from './adminUsersService';
import PtvAdminUserDetail from './PtvAdminUserDetail';
import PtvAdminUsersPage from './PtvAdminUsersPage';
import { formatAdminUserTime } from './AdminUserPresentation';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const api = {} as Api;
const apiClient = { serverId: () => 'server-a' } as unknown as ApiClient;

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
        id: 'member-a',
        isAdministrator: false,
        lastActivityAt: null,
        lastLoginAt: null,
        maskedEmail: null,
        profileSourceState: 'ready',
        role: 'member',
        sessionSourceState: 'ready',
        sessions: [],
        username: 'Alex',
        ...overrides
    };
}

function detail(overrides: Partial<AdminUserDetail> = {}): AdminUserDetail {
    return {
        ...summary({
            id: 'admin-a',
            isAdministrator: true,
            role: 'administrator',
            username: 'Piggie'
        }),
        contentPolicy: {
            accessScheduleCount: 0,
            allowedTagCount: 0,
            blockedTagCount: 0,
            blockedUnratedItemCount: 0,
            maxParentalRating: null
        },
        editablePlaybackPolicy: {
            allowAudioTranscoding: true,
            allowDownloads: true,
            allowLiveTv: true,
            allowMediaPlayback: true,
            allowRemoteAccess: true,
            allowRemuxing: true,
            allowVideoTranscoding: true
        },
        hasConfiguredPassword: true,
        hiddenFromLogin: false,
        invalidLoginAttemptCount: 0,
        playbackPolicy: {
            allowAudioTranscoding: true,
            allowDownloads: true,
            allowLiveTv: true,
            allowMediaPlayback: true,
            allowRemoteAccess: true,
            allowRemuxing: true,
            allowVideoTranscoding: true,
            maxActiveSessions: 0,
            remoteBitrateLimit: 0
        },
        policyAvailable: true,
        ...overrides
    };
}

function coreUser(policyOverrides: Partial<UserPolicy> = {}): UserDto {
    return {
        Id: 'admin-a',
        Name: 'Piggie',
        Policy: {
            AuthenticationProviderId: 'default-auth',
            EnableAllFolders: true,
            EnableAudioPlaybackTranscoding: true,
            EnableContentDownloading: true,
            EnableLiveTvAccess: true,
            EnableMediaPlayback: true,
            EnablePlaybackRemuxing: true,
            EnableRemoteAccess: true,
            EnableVideoPlaybackTranscoding: true,
            EnabledFolders: [],
            IsAdministrator: true,
            IsDisabled: false,
            PasswordResetProviderId: 'default-reset',
            ...policyOverrides
        }
    };
}

function availableLibraries(): AdminUserLibraryAccess {
    return {
        folders: [
            { id: 'movies', name: 'Movies', selected: true },
            { id: 'shows', name: 'Shows', selected: true }
        ],
        mode: 'all',
        preservedFolderIds: [],
        selectedFolderIds: []
    };
}

function usersState(overrides: Record<string, unknown> = {}) {
    return {
        coreError: false,
        isInitialLoading: false,
        isRefreshing: false,
        profileError: false,
        refresh: vi.fn(async () => [] as AdminUserSummary[]),
        sessionsError: false,
        users: [] as AdminUserSummary[],
        ...overrides
    };
}

function userState(overrides: Record<string, unknown> = {}) {
    return {
        adoptPolicy: vi.fn(),
        cancelPolicyQueries: vi.fn(async () => undefined),
        coreUser: coreUser(),
        detail: detail(),
        error: false,
        invalidate: vi.fn(async () => undefined),
        librariesError: false,
        libraryAccess: availableLibraries(),
        loading: false,
        profileError: false,
        refetch: vi.fn(async () => undefined),
        refetchLibraries: vi.fn(async () => undefined),
        sessions: [],
        sessionsError: false,
        ...overrides
    };
}

function changeInput(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function buttonWithText(root: ParentNode, text: string) {
    return Array.from(root.querySelectorAll('button')).find(button => button.textContent === text);
}

async function flushAsync() {
    await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
        await Promise.resolve();
    });
}

describe('PiggieTV administrator users UI', () => {
    let container: HTMLDivElement;
    let queryClient: QueryClient;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        uiMocks.loadAdminUserLibraries.mockResolvedValue([
            { Id: 'movies', Name: 'Movies' }
        ]);
        uiMocks.updateAdminUserLibraryAccessFromBaseline.mockImplementation(async (
            _api: Api,
            _userId: string,
            _baseline: Readonly<{ enabledFolderIds: readonly string[] }>,
            selection: Readonly<{ mode: 'all' | 'selected'; selectedFolderIds?: readonly string[] }>
        ) => {
            const enableAllFolders = selection.mode === 'all';
            const enabledFolderIds = enableAllFolders ? [] : [ ...(selection.selectedFolderIds || []) ];
            return {
                confirmedBaseline: { enableAllFolders, enabledFolderIds },
                policy: {
                    ...coreUser().Policy,
                    EnableAllFolders: enableAllFolders,
                    EnabledFolders: enabledFolderIds
                }
            };
        });
        uiMocks.updateAdminUserPlaybackPolicyFromBaseline.mockImplementation(async (
            _api: Api,
            _userId: string,
            _baseline: Readonly<Record<string, boolean>>,
            edited: Readonly<Record<string, boolean>>
        ) => ({
            confirmedBaseline: edited,
            policy: { ...coreUser().Policy, ...edited }
        }));
        uiMocks.userState = userState();
        uiMocks.usersState = usersState();
        queryClient = new QueryClient({
            defaultOptions: {
                queries: { gcTime: Infinity, retry: false }
            }
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

    function render(children: React.ReactNode) {
        return act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter>{children}</MemoryRouter>
            </QueryClientProvider>
        ));
    }

    it('keeps user creation read-only until the active server id resolves', async () => {
        const unresolved = { serverId: () => '' } as unknown as ApiClient;
        await render(
            <AddAdminUserDialog
                api={api}
                apiClient={unresolved}
                onClose={vi.fn()}
                onCreated={vi.fn()}
                open
            />
        );
        await flushAsync();

        expect(uiMocks.loadAdminUserLibraries).not.toHaveBeenCalled();
        expect(buttonWithText(container, 'Create User')?.disabled).toBe(true);
        container.querySelector('#ptv-add-user-form')?.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true })
        );
        await flushAsync();
        expect(uiMocks.createAdminUser).not.toHaveBeenCalled();
    });

    it('renders compact user rows and supports local search and role/status filters', async () => {
        uiMocks.usersState = usersState({
            users: [
                summary({
                    activeSessionCount: 1,
                    avatarUrl: 'https://example.test/piggie.png',
                    email: 'piggie@example.test',
                    emailStatus: 'verified',
                    id: 'admin-a',
                    isAdministrator: true,
                    role: 'administrator',
                    username: 'Piggie'
                }),
                summary({
                    accountStatus: 'disabled',
                    enabled: false,
                    id: 'member-a',
                    username: 'Alex'
                }),
                summary({
                    emailStatus: 'pending',
                    id: 'member-b',
                    maskedEmail: 'c***@example.test',
                    username: 'Casey'
                })
            ]
        });

        await render(<PtvAdminUsersPage />);

        expect(container.querySelectorAll('.ptv-admin-user-row')).toHaveLength(3);
        expect(container.textContent).toContain('Administrator');
        expect(container.textContent).toContain('Disabled');
        expect(container.textContent).toContain('Verified');
        expect(container.textContent).toContain('Pending verification');
        expect(container.querySelector('a[href="/settings/admin/users/signup-invites"]')?.textContent).toBe('Create Invite');

        const search = container.querySelector<HTMLInputElement>('#ptv-admin-user-search');
        await act(async () => changeInput(search!, 'alex'));
        expect(container.querySelectorAll('.ptv-admin-user-row')).toHaveLength(1);
        expect(container.textContent).toContain('Alex');
        expect(container.textContent).not.toContain('Casey');

        await act(async () => changeInput(search!, ''));
        await act(async () => buttonWithText(container, 'Administrators')?.click());
        expect(container.querySelectorAll('.ptv-admin-user-row')).toHaveLength(1);
        expect(container.textContent).toContain('Piggie');

        await act(async () => buttonWithText(container, 'Disabled')?.click());
        expect(container.querySelectorAll('.ptv-admin-user-row')).toHaveLength(1);
        expect(container.textContent).toContain('Alex');
    });

    it('keeps initials visible and removes a failed avatar image', async () => {
        uiMocks.usersState = usersState({
            users: [ summary({
                avatarUrl: 'https://example.test/broken.png',
                id: 'admin-a',
                username: 'Piggie'
            }) ]
        });

        await render(<PtvAdminUsersPage />);
        const avatar = container.querySelector('.ptv-admin-user-avatar');
        const image = avatar?.querySelector('img');
        expect(avatar?.textContent).toContain('PI');
        expect(image).not.toBeNull();

        await act(async () => image?.dispatchEvent(new Event('error')));
        expect(avatar?.querySelector('img')).toBeNull();
        expect(avatar?.textContent).toContain('PI');
    });

    it('keeps core rows usable when profile and session context fail independently', async () => {
        uiMocks.usersState = usersState({
            profileError: true,
            sessionsError: true,
            users: [ summary({
                emailStatus: 'unavailable',
                profileSourceState: 'unavailable'
            }) ]
        });

        await render(<PtvAdminUsersPage />);

        expect(container.querySelectorAll('.ptv-admin-user-row')).toHaveLength(1);
        expect(container.textContent).toContain('PTV profile details are unavailable');
        expect(container.textContent).toContain('Session activity is unavailable');
        expect(container.textContent).toContain('Alex');
    });

    it('renders the full detail workspace, fails library access closed, and guards the signed-in administrator', async () => {
        const refetchLibraries = vi.fn(async () => undefined);
        const currentDetail = detail();
        uiMocks.userState = userState({
            librariesError: true,
            libraryAccess: {
                folders: [],
                mode: 'unavailable',
                preservedFolderIds: [],
                reason: 'folders-unavailable',
                selectedFolderIds: []
            },
            profileError: true,
            refetchLibraries,
            sessionsError: true
        });
        uiMocks.usersState = usersState({
            users: [
                currentDetail,
                summary({
                    id: 'admin-b',
                    isAdministrator: true,
                    role: 'administrator',
                    username: 'Backup Admin'
                })
            ]
        });

        await render(<PtvAdminUserDetail userId='admin-a' />);

        for (const heading of [
            'Profile',
            'Account Access',
            'Library Access',
            'Playback & Content',
            'Content Restrictions',
            'Devices & Activity',
            'Security',
            'Danger Zone'
        ]) {
            expect(container.textContent).toContain(heading);
        }
        expect(container.textContent).toContain('Some account context is unavailable');
        expect(container.textContent).toContain('Library access could not be loaded.');
        expect(container.textContent).toContain('You cannot disable the account you are currently using.');
        expect(buttonWithText(container, 'Save library access')).toBeUndefined();
        expect(container.querySelector('a[href="/settings/admin/devices"]')?.textContent)
            .toBe('View Devices');
        expect(container.querySelector('a[href="/settings/admin/activity"]')?.textContent)
            .toBe('View Activity');

        const accessSection = Array.from(container.querySelectorAll('section'))
            .find(section => section.querySelector('h2')?.textContent === 'Account Access');
        const guardedSwitches = accessSection?.querySelectorAll<HTMLInputElement>('input[role="switch"]');
        expect(guardedSwitches).toHaveLength(2);
        expect(guardedSwitches?.[0].disabled).toBe(true);
        expect(guardedSwitches?.[1].disabled).toBe(true);
        expect(buttonWithText(container, 'Delete user')?.disabled).toBe(true);

        await act(async () => buttonWithText(container, 'Retry')?.click());
        expect(refetchLibraries).toHaveBeenCalledOnce();
        expect(uiMocks.updateAdminUserLibraryAccess).not.toHaveBeenCalled();
    });

    it('saves explicit profile, library, and playback changes through their focused services', async () => {
        uiMocks.currentUser = { Id: 'admin-a', Name: 'Piggie' };
        const adoptPolicy = vi.fn();
        const cancelPolicyQueries = vi.fn(async () => undefined);
        const memberDetail = detail({
            id: 'member-a',
            isAdministrator: false,
            role: 'member',
            username: 'Alex'
        });
        uiMocks.userState = userState({
            adoptPolicy,
            cancelPolicyQueries,
            coreUser: {
                ...coreUser({ EnableAllFolders: false, EnabledFolders: [ 'movies' ] }),
                Id: 'member-a',
                Name: 'Alex'
            },
            detail: memberDetail,
            libraryAccess: {
                ...availableLibraries(),
                folders: [
                    { id: 'movies', name: 'Movies', selected: true },
                    { id: 'shows', name: 'Shows', selected: false }
                ],
                mode: 'selected',
                selectedFolderIds: [ 'movies' ]
            }
        });
        uiMocks.usersState = usersState({
            users: [ summary({ id: 'admin-a', isAdministrator: true, role: 'administrator' }), memberDetail ]
        });
        uiMocks.updateAdminUsername.mockResolvedValue(undefined);

        await render(<PtvAdminUserDetail userId='member-a' />);

        const username = container.querySelector<HTMLInputElement>('#ptv-admin-user-profile input');
        await act(async () => changeInput(username!, 'Alex Prime'));
        await act(async () => { buttonWithText(container, 'Save profile')?.click(); await Promise.resolve(); });
        await flushAsync();
        expect(uiMocks.updateAdminUsername).toHaveBeenCalledWith(expect.anything(), 'member-a', 'Alex Prime');

        const shows = Array.from(container.querySelectorAll('label')).find(label => label.textContent?.includes('Shows'))
            ?.querySelector<HTMLInputElement>('input');
        await act(async () => shows?.click());
        await act(async () => { buttonWithText(container, 'Save library access')?.click(); await Promise.resolve(); });
        await flushAsync();
        expect(uiMocks.updateAdminUserLibraryAccessFromBaseline).toHaveBeenCalledWith(
            expect.anything(),
            'member-a',
            { enableAllFolders: false, enabledFolderIds: [ 'movies' ] },
            { mode: 'selected', selectedFolderIds: [ 'movies', 'shows' ] }
        );
        expect(buttonWithText(container, 'Save library access')?.disabled).toBe(true);

        const downloads = Array.from(container.querySelectorAll('label')).find(label => label.textContent?.includes('Downloads'))
            ?.querySelector<HTMLInputElement>('input');
        await act(async () => downloads?.click());
        await act(async () => { buttonWithText(container, 'Save playback access')?.click(); await Promise.resolve(); });
        await flushAsync();
        expect(uiMocks.updateAdminUserPlaybackPolicyFromBaseline).toHaveBeenCalledWith(
            expect.anything(),
            'member-a',
            expect.objectContaining({ EnableContentDownloading: true }),
            expect.objectContaining({ EnableContentDownloading: false })
        );
        expect(buttonWithText(container, 'Save playback access')?.disabled).toBe(true);
        expect(cancelPolicyQueries).toHaveBeenCalledTimes(2);
        expect(adoptPolicy).toHaveBeenCalledTimes(2);
    });

    it('keeps playback edits dirty and presents a safe server conflict without adopting them', async () => {
        const adoptPolicy = vi.fn();
        const member = detail({
            id: 'member-a',
            isAdministrator: false,
            role: 'member',
            username: 'Alex'
        });
        uiMocks.userState = userState({
            adoptPolicy,
            coreUser: { ...coreUser(), Id: 'member-a', Name: 'Alex' },
            detail: member
        });
        uiMocks.usersState = usersState({ users: [ member ] });
        uiMocks.updateAdminUserPlaybackPolicyFromBaseline.mockRejectedValueOnce(
            new AdminUsersServiceError(
                'managed-state-conflict',
                'Playback permissions changed on the server while you were editing. Reload the account before saving.'
            )
        );

        await render(<PtvAdminUserDetail userId='member-a' />);
        const downloads = Array.from(container.querySelectorAll('label'))
            .find(label => label.textContent?.includes('Downloads'))
            ?.querySelector<HTMLInputElement>('input');
        await act(async () => downloads?.click());
        await act(async () => {
            buttonWithText(container, 'Save playback access')?.click();
            await Promise.resolve();
        });
        await flushAsync();

        expect(container.textContent).toContain('Playback permissions changed on the server while you were editing.');
        expect(container.querySelector('.ptv-admin-user-status-message.is-error')?.textContent)
            .toContain('changed on the server');
        expect(buttonWithText(container, 'Save playback access')?.disabled).toBe(false);
        expect(adoptPolicy).not.toHaveBeenCalled();
    });

    it('does not render arbitrary backend error details from profile mutations', async () => {
        uiMocks.currentUser = { Id: 'admin-a', Name: 'Piggie' };
        const member = detail({
            id: 'member-a',
            isAdministrator: false,
            role: 'member',
            username: 'Alex'
        });
        uiMocks.userState = userState({
            coreUser: { ...coreUser(), Id: 'member-a', Name: 'Alex' },
            detail: member
        });
        uiMocks.usersState = usersState({ users: [ member ] });
        const sensitiveDetail = 'account update failed: token=private-value C:\\private\\server-path';
        uiMocks.updateAdminUsername.mockRejectedValue(new Error(sensitiveDetail));

        await render(<PtvAdminUserDetail userId='member-a' />);
        const username = container.querySelector<HTMLInputElement>('#ptv-admin-user-profile input');
        await act(async () => changeInput(username!, 'Alex Prime'));
        await act(async () => {
            buttonWithText(container, 'Save profile')?.click();
            await Promise.resolve();
        });
        await flushAsync();

        expect(container.textContent).toContain("We couldn't rename Alex.");
        expect(container.textContent).not.toContain('private-value');
        expect(container.textContent).not.toContain('private\\server-path');
    });

    it('runs confirmed account mutations and rechecks the fresh target before destructive work', async () => {
        uiMocks.currentUser = { Id: 'admin-a', Name: 'Piggie' };
        const admin = summary({ id: 'admin-a', isAdministrator: true, role: 'administrator', username: 'Piggie' });
        const member = detail({ id: 'member-a', isAdministrator: false, role: 'member', username: 'Alex' });
        const refresh = vi.fn(async () => [ admin, member ]);
        let releasePromotion: (() => void) | undefined;
        const promotion = new Promise<void>(resolve => { releasePromotion = resolve; });
        uiMocks.userState = userState({ detail: member });
        uiMocks.usersState = usersState({ refresh, users: [ admin, member ] });
        uiMocks.setAdminUserAdministrator.mockReturnValueOnce(promotion);
        uiMocks.setAdminUserEnabled.mockResolvedValue(undefined);
        uiMocks.deleteAdminUser.mockResolvedValue(undefined);

        await render(<PtvAdminUserDetail userId='member-a' />);

        const accessSection = Array.from(container.querySelectorAll('section'))
            .find(section => section.querySelector('h2')?.textContent === 'Account Access');
        const switches = accessSection?.querySelectorAll<HTMLInputElement>('input[role="switch"]');
        await act(async () => switches?.[0].click());
        const confirmation = buttonWithText(container, 'Confirm action');
        await act(async () => {
            confirmation?.click();
            confirmation?.click();
            await Promise.resolve();
        });
        expect(uiMocks.setAdminUserAdministrator).toHaveBeenCalledOnce();
        await act(async () => {
            releasePromotion?.();
            await promotion;
        });
        await flushAsync();
        expect(uiMocks.setAdminUserAdministrator).toHaveBeenCalledWith(expect.anything(), 'member-a', true);

        await act(async () => switches?.[1].click());
        await act(async () => { buttonWithText(container, 'Confirm action')?.click(); await Promise.resolve(); });
        await flushAsync();
        expect(uiMocks.setAdminUserEnabled).toHaveBeenCalledWith(expect.anything(), 'member-a', false);

        await act(async () => buttonWithText(container, 'Delete user')?.click());
        await act(async () => { buttonWithText(container, 'Confirm action')?.click(); await Promise.resolve(); });
        await flushAsync();
        expect(refresh).toHaveBeenCalled();
        expect(uiMocks.deleteAdminUser).toHaveBeenCalledWith(expect.anything(), 'member-a');
    });

    it('submits and clears every password field after a failed self-password mutation', async () => {
        uiMocks.updateAdminUserPassword.mockRejectedValue(new Error('request failed'));

        await render(
            <AdminUserPasswordDialog
                api={api}
                onClose={vi.fn()}
                onSaved={vi.fn()}
                open
                requiresCurrentPassword
                userId='member-a'
                username='Alex'
            />
        );

        const passwordInputs = container.querySelectorAll<HTMLInputElement>('input[type="password"]');
        await act(async () => {
            changeInput(passwordInputs[0], 'current-password');
            changeInput(passwordInputs[1], 'temporary-password');
            changeInput(passwordInputs[2], 'temporary-password');
        });
        await act(async () => {
            container.querySelector('#ptv-user-password-form')?.dispatchEvent(
                new Event('submit', { bubbles: true, cancelable: true })
            );
            await Promise.resolve();
        });

        expect(uiMocks.updateAdminUserPassword).toHaveBeenCalledOnce();
        expect(uiMocks.updateAdminUserPassword).toHaveBeenCalledWith(
            api,
            'member-a',
            { currentPassword: 'current-password', newPassword: 'temporary-password' }
        );
        expect(Array.from(passwordInputs).every(input => input.value === '')).toBe(true);
        expect(container.textContent).toContain("We couldn't update Alex's password.");
    });

    it('retries access setup for a partially created account without creating it twice', async () => {
        const onCreated = vi.fn();
        let releaseCreation: ((user: { Id: string; Name: string }) => void) | undefined;
        const creation = new Promise<{ Id: string; Name: string }>(resolve => { releaseCreation = resolve; });
        uiMocks.createAdminUser.mockReturnValue(creation);
        uiMocks.updateAdminUserPolicy
            .mockRejectedValueOnce(new Error('policy unavailable'))
            .mockResolvedValueOnce(undefined);
        uiMocks.updateAdminUserLibraryAccess.mockResolvedValue(undefined);

        await render(
            <AddAdminUserDialog
                api={api}
                apiClient={apiClient}
                onClose={vi.fn()}
                onCreated={onCreated}
                open
            />
        );
        await flushAsync();

        const username = container.querySelector<HTMLInputElement>(
            '#ptv-add-user-form input:not([type])'
        );
        await act(async () => changeInput(username!, 'Nova'));
        const form = container.querySelector('#ptv-add-user-form');
        await act(async () => {
            form?.dispatchEvent(
                new Event('submit', { bubbles: true, cancelable: true })
            );
            form?.dispatchEvent(
                new Event('submit', { bubbles: true, cancelable: true })
            );
            await Promise.resolve();
        });
        expect(uiMocks.createAdminUser).toHaveBeenCalledOnce();
        await act(async () => {
            releaseCreation?.({ Id: 'new-user', Name: 'Nova' });
            await creation;
        });
        await flushAsync();

        expect(uiMocks.createAdminUser).toHaveBeenCalledOnce();
        expect(uiMocks.updateAdminUserPolicy).toHaveBeenCalledOnce();
        expect(container.textContent).toContain('Nova was created, but access settings could not be saved.');
        expect(buttonWithText(container, 'Retry access settings')).toBeDefined();
        expect(buttonWithText(container, 'Open User')).toBeDefined();
        expect(Array.from(container.querySelectorAll<HTMLInputElement>('input[type="password"]'))
            .every(input => input.value === '')).toBe(true);

        await act(async () => {
            buttonWithText(container, 'Retry access settings')?.click();
            await Promise.resolve();
        });
        await flushAsync();

        expect(uiMocks.createAdminUser).toHaveBeenCalledOnce();
        expect(uiMocks.updateAdminUserPolicy).toHaveBeenCalledTimes(2);
        expect(uiMocks.updateAdminUserLibraryAccess).toHaveBeenCalledOnce();
        expect(onCreated).toHaveBeenCalledWith('new-user');
    });

    it('formats long activity intervals without a zero-year edge case', () => {
        const now = Date.parse('2026-08-12T12:00:00.000Z');
        const elevenMonthsAgo = new Date(now - (364 * 24 * 60 * 60_000)).toISOString();

        expect(formatAdminUserTime(elevenMonthsAgo, now)).toBe('11 months ago');
    });
});

/* eslint-enable @stylistic/max-statements-per-line, @typescript-eslint/naming-convention, sonarjs/no-hardcoded-passwords */
