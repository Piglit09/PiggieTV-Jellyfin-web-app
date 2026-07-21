import { on } from './events';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import Events from '../../utils/events';
import layoutManager from '../../components/layoutManager';
import { getPtvRouteControllerState } from '../shell/routeController';
import { getPtvTvNavigationSnapshot } from './tvFocus';

const FOCUSABLE_SELECTOR = `
    a[href],
    button,
    input,
    select,
    textarea,
    [contenteditable="true"],
    [role="button"],
    [role="link"],
    [role="menuitem"],
    [tabindex]:not([tabindex="-1"])
`;

function isWindowReady() {
    return document.readyState === 'interactive' || document.readyState === 'complete';
}

function getApiClient() {
    try {
        if (ServerConnections && typeof ServerConnections.getLocalApiClient === 'function') {
            const localApiClient = ServerConnections.getLocalApiClient();

            if (localApiClient) return localApiClient;
        }

        const selectedServer = typeof ServerConnections?.getLastUsedServer === 'function' ?
            ServerConnections.getLastUsedServer() :
            null;
        const serverId = selectedServer?.Id;

        if (typeof serverId === 'string' && serverId && typeof ServerConnections?.getApiClient === 'function') {
            return ServerConnections.getApiClient(serverId);
        }
    } catch (_) {
        // Jellyfin may expose a partial server record while restoring local storage.
    }

    return window.ApiClient;
}

function hasActiveUser() {
    const apiClient = getApiClient();

    if (!apiClient || typeof apiClient.getCurrentUserId !== 'function') return false;

    return Boolean(apiClient.getCurrentUserId());
}

function isActiveRouteHome(route) {
    return Boolean(
        route &&
        (route.isHome || route.routeId === 'home' || route.pageType === 'home')
    );
}

function isLayoutManagerReady() {
    return Boolean(
        layoutManager.defaultLayout &&
        (layoutManager.desktop || layoutManager.tv || layoutManager.mobile)
    );
}

function isSplashRemoved() {
    return !document.querySelector('#reactRoot .splashLogo');
}

function isVisible(node) {
    if (!(node instanceof HTMLElement)) return false;
    if (node.hidden || node.getAttribute('aria-hidden') === 'true' || node.disabled) return false;

    const style = window.getComputedStyle(node);
    if (!style || style.display === 'none' || style.visibility === 'hidden') return false;

    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && Number(style.opacity) > 0;
}

function hasVisibleFocusableTarget() {
    const candidates = document.querySelectorAll(FOCUSABLE_SELECTOR);

    for (const candidate of candidates) {
        if (isVisible(candidate)) return true;
    }

    return false;
}

function hasUsableFocusTarget() {
    const focusSnapshot = getFocusSnapshot();

    return Boolean(hasVisibleFocusableTarget() || (focusSnapshot?.focusManagerReady && focusSnapshot.focusTargetCount > 0));
}

function getFocusSnapshot() {
    try {
        return getPtvTvNavigationSnapshot();
    } catch (_) {
        return null;
    }
}

function emitRuntimeReadySignal(route) {
    const focusSnapshot = getFocusSnapshot();
    const apiClient = getApiClient();
    const userId = apiClient && typeof apiClient.getCurrentUserId === 'function' ? apiClient.getCurrentUserId() : '';
    const serverId = apiClient && typeof apiClient.serverId === 'function' ? apiClient.serverId() : '';
    const detail = {
        route: route?.full || window.location.hash || '',
        routeId: route?.routeId || '',
        routeOwner: route?.owner || '',
        routePageType: route?.pageType || '',
        runtimeReady: true,
        authReady: true,
        hasActiveUser: hasActiveUser(),
        activeApiClient: Boolean(apiClient),
        authenticated: Boolean(userId),
        layoutReady: isLayoutManagerReady(),
        homeRendered: isActiveRouteHome(route),
        splashRemoved: isSplashRemoved(),
        focusTargetPresent: hasVisibleFocusableTarget(),
        focusManagerReady: focusSnapshot?.focusManagerReady || false,
        focusScopeCount: focusSnapshot?.focusScopeCount || 0,
        focusTargetCount: focusSnapshot?.focusTargetCount || 0,
        focusRecoveryCount: focusSnapshot?.focusRecoveryCount || 0,
        navigationMoves: focusSnapshot?.navigationMoves || 0,
        duplicateKeySuppressedCount: focusSnapshot?.duplicateKeySuppressedCount || 0,
        routeDefaultFailureCount: focusSnapshot?.routeDefaultFailureCount || 0,
        serverId: serverId || '',
        userId: userId || '',
        pageGeneration: window.__ptvAndroidPageGeneration || 0,
        lastFocusKey: focusSnapshot?.lastKeyPressed || 'none',
        activeFocusTarget: focusSnapshot?.activeFocusTarget || '',
        activeNavigationScope: focusSnapshot?.activeNavigationScope || '',
        documentReady: isWindowReady(),
        url: window.location.href,
        userAgent: navigator?.userAgent || ''
    };

    try {
        if (window.NativeShell && typeof window.NativeShell.onPtvRuntimeReady === 'function') {
            window.NativeShell.onPtvRuntimeReady(JSON.stringify(detail));
        }
    } catch (_) {}

    try {
        const event = document.createEvent('CustomEvent');
        event.initCustomEvent('ptv-runtime-ready', false, false, detail);
        window.dispatchEvent(event);
    } catch (_) {}
}

let runtimeReadyDispatched = false;

function evaluateReadiness() {
    if (runtimeReadyDispatched) return;

    const route = getPtvRouteControllerState();
    const hasFocusTarget = hasUsableFocusTarget();

    const ready = (
        isWindowReady() &&
        Boolean(getApiClient()) &&
        hasActiveUser() &&
        isLayoutManagerReady() &&
        isSplashRemoved() &&
        isActiveRouteHome(route) &&
        hasFocusTarget
    );

    if (!ready) return;

    runtimeReadyDispatched = true;
    emitRuntimeReadySignal(route);
}

function startLayoutReadinessSignal() {
    const stopListeners = [
        on('routechange', evaluateReadiness),
        on('routecontrollerchange', evaluateReadiness),
        on('modulesupdated', evaluateReadiness),
        on('moduleregistered', evaluateReadiness)
    ];

    const onLayoutModeChange = () => evaluateReadiness();
    Events.on(layoutManager, 'modechange', onLayoutModeChange);

    const onLoad = () => evaluateReadiness();
    window.addEventListener('load', onLoad, { once: true });

    evaluateReadiness();

    return () => {
        stopListeners.forEach(unsubscribe => unsubscribe());
        Events.off(layoutManager, 'modechange', onLayoutModeChange);
        window.removeEventListener('load', onLoad);
    };
}

export function startPtvStartupReadiness() {
    return startLayoutReadinessSignal();
}
