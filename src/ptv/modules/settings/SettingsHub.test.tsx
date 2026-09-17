import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/jellyfinLogoutAction', () => ({
    requestJellyfinLogout: vi.fn()
}));

import SettingsHub from './SettingsHub';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

describe('Settings hub permissions', () => {
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

    async function renderHub(isAdministrator: boolean) {
        await act(async () => root.render(
            <MemoryRouter>
                <SettingsHub email='alex@example.com' isAdministrator={isAdministrator} username='Alex' />
            </MemoryRouter>
        ));
    }

    it('keeps administration out of a member settings hub', async () => {
        await renderHub(false);
        expect(container.textContent).not.toContain('PTV Administration');
        expect(container.textContent).not.toContain('Media Management');
    });

    it('shows administration for an administrator', async () => {
        await renderHub(true);
        expect(container.textContent).toContain('PTV Administration');
        expect(container.textContent).toContain('Media Management');
    });
});
