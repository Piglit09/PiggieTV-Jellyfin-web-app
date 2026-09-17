import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestClient = {
    accessToken: () => string;
    fetch?: ReturnType<typeof vi.fn>;
    getCurrentUserId: () => string;
    getJSON: ReturnType<typeof vi.fn>;
    getUrl: (path: string) => string;
    serverId: () => string;
    serverInfo: () => { Id: string };
};

const connectionMocks = vi.hoisted(() => ({ client: null as TestClient | null }));

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        currentApiClient: () => connectionMocks.client
    }
}));

import {
    getCurrentPtvPluginApiClient,
    resetPtvPluginApiAvailability,
    subscribePtvPluginStatus
} from './pluginApi';
import { createPtvAbortController } from './abortController';
import {
    beginConfiguredRowVerification,
    getConfiguredRowFreshnessSnapshot,
    retireConfiguredRowFreshness,
    verifyConfiguredRowFreshness
} from '../pages/home/configuredRowFreshness';

const scopeA = 'a'.repeat(64);
const scopeB = 'b'.repeat(64);
const generationA = '1'.repeat(64);
const generationB = '2'.repeat(64);

const authority = (scope: string, generation: string) => ({ version: 1 as const, scope, generation });
const status = (currentPresentationAuthority: ReturnType<typeof authority>) => ({
    configuredPresentationBindings: [],
    currentPresentationAuthority
});

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>(resolvePromise => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

function createClient(getJSON: TestClient['getJSON']): TestClient {
    return {
        accessToken: () => 'authenticated',
        getCurrentUserId: () => 'admin',
        getJSON,
        getUrl: path => `https://offline.invalid/${path}`,
        serverId: () => 'server-a',
        serverInfo: () => ({ Id: 'server-a' })
    };
}

beforeEach(() => {
    connectionMocks.client = null;
    (window as unknown as { ApiClient?: unknown }).ApiClient = undefined;
    window.localStorage.clear();
    resetPtvPluginApiAvailability();
    retireConfiguredRowFreshness('plugin-api-test-reset');
});

describe('final configured-row freshness transport ordering', () => {
    it('starts a bypassed final status read after both inputs and never joins a pre-input status request', async () => {
        const ordinary = deferred<unknown>();
        const final = deferred<unknown>();
        const transport = vi.fn()
            .mockImplementationOnce(() => ordinary.promise)
            .mockImplementationOnce(() => final.promise);
        const client = createClient(transport);
        connectionMocks.client = client;
        const pluginApi = getCurrentPtvPluginApiClient(client)!;

        const oldStatusRequest = pluginApi.getStatus();
        expect(transport).toHaveBeenCalledTimes(1);

        const settingsInput = deferred<unknown>();
        const featuredInput = deferred<unknown>();
        let finalStatusRequest: Promise<unknown> | undefined;
        const assembled = Promise.all([ settingsInput.promise, featuredInput.promise ])
            .then(() => {
                finalStatusRequest = pluginApi.getStatus({ bypassCache: true });
                return finalStatusRequest;
            });

        settingsInput.resolve({ settings: 'ready' });
        await Promise.resolve();
        expect(transport).toHaveBeenCalledTimes(1);
        featuredInput.resolve({ featured: 'ready' });
        await Promise.resolve();
        await Promise.resolve();
        expect(transport).toHaveBeenCalledTimes(2);
        expect(finalStatusRequest).toBeDefined();
        expect(finalStatusRequest).not.toBe(oldStatusRequest);

        final.resolve({ authority: 'fresh-final' });
        await expect(assembled).resolves.toEqual({ authority: 'fresh-final' });
        ordinary.resolve({ authority: 'older-late' });
        await expect(oldStatusRequest).resolves.toEqual({ authority: 'older-late' });
    });

    it('bypassed status reads neither reuse a settled cache entry nor coalesce with each other', async () => {
        const transport = vi.fn()
            .mockResolvedValueOnce({ sequence: 1 })
            .mockResolvedValueOnce({ sequence: 2 })
            .mockResolvedValueOnce({ sequence: 3 });
        const client = createClient(transport);
        connectionMocks.client = client;
        const pluginApi = getCurrentPtvPluginApiClient(client)!;

        await expect(pluginApi.getStatus()).resolves.toEqual({ sequence: 1 });
        await expect(Promise.all([
            pluginApi.getStatus({ bypassCache: true }),
            pluginApi.getStatus({ bypassCache: true })
        ])).resolves.toEqual([ { sequence: 2 }, { sequence: 3 } ]);
        expect(transport).toHaveBeenCalledTimes(3);
    });

    it('keeps a signaled final read on its own post-input transport path', async () => {
        const ordinary = deferred<unknown>();
        const final = deferred<unknown>();
        const ordinaryTransport = vi.fn(() => ordinary.promise);
        let capturedFinalRequest: unknown;
        const finalTransport = vi.fn((request: unknown) => {
            capturedFinalRequest = request;
            return final.promise;
        });
        const client = createClient(ordinaryTransport);
        client.fetch = finalTransport;
        connectionMocks.client = client;
        const pluginApi = getCurrentPtvPluginApiClient(client)!;
        const olderRequest = pluginApi.getStatus();
        const controller = createPtvAbortController();

        const finalRequest = pluginApi.getStatus({ bypassCache: true, signal: controller.signal });
        expect(ordinaryTransport).toHaveBeenCalledOnce();
        expect(finalTransport).toHaveBeenCalledOnce();
        expect(capturedFinalRequest).toMatchObject({
            method: 'GET',
            signal: controller.signal
        });
        final.resolve({ authority: 'fresh-final' });
        await expect(finalRequest).resolves.toEqual({ authority: 'fresh-final' });
        ordinary.resolve({ authority: 'older-late' });
        await expect(olderRequest).resolves.toEqual({ authority: 'older-late' });
    });

    it('shows why local status publication must be retirement-only: an older request may publish last', async () => {
        const older = deferred<unknown>();
        const fresh = deferred<unknown>();
        const transport = vi.fn()
            .mockImplementationOnce(() => older.promise)
            .mockImplementationOnce(() => fresh.promise);
        const client = createClient(transport);
        connectionMocks.client = client;
        const pluginApi = getCurrentPtvPluginApiClient(client)!;
        const publications: unknown[] = [];
        const unsubscribe = subscribePtvPluginStatus(value => publications.push(value));

        const olderRequest = pluginApi.getStatus();
        const freshRequest = pluginApi.getStatus({ bypassCache: true });
        fresh.resolve({ authority: 'B-current' });
        await expect(freshRequest).resolves.toEqual({ authority: 'B-current' });
        older.resolve({ authority: 'A-older' });
        await expect(olderRequest).resolves.toEqual({ authority: 'A-older' });

        expect(publications).toEqual([
            { authority: 'B-current' },
            { authority: 'A-older' }
        ]);
        unsubscribe();
    });

    it('does not publish an old identity success after its inner request guard but before its outer observer', async () => {
        const oldResponse = deferred<unknown>();
        let currentUserId = 'user-a';
        let armIdentitySwitch = false;
        let identitySwitchQueued = false;
        let establishCurrentB: Promise<unknown> | undefined;
        const switchToCurrentB = () => {
            currentUserId = 'user-b';
            const currentB = authority(scopeB, generationB);
            establishCurrentB = verifyConfiguredRowFreshness({
                featured: { currentPresentationAuthority: currentB },
                readAuthority: async () => status(currentB),
                settings: { currentPresentationAuthority: currentB },
                verification: beginConfiguredRowVerification('server-a:user-b')
            });
        };
        const getCurrentUserId = vi.fn(() => {
            if (armIdentitySwitch && !identitySwitchQueued) {
                identitySwitchQueued = true;
                queueMicrotask(switchToCurrentB);
            }

            return currentUserId;
        });
        const transport = vi.fn(() => oldResponse.promise);
        const client = createClient(transport);
        client.getCurrentUserId = getCurrentUserId;
        connectionMocks.client = client;
        const pluginApi = getCurrentPtvPluginApiClient(client)!;
        const publications: unknown[] = [];
        const unsubscribe = subscribePtvPluginStatus(value => publications.push(value));

        const request = pluginApi.getStatus({ bypassCache: true });
        expect(transport).toHaveBeenCalledOnce();
        armIdentitySwitch = true;
        const staleA = status(authority(scopeA, generationA));
        oldResponse.resolve(staleA);

        await expect(request).resolves.toEqual(staleA);
        expect(identitySwitchQueued).toBe(true);
        expect(establishCurrentB).toBeDefined();
        await expect(establishCurrentB).resolves.not.toBeNull();
        expect(publications).toEqual([]);
        expect(getConfiguredRowFreshnessSnapshot()).toMatchObject({
            authority: `${scopeB}.${generationB}`,
            identityKey: 'server-a:user-b',
            status: 'CURRENT'
        });
        unsubscribe();
    });
});
