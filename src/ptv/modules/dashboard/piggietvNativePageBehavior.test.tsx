import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pluginApiState = vi.hoisted(() => ({
    client: null as Record<string, ReturnType<typeof vi.fn>> | null
}));

vi.mock('../../core/pluginApi', () => {
    return {
        getCurrentPtvPluginApiClient: () => pluginApiState.client,
        getPtvPluginApiDiagnostics: vi.fn(() => ({})),
        getPtvPluginApiResolvedUrl: vi.fn(() => ''),
        normalizePtvApiError: vi.fn((error: unknown) => ({
            code: null,
            kind: 'unknown',
            message: error instanceof Error ? error.message : String(error),
            status: null
        }))
    };
});

vi.mock('../settings/admin/configuration/useAdminUnsavedChanges', () => ({
    useAdminUnsavedChanges: vi.fn()
}));

vi.mock('../cache/featuredContentCache', () => ({
    getFeaturedContentCacheStatus: vi.fn(() => ({
        heroCount: 0,
        isFresh: false,
        itemCount: 0,
        sectionCount: 0,
        storage: 'none'
    })),
    getPtvFeaturedRowConfigHash: vi.fn(() => 'test-hash'),
    hydrateFeaturedContentCacheFromDocument: vi.fn(),
    invalidateFeaturedContentMemoryCache: vi.fn(),
    primeFeaturedContentCacheStatus: vi.fn()
}));

vi.mock('../../api', () => ({
    getPtvCurrentUserId: vi.fn(() => 'test-user'),
    getPtvServerId: vi.fn(() => 'test-server')
}));

vi.mock('../../core/clientProfile', () => ({
    getPtvPerformanceProfile: vi.fn(() => ({
        isFireTv: false,
        isLowPower: false
    }))
}));

vi.mock('../../core/observability', () => ({
    recordPtvEvent: vi.fn(),
    shouldCollectDiagnostics: vi.fn(() => false)
}));

import PiggieTvRowsPage from './PiggieTvRowsPage';

async function flushAsyncWork() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await new Promise(resolve => window.setTimeout(resolve, 0));
    });
}

describe('PiggieTV native administration page behavior', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', false);
        pluginApiState.client = null;
        vi.restoreAllMocks();
    });

    it('mounts Home Rows read-only and exposes no writable defaults after both authoritative reads fail', async () => {
        const getRows = vi.fn().mockRejectedValue(new Error('rows unavailable'));
        const getSettings = vi.fn().mockRejectedValue(new Error('settings unavailable'));
        const saveRows = vi.fn();
        const saveSettings = vi.fn();
        const refreshFeaturedContentCacheDocument = vi.fn();

        pluginApiState.client = {
            getRows,
            getSettings,
            refreshFeaturedContentCacheDocument,
            saveRows,
            saveSettings
        };

        await act(async () => {
            root.render(<PiggieTvRowsPage />);
        });
        await flushAsyncWork();

        expect(getRows).toHaveBeenCalledTimes(1);
        expect(getSettings).toHaveBeenCalledTimes(1);
        expect(container.textContent).toContain('Home Row settings could not be loaded. No editable defaults were shown.');
        expect(container.textContent).not.toContain('Save Changes');
        expect(container.querySelectorAll('input')).toHaveLength(0);
        expect(saveRows).not.toHaveBeenCalled();
        expect(saveSettings).not.toHaveBeenCalled();
        expect(refreshFeaturedContentCacheDocument).not.toHaveBeenCalled();
    });
});
