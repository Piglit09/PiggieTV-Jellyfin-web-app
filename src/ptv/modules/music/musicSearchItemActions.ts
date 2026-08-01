import type { PtvItem } from '../../api';
import type { PtvItemActionMenuCommand } from '../cards/itemActionMenu';

import type { PtvMusicItem, PtvMusicSeedKind } from './musicTypes';

export const PTV_MUSIC_SEARCH_ACTION_IDS = {
    addToQueue: 'ptv-music:add-to-queue',
    play: 'ptv-music:play',
    playNext: 'ptv-music:play-next',
    startMix: 'ptv-music:start-mix'
} as const;

type PtvMusicSearchActionId = typeof PTV_MUSIC_SEARCH_ACTION_IDS[keyof typeof PTV_MUSIC_SEARCH_ACTION_IDS];

export type PtvMusicSearchActionMenuExtension = Readonly<{
    extraCommands: readonly PtvItemActionMenuCommand[];
    instantMix: false;
    onExtraCommand: (commandId: string, item: PtvItem) => Promise<unknown>;
    play: false;
    queue: false;
    shuffle: false;
}>;

function getMusicItemType(item: PtvItem) {
    return String(item.Type || '').trim();
}

function isPlayableMusicTrack(item: PtvItem) {
    return Boolean(item.Id)
        && getMusicItemType(item) === 'Audio';
}

function supportsMusicMix(item: PtvItem) {
    return Boolean(item.Id) && [
        'Audio',
        'MusicAlbum',
        'MusicArtist',
        'MusicGenre'
    ].includes(getMusicItemType(item));
}

function isMusicSearchItem(item: PtvItem) {
    return isPlayableMusicTrack(item) || supportsMusicMix(item);
}

function getMusicMixSeedKind(item: PtvItem): PtvMusicSeedKind {
    switch (getMusicItemType(item)) {
        case 'MusicAlbum':
            return 'album';
        case 'MusicArtist':
            return 'artist';
        case 'MusicGenre':
            return 'genre';
        default:
            return 'song';
    }
}

export function getPtvMusicSearchActionCommands(item: PtvItem): readonly PtvItemActionMenuCommand[] {
    if (!isMusicSearchItem(item)) return [];

    const commands: PtvItemActionMenuCommand[] = [];

    if (isPlayableMusicTrack(item)) {
        commands.push(
            {
                icon: 'play_arrow',
                id: PTV_MUSIC_SEARCH_ACTION_IDS.play,
                name: 'Play'
            },
            {
                icon: 'playlist_add',
                id: PTV_MUSIC_SEARCH_ACTION_IDS.playNext,
                name: 'Play Next'
            },
            {
                icon: 'playlist_add',
                id: PTV_MUSIC_SEARCH_ACTION_IDS.addToQueue,
                name: 'Add to Queue'
            }
        );
    }

    if (supportsMusicMix(item)) {
        commands.push({
            icon: 'explore',
            id: PTV_MUSIC_SEARCH_ACTION_IDS.startMix,
            name: 'Start Mix'
        });
    }

    return commands;
}

function assertAvailableMusicSearchAction(commandId: string, item: PtvItem): asserts commandId is PtvMusicSearchActionId {
    const availableCommandIds = new Set(getPtvMusicSearchActionCommands(item).map(command => command.id));

    if (!availableCommandIds.has(commandId)) {
        throw new Error('Unsupported PiggieTV Music search action.');
    }
}

export async function dispatchPtvMusicSearchAction(commandId: string, item: PtvItem) {
    assertAvailableMusicSearchAction(commandId, item);
    const musicItem = item as PtvMusicItem;

    switch (commandId) {
        case PTV_MUSIC_SEARCH_ACTION_IDS.play: {
            const { playPtvMusicTracks } = await import('./musicQueue');

            return playPtvMusicTracks([musicItem], 0, {
                rejectOnPlaybackError: true
            });
        }
        case PTV_MUSIC_SEARCH_ACTION_IDS.playNext: {
            const { playPtvMusicNext } = await import('./musicQueue');

            return playPtvMusicNext(musicItem);
        }
        case PTV_MUSIC_SEARCH_ACTION_IDS.addToQueue: {
            const { addPtvMusicToQueue } = await import('./musicQueue');

            return addPtvMusicToQueue(musicItem);
        }
        case PTV_MUSIC_SEARCH_ACTION_IDS.startMix: {
            const [
                { generatePtvMusicPlaylist },
                { playPtvMusicTracks }
            ] = await Promise.all([
                import('./musicPlaylists'),
                import('./musicQueue')
            ]);
            const title = String(item.Name || '').trim() || 'Music';
            const result = await generatePtvMusicPlaylist({
                seed: {
                    id: item.Id,
                    item: musicItem,
                    kind: getMusicMixSeedKind(item),
                    label: title,
                    value: title
                }
            });

            return playPtvMusicTracks(result.items, 0, {
                rejectOnPlaybackError: true
            });
        }
    }
}

export function getPtvMusicSearchActionMenuExtension(
    item: PtvItem
): PtvMusicSearchActionMenuExtension | undefined {
    const extraCommands = getPtvMusicSearchActionCommands(item);

    if (!extraCommands.length) return undefined;

    return {
        extraCommands,
        instantMix: false,
        onExtraCommand: dispatchPtvMusicSearchAction,
        play: false,
        queue: false,
        shuffle: false
    };
}
