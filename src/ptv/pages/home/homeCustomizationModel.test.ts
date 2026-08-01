import { describe, expect, it } from 'vitest';

import {
    moveNativeHomeCustomizationRow,
    orderNativeHomeCustomizationRows
} from './HomeCustomizationDialog';

const rows = [
    { id: 'continue', title: 'Continue Watching' },
    { id: 'recommended', title: 'Recommended For You' },
    { id: 'recent', title: 'Recently Added' }
];

describe('Home customization row helpers', () => {
    it('applies a stored order without losing newly available rows', () => {
        expect(orderNativeHomeCustomizationRows(rows, ['recommended', 'continue']).map(row => row.id))
            .toEqual(['recommended', 'continue', 'recent']);
    });

    it('ignores invalid and duplicate row identities', () => {
        expect(orderNativeHomeCustomizationRows([
            ...rows,
            { id: 'continue', title: 'Duplicate' },
            { id: '', title: 'Invalid' }
        ], ['missing', 'recent']).map(row => row.id))
            .toEqual(['recent', 'continue', 'recommended']);
    });

    it('moves rows within bounds while preserving every identity', () => {
        expect(moveNativeHomeCustomizationRow(rows, 'recommended', 'up').map(row => row.id))
            .toEqual(['recommended', 'continue', 'recent']);
        expect(moveNativeHomeCustomizationRow(rows, 'recent', 'down')).toEqual(rows);
    });
});
