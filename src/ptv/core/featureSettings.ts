export const PTV_FEATURE_SETTINGS_CHANGE_EVENT = 'ptv:feature-settings:change';

export type PtvPlaybackMode = 'auto' | 'compatible' | 'performance';

export type PtvFeatureSettings = {
    dynamicBackdropsEnabled: boolean;
    heroEnabled: boolean;
    homeRowsEnabled: boolean;
    playbackMode: PtvPlaybackMode;
    tvLowPowerModeEnabled: boolean;
};

export type PtvFeatureSettingKey = keyof PtvFeatureSettings;
type PtvBooleanFeatureSettingKey = Exclude<PtvFeatureSettingKey, 'playbackMode'>;

const PTV_FEATURE_SETTINGS_KEY = 'ptv:feature-flags:v1';
const PTV_LEGACY_FEATURE_SETTINGS_KEY = 'ptv:feature-settings:v1';
const PTV_LEGACY_SAFE_PLAYBACK_KEY = 'ptv:safe-playback-mode';
const PTV_PLAYBACK_MODES = new Set<PtvPlaybackMode>(['auto', 'compatible', 'performance']);
const PTV_BOOLEAN_FEATURE_SETTINGS = new Set<PtvBooleanFeatureSettingKey>([
    'dynamicBackdropsEnabled',
    'heroEnabled',
    'homeRowsEnabled',
    'tvLowPowerModeEnabled'
]);

const DEFAULT_FEATURE_SETTINGS: PtvFeatureSettings = {
    dynamicBackdropsEnabled: true,
    heroEnabled: true,
    homeRowsEnabled: true,
    playbackMode: 'auto',
    tvLowPowerModeEnabled: true
};

type PtvGlobal = Record<string, unknown> & {
    features?: {
        get: typeof getPtvFeatureSettings;
        set: typeof setPtvFeatureSetting;
    };
};

type PtvWindow = Window & {
    PTV?: PtvGlobal;
};

function getStorage() {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

export function isPtvPlaybackMode(value: unknown): value is PtvPlaybackMode {
    return typeof value === 'string' && PTV_PLAYBACK_MODES.has(value as PtvPlaybackMode);
}

function isPtvBooleanFeatureSettingKey(value: PtvFeatureSettingKey): value is PtvBooleanFeatureSettingKey {
    return PTV_BOOLEAN_FEATURE_SETTINGS.has(value as PtvBooleanFeatureSettingKey);
}

function parseStoredSettings(value: string | null): Partial<PtvFeatureSettings> {
    if (!value) return {};

    try {
        const parsed = JSON.parse(value) as Partial<Record<PtvFeatureSettingKey, unknown>>;

        return Object.keys(DEFAULT_FEATURE_SETTINGS).reduce<Partial<PtvFeatureSettings>>((settings, key) => {
            const settingKey = key as PtvFeatureSettingKey;

            const parsedValue = parsed[settingKey];

            if (settingKey === 'playbackMode') {
                if (isPtvPlaybackMode(parsedValue)) {
                    settings.playbackMode = parsedValue;
                }

                return settings;
            }

            if (isPtvBooleanFeatureSettingKey(settingKey) && typeof parsedValue === 'boolean') {
                settings[settingKey] = parsedValue;
            }

            return settings;
        }, {});
    } catch {
        return {};
    }
}

function getLegacyPlaybackMode(storage: Storage | null): Partial<PtvFeatureSettings> {
    const storedValue = storage?.getItem(PTV_LEGACY_SAFE_PLAYBACK_KEY);

    if (storedValue === '1' || storedValue === 'true') return { playbackMode: 'compatible' };
    if (storedValue === '0' || storedValue === 'false') return { playbackMode: 'performance' };

    return {};
}

function saveSettings(settings: PtvFeatureSettings) {
    const storage = getStorage();
    if (!storage) return;

    storage.setItem(PTV_FEATURE_SETTINGS_KEY, JSON.stringify(settings));
}

function dispatchFeatureSettingsChange(settings: PtvFeatureSettings) {
    window.dispatchEvent(new CustomEvent(PTV_FEATURE_SETTINGS_CHANGE_EVENT, {
        detail: settings
    }));
}

export function getPtvFeatureSettings(): PtvFeatureSettings {
    const storage = getStorage();

    return {
        ...DEFAULT_FEATURE_SETTINGS,
        ...getLegacyPlaybackMode(storage),
        ...parseStoredSettings(storage?.getItem(PTV_LEGACY_FEATURE_SETTINGS_KEY) || null),
        ...parseStoredSettings(storage?.getItem(PTV_FEATURE_SETTINGS_KEY) || null)
    };
}

export function applyPtvFeatureSettings(settings = getPtvFeatureSettings()) {
    const root = document.documentElement;

    root.classList.toggle('ptv-feature-hero-disabled', !settings.heroEnabled);
    root.classList.toggle('ptv-feature-home-rows-disabled', !settings.homeRowsEnabled);
    root.classList.toggle('ptv-feature-dynamic-backdrops-disabled', !settings.dynamicBackdropsEnabled);
    root.classList.toggle('ptv-feature-tv-low-power-disabled', !settings.tvLowPowerModeEnabled);
    root.dataset.ptvPlaybackMode = settings.playbackMode;
    root.classList.toggle('ptv-playback-mode-auto', settings.playbackMode === 'auto');
    root.classList.toggle('ptv-playback-mode-compatible', settings.playbackMode === 'compatible');
    root.classList.toggle('ptv-playback-mode-performance', settings.playbackMode === 'performance');

    return settings;
}

export function setPtvFeatureSetting<Key extends PtvFeatureSettingKey>(
    key: Key,
    value: PtvFeatureSettings[Key]
) {
    const settings = {
        ...getPtvFeatureSettings(),
        [key]: value
    };

    saveSettings(settings);
    applyPtvFeatureSettings(settings);
    dispatchFeatureSettingsChange(settings);

    return settings;
}

export function getPtvPlaybackMode(): PtvPlaybackMode {
    return getPtvFeatureSettings().playbackMode;
}

export function setPtvPlaybackMode(mode: PtvPlaybackMode) {
    return setPtvFeatureSetting('playbackMode', mode);
}

function installFeatureSettingsApi() {
    const ptvWindow = window as PtvWindow;
    const ptv = ptvWindow.PTV || (ptvWindow.PTV = {});

    ptv.features = {
        get: getPtvFeatureSettings,
        set: setPtvFeatureSetting
    };
}

applyPtvFeatureSettings();
installFeatureSettingsApi();
