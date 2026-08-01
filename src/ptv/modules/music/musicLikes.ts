import {
    getPtvCurrentUserId,
    getPtvServerId,
    setPtvFavorite
} from '../../api';
import { recordPtvEvent } from '../../core/observability';
import {
    readPtvLocalStorageJson,
    writePtvLocalStorageJson
} from '../../services/runtimeStability';

import type { PtvMusicItem } from './musicTypes';
import { updatePtvMusicQueueItemUserData } from './musicQueue';

type PtvLikedMusicEntry = {
    item: PtvMusicItem;
    likedAt: number;
};

type PtvLikedMusicPayload = {
    items: PtvLikedMusicEntry[];
    version: 2;
};

type PtvLikedMusicListener = (items: PtvMusicItem[]) => void;

const LIKED_MUSIC_STORAGE_PREFIX = 'ptv.music.liked.v2';
const MAX_STORED_LIKED_SONGS = 200;
const listeners = new Set<PtvLikedMusicListener>();

function getLikedMusicStorageKey() {
    return [
        LIKED_MUSIC_STORAGE_PREFIX,
        getPtvServerId() || 'server',
        getPtvCurrentUserId() || 'user'
    ].join(':');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object';
}

function isPtvLikedMusicEntry(value: unknown): value is PtvLikedMusicEntry {
    return isRecord(value)
        && isRecord(value.item)
        && typeof value.item.Id === 'string'
        && typeof value.likedAt === 'number';
}

function compactLikedMusicItem(item: PtvMusicItem): PtvMusicItem {
    return {
        Album: item.Album,
        AlbumArtist: item.AlbumArtist,
        AlbumArtists: item.AlbumArtists,
        AlbumId: item.AlbumId,
        AlbumPrimaryImageItemId: item.AlbumPrimaryImageItemId,
        AlbumPrimaryImageTag: item.AlbumPrimaryImageTag,
        Artist: item.Artist,
        ArtistItems: item.ArtistItems,
        Artists: item.Artists,
        BackdropImageTags: item.BackdropImageTags,
        Container: item.Container,
        DateCreated: item.DateCreated,
        Id: item.Id,
        ImageTags: item.ImageTags,
        IndexNumber: item.IndexNumber,
        MediaType: item.MediaType,
        Name: item.Name,
        ParentIndexNumber: item.ParentIndexNumber,
        ParentPrimaryImageItemId: item.ParentPrimaryImageItemId,
        ParentPrimaryImageTag: item.ParentPrimaryImageTag,
        ProductionYear: item.ProductionYear,
        RunTimeTicks: item.RunTimeTicks,
        ServerId: item.ServerId,
        SortName: item.SortName,
        Type: item.Type,
        UserData: {
            ...(item.UserData || {}),
            IsFavorite: true
        }
    };
}

function getStoredLikedMusicEntries() {
    const payload = readPtvLocalStorageJson<Partial<PtvLikedMusicPayload>>(getLikedMusicStorageKey(), {});

    return Array.isArray(payload.items) ? payload.items.filter(isPtvLikedMusicEntry) : [];
}

function writeStoredLikedMusicEntries(entries: PtvLikedMusicEntry[]) {
    const payload: PtvLikedMusicPayload = {
        items: entries
            .filter(entry => Boolean(entry.item.Id))
            .map(entry => ({
                item: compactLikedMusicItem(entry.item),
                likedAt: entry.likedAt
            }))
            .sort((left, right) => right.likedAt - left.likedAt)
            .slice(0, MAX_STORED_LIKED_SONGS),
        version: 2
    };

    const stored = writePtvLocalStorageJson(getLikedMusicStorageKey(), payload, {
        maxBytes: 96_000,
        namespace: 'music-liked'
    });

    if (!stored) {
        recordPtvEvent('render', 'music-liked-storage-failed', {
            reason: 'safe-storage-rejected'
        });
    }
}

function emitLikedMusicUpdated() {
    const items = getPtvLikedMusicItems();

    listeners.forEach(listener => {
        listener(items);
    });

    return items;
}

function withFavoriteUserData(item: PtvMusicItem, isFavorite: boolean): PtvMusicItem {
    return {
        ...item,
        UserData: {
            ...(item.UserData || {}),
            IsFavorite: isFavorite
        }
    };
}

function uniqueLikedEntries(entries: PtvLikedMusicEntry[]) {
    const seen = new Set<string>();
    const uniqueEntries: PtvLikedMusicEntry[] = [];

    entries
        .filter(entry => Boolean(entry.item.Id))
        .sort((left, right) => right.likedAt - left.likedAt)
        .forEach(entry => {
            const id = entry.item.Id || '';

            if (!id || seen.has(id)) return;

            seen.add(id);
            uniqueEntries.push(entry);
        });

    return uniqueEntries;
}

export function getPtvLikedMusicItems(): PtvMusicItem[] {
    return getStoredLikedMusicEntries()
        .map(entry => withFavoriteUserData(entry.item, true));
}

export function getPtvLikedMusicItemIds(): Set<string> {
    return new Set(getPtvLikedMusicItems()
        .map(item => item.Id)
        .filter((id): id is string => Boolean(id)));
}

export function isPtvMusicItemLiked(item: PtvMusicItem | null | undefined) {
    if (!item?.Id) return false;
    if (item.UserData?.IsFavorite) return true;

    return getPtvLikedMusicItemIds().has(item.Id);
}

export function mergePtvLikedMusicItems(items: PtvMusicItem[]) {
    const likedItems = items
        .filter(item => Boolean(item.Id))
        .map(item => ({
            item: withFavoriteUserData(item, true),
            likedAt: Date.now()
        }));

    if (!likedItems.length) return getPtvLikedMusicItems();

    writeStoredLikedMusicEntries(uniqueLikedEntries([
        ...likedItems,
        ...getStoredLikedMusicEntries()
    ]));

    recordPtvEvent('recommendation', 'music-liked-songs-merged', {
        count: likedItems.length
    });

    return emitLikedMusicUpdated();
}

export function subscribeToPtvLikedMusic(listener: PtvLikedMusicListener) {
    listeners.add(listener);
    listener(getPtvLikedMusicItems());

    return () => {
        listeners.delete(listener);
    };
}

export async function setPtvMusicItemLiked(item: PtvMusicItem, liked: boolean) {
    if (!item.Id) {
        throw new Error('Cannot like a music item without an Id.');
    }

    const previousEntries = getStoredLikedMusicEntries();
    const nextEntries = liked ?
        uniqueLikedEntries([
            {
                item: withFavoriteUserData(item, true),
                likedAt: Date.now()
            },
            ...previousEntries
        ]) :
        previousEntries.filter(entry => entry.item.Id !== item.Id);

    writeStoredLikedMusicEntries(nextEntries);
    emitLikedMusicUpdated();
    updatePtvMusicQueueItemUserData(item.Id, {
        ...(item.UserData || {}),
        IsFavorite: liked
    });

    try {
        await setPtvFavorite(item.Id, liked, {
            serverId: item.ServerId || getPtvServerId()
        });

        recordPtvEvent('render', 'music-liked-song-updated', {
            itemId: item.Id,
            liked
        });

        return getPtvLikedMusicItems();
    } catch (error) {
        writeStoredLikedMusicEntries(previousEntries);
        emitLikedMusicUpdated();
        updatePtvMusicQueueItemUserData(item.Id, item.UserData);
        recordPtvEvent('render', 'music-liked-song-failed', {
            error: error instanceof Error ? error.message : String(error),
            itemId: item.Id,
            liked
        });

        throw error;
    }
}
