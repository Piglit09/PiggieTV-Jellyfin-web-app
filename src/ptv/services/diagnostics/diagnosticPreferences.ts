export type PtvDiagnosticPreferences = Readonly<{
    collectionEnabled: boolean;
    overlayEnabled: boolean;
}>;

const STORAGE_KEY = 'ptv:diagnostics:preferences:v1';
const CHANGE_EVENT = 'ptv:diagnostics-preferences-change';
const DEFAULT_PREFERENCES: PtvDiagnosticPreferences = {
    collectionEnabled: true,
    overlayEnabled: false
};

function getStorage() {
    try {
        return typeof window === 'undefined' ? null : window.localStorage;
    } catch {
        return null;
    }
}

export function getPtvDiagnosticPreferences(): PtvDiagnosticPreferences {
    const raw = getStorage()?.getItem(STORAGE_KEY);

    if (!raw) return DEFAULT_PREFERENCES;

    try {
        const parsed = JSON.parse(raw) as Partial<PtvDiagnosticPreferences>;

        return {
            collectionEnabled: parsed.collectionEnabled !== false,
            overlayEnabled: parsed.overlayEnabled === true
        };
    } catch {
        return DEFAULT_PREFERENCES;
    }
}

export function setPtvDiagnosticPreferences(
    changes: Partial<PtvDiagnosticPreferences>
): PtvDiagnosticPreferences {
    const next = {
        ...getPtvDiagnosticPreferences(),
        ...changes
    };

    try {
        getStorage()?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // Preference persistence is optional. The current document still receives the change.
    }

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
    }

    return next;
}

export function subscribePtvDiagnosticPreferences(
    listener: (preferences: PtvDiagnosticPreferences) => void
) {
    if (typeof window === 'undefined') return () => undefined;

    const handleChange = (event: Event) => {
        listener((event as CustomEvent<PtvDiagnosticPreferences>).detail);
    };
    const handleStorage = (event: StorageEvent) => {
        if (event.key === STORAGE_KEY) listener(getPtvDiagnosticPreferences());
    };

    window.addEventListener(CHANGE_EVENT, handleChange);
    window.addEventListener('storage', handleStorage);

    return () => {
        window.removeEventListener(CHANGE_EVENT, handleChange);
        window.removeEventListener('storage', handleStorage);
    };
}

export function resetPtvDiagnosticPreferencesForTests() {
    try {
        getStorage()?.removeItem(STORAGE_KEY);
    } catch {
        // Storage can be unavailable in privacy-restricted browsers.
    }
}
