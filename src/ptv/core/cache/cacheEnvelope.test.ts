import { describe, expect, it } from 'vitest';

import {
    createPtvCacheEnvelope,
    inspectPtvCacheEnvelope
} from './cacheEnvelope';

const scope = { kind: 'user', serverId: 'server-1', userId: 'user-1' } as const;
const now = Date.parse('2026-07-22T12:00:00.000Z');

function envelope(expiresAt = '2026-07-22T13:00:00.000Z') {
    return createPtvCacheEnvelope({
        createdAt: '2026-07-22T11:00:00.000Z',
        expiresAt,
        key: 'home',
        payload: { rows: [] },
        payloadBytes: 100,
        schemaVersion: 1,
        scope,
        staleWhileRevalidateUntil: '2026-07-22T14:00:00.000Z'
    });
}

const expectations = {
    key: 'home',
    now,
    schemaVersion: 1,
    scope
};

describe('PTV Core cache envelopes', () => {
    it('distinguishes hit, miss, stale, and expiration', () => {
        expect(inspectPtvCacheEnvelope(envelope(), expectations).outcome).toBe('hit');
        expect(inspectPtvCacheEnvelope(null, expectations).outcome).toBe('miss');
        expect(inspectPtvCacheEnvelope(envelope('2026-07-22T11:30:00.000Z'), {
            ...expectations,
            allowStale: true
        }).outcome).toBe('stale');
        expect(inspectPtvCacheEnvelope(envelope('2026-07-22T11:30:00.000Z'), expectations).outcome)
            .toBe('expired');
    });

    it('isolates server/user scopes', () => {
        expect(inspectPtvCacheEnvelope(envelope(), {
            ...expectations,
            scope: { ...scope, userId: 'other-user' }
        }).outcome).toBe('miss');
        expect(inspectPtvCacheEnvelope(envelope(), {
            ...expectations,
            scope: { ...scope, serverId: 'other-server' }
        }).outcome).toBe('miss');
    });

    it('reports corruption, version mismatch, and payload size failures', () => {
        expect(inspectPtvCacheEnvelope({ contractVersion: '1.0' }, expectations).outcome).toBe('corrupt');
        expect(inspectPtvCacheEnvelope({ ...envelope(), schemaVersion: 2 }, expectations))
            .toMatchObject({
                error: { code: 'CACHE_VERSION_MISMATCH' },
                outcome: 'version-mismatch'
            });
        expect(inspectPtvCacheEnvelope(envelope(), {
            ...expectations,
            maxPayloadBytes: 99
        })).toMatchObject({
            error: { code: 'CACHE_PAYLOAD_TOO_LARGE' },
            outcome: 'error'
        });
    });

    it('supports an explicit legacy fallback reader before rejecting old data', () => {
        const result = inspectPtvCacheEnvelope({ legacyRows: [] }, {
            ...expectations,
            legacyReader: value => value && typeof value === 'object' ?
                envelope() :
                null
        });

        expect(result.outcome).toBe('hit');
        expect(result.envelope?.schemaVersion).toBe(1);
    });
});
