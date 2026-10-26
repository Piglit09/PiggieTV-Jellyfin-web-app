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

const calendarAvailabilityMocks = vi.hoisted(() => ({
    snapshot: {
        capabilityAvailable: false,
        configuredServices: [] as string[],
        error: '',
        identityKey: 'server:user',
        showEntry: false,
        status: String('not-configured')
    }
}));
const navigationAccessMocks = vi.hoisted(() => ({ mode: 'full' as
    'full' | 'restricted' | 'loading' | 'collectionsOnly' | 'movieA' | 'showA'
    | 'otherMovies' | 'otherShows' | 'booksOnly' | 'comicsOnly' }));
const adminVisibilityMocks = vi.hoisted(() => ({ isAdmin: false }));
const notificationMocks = vi.hoisted(() => ({
    notifications: [] as Array<Record<string, unknown>>
}));

vi.mock('./usePtvNavigationAccess', () => ({
    usePtvNavigationAccess: () => {
        const restrictedAccess = {
            collections: false,
            isAdmin: false,
            movies: [{ id: 'animemovies', kind: 'animeMovies', name: 'AniMovies' }],
            shows: [],
            music: [],
            reading: []
        };
        const fullAccess = {
            collections: true,
            isAdmin: false,
            movies: [
                { id: 'movies', kind: 'movies', name: 'Movies' },
                { id: 'animemovies', kind: 'animeMovies', name: 'AniMovies' }
            ],
            shows: [{ id: 'shows', kind: 'shows', name: 'TV Shows' }],
            music: [{ id: 'music', name: 'Music' }],
            reading: [{ id: 'books', kind: 'books', name: 'Books' }]
        };
        const collectionsOnlyAccess = {
            collections: true,
            isAdmin: false,
            movies: [],
            shows: [],
            music: [],
            reading: []
        };
        let access = null;
        if (navigationAccessMocks.mode === 'full') {
            access = fullAccess;
        }
        if (navigationAccessMocks.mode === 'restricted') {
            access = restrictedAccess;
        }
        if (navigationAccessMocks.mode === 'collectionsOnly') {
            access = collectionsOnlyAccess;
        }
        if (navigationAccessMocks.mode === 'movieA') {
            access = {
                ...collectionsOnlyAccess,
                movies: [{ id: 'movie-private-a', kind: 'movies', name: 'Movies A' }]
            };
        }
        if (navigationAccessMocks.mode === 'showA') {
            access = {
                ...collectionsOnlyAccess,
                shows: [{ id: 'show-private-a', kind: 'shows', name: 'Shows A' }]
            };
        }
        if (navigationAccessMocks.mode === 'otherMovies') {
            access = {
                ...collectionsOnlyAccess,
                movies: [{ id: 'other-movie-id', kind: 'movies', name: 'Other Movies' }]
            };
        }
        if (navigationAccessMocks.mode === 'otherShows') {
            access = {
                ...collectionsOnlyAccess,
                shows: [{ id: 'other-show-id', kind: 'shows', name: 'Other Shows' }]
            };
        }
        if (navigationAccessMocks.mode === 'booksOnly') {
            access = {
                ...collectionsOnlyAccess,
                reading: [{ id: 'books-id', kind: 'books', name: 'Books' }]
            };
        }
        if (navigationAccessMocks.mode === 'comicsOnly') {
            access = {
                ...collectionsOnlyAccess,
                reading: [{ id: 'comics-id', kind: 'comics', name: 'Comics' }]
            };
        }
        return {
            access,
            identityKey: navigationAccessMocks.mode === 'loading' ? '' : 'server:user',
            status: navigationAccessMocks.mode === 'loading' ? 'loading' : 'ready'
        };
    }
}));

vi.mock('../services/jellyfinLogoutAction', () => ({
    requestJellyfinLogout: logoutMocks.request,
    requestJellyfinUserSwitch: logoutMocks.switchUser
}));

vi.mock('../services/notificationService', () => ({
    clearDismissiblePtvNotifications: vi.fn(),
    dismissPtvNotification: vi.fn(),
    getPtvNotificationSnapshot: vi.fn((identityKey?: string) => ({
        duplicateSuppressionCount: 0,
        lastNotificationSource: 'none',
        notifications: identityKey === '' ? [] : notificationMocks.notifications,
        subscriberCount: 0,
        totalCount: identityKey === '' ? 0 : notificationMocks.notifications.length,
        unreadCount: identityKey === '' ? 0 : notificationMocks.notifications.length
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

vi.mock('../modules/calendar/arrCalendarAvailability', () => ({
    usePtvArrCalendarAvailability: () => calendarAvailabilityMocks.snapshot
}));

vi.mock('../utils/usePtvAdminDebugVisibility', () => ({
    usePtvAdminDebugVisibility: vi.fn(() => ({ isAdmin: adminVisibilityMocks.isAdmin }))
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
        navigationAccessMocks.mode = 'full';
        adminVisibilityMocks.isAdmin = false;
        notificationMocks.notifications = [];
        resetPtvRuntimeOverlayOcclusionsForTests();
        logoutMocks.request.mockReset();
        logoutMocks.request.mockResolvedValue(undefined);
        logoutMocks.switchUser.mockReset();
        logoutMocks.switchUser.mockResolvedValue(undefined);
        runtimeMocks.registerShell.mockClear();
        runtimeMocks.registerShell.mockImplementation(() => vi.fn());
        calendarAvailabilityMocks.snapshot = {
            capabilityAvailable: false,
            configuredServices: [],
            error: '',
            identityKey: 'server:user',
            showEntry: false,
            status: 'not-configured'
        };
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
                identityKey='server:user'
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

    it('publishes measured header clearance on mount and resize, then removes it on unmount', async () => {
        let bottom = 126;
        const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
            return { bottom } as DOMRect;
        });

        try {
            flushSync(() => root.render(<PTVShell headerOnly><div /></PTVShell>));
            expect(document.documentElement.style.getPropertyValue('--ptv-shell-header-clearance')).toBe('126px');

            bottom = 152;
            window.dispatchEvent(new Event('resize'));
            expect(document.documentElement.style.getPropertyValue('--ptv-shell-header-clearance')).toBe('152px');

            bottom = 108;
            document.documentElement.classList.add('ptv-route-detail-page');
            await vi.waitFor(() => expect(document.documentElement.style.getPropertyValue('--ptv-shell-header-clearance')).toBe('108px'));
            document.documentElement.classList.remove('ptv-route-detail-page');

            flushSync(() => root.unmount());
            expect(document.documentElement.style.getPropertyValue('--ptv-shell-header-clearance')).toBe('');
            root = createRoot(container);
        } finally {
            measure.mockRestore();
        }
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

    it('shows Release Calendar navigation only after saved configuration and Plugin capability are verified', () => {
        calendarAvailabilityMocks.snapshot = {
            capabilityAvailable: true,
            configuredServices: ['sonarr'],
            error: '',
            identityKey: 'server:user',
            showEntry: true,
            status: 'available'
        };

        flushSync(() => root.render(
            <PTVShell headerOnly>
                <div />
            </PTVShell>
        ));

        const calendarLink = Array.from(container.querySelectorAll<HTMLAnchorElement>('.ptv-shell-nav-button'))
            .find(link => link.textContent?.trim() === 'Calendar');
        expect(calendarLink?.getAttribute('href')).toBe('#/calendar');
    });

    it('does not force Calendar navigation visible without authoritative availability', () => {
        flushSync(() => root.render(
            <PTVShell headerOnly>
                <div />
            </PTVShell>
        ));

        const labels = Array.from(container.querySelectorAll<HTMLAnchorElement>('.ptv-shell-nav-button'))
            .map(link => link.textContent?.trim());
        expect(labels).not.toContain('Calendar');
    });

    it('provides Home and Back exits for a direct Calendar entry even before Calendar setup', () => {
        window.location.hash = '#/calendar';
        flushSync(() => root.render(
            <PTVShell section='request' showBackButton title='Release Calendar'>
                <div />
            </PTVShell>
        ));

        expect(container.querySelector<HTMLAnchorElement>('a[aria-label="PiggieTV Home"]')?.getAttribute('href'))
            .toBe('#/home');
        expect(container.querySelector<HTMLButtonElement>('button[aria-label="Back"]')).not.toBeNull();
    });

    it.each([
        ['Movie Details', '#/details?id=movie', 'movies'],
        ['Anime Movie Details', '#/details?id=anime-movie', 'movies'],
        ['Series Details', '#/details?id=series', 'shows'],
        ['Cartoon Details', '#/details?id=cartoon', 'shows'],
        ['Anime Series Details', '#/details?id=anime-series', 'shows'],
        ['Reading Details', '#/details?id=book', 'reading']
    ])('uses the shared Movies and Shows dropdowns on %s', (_name, hash, section) => {
        window.location.hash = hash;
        flushSync(() => root.render(
            <PTVShell headerOnly navigationVariant='details' section={section as 'movies' | 'anime' | 'shows' | 'cartoons' | 'reading'}>
                <div />
            </PTVShell>
        ));

        const movieTrigger = container.querySelector<HTMLButtonElement>('#ptv-shell-movies-trigger');
        const showsTrigger = container.querySelector<HTMLButtonElement>('#ptv-shell-shows-trigger');

        expect(movieTrigger?.getAttribute('aria-haspopup')).toBe('menu');
        expect(showsTrigger?.getAttribute('aria-haspopup')).toBe('menu');
        expect(movieTrigger?.parentElement?.classList.contains('is-active')).toBe(section === 'movies');
        expect(showsTrigger?.parentElement?.classList.contains('is-active')).toBe(section === 'shows');
        expect(container.querySelector('a.ptv-shell-nav-button[href="#/movies"]')).toBeNull();
        expect(container.querySelector('a.ptv-shell-nav-button[href="#/shows"]')).toBeNull();

        flushSync(() => movieTrigger?.click());
        expect(movieTrigger?.getAttribute('aria-expanded')).toBe('true');
        expect(document.querySelector('[data-ptv-shell-primary-menu="movies"] [href="#/movies?topParentId=animemovies"]')).not.toBeNull();
    });

    it.each([
        ['Home', '#/home', 'home'],
        ['Music', '#/music', 'music']
    ])('keeps the existing shared navigation on %s', (_name, hash, section) => {
        window.location.hash = hash;
        flushSync(() => root.render(
            <PTVShell headerOnly section={section as 'home' | 'music'}>
                <div />
            </PTVShell>
        ));

        expect(container.querySelector('#ptv-shell-movies-trigger')).not.toBeNull();
        expect(container.querySelector('#ptv-shell-shows-trigger')).not.toBeNull();
        expect(container.querySelector<HTMLAnchorElement>('a.ptv-shell-nav-button[href="#/music"]')?.classList.contains('is-active'))
            .toBe(section === 'music');
    });

    it('omits inaccessible category links for a restricted account', () => {
        navigationAccessMocks.mode = 'restricted';
        flushSync(() => root.render(<PTVShell headerOnly><div /></PTVShell>));

        expect(container.querySelector('#ptv-shell-movies-trigger')).not.toBeNull();
        expect(container.querySelector('#ptv-shell-shows-trigger')).toBeNull();
        expect(container.querySelector('a.ptv-shell-nav-button[href="#/music"]')).toBeNull();
        expect(container.querySelector('a.ptv-shell-nav-button[href="#/reading"]')).toBeNull();

        flushSync(() => container.querySelector<HTMLButtonElement>('#ptv-shell-movies-trigger')?.click());
        expect(document.querySelector('[data-ptv-shell-primary-menu="movies"] [href="#/movies?topParentId=animemovies"]')).not.toBeNull();
        expect(document.querySelector('[data-ptv-shell-primary-menu="movies"] [href="#/movies"]')).toBeNull();
    });

    it('keeps Collections reachable when it is the only permitted media view', () => {
        navigationAccessMocks.mode = 'collectionsOnly';
        flushSync(() => root.render(<PTVShell headerOnly><div /></PTVShell>));

        expect(container.querySelector('#ptv-shell-movies-trigger')).toBeNull();
        expect(container.querySelector<HTMLAnchorElement>('a.ptv-shell-nav-button[href="#/collections"]')).not.toBeNull();
    });

    it('retires an open category and its links as soon as access becomes unavailable', () => {
        flushSync(() => root.render(<PTVShell headerOnly><div /></PTVShell>));
        flushSync(() => container.querySelector<HTMLButtonElement>('#ptv-shell-shows-trigger')?.click());
        expect(document.querySelector('[data-ptv-shell-primary-menu="shows"]')).not.toBeNull();

        navigationAccessMocks.mode = 'loading';
        flushSync(() => root.render(<PTVShell headerOnly><div /></PTVShell>));

        expect(container.querySelector('#ptv-shell-shows-trigger')).toBeNull();
        expect(document.querySelector('[data-ptv-shell-primary-menu="shows"]')).toBeNull();
    });

    it('replaces a direct restricted route without retaining the previous account content', () => {
        window.location.hash = '#/tv?topParentId=shows';
        flushSync(() => root.render(
            <PTVShell section='shows'><p>Previous account title</p></PTVShell>
        ));
        expect(container.textContent).toContain('Previous account title');

        navigationAccessMocks.mode = 'restricted';
        flushSync(() => root.render(
            <PTVShell section='shows'><p>Previous account title</p></PTVShell>
        ));

        expect(container.textContent).not.toContain('Previous account title');
        expect(container.textContent).toContain('This library is not available for this account.');
        expect(container.querySelector('a[href="#/home"]')).not.toBeNull();
    });

    it('does not expose administrator notification details from a stale admin flag after account switch', () => {
        adminVisibilityMocks.isAdmin = true;
        navigationAccessMocks.mode = 'restricted';
        notificationMocks.notifications = [{
            dismissible: true,
            id: 'prior-admin-notice',
            message: 'A past notice',
            occurrenceCount: 1,
            read: false,
            source: 'ptv',
            technicalDetails: 'prior administrator diagnostics',
            title: 'Past notice',
            type: 'warning',
            updatedAt: Date.now()
        }];

        flushSync(() => root.render(<PTVShell headerOnly><div /></PTVShell>));
        flushSync(() => container.querySelector<HTMLButtonElement>('[aria-label="Notifications"]')?.click());

        expect(container.querySelector('.ptv-shell-notification-item-actions button[aria-expanded]')).toBeNull();
        expect(container.textContent).not.toContain('prior administrator diagnostics');
    });

    it('retires the prior account notification badge when identity becomes unverified', () => {
        notificationMocks.notifications = [{
            dismissible: true,
            id: 'prior-user-notice',
            message: 'Prior account notice',
            occurrenceCount: 1,
            read: false,
            source: 'ptv',
            title: 'Prior account notice',
            type: 'warning',
            updatedAt: Date.now()
        }];
        flushSync(() => root.render(<PTVShell headerOnly><div /></PTVShell>));
        expect(container.querySelector('.ptv-shell-notification-badge')?.textContent).toBe('1');

        navigationAccessMocks.mode = 'loading';
        flushSync(() => root.render(<PTVShell headerOnly><div /></PTVShell>));
        expect(container.querySelector('.ptv-shell-notification-badge')).toBeNull();
        expect(container.textContent).not.toContain('unread PiggieTV notifications');
    });

    it('keeps an authorized AniMovies route available without an anime-shows library', () => {
        navigationAccessMocks.mode = 'restricted';
        window.location.hash = '#/movies?topParentId=animemovies';
        flushSync(() => root.render(
            <PTVShell section='anime'><p>Authorized AniMovies content</p></PTVShell>
        ));

        expect(container.textContent).toContain('Authorized AniMovies content');
        expect(container.querySelector('a[href="#/movies?topParentId=animemovies"]')).not.toBeNull();
        expect(container.querySelector('a[href="#/tv?topParentId=anime&view=latest"]')).toBeNull();
    });

    it('does not use AniMovies permission to reveal a restricted Anime Shows route', () => {
        navigationAccessMocks.mode = 'restricted';
        window.location.hash = '#/tv?topParentId=anime';
        flushSync(() => root.render(
            <PTVShell section='anime'><p>Previous anime show account content</p></PTVShell>
        ));

        expect(container.textContent).not.toContain('Previous anime show account content');
        expect(container.textContent).toContain('This library is not available for this account.');
    });

    it.each([
        ['movie', '#/movies?topParentId=movie-private-a', 'movies', 'movieA', 'otherMovies'],
        ['show', '#/tv?topParentId=show-private-a', 'shows', 'showA', 'otherShows']
    ] as const)('retires prior %s content when only a different library remains accessible', (_kind, hash, section, startingMode, nextMode) => {
        navigationAccessMocks.mode = startingMode;
        window.location.hash = hash;
        flushSync(() => root.render(<PTVShell section={section}><p>Prior library content</p></PTVShell>));
        expect(container.textContent).toContain('Prior library content');

        navigationAccessMocks.mode = nextMode;
        flushSync(() => root.render(<PTVShell section={section}><p>Prior library content</p></PTVShell>));
        expect(container.textContent).not.toContain('Prior library content');
        expect(container.textContent).toContain('This library is not available for this account.');
    });

    it('retires prior Comics content when only Books remains accessible', () => {
        navigationAccessMocks.mode = 'comicsOnly';
        window.location.hash = '#/reading/comics';
        flushSync(() => root.render(<PTVShell section='reading'><p>Prior Comics content</p></PTVShell>));
        expect(container.textContent).toContain('Prior Comics content');

        navigationAccessMocks.mode = 'booksOnly';
        flushSync(() => root.render(<PTVShell section='reading'><p>Prior Comics content</p></PTVShell>));
        expect(container.textContent).not.toContain('Prior Comics content');
        expect(container.textContent).toContain('This library is not available for this account.');
    });

    it('applies the same Calendar gate to Request page context navigation', () => {
        flushSync(() => root.render(
            <PTVShell section='request' title='Requests'>
                <div />
            </PTVShell>
        ));

        const getContextLabels = () => Array.from(container.querySelectorAll<HTMLAnchorElement>('.ptv-shell-context-link'))
            .map(link => link.textContent?.trim());
        expect(getContextLabels()).not.toContain('Calendar');

        calendarAvailabilityMocks.snapshot = {
            capabilityAvailable: true,
            configuredServices: ['sonarr'],
            error: '',
            identityKey: 'server:user',
            showEntry: true,
            status: 'available'
        };
        flushSync(() => root.render(
            <PTVShell section='request' title='Requests'>
                <div />
            </PTVShell>
        ));

        const calendarLink = Array.from(container.querySelectorAll<HTMLAnchorElement>('.ptv-shell-context-link'))
            .find(link => link.textContent?.trim() === 'Calendar');
        expect(calendarLink?.getAttribute('href')).toBe('#/calendar');
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
