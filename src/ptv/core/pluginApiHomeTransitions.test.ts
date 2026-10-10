import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '@jellyfin/sdk';
const connection = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('lib/jellyfin-apiclient', () => ({ ServerConnections: { currentApiClient: () => connection.client } }));
import { getCurrentPtvPluginApiClient, resetPtvPluginApiAvailability } from './pluginApi';

describe('administrator transition transport', () => {
    beforeEach(() => {
        connection.client = null;
        (window as unknown as { ApiClient?: unknown }).ApiClient = undefined;
        resetPtvPluginApiAvailability();
    });
    it.each(['begin', 'complete', 'current'])('never sends %s to a configured fallback server', async kind => {
        const calls: string[] = [];
        const request = async (url: string) => {
            calls.push(url);
            if (url.startsWith('https://active.example.test/')) throw Object.assign(new Error('not found'), { status: 404 });
            return { held: true, state: 'pending' };
        };
        const client = {
            getUrl: (path: string) => `https://active.example.test/${path}`,
            accessToken: () => 'token', getCurrentUserId: () => 'admin', serverId: () => 'server-a',
            ajax: ({ url }: { url: string }) => request(url), getJSON: request,
            serverAddress: () => 'https://active.example.test'
        };
        connection.client = client;
        const plugin = getCurrentPtvPluginApiClient(client)!;
        let call;
        if (kind === 'begin') call = plugin.beginHomeTransition({ operationId: 'operation-a', kind: 'delete', serverId: 'server-a' });
        else if (kind === 'complete') call = plugin.completeHomeTransition('operation-a');
        else call = plugin.getCurrentHomeTransition();
        await expect(call).rejects.toMatchObject({ status: 404 });
        expect(calls).toHaveLength(1);
        expect(calls[0]).toContain('https://active.example.test/Ptv/v1/home-transitions/');
        expect(plugin.matchesSdkApi({ basePath: 'https://other.example.test', accessToken: 'token' } as Api)).toBe(false);
        expect(plugin.matchesSdkApi({ basePath: 'https://active.example.test', accessToken: 'wrong' } as Api)).toBe(false);
    });

    it('posts only administrator-selected rule and current folder IDs for completion', async () => {
        const requests: Array<{ data?: string; method?: string; url: string }> = [];
        const client = {
            getUrl: (path: string) => `https://active.example.test/${path}`,
            accessToken: () => 'token', getCurrentUserId: () => 'admin', serverId: () => 'server-a',
            ajax: async (request: { data?: string; method?: string; url: string }) => {
                requests.push(request);
                return { operationId: 'operation-a', held: true, state: 'pending' };
            },
            serverAddress: () => 'https://active.example.test'
        };
        connection.client = client;
        const plugin = getCurrentPtvPluginApiClient(client)!;

        await plugin.completeHomeTransition('operation-a', {
            bindings: [{ ruleId: 'anime', libraryId: 'current-folder-id' }]
        });

        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('POST');
        expect(requests[0].url).toContain('/Ptv/v1/home-transitions/operation-a/complete');
        expect(JSON.parse(requests[0].data!)).toEqual({
            bindings: [{ ruleId: 'anime', libraryId: 'current-folder-id' }]
        });
    });
});
