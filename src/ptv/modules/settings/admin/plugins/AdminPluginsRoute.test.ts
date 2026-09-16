import { describe, expect, it } from 'vitest';

import {
    ADMIN_PLUGINS_PATH,
    readAdminPluginsRoute
} from './AdminPluginsRoute';

describe('native Plugin Administration route', () => {
    it('uses Installed for the workspace root and resolves route-backed tabs first', () => {
        expect(ADMIN_PLUGINS_PATH).toBe('/settings/admin/plugins');
        expect(readAdminPluginsRoute('/settings/admin/plugins')).toEqual({ section: 'installed' });
        expect(readAdminPluginsRoute('/settings/admin/plugins/')).toEqual({ section: 'installed' });
        expect(readAdminPluginsRoute('/settings/admin/plugins/installed')).toEqual({ section: 'installed' });
        expect(readAdminPluginsRoute('/settings/admin/plugins/CATALOG/')).toEqual({ section: 'catalog' });
        expect(readAdminPluginsRoute('/settings/admin/plugins/repositories')).toEqual({ section: 'repositories' });
    });

    it('preserves an encoded immutable plugin identifier for detail routes', () => {
        expect(readAdminPluginsRoute('/settings/admin/plugins/27c90ee7-7d56-4591-98f8-b0ebcda8c5fd'))
            .toEqual({
                pluginId: '27c90ee7-7d56-4591-98f8-b0ebcda8c5fd',
                section: 'detail'
            });
        expect(readAdminPluginsRoute('/settings/admin/plugins/plugin%3Aone'))
            .toEqual({ pluginId: 'plugin:one', section: 'detail' });
    });

    it('rejects unrelated, nested, empty, and malformed routes', () => {
        expect(readAdminPluginsRoute('/settings/admin')).toEqual({ section: 'invalid' });
        expect(readAdminPluginsRoute('/settings/admin/plugins/plugin/extra')).toEqual({ section: 'invalid' });
        expect(readAdminPluginsRoute('/settings/admin/plugins/plugin%2Fextra')).toEqual({ section: 'invalid' });
        expect(readAdminPluginsRoute('/settings/admin/plugins/plugin%5Cextra')).toEqual({ section: 'invalid' });
        expect(readAdminPluginsRoute('/settings/admin/plugins/plugin%00extra')).toEqual({ section: 'invalid' });
        expect(readAdminPluginsRoute('/settings/admin/plugins/%')).toEqual({ section: 'invalid' });
    });
});
