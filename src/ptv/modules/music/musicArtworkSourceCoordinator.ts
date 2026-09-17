export type PtvMusicArtworkSourceStatus = 'failed' | 'loaded' | 'loading';

type PtvMusicArtworkSourceEntry = {
    expiresAt: number;
    promise: Promise<boolean>;
    status: PtvMusicArtworkSourceStatus;
};

const PTV_MUSIC_ARTWORK_SOURCE_LIMIT = 512;
const PTV_MUSIC_ARTWORK_FAILURE_TTL_MS = 5 * 60 * 1000;
const artworkSources = new Map<string, PtvMusicArtworkSourceEntry>();

function touchArtworkSource(url: string, entry: PtvMusicArtworkSourceEntry) {
    artworkSources.delete(url);
    artworkSources.set(url, entry);

    while (artworkSources.size > PTV_MUSIC_ARTWORK_SOURCE_LIMIT) {
        const oldest = artworkSources.keys().next().value;

        if (typeof oldest !== 'string') break;
        artworkSources.delete(oldest);
    }
}

function getArtworkSource(url: string) {
    const entry = artworkSources.get(url);

    if (!entry) return null;
    if (entry.status === 'failed' && entry.expiresAt <= Date.now()) {
        artworkSources.delete(url);
        return null;
    }

    touchArtworkSource(url, entry);
    return entry;
}

function createBrowserImageLoad(url: string) {
    return new Promise<boolean>(resolve => {
        const image = new Image();

        image.decoding = 'async';
        image.onload = () => resolve(true);
        image.onerror = () => resolve(false);
        image.src = url;
    });
}

/**
 * Gives one detached image loader ownership of a URL while every visible card
 * joins the same promise. The real URL is only assigned to card DOM after that
 * shared owner succeeds, so a known-bad generation cannot fan out across rows.
 */
export function loadPtvMusicArtworkSource(
    url: string,
    onFirstFailure?: (url: string) => void
) {
    const normalizedUrl = String(url || '').trim();

    if (!normalizedUrl) return Promise.resolve(false);

    const existing = getArtworkSource(normalizedUrl);

    if (existing) return existing.promise;

    const entry: PtvMusicArtworkSourceEntry = {
        expiresAt: Number.POSITIVE_INFINITY,
        promise: Promise.resolve(false),
        status: 'loading'
    };
    const promise = createBrowserImageLoad(normalizedUrl).then(loaded => {
        entry.status = loaded ? 'loaded' : 'failed';
        entry.expiresAt = loaded ? Number.POSITIVE_INFINITY : Date.now() + PTV_MUSIC_ARTWORK_FAILURE_TTL_MS;
        touchArtworkSource(normalizedUrl, entry);

        if (!loaded) onFirstFailure?.(normalizedUrl);
        return loaded;
    });

    entry.promise = promise;
    touchArtworkSource(normalizedUrl, entry);
    return promise;
}

export function markPtvMusicArtworkSourceFailed(
    url: string,
    onFirstFailure?: (url: string) => void
) {
    const normalizedUrl = String(url || '').trim();
    const existing = normalizedUrl ? getArtworkSource(normalizedUrl) : null;

    if (!normalizedUrl || existing?.status === 'failed') return false;

    const entry: PtvMusicArtworkSourceEntry = {
        expiresAt: Date.now() + PTV_MUSIC_ARTWORK_FAILURE_TTL_MS,
        promise: Promise.resolve(false),
        status: 'failed'
    };

    touchArtworkSource(normalizedUrl, entry);
    onFirstFailure?.(normalizedUrl);
    return true;
}

export function resetPtvMusicArtworkSourceCoordinatorForTests() {
    artworkSources.clear();
}
