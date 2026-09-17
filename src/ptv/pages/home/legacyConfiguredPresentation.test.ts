import { describe, expect, it } from 'vitest';

import { canRestoreLegacyHomeRow, isLegacyConfiguredRow } from './legacyConfiguredPresentation';

describe('legacy configured presentation fails closed without the native verifier', () => {
    it.each([
        { rowType: 'configured-rule' },
        { RowType: 'configured-rule' },
        { type: 'configured-rule' },
        { renderedSource: 'row-builder' },
        { sourceRuleId: 'synthetic-rule' },
        { ruleId: 'synthetic-rule' },
        { configuredRowAssociation: { malformed: true } },
        { ConfiguredRowAssociation: null },
        { configuredPresentationAuthority: 'synthetic-proof' }
    ])('never turns configured metadata into a generic legacy row: %j', row => {
        expect(isLegacyConfiguredRow(row)).toBe(true);
        expect(canRestoreLegacyHomeRow(row, { genericPresentationVerified: true })).toBe(false);
    });

    it.each(['libraries', 'continue', 'featured'])('preserves explicitly captured generic %s HTML', type => {
        const row = { id: 'generic', type, title: 'Generic' };
        expect(isLegacyConfiguredRow(row)).toBe(false);
        expect(canRestoreLegacyHomeRow(row, { genericPresentationVerified: true })).toBe(true);
    });

    it('does not infer provenance for an older HTML snapshot', () => {
        expect(canRestoreLegacyHomeRow({ type: 'featured' }, {})).toBe(false);
    });

    it('fails closed for ambiguous or missing row ownership', () => {
        expect(canRestoreLegacyHomeRow(null, { genericPresentationVerified: true })).toBe(false);
        expect(canRestoreLegacyHomeRow(undefined, { genericPresentationVerified: true })).toBe(false);
    });
});
