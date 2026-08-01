import {
    resolveNotoFontProfile,
    type NotoFontProfile
} from './notoFontProfile';

export type AppliedNotoFontProfile = NotoFontProfile | 'base';

interface NotoFontLoaderOptions {
    getLocale: () => string | null | undefined;
    loadBase: () => Promise<unknown>;
    loadLocale: (profile: NotoFontProfile) => Promise<unknown>;
    applyProfile: (profile: AppliedNotoFontProfile) => void;
    onError?: (error: unknown) => void;
}

/**
 * Coordinates lazy Noto CSS loading across live culture changes.
 *
 * Only fulfilled imports are cached so a transient chunk failure can be
 * retried. A generation guard prevents a slower, stale culture import from
 * replacing the profile selected by a newer language change.
 */
export function createNotoFontLoader(options: NotoFontLoaderOptions) {
    let generation = 0;
    let baseLoaded = false;
    let basePending: Promise<void> | null = null;
    const loadedLocales = new Set<NotoFontProfile>();
    const pendingLocales = new Map<NotoFontProfile, Promise<void>>();

    const ensureBase = async () => {
        if (baseLoaded) return;

        if (!basePending) {
            basePending = Promise.resolve()
                .then(options.loadBase)
                .then(() => {
                    baseLoaded = true;
                });
        }

        try {
            await basePending;
        } finally {
            if (!baseLoaded) {
                basePending = null;
            }
        }
    };

    const ensureLocale = async (profile: NotoFontProfile) => {
        if (loadedLocales.has(profile)) return;

        let pending = pendingLocales.get(profile);
        if (!pending) {
            pending = Promise.resolve()
                .then(() => options.loadLocale(profile))
                .then(() => {
                    loadedLocales.add(profile);
                });
            pendingLocales.set(profile, pending);
        }

        try {
            await pending;
        } finally {
            if (!loadedLocales.has(profile)) {
                pendingLocales.delete(profile);
            }
        }
    };

    return async () => {
        const requestGeneration = ++generation;
        const profile = resolveNotoFontProfile(options.getLocale());

        try {
            await ensureBase();
            if (profile) {
                await ensureLocale(profile);
            }

            if (requestGeneration !== generation) return false;

            options.applyProfile(profile || 'base');
            return true;
        } catch (error) {
            if (requestGeneration === generation) {
                options.onError?.(error);
            }
            return false;
        }
    };
}
