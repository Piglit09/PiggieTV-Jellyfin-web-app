import type { PtvIconName } from '../modules/icons';
import { getRegisteredNavigationSections } from '../core/lifecycle';
import { PTV_ROUTES } from '../core/config';

export type PtvNavigationPermission = 'admin' | 'authenticated' | 'guest';

export type PtvNavigationItem = {
    href: string;
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

export const PTV_NAVIGATION_SECTIONS: PtvNavigationSection[] = [
    {
        id: 'main',
        items: [
            { id: 'home', label: 'Home', href: PTV_ROUTES.home, icon: 'home' }
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
            { id: 'collections', label: 'Collections', href: '#/collections', icon: 'collections' },
            { id: 'livetv', label: 'Live TV', href: '#/livetv', icon: 'liveTv' },
            { id: 'guide', label: 'Guide', href: '#/livetv.html?tab=guide', icon: 'guide' },
            { id: 'playlists', label: 'Playlists', href: '#/playlists', icon: 'playlists' }
        ]
    },
    {
        id: 'admin',
        title: 'Administration',
        items: [
            { id: 'dashboard', label: 'Dashboard', href: '#/dashboard', icon: 'dashboard', permission: 'admin' },
            { id: 'piggietv-dashboard', label: 'PiggieTV', href: '#/dashboard/piggietv', icon: 'piggieHub', permission: 'admin' },
            { id: 'signup-invites', label: 'Signup / Invites', href: '#/dashboard/users/signup-invites', icon: 'users', permission: 'admin' },
            { id: 'metadata-manager', label: 'Metadata Manager', href: '#/metadata', icon: 'metadata', permission: 'admin' }
        ]
    },
    {
        id: 'user',
        title: 'User',
        items: [
            { id: 'select-server', label: 'Select Server', href: '#/selectserver', icon: 'server' },
            { id: 'settings', label: 'Settings', href: '#/settings', icon: 'settings' },
            { id: 'signout', label: 'Sign Out', href: '#/logout', icon: 'signout' }
        ]
    },
    {
        id: 'piggie-hub',
        title: 'Piggie Hub',
        items: [
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

        existing.items.push(...section.items);
        existing.title ||= section.title;
    });

    return Array.from(sectionMap.values());
}

export function getPtvNavigationSections() {
    return mergeNavigationSections(
        PTV_NAVIGATION_SECTIONS,
        getRegisteredNavigationSections() as PtvNavigationSection[]
    );
}
