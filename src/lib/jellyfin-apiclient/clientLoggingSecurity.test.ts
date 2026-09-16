// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const localRequire = createRequire(import.meta.url);
const securityLoader = localRequire('../../../scripts/ptv-jellyfin-apiclient-security-loader.cjs') as {
    transformJellyfinApiClientSource: (source: string) => string;
};
const ACCESS_CANARY = [ 'PTV_TEST', 'ACCESS_TOKEN', 'client' ].join('_');
const PASSWORD_CANARY = [ 'PTV_TEST', 'PASSWORD', 'login' ].join('_');
const JELLYFIN_TOKEN_FIELD = [ 'To', 'ken' ].join('');
const CONSOLE_LEVELS = [ 'debug', 'error', 'info', 'log', 'warn' ] as const;
const SOCKET_AUTH_CONSTRUCTION = 't+="?api_key=".concat(e),t+="&deviceId=".concat(this.deviceId())';

type CapturedConsoleCall = [string, ...unknown[]];

function expectCanariesAbsentAcrossConsoleLevels(calls: CapturedConsoleCall[], canaries: string[]) {
    CONSOLE_LEVELS.forEach(level => {
        const output = JSON.stringify(calls.filter(([callLevel]) => callLevel === level));

        canaries.forEach(canary => {
            expect(output).not.toContain(canary);
        });
    });
}

function readApiClientSource() {
    return readFileSync(localRequire.resolve('jellyfin-apiclient'), 'utf8');
}

function getSocketAuthConstruction(source: string) {
    const firstIndex = source.indexOf(SOCKET_AUTH_CONSTRUCTION);

    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(source.indexOf(SOCKET_AUTH_CONSTRUCTION, firstIndex + SOCKET_AUTH_CONSTRUCTION.length)).toBe(-1);
    return SOCKET_AUTH_CONSTRUCTION;
}

function loadPatchedClient(storedCredentials = '{}') {
    const source = readApiClientSource();
    const transformed = securityLoader.transformJellyfinApiClientSource(source);
    const calls: CapturedConsoleCall[] = [];
    const storedValues = new Map([ [ 'jellyfin_credentials', storedCredentials ] ]);
    const socketUrls: string[] = [];
    const socketInstances: TestWebSocket[] = [];
    const capturedConsole = Object.fromEntries(
        CONSOLE_LEVELS.map(method => [
            method,
            (...values: unknown[]) => calls.push([ method, ...values ])
        ])
    );

    class TestWebSocket {
        public static readonly CONNECTING = 0;
        public static readonly OPEN = 1;
        public onclose: (() => void) | null = null;
        public onerror: (() => void) | null = null;
        public onmessage: (() => void) | null = null;
        public onopen: (() => void) | null = null;
        public readyState = TestWebSocket.OPEN;

        public constructor(public readonly url: string) {
            socketUrls.push(url);
            socketInstances.push(this);
        }

        public close() {
            this.readyState = 3;
        }
    }

    const fetchMock = vi.fn(async () => new Response('{}', {
        headers: { 'Content-Type': 'application/json' },
        status: 200
    }));
    const context = {
        Date,
        Error,
        JSON,
        Promise,
        RegExp,
        Response,
        URL,
        WebSocket: TestWebSocket,
        clearTimeout,
        console: capturedConsole,
        decodeURIComponent,
        encodeURIComponent,
        exports: {},
        fetch: fetchMock,
        localStorage: {
            getItem: (key: string) => storedValues.get(key) || null,
            removeItem: (key: string) => storedValues.delete(key),
            setItem: (key: string, value: string) => storedValues.set(key, value)
        },
        module: { exports: {} as Record<string, new (...args: never[]) => unknown> },
        self: {},
        setTimeout
    };

    vm.runInNewContext(transformed, context);

    return {
        calls,
        client: context.module.exports,
        fetchMock,
        socketInstances,
        socketUrls,
        transformed
    };
}

describe('jellyfin-apiclient console security patch', () => {
    it('is fail-closed when an audited upstream logging call changes', () => {
        expect(() => securityLoader.transformJellyfinApiClientSource('console.log("different upstream source")'))
            .toThrow(/expected 1 jellyfin-apiclient match/);
    });

    it('rejects an unrelated legacy query when the WebSocket construction already uses ApiKey', () => {
        const source = readApiClientSource();
        const socketAuthConstruction = getSocketAuthConstruction(source);
        const driftedSource = source.replace(
            socketAuthConstruction,
            socketAuthConstruction.replace('?api_key=', '?ApiKey=')
        ) + '\nconst unrelatedLegacyQuery = "?api_key=not-a-websocket";';

        expect(() => securityLoader.transformJellyfinApiClientSource(driftedSource))
            .toThrow(/websocket-auth-query-name expected 1 jellyfin-apiclient match\(es\), found 0/);
    });

    it('rejects duplicate WebSocket authentication constructions', () => {
        const source = readApiClientSource();
        const socketAuthConstruction = getSocketAuthConstruction(source);
        const duplicatedSource = source.replace(
            socketAuthConstruction,
            `${socketAuthConstruction},${socketAuthConstruction}`
        );

        expect(() => securityLoader.transformJellyfinApiClientSource(duplicatedSource))
            .toThrow(/websocket-auth-query-name expected 1 jellyfin-apiclient match\(es\), found 2/);
    });

    it('restores credentials and authenticates the WebSocket without exposing the token to any console level', () => {
        const storedCredentials = JSON.stringify({
            Servers: [{
                AccessToken: ACCESS_CANARY,
                Id: 'server-fixture',
                UserId: 'user-fixture'
            }]
        });
        const { calls, client, socketInstances, socketUrls, transformed } = loadPatchedClient(storedCredentials);
        const Credentials = client.Credentials as unknown as new () => {
            credentials: () => { Servers: Array<{ AccessToken: string }> };
        };
        const ApiClient = client.ApiClient as unknown as new (...args: string[]) => {
            enableAutomaticBitrateDetection: boolean;
            openWebSocket: () => void;
            setAuthenticationInfo: (token: string, userId: string) => void;
        };
        const credentials = new Credentials();
        const apiClient = new ApiClient(
            'https://server.invalid',
            'PiggieTV',
            '0.0.0-test',
            'Test Device',
            'device-fixture'
        );

        apiClient.enableAutomaticBitrateDetection = false;
        apiClient.setAuthenticationInfo(ACCESS_CANARY, 'user-fixture');
        apiClient.openWebSocket();
        socketInstances[0].onerror?.();

        expect(credentials.credentials().Servers[0].AccessToken).toBe(ACCESS_CANARY);
        expect(socketUrls).toHaveLength(1);
        expect(socketUrls[0]).toContain(`?ApiKey=${ACCESS_CANARY}`);
        expect(socketUrls[0]).toContain('&deviceId=device-fixture');
        expect(socketUrls[0]).not.toContain('?api_key=');
        expect(transformed.match(/\?ApiKey=/g)).toHaveLength(1);
        expect(transformed).not.toContain('?api_key=');
        expectCanariesAbsentAcrossConsoleLevels(calls, [ ACCESS_CANARY ]);
        expect(transformed).not.toContain('Stored JSON credentials:');
        expect(transformed).not.toContain('opening web socket with url:');
        expect(transformed).not.toContain('Clearing KeepAlive for');
    });

    it('authenticates by password without exposing the submitted password or returned token to any console level', async () => {
        const { calls, client, fetchMock } = loadPatchedClient();
        const ApiClient = client.ApiClient as unknown as new (...args: string[]) => {
            authenticateUserByName: (username: string, password: string) => Promise<{
                AccessToken: string;
                User: { Id: string };
            }>;
            enableAutomaticBitrateDetection: boolean;
        };
        const apiClient = new ApiClient(
            'https://server.invalid',
            'PiggieTV',
            '0.0.0-test',
            'Test Device',
            'device-fixture'
        );
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
            AccessToken: ACCESS_CANARY,
            User: { Id: 'user-fixture' }
        }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200
        }));

        const result = await apiClient.authenticateUserByName('user-fixture', PASSWORD_CANARY);

        expect(result.AccessToken).toBe(ACCESS_CANARY);
        expect(result.User.Id).toBe('user-fixture');
        expectCanariesAbsentAcrossConsoleLevels(calls, [ PASSWORD_CANARY, ACCESS_CANARY ]);
    });

    it('keeps authenticated request URLs out of success and failure console messages', async () => {
        const { calls, client, fetchMock } = loadPatchedClient();
        const ApiClient = client.ApiClient as unknown as new (...args: string[]) => {
            enableAutomaticBitrateDetection: boolean;
            fetch: (request: Record<string, unknown>) => Promise<unknown>;
            setAuthenticationInfo: (token: string, userId: string) => void;
        };
        const apiClient = new ApiClient(
            'https://server.invalid',
            'PiggieTV',
            '0.0.0-test',
            'Test Device',
            'device-fixture'
        );

        apiClient.enableAutomaticBitrateDetection = false;
        apiClient.setAuthenticationInfo(ACCESS_CANARY, 'user-fixture');
        await apiClient.fetch({
            dataType: 'json',
            headers: { accept: 'application/json' },
            type: 'GET',
            url: `https://server.invalid/Items?api_key=${ACCESS_CANARY}`
        });
        fetchMock.mockResolvedValueOnce(new Response('request denied', {
            status: 401,
            statusText: 'Unauthorized'
        }));
        await expect(apiClient.fetch({
            dataType: 'json',
            headers: { Authorization: `MediaBrowser ${JELLYFIN_TOKEN_FIELD}="${ACCESS_CANARY}"` },
            type: 'GET',
            url: `https://server.invalid/Users/Me?api_key=${ACCESS_CANARY}`
        })).rejects.toBeTruthy();

        expectCanariesAbsentAcrossConsoleLevels(calls, [ ACCESS_CANARY ]);
    });
});
