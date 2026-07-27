import { describe, expect, it, vi } from 'vitest';

import {
    buildPtvCoreApiUrl,
    createPtvCoreRequestCancellation,
    createPtvCoreRequestHeaders,
    getPtvCoreAliasedField,
    normalizePtvCoreBaseUrl,
    normalizePtvCoreHttpMethod,
    shouldRetryPtvCoreRequest
} from './apiContracts';

describe('PTV Core API contracts', () => {
    it('normalizes base URLs and relative request paths', () => {
        expect(normalizePtvCoreBaseUrl(' https://example.test/jellyfin///?secret=value#x '))
            .toBe('https://example.test/jellyfin');
        expect(buildPtvCoreApiUrl('https://example.test/jellyfin/', '/Users', {
            empty: '',
            enabled: false,
            ids: ['a', 'b'],
            limit: 0,
            missing: null
        })).toBe('https://example.test/jellyfin/Users?enabled=false&ids=a%2Cb&limit=0');
        expect(() => normalizePtvCoreBaseUrl('file:///private')).toThrow(TypeError);
    });

    it('normalizes methods and reads camelCase or PascalCase without recasing payloads', () => {
        expect(normalizePtvCoreHttpMethod(' get ')).toBe('GET');
        expect(normalizePtvCoreHttpMethod('TRACE')).toBeNull();
        expect(getPtvCoreAliasedField({ CacheVersion: 7 }, 'cacheVersion')).toBe(7);
        expect(getPtvCoreAliasedField({ cacheVersion: 8, CacheVersion: 7 }, 'cacheVersion')).toBe(8);
    });

    it('applies authorization only at the request boundary', () => {
        expect(createPtvCoreRequestHeaders({ Accept: 'application/json' }, {
            name: 'X-MediaBrowser-Token',
            value: 'test-token'
        })).toEqual({
            Accept: 'application/json',
            'X-MediaBrowser-Token': 'test-token'
        });
        expect(createPtvCoreRequestHeaders({}, { value: '  ' })).toEqual({});
    });

    it('cancels from a caller signal and from a timeout', () => {
        vi.useFakeTimers();
        const external = createPtvCoreRequestCancellation();
        const linked = createPtvCoreRequestCancellation({ signal: external.signal });
        external.signal.dispatchEvent(new Event('abort'));
        expect(linked.signal.aborted).toBe(true);
        linked.dispose();
        external.dispose();

        const timed = createPtvCoreRequestCancellation({ timeoutMs: 50 });
        vi.advanceTimersByTime(49);
        expect(timed.signal.aborted).toBe(false);
        vi.advanceTimersByTime(1);
        expect(timed.signal.aborted).toBe(true);
        timed.dispose();
        vi.useRealTimers();
    });

    it('retries only safe or explicitly idempotent requests within the bounded policy', () => {
        expect(shouldRetryPtvCoreRequest({ attempt: 1, method: 'GET', status: 503 })).toBe(true);
        expect(shouldRetryPtvCoreRequest({ attempt: 1, method: 'POST', status: 503 })).toBe(false);
        expect(shouldRetryPtvCoreRequest({
            attempt: 1,
            explicitIdempotent: true,
            method: 'POST',
            status: 503
        })).toBe(true);
        expect(shouldRetryPtvCoreRequest({ attempt: 1, method: 'GET', status: 401 })).toBe(false);
        expect(shouldRetryPtvCoreRequest({ attempt: 3, method: 'GET', status: 503 })).toBe(false);
    });
});
