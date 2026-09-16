import type { PtvIconName } from '../icons';

export type PtvSettingsSectionId =
    | 'hub'
    | 'profile'
    | 'devices'
    | 'appearance'
    | 'home'
    | 'playback'
    | 'subtitles'
    | 'controls'
    | 'connection'
    | 'admin'
    | 'admin-activity'
    | 'admin-devices'
    | 'admin-library-display'
    | 'admin-library-metadata'
    | 'admin-library-nfo'
    | 'admin-libraries'
    | 'admin-live-tv'
    | 'admin-dvr'
    | 'admin-metadata-quality'
    | 'admin-metadata-manager'
    | 'admin-playback'
    | 'admin-piggietv'
    | 'admin-plugins'
    | 'admin-server'
    | 'admin-tasks'
    | 'admin-signup-invites'
    | 'admin-users'
    | 'media';

export type PtvSettingsNavigationItem = Readonly<{
    description: string;
    href: string;
    icon: PtvIconName;
    id: Exclude<PtvSettingsSectionId, 'hub'>;
    label: string;
    permission?: 'admin';
}>;

export type PtvSettingsNavigationGroup = Readonly<{
    id: 'account' | 'piggietv' | 'administration' | 'actions';
    items: readonly PtvSettingsNavigationItem[];
    label: string;
}>;

export const PTV_SETTINGS_GROUPS: readonly PtvSettingsNavigationGroup[] = [
    {
        id: 'account',
        label: 'Account',
        items: [
            {
                description: 'Account information and security',
                href: '#/settings/profile',
                icon: 'profile',
                id: 'profile',
                label: 'Profile'
            },
            {
                description: 'Connect and manage your devices',
                href: '#/settings/devices',
                icon: 'devices',
                id: 'devices',
                label: 'Devices & Quick Connect'
            }
        ]
    },
    {
        id: 'piggietv',
        label: 'PiggieTV',
        items: [
            {
                description: 'Customize how PiggieTV looks',
                href: '#/settings/appearance',
                icon: 'display',
                id: 'appearance',
                label: 'Appearance'
            },
            {
                description: 'Choose what appears on Home',
                href: '#/settings/home',
                icon: 'home',
                id: 'home',
                label: 'Home Screen'
            },
            {
                description: 'Video quality and playback behavior',
                href: '#/settings/playback',
                icon: 'playback',
                id: 'playback',
                label: 'Playback'
            },
            {
                description: 'Language and appearance',
                href: '#/settings/subtitles',
                icon: 'subtitles',
                id: 'subtitles',
                label: 'Subtitles'
            },
            {
                description: 'Keyboard, remote and interaction preferences',
                href: '#/settings/controls',
                icon: 'controls',
                id: 'controls',
                label: 'Controls & Accessibility'
            }
        ]
    },
    {
        id: 'administration',
        label: 'Administration',
        items: [
            {
                description: 'Server and PiggieTV management',
                href: '#/settings/admin',
                icon: 'server',
                id: 'admin',
                label: 'PTV Administration',
                permission: 'admin'
            },
            {
                description: 'Libraries and metadata',
                href: '#/settings/admin/media',
                icon: 'metadata',
                id: 'media',
                label: 'Media Management',
                permission: 'admin'
            }
        ]
    },
    {
        id: 'actions',
        label: 'Account actions',
        items: [
            {
                description: 'Connected to PiggieTV',
                href: '#/settings/connection',
                icon: 'link',
                id: 'connection',
                label: 'Connection'
            }
        ]
    }
] as const;

const PATH_TO_SECTION = new Map<string, PtvSettingsSectionId>([
    ['/settings', 'hub'],
    ['/settings/admin', 'admin'],
    ['/settings/admin/activity', 'admin-activity'],
    ['/settings/admin/devices', 'admin-devices'],
    ['/settings/admin/libraries/display', 'admin-library-display'],
    ['/settings/admin/libraries/metadata', 'admin-library-metadata'],
    ['/settings/admin/libraries/nfo', 'admin-library-nfo'],
    ['/settings/admin/libraries', 'admin-libraries'],
    ['/settings/admin/livetv/dvr', 'admin-dvr'],
    ['/settings/admin/livetv/recordings', 'admin-dvr'],
    ['/settings/admin/livetv', 'admin-live-tv'],
    ['/settings/admin/media/metadata-quality', 'admin-metadata-quality'],
    ['/settings/admin/media/metadata-manager', 'admin-metadata-manager'],
    ['/settings/admin/playback', 'admin-playback'],
    ['/settings/admin/piggietv/diagnostics', 'admin-piggietv'],
    ['/settings/admin/piggietv/rows', 'admin-piggietv'],
    ['/settings/admin/piggietv', 'admin-piggietv'],
    ['/settings/admin/plugins', 'admin-plugins'],
    ['/settings/admin/server', 'admin-server'],
    ['/settings/admin/tasks', 'admin-tasks'],
    ['/settings/admin/users/signup-invites', 'admin-signup-invites'],
    ['/settings/admin/users', 'admin-users'],
    ['/settings/admin/media', 'media'],
    ['/settings/appearance', 'appearance'],
    ['/settings/connection', 'connection'],
    ['/settings/controls', 'controls'],
    ['/settings/devices', 'devices'],
    ['/settings/home', 'home'],
    ['/settings/playback', 'playback'],
    ['/settings/profile', 'profile'],
    ['/settings/subtitles', 'subtitles']
]);

export const PTV_LEGACY_SETTINGS_REDIRECTS = new Map<string, string>([
    ['/mypreferencescontrols', '/settings/controls'],
    ['/mypreferencesdisplay', '/settings/appearance'],
    ['/mypreferenceshome', '/settings/home'],
    ['/mypreferencesmenu', '/settings'],
    ['/mypreferencesplayback', '/settings/playback'],
    ['/mypreferencessubtitles', '/settings/subtitles'],
    ['/profile', '/settings/profile'],
    ['/quickconnect', '/settings/devices'],
    ['/userprofile', '/settings/profile']
]);

function removeTrailingSlashes(pathname: string) {
    let normalized = pathname;
    while (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
    return normalized;
}

export function getPtvSettingsSection(pathname: string): PtvSettingsSectionId {
    const normalized = removeTrailingSlashes(pathname) || '/settings';
    const routePath = normalized.toLowerCase();
    const exactSection = PATH_TO_SECTION.get(routePath);

    if (exactSection) return exactSection;

    if (routePath.startsWith('/settings/admin/libraries/')) return 'admin-libraries';
    if (routePath.startsWith('/settings/admin/livetv/')) return 'admin-live-tv';
    if (routePath.startsWith('/settings/admin/media/metadata-quality/')) return 'admin-metadata-quality';
    if (routePath.startsWith('/settings/admin/media/metadata-manager/')) return 'admin-metadata-manager';
    if (routePath.startsWith('/settings/admin/playback/')) return 'admin-playback';
    if (routePath.startsWith('/settings/admin/piggietv/')) return 'admin-piggietv';
    if (routePath.startsWith('/settings/admin/plugins/')) return 'admin-plugins';
    if (routePath.startsWith('/settings/admin/server/')) return 'admin-server';
    if (routePath.startsWith('/settings/admin/tasks/')) return 'admin-tasks';
    if (routePath.startsWith('/settings/admin/users/')) return 'admin-users';
    // Keep the complete Administration namespace behind the administrator
    // boundary, including malformed or not-yet-registered descendants.
    if (routePath.startsWith('/settings/admin/')) return 'admin';

    return 'hub';
}

export function getVisiblePtvSettingsGroups(isAdministrator: boolean) {
    return PTV_SETTINGS_GROUPS
        .map(group => ({
            ...group,
            items: group.items.filter(item => item.permission !== 'admin' || isAdministrator)
        }))
        .filter(group => group.items.length > 0);
}

export function getPtvLegacySettingsRedirect(pathname: string) {
    const normalized = removeTrailingSlashes(pathname);

    return PTV_LEGACY_SETTINGS_REDIRECTS.get(normalized) || '/settings';
}
