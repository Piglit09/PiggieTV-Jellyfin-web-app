import React, { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const connectionState = vi.hoisted(() => ({
    connect: vi.fn(),
    firstConnection: true,
    isAdministrator: false,
    isLoggedIn: true,
    serverId: 'server-one'
}));

vi.mock('lib/jellyfin-apiclient', () => ({
    ConnectionState: {
        ServerMismatch: 'ServerMismatch',
        ServerSelection: 'ServerSelection',
        ServerSignIn: 'ServerSignIn',
        ServerUpdateNeeded: 'ServerUpdateNeeded',
        SignedIn: 'SignedIn',
        Unavailable: 'Unavailable'
    },
    ServerConnections: {
        connect: connectionState.connect,
        currentApiClient: () => ({
            getCurrentUser: () => Promise.resolve({
                Policy: { IsAdministrator: connectionState.isAdministrator }
            }),
            isLoggedIn: () => connectionState.isLoggedIn,
            serverId: () => connectionState.serverId
        }),
        get firstConnection() {
            return connectionState.firstConnection;
        },
        set firstConnection(value: boolean) {
            connectionState.firstConnection = value;
        }
    }
}));

vi.mock('./ConnectionErrorPage', () => ({
    default: () => <div>Connection error</div>
}));

vi.mock('./loading/LoadingComponent', () => ({
    default: () => <div>Loading</div>
}));

import ConnectionRequired from './ConnectionRequired';

describe('ConnectionRequired admin access', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        connectionState.connect.mockReset();
        connectionState.firstConnection = true;
        connectionState.isAdministrator = false;
        connectionState.isLoggedIn = true;
        connectionState.serverId = 'server-one';
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        vi.unstubAllGlobals();
    });

    async function renderAdminRoute() {
        await act(async () => {
            root.render(
                <MemoryRouter
                    future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
                    initialEntries={[ '/dashboard/piggietv' ]}
                >
                    <Routes>
                        <Route element={<ConnectionRequired level='admin' />}>
                            <Route path='/dashboard/piggietv' element={<div>Dashboard content</div>} />
                        </Route>
                        <Route path='/home' element={<div>Home content</div>} />
                    </Routes>
                </MemoryRouter>
            );
            await Promise.resolve();
        });
    }

    it('redirects a signed-in non-admin directly home without reconnecting', async () => {
        await renderAdminRoute();

        expect(container.textContent).toContain('Home content');
        expect(connectionState.connect).not.toHaveBeenCalled();
    });

    it('renders the admin outlet for an administrator', async () => {
        connectionState.isAdministrator = true;

        await renderAdminRoute();

        expect(container.textContent).toContain('Dashboard content');
    });

    it('starts one authoritative connection attempt across a StrictMode effect replay', async () => {
        let resolveConnection!: (value: unknown) => void;

        connectionState.firstConnection = false;
        connectionState.isLoggedIn = false;
        connectionState.connect.mockReturnValue(new Promise(resolve => {
            resolveConnection = resolve;
        }));
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            json: () => Promise.resolve({ StartupWizardCompleted: true }),
            ok: true
        }));

        await act(async () => {
            root.render(
                <StrictMode>
                    <MemoryRouter
                        future={{ v7_relativeSplatPath: true, v7_startTransition: true }}
                        initialEntries={[ '/home' ]}
                    >
                        <Routes>
                            <Route element={<ConnectionRequired />}>
                                <Route path='/home' element={<div>Home content</div>} />
                            </Route>
                            <Route path='/login' element={<div>Login content</div>} />
                        </Routes>
                    </MemoryRouter>
                </StrictMode>
            );
            await Promise.resolve();
        });

        expect(connectionState.connect).toHaveBeenCalledTimes(1);

        await act(async () => {
            resolveConnection({
                ApiClient: {
                    serverAddress: () => 'https://jellyfin.test',
                    serverId: () => 'server-one'
                },
                State: 'ServerSignIn'
            });
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(container.textContent).toContain('Login content');
    });
});
