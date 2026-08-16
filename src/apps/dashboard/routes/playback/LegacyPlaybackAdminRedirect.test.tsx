import React, { act, useCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Component as LegacyResumeRedirect } from './resume';
import { Component as LegacyStreamingRedirect } from './streaming';
import { Component as LegacyTranscodingRedirect } from './transcoding';
import { Component as LegacyTrickplayRedirect } from './trickplay';

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

describe('legacy Playback administration redirects', () => {
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
        [ 'streaming', LegacyStreamingRedirect ],
        [ 'transcoding', LegacyTranscodingRedirect ],
        [ 'resume', LegacyResumeRedirect ],
        [ 'trickplay', LegacyTrickplayRedirect ]
    ])('replaces the legacy %s route with its native section', async (section, Redirect) => {
        const legacyRoute = `/dashboard/playback/${section}`;
        const nativeRoute = `/settings/admin/playback/${section}`;

        await act(async () => root.render(
            <MemoryRouter initialEntries={[ '/before-playback', legacyRoute ]} initialIndex={1}>
                <Routes>
                    <Route path={legacyRoute} element={<Redirect />} />
                    <Route path='*' element={<LocationWithBack />} />
                </Routes>
            </MemoryRouter>
        ));

        expect(container.querySelector('output')?.textContent).toBe(nativeRoute);

        await act(async () => container.querySelector<HTMLButtonElement>('button')?.click());
        expect(container.querySelector('output')?.textContent).toBe('/before-playback');
    });
});
