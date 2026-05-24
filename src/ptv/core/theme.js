import { PTV_EVENTS } from './config';
import { dispatchPtvCustomEvent } from './events';

const PTV_THEME_ATTRIBUTE = 'data-ptv-theme';
const PTV_THEME_CLASS_PREFIX = 'ptv-theme-';
const PTV_THEME_PARAM = 'ptvTheme';
const PTV_THEME_STORAGE_KEY = 'ptv:theme';

const PTV_THEMES = [
    {
        description: 'Canonical PiggieTV token contract.',
        effects: 'standard',
        id: 'default',
        label: 'Default'
    },
    {
        description: 'True-black semantic surface overrides for OLED displays.',
        effects: 'standard',
        id: 'oled',
        label: 'OLED'
    },
    {
        description: 'Denser spacing and control sizing through density tokens.',
        effects: 'standard',
        id: 'compact',
        label: 'Compact'
    },
    {
        description: 'Reduced blur, shadows, and motion through semantic tokens.',
        effects: 'reduced',
        id: 'lowfx',
        label: 'Low FX'
    }
];

const DEFAULT_THEME = PTV_THEMES[0].id;
const THEME_IDS = new Set(PTV_THEMES.map((theme) => theme.id));

let currentTheme = DEFAULT_THEME;

function getStorage() {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function getThemeFromSearch() {
    const pattern = new RegExp(`[?&]${PTV_THEME_PARAM}=([^&]+)`, 'i');
    const match = pattern.exec(window.location.search);

    if (!match) return '';

    try {
        return decodeURIComponent(match[1].replace(/\+/g, ' '));
    } catch {
        return match[1];
    }
}

function normalizeTheme(theme) {
    const id = String(theme || '').trim().toLowerCase();

    return THEME_IDS.has(id) ? id : DEFAULT_THEME;
}

function getStoredTheme() {
    return getStorage()?.getItem(PTV_THEME_STORAGE_KEY) || '';
}

function persistTheme(theme) {
    const storage = getStorage();

    if (!storage) return;

    if (theme === DEFAULT_THEME) {
        storage.removeItem(PTV_THEME_STORAGE_KEY);
        return;
    }

    storage.setItem(PTV_THEME_STORAGE_KEY, theme);
}

function removeThemeClasses(root) {
    Array.from(root.classList)
        .filter((className) => className.startsWith(PTV_THEME_CLASS_PREFIX))
        .forEach((className) => {
            root.classList.remove(className);
        });
}

function getThemeInfo(theme = currentTheme) {
    return PTV_THEMES.find((item) => item.id === normalizeTheme(theme)) || PTV_THEMES[0];
}

export function getPtvTheme() {
    return currentTheme;
}

export function getPtvThemes() {
    return PTV_THEMES.map((theme) => ({ ...theme }));
}

export function setPtvTheme(theme, options = {}) {
    const nextTheme = normalizeTheme(theme);
    const root = document.documentElement;
    const previousTheme = currentTheme;
    const { persist = true } = options;

    currentTheme = nextTheme;
    root.setAttribute(PTV_THEME_ATTRIBUTE, nextTheme);
    removeThemeClasses(root);
    root.classList.add(`${PTV_THEME_CLASS_PREFIX}${nextTheme}`);

    if (persist) {
        persistTheme(nextTheme);
    }

    if (previousTheme !== nextTheme) {
        dispatchPtvCustomEvent(PTV_EVENTS.themeChange, {
            previousTheme,
            theme: getThemeInfo(nextTheme)
        });
    }

    return getThemeInfo(nextTheme);
}

export function resetPtvTheme() {
    getStorage()?.removeItem(PTV_THEME_STORAGE_KEY);

    return setPtvTheme(DEFAULT_THEME, { persist: false });
}

function getInitialTheme() {
    return normalizeTheme(getThemeFromSearch() || getStoredTheme() || DEFAULT_THEME);
}

function installThemeApi() {
    const ptv = window.PTV || (window.PTV = {});
    const themeApi = (theme, options) => {
        if (typeof theme === 'undefined') {
            return getThemeInfo();
        }

        return setPtvTheme(theme, options);
    };

    themeApi.get = () => getThemeInfo();
    themeApi.id = getPtvTheme;
    themeApi.list = getPtvThemes;
    themeApi.reset = resetPtvTheme;
    themeApi.set = setPtvTheme;
    themeApi.storageKey = PTV_THEME_STORAGE_KEY;

    ptv.theme = themeApi;
}

setPtvTheme(getInitialTheme(), { persist: Boolean(getThemeFromSearch()) });
installThemeApi();
