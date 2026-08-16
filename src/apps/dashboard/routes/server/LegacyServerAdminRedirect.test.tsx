import React, { act, useCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getNativeServerAdminRoute, LegacyServerAdminRedirect } from './LegacyServerAdminRedirect';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

function LocationWithBack() {
    const location = useLocation();
    const navigate = useNavigate();
    const handleBack = useCallback(() => navigate(-1), [ navigate ]);
    return (
        <>
            <output>{location.pathname}</output>
            <button onClick={handleBack} type='button'>Back</button>
        </>
    );
}

describe('legacy Server administration redirects', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    it.each([
        [ '/dashboard/settings', '/settings/admin/server/general' ],
        [ '/dashboard/branding', '/settings/admin/server/branding' ],
        [ '/dashboard/networking', '/settings/admin/server/networking' ],
        [ '/dashboard/keys', '/settings/admin/server/api-keys' ],
        [ '/dashboard/backups', '/settings/admin/server/backups' ],
        [ '/dashboard/logs', '/settings/admin/server/logs' ],
        [ '/dashboard/logs/server log.txt', '/settings/admin/server/logs/server%20log.txt' ]
    ])('maps %s to %s', (legacyRoute, nativeRoute) => {
        expect(getNativeServerAdminRoute(legacyRoute)).toBe(nativeRoute);
    });

    it('uses replacement history for compatibility navigation', async () => {
        await act(async () => root.render(
            <MemoryRouter initialEntries={[ '/before-server', '/dashboard/networking' ]} initialIndex={1}>
                <Routes>
                    <Route path='/dashboard/networking' element={<LegacyServerAdminRedirect />} />
                    <Route path='*' element={<LocationWithBack />} />
                </Routes>
            </MemoryRouter>
        ));

        expect(container.querySelector('output')?.textContent).toBe('/settings/admin/server/networking');
        await act(async () => container.querySelector<HTMLButtonElement>('button')?.click());
        expect(container.querySelector('output')?.textContent).toBe('/before-server');
    });
});
