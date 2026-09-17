import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const layoutMocks = vi.hoisted(() => ({
    configurationPages: [] as Array<{
        DisplayName?: string;
        EnableInMainMenu?: boolean;
        Name?: string;
        PluginId?: string;
    }>
}));

vi.mock('../../icons/PtvIcon', () => ({
    default: ({ name }: Readonly<{ name: string }>) => <span data-icon={name} />
}));
vi.mock('./useAdminNavigation', async () => {
    const navigation = await vi.importActual<typeof import('./adminNavigation')>('./adminNavigation');

    return {
        usePtvAdminNavigation: () => {
            const dynamicPluginDestinations = navigation.createDynamicPluginDestinations(layoutMocks.configurationPages);
            const allDestinations = [ ...navigation.PTV_ADMIN_DESTINATIONS, ...dynamicPluginDestinations ];
            return {
                dynamicPluginDestinations,
                groups: navigation.PTV_ADMIN_CATEGORIES.map(category => ({
                    category,
                    destinations: allDestinations.filter(destination => destination.category === category.id)
                })),
                isPluginNavigationError: false,
                isPluginNavigationPending: layoutMocks.configurationPages.length === 0,
                retryPluginNavigation: vi.fn().mockResolvedValue({})
            };
        }
    };
});

import PtvAdminLayout from './PtvAdminLayout';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

describe('PTV administration layout', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        sessionStorage.clear();
        layoutMocks.configurationPages = [];
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        vi.unstubAllGlobals();
        container.remove();
    });

    async function renderLayout({
        currentDestinationId = 'overview',
        initialEntry = '/settings/admin'
    }: Readonly<{
        currentDestinationId?: string;
        initialEntry?: string;
    }> = {}) {
        await act(async () => root.render(
            <MemoryRouter initialEntries={[ initialEntry ]}>
                <PtvAdminLayout currentDestinationId={currentDestinationId}>
                    <div>Dashboard content</div>
                </PtvAdminLayout>
            </MemoryRouter>
        ));
    }

    it('renders complete grouped navigation while keeping sections collapsible', async () => {
        await renderLayout();

        const administration = container.querySelector('nav[aria-label="Administration"]');
        expect(administration).not.toBeNull();
        expect(administration?.querySelector('a[href="/settings/admin"]')?.textContent).toContain('Overview');

        const peopleToggle = administration?.querySelector<HTMLButtonElement>('[data-admin-category="people"] .ptv-admin-group-toggle');
        expect(peopleToggle?.getAttribute('aria-expanded')).toBe('false');

        await act(async () => peopleToggle?.click());

        expect(peopleToggle?.getAttribute('aria-expanded')).toBe('true');
        expect(administration?.querySelector('a[href="/settings/admin/users"]')?.textContent).toContain('Users');
        expect(administration?.querySelector('a[href="/settings/admin/users/signup-invites"]')?.textContent).toContain('Signup & Invites');
        expect(sessionStorage.getItem('ptv-admin-expanded-groups')).toContain('people');
    });

    it('marks native Playback current and automatically expands its group for a section route', async () => {
        await renderLayout({ currentDestinationId: 'playback', initialEntry: '/settings/admin/playback/transcoding' });

        const playbackGroup = container.querySelector('[data-admin-category="playback"]');
        expect(playbackGroup?.querySelector('.ptv-admin-group-toggle')?.getAttribute('aria-expanded')).toBe('true');
        expect(playbackGroup?.querySelector('a[aria-current="page"]')?.textContent).toContain('Playback');
        expect(playbackGroup?.querySelector('a[href="/settings/admin/playback"]')).not.toBeNull();
        expect(container.querySelector('.ptv-admin-mobile-context')?.textContent).toContain('Playback');
    });

    it.each([
        [ '/settings/admin/piggietv', 'PiggieTV Configuration' ],
        [ '/settings/admin/piggietv/rows', 'Home Rows' ],
        [ '/settings/admin/piggietv/diagnostics', 'Diagnostics' ]
    ])('highlights the native PiggieTV destination for %s', async (initialEntry, label) => {
        await renderLayout({ currentDestinationId: '', initialEntry });

        const piggietvGroup = container.querySelector('[data-admin-category="piggietv"]');
        expect(piggietvGroup?.querySelector('.ptv-admin-group-toggle')?.getAttribute('aria-expanded')).toBe('true');
        expect(piggietvGroup?.querySelector('a[aria-current="page"]')?.textContent).toContain(label);
        expect(container.querySelector('.ptv-admin-mobile-context')?.textContent).toContain(label);
    });

    it('marks a directly loaded native Scheduled Task detail current and expands Server', async () => {
        await renderLayout({ currentDestinationId: '', initialEntry: '/settings/admin/tasks/task-a' });

        const serverGroup = container.querySelector('[data-admin-category="server"]');
        expect(serverGroup?.querySelector('.ptv-admin-group-toggle')?.getAttribute('aria-expanded')).toBe('true');
        expect(serverGroup?.querySelector('a[aria-current="page"]')?.textContent).toContain('Scheduled Tasks');
        expect(serverGroup?.querySelector('a[href="/settings/admin/tasks"]')).not.toBeNull();
        expect(container.querySelector('.ptv-admin-mobile-context')?.textContent).toContain('Scheduled Tasks');
    });

    it('highlights native Server sections and log detail routes from location', async () => {
        await renderLayout({ currentDestinationId: '', initialEntry: '/settings/admin/server/logs/server.log' });

        const serverGroup = container.querySelector('[data-admin-category="server"]');
        expect(serverGroup?.querySelector('.ptv-admin-group-toggle')?.getAttribute('aria-expanded')).toBe('true');
        expect(serverGroup?.querySelector('a[aria-current="page"]')?.textContent).toContain('Logs');
        expect(serverGroup?.querySelector('a[href="/settings/admin/server/logs"]')).not.toBeNull();
        expect(container.querySelector('.ptv-admin-mobile-context')?.textContent).toContain('Logs');
    });

    it('marks a directly loaded native user detail destination current', async () => {
        await renderLayout({ currentDestinationId: '', initialEntry: '/settings/admin/users/member-a' });

        const peopleGroup = container.querySelector('[data-admin-category="people"]');
        expect(peopleGroup?.querySelector('.ptv-admin-group-toggle')?.getAttribute('aria-expanded')).toBe('true');
        expect(peopleGroup?.querySelector('a[aria-current="page"]')?.textContent).toContain('Users');
    });

    it('marks the native Signup & Invites workspace current', async () => {
        await renderLayout({ currentDestinationId: '', initialEntry: '/settings/admin/users/signup-invites' });

        const peopleGroup = container.querySelector('[data-admin-category="people"]');
        expect(peopleGroup?.querySelector('.ptv-admin-group-toggle')?.getAttribute('aria-expanded')).toBe('true');
        expect(peopleGroup?.querySelector('a[aria-current="page"]')?.textContent).toContain('Signup & Invites');
        expect(peopleGroup?.querySelector('a[href="/settings/admin/users/signup-invites"]')).not.toBeNull();
        expect(container.querySelector('.ptv-admin-mobile-context')?.textContent).toContain('Signup & Invites');
    });

    it('highlights native Library Display and automatically expands Media', async () => {
        await renderLayout({
            currentDestinationId: '',
            initialEntry: '/settings/admin/libraries/display'
        });

        const mediaGroup = container.querySelector('[data-admin-category="media"]');
        expect(mediaGroup?.querySelector('.ptv-admin-group-toggle')?.getAttribute('aria-expanded')).toBe('true');
        expect(mediaGroup?.querySelector('a[aria-current="page"]')?.textContent).toContain('Library Display');
        expect(mediaGroup?.querySelector('a[href="/settings/admin/libraries/display"]')).not.toBeNull();
        expect(container.querySelector('.ptv-admin-mobile-context')?.textContent).toContain('Library Display');
    });

    it.each([
        [ '/settings/admin/libraries/metadata', 'Metadata', '/settings/admin/libraries/metadata' ],
        [ '/settings/admin/libraries/nfo', 'NFO Settings', '/settings/admin/libraries/nfo' ],
        [ '/settings/admin/media/metadata-quality/item-a', 'Metadata Quality', '/settings/admin/media/metadata-quality' ],
        [ '/settings/admin/media/metadata-manager/item-a', 'Metadata Manager', '/settings/admin/media/metadata-manager' ]
    ])('highlights the native Media destination for %s', async (initialEntry, label, href) => {
        await renderLayout({ currentDestinationId: '', initialEntry });

        const mediaGroup = container.querySelector('[data-admin-category="media"]');
        expect(mediaGroup?.querySelector('.ptv-admin-group-toggle')?.getAttribute('aria-expanded')).toBe('true');
        expect(mediaGroup?.querySelector('a[aria-current="page"]')?.textContent).toContain(label);
        expect(mediaGroup?.querySelector(`a[href="${href}"]`)).not.toBeNull();
        expect(container.querySelector('.ptv-admin-mobile-context')?.textContent).toContain(label);
    });

    it('inserts safely normalized dynamic plugin configuration pages under Plugins', async () => {
        layoutMocks.configurationPages = [
            {
                DisplayName: 'Intro Skipper',
                EnableInMainMenu: true,
                Name: 'IntroSkipperConfig',
                PluginId: 'intro'
            },
            {
                DisplayName: 'A Very Long Plugin Administration Configuration Page Title',
                EnableInMainMenu: true,
                Name: 'Long Plugin',
                PluginId: 'long'
            }
        ];

        await renderLayout({ currentDestinationId: 'plugin-manager' });

        const pluginGroup = container.querySelector('[data-admin-category="plugins"]');
        expect(pluginGroup?.textContent).toContain('Plugin Manager');
        expect(pluginGroup?.textContent).toContain('Intro Skipper');
        expect(pluginGroup?.textContent).toContain('A Very Long Plugin Administration Configuration Page Title');
        expect(pluginGroup?.querySelector('a[href="#/configurationpage?name=IntroSkipperConfig"]')).not.toBeNull();
        expect(pluginGroup?.querySelector('a[href="#/configurationpage?name=Long%20Plugin"]')).not.toBeNull();
    });

    it('expands and highlights a directly loaded dynamic plugin page', async () => {
        layoutMocks.configurationPages = [ {
            DisplayName: 'Intro Skipper',
            EnableInMainMenu: true,
            Name: 'IntroSkipperConfig',
            PluginId: 'intro'
        } ];

        await renderLayout({ currentDestinationId: '', initialEntry: '/configurationpage?name=IntroSkipperConfig' });

        const pluginGroup = container.querySelector('[data-admin-category="plugins"]');
        expect(pluginGroup?.querySelector('.ptv-admin-group-toggle')?.getAttribute('aria-expanded')).toBe('true');
        expect(pluginGroup?.querySelector('a[aria-current="page"]')?.textContent).toContain('Intro Skipper');
    });

    it('keeps Plugin Manager available when plugin discovery has no data', async () => {
        await renderLayout({ currentDestinationId: 'plugin-manager' });

        const pluginGroup = container.querySelector('[data-admin-category="plugins"]');
        expect(pluginGroup?.querySelector('a[href="/settings/admin/plugins"]')).not.toBeNull();
        expect(pluginGroup?.textContent).toContain('Discovering plugin pages');
    });

    it('highlights native Plugin Manager tabs and detail routes', async () => {
        await renderLayout({ currentDestinationId: '', initialEntry: '/settings/admin/plugins/plugin-a' });

        const pluginGroup = container.querySelector('[data-admin-category="plugins"]');
        expect(pluginGroup?.querySelector('.ptv-admin-group-toggle')?.getAttribute('aria-expanded')).toBe('true');
        expect(pluginGroup?.querySelector('a[aria-current="page"]')?.textContent).toContain('Plugin Manager');
        expect(pluginGroup?.querySelector('a[href="/settings/admin/plugins"]')).not.toBeNull();
        expect(container.querySelector('.ptv-admin-mobile-context')?.textContent).toContain('Plugin Manager');
    });

    it('opens a complete mobile administration drawer and closes it after navigation', async () => {
        await renderLayout();

        const menuButton = container.querySelector<HTMLButtonElement>('.ptv-admin-mobile-menu-button');
        expect(menuButton?.getAttribute('aria-expanded')).toBe('false');

        await act(async () => menuButton?.click());

        const drawer = container.querySelector('#ptv-admin-mobile-navigation');
        expect(menuButton?.getAttribute('aria-expanded')).toBe('true');
        expect(drawer?.textContent).toContain('Administration');
        expect(drawer?.querySelector('[data-admin-category="server"]')).not.toBeNull();

        const closeButton = drawer?.querySelector<HTMLButtonElement>('button[aria-label="Close administration navigation"]');
        await act(async () => closeButton?.click());
        expect(container.querySelector('#ptv-admin-mobile-navigation')).toBeNull();
    });

    it('keeps keyboard focus inside the open mobile navigation dialog', async () => {
        await renderLayout();

        const menuButton = container.querySelector<HTMLButtonElement>('.ptv-admin-mobile-menu-button');
        await act(async () => menuButton?.click());

        const drawer = container.querySelector<HTMLElement>('#ptv-admin-mobile-navigation');
        const focusable = Array.from(drawer?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') || []);
        const first = focusable[0];
        const last = focusable.at(-1);

        expect(document.activeElement).toBe(first);
        await act(async () => {
            first?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab', shiftKey: true }));
        });
        expect(document.activeElement).toBe(last);

        await act(async () => {
            last?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab' }));
        });
        expect(document.activeElement).toBe(first);
    });

    it('opens the mobile drawer when a Management category launcher is selected', async () => {
        vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));

        await renderLayout({ initialEntry: '/settings/admin?section=media' });

        expect(container.querySelector('#ptv-admin-mobile-navigation')).not.toBeNull();
        expect(container.querySelector('[data-admin-category="media"] .ptv-admin-group-toggle')?.getAttribute('aria-expanded')).toBe('true');
    });
});
