import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServerConnections } from '../../../lib/jellyfin-apiclient';
import appSettings from '../../../scripts/settings/appSettings';
import HtmlVideoPlayer from '../../../plugins/htmlVideoPlayer/plugin';

const fixture = vi.hoisted(() => ({ getApiClient: vi.fn() }));

vi.mock('../../../lib/jellyfin-apiclient', () => ({ ServerConnections: { getApiClient: fixture.getApiClient } }));
vi.mock('../../../components/apphost', () => ({ appHost: { supports: () => false } }));
vi.mock('../../../scripts/settings/webSettings', () => ({ getIncludeCorsCredentials: async () => false }));
vi.mock('../../../components/playback/playbackmanager', () => ({ playbackManager: {} }));
vi.mock('../../../components/router/appRouter', () => ({ appRouter: {} }));
vi.mock('../../../components/loading/loading', () => ({ default: { show: () => undefined, hide: () => undefined } }));
vi.mock('../../../scripts/browser', () => ({ default: { supportsCssAnimation: () => false } }));
vi.mock('../../../lib/globalize', () => ({ default: { translate: (value: string) => value } }));
vi.mock('apps/stable/features/playback/utils/subtitleStyles', () => ({ useCustomSubtitles: () => false }));
vi.mock('../../../plugins/htmlVideoPlayer/style.scss', () => ({}));

const item = { Id: 'episode-a', ServerId: 'server-a', Type: 'Episode', MediaType: 'Video' };
const subtitleA = { Type: 'Subtitle', Index: 2, Codec: 'subrip', DeliveryMethod: 'External', IsExternal: true };
const subtitleB = { Type: 'Subtitle', Index: 4, Codec: 'subrip', DeliveryMethod: 'External', IsExternal: true };
type SubtitleTrack = typeof subtitleA;
type SubtitleData = ReturnType<typeof subtitleData>;
type SubtitleInternals = {
    _currentPlayOptions: object;
    createMediaElement(options: { fullscreen: boolean }): Promise<HTMLVideoElement>;
    fetchSubtitles(track: SubtitleTrack, currentItem: typeof item): Promise<SubtitleData>;
    setTrackForDisplay(video: HTMLVideoElement, track: SubtitleTrack | null, targetIndex?: number): void;
    setCurrentTrackElement(index: number): void;
    disposePtvPlaybackSession(reason: string): void;
    setCueAppearance(): void;
};

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(res => {
        resolve = res;
    });
    return { promise, resolve };
}

function subtitleData(text: string) {
    return {
        TrackEvents: [{ StartPositionTicks: 0, EndPositionTicks: 100000000, Text: text }]
    };
}

function createNativeTracks(video: HTMLVideoElement) {
    type Cue = { text: string; line: string };
    type ManualTrack = {
        label: string;
        mode: string;
        cues: Cue[];
        addCue(cue: Cue): void;
        removeCue(cue: Cue): void;
    };
    const tracks: ManualTrack[] = [];
    Object.defineProperty(video, 'textTracks', { configurable: true, get: () => tracks });
    Object.defineProperty(video, 'addTextTrack', {
        configurable: true,
        value: () => {
            const track: ManualTrack = {
                label: 'manualTrack',
                mode: 'disabled',
                cues: [],
                addCue(cue) { this.cues.push(cue); },
                removeCue(cue) { this.cues.splice(this.cues.indexOf(cue), 1); }
            };
            tracks.push(track);
            return track;
        }
    });
    Object.defineProperty(window, 'VTTCue', {
        configurable: true,
        value: class {
            line = 'auto';
            constructor(_start: number, _end: number, readonly text: string) {}
        }
    });
    return tracks;
}

async function createPlayer(playMethod = 'DirectPlay') {
    const player = new HtmlVideoPlayer();
    const internal = player as unknown as SubtitleInternals;
    internal._currentPlayOptions = {
        item,
        playMethod,
        mediaSource: { Container: 'mp4', MediaStreams: [subtitleA, subtitleB] }
    };
    const video = await internal.createMediaElement({ fullscreen: false });
    return { player, internal, video };
}

describe('HTML video subtitle selection ownership', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.spyOn(console, 'debug').mockImplementation(() => undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = '';
    });

    it('does not restore A after B has rendered when A fetch settles last', async () => {
        const { internal, video } = await createPlayer();
        const tracks = createNativeTracks(video);
        const a = deferred<ReturnType<typeof subtitleData>>();
        const b = deferred<ReturnType<typeof subtitleData>>();
        vi.spyOn(internal, 'fetchSubtitles').mockImplementation(track => track.Index === 2 ? a.promise : b.promise);

        internal.setTrackForDisplay(video, subtitleA);
        internal.setTrackForDisplay(video, subtitleB);
        b.resolve(subtitleData('B'));
        await b.promise;
        await Promise.resolve();
        expect(tracks[0].cues.map(cue => cue.text)).toEqual(['\u200eB']);

        a.resolve(subtitleData('A'));
        await a.promise;
        await Promise.resolve();
        expect(tracks[0].cues.map(cue => cue.text)).toEqual(['\u200eB']);
    });

    it('keeps subtitles disabled when A fetch settles after Off', async () => {
        const { internal, video } = await createPlayer();
        const tracks = createNativeTracks(video);
        const a = deferred<ReturnType<typeof subtitleData>>();
        vi.spyOn(internal, 'fetchSubtitles').mockReturnValue(a.promise);

        internal.setTrackForDisplay(video, subtitleA);
        internal.setTrackForDisplay(video, null);
        expect(tracks[0].mode).toBe('disabled');

        a.resolve(subtitleData('A'));
        await a.promise;
        await Promise.resolve();
        expect(tracks[0].mode).toBe('disabled');
        expect(tracks[0].cues).toEqual([]);
    });

    it('restarts the same subtitle after a source replacement retires its pending fetch', async () => {
        const { internal, video } = await createPlayer();
        const tracks = createNativeTracks(video);
        const oldSource = deferred<SubtitleData>();
        const newSource = deferred<SubtitleData>();
        const fetchSubtitles = vi.spyOn(internal, 'fetchSubtitles')
            .mockReturnValueOnce(oldSource.promise)
            .mockReturnValueOnce(newSource.promise);

        internal.setTrackForDisplay(video, subtitleA);
        internal.disposePtvPlaybackSession('source-replaced');
        internal._currentPlayOptions = {
            item,
            playMethod: 'DirectPlay',
            mediaSource: { Container: 'mp4', MediaStreams: [subtitleA, subtitleB] }
        };
        internal.setTrackForDisplay(video, subtitleA);
        expect(fetchSubtitles).toHaveBeenCalledTimes(2);

        newSource.resolve(subtitleData('new A'));
        await newSource.promise;
        await Promise.resolve();
        oldSource.resolve(subtitleData('old A'));
        await oldSource.promise;
        await Promise.resolve();
        expect(tracks[0].cues.map(cue => cue.text)).toEqual(['\u200enew A']);
    });

    it('does not render an old A fetch after Off is requested but while session readback is pending', async () => {
        const { internal, video } = await createPlayer('Transcode');
        const tracks = createNativeTracks(video);
        const a = deferred<SubtitleData>();
        const offSession = deferred<unknown[]>();
        vi.spyOn(internal, 'fetchSubtitles').mockReturnValue(a.promise);
        vi.spyOn(appSettings, 'alwaysBurnInSubtitleWhenTranscoding').mockReturnValue(true);
        vi.spyOn(ServerConnections, 'getApiClient').mockReturnValue({
            deviceId: () => 'local-device',
            getSessions: () => offSession.promise
        } as ReturnType<typeof ServerConnections.getApiClient>);

        internal.setTrackForDisplay(video, subtitleA);
        internal.setCurrentTrackElement(-1);
        a.resolve(subtitleData('A'));
        await a.promise;
        await Promise.resolve();
        expect(tracks[0].mode).toBe('disabled');
        expect(tracks[0].cues).toEqual([]);
    });

    it('lets a pending A fetch finish after the same A is selected again', async () => {
        const { internal, video } = await createPlayer();
        const tracks = createNativeTracks(video);
        const a = deferred<SubtitleData>();
        const fetchSubtitles = vi.spyOn(internal, 'fetchSubtitles').mockReturnValue(a.promise);
        vi.spyOn(internal, 'setCueAppearance').mockImplementation(() => undefined);

        internal.setTrackForDisplay(video, subtitleA);
        internal.setCurrentTrackElement(2);
        await Promise.resolve();
        expect(fetchSubtitles).toHaveBeenCalledTimes(1);

        a.resolve(subtitleData('A'));
        await a.promise;
        await Promise.resolve();
        expect(tracks[0].mode).toBe('showing');
        expect(tracks[0].cues.map(cue => cue.text)).toEqual(['\u200eA']);
    });

    it('keeps a pending primary subtitle valid when a secondary subtitle is selected', async () => {
        const { internal, video } = await createPlayer();
        const tracks = createNativeTracks(video);
        const primary = deferred<SubtitleData>();
        const secondary = deferred<SubtitleData>();
        vi.spyOn(internal, 'fetchSubtitles').mockImplementation(track => track.Index === 2 ? primary.promise : secondary.promise);

        internal.setTrackForDisplay(video, subtitleA);
        internal.setTrackForDisplay(video, subtitleB, 1);
        primary.resolve(subtitleData('primary A'));
        await primary.promise;
        await Promise.resolve();
        secondary.resolve(subtitleData('secondary B'));
        await secondary.promise;
        await Promise.resolve();

        expect(tracks[0].mode).toBe('showing');
        expect(tracks[0].cues.map(cue => cue.text)).toEqual(['\u200eprimary A']);
        expect(tracks[1].mode).toBe('showing');
        expect(tracks[1].cues.map(cue => cue.text)).toEqual(['\u200esecondary B']);
    });

    it('disables an active native subtitle through the direct Off selection path', async () => {
        const { internal, video } = await createPlayer();
        const tracks = createNativeTracks(video);
        vi.spyOn(internal, 'fetchSubtitles').mockResolvedValue(subtitleData('A'));

        internal.setTrackForDisplay(video, subtitleA);
        await Promise.resolve();
        expect(tracks[0].mode).toBe('showing');

        internal.setCurrentTrackElement(-1);
        await Promise.resolve();
        expect(tracks[0].mode).toBe('disabled');
    });

    it('does not adopt a delayed A session result after Off', async () => {
        const { internal } = await createPlayer('Transcode');
        const a = deferred<unknown[]>();
        const off = deferred<unknown[]>();
        const sessions = [a, off];
        vi.spyOn(appSettings, 'alwaysBurnInSubtitleWhenTranscoding').mockReturnValue(true);
        vi.spyOn(ServerConnections, 'getApiClient').mockReturnValue({
            deviceId: () => 'local-device',
            getSessions: () => sessions.shift()!.promise
        } as ReturnType<typeof ServerConnections.getApiClient>);
        const applied = vi.spyOn(internal, 'setTrackForDisplay').mockImplementation(() => undefined);

        internal.setCurrentTrackElement(2);
        internal.setCurrentTrackElement(-1);
        off.resolve([{}]);
        await off.promise;
        await Promise.resolve();
        expect(applied).toHaveBeenCalledWith(expect.anything(), null, undefined);

        a.resolve([{}]);
        await a.promise;
        await Promise.resolve();
        expect(applied).toHaveBeenCalledTimes(1);
    });
});
