import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPtvAbortController } from '../../core/abortController';

const api = vi.hoisted(() => ({
    getItem: vi.fn(),
    getItems: vi.fn()
}));
const observability = vi.hoisted(() => ({ recordEvent: vi.fn() }));

vi.mock('../../api', () => ({
    getPtvItem: api.getItem,
    getPtvItems: api.getItems
}));

vi.mock('../../core/observability', () => ({ recordPtvEvent: observability.recordEvent }));

import {
    buildPtvCollectionLandingSections,
    loadPtvCollectionCritical,
    loadPtvCollectionDeferred,
    loadPtvCollectionDetails
} from './collectionLoader';
import { createDefaultPtvCollectionPreferenceDocument } from './collectionPreferences';
import type { PtvPortableCollection } from './collectionTypes';

describe('Collection loader lifecycle', () => {
    const preferences = createDefaultPtvCollectionPreferenceDocument({
        serverId: 'server',
        userId: 'user'
    }).preferences;

    beforeEach(() => vi.clearAllMocks());

    it('uses one bounded critical request and preserves a usable Jellyfin source', async () => {
        api.getItems.mockResolvedValueOnce({ Items: [{ ChildCount: 3, Id: 'set', Name: 'Saga', Type: 'BoxSet' }] });
        const controller = createPtvAbortController();
        const result = await loadPtvCollectionCritical(controller.signal);

        expect(api.getItems).toHaveBeenCalledTimes(1);
        expect(api.getItems.mock.calls[0]?.[0]).toMatchObject({ IncludeItemTypes: 'BoxSet', Limit: 200 });
        expect(api.getItems.mock.calls[0]?.[1]).toEqual({ signal: controller.signal });
        expect(result.collections).toHaveLength(1);
        const diagnostics = JSON.stringify(observability.recordEvent.mock.calls);

        expect(diagnostics).not.toContain('Saga');
        expect(diagnostics).not.toContain('"set"');
        expect(diagnostics).not.toContain('http');
    });

    it('isolates deferred discovery and never requires one request per card', async () => {
        api.getItems.mockResolvedValueOnce({ Items: [
            { Id: 'a', Name: 'A', Tags: ['Franchise:world'], Type: 'Movie' },
            { Id: 'b', Name: 'B', Tags: ['Franchise:world'], Type: 'MusicAlbum' }
        ] });
        const result = await loadPtvCollectionDeferred(createPtvAbortController().signal, []);

        expect(api.getItems).toHaveBeenCalledTimes(1);
        expect(result.crossLibrary).toHaveLength(1);
    });

    it('loads Jellyfin details in one bounded parallel batch and rejects missing identity', async () => {
        api.getItem.mockResolvedValueOnce({ Id: 'set', Name: 'Saga', Type: 'BoxSet' });
        api.getItems.mockResolvedValueOnce({ Items: [{ Id: 'a', Name: 'A', Type: 'Movie' }] });

        await expect(loadPtvCollectionDetails('', createPtvAbortController().signal)).resolves.toBeNull();
        await expect(loadPtvCollectionDetails('jellyfin:set', createPtvAbortController().signal)).resolves.toMatchObject({ memberCount: 1 });
        expect(api.getItem).toHaveBeenCalledTimes(1);
        expect(api.getItems).toHaveBeenCalledTimes(1);
    });

    it('re-verifies an authoritative BoxSet when its direct detail shape cannot normalize', async () => {
        api.getItem.mockResolvedValueOnce({ Id: 'set', Name: 'Saga', Type: 'Folder' });
        api.getItems
            .mockResolvedValueOnce({ Items: [{ Id: 'a', Name: 'A', Type: 'Movie' }] })
            .mockResolvedValueOnce({ Items: [{ Id: 'set', Name: 'Saga', Type: 'BoxSet' }] });

        await expect(loadPtvCollectionDetails('jellyfin:set', createPtvAbortController().signal))
            .resolves.toMatchObject({ memberCount: 1, sourceType: 'jellyfin' });
        expect(api.getItem).toHaveBeenCalledTimes(1);
        expect(api.getItems).toHaveBeenCalledTimes(2);
    });

    it('builds truthful visible sections after partial deferred failure', () => {
        const critical: PtvPortableCollection[] = [{
            artworkCandidates: [], backdropCandidates: [], capabilities: {
                canFavorite: true,
                canHide: true,
                canOpenMembers: false,
                canPin: true,
                canPlayNext: false,
                canReorder: false
            }, key: 'jellyfin:set',
            memberCount: 3, members: [], overview: '', progress: { completedCount: 0, inProgressCount: 0, nextMember: null, percent: 0, status: 'not-started', totalCount: 3 },
            raw: { Genres: ['Adventure'] }, relationshipReason: 'jellyfin-collection', section: 'jellyfin', sourceType: 'jellyfin', subtitle: '', tagline: '', title: 'Saga'
        }];
        const sections = buildPtvCollectionLandingSections({ critical, deferred: null, preferences });

        expect(sections.some(section => section.id === 'jellyfin')).toBe(true);
        expect(sections.every(section => section.collections.length > 0)).toBe(true);
    });
});
