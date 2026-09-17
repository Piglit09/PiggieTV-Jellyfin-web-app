/* eslint-disable @typescript-eslint/naming-convention -- Test fixtures preserve Axios/Jellyfin wire keys. */
import type { ApiClient } from 'jellyfin-apiclient';
import { describe, expect, it } from 'vitest';

import { sanitizePtvSdkTransportError, toApi } from './compat';

const ACCESS_CANARY = [ 'PTV_TEST', 'ACCESS_TOKEN', 'sdk-transport' ].join('_');

function serializeError(value: unknown) {
    const error = value as Error & Record<string, unknown>;

    return JSON.stringify({
        ...error,
        message: error.message,
        stack: error.stack
    });
}

describe('Jellyfin SDK transport credential safety', () => {
    it('sanitizes nested Axios request and response state without replacing the error identity', () => {
        const error = Object.assign(new Error(`failed?api_key=${ACCESS_CANARY}`), {
            accessKey: ACCESS_CANARY,
            config: {
                headers: { Authorization: `Bearer ${ACCESS_CANARY}` },
                params: { access_token: ACCESS_CANARY },
                url: `/Items?api_key=${ACCESS_CANARY}`
            },
            request: { responseURL: `https://server.invalid?api_key=${ACCESS_CANARY}` },
            response: {
                config: { headers: { 'X-Emby-Token': ACCESS_CANARY } },
                data: { refreshToken: ACCESS_CANARY },
                request: { responseURL: `https://server.invalid?api_key=${ACCESS_CANARY}` }
            }
        });

        expect(sanitizePtvSdkTransportError(error)).toBe(error);
        const serialized = serializeError(error);
        expect(serialized).not.toContain(ACCESS_CANARY);
        expect(serialized).toContain('[REDACTED]');
        expect(error.request).toBe('[request omitted]');
    });

    it('keeps the outgoing credential intact but sanitizes the rejected diagnostic object', async () => {
        const apiClient = {
            accessToken: () => ACCESS_CANARY,
            appName: () => 'PiggieTV',
            appVersion: () => '0.0.0-test',
            deviceId: () => 'device-test',
            deviceName: () => 'Test Device',
            serverAddress: () => 'https://server.invalid'
        } as ApiClient;
        const api = toApi(apiClient);
        let observedAuthorization = '';
        let caught: unknown;

        try {
            await api.axiosInstance.request({
                adapter: async config => {
                    observedAuthorization = String(config.headers?.get('Authorization') || '');
                    throw Object.assign(new Error(`request failed?token=${ACCESS_CANARY}`), {
                        config,
                        request: { responseURL: `https://server.invalid?api_key=${ACCESS_CANARY}` }
                    });
                },
                headers: { Authorization: `Bearer ${ACCESS_CANARY}` },
                method: 'GET',
                url: `/Items?api_key=${ACCESS_CANARY}`
            });
        } catch (error) {
            caught = error;
        }

        expect(observedAuthorization).toContain(ACCESS_CANARY);
        expect(serializeError(caught)).not.toContain(ACCESS_CANARY);
        expect(serializeError(caught)).toContain('[REDACTED]');
    });
});

/* eslint-enable @typescript-eslint/naming-convention */
