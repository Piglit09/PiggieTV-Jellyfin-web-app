import type { PtvMusicItem, PtvMusicSeed } from './musicTypes';

export function buildPtvCollectionMixSeed(
    item: PtvMusicItem,
    kind: 'album' | 'playlist',
    label: string,
    tracks: PtvMusicItem[]
): PtvMusicSeed {
    if (kind === 'album') {
        return {
            id: item.Id,
            item,
            kind: 'album',
            label,
            value: label
        };
    }

    const firstTrack = tracks[0];

    if (firstTrack) {
        return {
            id: firstTrack.Id,
            item: firstTrack,
            kind: 'song',
            label,
            value: String(firstTrack.Name || firstTrack.SortName || '').trim()
        };
    }

    return {
        id: item.Id,
        item,
        kind: 'random',
        label,
        value: label
    };
}
