export function shouldArmPlayerChromeHide({
    controlsVisible,
    hasTimer,
    paused,
    playbackActive
}) {
    return Boolean(
        playbackActive
        && controlsVisible
        && !hasTimer
        && !paused
    );
}

export function shouldDeferPlayerChromeHide({ controlFocused, isTv, interactionActive = false }) {
    return Boolean(interactionActive || isTv && controlFocused);
}
