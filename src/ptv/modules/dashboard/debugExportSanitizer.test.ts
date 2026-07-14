import { describe, expect, it } from 'vitest';

import {
    sanitizePtvDebugExport,
    serializeSanitizedPtvDebugExport
} from './debugExportSanitizer';

describe('debugExportSanitizer', () => {
    it('redacts sensitive dashboard data while preserving useful request diagnostics', () => {
        const sensitiveUserId = '11112222333344445555666677778888';
        const sensitiveItemId = 'aaaabbbbccccddddeeeeffff00001111';
        const privateHost = ['10', '23', '45', '67'].join('.');
        const snapshot = {
            authorization: 'Bearer highly-sensitive-token',
            cachePath: 'C:\\Users\\ExampleUser\\AppData\\Local\\jellyfin\\ptv-cache.json',
            imageUrl: `http://${privateHost}:8096/Items/${sensitiveItemId}/Images/Primary?fillWidth=320&quality=90`,
            serverHost: 'jellyfin.internal',
            request: {
                durationMs: 8123.4,
                method: 'GET',
                requestUrl: `http://${privateHost}:8096/Users/${sensitiveUserId}/Items?Fields=Overview%2CMediaSources&Limit=50&api_key=secret`,
                statusCode: 200,
                userId: sensitiveUserId
            },
            signup: {
                emailConfigured: true,
                emailEnabled: true,
                enabled: true,
                fromDomain: 'private.example',
                nativeUserCount: 4,
                pendingResetCount: 1,
                pendingVerificationCount: 2,
                smtpHost: 'smtp.private.example',
                smtpPasswordConfigured: true,
                smtpPort: 587,
                smtpUsername: 'private-user'
            },
            tmdbApiToken: 'tmdb-secret'
        };

        const serialized = serializeSanitizedPtvDebugExport(snapshot);
        const parsed = JSON.parse(serialized) as Record<string, unknown>;

        expect(serialized).not.toContain(privateHost);
        expect(serialized).not.toContain(sensitiveUserId);
        expect(serialized).not.toContain(sensitiveItemId);
        expect(serialized).not.toContain('highly-sensitive-token');
        expect(serialized).not.toContain('tmdb-secret');
        expect(serialized).not.toContain('smtp.private.example');
        expect(serialized).not.toContain('private-user');
        expect(serialized).not.toContain('jellyfin.internal');
        expect(serialized).not.toContain('C:\\Users\\ExampleUser');
        expect(serialized).toContain('[origin-redacted]/Users/{userId}/Items?Fields&Limit&api_key');
        expect(serialized).toContain('[origin-redacted]/Items/{itemId}/Images/Primary?fillWidth&quality');
        expect(serialized).toContain('8123.4');
        expect(serialized).toContain('statusCode');
        expect(serialized).toContain('"serverHost": "[private-host]"');
        expect(parsed.sanitization).toBeTruthy();
    });

    it('does not mutate input and bounds nested arrays, strings, objects, and depth', () => {
        const input = {
            events: Array.from({ length: 8 }, (_, index) => ({ index, message: 'x'.repeat(40) })),
            nested: {
                one: {
                    two: {
                        three: 'value'
                    }
                }
            },
            object: {
                a: 1,
                b: 2,
                c: 3
            }
        };
        const original = JSON.stringify(input);
        const sanitized = sanitizePtvDebugExport(input, {
            maxArrayLength: 2,
            maxDepth: 3,
            maxObjectKeys: 2,
            maxStringLength: 10
        });
        const report = sanitized.sanitization;

        expect(JSON.stringify(input)).toBe(original);
        expect(report.truncatedArrays).toBeGreaterThan(0);
        expect(report.truncatedDepth).toBeGreaterThan(0);
        expect(report.truncatedObjects).toBeGreaterThan(0);
        expect(report.truncatedStrings).toBeGreaterThan(0);
    });
});
