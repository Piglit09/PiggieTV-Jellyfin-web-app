import { describe, expect, it } from 'vitest';

import { ADMIN_TASKS_PATH, readAdminTaskId } from './AdminTasksRoute';

describe('native Tasks & Maintenance route', () => {
    it('recognizes the list route and immutable task detail identifiers', () => {
        expect(ADMIN_TASKS_PATH).toBe('/settings/admin/tasks');
        expect(readAdminTaskId('/settings/admin/tasks')).toBe('');
        expect(readAdminTaskId('/settings/admin/tasks/')).toBe('');
        expect(readAdminTaskId('/settings/admin/tasks/task%3Aplugin%3Abackup')).toBe('task:plugin:backup');
    });

    it('rejects unrelated, nested, empty, and malformed detail routes', () => {
        expect(readAdminTaskId('/settings/admin')).toBeNull();
        expect(readAdminTaskId('/settings/admin/tasks/task/extra')).toBeNull();
        expect(readAdminTaskId('/settings/admin/tasks/task%2Fextra')).toBeNull();
        expect(readAdminTaskId('/settings/admin/tasks/task%5Cextra')).toBeNull();
        expect(readAdminTaskId('/settings/admin/tasks/task%00extra')).toBeNull();
        expect(readAdminTaskId('/settings/admin/tasks/%')).toBeNull();
    });
});
