import type { Api } from '@jellyfin/sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    getAdminPlaybackQueryKey,
    type AdminPlaybackResourceSection,
    useAdminPlaybackResource
} from './useAdminPlaybackResource';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

type TestSettings = Readonly<{ value: string }>;
type TestSnapshot = Readonly<{
    marker: string;
    settings: TestSettings;
}>;

type LoadResource = (
    api: Api,
    signal?: AbortSignal
) => Promise<TestSnapshot>;
type SaveResource = (
    api: Api,
    desired: TestSettings,
    confirmed: TestSettings,
    signal?: AbortSignal
) => Promise<TestSnapshot>;
type HookState = ReturnType<typeof useAdminPlaybackResource<TestSettings, TestSnapshot>>;

const api = {} as Api;
const apiClient = (serverId: string) => ({
    serverId: () => serverId
} as unknown as ApiClient);

const confirmed: TestSettings = { value: 'confirmed' };

function snapshot(
    settings: TestSettings = confirmed,
    marker = 'server-a'
): TestSnapshot {
    return { marker, settings };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function Harness({
    client = apiClient('server-a'),
    jellyfinApi = api,
    load,
    save,
    section = 'streaming',
    source = 'System/Configuration',
    stateRef
}: Readonly<{
    client?: ApiClient;
    jellyfinApi?: Api;
    load: LoadResource;
    save: SaveResource;
    section?: AdminPlaybackResourceSection;
    source?: 'System/Configuration' | 'System/Configuration/encoding';
    stateRef: { current?: HookState };
}>) {
    stateRef.current = useAdminPlaybackResource({
        api: jellyfinApi,
        apiClient: client,
        load,
        save,
        section,
        source
    });
    return null;
}

async function flushQueries() {
    await act(async () => {
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
        await Promise.resolve();
    });
}

describe('administrator Playback resource hook', () => {
    let container: HTMLDivElement;
    let queryClient: QueryClient;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        queryClient = new QueryClient({
            defaultOptions: { queries: { gcTime: Infinity, retry: false } }
        });
        container = document.createElement('div');
        document.body.append(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        queryClient.clear();
        container.remove();
    });

    it('isolates cache identity by server, section, and authoritative source', () => {
        const streaming = getAdminPlaybackQueryKey(
            'server-a',
            'streaming',
            'System/Configuration'
        );

        expect(streaming).toEqual([
            'PtvAdminPlayback',
            'server-a',
            'streaming',
            'System/Configuration'
        ]);
        expect(streaming).not.toEqual(getAdminPlaybackQueryKey(
            'server-b',
            'streaming',
            'System/Configuration'
        ));
        expect(streaming).not.toEqual(getAdminPlaybackQueryKey(
            'server-a',
            'resume',
            'System/Configuration'
        ));
        expect(streaming).not.toEqual(getAdminPlaybackQueryKey(
            'server-a',
            'streaming',
            'System/Configuration/encoding'
        ));

        // The generic Jellyfin configuration hook uses [ 'Configuration' ].
        expect(streaming).not.toEqual([ 'Configuration' ]);
        // Member Playback is user-configuration state and has no admin query scope.
        expect(streaming[0]).toBe('PtvAdminPlayback');
    });

    it('loads with an AbortSignal and does not refetch on focus', async () => {
        const load = vi.fn<LoadResource>().mockResolvedValue(snapshot());
        const save = vi.fn<SaveResource>().mockResolvedValue(snapshot());
        const stateRef: { current?: HookState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness load={load} save={save} stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(load).toHaveBeenCalledWith(api, expect.any(AbortSignal));
        expect(load).toHaveBeenCalledOnce();
        expect(stateRef.current?.settings).toEqual(confirmed);

        await act(async () => {
            window.dispatchEvent(new Event('focus'));
            await new Promise(resolve => setTimeout(resolve, 20));
        });

        expect(load).toHaveBeenCalledOnce();
    });

    it('does not load without both an API and stable server identity', async () => {
        const load = vi.fn<LoadResource>().mockResolvedValue(snapshot());
        const save = vi.fn<SaveResource>().mockResolvedValue(snapshot());
        const stateRef: { current?: HookState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness
                    client={apiClient('')}
                    load={load}
                    save={save}
                    stateRef={stateRef}
                />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(load).not.toHaveBeenCalled();
        expect(stateRef.current?.settings).toBeNull();
    });

    it('keeps duplicate saves single-flight and updates only the exact cache', async () => {
        const load = vi.fn<LoadResource>().mockResolvedValue(snapshot());
        const pendingSave = deferred<TestSnapshot>();
        const save = vi.fn<SaveResource>().mockReturnValue(pendingSave.promise);
        const cancelSpy = vi.spyOn(queryClient, 'cancelQueries');
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
        const stateRef: { current?: HookState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness load={load} save={save} stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        const desired = { value: 'saved' };
        const saved = snapshot(desired, 'saved-response');
        let first!: Promise<TestSnapshot>;
        let second!: Promise<TestSnapshot>;
        await act(async () => {
            first = stateRef.current!.save(desired, confirmed);
            second = stateRef.current!.save(desired, confirmed);
            await Promise.resolve();
        });

        const queryKey = getAdminPlaybackQueryKey(
            'server-a',
            'streaming',
            'System/Configuration'
        );
        const siblingKey = getAdminPlaybackQueryKey(
            'server-a',
            'resume',
            'System/Configuration'
        );
        queryClient.setQueryData(siblingKey, snapshot({ value: 'resume' }, 'resume'));

        expect(first).toBe(second);
        expect(save).toHaveBeenCalledOnce();
        expect(save).toHaveBeenCalledWith(api, desired, confirmed);
        expect(cancelSpy).toHaveBeenCalledWith({ exact: true, queryKey });

        await act(async () => {
            pendingSave.resolve(saved);
            await first;
        });

        expect(queryClient.getQueryData(queryKey)).toEqual(saved);
        expect(queryClient.getQueryData(siblingKey)).toEqual(
            snapshot({ value: 'resume' }, 'resume')
        );
        expect(invalidateSpy).not.toHaveBeenCalled();
        expect(stateRef.current?.settings).toEqual(desired);
        expect(stateRef.current?.saving).toBe(false);
    });

    it('keeps sibling Playback sections usable when one source fails', async () => {
        const streamingLoad = vi.fn<LoadResource>()
            .mockRejectedValue(new Error('Streaming unavailable.'));
        const resumeLoad = vi.fn<LoadResource>()
            .mockResolvedValue(snapshot({ value: 'resume-ready' }, 'resume'));
        const save = vi.fn<SaveResource>().mockResolvedValue(snapshot());
        const streamingRef: { current?: HookState } = {};
        const resumeRef: { current?: HookState } = {};

        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness
                    load={streamingLoad}
                    save={save}
                    section='streaming'
                    stateRef={streamingRef}
                />
                <Harness
                    load={resumeLoad}
                    save={save}
                    section='resume'
                    stateRef={resumeRef}
                />
            </QueryClientProvider>
        ));
        await flushQueries();

        expect(streamingRef.current?.error).toMatchObject({
            message: 'Streaming unavailable.'
        });
        expect(streamingRef.current?.settings).toBeNull();
        expect(resumeRef.current?.error).toBeNull();
        expect(resumeRef.current?.settings).toEqual({ value: 'resume-ready' });
        expect(streamingLoad).toHaveBeenCalledOnce();
        expect(resumeLoad).toHaveBeenCalledOnce();
    });
});
