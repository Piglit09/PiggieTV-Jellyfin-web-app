import { describe, expect, it } from 'vitest';

import { PTV_NAVIGATION_SECTIONS } from './navigation';

describe('PTV logout navigation contract', () => {
    it('models Sign Out as an action without registering a cosmetic route', () => {
        const item = PTV_NAVIGATION_SECTIONS
            .flatMap(section => section.items)
            .find(entry => entry.id === 'signout');

        expect(item).toMatchObject({
            action: 'logout',
            id: 'signout'
        });
        expect(item).not.toHaveProperty('href');
    });

    it('derives global administration launchers from the administration registry', () => {
        const adminItems = PTV_NAVIGATION_SECTIONS.find(section => section.id === 'admin')?.items;

        expect(adminItems).toEqual(expect.arrayContaining([
            expect.objectContaining({ href: '#/settings/admin', label: 'Overview' }),
            expect.objectContaining({ href: '#/settings/admin/piggietv/rows', label: 'Home Rows' }),
            expect.objectContaining({ href: '#/settings/admin/piggietv/diagnostics', label: 'Diagnostics' }),
            expect.objectContaining({ href: '#/settings/admin/media/metadata-manager', label: 'Metadata Manager' })
        ]));
        expect(adminItems?.some(item => item.href === '#/dashboard/piggietv/recommendations')).toBe(false);
    });
});
