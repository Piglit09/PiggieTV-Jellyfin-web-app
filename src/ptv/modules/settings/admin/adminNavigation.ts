import type { ConfigurationPageInfo } from '@jellyfin/sdk/lib/generated-client/models/configuration-page-info';

import { getPtvIconNameFromText, normalizePtvIconName, type PtvIconName } from '../../icons/iconRegistry';

export type PtvAdminCategoryId =
    | 'overview'
    | 'piggietv'
    | 'people'
    | 'media'
    | 'playback'
    | 'livetv'
    | 'plugins'
    | 'server';

export type PtvAdminDestinationSource = 'jellyfin' | 'plugin' | 'ptv';
export type PtvAdminMigrationStatus =
    | 'PTV_NATIVE'
    | 'PTV_WRAPPED'
    | 'LEGACY_ROUTE'
    | 'DYNAMIC_PLUGIN'
    | 'REDIRECTED';

export type PtvAdminDestination = Readonly<{
    aliases?: readonly string[];
    category: PtvAdminCategoryId;
    description: string;
    href: string;
    icon: PtvIconName;
    id: string;
    label: string;
    migrationStatus: PtvAdminMigrationStatus;
    routeKind: 'hash' | 'router';
    source: PtvAdminDestinationSource;
}>;

export type PtvAdminCategory = Readonly<{
    description: string;
    icon: PtvIconName;
    id: PtvAdminCategoryId;
    label: string;
}>;

export type PtvAdminNavigationGroup = Readonly<{
    category: PtvAdminCategory;
    destinations: readonly PtvAdminDestination[];
}>;

export const PTV_ADMIN_CATEGORIES: readonly PtvAdminCategory[] = [
    { description: 'System health and activity', icon: 'dashboard', id: 'overview', label: 'Overview' },
    { description: 'Plugin, rows and PTV runtime tools', icon: 'piggieHub', id: 'piggietv', label: 'PiggieTV' },
    { description: 'Users, invitations, devices and activity', icon: 'users', id: 'people', label: 'People' },
    { description: 'Libraries, metadata and catalog tools', icon: 'libraries', id: 'media', label: 'Media' },
    { description: 'Streaming, transcoding and playback processing', icon: 'playback', id: 'playback', label: 'Playback' },
    { description: 'Live channels, tuners and recording', icon: 'liveTv', id: 'livetv', label: 'Live TV' },
    { description: 'Installed extensions and configuration', icon: 'plugins', id: 'plugins', label: 'Plugins' },
    { description: 'Core settings, security and maintenance', icon: 'server', id: 'server', label: 'Server' }
] as const;

export const PTV_ADMIN_DESTINATIONS: readonly PtvAdminDestination[] = [
    {
        aliases: [ '#/dashboard' ],
        category: 'overview',
        description: 'Server health and activity',
        href: '/settings/admin',
        icon: 'dashboard',
        id: 'overview',
        label: 'Overview',
        migrationStatus: 'PTV_NATIVE',
        routeKind: 'router',
        source: 'ptv'
    },
    {
        aliases: [ '#/dashboard/piggietv' ],
        category: 'piggietv',
        description: 'Plugin, cache and integration configuration',
        href: '/settings/admin/piggietv',
        icon: 'piggieHub',
        id: 'piggietv-configuration',
        label: 'PiggieTV Configuration',
        migrationStatus: 'PTV_NATIVE',
        routeKind: 'router',
        source: 'ptv'
    },
    {
        aliases: [
            '#/dashboard/piggietv/rows',
            '#/dashboard/piggietv/recommendations'
        ],
        category: 'piggietv',
        description: 'Configure PiggieTV Home content rows',
        href: '/settings/admin/piggietv/rows',
        icon: 'grid',
        id: 'home-rows',
        label: 'Home Rows',
        migrationStatus: 'PTV_NATIVE',
        routeKind: 'router',
        source: 'ptv'
    },
    {
        aliases: [ '#/dashboard/piggietv/diagnostics' ],
        category: 'piggietv',
        description: 'PTV runtime, plugin and client health',
        href: '/settings/admin/piggietv/diagnostics',
        icon: 'activity',
        id: 'diagnostics',
        label: 'Diagnostics',
        migrationStatus: 'PTV_NATIVE',
        routeKind: 'router',
        source: 'ptv'
    },
    {
        aliases: [ '#/dashboard/users' ],
        category: 'people',
        description: 'Profiles, policies and access',
        href: '/settings/admin/users',
        icon: 'users',
        id: 'users',
        label: 'Users',
        migrationStatus: 'PTV_NATIVE',
        routeKind: 'router',
        source: 'ptv'
    },
    {
        aliases: [ '#/dashboard/users/signup-invites' ],
        category: 'people',
        description: 'Registration links and pending invitations',
        href: '/settings/admin/users/signup-invites',
        icon: 'request',
        id: 'signup-invites',
        label: 'Signup & Invites',
        migrationStatus: 'PTV_NATIVE',
        routeKind: 'router',
        source: 'ptv'
    },
    {
        aliases: [ '#/dashboard/devices' ],
        category: 'people',
        description: 'Server-wide device access and sessions',
        href: '/settings/admin/devices',
        icon: 'devices',
        id: 'devices',
        label: 'Devices',
        migrationStatus: 'PTV_NATIVE',
        routeKind: 'router',
        source: 'ptv'
    },
    {
        aliases: [ '#/dashboard/activity' ],
        category: 'people',
        description: 'Recent server and account activity',
        href: '/settings/admin/activity',
        icon: 'activity',
        id: 'activity',
        label: 'Activity',
        migrationStatus: 'PTV_NATIVE',
        routeKind: 'router',
        source: 'ptv'
    },
    {
        aliases: [ '#/dashboard/libraries' ],
        category: 'media',
        description: 'Add, organize, scan and configure media sources',
        href: '/settings/admin/libraries',
        icon: 'libraries',
        id: 'libraries',
        label: 'Libraries',
        migrationStatus: 'PTV_NATIVE',
        routeKind: 'router',
        source: 'ptv'
    },
    {
        aliases: [ '#/dashboard/libraries/display' ],
        category: 'media',
        description: 'Server-shaped library presentation behavior',
        href: '/settings/admin/libraries/display',
        icon: 'display',
        id: 'library-display',
        label: 'Library Display',
        migrationStatus: 'PTV_NATIVE',
        routeKind: 'router',
        source: 'ptv'
    },
    {
        aliases: [ '#/dashboard/libraries/metadata' ],
        category: 'media',
        description: 'Global metadata language and chapter defaults',
        href: '/settings/admin/libraries/metadata',
        icon: 'metadata',
        id: 'library-metadata',
        label: 'Metadata',
        migrationStatus: 'PTV_NATIVE',
        routeKind: 'router',
        source: 'ptv'
    },
    {
        aliases: [ '#/dashboard/libraries/nfo' ],
        category: 'media',
        description: 'NFO writing and compatibility options',
        href: '/settings/admin/libraries/nfo',
        icon: 'metadata',
        id: 'nfo-settings',
        label: 'NFO Settings',
        migrationStatus: 'PTV_NATIVE',
        routeKind: 'router',
        source: 'ptv'
    },
    {
        category: 'media',
        description: 'PiggieTV catalog tools and launchers',
        href: '/settings/admin/media',
        icon: 'metadata',
        id: 'media-management',
        label: 'Media Management',
        migrationStatus: 'PTV_NATIVE',
        routeKind: 'router',
        source: 'ptv'
    },
    {
        category: 'media',
        description: 'Audit suspicious matches and incomplete metadata',
        href: '/settings/admin/media/metadata-quality',
        icon: 'quality',
        id: 'metadata-quality',
        label: 'Metadata Quality',
        migrationStatus: 'PTV_NATIVE',
        routeKind: 'router',
        source: 'ptv'
    },
    {
        aliases: [ '#/metadata' ],
        category: 'media',
        description: 'Edit titles, artwork and item metadata',
        href: '/settings/admin/media/metadata-manager',
        icon: 'metadata',
        id: 'metadata-manager',
        label: 'Metadata Manager',
        migrationStatus: 'PTV_NATIVE',
        routeKind: 'router',
        source: 'ptv'
    },
    {
        aliases: [
            '#/dashboard/playback/streaming',
            '#/dashboard/playback/transcoding',
            '#/dashboard/playback/resume',
            '#/dashboard/playback/trickplay'
        ],
        category: 'playback',
        description: 'Server streaming, transcoding, resume and trickplay behavior',
        href: '/settings/admin/playback',
        icon: 'playback',
        id: 'playback',
        label: 'Playback',
        migrationStatus: 'PTV_NATIVE',
        routeKind: 'router',
        source: 'ptv'
    },
    {
        aliases: [
            '#/dashboard/livetv',
            '#/dashboard/livetv/guide',
            '#/dashboard/livetv/tuner'
        ],
        category: 'livetv',
        description: 'Tuners, guide data and channel setup',
        href: '/settings/admin/livetv',
        icon: 'liveTv',
        id: 'live-tv',
        label: 'Live TV',
        migrationStatus: 'PTV_NATIVE',
        routeKind: 'router',
        source: 'ptv'
    },
    {
        aliases: [ '#/dashboard/livetv/recordings' ],
        category: 'livetv',
        description: 'Recording and DVR configuration',
        href: '/settings/admin/livetv/dvr',
        icon: 'dvr',
        id: 'dvr',
        label: 'DVR',
        migrationStatus: 'PTV_NATIVE',
        routeKind: 'router',
        source: 'ptv'
    },
    {
        aliases: [
            '#/dashboard/plugins',
            '#/dashboard/plugins/catalog',
            '#/dashboard/plugins/repositories'
        ],
        category: 'plugins',
        description: 'Installed plugins, catalog and repositories',
        href: '/settings/admin/plugins',
        icon: 'plugins',
        id: 'plugin-manager',
        label: 'Plugin Manager',
        migrationStatus: 'PTV_NATIVE',
        routeKind: 'router',
        source: 'ptv'
    },
    {
        aliases: [ '#/dashboard/settings' ],
        category: 'server',
        description: 'Name, locale, paths and core behavior',
        href: '/settings/admin/server/general',
        icon: 'general',
        id: 'general',
        label: 'General',
        migrationStatus: 'PTV_NATIVE',
        routeKind: 'router',
        source: 'ptv'
    },
    {
        aliases: [ '#/dashboard/branding' ],
        category: 'server',
        description: 'Installation branding and custom styles',
        href: '/settings/admin/server/branding',
        icon: 'branding',
        id: 'branding',
        label: 'Branding',
        migrationStatus: 'PTV_NATIVE',
        routeKind: 'router',
        source: 'ptv'
    },
    {
        aliases: [ '#/dashboard/networking' ],
        category: 'server',
        description: 'Ports, protocols and remote access',
        href: '/settings/admin/server/networking',
        icon: 'networking',
        id: 'networking',
        label: 'Networking',
        migrationStatus: 'PTV_NATIVE',
        routeKind: 'router',
        source: 'ptv'
    },
    {
        aliases: [ '#/dashboard/keys' ],
        category: 'server',
        description: 'Application credentials and integrations',
        href: '/settings/admin/server/api-keys',
        icon: 'apiKeys',
        id: 'api-keys',
        label: 'API Keys',
        migrationStatus: 'PTV_NATIVE',
        routeKind: 'router',
        source: 'ptv'
    },
    {
        aliases: [ '#/dashboard/backups' ],
        category: 'server',
        description: 'Create, restore and manage server backups',
        href: '/settings/admin/server/backups',
        icon: 'backups',
        id: 'backups',
        label: 'Backups',
        migrationStatus: 'PTV_NATIVE',
        routeKind: 'router',
        source: 'ptv'
    },
    {
        aliases: [ '#/dashboard/logs' ],
        category: 'server',
        description: 'Raw server log files',
        href: '/settings/admin/server/logs',
        icon: 'logs',
        id: 'logs',
        label: 'Logs',
        migrationStatus: 'PTV_NATIVE',
        routeKind: 'router',
        source: 'ptv'
    },
    {
        aliases: [ '#/dashboard/tasks' ],
        category: 'server',
        description: 'Background jobs and maintenance',
        href: '/settings/admin/tasks',
        icon: 'tasks',
        id: 'scheduled-tasks',
        label: 'Scheduled Tasks',
        migrationStatus: 'PTV_NATIVE',
        routeKind: 'router',
        source: 'ptv'
    }
] as const;

export const PTV_ADMIN_ROUTE_EXCLUSIONS = [
    { path: 'dashboard/logs/:file', reason: 'Compatibility detail route that redirects to native bounded log detail.' },
    { path: 'dashboard/plugins/:pluginId', reason: 'Compatibility detail route that redirects to native Plugin Manager detail.' },
    { path: 'dashboard/tasks/:id', reason: 'Detail route reached from Scheduled Tasks.' },
    { path: 'dashboard/users/access', reason: 'Compatibility redirect to the native user Access panel.' },
    { path: 'dashboard/users/add', reason: 'Compatibility redirect to the native user creation workflow.' },
    { path: 'dashboard/users/parentalcontrol', reason: 'Legacy parental controls retained until native equivalence exists.' },
    { path: 'dashboard/users/password', reason: 'Compatibility redirect to the native user Security panel.' },
    { path: 'dashboard/users/profile', reason: 'Compatibility redirect to the native user detail workspace.' }
] as const;

export const PTV_ADMIN_DYNAMIC_ROUTE_PATHS = [ 'configurationpage' ] as const;

function normalizeRoutePath(value: string) {
    const hashIndex = value.indexOf('#');
    const hashRoute = hashIndex >= 0 ? value.slice(hashIndex + 1) : value;
    return hashRoute.split('?')[0].replace(/^\//, '').replace(/\/$/, '').toLowerCase();
}

export function getPtvAdminCategory(id: PtvAdminCategoryId) {
    return PTV_ADMIN_CATEGORIES.find(category => category.id === id);
}

export function getPtvAdminDestination(id: string) {
    return PTV_ADMIN_DESTINATIONS.find(destination => destination.id === id);
}

export function getPtvAdminDestinationsForCategory(id: PtvAdminCategoryId) {
    return PTV_ADMIN_DESTINATIONS.filter(destination => destination.category === id);
}

export function getPtvAdminDestinationForLocation(pathname: string, search = '', hash = '') {
    const route = normalizeRoutePath(hash || `${pathname}${search}`);

    if (route.startsWith('configurationpage')) return undefined;

    const candidates = PTV_ADMIN_DESTINATIONS.flatMap(destination => (
        [ destination.href, ...(destination.aliases || []) ].map(destinationHref => ({
            destination,
            route: normalizeRoutePath(destinationHref)
        }))
    ));

    return candidates
        .filter(candidate => route === candidate.route || route.startsWith(`${candidate.route}/`))
        .sort((left, right) => right.route.length - left.route.length)[0]
        ?.destination;
}

export function createDynamicPluginDestinations(pages: readonly ConfigurationPageInfo[] = []) {
    const destinations: PtvAdminDestination[] = [];
    const names = new Set<string>();

    pages.forEach(page => {
        const name = page.Name?.trim();
        if (!name || page.EnableInMainMenu === false) return;

        const normalizedName = name.toLowerCase();
        if (names.has(normalizedName)) return;
        names.add(normalizedName);

        const label = page.DisplayName?.trim() || name;
        const textFallback = getPtvIconNameFromText(label, 'plugins') || 'plugins';

        destinations.push({
            category: 'plugins',
            description: 'Installed plugin configuration',
            href: `#/configurationpage?name=${encodeURIComponent(name)}`,
            icon: normalizePtvIconName(page.MenuIcon, textFallback),
            id: `plugin:${page.PluginId?.trim() || 'unknown'}:${normalizedName}`,
            label,
            migrationStatus: 'DYNAMIC_PLUGIN',
            routeKind: 'hash',
            source: 'plugin'
        });
    });

    return destinations;
}

export function createPtvAdminNavigationGroups(
    dynamicDestinations: readonly PtvAdminDestination[] = [],
    isLiveTvAvailable?: boolean
): PtvAdminNavigationGroup[] {
    const allDestinations = [ ...PTV_ADMIN_DESTINATIONS, ...dynamicDestinations ];

    return PTV_ADMIN_CATEGORIES
        .filter(category => category.id !== 'livetv' || isLiveTvAvailable !== false)
        .map(category => ({
            category,
            destinations: allDestinations.filter(destination => destination.category === category.id)
        }))
        .filter(group => group.destinations.length > 0);
}

export function getAdminLiveTvQueryKey(serverId: string) {
    return [ 'PtvAdminNavigation', serverId, 'LiveTvInfo' ] as const;
}

export function getPtvAdminManagementCategories() {
    return PTV_ADMIN_CATEGORIES.filter(category => category.id !== 'overview');
}
