import { describe, expect, it } from 'vitest';
import { HomeOwnershipReadBudget } from './homeOwnershipReadBudget';

describe('shared Home ownership budget', () => {
    it('counts the final status plus one Views and four Items as six reads', () => {
        const budget = new HomeOwnershipReadBudget();
        expect(budget.reserve('status')).toBe(true);
        expect(budget.reserve('views')).toBe(true);
        for (let index = 0; index < 4; index++) expect(budget.reserve('items')).toBe(true);
        expect(budget.used).toBe(6);
    });
    it('enforces 25 across status Views Items and rechecks with no refill', () => {
        const budget = new HomeOwnershipReadBudget();
        budget.reserve('status');
        budget.reserve('views');
        for (let index = 0; index < 23; index++) expect(budget.reserve('items')).toBe(true);
        expect(budget.reserve('recheck')).toBe(false);
        expect(budget.reserve('items')).toBe(false);
        expect(budget.used).toBe(25);
    });
});
