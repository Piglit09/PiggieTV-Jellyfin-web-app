import Dashboard from '../../utils/dashboard';

let logoutInFlight: Promise<void> | null = null;

function clearLogoutInFlight(promise: Promise<void>) {
    if (logoutInFlight === promise) {
        logoutInFlight = null;
    }
}

/**
 * Invokes Jellyfin Web's authoritative logout lifecycle while preventing
 * duplicate requests from overlapping pointer, keyboard, and remote events.
 *
 * PTV intentionally does not clear credentials, publish session events, or
 * choose the post-logout route here. Those remain owned by Dashboard.logout.
 */
export function requestJellyfinLogout(): Promise<void> {
    if (logoutInFlight) return logoutInFlight;

    const promise = Promise.resolve(Dashboard.logout())
        .then(async () => {
            try {
                const { retirePtvMusicIdentityState } = await import('../modules/music/musicQueue');

                retirePtvMusicIdentityState('logout');
            } catch {
                // Logout remains authoritative even when the optional Music
                // feature chunk was unavailable or had never been loaded.
            }
        });

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
