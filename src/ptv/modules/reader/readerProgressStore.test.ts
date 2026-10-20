import { beforeEach, describe, expect, it, vi } from 'vitest';

const identity = vi.hoisted(() => ({ serverId: 'server-a', userId: 'user-a' }));

vi.mock('../../api/client', () => ({
    getPtvApiClient: (serverId?: string) => serverId && serverId !== identity.serverId ? null : {
        getCurrentUserId: () => identity.userId,
        serverId: () => identity.serverId,
        serverInfo: () => ({ Id: identity.serverId })
    }
}));

import {
    addReaderBookmark,
    loadReaderBookmarks,
    loadReaderProgress,
    saveReaderProgress
} from './readerProgressStore';

const progress = {
    stableId: 'shared-book',
    format: 'pdf' as const,
    position: 'page:4',
    pageIndex: 4,
    pageCount: 10,
    percent: 50,
    updatedAt: 1
};

describe('Reader progress and bookmark ownership', () => {
    beforeEach(() => {
        window.localStorage.clear();
        identity.serverId = 'server-a';
        identity.userId = 'user-a';
    });

    it('isolates the same item across users and servers', () => {
        saveReaderProgress(progress, 'server-a');
        expect(loadReaderProgress('shared-book', 'server-a')?.percent).toBe(50);

        identity.userId = 'user-b';
        expect(loadReaderProgress('shared-book', 'server-a')).toBeNull();
        saveReaderProgress({ ...progress, percent: 20 }, 'server-a');

        identity.userId = 'user-a';
        expect(loadReaderProgress('shared-book', 'server-a')?.percent).toBe(50);
        identity.serverId = 'server-b';
        expect(loadReaderProgress('shared-book', 'server-b')).toBeNull();
    });

    it('keeps bookmarks private to the authenticated identity', () => {
        addReaderBookmark({
            stableId: 'shared-book',
            label: 'Halfway',
            position: 'page:4',
            pageIndex: 4,
            percent: 50
        }, 'server-a');
        expect(loadReaderBookmarks('shared-book', 'server-a')).toHaveLength(1);

        identity.userId = 'user-b';
        expect(loadReaderBookmarks('shared-book', 'server-a')).toEqual([]);
    });

    it('ignores unscoped historical records and refuses persistence without proven identity', () => {
        window.localStorage.setItem('ptv.reader.progress.shared-book', JSON.stringify(progress));
        window.localStorage.setItem('ptv.reader.bookmarks.shared-book', JSON.stringify([{ label: 'legacy' }]));
        expect(loadReaderProgress('shared-book', 'server-a')).toBeNull();
        expect(loadReaderBookmarks('shared-book', 'server-a')).toEqual([]);

        identity.userId = '';
        const before = window.localStorage.length;
        saveReaderProgress(progress, 'server-a');
        addReaderBookmark({
            stableId: 'shared-book',
            label: 'Private',
            position: 'page:4',
            pageIndex: 4,
            percent: 50
        }, 'server-a');
        expect(window.localStorage.length).toBe(before);
        expect(loadReaderProgress('shared-book', 'server-a')).toBeNull();
        expect(loadReaderBookmarks('shared-book', 'server-a')).toEqual([]);
    });

    it('does not fall back to the active server for a different requested server', () => {
        saveReaderProgress(progress, 'server-b');
        expect(loadReaderProgress('shared-book', 'server-b')).toBeNull();
        expect(window.localStorage.length).toBe(0);
    });
});
