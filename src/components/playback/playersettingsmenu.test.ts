import { beforeEach, describe, expect, it, vi } from 'vitest';

import { show } from './playersettingsmenu';
import { createPtvAbortController } from '../../ptv/core/abortController';

const fixture = vi.hoisted(() => ({
    sheet: vi.fn(),
    user: vi.fn(),
    bitrate: vi.fn(),
    selection: vi.fn(),
    toast: vi.fn(),
    isInNetwork: false,
    playerQualityOptions: vi.fn(),
    currentSelection: vi.fn(),
    playMethod: 'DirectPlay',
    aspectRatio: vi.fn(),
    rate: vi.fn(),
    repeat: vi.fn()
}));
vi.mock('../actionSheet/actionSheet', () => ({ default: { show: fixture.sheet } }));
vi.mock('../toast/toast', () => ({ default: fixture.toast }));
vi.mock('lib/globalize', () => ({ default: { translate: (key: string) => key === 'PtvVideoQualitySwitchFailed' ?
    'Could not switch to the selected quality.' : key } }));
vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: { getApiClient: () => ({
        getCurrentUser: fixture.user,
        getSavedEndpointInfo: () => ({ IsInNetwork: fixture.isInNetwork })
    }) }
}));
vi.mock('../qualityOptions', () => ({
    default: {
        getVideoQualityOptions: () => [
            { name: 'Original', bitrate: 1000, selected: true },
            { name: 'Low', bitrate: 500, selected: false }
        ],
        getPlayerVideoQualityOptions: fixture.playerQualityOptions
    }
}));
vi.mock('./playbackmanager', () => ({
    playbackManager: {
        currentItem: () => ({ Id: 'movie-a', ServerId: 'server-a' }),
        currentMediaSource: () => ({ RunTimeTicks: 1000000, MediaStreams: [{ Type: 'Video', Codec: 'h264', BitRate: 1000, Width: 1920, Height: 1080 }] }),
        getPlayerState: () => ({ PlayState: { PlayMethod: fixture.playMethod } }),
        getSupportedCommands: () => ['SetAspectRatio', 'PlaybackRate', 'SetMaxStreamingBitrate', 'SetRepeatMode'],
        getAspectRatio: () => 'auto',
        getSupportedAspectRatios: () => [{ id: 'auto', name: 'Auto' }, { id: 'fill', name: 'Fill' }],
        getPlaybackRate: () => '1',
        getSupportedPlaybackRates: () => [{ id: '1', name: 'Normal' }, { id: '2', name: 'Fast' }],
        getRepeatMode: () => 'RepeatNone',
        getMaxStreamingBitrate: () => 1000,
        getVideoQualityConnectionBitrate: () => 12_000_000,
        enableAutomaticBitrateDetection: () => false,
        setMaxStreamingBitrate: fixture.bitrate,
        getVideoQualitySelection: fixture.currentSelection,
        setVideoQualitySelection: fixture.selection,
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
        fixture.currentSelection.mockReturnValue('auto');
        fixture.playMethod = 'DirectPlay';
        fixture.isInNetwork = false;
        fixture.playerQualityOptions.mockReturnValue([
            { id: 'auto', name: 'Auto', secondaryText: 'Recommended', selected: true },
            { id: 'original', name: 'Original', secondaryText: 'Source quality' },
            { id: 'full-hd', name: 'Full HD', secondaryText: 'Up to 1080p' },
            { id: 'hd', name: 'HD', secondaryText: 'Up to 720p' },
            { id: 'sd', name: 'SD', secondaryText: 'Up to 480p' }
        ]);
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
        ['quality', 'hd', 'selection'],
        ['aspectratio', 'fill', 'aspectRatio'],
        ['playbackrate', '2', 'rate'],
        ['repeatmode', 'RepeatAll', 'repeat']
    ] as const)('threads one signal into %s and refuses a late child selection', async (option, selected, setter) => {
        const root = deferred<string>();
        const child = deferred<string>();
        fixture.sheet.mockReturnValueOnce(root.promise).mockReturnValueOnce(child.promise);
        const owner = operation();
        const player = { isLocalPlayer: true };
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

    it('offers the named player presets and applies a selected preset ID', async () => {
        fixture.sheet.mockResolvedValueOnce('quality').mockResolvedValueOnce('hd');
        const player = { isLocalPlayer: true };

        await show({ player, quality: true });

        const menu = fixture.sheet.mock.calls[1][0];
        expect(menu.items.map((item: { id: string; name: string; secondaryText: string }) => [ item.id, item.name, item.secondaryText ])).toEqual([
            [ 'auto', 'Auto', 'Recommended' ],
            [ 'original', 'Original', 'Source quality' ],
            [ 'full-hd', 'Full HD', 'Up to 1080p' ],
            [ 'hd', 'HD', 'Up to 720p' ],
            [ 'sd', 'SD', 'Up to 480p' ]
        ]);
        expect(fixture.playerQualityOptions).toHaveBeenCalledWith(expect.objectContaining({
            videoWidth: 1920,
            videoHeight: 1080,
            currentSelection: 'auto'
        }));
        expect(fixture.playerQualityOptions.mock.calls.at(-1)?.[0]).not.toHaveProperty('maxAllowedBitrate');
        expect(fixture.selection).toHaveBeenCalledExactlyOnceWith('hd', player);
        expect(fixture.bitrate).not.toHaveBeenCalled();
    });

    it('passes a public user limit to the quality choices but not on a local connection', async () => {
        fixture.user.mockResolvedValue({ Policy: { EnableVideoPlaybackTranscoding: true, RemoteClientBitrateLimit: 3_000_000 } });
        fixture.sheet.mockResolvedValueOnce('quality').mockResolvedValueOnce(undefined);
        await show({ player: { isLocalPlayer: true }, quality: true });
        expect(fixture.playerQualityOptions.mock.calls.at(-1)?.[0].maxAllowedBitrate).toBe(3_000_000);

        fixture.playerQualityOptions.mockClear();
        fixture.isInNetwork = true;
        fixture.sheet.mockResolvedValueOnce('quality').mockResolvedValueOnce(undefined);
        await show({ player: { isLocalPlayer: true }, quality: true });
        expect(fixture.playerQualityOptions.mock.calls.at(-1)?.[0]).not.toHaveProperty('maxAllowedBitrate');
    });

    it('shows a visible error when the server refuses the selected quality', async () => {
        fixture.sheet.mockResolvedValueOnce('quality').mockResolvedValueOnce('full-hd');
        fixture.selection.mockRejectedValueOnce(new Error('unsupported stream'));
        await expect(show({ player: { isLocalPlayer: true }, quality: true })).rejects.toThrow();
        expect(fixture.toast).toHaveBeenCalledWith('Could not switch to the selected quality.');
    });

    it('keeps the quality choice out of a remote player menu', async () => {
        fixture.sheet.mockResolvedValue(undefined);

        await show({ player: { isLocalPlayer: false }, quality: true }).catch(() => undefined);

        expect(fixture.sheet.mock.calls[0][0].items.map((item: { id: string }) => item.id)).not.toContain('quality');
        expect(fixture.selection).not.toHaveBeenCalled();
    });

    it('discloses conversion when Original cannot use direct playback', async () => {
        fixture.currentSelection.mockReturnValue('original');
        fixture.playMethod = 'Transcode';
        fixture.playerQualityOptions.mockReturnValue([
            { id: 'auto', name: 'Auto', secondaryText: 'Recommended' },
            { id: 'original', name: 'Original', secondaryText: 'Source quality', selected: true }
        ]);
        fixture.sheet.mockResolvedValue(undefined);

        await show({ player: { isLocalPlayer: true }, quality: true }).catch(() => undefined);

        const quality = fixture.sheet.mock.calls[0][0].items.find((item: { id: string }) => item.id === 'quality');
        expect(quality.asideText).toBe('Original · Transcoding');
    });
});
