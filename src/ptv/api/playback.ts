import { playbackManager } from 'components/playback/playbackmanager';

import {
    getPtvCurrentUserId,
    sendPtvJson
} from './client';
import type { PtvPlaybackActionOptions } from './types';

export function playPtvItems(options: PtvPlaybackActionOptions): Promise<unknown> {
    if (!options.ids.length) {
        return Promise.resolve();
    }

    return playbackManager.play({
        ids: options.ids,
        serverId: options.serverId || undefined,
        startPositionTicks: options.startPositionTicks || 0
    });
}

export function playPtvItem(itemId: string, options: {
    serverId?: string | null;
    startPositionTicks?: number;
} = {}): Promise<unknown> {
    return playPtvItems({
        ids: [itemId],
        serverId: options.serverId,
        startPositionTicks: options.startPositionTicks
    });
}

export function queuePtvItems(options: PtvPlaybackActionOptions): Promise<unknown> {
    if (!options.ids.length || typeof playbackManager.queue !== 'function') {
        return Promise.resolve();
    }

    return playbackManager.queue({
        ids: options.ids,
        serverId: options.serverId || undefined,
        startPositionTicks: options.startPositionTicks || 0
    });
}

export function shufflePtvItems(options: Omit<PtvPlaybackActionOptions, 'ids'> & {
    itemId: string;
}): Promise<unknown> {
    if (typeof playbackManager.shuffle !== 'function') {
        return playPtvItem(options.itemId, options);
    }

    return playbackManager.shuffle({
        id: options.itemId,
        serverId: options.serverId || undefined
    });
}

export function setPtvFavorite(
    itemId: string,
    isFavorite: boolean,
    options: {
        serverId?: string | null;
        userId?: string | null;
    } = {}
): Promise<unknown> {
    const userId = options.userId || getPtvCurrentUserId(options.serverId);

    if (!userId) {
        return Promise.reject(new Error('A signed-in Jellyfin user is required.'));
    }

    return sendPtvJson(`Users/${userId}/FavoriteItems/${itemId}`, null, {
        method: isFavorite ? 'POST' : 'DELETE',
        serverId: options.serverId
    });
}

export function setPtvPlayed(
    itemId: string,
    played: boolean,
    options: {
        serverId?: string | null;
        userId?: string | null;
    } = {}
): Promise<unknown> {
    const userId = options.userId || getPtvCurrentUserId(options.serverId);

    if (!userId) {
        return Promise.reject(new Error('A signed-in Jellyfin user is required.'));
    }

    return sendPtvJson(`Users/${userId}/PlayedItems/${itemId}`, null, {
        method: played ? 'POST' : 'DELETE',
        serverId: options.serverId
    });
}

export function getPtvCurrentPlaybackState(): unknown {
    const player = playbackManager.getCurrentPlayer?.();

    return player ? playbackManager.getPlayerState?.(player) || null : null;
}

