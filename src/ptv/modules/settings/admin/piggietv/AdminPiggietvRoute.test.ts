import { describe, expect, it } from 'vitest';

import { readAdminPiggietvSection } from './AdminPiggietvRoute';

describe('native PiggieTV administration route boundary', () => {
    it.each([
        [ '/settings/admin/piggietv', 'configuration' ],
        [ '/settings/admin/piggietv/', 'configuration' ],
        [ '/settings/admin/piggietv/rows', 'rows' ],
        [ '/settings/admin/piggietv/rows/', 'rows' ],
        [ '/settings/admin/piggietv/diagnostics', 'diagnostics' ],
        [ '/SETTINGS/ADMIN/PIGGIETV/DIAGNOSTICS', 'diagnostics' ]
    ])('maps %s to %s', (pathname, section) => {
        expect(readAdminPiggietvSection(pathname)).toBe(section);
    });

    it.each([
        '/settings/admin/piggietv/not-real',
        '/settings/admin/piggietv/rows/extra',
        '/dashboard/piggietv'
    ])('rejects non-canonical path %s', pathname => {
        expect(readAdminPiggietvSection(pathname)).toBeNull();
    });
});
