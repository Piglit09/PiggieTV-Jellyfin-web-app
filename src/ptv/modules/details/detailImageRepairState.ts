const PTV_DETAIL_IMAGE_REPAIR_TTL_MS = 5 * 60 * 1000;
const PTV_DETAIL_IMAGE_REPAIR_LIMIT = 4;

type PtvDetailImageRepairState = {
    attempts: Map<string, number>;
    itemId: string;
};

const detailImageRepairAttempts = new WeakMap<HTMLImageElement, PtvDetailImageRepairState>();

export function claimPtvDetailImageRepair(
    image: HTMLImageElement,
    itemId: string,
    targetUrl: string,
    now = Date.now()
) {
    const existing = detailImageRepairAttempts.get(image);
    const state = existing?.itemId === itemId ? existing : {
        attempts: new Map<string, number>(),
        itemId
    };

    state.attempts.forEach((attemptedAt, url) => {
        if (now - attemptedAt >= PTV_DETAIL_IMAGE_REPAIR_TTL_MS) {
            state.attempts.delete(url);
        }
    });

    if (state.attempts.has(targetUrl)) {
        detailImageRepairAttempts.set(image, state);
        return false;
    }

    state.attempts.set(targetUrl, now);

    while (state.attempts.size > PTV_DETAIL_IMAGE_REPAIR_LIMIT) {
        const oldestUrl = state.attempts.keys().next().value;

        if (oldestUrl === undefined) break;
        state.attempts.delete(oldestUrl);
    }

    detailImageRepairAttempts.set(image, state);
    return true;
}

export function clearPtvDetailImageRepairAttempts(image: HTMLImageElement) {
    detailImageRepairAttempts.delete(image);
}
