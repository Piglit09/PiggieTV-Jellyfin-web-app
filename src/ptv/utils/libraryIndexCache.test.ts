import { describe, expect, it, vi } from 'vitest';

vi.mock('../core/observability', () => ({ recordPtvEvent: vi.fn() }));

import { createPtvCacheEnvelope } from '../core/cache/cacheEnvelope';
import {
    inspectPtvLibraryIndexCacheRecord,
    PTV_LIBRARY_INDEX_CACHE_STALE_MS,
    type PtvLegacyLibraryIndexCacheEntry
} from './libraryIndexCache';

const key = 'reading:server-a:user-a:books:library-index';
const scope = { kind: 'user', serverId: 'server-a', userId: 'user-a' } as const;
const now = Date.parse('2026-07-22T12:00:00.000Z');

function envelope(overrides: Record<string, unknown> = {}) {
    return {
        ...createPtvCacheEnvelope({
            createdAt: new Date(now - 1_000).toISOString(),
            expiresAt: new Date(now + 60_000).toISOString(),
            key,
            payload: { ids: ['one'] },
            schemaVersion: 4,
            scope
        }),
        ...overrides
    };
}

describe('library index cache envelope boundary', () => {
    it('reads a current v1 envelope', () => {
        const result = inspectPtvLibraryIndexCacheRecord(envelope(), key, 4, { now, scope });

        expect(result.outcome).toBe('hit');
        expect(result.envelope?.payload).toEqual({ ids: ['one'] });
    });

    it('retains the legacy record fallback', () => {
        const legacy: PtvLegacyLibraryIndexCacheEntry<{ ids: string[] }> = {
            createdAt: now - 1_000,
            data: { ids: ['legacy'] },
            expiresAt: now + 60_000,
            key,
            schemaVersion: 4
        };
        const result = inspectPtvLibraryIndexCacheRecord(legacy, key, 4, { now, scope });

        expect(result.outcome).toBe('hit');
        expect(result.envelope?.contractVersion).toBe('1.0');
        expect(result.envelope?.payload).toEqual({ ids: ['legacy'] });
    });

    it('isolates scopes', () => {
        const result = inspectPtvLibraryIndexCacheRecord(envelope(), key, 4, {
            now,
            scope: { kind: 'user', serverId: 'server-a', userId: 'user-b' }
        });

        expect(result.outcome).toBe('miss');
    });

    it('handles corruption and version mismatches', () => {
        expect(inspectPtvLibraryIndexCacheRecord({ key }, key, 4, { now, scope }).outcome)
            .toBe('corrupt');
        expect(inspectPtvLibraryIndexCacheRecord(envelope({ schemaVersion: 3 }), key, 4, { now, scope }).outcome)
            .toBe('version-mismatch');
    });

    it('returns stale only within the opt-in stale window', () => {
        const stale = envelope({
            expiresAt: new Date(now - 1).toISOString(),
            staleWhileRevalidateUntil: new Date(now + PTV_LIBRARY_INDEX_CACHE_STALE_MS).toISOString()
        });

        expect(inspectPtvLibraryIndexCacheRecord(stale, key, 4, { now, scope }).outcome)
            .toBe('expired');
        expect(inspectPtvLibraryIndexCacheRecord(stale, key, 4, { allowStale: true, now, scope }).outcome)
            .toBe('stale');
    });
});
