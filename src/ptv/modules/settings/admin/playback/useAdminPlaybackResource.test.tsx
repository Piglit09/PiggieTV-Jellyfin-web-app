import type { Api } from '@jellyfin/sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiClient } from 'jellyfin-apiclient';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAdminConfigurationForm } from '../configuration/useAdminConfigurationForm';
import { resetAdminConfigurationSaveSettlementsForTests } from '../configuration/useAdminConfigurationSave';
import {
    getAdminPlaybackQueryKey,
    type AdminPlaybackResourceSection,
    useAdminPlaybackResource
} from './useAdminPlaybackResource';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

type TestSettings = Readonly<{
    transient?: string;
    value: string;
}>;
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
type FormState = ReturnType<typeof useAdminConfigurationForm<TestSettings>>;
type LifecycleState = Readonly<{
    form: FormState;
    resource: HookState;
}>;

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
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

function Harness({
    client = apiClient('server-a'),
    jellyfinApi = api,
    load,
    renderSettings,
    save,
    saveTimeoutMs,
    section = 'streaming',
    source = 'System/Configuration',
    stateRef
}: Readonly<{
    client?: ApiClient;
    jellyfinApi?: Api;
    load: LoadResource;
    renderSettings?: Array<TestSettings | null>;
    save: SaveResource;
    saveTimeoutMs?: number;
    section?: AdminPlaybackResourceSection;
    source?: 'System/Configuration' | 'System/Configuration/encoding';
    stateRef: { current?: HookState };
}>) {
    const state = useAdminPlaybackResource({
        api: jellyfinApi,
        apiClient: client,
        load,
        save,
        saveTimeoutMs,
        section,
        source
    });
    stateRef.current = state;
    renderSettings?.push(state.settings);
    return null;
}

function settingsEqual(left: TestSettings, right: TestSettings) {
    return left.value === right.value;
}

function LifecycleHarness({
    load,
    save,
    section = 'streaming',
    stateRef
}: Readonly<{
    load: LoadResource;
    save: SaveResource;
    section?: AdminPlaybackResourceSection;
    stateRef: { current?: LifecycleState };
}>) {
    const resource = useAdminPlaybackResource({
        api,
        apiClient: apiClient('server-a'),
        load,
        save,
        section,
        source: 'System/Configuration'
    });
    const form = useAdminConfigurationForm(resource.settings, settingsEqual);

    stateRef.current = { form, resource };
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
        resetAdminConfigurationSaveSettlementsForTests();
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
        expect(save).toHaveBeenCalledWith(
            api,
            desired,
            confirmed,
            expect.any(AbortSignal)
        );
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

    it('settles the real resource-to-form save publication without a false conflict', async () => {
        const initial = snapshot({
            transient: 'initial-response',
            value: 'confirmed'
        });
        const verified = snapshot({
            transient: 'server-normalized',
            value: 'saved'
        }, 'verified-readback');
        const load = vi.fn<LoadResource>().mockResolvedValue(initial);
        const save = vi.fn<SaveResource>().mockResolvedValue(verified);
        const stateRef: { current?: LifecycleState } = {};

        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <LifecycleHarness load={load} save={save} stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        act(() => stateRef.current!.form.update('value', 'saved'));
        expect(stateRef.current?.form.dirty).toBe(true);

        let saved!: TestSnapshot;
        await act(async () => {
            saved = await stateRef.current!.resource.save(
                stateRef.current!.form.form!,
                stateRef.current!.form.confirmed!
            );
        });
        await flushQueries();

        // Query publication reaches the real form source before a page's
        // explicit adopt. Equivalent persisted values must settle the form,
        // including authoritative normalization of non-persisted fields.
        expect(stateRef.current?.form.form).toEqual(verified.settings);
        expect(stateRef.current?.form.confirmed).toEqual(verified.settings);
        expect(stateRef.current?.form.dirty).toBe(false);
        expect(stateRef.current?.form.serverChanged).toBe(false);

        act(() => stateRef.current!.form.adopt(saved.settings));

        expect(stateRef.current?.form.form).toEqual(verified.settings);
        expect(stateRef.current?.form.confirmed).toEqual(verified.settings);
        expect(stateRef.current?.form.dirty).toBe(false);
        expect(stateRef.current?.form.serverChanged).toBe(false);
        expect(save).toHaveBeenCalledWith(
            api,
            { transient: 'initial-response', value: 'saved' },
            initial.settings,
            expect.any(AbortSignal)
        );
    });

    it('adopts a server-normalized persisted value as the new clean baseline', async () => {
        const initial = snapshot({ value: 'confirmed' });
        const verified = snapshot({
            transient: 'verified-response',
            value: 'server-normalized'
        }, 'verified-readback');
        const load = vi.fn<LoadResource>().mockResolvedValue(initial);
        const save = vi.fn<SaveResource>().mockResolvedValue(verified);
        const stateRef: { current?: LifecycleState } = {};

        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <LifecycleHarness load={load} save={save} stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        act(() => stateRef.current!.form.update('value', 'requested'));
        await act(async () => {
            const saved = await stateRef.current!.resource.save(
                stateRef.current!.form.form!,
                stateRef.current!.form.confirmed!
            );
            // This is the same continuation used by each settings page after
            // an authoritative post-write readback.
            stateRef.current!.form.adopt(saved.settings);
        });
        await flushQueries();

        expect(stateRef.current?.form.form).toEqual(verified.settings);
        expect(stateRef.current?.form.confirmed).toEqual(verified.settings);
        expect(stateRef.current?.form.dirty).toBe(false);
        expect(stateRef.current?.form.serverChanged).toBe(false);
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

    it('does not expose a stale cached snapshot until the mount refresh settles', async () => {
        const queryKey = getAdminPlaybackQueryKey(
            'server-a',
            'streaming',
            'System/Configuration'
        );
        queryClient.setQueryData(
            queryKey,
            snapshot({ value: 'stale' }, 'stale-cache'),
            { updatedAt: Date.now() - 61_000 }
        );
        const pendingLoad = deferred<TestSnapshot>();
        const load = vi.fn<LoadResource>().mockReturnValue(pendingLoad.promise);
        const save = vi.fn<SaveResource>().mockResolvedValue(snapshot());
        const stateRef: { current?: HookState } = {};

        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness load={load} save={save} stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await act(async () => Promise.resolve());

        expect(stateRef.current?.loading).toBe(true);
        expect(stateRef.current?.settings).toBeNull();

        await act(async () => {
            pendingLoad.resolve(snapshot({ value: 'fresh' }, 'fresh-read'));
            await pendingLoad.promise;
        });
        await flushQueries();

        expect(stateRef.current?.loading).toBe(false);
        expect(stateRef.current?.settings).toEqual({ value: 'fresh' });
    });

    it('exposes a fresh cached snapshot on the first render without an unavailable frame', async () => {
        const queryKey = getAdminPlaybackQueryKey(
            'server-a',
            'streaming',
            'System/Configuration'
        );
        const freshSettings = { value: 'fresh-cache' };
        queryClient.setQueryData(
            queryKey,
            snapshot(freshSettings, 'fresh-cache'),
            { updatedAt: Date.now() }
        );
        const load = vi.fn<LoadResource>().mockResolvedValue(snapshot());
        const save = vi.fn<SaveResource>().mockResolvedValue(snapshot());
        const stateRef: { current?: HookState } = {};
        const renderSettings: Array<TestSettings | null> = [];

        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness
                    load={load}
                    renderSettings={renderSettings}
                    save={save}
                    stateRef={stateRef}
                />
            </QueryClientProvider>
        ));

        expect(renderSettings[0]).toEqual(freshSettings);
        expect(stateRef.current?.settings).toEqual(freshSettings);
        expect(load).not.toHaveBeenCalled();
    });

    it('bounds an unresponsive save, aborts it, and returns the UI to a retryable state', async () => {
        const load = vi.fn<LoadResource>().mockResolvedValue(snapshot());
        let saveSignal: AbortSignal | undefined;
        const save = vi.fn<SaveResource>((_api, _desired, _baseline, signal) => {
            saveSignal = signal;
            return new Promise<TestSnapshot>(() => undefined);
        });
        const stateRef: { current?: HookState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness
                    load={load}
                    save={save}
                    saveTimeoutMs={10}
                    stateRef={stateRef}
                />
            </QueryClientProvider>
        ));
        await flushQueries();

        let savePromise!: Promise<TestSnapshot>;
        await act(async () => {
            savePromise = stateRef.current!.save({ value: 'edited' }, confirmed);
            await Promise.resolve();
        });
        expect(stateRef.current?.saving).toBe(true);

        let timeoutError: unknown;
        await act(async () => {
            try {
                await savePromise;
            } catch (error) {
                timeoutError = error;
            }
        });
        expect(timeoutError).toMatchObject({
            code: 'save-timeout',
            message: 'The server did not confirm this save in time. Reload the latest values before trying again.'
        });
        await flushQueries();

        expect(saveSignal?.aborted).toBe(true);
        expect(stateRef.current?.saving).toBe(false);
        expect(stateRef.current?.settings).toEqual(confirmed);
    });

    it('queues a retry until a retired save settles and never publishes the late result', async () => {
        const load = vi.fn<LoadResource>().mockResolvedValue(snapshot());
        const retiredSave = deferred<TestSnapshot>();
        const recovered = snapshot({ value: 'recovered' }, 'retry');
        const save = vi.fn<SaveResource>()
            .mockReturnValueOnce(retiredSave.promise)
            .mockResolvedValueOnce(recovered);
        const stateRef: { current?: HookState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness
                    load={load}
                    save={save}
                    saveTimeoutMs={30}
                    stateRef={stateRef}
                />
            </QueryClientProvider>
        ));
        await flushQueries();

        let timeoutError: unknown;
        await act(async () => {
            try {
                await stateRef.current!.save({ value: 'retired' }, confirmed);
            } catch (error) {
                timeoutError = error;
            }
        });
        expect(timeoutError).toMatchObject({ code: 'save-timeout' });

        let retry!: Promise<TestSnapshot>;
        await act(async () => {
            retry = stateRef.current!.save({ value: 'recovered' }, confirmed);
            await Promise.resolve();
        });
        expect(save).toHaveBeenCalledOnce();

        await act(async () => {
            retiredSave.resolve(snapshot({ value: 'late-retired' }, 'late'));
            await expect(retry).resolves.toEqual(recovered);
        });
        await flushQueries();

        const queryKey = getAdminPlaybackQueryKey(
            'server-a',
            'streaming',
            'System/Configuration'
        );
        expect(queryClient.getQueryData(queryKey)).toEqual(recovered);
        expect(stateRef.current?.settings).toEqual(recovered.settings);
        expect(stateRef.current?.saving).toBe(false);
        expect(save).toHaveBeenCalledTimes(2);
    });

    it('serializes different Playback sections that write the same server document', async () => {
        const lateStreaming = deferred<TestSnapshot>();
        const streamingSave = vi.fn<SaveResource>(() => lateStreaming.promise);
        const resumed = snapshot({ value: 'resume-saved' }, 'resume-verified');
        const resumeSave = vi.fn<SaveResource>().mockResolvedValue(resumed);
        const streamingRef: { current?: HookState } = {};
        const resumeRef: { current?: HookState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness
                    load={vi.fn<LoadResource>().mockResolvedValue(snapshot())}
                    save={streamingSave}
                    saveTimeoutMs={30}
                    section='streaming'
                    stateRef={streamingRef}
                />
                <Harness
                    load={vi.fn<LoadResource>().mockResolvedValue(
                        snapshot({ value: 'resume' }, 'resume-load')
                    )}
                    save={resumeSave}
                    saveTimeoutMs={250}
                    section='resume'
                    stateRef={resumeRef}
                />
            </QueryClientProvider>
        ));
        await flushQueries();

        await act(async () => {
            await expect(streamingRef.current!.save(
                { value: 'streaming-late' },
                confirmed
            )).rejects.toMatchObject({ code: 'save-timeout' });
        });

        let resume!: Promise<TestSnapshot>;
        await act(async () => {
            resume = resumeRef.current!.save(
                resumed.settings,
                { value: 'resume' }
            );
            await Promise.resolve();
        });
        expect(streamingSave).toHaveBeenCalledOnce();
        expect(resumeSave).not.toHaveBeenCalled();

        await act(async () => {
            lateStreaming.resolve(snapshot({ value: 'streaming-late' }, 'late'));
            await expect(resume).resolves.toEqual(resumed);
        });
        await flushQueries();

        expect(resumeSave).toHaveBeenCalledOnce();
        expect(resumeRef.current?.settings).toEqual(resumed.settings);
        expect(queryClient.getQueryData(getAdminPlaybackQueryKey(
            'server-a',
            'streaming',
            'System/Configuration'
        ))).toEqual(snapshot());
    });

    it('bounds query cancellation as part of the complete save operation', async () => {
        const load = vi.fn<LoadResource>().mockResolvedValue(snapshot());
        const recovered = snapshot({ value: 'recovered' }, 'retry');
        const save = vi.fn<SaveResource>().mockResolvedValue(recovered);
        const retiredCancellation = deferred<void>();
        vi.spyOn(queryClient, 'cancelQueries')
            .mockReturnValueOnce(retiredCancellation.promise)
            .mockResolvedValueOnce(undefined);
        const stateRef: { current?: HookState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness
                    load={load}
                    save={save}
                    saveTimeoutMs={10}
                    stateRef={stateRef}
                />
            </QueryClientProvider>
        ));
        await flushQueries();

        let failure: unknown;
        await act(async () => {
            try {
                await stateRef.current!.save({ value: 'edited' }, confirmed);
            } catch (error) {
                failure = error;
            }
        });

        expect(failure).toMatchObject({ code: 'save-timeout' });
        expect(save).not.toHaveBeenCalled();
        expect(stateRef.current?.saving).toBe(false);
        expect(stateRef.current?.settings).toEqual(confirmed);

        await act(async () => {
            retiredCancellation.resolve();
            await retiredCancellation.promise;
        });
        await flushQueries();
        expect(save).not.toHaveBeenCalled();

        await act(async () => {
            await stateRef.current!.save({ value: 'recovered' }, confirmed);
        });
        expect(save).toHaveBeenCalledOnce();
        expect(stateRef.current?.settings).toEqual(recovered.settings);
    });

    it.each([
        [ '400', new Error('bad request') ],
        [ '401', Object.assign(new Error('unauthorized'), { status: 401 }) ],
        [ '409', Object.assign(new Error('conflict'), { status: 409 }) ],
        [ '500', Object.assign(new Error('server error'), { status: 500 }) ],
        [ 'network', new TypeError('network failure') ],
        [ 'cancelled', Object.assign(new Error('cancelled'), { name: 'AbortError' }) ]
    ])('clears pending state after a %s save rejection and permits retry', async (
        _failure,
        failure
    ) => {
        const load = vi.fn<LoadResource>().mockResolvedValue(snapshot());
        const recovered = snapshot({ value: 'recovered' }, 'retry');
        const save = vi.fn<SaveResource>()
            .mockRejectedValueOnce(failure)
            .mockResolvedValueOnce(recovered);
        const stateRef: { current?: HookState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness load={load} save={save} stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        let firstError: unknown;
        await act(async () => {
            try {
                await stateRef.current!.save({ value: 'first' }, confirmed);
            } catch (error) {
                firstError = error;
            }
        });
        expect(firstError).toBe(failure);
        await flushQueries();
        expect(stateRef.current?.saving).toBe(false);

        let retryResult: TestSnapshot | undefined;
        await act(async () => {
            retryResult = await stateRef.current!.save({ value: 'recovered' }, confirmed);
        });
        expect(retryResult).toEqual(recovered);
        await flushQueries();
        expect(stateRef.current?.saving).toBe(false);
        expect(stateRef.current?.settings).toEqual({ value: 'recovered' });
        expect(save).toHaveBeenCalledTimes(2);
    });

    it('settles repeated successful saves without accumulating mutation state', async () => {
        const load = vi.fn<LoadResource>().mockResolvedValue(snapshot());
        const firstSaved = snapshot({ value: 'first' }, 'first-save');
        const secondSaved = snapshot({ value: 'second' }, 'second-save');
        const save = vi.fn<SaveResource>()
            .mockResolvedValueOnce(firstSaved)
            .mockResolvedValueOnce(secondSaved);
        const stateRef: { current?: HookState } = {};
        await act(async () => root.render(
            <QueryClientProvider client={queryClient}>
                <Harness load={load} save={save} stateRef={stateRef} />
            </QueryClientProvider>
        ));
        await flushQueries();

        await act(async () => {
            await stateRef.current!.save({ value: 'first' }, confirmed);
        });
        await act(async () => {
            await stateRef.current!.save({ value: 'second' }, firstSaved.settings);
        });

        expect(save).toHaveBeenNthCalledWith(
            1,
            api,
            { value: 'first' },
            confirmed,
            expect.any(AbortSignal)
        );
        expect(save).toHaveBeenNthCalledWith(
            2,
            api,
            { value: 'second' },
            firstSaved.settings,
            expect.any(AbortSignal)
        );
        expect(stateRef.current?.saving).toBe(false);
        expect(stateRef.current?.settings).toEqual({ value: 'second' });
    });

    it('keeps verified baselines isolated across section navigation and restores them on return', async () => {
        const load = vi.fn<LoadResource>()
            .mockResolvedValueOnce(snapshot({ value: 'streaming' }, 'streaming-load'))
            .mockResolvedValueOnce(snapshot({ value: 'resume' }, 'resume-load'));
        const save = vi.fn<SaveResource>(async (_api, desired) => (
            snapshot(desired, `${desired.value}-verified`)
        ));
        const stateRef: { current?: HookState } = {};
        const renderSection = async (
            section: AdminPlaybackResourceSection,
            key: string
        ) => {
            await act(async () => root.render(
                <QueryClientProvider client={queryClient}>
                    <Harness
                        key={key}
                        load={load}
                        save={save}
                        section={section}
                        stateRef={stateRef}
                    />
                </QueryClientProvider>
            ));
            await flushQueries();
        };

        await renderSection('streaming', 'streaming-first');
        await act(async () => {
            await stateRef.current!.save(
                { value: 'streaming-saved' },
                { value: 'streaming' }
            );
        });
        expect(stateRef.current?.settings).toEqual({ value: 'streaming-saved' });

        await renderSection('resume', 'resume');
        expect(stateRef.current?.settings).toEqual({ value: 'resume' });
        await act(async () => {
            await stateRef.current!.save(
                { value: 'resume-saved' },
                { value: 'resume' }
            );
        });
        expect(stateRef.current?.settings).toEqual({ value: 'resume-saved' });

        await renderSection('streaming', 'streaming-return');
        expect(stateRef.current?.saving).toBe(false);
        expect(stateRef.current?.settings).toEqual({ value: 'streaming-saved' });
        expect(load).toHaveBeenCalledTimes(2);
    });

    it('keeps forms clean through Streaming save, Resume save, and Streaming return', async () => {
        const load = vi.fn<LoadResource>()
            .mockResolvedValueOnce(snapshot({ value: 'streaming' }, 'streaming-load'))
            .mockResolvedValueOnce(snapshot({ value: 'resume' }, 'resume-load'));
        const save = vi.fn<SaveResource>(async (_api, desired) => (
            snapshot({
                ...desired,
                transient: `${desired.value}-normalized`
            }, `${desired.value}-verified`)
        ));
        const stateRef: { current?: LifecycleState } = {};
        const renderSection = async (
            section: AdminPlaybackResourceSection,
            key: string
        ) => {
            await act(async () => root.render(
                <QueryClientProvider client={queryClient}>
                    <LifecycleHarness
                        key={key}
                        load={load}
                        save={save}
                        section={section}
                        stateRef={stateRef}
                    />
                </QueryClientProvider>
            ));
            await flushQueries();
        };
        const saveEditedValue = async (value: string) => {
            act(() => stateRef.current!.form.update('value', value));
            expect(stateRef.current?.form.dirty).toBe(true);
            await act(async () => {
                const saved = await stateRef.current!.resource.save(
                    stateRef.current!.form.form!,
                    stateRef.current!.form.confirmed!
                );
                stateRef.current!.form.adopt(saved.settings);
            });
            await flushQueries();
            expect(stateRef.current?.form.dirty).toBe(false);
            expect(stateRef.current?.form.serverChanged).toBe(false);
        };

        await renderSection('streaming', 'streaming-first');
        await saveEditedValue('streaming-saved');

        await renderSection('resume', 'resume');
        expect(stateRef.current?.form.form?.value).toBe('resume');
        await saveEditedValue('resume-saved');

        await renderSection('streaming', 'streaming-return');
        expect(stateRef.current?.form.form).toEqual({
            transient: 'streaming-saved-normalized',
            value: 'streaming-saved'
        });
        expect(stateRef.current?.form.confirmed).toEqual(stateRef.current?.form.form);
        expect(stateRef.current?.form.dirty).toBe(false);
        expect(stateRef.current?.form.serverChanged).toBe(false);
        expect(stateRef.current?.resource.saving).toBe(false);
        expect(load).toHaveBeenCalledTimes(2);
        expect(save).toHaveBeenCalledTimes(2);
    });
});
