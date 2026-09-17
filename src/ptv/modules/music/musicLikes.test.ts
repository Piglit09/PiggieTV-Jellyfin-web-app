import { beforeEach, describe, expect, it, vi } from 'vitest';

const likesMocks = vi.hoisted(() => ({
    currentUserId: 'user-a',
    recordPtvEvent: vi.fn(),
    serverId: 'server-a',
    setPtvFavorite: vi.fn(),
    storage: new Map<string, unknown>(),
    updatePtvMusicQueueItemUserData: vi.fn()
}));

vi.mock('../../api', () => ({
    getPtvCurrentUserId: () => likesMocks.currentUserId,
    getPtvServerId: () => likesMocks.serverId,
    setPtvFavorite: likesMocks.setPtvFavorite
}));

vi.mock('../../core/observability', () => ({
    recordPtvEvent: likesMocks.recordPtvEvent
}));

vi.mock('../../services/runtimeStability', () => ({
    readPtvLocalStorageJson: <T>(key: string, fallback: T): T => (
        likesMocks.storage.has(key) ? likesMocks.storage.get(key) as T : fallback
    ),
    writePtvLocalStorageJson: (key: string, value: unknown) => {
        likesMocks.storage.set(key, value);
        return true;
    }
}));

vi.mock('./musicQueue', () => ({
    updatePtvMusicQueueItemUserData: likesMocks.updatePtvMusicQueueItemUserData
}));

import {
    getPtvLikedMusicItems,
    mergePtvLikedMusicItems,
    reconcilePtvLikedMusicIdentifyMetadata,
    setPtvMusicItemLiked,
    subscribeToPtvLikedMusic
} from './musicLikes';
import type { PtvMusicItem } from './musicTypes';

function deferredRequest() {
    let reject!: (reason?: unknown) => void;
    let resolve!: () => void;
    const promise = new Promise<void>((requestResolve, requestReject) => {
        reject = requestReject;
        resolve = requestResolve;
    });

    return { promise, reject, resolve };
}

function track(
    id: string,
    overrides: Partial<PtvMusicItem> = {}
): PtvMusicItem {
    return {
        Album: 'Old Album',
        AlbumId: 'album-1',
        Artist: 'Old Artist',
        ArtistItems: [ { Id: 'artist-1', Name: 'Old Artist' } ],
        Artists: [ 'Old Artist' ],
        Id: id,
        Name: `Track ${id}`,
        ServerId: 'server-a',
        Type: 'Audio',
        UserData: {
            IsFavorite: true,
            PlaybackPositionTicks: 12_345
        },
        ...overrides
    };
}

function likedItemsById() {
    return new Map(getPtvLikedMusicItems().map(item => [ item.Id, item ]));
}

describe('PTV Music liked rollback and Identify reconciliation', () => {
    beforeEach(() => {
        likesMocks.currentUserId = 'user-a';
        likesMocks.storage.clear();
        likesMocks.serverId = 'server-a';
        likesMocks.recordPtvEvent.mockReset();
        likesMocks.setPtvFavorite.mockReset();
        likesMocks.updatePtvMusicQueueItemUserData.mockReset();
    });

    it('rolls back a rejected pending like without discarding confirmed Artist presentation', async () => {
        const request = deferredRequest();
        const target = track('target-like', {
            UserData: { IsFavorite: false, PlaybackPositionTicks: 77 }
        });
        const related = track('related-artist');
        const unrelated = track('unrelated', {
            Album: 'Other Album',
            AlbumId: 'album-2',
            Artist: 'Other Artist',
            ArtistItems: [ { Id: 'artist-2', Name: 'Other Artist' } ],
            Artists: [ 'Other Artist' ]
        });

        mergePtvLikedMusicItems([ related, unrelated ]);
        likesMocks.setPtvFavorite.mockReturnValueOnce(request.promise);

        const mutation = setPtvMusicItemLiked(target, true);

        reconcilePtvLikedMusicIdentifyMetadata({
            Id: 'artist-1',
            Name: 'Confirmed Artist',
            Type: 'MusicArtist'
        });
        request.reject(new Error('server rejected favorite'));

        await expect(mutation).rejects.toThrow('server rejected favorite');

        const liked = likedItemsById();

        expect(liked.has(target.Id)).toBe(false);
        expect(liked.get(related.Id)).toMatchObject({
            Artist: 'Confirmed Artist',
            ArtistItems: [ { Id: 'artist-1', Name: 'Confirmed Artist' } ],
            Artists: [ 'Confirmed Artist' ],
            UserData: { IsFavorite: true }
        });
        expect(liked.get(unrelated.Id)).toMatchObject({
            Album: 'Other Album',
            Artist: 'Other Artist',
            UserData: { IsFavorite: true }
        });
        expect(likesMocks.updatePtvMusicQueueItemUserData).toHaveBeenLastCalledWith(
            target.Id,
            target.UserData
        );
    });

    it('restores a rejected pending unlike with confirmed Album presentation and current liked entries', async () => {
        const request = deferredRequest();
        const target = track('target-unlike');
        const related = track('related-album');
        const unrelated = track('unrelated', {
            Album: 'Other Album',
            AlbumId: 'album-2'
        });

        mergePtvLikedMusicItems([ target, related, unrelated ]);
        likesMocks.setPtvFavorite.mockReturnValueOnce(request.promise);

        const mutation = setPtvMusicItemLiked(target, false);

        reconcilePtvLikedMusicIdentifyMetadata({
            AlbumArtist: 'Confirmed Artist',
            AlbumArtists: [ { Id: 'artist-1', Name: 'Confirmed Artist' } ],
            Id: 'album-1',
            ImageTags: { Primary: 'confirmed-image-tag' },
            Name: 'Confirmed Album',
            Type: 'MusicAlbum'
        });
        request.reject(new Error('server rejected unfavorite'));

        await expect(mutation).rejects.toThrow('server rejected unfavorite');

        const liked = likedItemsById();

        expect(liked.get(target.Id)).toMatchObject({
            Album: 'Confirmed Album',
            AlbumArtist: 'Confirmed Artist',
            AlbumPrimaryImageItemId: 'album-1',
            AlbumPrimaryImageTag: 'confirmed-image-tag',
            UserData: {
                IsFavorite: true,
                PlaybackPositionTicks: 12_345
            }
        });
        expect(liked.get(related.Id)).toMatchObject({
            Album: 'Confirmed Album',
            AlbumPrimaryImageTag: 'confirmed-image-tag',
            UserData: { IsFavorite: true }
        });
        expect(liked.get(unrelated.Id)).toMatchObject({
            Album: 'Other Album',
            UserData: { IsFavorite: true }
        });
        expect(likesMocks.updatePtvMusicQueueItemUserData).toHaveBeenLastCalledWith(
            target.Id,
            target.UserData
        );
    });

    it('contains a late rollback to its captured identity after the active user changes', async () => {
        const request = deferredRequest();
        const listener = vi.fn();
        const target = track('identity-a-target');

        mergePtvLikedMusicItems([ target ]);
        const unsubscribe = subscribeToPtvLikedMusic(listener);
        likesMocks.setPtvFavorite.mockReturnValueOnce(request.promise);

        const mutation = setPtvMusicItemLiked(target, false);

        likesMocks.currentUserId = 'user-b';
        const identityBItem = track('identity-b-liked', {
            Album: 'Identity B Album',
            AlbumId: 'album-b',
            ServerId: 'server-a'
        });

        mergePtvLikedMusicItems([ identityBItem ]);
        reconcilePtvLikedMusicIdentifyMetadata({
            Id: 'album-1',
            Name: 'Confirmed Identity A Album',
            Type: 'MusicAlbum'
        });

        const listenerCallsBeforeRejection = listener.mock.calls.length;
        const queueCallsBeforeRejection = likesMocks.updatePtvMusicQueueItemUserData.mock.calls.length;

        request.reject(new Error('late identity-a rejection'));
        await expect(mutation).rejects.toThrow('late identity-a rejection');

        expect(getPtvLikedMusicItems()).toMatchObject([ {
            Album: 'Identity B Album',
            Id: identityBItem.Id,
            UserData: { IsFavorite: true }
        } ]);
        expect(listener).toHaveBeenCalledTimes(listenerCallsBeforeRejection);
        expect(likesMocks.updatePtvMusicQueueItemUserData)
            .toHaveBeenCalledTimes(queueCallsBeforeRejection);

        likesMocks.currentUserId = 'user-a';
        expect(getPtvLikedMusicItems()).toMatchObject([ {
            Album: 'Old Album',
            Id: target.Id,
            UserData: { IsFavorite: true }
        } ]);

        unsubscribe();
    });
});
