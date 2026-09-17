import { describe, expect, it, vi } from 'vitest';

import {
    beginPlaybackRequest,
    beginPlayerStart,
    cancelRetiredPlayerStart,
    clearRetiredPlayerState,
    completePlaybackRequest,
    completePlayerStart,
    isPlaybackStartAllowed,
    stopPlayerWithoutPlaybackEvents
} from './playbackStartGuard';

describe('playback start guard', () => {
    it('allows ordinary playback without a guard', () => {
        expect(isPlaybackStartAllowed({})).toBe(true);
    });

    it('honors an active playback request', () => {
        const guard = vi.fn(() => true);

        expect(isPlaybackStartAllowed({ playbackStartGuard: guard })).toBe(true);
        expect(guard).toHaveBeenCalledOnce();
    });

    it('cancels a retired playback request', () => {
        expect(isPlaybackStartAllowed({ playbackStartGuard: () => false })).toBe(false);
    });

    it('fails closed when a guard throws', () => {
        expect(isPlaybackStartAllowed({
            playbackStartGuard: () => {
                throw new Error('retired');
            }
        })).toBe(false);
    });

    it('gives an active user request priority over older and later background requests', () => {
        const manager = {};
        const olderTheme = { playbackStartGuard: () => true };
        const olderThemeRequest = beginPlaybackRequest(manager, olderTheme);
        const userPlayback = {};
        const userRequest = beginPlaybackRequest(manager, userPlayback);
        const laterTheme = { playbackStartGuard: () => true };

        expect(olderThemeRequest).not.toBeNull();
        expect(userRequest).not.toBeNull();
        expect(isPlaybackStartAllowed(olderTheme)).toBe(false);
        expect(isPlaybackStartAllowed(userPlayback)).toBe(true);
        expect(beginPlaybackRequest(manager, laterTheme)).toBeNull();
        expect(isPlaybackStartAllowed(userPlayback)).toBe(true);

        expect(completePlaybackRequest(manager, userRequest)).toBe(true);

        const nextThemeRequest = beginPlaybackRequest(manager, laterTheme);
        expect(nextThemeRequest).not.toBeNull();
        expect(isPlaybackStartAllowed(laterTheme)).toBe(true);
        expect(completePlaybackRequest(manager, nextThemeRequest)).toBe(true);
        expect(completePlaybackRequest(manager, olderThemeRequest)).toBe(false);
    });

    it('stops a retired player start without touching a different active player', async () => {
        const themePlayer = { stop: vi.fn().mockResolvedValue(undefined) };
        const userPlayer = { stop: vi.fn().mockResolvedValue(undefined) };
        const themeToken = beginPlayerStart(themePlayer);

        await expect(cancelRetiredPlayerStart(themePlayer, themeToken)).resolves.toBe(true);

        expect(themePlayer.stop).toHaveBeenCalledWith(false);
        expect(userPlayer.stop).not.toHaveBeenCalled();
    });

    it('does not stop a same-player request that superseded the retired start', async () => {
        const player = { stop: vi.fn().mockResolvedValue(undefined) };
        const retiredToken = beginPlayerStart(player, { guarded: true });
        const currentToken = beginPlayerStart(player);

        await expect(cancelRetiredPlayerStart(player, retiredToken)).resolves.toBe(false);

        expect(player.stop).not.toHaveBeenCalled();
        expect(completePlayerStart(player, currentToken)).toBe(true);
    });

    it('does not let a late guarded start overtake an active user start on the same player', () => {
        const player = { stop: vi.fn().mockResolvedValue(undefined) };
        const userToken = beginPlayerStart(player);
        const lateThemeToken = beginPlayerStart(player, { guarded: true });

        expect(lateThemeToken).toBeNull();
        expect(completePlayerStart(player, userToken)).toBe(true);
        expect(player.stop).not.toHaveBeenCalled();
    });

    it('silences a retired player without emitting normal playback-stop effects', async () => {
        let stoppedListenerBound = true;
        const effects = {
            playbackStops: 0,
            queueResets: 0
        };
        const player = {
            stop: vi.fn(async () => {
                if (stoppedListenerBound) {
                    effects.playbackStops += 1;
                    effects.queueResets += 1;
                }
            })
        };

        await stopPlayerWithoutPlaybackEvents(
            player,
            () => {
                stoppedListenerBound = false;
            },
            () => {
                stoppedListenerBound = true;
            }
        );

        expect(player.stop).toHaveBeenCalledWith(false);
        expect(effects).toEqual({
            playbackStops: 0,
            queueResets: 0
        });
        expect(stoppedListenerBound).toBe(true);
    });

    it('removes matching retired current state so the next playback can start cleanly', () => {
        const retiredStream = { item: { Id: 'theme-a' } };
        const playerData = { streamInfo: retiredStream };
        let currentPlayer: object | null = playerData;
        const stopProgress = vi.fn();
        const resetQueue = vi.fn();
        const removeCurrentPlayer = vi.fn(() => {
            currentPlayer = null;
        });

        expect(clearRetiredPlayerState({
            currentPlayer,
            expectedStreamInfo: retiredStream,
            player: playerData,
            playerData,
            removeCurrentPlayer,
            resetQueue,
            stopProgress
        })).toBe(true);

        expect(playerData.streamInfo).toBeNull();
        expect(stopProgress).toHaveBeenCalledWith(playerData);
        expect(resetQueue).toHaveBeenCalledOnce();
        expect(removeCurrentPlayer).toHaveBeenCalledWith(playerData);
        expect(currentPlayer).toBeNull();
    });

    it('clears retired stream data without disturbing a different active player', () => {
        const retiredStream = { item: { Id: 'theme-a' } };
        const retiredPlayer = { streamInfo: retiredStream };
        const userPlayer = { streamInfo: { item: { Id: 'user-video' } } };
        const stopProgress = vi.fn();
        const resetQueue = vi.fn();
        const removeCurrentPlayer = vi.fn();

        expect(clearRetiredPlayerState({
            currentPlayer: userPlayer,
            expectedStreamInfo: retiredStream,
            player: retiredPlayer,
            playerData: retiredPlayer,
            removeCurrentPlayer,
            resetQueue,
            stopProgress
        })).toBe(true);

        expect(retiredPlayer.streamInfo).toBeNull();
        expect(userPlayer.streamInfo?.item.Id).toBe('user-video');
        expect(stopProgress).not.toHaveBeenCalled();
        expect(resetQueue).not.toHaveBeenCalled();
        expect(removeCurrentPlayer).not.toHaveBeenCalled();
    });

    it('does not clear a newer stream on the same player', () => {
        const retiredStream = { item: { Id: 'theme-a' } };
        const currentStream = { item: { Id: 'user-audio' } };
        const playerData = { streamInfo: currentStream };

        expect(clearRetiredPlayerState({
            currentPlayer: playerData,
            expectedStreamInfo: retiredStream,
            player: playerData,
            playerData,
            removeCurrentPlayer: vi.fn(),
            resetQueue: vi.fn(),
            stopProgress: vi.fn()
        })).toBe(false);

        expect(playerData.streamInfo).toBe(currentStream);
    });
});
