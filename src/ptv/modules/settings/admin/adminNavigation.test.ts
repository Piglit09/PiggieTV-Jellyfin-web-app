import { describe, expect, it } from 'vitest';

import {
    createDynamicPluginDestinations,
    createPtvAdminNavigationGroups,
    getPtvAdminDestination,
    getPtvAdminDestinationForLocation,
    getPtvAdminDestinationsForCategory,
    getPtvAdminManagementCategories,
    PTV_ADMIN_CATEGORIES,
    PTV_ADMIN_DESTINATIONS
} from './adminNavigation';

describe('PTV administration destination registry', () => {
    it('provides one grouped source of truth for the complete administration navigation', () => {
        expect(PTV_ADMIN_CATEGORIES.map(category => category.id)).toEqual([
            'overview', 'piggietv', 'people', 'media', 'playback', 'livetv', 'plugins', 'server'
        ]);
        expect(PTV_ADMIN_DESTINATIONS).toHaveLength(26);
        expect(getPtvAdminManagementCategories().map(category => category.id)).toEqual([
            'piggietv', 'people', 'media', 'playback', 'livetv', 'plugins', 'server'
        ]);
    });

    it('keeps canonical ids and routes unique without promoting compatibility aliases', () => {
        const canonicalIds = PTV_ADMIN_DESTINATIONS.map(destination => destination.id.toLowerCase());
        const canonicalRoutes = PTV_ADMIN_DESTINATIONS.map(destination => destination.href.toLowerCase());
        const aliases = PTV_ADMIN_DESTINATIONS.flatMap(destination => destination.aliases || [])
            .map(alias => alias.toLowerCase());

        expect(new Set(canonicalIds).size).toBe(canonicalIds.length);
        expect(new Set(canonicalRoutes).size).toBe(canonicalRoutes.length);
        expect(new Set(aliases).size).toBe(aliases.length);
        expect(aliases.filter(alias => canonicalRoutes.includes(alias))).toEqual([]);

        const navigationRoutes = createPtvAdminNavigationGroups()
            .flatMap(group => group.destinations.map(destination => destination.href.toLowerCase()));
        expect(navigationRoutes).toEqual(canonicalRoutes);
        expect(navigationRoutes.filter(route => aliases.includes(route))).toEqual([]);
    });

    it('retains every known primary legacy administration capability', () => {
        expect(PTV_ADMIN_DESTINATIONS.map(destination => destination.label)).toEqual(expect.arrayContaining([
            'Overview',
            'PiggieTV Configuration',
            'Home Rows',
            'Diagnostics',
            'Users',
            'Signup & Invites',
            'Devices',
            'Activity',
            'Libraries',
            'Library Display',
            'Metadata',
            'NFO Settings',
            'Media Management',
            'Metadata Quality',
            'Metadata Manager',
            'Playback',
            'Live TV',
            'DVR',
            'Plugin Manager',
            'General',
            'Branding',
            'Networking',
            'API Keys',
            'Backups',
            'Logs',
            'Scheduled Tasks'
        ]));
    });

    it('resolves nested and compatibility routes to their parent navigation entry', () => {
        expect(getPtvAdminDestinationForLocation('/settings/admin/piggietv')?.id).toBe('piggietv-configuration');
        expect(getPtvAdminDestinationForLocation('/settings/admin/piggietv/rows')?.id).toBe('home-rows');
        expect(getPtvAdminDestinationForLocation('/settings/admin/piggietv/diagnostics')?.id).toBe('diagnostics');
        expect(getPtvAdminDestinationForLocation('/dashboard/piggietv')?.id).toBe('piggietv-configuration');
        expect(getPtvAdminDestinationForLocation('/dashboard/piggietv/rows')?.id).toBe('home-rows');
        expect(getPtvAdminDestinationForLocation('/dashboard/piggietv/diagnostics')?.id).toBe('diagnostics');
        expect(getPtvAdminDestinationForLocation('/dashboard/playback/transcoding')?.id).toBe('playback');
        expect(getPtvAdminDestinationForLocation('/dashboard/playback/streaming')?.id).toBe('playback');
        expect(getPtvAdminDestinationForLocation('/dashboard/playback/resume')?.id).toBe('playback');
        expect(getPtvAdminDestinationForLocation('/dashboard/playback/trickplay')?.id).toBe('playback');
        expect(getPtvAdminDestinationForLocation('/settings/admin/playback')?.id).toBe('playback');
        expect(getPtvAdminDestinationForLocation('/settings/admin/playback/trickplay')?.id).toBe('playback');
        expect(getPtvAdminDestinationForLocation('/dashboard/livetv')?.id).toBe('live-tv');
        expect(getPtvAdminDestinationForLocation('/dashboard/livetv/guide')?.id).toBe('live-tv');
        expect(getPtvAdminDestinationForLocation('/settings/admin/livetv/tuners/tuner-a')?.id).toBe('live-tv');
        expect(getPtvAdminDestinationForLocation('/dashboard/livetv/recordings')?.id).toBe('dvr');
        expect(getPtvAdminDestinationForLocation('/settings/admin/livetv/dvr')?.id).toBe('dvr');
        expect(getPtvAdminDestinationForLocation('/dashboard/tasks')?.id).toBe('scheduled-tasks');
        expect(getPtvAdminDestinationForLocation('/dashboard/tasks/task-a')?.id).toBe('scheduled-tasks');
        expect(getPtvAdminDestinationForLocation('/settings/admin/tasks')?.id).toBe('scheduled-tasks');
        expect(getPtvAdminDestinationForLocation('/settings/admin/tasks/task-a')?.id).toBe('scheduled-tasks');
        expect(getPtvAdminDestinationForLocation('/dashboard/users/profile')?.id).toBe('users');
        expect(getPtvAdminDestinationForLocation('/dashboard/libraries')?.id).toBe('libraries');
        expect(getPtvAdminDestinationForLocation('/settings/admin/libraries')?.id).toBe('libraries');
        expect(getPtvAdminDestinationForLocation('/dashboard/libraries/display')?.id).toBe('library-display');
        expect(getPtvAdminDestinationForLocation('/settings/admin/libraries/display')?.id).toBe('library-display');
        expect(getPtvAdminDestinationForLocation('/dashboard/libraries/metadata')?.id).toBe('library-metadata');
        expect(getPtvAdminDestinationForLocation('/settings/admin/libraries/metadata')?.id).toBe('library-metadata');
        expect(getPtvAdminDestinationForLocation('/dashboard/libraries/nfo')?.id).toBe('nfo-settings');
        expect(getPtvAdminDestinationForLocation('/settings/admin/libraries/nfo')?.id).toBe('nfo-settings');
        expect(getPtvAdminDestinationForLocation('/settings/admin/libraries/library-a')?.id).toBe('libraries');
        expect(getPtvAdminDestinationForLocation('/settings/admin/users')?.id).toBe('users');
        expect(getPtvAdminDestinationForLocation('/settings/admin/users/signup-invites')?.id).toBe('signup-invites');
        expect(getPtvAdminDestinationForLocation('/dashboard/users/signup-invites')?.id).toBe('signup-invites');
        expect(getPtvAdminDestinationForLocation('/settings/admin/users/member-a')?.id).toBe('users');
        expect(getPtvAdminDestinationForLocation('/dashboard/devices')?.id).toBe('devices');
        expect(getPtvAdminDestinationForLocation('/settings/admin/devices')?.id).toBe('devices');
        expect(getPtvAdminDestinationForLocation('/dashboard/activity')?.id).toBe('activity');
        expect(getPtvAdminDestinationForLocation('/settings/admin/activity')?.id).toBe('activity');
        expect(getPtvAdminDestinationForLocation('/dashboard/plugins/repositories')?.id).toBe('plugin-manager');
        expect(getPtvAdminDestinationForLocation('/dashboard/plugins/plugin-a')?.id).toBe('plugin-manager');
        expect(getPtvAdminDestinationForLocation('/settings/admin/plugins')?.id).toBe('plugin-manager');
        expect(getPtvAdminDestinationForLocation('/settings/admin/plugins/installed')?.id).toBe('plugin-manager');
        expect(getPtvAdminDestinationForLocation('/settings/admin/plugins/catalog')?.id).toBe('plugin-manager');
        expect(getPtvAdminDestinationForLocation('/settings/admin/plugins/repositories')?.id).toBe('plugin-manager');
        expect(getPtvAdminDestinationForLocation('/settings/admin/plugins/plugin-a')?.id).toBe('plugin-manager');
        expect(getPtvAdminDestinationForLocation('/dashboard/logs/server.log')?.id).toBe('logs');
        expect(getPtvAdminDestinationForLocation('/settings/admin/server/general')?.id).toBe('general');
        expect(getPtvAdminDestinationForLocation('/settings/admin/server/branding')?.id).toBe('branding');
        expect(getPtvAdminDestinationForLocation('/settings/admin/server/networking')?.id).toBe('networking');
        expect(getPtvAdminDestinationForLocation('/settings/admin/server/api-keys')?.id).toBe('api-keys');
        expect(getPtvAdminDestinationForLocation('/settings/admin/server/backups')?.id).toBe('backups');
        expect(getPtvAdminDestinationForLocation('/settings/admin/server/logs/server.log')?.id).toBe('logs');
        expect(getPtvAdminDestinationForLocation('/metadata')?.id).toBe('metadata-manager');
        expect(getPtvAdminDestinationForLocation('/settings/admin/media/metadata-quality')?.id).toBe('metadata-quality');
        expect(getPtvAdminDestinationForLocation('/settings/admin/media/metadata-quality/item-a')?.id).toBe('metadata-quality');
        expect(getPtvAdminDestinationForLocation('/settings/admin/media/metadata-manager')?.id).toBe('metadata-manager');
        expect(getPtvAdminDestinationForLocation('/settings/admin/media/metadata-manager/item-a')?.id).toBe('metadata-manager');
        expect(getPtvAdminDestinationForLocation('/settings/admin/media')?.id).toBe('media-management');
        expect(getPtvAdminDestinationForLocation('/dashboard/piggietv/recommendations')?.id).toBe('home-rows');
    });

    it.each([
        [ '/settings/admin/piggietv', 'piggietv-configuration' ],
        [ '/settings/admin/piggietv/rows', 'home-rows' ],
        [ '/settings/admin/piggietv/diagnostics', 'diagnostics' ],
        [ '/dashboard/piggietv', 'piggietv-configuration' ],
        [ '/dashboard/piggietv/rows', 'home-rows' ],
        [ '/dashboard/piggietv/diagnostics', 'diagnostics' ],
        [ '/dashboard/users/access', 'users' ],
        [ '/dashboard/users/parentalcontrol', 'users' ],
        [ '/settings/admin/livetv/guide/provider-a', 'live-tv' ],
        [ '/settings/admin/server/logs/archive/server.log', 'logs' ]
    ])('resolves the active parent for nested route %s', (path, destinationId) => {
        expect(getPtvAdminDestinationForLocation(path)?.id).toBe(destinationId);
    });

    it('returns destinations by stable id and category', () => {
        expect(getPtvAdminDestination('piggietv-configuration')).toMatchObject({
            aliases: [ '#/dashboard/piggietv' ],
            href: '/settings/admin/piggietv',
            migrationStatus: 'PTV_NATIVE',
            routeKind: 'router',
            source: 'ptv'
        });
        expect(getPtvAdminDestination('home-rows')).toMatchObject({
            aliases: [
                '#/dashboard/piggietv/rows',
                '#/dashboard/piggietv/recommendations'
            ],
            href: '/settings/admin/piggietv/rows',
            migrationStatus: 'PTV_NATIVE',
            routeKind: 'router',
            source: 'ptv'
        });
        expect(getPtvAdminDestination('diagnostics')).toMatchObject({
            aliases: [ '#/dashboard/piggietv/diagnostics' ],
            href: '/settings/admin/piggietv/diagnostics',
            migrationStatus: 'PTV_NATIVE',
            routeKind: 'router',
            source: 'ptv'
        });
        expect(getPtvAdminDestination('users')).toMatchObject({
            aliases: [ '#/dashboard/users' ],
            href: '/settings/admin/users',
            migrationStatus: 'PTV_NATIVE',
            routeKind: 'router',
            source: 'ptv'
        });
        expect(getPtvAdminDestination('signup-invites')).toMatchObject({
            aliases: [ '#/dashboard/users/signup-invites' ],
            href: '/settings/admin/users/signup-invites',
            migrationStatus: 'PTV_NATIVE',
            routeKind: 'router',
            source: 'ptv'
        });
        expect(getPtvAdminDestination('devices')).toMatchObject({
            aliases: [ '#/dashboard/devices' ],
            href: '/settings/admin/devices',
            migrationStatus: 'PTV_NATIVE',
            routeKind: 'router',
            source: 'ptv'
        });
        expect(getPtvAdminDestination('activity')).toMatchObject({
            aliases: [ '#/dashboard/activity' ],
            href: '/settings/admin/activity',
            migrationStatus: 'PTV_NATIVE',
            routeKind: 'router',
            source: 'ptv'
        });
        expect(getPtvAdminDestination('libraries')).toMatchObject({
            aliases: [ '#/dashboard/libraries' ],
            href: '/settings/admin/libraries',
            migrationStatus: 'PTV_NATIVE',
            routeKind: 'router',
            source: 'ptv'
        });
        expect(getPtvAdminDestination('library-display')).toMatchObject({
            aliases: [ '#/dashboard/libraries/display' ],
            href: '/settings/admin/libraries/display',
            migrationStatus: 'PTV_NATIVE',
            routeKind: 'router',
            source: 'ptv'
        });
        expect(getPtvAdminDestination('library-metadata')).toMatchObject({
            aliases: [ '#/dashboard/libraries/metadata' ],
            href: '/settings/admin/libraries/metadata',
            migrationStatus: 'PTV_NATIVE',
            routeKind: 'router',
            source: 'ptv'
        });
        expect(getPtvAdminDestination('nfo-settings')).toMatchObject({
            aliases: [ '#/dashboard/libraries/nfo' ],
            href: '/settings/admin/libraries/nfo',
            migrationStatus: 'PTV_NATIVE',
            routeKind: 'router',
            source: 'ptv'
        });
        expect(getPtvAdminDestination('metadata-manager')).toMatchObject({
            aliases: [ '#/metadata' ],
            href: '/settings/admin/media/metadata-manager',
            migrationStatus: 'PTV_NATIVE',
            routeKind: 'router',
            source: 'ptv'
        });
        expect(getPtvAdminDestination('metadata-quality')).toMatchObject({
            href: '/settings/admin/media/metadata-quality',
            label: 'Metadata Quality',
            migrationStatus: 'PTV_NATIVE',
            routeKind: 'router',
            source: 'ptv'
        });
        expect(getPtvAdminDestination('scheduled-tasks')).toMatchObject({
            aliases: [ '#/dashboard/tasks' ],
            href: '/settings/admin/tasks',
            label: 'Scheduled Tasks',
            migrationStatus: 'PTV_NATIVE',
            routeKind: 'router',
            source: 'ptv'
        });
        expect(getPtvAdminDestination('plugin-manager')).toMatchObject({
            aliases: [
                '#/dashboard/plugins',
                '#/dashboard/plugins/catalog',
                '#/dashboard/plugins/repositories'
            ],
            href: '/settings/admin/plugins',
            migrationStatus: 'PTV_NATIVE',
            routeKind: 'router',
            source: 'ptv'
        });
        expect(getPtvAdminDestination('playback')).toMatchObject({
            aliases: [
                '#/dashboard/playback/streaming',
                '#/dashboard/playback/transcoding',
                '#/dashboard/playback/resume',
                '#/dashboard/playback/trickplay'
            ],
            href: '/settings/admin/playback',
            migrationStatus: 'PTV_NATIVE',
            routeKind: 'router',
            source: 'ptv'
        });
        expect(getPtvAdminDestination('live-tv')).toMatchObject({
            href: '/settings/admin/livetv',
            migrationStatus: 'PTV_NATIVE',
            routeKind: 'router',
            source: 'ptv'
        });
        expect(getPtvAdminDestination('dvr')).toMatchObject({
            href: '/settings/admin/livetv/dvr',
            migrationStatus: 'PTV_NATIVE',
            routeKind: 'router',
            source: 'ptv'
        });
        expect(getPtvAdminDestination('general')).toMatchObject({
            aliases: [ '#/dashboard/settings' ],
            href: '/settings/admin/server/general',
            migrationStatus: 'PTV_NATIVE',
            routeKind: 'router',
            source: 'ptv'
        });
        expect(getPtvAdminDestination('networking')).toMatchObject({
            aliases: [ '#/dashboard/networking' ],
            href: '/settings/admin/server/networking',
            migrationStatus: 'PTV_NATIVE',
            routeKind: 'router',
            source: 'ptv'
        });
        expect(getPtvAdminDestination('logs')).toMatchObject({
            aliases: [ '#/dashboard/logs' ],
            href: '/settings/admin/server/logs',
            migrationStatus: 'PTV_NATIVE',
            routeKind: 'router',
            source: 'ptv'
        });
        expect(getPtvAdminDestinationsForCategory('playback').map(destination => destination.id)).toEqual([ 'playback' ]);
    });
});

describe('dynamic plugin administration destinations', () => {
    it('normalizes registered plugin pages and safely falls back title and icon', () => {
        const destinations = createDynamicPluginDestinations([
            {
                DisplayName: 'Intro Skipper',
                EnableInMainMenu: true,
                MenuIcon: 'folder',
                Name: 'IntroSkipperConfig',
                PluginId: 'plugin-a'
            },
            {
                EnableInMainMenu: true,
                MenuIcon: 'not-an-icon',
                Name: 'Playback Reporting',
                PluginId: null
            }
        ]);

        expect(destinations).toEqual([
            expect.objectContaining({
                href: '#/configurationpage?name=IntroSkipperConfig',
                icon: 'folders',
                id: 'plugin:plugin-a:introskipperconfig',
                label: 'Intro Skipper',
                migrationStatus: 'DYNAMIC_PLUGIN'
            }),
            expect.objectContaining({
                href: '#/configurationpage?name=Playback%20Reporting',
                icon: 'reports',
                id: 'plugin:unknown:playback reporting',
                label: 'Playback Reporting'
            })
        ]);
    });

    it('filters unavailable pages, deduplicates names, and keeps multiple pages from one plugin', () => {
        const destinations = createDynamicPluginDestinations([
            { DisplayName: 'Missing route', Name: '  ', PluginId: 'a' },
            { DisplayName: 'Disabled', EnableInMainMenu: false, Name: 'disabled', PluginId: 'a' },
            { DisplayName: 'Reports', Name: 'reports', PluginId: 'shared' },
            { DisplayName: 'Duplicate Reports', Name: 'REPORTS', PluginId: 'other' },
            { DisplayName: 'Reports Detail', Name: 'reports-detail', PluginId: 'shared' }
        ]);

        expect(destinations.map(destination => destination.label)).toEqual([ 'Reports', 'Reports Detail' ]);
    });

    it('handles a plugin page disappearing without throwing', () => {
        expect(createDynamicPluginDestinations([])).toEqual([]);
        expect(createDynamicPluginDestinations()).toEqual([]);
    });

    it('preserves long titles as text without using them as an unsafe icon value', () => {
        const [ destination ] = createDynamicPluginDestinations([{
            DisplayName: 'A Very Long Plugin Administration Configuration Page Title',
            MenuIcon: '<script>',
            Name: 'long-plugin'
        }]);

        expect(destination.label).toBe('A Very Long Plugin Administration Configuration Page Title');
        expect(destination.icon).toBe('plugins');
    });

    it('cannot duplicate a static destination when plugin metadata reuses its labels and identifiers', () => {
        const dynamicDestinations = createDynamicPluginDestinations([
            {
                DisplayName: 'Overview',
                Name: 'overview',
                PluginId: 'overview'
            },
            {
                DisplayName: 'Plugin Manager',
                Name: 'plugin-manager',
                PluginId: 'plugin-manager'
            }
        ]);
        const staticIds = new Set(PTV_ADMIN_DESTINATIONS.map(destination => destination.id.toLowerCase()));
        const staticRoutes = new Set(PTV_ADMIN_DESTINATIONS.map(destination => destination.href.toLowerCase()));

        expect(dynamicDestinations).toHaveLength(2);
        expect(dynamicDestinations.every(destination => !staticIds.has(destination.id.toLowerCase()))).toBe(true);
        expect(dynamicDestinations.every(destination => !staticRoutes.has(destination.href.toLowerCase()))).toBe(true);
    });
});
