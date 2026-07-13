import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { PTV_ASSETS, PTV_BRANDING, PTV_ROUTES } from '../core/config';
import { recordPtvEvent } from '../core/observability';
import { resolvePtvStaticAssetUrl } from '../core/urlOrigins';
import { PtvIcon, type PtvIconName } from '../modules/icons';
import { incrementPtvPerformanceCounter } from '../services/performanceMonitor';
import {
    registerPtvNativeShellInstance,
    runPtvClientCacheMigration
} from '../services/runtimeStability';
import {
    clearDismissiblePtvNotifications,
    dismissPtvNotification,
    getPtvNotificationSnapshot,
    hasPtvNotificationRetryHandler,
    markAllPtvNotificationsRead,
    markPtvNotificationRead,
    runPtvNotificationRetry,
    subscribePtvNotifications,
    type PtvNotification,
    type PtvNotificationSnapshot
} from '../services/notificationService';
import { recordPtvRouteGenerationLifecycle } from './routeController';
import { usePtvAdminDebugVisibility } from '../utils/usePtvAdminDebugVisibility';

import './ptvShell.scss';

export type PtvShellSection =
    | 'anime'
    | 'cartoons'
    | 'collections'
    | 'dashboard'
    | 'home'
    | 'movies'
    | 'music'
    | 'reading'
    | 'request'
    | 'search'
    | 'settings'
    | 'shows';

export type PtvShellNavLink = Readonly<{
    active?: boolean;
    href: string;
    icon: PtvIconName;
    id: string;
    label: string;
}>;

type PtvShellNavGroup = Readonly<{
    active?: boolean;
    icon: PtvIconName;
    id: string;
    label: string;
    links: readonly PtvShellNavLink[];
}>;

type PtvShellOpenPanel = 'movies' | 'notifications' | 'shows' | 'user' | null;

export type PTVShellProps = Readonly<{
    backdropSource?: string;
    backdropUrl?: string;
    children: React.ReactNode;
    className?: string;
    contextualLinks?: readonly PtvShellNavLink[];
    onNavigationOpenChange?: (open: boolean) => void;
    section?: PtvShellSection;
    title?: string;
}>;

const PTV_SHELL_DASHBOARD_HREF = '#/dashboard/piggietv';
const PTV_SHELL_SERVER_HREF = '#/selectserver';
const PTV_SHELL_SIGNOUT_HREF = '#/logout';
const PTV_SHELL_FALLBACK_BACKDROP_URL = resolvePtvStaticAssetUrl(PTV_ASSETS.backgrounds.page);
const PTV_SHELL_SEARCH_DRAFT_KEY = 'ptv:shell:search-draft';

type PtvShellDebugStatus = {
    activeSecondaryNav: string;
    currentRoute: string;
    domNodeCount: number;
    headerRenderCount: number;
    mounted: boolean;
    mountedAt: string;
    mountedForMs: number;
    navGroups: string[];
    notificationDuplicateSuppressionCount: number;
    notificationCount: number;
    notificationLastSource: string;
    notificationSubscriberCount: number;
    notificationTotalCount: number;
    openPanel: string;
    pageTitle: string;
    searchExpanded: boolean;
    searchQuery: string;
    section: string;
    shellSource: 'page-shell';
};

let shellHeaderStatusBridgeInstalled = false;
let shellHeaderRenderCount = 0;
let shellMountedAt = 0;
let shellStatus: Omit<PtvShellDebugStatus, 'currentRoute' | 'domNodeCount' | 'mountedForMs'> = {
    activeSecondaryNav: '',
    headerRenderCount: 0,
    mounted: false,
    mountedAt: '',
    navGroups: [],
    notificationDuplicateSuppressionCount: 0,
    notificationCount: 0,
    notificationLastSource: 'none',
    notificationSubscriberCount: 0,
    notificationTotalCount: 0,
    openPanel: '',
    pageTitle: '',
    searchExpanded: false,
    searchQuery: '',
    section: '',
    shellSource: 'page-shell'
};

const PTV_SHELL_MOVIE_LINKS: readonly PtvShellNavLink[] = [
    { id: 'movies', label: 'Movies', href: PTV_ROUTES.movies, icon: 'movies' },
    { id: 'anime-movies', label: 'AniMovies', href: PTV_ROUTES.animeMovies, icon: 'animeMovies' },
    { id: 'collections', label: 'Collections', href: PTV_ROUTES.collections, icon: 'collections' }
];

const PTV_SHELL_SHOW_LINKS: readonly PtvShellNavLink[] = [
    { id: 'shows', label: 'TV Shows', href: PTV_ROUTES.shows, icon: 'shows' },
    { id: 'anime-shows', label: 'Anime', href: PTV_ROUTES.animeShows, icon: 'anime' },
    { id: 'cartoons', label: 'Cartoons', href: PTV_ROUTES.cartoons, icon: 'cartoons' }
];

const PTV_SHELL_PRIMARY_LINKS: readonly PtvShellNavLink[] = [
    { id: 'music', label: 'Music', href: PTV_ROUTES.music, icon: 'music' },
    { id: 'reading', label: 'Reading', href: PTV_ROUTES.reading, icon: 'books' },
    { id: 'request', label: 'Request', href: PTV_ROUTES.request, icon: 'request' }
];

const PTV_SHELL_CONTEXT_LINKS: Record<PtvShellSection, readonly PtvShellNavLink[]> = {
    anime: [
        { id: 'anime-season', label: 'Season', href: `${PTV_ROUTES.animeShows}&view=season`, icon: 'activity' },
        { id: 'anime-movies', label: 'Movies', href: PTV_ROUTES.animeMovies, icon: 'animeMovies' },
        { id: 'anime-genres', label: 'Genres', href: `${PTV_ROUTES.animeShows}&view=genres`, icon: 'filter' },
        { id: 'anime-trending', label: 'Trending', href: `${PTV_ROUTES.animeShows}&view=trending`, icon: 'activity' }
    ],
    cartoons: [
        { id: 'cartoons-continue', label: 'Continue', href: `${PTV_ROUTES.cartoons}&view=continue`, icon: 'resume' },
        { id: 'cartoons-latest', label: 'Latest', href: `${PTV_ROUTES.cartoons}&view=latest`, icon: 'activity' },
        { id: 'cartoons-genres', label: 'Genres', href: `${PTV_ROUTES.cartoons}&view=genres`, icon: 'filter' }
    ],
    collections: [
        { id: 'collections-featured', label: 'Featured', href: `${PTV_ROUTES.collections}?view=featured`, icon: 'collections' },
        { id: 'collections-movies', label: 'Movies', href: PTV_ROUTES.movies, icon: 'movies' },
        { id: 'collections-genres', label: 'Genres', href: `${PTV_ROUTES.collections}?view=genres`, icon: 'filter' }
    ],
    dashboard: [
        { id: 'dashboard-home', label: 'Overview', href: PTV_SHELL_DASHBOARD_HREF, icon: 'dashboard' },
        { id: 'dashboard-rows', label: 'Rows', href: '#/dashboard/piggietv/rows', icon: 'grid' },
        { id: 'dashboard-recommendations', label: 'Recommendations', href: '#/dashboard/piggietv/recommendations', icon: 'shuffle' }
    ],
    home: [],
    movies: [
        { id: 'movies-latest', label: 'Latest', href: `${PTV_ROUTES.movies}?view=latest`, icon: 'activity' },
        { id: 'movies-genres', label: 'Genres', href: `${PTV_ROUTES.movies}?view=genres`, icon: 'filter' },
        { id: 'movies-studios', label: 'Studios', href: `${PTV_ROUTES.movies}?view=studios`, icon: 'libraries' },
        { id: 'movies-collections', label: 'Collections', href: PTV_ROUTES.collections, icon: 'collections' },
        { id: 'movies-trending', label: 'Trending', href: `${PTV_ROUTES.movies}?view=trending`, icon: 'activity' }
    ],
    music: [
        { id: 'music-home', label: 'Home', href: PTV_ROUTES.music, icon: 'home' },
        { id: 'music-explore', label: 'Explore', href: `${PTV_ROUTES.music}/explore`, icon: 'shuffle' },
        { id: 'music-artists', label: 'Artists', href: `${PTV_ROUTES.music}/artists`, icon: 'person' },
        { id: 'music-albums', label: 'Albums', href: `${PTV_ROUTES.music}/albums`, icon: 'music' },
        { id: 'music-songs', label: 'Songs', href: `${PTV_ROUTES.music}/songs`, icon: 'audio' },
        { id: 'music-playlists', label: 'Playlists', href: `${PTV_ROUTES.music}/playlists`, icon: 'playlists' }
    ],
    reading: [
        { id: 'reading-home', label: 'Home', href: PTV_ROUTES.reading, icon: 'home' },
        { id: 'reading-explore', label: 'Explore', href: PTV_ROUTES.readingExplore, icon: 'shuffle' },
        { id: 'reading-books', label: 'Books', href: PTV_ROUTES.readingLibrary, icon: 'books' },
        { id: 'reading-comics', label: 'Comics', href: PTV_ROUTES.readingComics, icon: 'collections' },
        { id: 'reading-manga', label: 'Manga', href: PTV_ROUTES.readingManga, icon: 'anime' },
        { id: 'reading-collections', label: 'Collections', href: PTV_ROUTES.readingCollections, icon: 'collections' }
    ],
    request: [
        { id: 'request-new', label: 'New Request', href: PTV_ROUTES.request, icon: 'request' },
        { id: 'request-calendar', label: 'Calendar', href: PTV_ROUTES.calendar, icon: 'activity' }
    ],
    search: [],
    settings: [
        { id: 'settings-profile', label: 'Profile', href: PTV_ROUTES.profilePreferences, icon: 'profile' },
        { id: 'settings-display', label: 'Display', href: PTV_ROUTES.displayPreferences, icon: 'display' }
    ],
    shows: [
        { id: 'shows-continue', label: 'Continue', href: `${PTV_ROUTES.shows}?view=continue`, icon: 'resume' },
        { id: 'shows-latest', label: 'Latest', href: `${PTV_ROUTES.shows}?view=latest`, icon: 'activity' },
        { id: 'shows-genres', label: 'Genres', href: `${PTV_ROUTES.shows}?view=genres`, icon: 'filter' },
        { id: 'shows-networks', label: 'Networks', href: `${PTV_ROUTES.shows}?view=networks`, icon: 'libraries' }
    ]
};

function isPtvShellHrefActive(href: string, hash = window.location.hash || PTV_ROUTES.home) {
    const [targetHash] = href.split('?');
    const [currentHash] = hash.split('?');

    return currentHash === targetHash;
}

function getPtvShellHashPath(hash = window.location.hash || PTV_ROUTES.home) {
    return (hash.split('?')[0] || PTV_ROUTES.home).toLowerCase();
}

function getPtvShellPrimarySection(hash = window.location.hash || PTV_ROUTES.home): PtvShellSection | 'fallback' {
    const path = getPtvShellHashPath(hash);

    if (path.startsWith('#/requests') || path.startsWith('#/request') || path.startsWith('#/ptv/request')) return 'request';
    if (path.startsWith('#/music')) return 'music';
    if (path.startsWith('#/books') || path.startsWith('#/comics') || path.startsWith('#/manga') || path.startsWith('#/reading')) return 'reading';
    if (path.startsWith('#/shows') || path.startsWith('#/tv')) return 'shows';
    if (path.startsWith('#/movies') || path.startsWith('#/collections')) return 'movies';
    if (path.startsWith('#/search')) return 'search';
    if (path.startsWith('#/dashboard')) return 'dashboard';
    if (path.startsWith('#/mypreferences')) return 'settings';
    if (path.startsWith('#/home') || path === '#/' || path === '') return 'home';

    return 'fallback';
}

function isPtvShellRouteAllowed(route?: string) {
    if (!route || !route.startsWith('#/')) return false;

    const path = getPtvShellHashPath(route);

    return [
        '#/home',
        '#/movies',
        '#/shows',
        '#/tv',
        '#/collections',
        '#/music',
        '#/reading',
        '#/books',
        '#/comics',
        '#/manga',
        '#/search',
        '#/requests',
        '#/request',
        '#/ptv/request',
        '#/calendar',
        '#/dashboard',
        '#/mypreferences',
        '#/selectserver',
        '#/logout'
    ].some(prefix => path.startsWith(prefix));
}

function getCurrentPtvShellRoute() {
    return `${window.location.pathname || ''}${window.location.hash || ''}`;
}

function getPtvShellDebugStatus(): PtvShellDebugStatus {
    return {
        ...shellStatus,
        currentRoute: getCurrentPtvShellRoute(),
        domNodeCount: document.getElementsByTagName('*').length,
        headerRenderCount: shellHeaderRenderCount,
        mountedForMs: shellMountedAt ? Number((performance.now() - shellMountedAt).toFixed(1)) : 0
    };
}

function ensurePtvShellHeaderStatusBridge() {
    if (shellHeaderStatusBridgeInstalled) return;

    shellHeaderStatusBridgeInstalled = true;
    const root = window.PTV || (window.PTV = {});
    const existingShell = root.shell && typeof root.shell === 'object' ?
        root.shell as Record<string, unknown> :
        {};

    root.shell = {
        ...existingShell,
        getHeaderStatus: getPtvShellDebugStatus
    };
}

function updatePtvShellDebugStatus(nextStatus: Partial<typeof shellStatus>) {
    shellStatus = {
        ...shellStatus,
        ...nextStatus
    };
}

function getPtvShellSearchRouteQuery(hash = window.location.hash || '') {
    const queryString = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';

    if (!queryString) return '';

    try {
        return new URLSearchParams(queryString).get('query') || '';
    } catch {
        return '';
    }
}

function readPtvShellSearchDraft() {
    try {
        return window.sessionStorage?.getItem(PTV_SHELL_SEARCH_DRAFT_KEY) || '';
    } catch {
        return '';
    }
}

function writePtvShellSearchDraft(query: string) {
    try {
        const trimmedQuery = query.trim();

        if (trimmedQuery) {
            window.sessionStorage?.setItem(PTV_SHELL_SEARCH_DRAFT_KEY, query);
        } else {
            window.sessionStorage?.removeItem(PTV_SHELL_SEARCH_DRAFT_KEY);
        }
    } catch {
        // Session storage is a nicety; search must stay usable without it.
    }
}

function isTextInputTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;

    return Boolean(
        target.closest('input, textarea, select, [contenteditable="true"]')
    );
}

function getPtvShellNavGroups(section: PtvShellSection, hash: string): readonly PtvShellNavGroup[] {
    const activeSection = getPtvShellPrimarySection(hash);

    return [
        {
            active: activeSection === 'movies',
            icon: 'movies',
            id: 'movies',
            label: 'Movies',
            links: PTV_SHELL_MOVIE_LINKS
        },
        {
            active: activeSection === 'shows',
            icon: 'shows',
            id: 'shows',
            label: 'Shows',
            links: PTV_SHELL_SHOW_LINKS
        }
    ];
}

function PtvShellDropdown({
    active,
    icon,
    id,
    isOpen,
    label,
    onLinkClick,
    onOpenFirstItem,
    links,
    onToggle
}: PtvShellNavGroup & Readonly<{
    isOpen: boolean;
    onLinkClick: () => void;
    onOpenFirstItem: () => void;
    onToggle: () => void;
}>) {
    const panelId = `ptv-shell-${id}-menu`;
    const panelRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});
    const updatePanelPosition = useCallback(() => {
        const rect = triggerRef.current?.getBoundingClientRect();

        if (!rect) return;

        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const panelWidth = Math.min(Math.max(220, rect.width + 72), Math.max(220, viewportWidth - 28));
        const left = Math.min(Math.max(14, rect.left), Math.max(14, viewportWidth - panelWidth - 14));
        const top = Math.max(14, rect.bottom + 10);

        setPanelStyle({
            '--ptv-shell-dropdown-left': `${left}px`,
            '--ptv-shell-dropdown-min-width': `${Math.max(220, rect.width)}px`,
            '--ptv-shell-dropdown-top': `${top}px`,
            '--ptv-shell-dropdown-width': `${panelWidth}px`
        } as React.CSSProperties);
    }, []);
    const handleTriggerKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== 'ArrowDown') return;

        event.preventDefault();
        updatePanelPosition();
        onOpenFirstItem();
        window.requestAnimationFrame(() => {
            panelRef.current?.querySelector<HTMLAnchorElement>('a')?.focus();
        });
    }, [onOpenFirstItem, updatePanelPosition]);
    const handleTriggerClick = useCallback(() => {
        updatePanelPosition();
        onToggle();
    }, [onToggle, updatePanelPosition]);
    const handlePanelKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

        const items = Array.from(panelRef.current?.querySelectorAll<HTMLAnchorElement>('a') || []);
        if (!items.length) return;

        event.preventDefault();
        const currentIndex = Math.max(0, items.findIndex(item => item === document.activeElement));
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = (currentIndex + direction + items.length) % items.length;

        items[nextIndex]?.focus();
    }, []);

    useEffect(() => {
        if (!isOpen) return undefined;

        const frame = window.requestAnimationFrame(updatePanelPosition);
        const handleViewportChange = () => updatePanelPosition();

        window.addEventListener('resize', handleViewportChange);
        window.addEventListener('scroll', handleViewportChange, true);

        return () => {
            window.cancelAnimationFrame(frame);
            window.removeEventListener('resize', handleViewportChange);
            window.removeEventListener('scroll', handleViewportChange, true);
        };
    }, [isOpen, updatePanelPosition]);

    return (
        <div className={`ptv-shell-nav-dropdown${active ? ' is-active' : ''}${isOpen ? ' is-open' : ''}`}>
            <button
                ref={triggerRef}
                aria-controls={panelId}
                aria-expanded={isOpen}
                aria-haspopup='menu'
                className='ptv-shell-nav-button'
                onClick={handleTriggerClick}
                onKeyDown={handleTriggerKeyDown}
                type='button'
            >
                <PtvIcon name={icon} />
                <span>{label}</span>
                <span className='ptv-shell-nav-caret' aria-hidden='true' />
            </button>
            {isOpen ? (
                <div
                    ref={panelRef}
                    className='ptv-shell-dropdown-panel'
                    id={panelId}
                    onKeyDown={handlePanelKeyDown}
                    role='menu'
                    style={panelStyle}
                    tabIndex={-1}
                >
                    {links.map(link => (
                        <a
                            key={link.id}
                            className='ptv-shell-dropdown-link'
                            href={link.href}
                            onClick={onLinkClick}
                            role='menuitem'
                        >
                            <PtvIcon name={link.icon} />
                            <span>{link.label}</span>
                        </a>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function PtvShellDirectLink({ href, icon, label, onClick }: PtvShellNavLink & Readonly<{ onClick: () => void }>) {
    const hash = window.location.hash || PTV_ROUTES.home;
    const activeSection = getPtvShellPrimarySection(hash);
    const isActive = label === 'Music' ?
        activeSection === 'music' :
        label === 'Reading' ?
            activeSection === 'reading' :
            label === 'Request' ?
                activeSection === 'request' :
                isPtvShellHrefActive(href, hash);

    return (
        <a
            className={`ptv-shell-nav-button${isActive ? ' is-active' : ''}`}
            data-ptv-request-trigger={label === 'Request' ? 'true' : undefined}
            href={href}
            onClick={onClick}
        >
            <PtvIcon name={icon} />
            <span>{label}</span>
        </a>
    );
}

function PtvShellSearch({
    isExpanded,
    onClose,
    onOpen,
    query,
    setQuery
}: Readonly<{
    isExpanded: boolean;
    onClose: () => void;
    onOpen: (options?: { focus?: boolean }) => void;
    query: string;
    setQuery: (query: string) => void;
}>) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const searchRef = useRef<HTMLFormElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const shouldFocusInputRef = useRef(false);
    const skipNextTriggerFocusRef = useRef(false);

    const openSearch = useCallback((options: { focus?: boolean } = {}) => {
        shouldFocusInputRef.current = options.focus !== false;
        onOpen(options);
    }, [onOpen]);

    const closeSearchIfEmpty = useCallback(() => {
        if (!query.trim()) onClose();
    }, [onClose, query]);

    useEffect(() => {
        updatePtvShellDebugStatus({
            searchExpanded: isExpanded,
            searchQuery: query
        });
    }, [isExpanded, query]);

    useEffect(() => {
        writePtvShellSearchDraft(query);
    }, [query]);

    useEffect(() => {
        const handleSearchShortcut = (event: KeyboardEvent) => {
            const isShortcut = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
            const isSlashShortcut = event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey;

            if (!isShortcut && !isSlashShortcut) return;
            if (isTextInputTarget(event.target)) return;

            event.preventDefault();
            openSearch({ focus: true });
        };

        document.addEventListener('keydown', handleSearchShortcut);

        return () => document.removeEventListener('keydown', handleSearchShortcut);
    }, [openSearch]);

    useEffect(() => {
        if (!isExpanded) return undefined;
        if (!shouldFocusInputRef.current) return undefined;

        const frame = window.requestAnimationFrame(() => {
            shouldFocusInputRef.current = false;
            inputRef.current?.focus();
        });

        return () => window.cancelAnimationFrame(frame);
    }, [isExpanded]);

    const handleSubmit = useCallback((event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const trimmedQuery = query.trim();

        if (!trimmedQuery) {
            window.location.hash = PTV_ROUTES.search.slice(1);
            onClose();
            return;
        }

        const target = `${PTV_ROUTES.search}?query=${encodeURIComponent(trimmedQuery)}&ptvGrouped=true`;

        recordPtvEvent('route', 'ptv-shell-search-submit', {
            queryLength: trimmedQuery.length,
            target
        });
        window.location.hash = target.slice(1);
        onClose();
    }, [onClose, query]);
    const handleTriggerClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        if (!isExpanded || document.activeElement !== inputRef.current) {
            event.preventDefault();
            openSearch({ focus: true });
        }
    }, [isExpanded, openSearch]);
    const handleTriggerKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (isExpanded || (event.key !== 'Enter' && event.key !== ' ')) return;

        event.preventDefault();
        openSearch({ focus: true });
    }, [isExpanded, openSearch]);
    const handleTriggerFocus = useCallback(() => {
        if (skipNextTriggerFocusRef.current) {
            skipNextTriggerFocusRef.current = false;
            return;
        }

        openSearch({ focus: true });
    }, [openSearch]);
    const handlePointerEnter = useCallback((event: React.PointerEvent<HTMLFormElement>) => {
        if (event.pointerType !== 'mouse') return;
        if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;

        openSearch({ focus: false });
    }, [openSearch]);
    const handleBlur = useCallback(() => {
        window.setTimeout(() => {
            if (searchRef.current?.contains(document.activeElement)) return;
            closeSearchIfEmpty();
        }, 0);
    }, [closeSearchIfEmpty]);
    const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLFormElement>) => {
        if (event.key !== 'Escape') return;

        event.stopPropagation();

        if (!query.trim()) {
            skipNextTriggerFocusRef.current = true;
            onClose();
            triggerRef.current?.focus();
            return;
        }

        inputRef.current?.blur();
        closeSearchIfEmpty();
    }, [closeSearchIfEmpty, onClose, query]);
    const handleClear = useCallback(() => {
        setQuery('');
        inputRef.current?.focus();
    }, [setQuery]);

    return (
        <form
            ref={searchRef}
            className={`ptv-shell-search${isExpanded || query ? ' is-expanded' : ''}${query ? ' has-query' : ''}`}
            role='search'
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            onPointerEnter={handlePointerEnter}
            onSubmit={handleSubmit}
        >
            <button
                ref={triggerRef}
                aria-expanded={isExpanded}
                aria-label='Search PiggieTV'
                className='ptv-shell-search-trigger'
                onClick={handleTriggerClick}
                onFocus={handleTriggerFocus}
                onKeyDown={handleTriggerKeyDown}
                title='Search PiggieTV'
                type={isExpanded ? 'submit' : 'button'}
            >
                <PtvIcon name='search' />
            </button>
            <input
                ref={inputRef}
                aria-label='Search PiggieTV'
                autoComplete='off'
                inputMode='search'
                onChange={event => setQuery(event.currentTarget.value)}
                placeholder='Search movies, shows, music, reading'
                type='search'
                value={query}
            />
            {query ? (
                <button
                    aria-label='Clear search'
                    className='ptv-shell-search-clear'
                    onClick={handleClear}
                    title='Clear search'
                    type='button'
                >
                    <PtvIcon name='delete' />
                </button>
            ) : null}
        </form>
    );
}

const EMPTY_NOTIFICATION_SNAPSHOT: PtvNotificationSnapshot = {
    duplicateSuppressionCount: 0,
    lastNotificationSource: 'none',
    notifications: [],
    subscriberCount: 0,
    totalCount: 0,
    unreadCount: 0
};

function usePtvNotificationSnapshot() {
    const [snapshot, setSnapshot] = useState<PtvNotificationSnapshot>(() => getPtvNotificationSnapshot());

    useEffect(() => subscribePtvNotifications(setSnapshot), []);

    return snapshot || EMPTY_NOTIFICATION_SNAPSHOT;
}

function formatPtvNotificationTime(notification: PtvNotification) {
    const ageMs = Math.max(0, Date.now() - notification.updatedAt);
    const ageMinutes = Math.floor(ageMs / 60000);

    if (ageMinutes < 1) return 'Just now';
    if (ageMinutes < 60) return `${ageMinutes}m ago`;

    const ageHours = Math.floor(ageMinutes / 60);
    if (ageHours < 24) return `${ageHours}h ago`;

    return new Date(notification.updatedAt).toLocaleDateString();
}

function getPtvNotificationSeverityLabel(notification: PtvNotification) {
    switch (notification.type) {
        case 'success':
            return 'Success';
        case 'warning':
            return 'Warning';
        case 'error':
            return 'Error';
        case 'info':
        default:
            return 'Info';
    }
}

function PtvShellNotificationPanel({
    isAdmin,
    notifications,
    onClose
}: Readonly<{
    isAdmin: boolean;
    notifications: readonly PtvNotification[];
    onClose: () => void;
}>) {
    const [expandedDetailsId, setExpandedDetailsId] = useState('');
    const [retryingNotificationId, setRetryingNotificationId] = useState('');
    const handleRetry = useCallback((notification: PtvNotification) => {
        setRetryingNotificationId(notification.id);
        void runPtvNotificationRetry(notification)
            .catch((err: unknown) => {
                recordPtvEvent('render', 'ptv-notification-retry-failed', {
                    error: err instanceof Error ? err.message : 'Unknown retry failure',
                    notificationId: notification.id,
                    source: notification.source
                });
            })
            .finally(() => {
                setRetryingNotificationId('');
            });
    }, []);

    return (
        <div className='ptv-shell-notification-panel' id='ptv-shell-notifications-panel' role='dialog' aria-label='PiggieTV notifications'>
            <header className='ptv-shell-notification-panel-header'>
                <div>
                    <span>Notifications</span>
                    <strong>{notifications.length ? `${notifications.length} recent` : 'All clear'}</strong>
                </div>
                <div className='ptv-shell-notification-actions'>
                    <button type='button' onClick={markAllPtvNotificationsRead}>Mark all read</button>
                    <button type='button' onClick={clearDismissiblePtvNotifications}>Clear</button>
                </div>
            </header>
            {notifications.length ? (
                <div className='ptv-shell-notification-list'>
                    {notifications.map(notification => {
                        const canNavigate = isPtvShellRouteAllowed(notification.route);
                        const canRetry = hasPtvNotificationRetryHandler(notification);
                        const isDetailsExpanded = expandedDetailsId === notification.id;

                        return (
                            <article
                                key={notification.id}
                                className={`ptv-shell-notification-item${notification.read ? ' is-read' : ''}`}
                            >
                                <span className={`ptv-shell-notification-severity is-${notification.type}`}>
                                    {getPtvNotificationSeverityLabel(notification)}
                                </span>
                                <strong>
                                    {notification.title}
                                    {notification.occurrenceCount > 1 ? ` (${notification.occurrenceCount})` : ''}
                                </strong>
                                {notification.message ? <span>{notification.message}</span> : null}
                                <small>{formatPtvNotificationTime(notification)} · {notification.source}</small>
                                <div className='ptv-shell-notification-item-actions'>
                                    {canNavigate ? (
                                        <a
                                            href={notification.route}
                                            onClick={() => {
                                                markPtvNotificationRead(notification.id);
                                                onClose();
                                            }}
                                        >
                                            Open
                                        </a>
                                    ) : null}
                                    {canRetry ? (
                                        <button
                                            disabled={retryingNotificationId === notification.id}
                                            onClick={() => handleRetry(notification)}
                                            type='button'
                                        >
                                            {retryingNotificationId === notification.id ? 'Retrying...' : notification.retryLabel || 'Retry'}
                                        </button>
                                    ) : null}
                                    {!notification.read ? (
                                        <button type='button' onClick={() => markPtvNotificationRead(notification.id)}>
                                            Mark read
                                        </button>
                                    ) : null}
                                    {isAdmin && notification.technicalDetails ? (
                                        <button
                                            aria-expanded={isDetailsExpanded}
                                            onClick={() => setExpandedDetailsId(isDetailsExpanded ? '' : notification.id)}
                                            type='button'
                                        >
                                            Details
                                        </button>
                                    ) : null}
                                    {notification.dismissible ? (
                                        <button type='button' onClick={() => dismissPtvNotification(notification.id)}>
                                            Dismiss
                                        </button>
                                    ) : null}
                                </div>
                                {isAdmin && notification.technicalDetails && isDetailsExpanded ? (
                                    <pre className='ptv-shell-notification-details'>{notification.technicalDetails}</pre>
                                ) : null}
                            </article>
                        );
                    })}
                </div>
            ) : (
                <div className='ptv-shell-notification-empty'>
                    <PtvIcon name='check' />
                    <strong>You&apos;re all caught up.</strong>
                    <span>No PiggieTV notices right now.</span>
                </div>
            )}
        </div>
    );
}

function PtvShellActions({
    isAdmin,
    onPanelToggle,
    openPanel,
    searchExpanded
}: Readonly<{
    isAdmin: boolean;
    onPanelToggle: (panel: PtvShellOpenPanel) => void;
    openPanel: PtvShellOpenPanel;
    searchExpanded: boolean;
}>) {
    const notificationSnapshot = usePtvNotificationSnapshot();
    const notificationsOpen = openPanel === 'notifications';
    const userOpen = openPanel === 'user';

    useEffect(() => {
        updatePtvShellDebugStatus({
            notificationDuplicateSuppressionCount: notificationSnapshot.duplicateSuppressionCount,
            notificationCount: notificationSnapshot.unreadCount,
            notificationLastSource: notificationSnapshot.lastNotificationSource,
            notificationSubscriberCount: notificationSnapshot.subscriberCount,
            notificationTotalCount: notificationSnapshot.totalCount,
            openPanel: openPanel || ''
        });
    }, [
        notificationSnapshot.duplicateSuppressionCount,
        notificationSnapshot.lastNotificationSource,
        notificationSnapshot.subscriberCount,
        notificationSnapshot.totalCount,
        notificationSnapshot.unreadCount,
        openPanel
    ]);

    return (
        <div className={`ptv-shell-actions${searchExpanded ? ' is-search-expanded' : ''}`} aria-label='PiggieTV actions'>
            <button
                aria-controls='ptv-shell-notifications-panel'
                aria-expanded={notificationsOpen}
                aria-label='Notifications'
                className='ptv-shell-icon-button ptv-shell-notification-trigger'
                onClick={() => onPanelToggle('notifications')}
                title='Notifications'
                type='button'
            >
                <PtvIcon name='alerts' />
                {notificationSnapshot.unreadCount ? (
                    <span className='ptv-shell-notification-badge'>{Math.min(99, notificationSnapshot.unreadCount)}</span>
                ) : null}
            </button>
            {notificationsOpen ? (
                <PtvShellNotificationPanel
                    isAdmin={isAdmin}
                    notifications={notificationSnapshot.notifications}
                    onClose={() => onPanelToggle(null)}
                />
            ) : null}
            {isAdmin ? (
                <a
                    aria-label='PiggieTV dashboard'
                    className='ptv-shell-icon-button'
                    href={PTV_SHELL_DASHBOARD_HREF}
                    onClick={() => onPanelToggle(null)}
                    title='PiggieTV dashboard'
                >
                    <PtvIcon name='dashboard' />
                </a>
            ) : null}
            <a
                aria-label='Settings'
                className='ptv-shell-icon-button'
                href={PTV_ROUTES.profilePreferences}
                onClick={() => onPanelToggle(null)}
                title='Settings'
            >
                <PtvIcon name='settings' />
            </a>
            <div className={`ptv-shell-user-menu${userOpen ? ' is-open' : ''}`}>
                <button
                    aria-controls='ptv-shell-user-panel'
                    aria-expanded={userOpen}
                    aria-label='User menu'
                    className='ptv-shell-icon-button'
                    onClick={() => onPanelToggle('user')}
                    type='button'
                >
                    <PtvIcon name='user' />
                </button>
                {userOpen ? (
                    <div className='ptv-shell-user-panel' id='ptv-shell-user-panel' role='menu'>
                        <a href={PTV_ROUTES.profilePreferences} onClick={() => onPanelToggle(null)} role='menuitem'>
                            <PtvIcon name='profile' />
                            <span>Profile</span>
                        </a>
                        <a href={PTV_SHELL_SERVER_HREF} onClick={() => onPanelToggle(null)} role='menuitem'>
                            <PtvIcon name='server' />
                            <span>Select Server</span>
                        </a>
                        <a href={PTV_SHELL_SIGNOUT_HREF} onClick={() => onPanelToggle(null)} role='menuitem'>
                            <PtvIcon name='signout' />
                            <span>Sign Out</span>
                        </a>
                    </div>
                ) : null}
            </div>
            <span className='ptv-shell-notification-live' aria-live='polite' aria-atomic='true'>
                {notificationSnapshot.unreadCount ? `${notificationSnapshot.unreadCount} unread PiggieTV notifications` : ''}
            </span>
        </div>
    );
}

function PtvShellContextNav({
    links,
    title
}: Readonly<{
    links: readonly PtvShellNavLink[];
    title?: string;
}>) {
    if (!links.length) return null;

    return (
        <nav className='ptv-shell-context-nav' aria-label={`${title || 'PiggieTV'} section navigation`}>
            {links.map(link => (
                <a
                    key={link.id}
                    className={`ptv-shell-context-link${link.active || isPtvShellHrefActive(link.href) ? ' is-active' : ''}`}
                    href={link.href}
                >
                    <PtvIcon name={link.icon} />
                    <span>{link.label}</span>
                </a>
            ))}
        </nav>
    );
}

function PtvShellBackdrop({
    source,
    url
}: Readonly<{
    source?: string;
    url?: string;
}>) {
    const resolvedUrl = url || PTV_SHELL_FALLBACK_BACKDROP_URL;
    const [currentUrl, setCurrentUrl] = useState(resolvedUrl);
    const [previousUrl, setPreviousUrl] = useState('');
    const [isCurrentVisible, setCurrentVisible] = useState(Boolean(resolvedUrl));
    const [isPreviousVisible, setPreviousVisible] = useState(false);

    useEffect(() => {
        if (!resolvedUrl || resolvedUrl === currentUrl) return undefined;

        const startedAt = performance.now();
        let cancelled = false;
        const image = new Image();

        image.decoding = 'async';
        image.onload = () => {
            if (cancelled) return;

            setPreviousUrl(currentUrl);
            setPreviousVisible(Boolean(currentUrl));
            setCurrentUrl(resolvedUrl);
            setCurrentVisible(false);

            const frame = window.requestAnimationFrame(() => {
                setPreviousVisible(false);
                setCurrentVisible(true);
            });
            const timeout = window.setTimeout(() => {
                setPreviousUrl('');
            }, 900);

            recordPtvEvent('render', 'ptv-shell-backdrop-loaded', {
                activeBackdropSource: source || 'unknown',
                backdropCacheHit: performance.now() - startedAt < 10,
                backdropLoadMs: Number((performance.now() - startedAt).toFixed(1))
            });

            window.setTimeout(() => {
                window.cancelAnimationFrame(frame);
                window.clearTimeout(timeout);
            }, 950);
        };
        image.onerror = () => {
            if (cancelled) return;

            recordPtvEvent('render', 'ptv-shell-backdrop-failed', {
                activeBackdropSource: source || 'unknown',
                fallbackUrl: PTV_SHELL_FALLBACK_BACKDROP_URL,
                requestedUrl: resolvedUrl
            });
        };
        image.src = resolvedUrl;

        return () => {
            cancelled = true;
        };
    }, [currentUrl, resolvedUrl, source]);

    useEffect(() => {
        recordPtvEvent('route', 'ptv-shell-mounted', {
            activeBackdropSource: source || 'fallback',
            backdropActive: Boolean(currentUrl)
        });
    }, [currentUrl, source]);

    return (
        <div className='ptv-shell-backdrop' aria-hidden='true' data-ptv-shell-backdrop-source={source || 'fallback'}>
            {previousUrl ? (
                <img
                    alt=''
                    className={`ptv-shell-backdrop-image ptv-shell-backdrop-image-previous${isPreviousVisible ? ' is-visible' : ''}`}
                    decoding='async'
                    src={previousUrl}
                />
            ) : null}
            {currentUrl ? (
                <img
                    alt=''
                    className={`ptv-shell-backdrop-image ptv-shell-backdrop-image-current${isCurrentVisible ? ' is-visible' : ''}`}
                    decoding='async'
                    src={currentUrl}
                />
            ) : null}
            <div className='ptv-shell-backdrop-overlay' />
            <div className='ptv-shell-noise' />
        </div>
    );
}

export default function PTVShell({
    backdropSource,
    backdropUrl,
    children,
    className = '',
    contextualLinks,
    onNavigationOpenChange,
    section = 'home',
    title
}: PTVShellProps) {
    const { isAdmin } = usePtvAdminDebugVisibility();
    const headerRef = useRef<HTMLElement | null>(null);
    const headerRenderCountRef = useRef(0);
    const appLogoUrl = resolvePtvStaticAssetUrl(PTV_ASSETS.logos.bannerLight);
    const hash = window.location.hash || PTV_ROUTES.home;
    const [openPanel, setOpenPanel] = useState<PtvShellOpenPanel>(null);
    const [isSearchExpanded, setSearchExpanded] = useState(false);
    const [searchQuery, setSearchQuery] = useState(() => getPtvShellSearchRouteQuery() || readPtvShellSearchDraft());
    const navGroups = useMemo(() => getPtvShellNavGroups(section, hash), [hash, section]);
    const contextLinks = contextualLinks || PTV_SHELL_CONTEXT_LINKS[section] || [];
    const activeSecondaryNav = contextLinks.find(link => link.active || isPtvShellHrefActive(link.href, hash))?.id || '';
    const closeHeaderTransientState = useCallback((options: { collapseSearch?: boolean } = {}) => {
        setOpenPanel(null);

        if (options.collapseSearch !== false) setSearchExpanded(false);
    }, []);
    const handlePanelToggle = useCallback((panel: PtvShellOpenPanel) => {
        setSearchExpanded(false);
        setOpenPanel(currentPanel => (currentPanel === panel ? null : panel));
    }, []);
    const handleSearchOpen = useCallback(() => {
        setOpenPanel(null);
        setSearchExpanded(true);
    }, []);
    const handleSearchClose = useCallback(() => {
        setSearchExpanded(false);
    }, []);

    headerRenderCountRef.current += 1;
    shellHeaderRenderCount = headerRenderCountRef.current;
    updatePtvShellDebugStatus({
        activeSecondaryNav,
        headerRenderCount: shellHeaderRenderCount,
        navGroups: navGroups.map(group => group.id),
        openPanel: openPanel || '',
        pageTitle: title || section,
        searchExpanded: isSearchExpanded,
        searchQuery,
        section
    });

    useEffect(() => {
        onNavigationOpenChange?.(Boolean(openPanel));
    }, [onNavigationOpenChange, openPanel]);

    useEffect(() => () => {
        onNavigationOpenChange?.(false);
    }, [onNavigationOpenChange]);

    useEffect(() => {
        const syncFromRoute = () => {
            const routeQuery = getPtvShellSearchRouteQuery();

            if (routeQuery) setSearchQuery(routeQuery);
            closeHeaderTransientState();
        };

        window.addEventListener('hashchange', syncFromRoute);
        window.addEventListener('popstate', syncFromRoute);

        return () => {
            window.removeEventListener('hashchange', syncFromRoute);
            window.removeEventListener('popstate', syncFromRoute);
        };
    }, [closeHeaderTransientState]);

    useEffect(() => {
        if (!openPanel && !isSearchExpanded) return undefined;

        const handlePointerDown = (event: PointerEvent) => {
            if (headerRef.current?.contains(event.target as Node)) return;

            setOpenPanel(null);
            if (!searchQuery.trim()) setSearchExpanded(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;

            setOpenPanel(null);
            if (!searchQuery.trim()) setSearchExpanded(false);
        };

        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isSearchExpanded, openPanel, searchQuery]);

    useEffect(() => {
        ensurePtvShellHeaderStatusBridge();
        shellMountedAt = performance.now();
        runPtvClientCacheMigration();
        const unregisterShellInstance = registerPtvNativeShellInstance(section);
        updatePtvShellDebugStatus({
            mounted: true,
            mountedAt: new Date().toISOString(),
            section
        });

        incrementPtvPerformanceCounter('routePageMountCount', {
            route: window.location.hash || window.location.pathname,
            section
        });
        incrementPtvPerformanceCounter('pageMountCount', {
            route: window.location.hash || window.location.pathname,
            section
        });
        recordPtvRouteGenerationLifecycle('shell-mount', {
            route: window.location.hash || window.location.pathname,
            section
        });

        return () => {
            unregisterShellInstance();
            shellMountedAt = 0;
            shellHeaderRenderCount = 0;
            updatePtvShellDebugStatus({
                mounted: false,
                mountedAt: ''
            });
            incrementPtvPerformanceCounter('pageUnmountCount', {
                route: window.location.hash || window.location.pathname,
                section
            });
        };
    }, []);

    return (
        <div
            className={`ptv-shell-frame ptv-shell-frame-${section} ${className}`.trim()}
            data-ptv-route-mode='native'
            data-ptv-shell-section={section}
        >
            <PtvShellBackdrop source={backdropSource || section} url={backdropUrl} />

            <header ref={headerRef} className='ptv-shell-header' aria-label='PiggieTV application shell'>
                <div className='ptv-shell-header-left'>
                    <a className='ptv-shell-brand' href={PTV_ROUTES.home} aria-label='PiggieTV Home' onClick={() => closeHeaderTransientState()}>
                        <img alt={PTV_BRANDING.appName} decoding='async' loading='eager' src={appLogoUrl} />
                    </a>
                </div>

                <nav
                    className='ptv-shell-nav ptv-shell-header-primary'
                    aria-label='PiggieTV media navigation'
                >
                    <div className='ptv-shell-nav-primary'>
                        {navGroups.map(group => (
                            <PtvShellDropdown
                                key={group.id}
                                {...group}
                                isOpen={openPanel === group.id}
                                onLinkClick={() => closeHeaderTransientState()}
                                onOpenFirstItem={() => {
                                    setSearchExpanded(false);
                                    setOpenPanel(group.id as PtvShellOpenPanel);
                                }}
                                onToggle={() => handlePanelToggle(group.id as PtvShellOpenPanel)}
                            />
                        ))}
                        {PTV_SHELL_PRIMARY_LINKS.map(link => (
                            <PtvShellDirectLink key={link.id} {...link} onClick={() => closeHeaderTransientState()} />
                        ))}
                    </div>
                </nav>

                <div className='ptv-shell-header-right'>
                    <PtvShellActions
                        isAdmin={isAdmin}
                        onPanelToggle={handlePanelToggle}
                        openPanel={openPanel}
                        searchExpanded={isSearchExpanded}
                    />
                    <PtvShellSearch
                        isExpanded={isSearchExpanded}
                        onClose={handleSearchClose}
                        onOpen={handleSearchOpen}
                        query={searchQuery}
                        setQuery={setSearchQuery}
                    />
                </div>
            </header>

            <PtvShellContextNav links={contextLinks} title={title} />

            <div className='ptv-shell-page-content'>
                {children}
            </div>
        </div>
    );
}
