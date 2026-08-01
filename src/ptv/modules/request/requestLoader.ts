import { PTV_EVENTS, PTV_ROUTES, PTV_SERVICES } from '../../core/config';
import { dispatchPtvCustomEvent } from '../../core/events';

export type PtvRequestOpenOptions = {
    pushHistory?: boolean;
    query?: string;
};

export type PtvRequestCloseOptions = {
    useHistory?: boolean;
};

let requestModulePromise: Promise<typeof import('./index')> | null = null;
let requestActivationPromise: Promise<boolean> | null = null;
const dispatchRequestEvent = dispatchPtvCustomEvent as (
    eventName: string,
    detail: unknown
) => void;

type PtvRequestNavigationGuard = {
    dispose: () => void;
    invalidate: () => void;
    isCurrent: () => boolean;
};

let cancelCurrentRequestActivation: (() => void) | null = null;

function getLocationIdentity() {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function createRequestNavigationGuard(
    onInvalidate: () => void = () => undefined
): PtvRequestNavigationGuard {
    const initialLocation = getLocationIdentity();
    let invalidated = false;

    const invalidate = () => {
        if (invalidated) return;
        invalidated = true;
        onInvalidate();
    };
    const handleNavigation = () => {
        if (getLocationIdentity() !== initialLocation) {
            invalidate();
        }
    };

    window.addEventListener('hashchange', handleNavigation);
    window.addEventListener('popstate', handleNavigation);
    window.addEventListener('ptv:routechange', handleNavigation);

    return {
        dispose: () => {
            window.removeEventListener('hashchange', handleNavigation);
            window.removeEventListener('popstate', handleNavigation);
            window.removeEventListener('ptv:routechange', handleNavigation);
        },
        invalidate,
        isCurrent: () => {
            handleNavigation();
            return !invalidated;
        }
    };
}

export function loadPtvRequestModule(): Promise<typeof import('./index')> {
    if (requestModulePromise) return requestModulePromise;

    requestModulePromise = import(
        /* webpackChunkName: "ptv-request" */ './index'
    ).catch(error => {
        requestModulePromise = null;
        throw error;
    });

    return requestModulePromise;
}

function navigateToExternalRequestFallback(url: string) {
    const link = document.createElement('a');

    link.dataset.ptvRequestExternal = 'true';
    link.href = url;
    link.rel = 'noopener noreferrer';
    link.target = '_self';
    link.click();
}

async function openExternalRequestFallback(
    query: string | undefined,
    isCurrent: () => boolean
) {
    let fallbackUrl: string = PTV_SERVICES.requestPortalUrl;

    try {
        const { getPtvRequestPortalUrl } = await import(
            '../integrations/integrationsConfig'
        );
        fallbackUrl = await getPtvRequestPortalUrl(query);
    } catch {
        // The product-owned default remains available when settings cannot load.
    }

    if (!isCurrent()) return;

    navigateToExternalRequestFallback(fallbackUrl);
}

async function recoverFromRequestLoadFailure(
    query: string | undefined,
    isCurrent: () => boolean,
    warning: string
) {
    if (!isCurrent()) return;

    console.warn(warning);

    try {
        await openExternalRequestFallback(query, isCurrent);
    } catch {
        if (isCurrent()) {
            window.location.hash = PTV_ROUTES.requestSafe;
        }
    }
}

async function activatePtvRequestPortal(
    options: PtvRequestOpenOptions,
    guard: PtvRequestNavigationGuard
) {
    try {
        await loadPtvRequestModule();

        if (!guard.isCurrent()) return false;

        dispatchRequestEvent(PTV_EVENTS.requestOpen, options);
        return true;
    } catch {
        await recoverFromRequestLoadFailure(
            options.query,
            guard.isCurrent,
            '[PiggieTV] Request feature failed to load; opening the external fallback'
        );
        return false;
    }
}

/**
 * Loads the Request owner for a direct Request URL. The module adopts the
 * existing route on success; a failed chunk uses the same external/safe
 * recovery chain as an explicit Request activation.
 */
export async function ensurePtvRequestRoute(): Promise<boolean> {
    const guard = createRequestNavigationGuard();

    try {
        await loadPtvRequestModule();
        return guard.isCurrent();
    } catch {
        await recoverFromRequestLoadFailure(
            undefined,
            guard.isCurrent,
            '[PiggieTV] Request route failed to load; opening the external fallback'
        );
        return false;
    } finally {
        guard.dispose();
    }
}

/**
 * Coalesces overlapping pointer/click/keyboard activations while the lazy
 * module is loading, then sends exactly one product-owned open event.
 */
export function openPtvRequestPortal(
    options: PtvRequestOpenOptions = {}
): Promise<boolean> {
    if (requestActivationPromise) return requestActivationPromise;

    const activationOwner: {
        promise: Promise<boolean> | null;
    } = {
        promise: null
    };
    const guard = createRequestNavigationGuard(() => {
        if (requestActivationPromise === activationOwner.promise) {
            requestActivationPromise = null;
        }
    });
    cancelCurrentRequestActivation = guard.invalidate;

    const ownedActivation = activatePtvRequestPortal(options, guard)
        .finally(() => {
            guard.dispose();

            if (requestActivationPromise === ownedActivation) {
                requestActivationPromise = null;
            }

            if (cancelCurrentRequestActivation === guard.invalidate) {
                cancelCurrentRequestActivation = null;
            }
        });
    activationOwner.promise = ownedActivation;
    requestActivationPromise = ownedActivation;

    return requestActivationPromise;
}

export function cancelPendingPtvRequestActivation(): void {
    cancelCurrentRequestActivation?.();
}

export async function closePtvRequestPortal(
    options: PtvRequestCloseOptions = {}
): Promise<boolean> {
    cancelPendingPtvRequestActivation();

    try {
        await loadPtvRequestModule();
        dispatchRequestEvent(PTV_EVENTS.requestClose, options);
        return true;
    } catch {
        console.warn('[PiggieTV] Request feature failed to load while closing');

        if (window.location.hash) {
            window.location.hash = PTV_ROUTES.requestSafe;
        }

        return false;
    }
}
