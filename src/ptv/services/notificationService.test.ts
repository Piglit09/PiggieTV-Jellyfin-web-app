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
});
