import React, { act, useCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getNativeLiveTvAdminRoute, LegacyLiveTvAdminRedirect } from './LegacyLiveTvAdminRedirect';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

function LocationWithBack() {
    const location = useLocation();
    const navigate = useNavigate();
    const handleBack = useCallback(() => navigate(-1), [ navigate ]);
    return (
        <>
            <output>{`${location.pathname}${location.search}`}</output>
            <button onClick={handleBack} type='button'>Back</button>
        </>
    );
}

describe('legacy Live TV administration redirects', () => {
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
        [ '/dashboard/livetv', '', '/settings/admin/livetv' ],
        [ '/dashboard/livetv/recordings', '', '/settings/admin/livetv/dvr' ],
        [ '/dashboard/livetv/tuner', '?id=tuner one', '/settings/admin/livetv/tuners/tuner%20one' ],
        [ '/dashboard/livetv/tuner', '', '/settings/admin/livetv/tuners/new' ],
        [ '/dashboard/livetv/guide', '?id=guide one', '/settings/admin/livetv/guide/guide%20one' ],
        [ '/dashboard/livetv/guide', '?type=xmltv', '/settings/admin/livetv/guide/new?type=xmltv' ],
        [ '/dashboard/livetv/guide', '?type=schedulesdirect', '/settings/admin/livetv/guide/new?type=schedulesdirect' ]
    ])('maps %s%s to %s', (pathname, search, expected) => {
        expect(getNativeLiveTvAdminRoute(pathname, search)).toBe(expected);
    });

    it('uses replacement navigation for the exact compatibility route', async () => {
        await act(async () => root.render(
            <MemoryRouter initialEntries={[ '/before', '/dashboard/livetv/recordings' ]} initialIndex={1}>
                <Routes>
                    <Route path='/dashboard/livetv/recordings' element={<LegacyLiveTvAdminRedirect />} />
                    <Route path='*' element={<LocationWithBack />} />
                </Routes>
            </MemoryRouter>
        ));

        expect(container.querySelector('output')?.textContent).toBe('/settings/admin/livetv/dvr');

        await act(async () => container.querySelector<HTMLButtonElement>('button')?.click());
        expect(container.querySelector('output')?.textContent).toBe('/before');
    });
});
