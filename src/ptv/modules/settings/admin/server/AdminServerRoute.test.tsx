import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./PtvAdminServerPage', () => ({
    default: ({ route }: Readonly<{ route: { logFileName: string | null; section: string } }>) => (
        <div data-log-file={route.logFileName || ''} data-section={route.section}>Server workspace</div>
    )
}));

import AdminServerRoute, {
    ADMIN_SERVER_BASE_PATH,
    readAdminServerRoute
} from './AdminServerRoute';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

function LocationProbe() {
    const location = useLocation();
    return <output data-pathname={location.pathname} />;
}

describe('native Server Administration route', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('normalizes the workspace root to General and redirects it to the canonical URL', async () => {
        expect(ADMIN_SERVER_BASE_PATH).toBe('/settings/admin/server');
        expect(readAdminServerRoute(ADMIN_SERVER_BASE_PATH)).toEqual({
            logFileName: null,
            section: 'general'
        });
        expect(readAdminServerRoute(`${ADMIN_SERVER_BASE_PATH}/`)).toEqual({
            logFileName: null,
            section: 'general'
        });

        await act(async () => {
            root.render(
                <MemoryRouter initialEntries={[ ADMIN_SERVER_BASE_PATH ]}>
                    <AdminServerRoute />
                    <LocationProbe />
                </MemoryRouter>
            );
        });

        expect(container.querySelector('output')?.getAttribute('data-pathname'))
            .toBe(`${ADMIN_SERVER_BASE_PATH}/general`);
        expect(container.querySelector('[data-section="general"]')).toBeTruthy();
    });

    it.each([
        [ 'general', { logFileName: null, section: 'general' } ],
        [ 'branding', { logFileName: null, section: 'branding' } ],
        [ 'networking', { logFileName: null, section: 'networking' } ],
        [ 'api-keys', { logFileName: null, section: 'api-keys' } ],
        [ 'backups', { logFileName: null, section: 'backups' } ],
        [ 'logs', { logFileName: null, section: 'logs' } ]
    ])('resolves the %s workspace', (path, expected) => {
        expect(readAdminServerRoute(`${ADMIN_SERVER_BASE_PATH}/${path}`)).toEqual(expected);
    });

    it('decodes one exact deep log filename without changing its safe characters', () => {
        expect(readAdminServerRoute(
            `${ADMIN_SERVER_BASE_PATH}/logs/jellyfin%20server%202026-08-13.log`
        )).toEqual({
            logFileName: 'jellyfin server 2026-08-13.log',
            section: 'logs'
        });
    });

    it.each([
        '/settings/admin',
        '/settings/admin/server-ish',
        '/settings/admin/server/unknown',
        '/settings/admin/server/general/extra',
        '/settings/admin/server/logs/archive/server.log',
        '/settings/admin/server/logs/archive%2Fserver.log',
        '/settings/admin/server/logs/archive%5Cserver.log',
        '/settings/admin/server/logs/archive%00server.log',
        '/settings/admin/server/logs/%'
    ])('rejects invalid server route %s', pathname => {
        expect(readAdminServerRoute(pathname)).toBeNull();
    });
});
