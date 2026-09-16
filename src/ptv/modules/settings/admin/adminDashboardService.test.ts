import type { Api } from '@jellyfin/sdk';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: vi.fn(() => null)
}));

import {
    normalizeAdminLibraries,
    normalizeAdminPlayback,
    normalizeAdminPtvStatus,
    normalizeAdminServer,
    normalizeAdminTasks
} from './adminDashboardAdapters';
import {
    loadAdminDashboard,
    loadAdminPtv,
    type AdminDashboardLoaders,
    type AdminPtvApiClient
} from './adminDashboardService';

const api = {} as Api;
const NOW = Date.UTC(2026, 7, 12, 12, 0, 0);

function createSuccessfulLoaders(): AdminDashboardLoaders {
    return {
        libraries: vi.fn(async () => normalizeAdminLibraries([ { CollectionType: 'movies' } ])),
        playback: vi.fn(async () => normalizeAdminPlayback([])),
        ptv: vi.fn(async () => normalizeAdminPtvStatus({
            featuredCacheFresh: true,
            featuredContent: {
                hasPayload: true,
                heroCount: 1,
                itemCount: 10,
                sectionCount: 2
            },
            ok: true,
            pluginVersion: '2.0.0'
        })),
        server: vi.fn(async () => normalizeAdminServer({
            ServerName: 'Piggie Server',
            Version: '10.11.11'
        })),
        tasks: vi.fn(async () => normalizeAdminTasks([], { now: NOW }))
    };
}

describe('loadAdminDashboard', () => {
    it('keeps successful server data when PTV status fails', async () => {
        const successfulLoaders = createSuccessfulLoaders();
        const loaders: AdminDashboardLoaders = {
            ...successfulLoaders,
            ptv: vi.fn(async () => {
                throw new Error('private transport details');
            })
        };
        const logger = vi.fn();

        const result = await loadAdminDashboard(api, {
            loaders,
            logger,
            now: NOW,
            ptvApiClient: null
        });

        expect(result.server).toMatchObject({
            name: 'Piggie Server',
            state: 'online'
        });
        expect(result.ptv.state).toBe('unavailable');
        expect(result.libraries.count).toBe(1);
        expect(result.overall.state).toBe('plugin-unavailable');
        expect(logger).toHaveBeenCalledWith('[PiggieTV Administration] PTV status request failed.');
        expect(JSON.stringify(logger.mock.calls)).not.toContain('private transport details');
    });

    it('keeps task health usable when sessions fail', async () => {
        const successfulLoaders = createSuccessfulLoaders();
        const loaders: AdminDashboardLoaders = {
            ...successfulLoaders,
            playback: vi.fn(async () => {
                throw new Error('sessions failed');
            })
        };

        const result = await loadAdminDashboard(api, {
            loaders,
            logger: vi.fn(),
            now: NOW,
            ptvApiClient: null
        });

        expect(result.playback).toMatchObject({
            activeStreamCount: null,
            state: 'unavailable'
        });
        expect(result.tasks).toMatchObject({
            failedRecentlyCount: 0,
            runningCount: 0,
            state: 'available'
        });
        expect(result.warnings.some(warning => warning.code === 'sessions-unavailable')).toBe(true);
    });

    it('starts every dashboard source and forwards the PTV cache bypass option', async () => {
        const loaders = createSuccessfulLoaders();

        await loadAdminDashboard(api, {
            bypassPtvCache: true,
            loaders,
            now: NOW,
            ptvApiClient: null
        });

        expect(loaders.server).toHaveBeenCalledOnce();
        expect(loaders.libraries).toHaveBeenCalledOnce();
        expect(loaders.playback).toHaveBeenCalledOnce();
        expect(loaders.tasks).toHaveBeenCalledOnce();
        expect(loaders.ptv).toHaveBeenCalledWith(null, undefined, true);
    });

    it('rejects an already-aborted coordinated load without starting requests', async () => {
        // AbortController is polyfilled by the production browser bundle.
        // eslint-disable-next-line compat/compat
        const controller = new AbortController();
        const loaders = createSuccessfulLoaders();
        controller.abort();

        await expect(loadAdminDashboard(api, {
            loaders,
            signal: controller.signal
        })).rejects.toMatchObject({ name: 'AbortError' });
        expect(loaders.server).not.toHaveBeenCalled();
    });
});

describe('loadAdminPtv', () => {
    it('requests observational full status and supports a cache bypass', async () => {
        const getStatus = vi.fn(async () => ({
            featuredContent: { hasPayload: true },
            ok: true
        }));
        const apiClient = { getStatus } as unknown as AdminPtvApiClient;
        // AbortController is polyfilled by the production browser bundle.
        // eslint-disable-next-line compat/compat
        const controller = new AbortController();

        const result = await loadAdminPtv(apiClient, controller.signal, true);

        expect(getStatus).toHaveBeenCalledWith({
            bypassCache: true,
            params: { full: true },
            signal: controller.signal
        });
        expect(result.sourceState).toBe('ready');
    });

    it('rejects when no authenticated plugin client is available', async () => {
        await expect(loadAdminPtv(null)).rejects.toThrow('plugin API client is unavailable');
    });
});
