import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AppearanceSettings from './pages/AppearanceSettings';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

describe('Appearance settings failure behavior', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        localStorage.clear();
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await act(async () => root.unmount());
        container.remove();
        document.documentElement.className = '';
        delete document.documentElement.dataset.ptvUiScale;
    });

    it('rolls immediate UI state back when local persistence fails', async () => {
        await act(async () => root.render(<AppearanceSettings />));
        const reduceMotion = container.querySelector<HTMLInputElement>('#ptv-settings-reduce-motion');
        expect(reduceMotion?.checked).toBe(false);
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('storage unavailable');
        });

        await act(async () => reduceMotion?.click());

        expect(reduceMotion?.checked).toBe(false);
        expect(container.textContent).toContain('We could not save this setting');
        expect(document.documentElement.classList).not.toContain('ptv-user-reduce-motion');
    });
});
