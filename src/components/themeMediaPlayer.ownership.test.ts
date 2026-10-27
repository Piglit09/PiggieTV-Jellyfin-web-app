import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServerConnections } from 'lib/jellyfin-apiclient';

import Events from '../utils/events';

type AudioItem = {
    Id: string;
    ServerId: string;
    MediaType: string;
    Type: string;
    Name: string;
    RunTimeTicks: number;
    MediaStreams: unknown[];
};

type StreamInfo = { item: AudioItem; url: string };

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {
        resolve = done;
    });
    return { promise, resolve };
}

const fixture = vi.hoisted(() => {
    const state = {
        loadedStream: null as StreamInfo | null,
        paused: true,
        nextPlay: null as Promise<void> | null
    };
    const player = {
        id: 'ownership-audio-player',
        name: 'Ownership fixture audio player',
        isLocalPlayer: true,
        _callbacks: {},
        canPlayMediaType: (type: string) => type === 'Audio',
        currentSrc: () => state.loadedStream?.url || null,
        currentTime: () => 0,
        duration: () => 60_000,
        getVolume: () => 50,
        setVolume: () => undefined,
        isMuted: () => false,
        paused: () => state.paused,
        getPlaybackRate: () => 1,
        getBufferedRanges: () => [],
        getDeviceProfile: vi.fn(async () => ({
            CodecProfiles: [],
            DirectPlayProfiles: [{ Type: 'Audio', Container: 'mp3' }],
            TranscodingProfiles: [{ Type: 'Audio', Context: 'Streaming', Container: 'mp3', AudioCodec: 'mp3' }]
        })),
        play: vi.fn((stream: StreamInfo) => {
            const pending = state.nextPlay || Promise.resolve();
            state.nextPlay = null;
            state.loadedStream = stream;

            return pending.then(() => {
                if (state.loadedStream === stream) state.paused = false;
            });
        }),
        stop: vi.fn(),
        destroy: vi.fn(() => {
            state.loadedStream = null;
            state.paused = true;
        })
    };

    return {
        state,
        player,
        intercept: vi.fn(async (): Promise<void> => undefined),
        itemLookup: vi.fn(),
        getThemeMedia: vi.fn(),
        userSettings: {
            enableThemeSongs: vi.fn(() => true),
            enableThemeVideos: vi.fn(() => false)
        },
        reportPlaybackStart: vi.fn(async () => undefined),
        reportPlaybackProgress: vi.fn(async () => undefined),
        reportPlaybackStopped: vi.fn(async () => undefined)
    };
});

vi.mock('./pluginManager', () => ({
    pluginManager: {
        _callbacks: {},
        ofType: (type: string) => {
            if (type === 'mediaplayer') return [fixture.player];
            if (type === 'preplayintercept') return [{ intercept: fixture.intercept }];
            return [];
        }
    }
}));
vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        getApiClient: () => ({
            getCurrentUserId: () => 'user-a',
            getCurrentUser: async () => ({
                Configuration: { RememberAudioSelections: false, RememberSubtitleSelections: false },
                Policy: { RemoteClientBitrateLimit: 0 }
            }),
            getItem: fixture.itemLookup,
            getSavedEndpointInfo: () => ({ IsInNetwork: true }),
            getEndpointInfo: async () => ({ IsInNetwork: true }),
            getUrl: (path: string) => `https://fixture.invalid/${path}`,
            deviceId: () => 'fixture-device',
            accessToken: () => '',
            reportPlaybackStart: fixture.reportPlaybackStart,
            reportPlaybackProgress: fixture.reportPlaybackProgress,
            reportPlaybackStopped: fixture.reportPlaybackStopped
        })
    }
}));
vi.mock('@jellyfin/sdk/lib/utils/api/library-api', () => ({
    getLibraryApi: () => ({ getThemeMedia: fixture.getThemeMedia })
}));
vi.mock('hooks/useItem', () => ({ getItemQuery: (_api: unknown, itemId: string) => ({ itemId }) }));
vi.mock('utils/query/queryClient', () => ({
    queryClient: { fetchQuery: async ({ itemId }: { itemId: string }) => ({ Id: itemId, Type: 'Series' }) }
}));
vi.mock('utils/jellyfin-apiclient/compat', () => ({ toApi: () => ({}) }));
vi.mock('apps/stable/features/playback/utils/mediaSegmentManager', () => ({ bindMediaSegmentManager: () => undefined }));
vi.mock('apps/stable/features/playback/utils/mediaSessionSubscriber', () => ({ bindMediaSessionSubscriber: () => undefined }));
vi.mock('./loading/loading', () => ({ default: { show: () => undefined, hide: () => undefined } }));
vi.mock('./apphost', () => ({ appHost: { supports: () => false } }));
vi.mock('./alert', () => ({ default: () => undefined }));
vi.mock('./itemHelper', () => ({ default: { isLocalItem: () => false } }));
vi.mock('../lib/globalize', () => ({ default: { translate: (key: string) => key } }));
vi.mock('../scripts/settings/userSettings', () => ({ currentSettings: fixture.userSettings }));
vi.mock('../scripts/settings/appSettings', () => ({
    default: {
        maxStreamingBitrate: () => 320_000,
        enableAutomaticBitrateDetection: () => false
    }
}));
vi.mock('../utils/jellyfin-apiclient/backdropImage', () => ({ getItemBackdropImageUrl: () => null }));
vi.mock('./playback/skipsegment.ts', () => ({ bindSkipSegment: () => undefined }));

import { playbackManager } from './playback/playbackmanager';
import './themeMediaPlayer';

function audioItem(id: string): AudioItem {
    return {
        Id: id,
        ServerId: 'server-a',
        MediaType: 'Audio',
        Type: 'Audio',
        Name: id,
        RunTimeTicks: 600_000_000,
        MediaStreams: []
    };
}

function leaveDetails() {
    document.dispatchEvent(new CustomEvent('viewshow', {
        detail: { params: {}, options: { supportsThemeMedia: false } }
    }));
}

async function settlePromises() {
    for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

async function startAutomaticTheme() {
    document.dispatchEvent(new CustomEvent('viewshow', {
        detail: { params: { serverId: 'server-a', id: 'series-a' }, options: {} }
    }));
    await vi.waitFor(() => {
        expect(fixture.state.loadedStream?.item.Id).toBe('song-a');
        expect(fixture.state.paused).toBe(false);
    });
    await settlePromises();
}

describe('automatic themes and actual PlaybackManager ownership', () => {
    beforeEach(async () => {
        fixture.state.nextPlay = null;
        fixture.player.stop.mockImplementation(async () => {
            fixture.state.loadedStream = null;
            fixture.state.paused = true;
            Events.trigger(fixture.player, 'stopped');
        });
        leaveDetails();
        await playbackManager.stop();
        await settlePromises();
        vi.clearAllMocks();
        fixture.intercept.mockReset().mockResolvedValue(undefined);
        fixture.itemLookup.mockImplementation(async (_userId: string, id: string | string[]) => audioItem(String(id)));
        fixture.getThemeMedia.mockResolvedValue({
            data: { ThemeSongsResult: { Items: [audioItem('song-a')], OwnerId: 'series-a' } }
        });
    });

    afterEach(async () => {
        fixture.state.nextPlay = null;
        leaveDetails();
        await playbackManager.stop();
        await settlePromises();
    });

    it('retires an automatic theme when the destination does not retain theme media', async () => {
        await startAutomaticTheme();

        leaveDetails();
        await settlePromises();

        expect(fixture.state.loadedStream).toBeNull();
        expect(await playbackManager.getPlaylist()).toEqual([]);
    });

    it('preserves an intentional same-ID manual playback after the automatic request settled', async () => {
        await startAutomaticTheme();
        await playbackManager.play({ items: [audioItem('song-a')], fullscreen: false });
        const manualStream = fixture.state.loadedStream;

        leaveDetails();
        await settlePromises();

        expect(fixture.state.loadedStream).toBe(manualStream);
        expect(fixture.state.paused).toBe(false);
        expect((await playbackManager.getPlaylist()).map((item: AudioItem) => item.Id)).toEqual(['song-a']);
    });

    it('preserves a same-ID manual source while its accepted player start is pending', async () => {
        await startAutomaticTheme();
        const pending = deferred<void>();
        fixture.state.nextPlay = pending.promise;
        const manualPlayback = playbackManager.play({ items: [audioItem('song-a')], fullscreen: false });
        await vi.waitFor(() => expect(fixture.player.play).toHaveBeenCalledTimes(2));
        const manualStream = fixture.state.loadedStream;

        leaveDetails();
        await settlePromises();
        pending.resolve();
        await manualPlayback;

        expect(fixture.state.loadedStream).toBe(manualStream);
        expect(fixture.state.paused).toBe(false);
        expect((await playbackManager.getPlaylist()).map((item: AudioItem) => item.Id)).toEqual(['song-a']);
    });

    it('allows an accepted manual item lookup to finish after leaving Details', async () => {
        await startAutomaticTheme();
        const pending = deferred<AudioItem>();
        fixture.itemLookup.mockReturnValueOnce(pending.promise);
        const manualPlayback = playbackManager.play({ serverId: 'server-a', ids: ['song-a'], fullscreen: false });

        leaveDetails();
        await settlePromises();
        pending.resolve(audioItem('song-a'));
        await manualPlayback;

        expect(fixture.state.loadedStream?.item.Id).toBe('song-a');
        expect(fixture.state.paused).toBe(false);
        expect((await playbackManager.getPlaylist()).map((item: AudioItem) => item.Id)).toEqual(['song-a']);
    });

    it.each(['queue', 'queueNext'] as const)('preserves an accepted intentional %s transfer when leaving Details', async mode => {
        await startAutomaticTheme();
        await playbackManager[mode]({ items: [audioItem('manual-b')] });
        const acceptedQueue = (await playbackManager.getPlaylist()).map((item: AudioItem) => item.Id);
        expect(acceptedQueue).toEqual(['song-a', 'manual-b']);

        leaveDetails();
        await settlePromises();

        expect(fixture.state.loadedStream?.item.Id).toBe('song-a');
        expect(fixture.state.paused).toBe(false);
        expect((await playbackManager.getPlaylist()).map((item: AudioItem) => item.Id)).toEqual(['song-a', 'manual-b']);
    });

    it('preserves an intentional same-ID selection from the automatic queue', async () => {
        await startAutomaticTheme();
        const [selectedItem] = await playbackManager.getPlaylist();
        playbackManager.setCurrentPlaylistItem(selectedItem.PlaylistItemId, fixture.player);
        await vi.waitFor(() => expect(fixture.player.play).toHaveBeenCalledTimes(2));
        await settlePromises();
        const selectedStream = fixture.state.loadedStream;

        leaveDetails();
        await settlePromises();

        expect(fixture.state.loadedStream).toBe(selectedStream);
        expect(fixture.state.paused).toBe(false);
        expect((await playbackManager.getPlaylist()).map((item: AudioItem) => item.Id)).toEqual(['song-a']);
    });

    it('advances the accepted manual queue after its transfer survives leaving Details', async () => {
        await startAutomaticTheme();
        await playbackManager.queue({ items: [audioItem('manual-b')] });

        leaveDetails();
        await settlePromises();
        playbackManager.nextTrack();
        await vi.waitFor(() => {
            expect(fixture.state.loadedStream?.item.Id).toBe('manual-b');
            expect(fixture.state.paused).toBe(false);
        });

        expect((await playbackManager.getPlaylist()).map((item: AudioItem) => item.Id)).toEqual(['song-a', 'manual-b']);
        expect(playbackManager.getCurrentPlaylistIndex()).toBe(1);
    });

    it.each(['Previous', 'queue selection'] as const)('replays the retained theme entry through %s after adopting and advancing the manual queue', async action => {
        await startAutomaticTheme();
        await playbackManager.queue({ items: [audioItem('manual-b')] });
        leaveDetails();
        await settlePromises();
        playbackManager.nextTrack();
        await vi.waitFor(() => {
            expect(fixture.state.loadedStream?.item.Id).toBe('manual-b');
            expect(fixture.state.paused).toBe(false);
        });

        if (action === 'Previous') {
            playbackManager.previousTrack();
        } else {
            const [retainedItem] = await playbackManager.getPlaylist();
            playbackManager.setCurrentPlaylistItem(retainedItem.PlaylistItemId);
        }
        await vi.waitFor(() => {
            expect(fixture.state.loadedStream?.item.Id).toBe('song-a');
            expect(fixture.state.paused).toBe(false);
        });

        expect((await playbackManager.getPlaylist()).map((item: AudioItem) => item.Id)).toEqual(['song-a', 'manual-b']);
        expect(playbackManager.getCurrentPlaylistIndex()).toBe(0);
    });

    it('rejects a pending automatic replacement after the current queue is intentionally adopted', async () => {
        await startAutomaticTheme();
        const replacement = deferred<void>();
        fixture.intercept.mockReturnValueOnce(replacement.promise);
        fixture.getThemeMedia.mockResolvedValueOnce({
            data: { ThemeSongsResult: { Items: [audioItem('song-replacement')], OwnerId: 'series-b' } }
        });
        document.dispatchEvent(new CustomEvent('viewshow', {
            detail: { params: { serverId: 'server-a', id: 'series-b' }, options: {} }
        }));
        await vi.waitFor(() => expect(fixture.intercept).toHaveBeenCalledTimes(2));
        await playbackManager.queue({ items: [audioItem('manual-b')] });
        leaveDetails();
        replacement.resolve();
        await settlePromises();

        expect(fixture.state.loadedStream?.item.Id).toBe('song-a');
        expect(fixture.state.paused).toBe(false);
        expect((await playbackManager.getPlaylist()).map((item: AudioItem) => item.Id)).toEqual(['song-a', 'manual-b']);
        expect(fixture.player.play).toHaveBeenCalledTimes(1);

        playbackManager.nextTrack();
        await vi.waitFor(() => expect(fixture.state.loadedStream?.item.Id).toBe('manual-b'));
        playbackManager.previousTrack();
        await vi.waitFor(() => {
            expect(fixture.state.loadedStream?.item.Id).toBe('song-a');
            expect(fixture.state.paused).toBe(false);
        });
    });

    it.each(['localusersignedout', 'localusersignedin'])('retires active automatic themes on the actual %s event source', async eventName => {
        await startAutomaticTheme();

        Events.trigger(ServerConnections, eventName);
        await settlePromises();

        expect(fixture.state.loadedStream).toBeNull();
        expect(await playbackManager.getPlaylist()).toEqual([]);
    });

    it.each(['localusersignedout', 'localusersignedin'])('leaves intentional same-ID playback to its owner on the actual %s event source', async eventName => {
        await startAutomaticTheme();
        await playbackManager.play({ items: [audioItem('song-a')], fullscreen: false });
        const manualStream = fixture.state.loadedStream;

        Events.trigger(ServerConnections, eventName);
        await settlePromises();

        expect(fixture.state.loadedStream).toBe(manualStream);
        expect(fixture.state.paused).toBe(false);
        expect((await playbackManager.getPlaylist()).map((item: AudioItem) => item.Id)).toEqual(['song-a']);
    });

    it('preserves a newer same-player request when a route stop is already queued', async () => {
        await startAutomaticTheme();

        leaveDetails();
        const manualPlayback = playbackManager.play({ items: [audioItem('manual-b')], fullscreen: false });
        await manualPlayback;
        await settlePromises();

        expect(fixture.state.loadedStream?.item.Id).toBe('manual-b');
        expect(fixture.state.paused).toBe(false);
        expect((await playbackManager.getPlaylist()).map((item: AudioItem) => item.Id)).toEqual(['manual-b']);
    });
});
