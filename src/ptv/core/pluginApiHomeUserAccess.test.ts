import { beforeEach, describe, expect, it, vi } from 'vitest';

const connection = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('lib/jellyfin-apiclient', () => ({ ServerConnections: { currentApiClient: () => connection.client } }));

import { getCurrentPtvPluginApiClient, resetPtvPluginApiAvailability } from './pluginApi';

describe('administrator user-access transport', () => {
    beforeEach(() => {
        connection.client = null;
        (window as unknown as { ApiClient?: unknown }).ApiClient = undefined;
        resetPtvPluginApiAvailability();
    });

    it('normalizes the Plugin current-policy fields without losing retained folder preferences', async () => {
        const requests: string[] = [];
        const userId = '22222222222222222222222222222222';
        const folderId = '33333333333333333333333333333333';
        const client = {
            getUrl: (path: string) => `https://active.example.test/${path}`,
            accessToken: () => 'token', getCurrentUserId: () => 'admin', serverId: () => 'server-a',
            getJSON: async (url: string) => {
                requests.push(url);
                return {
                    version: 1,
                    userId,
                    verificationBatchId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
                    state: 'unproven',
                    currentAccess: {
                        UserId: userId,
                        EnableAllFolders: true,
                        EnabledFolders: [ folderId ],
                        IsAdministrator: false,
                        IsDisabled: false
                    },
                    expectedAccess: null,
                    intendedAccess: {
                        UserId: userId,
                        EnableAllFolders: false,
                        EnabledFolders: [ folderId ],
                        IsAdministrator: false,
                        IsDisabled: false
                    }
                };
            },
            serverAddress: () => 'https://active.example.test'
        };
        connection.client = client;

        const response = await getCurrentPtvPluginApiClient(client)!.getCurrentHomeUserAccess(userId);

        expect(requests).toEqual([ `https://active.example.test/Ptv/v1/home-user-access/current?userId=${userId}` ]);
        expect(response.verificationBatchId).toBe('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
        expect(response.currentAccess).toEqual({
            userId,
            enableAllFolders: true,
            enabledFolders: [ folderId ],
            isAdministrator: false,
            isDisabled: false
        });
        expect(response.intendedAccess).toEqual({
            userId,
            enableAllFolders: false,
            enabledFolders: [ folderId ],
            isAdministrator: false,
            isDisabled: false
        });
    });

    it.each([
        { UserId: '22222222222222222222222222222222', EnableAllFolders: false },
        {
            userId: '22222222222222222222222222222222',
            EnableAllFolders: false,
            enabledFolders: [],
            isAdministrator: false,
            isDisabled: false
        }
    ])('rejects an incomplete or mixed-format current policy', async currentAccess => {
        const client = {
            getUrl: (path: string) => `https://active.example.test/${path}`,
            accessToken: () => 'token', getCurrentUserId: () => 'admin', serverId: () => 'server-a',
            getJSON: async () => ({
                version: 1, userId: '22222222222222222222222222222222', currentAccess
            }),
            serverAddress: () => 'https://active.example.test'
        };
        connection.client = client;

        await expect(getCurrentPtvPluginApiClient(client)!.getCurrentHomeUserAccess('22222222222222222222222222222222'))
            .rejects.toMatchObject({ code: 'PTV_PLUGIN_ACCESS_RESPONSE_INVALID' });
    });

    it('sends a bounded verification batch and one selected candidate to the active Plugin only', async () => {
        const requests: Array<{ data?: string; method?: string; url: string }> = [];
        const client = {
            getUrl: (path: string) => `https://active.example.test/${path}`,
            accessToken: () => 'token', getCurrentUserId: () => 'admin', serverId: () => 'server-a',
            ajax: async (request: { data?: string; method?: string; url: string }) => {
                requests.push(request);
                return { id: '11111111111111111111111111111111', candidateUserIds: [] };
            },
            getJSON: async (url: string) => {
                requests.push({ url });
                return { id: '11111111111111111111111111111111', candidateUserIds: [] };
            },
            serverAddress: () => 'https://active.example.test'
        };
        connection.client = client;
        const plugin = getCurrentPtvPluginApiClient(client)!;

        await plugin.createHomeUserVerificationBatch();
        await plugin.getCurrentHomeUserVerificationBatch();
        await plugin.verifyHomeUserVerificationBatchCandidate(
            '11111111111111111111111111111111',
            '22222222222222222222222222222222',
            {
                confirmCurrentPolicy: true,
                intendedAccess: {
                    enableAllFolders: false,
                    enabledFolders: [ '33333333333333333333333333333333' ],
                    isAdministrator: false,
                    isDisabled: false,
                    userId: '22222222222222222222222222222222'
                }
            }
        );
        await plugin.getHomeUserVerificationSummary();
        await plugin.createFreshHomeUserVerificationBatch();
        await plugin.recoverCorruptHomeUserAccessLedger();
        await plugin.reserveHomeUserCreation({ creationOperationId: '44444444444444444444444444444444' });
        await plugin.bindHomeUserCreation('44444444444444444444444444444444', {
            userId: '55555555555555555555555555555555'
        });
        await plugin.getCurrentHomeUserCreations();
        await plugin.getHomeUserCreationOperationStatus('44444444444444444444444444444444');
        await plugin.recoverHomeUserCreation('44444444444444444444444444444444', {
            confirmCreationRequestSettled: true
        });

        expect(requests.map(request => [ request.method || 'GET', request.url ])).toEqual([
            [ 'POST', 'https://active.example.test/Ptv/v1/home-user-access/verification-batches' ],
            [ 'GET', 'https://active.example.test/Ptv/v1/home-user-access/verification-batches/current' ],
            [ 'POST', 'https://active.example.test/Ptv/v1/home-user-access/verification-batches/11111111111111111111111111111111/users/22222222222222222222222222222222/verify' ],
            [ 'GET', 'https://active.example.test/Ptv/v1/home-user-access/verification-summary' ],
            [ 'POST', 'https://active.example.test/Ptv/v1/home-user-access/verification-batches/new' ],
            [ 'POST', 'https://active.example.test/Ptv/v1/home-user-access/recover-corrupt' ],
            [ 'POST', 'https://active.example.test/Ptv/v1/home-user-access/creations/reserve' ],
            [ 'POST', 'https://active.example.test/Ptv/v1/home-user-access/creations/44444444444444444444444444444444/bind' ],
            [ 'GET', 'https://active.example.test/Ptv/v1/home-user-access/creations/current' ],
            [ 'GET', 'https://active.example.test/Ptv/v1/home-user-access/creations/44444444444444444444444444444444/status' ],
            [ 'POST', 'https://active.example.test/Ptv/v1/home-user-access/creations/44444444444444444444444444444444/recover' ]
        ]);
        expect(JSON.parse(requests[0].data!)).toEqual({});
        expect(JSON.parse(requests[2].data!)).toEqual({
            confirmCurrentPolicy: true,
            intendedAccess: {
                enableAllFolders: false,
                enabledFolders: [ '33333333333333333333333333333333' ],
                isAdministrator: false,
                isDisabled: false,
                userId: '22222222222222222222222222222222'
            }
        });
        expect(JSON.parse(requests[4].data!)).toEqual({});
        expect(JSON.parse(requests[5].data!)).toEqual({});
        expect(JSON.parse(requests[6].data!)).toEqual({ creationOperationId: '44444444444444444444444444444444' });
        expect(JSON.parse(requests[7].data!)).toEqual({ userId: '55555555555555555555555555555555' });
        expect(JSON.parse(requests[10].data!)).toEqual({ confirmCreationRequestSettled: true });
    });
});
