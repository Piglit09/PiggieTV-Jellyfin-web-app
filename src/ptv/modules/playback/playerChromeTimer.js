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

export function shouldDeferPlayerChromeHide({ controlFocused, isTv }) {
    return Boolean(isTv && controlFocused);
}
