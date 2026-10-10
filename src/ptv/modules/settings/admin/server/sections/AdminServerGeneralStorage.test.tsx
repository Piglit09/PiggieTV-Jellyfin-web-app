import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
    api: {},
    apiClient: { getCurrentUserId: () => 'admin-a', serverId: () => 'server-a' },
    configurationAvailable: true,
    loading: false,
    storageMounts: 0,
    storageUnmounts: 0,
    snapshot: {
        settings: {
            cachePath: 'F:/cache',
            libraryScanFanoutConcurrency: 0,
            metadataPath: 'F:/metadata',
            parallelImageEncodingLimit: 0,
            quickConnectAvailable: true,
            serverName: 'Test server',
            uiCulture: 'en-US'
        },
        system: {
            canSelfRestart: true,
            operatingSystem: 'Test OS',
            pendingRestart: false,
            productName: 'Jellyfin',
            version: '12.2.0'
        }
    }
}));

vi.mock('../../../../../../hooks/useApi', () => ({
    useApi: () => ({ __legacyApiClient__: fixture.apiClient, api: fixture.api })
}));

vi.mock('../useAdminServerConfiguration', () => ({
    useAdminServerGeneral: () => ({
        fetching: false,
        languages: [ { label: 'English', value: 'en-US' } ],
        languagesError: null,
        loading: fixture.loading,
        powerAction: null,
        refetch: vi.fn(),
        runPowerAction: vi.fn(),
        save: vi.fn(),
        saving: false,
        snapshot: fixture.configurationAvailable ? fixture.snapshot : null,
        systemError: null
    })
}));

vi.mock('../../configuration/useAdminUnsavedChanges', () => ({
    useAdminUnsavedChanges: vi.fn()
}));

vi.mock('../../storage/useAdminStorage', () => ({
    getAdminStorageAuthority: () => ({ authenticatedIdentity: 'server-a:admin-a', connection: 'https://example.test', serverId: 'server-a' }),
    useAdminStorage: () => {
        React.useEffect(() => {
            fixture.storageMounts += 1;
            return () => {
                fixture.storageUnmounts += 1;
            };
        }, []);
        return {
            data: {
                Libraries: [ {
                    Folders: [ { DeviceId: 'F:', FreeSpace: 750, Path: 'F:/movies', UsedSpace: 250 } ],
                    Id: 'movies',
                    Name: 'Movies'
                } ]
            },
            isError: false,
            isPending: false,
            refetch: vi.fn()
        };
    }
}));

import AdminServerGeneralPage from './AdminServerGeneralPage';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

describe('Server General storage visibility', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        fixture.configurationAvailable = true;
        fixture.loading = false;
        fixture.storageMounts = 0;
        fixture.storageUnmounts = 0;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    it('shows authoritative mount utilization alongside editable storage paths', async () => {
        await act(async () => root.render(<AdminServerGeneralPage />));

        expect(container.querySelector('[aria-label="Storage utilization"]')).toBeTruthy();
        expect(container.textContent).toContain('F:/movies');
        expect(container.textContent).toContain('25% used');
        expect(container.querySelector('#ptv-server-cache-path')).toBeTruthy();
    });

    it('shows storage while unrelated General configuration is still loading', async () => {
        fixture.configurationAvailable = false;
        fixture.loading = true;
        await act(async () => root.render(<AdminServerGeneralPage />));

        expect(container.querySelector('[aria-label="Loading administration settings"]')).toBeTruthy();
        expect(container.querySelector('[aria-label="Storage utilization"]')).toBeTruthy();
        expect(container.textContent).toContain('25% used');
    });

    it('shows storage when unrelated General configuration fails to load', async () => {
        fixture.configurationAvailable = false;
        await act(async () => root.render(<AdminServerGeneralPage />));

        expect(container.textContent).toContain("General settings couldn't be loaded.");
        expect(container.querySelector('[aria-label="Storage utilization"]')).toBeTruthy();
        expect(container.textContent).toContain('25% used');
    });

    it('keeps the storage query mounted through loading, error, and successful configuration', async () => {
        fixture.configurationAvailable = false;
        fixture.loading = true;
        await act(async () => root.render(<AdminServerGeneralPage />));
        expect(fixture.storageMounts).toBe(1);

        fixture.loading = false;
        await act(async () => root.render(<AdminServerGeneralPage />));
        expect(fixture.storageMounts).toBe(1);

        fixture.configurationAvailable = true;
        await act(async () => root.render(<AdminServerGeneralPage />));
        expect(container.textContent).toContain('25% used');
        expect(fixture.storageMounts).toBe(1);
        expect(fixture.storageUnmounts).toBe(0);
    });
});
