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
});
