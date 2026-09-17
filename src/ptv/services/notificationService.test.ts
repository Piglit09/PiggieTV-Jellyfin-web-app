import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../core/observability', () => ({
    recordPtvEvent: vi.fn()
}));

async function loadNotificationService() {
    vi.resetModules();
    window.localStorage.clear();

    return import('./notificationService');
}

describe('notificationService', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('deduplicates repeated notifications and keeps the latest retry handler', async () => {
        const service = await loadNotificationService();
        const firstRetry = vi.fn();
        const latestRetry = vi.fn();

        service.addPtvNotification({
            dedupeKey: 'shelf:latest',
            message: 'The rest of the page is still available.',
            onRetry: firstRetry,
            source: 'ptv',
            title: 'Unable to load one recommendation shelf.',
            type: 'warning'
        });
        const repeatedNotification = service.addPtvNotification({
            dedupeKey: 'shelf:latest',
            message: 'The rest of the page is still available.',
            onRetry: latestRetry,
            source: 'ptv',
            title: 'Unable to load one recommendation shelf.',
            type: 'warning'
        });

        expect(service.getPtvNotificationSnapshot()).toMatchObject({
            duplicateSuppressionCount: 1,
            totalCount: 1,
            unreadCount: 1
        });
        expect(repeatedNotification.occurrenceCount).toBe(2);

        await service.runPtvNotificationRetry(repeatedNotification);

        expect(firstRetry).not.toHaveBeenCalled();
        expect(latestRetry).toHaveBeenCalledTimes(1);
        expect(service.getPtvNotificationSnapshot().unreadCount).toBe(0);
    });

    it('marks and clears dismissible notifications', async () => {
        const service = await loadNotificationService();
        const notification = service.addPtvNotification({
            source: 'music',
            title: 'Music library loaded.',
            type: 'success'
        });

        service.markPtvNotificationRead(notification.id);

        expect(service.getPtvNotificationSnapshot().unreadCount).toBe(0);

        service.dismissPtvNotification(notification.id);

        expect(service.getPtvNotificationSnapshot().totalCount).toBe(0);
    });

    it('sanitizes credential-bearing diagnostics before memory and local storage retention', async () => {
        const service = await loadNotificationService();
        const accessCanary = [ 'PTV_TEST', 'ACCESS_TOKEN', 'notification' ].join('_');

        service.addPtvNotification({
            message: `Request failed?api_key=${accessCanary}`,
            route: `#/quickconnect?code=${accessCanary}`,
            source: 'request',
            technicalDetails: {
                config: {
                    // eslint-disable-next-line compat/compat -- Native header sanitization is the behavior under test.
                    headers: new Headers({ 'X-Api-Key': accessCanary })
                },
                tokenCount: 6
            },
            title: 'Authenticated request failed',
            type: 'error'
        });

        const notification = service.getPtvNotificationSnapshot().notifications[0];
        const snapshot = JSON.stringify(service.getPtvNotificationSnapshot());
        const stored = window.localStorage.getItem('ptv:notifications:v1') || '';

        expect(snapshot).not.toContain(accessCanary);
        expect(stored).not.toContain(accessCanary);
        expect(snapshot).toContain('[REDACTED]');
        expect(notification.technicalDetails).toContain('"tokenCount": 6');
    });
});
