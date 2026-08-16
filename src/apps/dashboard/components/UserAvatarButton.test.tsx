import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('components/UserAvatar', () => ({
    default: () => <span>User avatar</span>
}));

import UserAvatarButton from './UserAvatarButton';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

describe('UserAvatarButton', () => {
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

    it('links administrators to the native user detail workspace', async () => {
        await act(async () => root.render(
            <MemoryRouter>
                <UserAvatarButton user={{ Id: 'member/a', Name: 'Alex' }} />
            </MemoryRouter>
        ));

        expect(container.querySelector('a')?.getAttribute('href')).toBe('/settings/admin/users/member%2Fa');
    });
});
