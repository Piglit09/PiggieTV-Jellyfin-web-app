import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import appSettings from '../../scripts/settings/appSettings';
import Events from '../../utils/events';
import HtmlAudioPlayer from './plugin';

// The player, DOM source, media helper, volume storage, fade timer and Events
// remain real. jsdom supplies no decoder, so only native play/pause are stubbed.
vi.mock('../../scripts/browser', () => ({ default: { tv: false, safari: false } }));
vi.mock('../../components/apphost', () => ({ appHost: { supports: () => false } }));
vi.mock('../../scripts/browserDeviceProfile', () => ({ default: () => ({}) }));
vi.mock('../../scripts/settings/userSettings', () => ({ selectAudioNormalization: () => 'None' }));
vi.mock('../../scripts/settings/webSettings', () => ({ getIncludeCorsCredentials: async () => false }));

function audioOptions(id: string) {
    return {
        url: `/offline/${id}.mp3`,
        item: { Id: id, Type: 'Audio', MediaType: 'Audio' },
        mediaSource: { IsRemote: false, RunTimeTicks: 600_000_000, MediaStreams: [] }
    };
}

async function playTheme() {
    const player = new HtmlAudioPlayer();
    await player.play(audioOptions('theme-a'));
    const audio = document.querySelector('audio.mediaPlayerAudio');
    if (!(audio instanceof HTMLAudioElement)) throw new Error('Audio player did not create its media element');
    player.setVolume(90);
    audio.dispatchEvent(new Event('volumechange'));
    return { player, audio };
}

async function replaceDuringFade() {
    const { player, audio } = await playTheme();
    const stopped = vi.fn();
    Events.on(player, 'stopped', stopped);
    let originalStopSettled = false;
    void player.stop(true).then(() => {
        originalStopSettled = true;
    });
    await vi.advanceTimersByTimeAsync(100);

    // PlaybackManager's same-player handoff uses stop(false), then play(new).
    await player.stop(false);
    await player.play(audioOptions('manual-b'));
    await vi.advanceTimersByTimeAsync(1_000);

    return { player, audio, originalStopSettled, stopped };
}

describe('actual HTML audio theme-stop handoff', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
        localStorage.clear();
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
        vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('completes an uninterrupted desktop stop fade and restores the selected volume', async () => {
        const { player, audio } = await playTheme();
        const stop = player.stop(true);
        await vi.advanceTimersByTimeAsync(1_000);
        await stop;

        expect(player.currentSrc()).toBeNull();
        expect(audio.hasAttribute('src')).toBe(false);
        expect(audio.volume).toBeCloseTo(0.729, 12);
    });

    it('restores the selected volume when a manual source replaces a fading theme', async () => {
        const { player, audio } = await replaceDuringFade();

        expect(player.currentSrc()).toBe('/offline/manual-b.mp3');
        expect(audio.getAttribute('src')).toBe('/offline/manual-b.mp3');
        expect(audio.volume).toBeCloseTo(0.729, 12);
    });

    it('resumes time and volume events after the manual source replaces a fading theme', async () => {
        const { player, audio } = await replaceDuringFade();
        const timeUpdate = vi.fn();
        const volumeChange = vi.fn();
        Events.on(player, 'timeupdate', timeUpdate);
        Events.on(player, 'volumechange', volumeChange);

        audio.currentTime = 12;
        audio.dispatchEvent(new Event('timeupdate'));
        audio.volume = 0.512;
        // The real DOM setter schedules volumechange; dispatching another one
        // would count two browser events for this single deliberate adjustment.
        await vi.advanceTimersByTimeAsync(0);

        expect(timeUpdate).toHaveBeenCalledOnce();
        expect(volumeChange).toHaveBeenCalledOnce();
        expect(Number(appSettings.get('volume'))).toBeCloseTo(0.512, 12);
    });

    it('settles the canceled stop without retiring the newer manual source', async () => {
        const { player, audio, originalStopSettled, stopped } = await replaceDuringFade();

        expect(originalStopSettled).toBe(true);
        expect(stopped).toHaveBeenCalledOnce();
        expect(player.currentSrc()).toBe('/offline/manual-b.mp3');
        expect(audio.getAttribute('src')).toBe('/offline/manual-b.mp3');
    });
});
