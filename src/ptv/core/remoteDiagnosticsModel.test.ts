import { describe, expect, it } from 'vitest';

import type { PtvClientProfile } from './clientProfile';
import {
    createPtvRemoteDiagnosticsPayload,
    createPtvRemoteDiagnosticsProfileTag,
    evaluatePtvRemoteDiagnosticsLease,
    PTV_REMOTE_DIAGNOSTICS_MAX_LEASE_MS,
    PtvDiagnosticsRingBuffer,
    sanitizePtvDiagnosticRoute,
    sanitizePtvDiagnosticUrl,
    sanitizePtvRemoteDiagnosticDetail,
    type PtvRemoteDiagnosticEntry
} from './remoteDiagnosticsModel';

function createProfile(overrides: Partial<PtvClientProfile> = {}) {
    return {
        isLowPower: false,
        kind: 'desktop',
        layoutMode: 'desktop',
        renderProfile: {
            className: 'ptv-render-profile-balanced',
            id: 'balanced',
            matchReason: 'desktop-default',
            tier: 'balanced'
        },
        supportsAspectRatio: true,
        supportsBackdropFilter: true,
        supportsContainerQueries: true,
        supportsContentVisibility: true,
        tvPlatform: 'none',
        userAgent: 'Mozilla/5.0 Chrome/126.0 Safari/537.36',
        ...overrides
    } as PtvClientProfile;
}

describe('remote diagnostics ring buffer', () => {
    it('retains newest values in order and counts dropped values', () => {
        const buffer = new PtvDiagnosticsRingBuffer<number>(3);

        buffer.push(1);
        buffer.push(2);
        buffer.push(3);
        buffer.push(4);
        buffer.push(5);

        expect(buffer.toArray()).toEqual([3, 4, 5]);
        expect(buffer.count).toBe(3);
        expect(buffer.dropped).toBe(2);

        buffer.clear();

        expect(buffer.toArray()).toEqual([]);
        expect(buffer.dropped).toBe(0);
    });
});

describe('remote diagnostics lease gate', () => {
    const now = 1_700_000_000_000;

    it('accepts a temporary matching-profile admin lease', () => {
        const decision = evaluatePtvRemoteDiagnosticsLease({
            enabled: true,
            expiresAt: now + 5 * 60 * 1000,
            profiles: ['webos'],
            sessionId: 'admin-session-123'
        }, 'webos', now);

        expect(decision).toMatchObject({
            accepted: true,
            lease: {
                profile: 'webos',
                startedAt: now
            }
        });
    });

    it('uses bounded server-relative duration when the TV clock is skewed', () => {
        const decision = evaluatePtvRemoteDiagnosticsLease({
            durationMs: 5 * 60 * 1000,
            enabled: true,
            expiresAt: 100,
            issuedAt: 50,
            profiles: ['webos'],
            sessionId: 'skew-safe-session'
        }, 'webos', now);

        expect(decision).toMatchObject({
            accepted: true,
            lease: {
                expiresAt: now + 5 * 60 * 1000
            }
        });
    });

    it.each([
        {
            expectedReason: 'disabled',
            lease: { enabled: false, expiresAt: now + 1_000, sessionId: 'session-123' },
            profile: 'desktop' as const
        },
        {
            expectedReason: 'expired',
            lease: { enabled: true, expiresAt: now - 1, sessionId: 'session-123' },
            profile: 'desktop' as const
        },
        {
            expectedReason: 'too-long',
            lease: {
                enabled: true,
                expiresAt: now + PTV_REMOTE_DIAGNOSTICS_MAX_LEASE_MS + 1,
                sessionId: 'session-123'
            },
            profile: 'desktop' as const
        },
        {
            expectedReason: 'profile-mismatch',
            lease: {
                enabled: true,
                expiresAt: now + 1_000,
                profiles: ['webos' as const],
                sessionId: 'session-123'
            },
            profile: 'firetv' as const
        }
    ])('rejects a lease gated by $expectedReason', ({ expectedReason, lease, profile }) => {
        expect(evaluatePtvRemoteDiagnosticsLease(lease, profile, now)).toEqual({
            accepted: false,
            reason: expectedReason
        });
    });
});

describe('remote diagnostics privacy and payload contract', () => {
    it('tags WebOS without retaining the raw user agent', () => {
        const tag = createPtvRemoteDiagnosticsProfileTag(createProfile({
            isLowPower: true,
            kind: 'webos',
            layoutMode: 'ten-foot',
            tvPlatform: 'webos',
            userAgent: 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.41'
        }), {
            deviceMemory: 1.5,
            hardwareConcurrency: 4,
            viewportWidth: 1920
        });

        expect(tag).toMatchObject({
            browserFamily: 'webos',
            deviceMemoryGb: 1.5,
            hardwareConcurrency: 4,
            isLowPower: true,
            kind: 'webos',
            tvPlatform: 'webos',
            viewport: 'large'
        });
        expect(tag).not.toHaveProperty('userAgent');
    });

    it('removes credentials, query strings, external hosts, and likely item identifiers', () => {
        expect(sanitizePtvRemoteDiagnosticDetail({
            authorization: 'Bearer top-secret',
            message: 'GET https://media.example.test/Items/abcdef0123456789?api_key=secret failed',
            note: 'token=top-secret Authorization: Basic-credential api key=private'
        })).toEqual({
            authorization: '[redacted]',
            message: '[redacted]',
            note: '[redacted]'
        });
        expect(sanitizePtvDiagnosticRoute('#/details?id=abcdef0123456789&token=secret')).toBe('/details');
        expect(sanitizePtvDiagnosticRoute('#/music/artist/artist-one')).toBe('/music/artist/:id');
        expect(sanitizePtvDiagnosticUrl('https://other.example.test/private?id=1', 'https://ptv.example.test')).toEqual({
            path: null,
            scope: 'cross-origin'
        });
    });

    it('removes relative media paths, local paths, and query values from error text', () => {
        const sanitized = sanitizePtvRemoteDiagnosticDetail({
            message: 'Failed /Items/abcdef0123456789/Private%20Movie.mkv while decoding Private Movie.mkv',
            stack: 'at play (C:\\Users\\viewer\\private\\player.js:1:2)'
        });
        const serialized = JSON.stringify(sanitized);

        expect(serialized).not.toContain('Private Movie');
        expect(serialized).not.toContain('Private%20Movie');
        expect(serialized).not.toContain('viewer');
        expect(serialized).not.toContain('secret');
        expect(serialized).not.toContain('api_key');
        expect(serialized).toContain('[media-path]');
        expect(serialized).toContain('[local-path]');
    });

    it('builds a bounded, profile-tagged report with the stable schema shape', () => {
        const buffer = new PtvDiagnosticsRingBuffer<PtvRemoteDiagnosticEntry>(2);
        const profile = createPtvRemoteDiagnosticsProfileTag(createProfile());

        buffer.push({
            at: 101,
            detail: { route: '/music/player' },
            kind: 'route',
            name: 'route-change'
        });
        buffer.push({
            at: 102,
            detail: { status: 500 },
            kind: 'network',
            name: 'fetch-failed'
        });

        const payload = createPtvRemoteDiagnosticsPayload({
            buffer,
            clientId: 'ptv-client-123',
            generatedAt: 200,
            lease: {
                enabled: true,
                expiresAt: 1_000,
                profile: 'desktop',
                sessionId: 'admin-session-123',
                startedAt: 100
            },
            profile,
            route: '#/music/player?access_token=secret'
        });

        expect(payload).toMatchObject({
            buffer: { capacity: 2, count: 2, dropped: 0 },
            client: {
                clientId: 'ptv-client-123',
                profile: { kind: 'desktop' }
            },
            generatedAt: 200,
            privacy: {
                contentIdentifiers: 'redacted',
                externalHosts: 'omitted',
                persistence: 'memory-only',
                queryStrings: 'omitted'
            },
            route: '/music/player',
            schemaVersion: 1,
            session: {
                sessionId: 'admin-session-123'
            },
            summary: {
                countsByKind: {
                    network: 1,
                    route: 1
                }
            }
        });
        expect(payload.samples).toHaveLength(2);
    });

    it('keeps the serialized report below the plugin upload limit', () => {
        const buffer = new PtvDiagnosticsRingBuffer<PtvRemoteDiagnosticEntry>(300);
        const profile = createPtvRemoteDiagnosticsProfileTag(createProfile());
        const largeDetail = Object.fromEntries(Array.from({ length: 24 }, (_value, index) => [
            `field-${index}`,
            'x'.repeat(320)
        ]));

        for (let index = 0; index < 300; index += 1) {
            buffer.push({
                at: index,
                detail: largeDetail,
                kind: 'system',
                name: `large-event-${index}`
            });
        }

        const payload = createPtvRemoteDiagnosticsPayload({
            buffer,
            clientId: 'ptv-client-123',
            generatedAt: 200,
            lease: {
                enabled: true,
                expiresAt: 1_000,
                profile: 'desktop',
                sessionId: 'admin-session-123',
                startedAt: 100
            },
            profile,
            route: '/home'
        });

        expect(JSON.stringify(payload).length).toBeLessThan(192 * 1024);
        expect(payload.samples.length).toBeLessThan(300);
        expect(payload.buffer.dropped).toBe(300 - payload.samples.length);
        expect(payload.samples[payload.samples.length - 1]?.name).toBe('large-event-299');
    });
});
