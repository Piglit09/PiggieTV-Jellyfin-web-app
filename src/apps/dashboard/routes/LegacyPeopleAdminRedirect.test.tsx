import React, { act, type ReactElement, useCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Component as LegacyActivityRedirect } from './activity';
import { Component as LegacyDevicesRedirect } from './devices';

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

describe('legacy People administration redirects', () => {
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

    async function renderRedirect(element: ReactElement, route: string, initialEntry: string) {
        await act(async () => root.render(
            <MemoryRouter
                key={initialEntry}
                initialEntries={[ '/before-people', initialEntry ]}
                initialIndex={1}
            >
                <Routes>
                    <Route path={route} element={element} />
                    <Route path='*' element={<LocationWithBack />} />
                </Routes>
            </MemoryRouter>
        ));
    }

    it('replaces Devices with the native route and drops legacy query parameters', async () => {
        await renderRedirect(
            <LegacyDevicesRedirect />,
            '/dashboard/devices',
            '/dashboard/devices?userId=member-a&search=tv'
        );

        expect(container.querySelector('output')?.textContent).toBe('/settings/admin/devices');

        await act(async () => container.querySelector<HTMLButtonElement>('button')?.click());
        expect(container.querySelector('output')?.textContent).toBe('/before-people');
    });

    it.each([
        [ 'true', 'user' ],
        [ 'false', 'system' ]
    ])('maps legacy useractivity=%s to the native %s view', async (legacyView, nativeView) => {
        await renderRedirect(
            <LegacyActivityRedirect />,
            '/dashboard/activity',
            `/dashboard/activity?useractivity=${legacyView}&unsupported=value`
        );

        expect(container.querySelector('output')?.textContent)
            .toBe(`/settings/admin/activity?view=${nativeView}`);
    });

    it.each([
        '/dashboard/activity',
        '/dashboard/activity?useractivity=invalid',
        '/dashboard/activity?useractivity=TRUE',
        '/dashboard/activity?useractivity=true&useractivity=false',
        '/dashboard/activity?userId=member-a&search=login'
    ])('drops unsupported or invalid Activity query state from %s', async initialEntry => {
        await renderRedirect(
            <LegacyActivityRedirect />,
            '/dashboard/activity',
            initialEntry
        );

        expect(container.querySelector('output')?.textContent).toBe('/settings/admin/activity');
    });

    it('uses replacement history for the Activity route', async () => {
        await renderRedirect(
            <LegacyActivityRedirect />,
            '/dashboard/activity',
            '/dashboard/activity?useractivity=true'
        );

        await act(async () => container.querySelector<HTMLButtonElement>('button')?.click());
        expect(container.querySelector('output')?.textContent).toBe('/before-people');
    });
});
