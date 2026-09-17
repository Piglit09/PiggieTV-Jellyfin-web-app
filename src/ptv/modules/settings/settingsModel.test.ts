import { describe, expect, it } from 'vitest';

import {
    getPtvLegacySettingsRedirect,
    getPtvSettingsSection,
    getVisiblePtvSettingsGroups
} from './settingsModel';

describe('PiggieTV settings navigation model', () => {
    it('maps canonical and legacy routes to first-party settings sections', () => {
        expect(getPtvSettingsSection('/settings/playback')).toBe('playback');
        expect(getPtvSettingsSection('/settings/admin/activity')).toBe('admin-activity');
        expect(getPtvSettingsSection('/settings/admin/activity/')).toBe('admin-activity');
        expect(getPtvSettingsSection('/settings/admin/devices')).toBe('admin-devices');
        expect(getPtvSettingsSection('/settings/admin/devices/')).toBe('admin-devices');
        expect(getPtvSettingsSection('/settings/admin/libraries')).toBe('admin-libraries');
        expect(getPtvSettingsSection('/settings/admin/libraries/display')).toBe('admin-library-display');
        expect(getPtvSettingsSection('/settings/admin/libraries/display/')).toBe('admin-library-display');
        expect(getPtvSettingsSection('/settings/admin/libraries/metadata')).toBe('admin-library-metadata');
        expect(getPtvSettingsSection('/settings/admin/libraries/metadata/')).toBe('admin-library-metadata');
        expect(getPtvSettingsSection('/settings/admin/libraries/nfo')).toBe('admin-library-nfo');
        expect(getPtvSettingsSection('/settings/admin/libraries/nfo/')).toBe('admin-library-nfo');
        expect(getPtvSettingsSection('/settings/admin/media/metadata-quality')).toBe('admin-metadata-quality');
        expect(getPtvSettingsSection('/settings/admin/media/metadata-quality/item-a/')).toBe('admin-metadata-quality');
        expect(getPtvSettingsSection('/settings/admin/media/metadata-manager')).toBe('admin-metadata-manager');
        expect(getPtvSettingsSection('/settings/admin/media/metadata-manager/item-a/')).toBe('admin-metadata-manager');
        expect(getPtvSettingsSection('/settings/admin/playback')).toBe('admin-playback');
        expect(getPtvSettingsSection('/settings/admin/playback/streaming')).toBe('admin-playback');
        expect(getPtvSettingsSection('/settings/admin/playback/transcoding/')).toBe('admin-playback');
        expect(getPtvSettingsSection('/settings/admin/playback/resume')).toBe('admin-playback');
        expect(getPtvSettingsSection('/settings/admin/playback/trickplay')).toBe('admin-playback');
        expect(getPtvSettingsSection('/settings/admin/piggietv')).toBe('admin-piggietv');
        expect(getPtvSettingsSection('/settings/admin/piggietv/rows')).toBe('admin-piggietv');
        expect(getPtvSettingsSection('/settings/admin/piggietv/diagnostics/')).toBe('admin-piggietv');
        expect(getPtvSettingsSection('/settings/admin/livetv')).toBe('admin-live-tv');
        expect(getPtvSettingsSection('/settings/admin/livetv/tuners')).toBe('admin-live-tv');
        expect(getPtvSettingsSection('/settings/admin/livetv/guide/provider-a')).toBe('admin-live-tv');
        expect(getPtvSettingsSection('/settings/admin/livetv/dvr')).toBe('admin-dvr');
        expect(getPtvSettingsSection('/settings/admin/livetv/recordings')).toBe('admin-dvr');
        expect(getPtvSettingsSection('/settings/admin/plugins')).toBe('admin-plugins');
        expect(getPtvSettingsSection('/settings/admin/plugins/installed')).toBe('admin-plugins');
        expect(getPtvSettingsSection('/settings/admin/plugins/catalog/')).toBe('admin-plugins');
        expect(getPtvSettingsSection('/settings/admin/plugins/repositories')).toBe('admin-plugins');
        expect(getPtvSettingsSection('/settings/admin/plugins/plugin-a/')).toBe('admin-plugins');
        expect(getPtvSettingsSection('/settings/admin/server')).toBe('admin-server');
        expect(getPtvSettingsSection('/settings/admin/server/general')).toBe('admin-server');
        expect(getPtvSettingsSection('/settings/admin/server/logs/server.log')).toBe('admin-server');
        expect(getPtvSettingsSection('/settings/admin/tasks')).toBe('admin-tasks');
        expect(getPtvSettingsSection('/settings/admin/tasks/')).toBe('admin-tasks');
        expect(getPtvSettingsSection('/settings/admin/tasks/task-a/')).toBe('admin-tasks');
        expect(getPtvSettingsSection('/settings/admin/libraries/library-a/')).toBe('admin-libraries');
        expect(getPtvSettingsSection('/settings/admin/users')).toBe('admin-users');
        expect(getPtvSettingsSection('/settings/admin/users/signup-invites')).toBe('admin-signup-invites');
        expect(getPtvSettingsSection('/settings/admin/users/signup-invites/')).toBe('admin-signup-invites');
        expect(getPtvSettingsSection('/settings/admin/users/member-a/')).toBe('admin-users');
        expect(getPtvSettingsSection('/settings/admin/media/')).toBe('media');
        expect(getPtvSettingsSection('/settings/admin/not-a-real-destination')).toBe('admin');
        expect(getPtvSettingsSection('/SETTINGS/ADMIN/not-a-real-destination')).toBe('admin');
        expect(getPtvLegacySettingsRedirect('/mypreferencesdisplay')).toBe('/settings/appearance');
        expect(getPtvLegacySettingsRedirect('/quickconnect')).toBe('/settings/devices');
        expect(getPtvLegacySettingsRedirect('/unknown')).toBe('/settings');
    });

    it('hides every administration destination from normal users', () => {
        const memberGroups = getVisiblePtvSettingsGroups(false);
        const memberIds = memberGroups.flatMap(group => group.items.map(item => item.id));
        const adminIds = getVisiblePtvSettingsGroups(true).flatMap(group => group.items.map(item => item.id));

        expect(memberIds).not.toContain('admin');
        expect(memberIds).not.toContain('media');
        expect(adminIds).toEqual(expect.arrayContaining(['admin', 'media']));
    });
});
