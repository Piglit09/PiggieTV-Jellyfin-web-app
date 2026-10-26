import type { PtvIconName } from '../modules/icons';
import { getRegisteredNavigationSections } from '../core/lifecycle';
import { PTV_ROUTES } from '../core/config';
import { getPtvAdminDestination } from '../modules/settings/admin/adminNavigation';
import { isPtvPlatformNavigationEntryAvailable } from '../core/platformFeatures';
import type { PtvNavigationAccess } from './navigationAccess';

export type PtvNavigationPermission = 'admin' | 'authenticated' | 'guest';
export type PtvNavigationAction = 'logout';

export type PtvNavigationItem = {
    action?: PtvNavigationAction;
    href?: string;
    icon: PtvIconName;
    id: string;
    isExternal?: boolean;
    label: string;
    permission?: PtvNavigationPermission;
};

export type PtvNavigationSection = {
    id: string;
    items: PtvNavigationItem[];
    title?: string;
};

function createAdminNavigationItem(
    id: string,
    destinationId: string
): PtvNavigationItem | null {
    const destination = getPtvAdminDestination(destinationId);
    if (!destination) return null;

    return {
        href: destination.routeKind === 'router' ? `#${destination.href}` : destination.href,
        icon: destination.icon,
        id,
        label: destination.label,
        permission: 'admin'
    };
}

const ADMIN_NAVIGATION_ITEMS = [
    createAdminNavigationItem('dashboard', 'overview'),
    createAdminNavigationItem('piggietv-dashboard', 'piggietv-configuration'),
    createAdminNavigationItem('piggietv-row-builder', 'home-rows'),
    createAdminNavigationItem('piggietv-diagnostics', 'diagnostics'),
    createAdminNavigationItem('signup-invites', 'signup-invites'),
    createAdminNavigationItem('metadata-manager', 'metadata-manager')
].filter((item): item is PtvNavigationItem => item !== null);

export const PTV_NAVIGATION_SECTIONS: PtvNavigationSection[] = [
    {
        id: 'main',
        items: [
            { id: 'home', label: 'Home', href: PTV_ROUTES.home, icon: 'home' },
            { id: 'recommendations', label: 'Recommendations', href: PTV_ROUTES.recommendations, icon: 'shuffle' }
        ]
    },
    {
        id: 'media',
        title: 'Media',
        items: [
            { id: 'anime', label: 'Anime', href: '#/tv?topParentId=anime', icon: 'anime' },
            { id: 'anime-movies', label: 'Anime Movies', href: '#/movies?topParentId=animemovies', icon: 'animeMovies' },
            { id: 'cartoons', label: 'Cartoons', href: '#/tv?topParentId=cartoons', icon: 'cartoons' },
            { id: 'movies', label: 'Movies', href: '#/movies', icon: 'movies' },
            { id: 'shows', label: 'Shows', href: '#/tv', icon: 'shows' },
            { id: 'music', label: 'Music', href: '#/music', icon: 'music' },
            { id: 'reading-library', label: 'PTV Reading', href: PTV_ROUTES.reading, icon: 'books' },
            { id: 'collections', label: 'Collections', href: '#/collections', icon: 'collections' },
            { id: 'livetv', label: 'Live TV', href: '#/livetv', icon: 'liveTv' },
            { id: 'guide', label: 'Guide', href: '#/livetv.html?tab=guide', icon: 'guide' },
            { id: 'playlists', label: 'Playlists', href: '#/playlists', icon: 'playlists' }
        ]
    },
    {
        id: 'admin',
        title: 'Administration',
        items: ADMIN_NAVIGATION_ITEMS
    },
    {
        id: 'user',
        title: 'User',
        items: [
            { id: 'select-server', label: 'Select Server', href: '#/selectserver', icon: 'server' },
            { id: 'settings', label: 'Settings', href: '#/settings', icon: 'settings' },
            { id: 'signout', label: 'Sign Out', action: 'logout', icon: 'signout' }
        ]
    },
    {
        id: 'piggie-hub',
        title: 'Piggie Hub',
        items: [
            {
                id: 'calendar',
                label: 'Release Calendar',
                href: PTV_ROUTES.calendar,
                icon: 'activity',
                permission: 'authenticated'
            },
            {
                id: 'request',
                label: 'Request',
                href: PTV_ROUTES.request,
                icon: 'request'
            }
        ]
    }
];

function mergeNavigationSections(
    baseSections: PtvNavigationSection[],
    registeredSections: PtvNavigationSection[]
) {
    const sectionMap = new Map<string, PtvNavigationSection>();

    baseSections.forEach(section => {
        sectionMap.set(section.id, {
            ...section,
            items: [...section.items]
        });
    });

    registeredSections.forEach(section => {
        const existing = sectionMap.get(section.id);

        if (!existing) {
            sectionMap.set(section.id, {
                ...section,
                items: [...section.items]
            });
            return;
        }

        section.items.forEach(item => {
            if (existing.items.some(existingItem => existingItem.id === item.id)) return;

            existing.items.push(item);
        });
        existing.title ||= section.title;
    });

    return Array.from(sectionMap.values());
}

function getAccessibleMediaItems(access: PtvNavigationAccess | null): PtvNavigationItem[] {
    if (!access) return [];

    const movieItems: PtvNavigationItem[] = access.movies.map(view => ({
        href: `#/movies?topParentId=${encodeURIComponent(view.id)}`,
        icon: view.kind === 'animeMovies' ? 'animeMovies' : 'movies',
        id: `movie-library-${view.id}`,
        label: view.name
    }));
    const showItems: PtvNavigationItem[] = access.shows.map(view => ({
        href: `#/tv?topParentId=${encodeURIComponent(view.id)}`,
        icon: getPtvSidebarShowIcon(view.kind),
        id: `show-library-${view.id}`,
        label: view.name
    }));
    const readingItems: PtvNavigationItem[] = access.reading.length ? [{
        href: PTV_ROUTES.reading,
        icon: 'books',
        id: 'reading-library',
        label: 'PTV Reading'
    }] : [];

    return [
        ...movieItems,
        ...showItems,
        ...(access.music.length ? [{ id: 'music', label: 'Music', href: PTV_ROUTES.music, icon: 'music' as const }] : []),
        ...readingItems,
        ...(access.collections ? [{ id: 'collections', label: 'Collections', href: PTV_ROUTES.collections, icon: 'collections' as const }] : []),
        ...(access.liveTv ? (PTV_NAVIGATION_SECTIONS.find(section => section.id === 'media')?.items
            .filter(item => ['livetv', 'guide'].includes(item.id)) || []) : []),
        ...(access.music.length ? [{ id: 'playlists', label: 'Playlists', href: '#/playlists', icon: 'playlists' as const }] : [])
    ];
}

function getPtvSidebarShowIcon(kind: 'anime' | 'cartoons' | 'shows'): PtvIconName {
    if (kind === 'anime') return 'anime';
    if (kind === 'cartoons') return 'cartoons';
    return 'shows';
}

function getPtvSectionItems(section: PtvNavigationSection, access: PtvNavigationAccess | null) {
    if (section.id === 'admin' && !access?.isAdmin) return [];
    if (section.id === 'media') return getAccessibleMediaItems(access);
    return section.items;
}

// Route classification describes registered destinations, regardless of the
// currently signed-in user's visible navigation projection.
export function getPtvRouteNavigationSections() {
    return mergeNavigationSections(
        PTV_NAVIGATION_SECTIONS,
        getRegisteredNavigationSections() as PtvNavigationSection[]
    ).map(section => ({
        ...section,
        items: section.items.filter(item => isPtvPlatformNavigationEntryAvailable(item))
    })).filter(section => section.items.length > 0);
}

export function getPtvNavigationSections(
    access: PtvNavigationAccess | null = null,
    { calendarAvailable = false }: Readonly<{ calendarAvailable?: boolean }> = {}
) {
    return getPtvRouteNavigationSections().map(section => ({
        ...section,
        items: getPtvSectionItems(section, access)
            .filter(item => item.permission !== 'admin' || access?.isAdmin === true)
            .filter(item => item.id !== 'calendar' || calendarAvailable)
            .filter(item => isPtvPlatformNavigationEntryAvailable(item))
    })).filter(section => section.items.length > 0);
}
