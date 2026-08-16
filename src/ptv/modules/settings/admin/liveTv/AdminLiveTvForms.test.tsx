import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../configuration/useAdminUnsavedChanges', () => ({
    useAdminUnsavedChanges: vi.fn()
}));

import { AdminLiveTvSchedulesDirectForm } from './AdminLiveTvForms';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

type LiveTvState = React.ComponentProps<typeof AdminLiveTvSchedulesDirectForm>['state'];

function setInputValue(input: HTMLInputElement, value: string) {
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

describe('Live TV secret form safety', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    it('clears a Schedules Direct password immediately when connection fails', async () => {
        const password = [ 'temporary', 'guide', 'secret' ].join('-');
        const connectSchedulesDirect = vi.fn(() => Promise.reject(new Error('Connection failed')));
        const state = {
            action: null,
            configuration: { providers: [], tuners: [] },
            connectSchedulesDirect,
            loadCountries: vi.fn(),
            loadLineups: vi.fn(),
            saveSchedulesDirectListing: vi.fn()
        } as unknown as LiveTvState;

        await act(async () => root.render(
            <MemoryRouter>
                <AdminLiveTvSchedulesDirectForm provider={null} state={state} />
            </MemoryRouter>
        ));
        setInputValue(container.querySelector<HTMLInputElement>('#ptv-live-tv-sd-username')!, 'piggie');
        setInputValue(container.querySelector<HTMLInputElement>('#ptv-live-tv-sd-password')!, password);

        await act(async () => {
            Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
                .find(button => button.textContent === 'Connect Account')
                ?.click();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(connectSchedulesDirect).toHaveBeenCalledWith(
            { id: '', password, username: 'piggie' },
            undefined
        );
        expect(container.querySelector<HTMLInputElement>('#ptv-live-tv-sd-password')?.value).toBe('');
        expect(container.textContent).not.toContain(password);
    });
});
