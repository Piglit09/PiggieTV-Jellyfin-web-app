export type PtvProgressiveMusicDetailOptions<TItem, TTrack> = Readonly<{
    isCurrent: () => boolean;
    loadItem: () => Promise<TItem>;
    loadTracks: () => Promise<TTrack[]>;
    onItem: (item: TItem) => void;
    onItemError: (error: unknown) => void;
    onTracks: (tracks: TTrack[]) => void;
    onTracksError: (error: unknown) => void;
}>;

/**
 * Loads primary metadata and its track collection independently. Each result
 * is guarded at commit time so a retired route cannot publish stale state.
 */
export async function loadPtvProgressiveMusicDetail<TItem, TTrack>(
    options: PtvProgressiveMusicDetailOptions<TItem, TTrack>
) {
    const itemWork = options.loadItem().then(item => {
        if (options.isCurrent()) {
            options.onItem(item);
        }
    }).catch(error => {
        if (options.isCurrent()) {
            options.onItemError(error);
        }
    });
    const trackWork = options.loadTracks().then(tracks => {
        if (options.isCurrent()) {
            options.onTracks(tracks);
        }
    }).catch(error => {
        if (options.isCurrent()) {
            options.onTracksError(error);
        }
    });

    await Promise.all([itemWork, trackWork]);
}
