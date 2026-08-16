/* eslint-disable @typescript-eslint/naming-convention, compat/compat -- Tests intentionally exercise wire-format keys and native security objects. */
import { describe, expect, it } from 'vitest';

import {
    isPtvSensitiveKey,
    PTV_REDACTED_VALUE,
    redactPtvCoreText,
    redactPtvSensitiveText,
    redactPtvSensitiveValue
} from './redaction';

const ACCESS_CANARY = [ 'PTV_TEST', 'ACCESS_TOKEN', '4ea61f' ].join('_');
const PASSWORD_CANARY = [ 'PTV_TEST', 'PASSWORD', '83be9a' ].join('_');
const API_KEY_CANARY = [ 'PTV_TEST', 'API_KEY', 'dcc112' ].join('_');
const JELLYFIN_TOKEN_FIELD = [ 'To', 'ken' ].join('');

describe('credential redaction', () => {
    it('matches explicit credential keys without hiding safe token metrics', () => {
        const sensitiveKeys = [
            'Authorization',
            'proxy-authorization',
            'AccessToken',
            'access_token',
            'accessKey',
            'ExchangeToken',
            'token',
            'authToken',
            'authenticationToken',
            'X-Api-Key',
            'X-Auth-Token',
            'TmdbReadAccessToken',
            'TmdbApiKey',
            'musicDiscogsToken',
            'certificatePassword',
            'inviteCode',
            'passwordResetCode',
            'verificationToken',
            'apiKey',
            'api_key',
            'password',
            'secret',
            'clientSecret',
            'refreshToken',
            'refresh_token',
            'cookie',
            'set-cookie',
            'X-Emby-Authorization'
        ];

        sensitiveKeys.forEach(key => {
            expect(isPtvSensitiveKey(key)).toBe(true);
        });
        expect(isPtvSensitiveKey('tokenCount')).toBe(false);
        expect(isPtvSensitiveKey('tokenUsage')).toBe(false);

        expect(redactPtvSensitiveValue({
            AccessToken: ACCESS_CANARY,
            api_key: API_KEY_CANARY,
            password: PASSWORD_CANARY,
            tokenCount: 17,
            tokenUsage: 29
        })).toEqual({
            AccessToken: PTV_REDACTED_VALUE,
            api_key: PTV_REDACTED_VALUE,
            password: PTV_REDACTED_VALUE,
            tokenCount: 17,
            tokenUsage: 29
        });
    });

    it('redacts headers, Jellyfin token assignments, and sensitive URL parameters', () => {
        const input = [
            `Authorization: Bearer ${ACCESS_CANARY}`,
            `X-Emby-Authorization: MediaBrowser Client="PiggieTV", ${JELLYFIN_TOKEN_FIELD}="${ACCESS_CANARY}"`,
            `https://server.invalid/socket?api_key=${API_KEY_CANARY}&name=test`,
            `https://provider.invalid/search?key=${API_KEY_CANARY}&title=test`,
            `#/quickconnect?code=${ACCESS_CANARY}`,
            `https://server.invalid/connect?auth=${ACCESS_CANARY}&mode=test`,
            `access_token=${ACCESS_CANARY}`,
            `accessKey=${ACCESS_CANARY}`,
            `exchangeToken=${ACCESS_CANARY}`,
            `certificatePassword=${PASSWORD_CANARY}`,
            `inviteCode=${ACCESS_CANARY}`,
            `password=${PASSWORD_CANARY}`
        ].join('\n');
        const redacted = redactPtvSensitiveText(input, 4000);

        expect(redacted).not.toContain(ACCESS_CANARY);
        expect(redacted).not.toContain(API_KEY_CANARY);
        expect(redacted).not.toContain(PASSWORD_CANARY);
        expect(redacted).toContain(PTV_REDACTED_VALUE);
        expect(redacted).toContain('name=test');
    });

    it('removes authenticated Reader URL details from user-visible error text', () => {
        const input = `Unexpected server response while retrieving PDF from https://server.invalid/Items/item-id/Download?api_key=${API_KEY_CANARY}&download=true`;
        const redacted = redactPtvCoreText(input, 500);

        expect(redacted).not.toContain(API_KEY_CANARY);
        expect(redacted).not.toContain('download=true');
        expect(redacted).toContain('https://server.invalid/Items/item-id/Download?[redacted]');
    });

    it('sanitizes nested arrays, circular objects, Error properties, Headers, and URLSearchParams', () => {
        const circular: Record<string, unknown> = {
            values: [{ apiKey: API_KEY_CANARY }]
        };
        circular.self = circular;
        const error = Object.assign(new Error(`request failed?token=${ACCESS_CANARY}`), {
            config: {
                headers: {
                    Authorization: `Bearer ${ACCESS_CANARY}`
                }
            },
            response: {
                config: {
                    headers: new Headers([
                        [ 'X-Api-Key', API_KEY_CANARY ],
                        [ 'X-Emby-Authorization', `MediaBrowser ${JELLYFIN_TOKEN_FIELD}="${ACCESS_CANARY}"` ]
                    ])
                }
            }
        });
        Object.defineProperty(error, 'throwingCredentialGetter', {
            enumerable: true,
            get: () => {
                throw new Error('unavailable');
            }
        });
        const params = new URLSearchParams({
            api_key: API_KEY_CANARY,
            auth: ACCESS_CANARY,
            code: ACCESS_CANARY,
            key: API_KEY_CANARY,
            name: 'test'
        });
        const sanitized = redactPtvSensitiveValue({ circular, error, params });
        const serialized = JSON.stringify(sanitized);

        expect(serialized).not.toContain(ACCESS_CANARY);
        expect(serialized).not.toContain(API_KEY_CANARY);
        expect(serialized).toContain('[circular-reference]');
        expect(serialized).toContain('[unavailable]');
        expect(serialized).toContain('name');
        expect(serialized).toContain(PTV_REDACTED_VALUE);
    });

    it('does not treat context-sensitive query key names as generic object secrets', () => {
        const sanitizedRecord = redactPtvSensitiveValue({
            auth: 'authentication mode',
            code: 204,
            key: 'display-key'
        });

        expect(sanitizedRecord).toEqual({
            auth: 'authentication mode',
            code: 204,
            key: 'display-key'
        });
    });

    it('bounds strings, collections, depth, binary data, blobs, and DOM nodes without mutating input', () => {
        const input = {
            array: Array.from({ length: 8 }, (_, index) => ({ index })),
            binary: new Uint8Array([ 1, 2, 3 ]),
            blob: new Blob([ 'fixture' ]),
            long: 'x'.repeat(80),
            nested: { one: { two: { three: 'value' } } },
            node: document.createElement('div'),
            object: { a: 1, b: 2, c: 3 }
        };
        const originalArrayLength = input.array.length;
        const sanitized = redactPtvSensitiveValue(input, {
            maxArrayItems: 2,
            maxDepth: 3,
            maxObjectKeys: 10,
            maxStringLength: 10
        });
        const serialized = JSON.stringify(sanitized);
        const boundedObject = redactPtvSensitiveValue(input.object, {
            maxObjectKeys: 2
        });

        expect(input.array).toHaveLength(originalArrayLength);
        expect(serialized).toContain('entries tru');
        expect(serialized).toContain('[truncated]');
        expect(serialized).toContain('[binary data omitted]');
        expect(serialized).toContain('[Blob omitt');
        expect(serialized).toContain('[DOM node ');
        expect(boundedObject).toEqual({ a: 1, b: 2, __truncatedKeys: 1 });
        expect(serialized.length).toBeLessThan(500);
    });
});

/* eslint-enable @typescript-eslint/naming-convention, compat/compat */
