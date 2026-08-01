import { playbackManager } from '../../../components/playback/playbackmanager';

type PtvReaderPlayOptions = {
    items: unknown[];
    serverId?: string;
    startPositionTicks?: number;
};

let readerLoadPromise: Promise<void> | null = null;

export function ensurePtvReaderLoaded(): Promise<void> {
    if (readerLoadPromise) return readerLoadPromise;

    readerLoadPromise = import(
        /* webpackChunkName: "ptv-reading" */ './index'
    )
        .then(({ ensurePtvReaderRegistration }) => ensurePtvReaderRegistration())
        .then(() => undefined)
        .catch(error => {
            readerLoadPromise = null;
            throw error;
        });

    return readerLoadPromise;
}

/**
 * Keeps every PTV reading activation behind the same player-registration
 * boundary. If the enhancement chunk is unavailable, Jellyfin's stock reader
 * remains a safe fallback.
 */
export async function playPtvReaderItem(options: PtvReaderPlayOptions): Promise<unknown> {
    try {
        await ensurePtvReaderLoaded();
    } catch {
        console.warn('[PiggieTV Reader] Enhanced reader unavailable; using the stock reader fallback');
    }

    return playbackManager.play(options);
}
