export const ACTION_SHEET_CANCELLED_ERROR_NAME = 'ActionSheetCancelledError';

export function createActionSheetCancelledError() {
    const error = new Error('ActionSheet was dismissed');

    error.name = ACTION_SHEET_CANCELLED_ERROR_NAME;

    return error;
}

export function isActionSheetCancelledError(error: unknown) {
    return Boolean(
        error
        && typeof error === 'object'
        && 'name' in error
        && error.name === ACTION_SHEET_CANCELLED_ERROR_NAME
    );
}

export function bindActionSheetAbort(
    signal: AbortSignal | null | undefined,
    close: () => void
) {
    if (!signal) return () => undefined;

    const abort = () => close();

    signal.addEventListener('abort', abort, { once: true });

    return () => signal.removeEventListener('abort', abort);
}
