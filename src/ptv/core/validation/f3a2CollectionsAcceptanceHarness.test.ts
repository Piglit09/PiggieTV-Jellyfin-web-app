import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

type RequestRecord = {
    category: string;
    durationMs: number;
    failed: boolean;
    keyHash: string;
    startMs: number;
    status: number | null;
};

type HarnessUtils = {
    assertShareSafeEvidence: (value: unknown) => unknown;
    classifyRequest: (url: string) => string;
    createOneShotFailureGate: (category?: string) => {
        tryConsume: (category: string) => boolean;
        summary: () => { consumed: boolean };
    };
    exactRequestKey: (method: string, url: string) => string;
    summarizeRequestRecords: (records: RequestRecord[]) => {
        exactConcurrentDuplicates: number;
        failedRequestHandoffs: number;
    };
};

const require = createRequire(import.meta.url);
const utils = require(path.resolve(process.cwd(), 'scripts/ptv-f3a2-harness-utils.cjs')) as HarnessUtils;

describe('F3A2 authenticated Collections evidence harness', () => {
    it('classifies request families without returning private request data', () => {
        expect(utils.classifyRequest('https://example.test/Items?IncludeItemTypes=BoxSet')).toBe('jellyfin-collections');
        expect(utils.classifyRequest('https://example.test/Items?SearchTerm=private-value')).toBe('search');
        expect(utils.classifyRequest('https://example.test/Ptv/v1/collections')).toBe('plugin');
    });

    it('hashes exact request identity without exposing URL values', () => {
        const first = utils.exactRequestKey('GET', 'https://example.test/Items?IncludeItemTypes=BoxSet&api_key=one');
        const second = utils.exactRequestKey('GET', 'https://example.test/Items?api_key=two&IncludeItemTypes=BoxSet');
        expect(first).toMatch(/^[a-f0-9]{64}$/);
        expect(first).toBe(second);
        expect(first).not.toContain('example');
    });

    it('allows exactly one controlled collection failure', () => {
        const gate = utils.createOneShotFailureGate();
        expect(gate.tryConsume('asset')).toBe(false);
        expect(gate.tryConsume('jellyfin-collections')).toBe(true);
        expect(gate.tryConsume('jellyfin-collections')).toBe(false);
        expect(gate.summary().consumed).toBe(true);
    });

    it('separates failed-request handoff from a concurrent duplicate', () => {
        const summary = utils.summarizeRequestRecords([
            { category: 'jellyfin-collections', durationMs: 100, failed: true, keyHash: 'same', startMs: 0, status: null },
            { category: 'jellyfin-collections', durationMs: 20, failed: false, keyHash: 'same', startMs: 90, status: 200 },
            { category: 'jellyfin-collections', durationMs: 100, failed: false, keyHash: 'other', startMs: 0, status: 200 },
            { category: 'jellyfin-collections', durationMs: 20, failed: false, keyHash: 'other', startMs: 40, status: 200 }
        ]);
        expect(summary.failedRequestHandoffs).toBe(1);
        expect(summary.exactConcurrentDuplicates).toBe(1);
    });

    it('rejects private or credential-bearing evidence', () => {
        expect(() => utils.assertShareSafeEvidence({ authorization: 'redacted' })).toThrow(/Sensitive evidence key/);
        expect(() => utils.assertShareSafeEvidence({ endpoint: 'https://10.0.0.1' })).toThrow(/Private evidence value/);
        expect(utils.assertShareSafeEvidence({ route: 'collections', requestCount: 3 })).toEqual({
            requestCount: 3,
            route: 'collections'
        });
    });

    it('keeps the runner credential-blind and artifact-safe', () => {
        const source = fs.readFileSync(path.resolve(process.cwd(), 'scripts/ptv-f3a2-collections-acceptance.cjs'), 'utf8');
        expect(source).not.toMatch(/(?:userName|password)\s*[:=]/i);
        expect(source).not.toMatch(/storageState\s*:\s*['"]/i);
        expect(source).not.toMatch(/\.screenshot\s*\(/);
        expect(source).not.toMatch(/tracing\.start/);
        expect(source).not.toMatch(/\b(?:10|192\.168)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    });
});
