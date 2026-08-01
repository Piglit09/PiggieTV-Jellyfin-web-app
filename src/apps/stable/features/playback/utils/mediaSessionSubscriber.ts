import { MediaType } from '@jellyfin/sdk/lib/generated-client/models/media-type';

import { getImageUrl } from 'apps/stable/features/playback/utils/image';
import { getItemTextLines } from 'apps/stable/features/playback/utils/itemText';
import { PlaybackSubscriber } from 'apps/stable/features/playback/utils/playbackSubscriber';
import type { PlaybackManager } from 'components/playback/playbackmanager';
import { MILLISECONDS_PER_SECOND, TICKS_PER_MILLISECOND } from 'constants/time';
import browser from 'scripts/browser';
import shell from 'scripts/shell';
import type { ItemDto } from 'types/base/models/item-dto';
import type { PlayerState } from 'types/playbackStopInfo';
import type { Event } from 'utils/events';

/** The default image resolutions to provide to the media session.
 *
 * Highest-to-lowest order matters; Firefox on Linux seems to use the first
 * image in the artwork array for its MPRIS interface. (#7630)
 */
const DEFAULT_IMAGE_SIZES = [512, 384, 256, 192, 128, 96];

const hasNavigatorSession = 'mediaSession' in navigator;
const hasNativeShell = !!window.NativeShell;

export type PtvExternalMediaSessionState = Readonly<{
    active: boolean;
    album?: string;
    artist?: string;
    durationTicks?: number;
    imageUrl?: string;
    name?: string;
    paused: boolean;
    positionTicks?: number;
}>;

export type PtvExternalMediaSessionController = Readonly<{
    next: () => unknown;
    pause: () => unknown;
    play: () => unknown;
    previous: () => unknown;
    seekTo: (positionSeconds: number) => unknown;
    stop: () => unknown;
}>;

let externalMediaSession: Readonly<{
    controller: PtvExternalMediaSessionController;
    state: PtvExternalMediaSessionState;
}> | null = null;

const getArtwork = (item: ItemDto): MediaImage[] => {
    const artwork: MediaImage[] = [];

    DEFAULT_IMAGE_SIZES.forEach(height => {
        const src = getImageUrl(item, { height });
        if (src) {
            artwork.push({
                src,
                sizes: `${height}x${height}`
            });
        }
    });

    return artwork;
};

const resetMediaSession = () => {
    if (hasNavigatorSession) {
        navigator.mediaSession.metadata = null;
    } else if (hasNativeShell) {
        shell.hideMediaSession();
    }
};

function updateExternalMediaSessionPresentation(state: PtvExternalMediaSessionState) {
    const durationMs = state.durationTicks ? Math.round(state.durationTicks / TICKS_PER_MILLISECOND) : 0;
    const positionMs = state.positionTicks ? Math.round(state.positionTicks / TICKS_PER_MILLISECOND) : 0;

    if (hasNavigatorSession) {
        navigator.mediaSession.metadata = new MediaMetadata({
            album: state.album,
            artist: state.artist,
            artwork: state.imageUrl ? [{ src: state.imageUrl }] : [],
            title: state.name || 'Now Playing'
        });
        navigator.mediaSession.playbackState = state.paused ? 'paused' : 'playing';

        if (durationMs > 0 && typeof navigator.mediaSession.setPositionState === 'function') {
            try {
                navigator.mediaSession.setPositionState({
                    duration: durationMs / MILLISECONDS_PER_SECOND,
                    playbackRate: 1,
                    position: Math.min(positionMs, durationMs) / MILLISECONDS_PER_SECOND
                });
            } catch {
                // Some partial MediaSession implementations expose the method
                // but reject position updates until native playback is ready.
            }
        }
    } else if (hasNativeShell) {
        shell.updateMediaSession({
            action: 'timeupdate',
            album: state.album,
            artist: state.artist,
            canSeek: durationMs > 0,
            duration: durationMs,
            imageUrl: state.imageUrl,
            isLocalPlayer: true,
            isPaused: state.paused,
            itemId: '',
            position: positionMs,
            title: state.name
        });
    }
}

function resetInactiveMediaSession(message: string, state?: PlayerState) {
    if (externalMediaSession?.state.active) return;

    console.debug(message, state);
    resetMediaSession();
}

/**
 * Projects PiggieTV's existing native Music owner through this sole
 * MediaSession owner. It does not own playback or queue state.
 */
export function updatePtvExternalMediaSession(
    state: PtvExternalMediaSessionState | null,
    controller?: PtvExternalMediaSessionController,
    resetOnRelease = true
) {
    if (!state?.active || !controller) {
        const previouslyExternal = Boolean(externalMediaSession);

        externalMediaSession = null;
        if (previouslyExternal && resetOnRelease) resetMediaSession();
        return;
    }

    externalMediaSession = {
        controller,
        state
    };
    updateExternalMediaSessionPresentation(state);
}

/** A PlaybackSubscriber that manages MediaSession state and events. */
class MediaSessionSubscriber extends PlaybackSubscriber {
    constructor(playbackManager: PlaybackManager) {
        super(playbackManager);

        resetMediaSession();
        if (hasNavigatorSession) this.bindNavigatorSession();
    }

    private bindNavigatorSession() {
        const actions: MediaSessionAction[] = ['pause', 'play', 'previoustrack', 'nexttrack', 'stop', 'seekto'];

        // iOS will only show next/prev track controls or seek controls
        if (!browser.iOS) actions.push('seekbackward', 'seekforward');

        for (const action of actions) {
            try {
                /* eslint-disable-next-line compat/compat */
                navigator.mediaSession.setActionHandler(action, this.onMediaSessionAction.bind(this));
            } catch (err) {
                // NOTE: Some legacy (TV) browsers lack support for the stop and seekto actions
                console.warn(`[MediaSessionSubscriber] Failed to add "${action}" action handler`, err);
            }
        }
    }

    private onMediaSessionAction(details: MediaSessionActionDetails) {
        if (externalMediaSession?.state.active) {
            const controller = externalMediaSession.controller;
            const currentPositionSeconds = (externalMediaSession.state.positionTicks || 0)
                / TICKS_PER_MILLISECOND
                / MILLISECONDS_PER_SECOND;

            switch (details.action) {
                case 'pause':
                    return controller.pause();
                case 'play':
                    return controller.play();
                case 'stop':
                    return controller.stop();
                case 'seekto':
                    return controller.seekTo(details.seekTime || 0);
                case 'previoustrack':
                    return controller.previous();
                case 'nexttrack':
                    return controller.next();
                case 'seekbackward':
                    return controller.seekTo(Math.max(0, currentPositionSeconds - (details.seekOffset || 10)));
                case 'seekforward':
                    return controller.seekTo(currentPositionSeconds + (details.seekOffset || 10));
                default:
                    break;
            }
        }

        switch (details.action) {
            case 'pause':
                return this.playbackManager.pause(this.player);
            case 'play':
                return this.playbackManager.unpause(this.player);
            case 'stop':
                return this.playbackManager.stop(this.player);
            case 'seekbackward':
                return this.playbackManager.rewind(this.player);
            case 'seekforward':
                return this.playbackManager.fastForward(this.player);
            case 'seekto':
                return this.playbackManager.seekMs((details.seekTime || 0) * MILLISECONDS_PER_SECOND, this.player);
            case 'previoustrack':
                return this.playbackManager.previousTrack(this.player);
            case 'nexttrack':
                return this.playbackManager.nextTrack(this.player);
            default:
                console.info('[MediaSessionSubscriber] Unhandled media session action', details);
        }
    }

    private onMediaSessionUpdate(
        { type: action }: Event,
        stateOverride?: PlayerState
    ) {
        if (!this.player) {
            return resetInactiveMediaSession(
                '[MediaSessionSubscriber] no active player; resetting media session'
            );
        }

        const state: PlayerState = stateOverride || this.playbackManager.getPlayerState(this.player);
        const item = state.NowPlayingItem;

        if (!item) {
            return resetInactiveMediaSession(
                '[MediaSessionSubscriber] no now playing item; resetting media session',
                state
            );
        }

        const isVideo = item.MediaType === MediaType.Video;
        const isLocalPlayer = !!this.player?.isLocalPlayer;

        externalMediaSession = null;

        // Local players do their own notifications
        if (isLocalPlayer && isVideo) {
            console.debug('[MediaSessionSubscriber] ignoring local player update');
            return;
        }

        const album = item.Album || undefined;
        const [ line1, line2 ] = getItemTextLines(item, false) || [];
        // The artist will be the second line if present or the first line otherwise
        const artist = line2 || line1;
        // The title will be the first line if there are two lines
        const title = line2 && line1;

        if (hasNavigatorSession) {
            if (
                !navigator.mediaSession.metadata
                || navigator.mediaSession.metadata.album !== album
                || navigator.mediaSession.metadata.artist !== artist
                || navigator.mediaSession.metadata.title !== title
            ) {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title,
                    artist,
                    album,
                    artwork: getArtwork(item)
                });
            }
        } else {
            shell.updateMediaSession({
                action,
                isLocalPlayer,
                itemId: item.Id,
                title,
                artist,
                album,
                duration: item.RunTimeTicks ? Math.round(item.RunTimeTicks / TICKS_PER_MILLISECOND) : 0,
                position: state.PlayState.PositionTicks ? Math.round(state.PlayState.PositionTicks / TICKS_PER_MILLISECOND) : 0,
                imageUrl: getImageUrl(item, { maxHeight: 3_000 }),
                canSeek: !!state.PlayState.CanSeek,
                isPaused: !!state.PlayState.IsPaused
            });
        }
    }

    onPlayerChange() {
        this.onMediaSessionUpdate({ type: 'timeupdate' });
    }

    onPlayerPause(e: Event) {
        this.onMediaSessionUpdate(e);
    }

    onPlayerPlaybackStart(e: Event, state: PlayerState) {
        this.onMediaSessionUpdate(e, state);
    }

    onPlayerPlaybackStop() {
        if (externalMediaSession?.state.active) return;
        resetMediaSession();
    }

    onPlayerStateChange(e: Event, state: PlayerState) {
        this.onMediaSessionUpdate(e, state);
    }

    onPlayerUnpause(e: Event) {
        this.onMediaSessionUpdate(e);
    }
}

/** Bind a new MediaSessionSubscriber to the specified PlaybackManager */
export const bindMediaSessionSubscriber = (playbackManager: PlaybackManager) => {
    if (hasNativeShell || hasNavigatorSession) {
        return new MediaSessionSubscriber(playbackManager);
    }
};
