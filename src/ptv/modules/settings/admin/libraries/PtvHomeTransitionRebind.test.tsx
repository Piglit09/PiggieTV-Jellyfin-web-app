import type { Api } from '@jellyfin/sdk';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HomeTransitionResponse } from '../../../../core/pluginApi';

const service = vi.hoisted(() => ({ load: vi.fn(), rebind: vi.fn(), retryConvergence: vi.fn(), retryGeneration: vi.fn() }));
vi.mock('./adminLibrariesService', () => ({
    loadAdminLibraryTransition: service.load,
    rebindAdminLibraryTransition: service.rebind,
    retryAdminLibraryTransitionConvergence: service.retryConvergence,
    retryAdminLibraryTransitionGeneration: service.retryGeneration
}));

import PtvHomeTransitionRebind from './PtvHomeTransitionRebind';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

const api = {} as Api;
const folderId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
function diagnostic(overrides: Partial<HomeTransitionResponse> = {}): HomeTransitionResponse {
    return {
        operationId: 'operation-a', epoch: 'a'.repeat(64), held: true, state: 'pending',
        affectedRuleIds: ['anime'], authority: 'binding-required', writeAllowed: false,
        library: { ItemId: folderId, Name: 'Current Anime', Locations: ['/local', '/das'] },
        ...overrides
    };
}

describe('administrator Home transition rebind', () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => {
        vi.clearAllMocks();
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });
    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });
    async function render(transition: HomeTransitionResponse) {
        await act(async () => root.render(<PtvHomeTransitionRebind api={api} transition={transition} />));
    }
    it('never offers a malformed epoch as a verified folder selection', async () => {
        await render(diagnostic({ epoch: 'storage-hint' }));
        expect(container.textContent).toContain('Current library identity is not verified');
        expect(container.querySelector('input[type="radio"]')).toBeNull();
        expect(service.rebind).not.toHaveBeenCalled();
    });
    it('still requires explicit binding after the Plugin releases its broad hold', async () => {
        await render(diagnostic({ held: false, state: 'complete' }));
        expect(container.textContent).toContain('Rebind Home rows');
        expect(container.textContent).toContain('Affected Home rules');
        expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
        expect(container.querySelector<HTMLInputElement>(`input[value="${folderId}"]`)?.checked).toBe(false);
        expect(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Confirm Home binding')?.disabled).toBe(true);
        expect(container.textContent).not.toContain('Home transition completed');
    });
    it('does not call a released broad hold completed while affected rules still need binding', async () => {
        const released = diagnostic({ held: false, state: 'complete' });
        service.rebind.mockResolvedValueOnce({ ...released, epoch: 'b'.repeat(64) });
        await render(released);
        await act(async () => {
            container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
            container.querySelector<HTMLInputElement>('input[type="radio"]')?.click();
        });
        await act(async () => {
            Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Confirm Home binding')?.click();
            await Promise.resolve();
        });
        expect(service.rebind).toHaveBeenCalledOnce();
        expect(container.textContent).toContain('still need binding');
        expect(container.textContent).not.toContain('Home transition completed');
    });
    it('reports completion after a same-epoch bound retry of an already-released operation', async () => {
        const released = diagnostic({ held: false, state: 'complete' });
        service.rebind.mockResolvedValueOnce({ ...released, authority: 'bound', affectedRuleIds: [] });
        await render(released);
        await act(async () => {
            container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
            container.querySelector<HTMLInputElement>('input[type="radio"]')?.click();
        });
        await act(async () => {
            Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Confirm Home binding')?.click();
            await Promise.resolve();
        });
        expect(service.rebind).toHaveBeenCalledOnce();
        expect(container.textContent).toContain('Home transition completed');
        expect(container.textContent).not.toContain('still need binding');
    });
    it('does not report a held pre-rebind operation complete from a same-epoch reply', async () => {
        const held = diagnostic();
        service.rebind.mockResolvedValueOnce({ ...held, held: false, state: 'complete',
            authority: 'bound', affectedRuleIds: [] });
        await render(held);
        await act(async () => {
            container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
            container.querySelector<HTMLInputElement>('input[type="radio"]')?.click();
        });
        await act(async () => {
            Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Confirm Home binding')?.click();
            await Promise.resolve();
        });
        expect(container.textContent).not.toContain('Home transition completed');
    });
    it('checks unresolved server readback only after the administrator asks', async () => {
        service.load.mockResolvedValueOnce(diagnostic());
        await render(diagnostic({ authority: 'unresolved', library: null }));
        expect(service.load).not.toHaveBeenCalled();
        expect(container.querySelector('input[type="radio"]')).toBeNull();
        await act(async () => {
            Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Check current state')?.click();
            await Promise.resolve();
        });
        expect(service.load).toHaveBeenCalledWith(api);
        expect(container.querySelector<HTMLInputElement>(`input[value="${folderId}"]`)?.checked).toBe(false);
    });
    it.each(['pending', 'failed'] as const)('retries held %s Jellyfin convergence only after an administrator click', async state => {
        const held = diagnostic({ state, authority: 'unresolved', library: null });
        service.retryConvergence.mockResolvedValueOnce(held);
        await render(held);
        const retry = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Retry Jellyfin convergence');
        expect(retry).toBeDefined();
        expect(service.retryConvergence).not.toHaveBeenCalled();
        expect(service.load).not.toHaveBeenCalled();
        await act(async () => {
            retry?.click();
            await Promise.resolve();
        });
        expect(service.retryConvergence).toHaveBeenCalledOnce();
        expect(service.retryConvergence).toHaveBeenCalledWith(api, held);
        expect(service.rebind).not.toHaveBeenCalled();
        expect(service.retryGeneration).not.toHaveBeenCalled();
        expect(container.textContent).toContain('Jellyfin convergence is still unverified');
        expect(container.textContent).not.toContain('Home transition completed');
    });
    it('offers an explicit binding choice after convergence resolves but affected rules remain', async () => {
        const held = diagnostic({ authority: 'unresolved', library: null });
        service.retryConvergence.mockResolvedValueOnce(diagnostic({ held: false, state: 'complete', authority: 'binding-required' }));
        await render(held);
        await act(async () => {
            Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Retry Jellyfin convergence')?.click();
            await Promise.resolve();
        });
        expect(container.textContent).toContain('Affected Home rows still need binding');
        expect(container.textContent).not.toContain('Home transition completed');
        expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(false);
        expect(container.querySelector<HTMLInputElement>(`input[value="${folderId}"]`)?.checked).toBe(false);
        expect(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Confirm Home binding')?.disabled).toBe(true);
        expect(service.rebind).not.toHaveBeenCalled();
    });
    it('reports final bound authority after an explicit convergence retry', async () => {
        const held = diagnostic({ authority: 'unresolved', library: null });
        service.retryConvergence.mockResolvedValueOnce(diagnostic({ held: false, state: 'complete', authority: 'bound',
            affectedRuleIds: [], library: null }));
        await render(held);
        await act(async () => {
            Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Retry Jellyfin convergence')?.click();
            await Promise.resolve();
        });
        expect(container.textContent).toContain('Home transition completed');
    });
    it.each([
        ['binding required', { authority: 'binding-required' as const }],
        ['released', { held: false, state: 'complete' as const }],
        ['malformed epoch', { epoch: 'storage-hint' }]
    ])('does not offer convergence retry for %s', async (_name, overrides) => {
        await render(diagnostic({ authority: 'unresolved', library: null, ...overrides }));
        expect(Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Retry Jellyfin convergence')).toBeUndefined();
        expect(service.retryConvergence).not.toHaveBeenCalled();
    });
    it('keeps the operation held when the Plugin rejects the selected binding', async () => {
        service.rebind.mockRejectedValueOnce(new Error('conflict'));
        await render(diagnostic());
        await act(async () => {
            container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click();
            container.querySelector<HTMLInputElement>('input[type="radio"]')?.click();
        });
        await act(async () => {
            Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Confirm Home binding')?.click();
            await Promise.resolve();
        });
        expect(container.textContent).toContain('Home rows remain unavailable');
        expect(container.textContent).not.toContain('Home transition completed');
    });
    it('offers an explicit generation retry after broad release with no pending rules', async () => {
        const pending = diagnostic({ held: false, state: 'complete', authority: 'generation-pending',
            affectedRuleIds: [], library: null });
        service.retryGeneration.mockResolvedValueOnce({ ...pending, authority: 'bound' });
        await render(pending);
        expect(container.textContent).toContain('Home generation is pending');
        expect(container.querySelector('input[type="checkbox"]')).toBeNull();
        expect(container.querySelector('input[type="radio"]')).toBeNull();
        expect(service.retryGeneration).not.toHaveBeenCalled();
        await act(async () => {
            Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Retry Home generation')?.click();
            await Promise.resolve();
        });
        expect(service.retryGeneration).toHaveBeenCalledWith(api, pending);
        expect(container.textContent).toContain('Home transition completed');
    });
    it('does not report completion when generation retry remains pending', async () => {
        const pending = diagnostic({ held: false, state: 'complete', authority: 'generation-pending',
            affectedRuleIds: [], library: null });
        service.retryGeneration.mockResolvedValueOnce(pending);
        await render(pending);
        await act(async () => {
            Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Retry Home generation')?.click();
            await Promise.resolve();
        });
        expect(container.textContent).toContain('Home generation is pending');
        expect(container.textContent).not.toContain('Home transition completed');
    });
    it('describes a failed current-state check as unavailable after the broad hold has released', async () => {
        const pending = diagnostic({ held: false, state: 'complete', authority: 'generation-pending',
            affectedRuleIds: [], library: null });
        service.load.mockRejectedValueOnce(new Error('unavailable'));
        await render(pending);
        await act(async () => {
            Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Check current state')?.click();
            await Promise.resolve();
        });
        expect(container.textContent).toContain('Home rows remain unavailable');
        expect(container.textContent).not.toContain('Home rows remain held');
    });
});
