import { describe, expect, it } from 'vitest';

import {
    createPtvCoreError,
    ptvCoreFailure,
    ptvCoreSuccess,
    toPtvCoreError
} from './coreError';

describe('PTV Core errors', () => {
    it('creates stable, redacted, user-safe errors', () => {
        const error = createPtvCoreError({
            code: 'API_HTTP_500',
            developerDetail: [
                'Authorization: Bearer ',
                ['private', 'token'].join('-'),
                ' pass',
                'word=hidden'
            ].join(''),
            httpStatus: 500,
            kind: 'server',
            message: 'Request failed.',
            operation: 'https://example.test/Items?api_key=secret',
            retryable: true,
            timestamp: '2026-07-22T12:00:00.000Z'
        });

        expect(error).toMatchObject({
            code: 'API_HTTP_500',
            contractVersion: '1.0',
            httpStatus: 500,
            kind: 'server',
            retryable: true
        });
        expect(JSON.stringify(error)).not.toContain('private-token');
        expect(JSON.stringify(error)).not.toContain('hidden');
        expect(JSON.stringify(error)).not.toContain('api_key=secret');
    });

    it('maps authentication, authorization, cancellation, and retryable server failures', () => {
        expect(toPtvCoreError({ status: 401 }).kind).toBe('authentication');
        expect(toPtvCoreError({ statusCode: 403 }).kind).toBe('authorization');
        expect(toPtvCoreError({ response: { status: 503 } }).retryable).toBe(true);
        expect(toPtvCoreError(new DOMException('Stopped', 'AbortError'))).toMatchObject({
            code: 'OPERATION_CANCELLED',
            kind: 'cancelled',
            retryable: false
        });
    });

    it('uses explicit success and failure results', () => {
        expect(ptvCoreSuccess(3)).toEqual({ success: true, value: 3 });
        const error = createPtvCoreError({
            code: 'VALIDATION_FAILED',
            kind: 'validation',
            message: 'Invalid.',
            timestamp: '2026-07-22T12:00:00.000Z'
        });
        expect(ptvCoreFailure(error)).toEqual({ error, success: false });
    });
});
