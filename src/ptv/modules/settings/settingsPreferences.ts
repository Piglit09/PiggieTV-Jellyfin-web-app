export type PtvUiScale = 'compact' | 'default' | 'comfortable';

export type PtvAppearancePreferences = Readonly<{
    animations: boolean;
    backdropMotion: boolean;
    highVisibilityFocus: boolean;
    reduceMotion: boolean;
    uiScale: PtvUiScale;
}>;

type PtvAppearancePreferenceDocument = Readonly<{
    schemaVersion: 1;
    values: PtvAppearancePreferences;
}>;

export const PTV_APPEARANCE_STORAGE_KEY = 'ptv:appearance:v1';

export const DEFAULT_PTV_APPEARANCE_PREFERENCES: PtvAppearancePreferences = {
    animations: true,
    backdropMotion: true,
    highVisibilityFocus: false,
    reduceMotion: false,
    uiScale: 'default'
};

function normalizeBoolean(value: unknown, fallback: boolean) {
    return typeof value === 'boolean' ? value : fallback;
}

export function normalizePtvAppearancePreferences(value: unknown): PtvAppearancePreferences {
    const candidate = value && typeof value === 'object' ?
        value as Partial<PtvAppearancePreferences> :
        {};
    const uiScale = candidate.uiScale === 'compact'
        || candidate.uiScale === 'comfortable'
        || candidate.uiScale === 'default' ?
        candidate.uiScale :
        DEFAULT_PTV_APPEARANCE_PREFERENCES.uiScale;

    return {
        animations: normalizeBoolean(candidate.animations, true),
        backdropMotion: normalizeBoolean(candidate.backdropMotion, true),
        highVisibilityFocus: normalizeBoolean(candidate.highVisibilityFocus, false),
        reduceMotion: normalizeBoolean(candidate.reduceMotion, false),
        uiScale
    };
}

export function loadPtvAppearancePreferences(storage: Pick<Storage, 'getItem'> = window.localStorage) {
    try {
        const raw = storage.getItem(PTV_APPEARANCE_STORAGE_KEY);
        if (!raw) return DEFAULT_PTV_APPEARANCE_PREFERENCES;

        const parsed = JSON.parse(raw) as Partial<PtvAppearancePreferenceDocument>;
        return parsed.schemaVersion === 1 ?
            normalizePtvAppearancePreferences(parsed.values) :
            DEFAULT_PTV_APPEARANCE_PREFERENCES;
    } catch {
        return DEFAULT_PTV_APPEARANCE_PREFERENCES;
    }
}

export function applyPtvAppearancePreferences(
    preferences: PtvAppearancePreferences,
    root: HTMLElement = document.documentElement
) {
    const motionReduced = preferences.reduceMotion || !preferences.animations;

    root.dataset.ptvUiScale = preferences.uiScale;
    root.classList.toggle('ptv-user-reduce-motion', motionReduced);
    root.classList.toggle('ptv-user-backdrop-motion-off', !preferences.backdropMotion);
    root.classList.toggle('ptv-user-high-visibility-focus', preferences.highVisibilityFocus);
}

export function savePtvAppearancePreferences(
    preferences: PtvAppearancePreferences,
    storage: Pick<Storage, 'setItem'> = window.localStorage,
    root: HTMLElement = document.documentElement
) {
    const normalized = normalizePtvAppearancePreferences(preferences);

    storage.setItem(PTV_APPEARANCE_STORAGE_KEY, JSON.stringify({
        schemaVersion: 1,
        values: normalized
    } satisfies PtvAppearancePreferenceDocument));
    applyPtvAppearancePreferences(normalized, root);

    return normalized;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    applyPtvAppearancePreferences(loadPtvAppearancePreferences());
}
