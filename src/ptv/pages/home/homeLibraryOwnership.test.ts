import { describe, expect, it } from 'vitest';

import {
    computeHomeResolvedScopeHash,
    filterOwnedHomeRowInPluginOrder,
    resolveHomeLibraryOwnershipClaim
} from './homeLibraryOwnership';
import { createConfiguredRowAssociationResolver } from './configuredRowAssociation';
import { beginConfiguredRowVerification, retireConfiguredRowFreshness, verifyConfiguredRowFreshness } from './configuredRowFreshness';

const libraryId = 'a'.repeat(32);
const otherLibraryId = 'b'.repeat(32);
const hash = 'row-settings-hash';
const rule = {
    id: 'latest-movies', enabled: true, mediaType: 'movies', sourceType: 'latest', sourceValue: 'movies',
    libraryScope: { mode: 'defaultLibrary', defaultKey: 'movies', virtualFolderId: libraryId }
};
const section = {
    id: 'section-movies', sourceRuleId: rule.id, ruleId: rule.id, scopeType: 'library', libraryId,
    configuredRowAssociation: { version: 1, scope: 'a'.repeat(64), rule: 'b'.repeat(64), section: 'opaque-section' },
    topologyEpoch: 'f'.repeat(64), userAccessEpoch: '1'.repeat(64), bindingGeneration: 0, bindingKey: 'movies', resolvedScopeHash: '618230892', rowConfigHash: hash
};
const payload = { rowConfigHash: hash, rowConfigVersion: 3, scopeSchemaVersion: 2 };
const association = { kind: 'matched' as const, ruleId: rule.id, section: 'opaque-section' };
const input = () => ({ rule, section, sectionId: section.id, payload, association,
    expectedRowConfigHash: hash, featuredCacheVersion: 9, currentHomeTopology: { version: 1, epoch: 'f'.repeat(64), held: false },
    currentHomeUserAccess: { version: 1, userId: 'user-a', accessEpoch: '1'.repeat(64), held: false, policyProven: true },
    currentHomeUserId: 'user-a' });

describe('Home library ownership claim', () => {
    it('matches the Plugin scope hash including the pinned ID', () => {
        expect(computeHomeResolvedScopeHash(rule)).toBe('618230892');
    });

    it('accepts a current exact library claim with a structural Movie query', () => {
        expect(resolveHomeLibraryOwnershipClaim(input())).toMatchObject({
            kind: 'library', libraryId, ruleId: rule.id, sectionId: section.id,
            structuralTypes: [ 'Movie' ], expectedCollectionType: 'movies'
        });
    });

    it('accepts an authorized redacted owned section using the matched opaque association and payload hash', () => {
        const redacted = {
            id: 'section', source: 'authorized', title: 'Featured', rowType: 'configured-rule',
            scopeType: 'library', libraryId, topologyEpoch: 'f'.repeat(64), userAccessEpoch: '1'.repeat(64), bindingGeneration: 0, bindingKey: 'movies', resolvedScopeHash: '618230892',
            configuredRowAssociation: {
                version: 1, scope: 'a'.repeat(64), rule: 'b'.repeat(64), section: 'c'.repeat(64)
            }
        };
        const settings = {
            enabled: true, rules: [ rule ], configuredRowAssociations: {
                version: 1, scope: 'a'.repeat(64),
                rules: [ { ruleId: rule.id, association: 'b'.repeat(64) } ],
                sections: [ { rule: 'b'.repeat(64), section: 'c'.repeat(64) } ]
            }
        };
        const matched = createConfiguredRowAssociationResolver(settings, [ redacted ]).resolve(redacted);
        expect(matched.kind).toBe('matched');
        expect(resolveHomeLibraryOwnershipClaim({ ...input(), section: redacted,
            sectionId: redacted.id, association: matched }))
            .toMatchObject({ kind: 'library', libraryId, ruleId: rule.id, sectionId: redacted.id });
        for (const poisoned of [
            { ...redacted, source: 'cache' },
            { ...redacted, sourceRuleId: 'another-rule' },
            { ...redacted, rowConfigHash: 'another-hash' },
            { ...redacted, resolvedScopeHash: '0' }
        ]) {
            expect(resolveHomeLibraryOwnershipClaim({ ...input(), section: poisoned,
                sectionId: poisoned.id, association: matched }).kind).toBe('rejected');
        }
    });

    it('accepts a virtual-folder claim when the Plugin omits a null binding key', () => {
        const customRule = { id: 'custom-movies', enabled: true, mediaType: 'movies', sourceType: 'library',
            libraryScope: { mode: 'virtualFolder', virtualFolderId: libraryId } };
        const customSection = { ...section, sourceRuleId: customRule.id, ruleId: customRule.id,
            resolvedScopeHash: '225189944', bindingKey: undefined };
        expect(resolveHomeLibraryOwnershipClaim({ ...input(), rule: customRule, section: customSection,
            association: { kind: 'matched', ruleId: customRule.id, section: 'opaque-section' } }))
            .toMatchObject({ kind: 'library', libraryId, ruleId: customRule.id });
        expect(resolveHomeLibraryOwnershipClaim({ ...input(), rule: customRule,
            section: { ...customSection, bindingKey: null },
            association: { kind: 'matched', ruleId: customRule.id, section: 'opaque-section' } }))
            .toMatchObject({ kind: 'library', libraryId, ruleId: customRule.id });
        expect(resolveHomeLibraryOwnershipClaim({ ...input(), rule: customRule,
            section: { ...customSection, bindingKey: 'movies' },
            association: { kind: 'matched', ruleId: customRule.id, section: 'opaque-section' } }).kind)
            .toBe('rejected');
    });

    it.each([
        [ 'legacy-v8', { featuredCacheVersion: 8 } ],
        [ 'missing-current-status', { currentHomeTopology: null } ],
        [ 'held-old-view-still-present', { currentHomeTopology: { version: 1, epoch: 'f'.repeat(64), held: true } } ],
        [ 'old-epoch-same-id', { currentHomeTopology: { version: 1, epoch: 'e'.repeat(64), held: false } } ],
        [ 'missing-user-access-epoch', { section: { ...section, userAccessEpoch: undefined } } ],
        [ 'old-user-access-epoch', { section: { ...section, userAccessEpoch: '2'.repeat(64) } } ],
        [ 'ambiguous-user-access-epoch', { section: { ...section, UserAccessEpoch: '1'.repeat(64) } } ],
        [ 'unproven-user-access', { currentHomeUserAccess: { ...input().currentHomeUserAccess, policyProven: false } } ],
        [ 'poisoned-generation', { section: { ...section, bindingGeneration: -1 } } ],
        [ 'duplicate-epoch-key', { section: { ...section, TopologyEpoch: 'e'.repeat(64) } } ],
        [ 'foreign-id', { section: { ...section, libraryId: otherLibraryId } } ],
        [ 'wrong-rule', { section: { ...section, sourceRuleId: 'another-rule' } } ],
        [ 'wrong-association', { association: { kind: 'matched' as const, ruleId: 'another-rule', section: 'opaque-section' } } ],
        [ 'wrong-association-instance', { association: { kind: 'matched' as const, ruleId: rule.id, section: 'other-instance' } } ],
        [ 'contradictory-rule-id', { section: { ...section, ruleId: 'another-rule' } } ],
        [ 'wrong-section', { sectionId: 'another-section' } ],
        [ 'scope-hash-mismatch', { section: { ...section, resolvedScopeHash: '0' } } ],
        [ 'config-hash-mismatch', { payload: { ...payload, rowConfigHash: 'old-hash' } } ],
        [ 'legacy-version', { featuredCacheVersion: 7 } ],
        [ 'missing-scope-schema', { payload: { ...payload, scopeSchemaVersion: undefined } } ],
        [ 'missing-library-claim', { section: { ...section, scopeType: undefined } } ],
        [ 'unbound-rule', { rule: { ...rule, libraryScope: { ...rule.libraryScope, virtualFolderId: undefined } } } ]
    ])('rejects a poisoned or stale claim: %s', (_label, change) => {
        expect(resolveHomeLibraryOwnershipClaim({ ...input(), ...change }).kind).toBe('rejected');
    });

    it('keeps an explicitly global editorial row global', () => {
        const globalRule = { id: 'discovery', enabled: true, mediaType: 'mixed', sourceType: 'genre', libraryScope: { mode: 'global' } };
        const globalSection = { id: 'global', sourceRuleId: globalRule.id, scopeType: 'global',
            configuredRowAssociation: { version: 1, scope: 'a'.repeat(64), rule: 'b'.repeat(64), section: 'opaque-global' },
            resolvedScopeHash: computeHomeResolvedScopeHash(globalRule, 'global'), rowConfigHash: hash };
        expect(resolveHomeLibraryOwnershipClaim({ ...input(), rule: globalRule, section: globalSection,
            sectionId: 'global', association: { kind: 'matched', ruleId: 'discovery', section: 'opaque-global' } }))
            .toMatchObject({ kind: 'global' });
    });

    it('does not treat a library source with a global scope as global', () => {
        const badRule = { ...rule, sourceType: 'library', libraryScope: { mode: 'global' } };
        expect(resolveHomeLibraryOwnershipClaim({ ...input(), rule: badRule }).kind).toBe('rejected');
    });
});

describe('Home owned-row filtering', () => {
    it('keeps only positive proofs in original Plugin order without refill', () => {
        const claim = resolveHomeLibraryOwnershipClaim(input());
        const items = [ { Id: 'movie-c' }, { Id: 'foreign' }, { Id: 'movie-a' }, { Id: 'no-proof' } ];
        expect(filterOwnedHomeRowInPluginOrder(claim, items, new Set([ 'movie-a', 'movie-c' ])))
            .toEqual([ items[0], items[2] ]);
        expect(items).toHaveLength(4);
    });

    it('suppresses a rejected claim even with supplied positive IDs', () => {
        const rejected = resolveHomeLibraryOwnershipClaim({ ...input(), sectionId: 'wrong' });
        expect(filterOwnedHomeRowInPluginOrder(rejected, [ { Id: 'movie-a' } ], new Set([ 'movie-a' ])))
            .toEqual([]);
    });
});

describe('Home ownership after an explicit ledger-only rebind', () => {
    const currentId = otherLibraryId;
    const sectionToken = 'c'.repeat(64);
    const presentation = { version: 1, scope: 'a'.repeat(64), generation: 'd'.repeat(64) };
    const reboundSection = () => ({ ...section, libraryId: currentId, bindingGeneration: 2,
        configuredRowAssociation: { ...section.configuredRowAssociation, section: sectionToken },
        resolvedScopeHash: computeHomeResolvedScopeHash({ ...rule,
            libraryScope: { ...rule.libraryScope, virtualFolderId: currentId } }) });
    const reboundInput = (proof: Awaited<ReturnType<typeof verifyConfiguredRowFreshness>>) => ({
        ...input(), section: reboundSection(),
        association: { kind: 'matched' as const, ruleId: rule.id, section: sectionToken },
        configuredProof: proof,
        payload: { ...payload, currentPresentationAuthority: presentation }
    });
    async function finalProof(binding: Record<string, unknown> | null = {
        rule: 'b'.repeat(64), section: sectionToken, libraryId: currentId,
        topologyEpoch: 'f'.repeat(64), bindingGeneration: 2, explicitRebind: true
    }) {
        retireConfiguredRowFreshness('test-reset');
        return verifyConfiguredRowFreshness({
            verification: beginConfiguredRowVerification('server-a:user-a'),
            settings: { currentPresentationAuthority: presentation },
            featured: { currentPresentationAuthority: presentation },
            readAuthority: async () => ({ currentPresentationAuthority: presentation,
                configuredPresentationBindings: binding ? [binding] : [ { rule: 'b'.repeat(64), section: sectionToken } ] })
        });
    }

    it('accepts the current ID for the exact saved pinned rule only with a fresh final-status attestation', async () => {
        const proof = await finalProof();
        expect(resolveHomeLibraryOwnershipClaim(reboundInput(proof))).toMatchObject({
            kind: 'library', libraryId: currentId, ruleId: rule.id
        });
        const withoutProof = reboundInput(null);
        expect(resolveHomeLibraryOwnershipClaim({ ...withoutProof,
            section: { ...withoutProof.section, transitionBinding: 'verified' } }).kind).toBe('rejected');
    });

    it('accepts an unpinned default only through the same attested current ID', async () => {
        const proof = await finalProof();
        const unpinned = { ...rule, libraryScope: { mode: 'defaultLibrary', defaultKey: 'movies' } };
        expect(resolveHomeLibraryOwnershipClaim({ ...reboundInput(proof), rule: unpinned }).kind).toBe('library');
        expect(resolveHomeLibraryOwnershipClaim({ ...reboundInput(null), rule: unpinned }).kind).toBe('rejected');
    });

    it('uses a verified seed only for an unpinned default, never a pinned-ID mismatch', async () => {
        const proof = await finalProof({ rule: 'b'.repeat(64), section: sectionToken, libraryId: currentId,
            topologyEpoch: 'f'.repeat(64), bindingGeneration: 2, explicitRebind: false });
        const unpinned = { ...rule, libraryScope: { mode: 'defaultLibrary', defaultKey: 'movies' } };
        expect(resolveHomeLibraryOwnershipClaim({ ...reboundInput(proof), rule: unpinned }).kind).toBe('library');
        expect(resolveHomeLibraryOwnershipClaim(reboundInput(proof)).kind).toBe('rejected');
    });

    it('rejects changed ID, effective hash, generation, saved scope fingerprint, and missing current status', async () => {
        const proof = await finalProof();
        const valid = reboundInput(proof);
        for (const poisoned of [
            { ...valid, section: { ...valid.section, libraryId: 'c'.repeat(32) } },
            { ...valid, section: { ...valid.section, resolvedScopeHash: computeHomeResolvedScopeHash(rule) } },
            { ...valid, section: { ...valid.section, bindingGeneration: 3 } },
            { ...valid, expectedRowConfigHash: 'changed-saved-scope-hash' },
            { ...valid, currentHomeTopology: null }
        ]) {
            expect(resolveHomeLibraryOwnershipClaim(poisoned).kind).toBe('rejected');
        }
    });

    it('rejects a copied section token when the final status lacks explicit rebound binding', async () => {
        const proof = await finalProof(null);
        expect(resolveHomeLibraryOwnershipClaim(reboundInput(proof)).kind).toBe('rejected');
    });
});
