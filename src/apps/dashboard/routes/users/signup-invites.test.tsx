import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Component } from './signup-invites';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

function LocationState() {
    const location = useLocation();
    const navigationType = useNavigationType();
    return <output>{`${location.pathname}|${navigationType}`}</output>;
}

describe('legacy Signup & Invites redirect', () => {
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

    it('replaces only the exact legacy route with the native workspace', async () => {
        await act(async () => root.render(
            <MemoryRouter initialEntries={[ '/dashboard/users/signup-invites' ]}>
                <Routes>
                    <Route path='/dashboard/users/signup-invites' element={<Component />} />
                    <Route path='*' element={<LocationState />} />
                </Routes>
            </MemoryRouter>
        ));

        expect(container.querySelector('output')?.textContent).toBe('/settings/admin/users/signup-invites|REPLACE');
    });
});
