import React, { act, useCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LegacyPluginAdminRedirect } from './LegacyPluginAdminRedirect';

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

describe('legacy Plugin administration redirects', () => {
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
        [ '/dashboard/plugins', '/settings/admin/plugins/installed' ],
        [ '/dashboard/plugins/catalog', '/settings/admin/plugins/catalog' ],
        [ '/dashboard/plugins/repositories', '/settings/admin/plugins/repositories' ]
    ])('replaces %s with its exact native workspace', async (legacyRoute, nativeRoute) => {
        await act(async () => root.render(
            <MemoryRouter initialEntries={[ '/before-plugins', legacyRoute ]} initialIndex={1}>
                <Routes>
                    <Route path={legacyRoute} element={<LegacyPluginAdminRedirect />} />
                    <Route path='*' element={<LocationWithBack />} />
                </Routes>
            </MemoryRouter>
        ));

        expect(container.querySelector('output')?.textContent).toBe(nativeRoute);

        await act(async () => container.querySelector<HTMLButtonElement>('button')?.click());
        expect(container.querySelector('output')?.textContent).toBe('/before-plugins');
    });

    it('preserves and safely encodes the immutable plugin id for native detail', async () => {
        await act(async () => root.render(
            <MemoryRouter
                initialEntries={[ '/before-plugin', '/dashboard/plugins/plugin%20one?name=Untrusted' ]}
                initialIndex={1}
            >
                <Routes>
                    <Route path='/dashboard/plugins/:pluginId' element={<LegacyPluginAdminRedirect />} />
                    <Route path='*' element={<LocationWithBack />} />
                </Routes>
            </MemoryRouter>
        ));

        expect(container.querySelector('output')?.textContent).toBe('/settings/admin/plugins/plugin%20one');

        await act(async () => container.querySelector<HTMLButtonElement>('button')?.click());
        expect(container.querySelector('output')?.textContent).toBe('/before-plugin');
    });

    it('does not intercept the retained dynamic plugin configuration route', async () => {
        await act(async () => root.render(
            <MemoryRouter initialEntries={[ '/configurationpage?name=IntroSkipperConfig' ]}>
                <Routes>
                    <Route path='/dashboard/plugins/*' element={<LegacyPluginAdminRedirect />} />
                    <Route path='/configurationpage' element={<LocationWithBack />} />
                </Routes>
            </MemoryRouter>
        ));

        expect(container.querySelector('output')?.textContent).toBe('/configurationpage');
    });
});
