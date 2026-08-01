const PTV_RUNTIME_OVERLAY_OCCLUDED_CLASS = 'ptv-runtime-overlay-occluded';
const activeOcclusions = new Set<symbol>();

function syncPtvRuntimeOverlayOcclusionClass() {
    if (typeof document === 'undefined') return;

    document.documentElement.classList.toggle(
        PTV_RUNTIME_OVERLAY_OCCLUDED_CLASS,
        activeOcclusions.size > 0
    );
}

export function acquirePtvRuntimeOverlayOcclusion(owner: string) {
    const token = Symbol(owner);
    let released = false;

    activeOcclusions.add(token);
    syncPtvRuntimeOverlayOcclusionClass();

    return () => {
        if (released) return;

        released = true;
        activeOcclusions.delete(token);
        syncPtvRuntimeOverlayOcclusionClass();
    };
}

export function getPtvRuntimeOverlayOcclusionCount() {
    return activeOcclusions.size;
}

export function resetPtvRuntimeOverlayOcclusionsForTests() {
    activeOcclusions.clear();
    syncPtvRuntimeOverlayOcclusionClass();
}
