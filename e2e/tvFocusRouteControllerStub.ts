export type PtvRouteControllerState = Readonly<{
    owner: string;
    pageType: string;
    routeKey: string;
}>;

export function getPtvRouteControllerState(): PtvRouteControllerState {
    return {
        owner: document.documentElement.dataset.ptvRouteOwner || 'shell',
        pageType: document.documentElement.dataset.ptvRoutePageType || 'unknown',
        routeKey: `${window.location.pathname}${window.location.hash}`
    };
}
