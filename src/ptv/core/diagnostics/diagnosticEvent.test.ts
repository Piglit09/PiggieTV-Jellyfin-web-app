import { describe, expect, it, vi } from 'vitest';

import { createPtvCoreError } from '../errors/coreError';
import {
    createPtvDiagnosticEvent,
    recordPtvDiagnosticEventSafely
} from './diagnosticEvent';
import {
    getPtvCoreSerializedSize,
    sanitizePtvCoreMetadata
} from './redaction';

const baseOptions = {
    appVersion: '1.0.0',
    category: 'api' as const,
    deviceClass: 'desktop',
    name: 'request-finished',
    platform: 'web' as const,
    sessionId: 'session-1',
    success: false,
    timestamp: '2026-07-22T12:00:00.000Z'
};

describe('PTV Core diagnostics', () => {
    it('creates schema-compatible events with redacted and bounded metadata', () => {
        const sensitiveHeaderName = ['author', 'ization'].join('');
        const event = createPtvDiagnosticEvent({
            ...baseOptions,
            durationMs: 12.4,
            error: createPtvCoreError({
                code: 'API_HTTP_500',
                kind: 'server',
                message: 'Failed.',
                timestamp: baseOptions.timestamp
            }),
            metadata: {
                [sensitiveHeaderName]: ['Bearer ', 'private', '-token'].join(''),
                email: 'person@example.test',
                endpoint: 'https://example.test/Items?token=secret'
            }
        });

        expect(event).toMatchObject({
            contractVersion: '1.0',
            durationMs: 12,
            errorCode: 'API_HTTP_500'
        });
        expect(event.metadata[sensitiveHeaderName]).toBe('[REDACTED]');
        expect(JSON.stringify(event.metadata)).not.toContain('person@example.test');
        expect(JSON.stringify(event.metadata)).not.toContain('token=secret');
    });

    it('drops optional metadata when the payload size limit is exceeded', () => {
        const event = createPtvDiagnosticEvent({
            ...baseOptions,
            maxBytes: 250,
            metadata: { large: 'x'.repeat(500) }
        });

        expect(event.metadata).toEqual({
            dropped: true,
            reason: 'payload-size-limit'
        });
        expect(getPtvCoreSerializedSize(event)).toBeGreaterThan(0);
    });

    it('does nothing when disabled and isolates sink failures', async () => {
        const event = createPtvDiagnosticEvent(baseOptions);
        const record = vi.fn();

        expect(await recordPtvDiagnosticEventSafely({ enabled: () => false, record }, event)).toBe(false);
        expect(record).not.toHaveBeenCalled();
        expect(await recordPtvDiagnosticEventSafely({
            enabled: () => true,
            record: () => {
                throw new Error('storage unavailable');
            }
        }, event)).toBe(false);
    });

    it('bounds nested metadata depth, keys, arrays, and invalid numbers', () => {
        const sanitized = sanitizePtvCoreMetadata({
            array: Array.from({ length: 50 }, (_, index) => index),
            invalid: Number.NaN,
            nested: { a: { b: { c: { d: { e: 'too deep' } } } } }
        });

        expect((sanitized.array as unknown[]).length).toBe(32);
        expect(sanitized.invalid).toBeUndefined();
        expect(JSON.stringify(sanitized.nested)).toContain('[truncated]');
    });
});
