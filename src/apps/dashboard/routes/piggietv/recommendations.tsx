import RecommendationDashboardPage from 'ptv/modules/recommendations/RecommendationDashboardPage';
import { logPtvRecommendationStage } from 'ptv/modules/recommendations/debug/recommendationRuntimeDebug';
import { getPtvRouteControllerState } from 'ptv/shell/routeController';

const routeState = getPtvRouteControllerState();

logPtvRecommendationStage('Route matched', {
    currentHash: window.location.hash,
    currentPageType: routeState.pageType,
    currentRouteId: routeState.routeId,
    currentRouteMode: routeState.mode,
    hash: window.location.hash,
    lazyImportPath: 'apps/dashboard/routes/piggietv/recommendations',
    pathname: window.location.pathname,
    route: 'piggietv/recommendations'
});

export const Component = RecommendationDashboardPage;
