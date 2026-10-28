import { beforeEach, describe, expect, it, vi } from 'vitest';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => {
        resolve = done;
    });
    return { promise, resolve };
}

const fixture = vi.hoisted(() => ({
    player: null as Record<string, unknown> | null,
    apiClient: {} as Record<string, unknown>,
    postedPlaybackInfo: vi.fn(),
    stopActiveEncodings: vi.fn(),
    detectBitrate: vi.fn(),
    maxStreamingBitrate: vi.fn(),
    automaticBitrate: vi.fn()
}));

vi.mock('../pluginManager', () => ({
    pluginManager: {
        _callbacks: {},
        ofType: (type: string) => type === 'mediaplayer' && fixture.player ? [fixture.player] : []
    }
}));
vi.mock('lib/jellyfin-apiclient', () => ({
    ServerConnections: {
        getApiClient: () => fixture.apiClient,
        currentApiClient: () => fixture.apiClient
    }
}));
vi.mock('@jellyfin/sdk/lib/utils/api/media-info-api', () => ({
    getMediaInfoApi: () => ({ getPostedPlaybackInfo: fixture.postedPlaybackInfo })
}));
vi.mock('utils/jellyfin-apiclient/compat', () => ({ toApi: () => ({}) }));
vi.mock('apps/stable/features/playback/utils/mediaSegmentManager', () => ({ bindMediaSegmentManager: () => undefined }));
vi.mock('apps/stable/features/playback/utils/mediaSessionSubscriber', () => ({ bindMediaSessionSubscriber: () => undefined }));
vi.mock('../loading/loading', () => ({ default: { show: () => undefined, hide: () => undefined } }));
vi.mock('../apphost', () => ({ appHost: { supports: () => false } }));
vi.mock('../alert', () => ({ default: () => undefined }));
vi.mock('../itemHelper', () => ({ default: { isLocalItem: () => false } }));
vi.mock('../../lib/globalize', () => ({ default: { translate: (key: string) => key } }));
vi.mock('../../scripts/settings/userSettings', () => ({}));
vi.mock('../../scripts/settings/appSettings', () => ({
    default: {
        maxStreamingBitrate: fixture.maxStreamingBitrate,
        enableAutomaticBitrateDetection: fixture.automaticBitrate,
        alwaysBurnInSubtitleWhenTranscoding: () => false
    }
}));
vi.mock('../../utils/jellyfin-apiclient/backdropImage', () => ({ getItemBackdropImageUrl: () => null }));
vi.mock('./skipsegment.ts', () => ({ bindSkipSegment: () => undefined }));

import { PlaybackManager } from './playbackmanager';

type QualitySelectionManager = PlaybackManager & {
    getVideoQualitySelection: (player: unknown) => string;
    setVideoQualitySelection: (selection: string, player: unknown) => Promise<void>;
};

const sourceItem = {
    Id: 'movie-4k',
    ServerId: 'fixture-server',
    MediaType: 'Video',
    Type: 'Movie',
    Name: 'Fixture Movie',
    RunTimeTicks: 72_000_000_000
};

function source(width = 3840, height = 2160) {
    return {
        Id: 'source-4k',
        Bitrate: undefined as number | undefined,
        Container: 'mkv',
        MediaStreams: [
            { Type: 'Video', Index: 0, Width: width, Height: height, Codec: 'hevc', BitRate: 6_390_000, BitDepth: undefined as number | undefined },
            { Type: 'Audio', Index: 2, Codec: 'aac' },
            { Type: 'Subtitle', Index: 4, Codec: 'srt', DeliveryMethod: 'Embed' }
        ],
        SupportsDirectPlay: false,
        SupportsDirectStream: false,
        SupportsTranscoding: true,
        TranscodingContainer: 'ts',
        TranscodingSubProtocol: 'hls',
        TranscodingUrl: '/Videos/movie-4k/master.m3u8?MaxWidth=1920&MaxHeight=1080&PlaySessionId=new-session&ApiKey=fixture-secret' as string | undefined
    };
}

function response(mediaSource = source()) {
    return { data: { PlaySessionId: 'new-session', MediaSources: [mediaSource] } };
}

function setupPlayback(width = 3840, height = 2160) {
    const baseProfile = {
        Name: 'fixture browser',
        CodecProfiles: [{ Type: 'Video', Codec: 'h264', Conditions: [{ Condition: 'LessThanEqual', Property: 'VideoBitDepth', Value: '10', IsRequired: false }] }],
        TranscodingProfiles: [{ Type: 'Video', Container: 'ts', VideoCodec: 'h264', Conditions: [] }],
        DirectPlayProfiles: [{ Type: 'Video', Container: 'mkv', VideoCodec: 'hevc' }]
    };
    const originalStreamInfo = {
        item: sourceItem,
        mediaSource: source(width, height),
        mediaType: 'Video',
        playMethod: 'Transcode',
        playSessionId: 'old-session' as string | undefined,
        url: 'https://fixture.local/old-stream',
        started: true,
        ended: false
    };
    const player = {
        id: 'fixture-player',
        name: 'fixture player',
        isLocalPlayer: true,
        _callbacks: {},
        streamInfo: originalStreamInfo,
        audioStreamIndex: 2,
        subtitleStreamIndex: 4,
        secondarySubtitleStreamIndex: -1,
        canPlayMediaType: () => true,
        currentTime: () => 120_000,
        getDeviceProfile: vi.fn().mockResolvedValue(baseProfile),
        play: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        destroy: vi.fn()
    };
    fixture.player = player;
    const manager = new PlaybackManager() as QualitySelectionManager;
    Object.assign(manager, { _currentPlayer: player });
    manager.getPlayerState = () => ({ PlayState: {}, NowPlayingItem: { Id: sourceItem.Id } });
    return { manager, player, baseProfile, originalStreamInfo };
}

function requestedProfile() {
    const call = fixture.postedPlaybackInfo.mock.calls.at(-1)?.[0];
    return call?.playbackInfoDto?.DeviceProfile;
}

function hasCeiling(profile: Record<string, unknown>, property: string, value: string) {
    return (profile.CodecProfiles as Array<{ Type: string; Conditions: Array<Record<string, unknown>> }>).some(codec =>
        codec.Type === 'Video' && codec.Conditions.some(condition =>
            condition.Property === property && condition.Condition === 'LessThanEqual' && condition.Value === value));
}

describe('PlaybackManager video quality selection', () => {
    beforeEach(() => {
        fixture.player = null;
        fixture.postedPlaybackInfo.mockReset();
        fixture.stopActiveEncodings.mockReset().mockResolvedValue(undefined);
        fixture.detectBitrate.mockReset().mockResolvedValue(12_000_000);
        fixture.maxStreamingBitrate.mockReset().mockReturnValue(12_000_000);
        fixture.automaticBitrate.mockReset().mockReturnValue(true);
        fixture.apiClient = {
            getCurrentUserId: () => 'fixture-user',
            getSavedEndpointInfo: () => ({ IsInNetwork: false }),
            getEndpointInfo: () => Promise.resolve({ IsInNetwork: false }),
            getCurrentUser: () => Promise.resolve({ Policy: { RemoteClientBitrateLimit: 0 } }),
            getUrl: (url: string) => `https://fixture.local${url}`,
            deviceId: () => 'fixture-device',
            accessToken: () => 'fixture-secret',
            stopActiveEncodings: fixture.stopActiveEncodings,
            detectBitrate: fixture.detectBitrate,
            reportPlaybackStopped: vi.fn().mockResolvedValue(undefined),
            reportPlaybackStart: vi.fn().mockResolvedValue(undefined)
        };
        fixture.postedPlaybackInfo.mockResolvedValue(response());
    });

    it('applies the manual width and height ceilings only to this PlaybackInfo request', async () => {
        const { manager, player, baseProfile } = setupPlayback();
        const before = JSON.parse(JSON.stringify(baseProfile));

        expect(manager.getVideoQualitySelection(player)).toBe('auto');
        await manager.setVideoQualitySelection('full-hd', player);

        const profile = requestedProfile();
        expect(profile).toBeDefined();
        expect(profile).not.toBe(baseProfile);
        expect(hasCeiling(profile, 'Width', '1920')).toBe(true);
        expect(hasCeiling(profile, 'Height', '1080')).toBe(true);
        expect(baseProfile).toEqual(before);
        expect(manager.getVideoQualitySelection(player)).toBe('full-hd');
        expect(manager.getVideoQualityConnectionBitrate(player)).toBe(12_000_000);
    });

    it.each([
        ['a transcoding URL without a resolution ceiling', {
            ...source(),
            TranscodingUrl: '/Videos/movie-4k/master.m3u8?PlaySessionId=new-session&ApiKey=fixture-secret'
        }],
        ['direct play of an over-cap source', {
            ...source(),
            SupportsDirectPlay: true
        }]
    ])('rejects %s before retiring the active session', async (_reason, negotiatedSource) => {
        const { manager, player, originalStreamInfo } = setupPlayback();
        fixture.postedPlaybackInfo.mockResolvedValue(response(negotiatedSource));

        await expect(manager.setVideoQualitySelection('full-hd', player)).rejects.toThrow();

        expect(fixture.stopActiveEncodings).not.toHaveBeenCalled();
        expect(player.play).not.toHaveBeenCalled();
        expect(player.streamInfo).toBe(originalStreamInfo);
        expect(manager.getVideoQualitySelection(player)).toBe('auto');
    });

    it('preserves seek position, selected tracks and source while handing off the playback session', async () => {
        const { manager, player } = setupPlayback();

        await manager.setVideoQualitySelection('full-hd', player);

        const query = fixture.postedPlaybackInfo.mock.calls[0][0].playbackInfoDto;
        expect(query).toMatchObject({
            MediaSourceId: 'source-4k',
            StartTimeTicks: 1_200_000_000,
            AudioStreamIndex: 2,
            SubtitleStreamIndex: 4
        });
        expect(fixture.stopActiveEncodings).toHaveBeenCalledWith('old-session');
        expect(player.play.mock.invocationCallOrder[0]).toBeLessThan(fixture.stopActiveEncodings.mock.invocationCallOrder[0]);
        expect(player.play).toHaveBeenCalledOnce();
        expect(player.play).toHaveBeenCalledWith(expect.objectContaining({
            playerStartPositionTicks: 1_200_000_000,
            playSessionId: 'new-session',
            mediaSource: expect.objectContaining({ Id: 'source-4k' })
        }));
        expect(manager.playSessionId(player)).toBe('new-session');
    });

    it('keeps the selected ceiling through a later audio-track stream rebuild', async () => {
        const { manager, player } = setupPlayback();
        await manager.setVideoQualitySelection('full-hd', player);

        await manager.setAudioStreamIndex(3, player);

        const profile = requestedProfile();
        expect(hasCeiling(profile, 'Width', '1920')).toBe(true);
        expect(hasCeiling(profile, 'Height', '1080')).toBe(true);
        expect(fixture.postedPlaybackInfo.mock.calls.at(-1)?.[0].playbackInfoDto.AudioStreamIndex).toBe(3);
        expect(manager.getVideoQualitySelection(player)).toBe('full-hd');
    });

    it('does not advertise an old manual ceiling when the same item starts a fresh playback', async () => {
        const { manager, player, baseProfile } = setupPlayback();
        await manager.setVideoQualitySelection('full-hd', player);
        expect(manager.getVideoQualitySelection(player)).toBe('full-hd');

        fixture.apiClient.getItem = vi.fn().mockResolvedValue({ MediaStreams: source().MediaStreams });
        fixture.apiClient.getCurrentUser = vi.fn().mockResolvedValue({
            Configuration: { RememberAudioSelections: false, RememberSubtitleSelections: false }
        });
        fixture.apiClient.reportPlaybackStart = vi.fn().mockResolvedValue(undefined);
        fixture.postedPlaybackInfo.mockResolvedValue(response());

        await manager.play({ items: [{ ...sourceItem }], fullscreen: false });

        expect(fixture.apiClient.getItem).toHaveBeenCalled();
        expect(player.getDeviceProfile).toHaveBeenCalledTimes(2);
        expect(fixture.postedPlaybackInfo).toHaveBeenCalledTimes(2);
        expect(player.play).toHaveBeenCalledTimes(2);
        expect(requestedProfile()).toEqual(baseProfile);
        expect(manager.currentItem(player)?.Id).toBe(sourceItem.Id);
        expect(manager.getVideoQualitySelection(player)).toBe('auto');
    });

    it('restores the previous stream if a new quality stream fails to start', async () => {
        const { manager, player, originalStreamInfo } = setupPlayback();
        player.play.mockRejectedValueOnce(new Error('new stream failed')).mockResolvedValueOnce(undefined);

        await expect(manager.setVideoQualitySelection('full-hd', player)).rejects.toThrow('new stream failed');

        expect(fixture.stopActiveEncodings).not.toHaveBeenCalledWith('old-session');
        expect(player.play).toHaveBeenCalledTimes(2);
        expect(player.play).toHaveBeenLastCalledWith(expect.objectContaining({
            url: originalStreamInfo.url,
            playSessionId: 'old-session',
            playerStartPositionTicks: 1_200_000_000
        }));
        expect(player.streamInfo).toMatchObject({ url: originalStreamInfo.url, playSessionId: 'old-session' });
        expect(manager.playSessionId(player)).toBe('old-session');
        expect(manager.getVideoQualitySelection(player)).toBe('auto');
    });

    it('retains the previous manual ceiling when a later quality choice fails to start', async () => {
        const { manager, player } = setupPlayback();
        await manager.setVideoQualitySelection('full-hd', player);
        const previousStreamInfo = player.streamInfo;
        expect(manager.getVideoQualitySelection(player)).toBe('full-hd');

        fixture.postedPlaybackInfo.mockResolvedValue(response({
            ...source(),
            TranscodingUrl: '/Videos/movie-4k/master.m3u8?MaxWidth=1280&MaxHeight=720&PlaySessionId=third-session'
        }));
        player.play.mockRejectedValueOnce(new Error('HD playback failed')).mockResolvedValueOnce(undefined);

        await expect(manager.setVideoQualitySelection('hd', player)).rejects.toThrow('HD playback failed');

        expect(manager.getVideoQualitySelection(player)).toBe('full-hd');
        expect(player.streamInfo).toMatchObject({
            url: previousStreamInfo.url,
            playSessionId: 'new-session'
        });
        expect(fixture.stopActiveEncodings).not.toHaveBeenCalledWith('new-session');
    });

    it('restores an existing direct stream without a playback session ID after a failed switch', async () => {
        const { manager, player, originalStreamInfo } = setupPlayback();
        originalStreamInfo.playSessionId = undefined;
        player.play.mockRejectedValueOnce(new Error('new stream failed')).mockResolvedValueOnce(undefined);

        await expect(manager.setVideoQualitySelection('full-hd', player)).rejects.toThrow('new stream failed');

        expect(player.play).toHaveBeenCalledTimes(2);
        expect(player.streamInfo).toMatchObject({ url: originalStreamInfo.url });
        expect(fixture.stopActiveEncodings).not.toHaveBeenCalledWith('old-session');
    });

    it('does not stop a reused session ID after a successful quality switch', async () => {
        const { manager, player } = setupPlayback();
        fixture.postedPlaybackInfo.mockResolvedValue(response({
            ...source(),
            TranscodingUrl: '/Videos/movie-4k/master.m3u8?MaxWidth=1920&MaxHeight=1080&PlaySessionId=old-session'
        }));

        await manager.setVideoQualitySelection('full-hd', player);

        expect(player.play).toHaveBeenCalledOnce();
        expect(manager.playSessionId(player)).toBe('old-session');
        expect(fixture.stopActiveEncodings).not.toHaveBeenCalledWith('old-session');
    });

    it('keeps the previous encoding when the new transcoding URL has no session ID', async () => {
        const { manager, player } = setupPlayback();
        fixture.postedPlaybackInfo.mockResolvedValue(response({
            ...source(),
            TranscodingUrl: '/Videos/movie-4k/master.m3u8?MaxWidth=1920&MaxHeight=1080'
        }));

        await manager.setVideoQualitySelection('full-hd', player);

        expect(player.play).toHaveBeenCalledOnce();
        expect(manager.playSessionId(player)).toBeFalsy();
        expect(fixture.stopActiveEncodings).not.toHaveBeenCalledWith('old-session');
    });

    it('reports old-encoding cleanup failure without logging private stream data', async () => {
        const { manager, player } = setupPlayback();
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        fixture.stopActiveEncodings.mockRejectedValueOnce(new Error('ApiKey=private-secret'));

        try {
            await manager.setVideoQualitySelection('full-hd', player);

            expect(player.play).toHaveBeenCalledOnce();
            expect(manager.getVideoQualitySelection(player)).toBe('full-hd');
            expect(fixture.stopActiveEncodings).toHaveBeenCalledWith('old-session');
            expect(warning).toHaveBeenCalledWith('[playbackmanager] Could not retire previous encoding after quality switch.');
            expect(JSON.stringify(warning.mock.calls)).not.toContain('private-secret');
        } finally {
            warning.mockRestore();
        }
    });

    it('uses portrait-oriented dimensions for the negotiated manual ceiling', async () => {
        const { manager, player } = setupPlayback(1080, 1920);
        fixture.postedPlaybackInfo.mockResolvedValue(response({
            ...source(1080, 1920),
            TranscodingUrl: '/Videos/movie-4k/master.m3u8?MaxWidth=720&MaxHeight=1280&PlaySessionId=new-session&ApiKey=fixture-secret'
        }));

        await manager.setVideoQualitySelection('hd', player);

        const profile = requestedProfile();
        expect(hasCeiling(profile, 'Width', '720')).toBe(true);
        expect(hasCeiling(profile, 'Height', '1280')).toBe(true);
        expect(player.play).toHaveBeenCalledOnce();
        expect(manager.getVideoQualitySelection(player)).toBe('hd');
    });

    it('does not infer direct-play support from a 4K HEVC Main 10 source label', async () => {
        const { manager, player, baseProfile } = setupPlayback();
        player.streamInfo.mediaSource.MediaStreams[0].BitDepth = 10;

        await manager.setVideoQualitySelection('full-hd', player);

        expect(requestedProfile().DirectPlayProfiles).toEqual(baseProfile.DirectPlayProfiles);
        expect(player.play).toHaveBeenCalledWith(expect.objectContaining({ playMethod: 'Transcode' }));
        expect(manager.getVideoQualitySelection(player)).toBe('full-hd');
    });

    it('removes the manual profile ceiling when returning to Auto', async () => {
        const { manager, player, baseProfile } = setupPlayback();
        await manager.setVideoQualitySelection('full-hd', player);
        fixture.postedPlaybackInfo.mockResolvedValue(response({
            ...source(),
            SupportsDirectPlay: true,
            SupportsDirectStream: true,
            TranscodingUrl: undefined
        }));

        await manager.setVideoQualitySelection('auto', player);

        expect(requestedProfile()).toEqual(baseProfile);
        expect(manager.getVideoQualitySelection(player)).toBe('auto');
        expect(player.play).toHaveBeenCalledTimes(2);
        expect(player.play.mock.calls[1][0].playMethod).toBe('DirectPlay');
    });

    it('refreshes the connection estimate when Auto is reselected', async () => {
        const { manager, player } = setupPlayback();
        await manager.setVideoQualitySelection('full-hd', player);
        fixture.detectBitrate.mockResolvedValue(6_000_000);

        await manager.setVideoQualitySelection('auto', player);

        expect(manager.getVideoQualityConnectionBitrate(player)).toBe(6_000_000);
        await expect(manager.setVideoQualitySelection('4k', player)).rejects.toThrow();
    });

    it('allows Auto to replace a pre-existing custom bitrate preference', async () => {
        fixture.automaticBitrate.mockReturnValue(false);
        const { manager, player } = setupPlayback();
        expect(manager.getVideoQualitySelection(player)).toBeNull();

        await manager.setVideoQualitySelection('auto', player);

        expect(fixture.detectBitrate).toHaveBeenCalledOnce();
        expect(fixture.postedPlaybackInfo).toHaveBeenCalledOnce();
        expect(manager.getVideoQualitySelection(player)).toBe('auto');
    });

    it('can measure Auto when the initial connection bitrate is unavailable', async () => {
        fixture.maxStreamingBitrate.mockReturnValue(null);
        const { manager, player } = setupPlayback();
        expect(manager.getVideoQualityConnectionBitrate(player)).toBeNull();

        await manager.setVideoQualitySelection('auto', player);

        expect(fixture.detectBitrate).toHaveBeenCalledOnce();
        expect(manager.getVideoQualityConnectionBitrate(player)).toBe(12_000_000);
    });

    it('removes the manual ceiling for Original and keeps compatible direct playback', async () => {
        const { manager, player, baseProfile } = setupPlayback();
        await manager.setVideoQualitySelection('full-hd', player);
        fixture.postedPlaybackInfo.mockResolvedValue(response({
            ...source(),
            SupportsDirectPlay: true,
            SupportsDirectStream: true,
            TranscodingUrl: undefined
        }));

        await manager.setVideoQualitySelection('original', player);

        expect(requestedProfile()).toEqual(baseProfile);
        expect(manager.getVideoQualitySelection(player)).toBe('original');
        expect(player.play.mock.calls[1][0].playMethod).toBe('DirectPlay');
    });

    it('ignores an older negotiation after a newer quality selection completes', async () => {
        const { manager, player } = setupPlayback();
        const older = deferred<ReturnType<typeof response>>();
        fixture.postedPlaybackInfo.mockReturnValueOnce(older.promise).mockResolvedValueOnce(response({
            ...source(),
            TranscodingUrl: '/Videos/movie-4k/master.m3u8?MaxWidth=1280&MaxHeight=720&PlaySessionId=new-session&ApiKey=fixture-secret'
        }));

        const first = manager.setVideoQualitySelection('full-hd', player);
        await vi.waitFor(() => expect(fixture.postedPlaybackInfo).toHaveBeenCalledTimes(1));
        const second = manager.setVideoQualitySelection('hd', player);
        await second;
        older.resolve(response());
        await first;

        expect(player.play).toHaveBeenCalledOnce();
        expect(manager.getVideoQualitySelection(player)).toBe('hd');
    });

    it('keeps playback unchanged when a restricted server offers no eligible stream', async () => {
        const { manager, player, originalStreamInfo } = setupPlayback();
        fixture.postedPlaybackInfo.mockResolvedValue(response({
            ...source(),
            SupportsTranscoding: false,
            TranscodingUrl: undefined
        }));

        await expect(manager.setVideoQualitySelection('full-hd', player)).rejects.toThrow();

        expect(fixture.stopActiveEncodings).not.toHaveBeenCalled();
        expect(player.play).not.toHaveBeenCalled();
        expect(player.streamInfo).toBe(originalStreamInfo);
    });

    it('reports a server playback-info error instead of silently accepting the selected label', async () => {
        const { manager, player, originalStreamInfo } = setupPlayback();
        fixture.postedPlaybackInfo.mockResolvedValue({ data: { ErrorCode: 'NoCompatibleStream', MediaSources: [] } });

        await expect(manager.setVideoQualitySelection('full-hd', player)).rejects.toThrow();

        expect(player.streamInfo).toBe(originalStreamInfo);
        expect(manager.getVideoQualitySelection(player)).toBe('auto');
        expect(fixture.stopActiveEncodings).not.toHaveBeenCalled();
    });

    it('lets a deliberate Full HD selection override a 3 Mbps Auto estimate', async () => {
        const { manager, player, originalStreamInfo } = setupPlayback();
        fixture.maxStreamingBitrate.mockReturnValue(3_000_000);

        await manager.setVideoQualitySelection('full-hd', player);

        expect(fixture.postedPlaybackInfo.mock.calls[0][0].playbackInfoDto.MaxStreamingBitrate).toBe(4_000_000);
        expect(player.streamInfo).not.toBe(originalStreamInfo);
        expect(manager.getVideoQualitySelection(player)).toBe('full-hd');
    });

    it('enforces a remote user bitrate limit but does not apply it to a local connection', async () => {
        const { manager, player, originalStreamInfo } = setupPlayback();
        fixture.maxStreamingBitrate.mockReturnValue(3_000_000);
        fixture.apiClient.getCurrentUser = () => Promise.resolve({ Policy: { RemoteClientBitrateLimit: 3_000_000 } });

        await expect(manager.setVideoQualitySelection('full-hd', player)).rejects.toThrow();

        expect(fixture.postedPlaybackInfo).not.toHaveBeenCalled();
        expect(player.streamInfo).toBe(originalStreamInfo);

        fixture.apiClient.getEndpointInfo = () => Promise.resolve({ IsInNetwork: true });
        await manager.setVideoQualitySelection('full-hd', player);

        expect(fixture.postedPlaybackInfo.mock.calls[0][0].playbackInfoDto.MaxStreamingBitrate).toBe(4_000_000);
    });

    it('omits the client bitrate cap for Original when source bitrate metadata is absent', async () => {
        const { manager, player } = setupPlayback();
        fixture.maxStreamingBitrate.mockReturnValue(3_000_000);
        player.streamInfo.mediaSource.Bitrate = undefined;
        for (const stream of player.streamInfo.mediaSource.MediaStreams) stream.BitRate = undefined;

        await manager.setVideoQualitySelection('original', player);

        expect(fixture.postedPlaybackInfo.mock.calls[0][0].playbackInfoDto.MaxStreamingBitrate).toBeUndefined();
        expect(manager.getVideoQualitySelection(player)).toBe('original');
    });

    it('rejects a tier before PlaybackInfo when the remote user limit is below its low profile', async () => {
        const { manager, player, originalStreamInfo } = setupPlayback();
        fixture.apiClient.getCurrentUser = () => Promise.resolve({ Policy: { RemoteClientBitrateLimit: 500_000 } });

        await expect(manager.setVideoQualitySelection('hd', player)).rejects.toThrow();

        expect(fixture.postedPlaybackInfo).not.toHaveBeenCalled();
        expect(fixture.stopActiveEncodings).not.toHaveBeenCalled();
        expect(player.play).not.toHaveBeenCalled();
        expect(player.streamInfo).toBe(originalStreamInfo);
    });
});
