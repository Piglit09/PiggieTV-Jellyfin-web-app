import type { ConnectResponse } from 'jellyfin-apiclient';

type ServerConnectionAttemptState = {
    active: Promise<ConnectResponse> | null;
    attemptCount: number;
    reuseCount: number;
};

type ServerConnectionAttemptWindow = Window & {
    __PTV_SERVER_CONNECTION_ATTEMPT__?: ServerConnectionAttemptState;
};

function getState() {
    const runtimeWindow = window as ServerConnectionAttemptWindow;

    runtimeWindow.__PTV_SERVER_CONNECTION_ATTEMPT__ ||= {
        active: null,
        attemptCount: 0,
        reuseCount: 0
    };

    return runtimeWindow.__PTV_SERVER_CONNECTION_ATTEMPT__;
}

/**
 * Deduplicates calls into Jellyfin's authoritative connection manager. This
 * gate never creates an ApiClient, WebSocket, reconnect timer, or session.
 */
export function runServerConnectionAttempt(
    connect: () => Promise<ConnectResponse>
): Promise<ConnectResponse> {
    const state = getState();

    if (state.active) {
        state.reuseCount += 1;
        return state.active;
    }

    state.attemptCount += 1;
    const attempt = Promise.resolve().then(connect);

    state.active = attempt;
    const clear = () => {
        if (state.active === attempt) state.active = null;
    };

    void attempt.then(clear, clear);
    return attempt;
}

export function getServerConnectionAttemptSnapshot() {
    const state = getState();

    return {
        active: Boolean(state.active),
        attemptCount: state.attemptCount,
        reuseCount: state.reuseCount
    };
}

export function resetServerConnectionAttemptForTests() {
    delete (window as ServerConnectionAttemptWindow).__PTV_SERVER_CONNECTION_ATTEMPT__;
}
