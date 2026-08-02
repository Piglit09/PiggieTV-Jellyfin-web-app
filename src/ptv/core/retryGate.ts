export type PtvRetryGate = Readonly<{
    claim: () => boolean;
    release: () => void;
}>;

/** Prevents a burst of UI activations from creating parallel owned retries. */
export function createPtvRetryGate(): PtvRetryGate {
    let claimed = false;

    return {
        claim() {
            if (claimed) return false;
            claimed = true;
            return true;
        },
        release() {
            claimed = false;
        }
    };
}
