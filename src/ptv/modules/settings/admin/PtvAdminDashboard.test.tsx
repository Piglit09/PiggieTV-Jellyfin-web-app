import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HashRouter, MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
    AdminDashboardSnapshot,
    AdminDashboardSourceKey,
    AdminPlaybackSession
} from './adminDashboardModel';
import type {
    AdminDashboardQueryState,
    AdminDashboardSourceStates
} from './useAdminDashboard';

const dashboardHookMocks = vi.hoisted(() => ({
    useAdminDashboard: vi.fn()
}));

vi.mock('../../icons/PtvIcon', () => ({
    default: ({ name }: Readonly<{ name: string }>) => <span data-icon={name} />
}));
vi.mock('./useAdminDashboard', () => ({
    useAdminDashboard: dashboardHookMocks.useAdminDashboard
}));
vi.mock('./metadataQuality/AdminMetadataQualityOverviewCard', () => ({
    default: () => <section data-testid='metadata-quality-overview'>Metadata Quality</section>
}));

import PtvAdminDashboard from './PtvAdminDashboard';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

const NOW = Date.parse('2026-08-12T18:00:00.000Z');

function LocationProbe() {
    const location = useLocation();
    return <output data-testid='dashboard-location'>{`${location.pathname}${location.search}`}</output>;
}

const directPlaySession: AdminPlaybackSession = {
    bitrateMbps: null,
    clientName: 'PiggieTV webOS',
    deviceName: 'Living Room TV',
    mediaKind: 'movie',
    mediaSubtitle: null,
    mediaTitle: 'Blade Runner 2049',
    method: 'direct-play',
    methodLabel: 'Direct Play',
    paused: false,
    progressPercent: 41,
    remainingMinutes: 58,
    resolution: '4K',
    statusLabel: 'Playing',
    userName: 'Piggie'
};

function createSnapshot(
    overrides: Partial<AdminDashboardSnapshot> = {}
): AdminDashboardSnapshot {
    return {
        generatedAt: '2026-08-12T18:00:00.000Z',
        libraries: {
            breakdown: {
                books: 1,
                mixed: 0,
                movies: 1,
                music: 1,
                other: 0,
                shows: 1
            },
            count: 4,
            message: 'Libraries are available.',
            severity: 'healthy',
            sourceState: 'ready',
            state: 'available',
            statusLabel: 'Available'
        },
        overall: {
            message: 'All available dashboard signals are healthy.',
            severity: 'healthy',
            state: 'operational',
            statusLabel: 'All systems operational'
        },
        playback: {
            activeStreamCount: 1,
            directPlayCount: 1,
            directStreamCount: 0,
            message: 'One active stream.',
            sessions: [ directPlaySession ],
            severity: 'info',
            sourceState: 'ready',
            state: 'active',
            statusLabel: '1 active',
            transcodeCount: 0,
            unknownMethodCount: 0
        },
        ptv: {
            featuredContent: {
                createdAt: '2026-08-12T17:25:00.000Z',
                expiresAt: '2026-08-12T19:25:00.000Z',
                heroCount: 5,
                itemCount: 86,
                sectionCount: 12,
                severity: 'healthy',
                state: 'healthy',
                statusLabel: 'Healthy',
                updatedAt: '2026-08-12T17:25:00.000Z'
            },
            message: 'PiggieTV plugin is healthy.',
            pluginVersion: '2.4.0',
            ptvWebVersion: '0.5.7',
            refreshInProgress: false,
            severity: 'healthy',
            sourceState: 'ready',
            state: 'healthy',
            statusLabel: 'Healthy'
        },
        server: {
            message: 'Server is online.',
            name: 'Piggie Den',
            operatingSystem: 'Linux',
            severity: 'healthy',
            sourceState: 'ready',
            state: 'online',
            statusLabel: 'Online',
            version: '10.11.11'
        },
        tasks: {
            abortedRecentlyCount: 0,
            cancelledRecentlyCount: 0,
            failedRecentlyCount: 0,
            message: 'Scheduled tasks are healthy.',
            recent: [],
            runningCount: 0,
            severity: 'healthy',
            sourceState: 'ready',
            state: 'available',
            statusLabel: 'Healthy'
        },
        warnings: [],
        ...overrides
    };
}

function createSourceStates(
    overrides: Partial<Record<AdminDashboardSourceKey, Partial<AdminDashboardQueryState>>> = {}
): AdminDashboardSourceStates {
    const state = (source: AdminDashboardSourceKey): AdminDashboardQueryState => ({
        error: false,
        fetching: false,
        loading: false,
        ...overrides[source]
    });

    return {
        libraries: state('libraries'),
        playback: state('playback'),
        ptv: state('ptv'),
        server: state('server'),
        tasks: state('tasks')
    };
}

describe('PiggieTV administration dashboard', () => {
    let container: HTMLDivElement;
    let root: Root;
    let refresh: ReturnType<typeof vi.fn>;
    let retrySource: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.spyOn(Date, 'now').mockReturnValue(NOW);
        refresh = vi.fn(async () => undefined);
        retrySource = vi.fn(async () => undefined);
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        window.history.replaceState(null, '', '/');
        vi.restoreAllMocks();
    });

    function useDashboard(
        snapshot = createSnapshot(),
        sourceStates = createSourceStates(),
        options: Readonly<{ isRefreshing?: boolean }> = {}
    ) {
        dashboardHookMocks.useAdminDashboard.mockReturnValue({
            isInitialLoading: Object.values(sourceStates).every(state => state.loading),
            isRefreshing: options.isRefreshing || false,
            lastUpdatedAt: NOW - 120_000,
            refresh,
            retrySource,
            snapshot,
            sourceStates
        });
    }

    async function renderDashboard() {
        await act(async () => root.render(
            <MemoryRouter>
                <PtvAdminDashboard />
            </MemoryRouter>
        ));
    }

    async function renderHashDashboard() {
        window.history.replaceState(null, '', '/web/#/settings/admin');
        await act(async () => root.render(
            <HashRouter>
                <LocationProbe />
                <PtvAdminDashboard />
            </HashRouter>
        ));
    }

    it('renders the live control-center hierarchy without leaking sensitive response fields', async () => {
        const accessToken = 'access-token-secret-123';
        const remoteEndpoint = '203.0.113.9:8096';
        const userId = 'user-id-42';
        const snapshot = createSnapshot();
        const snapshotWithSensitiveExtras = {
            ...snapshot,
            playback: {
                ...snapshot.playback,
                sessions: snapshot.playback.sessions.map(session => ({
                    ...session,
                    remoteEndpoint,
                    userId
                }))
            },
            server: {
                ...snapshot.server,
                accessToken
            }
        } as unknown as AdminDashboardSnapshot;
        useDashboard(snapshotWithSensitiveExtras);

        await renderDashboard();

        expect(container.querySelector('h1')?.textContent).toBe('PiggieTV Administration');
        expect(container.textContent).toContain('All systems operational');
        expect(container.textContent).toContain('Piggie Den');
        expect(container.textContent).toContain('10.11.11');
        expect(container.textContent).toContain('PTV Web');
        expect(container.textContent).toContain('0.5.7');
        expect(container.textContent).toContain('2.4.0');
        expect(container.textContent).toContain('12 sections');
        expect(container.textContent).toContain('4');
        expect(container.textContent).toContain('1 Movies · 1 Shows · 1 Music · 1 Reading');
        expect(container.textContent).toContain('Active Now');
        expect(container.textContent).toContain('Scheduled Tasks');
        expect(container.textContent).toContain('Attention');
        expect(container.textContent).toContain('Management');
        expect(container.textContent).not.toContain(accessToken);
        expect(container.textContent).not.toContain(remoteEndpoint);
        expect(container.textContent).not.toContain(userId);
        expect(container.innerHTML).not.toContain(accessToken);
    });

    it('renders every management category launcher from the shared registry', async () => {
        useDashboard();
        await renderDashboard();

        const links = Array.from(container.querySelectorAll('.ptv-admin-management-link'))
            .map(link => ({
                href: link.getAttribute('href'),
                label: link.querySelector('strong')?.textContent
            }));

        expect(links).toEqual([
            { href: '/settings/admin?section=piggietv', label: 'PiggieTV' },
            { href: '/settings/admin?section=people', label: 'People' },
            { href: '/settings/admin?section=media', label: 'Media' },
            { href: '/settings/admin/playback', label: 'Playback' },
            { href: '/settings/admin?section=livetv', label: 'Live TV' },
            { href: '/settings/admin/plugins', label: 'Plugins' },
            { href: '/settings/admin?section=server', label: 'Server' }
        ]);
    });

    it('keeps the plugin workspace action inside the client router', async () => {
        useDashboard();
        await renderHashDashboard();

        const pluginWorkspace = Array.from(container.querySelectorAll<HTMLAnchorElement>('a'))
            .find(link => link.textContent?.includes('Plugin workspace'));

        expect(pluginWorkspace?.getAttribute('href')).toBe('#/settings/admin/piggietv');

        await act(async () => pluginWorkspace?.click());

        expect(container.querySelector('[data-testid="dashboard-location"]')?.textContent)
            .toBe('/settings/admin/piggietv');
        expect(window.location.pathname).toBe('/web/');
        expect(window.location.hash).toBe('#/settings/admin/piggietv');
    });

    it('keeps server data visible when PTV status is unavailable and retries only the plugin', async () => {
        const base = createSnapshot();
        useDashboard(createSnapshot({
            overall: {
                message: 'PTV plugin status is unavailable.',
                severity: 'warning',
                state: 'plugin-unavailable',
                statusLabel: 'PTV plugin unavailable'
            },
            ptv: {
                ...base.ptv,
                featuredContent: {
                    ...base.ptv.featuredContent,
                    heroCount: null,
                    itemCount: null,
                    sectionCount: null,
                    severity: 'unknown',
                    state: 'unavailable',
                    statusLabel: 'Unavailable',
                    updatedAt: null
                },
                pluginVersion: null,
                severity: 'error',
                sourceState: 'unavailable',
                state: 'unavailable',
                statusLabel: 'Unavailable'
            },
            warnings: [{
                code: 'ptv-unavailable',
                message: 'PTV Plugin status is temporarily unavailable.',
                severity: 'error',
                source: 'ptv',
                title: 'PTV plugin unavailable'
            }]
        }), createSourceStates({ ptv: { error: true } }));

        await renderDashboard();

        expect(container.textContent).toContain('Piggie Den');
        expect(container.textContent).toContain('10.11.11');
        expect(container.textContent).toContain('PTV plugin unavailable');
        const retry = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent === 'Retry plugin');
        expect(retry).toBeDefined();

        await act(async () => retry?.click());
        expect(retrySource).toHaveBeenCalledOnce();
        expect(retrySource).toHaveBeenCalledWith('ptv');
    });

    it('keeps scheduled tasks usable when session loading fails', async () => {
        const base = createSnapshot();
        useDashboard(createSnapshot({
            playback: {
                ...base.playback,
                activeStreamCount: null,
                directPlayCount: null,
                directStreamCount: null,
                sessions: [],
                severity: 'unknown',
                sourceState: 'unavailable',
                state: 'unavailable',
                statusLabel: 'Unavailable',
                transcodeCount: null,
                unknownMethodCount: null
            },
            tasks: {
                ...base.tasks,
                recent: [{
                    completedAt: null,
                    name: 'Scan Media Library',
                    progressPercent: 36,
                    severity: 'info',
                    startedAt: '2026-08-12T17:55:00.000Z',
                    state: 'running',
                    statusLabel: 'Running'
                }],
                runningCount: 1,
                statusLabel: 'Running'
            }
        }), createSourceStates({ playback: { error: true } }));

        await renderDashboard();

        expect(container.textContent).toContain('Playback activity is unavailable.');
        expect(container.textContent).toContain('Scan Media Library');
        expect(container.textContent).toContain('1 running');
        expect(container.textContent).toContain('Running now');
        expect(container.textContent).not.toContain('Started ');
        expect(container.querySelector('a[href="/settings/admin/tasks"]')?.textContent).toContain('View Tasks');
        expect(Array.from(container.querySelectorAll('button'))
            .some(button => button.textContent === 'Retry sessions')).toBe(true);
    });

    it('uses a lightweight empty state when no one is streaming', async () => {
        const base = createSnapshot();
        useDashboard(createSnapshot({
            playback: {
                ...base.playback,
                activeStreamCount: 0,
                directPlayCount: 0,
                directStreamCount: 0,
                sessions: [],
                severity: 'healthy',
                state: 'idle',
                statusLabel: 'Idle',
                transcodeCount: 0,
                unknownMethodCount: 0
            }
        }));

        await renderDashboard();

        expect(container.textContent).toContain('No one is streaming right now.');
        expect(container.textContent).toContain('Active and paused playback sessions will appear here.');
        expect(container.querySelector('[aria-label="Currently playing sessions"]')).toBeNull();
    });

    it('shows friendly media, paused state, direct stream and transcoding labels for active sessions', async () => {
        const base = createSnapshot();
        const sessions: readonly AdminPlaybackSession[] = [
            directPlaySession,
            {
                bitrateMbps: null,
                clientName: 'PiggieTV Android TV',
                deviceName: 'Bedroom TV',
                mediaKind: 'episode',
                mediaSubtitle: 'S01E03 · The Head',
                mediaTitle: 'Fallout',
                method: 'direct-stream',
                methodLabel: 'Direct Stream',
                paused: true,
                progressPercent: 63,
                remainingMinutes: 22,
                resolution: '1080p',
                statusLabel: 'Paused',
                userName: 'Alex'
            },
            {
                bitrateMbps: 8,
                clientName: 'Chrome',
                deviceName: 'Office PC',
                mediaKind: 'music',
                mediaSubtitle: 'M83',
                mediaTitle: 'Midnight City',
                method: 'transcoding',
                methodLabel: 'Transcoding',
                paused: false,
                progressPercent: null,
                remainingMinutes: null,
                resolution: '1080p → 720p',
                statusLabel: 'Playing',
                userName: null
            }
        ];
        useDashboard(createSnapshot({
            playback: {
                ...base.playback,
                activeStreamCount: 3,
                directPlayCount: 1,
                directStreamCount: 1,
                sessions,
                statusLabel: '3 active',
                transcodeCount: 1,
                unknownMethodCount: 0
            }
        }));

        await renderDashboard();

        expect(container.textContent).toContain('Blade Runner 2049');
        expect(container.textContent).toContain('Fallout');
        expect(container.textContent).toContain('S01E03 · The Head');
        expect(container.textContent).toContain('Midnight City');
        expect(container.textContent).toContain('M83');
        expect(container.textContent).toContain('Direct Play');
        expect(container.textContent).toContain('Direct Stream');
        expect(container.textContent).toContain('Transcoding');
        expect(container.textContent).toContain('Paused');
        expect(container.textContent).toContain('1080p → 720p · 8 Mbps');
        expect(container.textContent).toContain('User unavailable');
    });

    it('does not convert unknown summary values into misleading zero metrics', async () => {
        const base = createSnapshot();
        useDashboard(createSnapshot({
            libraries: {
                ...base.libraries,
                breakdown: null,
                count: null,
                severity: 'unknown',
                sourceState: 'unavailable',
                state: 'unavailable',
                statusLabel: 'Unavailable'
            },
            playback: {
                ...base.playback,
                activeStreamCount: null,
                directPlayCount: null,
                directStreamCount: null,
                sessions: [],
                severity: 'unknown',
                sourceState: 'unavailable',
                state: 'unavailable',
                statusLabel: 'Unavailable',
                transcodeCount: null,
                unknownMethodCount: null
            },
            tasks: {
                ...base.tasks,
                abortedRecentlyCount: null,
                cancelledRecentlyCount: null,
                failedRecentlyCount: null,
                runningCount: null,
                severity: 'unknown',
                sourceState: 'unavailable',
                state: 'unavailable',
                statusLabel: 'Unavailable'
            }
        }));

        await renderDashboard();

        expect(container.querySelectorAll('.ptv-admin-card-metric')).toHaveLength(0);
        expect(container.textContent).not.toContain('0 libraries');
        expect(container.textContent).not.toContain('0 streams');
        expect(container.textContent).not.toContain('0 running');
        expect(container.textContent).not.toContain('0 failed');
    });

    it('renders independent skeletons for each loading dashboard source', async () => {
        useDashboard(createSnapshot(), createSourceStates({
            libraries: { loading: true },
            playback: { loading: true },
            ptv: { loading: true },
            server: { loading: true },
            tasks: { loading: true }
        }));

        await renderDashboard();

        const loadingLabels = Array.from(container.querySelectorAll('[aria-busy="true"]'))
            .map(element => element.getAttribute('aria-label'));
        expect(loadingLabels).toEqual([
            'Loading server status',
            'Loading PTV plugin status',
            'Loading library status',
            'Loading active streams',
            'Loading active sessions',
            'Loading scheduled tasks'
        ]);
        expect(container.textContent).toContain('Checking system health');
    });

    it('runs the coordinated in-place refresh from the dashboard header', async () => {
        useDashboard();
        await renderDashboard();

        const button = container.querySelector<HTMLButtonElement>(
            'button[aria-label="Refresh administration dashboard"]'
        );
        expect(button?.disabled).toBe(false);

        await act(async () => button?.click());
        expect(refresh).toHaveBeenCalledOnce();
    });
});
