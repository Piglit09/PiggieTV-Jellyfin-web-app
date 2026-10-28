import { beforeEach, describe, expect, it, vi } from 'vitest';

const identityMocks = vi.hoisted(() => ({
    client: null as null | {
        getCurrentUserId: () => string;
        serverId: () => string;
        serverInfo: () => { Id: string };
    }
}));

vi.mock('../core/observability', () => ({
    recordPtvEvent: vi.fn()
}));

vi.mock('../api/client', () => ({
    getCurrentPtvApiClient: () => identityMocks.client
}));

function setCurrentIdentity(serverId: string, userId: string) {
    identityMocks.client = {
        getCurrentUserId: () => userId,
        serverId: () => serverId,
        serverInfo: () => ({ Id: serverId })
    };
}

async function loadNotificationService() {
    vi.resetModules();
    window.localStorage.clear();
    setCurrentIdentity('server-a', 'user-a');

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
        if (!repeatedNotification) throw new Error('Expected authenticated notification');

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
        if (!notification) throw new Error('Expected authenticated notification');

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
        const stored = window.localStorage.getItem('ptv:notifications:v2:server-a%3Auser-a') || '';

        expect(snapshot).not.toContain(accessCanary);
        expect(stored).not.toContain(accessCanary);
        expect(snapshot).toContain('[REDACTED]');
        expect(notification.technicalDetails).toContain('"tokenCount": 6');
    });

    it('preserves but never displays legacy notifications without a user and server scope', async () => {
        const service = await loadNotificationService();
        const legacy = JSON.stringify([ {
            id: 'legacy',
            source: 'music',
            title: 'Private title from another account'
        } ]);
        window.localStorage.setItem('ptv:notifications:v1', legacy);
        vi.resetModules();
        const reloaded = await import('./notificationService');

        expect(reloaded.getPtvNotificationSnapshot('server-a:user-a').notifications).toEqual([]);
        expect(window.localStorage.getItem('ptv:notifications:v1')).toBe(legacy);
        expect(service.getPtvNotificationSnapshot('server-a:user-a').notifications).toEqual([]);
    });

    it('keeps notification titles and persisted state within the exact current identity', async () => {
        const service = await loadNotificationService();
        service.addPtvNotification({ source: 'music', title: 'User A private album' });

        setCurrentIdentity('server-a', 'user-b');
        expect(service.getPtvNotificationSnapshot('server-a:user-b').notifications).toEqual([]);
        expect(service.getPtvNotificationSnapshot('server-a:user-a').notifications).toEqual([]);
        service.addPtvNotification({ source: 'music', title: 'User B private album' });

        setCurrentIdentity('server-b', 'user-a');
        expect(service.getPtvNotificationSnapshot('server-b:user-a').notifications).toEqual([]);

        setCurrentIdentity('server-a', 'user-a');
        expect(service.getPtvNotificationSnapshot('server-a:user-a').notifications.map(item => item.title))
            .toEqual([ 'User A private album' ]);
    });

    it('does not hydrate another user\'s stored notices on a fresh module load', async () => {
        const service = await loadNotificationService();
        service.addPtvNotification({ source: 'reading', title: 'User A private book' });

        setCurrentIdentity('server-a', 'user-b');
        vi.resetModules();
        const reloaded = await import('./notificationService');

        expect(reloaded.getPtvNotificationSnapshot('server-a:user-b').notifications).toEqual([]);

        setCurrentIdentity('server-a', 'user-a');
        expect(reloaded.getPtvNotificationSnapshot('server-a:user-a').notifications.map(item => item.title))
            .toEqual([ 'User A private book' ]);
    });

    it('fails closed without a canonical identity and rejects conflicting client server IDs', async () => {
        const service = await loadNotificationService();
        identityMocks.client = null;
        expect(service.addPtvNotification({ source: 'music', title: 'Unbound secret' })).toBeNull();
        expect(service.getPtvNotificationSnapshot('server-a:user-a').notifications).toEqual([]);

        identityMocks.client = {
            getCurrentUserId: () => 'user-a',
            serverId: () => 'server-a',
            serverInfo: () => ({ Id: 'server-b' })
        };
        expect(service.getPtvNotificationSnapshot('server-a:user-a').notifications).toEqual([]);
        expect(window.localStorage.length).toBe(0);
    });

    it('does not treat an explicitly empty shell identity as a request for current notices', async () => {
        const service = await loadNotificationService();
        service.addPtvNotification({ source: 'music', title: 'User A private album' });
        const snapshots: string[][] = [];

        service.subscribePtvNotifications(snapshot => {
            snapshots.push(snapshot.notifications.map(item => item.title));
        }, '');

        expect(service.getPtvNotificationSnapshot('').notifications).toEqual([]);
        expect(snapshots).toEqual([ [] ]);
    });

    it('does not let an old subscription or retry handler act in a different identity', async () => {
        const service = await loadNotificationService();
        const retry = vi.fn();
        const oldNotice = service.addPtvNotification({
            onRetry: retry,
            source: 'music',
            title: 'User A private retry'
        });
        expect(oldNotice).not.toBeNull();
        if (!oldNotice) throw new Error('Expected authenticated notification');
        const oldSnapshots: string[][] = [];
        const unsubscribe = service.subscribePtvNotifications(snapshot => {
            oldSnapshots.push(snapshot.notifications.map(item => item.title));
        }, 'server-a:user-a');

        setCurrentIdentity('server-a', 'user-b');
        service.addPtvNotification({ source: 'music', title: 'User B private notice' });

        expect(oldSnapshots.at(-1)).toEqual([]);
        expect(service.hasPtvNotificationRetryHandler(oldNotice)).toBe(false);
        expect(await service.runPtvNotificationRetry(oldNotice)).toBe(false);
        expect(retry).not.toHaveBeenCalled();
        unsubscribe();
    });
});
