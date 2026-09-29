import { beforeEach, describe, expect, it, vi } from 'vitest';

import { show } from './playersettingsmenu';
import { createPtvAbortController } from '../../ptv/core/abortController';

const fixture = vi.hoisted(() => ({
    sheet: vi.fn(),
    user: vi.fn(),
    bitrate: vi.fn(),
    aspectRatio: vi.fn(),
    rate: vi.fn(),
    repeat: vi.fn()
}));
vi.mock('../actionSheet/actionSheet', () => ({ default: { show: fixture.sheet } }));
vi.mock('lib/globalize', () => ({ default: { translate: (key: string) => key } }));
vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: { getApiClient: () => ({ getCurrentUser: fixture.user }) }
}));
vi.mock('../qualityOptions', () => ({
    default: { getVideoQualityOptions: () => [
        { name: 'Original', bitrate: 1000, selected: true },
        { name: 'Low', bitrate: 500, selected: false }
    ] }
}));
vi.mock('./playbackmanager', () => ({
    playbackManager: {
        currentItem: () => ({ Id: 'movie-a', ServerId: 'server-a' }),
        currentMediaSource: () => ({ RunTimeTicks: 1000000, MediaStreams: [{ Type: 'Video', Codec: 'h264', BitRate: 1000 }] }),
        getPlayerState: () => ({ PlayState: { PlayMethod: 'DirectPlay' } }),
        getSupportedCommands: () => ['SetAspectRatio', 'PlaybackRate', 'SetMaxStreamingBitrate', 'SetRepeatMode'],
        getAspectRatio: () => 'auto',
        getSupportedAspectRatios: () => [{ id: 'auto', name: 'Auto' }, { id: 'fill', name: 'Fill' }],
        getPlaybackRate: () => '1',
        getSupportedPlaybackRates: () => [{ id: '1', name: 'Normal' }, { id: '2', name: 'Fast' }],
        getRepeatMode: () => 'RepeatNone',
        getMaxStreamingBitrate: () => 1000,
        enableAutomaticBitrateDetection: () => false,
        setMaxStreamingBitrate: fixture.bitrate,
        setAspectRatio: fixture.aspectRatio,
        setPlaybackRate: fixture.rate,
        setRepeatMode: fixture.repeat
    }
}));

function deferred<T>() {
    let resolvePromise!: (value: T) => void;
    const promise = new Promise<T>(resolve => {
        resolvePromise = resolve;
    });
    return { promise, resolve: resolvePromise };
}

function operation() {
    const controller = createPtvAbortController();
    return {
        signal: controller.signal,
        isCurrent: () => !controller.signal.aborted,
        retire: () => controller.abort()
    };
}

async function flush() {
    for (let i = 0; i < 8; i++) await Promise.resolve();
}

describe('player settings child menu lifetime', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fixture.user.mockResolvedValue({ Policy: { EnableVideoPlaybackTranscoding: true } });
    });

    it('does not open a settings sheet after the owning operation retires during user lookup', async () => {
        const user = deferred<{ Policy: { EnableVideoPlaybackTranscoding: boolean } }>();
        fixture.user.mockReturnValue(user.promise);
        const owner = operation();
        const task = show({ player: {}, operation: owner }).catch(() => undefined);
        owner.retire();
        user.resolve({ Policy: { EnableVideoPlaybackTranscoding: true } });
        await task;
        expect(fixture.sheet).not.toHaveBeenCalled();
    });

    it.each([
        ['quality', '500', 'bitrate'],
        ['aspectratio', 'fill', 'aspectRatio'],
        ['playbackrate', '2', 'rate'],
        ['repeatmode', 'RepeatAll', 'repeat']
    ] as const)('threads one signal into %s and refuses a late child selection', async (option, selected, setter) => {
        const root = deferred<string>();
        const child = deferred<string>();
        fixture.sheet.mockReturnValueOnce(root.promise).mockReturnValueOnce(child.promise);
        const owner = operation();
        const player = {};
        const task = show({ player, operation: owner, quality: true }).catch(() => undefined);
        await flush();
        root.resolve(option);
        await flush();
        expect(fixture.sheet).toHaveBeenCalledTimes(2);
        expect(fixture.sheet.mock.calls[0][0].signal).toBe(owner.signal);
        expect(fixture.sheet.mock.calls[1][0].signal).toBe(owner.signal);
        owner.retire();
        child.resolve(selected);
        await task;
        expect(fixture[setter]).not.toHaveBeenCalled();
    });

    it('does not launch a child after a queued root selection loses its owner', async () => {
        const root = deferred<string>();
        fixture.sheet.mockReturnValue(root.promise);
        const owner = operation();
        const task = show({ player: {}, operation: owner }).catch(() => undefined);
        await flush();
        root.resolve('aspectratio');
        owner.retire();
        await task;
        expect(fixture.sheet).toHaveBeenCalledTimes(1);
        expect(fixture.aspectRatio).not.toHaveBeenCalled();
    });

    it.each(['stats', 'suboffset'])('refuses a stale %s callback', async option => {
        const root = deferred<string>();
        fixture.sheet.mockReturnValue(root.promise);
        const owner = operation();
        const onOption = vi.fn();
        const task = show({ player: {}, operation: owner, onOption }).catch(() => undefined);
        await flush();
        owner.retire();
        root.resolve(option);
        await task;
        expect(onOption).not.toHaveBeenCalled();
    });

    it('preserves settings selection for callers without a video operation', async () => {
        fixture.sheet.mockResolvedValueOnce('aspectratio').mockResolvedValueOnce('fill');
        const player = {};
        await show({ player });
        expect(fixture.aspectRatio).toHaveBeenCalledExactlyOnceWith('fill', player);
    });
});
