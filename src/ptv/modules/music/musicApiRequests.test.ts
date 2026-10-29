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
    getPtvItem,
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
    getPtvMusicLibrary,
    invalidatePtvMusicHomeCache,
    PTV_MUSIC_API_REQUEST_CONCURRENCY,
    PTV_MUSIC_MIX_SAMPLE_BASE_REQUESTS,
    PTV_MUSIC_MIX_SAMPLE_MAX_PAGES,
    PTV_MUSIC_MIX_SAMPLE_MAX_REQUESTS,
    PTV_MUSIC_MIX_SAMPLE_PAGE_SIZE,
    PTV_MUSIC_PLAYLIST_PROBE_CONCURRENCY,
    samplePtvMusicMixCandidates
} from './musicApi';
import type { PtvMusicHomeData, PtvMusicItem } from './musicTypes';

function getPlaylistCandidates(count: number): PtvMusicItem[] {
    return Array.from({ length: count }, (_, index) => ({
        Id: `playlist-${index}`,
        Name: `Playlist ${index}`,
        Type: 'Playlist'
    }));
}

const selectedMusicAlbum: PtvMusicItem = {
    Id: 'album-1',
    Name: 'A Two-Disc Album',
    Type: 'MusicAlbum'
};

function musicTrack(id: string, disc: number, track: number, albumId = 'album-1'): PtvMusicItem {
    return {
        AlbumId: albumId,
        Id: id,
        IndexNumber: track,
        Name: `Track ${track}`,
        ParentId: `disc-${disc}`,
        ParentIndexNumber: disc,
        Type: 'Audio'
    };
}

function mockSelectedMusicLibrary() {
    vi.mocked(getPtvUserViews).mockResolvedValue({
        Items: [
            { CollectionType: 'music', Id: 'music-library-1', Name: 'Music', Type: 'CollectionFolder' },
            { CollectionType: 'movies', Id: 'movie-library-1', Name: 'Movies', Type: 'CollectionFolder' }
        ],
        TotalRecordCount: 2
    });
}

function isMusicAlbumMembershipQuery(query?: { IncludeItemTypes?: string }) {
    return query?.IncludeItemTypes === 'MusicAlbum';
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
        vi.mocked(getPtvItem).mockReset();
        vi.mocked(getPtvItem).mockResolvedValue(selectedMusicAlbum);
        vi.mocked(getPtvItems).mockReset();
        vi.mocked(getPtvRecentlyAdded).mockReset();
        vi.mocked(getPtvResumeItems).mockReset();
        vi.mocked(getPtvUserViews).mockReset();
        vi.mocked(requestPtvJson).mockReset();
        vi.mocked(recordPtvEvent).mockReset();
        invalidatePtvMusicHomeCache();
        localStorage.removeItem('ptv.music.liked.v2:server-1:user-1');
    });

    it('samples later Music pages within a captured user and library scope with deterministic bounded requests', async () => {
        mockSelectedMusicLibrary();
        const library = Array.from({ length: 2100 }, (_, index): PtvMusicItem => ({
            Id: `track-${index}`,
            Name: `Track ${index}`,
            Type: 'Audio'
        }));

        vi.mocked(getPtvItems).mockImplementation(async query => ({
            Items: library.slice(Number(query?.StartIndex || 0), Number(query?.StartIndex || 0) + Number(query?.Limit || 0)),
            TotalRecordCount: library.length
        }));

        const first = await samplePtvMusicMixCandidates({ sessionSeed: 'same-seed' });
        const firstQueries = vi.mocked(getPtvItems).mock.calls.map(([query]) => query);
        const firstOptions = vi.mocked(getPtvItems).mock.calls.map(([, options]) => options);

        expect(first.libraryId).toBe('music-library-1');
        expect(first.serverId).toBe('server-1');
        expect(first.userId).toBe('user-1');
        expect(first.totalCount).toBe(2100);
        expect(first.complete).toBe(true);
        expect(first.requests).toBe(PTV_MUSIC_MIX_SAMPLE_BASE_REQUESTS + 1);
        expect(first.received).toBeLessThanOrEqual(1 + (PTV_MUSIC_MIX_SAMPLE_MAX_PAGES + 1) * PTV_MUSIC_MIX_SAMPLE_PAGE_SIZE);
        expect(first.items.some(item => Number(item.Id?.split('-')[1]) > 300)).toBe(true);
        expect(new Set(firstQueries.slice(1, PTV_MUSIC_MIX_SAMPLE_BASE_REQUESTS).map(query => query?.StartIndex)).size)
            .toBe(PTV_MUSIC_MIX_SAMPLE_MAX_PAGES);
        expect(firstQueries).toHaveLength(PTV_MUSIC_MIX_SAMPLE_BASE_REQUESTS + 1);
        firstQueries.slice(0, PTV_MUSIC_MIX_SAMPLE_BASE_REQUESTS).forEach(query => {
            expect(query).toEqual(expect.objectContaining({
                EnableTotalRecordCount: true,
                IncludeItemTypes: 'Audio',
                ParentId: 'music-library-1',
                Recursive: true,
                SortBy: 'SortName',
                SortOrder: 'Ascending'
            }));
            expect(query?.Limit).toBeLessThanOrEqual(PTV_MUSIC_MIX_SAMPLE_PAGE_SIZE);
        });
        expect(firstQueries.at(-1)).toEqual(expect.objectContaining({
            IncludeItemTypes: 'Audio',
            ParentId: 'music-library-1',
            SortBy: 'DatePlayed,SortName',
            SortOrder: 'Descending',
            StartIndex: 0
        }));
        firstOptions.forEach(options => {
            expect(options).toEqual(expect.objectContaining({
                serverId: 'server-1',
                userId: 'user-1'
            }));
        });
        expect(getPtvUserViews).toHaveBeenCalledWith(expect.objectContaining({
            serverId: 'server-1',
            userId: 'user-1'
        }));

        vi.mocked(getPtvItems).mockClear();
        const again = await samplePtvMusicMixCandidates({ sessionSeed: 'same-seed' });
        const different = await samplePtvMusicMixCandidates({ sessionSeed: 'different-seed' });
        expect(again.items.map(item => item.Id)).toEqual(first.items.map(item => item.Id));
        expect(new Set(different.items.map(item => item.Id))).not.toEqual(new Set(first.items.map(item => item.Id)));
    });

    it('does not issue an unscoped Mix query if the Music view cannot be resolved', async () => {
        vi.mocked(getPtvUserViews).mockResolvedValue({ Items: [], TotalRecordCount: 0 });

        await expect(samplePtvMusicMixCandidates({ sessionSeed: 'unresolved' }))
            .rejects.toThrow('selected Music library');
        expect(getPtvItems).not.toHaveBeenCalled();
    });

    it('adds fresh user-scoped recent tracks without admitting an unrelated Home-only track', async () => {
        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (query?.SortBy === 'DatePlayed,SortName') {
                return {
                    Items: [{ Id: 'recent-in-selected-view', Type: 'Audio' }],
                    TotalRecordCount: 2100
                };
            }

            const start = Number(query?.StartIndex || 0);
            return {
                Items: Array.from({ length: Number(query?.Limit || 0) }, (_, index) => ({
                    Id: `selected-view-${start + index}`,
                    Type: 'Audio'
                })),
                TotalRecordCount: 2100
            };
        });

        const result = await samplePtvMusicMixCandidates({ sessionSeed: 'fresh-recent' });

        expect(result.items.map(item => item.Id)).toContain('recent-in-selected-view');
        expect(result.items.map(item => item.Id)).not.toContain('foreign-home-only');
        expect(vi.mocked(getPtvItems).mock.calls.every(([query], index) => (
            query?.ParentId === 'music-library-1'
            && vi.mocked(getPtvItems).mock.calls[index]?.[1]?.userId === 'user-1'
        ))).toBe(true);
        expect(result.requests).toBe(PTV_MUSIC_MIX_SAMPLE_BASE_REQUESTS + 1);
    });

    it('retains a rare explicit genre outside all stratified and recent windows via one scoped affinity request', async () => {
        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (query?.Genres === 'Darkwave') {
                return {
                    Items: [{ Genres: ['Darkwave'], Id: 'rare-genre-track', Type: 'Audio' }],
                    TotalRecordCount: 1
                };
            }

            const start = Number(query?.StartIndex || 0);
            return {
                Items: Array.from({ length: Number(query?.Limit || 0) }, (_, index) => ({
                    Genres: ['Pop'],
                    Id: `ordinary-${start + index}`,
                    Type: 'Audio'
                })),
                TotalRecordCount: 2100
            };
        });

        const result = await samplePtvMusicMixCandidates({
            affinityGenres: ['Darkwave'],
            seed: { kind: 'genre', label: 'Darkwave', value: 'Darkwave' },
            sessionSeed: 'rare-darkwave'
        });
        const genreQueries = vi.mocked(getPtvItems).mock.calls.filter(([query]) => query?.Genres);

        expect(result.items.map(item => item.Id)).toContain('rare-genre-track');
        expect(genreQueries).toHaveLength(1);
        expect(genreQueries[0]?.[0]).toEqual(expect.objectContaining({
            Genres: 'Darkwave',
            IncludeItemTypes: 'Audio',
            ParentId: 'music-library-1',
            StartIndex: 0
        }));
        expect(genreQueries[0]?.[1]).toEqual(expect.objectContaining({ serverId: 'server-1', userId: 'user-1' }));
        expect(result.requests).toBe(PTV_MUSIC_MIX_SAMPLE_BASE_REQUESTS + 2);
        expect(result.requests).toBeLessThanOrEqual(PTV_MUSIC_MIX_SAMPLE_MAX_REQUESTS);
        expect(result.received).toBeLessThanOrEqual(529);
    });

    it('queries both an exact mood-named genre and one mapped genre reproducibly within selected scope', async () => {
        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (query?.Genres) {
                return {
                    Items: [{ Genres: [String(query.Genres)], Id: `genre-${query.Genres}`, Type: 'Audio' }],
                    TotalRecordCount: 1
                };
            }
            const start = Number(query?.StartIndex || 0);
            return {
                Items: Array.from({ length: Number(query?.Limit || 0) }, (_, index) => ({
                    Id: `track-${start + index}`,
                    Type: 'Audio'
                })),
                TotalRecordCount: 2100
            };
        });

        const options = {
            affinityGenres: ['Focus', 'Ambient', 'Classical'],
            seed: { kind: 'genre' as const, label: 'Focus', value: 'Focus' },
            sessionSeed: 'focus-mood'
        };
        const first = await samplePtvMusicMixCandidates(options);
        const firstGenres = vi.mocked(getPtvItems).mock.calls.map(([query]) => query?.Genres).filter(Boolean);
        vi.mocked(getPtvItems).mockClear();
        await samplePtvMusicMixCandidates(options);
        const secondGenres = vi.mocked(getPtvItems).mock.calls.map(([query]) => query?.Genres).filter(Boolean);

        expect(firstGenres[0]).toBe('Focus');
        expect(['Ambient', 'Classical']).toContain(firstGenres[1]);
        expect(first.items.map(item => item.Id)).toContain('genre-Focus');
        expect(first.items.map(item => item.Id)).toContain(`genre-${firstGenres[1]}`);
        expect(secondGenres).toEqual(firstGenres);
        expect(vi.mocked(getPtvItems).mock.calls.every(([query]) => query?.ParentId === 'music-library-1')).toBe(true);
        expect(first.requests).toBe(PTV_MUSIC_MIX_SAMPLE_BASE_REQUESTS + 3);
    });

    it('uses explicit random-prompt affinity to retrieve a rare genre beyond sampled windows', async () => {
        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (query?.Genres) {
                return {
                    Items: [{ Genres: [String(query.Genres)], Id: `genre-${query.Genres}`, Type: 'Audio' }],
                    TotalRecordCount: 1
                };
            }

            const start = Number(query?.StartIndex || 0);
            return {
                Items: Array.from({ length: Number(query?.Limit || 0) }, (_, index) => ({
                    Genres: ['Pop'],
                    Id: `ordinary-${start + index}`,
                    Type: 'Audio'
                })),
                TotalRecordCount: 2100
            };
        });

        const result = await samplePtvMusicMixCandidates({
            affinityGenres: ['Darkwave', 'Synth'],
            seed: { kind: 'random', label: 'Discovery' },
            sessionSeed: 'random-darkwave-prompt'
        });
        const genreQueries = vi.mocked(getPtvItems).mock.calls.filter(([query]) => query?.Genres);

        expect(result.items.map(item => item.Id)).toContain('genre-Darkwave');
        expect(genreQueries.map(([query]) => query?.Genres)).toEqual(['Darkwave', 'Synth']);
        expect(genreQueries.every(([query], index) => (
            query?.ParentId === 'music-library-1'
            && genreQueries[index]?.[1]?.userId === 'user-1'
        ))).toBe(true);
        expect(result.requests).toBeLessThanOrEqual(PTV_MUSIC_MIX_SAMPLE_MAX_REQUESTS);
    });

    it('samples a small Music library once without padding or repeated page requests', async () => {
        mockSelectedMusicLibrary();
        const tracks: PtvMusicItem[] = [
            { Id: 'small-1', Type: 'Audio' },
            { Id: 'small-2', Type: 'Audio' },
            { Id: 'small-3', Type: 'Audio' }
        ];
        vi.mocked(getPtvItems).mockImplementation(async query => ({
            Items: tracks.slice(Number(query?.StartIndex || 0), Number(query?.StartIndex || 0) + Number(query?.Limit || 0)),
            TotalRecordCount: tracks.length
        }));

        const result = await samplePtvMusicMixCandidates({ sessionSeed: 'small-library' });

        expect(result.complete).toBe(true);
        expect(result.items.map(item => item.Id)).toEqual(['small-1', 'small-2', 'small-3']);
        expect(result.requests).toBe(3);
        expect(vi.mocked(getPtvItems).mock.calls.map(([query]) => query?.Limit)).toEqual([1, 3, 3]);
    });

    it('marks an unexpectedly short sampled page partial when Jellyfin still reports many items', async () => {
        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation(async query => ({
            Items: [{ Id: `track-${query?.StartIndex}`, Type: 'Audio' }],
            TotalRecordCount: 2100
        }));

        const result = await samplePtvMusicMixCandidates({ sessionSeed: 'short-page' });

        expect(result.complete).toBe(false);
        expect(result.requests).toBeLessThanOrEqual(PTV_MUSIC_MIX_SAMPLE_BASE_REQUESTS);
        expect(result.items.length).toBeGreaterThan(0);
    });

    it('stops bounded Mix sampling when a later page changes the total', async () => {
        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation(async query => ({
            Items: [{ Id: `track-${query?.StartIndex}`, Type: 'Audio' }],
            TotalRecordCount: vi.mocked(getPtvItems).mock.calls.length > 1 ? 2101 : 2100
        }));

        const result = await samplePtvMusicMixCandidates({ sessionSeed: 'changing-total' });

        expect(result.complete).toBe(false);
        expect(result.items).toHaveLength(0);
        expect(result.requests).toBeLessThanOrEqual(PTV_MUSIC_MIX_SAMPLE_MAX_REQUESTS);
        expect(vi.mocked(getPtvItems).mock.calls.every(([query]) => query?.ParentId === 'music-library-1')).toBe(true);
    });

    it('deduplicates repeated pages and stops rather than spending the remaining Mix request budget', async () => {
        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockResolvedValue({
            Items: [{ Id: 'same-track', Type: 'Audio' }],
            TotalRecordCount: 2100
        });

        const result = await samplePtvMusicMixCandidates({ sessionSeed: 'repeated-page' });

        expect(result.complete).toBe(false);
        expect(result.items.map(item => item.Id)).toEqual(['same-track']);
        expect(result.requests).toBeLessThan(PTV_MUSIC_MIX_SAMPLE_MAX_REQUESTS);
    });

    it('marks a partly overlapping full page incomplete while retaining its new scoped tracks', async () => {
        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation(async query => {
            const start = Number(query?.StartIndex || 0);
            const items = Array.from({ length: Number(query?.Limit || 0) }, (_, index) => ({
                Id: `track-${start + index}`,
                Type: 'Audio'
            }));
            if (vi.mocked(getPtvItems).mock.calls.length === 2 || vi.mocked(getPtvItems).mock.calls.length === 3) {
                items[0] = { Id: 'track-from-first-page', Type: 'Audio' };
            }

            return { Items: items, TotalRecordCount: 2100 };
        });

        const result = await samplePtvMusicMixCandidates({ sessionSeed: 'one-overlap' });

        expect(result.complete).toBe(false);
        expect(result.items.map(item => item.Id).filter(id => id === 'track-from-first-page')).toHaveLength(1);
        expect(result.items.length).toBeGreaterThan(PTV_MUSIC_MIX_SAMPLE_PAGE_SIZE);
        expect(result.requests).toBe(PTV_MUSIC_MIX_SAMPLE_BASE_REQUESTS);
    });

    it('rejects a Mix superseded while a later scoped page is in flight', async () => {
        mockSelectedMusicLibrary();
        let current = true;
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (vi.mocked(getPtvItems).mock.calls.length > 1) current = false;

            return {
                Items: [{ Id: `track-${query?.StartIndex}`, Type: 'Audio' }],
                TotalRecordCount: 2100
            };
        });

        await expect(samplePtvMusicMixCandidates({ sessionSeed: 'superseded', isCurrent: () => current }))
            .rejects.toMatchObject({ name: 'AbortError' });
        expect(getPtvItems).toHaveBeenCalledTimes(2);
    });

    it('rejects identity switches during Mix sampling without starting another page', async () => {
        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (vi.mocked(getPtvItems).mock.calls.length > 1) vi.mocked(getPtvServerId).mockReturnValue('server-2');

            return {
                Items: [{ Id: `track-${query?.StartIndex}`, Type: 'Audio' }],
                TotalRecordCount: 2100
            };
        });

        await expect(samplePtvMusicMixCandidates({ sessionSeed: 'identity-switch' }))
            .rejects.toMatchObject({ name: 'AbortError' });
        expect(getPtvItems).toHaveBeenCalledTimes(2);
    });

    it('stops a Mix after one count probe if Jellyfin omits the total', async () => {
        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockResolvedValue({ Items: [{ Id: 'track-1', Type: 'Audio' }] });

        const result = await samplePtvMusicMixCandidates({ sessionSeed: 'missing-total' });

        expect(result).toMatchObject({ complete: false, items: [], requests: 1, totalCount: null });
        expect(getPtvItems).toHaveBeenCalledTimes(1);
    });

    it('stops at an empty sampled page instead of restarting at the first page', async () => {
        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation(async () => ({
            Items: vi.mocked(getPtvItems).mock.calls.length === 1 ? [{ Id: 'track-0', Type: 'Audio' }] : [],
            TotalRecordCount: 2100
        }));

        const result = await samplePtvMusicMixCandidates({ sessionSeed: 'empty-page' });

        expect(result).toMatchObject({ complete: false, items: [], requests: 2 });
        expect(getPtvItems).toHaveBeenCalledTimes(2);
    });

    it('retains a valid first scoped page when a later optional sampling request fails', async () => {
        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (vi.mocked(getPtvItems).mock.calls.length === 3) {
                throw new Error('Optional page failed');
            }

            return {
                Items: [{ Id: `track-${query?.StartIndex}`, Type: 'Audio' }],
                TotalRecordCount: 2100
            };
        });

        const result = await samplePtvMusicMixCandidates({ sessionSeed: 'partial-failure' });

        expect(result.complete).toBe(false);
        expect(result.items).toHaveLength(1);
        expect(result.requests).toBe(3);
        expect(vi.mocked(getPtvItems).mock.calls.every(([query]) => query?.ParentId === 'music-library-1')).toBe(true);
    });

    it.each(['sampled page', 'recent page'])('proves an explicit song seed after a failed %s without claiming the sample is complete', async failedPage => {
        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (query?.SearchTerm === 'Seed Song') {
                return {
                    Items: [{ Id: 'verified-seed', Name: 'Seed Song', Type: 'Audio' }],
                    TotalRecordCount: 1
                };
            }
            if (failedPage === 'sampled page' && vi.mocked(getPtvItems).mock.calls.length === 3) {
                throw new Error('Later sampled page failed');
            }
            if (failedPage === 'recent page' && query?.SortBy === 'DatePlayed,SortName') {
                throw new Error('Recent page failed');
            }

            const start = Number(query?.StartIndex || 0);
            return {
                Items: Array.from({ length: Number(query?.Limit || 0) }, (_, index) => ({
                    Id: `ordinary-${start + index}`,
                    Type: 'Audio'
                })),
                TotalRecordCount: 2100
            };
        });

        const result = await samplePtvMusicMixCandidates({
            seed: { id: 'verified-seed', item: { Id: 'verified-seed', Name: 'Seed Song', Type: 'Audio' }, kind: 'song' },
            sessionSeed: `seed-after-${failedPage}`
        });

        expect(result.complete).toBe(false);
        expect(result.seedVerified).toBe(true);
        expect(result.items.map(item => item.Id)).toContain('verified-seed');
        expect(result.requests).toBeLessThanOrEqual(PTV_MUSIC_MIX_SAMPLE_MAX_REQUESTS);
        expect(vi.mocked(getPtvItems).mock.calls.every(([query], index) => (
            query?.ParentId === 'music-library-1'
            && vi.mocked(getPtvItems).mock.calls[index]?.[1]?.userId === 'user-1'
        ))).toBe(true);
    });

    it('rejects a Mix aborted during a sampled page even when the transport resolves', async () => {
        mockSelectedMusicLibrary();
        // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill for legacy web runtimes.
        const controller = new AbortController();
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (vi.mocked(getPtvItems).mock.calls.length === 2) controller.abort();

            return {
                Items: [{ Id: `track-${query?.StartIndex}`, Type: 'Audio' }],
                TotalRecordCount: 2100
            };
        });

        await expect(samplePtvMusicMixCandidates({ sessionSeed: 'aborted', signal: controller.signal }))
            .rejects.toMatchObject({ name: 'AbortError' });
        expect(getPtvItems).toHaveBeenCalledTimes(2);
    });

    it('rejects a Mix after Music scope invalidation rather than publishing stale pages', async () => {
        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (vi.mocked(getPtvItems).mock.calls.length === 2) invalidatePtvMusicHomeCache();

            return {
                Items: [{ Id: `track-${query?.StartIndex}`, Type: 'Audio' }],
                TotalRecordCount: 2100
            };
        });

        await expect(samplePtvMusicMixCandidates({ sessionSeed: 'scope-retired' }))
            .rejects.toMatchObject({ name: 'AbortError' });
        expect(getPtvItems).toHaveBeenCalledTimes(2);
    });

    it('allows a completed Mix to assert its original scope after ranking and rejects later invalidation', async () => {
        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockResolvedValue({ Items: [], TotalRecordCount: 0 });

        const result = await samplePtvMusicMixCandidates({ sessionSeed: 'post-ranking-guard' });

        expect(() => result.assertCurrent()).not.toThrow();
        invalidatePtvMusicHomeCache();
        expect(() => result.assertCurrent()).toThrow(expect.objectContaining({ name: 'AbortError' }));
    });

    it('rejects a completed Mix when the selected Music view changes before publication', async () => {
        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockResolvedValue({ Items: [], TotalRecordCount: 0 });
        const result = await samplePtvMusicMixCandidates({ sessionSeed: 'view-switch-guard' });

        vi.mocked(getPtvUserViews).mockResolvedValue({
            Items: [{ CollectionType: 'music', Id: 'music-library-2', Name: 'Other Music', Type: 'CollectionFolder' }],
            TotalRecordCount: 1
        });
        await getPtvMusicLibrary();

        expect(() => result.assertCurrent()).toThrow(expect.objectContaining({ name: 'AbortError' }));
    });

    it('verifies the same selected Music view through one fresh user-aware publication read', async () => {
        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockResolvedValue({ Items: [], TotalRecordCount: 0 });
        const result = await samplePtvMusicMixCandidates({ sessionSeed: 'fresh-publication-read' });

        await expect(result.verifyCurrent()).resolves.toBeUndefined();
        expect(getPtvUserViews).toHaveBeenCalledTimes(2);
        expect(vi.mocked(getPtvUserViews).mock.calls.every(([options]) => (
            options?.serverId === 'server-1' && options?.userId === 'user-1'
        ))).toBe(true);
        expect(vi.mocked(getPtvUserViews).mock.calls[1]?.[0]).toEqual(expect.objectContaining({ fresh: true }));
    });

    it('rejects a selected-view change during ranking even without cache invalidation', async () => {
        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockResolvedValue({ Items: [], TotalRecordCount: 0 });
        const result = await samplePtvMusicMixCandidates({ sessionSeed: 'silent-view-switch' });
        vi.mocked(getPtvUserViews).mockResolvedValue({
            Items: [{ CollectionType: 'music', Id: 'music-library-2', Name: 'Other Music', Type: 'CollectionFolder' }],
            TotalRecordCount: 1
        });

        expect(() => result.assertCurrent()).not.toThrow();
        await expect(result.verifyCurrent()).rejects.toMatchObject({ name: 'AbortError' });
        expect(getPtvUserViews).toHaveBeenCalledTimes(2);
    });

    it('rejects publication when the fresh Music view verification fails', async () => {
        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockResolvedValue({ Items: [], TotalRecordCount: 0 });
        const result = await samplePtvMusicMixCandidates({ sessionSeed: 'view-lookup-failure' });
        vi.mocked(getPtvUserViews).mockRejectedValue(new Error('Views unavailable'));

        await expect(result.verifyCurrent()).rejects.toMatchObject({ name: 'AbortError' });
        expect(getPtvUserViews).toHaveBeenCalledTimes(2);
    });

    it('adds an exact song seed only after a user-aware selected-library search returns its ID', async () => {
        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (query?.SearchTerm) {
                return {
                    Items: [
                        { Id: 'foreign-song', Name: 'The Seed', Type: 'Audio' },
                        { Id: 'seed-song', Name: 'The Seed', Type: 'Audio' }
                    ],
                    TotalRecordCount: 2
                };
            }

            const start = Number(query?.StartIndex || 0);
            return {
                Items: Array.from({ length: Number(query?.Limit || 0) }, (_, index) => ({
                    Id: `ordinary-${start + index}`,
                    Type: 'Audio'
                })),
                TotalRecordCount: 2100
            };
        });

        const result = await samplePtvMusicMixCandidates({
            seed: { id: 'seed-song', item: { Id: 'seed-song', Name: 'The Seed', Type: 'Audio' }, kind: 'song' },
            sessionSeed: 'song-seed'
        });

        expect(result.seedVerified).toBe(true);
        expect(result.items.map(item => item.Id)).toContain('seed-song');
        expect(result.items.map(item => item.Id)).not.toContain('foreign-song');
        expect(result.requests).toBeLessThanOrEqual(PTV_MUSIC_MIX_SAMPLE_MAX_REQUESTS);
        expect(vi.mocked(getPtvItems).mock.calls.every(([query], index) => (
            query?.ParentId === 'music-library-1'
            && vi.mocked(getPtvItems).mock.calls[index]?.[1]?.userId === 'user-1'
        ))).toBe(true);
    });

    it('does not verify a seed from an inconsistent zero-total nonempty search response', async () => {
        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (query?.SearchTerm === 'Seed Song') {
                return {
                    Items: [{ Id: 'unproven-seed', Name: 'Seed Song', Type: 'Audio' }],
                    TotalRecordCount: 0
                };
            }

            return {
                Items: [{ Id: 'ordinary-track', Type: 'Audio' }],
                TotalRecordCount: 1
            };
        });

        const result = await samplePtvMusicMixCandidates({
            seed: { id: 'unproven-seed', item: { Id: 'unproven-seed', Name: 'Seed Song', Type: 'Audio' }, kind: 'song' },
            sessionSeed: 'inconsistent-seed-total'
        });

        expect(result.seedVerified).toBe(false);
        expect(result.complete).toBe(false);
        expect(result.items.map(item => item.Id)).not.toContain('unproven-seed');
        expect(vi.mocked(getPtvItems).mock.calls.every(([query]) => query?.ParentId === 'music-library-1')).toBe(true);
    });

    it('does not trust a foreign album seed or query its descendants without exact selected-view membership', async () => {
        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (query?.IncludeItemTypes === 'MusicAlbum') {
                return {
                    Items: [{ Id: 'other-album', Name: 'Similar Album', Type: 'MusicAlbum' }],
                    TotalRecordCount: 1
                };
            }

            const start = Number(query?.StartIndex || 0);
            return {
                Items: Array.from({ length: Number(query?.Limit || 0) }, (_, index) => ({
                    AlbumId: 'other-album',
                    Id: `ordinary-${start + index}`,
                    Type: 'Audio'
                })),
                TotalRecordCount: 2100
            };
        });

        const result = await samplePtvMusicMixCandidates({
            seed: { id: 'foreign-album', item: { Id: 'foreign-album', Name: 'Similar Album', Type: 'MusicAlbum' }, kind: 'album' },
            sessionSeed: 'foreign-album'
        });

        expect(result.seedVerified).toBe(false);
        expect(result.items.map(item => item.Id)).not.toContain('foreign-album');
        expect(vi.mocked(getPtvItems).mock.calls.every(([query]) => query?.ParentId === 'music-library-1')).toBe(true);
    });

    it('retrieves bounded nested tracks only after proving exact album membership in the selected view', async () => {
        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (query?.IncludeItemTypes === 'MusicAlbum') {
                return {
                    Items: [{ Id: 'album-1', Name: 'A Two-Disc Album', Type: 'MusicAlbum' }],
                    TotalRecordCount: 1
                };
            }
            if (query?.ParentId === 'album-1') {
                return {
                    Items: [
                        musicTrack('disc-1-song', 1, 1),
                        musicTrack('disc-2-song', 2, 1),
                        musicTrack('wrong-album-song', 1, 2, 'other-album')
                    ],
                    TotalRecordCount: 3
                };
            }

            const start = Number(query?.StartIndex || 0);
            return {
                Items: Array.from({ length: Number(query?.Limit || 0) }, (_, index) => ({
                    Id: `ordinary-${start + index}`,
                    Type: 'Audio'
                })),
                TotalRecordCount: 2100
            };
        });

        const result = await samplePtvMusicMixCandidates({
            seed: { id: 'album-1', item: selectedMusicAlbum, kind: 'album' },
            sessionSeed: 'nested-album'
        });

        expect(result.seedVerified).toBe(true);
        expect(result.items.map(item => item.Id)).toEqual(expect.arrayContaining(['disc-1-song', 'disc-2-song']));
        expect(result.items.map(item => item.Id)).not.toContain('wrong-album-song');
        expect(result.requests).toBe(PTV_MUSIC_MIX_SAMPLE_BASE_REQUESTS + 3);
        expect(vi.mocked(getPtvItems).mock.calls.slice(-2).map(([query]) => query?.ParentId))
            .toEqual(['music-library-1', 'album-1']);
        expect(vi.mocked(getPtvItems).mock.calls.slice(-2).every(([, options]) => options?.userId === 'user-1')).toBe(true);
    });

    it('keeps artist affinity scoped and accepts only tracks tied to the verified artist ID', async () => {
        mockSelectedMusicLibrary();
        vi.mocked(requestPtvJson).mockResolvedValue({
            Items: [{ Id: 'artist-1', Name: 'Artist One', Type: 'MusicArtist' }],
            TotalRecordCount: 1
        });
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (query?.ArtistIds === 'artist-1') {
                return {
                    Items: [
                        { ArtistItems: [{ Id: 'artist-1', Name: 'Artist One' }], Id: 'artist-track', Type: 'Audio' },
                        { ArtistItems: [{ Id: 'other-artist', Name: 'Other' }], Id: 'foreign-track', Type: 'Audio' }
                    ],
                    TotalRecordCount: 2
                };
            }

            const start = Number(query?.StartIndex || 0);
            return {
                Items: Array.from({ length: Number(query?.Limit || 0) }, (_, index) => ({
                    Id: `ordinary-${start + index}`,
                    Type: 'Audio'
                })),
                TotalRecordCount: 2100
            };
        });

        const result = await samplePtvMusicMixCandidates({
            seed: { id: 'artist-1', item: { Id: 'artist-1', Name: 'Artist One', Type: 'MusicArtist' }, kind: 'artist' },
            sessionSeed: 'artist-seed'
        });

        expect(result.seedVerified).toBe(true);
        expect(result.items.map(item => item.Id)).toContain('artist-track');
        expect(result.items.map(item => item.Id)).not.toContain('foreign-track');
        expect(vi.mocked(getPtvItems).mock.calls.every(([query]) => query?.ParentId === 'music-library-1')).toBe(true);
        expect(requestPtvJson).toHaveBeenCalledWith('Artists', expect.objectContaining({
            params: expect.objectContaining({ ParentId: 'music-library-1', UserId: 'user-1' }),
            serverId: 'server-1'
        }));
    });

    it.each(['empty', 'error'])('verifies an album artist through the scoped fallback when the ordinary artist endpoint has an %s result', async outcome => {
        mockSelectedMusicLibrary();
        vi.mocked(requestPtvJson).mockImplementation(async path => {
            if (path === 'Artists' && outcome === 'error') throw new Error('Ordinary artist endpoint unavailable');

            return path === 'Artists' ? {
                Items: [],
                TotalRecordCount: 0
            } : {
                Items: [{ Id: 'album-artist-1', Name: 'Album Artist', Type: 'MusicArtist' }],
                TotalRecordCount: 1
            };
        });
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (query?.ArtistIds === 'album-artist-1') {
                return {
                    Items: [{ ArtistItems: [], Id: 'album-artist-track', Type: 'Audio' }],
                    TotalRecordCount: 1
                };
            }

            const start = Number(query?.StartIndex || 0);
            return {
                Items: Array.from({ length: Number(query?.Limit || 0) }, (_, index) => ({
                    Id: `ordinary-${start + index}`,
                    Type: 'Audio'
                })),
                TotalRecordCount: 2100
            };
        });

        const result = await samplePtvMusicMixCandidates({
            seed: { id: 'album-artist-1', item: { Id: 'album-artist-1', Name: 'Album Artist', Type: 'MusicArtist' }, kind: 'artist' },
            sessionSeed: 'album-artist-fallback'
        });

        expect(result.seedVerified).toBe(true);
        expect(result.items.map(item => item.Id)).toContain('album-artist-track');
        expect(vi.mocked(requestPtvJson).mock.calls.map(([path]) => path)).toEqual(['Artists', 'Artists/AlbumArtists']);
        expect(vi.mocked(requestPtvJson).mock.calls.every(([, options]) => (
            options?.params?.ParentId === 'music-library-1'
            && options?.params?.UserId === 'user-1'
            && options?.serverId === 'server-1'
        ))).toBe(true);
    });

    it.each([
        { kind: 'song' as const, type: 'Audio', expectedId: 'exact-seed' },
        { kind: 'album' as const, type: 'MusicAlbum', expectedId: 'related-track' },
        { kind: 'artist' as const, type: 'MusicArtist', expectedId: 'related-track' }
    ])('finds an exact $kind seed after more than 48 same-name hits without widening scope', async ({ kind, type, expectedId }) => {
        mockSelectedMusicLibrary();
        const matches: PtvMusicItem[] = Array.from({ length: 90 }, (_, index) => ({
            Id: index === 70 ? 'exact-seed' : `same-name-${index}`,
            Name: 'Common Name',
            Type: type
        }));
        if (kind === 'artist') {
            vi.mocked(requestPtvJson).mockImplementation(async (_path, options) => {
                const start = Number(options?.params?.StartIndex || 0);
                return {
                    Items: matches.slice(start, start + Number(options?.params?.Limit || 0)),
                    TotalRecordCount: matches.length
                };
            });
        }
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (query?.SearchTerm === 'Common Name') {
                const start = Number(query.StartIndex || 0);
                return {
                    Items: matches.slice(start, start + Number(query.Limit || 0)),
                    TotalRecordCount: matches.length
                };
            }
            if (query?.ParentId === 'exact-seed' || query?.ArtistIds === 'exact-seed') {
                return {
                    Items: [{ AlbumId: 'exact-seed', ArtistItems: [], Id: 'related-track', Type: 'Audio' }],
                    TotalRecordCount: 1
                };
            }

            const start = Number(query?.StartIndex || 0);
            return {
                Items: Array.from({ length: Number(query?.Limit || 0) }, (_, index) => ({
                    Id: `ordinary-${start + index}`,
                    Type: 'Audio'
                })),
                TotalRecordCount: 2100
            };
        });

        const result = await samplePtvMusicMixCandidates({
            seed: { id: 'exact-seed', item: { Id: 'exact-seed', Name: 'Common Name', Type: type }, kind },
            sessionSeed: `many-${kind}`
        });
        const membershipQueries = kind === 'artist' ?
            vi.mocked(requestPtvJson).mock.calls.map(([, options]) => options?.params) :
            vi.mocked(getPtvItems).mock.calls.map(([query]) => query)
                .filter(query => query?.SearchTerm === 'Common Name');

        expect(result.seedVerified).toBe(true);
        expect(result.items.map(item => item.Id)).toContain(expectedId);
        expect(membershipQueries.map(query => query?.StartIndex)).toEqual([0, 48]);
        expect(membershipQueries.every(query => query?.ParentId === 'music-library-1')).toBe(true);
        expect(result.requests).toBeLessThanOrEqual(PTV_MUSIC_MIX_SAMPLE_MAX_REQUESTS);
        expect(vi.mocked(getPtvItems).mock.calls.every(([, options]) => options?.userId === 'user-1')).toBe(true);
    });

    it('stops exact seed membership at three scoped pages when a common-name ID is beyond the lookup budget', async () => {
        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (query?.SearchTerm === 'Common Name') {
                const start = Number(query.StartIndex || 0);
                return {
                    Items: Array.from({ length: Number(query.Limit || 0) }, (_, index) => ({
                        Id: start + index === 150 ? 'too-deep-seed' : `same-name-${start + index}`,
                        Name: 'Common Name',
                        Type: 'Audio'
                    })),
                    TotalRecordCount: 160
                };
            }

            const start = Number(query?.StartIndex || 0);
            return {
                Items: Array.from({ length: Number(query?.Limit || 0) }, (_, index) => ({
                    Id: `ordinary-${start + index}`,
                    Type: 'Audio'
                })),
                TotalRecordCount: 2100
            };
        });

        const result = await samplePtvMusicMixCandidates({
            seed: { id: 'too-deep-seed', item: { Id: 'too-deep-seed', Name: 'Common Name', Type: 'Audio' }, kind: 'song' },
            sessionSeed: 'bounded-name-search'
        });
        const membershipQueries = vi.mocked(getPtvItems).mock.calls
            .map(([query]) => query)
            .filter(query => query?.SearchTerm === 'Common Name');

        expect(result.seedVerified).toBe(false);
        expect(result.items.map(item => item.Id)).not.toContain('too-deep-seed');
        expect(membershipQueries.map(query => query?.StartIndex)).toEqual([0, 48, 96]);
        expect(result.requests).toBeLessThanOrEqual(PTV_MUSIC_MIX_SAMPLE_MAX_REQUESTS);
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

    it('proves selected-library album membership before loading and ordering nested disc tracks', async () => {
        const tracks = [
            musicTrack('disc-2-track-2', 2, 2),
            musicTrack('disc-1-track-2', 1, 2),
            musicTrack('disc-2-track-1', 2, 1),
            musicTrack('disc-1-track-1', 1, 1)
        ];

        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (isMusicAlbumMembershipQuery(query)) {
                return { Items: [selectedMusicAlbum], TotalRecordCount: 1 };
            }

            if (query?.ParentId === selectedMusicAlbum.Id) {
                return { Items: tracks, TotalRecordCount: tracks.length };
            }

            return { Items: [], TotalRecordCount: 0 };
        });

        const result = await fetchPtvMusicAlbumTracks('album-1', 100);
        const queries = vi.mocked(getPtvItems).mock.calls.map(([query]) => query);
        const albumQueries = queries.filter(isMusicAlbumMembershipQuery);

        expect(result.map(track => track.Id)).toEqual([
            'disc-1-track-1', 'disc-1-track-2', 'disc-2-track-1', 'disc-2-track-2'
        ]);
        expect(result[0]).toBe(tracks[3]);
        expect(vi.mocked(getPtvItem).mock.calls[0]?.[0]).toBe('album-1');
        expect(albumQueries).toEqual([expect.objectContaining({
            IncludeItemTypes: 'MusicAlbum',
            ParentId: 'music-library-1',
            Recursive: true,
            SearchTerm: selectedMusicAlbum.Name
        })]);
        expect(albumQueries[0]).not.toHaveProperty('Ids');
        expect(queries).toContainEqual(expect.objectContaining({
            IncludeItemTypes: 'Audio',
            ParentId: 'album-1',
            Recursive: true
        }));
    });

    it('keeps a flat single-disc album playable with its original track identities', async () => {
        const tracks = [musicTrack('flat-track-2', 1, 2), musicTrack('flat-track-1', 1, 1)];

        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (isMusicAlbumMembershipQuery(query)) {
                return { Items: [selectedMusicAlbum], TotalRecordCount: 1 };
            }

            return { Items: tracks, TotalRecordCount: tracks.length };
        });

        await expect(fetchPtvMusicAlbumTracks('album-1', 100)).resolves.toEqual([
            tracks[1], tracks[0]
        ]);
    });

    it('includes a dispersed album track returned only by Jellyfin album relationship identity', async () => {
        const descendant = musicTrack('folder-track', 1, 2);
        const dispersed = { ...musicTrack('dispersed-track', 1, 1), ParentId: 'unrelated-folder' };
        const foreign = musicTrack('foreign-track', 1, 3, 'other-album');

        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (isMusicAlbumMembershipQuery(query)) {
                return { Items: [selectedMusicAlbum], TotalRecordCount: 1 };
            }

            if (query?.ParentId === selectedMusicAlbum.Id) {
                return { Items: [descendant], TotalRecordCount: 1 };
            }

            if (query?.AlbumIds === selectedMusicAlbum.Id) {
                return { Items: [dispersed, foreign], TotalRecordCount: 2 };
            }

            return { Items: [], TotalRecordCount: 0 };
        });

        const result = await fetchPtvMusicAlbumTracks('album-1', 100);
        const queries = vi.mocked(getPtvItems).mock.calls.map(([query]) => query);

        expect(result).toEqual([dispersed, descendant]);
        expect(queries).toContainEqual(expect.objectContaining({
            AlbumIds: 'album-1',
            IncludeItemTypes: 'Audio',
            ParentId: 'music-library-1'
        }));
    });

    it('deduplicates mixed direct and nested tracks while excluding foreign or unverified album IDs', async () => {
        const directTrack = {
            ...musicTrack('direct-track', 1, 2),
            ParentId: 'album-1',
            ParentIndexNumber: undefined
        };
        const firstDiscTrack = musicTrack('disc-1-track', 1, 1);
        const nestedTrack = musicTrack('nested-track', 2, 1);
        const foreignTrack = musicTrack('foreign-track', 2, 2, 'album-elsewhere');
        const missingAlbumId = { ...musicTrack('unverified-track', 2, 3), AlbumId: undefined };

        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (isMusicAlbumMembershipQuery(query)) {
                return { Items: [selectedMusicAlbum], TotalRecordCount: 1 };
            }

            return {
                Items: [nestedTrack, foreignTrack, directTrack, firstDiscTrack, nestedTrack, missingAlbumId],
                TotalRecordCount: 6
            };
        });

        const result = await fetchPtvMusicAlbumTracks('album-1', 100);

        expect(result.map(track => track.Id)).toEqual(['disc-1-track', 'direct-track', 'nested-track']);
        expect(result).toEqual([firstDiscTrack, directTrack, nestedTrack]);
    });

    it('does not load tracks for an album absent from the selected Music library', async () => {
        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (isMusicAlbumMembershipQuery(query)) {
                return { Items: [{ ...selectedMusicAlbum, Id: 'other-library-album' }], TotalRecordCount: 1 };
            }

            return { Items: [musicTrack('foreign-track', 1, 1)], TotalRecordCount: 1 };
        });

        await expect(fetchPtvMusicAlbumTracks('album-1', 100)).resolves.toEqual([]);
        expect(vi.mocked(getPtvItems).mock.calls.map(([query]) => query?.IncludeItemTypes)).toEqual([
            'MusicAlbum'
        ]);
        expect(vi.mocked(getPtvItems).mock.calls[0]?.[0]).toEqual(expect.objectContaining({
            ParentId: 'music-library-1',
            SearchTerm: selectedMusicAlbum.Name
        }));
        expect(vi.mocked(getPtvItems).mock.calls[0]?.[0]).not.toHaveProperty('Ids');
    });

    it('stops scoped album membership paging once the exact album ID is found', async () => {
        const track = musicTrack('confirmed-track', 1, 1);

        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (isMusicAlbumMembershipQuery(query)) {
                return {
                    Items: Number(query?.StartIndex || 0) === 0 ? [selectedMusicAlbum] : [],
                    TotalRecordCount: 5000
                };
            }

            if (query?.ParentId === selectedMusicAlbum.Id) {
                return { Items: [track], TotalRecordCount: 1 };
            }

            return { Items: [], TotalRecordCount: 0 };
        });

        await expect(fetchPtvMusicAlbumTracks('album-1', 100)).resolves.toEqual([track]);
        expect(vi.mocked(getPtvItems).mock.calls.filter(([query]) => isMusicAlbumMembershipQuery(query))).toHaveLength(1);
    });

    it('does not fall back to an unscoped album query when no Music library is visible', async () => {
        vi.mocked(getPtvUserViews).mockResolvedValue({ Items: [], TotalRecordCount: 0 });
        vi.mocked(getPtvItems).mockResolvedValue({
            Items: [musicTrack('unscoped-track', 1, 1)],
            TotalRecordCount: 1
        });

        await expect(fetchPtvMusicAlbumTracks('album-1', 100)).resolves.toEqual([]);
        expect(getPtvItems).not.toHaveBeenCalled();
    });

    it('pages album descendants beyond the first 100 tracks without truncating the playback queue', async () => {
        const tracks = Array.from({ length: 120 }, (_, index) => (
            musicTrack(`track-${String(index + 1).padStart(3, '0')}`, index < 60 ? 1 : 2, (index % 60) + 1)
        ));

        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (isMusicAlbumMembershipQuery(query)) {
                return { Items: [selectedMusicAlbum], TotalRecordCount: 1 };
            }

            const start = Number(query?.StartIndex || 0);
            const pageSize = Math.min(Number(query?.Limit || 100), 100);

            return { Items: tracks.slice(start, start + pageSize), TotalRecordCount: tracks.length };
        });

        const result = await fetchPtvMusicAlbumTracks('album-1', 150);
        const audioQueries = vi.mocked(getPtvItems).mock.calls
            .map(([query]) => query)
            .filter(query => query?.IncludeItemTypes === 'Audio');

        expect(result.map(track => track.Id)).toEqual(tracks.map(track => track.Id));
        expect(audioQueries.length).toBeGreaterThan(1);
        expect(audioQueries.some(query => Number(query?.StartIndex || 0) > 0)).toBe(true);
    });

    it.each([
        { label: 'zero', total: 0 },
        { label: 'unavailable', total: undefined }
    ])('stops a short album Audio page when the reported total is $label', async ({ total }) => {
        const track = musicTrack('short-page-track', 1, 1);

        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (isMusicAlbumMembershipQuery(query)) {
                return { Items: [selectedMusicAlbum], TotalRecordCount: 1 };
            }

            if (query?.ParentId === selectedMusicAlbum.Id) {
                return { Items: [track], TotalRecordCount: total };
            }

            return { Items: [], TotalRecordCount: 0 };
        });

        await expect(fetchPtvMusicAlbumTracks('album-1', 100)).resolves.toEqual([track]);
        expect(vi.mocked(getPtvItems).mock.calls.filter(([query]) => query?.ParentId === 'album-1')).toHaveLength(1);
    });

    it('fails closed when selected-library album membership or descendant retrieval fails', async () => {
        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockRejectedValueOnce(new Error('Music membership unavailable'));

        await expect(fetchPtvMusicAlbumTracks('album-1', 100)).rejects.toThrow('Music membership unavailable');
        expect(getPtvItems).toHaveBeenCalledTimes(1);

        vi.mocked(getPtvItems).mockReset();
        vi.mocked(getPtvItems).mockImplementation(async query => {
            if (isMusicAlbumMembershipQuery(query)) {
                return { Items: [selectedMusicAlbum], TotalRecordCount: 1 };
            }

            throw new Error('Album descendants unavailable');
        });

        await expect(fetchPtvMusicAlbumTracks('album-1', 100)).rejects.toThrow('Album descendants unavailable');
        expect(vi.mocked(getPtvItems).mock.calls.map(([query]) => query?.IncludeItemTypes)).toEqual([
            'MusicAlbum', 'Audio'
        ]);
    });

    it('propagates route cancellation without starting a fallback album query', async () => {
        // eslint-disable-next-line compat/compat -- Jellyfin loads the AbortController polyfill for legacy web runtimes.
        const controller = new AbortController();

        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation((query, options) => {
            if (isMusicAlbumMembershipQuery(query)) {
                return Promise.resolve({ Items: [selectedMusicAlbum], TotalRecordCount: 1 });
            }

            return new Promise((_resolve, reject) => {
                // eslint-disable-next-line sonarjs/no-nested-functions -- The test transport must observe the route-owned signal.
                options?.signal?.addEventListener('abort', () => reject(createAbortError()), { once: true });
            });
        });

        const request = fetchPtvMusicAlbumTracks('album-1', 100, controller.signal);

        await vi.waitFor(() => {
            expect(vi.mocked(getPtvItems).mock.calls.some(([query]) => query?.IncludeItemTypes === 'Audio')).toBe(true);
        });
        controller.abort();

        await expect(request).rejects.toMatchObject({ name: 'AbortError' });
        expect(vi.mocked(getPtvItems).mock.calls.map(([query]) => query?.IncludeItemTypes)).toEqual([
            'MusicAlbum', 'Audio'
        ]);
    });

    it.each(['user', 'server'])('does not expose the previous %s identity\'s album tracks after a session change', async identity => {
        let resolveAudio!: (result: PtvItemsResult<PtvMusicItem>) => void;

        mockSelectedMusicLibrary();
        vi.mocked(getPtvItems).mockImplementation(query => {
            if (isMusicAlbumMembershipQuery(query)) {
                return Promise.resolve({ Items: [selectedMusicAlbum], TotalRecordCount: 1 });
            }

            if (query?.ParentId === 'album-1') {
                return new Promise(resolve => {
                    resolveAudio = resolve;
                });
            }

            return Promise.resolve({ Items: [], TotalRecordCount: 0 });
        });

        const request = fetchPtvMusicAlbumTracks('album-1', 100);

        await vi.waitFor(() => {
            expect(vi.mocked(getPtvItems).mock.calls.some(([query]) => query?.IncludeItemTypes === 'Audio')).toBe(true);
        });

        if (identity === 'user') {
            vi.mocked(getPtvCurrentUserId).mockReturnValue('user-2');
        } else {
            vi.mocked(getPtvServerId).mockReturnValue('server-2');
        }
        resolveAudio({ Items: [musicTrack('previous-session-track', 1, 1)], TotalRecordCount: 1 });

        await expect(request).rejects.toMatchObject({ name: 'AbortError' });
        expect(getPtvItems).toHaveBeenCalledTimes(2);
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
