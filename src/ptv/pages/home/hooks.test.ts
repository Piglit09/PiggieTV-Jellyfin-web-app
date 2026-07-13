import { describe, expect, it } from 'vitest';

import { resolveNativeHomeDerivedRowSourceValue } from './rowSourceValue';

describe('resolveNativeHomeDerivedRowSourceValue', () => {
    it('keeps expanded genre titles paired with their derived source values', () => {
        const parentRuleSourceValue = 'Horror';

        ['Horror', 'Comedy', 'Action', 'Adventure'].forEach(title => {
            expect(resolveNativeHomeDerivedRowSourceValue({
                ruleSourceValue: parentRuleSourceValue,
                sourceType: 'genre',
                title
            })).toBe(title);
        });
    });

    it('prefers explicit section source values over parent rule values', () => {
        expect(resolveNativeHomeDerivedRowSourceValue({
            ruleSourceValue: 'Horror',
            sectionSourceValue: 'Supernatural',
            sourceType: 'genre',
            title: 'Comedy'
        })).toBe('Supernatural');
    });
});
