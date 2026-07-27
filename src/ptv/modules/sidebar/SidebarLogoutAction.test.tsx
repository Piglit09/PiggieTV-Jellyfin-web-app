import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logoutMocks = vi.hoisted(() => ({
    request: vi.fn<() => Promise<void>>()
}));

vi.mock('../../services/jellyfinLogoutAction', () => ({
    requestJellyfinLogout: logoutMocks.request
}));

vi.mock('../../core/events', () => ({
    dispatchPtvCustomEvent: vi.fn()
}));

vi.mock('../request', () => ({
    openRequestPortal: vi.fn()
}));

vi.mock('../icons', () => ({
    PtvIcon: ({ name }: { name: string }) => <span data-icon={name} />
}));

import SidebarItem from './SidebarItem';

describe('PTV sidebar logout action', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        logoutMocks.request.mockReset();
        logoutMocks.request.mockResolvedValue(undefined);
        window.location.hash = '#/movies';
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        flushSync(() => root.unmount());
        container.remove();
    });

    it('uses a semantic action, closes the sidebar, and leaves routing to Jellyfin', () => {
        const onAction = vi.fn();

        flushSync(() => root.render(
            <SidebarItem
                item={{
                    action: 'logout',
                    icon: 'signout',
                    id: 'signout',
                    label: 'Sign Out'
                }}
                onAction={onAction}
            />
        ));
        const button = container.querySelector<HTMLButtonElement>('[data-ptv-action="logout"]');

        expect(button?.tagName).toBe('BUTTON');
        expect(button?.getAttribute('href')).toBeNull();

        button?.click();

        expect(onAction).toHaveBeenCalledTimes(1);
        expect(logoutMocks.request).toHaveBeenCalledTimes(1);
        expect(window.location.hash).toBe('#/movies');
    });
});
