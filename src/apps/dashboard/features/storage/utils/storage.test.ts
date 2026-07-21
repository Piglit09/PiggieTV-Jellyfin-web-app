import { describe, expect, it } from 'vitest';

import { groupDashboardStorageFolders } from './storage';

describe('groupDashboardStorageFolders()', () => {
    it('groups paths sharing the same filesystem usage values', () => {
        const groups = groupDashboardStorageFolders([
            { folder: { FreeSpace: 1, Path: '/cache', UsedSpace: 9 }, label: 'Cache' },
            { folder: { FreeSpace: 1, Path: '/logs', UsedSpace: 9 }, label: 'Logs' },
            { folder: { FreeSpace: 4, Path: '/other', UsedSpace: 6 }, label: 'Other' }
        ]);

        expect(groups).toHaveLength(2);
        expect(groups[0].entries.map(entry => entry.label)).toEqual(['Cache', 'Logs']);
        expect(groups[1].entries.map(entry => entry.label)).toEqual(['Other']);
    });

    it('does not merge entries when disk statistics are unavailable', () => {
        const groups = groupDashboardStorageFolders([
            { folder: { Path: '/cache' }, label: 'Cache' },
            { folder: { Path: '/logs' }, label: 'Logs' }
        ]);

        expect(groups).toHaveLength(2);
    });
});
