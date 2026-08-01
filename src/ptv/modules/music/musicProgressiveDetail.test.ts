import { describe, expect, it, vi } from 'vitest';

import { loadPtvProgressiveMusicDetail } from './musicProgressiveDetail';

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });

    return {
        promise,
        reject,
        resolve
    };
}

describe('progressive Music detail loading', () => {
    it('publishes primary metadata without waiting for tracks', async () => {
        const item = createDeferred<{ Id: string }>();
        const tracks = createDeferred<Array<{ Id: string }>>();
        const onItem = vi.fn();
        const onTracks = vi.fn();
        const work = loadPtvProgressiveMusicDetail({
            isCurrent: () => true,
            loadItem: () => item.promise,
            loadTracks: () => tracks.promise,
            onItem,
            onItemError: vi.fn(),
            onTracks,
            onTracksError: vi.fn()
        });

        item.resolve({ Id: 'album-1' });
        await Promise.resolve();

        expect(onItem).toHaveBeenCalledWith({ Id: 'album-1' });
        expect(onTracks).not.toHaveBeenCalled();

        tracks.resolve([{ Id: 'track-1' }]);
        await work;

        expect(onTracks).toHaveBeenCalledWith([{ Id: 'track-1' }]);
    });

    it('rejects every late commit after the owning route retires', async () => {
        const item = createDeferred<{ Id: string }>();
        const tracks = createDeferred<Array<{ Id: string }>>();
        const onItem = vi.fn();
        const onTracks = vi.fn();
        let isCurrent = true;
        const work = loadPtvProgressiveMusicDetail({
            isCurrent: () => isCurrent,
            loadItem: () => item.promise,
            loadTracks: () => tracks.promise,
            onItem,
            onItemError: vi.fn(),
            onTracks,
            onTracksError: vi.fn()
        });

        isCurrent = false;
        item.resolve({ Id: 'retired-album' });
        tracks.resolve([{ Id: 'retired-track' }]);
        await work;

        expect(onItem).not.toHaveBeenCalled();
        expect(onTracks).not.toHaveBeenCalled();
    });

    it('keeps track failure independent from successful primary metadata', async () => {
        const onItem = vi.fn();
        const onItemError = vi.fn();
        const onTracksError = vi.fn();

        await loadPtvProgressiveMusicDetail({
            isCurrent: () => true,
            loadItem: () => Promise.resolve({ Id: 'playlist-1' }),
            loadTracks: () => Promise.reject(new Error('tracks unavailable')),
            onItem,
            onItemError,
            onTracks: vi.fn(),
            onTracksError
        });

        expect(onItem).toHaveBeenCalledWith({ Id: 'playlist-1' });
        expect(onItemError).not.toHaveBeenCalled();
        expect(onTracksError).toHaveBeenCalledWith(expect.objectContaining({
            message: 'tracks unavailable'
        }));
    });
});
