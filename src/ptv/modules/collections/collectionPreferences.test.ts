import { beforeEach, describe, expect, it, vi } from 'vitest';

const settingsState = vi.hoisted(() => ({ value: '' }));

vi.mock('../../../scripts/settings/userSettings', () => ({
    currentSettings: {
        flushServerPreferences: vi.fn(async () => undefined),
        get: vi.fn(() => settingsState.value),
        getData: vi.fn(() => ({})),
        set: vi.fn((_key: string, value: string) => {
            settingsState.value = value;
        })
    }
}));

vi.mock('../../api', () => ({
    getPtvCurrentUserId: vi.fn(() => 'user-a'),
    getPtvServerId: vi.fn(() => 'server-a')
}));

import {
    PtvCollectionPreferenceStaleError,
    createDefaultPtvCollectionPreferenceDocument,
    loadPtvCollectionPreferenceDocument,
    normalizePtvCollectionPreferenceDocument,
    resetPtvCollectionVisibility,
    setPtvCollectionHidden,
    setPtvCollectionPinned,
    stagePtvCollectionPreferenceDocument,
    undoPtvCollectionHidden
} from './collectionPreferences';

describe('Collection preferences', () => {
    const scope = { serverId: 'server-a', userId: 'user-a' };

    beforeEach(() => {
        settingsState.value = '';
        vi.clearAllMocks();
    });

    it('recovers invalid state to scoped defaults', () => {
        const document = normalizePtvCollectionPreferenceDocument({
            preferences: { density: 'giant', sectionOrder: ['not-real'] },
            revision: -1,
            scope: { serverId: 'wrong', userId: 'wrong' }
        }, scope);

        expect(document.scope).toEqual(scope);
        expect(document.preferences.density).toBe('comfortable');
        expect(document.preferences.sectionOrder).toContain('featured');
    });

    it('supports pin, hide, undo, and reset without item-level suppression', () => {
        const initial = createDefaultPtvCollectionPreferenceDocument(scope);
        const pinned = setPtvCollectionPinned(initial, 'jellyfin:set', true);
        const hidden = setPtvCollectionHidden(pinned, 'jellyfin:set', true);
        const undone = undoPtvCollectionHidden(hidden);
        const reset = resetPtvCollectionVisibility(hidden);

        expect(pinned.preferences.pinnedCollectionKeys).toEqual(['jellyfin:set']);
        expect(hidden.preferences.hiddenCollectionKeys).toEqual(['jellyfin:set']);
        expect(undone.preferences.hiddenCollectionKeys).toEqual([]);
        expect(reset.preferences.hiddenCollectionKeys).toEqual([]);
    });

    it('rejects stale writes and remains scoped to the active server user', () => {
        const initial = createDefaultPtvCollectionPreferenceDocument(scope);
        const next = setPtvCollectionPinned(initial, 'curated:one', true);

        stagePtvCollectionPreferenceDocument(next);
        expect(loadPtvCollectionPreferenceDocument(scope).preferences.pinnedCollectionKeys).toEqual(['curated:one']);
        expect(() => stagePtvCollectionPreferenceDocument(next)).toThrow(PtvCollectionPreferenceStaleError);
        expect(loadPtvCollectionPreferenceDocument({ serverId: 'server-b', userId: 'user-b' }).preferences.pinnedCollectionKeys).toEqual([]);
    });
});
