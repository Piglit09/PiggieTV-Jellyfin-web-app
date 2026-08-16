import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const logoutMocks = vi.hoisted(() => ({
    request: vi.fn<() => Promise<void>>(),
    switchUser: vi.fn<() => Promise<void>>()
}));

const runtimeMocks = vi.hoisted(() => ({
    registerShell: vi.fn(() => vi.fn())
}));

vi.mock('../services/jellyfinLogoutAction', () => ({
    requestJellyfinLogout: logoutMocks.request,
    requestJellyfinUserSwitch: logoutMocks.switchUser
}));

vi.mock('../services/notificationService', () => ({
    clearDismissiblePtvNotifications: vi.fn(),
    dismissPtvNotification: vi.fn(),
    getPtvNotificationSnapshot: vi.fn(() => ({
        duplicateSuppressionCount: 0,
        lastNotificationSource: 'none',
        notifications: [],
        subscriberCount: 0,
        totalCount: 0,
        unreadCount: 0
    })),
    hasPtvNotificationRetryHandler: vi.fn(() => false),
    markAllPtvNotificationsRead: vi.fn(),
    markPtvNotificationRead: vi.fn(),
    runPtvNotificationRetry: vi.fn(),
    subscribePtvNotifications: vi.fn(() => vi.fn())
}));

vi.mock('../services/performanceMonitor', () => ({
    incrementPtvPerformanceCounter: vi.fn()
}));

vi.mock('../services/runtimeStability', () => ({
    registerPtvNativeShellInstance: runtimeMocks.registerShell,
    runPtvClientCacheMigration: vi.fn()
}));

vi.mock('../core/observability', () => ({
    recordPtvEvent: vi.fn()
}));

vi.mock('../utils/usePtvAdminDebugVisibility', () => ({
    usePtvAdminDebugVisibility: vi.fn(() => ({ isAdmin: false }))
}));

vi.mock('./routeController', () => ({
    recordPtvRouteGenerationLifecycle: vi.fn()
}));

vi.mock('../modules/icons', () => ({
    PtvIcon: ({ name }: { name: string }) => <span data-icon={name} />
}));

import {
    getPtvRuntimeOverlayOcclusionCount,
    resetPtvRuntimeOverlayOcclusionsForTests
} from '../services/runtimeOverlayOcclusion';
import PTVShell, { PtvShellActions } from './PTVShell';

describe('PTV shell logout control', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        resetPtvRuntimeOverlayOcclusionsForTests();
        logoutMocks.request.mockReset();
        logoutMocks.request.mockResolvedValue(undefined);
        logoutMocks.switchUser.mockReset();
        logoutMocks.switchUser.mockResolvedValue(undefined);
        runtimeMocks.registerShell.mockClear();
        runtimeMocks.registerShell.mockImplementation(() => vi.fn());
        window.location.hash = '#/home';
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        flushSync(() => root.unmount());
        container.remove();
        resetPtvRuntimeOverlayOcclusionsForTests();
    });

    function renderUserMenu(onPanelToggle = vi.fn(), isAdmin = false) {
        flushSync(() => root.render(
            <PtvShellActions
                isAdmin={isAdmin}
                onPanelToggle={onPanelToggle}
                openPanel='user'
                searchExpanded={false}
            />
        ));

        return {
            button: container.querySelector<HTMLButtonElement>('[data-ptv-action="logout"]'),
            onPanelToggle
        };
    }

    it('renders Sign Out as an action and never navigates to an invalid logout hash', () => {
        const { button } = renderUserMenu();

        expect(button).not.toBeNull();
        expect(button?.tagName).toBe('BUTTON');
        expect(button?.getAttribute('href')).toBeNull();

        button?.click();

        expect(window.location.hash).toBe('#/home');
        expect(logoutMocks.request).toHaveBeenCalledTimes(1);
    });

    it('closes the user menu before invoking the authoritative logout adapter', () => {
        const onPanelToggle = vi.fn();
        const { button } = renderUserMenu(onPanelToggle);

        button?.click();

        expect(onPanelToggle).toHaveBeenCalledWith(null);
        expect(onPanelToggle.mock.invocationCallOrder[0])
            .toBeLessThan(logoutMocks.request.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER);
    });

    it('renders the premium user-menu order and routes Profile to the actual profile page', () => {
        renderUserMenu();

        const items = Array.from(container.querySelectorAll<HTMLElement>('#ptv-shell-user-panel [role="menuitem"]'));

        expect(items.map(item => item.textContent?.trim())).toEqual([
            'Profile',
            'Quick Connect',
            'Settings',
            'Sign Out'
        ]);
        expect(items[0]?.getAttribute('href')).toBe('#/settings/profile');
    });

    it('keeps the same focused menu for administrators', () => {
        renderUserMenu(vi.fn(), true);

        const labels = Array.from(container.querySelectorAll<HTMLElement>('#ptv-shell-user-panel [role="menuitem"]'))
            .map(item => item.textContent?.trim());

        expect(labels).toEqual(['Profile', 'Quick Connect', 'Settings', 'Sign Out']);
    });

    it('acquires and releases runtime occlusion with a real shell panel lifecycle', () => {
        const shellContainer = document.createElement('div');
        const shellRoot = createRoot(shellContainer);

        document.body.appendChild(shellContainer);
        flushSync(() => shellRoot.render(
            <PTVShell headerOnly>
                <div />
            </PTVShell>
        ));

        const userMenu = shellContainer.querySelector<HTMLButtonElement>('[aria-label="User menu"]')!;

        expect(getPtvRuntimeOverlayOcclusionCount()).toBe(0);
        flushSync(() => userMenu.click());
        expect(getPtvRuntimeOverlayOcclusionCount()).toBe(1);
        expect(document.documentElement.classList.contains('ptv-runtime-overlay-occluded')).toBe(true);

        flushSync(() => shellRoot.unmount());
        expect(getPtvRuntimeOverlayOcclusionCount()).toBe(0);
        expect(document.documentElement.classList.contains('ptv-runtime-overlay-occluded')).toBe(false);
        shellContainer.remove();
    });

    it('supports the shared fallback header without claiming native route ownership', () => {
        const onMenuClick = vi.fn();

        flushSync(() => root.render(
            <PTVShell
                headerOnly
                menuLabel='Open dashboard navigation'
                onMenuClick={onMenuClick}
                registerRuntimeShell={false}
            >
                <div />
            </PTVShell>
        ));

        container.querySelector<HTMLButtonElement>('[aria-label="Open dashboard navigation"]')?.click();

        expect(onMenuClick).toHaveBeenCalledTimes(1);
        expect(runtimeMocks.registerShell).not.toHaveBeenCalled();
    });

    it('marks the full-screen Music route so physical TV navigation can stay pinned', () => {
        window.location.hash = '#/music/player';

        flushSync(() => root.render(
            <PTVShell>
                <div />
            </PTVShell>
        ));

        expect(container.querySelector('.ptv-shell-frame-fullscreen-music')).not.toBeNull();
    });

    it('keeps the shell search field synchronized with the active Search page query', async () => {
        const renderShellSearch = (searchQuery: string) => flushSync(() => root.render(
            <PTVShell headerOnly searchQuery={searchQuery}>
                <div />
            </PTVShell>
        ));
        const getSearchInput = () => container.querySelector<HTMLInputElement>(
            'input[aria-label="Search PiggieTV"]'
        );

        renderShellSearch('Digimon');
        await vi.waitFor(() => expect(getSearchInput()?.value).toBe('Digimon'));

        renderShellSearch('Marvel');
        await vi.waitFor(() => expect(getSearchInput()?.value).toBe('Marvel'));

        renderShellSearch('');
        await vi.waitFor(() => expect(getSearchInput()?.value).toBe(''));
    });

    it.each([
        ['mouse click', (button: HTMLButtonElement) => {
            button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }],
        ['keyboard Enter synthesized click', (button: HTMLButtonElement) => {
            button.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
            button.click();
        }],
        ['remote OK synthesized click', (button: HTMLButtonElement) => {
            button.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'OK' }));
            button.click();
        }],
        ['pointer compatibility click', (button: HTMLButtonElement) => {
            button.dispatchEvent(new Event('pointerup', { bubbles: true }));
            button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }]
    ] as const)('routes %s through the same action control', (_label, activate) => {
        const { button } = renderUserMenu();

        if (button) activate(button);

        expect(logoutMocks.request).toHaveBeenCalledTimes(1);
        expect(window.location.hash).toBe('#/home');
    });
});
