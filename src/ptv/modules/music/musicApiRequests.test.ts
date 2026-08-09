import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../core/observability', () => ({
    recordPtvEvent: vi.fn(),
    shouldCollectDiagnostics: vi.fn(() => false),
    timePtvAsync: vi.fn((_type, _name, task: () => Promise<unknown>) => task())
}));

vi.mock('../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: vi.fn()
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
import { serializePtvItemFieldProfile } from '../../api/itemFieldProfiles';
import {
    fetchPtvMusicLyrics,
    fetchPtvMusicPlaylists,
    fetchPtvMusicTracks,
    getPtvMusicHome,
    invalidatePtvMusicHomeCache,
    PTV_MUSIC_PLAYLIST_PROBE_CONCURRENCY
} from './musicApi';
import type { PtvMusicItem } from './musicTypes';

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
        invalidatePtvMusicHomeCache();
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
