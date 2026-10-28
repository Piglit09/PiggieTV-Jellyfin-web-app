import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    beginConfiguredRowVerification,
    getConfiguredRowFreshnessSnapshot,
    getConfiguredRowProofAuthority,
    getVerifiedHomeTransitionBinding,
    isConfiguredRowPresentationCurrent,
    isConfiguredSectionVerified,
    observeConfiguredRowAuthority,
    retireConfiguredRowFreshness,
    subscribeConfiguredRowFreshness,
    verifyConfiguredRowFreshness
} from './configuredRowFreshness';

const identityA = 'server-a:user-a';
const identityB = 'server-a:user-b';
const scopeA = 'a'.repeat(64);
const scopeB = 'b'.repeat(64);
const generationA = '1'.repeat(64);
const generationB = '2'.repeat(64);
const ruleA = 'c'.repeat(64);
const ruleB = 'd'.repeat(64);
const sectionA = 'e'.repeat(64);
const sectionB = 'f'.repeat(64);

const authority = (scope = scopeA, generation = generationA) => ({
    version: 1,
    scope,
    generation
});
const settings = (value: unknown = authority()) => ({ currentPresentationAuthority: value });
const featured = (value: unknown = authority()) => ({ currentPresentationAuthority: value });
const status = (
    value = authority(),
    bindings: Array<{ rule: string; section: string }> = [ { rule: ruleA, section: sectionA } ]
) => ({ currentPresentationAuthority: value, configuredPresentationBindings: bindings });
const configuredSection = (value = authority(), rule = ruleA, section = sectionA) => ({
    configuredRowAssociation: { version: 1, scope: value.scope, rule, section }
});
const configuredRow = (presentationAuthority?: string) => ({
    configuredPresentationAuthority: presentationAuthority,
    id: 'configured-row',
    rowType: 'configured-rule'
});
const genericRow = () => ({ id: 'safe-generic-row', rowType: 'fallback' });

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

async function verifyCurrent(
    value = authority(),
    options: {
        bindings?: Array<{ rule: string; section: string }>;
        identity?: string;
        isCurrent?: () => boolean;
    } = {}
) {
    const lease = beginConfiguredRowVerification(options.identity ?? identityA);
    return verifyConfiguredRowFreshness({
        verification: lease,
        settings: settings(value),
        featured: featured(value),
        readAuthority: async () => status(value, options.bindings),
        isCurrent: options.isCurrent
    });
}

beforeEach(() => {
    retireConfiguredRowFreshness('test-reset');
});

describe('configured-row CURRENT state machine', () => {
    it('FRESH-01 admits only an exact post-input authority proof and exact issued section', async () => {
        const readAuthority = vi.fn(async () => status());
        const lease = beginConfiguredRowVerification(identityA);
        const proof = await verifyConfiguredRowFreshness({
            verification: lease,
            settings: settings(),
            featured: featured(),
            readAuthority
        });

        expect(readAuthority).toHaveBeenCalledOnce();
        expect(proof).not.toBeNull();
        expect(getConfiguredRowProofAuthority(proof!)).toBe(`${scopeA}.${generationA}`);
        expect(isConfiguredSectionVerified(configuredSection(), proof!)).toBe(true);
        expect(isConfiguredRowPresentationCurrent(configuredRow(`${scopeA}.${generationA}`), identityA)).toBe(true);
    });

    it('FRESH-02 rejects a mutually matching stale pair against a newer final proof', async () => {
        const lease = beginConfiguredRowVerification(identityA);
        const proof = await verifyConfiguredRowFreshness({
            verification: lease,
            settings: settings(),
            featured: featured(),
            readAuthority: async () => status(authority(scopeB, generationB))
        });

        expect(proof).toBeNull();
        expect(isConfiguredRowPresentationCurrent(configuredRow(`${scopeA}.${generationA}`), identityA)).toBe(false);
    });

    it.each([
        [ 'FRESH-03 old Featured plus fresh Settings', settings(authority(scopeB, generationB)), featured() ],
        [ 'FRESH-04 fresh Featured plus old Settings', settings(), featured(authority(scopeB, generationB)) ]
    ])('%s rejects mismatched inputs', async (_label, settingsValue, featuredValue) => {
        const proof = await verifyConfiguredRowFreshness({
            verification: beginConfiguredRowVerification(identityA),
            settings: settingsValue,
            featured: featuredValue,
            readAuthority: async () => status(authority(scopeB, generationB))
        });
        expect(proof).toBeNull();
    });

    it('FRESH-05 remains current until a changed authority is observed, then retires', async () => {
        const proof = await verifyCurrent();
        const key = getConfiguredRowProofAuthority(proof!);
        const row = configuredRow(key);

        expect(isConfiguredRowPresentationCurrent(row, identityA)).toBe(true);
        observeConfiguredRowAuthority(authority());
        expect(isConfiguredRowPresentationCurrent(row, identityA)).toBe(true);
        observeConfiguredRowAuthority(authority(scopeB, generationB));
        expect(isConfiguredRowPresentationCurrent(row, identityA)).toBe(false);
    });

    it('FRESH-06 does not revive A after A-to-B-to-A without a new proof', async () => {
        const proof = await verifyCurrent();
        const oldA = configuredRow(getConfiguredRowProofAuthority(proof!));
        observeConfiguredRowAuthority(authority(scopeB, generationB));
        observeConfiguredRowAuthority(authority(scopeA, generationA));
        expect(isConfiguredRowPresentationCurrent(oldA, identityA)).toBe(false);
    });

    it('FRESH-07 retires the previous process scope and requires a new proof', async () => {
        const proof = await verifyCurrent();
        const row = configuredRow(getConfiguredRowProofAuthority(proof!));
        observeConfiguredRowAuthority(authority(scopeB, generationA));
        expect(isConfiguredRowPresentationCurrent(row, identityA)).toBe(false);
    });

    it.each([
        [ 'FRESH-08 server identity', 'server-b:user-a' ],
        [ 'FRESH-09 user identity', identityB ]
    ])('%s change retires the prior identity owner', async (_label, nextIdentity) => {
        const proof = await verifyCurrent();
        const row = configuredRow(getConfiguredRowProofAuthority(proof!));
        beginConfiguredRowVerification(nextIdentity);
        expect(isConfiguredRowPresentationCurrent(row, identityA)).toBe(false);
        expect(isConfiguredRowPresentationCurrent(row, nextIdentity)).toBe(false);
    });

    it.each([
        [ 'FRESH-10 timeout/server uncertainty', Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }), 'authority-uncertain' ],
        [ 'FRESH-11 401', Object.assign(new Error('denied'), { status: 401 }), 'authority-rejected' ],
        [ 'FRESH-11 403', Object.assign(new Error('forbidden'), { status: 403 }), 'authority-rejected' ]
    ])('%s fails closed and retires CURRENT', async (_label, error, expectedReason) => {
        const currentProof = await verifyCurrent();
        const row = configuredRow(getConfiguredRowProofAuthority(currentProof!));
        const proof = await verifyConfiguredRowFreshness({
            verification: beginConfiguredRowVerification(identityA),
            settings: settings(),
            featured: featured(),
            readAuthority: async () => Promise.reject(error)
        });
        expect(proof).toBeNull();
        expect(isConfiguredRowPresentationCurrent(row, identityA)).toBe(false);
        expect(getConfiguredRowFreshnessSnapshot()).toMatchObject({
            authority: null,
            reason: expectedReason,
            status: 'ERROR'
        });
    });

    it.each([
        null,
        {},
        { currentPresentationAuthority: { version: 2, scope: scopeA, generation: generationA }, configuredPresentationBindings: [] },
        { currentPresentationAuthority: { version: 1, scope: 'short', generation: generationA }, configuredPresentationBindings: [] },
        { currentPresentationAuthority: { ...authority(), extra: 'not-allowed' }, configuredPresentationBindings: [] },
        { currentPresentationAuthority: authority(), configuredPresentationBindings: 'not-an-array' },
        { currentPresentationAuthority: authority(), configuredPresentationBindings: [ { rule: ruleA, section: sectionA, extra: 'not-allowed' } ] },
        { currentPresentationAuthority: authority(), configuredPresentationBindings: [
            { rule: ruleA, section: sectionA },
            { rule: ruleB, section: sectionA }
        ] }
    ])('FRESH-12 rejects malformed final authority %#', async malformed => {
        const proof = await verifyConfiguredRowFreshness({
            verification: beginConfiguredRowVerification(identityA),
            settings: settings(),
            featured: featured(),
            readAuthority: async () => malformed
        });
        expect(proof).toBeNull();
    });

    it('FRESH-13 refuses tagged last-good configured rows while authority is UNKNOWN', async () => {
        const proof = await verifyCurrent();
        const row = configuredRow(getConfiguredRowProofAuthority(proof!));
        retireConfiguredRowFreshness('route-reentry');
        expect(isConfiguredRowPresentationCurrent(row, identityA)).toBe(false);
    });

    it('FRESH-14 leaves an independently generic row renderable while configured rows are UNKNOWN', () => {
        expect(isConfiguredRowPresentationCurrent(configuredRow(`${scopeA}.${generationA}`), identityA)).toBe(false);
        expect(isConfiguredRowPresentationCurrent(genericRow(), identityA)).toBe(true);
    });

    it('FRESH-15 rejects an authority response retired while the final read is in flight', async () => {
        const pending = deferred<unknown>();
        const proofPromise = verifyConfiguredRowFreshness({
            verification: beginConfiguredRowVerification(identityA),
            settings: settings(),
            featured: featured(),
            readAuthority: () => pending.promise,
            isCurrent: () => true
        });
        retireConfiguredRowFreshness('mutation-observed-during-read');
        pending.resolve(status());
        await expect(proofPromise).resolves.toBeNull();
    });

    it('FRESH-15 rejects when the caller lifecycle is no longer current at publication', async () => {
        await expect(verifyCurrent(authority(), { isCurrent: () => false })).resolves.toBeNull();
    });

    it('FRESH-16 keeps same-title ownership unambiguous through distinct opaque issued pairs', async () => {
        const proof = await verifyCurrent(authority(), {
            bindings: [ { rule: ruleA, section: sectionA }, { rule: ruleB, section: sectionB } ]
        });
        expect(isConfiguredSectionVerified(configuredSection(authority(), ruleA, sectionA), proof!)).toBe(true);
        expect(isConfiguredSectionVerified(configuredSection(authority(), ruleB, sectionB), proof!)).toBe(true);
        expect(isConfiguredSectionVerified(configuredSection(authority(), ruleA, sectionB), proof!)).toBe(false);
    });

    it('FRESH-17 verifies multiple issued section instances for one rule without accepting an unissued one', async () => {
        const proof = await verifyCurrent(authority(), {
            bindings: [ { rule: ruleA, section: sectionA }, { rule: ruleA, section: sectionB } ]
        });
        expect(isConfiguredSectionVerified(configuredSection(authority(), ruleA, sectionA), proof!)).toBe(true);
        expect(isConfiguredSectionVerified(configuredSection(authority(), ruleA, sectionB), proof!)).toBe(true);
        expect(isConfiguredSectionVerified(configuredSection(authority(), ruleA, '0'.repeat(64)), proof!)).toBe(false);
    });

    it('FRESH-18/FRESH-19 rejects generic impersonation, edited aliases, and caller-fabricated proof', async () => {
        const proof = await verifyCurrent();
        expect(isConfiguredSectionVerified({}, proof!)).toBe(false);
        expect(isConfiguredSectionVerified(configuredSection(authority(), ruleB, sectionA), proof!)).toBe(false);
        expect(isConfiguredSectionVerified(configuredSection(), {} as never)).toBe(false);
        expect(isConfiguredRowPresentationCurrent(configuredRow(), identityA)).toBe(false);
    });

    it('FRESH-20 exposes only the opaque presentation-authority key from the private proof', async () => {
        const proof = await verifyCurrent();
        expect(getConfiguredRowProofAuthority(proof!)).toBe(`${scopeA}.${generationA}`);
        expect(JSON.stringify(proof)).not.toContain('server-a');
        expect(JSON.stringify(proof)).not.toContain('user-a');
    });

    it('keeps an explicit rebound library attestation private to the fresh final status proof and exact section pair', async () => {
        const attested = { rule: ruleA, section: sectionA, libraryId: 'b'.repeat(32),
            topologyEpoch: 'f'.repeat(64), bindingGeneration: 2, explicitRebind: true };
        const proof = await verifyConfiguredRowFreshness({
            verification: beginConfiguredRowVerification(identityA), settings: settings(), featured: featured(),
            readAuthority: async () => status(authority(), [attested])
        });
        expect(proof).not.toBeNull();
        expect(getVerifiedHomeTransitionBinding(configuredSection(), proof)).toEqual({
            libraryId: attested.libraryId, topologyEpoch: attested.topologyEpoch,
            bindingGeneration: attested.bindingGeneration, explicitRebind: true
        });
        expect(getVerifiedHomeTransitionBinding(configuredSection(authority(), ruleB), proof)).toBeNull();
        expect(JSON.stringify(proof)).not.toContain(attested.libraryId);
        retireConfiguredRowFreshness('transition-changed');
        expect(getVerifiedHomeTransitionBinding(configuredSection(), proof)).toBeNull();
    });

    it('keeps a Plugin-verified seeded unpinned binding distinct from an explicit rebind', async () => {
        const seeded = { rule: ruleA, section: sectionA, libraryId: 'b'.repeat(32),
            topologyEpoch: 'f'.repeat(64), bindingGeneration: 1, explicitRebind: false };
        const proof = await verifyConfiguredRowFreshness({
            verification: beginConfiguredRowVerification(identityA), settings: settings(), featured: featured(),
            readAuthority: async () => status(authority(), [seeded])
        });
        expect(proof).not.toBeNull();
        expect(getVerifiedHomeTransitionBinding(configuredSection(), proof)).toMatchObject({
            libraryId: seeded.libraryId, bindingGeneration: 1, explicitRebind: false
        });
    });

    it.each([
        { rule: ruleA, section: sectionA, libraryId: 'b'.repeat(32) },
        { rule: ruleA, section: sectionA, libraryId: 'b'.repeat(32), topologyEpoch: 'f'.repeat(64), bindingGeneration: 2, explicitRebind: 'false' },
        { rule: ruleA, section: sectionA, libraryId: '0'.repeat(32), topologyEpoch: 'f'.repeat(64), bindingGeneration: 2, explicitRebind: true },
        { rule: ruleA, section: sectionA, libraryId: 'b'.repeat(32), topologyEpoch: 'short', bindingGeneration: 2, explicitRebind: true },
        { rule: ruleA, section: sectionA, libraryId: 'b'.repeat(32), topologyEpoch: 'f'.repeat(64), bindingGeneration: 0, explicitRebind: true },
        { rule: ruleA, section: sectionA, libraryId: 'b'.repeat(32), topologyEpoch: 'f'.repeat(64), bindingGeneration: 2, explicitRebind: true, LibraryId: 'b'.repeat(32) }
    ])('rejects malformed explicit rebound final-status attestation %#', async binding => {
        const proof = await verifyConfiguredRowFreshness({
            verification: beginConfiguredRowVerification(identityA), settings: settings(), featured: featured(),
            readAuthority: async () => status(authority(), [binding])
        });
        expect(proof).toBeNull();
    });

    it('ordinary observations can retire but cannot promote UNKNOWN to CURRENT', () => {
        beginConfiguredRowVerification(null);
        const snapshots: unknown[] = [];
        const unsubscribe = subscribeConfiguredRowFreshness(() => {
            snapshots.push(getConfiguredRowFreshnessSnapshot());
        });
        observeConfiguredRowAuthority(authority());
        expect(isConfiguredRowPresentationCurrent(configuredRow(`${scopeA}.${generationA}`), identityA)).toBe(false);
        expect(getConfiguredRowFreshnessSnapshot()).toBeDefined();
        expect(snapshots.length).toBeGreaterThan(0);
        unsubscribe();
    });

    it('consumes each verification lease exactly once instead of reusing an earlier request boundary', async () => {
        const lease = beginConfiguredRowVerification(identityA);
        const firstRead = vi.fn(async () => status());
        const secondRead = vi.fn(async () => status());

        await expect(verifyConfiguredRowFreshness({
            verification: lease,
            settings: settings(),
            featured: featured(),
            readAuthority: firstRead
        })).resolves.not.toBeNull();
        await expect(verifyConfiguredRowFreshness({
            verification: lease,
            settings: settings(),
            featured: featured(),
            readAuthority: secondRead
        })).resolves.toBeNull();
        expect(firstRead).toHaveBeenCalledOnce();
        expect(secondRead).not.toHaveBeenCalled();
    });

    it.each([
        [ 'settings', {}, featured() ],
        [ 'Settings authority with extra keys', settings({ ...authority(), extra: 'not-allowed' }), featured() ],
        [ 'Featured', settings(), {} ],
        [ 'Featured authority with extra keys', settings(), featured({ ...authority(), extra: 'not-allowed' }) ]
    ])('rejects malformed %s input before attempting the final authority read', async (_label, settingsValue, featuredValue) => {
        const readAuthority = vi.fn(async () => status());
        await expect(verifyConfiguredRowFreshness({
            verification: beginConfiguredRowVerification(identityA),
            settings: settingsValue,
            featured: featuredValue,
            readAuthority
        })).resolves.toBeNull();
        expect(readAuthority).not.toHaveBeenCalled();
    });

    it.each([
        { id: 'by-source-rule', sourceRuleId: 'configured' },
        { id: 'by-rule-id', ruleId: 'configured' },
        { id: 'by-rendered-source', renderedSource: 'row-builder' }
    ])('fails closed for configured-row signal %# when its proof tag is absent', row => {
        expect(isConfiguredRowPresentationCurrent(row, identityA)).toBe(false);
    });
});
