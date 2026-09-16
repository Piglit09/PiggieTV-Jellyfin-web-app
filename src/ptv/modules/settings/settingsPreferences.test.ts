import { describe, expect, it } from 'vitest';

import {
    DEFAULT_PTV_APPEARANCE_PREFERENCES,
    loadPtvAppearancePreferences,
    normalizePtvAppearancePreferences,
    PTV_APPEARANCE_STORAGE_KEY,
    savePtvAppearancePreferences
} from './settingsPreferences';

describe('PiggieTV appearance preferences', () => {
    it('normalizes invalid documents without inventing settings', () => {
        expect(normalizePtvAppearancePreferences({
            animations: false,
            reduceMotion: 'yes',
            uiScale: 'giant'
        })).toEqual({
            ...DEFAULT_PTV_APPEARANCE_PREFERENCES,
            animations: false
        });
    });

    it('round-trips the versioned device-local document and applies root state', () => {
        const values = {
            animations: true,
            backdropMotion: false,
            highVisibilityFocus: true,
            reduceMotion: true,
            uiScale: 'comfortable' as const
        };
        let stored = '';
        const root = document.createElement('div');
        const storage = {
            getItem: (key: string) => key === PTV_APPEARANCE_STORAGE_KEY ? stored : null,
            setItem: (_key: string, value: string) => {
                stored = value;
            }
        };

        savePtvAppearancePreferences(values, storage, root);

        expect(loadPtvAppearancePreferences(storage)).toEqual(values);
        expect(root.dataset.ptvUiScale).toBe('comfortable');
        expect(root.classList).toContain('ptv-user-reduce-motion');
        expect(root.classList).toContain('ptv-user-backdrop-motion-off');
        expect(root.classList).toContain('ptv-user-high-visibility-focus');
    });
});
