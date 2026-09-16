import React, { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const ROUTER_FUTURE = { v7_relativeSplatPath: true, v7_startTransition: true } as const;
/* eslint-enable @typescript-eslint/naming-convention */

const connectionState = vi.hoisted(() => ({
    connect: vi.fn(),
    firstConnection: true,
    getCurrentUser: vi.fn(),
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
            getCurrentUser: connectionState.getCurrentUser,
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
        connectionState.getCurrentUser.mockReset();
        connectionState.getCurrentUser.mockImplementation(() => Promise.resolve({
            Policy: { IsAdministrator: connectionState.isAdministrator }
        }));
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
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    async function renderAdminRoute(initialEntry = '/dashboard/piggietv') {
        await act(async () => {
            root.render(
                <MemoryRouter
                    future={ROUTER_FUTURE}
                    initialEntries={[ initialEntry ]}
                >
                    <Routes>
                        <Route element={<ConnectionRequired level='admin' />}>
                            <Route path='/dashboard/*' element={<div>Dashboard content</div>} />
                            <Route path='/configurationpage' element={<div>Plugin configuration content</div>} />
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

    it.each([
        '/dashboard/piggietv',
        '/configurationpage?name=plugin-a'
    ])('fails closed for retained administration route %s when policy lookup fails', async initialEntry => {
        connectionState.getCurrentUser.mockRejectedValue(new Error('policy unavailable'));

        await renderAdminRoute(initialEntry);

        expect(container.textContent).toContain('Loading');
        expect(container.textContent).not.toContain('Dashboard content');
        expect(container.textContent).not.toContain('Plugin configuration content');
        expect(connectionState.getCurrentUser).toHaveBeenCalledOnce();
    });

    it('fails closed without exposing authenticated policy errors to console output', async () => {
        const accessCanary = [ 'PTV_TEST', 'ACCESS_TOKEN', 'connection-required' ].join('_');
        const consoleSpies = ([ 'debug', 'error', 'info', 'log', 'warn' ] as const).map(level => (
            vi.spyOn(console, level).mockImplementation(() => undefined)
        ));
        connectionState.getCurrentUser.mockRejectedValue(Object.assign(
            new Error(`policy request failed?api_key=${accessCanary}`),
            { config: { headers: { Authorization: `Bearer ${accessCanary}` } } }
        ));

        await renderAdminRoute();

        expect(container.textContent).toContain('Loading');
        const consoleOutput = JSON.stringify(consoleSpies.flatMap(spy => spy.mock.calls));
        expect(consoleOutput).not.toContain(accessCanary);
        expect(consoleOutput).toContain('[REDACTED]');
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
                        future={ROUTER_FUTURE}
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
