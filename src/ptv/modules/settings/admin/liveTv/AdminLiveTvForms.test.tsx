import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../configuration/useAdminUnsavedChanges', () => ({
    useAdminUnsavedChanges: vi.fn()
}));

import { AdminLiveTvDvrForm, AdminLiveTvSchedulesDirectForm } from './AdminLiveTvForms';
import {
    AdminLiveTvServiceError,
    type AdminLiveTvDvrSettings
} from './adminLiveTvModel';

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

describe('Live TV form safety', () => {
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

    it('keeps DVR edits usable and retryable after a bounded save failure', async () => {
        const dvr: AdminLiveTvDvrSettings = {
            guideDays: 7,
            movieRecordingPath: null,
            postPaddingSeconds: 120,
            prePaddingSeconds: 60,
            recordingPath: null,
            recordingPostProcessor: null,
            recordingPostProcessorArguments: null,
            saveRecordingImages: false,
            saveRecordingNfo: false,
            seriesRecordingPath: null
        };
        const message = 'The server did not confirm this save in time. Reload the latest values before trying again.';
        const saveDvr = vi.fn(async () => {
            throw new AdminLiveTvServiceError('save-timeout', message);
        });
        const state = {
            action: null,
            configuration: { dvr, providers: [], tuners: [] },
            initialLoading: false,
            refetchConfiguration: vi.fn(async () => ({ dvr, providers: [], tuners: [] })),
            refresh: vi.fn(async () => undefined),
            refreshing: false,
            saveDvr
        } as unknown as LiveTvState;

        await act(async () => root.render(
            <MemoryRouter>
                <AdminLiveTvDvrForm state={state} />
            </MemoryRouter>
        ));
        const prePadding = container.querySelector<HTMLInputElement>('#ptv-live-tv-pre-padding')!;
        setInputValue(prePadding, '61');

        await act(async () => {
            Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
                .find(button => button.textContent === 'Save Changes')
                ?.click();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(saveDvr).toHaveBeenCalledOnce();
        expect(container.textContent).toContain(message);
        expect(prePadding.value).toBe('61');
        expect(Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
            .find(button => button.textContent === 'Save Changes')?.disabled).toBe(false);
        expect(Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
            .find(button => button.textContent === 'Reset Changes')?.disabled).toBe(false);
    });
});
