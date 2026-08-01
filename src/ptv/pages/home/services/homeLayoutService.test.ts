import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../scripts/settings/userSettings', () => ({
    currentSettings: {}
}));

vi.mock('../../../api', () => ({
    getPtvCurrentUserId: vi.fn(),
    getPtvServerId: vi.fn()
}));

import {
    DEFAULT_NATIVE_HOME_PERSONALIZATION_SETTINGS,
    decorateNativeHomeRowsForCurrentLayout
} from './homeLayoutService';
import type { NativeHomeRow } from '../hooks';

function row(id: string): NativeHomeRow {
    return {
        id,
        items: [],
        kind: 'items',
        source: 'recently-added',
        subtitle: '',
        title: id
    };
}

describe('Home layout compatibility adapter', () => {
    it('applies scoped visibility and explicit row order while retaining legacy pin ordering', () => {
        const settings = {
            ...DEFAULT_NATIVE_HOME_PERSONALIZATION_SETTINGS,
            pinnedRows: ['row-d'],
            rowOrder: ['row-c', 'row-a'],
            rowVisibility: {
                'row-b': false
            }
        };
        const decorated = decorateNativeHomeRowsForCurrentLayout([
            row('row-a'),
            row('row-b'),
            row('row-c'),
            row('row-d'),
            row('row-e')
        ], settings);

        expect(decorated.map(value => value.id)).toEqual([
            'row-c',
            'row-a',
            'row-d',
            'row-e'
        ]);
        expect(decorated.find(value => value.id === 'row-d')?.pinned).toBe(true);
    });
});
