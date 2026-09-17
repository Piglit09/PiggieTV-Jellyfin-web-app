import type { SessionInfoDto } from '@jellyfin/sdk/lib/generated-client/models/session-info-dto';
import type { SystemInfo } from '@jellyfin/sdk/lib/generated-client/models/system-info';
import type { TaskInfo } from '@jellyfin/sdk/lib/generated-client/models/task-info';
import type { VirtualFolderInfo } from '@jellyfin/sdk/lib/generated-client/models/virtual-folder-info';
import { describe, expect, it } from 'vitest';

import { getPtvBuildInfo } from '../../../core/buildInfo';
import {
    buildAdminDashboardOverall,
    buildAdminDashboardWarnings,
    createUnavailableAdminLibraries,
    createUnavailableAdminPlayback,
    createUnavailableAdminPtv,
    createUnavailableAdminServer,
    createUnavailableAdminTasks,
    normalizeAdminLibraries,
    normalizeAdminPlayback,
    normalizeAdminPtvStatus,
    normalizeAdminServer,
    normalizeAdminTasks
} from './adminDashboardAdapters';
import type { AdminDashboardSources } from './adminDashboardModel';

const NOW = Date.UTC(2026, 7, 12, 12, 0, 0);
const MINUTE_IN_TICKS = 600_000_000;

function systemInfo(overrides: Partial<SystemInfo> = {}): SystemInfo {
    return {
        ServerName: 'Piggie Server',
        Version: '10.11.11',
        ...overrides
    };
}

function task(overrides: Partial<TaskInfo> = {}): TaskInfo {
    return {
        Name: 'Scheduled task',
        State: 'Idle',
        ...overrides
    };
}

function session(overrides: Partial<SessionInfoDto> = {}): SessionInfoDto {
    return {
        Client: 'PiggieTV',
        DeviceName: 'Living Room TV',
        IsActive: true,
        NowPlayingItem: {
            Name: 'Movie title',
            RunTimeTicks: 120 * MINUTE_IN_TICKS,
            Type: 'Movie'
        },
        PlayState: {
            IsPaused: false,
            PlayMethod: 'DirectPlay',
            PositionTicks: 30 * MINUTE_IN_TICKS
        },
        UserName: 'Piggie',
        ...overrides
    };
}

function healthySources(): AdminDashboardSources {
    return {
        libraries: normalizeAdminLibraries([ { CollectionType: 'movies' } ]),
        playback: normalizeAdminPlayback([]),
        ptv: normalizeAdminPtvStatus({
            cacheHealthy: true,
            featuredCacheFresh: true,
            featuredContent: {
                hasPayload: true,
                heroCount: 2,
                itemCount: 20,
                sectionCount: 4
            },
            ok: true,
            pluginVersion: '1.2.3'
        }),
        server: normalizeAdminServer(systemInfo()),
        tasks: normalizeAdminTasks([], { now: NOW })
    };
}

describe('admin dashboard server normalization', () => {
    it('represents an available server as online', () => {
        expect(normalizeAdminServer(systemInfo())).toMatchObject({
            name: 'Piggie Server',
            severity: 'healthy',
            sourceState: 'ready',
            state: 'online',
            statusLabel: 'Online',
            version: '10.11.11'
        });
    });

    it('prioritizes shutdown and pending restart states', () => {
        expect(normalizeAdminServer(systemInfo({ HasPendingRestart: true })).state).toBe('restart-pending');
        expect(normalizeAdminServer(systemInfo({
            HasPendingRestart: true,
            IsShuttingDown: true
        })).state).toBe('shutting-down');
    });

    it('keeps unavailable fields unknown instead of converting them to values', () => {
        expect(createUnavailableAdminServer()).toMatchObject({
            name: null,
            sourceState: 'unavailable',
            state: 'unavailable',
            version: null
        });
    });
});

describe('admin dashboard PiggieTV normalization', () => {
    it('normalizes a healthy plugin and uses the build version authority', () => {
        const result = normalizeAdminPtvStatus({
            cacheHealthy: true,
            featuredCacheFresh: true,
            featuredContent: {
                createdAt: NOW - 60_000,
                hasPayload: true,
                heroCount: 3,
                itemCount: 24,
                sectionCount: 6,
                updatedAt: NOW
            },
            ok: true,
            pluginVersion: '2.4.1'
        });

        expect(result).toMatchObject({
            pluginVersion: '2.4.1',
            ptvWebVersion: getPtvBuildInfo().ptvWebVersion,
            severity: 'healthy',
            state: 'healthy',
            featuredContent: {
                heroCount: 3,
                itemCount: 24,
                sectionCount: 6,
                state: 'healthy'
            }
        });
    });

    it('keeps plugin degradation distinct from unreachability', () => {
        expect(normalizeAdminPtvStatus({
            cacheHealthy: false,
            degraded: true,
            error: 'C:\\private\\cache failed',
            ok: false,
            pluginVersion: '2.4.1'
        })).toMatchObject({
            sourceState: 'ready',
            state: 'degraded',
            statusLabel: 'Degraded'
        });

        const unavailable = createUnavailableAdminPtv();
        expect(unavailable).toMatchObject({
            pluginVersion: null,
            sourceState: 'unavailable',
            state: 'unavailable'
        });
        expect(JSON.stringify(unavailable)).not.toContain('private');
    });

    it('warns for an empty featured-content cache without marking the server offline', () => {
        const result = normalizeAdminPtvStatus({
            featuredCacheExists: true,
            featuredCacheFresh: true,
            featuredContent: {
                hasPayload: false,
                heroCount: 0,
                itemCount: 0,
                sectionCount: 0
            },
            ok: true
        });

        expect(result).toMatchObject({
            sourceState: 'ready',
            state: 'degraded',
            featuredContent: {
                heroCount: 0,
                itemCount: 0,
                sectionCount: 0,
                state: 'empty'
            }
        });
    });

    it('preserves missing status fields as unknown', () => {
        expect(normalizeAdminPtvStatus(undefined)).toMatchObject({
            pluginVersion: null,
            state: 'unknown',
            featuredContent: {
                heroCount: null,
                itemCount: null,
                sectionCount: null,
                state: 'unknown'
            }
        });
    });
});

describe('admin dashboard library normalization', () => {
    it('distinguishes a known zero from a failed request', () => {
        expect(normalizeAdminLibraries([])).toMatchObject({
            breakdown: {
                books: 0,
                mixed: 0,
                movies: 0,
                music: 0,
                other: 0,
                shows: 0
            },
            count: 0,
            state: 'empty'
        });
        expect(createUnavailableAdminLibraries()).toMatchObject({
            breakdown: null,
            count: null,
            state: 'unavailable'
        });
    });

    it('counts configured folders from the virtual-folder response only', () => {
        const folders: VirtualFolderInfo[] = [
            { CollectionType: 'movies' },
            { CollectionType: 'tvshows' },
            { CollectionType: 'music' },
            { CollectionType: 'books' },
            { CollectionType: 'homevideos' }
        ];

        expect(normalizeAdminLibraries(folders)).toMatchObject({
            count: 5,
            breakdown: {
                books: 1,
                movies: 1,
                music: 1,
                other: 1,
                shows: 1
            }
        });
    });
});

describe('admin dashboard playback normalization', () => {
    it('filters idle and stopped sessions while keeping paused media active', () => {
        const result = normalizeAdminPlayback([
            { IsActive: true, UserName: 'Idle browser' },
            session(),
            session({
                DeviceName: 'Bedroom TV',
                NowPlayingItem: {
                    IndexNumber: 4,
                    Name: 'The Episode',
                    ParentIndexNumber: 2,
                    RunTimeTicks: 50 * MINUTE_IN_TICKS,
                    SeriesName: 'The Series',
                    Type: 'Episode'
                },
                PlayState: {
                    PlayMethod: 'DirectStream',
                    PositionTicks: 5 * MINUTE_IN_TICKS
                }
            }),
            session({
                DeviceName: 'Office TV',
                NowPlayingItem: {
                    Name: 'Transcoded movie',
                    RunTimeTicks: 90 * MINUTE_IN_TICKS,
                    Type: 'Movie'
                },
                PlayState: {
                    PlayMethod: 'Transcode',
                    PositionTicks: 45 * MINUTE_IN_TICKS
                },
                TranscodingInfo: {
                    Bitrate: 8_000_000,
                    Height: 720
                }
            }),
            session({
                DeviceName: 'Kitchen speaker',
                NowPlayingItem: {
                    Artists: [ 'The Artist' ],
                    Name: 'The Track',
                    RunTimeTicks: 4 * MINUTE_IN_TICKS,
                    Type: 'Audio'
                },
                PlayState: {
                    IsPaused: true,
                    PlayMethod: 'DirectPlay',
                    PositionTicks: MINUTE_IN_TICKS
                }
            }),
            session({ IsActive: false }),
            session({ PlayState: undefined })
        ]);

        expect(result).toMatchObject({
            activeStreamCount: 4,
            directPlayCount: 2,
            directStreamCount: 1,
            transcodeCount: 1,
            unknownMethodCount: 0
        });
        expect(result.sessions[1]).toMatchObject({
            mediaTitle: 'The Series',
            mediaSubtitle: 'S02E04 · The Episode',
            method: 'direct-stream'
        });
        expect(result.sessions[2]).toMatchObject({
            bitrateMbps: 8,
            method: 'transcoding',
            resolution: '720p'
        });
        expect(result.sessions[3]).toMatchObject({
            mediaTitle: 'The Artist',
            mediaSubtitle: 'The Track',
            paused: true,
            statusLabel: 'Paused'
        });
    });

    it('preserves unknown counts after a sessions failure', () => {
        expect(createUnavailableAdminPlayback()).toMatchObject({
            activeStreamCount: null,
            directPlayCount: null,
            sessions: [],
            transcodeCount: null
        });
    });
});

describe('admin dashboard task normalization', () => {
    it('uses real task states and does not classify never-run tasks as failures', () => {
        const recent = new Date(NOW - 60_000).toISOString();
        const old = new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString();
        const result = normalizeAdminTasks([
            task({
                CurrentProgressPercentage: 52.4,
                LastExecutionResult: {
                    StartTimeUtc: new Date(NOW - 24 * 60 * 60 * 1000).toISOString(),
                    Status: 'Completed'
                },
                Name: 'Scan media library',
                State: 'Running'
            }),
            task({
                LastExecutionResult: { EndTimeUtc: recent, Status: 'Failed' },
                Name: 'Failed task'
            }),
            task({
                LastExecutionResult: { EndTimeUtc: recent, Status: 'Cancelled' },
                Name: 'Cancelled task'
            }),
            task({
                LastExecutionResult: { EndTimeUtc: recent, Status: 'Aborted' },
                Name: 'Aborted task'
            }),
            task({
                LastExecutionResult: { EndTimeUtc: old, Status: 'Failed' },
                Name: 'Old failed task'
            }),
            task({ Name: 'Never run task' })
        ], { now: NOW });

        expect(result).toMatchObject({
            abortedRecentlyCount: 1,
            cancelledRecentlyCount: 1,
            failedRecentlyCount: 1,
            runningCount: 1,
            state: 'attention'
        });
        expect(result.recent.map(item => item.state)).toEqual([
            'failed',
            'aborted',
            'running',
            'cancelled'
        ]);
        expect(result.recent.find(item => item.name === 'Never run task')).toBeUndefined();
        expect(result.recent.find(item => item.state === 'running')).toMatchObject({
            progressPercent: 52,
            startedAt: null
        });
    });

    it('preserves unknown counts after a task request failure', () => {
        expect(createUnavailableAdminTasks()).toMatchObject({
            failedRecentlyCount: null,
            recent: [],
            runningCount: null,
            state: 'unavailable'
        });
    });
});

describe('admin dashboard health aggregation', () => {
    it('reports all systems operational from supported healthy signals', () => {
        const sources = healthySources();
        const warnings = buildAdminDashboardWarnings(sources);

        expect(warnings).toEqual([]);
        expect(buildAdminDashboardOverall(sources, warnings)).toMatchObject({
            severity: 'healthy',
            state: 'operational',
            statusLabel: 'All systems operational'
        });
    });

    it('keeps server data healthy when the plugin is unavailable', () => {
        const sources: AdminDashboardSources = {
            ...healthySources(),
            ptv: createUnavailableAdminPtv()
        };
        const warnings = buildAdminDashboardWarnings(sources);

        expect(sources.server.state).toBe('online');
        expect(warnings.some(warning => warning.code === 'ptv-unavailable')).toBe(true);
        expect(buildAdminDashboardOverall(sources, warnings).state).toBe('plugin-unavailable');
    });

    it('reports a server issue without hiding other source summaries', () => {
        const sources: AdminDashboardSources = {
            ...healthySources(),
            server: createUnavailableAdminServer()
        };

        expect(buildAdminDashboardOverall(sources).state).toBe('server-issue');
        expect(sources.libraries.count).toBe(1);
    });
});
