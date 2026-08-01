import { beforeEach, describe, expect, it, vi } from 'vitest';

const identity = vi.hoisted(() => ({
    serverId: 'server-a',
    userId: 'user-a'
}));
const settingsState = vi.hoisted(() => ({
    rawValue: undefined as string | undefined
}));
const settingsMocks = vi.hoisted(() => ({
    flushServerPreferences: vi.fn(async () => undefined),
    get: vi.fn(() => settingsState.rawValue),
    getData: vi.fn(() => ({
        CustomPrefs: {}
    })),
    set: vi.fn((_name: string, value: string) => {
        settingsState.rawValue = value;
    })
}));
const currentSettings = vi.hoisted(() => ({
    currentApiClient: {
        serverId: vi.fn(() => identity.serverId)
    },
    currentUserId: identity.userId,
    flushServerPreferences: settingsMocks.flushServerPreferences,
    get: settingsMocks.get,
    getData: settingsMocks.getData,
    set: settingsMocks.set
}));

vi.mock('../../../../scripts/settings/userSettings', () => ({
    currentSettings
}));

vi.mock('../../../api', () => ({
    getPtvCurrentUserId: vi.fn(() => identity.userId),
    getPtvServerId: vi.fn(() => identity.serverId)
}));

import {
    applyNativeHomeRecommendationFeedback,
    createDefaultNativeHomePreferenceDocument,
    loadNativeHomePreferenceDocument,
    MAX_NATIVE_HOME_STORED_ROWS,
    NATIVE_HOME_PREFERENCE_SCHEMA_VERSION,
    normalizeNativeHomePreferenceDocument,
    parseNativeHomePreferenceDocument,
    resetNativeHomeRecommendationFeedback,
    saveNativeHomePreferenceDocument,
    stageNativeHomePreferenceDocument,
    undoNativeHomeRecommendationFeedback
} from './homePreferenceService';

describe('Home preference document', () => {
    beforeEach(() => {
        identity.serverId = 'server-a';
        identity.userId = 'user-a';
        currentSettings.currentUserId = 'user-a';
        settingsState.rawValue = undefined;
        settingsMocks.flushServerPreferences.mockClear();
        settingsMocks.get.mockClear();
        settingsMocks.getData.mockClear();
        settingsMocks.set.mockClear();
    });

    it('ignores unscoped and mismatched documents instead of leaking them between identities', () => {
        const scope = {
            serverId: 'server-a',
            userId: 'user-a'
        };
        const document = createDefaultNativeHomePreferenceDocument(scope);

        document.layout.density = 'compact';
        settingsState.rawValue = JSON.stringify(document);

        expect(loadNativeHomePreferenceDocument().layout.density).toBe('compact');

        identity.serverId = 'server-b';
        identity.userId = 'user-b';
        currentSettings.currentUserId = 'user-b';

        expect(loadNativeHomePreferenceDocument().layout.density).toBe('comfortable');
        expect(parseNativeHomePreferenceDocument(JSON.stringify({
            layout: {
                density: 'compact'
            }
        }), {
            serverId: 'server-b',
            userId: 'user-b'
        }).layout.density).toBe('comfortable');
    });

    it('recovers invalid fields and bounds row and feedback collections', () => {
        const scope = {
            serverId: 'server-a',
            userId: 'user-a'
        };
        const rowIds = Array.from({
            length: MAX_NATIVE_HOME_STORED_ROWS + 20
        }, (_, index) => `row-${index}`);
        const normalized = normalizeNativeHomePreferenceDocument({
            feedback: {
                entries: Array.from({
                    length: 240
                }, (_, index) => ({
                    action: 'not-interested',
                    createdAt: index,
                    itemId: `item-${index}`,
                    terms: []
                })),
                undoStack: []
            },
            layout: {
                adaptiveRows: 'yes',
                autoReorder: false,
                density: 'huge',
                heroEnabled: false,
                layoutMode: 'invalid',
                pinnedRows: [...rowIds, 'row-0'],
                rowOrder: rowIds,
                rowVisibility: Object.fromEntries(rowIds.map(rowId => [
                    rowId,
                    true
                ]))
            },
            schemaVersion: NATIVE_HOME_PREFERENCE_SCHEMA_VERSION,
            scope,
            updatedAt: Number.POSITIVE_INFINITY
        }, scope);

        expect(normalized.layout.adaptiveRows).toBe(true);
        expect(normalized.layout.autoReorder).toBe(false);
        expect(normalized.layout.density).toBe('comfortable');
        expect(normalized.layout.heroEnabled).toBe(false);
        expect(normalized.layout.layoutMode).toBe('balanced');
        expect(normalized.layout.pinnedRows).toHaveLength(MAX_NATIVE_HOME_STORED_ROWS);
        expect(normalized.layout.rowOrder).toHaveLength(MAX_NATIVE_HOME_STORED_ROWS);
        expect(Object.keys(normalized.layout.rowVisibility)).toHaveLength(MAX_NATIVE_HOME_STORED_ROWS);
        expect(normalized.feedback.entries).toHaveLength(200);
        expect(normalized.updatedAt).toBe(0);
    });

    it('supports feedback application, undo, and reset without mutating the source document', () => {
        const document = createDefaultNativeHomePreferenceDocument({
            serverId: 'server-a',
            userId: 'user-a'
        });
        const withFeedback = applyNativeHomeRecommendationFeedback(document, {
            action: 'show-fewer-like-this',
            itemId: 'item-a',
            now: 10,
            terms: ['Drama', 'drama']
        });

        expect(document.feedback.entries).toEqual([]);
        expect(withFeedback.feedback.entries).toEqual([{
            action: 'show-fewer-like-this',
            createdAt: 10,
            itemId: 'item-a',
            terms: ['drama']
        }]);
        expect(undoNativeHomeRecommendationFeedback(withFeedback).feedback.entries).toEqual([]);
        expect(resetNativeHomeRecommendationFeedback(withFeedback).feedback).toEqual({
            entries: [],
            undoStack: []
        });
    });

    it('stages through CustomPrefs and provides an awaitable serialized flush boundary', async () => {
        const document = createDefaultNativeHomePreferenceDocument({
            serverId: 'server-a',
            userId: 'user-a'
        });

        document.layout.rowOrder = ['continue-watching', 'recommended-for-you'];

        const staged = stageNativeHomePreferenceDocument(document);

        expect(settingsMocks.set).toHaveBeenCalledWith(
            'ptv.home.preferences.v1',
            expect.any(String),
            true
        );
        expect(JSON.parse(settingsState.rawValue || '').scope).toEqual(document.scope);
        expect(staged.layout.rowOrder).toEqual(document.layout.rowOrder);

        await saveNativeHomePreferenceDocument(staged);

        expect(settingsMocks.flushServerPreferences).toHaveBeenCalledTimes(1);
    });

    it('rejects staging a document owned by another user', () => {
        const document = createDefaultNativeHomePreferenceDocument({
            serverId: 'server-a',
            userId: 'user-b'
        });

        expect(() => stageNativeHomePreferenceDocument(document)).toThrow(/identity/i);
        expect(settingsMocks.set).not.toHaveBeenCalled();
    });
});
