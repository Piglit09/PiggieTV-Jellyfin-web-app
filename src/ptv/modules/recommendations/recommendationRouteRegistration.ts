import { recordPtvEvent } from '../../core/observability';

const REGISTRY_KEY = '__ptvRecommendationRouteRegistrations';

type PtvRegistrationWindow = Window & Partial<Record<typeof REGISTRY_KEY, Set<string>>>;

export function claimPtvRecommendationRouteRegistration(registry: Set<string>, path: string): boolean {
    if (registry.has(path)) return false;

    registry.add(path);
    return true;
}

export function registerPtvRecommendationRouteOnce(path: string): boolean {
    const root = window as PtvRegistrationWindow;
    const registry = root[REGISTRY_KEY] || new Set<string>();

    root[REGISTRY_KEY] = registry;
    if (!claimPtvRecommendationRouteRegistration(registry, path)) return false;

    console.info('[PTV Recommendations] Route registered', {
        currentHash: window.location.hash,
        currentPageType: '',
        currentRouteId: '',
        path,
        source: 'dashboard-async-route-registry'
    });
    recordPtvEvent('recommendation', 'recommendation-route-registered', {
        currentHash: window.location.hash,
        currentPageType: '',
        currentRouteId: '',
        lazyImportPath: 'apps/dashboard/routes/piggietv/recommendations',
        path,
        source: 'dashboard-async-route-registry'
    });

    return true;
}
