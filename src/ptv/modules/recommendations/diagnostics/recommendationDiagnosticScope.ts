import { ServerConnections } from 'lib/jellyfin-apiclient';
import Events from '../../../../utils/events';

import { getCurrentPtvApiClient } from '../../../api/client';
import {
    getPtvAuthenticatedDisplayIdentityKey,
    getPtvDisplayIdentityKey
} from '../../../services/displayIdentity';

type RecommendationDiagnosticScope = Readonly<{
    identityScope: string;
    isCurrent: () => boolean;
}>;

let identityEpoch = 0;
let activeIdentityKey: string | null = null;
let lifecycleInstalled = false;
const scopeListeners = new Set<() => void>();

function advanceIdentityScope(identityKey: string | null) {
    activeIdentityKey = identityKey;
    identityEpoch += 1;
    scopeListeners.forEach(listener => {
        try {
            listener();
        } catch {
            // Diagnostic listeners cannot interfere with authentication.
        }
    });
}

function ensureIdentityLifecycle() {
    if (lifecycleInstalled) return;

    // Bind at runtime: ServerConnections is part of the API bootstrap graph.
    Events.on(ServerConnections, 'localusersignedin', retirePtvRecommendationDiagnosticScope);
    Events.on(ServerConnections, 'localusersignedout', retirePtvRecommendationDiagnosticScope);
    lifecycleInstalled = true;
}

function observeAuthenticatedIdentity() {
    const key = getPtvAuthenticatedDisplayIdentityKey(getCurrentPtvApiClient());

    if (key !== activeIdentityKey) advanceIdentityScope(key);
    return key;
}

/** The identity key remains private; only an ephemeral scope number is exported. */
export function capturePtvRecommendationDiagnosticScope(input: Readonly<{
    serverId: string | null | undefined;
    userId: string | null | undefined;
}>): RecommendationDiagnosticScope | null {
    ensureIdentityLifecycle();
    const requestedKey = getPtvDisplayIdentityKey(input.serverId, input.userId);
    if (!requestedKey) return null;

    const authenticatedKey = observeAuthenticatedIdentity();
    if (authenticatedKey !== requestedKey) return null;

    const capturedEpoch = identityEpoch;
    const identityScope = `recommendation-scope-${capturedEpoch}`;

    return {
        identityScope,
        isCurrent: () => {
            observeAuthenticatedIdentity();
            return capturedEpoch === identityEpoch && activeIdentityKey === requestedKey;
        }
    };
}

/** Retires pending diagnostics immediately when logout or user switching starts. */
export function retirePtvRecommendationDiagnosticScope() {
    ensureIdentityLifecycle();
    advanceIdentityScope(null);
}

export function subscribePtvRecommendationDiagnosticScope(listener: () => void) {
    ensureIdentityLifecycle();
    scopeListeners.add(listener);

    return () => {
        scopeListeners.delete(listener);
    };
}
