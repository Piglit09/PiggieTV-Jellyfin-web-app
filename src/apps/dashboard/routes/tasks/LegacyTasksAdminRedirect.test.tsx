import React, { act, useCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Component as LegacyTasksRedirect } from './index';
import { Component as LegacyTaskDetailRedirect } from './task';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

function LocationWithBack() {
    const location = useLocation();
    const navigate = useNavigate();
    const handleBack = useCallback(() => navigate(-1), [ navigate ]);

    return (
        <>
            <output>{location.pathname}</output>
            <button onClick={handleBack} type='button'>Back</button>
        </>
    );
}

describe('legacy Scheduled Tasks administration redirects', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    it('replaces the exact legacy task list route with the native workspace', async () => {
        await act(async () => root.render(
            <MemoryRouter initialEntries={[ '/before-tasks', '/dashboard/tasks' ]} initialIndex={1}>
                <Routes>
                    <Route path='/dashboard/tasks' element={<LegacyTasksRedirect />} />
                    <Route path='*' element={<LocationWithBack />} />
                </Routes>
            </MemoryRouter>
        ));

        expect(container.querySelector('output')?.textContent).toBe('/settings/admin/tasks');

        await act(async () => container.querySelector<HTMLButtonElement>('button')?.click());
        expect(container.querySelector('output')?.textContent).toBe('/before-tasks');
    });

    it('preserves and safely encodes the immutable task id on the detail redirect', async () => {
        await act(async () => root.render(
            <MemoryRouter initialEntries={[ '/before-task', '/dashboard/tasks/task%20one' ]} initialIndex={1}>
                <Routes>
                    <Route path='/dashboard/tasks/:id' element={<LegacyTaskDetailRedirect />} />
                    <Route path='*' element={<LocationWithBack />} />
                </Routes>
            </MemoryRouter>
        ));

        expect(container.querySelector('output')?.textContent).toBe('/settings/admin/tasks/task%20one');

        await act(async () => container.querySelector<HTMLButtonElement>('button')?.click());
        expect(container.querySelector('output')?.textContent).toBe('/before-task');
    });

    it('falls back safely when the detail redirect has no task id', async () => {
        await act(async () => root.render(
            <MemoryRouter initialEntries={[ '/dashboard/tasks' ]}>
                <Routes>
                    <Route path='*' element={<LegacyTaskDetailRedirect />} />
                    <Route path='/settings/admin/tasks' element={<LocationWithBack />} />
                </Routes>
            </MemoryRouter>
        ));

        expect(container.querySelector('output')?.textContent).toBe('/settings/admin/tasks');
    });
});
