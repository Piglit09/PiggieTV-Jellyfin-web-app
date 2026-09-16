import { describe, expect, it } from 'vitest';

import { readAdminUserId } from './AdminUsersRoute';

describe('native Users route identity', () => {
    it('reads one encoded immutable user identifier', () => {
        expect(readAdminUserId('/settings/admin/users/member%3Aone')).toBe('member:one');
    });

    it.each([
        '/settings/admin/users/member/extra',
        '/settings/admin/users/member%2Fextra',
        '/settings/admin/users/member%5Cextra',
        '/settings/admin/users/member%00extra',
        '/settings/admin/users/%'
    ])('rejects malformed or non-single-segment user route %s', pathname => {
        expect(readAdminUserId(pathname)).toBe('');
    });
});
