import type { Api } from '@jellyfin/sdk';
import type { CountryInfo } from '@jellyfin/sdk/lib/generated-client/models/country-info';
import type { CultureDto } from '@jellyfin/sdk/lib/generated-client/models/culture-dto';
import { ImageResolution } from '@jellyfin/sdk/lib/generated-client/models/image-resolution';
import type { ServerConfiguration } from '@jellyfin/sdk/lib/generated-client/models/server-configuration';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
    loadAdminMetadataConfiguration: vi.fn(),
    loadAdminMetadataCountries: vi.fn(),
    loadAdminMetadataCultures: vi.fn(),
    saveAdminMetadata: vi.fn()
}));

vi.mock('./adminMetadataService', () => serviceMocks);

import { resetAdminConfigurationSaveSettlementsForTests } from '../configuration/useAdminConfigurationSave';

import {
    getAdminMetadataQueryKeys,
    useAdminMetadata
} from './useAdminMetadata';
import {
    AdminMetadataServiceError,
    type AdminMetadataSettings,
    type AdminMetadataSnapshot
} from './adminMetadataModel';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

const api = {} as Api;
const apiClient = (serverId: string) => ({
    serverId: () => serverId
} as unknown as ApiClient);
const confirmed: AdminMetadataSettings = {
    chapterImageResolution: ImageResolution.P720,
    dummyChapterDurationSeconds: 300,
    preferredCountryCode: 'ZZ',
    preferredLanguage: 'custom-language'
};

function snapshot(settings: AdminMetadataSettings = confirmed): AdminMetadataSnapshot {
    return {
        serverConfiguration: {
            ChapterImageResolution: settings.chapterImageResolution,
            DummyChapterDuration: settings.dummyChapterDurationSeconds,
            MetadataCountryCode: settings.preferredCountryCode,
            PreferredMetadataLanguage: settings.preferredLanguage
        } as ServerConfiguration,
        settings
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

type HookState = ReturnType<typeof useAdminMetadata>;

function Harness({
    client = apiClient('server-a'),
    jellyfinApi = api,
    saveTimeoutMs,
    stateRef
}: Readonly<{
    client?: ApiClient;
    jellyfinApi?: Api;
    saveTimeoutMs?: number;
    stateRef: { current?: HookState };
}>) {
    stateRef.current = useAdminMetadata(jellyfinApi, client, saveTimeoutMs);
    return null;
}

async function flushQueries() {
    await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
        await Promise.resolve();
    });
}

describe('administrator Metadata hook', () => {
    let container: HTMLDivElement;
    let queryClient: QueryClient;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        serviceMocks.loadAdminMetadataConfiguration.mockResolvedValue(snapshot());
        serviceMocks.loadAdminMetadataCultures.mockResolvedValue([
            { DisplayName: 'English', TwoLetterISOLanguageName: 'en' }
        ] satisfies CultureDto[]);
        serviceMocks.loadAdminMetadataCountries.mockResolvedValue([
            { DisplayName: 'United States', TwoLetterISORegionName: 'US' }
        ] satisfies CountryInfo[]);
        serviceMocks.saveAdminMetadata.mockResolvedValue(snapshot());
        queryClient = new QueryClient({
            defaultOptions: { queries: { gcTime: Infinity, retry: false } }
        });
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

    it('uses three source-specific query identities isolated by server', () => {
        expect(getAdminMetadataQueryKeys('server-a')).toEqual({
            configuration: [
                'PtvAdminMetadata',
                'server-a',
                'configuration',
                'System/Configuration'
            ],
            countries: [
                'PtvAdminMetadata',
                'server-a',
                'catalog',
                'Localization/Countries'
            ],
            cultures: [
                'PtvAdminMetadata',
                'server-a',
                'catalog',
                'Localization/Cultures'
            ]
        });
        expect(getAdminMetadataQueryKeys('server-a')).not.toEqual(
            getAdminMetadataQueryKeys('server-b')
        );
    });

    it('loads all three independent sources with AbortSignals and does not poll', async () => {
        const stateRef: { current?: HookState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(serviceMocks.loadAdminMetadataConfiguration).toHaveBeenCalledWith(
            api,
            expect.any(AbortSignal)
        );
        expect(serviceMocks.loadAdminMetadataCultures).toHaveBeenCalledWith(
            api,
            expect.any(AbortSignal)
        );
        expect(serviceMocks.loadAdminMetadataCountries).toHaveBeenCalledWith(
            api,
            expect.any(AbortSignal)
        );
        expect(stateRef.current?.settings).toEqual(confirmed);

        await new Promise(resolve => setTimeout(resolve, 20));
        expect(serviceMocks.loadAdminMetadataConfiguration).toHaveBeenCalledOnce();
        expect(serviceMocks.loadAdminMetadataCultures).toHaveBeenCalledOnce();
        expect(serviceMocks.loadAdminMetadataCountries).toHaveBeenCalledOnce();
    });

    it('keeps configured values and settings usable when both catalogs fail', async () => {
        serviceMocks.loadAdminMetadataCultures.mockRejectedValue(
            new AdminMetadataServiceError('cultures-unavailable', 'Languages unavailable.')
        );
        serviceMocks.loadAdminMetadataCountries.mockRejectedValue(
            new AdminMetadataServiceError('countries-unavailable', 'Countries unavailable.')
        );
        const stateRef: { current?: HookState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(stateRef.current?.settings).toEqual(confirmed);
        expect(stateRef.current?.languages).toEqual([{
            available: false,
            label: 'custom-language',
            value: 'custom-language'
        }]);
        expect(stateRef.current?.countries).toEqual([{
            available: false,
            label: 'ZZ',
            value: 'ZZ'
        }]);
        expect(stateRef.current?.languagesError).toBeInstanceOf(Error);
        expect(stateRef.current?.countriesError).toBeInstanceOf(Error);

        await act(async () => {
            await stateRef.current!.save({
                ...confirmed,
                dummyChapterDurationSeconds: 600
            }, confirmed);
        });
        expect(serviceMocks.saveAdminMetadata).toHaveBeenCalledWith(api, {
            ...confirmed,
            dummyChapterDurationSeconds: 600
        }, confirmed, expect.any(AbortSignal));
    });

    it('does not load without both API and stable server identity', async () => {
        const stateRef: { current?: HookState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness client={apiClient('')} stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(serviceMocks.loadAdminMetadataConfiguration).not.toHaveBeenCalled();
        expect(serviceMocks.loadAdminMetadataCultures).not.toHaveBeenCalled();
        expect(serviceMocks.loadAdminMetadataCountries).not.toHaveBeenCalled();
    });

    it('keeps save single-flight, cancels only configuration, and updates its exact cache', async () => {
        const stateRef: { current?: HookState } = {};
        const desired = { ...confirmed, dummyChapterDurationSeconds: 600 };
        const saved = snapshot(desired);
        const pendingSave = deferred<AdminMetadataSnapshot>();
        serviceMocks.saveAdminMetadata.mockReturnValue(pendingSave.promise);
        const cancelSpy = vi.spyOn(queryClient, 'cancelQueries');
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        let first!: Promise<AdminMetadataSnapshot>;
        let second!: Promise<AdminMetadataSnapshot>;
        await act(async () => {
            first = stateRef.current!.save(desired, confirmed);
            second = stateRef.current!.save(desired, confirmed);
            await Promise.resolve();
        });

        expect(first).toBe(second);
        expect(serviceMocks.saveAdminMetadata).toHaveBeenCalledOnce();
        expect(cancelSpy).toHaveBeenCalledWith({
            exact: true,
            queryKey: getAdminMetadataQueryKeys('server-a').configuration
        });

        await act(async () => {
            pendingSave.resolve(saved);
            await first;
        });

        expect(queryClient.getQueryData(
            getAdminMetadataQueryKeys('server-a').configuration
        )).toEqual(saved);
        expect(invalidateSpy).not.toHaveBeenCalled();
        expect(stateRef.current?.settings).toEqual(desired);
        expect(stateRef.current?.saving).toBe(false);
    });

    it('bounds query cancellation, releases the UI, and permits a retry', async () => {
        const stateRef: { current?: HookState } = {};
        const desired = { ...confirmed, dummyChapterDurationSeconds: 600 };
        const cancelSpy = vi.spyOn(queryClient, 'cancelQueries')
            .mockImplementation(() => new Promise(() => undefined));
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness saveTimeoutMs={20} stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        let timedOut!: Promise<AdminMetadataSnapshot>;
        await act(async () => {
            timedOut = stateRef.current!.save(desired, confirmed);
            await Promise.resolve();
        });
        expect(stateRef.current?.saving).toBe(true);

        await act(async () => {
            await expect(timedOut).rejects.toMatchObject({
                code: 'save-timeout',
                message: 'Metadata settings were not confirmed in time. Reload the latest values before trying again.'
            });
        });
        expect(stateRef.current?.saving).toBe(false);
        expect(serviceMocks.saveAdminMetadata).not.toHaveBeenCalled();

        cancelSpy.mockResolvedValue(undefined);
        serviceMocks.saveAdminMetadata.mockResolvedValue(snapshot(desired));
        await act(async () => {
            await expect(stateRef.current!.save(desired, confirmed)).resolves.toEqual(
                snapshot(desired)
            );
        });
        expect(stateRef.current?.saving).toBe(false);
        expect(serviceMocks.saveAdminMetadata).toHaveBeenCalledWith(
            api,
            desired,
            confirmed,
            expect.any(AbortSignal)
        );
    });

    it('queues a retry behind a late timed-out save and never publishes the late result', async () => {
        const stateRef: { current?: HookState } = {};
        const lateDesired = { ...confirmed, dummyChapterDurationSeconds: 600 };
        const retryDesired = { ...confirmed, dummyChapterDurationSeconds: 900 };
        const lateSave = deferred<AdminMetadataSnapshot>();
        serviceMocks.saveAdminMetadata
            .mockReturnValueOnce(lateSave.promise)
            .mockResolvedValueOnce(snapshot(retryDesired));
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness saveTimeoutMs={20} stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        let timedOut!: Promise<AdminMetadataSnapshot>;
        await act(async () => {
            timedOut = stateRef.current!.save(lateDesired, confirmed);
            await Promise.resolve();
        });
        await act(async () => {
            await expect(timedOut).rejects.toMatchObject({ code: 'save-timeout' });
        });
        expect(queryClient.getQueryData<AdminMetadataSnapshot>(
            getAdminMetadataQueryKeys('server-a').configuration
        )?.settings).toEqual(confirmed);

        let retry!: Promise<AdminMetadataSnapshot>;
        await act(async () => {
            retry = stateRef.current!.save(retryDesired, confirmed);
            await Promise.resolve();
        });
        expect(serviceMocks.saveAdminMetadata).toHaveBeenCalledOnce();
        await act(async () => {
            lateSave.resolve(snapshot(lateDesired));
            await expect(retry).resolves.toEqual(snapshot(retryDesired));
        });
        await flushQueries();

        expect(queryClient.getQueryData<AdminMetadataSnapshot>(
            getAdminMetadataQueryKeys('server-a').configuration
        )?.settings).toEqual(retryDesired);
        expect(stateRef.current?.settings).toEqual(retryDesired);
        expect(serviceMocks.saveAdminMetadata).toHaveBeenCalledTimes(2);
    });

    it('prevents a cancelled stale configuration read from replacing a save', async () => {
        const stateRef: { current?: HookState } = {};
        const oldRead = deferred<AdminMetadataSnapshot>();
        const desired = { ...confirmed, dummyChapterDurationSeconds: 600 };
        const saved = snapshot(desired);
        serviceMocks.loadAdminMetadataConfiguration.mockReturnValue(oldRead.promise);
        serviceMocks.saveAdminMetadata.mockResolvedValue(saved);
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness stateRef={stateRef} />
            </QueryClientProvider>
        ));

        await act(async () => {
            await stateRef.current!.save(desired, confirmed);
        });
        await act(async () => {
            oldRead.resolve(snapshot(confirmed));
            await oldRead.promise;
            await Promise.resolve();
        });

        expect(stateRef.current?.settings).toEqual(desired);
        expect(queryClient.getQueryData<AdminMetadataSnapshot>(
            getAdminMetadataQueryKeys('server-a').configuration
        )?.settings).toEqual(desired);
    });
});
