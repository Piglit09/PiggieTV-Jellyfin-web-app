import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actEnvironment = globalThis as typeof globalThis & {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};

const accessState = vi.hoisted(() => ({
    collections: true,
    identityKey: 'server-a:user-a'
}));

vi.mock('react-router-dom', () => ({
    useLocation: () => ({ pathname: '/collections', search: '' })
}));

vi.mock('components/Page', () => ({
    default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));

vi.mock('../../api/usePtvAuthenticatedIdentity', () => ({
    usePtvAuthenticatedIdentity: () => ({
        identityKey: accessState.identityKey,
        serverId: 'server-a',
        status: 'restoring',
        userId: 'user-a'
    })
}));

vi.mock('../../shell/usePtvNavigationAccess', () => ({
    usePtvNavigationAccess: () => ({
        access: {
            collections: accessState.collections,
            isAdmin: false,
            movies: [],
            music: [],
            reading: [],
            shows: []
        },
        identityKey: accessState.identityKey,
        status: 'ready'
    })
}));

vi.mock('../calendar/arrCalendarAvailability', () => ({
    usePtvArrCalendarAvailability: () => ({ showEntry: false })
}));

vi.mock('../../api/images', () => ({
    getPtvItemImageCandidates: () => [],
    markPtvImageCandidateFailed: vi.fn(),
    recordPtvImageFallback: vi.fn()
}));

vi.mock('./collectionLoader', () => ({
    buildPtvCollectionLandingSections: () => [],
    getPtvCollectionGenres: () => [],
    getPtvCollectionHero: () => null,
    loadPtvCollectionCritical: vi.fn(),
    loadPtvCollectionDeferred: vi.fn(),
    loadPtvCollectionDetails: vi.fn()
}));

vi.mock('./collectionPreferences', () => ({
    getCurrentPtvCollectionPreferenceScope: () => null
}));

vi.mock('../../services/jellyfinLogoutAction', () => ({
    requestJellyfinLogout: vi.fn()
}));

vi.mock('../../services/performanceMonitor', () => ({
    incrementPtvPerformanceCounter: vi.fn()
}));

vi.mock('../../services/runtimeStability', () => ({
    registerPtvNativeShellInstance: () => vi.fn(),
    runPtvClientCacheMigration: vi.fn()
}));

vi.mock('../../services/notificationService', () => ({
    clearDismissiblePtvNotifications: vi.fn(),
    dismissPtvNotification: vi.fn(),
    getPtvNotificationSnapshot: () => ({
        duplicateSuppressionCount: 0,
        lastNotificationSource: 'none',
        notifications: [],
        subscriberCount: 0,
        totalCount: 0,
        unreadCount: 0
    }),
    hasPtvNotificationRetryHandler: () => false,
    markAllPtvNotificationsRead: vi.fn(),
    markPtvNotificationRead: vi.fn(),
    runPtvNotificationRetry: vi.fn(),
    subscribePtvNotifications: () => vi.fn()
}));

vi.mock('../../core/observability', () => ({ recordPtvEvent: vi.fn() }));
vi.mock('../../shell/routeController', () => ({ recordPtvRouteGenerationLifecycle: vi.fn() }));
vi.mock('../icons', () => ({ PtvIcon: () => <span /> }));
vi.mock('../../services/requestCoordinator', () => ({
    recordPtvRequestLedgerStaleRejected: vi.fn(),
    recordPtvRequestLedgerVisibleRetry: vi.fn()
}));

import CollectionsPage from './CollectionsPage';

describe('Collections direct-route access', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
        accessState.collections = true;
        accessState.identityKey = 'server-a:user-a';
        window.location.hash = '#/collections';
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
    });

    it('retires Collections content when the current account has no Collections access', async () => {
        await act(async () => root.render(<CollectionsPage />));
        expect(container.querySelector('.ptv-collections-masthead')).not.toBeNull();

        accessState.collections = false;
        accessState.identityKey = 'server-a:user-b';
        await act(async () => root.render(<CollectionsPage />));

        expect(container.querySelector('.ptv-collections-masthead')).toBeNull();
        expect(container.textContent).toContain('This library is not available for this account.');
    });
});
