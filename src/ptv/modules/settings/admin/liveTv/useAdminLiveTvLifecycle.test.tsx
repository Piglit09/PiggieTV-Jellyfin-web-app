import type { Api } from '@jellyfin/sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetAdminConfigurationSaveSettlementsForTests } from '../configuration/useAdminConfigurationSave';

import {
    AdminLiveTvServiceError,
    type AdminLiveTvConfigurationSnapshot,
    type AdminLiveTvDvrSettings
} from './adminLiveTvModel';

const serviceMocks = vi.hoisted(() => ({
    loadCapability: vi.fn(),
    loadConfiguration: vi.fn(),
    loadTunerTypes: vi.fn(),
    saveDvr: vi.fn()
}));

const taskMocks = vi.hoisted(() => ({
    load: vi.fn(),
    run: vi.fn()
}));

vi.mock('./adminLiveTvService', async () => {
    const actual = await vi.importActual<typeof import('./adminLiveTvService')>('./adminLiveTvService');
    return {
        ...actual,
        loadAdminLiveTvCapability: serviceMocks.loadCapability,
        loadAdminLiveTvConfiguration: serviceMocks.loadConfiguration,
        loadAdminLiveTvTunerTypes: serviceMocks.loadTunerTypes,
        saveAdminLiveTvDvr: serviceMocks.saveDvr
    };
});

vi.mock('../tasks/adminTasksService', async () => {
    const actual = await vi.importActual<typeof import('../tasks/adminTasksService')>('../tasks/adminTasksService');
    return {
        ...actual,
        loadAdminTasks: taskMocks.load,
        runAdminTask: taskMocks.run
    };
});

import { getAdminLiveTvQueryKeys, useAdminLiveTv } from './useAdminLiveTv';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

const api = {} as Api;
const apiClient = { serverId: () => 'server-a' } as ApiClient;

function dvr(overrides: Partial<AdminLiveTvDvrSettings> = {}): AdminLiveTvDvrSettings {
    return {
        guideDays: 7,
        movieRecordingPath: null,
        postPaddingSeconds: 120,
        prePaddingSeconds: 60,
        recordingPath: null,
        recordingPostProcessor: null,
        recordingPostProcessorArguments: null,
        saveRecordingImages: false,
        saveRecordingNfo: false,
        seriesRecordingPath: null,
        ...overrides
    };
}

function snapshot(settings = dvr()): AdminLiveTvConfigurationSnapshot {
    return { dvr: settings, providers: [], tuners: [] };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

let latest: ReturnType<typeof useAdminLiveTv> | null = null;

function Harness({ timeoutMs = 100 }: Readonly<{ timeoutMs?: number }>) {
    latest = useAdminLiveTv(api, apiClient, { dvrSaveTimeoutMs: timeoutMs });
    return null;
}

async function flush() {
    await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
    });
}

describe('Live TV DVR configuration save lifecycle', () => {
    let container: HTMLDivElement;
    let queryClient: QueryClient;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        latest = null;
        serviceMocks.loadCapability.mockResolvedValue({ availability: 'available', serviceCount: 1 });
        serviceMocks.loadConfiguration.mockResolvedValue(snapshot());
        serviceMocks.loadTunerTypes.mockResolvedValue([]);
        serviceMocks.saveDvr.mockResolvedValue(snapshot(dvr({ guideDays: 8 })));
        taskMocks.load.mockResolvedValue([]);
        taskMocks.run.mockResolvedValue(undefined);
        queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        resetAdminConfigurationSaveSettlementsForTests();
        queryClient.clear();
        container.remove();
    });

    async function render(timeoutMs = 100) {
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness timeoutMs={timeoutMs} />
            </QueryClientProvider>
        ));
        await flush();
        await vi.waitFor(() => expect(latest?.configuration).not.toBeNull());
    }

    it('single-flights a successful save, forwards cancellation, and commits the confirmed snapshot', async () => {
        const pending = deferred<AdminLiveTvConfigurationSnapshot>();
        const saved = snapshot(dvr({ guideDays: 8 }));
        serviceMocks.saveDvr.mockReturnValue(pending.promise);
        await render();

        let first!: Promise<AdminLiveTvConfigurationSnapshot>;
        let second!: Promise<AdminLiveTvConfigurationSnapshot>;
        await act(async () => {
            first = latest!.saveDvr(saved.dvr, dvr());
            second = latest!.saveDvr(saved.dvr, dvr());
            await Promise.resolve();
        });

        expect(first).toBe(second);
        expect(latest?.action).toBe('dvr:save');
        expect(serviceMocks.saveDvr).toHaveBeenCalledWith(api, saved.dvr, dvr(), expect.any(AbortSignal));

        await act(async () => {
            pending.resolve(saved);
            await first;
        });

        expect(latest?.action).toBeNull();
        expect(latest?.feedback).toEqual({ message: 'DVR settings saved.', tone: 'success' });
        expect(queryClient.getQueryData(getAdminLiveTvQueryKeys('server-a').configuration)).toEqual(saved);
    });

    it('times out query cancellation as part of the whole save and remains retryable', async () => {
        await render(10);
        const cancel = vi.spyOn(queryClient, 'cancelQueries')
            .mockReturnValueOnce(new Promise<void>(() => undefined));

        let failure: unknown;
        await act(async () => {
            try {
                await latest!.saveDvr(dvr({ guideDays: 8 }), dvr());
            } catch (error) {
                failure = error;
            }
        });

        expect(failure).toMatchObject({ code: 'save-timeout' });
        expect(serviceMocks.saveDvr).not.toHaveBeenCalled();
        expect(latest?.action).toBeNull();

        cancel.mockRestore();
        await act(async () => {
            await latest!.saveDvr(dvr({ guideDays: 8 }), dvr());
        });
        expect(serviceMocks.saveDvr).toHaveBeenCalledOnce();
        expect(latest?.action).toBeNull();
    });

    it('rejects a late response after timeout without publishing it to the cache', async () => {
        const pending = deferred<AdminLiveTvConfigurationSnapshot>();
        let saveSignal: AbortSignal | undefined;
        serviceMocks.saveDvr.mockImplementation((...args: unknown[]) => {
            saveSignal = args[3] as AbortSignal;
            return pending.promise;
        });
        await render(10);
        const original = queryClient.getQueryData(getAdminLiveTvQueryKeys('server-a').configuration);

        await act(async () => {
            await expect(latest!.saveDvr(dvr({ guideDays: 9 }), dvr())).rejects.toMatchObject({
                code: 'save-timeout'
            });
        });
        expect(saveSignal?.aborted).toBe(true);
        expect(latest?.action).toBeNull();

        await act(async () => {
            pending.resolve(snapshot(dvr({ guideDays: 9 })));
            await Promise.resolve();
        });
        expect(queryClient.getQueryData(getAdminLiveTvQueryKeys('server-a').configuration)).toEqual(original);
    });

    it('clears failure state and permits a successful retry', async () => {
        serviceMocks.saveDvr
            .mockRejectedValueOnce(new AdminLiveTvServiceError('operation-failed', 'Save rejected.'))
            .mockResolvedValueOnce(snapshot(dvr({ guideDays: 8 })));
        await render();

        await act(async () => {
            await expect(latest!.saveDvr(dvr({ guideDays: 8 }), dvr())).rejects.toThrow('Save rejected.');
        });
        expect(latest?.action).toBeNull();
        expect(latest?.feedback).toEqual({ message: 'Save rejected.', tone: 'error' });

        await act(async () => {
            await latest!.saveDvr(dvr({ guideDays: 8 }), dvr());
        });
        expect(latest?.action).toBeNull();
        expect(latest?.feedback?.tone).toBe('success');
    });
});
