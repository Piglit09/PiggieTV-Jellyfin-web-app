import React, { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    LegacyAddUserRedirect,
    LegacyUserAccessRedirect,
    LegacyUserPasswordRedirect,
    LegacyUserProfileRedirect,
    LegacyUsersRedirect
} from './LegacyUserAdminRedirect';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

function CurrentLocation() {
    const location = useLocation();
    return <output>{`${location.pathname}${location.search}`}</output>;
}

describe('legacy user administration redirects', () => {
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

    async function renderRedirect(element: ReactElement, initialEntry: string) {
        await act(async () => root.render(
            <MemoryRouter key={initialEntry} initialEntries={[ initialEntry ]}>
                <Routes>
                    <Route path='/dashboard/users/*' element={element} />
                    <Route path='*' element={<CurrentLocation />} />
                </Routes>
            </MemoryRouter>
        ));
    }

    it('redirects the legacy list and add routes to native Users', async () => {
        await renderRedirect(<LegacyUsersRedirect />, '/dashboard/users');
        expect(container.querySelector('output')?.textContent).toBe('/settings/admin/users');

        await renderRedirect(<LegacyAddUserRedirect />, '/dashboard/users/add');
        expect(container.querySelector('output')?.textContent).toBe('/settings/admin/users?action=add');
    });

    it('preserves a legacy user id on profile and contextual redirects', async () => {
        await renderRedirect(<LegacyUserProfileRedirect />, '/dashboard/users/profile?userId=member-a');
        expect(container.querySelector('output')?.textContent).toBe('/settings/admin/users/member-a');

        await renderRedirect(<LegacyUserAccessRedirect />, '/dashboard/users/access?userId=member-a');
        expect(container.querySelector('output')?.textContent).toBe('/settings/admin/users/member-a?panel=access');

        await renderRedirect(<LegacyUserPasswordRedirect />, '/dashboard/users/password?userId=member-a');
        expect(container.querySelector('output')?.textContent).toBe('/settings/admin/users/member-a?panel=security');
    });

    it('falls back to the native list when a legacy detail route has no user id', async () => {
        await renderRedirect(<LegacyUserProfileRedirect />, '/dashboard/users/profile');
        expect(container.querySelector('output')?.textContent).toBe('/settings/admin/users');
    });
});
