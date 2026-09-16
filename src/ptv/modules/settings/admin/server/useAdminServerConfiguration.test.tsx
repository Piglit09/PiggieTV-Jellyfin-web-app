import type { Api } from '@jellyfin/sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const service = vi.hoisted(() => ({
    deleteAdminServerSplashscreen: vi.fn(),
    loadAdminServerBranding: vi.fn(),
    loadAdminServerGeneral: vi.fn(),
    loadAdminServerLocalizationOptions: vi.fn(),
    loadAdminServerNetworking: vi.fn(),
    loadAdminServerSystemInfo: vi.fn(),
    runAdminServerPowerAction: vi.fn(),
    saveAdminServerBranding: vi.fn(),
    saveAdminServerGeneral: vi.fn(),
    saveAdminServerNetworking: vi.fn(),
    uploadAdminServerSplashscreen: vi.fn()
}));

vi.mock('./adminServerConfigurationService', () => service);

import { resetAdminConfigurationSaveSettlementsForTests } from '../configuration/useAdminConfigurationSave';

import type {
    AdminServerBrandingSnapshot,
    AdminServerGeneralSnapshot,
    AdminServerNetworkingSaveResult,
    AdminServerNetworkingSnapshot
} from './adminServerConfigurationModel';
import {
    useAdminServerBranding,
    useAdminServerGeneral,
    useAdminServerNetworking
} from './useAdminServerConfiguration';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

type ConfigurationKind = 'branding' | 'general' | 'networking';
type HarnessState = Readonly<{
    invoke: (value: string) => Promise<unknown>;
    pending: boolean;
    value: string | null;
}>;

const api = {} as Api;
const apiClient = {
    serverId: () => 'server-a'
} as unknown as ApiClient;

const generalSettings = {
    cachePath: '/cache',
    libraryScanFanoutConcurrency: 2,
    metadataPath: '/metadata',
    parallelImageEncodingLimit: 4,
    quickConnectAvailable: true,
    serverName: 'initial',
    uiCulture: 'en-US'
} as const;
const brandingSettings = {
    customCss: '',
    loginDisclaimer: 'initial',
    splashscreenEnabled: true
} as const;
const networkingSettings = {
    autoDiscovery: true,
    baseUrl: '',
    certificatePasswordConfigured: true,
    certificatePath: '/cert.pfx',
    enableHttps: true,
    enableIPv4: true,
    enableIPv6: false,
    enableRemoteAccess: true,
    internalHttpPort: 8096,
    internalHttpsPort: 8920,
    isRemoteIPFilterBlacklist: true,
    knownProxies: [],
    localNetworkAddresses: [],
    localNetworkSubnets: [],
    publicHttpPort: 8096,
    publicHttpsPort: 8920,
    publishedServerUriBySubnet: [],
    remoteIPFilter: [],
    requireHttps: false
} as const;

const generalSnapshot = (value = 'initial'): AdminServerGeneralSnapshot => ({
    settings: { ...generalSettings, serverName: value },
    system: null
});
const brandingSnapshot = (value = 'initial'): AdminServerBrandingSnapshot => ({
    settings: { ...brandingSettings, loginDisclaimer: value }
});
const networkingSnapshot = (value = '8096'): AdminServerNetworkingSnapshot => ({
    authority: {},
    settings: { ...networkingSettings, internalHttpPort: Number(value) }
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function GeneralHarness({
    saveTimeoutMs,
    stateRef
}: Readonly<{
    saveTimeoutMs: number;
    stateRef: { current?: HarnessState };
}>) {
    const state = useAdminServerGeneral(api, apiClient, { saveTimeoutMs });
    stateRef.current = {
        invoke: value => state.save(
            { ...generalSettings, serverName: value },
            generalSettings
        ),
        pending: state.saving,
        value: state.snapshot?.settings.serverName || null
    };
    return null;
}

function BrandingHarness({
    saveTimeoutMs,
    stateRef
}: Readonly<{
    saveTimeoutMs: number;
    stateRef: { current?: HarnessState };
}>) {
    const state = useAdminServerBranding(api, apiClient, { saveTimeoutMs });
    stateRef.current = {
        invoke: value => state.save(
            { ...brandingSettings, loginDisclaimer: value },
            brandingSettings
        ),
        pending: state.busyAction === 'save',
        value: state.snapshot?.settings.loginDisclaimer || null
    };
    return null;
}

function NetworkingHarness({
    saveTimeoutMs,
    stateRef
}: Readonly<{
    saveTimeoutMs: number;
    stateRef: { current?: HarnessState };
}>) {
    const state = useAdminServerNetworking(api, apiClient, { saveTimeoutMs });
    stateRef.current = {
        invoke: value => state.save(
            { ...networkingSettings, internalHttpPort: Number(value) },
            state.snapshot!,
            { mode: 'unchanged' }
        ),
        pending: state.saving,
        value: state.snapshot ? String(state.snapshot.settings.internalHttpPort) : null
    };
    return null;
}

function harness(
    kind: ConfigurationKind,
    stateRef: { current?: HarnessState },
    saveTimeoutMs: number
) {
    const props = { saveTimeoutMs, stateRef };
    if (kind === 'general') return <GeneralHarness {...props} />;
    if (kind === 'branding') return <BrandingHarness {...props} />;
    return <NetworkingHarness {...props} />;
}

function getSaveMock(kind: ConfigurationKind) {
    if (kind === 'general') return service.saveAdminServerGeneral;
    if (kind === 'branding') return service.saveAdminServerBranding;
    return service.saveAdminServerNetworking;
}

function saveResult(kind: ConfigurationKind, value: string) {
    if (kind === 'general') return generalSnapshot(value);
    if (kind === 'branding') return brandingSnapshot(value);
    return {
        snapshot: networkingSnapshot(value),
        verification: 'confirmed'
    } satisfies AdminServerNetworkingSaveResult;
}

function testValue(kind: ConfigurationKind, label: string) {
    if (kind !== 'networking') return label;
    const ports: Record<string, string> = {
        failed: '8100',
        'late-retired': '8102',
        recovered: '8098',
        retired: '8101',
        saved: '8097'
    };
    return ports[label] || '8199';
}

async function flushQueries() {
    await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
        await Promise.resolve();
    });
}

describe('Server configuration bounded save lifecycle', () => {
    let container: HTMLDivElement;
    let queryClient: QueryClient;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        queryClient = new QueryClient({
            defaultOptions: { queries: { gcTime: Infinity, retry: false } }
        });
        service.loadAdminServerGeneral.mockResolvedValue(generalSnapshot());
        service.loadAdminServerSystemInfo.mockResolvedValue(null);
        service.loadAdminServerLocalizationOptions.mockResolvedValue([]);
        service.loadAdminServerBranding.mockResolvedValue(brandingSnapshot());
        service.loadAdminServerNetworking.mockResolvedValue(networkingSnapshot());
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

    it.each<ConfigurationKind>([ 'general', 'branding', 'networking' ])(
        '%s save is single-flight, publishes only its verified result, and clears pending',
        async kind => {
            const savedValue = testValue(kind, 'saved');
            const pending = deferred<unknown>();
            const saveMock = getSaveMock(kind).mockReturnValueOnce(pending.promise);
            const cancelSpy = vi.spyOn(queryClient, 'cancelQueries');
            const stateRef: { current?: HarnessState } = {};
            await act(async () => root.render(
                <QueryClientProvider client={queryClient}>
                    {harness(kind, stateRef, 100)}
                </QueryClientProvider>
            ));
            await flushQueries();

            let first!: Promise<unknown>;
            let second!: Promise<unknown>;
            await act(async () => {
                first = stateRef.current!.invoke(savedValue);
                second = stateRef.current!.invoke(savedValue);
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(first).toBe(second);
            expect(stateRef.current?.pending).toBe(true);
            expect(saveMock).toHaveBeenCalledOnce();
            expect(saveMock.mock.calls[0].at(-1)).toBeInstanceOf(AbortSignal);
            expect(cancelSpy).toHaveBeenCalledWith(expect.objectContaining({ exact: true }));

            await act(async () => {
                pending.resolve(saveResult(kind, savedValue));
                await first;
            });
            await flushQueries();

            expect(stateRef.current?.pending).toBe(false);
            expect(stateRef.current?.value).toBe(savedValue);
        }
    );

    it.each<ConfigurationKind>([ 'general', 'branding', 'networking' ])(
        '%s save failure clears pending state and permits a successful retry',
        async kind => {
            const failedValue = testValue(kind, 'failed');
            const recoveredValue = testValue(kind, 'recovered');
            const failure = new Error('request failed');
            const saveMock = getSaveMock(kind)
                .mockRejectedValueOnce(failure)
                .mockResolvedValueOnce(saveResult(kind, recoveredValue));
            const stateRef: { current?: HarnessState } = {};
            await act(async () => root.render(
                <QueryClientProvider client={queryClient}>
                    {harness(kind, stateRef, 100)}
                </QueryClientProvider>
            ));
            await flushQueries();

            let observed: unknown;
            await act(async () => {
                try {
                    await stateRef.current!.invoke(failedValue);
                } catch (error) {
                    observed = error;
                }
            });
            expect(observed).toBe(failure);
            expect(stateRef.current?.pending).toBe(false);
            expect(stateRef.current?.value).toBe(kind === 'networking' ? '8096' : 'initial');

            await act(async () => {
                await stateRef.current!.invoke(recoveredValue);
            });
            await flushQueries();

            expect(saveMock).toHaveBeenCalledTimes(2);
            expect(stateRef.current?.pending).toBe(false);
            expect(stateRef.current?.value).toBe(recoveredValue);
        }
    );

    it.each<ConfigurationKind>([ 'general', 'branding', 'networking' ])(
        '%s timeout aborts, allows retry, and rejects a retired late cache write',
        async kind => {
            const lateValue = testValue(kind, 'late-retired');
            const recoveredValue = testValue(kind, 'recovered');
            const retiredValue = testValue(kind, 'retired');
            const retired = deferred<unknown>();
            const saveMock = getSaveMock(kind)
                .mockReturnValueOnce(retired.promise)
                .mockResolvedValueOnce(saveResult(kind, recoveredValue));
            const stateRef: { current?: HarnessState } = {};
            await act(async () => root.render(
                <QueryClientProvider client={queryClient}>
                    {harness(kind, stateRef, 30)}
                </QueryClientProvider>
            ));
            await flushQueries();

            let failure: unknown;
            await act(async () => {
                try {
                    await stateRef.current!.invoke(retiredValue);
                } catch (error) {
                    failure = error;
                }
            });

            expect(failure).toMatchObject({
                code: 'server-save-timeout',
                message: 'The server did not confirm this save in time. Reload the latest values before trying again.'
            });
            expect(saveMock.mock.calls[0].at(-1)).toMatchObject({ aborted: true });
            expect(stateRef.current?.pending).toBe(false);

            let retry!: Promise<unknown>;
            await act(async () => {
                retry = stateRef.current!.invoke(recoveredValue);
                await Promise.resolve();
            });
            expect(saveMock).toHaveBeenCalledOnce();

            await act(async () => {
                retired.resolve(saveResult(kind, lateValue));
                await retry;
            });
            await flushQueries();

            expect(stateRef.current?.value).toBe(recoveredValue);
            expect(stateRef.current?.pending).toBe(false);
        }
    );

    it.each<ConfigurationKind>([ 'general', 'branding', 'networking' ])(
        '%s bounds query cancellation and prevents a retired request from reaching the service',
        async kind => {
            const recoveredValue = testValue(kind, 'recovered');
            const retiredValue = testValue(kind, 'retired');
            const retiredCancellation = deferred<void>();
            vi.spyOn(queryClient, 'cancelQueries')
                .mockReturnValueOnce(retiredCancellation.promise)
                .mockResolvedValueOnce(undefined);
            const saveMock = getSaveMock(kind)
                .mockResolvedValue(saveResult(kind, recoveredValue));
            const stateRef: { current?: HarnessState } = {};
            await act(async () => root.render(
                <QueryClientProvider client={queryClient}>
                    {harness(kind, stateRef, 10)}
                </QueryClientProvider>
            ));
            await flushQueries();

            let failure: unknown;
            await act(async () => {
                try {
                    await stateRef.current!.invoke(retiredValue);
                } catch (error) {
                    failure = error;
                }
            });
            expect(failure).toMatchObject({ code: 'server-save-timeout' });
            expect(saveMock).not.toHaveBeenCalled();
            expect(stateRef.current?.pending).toBe(false);

            await act(async () => {
                retiredCancellation.resolve();
                await retiredCancellation.promise;
            });
            await flushQueries();
            expect(saveMock).not.toHaveBeenCalled();

            await act(async () => {
                await stateRef.current!.invoke(recoveredValue);
            });
            await flushQueries();
            expect(saveMock).toHaveBeenCalledOnce();
            expect(stateRef.current?.value).toBe(recoveredValue);
        }
    );
});
