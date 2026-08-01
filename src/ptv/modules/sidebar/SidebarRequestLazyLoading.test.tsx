import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requestMocks = vi.hoisted(() => ({
    cancel: vi.fn(),
    open: vi.fn()
}));

vi.mock('../request/requestLoader', () => ({
    cancelPendingPtvRequestActivation: requestMocks.cancel,
    openPtvRequestPortal: requestMocks.open
}));

vi.mock('../../services/jellyfinLogoutAction', () => ({
    requestJellyfinLogout: vi.fn()
}));

vi.mock('../icons', () => ({
    PtvIcon: ({ name }: { name: string }) => <span data-icon={name} />
}));

import SidebarItem from './SidebarItem';

describe('PTV sidebar Request action', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        requestMocks.cancel.mockReset();
        requestMocks.open.mockReset();
        requestMocks.open.mockResolvedValue(true);
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        flushSync(() => root.unmount());
        container.remove();
    });

    it('loads and opens the Request portal only after activation', async () => {
        flushSync(() => root.render(
            <SidebarItem
                item={{
                    href: '#/home',
                    icon: 'request',
                    id: 'request',
                    label: 'Request'
                }}
            />
        ));

        expect(requestMocks.open).not.toHaveBeenCalled();

        container.querySelector<HTMLAnchorElement>('[data-ptv-request-trigger="true"]')?.click();

        await vi.waitFor(() => {
            expect(requestMocks.open).toHaveBeenCalledTimes(1);
        });
    });
});
