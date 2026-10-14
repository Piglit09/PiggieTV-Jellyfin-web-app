import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calendarMocks = vi.hoisted(() => ({
    captureRouteCriticalOwner: vi.fn(() => ({
        lifecycleId: 'calendar-critical-1',
        navigationKey: '/calendar',
        routeFamily: 'calendar',
        routeGeneration: 1,
        routeKey: 'calendar-route-key'
    })),
    getArrCalendar: vi.fn(),
    recordRouteCriticalPending: vi.fn(),
    recordRouteCriticalTerminal: vi.fn()
}));

vi.mock('components/Page', () => ({
    default: ({ children, title }: { children: React.ReactNode; title: string }) => (
        <main data-page-title={title}>{children}</main>
    )
}));

vi.mock('../../shell/PTVShell', () => ({
    default: ({ children, section, showBackButton, title }: {
        children: React.ReactNode;
        section: string;
        showBackButton: boolean;
        title: string;
    }) => (
        <div data-shell-section={section} data-show-back-button={String(showBackButton)} data-shell-title={title}>
            {children}
        </div>
    )
}));

vi.mock('../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: () => ({
        getArrCalendar: calendarMocks.getArrCalendar
    }),
    normalizePtvApiError: (error: unknown) => ({
        message: error instanceof Error ? error.message : 'Release calendar could not be loaded.'
    })
}));

vi.mock('../../shell/routeCriticalLifecycle', () => ({
    capturePtvRouteCriticalLifecycleOwner: calendarMocks.captureRouteCriticalOwner,
    recordPtvRouteCriticalPending: calendarMocks.recordRouteCriticalPending,
    recordPtvRouteCriticalTerminal: calendarMocks.recordRouteCriticalTerminal
}));

import PiggieTvCalendarPage, {
    groupCalendarItems,
    isHealthyCalendarService
} from './PiggieTvCalendarPage';

function calendarResponse(overrides: Record<string, unknown> = {}) {
    return {
        enabled: true,
        end: '2026-10-14',
        itemCount: 1,
        items: [{
            date: '2026-08-30T00:30:00Z',
            id: 'sonarr-1',
            service: 'sonarr',
            title: 'Verified Episode'
        }],
        ok: true,
        services: [{
            configured: true,
            enabled: true,
            itemCount: 1,
            service: 'sonarr',
            statusCode: 200,
            supported: true
        }],
        start: '2026-08-23',
        ...overrides
    };
}

describe('Release Calendar lifecycle', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
        calendarMocks.getArrCalendar.mockReset();
        calendarMocks.captureRouteCriticalOwner.mockClear();
        calendarMocks.recordRouteCriticalPending.mockClear();
        calendarMocks.recordRouteCriticalTerminal.mockClear();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        window.location.hash = '';
        Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', false);
    });

    async function renderCalendar() {
        await act(async () => {
            root.render(<PiggieTvCalendarPage />);
            await Promise.resolve();
        });
    }

    it('keeps shared navigation and a safe Home exit on direct Calendar entry', async () => {
        calendarMocks.getArrCalendar.mockResolvedValue(calendarResponse({
            items: [],
            services: []
        }));
        window.location.hash = '#/calendar';

        await renderCalendar();

        const shell = container.querySelector<HTMLElement>('[data-shell-section="request"]');
        expect(shell?.getAttribute('data-show-back-button')).toBe('true');
        expect(shell?.getAttribute('data-shell-title')).toBe('Release Calendar');
        expect(container.textContent).toContain('0 releases');
    });

    it('loads a bounded range and reaches a healthy terminal state', async () => {
        calendarMocks.getArrCalendar.mockResolvedValue(calendarResponse());

        await renderCalendar();

        expect(calendarMocks.getArrCalendar).toHaveBeenCalledWith(expect.objectContaining({
            params: { daysAfter: 45, daysBefore: 7 },
            signal: expect.any(AbortSignal)
        }));
        expect(container.textContent).toContain('1 active services');
        expect(container.textContent).toContain('1 releases');
        expect(container.textContent).toContain('healthy');
        expect(container.textContent).toContain('Verified Episode');
        expect(container.textContent).not.toContain('Refreshing...');
        expect(calendarMocks.recordRouteCriticalPending).toHaveBeenCalledTimes(1);
        expect(calendarMocks.recordRouteCriticalTerminal).toHaveBeenCalledWith(
            expect.objectContaining({ lifecycleId: 'calendar-critical-1' }),
            'success'
        );
    });

    it('keeps healthy data when another configured provider fails', async () => {
        const privateUrl = 'https://private-radarr.invalid/calendar';
        calendarMocks.getArrCalendar.mockResolvedValue(calendarResponse({
            services: [
                {
                    configured: true,
                    enabled: true,
                    itemCount: 1,
                    service: 'sonarr',
                    statusCode: 200,
                    supported: true
                },
                {
                    configured: true,
                    enabled: true,
                    error: `401 from ${privateUrl}`,
                    itemCount: 0,
                    service: 'radarr',
                    statusCode: 401,
                    supported: true
                }
            ]
        }));

        await renderCalendar();

        expect(container.textContent).toContain('1 active services');
        expect(container.textContent).toContain('Verified Episode');
        expect(container.textContent).toContain('degraded');
        expect(container.textContent).toContain('Authentication failed. Check the saved API key.');
        expect(container.textContent).toContain('Some calendar providers returned warnings.');
        expect(container.textContent).not.toContain(privateUrl);
        expect(calendarMocks.recordRouteCriticalTerminal).toHaveBeenLastCalledWith(
            expect.anything(),
            'partial'
        );
    });

    it('distinguishes configured provider failure from missing configuration', async () => {
        calendarMocks.getArrCalendar.mockResolvedValue(calendarResponse({
            enabled: true,
            itemCount: 0,
            items: [],
            services: [{
                configured: true,
                enabled: true,
                error: 'The operation timed out.',
                itemCount: 0,
                service: 'lidarr',
                statusCode: null,
                supported: true
            }]
        }));

        await renderCalendar();

        expect(container.textContent).toContain('0 active services');
        expect(container.textContent).toContain('Configured calendar providers are currently unavailable.');
        expect(container.textContent).not.toContain('Configure and save a Sonarr');
        expect(container.textContent).toContain('The service timed out.');
        expect(calendarMocks.recordRouteCriticalTerminal).toHaveBeenLastCalledWith(
            expect.anything(),
            'failed'
        );
    });

    it('shows setup guidance only when no supported provider is configured', async () => {
        calendarMocks.getArrCalendar.mockResolvedValue(calendarResponse({
            enabled: false,
            itemCount: 0,
            items: [],
            services: [{
                configured: false,
                enabled: false,
                itemCount: 0,
                service: 'sonarr',
                supported: true
            }]
        }));

        await renderCalendar();

        expect(container.textContent).toContain('Configure and save a Sonarr, Radarr, or Lidarr API key');
        expect(container.textContent).not.toContain('Configured calendar providers are currently unavailable.');
        expect(calendarMocks.recordRouteCriticalTerminal).toHaveBeenLastCalledWith(
            expect.anything(),
            'empty'
        );
    });

    it('does not report an intentionally unsupported Prowlarr adapter as a provider failure', async () => {
        calendarMocks.getArrCalendar.mockResolvedValue(calendarResponse({
            services: [
                {
                    configured: true,
                    enabled: true,
                    itemCount: 1,
                    service: 'sonarr',
                    statusCode: 200,
                    supported: true
                },
                {
                    configured: true,
                    enabled: true,
                    error: 'Prowlarr does not expose a media release calendar.',
                    itemCount: 0,
                    service: 'prowlarr',
                    supported: false
                }
            ]
        }));

        await renderCalendar();

        expect(container.textContent).toContain('No calendar adapter');
        expect(container.textContent).not.toContain('Some calendar providers returned warnings.');
        expect(container.textContent).not.toContain('The service calendar could not be loaded.');
    });

    it('does not report intentionally unconfigured supported providers as partial failures', async () => {
        calendarMocks.getArrCalendar.mockResolvedValue(calendarResponse({
            services: [
                {
                    configured: true,
                    enabled: true,
                    itemCount: 1,
                    service: 'sonarr',
                    statusCode: 200,
                    supported: true
                },
                {
                    configured: false,
                    enabled: false,
                    error: 'radarr API key is not configured.',
                    itemCount: 0,
                    service: 'radarr',
                    supported: true
                },
                {
                    configured: false,
                    enabled: false,
                    error: 'lidarr integration is disabled.',
                    itemCount: 0,
                    service: 'lidarr',
                    supported: true
                }
            ]
        }));

        await renderCalendar();

        expect(container.textContent).toContain('1 active services');
        expect(container.textContent).toContain('Verified Episode');
        expect(container.textContent).not.toContain('Some calendar providers returned warnings.');
        expect(container.textContent).not.toContain('The service calendar could not be loaded.');
    });

    it('returns the UI to a usable state after a Plugin or network failure', async () => {
        calendarMocks.getArrCalendar.mockRejectedValue(new Error('Plugin unavailable'));

        await renderCalendar();

        expect(container.textContent).toContain('Plugin unavailable');
        const refreshButton = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent === 'Refresh');
        expect(refreshButton?.disabled).toBe(false);
        expect(calendarMocks.recordRouteCriticalTerminal).toHaveBeenLastCalledWith(
            expect.anything(),
            'failed'
        );
    });

    it('deduplicates repeated refresh attempts while a request is pending', async () => {
        let resolveRequest: ((value: unknown) => void) | undefined;
        calendarMocks.getArrCalendar.mockReturnValue(new Promise(resolve => {
            resolveRequest = resolve;
        }));

        await act(async () => {
            root.render(<PiggieTvCalendarPage />);
            await Promise.resolve();
        });
        const refreshButton = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent === 'Refreshing...');

        refreshButton?.click();
        refreshButton?.click();
        expect(calendarMocks.getArrCalendar).toHaveBeenCalledTimes(1);

        await act(async () => {
            resolveRequest?.(calendarResponse());
            await Promise.resolve();
        });
    });

    it('aborts in-flight work and suppresses stale settlement after unmount', async () => {
        calendarMocks.getArrCalendar.mockReturnValue(new Promise(() => undefined));

        await act(async () => {
            root.render(<PiggieTvCalendarPage />);
            await Promise.resolve();
        });
        const signal = calendarMocks.getArrCalendar.mock.calls[0]?.[0]?.signal as AbortSignal;

        act(() => root.unmount());
        expect(signal.aborted).toBe(true);
        expect(calendarMocks.recordRouteCriticalTerminal).toHaveBeenLastCalledWith(
            expect.anything(),
            'cancelled'
        );
        root = createRoot(container);
    });
});

describe('Release Calendar normalization', () => {
    it('counts only configured providers with a successful terminal result as healthy', () => {
        expect(isHealthyCalendarService({
            configured: true,
            enabled: true,
            service: 'sonarr',
            statusCode: 200,
            supported: true
        })).toBe(true);
        expect(isHealthyCalendarService({
            configured: true,
            enabled: true,
            error: 'failed',
            service: 'radarr',
            statusCode: 401,
            supported: true
        })).toBe(false);
    });

    it('groups timestamps by the same local day used for display and preserves date-only values', () => {
        const timestamp = '2026-08-30T00:30:00Z';
        const parsed = new Date(timestamp);
        const expectedLocalKey = [
            parsed.getFullYear(),
            String(parsed.getMonth() + 1).padStart(2, '0'),
            String(parsed.getDate()).padStart(2, '0')
        ].join('-');
        const groups = groupCalendarItems([
            { date: timestamp, id: 'timestamp', service: 'sonarr', title: 'Timestamp' },
            { date: '2026-09-01', id: 'date-only', service: 'radarr', title: 'Date only' }
        ]);

        expect(groups.map(group => group.key)).toContain(expectedLocalKey);
        expect(groups.map(group => group.key)).toContain('2026-09-01');
    });

    it('orders day groups by their rendered local date rather than provider sort order', () => {
        const groups = groupCalendarItems([
            {
                date: '2026-09-02',
                id: 'later-local-day',
                service: 'radarr',
                sortDate: '2026-09-01',
                title: 'Later local day'
            },
            {
                date: '2026-09-01',
                id: 'earlier-local-day',
                service: 'sonarr',
                sortDate: '2026-09-02',
                title: 'Earlier local day'
            }
        ]);

        expect(groups.map(group => group.key)).toEqual([
            '2026-09-01',
            '2026-09-02'
        ]);
    });
});
