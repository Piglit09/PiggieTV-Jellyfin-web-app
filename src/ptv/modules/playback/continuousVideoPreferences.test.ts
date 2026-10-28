import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Events from '../../../utils/events';
import appSettings from '../../../scripts/settings/appSettings';
import HtmlVideoPlayer from '../../../plugins/htmlVideoPlayer/plugin';
import HtmlAudioPlayer from '../../../plugins/htmlAudioPlayer/plugin';

type PreferencePlayer = {
    id: string;
    name: string;
    setVolume(value: number): void;
};

type PlaybackItem = {
    Id: string;
    ServerId: string;
    MediaType: string;
    Type: string;
    Name: string;
};

const fixture = vi.hoisted(() => {
    const state = {
        player: null as PreferencePlayer | null,
        item: null as PlaybackItem | null,
        sessionId: 'session-1',
        destroyModule: null as (() => void) | null
    };

    const manager = {
        _callbacks: {},
        currentItem: () => state.item,
        currentMediaSource: () => null,
        getCurrentPlayer: () => state.player,
        getPlayerState: () => ({
            NowPlayingItem: state.item,
            PlayState: {
                IsPaused: false,
                PlaySessionId: state.sessionId,
                PositionTicks: 0
            }
        }),
        playMethod: () => 'DirectPlay',
        playSessionId: () => state.sessionId,
        // This fixture has software volume control. Keep the native player
        // setter and its volumechange persistence real.
        setVolume: (value: number, player: PreferencePlayer) => player.setVolume(value)
    };

    return { manager, state };
});

// Isolate network, navigation and unrelated presentation collaborators. The
// complete PTV start/stop hooks, native players, media helper, Events and
// appSettings remain real; assertions observe the media element and storage.
vi.mock('../../../components/playback/playbackmanager', () => ({ playbackManager: fixture.manager }));
vi.mock('../../../lib/jellyfin-apiclient', () => ({ ServerConnections: { getApiClient: () => null } }));
vi.mock('../../../components/router/appRouter', () => ({ appRouter: {} }));
vi.mock('../../../scripts/browser', () => ({ default: { supportsCssAnimation: () => false } }));
vi.mock('../../../components/apphost', () => ({
    appHost: { supports: (feature: string) => feature === 'htmlvideoautoplay' }
}));
vi.mock('../../../components/loading/loading', () => ({ default: { show: () => undefined, hide: () => undefined } }));
vi.mock('../../../components/itemHelper', () => ({ default: {} }));
vi.mock('../../../lib/globalize', () => ({ default: { translate: (value: string) => value } }));
vi.mock('../../../scripts/browserDeviceProfile', () => ({
    default: () => ({}),
    canPlaySecondaryAudio: () => false
}));
vi.mock('../../../scripts/settings/userSettings', () => ({
    currentSettings: {},
    selectAudioNormalization: () => 'None'
}));
vi.mock('../../../scripts/settings/webSettings', () => ({ getIncludeCorsCredentials: async () => false }));
vi.mock('../../../components/backdrop/backdrop', () => ({
    setBackdropTransparency: () => undefined,
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Matches the existing backdrop export.
    TRANSPARENCY_LEVEL: { None: 0 }
}));
vi.mock('apps/stable/features/playback/utils/subtitleStyles', () => ({ useCustomSubtitles: () => false }));
vi.mock('components/subtitlesettings/subtitleappearancehelper', () => ({ default: {} }));
vi.mock('screenfull', () => ({ default: { isEnabled: false } }));
vi.mock('../../core/lifecycle', () => ({
    registerModule: ({ destroy }: { destroy: () => void }) => {
        fixture.state.destroyModule = destroy;
    }
}));
vi.mock('../../core/imageManager', () => ({ cancelPtvImageScope: () => undefined, loadPtvImage: () => undefined }));
vi.mock('../../core/observer', () => ({ watchDom: () => () => undefined }));
vi.mock('../../core/clientProfile', () => ({ getPtvClientProfile: () => ({ isTv: false }) }));
vi.mock('../../core/featureSettings', () => ({
    getPtvPlaybackMode: () => 'compatible',
    isPtvPlaybackMode: () => false
}));
vi.mock('../../core/observability', () => ({ recordPtvEvent: () => undefined }));
vi.mock('../../core/tvFocus', () => ({
    notifyPtvTvFocusContentReady: () => undefined,
    notifyPtvTvPlaybackFocus: () => undefined,
    notifyPtvTvPlaybackSurfaceReady: () => undefined,
    registerPtvTvPlaybackBackHandler: () => () => undefined
}));
vi.mock('../../services/playbackPresentationService', () => ({
    setPtvVideoPlaybackPresentation: () => undefined,
    getPtvPlaybackPresentation: () => ({ playbackActive: false, controlsVisible: false })
}));
vi.mock('./playbackChrome', () => ({}));
vi.mock('./playback.scss', () => ({}));
vi.mock('../../../plugins/htmlVideoPlayer/style.scss', () => ({}));

function episode(id = 'episode-1'): PlaybackItem {
    return { Id: id, ServerId: 'server-1', MediaType: 'Video', Type: 'Episode', Name: id };
}

function startPlayback(player: PreferencePlayer, item = episode(), sessionId = 'session-1') {
    fixture.state.player = player;
    fixture.state.item = item;
    fixture.state.sessionId = sessionId;
    Events.trigger(fixture.manager, 'playbackstart', [player, fixture.manager.getPlayerState()]);
}

async function createVideoPlayer() {
    const player = new HtmlVideoPlayer();
    const video = await playVideo(player);
    startPlayback(player);

    return { player, video };
}

function streamOptions(item: PlaybackItem) {
    return {
        item,
        fullscreen: false,
        playMethod: 'DirectPlay',
        url: `/offline/${item.Id}.mp4`,
        mediaSource: {
            IsRemote: false,
            Container: 'mp4',
            RunTimeTicks: 600000000,
            DefaultAudioStreamIndex: -1,
            DefaultSubtitleStreamIndex: -1,
            DefaultSecondarySubtitleStreamIndex: -1,
            MediaStreams: []
        }
    };
}

async function playVideo(player: HtmlVideoPlayer, item = episode()) {
    await player.play(streamOptions(item));
    const video = document.querySelector('video.htmlvideoplayer');

    if (!(video instanceof HTMLVideoElement)) throw new Error('Native playback did not create a video element');

    return video;
}

type Transition = 'manual Next' | 'autoplay';

async function nextEpisode(
    transition: Transition,
    player: HtmlVideoPlayer,
    video: HTMLVideoElement,
    adjustDuringTransition?: () => void,
    nextId = 'episode-2'
) {
    const nextItem = episode(nextId);
    const stopInfo = {
        player,
        state: fixture.manager.getPlayerState(),
        nextItem,
        nextMediaType: 'Video'
    };

    if (transition === 'autoplay') {
        let endedStops = 0;
        const reportEnded = () => {
            endedStops += 1;
            Events.trigger(fixture.manager, 'playbackstop', [stopInfo]);
        };
        Events.on(player, 'stopped', reportEnded);
        video.dispatchEvent(new Event('ended'));
        Events.off(player, 'stopped', reportEnded);
        expect(endedStops).toBe(1);
    }

    // PlaybackManager stops without destruction when Next retains the player.
    // Native ended emits stopped by itself on the autoplay path.
    if (transition !== 'autoplay') {
        await player.stop(false);
        Events.trigger(fixture.manager, 'playbackstop', [stopInfo]);
    }
    adjustDuringTransition?.();

    const reusedVideo = await playVideo(player, nextItem);
    expect(reusedVideo).toBe(video);
    expect(reusedVideo.getAttribute('src')).toBe(`/offline/${nextId}.mp4`);
    startPlayback(player, nextItem, `session-${nextId.split('-')[1]}`);

    return reusedVideo;
}

describe('continuous HTML video preferences', () => {
    beforeEach(async () => {
        vi.useFakeTimers();
        vi.resetModules();
        document.body.innerHTML = '';
        document.body.className = '';
        document.documentElement.className = '';
        localStorage.clear();
        fixture.manager._callbacks = {};
        fixture.state.player = null;
        fixture.state.item = null;
        fixture.state.sessionId = 'session-1';
        fixture.state.destroyModule = null;
        // jsdom has no decoder. Keep source assignment, element reuse and all
        // preference events real while replacing only native decoder entrypoints.
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
        vi.spyOn(console, 'debug').mockImplementation(() => undefined);
        await import('./index');
    });

    afterEach(async () => {
        fixture.state.destroyModule?.();
        if (fixture.state.player instanceof HtmlVideoPlayer) await fixture.state.player.stop(true);
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it.each<Transition>(['manual Next', 'autoplay'])('preserves selected gain and true mute through %s', async transition => {
        const { player, video } = await createVideoPlayer();
        player.setVolume(35);
        player.setMute(true);

        const reusedVideo = await nextEpisode(transition, player, video);

        expect(player.getVolume()).toBe(35);
        expect(reusedVideo.volume).toBeCloseTo(0.042875, 12);
        expect(player.isMuted()).toBe(true);
        expect(reusedVideo.muted).toBe(true);
        expect(Number(appSettings.get('volume'))).toBeCloseTo(0.042875, 12);
    });

    it('restores the custom control surface through five episode transitions', async () => {
        window.location.hash = '#/video';
        document.body.insertAdjacentHTML('beforeend', '<div id="videoOsdPage" class="videoOsdPage"><div class="videoOsdBottom"><div class="osdControls"></div></div></div>');
        const { player, video } = await createVideoPlayer();
        const control = document.querySelector('.videoOsdBottom') as HTMLElement;

        for (let generation = 2; generation <= 6; generation++) {
            const nextItem = episode(`episode-${generation}`);
            const stopInfo = { player, state: fixture.manager.getPlayerState(), nextItem, nextMediaType: 'Video' };
            await player.stop(false);
            Events.trigger(fixture.manager, 'playbackstop', [stopInfo]);
            const reusedVideo = await playVideo(player, nextItem);
            expect(reusedVideo).toBe(video);
            startPlayback(player, nextItem, `session-${generation}`);
            expect(control.classList.contains('ptv-player-chrome')).toBe(true);
            Events.trigger(document, 'showVideoOsd', [true]);
            expect(control.classList.contains('ptv-player-chrome-forced-visible')).toBe(true);
            expect(document.querySelector('.ptv-player-chrome-root')).not.toBeNull();
        }
        window.location.hash = '';
    });

    it('recovers the control surface through five native ended events and autoplay handoffs', async () => {
        window.location.hash = '#/video';
        document.body.insertAdjacentHTML('beforeend', '<div id="videoOsdPage" class="videoOsdPage"><div class="videoOsdBottom"><div class="osdControls"></div></div></div>');
        const { player, video } = await createVideoPlayer();
        const control = document.querySelector('.videoOsdBottom') as HTMLElement;
        let activeVideo = video;

        for (let generation = 2; generation <= 6; generation++) {
            activeVideo = await nextEpisode('autoplay', player, activeVideo, undefined, `episode-${generation}`);
            Events.trigger(document, 'showVideoOsd', [true]);
            expect(control.classList.contains('ptv-player-chrome-forced-visible')).toBe(true);
            expect(fixture.state.item?.Id).toBe(`episode-${generation}`);
        }
        window.location.hash = '';
    });

    it('uses native video controls while Safari owns video fullscreen', async () => {
        window.location.hash = '#/video';
        const { video } = await createVideoPlayer();
        expect(video.controls).toBe(false);
        video.dispatchEvent(new Event('webkitbeginfullscreen'));
        expect(video.controls).toBe(true);
        video.controls = false;
        video.dispatchEvent(new Event('playing'));
        expect(video.controls).toBe(true);
        video.dispatchEvent(new Event('webkitendfullscreen'));
        expect(video.controls).toBe(false);
        window.location.hash = '';
    });

    it.each<Transition>(['manual Next', 'autoplay'])('keeps slider-zero silence through %s', async transition => {
        const { player, video } = await createVideoPlayer();
        player.setVolume(0);
        player.setMute(false);

        await nextEpisode(transition, player, video);

        expect(player.getVolume()).toBe(0);
        expect(video.volume).toBe(0);
        expect(video.muted).toBe(false);
        expect(appSettings.get('volume')).toBe('0');
    });

    it.each<Transition>(['manual Next', 'autoplay'])('keeps the latest user selection made during %s', async transition => {
        const { player, video } = await createVideoPlayer();
        player.setVolume(35);
        player.setMute(true);

        await nextEpisode(transition, player, video, () => {
            player.setVolume(64);
            player.setMute(false);
        });

        expect(player.getVolume()).toBe(64);
        expect(video.volume).toBeCloseTo(0.262144, 12);
        expect(video.muted).toBe(false);
        expect(Number(appSettings.get('volume'))).toBeCloseTo(0.262144, 12);
    });

    it.each([
        ['repeated start', 'episode-1', 'session-1'],
        ['changed item', 'episode-2', 'session-1'],
        ['changed play session', 'episode-1', 'session-2']
    ])('does not overwrite the retained element on %s', async (_scenario, itemId, sessionId) => {
        const { player, video } = await createVideoPlayer();
        player.setVolume(35);
        player.setMute(true);

        startPlayback(player, episode(itemId), sessionId);

        expect(player.getVolume()).toBe(35);
        expect(video.volume).toBeCloseTo(0.042875, 12);
        expect(video.muted).toBe(true);
    });

    it('retains fresh-element defaults after full teardown rather than persisting mute', async () => {
        appSettings.set('volume', '0.512');
        const { player, video } = await createVideoPlayer();
        expect(player.getVolume()).toBe(50);
        expect(video.muted).toBe(false);

        player.setVolume(35);
        player.setMute(true);
        await player.stop(true);

        const freshVideo = await playVideo(player, episode('episode-fresh'));
        startPlayback(player, episode('episode-fresh'), 'session-fresh');

        expect(freshVideo).not.toBe(video);
        expect(player.getVolume()).toBe(50);
        expect(freshVideo.volume).toBe(0.125);
        expect(freshVideo.muted).toBe(false);
    });

    it('retains existing HTML audio startup enforcement', async () => {
        const player = new HtmlAudioPlayer();
        const item = { ...episode('audio-1'), MediaType: 'Audio', Type: 'Audio' };
        await player.play(streamOptions(item));
        const audio = document.querySelector('audio.mediaPlayerAudio');
        if (!(audio instanceof HTMLAudioElement)) throw new Error('Native playback did not create an audio element');
        player.setVolume(35);
        player.setMute(true);

        startPlayback(player, item);

        expect(player.getVolume()).toBe(50);
        expect(audio.volume).toBe(0.125);
        expect(audio.muted).toBe(true);
    });

    it('retains existing remote video startup enforcement', () => {
        let remoteVolume = 35;
        const remotePlayer = {
            id: 'sessionplayer',
            name: 'Remote Video Player',
            setVolume: (value: number) => { remoteVolume = value; }
        };

        startPlayback(remotePlayer);

        expect(remoteVolume).toBe(50);
    });
});
