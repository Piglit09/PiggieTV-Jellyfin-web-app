import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { PTV_ASSETS, PTV_BRANDING, PTV_ROUTES } from '../core/config';
import { recordPtvEvent } from '../core/observability';
import { resolvePtvStaticAssetUrl } from '../core/urlOrigins';
import { PtvIcon, type PtvIconName } from '../modules/icons';
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
    | 'settings'
    | 'shows';

export type PtvShellNavLink = Readonly<{
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

export type PTVShellProps = Readonly<{
    children: React.ReactNode;
    className?: string;
    contextualLinks?: readonly PtvShellNavLink[];
    mediaDock?: React.ReactNode;
    onNavigationOpenChange?: (open: boolean) => void;
    section?: PtvShellSection;
    title?: string;
}>;

const PTV_SHELL_DASHBOARD_HREF = '#/dashboard/piggietv';
const PTV_SHELL_SERVER_HREF = '#/selectserver';
const PTV_SHELL_SIGNOUT_HREF = '#/logout';

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
    { id: 'reading', label: 'Reading', href: PTV_ROUTES.readingLibrary, icon: 'books' },
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
        { id: 'music-artists', label: 'Artists', href: `${PTV_ROUTES.music}/artists`, icon: 'person' },
        { id: 'music-albums', label: 'Albums', href: `${PTV_ROUTES.music}/albums`, icon: 'music' },
        { id: 'music-songs', label: 'Songs', href: `${PTV_ROUTES.music}/songs`, icon: 'audio' },
        { id: 'music-playlists', label: 'Playlists', href: `${PTV_ROUTES.music}/playlists`, icon: 'playlists' }
    ],
    reading: [
        { id: 'reading-books', label: 'Books', href: PTV_ROUTES.books, icon: 'books' },
        { id: 'reading-comics', label: 'Comics', href: PTV_ROUTES.comics, icon: 'books' },
        { id: 'reading-manga', label: 'Manga', href: PTV_ROUTES.manga, icon: 'anime' },
        { id: 'reading-authors', label: 'Authors', href: `${PTV_ROUTES.readingLibrary}?view=authors`, icon: 'person' }
    ],
    request: [
        { id: 'request-new', label: 'New Request', href: PTV_ROUTES.request, icon: 'request' },
        { id: 'request-calendar', label: 'Calendar', href: PTV_ROUTES.calendar, icon: 'activity' }
    ],
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

function getPtvShellNavGroups(section: PtvShellSection, hash: string): readonly PtvShellNavGroup[] {
    return [
        {
            active: section === 'home' || section === 'movies' || section === 'collections'
                || hash.startsWith('#/movies') || hash.startsWith('#/collections'),
            icon: 'movies',
            id: 'movies',
            label: 'Movies',
            links: PTV_SHELL_MOVIE_LINKS
        },
        {
            active: section === 'shows' || section === 'anime' || section === 'cartoons'
                || hash.startsWith('#/shows') || hash.startsWith('#/tv'),
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
    label,
    links,
    onOpenChange
}: PtvShellNavGroup & Readonly<{ onOpenChange?: () => void }>) {
    const handleToggle = useCallback(() => {
        onOpenChange?.();
    }, [onOpenChange]);

    return (
        <details className={`ptv-shell-nav-dropdown${active ? ' is-active' : ''}`} onToggle={handleToggle}>
            <summary className='ptv-shell-nav-button'>
                <PtvIcon name={icon} />
                <span>{label}</span>
                <span className='ptv-shell-nav-caret' aria-hidden='true' />
            </summary>
            <div className='ptv-shell-dropdown-panel'>
                {links.map(link => (
                    <a key={link.id} className='ptv-shell-dropdown-link' href={link.href}>
                        <PtvIcon name={link.icon} />
                        <span>{link.label}</span>
                    </a>
                ))}
            </div>
        </details>
    );
}

function PtvShellDirectLink({ href, icon, label }: PtvShellNavLink) {
    return (
        <a
            className={`ptv-shell-nav-button${isPtvShellHrefActive(href) ? ' is-active' : ''}`}
            data-ptv-request-trigger={label === 'Request' ? 'true' : undefined}
            href={href}
        >
            <PtvIcon name={icon} />
            <span>{label}</span>
        </a>
    );
}

function PtvShellSearch() {
    const [query, setQuery] = useState('');
    const handleSubmit = useCallback((event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const trimmedQuery = query.trim();

        if (!trimmedQuery) {
            window.location.hash = PTV_ROUTES.search.slice(1);
            return;
        }

        const target = `${PTV_ROUTES.search}?query=${encodeURIComponent(trimmedQuery)}&ptvGrouped=true`;

        recordPtvEvent('route', 'ptv-shell-search-submit', {
            queryLength: trimmedQuery.length,
            target
        });
        window.location.hash = target.slice(1);
    }, [query]);

    return (
        <form className='ptv-shell-search' role='search' onSubmit={handleSubmit}>
            <PtvIcon name='search' />
            <input
                aria-label='Search PiggieTV'
                autoComplete='off'
                inputMode='search'
                onChange={event => setQuery(event.currentTarget.value)}
                placeholder='Search movies, shows, music, reading'
                type='search'
                value={query}
            />
        </form>
    );
}

function PtvShellActions({ isAdmin }: Readonly<{ isAdmin: boolean }>) {
    return (
        <div className='ptv-shell-actions' aria-label='PiggieTV actions'>
            <button
                aria-label='Notifications'
                className='ptv-shell-icon-button'
                title='Notifications'
                type='button'
            >
                <PtvIcon name='alerts' />
            </button>
            {isAdmin ? (
                <a
                    aria-label='PiggieTV dashboard'
                    className='ptv-shell-icon-button'
                    href={PTV_SHELL_DASHBOARD_HREF}
                    title='PiggieTV dashboard'
                >
                    <PtvIcon name='dashboard' />
                </a>
            ) : null}
            <a
                aria-label='Settings'
                className='ptv-shell-icon-button'
                href={PTV_ROUTES.profilePreferences}
                title='Settings'
            >
                <PtvIcon name='settings' />
            </a>
            <details className='ptv-shell-user-menu'>
                <summary className='ptv-shell-icon-button' aria-label='User menu'>
                    <PtvIcon name='user' />
                </summary>
                <div className='ptv-shell-user-panel'>
                    <a href={PTV_ROUTES.profilePreferences}>
                        <PtvIcon name='profile' />
                        <span>Profile</span>
                    </a>
                    <a href={PTV_SHELL_SERVER_HREF}>
                        <PtvIcon name='server' />
                        <span>Select Server</span>
                    </a>
                    <a href={PTV_SHELL_SIGNOUT_HREF}>
                        <PtvIcon name='signout' />
                        <span>Sign Out</span>
                    </a>
                </div>
            </details>
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
                    className={`ptv-shell-context-link${isPtvShellHrefActive(link.href) ? ' is-active' : ''}`}
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
    children,
    className = '',
    contextualLinks,
    mediaDock,
    onNavigationOpenChange,
    section = 'home',
    title
}: PTVShellProps) {
    const { isAdmin } = usePtvAdminDebugVisibility();
    const navRef = useRef<HTMLElement | null>(null);
    const appLogoUrl = resolvePtvStaticAssetUrl(PTV_ASSETS.logos.bannerLight);
    const hash = window.location.hash || PTV_ROUTES.home;
    const navGroups = useMemo(() => getPtvShellNavGroups(section, hash), [hash, section]);
    const contextLinks = contextualLinks || PTV_SHELL_CONTEXT_LINKS[section] || [];
    const reportNavigationOpenState = useCallback(() => {
        window.requestAnimationFrame(() => {
            onNavigationOpenChange?.(Boolean(navRef.current?.querySelector('details[open]')));
        });
    }, [onNavigationOpenChange]);

    useEffect(() => () => {
        onNavigationOpenChange?.(false);
    }, [onNavigationOpenChange]);

    return (
        <div
            className={`ptv-shell-frame ptv-shell-frame-${section} ${className}`.trim()}
            data-ptv-shell-section={section}
        >
            <header className='ptv-shell-header' aria-label='PiggieTV application shell'>
                <a className='ptv-shell-brand' href={PTV_ROUTES.home} aria-label='PiggieTV Home'>
                    <img alt={PTV_BRANDING.appName} decoding='async' loading='eager' src={appLogoUrl} />
                </a>

                <PtvShellSearch />

                <nav
                    ref={navRef}
                    className='ptv-shell-nav'
                    aria-label='PiggieTV media navigation'
                >
                    <div className='ptv-shell-nav-primary'>
                        {navGroups.map(group => (
                            <PtvShellDropdown
                                key={group.id}
                                {...group}
                                onOpenChange={reportNavigationOpenState}
                            />
                        ))}
                        {PTV_SHELL_PRIMARY_LINKS.map(link => (
                            <PtvShellDirectLink key={link.id} {...link} />
                        ))}
                        <PtvShellActions isAdmin={isAdmin} />
                    </div>
                </nav>
            </header>

            <PtvShellContextNav links={contextLinks} title={title} />

            <div className='ptv-shell-page-content'>
                {children}
            </div>

            {mediaDock ? (
                <div className='ptv-shell-media-dock-slot'>
                    {mediaDock}
                </div>
            ) : null}
        </div>
    );
}
