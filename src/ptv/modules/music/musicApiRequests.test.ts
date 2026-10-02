import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../core/observability', () => ({
    recordPtvEvent: vi.fn(),
    shouldCollectDiagnostics: vi.fn(() => false),
    timePtvAsync: vi.fn((_type, _name, task: () => Promise<unknown>) => task())
}));

vi.mock('../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: vi.fn()
}));

vi.mock('../../api/images', () => ({
    hasPtvImageCandidateFailed: vi.fn(() => false),
    markPtvImageCandidateFailed: vi.fn()
}));

vi.mock('../../api', async () => {
    const { serializePtvItemFieldProfile } = await import('../../api/itemFieldProfiles');

    return {
        cleanPtvQuery: vi.fn(query => query),
        getPtvCurrentUserId: vi.fn(),
        getPtvFavoriteItems: vi.fn(),
        getPtvItem: vi.fn(),
        getPtvItemImageCandidates: vi.fn(() => []),
        getPtvItemImageUrl: vi.fn(() => ''),
        getPtvApiUrl: vi.fn(() => ''),
        getPtvItems: vi.fn(),
        getPtvRecentlyAdded: vi.fn(),
        getPtvResumeItems: vi.fn(),
        getPtvServerId: vi.fn(),
        getPtvUserViews: vi.fn(),
        requestPtvJson: vi.fn(),
        sendPtvJson: vi.fn(),
        serializePtvItemFieldProfile,
        setPtvFavorite: vi.fn()
    };
});

import {
    getPtvCurrentUserId,
    getPtvFavoriteItems,
    getPtvItems,
    getPtvRecentlyAdded,
    getPtvResumeItems,
    getPtvServerId,
    getPtvUserViews,
    requestPtvJson,
    type PtvItemsResult,
    type PtvLibrary
} from '../../api';
import { recordPtvEvent } from '../../core/observability';
import { serializePtvItemFieldProfile } from '../../api/itemFieldProfiles';
import {
    fetchPtvMusicAlbumTracks,
    fetchPtvMusicLyrics,
    fetchPtvMusicPlaylists,
    fetchPtvMusicTracks,
    fetchPtvMusicVideos,
    getPtvMusicHome,
    invalidatePtvMusicHomeCache,
    PTV_MUSIC_API_REQUEST_CONCURRENCY,
    PTV_MUSIC_PLAYLIST_PROBE_CONCURRENCY
} from './musicApi';
import type { PtvMusicHomeData, PtvMusicItem } from './musicTypes';

function getPlaylistCandidates(count: number): PtvMusicItem[] {
    return Array.from({ length: count }, (_, index) => ({
        Id: `playlist-${index}`,
        Name: `Playlist ${index}`,
        Type: 'Playlist'
    }));
}

function createAbortError() {
    return Object.assign(new Error('Playlist probe aborted.'), {
        name: 'AbortError'
    });
}

function createPtvMusicRequestTracker() {
    let activeRequestCount = 0;
    let peakRequestCount = 0;
    const releaseRequests: Array<() => void> = [];

    return {
        getPeakRequestCount: () => peakRequestCount,
        release: (count = releaseRequests.length) => {
            releaseRequests.splice(0, count).forEach(release => {
                release();
            });
        },
        request: () => new Promise<PtvItemsResult<PtvMusicItem>>(resolve => {
            activeRequestCount += 1;
            peakRequestCount = Math.max(peakRequestCount, activeRequestCount);
            releaseRequests.push(() => {
                activeRequestCount -= 1;
                resolve({ Items: [], TotalRecordCount: 0 });
            });
        })
    };
}

const fullMusicHomeStorageKey = 'ptv:music-home-snapshot:server-1:user-1:full:v2';

function confirmedEmptyHomeEntry(expiresAt: number): { data: PtvMusicHomeData; expiresAt: number; schemaVersion: number } {
    return {
        data: {
            completeness: 'complete' as const,
            generatedAt: 1,
            isPartial: false,
            library: { id: 'music-library-1', name: 'Music' },
            nextEligibleRefreshAt: 1,
            refreshReason: 'full-home-snapshot',
            sectionTimings: [{ durationMs: 1, id: 'tracks', itemCount: 0, status: 'ok' as const }],
            sections: [],
            stats: { albumCount: 0, artistCount: 0, trackCount: 0 }
        },
        expiresAt,
        schemaVersion: 2
    };
}

function populatedHomeMocks() {
    vi.mocked(getPtvUserViews).mockResolvedValue({
        Items: [{ CollectionType: 'music', Id: 'music-library-1', Name: 'Music', Type: 'CollectionFolder' }],
        TotalRecordCount: 1
    });
    vi.mocked(getPtvItems).mockImplementation(async query => {
        const type = String(query?.IncludeItemTypes || 'Audio');
        let itemType = 'Audio';

        if (type === 'MusicAlbum') itemType = 'MusicAlbum';
        if (type === 'MusicArtist') itemType = 'MusicArtist';

        return {
            Items: [{
                Id: `${type}-1`,
                Name: `${type} 1`,
                Type: itemType
            }],
            TotalRecordCount: 1
        };
    });
    vi.mocked(getPtvRecentlyAdded).mockResolvedValue([{ Id: 'recent-1', Name: 'Recent', Type: 'Audio' }]);
    vi.mocked(getPtvResumeItems).mockResolvedValue({ Items: [], TotalRecordCount: 0 });
    vi.mocked(getPtvFavoriteItems).mockResolvedValue({ Items: [], TotalRecordCount: 0 });
}

describe('PiggieTV Music list requests', () => {
    beforeEach(() => {
        vi.mocked(getPtvCurrentUserId).mockReturnValue('user-1');
        vi.mocked(getPtvServerId).mockReturnValue('server-1');
        vi.mocked(getPtvFavoriteItems).mockReset();
        vi.mocked(getPtvItems).mockReset();
        vi.mocked(getPtvRecentlyAdded).mockReset();
        vi.mocked(getPtvResumeItems).mockReset();
        vi.mocked(getPtvUserViews).mockReset();
        vi.mocked(requestPtvJson).mockReset();
        vi.mocked(recordPtvEvent).mockReset();
        invalidatePtvMusicHomeCache();
        localStorage.removeItem('ptv.music.liked.v2:server-1:user-1');
    });

    it('uses the lean card profile and bounds playlist content probes', async () => {
        const candidates = getPlaylistCandidates(12);
        const expectedFields = serializePtvItemFieldProfile('MUSIC_CARD_FIELDS');
        let activeProbeCount = 0;
        let peakProbeCount = 0;

        vi.mocked(getPtvItems).mockResolvedValue({
            Items: candidates,
            TotalRecordCount: candidates.length
        });
        vi.mocked(requestPtvJson).mockImplementation(async () => {
            activeProbeCount += 1;
            peakProbeCount = Math.max(peakProbeCount, activeProbeCount);
            await Promise.resolve();
            activeProbeCount -= 1;

            return {
                Items: [{ Id: 'track-1', Type: 'Audio' }]
            };
        });

        const playlists = await fetchPtvMusicPlaylists(6);
        const listQuery = vi.mocked(getPtvItems).mock.calls[0]?.[0];
        const playlistProbeOptions = vi.mocked(requestPtvJson).mock.calls[0]?.[1];

        expect(playlists).toHaveLength(6);
        expect(listQuery?.Fields).toBe(expectedFields);
        expect(playlistProbeOptions?.params?.Fields).toBe(expectedFields);
        const requestedFields = expectedFields.split(',');

        expect(requestedFields).toEqual(expect.arrayContaining([
            'AlbumArtists',
            'ArtistItems',
            'BackdropImageTags',
            'CanDownload',
            'Container',
            'Genres',
            'ImageTags',
            'RunTimeTicks'
        ]));
        expect(requestedFields).not.toEqual(expect.arrayContaining([
            'MediaSources',
            'MediaStreams',
            'Overview',
            'Path',
            'ProviderIds',
            'Tags'
        ]));
        expect(requestedFields.length).toBeLessThan(29);
        expect(peakProbeCount).toBe(PTV_MUSIC_PLAYLIST_PROBE_CONCURRENCY);
        expect(requestPtvJson).toHaveBeenCalledTimes(candidates.length);
    });

    it('aborts active probes without starting the remaining candidates', async () => {
        const candidates = getPlaylistCandidates(12);
        // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill for legacy web runtimes.
        const controller = new AbortController();
        let startedProbeCount = 0;

        vi.mocked(getPtvItems).mockResolvedValue({
            Items: candidates,
            TotalRecordCount: candidates.length
        });
        vi.mocked(requestPtvJson).mockImplementation((_path, options) => new Promise((_resolve, reject) => {
            startedProbeCount += 1;
            // eslint-disable-next-line sonarjs/no-nested-functions -- The pending probe must observe the test-owned abort signal.
            options?.signal?.addEventListener('abort', () => reject(createAbortError()), { once: true });
        }));

        const request = fetchPtvMusicPlaylists(6, controller.signal);

        await vi.waitFor(() => {
            expect(startedProbeCount).toBe(PTV_MUSIC_PLAYLIST_PROBE_CONCURRENCY);
        });
        controller.abort();

        await expect(request).rejects.toMatchObject({ name: 'AbortError' });
        expect(startedProbeCount).toBe(PTV_MUSIC_PLAYLIST_PROBE_CONCURRENCY);
    });

    it('owns a lyrics request with the selected panel signal and propagates cancellation', async () => {
        // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill for legacy web runtimes.
        const controller = new AbortController();
        const abortError = Object.assign(new Error('Lyrics request aborted.'), {
            name: 'AbortError'
        });

        vi.mocked(requestPtvJson).mockImplementation((_path, options) => new Promise((_resolve, reject) => {
            // eslint-disable-next-line sonarjs/no-nested-functions -- The pending request must observe the test-owned abort signal.
            options?.signal?.addEventListener('abort', () => reject(abortError), { once: true });
        }));

        const request = fetchPtvMusicLyrics({
            HasLyrics: true,
            Id: 'track-with-lyrics',
            Type: 'Audio'
        }, controller.signal);

        expect(requestPtvJson).toHaveBeenCalledWith('Audio/track-with-lyrics/Lyrics', {
            signal: controller.signal
        });

        controller.abort();

        await expect(request).rejects.toMatchObject({ name: 'AbortError' });
        expect(requestPtvJson).toHaveBeenCalledTimes(1);
    });

    it('normalizes plain-text and nested lowercase lyric payloads', async () => {
        vi.mocked(requestPtvJson)
            .mockResolvedValueOnce({ Lyrics: 'First line\nSecond line' })
            .mockResolvedValueOnce({ lyrics: ['Third line', 'Fourth line'] });
        const item = {
            HasLyrics: true,
            Id: 'track-with-lyrics',
            Type: 'Audio'
        } as PtvMusicItem;

        await expect(fetchPtvMusicLyrics(item)).resolves.toEqual({
            Lyrics: 'First line\nSecond line'
        });
        await expect(fetchPtvMusicLyrics(item)).resolves.toEqual({
            Lyrics: ['Third line', 'Fourth line']
        });
    });

    it('classifies lyric 404 as unavailable and exposes other failures to one UI-owned retry', async () => {
        const notFound = Object.assign(new Error('Not found'), { status: 404 });
        const timeout = Object.assign(new Error('Timed out'), { name: 'TimeoutError' });
        const item = {
            HasLyrics: true,
            Id: 'track-with-lyrics',
            Type: 'Audio'
        } as PtvMusicItem;

        vi.mocked(requestPtvJson)
            .mockRejectedValueOnce(notFound)
            .mockRejectedValueOnce(timeout);

        await expect(fetchPtvMusicLyrics(item)).resolves.toEqual({ Lyrics: null });
        await expect(fetchPtvMusicLyrics(item)).rejects.toBe(timeout);
        expect(requestPtvJson).toHaveBeenCalledTimes(2);
    });

    it('deduplicates identical in-flight track shelves', async () => {
        let resolveItems!: (value: { Items: PtvMusicItem[]; TotalRecordCount: number }) => void;

        vi.mocked(getPtvUserViews).mockResolvedValue({ Items: [], TotalRecordCount: 0 });
        vi.mocked(getPtvItems).mockImplementation(() => new Promise(resolve => {
            resolveItems = resolve;
        }));

        const first = fetchPtvMusicTracks({ SortBy: 'SortName' }, 12);
        const second = fetchPtvMusicTracks({ SortBy: 'SortName' }, 12);

        await vi.waitFor(() => {
            expect(getPtvItems).toHaveBeenCalledTimes(1);
        });
        resolveItems({
            Items: [{ Id: 'deduped-track', Name: 'Deduped Track', Type: 'Audio' }],
            TotalRecordCount: 1
        });

        await expect(Promise.all([ first, second ])).resolves.toEqual([
            [ expect.objectContaining({ Id: 'deduped-track' }) ],
            [ expect.objectContaining({ Id: 'deduped-track' }) ]
        ]);
    });

    it('loads one album through Jellyfin album relationship identity without treating the album as a parent folder', async () => {
        vi.mocked(getPtvUserViews).mockResolvedValue({
            Items: [{
                CollectionType: 'music',
                Id: 'music-library-1',
                Name: 'Music',
                Type: 'CollectionFolder'
            }],
            TotalRecordCount: 1
        });
        vi.mocked(getPtvItems).mockResolvedValue({
            Items: [{
                AlbumId: 'album-1',
                Id: 'track-1',
                Name: 'Track 1',
                Type: 'Audio'
            }],
            TotalRecordCount: 1
        });

        await expect(fetchPtvMusicAlbumTracks('album-1', 100)).resolves.toEqual([
            expect.objectContaining({ Id: 'track-1' })
        ]);

        const query = vi.mocked(getPtvItems).mock.calls[0]?.[0];

        expect(query).toEqual(expect.objectContaining({
            AlbumIds: 'album-1',
            IncludeItemTypes: 'Audio',
            ParentId: 'music-library-1',
            Recursive: true
        }));
        expect(query?.ParentId).not.toBe('album-1');
        expect(getPtvItems).toHaveBeenCalledTimes(1);
    });

    it('negative-caches library discovery and records one truthful discovery start', async () => {
        vi.mocked(getPtvUserViews).mockResolvedValue({ Items: [], TotalRecordCount: 0 });
        vi.mocked(getPtvItems).mockResolvedValue({
            Items: [{ Id: 'track-1', Name: 'Track', Type: 'Audio' }],
            TotalRecordCount: 1
        });

        await fetchPtvMusicTracks({ SearchTerm: 'first' }, 12);
        await fetchPtvMusicTracks({ SearchTerm: 'second' }, 12);

        const discoveryStarts = vi.mocked(recordPtvEvent).mock.calls.filter(([, name]) => (
            name === 'music-library-discovery-started'
        ));

        expect(getPtvUserViews).toHaveBeenCalledTimes(1);
        expect(discoveryStarts).toHaveLength(1);
        expect(recordPtvEvent).toHaveBeenCalledWith('cache', 'music-library-scope-cache-hit', expect.objectContaining({
            libraryId: null,
            selectedParentId: null
        }));
    });

    it('caps concurrent Music list transports at the shared request budget', async () => {
        vi.mocked(getPtvUserViews).mockResolvedValue({ Items: [], TotalRecordCount: 0 });
        vi.mocked(getPtvItems).mockResolvedValue({ Items: [], TotalRecordCount: 0 });
        await fetchPtvMusicTracks({ SearchTerm: 'warm-discovery' }, 1);

        const requestTracker = createPtvMusicRequestTracker();

        vi.mocked(getPtvItems).mockReset();
        vi.mocked(getPtvItems).mockImplementation(requestTracker.request);

        const requests = Array.from({ length: 6 }, (_, index) => (
            fetchPtvMusicTracks({ SearchTerm: `budget-${index}` }, 1)
        ));

        await vi.waitFor(() => {
            expect(getPtvItems).toHaveBeenCalledTimes(PTV_MUSIC_API_REQUEST_CONCURRENCY);
        });
        expect(requestTracker.getPeakRequestCount()).toBe(PTV_MUSIC_API_REQUEST_CONCURRENCY);

        requestTracker.release(PTV_MUSIC_API_REQUEST_CONCURRENCY);
        await vi.waitFor(() => {
            expect(getPtvItems).toHaveBeenCalledTimes(requests.length);
        });
        requestTracker.release();

        await expect(Promise.all(requests)).resolves.toHaveLength(requests.length);
        expect(requestTracker.getPeakRequestCount()).toBe(PTV_MUSIC_API_REQUEST_CONCURRENCY);
    });

    it('cancels queued Music list work before it starts a transport', async () => {
        vi.mocked(getPtvUserViews).mockResolvedValue({ Items: [], TotalRecordCount: 0 });
        vi.mocked(getPtvItems).mockResolvedValue({ Items: [], TotalRecordCount: 0 });
        await fetchPtvMusicTracks({ SearchTerm: 'warm-cancellation' }, 1);

        const requestTracker = createPtvMusicRequestTracker();
        // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill for legacy web runtimes.
        const controller = new AbortController();

        vi.mocked(getPtvItems).mockReset();
        vi.mocked(getPtvItems).mockImplementation(requestTracker.request);
        const activeRequests = Array.from({ length: PTV_MUSIC_API_REQUEST_CONCURRENCY }, (_, index) => (
            fetchPtvMusicTracks({ SearchTerm: `active-${index}` }, 1)
        ));
        const queuedRequest = fetchPtvMusicTracks({ SearchTerm: 'queued-abort' }, 1, controller.signal);

        await vi.waitFor(() => {
            expect(getPtvItems).toHaveBeenCalledTimes(PTV_MUSIC_API_REQUEST_CONCURRENCY);
        });
        controller.abort();
        await expect(queuedRequest).rejects.toMatchObject({ name: 'AbortError' });

        requestTracker.release();
        await expect(Promise.all(activeRequests)).resolves.toHaveLength(PTV_MUSIC_API_REQUEST_CONCURRENCY);
        expect(getPtvItems).toHaveBeenCalledTimes(PTV_MUSIC_API_REQUEST_CONCURRENCY);
    });

    it('reuses complete initial shelves and reduces a normal Home schedule from 17 to 13 transports', async () => {
        vi.mocked(getPtvUserViews).mockResolvedValue({
            Items: [{
                CollectionType: 'music',
                Id: 'music-library-1',
                Name: 'Music',
                Type: 'CollectionFolder'
            }],
            TotalRecordCount: 1
        });
        vi.mocked(getPtvItems).mockImplementation(async query => {
            const resolvedQuery = query || {};
            const itemType = String(resolvedQuery.IncludeItemTypes || 'Audio');
            let type = 'Audio';

            if (itemType === 'MusicAlbum') type = 'MusicAlbum';
            if (itemType === 'MusicArtist') type = 'MusicArtist';
            const id = `${type}-${String(resolvedQuery.SortBy || 'sample')}`;

            return {
                Items: [{ Id: id, Name: id, Type: type }],
                TotalRecordCount: 1
            };
        });
        vi.mocked(getPtvRecentlyAdded).mockResolvedValue([{
            Id: 'recently-added',
            Name: 'Recently Added',
            Type: 'Audio'
        }]);
        vi.mocked(getPtvResumeItems).mockResolvedValue({
            Items: [{ Id: 'resume-track', Name: 'Resume Track', Type: 'Audio' }],
            TotalRecordCount: 1
        });
        vi.mocked(getPtvFavoriteItems).mockResolvedValue({
            Items: [{ Id: 'favorite-track', Name: 'Favorite Track', Type: 'Audio' }],
            TotalRecordCount: 1
        });

        await expect(getPtvMusicHome({ forceRefresh: true, initialOnly: true })).resolves.toEqual(expect.objectContaining({
            completeness: 'initial-usable',
            isPartial: true
        }));
        expect(
            vi.mocked(getPtvUserViews).mock.calls.length
            + vi.mocked(getPtvItems).mock.calls.length
            + vi.mocked(getPtvRecentlyAdded).mock.calls.length
            + vi.mocked(getPtvResumeItems).mock.calls.length
            + vi.mocked(getPtvFavoriteItems).mock.calls.length
        ).toBe(8);

        await expect(getPtvMusicHome({ forceRefresh: true, initialOnly: false })).resolves.toEqual(expect.objectContaining({
            completeness: 'complete',
            isPartial: false
        }));
        expect(
            vi.mocked(getPtvUserViews).mock.calls.length
            + vi.mocked(getPtvItems).mock.calls.length
            + vi.mocked(getPtvRecentlyAdded).mock.calls.length
            + vi.mocked(getPtvResumeItems).mock.calls.length
            + vi.mocked(getPtvFavoriteItems).mock.calls.length
        ).toBe(12);
        expect(getPtvResumeItems).toHaveBeenCalledTimes(1);
        expect(getPtvFavoriteItems).toHaveBeenCalledTimes(1);
        expect(recordPtvEvent).toHaveBeenCalledWith('cache', 'music-home-initial-seed-reused', {
            avoidedRequestCount: 4,
            libraryId: 'music-library-1',
            requestCountAfterReuse: 4,
            requestCountWithoutReuse: 8
        });

        await fetchPtvMusicVideos(12);
        expect(
            vi.mocked(getPtvUserViews).mock.calls.length
            + vi.mocked(getPtvItems).mock.calls.length
            + vi.mocked(getPtvRecentlyAdded).mock.calls.length
            + vi.mocked(getPtvResumeItems).mock.calls.length
            + vi.mocked(getPtvFavoriteItems).mock.calls.length
        ).toBe(13);
    });

    it('bypasses a stale confirmed-empty persistent Home snapshot and replaces it with live Music data', async () => {
        localStorage.setItem(fullMusicHomeStorageKey, JSON.stringify(confirmedEmptyHomeEntry(Date.now() - 1)));
        populatedHomeMocks();

        const data = await getPtvMusicHome();
        const stored = JSON.parse(localStorage.getItem(fullMusicHomeStorageKey) || '{}');

        expect(getPtvItems).toHaveBeenCalled();
        expect(data.stats.trackCount).toBeGreaterThan(0);
        expect(stored.data.stats.trackCount).toBeGreaterThan(0);
        expect(stored.expiresAt).toBeGreaterThan(Date.now());
    });

    it('uses a fresh confirmed-empty persistent Home snapshot without a transport request', async () => {
        localStorage.setItem(fullMusicHomeStorageKey, JSON.stringify(confirmedEmptyHomeEntry(Date.now() + 60_000)));

        await expect(getPtvMusicHome()).resolves.toMatchObject({
            sections: [],
            stats: { albumCount: 0, artistCount: 0, trackCount: 0 }
        });
        expect(getPtvUserViews).not.toHaveBeenCalled();
        expect(getPtvItems).not.toHaveBeenCalled();
    });

    it('continues to use a stale non-empty persistent Home snapshot when stale reads are allowed', async () => {
        const entry = confirmedEmptyHomeEntry(Date.now() - 1);

        entry.data.sections = [{
            id: 'songs',
            items: [{ Id: 'track-1', Name: 'Track 1', Type: 'Audio' }],
            kind: 'track',
            title: 'Songs'
        }];
        entry.data.stats.trackCount = 1;
        localStorage.setItem(fullMusicHomeStorageKey, JSON.stringify(entry));

        await expect(getPtvMusicHome()).resolves.toMatchObject({ stats: { trackCount: 1 } });
        expect(getPtvUserViews).not.toHaveBeenCalled();
        expect(getPtvItems).not.toHaveBeenCalled();
    });

    it('retains a stale confirmed-empty persistent snapshot when the required live Home load fails', async () => {
        const entry = confirmedEmptyHomeEntry(Date.now() - 1);
        const serialized = JSON.stringify(entry);

        localStorage.setItem(fullMusicHomeStorageKey, serialized);
        vi.mocked(getPtvUserViews).mockRejectedValue(new Error('Jellyfin unavailable'));
        vi.mocked(getPtvItems).mockRejectedValue(new Error('Jellyfin unavailable'));
        vi.mocked(getPtvRecentlyAdded).mockRejectedValue(new Error('Jellyfin unavailable'));
        vi.mocked(getPtvResumeItems).mockRejectedValue(new Error('Jellyfin unavailable'));
        vi.mocked(getPtvFavoriteItems).mockRejectedValue(new Error('Jellyfin unavailable'));

        await expect(getPtvMusicHome()).rejects.toThrow('Music full load failed before any library items were confirmed');
        expect(getPtvUserViews).toHaveBeenCalled();
        expect(localStorage.getItem(fullMusicHomeStorageKey)).toBe(serialized);
    });

    it('replaces a persistent Home snapshot during normal force refresh', async () => {
        localStorage.setItem(fullMusicHomeStorageKey, JSON.stringify(confirmedEmptyHomeEntry(Date.now() + 60_000)));
        populatedHomeMocks();

        await expect(getPtvMusicHome({ forceRefresh: true })).resolves.toMatchObject({
            completeness: 'complete',
            isPartial: false
        });
        const stored = JSON.parse(localStorage.getItem(fullMusicHomeStorageKey) || '{}');

        expect(getPtvItems).toHaveBeenCalled();
        expect(stored.data.stats.trackCount).toBeGreaterThan(0);
    });

    it('publishes the first usable shelf before library discovery completes', async () => {
        let resolveViews!: (value: PtvItemsResult<PtvLibrary>) => void;
        let homeSettled = false;
        const onProgress = vi.fn();

        vi.mocked(getPtvUserViews).mockImplementation(() => new Promise(resolve => {
            resolveViews = resolve;
        }));
        vi.mocked(getPtvItems).mockResolvedValue({
            Items: [{ Id: 'recent-track', Name: 'Recent Track', Type: 'Audio' }],
            TotalRecordCount: 1
        });
        vi.mocked(getPtvRecentlyAdded).mockResolvedValue([]);
        vi.mocked(getPtvResumeItems).mockResolvedValue({ Items: [], TotalRecordCount: 0 });
        vi.mocked(getPtvFavoriteItems).mockResolvedValue({ Items: [], TotalRecordCount: 0 });

        const homeRequest = getPtvMusicHome({
            forceRefresh: true,
            initialOnly: true,
            onProgress
        }).finally(() => {
            homeSettled = true;
        });

        await vi.waitFor(() => {
            expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
                completeness: 'initial-usable',
                isPartial: true,
                sections: [ expect.objectContaining({ id: 'recently-played' }) ]
            }));
        });
        expect(homeSettled).toBe(false);

        vi.mocked(getPtvUserViews).mockResolvedValue({ Items: [], TotalRecordCount: 0 });
        resolveViews({ Items: [], TotalRecordCount: 0 });
        await expect(homeRequest).resolves.toEqual(expect.objectContaining({
            completeness: 'initial-usable'
        }));
    });
});
