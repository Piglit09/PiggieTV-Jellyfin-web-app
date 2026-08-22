export function isPlaybackStartAllowed(playOptions) {
    const requestGuard = playOptions?.playbackRequestGuard;
    const guard = playOptions?.playbackStartGuard;

    try {
        if (typeof requestGuard === 'function' && requestGuard() === false) {
            return false;
        }

        return typeof guard !== 'function' || guard() !== false;
    } catch {
        return false;
    }
}

const activePlaybackRequests = new WeakMap();

export function beginPlaybackRequest(owner, playOptions) {
    const existingGuardedState = playOptions?.playbackStartIsGuarded;
    const guarded = typeof existingGuardedState === 'boolean' ?
        existingGuardedState :
        typeof playOptions?.playbackStartGuard === 'function';
    const activeRequest = activePlaybackRequests.get(owner);

    // Background playback is opportunistic. Once a user request has begun,
    // it owns the manager until its initial start pipeline settles.
    if (guarded && activeRequest?.guarded === false && !activeRequest.completed) {
        return null;
    }

    if (activeRequest && !activeRequest.completed) {
        activeRequest.retired = true;
    }

    const request = {
        completed: false,
        guarded,
        retired: false
    };

    activePlaybackRequests.set(owner, request);
    playOptions.playbackStartIsGuarded = guarded;
    playOptions.playbackRequestGuard = () => !request.retired;

    return request;
}

export function completePlaybackRequest(owner, request) {
    if (!request) return false;

    request.completed = true;

    if (activePlaybackRequests.get(owner) === request) {
        activePlaybackRequests.delete(owner);
    }

    return !request.retired;
}

export function isGuardedPlaybackStart(playOptions) {
    return playOptions?.playbackStartIsGuarded === true;
}

const playerStartTokens = new WeakMap();

export function beginPlayerStart(player, { guarded = false } = {}) {
    const activeStart = playerStartTokens.get(player);

    // A background start (currently theme audio) must never overtake an
    // ordinary user playback request already entering the shared player.
    if (guarded && activeStart?.guarded === false) return null;

    const token = { guarded };
    playerStartTokens.set(player, token);
    return token;
}

export function completePlayerStart(player, token) {
    if (playerStartTokens.get(player) !== token) return false;

    playerStartTokens.delete(player);
    return true;
}

export async function cancelRetiredPlayerStart(player, token, stopPlayer = () => player.stop(false)) {
    if (!completePlayerStart(player, token)) return false;

    try {
        await stopPlayer();
        return true;
    } catch {
        return false;
    }
}

export async function stopPlayerWithoutPlaybackEvents(player, unbindStopped, bindStopped) {
    unbindStopped(player);

    try {
        await player.stop(false);
    } finally {
        bindStopped(player);
    }
}

export function clearRetiredPlayerState({
    currentPlayer,
    expectedStreamInfo,
    player,
    playerData,
    removeCurrentPlayer,
    resetQueue,
    stopProgress
}) {
    if (!expectedStreamInfo || playerData.streamInfo !== expectedStreamInfo) {
        return false;
    }

    playerData.streamInfo = null;

    if (currentPlayer === player) {
        stopProgress(player);
        resetQueue();
        removeCurrentPlayer(player);
    }

    return true;
}
