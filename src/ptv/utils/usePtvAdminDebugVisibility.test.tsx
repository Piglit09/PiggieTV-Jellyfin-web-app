import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServerConnections } from 'lib/jellyfin-apiclient';
import Events from '../../utils/events';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const authState = vi.hoisted(() => ({
    user: null as null | { Id: string; Policy: { IsAdministrator: boolean } }
}));

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {}
}));

vi.mock('../api', () => ({
    getPtvCurrentUser: vi.fn(() => Promise.resolve(authState.user)),
    isPtvAdminUser: (user: typeof authState.user) => Boolean(user?.Policy.IsAdministrator)
}));

vi.mock('../core/config', () => ({
    // eslint-disable-next-line @typescript-eslint/naming-convention
    PTV_EVENTS: { debugChange: 'ptv:debugchange' }
}));

vi.mock('../core/observability', () => ({
    isPtvDebugEnabled: () => false,
    recordPtvEvent: vi.fn(),
    setPtvDebugAdminAccess: vi.fn()
}));

import {
    invalidatePtvAdminDebugAccess,
    usePtvAdminDebugVisibility
} from './usePtvAdminDebugVisibility';

function AdminVisibilityFixture() {
    const { isAdmin } = usePtvAdminDebugVisibility();

    return <div data-admin={String(isAdmin)} />;
}

describe('PTV administrator shell visibility', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        authState.user = null;
        invalidatePtvAdminDebugAccess();
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => {
            root.unmount();
        });
        container.remove();
        invalidatePtvAdminDebugAccess();
    });

    it('rechecks a shell mounted before authentication when sign-in completes', async () => {
        await act(async () => {
            root.render(<AdminVisibilityFixture />);
        });
        expect(container.firstElementChild?.getAttribute('data-admin')).toBe('false');

        authState.user = {
            Id: 'administrator',
            Policy: { IsAdministrator: true }
        };

        await act(async () => {
            Events.trigger(ServerConnections, 'localusersignedin');
        });

        expect(container.firstElementChild?.getAttribute('data-admin')).toBe('true');
    });

    it('removes administrator controls immediately after sign-out', async () => {
        authState.user = {
            Id: 'administrator',
            Policy: { IsAdministrator: true }
        };

        await act(async () => {
            root.render(<AdminVisibilityFixture />);
        });
        expect(container.firstElementChild?.getAttribute('data-admin')).toBe('true');

        await act(async () => {
            Events.trigger(ServerConnections, 'localusersignedout');
        });

        expect(container.firstElementChild?.getAttribute('data-admin')).toBe('false');
    });
});
