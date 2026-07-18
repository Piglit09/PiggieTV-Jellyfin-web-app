import { describe, expect, it, vi } from 'vitest';

vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        currentApiClient: () => null
    }
}));

import { normalizePtvApiError } from './pluginApi';

describe('normalizePtvApiError', () => {
    it('classifies HTTP 500 as a plugin server error and sanitizes its response body', () => {
        const sampleCredential = [ 'sample', 'credential' ].join('-');
        const result = normalizePtvApiError({
            message: 'Network middleware reported an unavailable service',
            responseText: `authorization=Bearer ${sampleCredential} token=${sampleCredential}`,
            status: 500
        });

        expect(result).toMatchObject({
            kind: 'server',
            message: 'Plugin server error: endpoint returned HTTP 500',
            status: 500
        });
        expect(result.responseBody).toContain('[redacted]');
        expect(result.responseBody).not.toContain(sampleCredential);
    });

    it('keeps transport failures separate from HTTP responses', () => {
        expect(normalizePtvApiError(new TypeError('Failed to fetch'))).toMatchObject({
            kind: 'network',
            message: 'Network failure: endpoint unreachable',
            status: undefined
        });
    });
});
