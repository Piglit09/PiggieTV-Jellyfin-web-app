import { createRequire } from 'node:module';

import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const contract = require('../../../../scripts/ptv-f3a3-harness-contract.cjs') as {
    assertEvidencePrivacy: (value: unknown, options?: { forbiddenStrings?: string[] }) => boolean;
    assertSinglePage: <T>(pages: T[]) => T;
    classifyReadiness: (state?: { populated?: boolean; empty?: boolean; error?: boolean }) => string;
    createBrowserOwnershipLease: (
        browser: { close?: () => Promise<void> },
        options?: { externallyOwned?: boolean }
    ) => { finalize: () => Promise<{ closed: boolean; repeated: boolean }> };
    createGenerationGate: () => {
        begin: () => number;
        isCurrent: (generation: number) => boolean;
        retire: () => void;
    };
    createObserverDisposer: (observer: { disconnect: () => void }) => () => boolean;
    createStageLedger: (options?: { clock?: { nowMs: () => number } }) => {
        begin: (name: string) => unknown;
        finish: (name: string, state: { populated?: boolean; empty?: boolean; error?: boolean }) => {
            elapsedMs: number;
            readiness: string;
        };
        snapshot: () => unknown[];
    };
    validateEvidenceDocument: (document: unknown) => {
        schemaVersion: number;
        stageCount: number;
        terminalStageCount: number;
    };
    waitForResponseBodyCompletion: (response: { finished: () => Promise<Error | null> }) => Promise<{ completed: boolean }>;
};

const stableCounters = {
    apiClients: 1,
    listeners: 4,
    observers: 1,
    runtimeRoots: 1,
    shells: 1,
    sockets: 1,
    timers: 0
};

describe('F3A3 authenticated evidence contract', () => {
    it('uses unique stage names and one monotonic timing source', () => {
        const readings = [ 10, 24 ];
        const ledger = contract.createStageLedger({
            clock: { nowMs: () => readings.shift() ?? 24 }
        });

        ledger.begin('development-search-exact');
        expect(ledger.finish('development-search-exact', { populated: true })).toMatchObject({
            elapsedMs: 14,
            readiness: 'populated'
        });
        expect(() => ledger.begin('development-search-exact')).toThrow(/Duplicate stage name/);
        expect(ledger.snapshot()).toHaveLength(1);
    });

    it('requires one truthful readiness state', () => {
        expect(contract.classifyReadiness()).toBe('pending');
        expect(contract.classifyReadiness({ empty: true })).toBe('empty');
        expect(() => contract.classifyReadiness({ error: true, populated: true })).toThrow(/more than one/);
    });

    it('retires stale request generations', () => {
        const gate = contract.createGenerationGate();
        const first = gate.begin();
        const second = gate.begin();

        expect(gate.isCurrent(first)).toBe(false);
        expect(gate.isCurrent(second)).toBe(true);
        gate.retire();
        expect(gate.isCurrent(second)).toBe(false);
    });

    it('disconnects observers idempotently', () => {
        const disconnect = vi.fn();
        const dispose = contract.createObserverDisposer({ disconnect });

        expect(dispose()).toBe(true);
        expect(dispose()).toBe(false);
        expect(disconnect).toHaveBeenCalledTimes(1);
    });

    it('fails closed when more than one browser page exists', () => {
        const page = {};
        expect(contract.assertSinglePage([ page ])).toBe(page);
        expect(() => contract.assertSinglePage([])).toThrow(/exactly one/);
        expect(() => contract.assertSinglePage([ {}, {} ])).toThrow(/exactly one/);
    });

    it('never closes an externally owned browser', async () => {
        const close = vi.fn(async () => undefined);
        const externalLease = contract.createBrowserOwnershipLease({ close }, { externallyOwned: true });

        await expect(externalLease.finalize()).resolves.toEqual({ closed: false, repeated: false });
        await expect(externalLease.finalize()).resolves.toEqual({ closed: false, repeated: true });
        expect(close).not.toHaveBeenCalled();

        const ownedLease = contract.createBrowserOwnershipLease({ close }, { externallyOwned: false });
        await expect(ownedLease.finalize()).resolves.toEqual({ closed: true, repeated: false });
        expect(close).toHaveBeenCalledTimes(1);
    });

    it('waits for response-body completion rather than headers', async () => {
        const finished = vi.fn(async () => null);

        await expect(contract.waitForResponseBodyCompletion({ finished })).resolves.toEqual({ completed: true });
        expect(finished).toHaveBeenCalledTimes(1);
    });

    it('rejects private values, credentials, and media-title fields', () => {
        const credentialKey = [ 'pass', 'word' ].join('');

        expect(() => contract.assertEvidencePrivacy({ endpoint: 'http://localhost:8091' })).toThrow(/Private evidence value/);
        expect(() => contract.assertEvidencePrivacy({ [credentialKey]: 'redacted' })).toThrow(/Forbidden evidence key/);
        expect(() => contract.assertEvidencePrivacy({ title: 'private media' })).toThrow(/Forbidden evidence key/);
        expect(() => contract.assertEvidencePrivacy({ stage: 'safe', note: 'private media' }, { forbiddenStrings: [ 'private media' ] })).toThrow(/Forbidden evidence value/);
    });

    it('validates one-page ownership and stable instrumentation', () => {
        const evidence = {
            schemaVersion: 1,
            stages: [
                { name: 'frozen-search-exact', readiness: 'populated', elapsedMs: 1200 }
            ],
            topology: {
                pageCount: 1,
                externallyOwnedBrowser: true,
                browserCloseCount: 0
            },
            instrumentation: {
                baseline: stableCounters,
                final: stableCounters
            }
        };

        expect(contract.validateEvidenceDocument(evidence)).toEqual({
            schemaVersion: 1,
            stageCount: 1,
            terminalStageCount: 1
        });
        expect(() => contract.validateEvidenceDocument({
            ...evidence,
            instrumentation: {
                baseline: stableCounters,
                final: { ...stableCounters, listeners: stableCounters.listeners + 1 }
            }
        })).toThrow(/counter grew/);
    });
});
