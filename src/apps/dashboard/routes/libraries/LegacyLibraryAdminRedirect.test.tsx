import React, { act, useCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LegacyLibrariesRedirect } from './LegacyLibraryAdminRedirect';
import { Component as LegacyLibraryDisplayRedirect } from './display';
import { Component as LegacyLibraryMetadataRedirect } from './metadata';
import { Component as LegacyLibraryNfoRedirect } from './nfo';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

function CurrentLocation() {
    const location = useLocation();
    return <output>{`${location.pathname}${location.search}`}</output>;
}

function LocationWithBack() {
    const navigate = useNavigate();
    const handleBack = useCallback(() => navigate(-1), [navigate]);
    return (
        <>
            <CurrentLocation />
            <button onClick={handleBack} type='button'>Back</button>
        </>
    );
}

describe('legacy Libraries administration redirect', () => {
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

    it('redirects only the migrated Libraries landing route to the native workspace', async () => {
        await act(async () => root.render(
            <MemoryRouter initialEntries={[ '/dashboard/libraries' ]}>
                <Routes>
                    <Route path='/dashboard/libraries' element={<LegacyLibrariesRedirect />} />
                    <Route path='*' element={<CurrentLocation />} />
                </Routes>
            </MemoryRouter>
        ));

        expect(container.querySelector('output')?.textContent).toBe('/settings/admin/libraries');
    });

    it('redirects only the migrated Library Display route to its native workspace', async () => {
        await act(async () => root.render(
            <MemoryRouter initialEntries={[ '/before-display', '/dashboard/libraries/display' ]} initialIndex={1}>
                <Routes>
                    <Route path='/dashboard/libraries/display' element={<LegacyLibraryDisplayRedirect />} />
                    <Route path='*' element={<LocationWithBack />} />
                </Routes>
            </MemoryRouter>
        ));

        expect(container.querySelector('output')?.textContent).toBe('/settings/admin/libraries/display');

        await act(async () => container.querySelector<HTMLButtonElement>('button')?.click());
        expect(container.querySelector('output')?.textContent).toBe('/before-display');
    });

    it.each([
        [
            '/dashboard/libraries/metadata',
            '/settings/admin/libraries/metadata',
            LegacyLibraryMetadataRedirect
        ],
        [
            '/dashboard/libraries/nfo',
            '/settings/admin/libraries/nfo',
            LegacyLibraryNfoRedirect
        ]
    ])('replaces the migrated %s route without intercepting Metadata Manager', async (
        legacyRoute,
        nativeRoute,
        Redirect
    ) => {
        await act(async () => root.render(
            <MemoryRouter initialEntries={[ '/metadata', legacyRoute ]} initialIndex={1}>
                <Routes>
                    <Route path={legacyRoute} element={<Redirect />} />
                    <Route path='*' element={<LocationWithBack />} />
                </Routes>
            </MemoryRouter>
        ));

        expect(container.querySelector('output')?.textContent).toBe(nativeRoute);

        await act(async () => container.querySelector<HTMLButtonElement>('button')?.click());
        expect(container.querySelector('output')?.textContent).toBe('/metadata');
    });
});
