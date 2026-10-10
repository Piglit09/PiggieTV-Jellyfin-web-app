import type { Api } from '@jellyfin/sdk';
import type { ApiClient } from 'jellyfin-apiclient';
import { describe, expect, it } from 'vitest';

import { getAdminStorageQueryOptions } from './useAdminStorage';

const api = (basePath = 'https://example.test/jellyfin', accessToken = 'test-token') => ({
    accessToken,
    basePath
}) as Api;
const client = (
    serverId: string | null,
    userId: string | null = 'admin-a',
    address = 'https://example.test/jellyfin',
    token = 'test-token'
) => ({
    accessToken: () => token,
    getCurrentUserId: () => userId,
    serverAddress: () => address,
    serverId: () => serverId
}) as ApiClient;

describe('admin storage query identity', () => {
    it('uses the concrete server identity so another server cannot reuse capacity data', () => {
        const first = getAdminStorageQueryOptions(api(), client('server-a'));
        const second = getAdminStorageQueryOptions(api(), client('server-b'));

        expect(first.enabled).toBe(true);
        expect(first.queryKey).toEqual([ 'PtvAdminStorage', 'server-a', 'server-a:admin-a', 'https://example.test/jellyfin', 'System/Info/Storage' ]);
        expect(second.queryKey).toEqual([ 'PtvAdminStorage', 'server-b', 'server-b:admin-a', 'https://example.test/jellyfin', 'System/Info/Storage' ]);
    });

    it('does not reuse a storage response across authenticated users on the same server', () => {
        const first = getAdminStorageQueryOptions(api(), client('server-a', 'admin-a'));
        const second = getAdminStorageQueryOptions(api(), client('server-a', 'admin-b'));

        expect(first.enabled).toBe(true);
        expect(second.enabled).toBe(true);
        expect(first.queryKey).not.toEqual(second.queryKey);
        expect(second.queryKey).toEqual([ 'PtvAdminStorage', 'server-a', 'server-a:admin-b', 'https://example.test/jellyfin', 'System/Info/Storage' ]);
    });

    it('does not reuse capacity from a clone with the same server and user IDs at another origin', () => {
        const first = getAdminStorageQueryOptions(api(), client('server-a'));
        const clone = getAdminStorageQueryOptions(
            api('https://clone.test/jellyfin'),
            client('server-a', 'admin-a', 'https://clone.test/jellyfin')
        );

        expect(first.enabled).toBe(true);
        expect(clone.enabled).toBe(true);
        expect(first.queryKey).not.toEqual(clone.queryKey);
    });

    it('fails closed while legacy identity and SDK transport belong to different connections or sessions', () => {
        const differentServer = getAdminStorageQueryOptions(api(), client('server-b', 'admin-b', 'https://other.test/jellyfin'));
        const differentToken = getAdminStorageQueryOptions(api(), client('server-a', 'admin-a', 'https://example.test/jellyfin', 'new-token'));

        expect(differentServer.enabled).toBe(false);
        expect(differentToken.enabled).toBe(false);
        expect(differentServer.queryKey).toEqual([ 'PtvAdminStorage', 'UNVERIFIED', 'System/Info/Storage' ]);
        expect(differentToken.queryKey).toEqual([ 'PtvAdminStorage', 'UNVERIFIED', 'System/Info/Storage' ]);
    });

    it('does not request administrator storage without a concrete authenticated server and user', () => {
        expect(getAdminStorageQueryOptions(api(), client(null)).enabled).toBe(false);
        expect(getAdminStorageQueryOptions(api(), client('server-a', null)).enabled).toBe(false);
        expect(getAdminStorageQueryOptions(undefined, client('server-a')).enabled).toBe(false);
    });
});
