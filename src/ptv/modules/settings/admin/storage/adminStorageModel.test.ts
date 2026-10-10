import { describe, expect, it } from 'vitest';

import { projectAdminStorage } from './adminStorageModel';

describe('admin storage projection', () => {
    it('shows one capacity reading for paths reported on the same mount', () => {
        const rows = projectAdminStorage({
            CacheFolder: { DeviceId: 'F:', FreeSpace: 600, Path: 'F:/cache', UsedSpace: 400 },
            Libraries: [
                { Folders: [ { DeviceId: 'F:', FreeSpace: 600, Path: 'F:/movies', UsedSpace: 400 } ], Id: 'movies', Name: 'Movies' },
                { Folders: [ { DeviceId: 'F:', FreeSpace: 600, Path: 'F:/shows', UsedSpace: 400 } ], Id: 'shows', Name: 'Shows' }
            ]
        });

        expect(rows).toEqual([ {
            freeBytes: 600,
            name: 'F:',
            paths: [ 'Cache: F:/cache', 'Movies: F:/movies', 'Shows: F:/shows' ],
            totalBytes: 1000,
            usedBytes: 400,
            usedPercent: 40
        } ]);
    });

    it('keeps different mount identifiers separate even with equal usage numbers', () => {
        const rows = projectAdminStorage({
            Libraries: [ {
                Folders: [
                    { DeviceId: 'F:', FreeSpace: 600, Path: 'F:/movies', UsedSpace: 400 },
                    { DeviceId: 'G:', FreeSpace: 600, Path: 'G:/movies', UsedSpace: 400 }
                ],
                Id: 'movies',
                Name: 'Movies'
            } ]
        });

        expect(rows.map(row => row.name)).toEqual([ 'F:', 'G:' ]);
        expect(rows.map(row => row.totalBytes)).toEqual([ 1000, 1000 ]);
    });

    it('does not merge conflicting capacity readings merely because the device label matches', () => {
        const rows = projectAdminStorage({
            Libraries: [ {
                Folders: [
                    { DeviceId: 'F:', FreeSpace: 600, Path: 'F:/movies', UsedSpace: 400 },
                    { DeviceId: 'F:', FreeSpace: 350, Path: 'F:/shows', UsedSpace: 150 }
                ],
                Id: 'media',
                Name: 'Media'
            } ]
        });

        expect(rows).toHaveLength(2);
        expect(rows.map(row => row.totalBytes)).toEqual([ 1000, 500 ]);
        expect(rows.map(row => row.paths)).toEqual([ [ 'Media: F:/movies' ], [ 'Media: F:/shows' ] ]);
    });

    it.each([
        [ undefined, 400 ],
        [ 600, undefined ],
        [ -1, 400 ],
        [ 600, -1 ],
        [ Number.NaN, 400 ],
        [ Number.POSITIVE_INFINITY, 400 ],
        [ 0, 0 ]
    ])('does not invent a percentage for invalid or zero-total usage (%s, %s)', (free, used) => {
        const [ row ] = projectAdminStorage({
            CacheFolder: { DeviceId: 'F:', FreeSpace: free, Path: 'F:/cache', UsedSpace: used }
        });

        expect(row?.usedPercent).toBeNull();
        expect(row?.totalBytes).toBeNull();
    });

    it('preserves known zero usage without reporting unavailable or a fabricated total', () => {
        const [ row ] = projectAdminStorage({
            CacheFolder: { DeviceId: 'F:', FreeSpace: 1000, Path: 'F:/cache', UsedSpace: 0 }
        });

        expect(row).toMatchObject({
            freeBytes: 1000,
            totalBytes: 1000,
            usedBytes: 0,
            usedPercent: 0
        });
    });

    it('retains distinct unknown-mount paths without combining them into physical capacity', () => {
        const rows = projectAdminStorage({
            Libraries: [ {
                Folders: [
                    { DeviceId: null, FreeSpace: 60, Path: '/media/a', UsedSpace: 40 },
                    { DeviceId: null, FreeSpace: 60, Path: '/media/b', UsedSpace: 40 }
                ],
                Id: 'movies',
                Name: 'Movies'
            } ]
        });

        expect(rows.map(row => row.name)).toEqual([ '/media/a', '/media/b' ]);
        expect(rows).toHaveLength(2);
    });
});
