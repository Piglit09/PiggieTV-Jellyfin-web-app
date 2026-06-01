import type { ReaderSettings } from './readerModels';

const SETTINGS_KEY = 'ptv.reader.settings.v1';

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
    theme: 'dark',
    flow: 'paged',
    direction: 'ltr',
    fontFamily: 'system',
    fontSize: 18,
    lineHeight: 1.55,
    margin: 28,
    textAlign: 'left',
    brightness: 1,
    fitMode: 'width',
    spreadMode: 'single',
    keepControlsVisible: false
};

function readJson<T>(key: string): T | null {
    try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) as T : null;
    } catch {
        return null;
    }
}

function writeJson(key: string, value: unknown) {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Local storage can fail in private or constrained modes. The reader still works with defaults.
    }
}

export function loadReaderSettings(): ReaderSettings {
    return {
        ...DEFAULT_READER_SETTINGS,
        ...(readJson<Partial<ReaderSettings>>(SETTINGS_KEY) || {})
    };
}

export function saveReaderSettings(settings: ReaderSettings) {
    writeJson(SETTINGS_KEY, settings);
}
