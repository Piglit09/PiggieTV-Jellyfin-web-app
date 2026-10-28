import Dashboard from '../../utils/dashboard';
import { getPtvCurrentUserId, getPtvServerId } from '../api';
import { retirePtvRecommendationDiagnosticScope } from '../modules/recommendations/diagnostics/recommendationDiagnosticScope';

let logoutInFlight: Promise<void> | null = null;

function clearLogoutInFlight(promise: Promise<void>) {
    if (logoutInFlight === promise) {
        logoutInFlight = null;
    }
}

async function retirePtvIdentityState(serverId: string, userId: string) {
    await Promise.allSettled([
        import('../modules/music/musicQueue')
            .then(module => module.retirePtvMusicIdentityState('logout')),
        import('../modules/recommendations/engine/recommendationEngine')
            .then(module => {
                if (serverId && userId) {
                    module.invalidatePtvRecommendationCache({ serverId, userId });
                }
            }),
        import('../pages/home/hooks')
            .then(module => module.retireNativeHomeIdentityState(serverId, userId)),
        import('../modules/cache/featuredContentCache')
            .then(module => module.invalidateFeaturedContentMemoryCache('identity-retired'))
    ]);
}

/**
 * Invokes Jellyfin Web's authoritative logout lifecycle while preventing
 * duplicate requests from overlapping pointer, keyboard, and remote events.
 *
 * PTV intentionally does not clear credentials, publish session events, or
 * choose the post-logout route here. Those remain owned by Dashboard.logout.
 */
export function requestJellyfinLogout(): Promise<void> {
    return requestJellyfinSessionExit(false);
}

export function requestJellyfinUserSwitch(): Promise<void> {
    return requestJellyfinSessionExit(true);
}

function requestJellyfinSessionExit(switchUser: boolean): Promise<void> {
    if (logoutInFlight) return logoutInFlight;

    retirePtvRecommendationDiagnosticScope();
    const serverId = String(getPtvServerId() || '');
    const userId = String(getPtvCurrentUserId(serverId) || '');
    const retirement = retirePtvIdentityState(serverId, userId);
    const authoritativeLogout = Promise.resolve(
        switchUser ? Dashboard.switchUser() : Dashboard.logout()
    );
    const promise = Promise.all([ authoritativeLogout, retirement ]).then(() => undefined);

    logoutInFlight = promise;
    void promise.then(
        () => clearLogoutInFlight(promise),
        () => clearLogoutInFlight(promise)
    );

    return promise;
}

export function isJellyfinLogoutInFlight() {
    return logoutInFlight !== null;
}
