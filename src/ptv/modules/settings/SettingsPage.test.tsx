import React, { act, useCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const settingsPageMocks = vi.hoisted(() => ({
    currentAdminDestinationId: '',
    currentUserStatus: 'ready' as 'error' | 'loading' | 'ready',
    isAdministrator: false as boolean | undefined,
    renderAdminActivity: vi.fn(),
    renderAdminDevices: vi.fn(),
    renderAdminSettings: vi.fn(),
    renderAdminLibraryDisplay: vi.fn(),
    renderAdminLibraries: vi.fn(),
    renderAdminMetadata: vi.fn(),
    renderAdminMetadataQuality: vi.fn(),
    renderAdminMetadataManager: vi.fn(),
    renderAdminNfo: vi.fn(),
    renderAdminLiveTv: vi.fn(),
    renderAdminPlayback: vi.fn(),
    renderAdminPiggietv: vi.fn(),
    renderAdminPlugins: vi.fn(),
    renderAdminServer: vi.fn(),
    renderAdminSignupInvites: vi.fn(),
    renderAdminTasks: vi.fn(),
    renderAdminUsers: vi.fn(),
    retryCurrentUser: vi.fn(async () => undefined)
}));

vi.mock('components/Page', () => ({
    default: ({ children }: Readonly<{ children: React.ReactNode }>) => <div>{children}</div>
}));
vi.mock('../../../hooks/useApi', () => ({
    useApi: () => ({
        currentUserStatus: settingsPageMocks.currentUserStatus,
        retryCurrentUser: settingsPageMocks.retryCurrentUser,
        user: settingsPageMocks.isAdministrator === undefined ? undefined : {
            Id: 'member-a',
            Name: 'Alex',
            Policy: { IsAdministrator: settingsPageMocks.isAdministrator }
        }
    })
}));
vi.mock('components/loading/LoadingComponent', () => ({
    default: () => <div data-testid='settings-auth-loading'>Authorizing</div>
}));
vi.mock('../../../hooks/useQuickConnect', () => ({
    useQuickConnectEnabled: () => ({ data: false })
}));
vi.mock('../account/accountProfileStore', () => ({
    startPtvAccountProfileService: () => () => undefined,
    usePtvAccountProfile: () => ({
        error: '',
        identityKey: 'service-a:member-a',
        profile: {
            email: 'alex@example.com',
            emailVerified: true,
            username: 'Alex'
        },
        status: 'ready'
    })
}));
vi.mock('../../services/jellyfinLogoutAction', () => ({
    requestJellyfinLogout: vi.fn()
}));
vi.mock('./admin/PtvAdminLayout', () => ({
    default: ({
        children,
        currentDestinationId
    }: Readonly<{
        children: React.ReactNode;
        currentDestinationId: string;
    }>) => {
        settingsPageMocks.currentAdminDestinationId = currentDestinationId;
        return <main>{children}</main>;
    }
}));
vi.mock('./admin/people/AdminPeopleRoute', () => ({
    default: ({ section }: Readonly<{ section: 'activity' | 'devices' }>) => {
        if (section === 'activity') settingsPageMocks.renderAdminActivity();
        else settingsPageMocks.renderAdminDevices();
        return <div data-testid={`admin-${section}`}>Admin {section}</div>;
    }
}));
vi.mock('./admin/users/AdminUsersRoute', () => ({
    default: () => {
        settingsPageMocks.renderAdminUsers();
        return <div data-testid='admin-users'>Admin users</div>;
    }
}));
vi.mock('./admin/libraries/AdminLibrariesRoute', () => ({
    default: () => {
        settingsPageMocks.renderAdminLibraries();
        return <div data-testid='admin-libraries'>Admin libraries</div>;
    }
}));
vi.mock('./admin/libraryDisplay/AdminLibraryDisplayRoute', () => ({
    default: () => {
        settingsPageMocks.renderAdminLibraryDisplay();
        return <div data-testid='admin-library-display'>Admin library display</div>;
    }
}));
vi.mock('./admin/metadata/AdminMetadataRoute', () => ({
    default: () => {
        settingsPageMocks.renderAdminMetadata();
        return <div data-testid='admin-metadata'>Admin metadata</div>;
    }
}));
vi.mock('./admin/metadataManager/AdminMetadataManagerRoute', () => ({
    default: () => {
        settingsPageMocks.renderAdminMetadataManager();
        return <div data-testid='admin-metadata-manager'>Admin metadata manager</div>;
    }
}));
vi.mock('./admin/metadataQuality/AdminMetadataQualityRoute', () => ({
    default: () => {
        settingsPageMocks.renderAdminMetadataQuality();
        return <div data-testid='admin-metadata-quality'>Admin metadata quality</div>;
    }
}));
vi.mock('./admin/nfo/AdminNfoRoute', () => ({
    default: () => {
        settingsPageMocks.renderAdminNfo();
        return <div data-testid='admin-nfo'>Admin NFO</div>;
    }
}));
vi.mock('./admin/liveTv/AdminLiveTvRoute', () => ({
    default: () => {
        settingsPageMocks.renderAdminLiveTv();
        return <div data-testid='admin-live-tv'>Admin Live TV</div>;
    }
}));
vi.mock('./admin/playback/AdminPlaybackRoute', () => ({
    default: () => {
        settingsPageMocks.renderAdminPlayback();
        return <div data-testid='admin-playback'>Admin playback</div>;
    }
}));
vi.mock('./admin/piggietv/AdminPiggietvRoute', () => ({
    default: () => {
        settingsPageMocks.renderAdminPiggietv();
        return <div data-testid='admin-piggietv'>Admin PiggieTV</div>;
    }
}));
vi.mock('./admin/plugins/AdminPluginsRoute', () => ({
    default: () => {
        settingsPageMocks.renderAdminPlugins();
        return <div data-testid='admin-plugins'>Admin plugins</div>;
    }
}));
vi.mock('./admin/server/AdminServerRoute', () => ({
    default: () => {
        settingsPageMocks.renderAdminServer();
        return <div data-testid='admin-server'>Admin server</div>;
    }
}));
vi.mock('./admin/tasks/AdminTasksRoute', () => ({
    default: () => {
        settingsPageMocks.renderAdminTasks();
        return <div data-testid='admin-tasks'>Admin tasks</div>;
    }
}));
vi.mock('./admin/signupInvites/AdminSignupInvitesRoute', () => ({
    default: () => {
        settingsPageMocks.renderAdminSignupInvites();
        return <div data-testid='admin-signup-invites'>Admin signup and invites</div>;
    }
}));
vi.mock('../account/ProfilePage', () => ({ default: () => <div>Profile settings</div> }));
vi.mock('./pages/AdminSettings', () => ({
    default: () => {
        settingsPageMocks.renderAdminSettings();
        return <div data-testid='admin-settings'>Admin settings</div>;
    }
}));
vi.mock('./pages/AppearanceSettings', () => ({ default: () => <div>Appearance settings</div> }));
vi.mock('./pages/ConnectionSettings', () => ({ default: () => <div>Connection settings</div> }));
vi.mock('./pages/ControlSettings', () => ({ default: () => <div>Control settings</div> }));
vi.mock('./pages/DeviceSettings', () => ({ default: () => <div>Device settings</div> }));
vi.mock('./pages/HomeSettings', () => ({ default: () => <div>Home settings</div> }));
vi.mock('./pages/MediaSettings', () => ({ default: () => <div>Media settings</div> }));
vi.mock('./pages/PlaybackSettings', () => ({ default: () => <div>Playback settings</div> }));
vi.mock('./pages/SubtitleSettings', () => ({ default: () => <div>Subtitle settings</div> }));

import SettingsPage from './SettingsPage';

const ADMIN_RENDER_MOCKS = [
    settingsPageMocks.renderAdminActivity,
    settingsPageMocks.renderAdminDevices,
    settingsPageMocks.renderAdminSettings,
    settingsPageMocks.renderAdminLibraryDisplay,
    settingsPageMocks.renderAdminLibraries,
    settingsPageMocks.renderAdminMetadata,
    settingsPageMocks.renderAdminMetadataQuality,
    settingsPageMocks.renderAdminMetadataManager,
    settingsPageMocks.renderAdminNfo,
    settingsPageMocks.renderAdminLiveTv,
    settingsPageMocks.renderAdminPlayback,
    settingsPageMocks.renderAdminPiggietv,
    settingsPageMocks.renderAdminPlugins,
    settingsPageMocks.renderAdminServer,
    settingsPageMocks.renderAdminSignupInvites,
    settingsPageMocks.renderAdminTasks,
    settingsPageMocks.renderAdminUsers
] as const;

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

function CurrentLocation() {
    return <output data-testid='location'>{useLocation().pathname}</output>;
}

function HistoryControls() {
    const navigate = useNavigate();
    const goBack = useCallback(() => navigate(-1), [navigate]);
    const goForward = useCallback(() => navigate(1), [navigate]);
    return (
        <>
            <button data-testid='history-back' onClick={goBack} type='button'>Back</button>
            <button data-testid='history-forward' onClick={goForward} type='button'>Forward</button>
        </>
    );
}

describe('Settings page administrator guard', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        settingsPageMocks.currentAdminDestinationId = '';
        settingsPageMocks.currentUserStatus = 'ready';
        settingsPageMocks.isAdministrator = false;
        settingsPageMocks.renderAdminActivity.mockClear();
        settingsPageMocks.renderAdminDevices.mockClear();
        settingsPageMocks.renderAdminSettings.mockClear();
        settingsPageMocks.renderAdminLibraryDisplay.mockClear();
        settingsPageMocks.renderAdminLibraries.mockClear();
        settingsPageMocks.renderAdminMetadata.mockClear();
        settingsPageMocks.renderAdminMetadataManager.mockClear();
        settingsPageMocks.renderAdminNfo.mockClear();
        settingsPageMocks.renderAdminLiveTv.mockClear();
        settingsPageMocks.renderAdminPlayback.mockClear();
        settingsPageMocks.renderAdminPiggietv.mockClear();
        settingsPageMocks.renderAdminPlugins.mockClear();
        settingsPageMocks.renderAdminServer.mockClear();
        settingsPageMocks.renderAdminSignupInvites.mockClear();
        settingsPageMocks.renderAdminTasks.mockClear();
        settingsPageMocks.renderAdminUsers.mockClear();
        settingsPageMocks.retryCurrentUser.mockClear();
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    it('redirects a non-administrator away from an admin-only URL', async () => {
        await act(async () => root.render(
            <MemoryRouter initialEntries={['/settings/admin']}>
                <Routes>
                    <Route path='/settings/*' element={<SettingsPage />} />
                </Routes>
                <CurrentLocation />
            </MemoryRouter>
        ));

        expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/settings');
        expect(container.querySelector('[data-testid="admin-settings"]')).toBeNull();
        expect(settingsPageMocks.renderAdminSettings).not.toHaveBeenCalled();
    });

    it('mounts the administration dashboard for an administrator', async () => {
        settingsPageMocks.isAdministrator = true;

        await act(async () => root.render(
            <MemoryRouter initialEntries={['/settings/admin']}>
                <Routes>
                    <Route path='/settings/*' element={<SettingsPage />} />
                </Routes>
                <CurrentLocation />
            </MemoryRouter>
        ));

        expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/settings/admin');
        expect(container.querySelector('[data-testid="admin-settings"]')?.textContent).toBe('Admin settings');
        expect(settingsPageMocks.renderAdminSettings).toHaveBeenCalledOnce();
    });

    it('rejects a non-administrator before mounting a direct user detail URL', async () => {
        await act(async () => root.render(
            <MemoryRouter initialEntries={['/settings/admin/users/member-a']}>
                <Routes>
                    <Route path='/settings/*' element={<SettingsPage />} />
                </Routes>
                <CurrentLocation />
            </MemoryRouter>
        ));

        expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/settings');
        expect(container.querySelector('[data-testid="admin-users"]')).toBeNull();
        expect(settingsPageMocks.renderAdminUsers).not.toHaveBeenCalled();
    });

    it('mounts the native user workspace for an administrator on a direct detail URL', async () => {
        settingsPageMocks.isAdministrator = true;

        await act(async () => root.render(
            <MemoryRouter initialEntries={['/settings/admin/users/member-a']}>
                <Routes>
                    <Route path='/settings/*' element={<SettingsPage />} />
                </Routes>
                <CurrentLocation />
            </MemoryRouter>
        ));

        expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/settings/admin/users/member-a');
        expect(container.querySelector('[data-testid="admin-users"]')?.textContent).toBe('Admin users');
        expect(settingsPageMocks.currentAdminDestinationId).toBe('users');
        expect(settingsPageMocks.renderAdminUsers).toHaveBeenCalledOnce();
    });

    it('authorizes the native Libraries list and detail routes before mounting them', async () => {
        await act(async () => root.render(
            <MemoryRouter key='member-libraries' initialEntries={['/settings/admin/libraries/library-a']}>
                <Routes>
                    <Route path='/settings/*' element={<SettingsPage />} />
                </Routes>
                <CurrentLocation />
            </MemoryRouter>
        ));

        expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/settings');
        expect(container.querySelector('[data-testid="admin-libraries"]')).toBeNull();
        expect(settingsPageMocks.renderAdminLibraries).not.toHaveBeenCalled();

        settingsPageMocks.isAdministrator = true;
        await act(async () => root.render(
            <MemoryRouter key='admin-libraries' initialEntries={['/settings/admin/libraries/library-a']}>
                <Routes>
                    <Route path='/settings/*' element={<SettingsPage />} />
                </Routes>
                <CurrentLocation />
            </MemoryRouter>
        ));

        expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/settings/admin/libraries/library-a');
        expect(container.querySelector('[data-testid="admin-libraries"]')?.textContent).toBe('Admin libraries');
        expect(settingsPageMocks.currentAdminDestinationId).toBe('libraries');
        expect(settingsPageMocks.renderAdminLibraries).toHaveBeenCalledOnce();
    });

    it('authorizes Library Display before mounting its native settings source', async () => {
        await act(async () => root.render(
            <MemoryRouter key='member-library-display' initialEntries={['/settings/admin/libraries/display']}>
                <Routes>
                    <Route path='/settings/*' element={<SettingsPage />} />
                </Routes>
                <CurrentLocation />
            </MemoryRouter>
        ));

        expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/settings');
        expect(container.querySelector('[data-testid="admin-library-display"]')).toBeNull();
        expect(settingsPageMocks.renderAdminLibraryDisplay).not.toHaveBeenCalled();

        settingsPageMocks.isAdministrator = true;
        await act(async () => root.render(
            <MemoryRouter key='admin-library-display' initialEntries={['/settings/admin/libraries/display']}>
                <Routes>
                    <Route path='/settings/*' element={<SettingsPage />} />
                </Routes>
                <CurrentLocation />
            </MemoryRouter>
        ));

        expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/settings/admin/libraries/display');
        expect(container.querySelector('[data-testid="admin-library-display"]')?.textContent).toBe('Admin library display');
        expect(settingsPageMocks.currentAdminDestinationId).toBe('library-display');
        expect(settingsPageMocks.renderAdminLibraryDisplay).toHaveBeenCalledOnce();
    });

    it('fails closed before mounting Library Display when authorization is unavailable', async () => {
        settingsPageMocks.currentUserStatus = 'error';
        settingsPageMocks.isAdministrator = undefined;

        await act(async () => root.render(
            <MemoryRouter initialEntries={['/settings/admin/libraries/display']}>
                <Routes>
                    <Route path='/settings/*' element={<SettingsPage />} />
                </Routes>
            </MemoryRouter>
        ));

        expect(container.textContent).toContain('Administration unavailable');
        expect(container.querySelector('[data-testid="admin-library-display"]')).toBeNull();
        expect(settingsPageMocks.renderAdminLibraryDisplay).not.toHaveBeenCalled();
    });

    it.each([
        [ 'Overview', '/settings/admin' ],
        [ 'People', '/settings/admin/devices' ],
        [ 'Media', '/settings/admin/libraries/library-a' ],
        [ 'Playback', '/settings/admin/playback/transcoding' ],
        [ 'PiggieTV', '/settings/admin/piggietv/diagnostics' ],
        [ 'Live TV', '/settings/admin/livetv/tuners/tuner-a' ],
        [ 'Plugins', '/settings/admin/plugins/plugin-a' ],
        [ 'Server', '/settings/admin/server/logs/server.log' ],
        [ 'an unknown Administration descendant', '/settings/admin/not-a-real-destination' ],
        [ 'a case-varied Administration descendant', '/SETTINGS/ADMIN/not-a-real-destination' ]
    ])('fails closed for %s when authorization is unavailable without mounting an admin module', async (_domain, path) => {
        settingsPageMocks.currentUserStatus = 'error';
        settingsPageMocks.isAdministrator = undefined;

        await act(async () => root.render(
            <MemoryRouter initialEntries={[path]}>
                <Routes>
                    <Route path='/settings/*' element={<SettingsPage />} />
                </Routes>
                <CurrentLocation />
            </MemoryRouter>
        ));

        expect(container.querySelector('[data-testid="location"]')?.textContent).toBe(path);
        expect(container.textContent).toContain('Administration unavailable');
        expect(container.textContent).toContain('No administration data was loaded.');
        ADMIN_RENDER_MOCKS.forEach(renderMock => {
            expect(renderMock).not.toHaveBeenCalled();
        });
    });

    it('canonicalizes an unknown Administration descendant only after administrator authorization succeeds', async () => {
        settingsPageMocks.isAdministrator = true;

        await act(async () => root.render(
            <MemoryRouter initialEntries={['/settings/admin/not-a-real-destination']}>
                <Routes>
                    <Route path='/settings/*' element={<SettingsPage />} />
                </Routes>
                <CurrentLocation />
            </MemoryRouter>
        ));

        expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/settings/admin');
        expect(settingsPageMocks.renderAdminSettings).toHaveBeenCalledOnce();
    });

    it('authorizes native People, Metadata, NFO, Metadata Manager, Playback, Plugins, and Scheduled Tasks routes before mounting their data sources', async () => {
        const assertRoute = async (route: Readonly<{
            destination: string;
            path: string;
            render: ReturnType<typeof vi.fn>;
            testId: string;
        }>) => {
            settingsPageMocks.isAdministrator = false;
            route.render.mockClear();
            await act(async () => root.render(
                <MemoryRouter key={`member-${route.destination}`} initialEntries={[route.path]}>
                    <Routes>
                        <Route path='/settings/*' element={<SettingsPage />} />
                    </Routes>
                    <CurrentLocation />
                </MemoryRouter>
            ));

            expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/settings');
            expect(container.querySelector(`[data-testid="${route.testId}"]`)).toBeNull();
            expect(route.render).not.toHaveBeenCalled();

            settingsPageMocks.isAdministrator = true;
            await act(async () => root.render(
                <MemoryRouter key={`admin-${route.destination}`} initialEntries={[route.path]}>
                    <Routes>
                        <Route path='/settings/*' element={<SettingsPage />} />
                    </Routes>
                    <CurrentLocation />
                </MemoryRouter>
            ));

            expect(container.querySelector('[data-testid="location"]')?.textContent).toBe(route.path);
            expect(container.querySelector(`[data-testid="${route.testId}"]`)).not.toBeNull();
            expect(settingsPageMocks.currentAdminDestinationId).toBe(route.destination);
            expect(route.render).toHaveBeenCalledOnce();
        };

        await assertRoute({
            destination: 'devices',
            path: '/settings/admin/devices',
            render: settingsPageMocks.renderAdminDevices,
            testId: 'admin-devices'
        });
        await assertRoute({
            destination: 'activity',
            path: '/settings/admin/activity',
            render: settingsPageMocks.renderAdminActivity,
            testId: 'admin-activity'
        });
        await assertRoute({
            destination: 'signup-invites',
            path: '/settings/admin/users/signup-invites',
            render: settingsPageMocks.renderAdminSignupInvites,
            testId: 'admin-signup-invites'
        });

        await assertRoute({
            destination: 'library-metadata',
            path: '/settings/admin/libraries/metadata',
            render: settingsPageMocks.renderAdminMetadata,
            testId: 'admin-metadata'
        });
        await assertRoute({
            destination: 'nfo-settings',
            path: '/settings/admin/libraries/nfo',
            render: settingsPageMocks.renderAdminNfo,
            testId: 'admin-nfo'
        });
        await assertRoute({
            destination: 'live-tv',
            path: '/settings/admin/livetv/guide',
            render: settingsPageMocks.renderAdminLiveTv,
            testId: 'admin-live-tv'
        });
        await assertRoute({
            destination: 'dvr',
            path: '/settings/admin/livetv/dvr',
            render: settingsPageMocks.renderAdminLiveTv,
            testId: 'admin-live-tv'
        });
        await assertRoute({
            destination: 'metadata-quality',
            path: '/settings/admin/media/metadata-quality/item-a',
            render: settingsPageMocks.renderAdminMetadataQuality,
            testId: 'admin-metadata-quality'
        });
        await assertRoute({
            destination: 'metadata-manager',
            path: '/settings/admin/media/metadata-manager',
            render: settingsPageMocks.renderAdminMetadataManager,
            testId: 'admin-metadata-manager'
        });
        await assertRoute({
            destination: 'metadata-manager',
            path: '/settings/admin/media/metadata-manager/item-a',
            render: settingsPageMocks.renderAdminMetadataManager,
            testId: 'admin-metadata-manager'
        });
        await assertRoute({
            destination: 'playback',
            path: '/settings/admin/playback/transcoding',
            render: settingsPageMocks.renderAdminPlayback,
            testId: 'admin-playback'
        });
        await assertRoute({
            destination: '',
            path: '/settings/admin/piggietv/rows',
            render: settingsPageMocks.renderAdminPiggietv,
            testId: 'admin-piggietv'
        });
        await assertRoute({
            destination: 'plugin-manager',
            path: '/settings/admin/plugins/catalog',
            render: settingsPageMocks.renderAdminPlugins,
            testId: 'admin-plugins'
        });
        await assertRoute({
            destination: '',
            path: '/settings/admin/server/networking',
            render: settingsPageMocks.renderAdminServer,
            testId: 'admin-server'
        });
        await assertRoute({
            destination: '',
            path: '/settings/admin/server/logs/server.log',
            render: settingsPageMocks.renderAdminServer,
            testId: 'admin-server'
        });
        await assertRoute({
            destination: 'plugin-manager',
            path: '/settings/admin/plugins/plugin-a',
            render: settingsPageMocks.renderAdminPlugins,
            testId: 'admin-plugins'
        });
        await assertRoute({
            destination: 'scheduled-tasks',
            path: '/settings/admin/tasks',
            render: settingsPageMocks.renderAdminTasks,
            testId: 'admin-tasks'
        });
        await assertRoute({
            destination: 'scheduled-tasks',
            path: '/settings/admin/tasks/task-a',
            render: settingsPageMocks.renderAdminTasks,
            testId: 'admin-tasks'
        });
    });

    it('restores Library Display through browser Back and Forward history', async () => {
        settingsPageMocks.isAdministrator = true;

        await act(async () => root.render(
            <MemoryRouter
                initialEntries={['/settings/admin/media', '/settings/admin/libraries/display']}
                initialIndex={1}
            >
                <Routes>
                    <Route path='/settings/*' element={<SettingsPage />} />
                </Routes>
                <CurrentLocation />
                <HistoryControls />
            </MemoryRouter>
        ));

        expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/settings/admin/libraries/display');
        expect(container.querySelector('[data-testid="admin-library-display"]')).not.toBeNull();

        await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="history-back"]')?.click());
        expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/settings/admin/media');
        expect(container.textContent).toContain('Media settings');

        await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="history-forward"]')?.click());
        expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/settings/admin/libraries/display');
        expect(container.querySelector('[data-testid="admin-library-display"]')).not.toBeNull();
        expect(settingsPageMocks.currentAdminDestinationId).toBe('library-display');
    });

    it('waits for current-user policy before resolving an admin-only URL', async () => {
        settingsPageMocks.currentUserStatus = 'loading';
        settingsPageMocks.isAdministrator = undefined;

        await act(async () => root.render(
            <MemoryRouter initialEntries={['/settings/admin']}>
                <Routes>
                    <Route path='/settings/*' element={<SettingsPage />} />
                </Routes>
                <CurrentLocation />
            </MemoryRouter>
        ));

        expect(container.querySelector('[data-testid="location"]')?.textContent).toBe('/settings/admin');
        expect(container.querySelector('[data-testid="settings-auth-loading"]')).not.toBeNull();
        expect(settingsPageMocks.renderAdminSettings).not.toHaveBeenCalled();
    });

    it('fails closed with safe retry and Settings escape when policy lookup fails', async () => {
        settingsPageMocks.currentUserStatus = 'error';
        settingsPageMocks.isAdministrator = undefined;

        await act(async () => root.render(
            <MemoryRouter initialEntries={['/settings/admin']}>
                <Routes>
                    <Route path='/settings/*' element={<SettingsPage />} />
                </Routes>
                <CurrentLocation />
            </MemoryRouter>
        ));

        expect(container.textContent).toContain('Administration unavailable');
        expect(container.textContent).toContain('No administration data was loaded.');
        expect(container.querySelector('a[href="/settings"]')?.textContent).toBe('Back to Settings');
        expect(container.querySelector('[data-testid="admin-settings"]')).toBeNull();
        expect(settingsPageMocks.renderAdminSettings).not.toHaveBeenCalled();

        const retryButton = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent === 'Retry authorization');
        expect(retryButton).toBeDefined();
        await act(async () => retryButton?.click());
        expect(settingsPageMocks.retryCurrentUser).toHaveBeenCalledOnce();
    });

    it('does not trust stale administrator data after policy revalidation fails', async () => {
        settingsPageMocks.currentUserStatus = 'error';
        settingsPageMocks.isAdministrator = true;

        await act(async () => root.render(
            <MemoryRouter initialEntries={['/settings/admin']}>
                <Routes>
                    <Route path='/settings/*' element={<SettingsPage />} />
                </Routes>
            </MemoryRouter>
        ));

        expect(container.textContent).toContain('Administration unavailable');
        expect(container.querySelector('[data-testid="admin-settings"]')).toBeNull();
        expect(settingsPageMocks.renderAdminSettings).not.toHaveBeenCalled();
    });
});
