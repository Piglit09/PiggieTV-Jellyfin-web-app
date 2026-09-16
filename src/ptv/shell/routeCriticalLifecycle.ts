import { recordPtvEvent } from '../core/observability';
import { getPtvCanonicalRouteIdentity } from './routeIdentity';
import { getPtvRouteControllerState } from './routeController';

export const PTV_ROUTE_CRITICAL_LIFECYCLE_EVENT = 'route-critical-lifecycle';

export type PtvRouteCriticalTerminalOutcome =
    | 'cancelled'
    | 'empty'
    | 'failed'
    | 'partial'
    | 'success';

export type PtvRouteCriticalLifecycleOwner = Readonly<{
    lifecycleId: string;
    navigationKey: string;
    routeFamily: string;
    routeGeneration: number;
    routeKey: string;
}>;

export type PtvRouteCriticalLifecycleDetail = PtvRouteCriticalLifecycleOwner & Readonly<{
    state: 'pending' | PtvRouteCriticalTerminalOutcome;
}>;

let routeCriticalLifecycleSequence = 0;

export function capturePtvRouteCriticalLifecycleOwner(
    routeFamily: string
): PtvRouteCriticalLifecycleOwner {
    const route = getPtvRouteControllerState();

    return Object.freeze({
        lifecycleId: `${routeFamily}-critical-${++routeCriticalLifecycleSequence}`,
        navigationKey: getPtvCanonicalRouteIdentity(route.hash, route.normalizedPath || route.path),
        routeFamily,
        routeGeneration: route.routeGeneration,
        routeKey: route.routeKey
    });
}

export function recordPtvRouteCriticalPending(owner: PtvRouteCriticalLifecycleOwner) {
    recordPtvEvent('route', PTV_ROUTE_CRITICAL_LIFECYCLE_EVENT, {
        ...owner,
        state: 'pending'
    } satisfies PtvRouteCriticalLifecycleDetail);
}

export function recordPtvRouteCriticalTerminal(
    owner: PtvRouteCriticalLifecycleOwner,
    state: PtvRouteCriticalTerminalOutcome
) {
    recordPtvEvent('route', PTV_ROUTE_CRITICAL_LIFECYCLE_EVENT, {
        ...owner,
        state
    } satisfies PtvRouteCriticalLifecycleDetail);
}

export function resetPtvRouteCriticalLifecycleForTests() {
    routeCriticalLifecycleSequence = 0;
}
