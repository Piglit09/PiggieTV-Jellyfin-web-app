import { describe, expect, it } from 'vitest';

import {
    beginStreamChange,
    completeStreamChange,
    invalidateStreamChanges,
    isCurrentStreamChange,
    runStreamChangePlay,
    waitForStreamChangePlays
} from './streamChangeGuard';

function createDeferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(promiseResolve => {
        resolve = promiseResolve;
    });

    return { promise, resolve };
}

describe('stream change guard', () => {
    it('allocates monotonic generations independently for each player', () => {
        const videoPlayer = {};
        const audioPlayer = {};

        const firstVideoChange = beginStreamChange(videoPlayer);
        const audioChange = beginStreamChange(audioPlayer);
        const secondVideoChange = beginStreamChange(videoPlayer);

        expect(secondVideoChange).toBeGreaterThan(firstVideoChange);
        expect(audioChange).toBe(firstVideoChange);
        expect(isCurrentStreamChange(videoPlayer, firstVideoChange)).toBe(false);
        expect(isCurrentStreamChange(videoPlayer, secondVideoChange)).toBe(true);
        expect(isCurrentStreamChange(audioPlayer, audioChange)).toBe(true);
    });

    it('allows only the newest generation to clear a pending replacement', () => {
        const player = { isChangingStream: false };
        const retiredChange = beginStreamChange(player);
        const activeChange = beginStreamChange(player);

        expect(player.isChangingStream).toBe(true);
        expect(completeStreamChange(player, retiredChange)).toBe(false);
        expect(player.isChangingStream).toBe(true);

        expect(completeStreamChange(player, activeChange)).toBe(true);
        expect(player.isChangingStream).toBe(false);
        expect(completeStreamChange(player, activeChange)).toBe(false);
    });

    it('invalidates a pending replacement when ordinary playback takes ownership', () => {
        const player = { isChangingStream: false };
        const retiredChange = beginStreamChange(player);
        const playbackGeneration = invalidateStreamChanges(player);

        expect(playbackGeneration).toBeGreaterThan(retiredChange);
        expect(isCurrentStreamChange(player, retiredChange)).toBe(false);
        expect(completeStreamChange(player, retiredChange)).toBe(false);
        expect(player.isChangingStream).toBe(false);
    });

    it('retires an older dispatched play before the latest generation starts', async () => {
        const player = { isChangingStream: false };
        const firstPlayFinished = createDeferred();
        const secondPlayFinished = createDeferred();
        const events: string[] = [];
        let physicalSource: string | null = null;
        let firstRetireCount = 0;

        const firstGeneration = beginStreamChange(player);
        const firstPlay = runStreamChangePlay(player, firstGeneration, async () => {
            events.push('first:start');
            await firstPlayFinished.promise;
            physicalSource = 'first';
        }, async () => {
            firstRetireCount += 1;
            physicalSource = null;
        });

        await Promise.resolve();
        expect(events).toEqual(['first:start']);

        const secondGeneration = beginStreamChange(player);
        const secondPlay = runStreamChangePlay(player, secondGeneration, async () => {
            events.push('second:start');
            await secondPlayFinished.promise;
            physicalSource = 'second';
        }, async () => {
            events.push('second:retire');
            physicalSource = null;
        });

        firstPlayFinished.resolve();
        await expect(firstPlay).resolves.toBe(false);
        await Promise.resolve();

        expect(events).toEqual(['first:start', 'second:start']);
        expect(firstRetireCount).toBe(2);
        expect(physicalSource).toBeNull();

        secondPlayFinished.resolve();
        await expect(secondPlay).resolves.toBe(true);
        expect(physicalSource).toBe('second');
    });

    it('neutralizes a dispatched play after stop invalidates its generation', async () => {
        const player = { isChangingStream: false };
        const playFinished = createDeferred();
        let physicalSource: string | null = null;
        let retireCount = 0;

        const generation = beginStreamChange(player);
        const play = runStreamChangePlay(player, generation, async () => {
            await playFinished.promise;
            physicalSource = 'retired';
        }, async () => {
            retireCount += 1;
            physicalSource = null;
            playFinished.resolve();
        });

        await Promise.resolve();
        const stopGeneration = invalidateStreamChanges(player);
        const drained = waitForStreamChangePlays(player);

        await expect(play).resolves.toBe(false);
        await drained;

        expect(isCurrentStreamChange(player, stopGeneration)).toBe(true);
        expect(retireCount).toBe(2);
        expect(physicalSource).toBeNull();
    });
});
