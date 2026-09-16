export function shouldFocusVideoOsdOnReveal(isTv: boolean, explicitFocusTarget: boolean) {
    return isTv || explicitFocusTarget;
}
