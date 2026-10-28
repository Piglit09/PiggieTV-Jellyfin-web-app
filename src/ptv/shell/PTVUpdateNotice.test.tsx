import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const update = vi.hoisted(() => ({
    applyWhenSafe: vi.fn(),
    dismiss: vi.fn(),
    getSnapshot: () => ({ activityReason: '', error: 'The update worker did not activate. Try again.', state: 'error' }),
    retryDeferredUpdate: vi.fn(),
    retryFailedUpdate: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    subscribe: () => () => undefined
}));

vi.mock('../services/updateService', () => ({
    getPtvUpdateService: () => update
}));

import PTVUpdateNotice from './PTVUpdateNotice';

describe('PiggieTV update notice failure', () => {
    afterEach(() => {
        document.body.replaceChildren();
        vi.clearAllMocks();
        vi.unstubAllGlobals();
    });

    it('shows a recoverable activation failure and lets the user retry', async () => {
        vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
        const host = document.createElement('div');
        document.body.append(host);
        const root = createRoot(host);

        await act(async () => root.render(<PTVUpdateNotice />));
        expect(host.textContent).toContain('did not activate');
        const retry = [...host.querySelectorAll('button')].find(button => button.textContent === 'Try again');
        expect(retry).toBeDefined();
        await act(async () => retry?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(update.retryFailedUpdate).toHaveBeenCalledOnce();
        await act(async () => root.unmount());
    });
});
