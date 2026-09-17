import { describe, expect, it } from 'vitest';

import { createConfiguredRowAssociationResolver } from './configuredRowAssociation';

const scope = 'a'.repeat(64);
const ruleA = 'b'.repeat(64);
const ruleB = 'c'.repeat(64);
const sectionA = 'd'.repeat(64);
const sectionB = 'e'.repeat(64);
const rules = [
    { id: 'private-a', name: 'Same title', mediaType: 'Movie', enabled: true },
    { id: 'private-b', name: 'Same title', mediaType: 'Movie', enabled: true }
];
const settings = () => ({
    enabled: true,
    rules: rules.map(rule => ({ ...rule })),
    configuredRowAssociations: {
        version: 1,
        scope,
        rules: [ { ruleId: 'private-a', association: ruleA }, { ruleId: 'private-b', association: ruleB } ],
        sections: [ { rule: ruleA, section: sectionA }, { rule: ruleB, section: sectionB } ]
    }
});
const section = (rule = ruleA, instance = sectionA) => ({
    id: instance === sectionA ? 'section' : 'section-2',
    title: 'Featured',
    rowType: 'configured-rule',
    configuredRowAssociation: { version: 1, scope, rule, section: instance }
});

describe('server-issued configured row association', () => {
    it('joins exact issued pairs, independent of same titles and media types', () => {
        const first = section();
        const second = section(ruleB, sectionB);
        const resolver = createConfiguredRowAssociationResolver(settings(), [ first, second ]);
        expect(resolver.resolve(first)).toEqual({ kind: 'matched', ruleId: 'private-a', section: sectionA });
        expect(resolver.resolve(second)).toEqual({ kind: 'matched', ruleId: 'private-b', section: sectionB });
    });

    it('supports many distinct section instances owned by one configured rule', () => {
        const config = settings();
        config.configuredRowAssociations.sections[1].rule = ruleA;
        const first = section();
        const second = section(ruleA, sectionB);
        const resolver = createConfiguredRowAssociationResolver(config, [ first, second ]);
        expect(resolver.resolve(first).kind).toBe('matched');
        expect(resolver.resolve(second)).toEqual({ kind: 'matched', ruleId: 'private-a', section: sectionB });
    });

    it('ignores title, public section ordinal and configured ordering as association inputs', () => {
        const config = settings();
        config.rules.reverse();
        const candidate = { ...section(), id: 'unrelated-public-id', title: 'A different label' };
        expect(createConfiguredRowAssociationResolver(config, [ candidate ]).resolve(candidate).kind).toBe('matched');
    });

    it('rejects a valid instance relabelled with another valid rule token', () => {
        const candidate = section(ruleB, sectionA);
        expect(createConfiguredRowAssociationResolver(settings(), [ candidate ]).resolve(candidate).kind).toBe('rejected');
    });

    it.each([ 'user-switch', 'server-switch', 'config-change', 'config-A-B-A', 'restart' ])('rejects a stale scope after %s', () => {
        const config = settings();
        config.configuredRowAssociations.scope = 'f'.repeat(64);
        const candidate = section();
        expect(createConfiguredRowAssociationResolver(config, [ candidate ]).resolve(candidate).kind).toBe('rejected');
    });

    it.each([ null, {}, { version: 2, scope, rule: ruleA, section: sectionA },
        { version: 1, scope, rule: 'short', section: sectionA },
        { version: 1, scope: scope.toUpperCase(), rule: ruleA, section: sectionA },
        { version: 1, scope, rule: ruleA, section: sectionA, extra: true }
    ])('rejects malformed section metadata without legacy downgrade (%j)', value => {
        const candidate = { ...section(), sourceRuleId: 'private-a', configuredRowAssociation: value };
        expect(createConfiguredRowAssociationResolver(settings(), [ candidate ]).resolve(candidate).kind).toBe('rejected');
    });

    it('rejects missing section metadata when the current settings contract is present', () => {
        const candidate = { id: 'section', sourceRuleId: 'private-a' };
        expect(createConfiguredRowAssociationResolver(settings(), [ candidate ]).resolve(candidate).kind).toBe('rejected');
    });

    it('rejects missing administrator mapping and never guesses from legacy fields', () => {
        const candidate = { ...section(), sourceRuleId: 'private-a' };
        expect(createConfiguredRowAssociationResolver({ rules }, [ candidate ]).resolve(candidate).kind).toBe('rejected');
    });

    it.each([ null, {}, { version: 2, scope, rules: [], sections: [] },
        { version: 1, scope, rules: [], sections: [] },
        { version: 1, scope, rules: [], sections: [], extra: true }
    ])('rejects malformed or unissued administrator mapping (%j)', mapping => {
        const config = { ...settings(), configuredRowAssociations: mapping };
        const candidate = section();
        expect(createConfiguredRowAssociationResolver(config, [ candidate ]).resolve(candidate).kind).toBe('rejected');
    });

    it('does not downgrade an unmarked section inside an opaque response', () => {
        const marked = section();
        const candidate = { id: 'legacy-looking', sourceRuleId: 'private-a' };
        expect(createConfiguredRowAssociationResolver({ rules }, [ marked, candidate ]).resolve(candidate).kind).toBe('rejected');
    });

    it('preserves legacy behavior only when both opaque contracts are absent', () => {
        const candidate = { id: 'legacy', sourceRuleId: 'private-a' };
        expect(createConfiguredRowAssociationResolver({ rules }, [ candidate ]).resolve(candidate)).toEqual({ kind: 'legacy' });
    });

    it.each([ 'disabled', 'deleted', 'ambiguous' ])('rejects a %s configured rule', mode => {
        const config = settings();
        if (mode === 'disabled') config.rules[0].enabled = false;
        if (mode === 'deleted') config.rules.shift();
        if (mode === 'ambiguous') config.rules.push({ ...config.rules[0], id: 'PRIVATE-A' });
        const candidate = section();
        expect(createConfiguredRowAssociationResolver(config, [ candidate ]).resolve(candidate).kind).toBe('rejected');
    });

    it('rejects mapping alias collisions between two configured rules', () => {
        const config = settings();
        config.configuredRowAssociations.rules[1].association = ruleA;
        const candidate = section();
        expect(createConfiguredRowAssociationResolver(config, [ candidate ]).resolve(candidate).kind).toBe('rejected');
    });

    it('rejects duplicate mapping instance tokens', () => {
        const config = settings();
        config.configuredRowAssociations.sections.push({ rule: ruleA, section: sectionA });
        const candidate = section();
        expect(createConfiguredRowAssociationResolver(config, [ candidate ]).resolve(candidate).kind).toBe('rejected');
    });

    it('rejects duplicate response instances before any first-wins section deduplication', () => {
        const first = section();
        const duplicate = { ...section(), id: 'other-public-id' };
        const resolver = createConfiguredRowAssociationResolver(settings(), [ first, duplicate ]);
        expect(resolver.resolve(first).kind).toBe('rejected');
        expect(resolver.resolve(duplicate).kind).toBe('rejected');
    });

    it('rejects ambiguous public section-item ownership', () => {
        const first = section();
        const second = { ...section(ruleB, sectionB), id: 'section' };
        const resolver = createConfiguredRowAssociationResolver(settings(), [ first, second ]);
        expect(resolver.resolve(first).kind).toBe('rejected');
        expect(resolver.resolve(second).kind).toBe('rejected');
    });

    it('rejects unknown, orphaned, or replayed instances', () => {
        const candidate = section(ruleA, 'f'.repeat(64));
        expect(createConfiguredRowAssociationResolver(settings(), [ candidate ]).resolve(candidate).kind).toBe('rejected');
    });

    it('rejects alternate or ambiguous property casing', () => {
        const candidate = { ...section(), ConfiguredRowAssociation: section().configuredRowAssociation };
        expect(createConfiguredRowAssociationResolver(settings(), [ candidate ]).resolve(candidate).kind).toBe('rejected');
    });

    it('requires administrator rule settings, retaining restricted-user behavior', () => {
        const candidate = section();
        expect(createConfiguredRowAssociationResolver(null, [ candidate ]).resolve(candidate).kind).toBe('rejected');
    });

    it('never edits section items, shared settings, or the supplied response', () => {
        const config = settings();
        const candidate = { ...section(), items: [ { Id: 'authorized-survivor' } ] };
        const before = JSON.stringify({ config, candidate });
        const resolver = createConfiguredRowAssociationResolver(config, [ candidate ]);
        resolver.resolve(candidate);
        expect(JSON.stringify({ config, candidate })).toBe(before);
        expect(candidate.items).toEqual([ { Id: 'authorized-survivor' } ]);
    });
});
