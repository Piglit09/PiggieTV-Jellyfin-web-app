import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { PTV_ASSETS, PTV_BRANDING, PTV_ROUTES } from '../core/config';
import { recordPtvEvent } from '../core/observability';
import { focusPtvTvElement } from '../core/tvFocus';
import { getPtvQueryStringValue, parsePtvQueryString } from '../core/queryString';
import { isPtvPlatformNavigationEntryAvailable } from '../core/platformFeatures';
import { resolvePtvStaticAssetUrl } from '../core/urlOrigins';
import { PtvIcon, type PtvIconName } from '../modules/icons';
import { incrementPtvPerformanceCounter } from '../services/performanceMonitor';
import { requestJellyfinLogout } from '../services/jellyfinLogoutAction';
import { acquirePtvRuntimeOverlayOcclusion } from '../services/runtimeOverlayOcclusion';
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
import { usePtvArrCalendarAvailability } from '../modules/calendar/arrCalendarAvailability';
import { recordPtvRouteGenerationLifecycle } from './routeController';
import PTVShellBackdrop from './PTVShellBackdrop';
import PtvShellPrimaryDropdown from './PtvShellPrimaryDropdown';
import { usePtvNavigationAccess } from './usePtvNavigationAccess';
import type { PtvNavigationAccess } from './navigationAccess';

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
    backdropPresentationKey?: string;
    backdropSource?: string;
    backdropUrl?: string;
    children: React.ReactNode;
    className?: string;
    contextualLinks?: readonly PtvShellNavLink[];
    headerOnly?: boolean;
    menuLabel?: string;
    navigationVariant?: 'default' | 'details';
    onMenuClick?: () => void;
    onNavigationOpenChange?: (open: boolean) => void;
    registerRuntimeShell?: boolean;
    searchQuery?: string;
    section?: PtvShellSection;
    showBackButton?: boolean;
    title?: string;
}>;

const PTV_SHELL_DASHBOARD_HREF = '#/settings/admin/piggietv';
const PTV_SHELL_SEARCH_DRAFT_KEY = 'ptv:shell:search-draft';

function getPtvShellProfileHref() {
    return PTV_ROUTES.profile;
}

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
const createEmptyPtvShellStatus = (): Omit<PtvShellDebugStatus, 'currentRoute' | 'domNodeCount' | 'mountedForMs'> => ({
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
});
let shellStatus = createEmptyPtvShellStatus();

const PTV_SHELL_PRIMARY_LINKS: readonly PtvShellNavLink[] = [
    { id: 'request', label: 'Request', href: PTV_ROUTES.request, icon: 'request' }
];

const PTV_SHELL_CALENDAR_LINK: PtvShellNavLink = {
    href: PTV_ROUTES.calendar,
    icon: 'activity',
    id: 'calendar',
    label: 'Calendar'
};

const PTV_SHELL_DETAILS_LINKS: readonly PtvShellNavLink[] = [
    { id: 'home', label: 'Home', href: PTV_ROUTES.home, icon: 'home' },
    { id: 'search', label: 'Search', href: PTV_ROUTES.search, icon: 'search' }
];

const PTV_SHELL_MUSIC_LINK: PtvShellNavLink =
    { id: 'music', label: 'Music', href: PTV_ROUTES.music, icon: 'music' };
const PTV_SHELL_READING_LINK: PtvShellNavLink =
    { id: 'reading', label: 'Reading', href: PTV_ROUTES.reading, icon: 'books' };
const PTV_SHELL_COLLECTIONS_LINK: PtvShellNavLink =
    { id: 'collections', label: 'Collections', href: PTV_ROUTES.collections, icon: 'collections' };

const PTV_SHELL_CONTEXT_LINKS: Record<PtvShellSection, readonly PtvShellNavLink[]> = {
    anime: [
        { id: 'anime-latest', label: 'Latest', href: `${PTV_ROUTES.animeShows}&view=latest`, icon: 'activity' },
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
        { id: 'dashboard-rows', label: 'Rows', href: '#/settings/admin/piggietv/rows', icon: 'grid' }
    ],
    home: [],
    movies: [
        { id: 'movies-latest', label: 'Latest', href: `${PTV_ROUTES.movies}/latest`, icon: 'activity' },
        { id: 'movies-genres', label: 'Genres', href: `${PTV_ROUTES.movies}/genres`, icon: 'filter' },
        { id: 'movies-studios', label: 'Studios', href: `${PTV_ROUTES.movies}/studios`, icon: 'libraries' },
        { id: 'movies-collections', label: 'Collections', href: PTV_ROUTES.collections, icon: 'collections' },
        { id: 'movies-trending', label: 'Trending', href: `${PTV_ROUTES.movies}/trending`, icon: 'activity' }
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
        { id: 'settings-profile', label: 'Profile', href: PTV_ROUTES.profile, icon: 'profile' },
        { id: 'settings-display', label: 'Appearance', href: PTV_ROUTES.displayPreferences, icon: 'display' }
    ],
    shows: [
        { id: 'shows-continue', label: 'Continue', href: `${PTV_ROUTES.shows}/continue`, icon: 'resume' },
        { id: 'shows-latest', label: 'Latest', href: `${PTV_ROUTES.shows}/latest`, icon: 'activity' },
        { id: 'shows-genres', label: 'Genres', href: `${PTV_ROUTES.shows}/genres`, icon: 'filter' },
        { id: 'shows-networks', label: 'Studios & Networks', href: `${PTV_ROUTES.shows}/networks`, icon: 'libraries' }
    ]
};

function isPtvShellHrefActive(href: string, hash = window.location.hash || PTV_ROUTES.home) {
    const [targetHash, targetSearch = ''] = href.split('?');
    const [currentHash, currentSearch = ''] = hash.split('?');

    if (currentHash !== targetHash) return false;
    const currentParams = parsePtvQueryString(currentSearch);

    if (!targetSearch) return !getPtvQueryStringValue(currentParams, 'view');

    const targetParams = parsePtvQueryString(targetSearch);

    return targetParams.every(([key, value]) => getPtvQueryStringValue(currentParams, key) === value);
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
    if (path.startsWith('#/settings') || path.startsWith('#/mypreferences')) return 'settings';
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
        '#/settings',
        '#/mypreferences',
        '#/selectserver'
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

function resetPtvShellDebugStatus() {
    shellHeaderRenderCount = 0;
    shellMountedAt = 0;
    shellStatus = createEmptyPtvShellStatus();
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

function getPtvShellNavGroups(
    section: PtvShellSection,
    hash: string,
    details: boolean,
    access: PtvNavigationAccess | null
): readonly PtvShellNavGroup[] {
    if (!access) return [];
    const routeSection = getPtvShellPrimarySection(hash);
    const activeSection = details && routeSection === 'fallback' ? section : routeSection;
    const movieLinks: PtvShellNavLink[] = access.movies.map(view => ({
        href: `#/movies?topParentId=${encodeURIComponent(view.id)}`,
        icon: view.kind === 'animeMovies' ? 'animeMovies' : 'movies',
        id: `movie-view-${view.id}`,
        label: view.name
    }));
    if (access.collections && movieLinks.length) {
        movieLinks.push({ id: 'collections', label: 'Collections', href: PTV_ROUTES.collections, icon: 'collections' });
    }
    const showLinks: PtvShellNavLink[] = access.shows.map(view => ({
        href: `#/tv?topParentId=${encodeURIComponent(view.id)}`,
        icon: getPtvShellShowIcon(view.kind),
        id: `show-view-${view.id}`,
        label: view.name
    }));

    return [
        ...(access.movies.length ? [{
            active: activeSection === 'movies',
            icon: 'movies' as const,
            id: 'movies',
            label: 'Movies',
            links: movieLinks
        }] : []),
        ...(access.shows.length ? [{
            active: activeSection === 'shows',
            icon: 'shows' as const,
            id: 'shows',
            label: 'Shows',
            links: showLinks
        }] : [])
    ];
}

function getPtvShellShowIcon(kind: 'anime' | 'cartoons' | 'shows'): PtvIconName {
    if (kind === 'anime') return 'anime';
    if (kind === 'cartoons') return 'cartoons';
    return 'shows';
}

function getPtvShellPrimaryLinks(
    access: PtvNavigationAccess | null,
    calendarAvailable: boolean,
    navigationVariant: 'default' | 'details',
    section: PtvShellSection
) {
    const accessLinks = [
        ...(access?.music.length ? [PTV_SHELL_MUSIC_LINK] : []),
        ...(access?.reading.length ? [PTV_SHELL_READING_LINK] : []),
        ...(access?.collections && !access.movies.length ? [PTV_SHELL_COLLECTIONS_LINK] : [])
    ];
    const links = navigationVariant === 'details' ? [
        PTV_SHELL_DETAILS_LINKS[0],
        ...accessLinks,
        PTV_SHELL_DETAILS_LINKS[1]
    ] : [
        ...accessLinks,
        ...PTV_SHELL_PRIMARY_LINKS,
        ...(calendarAvailable ? [PTV_SHELL_CALENDAR_LINK] : [])
    ];

    return links
        .filter(link => isPtvPlatformNavigationEntryAvailable(link))
        .map(link => navigationVariant === 'details' ? { ...link, active: link.id === section } : link);
}

const PTV_SHELL_LEGACY_VIEW_ALIASES: Record<string, Readonly<{ kind: string; names: readonly string[] }>> = {
    anime: { kind: 'anime', names: ['anime', 'anime library'] },
    animemovies: { kind: 'animeMovies', names: ['ani movies', 'anime movies', 'animemovies', 'animovies', 'animovies library'] },
    cartoons: { kind: 'cartoons', names: ['cartoons', 'cartoons library'] },
    movies: { kind: 'movies', names: ['movies', 'movies library'] },
    shows: { kind: 'shows', names: ['shows', 'shows library', 'tv shows'] }
};

function hasPtvShellViewAccess(
    views: ReadonlyArray<Readonly<{ id: string; kind: string; name: string }>>,
    hash: string
) {
    const requested = getPtvQueryStringValue(parsePtvQueryString(hash.split('?')[1] || ''), 'topParentId')
        .trim().toLowerCase();
    if (!requested) return views.length > 0;
    if (views.some(view => view.id.toLowerCase() === requested)) return true;

    // Legacy aliases are presentation routes only. Match them to an actual
    // user-visible view before showing page content; server APIs still decide.
    const alias = PTV_SHELL_LEGACY_VIEW_ALIASES[requested];
    return Boolean(alias && views.some(view => view.kind === alias.kind
        && alias.names.includes(view.name.trim().toLowerCase())));
}

function isPtvShellSectionAvailable(section: PtvShellSection, access: PtvNavigationAccess | null, hash: string) {
    if (['home', 'search', 'request', 'settings'].includes(section)) return true;
    if (!access) return false;

    switch (section) {
        case 'anime': {
            const path = getPtvShellHashPath(hash);
            if (path.startsWith('#/movies')) return hasPtvShellViewAccess(
                access.movies.filter(view => view.kind === 'animeMovies'), hash
            );
            if (path.startsWith('#/tv')) return hasPtvShellViewAccess(
                access.shows.filter(view => view.kind === 'anime'), hash
            );
            return access.shows.some(view => view.kind === 'anime')
                || access.movies.some(view => view.kind === 'animeMovies');
        }
        case 'cartoons': return hasPtvShellViewAccess(access.shows.filter(view => view.kind === 'cartoons'), hash);
        case 'collections': return access.collections;
        case 'dashboard': return access.isAdmin;
        case 'movies': return hasPtvShellViewAccess(access.movies, hash);
        case 'music': return access.music.length > 0;
        case 'reading': {
            const path = getPtvShellHashPath(hash);
            let views = access.reading;
            if (path.startsWith('#/reading/comics') || path.startsWith('#/comics')) {
                views = views.filter(view => view.kind === 'comics');
            } else if (path.startsWith('#/reading/manga') || path.startsWith('#/manga')) {
                views = views.filter(view => view.kind === 'manga');
            } else if (path.startsWith('#/reading/books') || path.startsWith('#/books')) {
                views = views.filter(view => view.kind === 'books');
            }
            return hasPtvShellViewAccess(views, hash);
        }
        case 'shows': return hasPtvShellViewAccess(access.shows, hash);
        default: return true;
    }
}

function getPtvShellAvailableContextLinks(
    links: readonly PtvShellNavLink[],
    section: PtvShellSection,
    access: PtvNavigationAccess | null,
    hash: string
) {
    if (!isPtvShellSectionAvailable(section, access, hash)) return [];
    return links.filter(link => {
        if (section === 'anime' && link.id !== 'anime-movies' && link.id.startsWith('anime-')) {
            return access?.shows.some(view => view.kind === 'anime');
        }
        if (link.id === 'reading-books') return access?.reading.some(view => view.kind === 'books');
        if (link.id === 'reading-comics') return access?.reading.some(view => view.kind === 'comics');
        if (link.id === 'reading-manga') return access?.reading.some(view => view.kind === 'manga');
        if (link.id === 'movies-collections') return access?.collections;
        if (link.id === 'collections-movies') return Boolean(access?.movies.length);
        if (link.id === 'anime-movies') return access?.movies.some(view => view.kind === 'animeMovies');
        return true;
    });
}

function isPtvShellDirectLinkActive(link: Pick<PtvShellNavLink, 'active' | 'href' | 'label'>, hash: string) {
    if (typeof link.active === 'boolean') return link.active;
    const activeSection = getPtvShellPrimarySection(hash);

    if (link.label === 'Music') return activeSection === 'music';
    if (link.label === 'Reading') return activeSection === 'reading';
    if (link.label === 'Request') return activeSection === 'request';
    return isPtvShellHrefActive(link.href, hash);
}

function PtvShellDirectLink({ active, href, icon, label, onClick }: PtvShellNavLink & Readonly<{ onClick: () => void }>) {
    const hash = window.location.hash || PTV_ROUTES.home;
    const isActive = isPtvShellDirectLinkActive({ active, href, label }, hash);

    return (
        <a
            className={`ptv-shell-nav-button${isActive ? ' is-active' : ''}`}
            data-ptv-request-trigger={label === 'Request' ? 'true' : undefined}
            href={href}
            onClick={onClick}
        >
            <PtvIcon name={icon} />
            <span className='ptv-shell-nav-label'>{label}</span>
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
            if (inputRef.current) focusPtvTvElement(inputRef.current, 'shell-search-open');
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
            if (triggerRef.current) focusPtvTvElement(triggerRef.current, 'shell-search-close');
            return;
        }

        inputRef.current?.blur();
        closeSearchIfEmpty();
    }, [closeSearchIfEmpty, onClose, query]);
    const handleClear = useCallback(() => {
        setQuery('');
        if (inputRef.current) focusPtvTvElement(inputRef.current, 'shell-search-clear');
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
                placeholder='Search titles, music, genres, studios'
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

function usePtvNotificationSnapshot(identityKey: string) {
    const [scopedSnapshot, setScopedSnapshot] = useState(() => ({
        identityKey,
        snapshot: getPtvNotificationSnapshot(identityKey)
    }));

    useEffect(() => subscribePtvNotifications(
        snapshot => setScopedSnapshot({ identityKey, snapshot }),
        identityKey
    ), [identityKey]);

    // Render the new identity's snapshot immediately. A subscription effect
    // from the previous account must never leave its badge or text visible.
    return scopedSnapshot.identityKey === identityKey ?
        scopedSnapshot.snapshot :
        getPtvNotificationSnapshot(identityKey) || EMPTY_NOTIFICATION_SNAPSHOT;
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
        <div
            aria-label='PiggieTV notifications'
            aria-labelledby='ptv-shell-notifications-trigger'
            className='ptv-shell-notification-panel'
            id='ptv-shell-notifications-panel'
            role='dialog'
        >
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

export function PtvShellActions({
    identityKey,
    isAdmin,
    onPanelToggle,
    openPanel,
    searchExpanded
}: Readonly<{
    identityKey: string;
    isAdmin: boolean;
    onPanelToggle: (panel: PtvShellOpenPanel) => void;
    openPanel: PtvShellOpenPanel;
    searchExpanded: boolean;
}>) {
    const notificationSnapshot = usePtvNotificationSnapshot(identityKey);
    const notificationsOpen = openPanel === 'notifications';
    const userOpen = openPanel === 'user';
    const profileHref = getPtvShellProfileHref();
    const handleLogout = useCallback(() => {
        onPanelToggle(null);
        void requestJellyfinLogout();
    }, [onPanelToggle]);
    const handlePanelClose = useCallback(() => onPanelToggle(null), [onPanelToggle]);

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
                id='ptv-shell-notifications-trigger'
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
            <div className={`ptv-shell-user-menu${userOpen ? ' is-open' : ''}`}>
                <button
                    aria-controls='ptv-shell-user-panel'
                    aria-expanded={userOpen}
                    aria-label='User menu'
                    className='ptv-shell-icon-button'
                    id='ptv-shell-user-trigger'
                    onClick={() => onPanelToggle('user')}
                    type='button'
                >
                    <PtvIcon name='user' />
                </button>
                {userOpen ? (
                    <div
                        aria-labelledby='ptv-shell-user-trigger'
                        className='ptv-shell-user-panel'
                        id='ptv-shell-user-panel'
                        role='menu'
                    >
                        <a href={profileHref} onClick={handlePanelClose} role='menuitem'>
                            <PtvIcon name='profile' />
                            <span>Profile</span>
                        </a>
                        <a href={PTV_ROUTES.quickConnect} onClick={handlePanelClose} role='menuitem'>
                            <PtvIcon name='display' />
                            <span>Quick Connect</span>
                        </a>
                        <a href={PTV_ROUTES.settings} onClick={handlePanelClose} role='menuitem'>
                            <PtvIcon name='settings' />
                            <span>Settings</span>
                        </a>
                        <button data-ptv-action='logout' onClick={handleLogout} role='menuitem' type='button'>
                            <PtvIcon name='signout' />
                            <span>Sign Out</span>
                        </button>
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

export default function PTVShell({
    backdropPresentationKey,
    backdropSource,
    backdropUrl,
    children,
    className = '',
    contextualLinks,
    headerOnly = false,
    menuLabel = 'Open navigation menu',
    navigationVariant = 'default',
    onMenuClick,
    onNavigationOpenChange,
    registerRuntimeShell = true,
    searchQuery: syncedSearchQuery,
    section = 'home',
    showBackButton = false,
    title
}: PTVShellProps) {
    const navigationAccess = usePtvNavigationAccess();
    const access = navigationAccess.status === 'ready' ? navigationAccess.access : null;
    const headerRef = useRef<HTMLElement | null>(null);
    const headerRenderCountRef = useRef(0);
    const appLogoUrl = resolvePtvStaticAssetUrl(PTV_ASSETS.logos.bannerLight);
    const hash = window.location.hash || PTV_ROUTES.home;
    const isFullScreenMusicRoute = getPtvShellHashPath(hash) === '#/music/player';
    const [openPanel, setOpenPanel] = useState<PtvShellOpenPanel>(null);
    const hasOpenPanel = openPanel !== null;
    const [isSearchExpanded, setSearchExpanded] = useState(false);
    const [searchQuery, setSearchQuery] = useState(() => getPtvShellSearchRouteQuery() || readPtvShellSearchDraft());
    const arrCalendarAvailability = usePtvArrCalendarAvailability();
    const navGroups = useMemo(
        () => getPtvShellNavGroups(section, hash, navigationVariant === 'details', access),
        [access, hash, navigationVariant, section]
    );
    const primaryLinks = useMemo(
        () => getPtvShellPrimaryLinks(access, arrCalendarAvailability.showEntry, navigationVariant, section),
        [access, arrCalendarAvailability.showEntry, navigationVariant, section]
    );
    const contextLinks = useMemo(
        () => getPtvShellAvailableContextLinks(contextualLinks || PTV_SHELL_CONTEXT_LINKS[section] || [], section, access, hash)
            .filter(link => link.href !== PTV_ROUTES.calendar || arrCalendarAvailability.showEntry),
        [access, arrCalendarAvailability.showEntry, contextualLinks, hash, section]
    );
    const sectionAvailable = isPtvShellSectionAvailable(section, access, hash);
    const shellContent = sectionAvailable ? (
        <div className='ptv-shell-main ptv-shell-page-content' data-ptv-layout-node='shell-main'>
            {children}
        </div>
    ) : (
        <div className='ptv-shell-main ptv-shell-page-content ptv-shell-access-state' data-ptv-layout-node='shell-main' role='status'>
            <p>{navigationAccess.status === 'loading' ?
                'Checking available libraries…' :
                'This library is not available for this account.'}</p>
            <a href={PTV_ROUTES.home}>Return to Home</a>
        </div>
    );
    const activeSecondaryNav = contextLinks.find(link => link.active || isPtvShellHrefActive(link.href, hash))?.id || '';
    const closeHeaderTransientState = useCallback((options: { collapseSearch?: boolean } = {}) => {
        setOpenPanel(null);

        if (options.collapseSearch !== false) setSearchExpanded(false);
    }, []);
    useEffect(() => {
        closeHeaderTransientState();
    }, [closeHeaderTransientState, navigationAccess.identityKey, navigationAccess.status, access]);
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
    const handleBack = useCallback(() => {
        closeHeaderTransientState();
        if (window.history.length > 1) {
            window.history.back();
        } else {
            window.location.hash = PTV_ROUTES.home.slice(1);
        }
    }, [closeHeaderTransientState]);

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

    useEffect(() => {
        if (!hasOpenPanel) return undefined;

        return acquirePtvRuntimeOverlayOcclusion('ptv-shell-panel');
    }, [hasOpenPanel]);

    useEffect(() => () => {
        onNavigationOpenChange?.(false);
    }, [onNavigationOpenChange]);

    useEffect(() => {
        if (syncedSearchQuery === undefined) return;

        setSearchQuery(syncedSearchQuery);
    }, [syncedSearchQuery]);

    useEffect(() => {
        const syncFromRoute = () => {
            const routeQuery = getPtvShellSearchRouteQuery();

            if (getPtvShellHashPath(window.location.hash) === '#/search') {
                setSearchQuery(routeQuery);
            }
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
        if (openPanel === 'movies' || openPanel === 'shows') return undefined;

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

    useLayoutEffect(() => {
        const header = headerRef.current;
        if (!header) return undefined;

        const publishClearance = () => {
            document.documentElement.style.setProperty(
                '--ptv-shell-header-clearance',
                `${Math.max(0, header.getBoundingClientRect().bottom)}px`
            );
        };
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(publishClearance);
        const routeObserver = new MutationObserver(publishClearance);

        publishClearance();
        observer?.observe(header);
        routeObserver.observe(document.documentElement, { attributeFilter: ['class'], attributes: true });
        window.addEventListener('resize', publishClearance);
        window.visualViewport?.addEventListener('resize', publishClearance);

        return () => {
            observer?.disconnect();
            routeObserver.disconnect();
            window.removeEventListener('resize', publishClearance);
            window.visualViewport?.removeEventListener('resize', publishClearance);
            const otherHeader = Array.from(document.querySelectorAll<HTMLElement>('.ptv-shell-header'))
                .find(node => node !== header && node.isConnected);

            if (otherHeader) {
                document.documentElement.style.setProperty(
                    '--ptv-shell-header-clearance',
                    `${Math.max(0, otherHeader.getBoundingClientRect().bottom)}px`
                );
            } else {
                document.documentElement.style.removeProperty('--ptv-shell-header-clearance');
            }
        };
    }, []);

    useLayoutEffect(() => {
        ensurePtvShellHeaderStatusBridge();
        shellMountedAt = performance.now();
        runPtvClientCacheMigration();
        const unregisterShellInstance = registerRuntimeShell ?
            registerPtvNativeShellInstance(section) :
            () => undefined;
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
        const mountedHeader = headerRef.current;

        return () => {
            unregisterShellInstance();
            const otherMountedHeader = Array.from(document.querySelectorAll<HTMLElement>('.ptv-shell-header'))
                .some(node => node !== mountedHeader);

            if (!otherMountedHeader) resetPtvShellDebugStatus();
            incrementPtvPerformanceCounter('pageUnmountCount', {
                route: window.location.hash || window.location.pathname,
                section
            });
        };
    }, [registerRuntimeShell, section]);

    return (
        <div
            className={`ptv-shell-frame ptv-shell-frame-${section}${headerOnly ? ' ptv-shell-frame-header-only' : ''}${isFullScreenMusicRoute ? ' ptv-shell-frame-fullscreen-music' : ''} ${className}`.trim()}
            data-ptv-route-mode='native'
            data-ptv-shell-section={section}
        >
            {headerOnly || !sectionAvailable ? null :
                <PTVShellBackdrop key={backdropPresentationKey} source={backdropSource || section} url={backdropUrl} />}

            <header ref={headerRef} className='ptv-shell-header' aria-label='PiggieTV application shell'>
                <div className='ptv-shell-header-left'>
                    {onMenuClick ? (
                        <button
                            aria-label={menuLabel}
                            className='ptv-shell-icon-button ptv-shell-menu-button'
                            onClick={onMenuClick}
                            title={menuLabel}
                            type='button'
                        >
                            <PtvIcon name='menu' />
                        </button>
                    ) : null}
                    <a className='ptv-shell-brand' data-ptv-owner='shell-brand' href={PTV_ROUTES.home} aria-label='PiggieTV Home' onClick={() => closeHeaderTransientState()}>
                        <img alt={PTV_BRANDING.appName} data-ptv-owner='shell-brand-image' decoding='async' loading='eager' src={appLogoUrl} />
                    </a>
                </div>

                <nav
                    className='ptv-shell-nav ptv-shell-header-primary'
                    aria-label='PiggieTV media navigation'
                >
                    <div className='ptv-shell-nav-primary'>
                        {navigationVariant === 'details' && primaryLinks[0] ? (
                            <PtvShellDirectLink {...primaryLinks[0]} onClick={closeHeaderTransientState} />
                        ) : null}
                        {navGroups.map(group => (
                            <PtvShellPrimaryDropdown
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
                        {primaryLinks.filter(link => navigationVariant !== 'details' || link.id !== 'home').map(link => (
                            <PtvShellDirectLink key={link.id} {...link} onClick={() => closeHeaderTransientState()} />
                        ))}
                    </div>
                </nav>

                <div className='ptv-shell-header-right'>
                    <PtvShellActions
                        identityKey={access ? navigationAccess.identityKey : ''}
                        isAdmin={access?.isAdmin === true}
                        onPanelToggle={handlePanelToggle}
                        openPanel={openPanel}
                        searchExpanded={isSearchExpanded}
                    />
                    {navigationVariant === 'details' ? null : (
                        <PtvShellSearch
                            isExpanded={isSearchExpanded}
                            onClose={handleSearchClose}
                            onOpen={handleSearchOpen}
                            query={searchQuery}
                            setQuery={setSearchQuery}
                        />
                    )}
                    {showBackButton ? (
                        <button
                            aria-label='Back'
                            className='ptv-shell-icon-button ptv-shell-back-button'
                            onClick={handleBack}
                            title='Back'
                            type='button'
                        >
                            <PtvIcon name='back' />
                        </button>
                    ) : null}
                </div>
            </header>

            {headerOnly ? null : <PtvShellContextNav links={contextLinks} title={title} />}

            {headerOnly ? null : shellContent}
        </div>
    );
}
