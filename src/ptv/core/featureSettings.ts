export const PTV_FEATURE_SETTINGS_CHANGE_EVENT = 'ptv:feature-settings:change';

export type PtvFeatureSettings = {
    dynamicBackdropsEnabled: boolean;
    heroEnabled: boolean;
    homeRowsEnabled: boolean;
    tvLowPowerModeEnabled: boolean;
};

export type PtvFeatureSettingKey = keyof PtvFeatureSettings;

const PTV_FEATURE_SETTINGS_KEY = 'ptv:feature-flags:v1';
const PTV_LEGACY_FEATURE_SETTINGS_KEY = 'ptv:feature-settings:v1';

const DEFAULT_FEATURE_SETTINGS: PtvFeatureSettings = {
    dynamicBackdropsEnabled: true,
    heroEnabled: true,
    homeRowsEnabled: true,
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

function parseStoredSettings(value: string | null): Partial<PtvFeatureSettings> {
    if (!value) return {};

    try {
        const parsed = JSON.parse(value) as Partial<Record<PtvFeatureSettingKey, unknown>>;

        return Object.keys(DEFAULT_FEATURE_SETTINGS).reduce<Partial<PtvFeatureSettings>>((settings, key) => {
            const settingKey = key as PtvFeatureSettingKey;

            if (typeof parsed[settingKey] === 'boolean') {
                settings[settingKey] = parsed[settingKey];
            }

            return settings;
        }, {});
    } catch {
        return {};
    }
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

    return settings;
}

export function setPtvFeatureSetting(
    key: PtvFeatureSettingKey,
    enabled: boolean
) {
    const settings = {
        ...getPtvFeatureSettings(),
        [key]: enabled
    };

    saveSettings(settings);
    applyPtvFeatureSettings(settings);
    dispatchFeatureSettingsChange(settings);

    return settings;
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
