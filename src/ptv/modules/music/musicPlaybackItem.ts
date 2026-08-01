import type { PtvMusicItem } from './musicTypes';

const NON_TRACK_MUSIC_TYPES = new Set([
    'musicalbum',
    'musicartist',
    'musicgenre',
    'playlist'
]);

export function isPlayablePtvMusicTrack(item: PtvMusicItem | null | undefined) {
    if (!item?.Id) return false;

    const itemType = String(item.Type || '').toLowerCase();
    const mediaType = String(item.MediaType || '').toLowerCase();

    if (NON_TRACK_MUSIC_TYPES.has(itemType)) return false;

    return itemType === 'audio' || mediaType === 'audio';
}
