import { describe, expect, it } from 'vitest';

import {
    beginPtvDetailChildLoad,
    retirePtvDetailChildLoad,
    settlePtvDetailChildLoad
} from './detailChildLoadOwner';

describe('detail child load ownership', () => {
    it('aborts the previous child load when a retry supersedes it', () => {
        const page = document.createElement('div');
        const first = beginPtvDetailChildLoad(page);
        const retry = beginPtvDetailChildLoad(page);

        expect(first.signal.aborted).toBe(true);
        expect(retry.signal.aborted).toBe(false);
    });

    it('aborts the active child load when its page exits', () => {
        const page = document.createElement('div');
        const controller = beginPtvDetailChildLoad(page);

        expect(retirePtvDetailChildLoad(page)).toBe(true);
        expect(controller.signal.aborted).toBe(true);
        expect(retirePtvDetailChildLoad(page)).toBe(false);
    });

    it('does not let an older completion retire a newer retry', () => {
        const page = document.createElement('div');
        const first = beginPtvDetailChildLoad(page);
        const retry = beginPtvDetailChildLoad(page);

        settlePtvDetailChildLoad(page, first);

        expect(retirePtvDetailChildLoad(page)).toBe(true);
        expect(retry.signal.aborted).toBe(true);
    });
});
