import { describe, expect, it } from 'vitest';

import {
    PTV_DIAGNOSTIC_SCHEMA_VERSION,
    createPtvDiagnosticHealth,
    getPtvDiagnosticContractMetadata,
    getPtvDiagnosticPercentile
} from './diagnosticContracts';

describe('PTV diagnostic contracts', () => {
    it('publishes a portable v1 contract and privacy schema', () => {
        expect(PTV_DIAGNOSTIC_SCHEMA_VERSION).toBe(1);
        expect(getPtvDiagnosticContractMetadata()).toEqual({
            contractVersion: '1.0',
            privacySchemaVersion: 1,
            schemaVersion: 1
        });
    });

    it('serializes health without browser-only values', () => {
        const health = createPtvDiagnosticHealth('healthy', 'Ready.', {
            lastUpdated: '2026-07-25T12:00:00.000Z',
            metrics: { activeRequests: 2 },
            warnings: []
        });
        const serialized = JSON.stringify(health);

        expect(JSON.parse(serialized)).toEqual(health);
        expect(serialized).not.toContain('[object ');
    });

    it('calculates bounded nearest-rank frame percentiles', () => {
        const frames = [ 8, 16, 17, 24, 55, Number.NaN ];

        expect(getPtvDiagnosticPercentile(frames, 0.5)).toBe(17);
        expect(getPtvDiagnosticPercentile(frames, 0.95)).toBe(55);
        expect(getPtvDiagnosticPercentile(frames, 0.99)).toBe(55);
        expect(getPtvDiagnosticPercentile([], 0.95)).toBe(0);
    });
});
