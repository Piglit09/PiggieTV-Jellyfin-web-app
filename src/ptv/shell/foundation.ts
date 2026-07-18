import { emit, on } from '../core/events';
import {
    recordPtvEvent,
    registerPtvDebugShellStatusProvider
} from '../core/observability';
import { registerPtvRuntimeListener } from '../core/runtime';
import {
    getPtvRouteControllerState,
    type PtvRouteControllerState
} from './routeController';
import { getHeaderStatusForRoute } from './shellHeaderState';

export type PtvShellFoundationStatus = {
    active: boolean;
    currentRoute: string;
    error: string | null;
    header: unknown | null;
    isLoading: boolean;
    route: PtvRouteControllerState;
};

let shellFoundationStarted = false;
let status: PtvShellFoundationStatus = {
    active: true,
    currentRoute: getPtvRouteControllerState().routeId,
    error: null,
    header: null,
    isLoading: false,
    route: getPtvRouteControllerState()
};

function applyShellState(nextStatus: PtvShellFoundationStatus) {
    const root = document.documentElement;
    const body = document.body;

    root.dataset.ptvShellReady = 'true';
    root.dataset.ptvShellActive = String(nextStatus.active);
    root.dataset.ptvShellCurrentRoute = nextStatus.currentRoute;
    root.dataset.ptvRouteMode = nextStatus.route.mode;
    root.dataset.ptvRouteNative = String(nextStatus.route.canRenderNative);
    root.dataset.ptvRouteFallback = nextStatus.route.fallbackReason || '';
    root.classList.toggle('ptv-shell-is-loading', nextStatus.isLoading);
    root.classList.toggle('ptv-shell-has-error', Boolean(nextStatus.error));

    if (body) {
        body.classList.add('ptv-native-shell-ready');
        body.dataset.ptvShellRoute = nextStatus.route.routeId;
        body.dataset.ptvShellLayout = nextStatus.route.layout;
    }
}

function publishShellStatus() {
    applyShellState(status);
    emit('shellfoundationchange', status);
}

function getPtvShellHeaderStatus() {
    try {
        const shell = window.PTV?.shell;

        if (!shell || typeof shell !== 'object') return null;

        const provider = (shell as Record<string, unknown>).getHeaderStatus;

        return typeof provider === 'function' ? provider() : null;
    } catch (error) {
        return {
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

export function getPtvShellFoundationStatus(): PtvShellFoundationStatus {
    const currentRoute = getPtvRouteControllerState();
    const header = getHeaderStatusForRoute(getPtvShellHeaderStatus(), currentRoute);

    if (status.route.full !== currentRoute.full || status.currentRoute !== currentRoute.routeId) {
        return {
            ...status,
            currentRoute: currentRoute.routeId,
            header,
            route: currentRoute
        };
    }

    return {
        ...status,
        header
    };
}

export function setPtvShellLoading(isLoading: boolean) {
    if (status.isLoading === isLoading) return;

    status = {
        ...status,
        isLoading
    };

    publishShellStatus();
}

export function setPtvShellError(error: string | Error | null) {
    const nextError = error instanceof Error ? error.message : error;

    if (status.error === nextError) return;

    status = {
        ...status,
        error: nextError
    };

    recordPtvEvent('route', 'shell-error-state', {
        error: nextError,
        routeId: status.route.routeId
    });
    publishShellStatus();
}

export function clearPtvShellStatus() {
    if (!status.error && !status.isLoading) return;

    status = {
        ...status,
        error: null,
        isLoading: false
    };

    publishShellStatus();
}

function updateRoute(nextRoute: PtvRouteControllerState) {
    status = {
        ...status,
        active: true,
        currentRoute: nextRoute.routeId,
        error: null,
        isLoading: false,
        route: nextRoute
    };

    publishShellStatus();
}

export function startPtvShellFoundation() {
    if (shellFoundationStarted) return;

    shellFoundationStarted = true;
    applyShellState(status);

    registerPtvRuntimeListener('shell-foundation:routecontrollerchange', () => on('routecontrollerchange', (event: Event) => {
        updateRoute((event as CustomEvent<PtvRouteControllerState>).detail || getPtvRouteControllerState());
    }));

    const root = window.PTV || (window.PTV = {});
    const existingShell = root.shell && typeof root.shell === 'object' ?
        root.shell as Record<string, unknown> :
        {};

    root.shell = {
        ...existingShell,
        clearStatus: clearPtvShellStatus,
        getFoundationStatus: getPtvShellFoundationStatus,
        setError: setPtvShellError,
        setLoading: setPtvShellLoading
    };
    registerPtvDebugShellStatusProvider(getPtvShellFoundationStatus);
}
