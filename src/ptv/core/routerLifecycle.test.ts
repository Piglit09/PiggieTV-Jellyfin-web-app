import { afterAll, describe, expect, it, vi } from 'vitest';

type Route = {
    className: string;
    density: string;
    elevation: number;
    features: string[];
    full: string;
    layout: string;
    navigation: {
        activeItemId: string;
        activeSectionId: string;
    };
    owner: string;
    pageType: string;
};

const routerMocks = vi.hoisted(() => ({
    emit: vi.fn(),
    listeners: [] as Array<{
        callback: () => void;
        eventName: string;
        options?: boolean | AddEventListenerOptions;
        target: EventTarget;
    }>,
    route: null as Route | null,
    schedule: vi.fn()
}));

vi.mock('./events', () => ({
    emit: routerMocks.emit,
    on: vi.fn(() => vi.fn())
}));

vi.mock('./observability', () => ({
    recordPtvEvent: vi.fn(),
    recordPtvTiming: vi.fn()
}));

vi.mock('./runtime', () => ({
    registerPtvRuntimeListener: vi.fn()
}));

vi.mock('./scheduler', () => ({
    schedule: routerMocks.schedule
}));

vi.mock('./scope', () => ({
    resetRuntimeScope: vi.fn(() => ({
        listen: vi.fn((
            target: EventTarget,
            eventName: string,
            callback: () => void,
            options?: boolean | AddEventListenerOptions
        ) => {
            routerMocks.listeners.push({
                callback,
                eventName,
                options,
                target
            });

            return vi.fn();
        })
    }))
}));

vi.mock('../shell/routes', () => ({
    getPtvRouteClassNames: vi.fn(() => ['ptv-route-home', 'ptv-route-details']),
    getPtvRouteOwnership: vi.fn(() => routerMocks.route)
}));

import { startRouter } from './router';

const originalPushState = window.history.pushState;
const originalReplaceState = window.history.replaceState;

function createRoute(pageType: string): Route {
    return {
        className: `ptv-route-${pageType}`,
        density: 'comfortable',
        elevation: 1,
        features: [pageType],
        full: `#/${pageType}`,
        layout: pageType,
        navigation: {
            activeItemId: '',
            activeSectionId: ''
        },
        owner: 'ptv',
        pageType
    };
}

afterAll(() => {
    window.history.pushState = originalPushState;
    window.history.replaceState = originalReplaceState;
});

describe('PTV route restoration lifecycle', () => {
    it('reconciles a restored route synchronously before viewshow and deduplicates the same view', () => {
        routerMocks.route = createRoute('home');
        startRouter();
        routerMocks.emit.mockClear();
        routerMocks.schedule.mockClear();

        const viewBeforeShow = routerMocks.listeners.find(listener => (
            listener.target === document
            && listener.eventName === 'viewbeforeshow'
        ));

        expect(viewBeforeShow?.options).toBe(true);

        routerMocks.route = createRoute('details');
        viewBeforeShow?.callback();

        expect(routerMocks.emit).toHaveBeenCalledTimes(1);
        expect(routerMocks.emit).toHaveBeenCalledWith(
            'routechange',
            expect.objectContaining({ pageType: 'details' })
        );
        expect(routerMocks.schedule).not.toHaveBeenCalled();

        viewBeforeShow?.callback();
        expect(routerMocks.emit).toHaveBeenCalledTimes(1);
    });
});
