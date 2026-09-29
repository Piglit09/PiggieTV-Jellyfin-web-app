import { isActionSheetCancelledError } from '../../../components/actionSheet/actionSheetAbort';
import { createPtvAbortController } from '../../../ptv/core/abortController';

type VideoMenuIdentity = Readonly<{
    player: unknown;
    itemId: string | null | undefined;
    serverId: string | null | undefined;
    view: Element;
    available: boolean;
}>;

export type VideoTransientMenuOperation = Readonly<{
    signal: AbortSignal;
    isCurrent: () => boolean;
    finish: () => boolean;
}>;

export function createVideoTransientMenuLifecycle(getIdentity: () => VideoMenuIdentity) {
    let active: { operation: VideoTransientMenuOperation; abort: () => void } | null = null;

    function retire() {
        const retired = active;
        active = null;
        retired?.abort();
    }

    function begin(): VideoTransientMenuOperation {
        retire();
        const captured = getIdentity();
        const controller = createPtvAbortController();
        const operation: VideoTransientMenuOperation = {
            signal: controller.signal,
            isCurrent() {
                if (active?.operation !== operation || controller.signal.aborted) return false;
                const current = getIdentity();
                const matches = captured.available && current.available && Boolean(captured.player && captured.itemId)
                    && current.player === captured.player && current.view === captured.view
                    && current.itemId === captured.itemId && current.serverId === captured.serverId;
                if (!matches) retire();
                return matches;
            },
            finish() {
                const wasCurrent = operation.isCurrent();
                if (active?.operation === operation) retire();
                return wasCurrent;
            }
        };
        active = { operation, abort: () => controller.abort() };
        return operation;
    }

    return {
        begin,
        retire,
        hasCurrent: () => active?.operation.isCurrent() ?? false
    };
}

export function isVideoTransientMenuCancellation(error: unknown) {
    return isActionSheetCancelledError(error) || Boolean(
        error && typeof error === 'object' && 'name' in error && error.name === 'AbortError'
    );
}
