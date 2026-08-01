import { describe, expect, it, vi } from 'vitest';

import { createPtvAbortController } from '../../ptv/core/abortController';
import {
    ACTION_SHEET_CANCELLED_ERROR_NAME,
    bindActionSheetAbort,
    createActionSheetCancelledError,
    isActionSheetCancelledError
} from './actionSheetAbort';

describe('bindActionSheetAbort', () => {
    it('closes a visible action sheet when its owning operation retires', () => {
        const controller = createPtvAbortController();
        const close = vi.fn();
        const unbind = bindActionSheetAbort(controller.signal, close);

        controller.abort();

        expect(close).toHaveBeenCalledTimes(1);

        unbind();
    });

    it('removes its listener when the action sheet closes normally', () => {
        const controller = createPtvAbortController();
        const close = vi.fn();
        const unbind = bindActionSheetAbort(controller.signal, close);

        unbind();
        controller.abort();

        expect(close).not.toHaveBeenCalled();
    });

    it('uses a stable cancellation sentinel that survives transpilation boundaries', () => {
        const error = createActionSheetCancelledError();

        expect(error.name).toBe(ACTION_SHEET_CANCELLED_ERROR_NAME);
        expect(isActionSheetCancelledError(error)).toBe(true);
        expect(isActionSheetCancelledError({
            name: ACTION_SHEET_CANCELLED_ERROR_NAME
        })).toBe(true);
        expect(isActionSheetCancelledError(new Error('real failure'))).toBe(false);
    });
});
