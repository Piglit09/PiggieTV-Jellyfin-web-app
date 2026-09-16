import appSettings from '../scripts/settings/appSettings' ;
import browser from '../scripts/browser';
import Events from '../utils/events.ts';
import { MediaError } from 'types/mediaError';

const DEFAULT_MEDIA_VOLUME_LEVEL = 50;
const DEFAULT_MEDIA_VOLUME = Math.pow(DEFAULT_MEDIA_VOLUME_LEVEL / 100, 3);

export function getSavedVolume() {
    const value = Number(appSettings.get('volume'));

    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : DEFAULT_MEDIA_VOLUME;
}

export function getStartupVolume() {
    return DEFAULT_MEDIA_VOLUME;
}

export function saveVolume(value) {
    const normalizedValue = Number(value);

    if (Number.isFinite(normalizedValue)) {
        appSettings.set('volume', Math.max(0, Math.min(1, normalizedValue)));
    }
}

export function getCrossOriginValue(mediaSource) {
    if (mediaSource.IsRemote) {
        return null;
    }

    return 'anonymous';
}

function canPlayNativeHls() {
    const media = document.createElement('video');

    return !!(media.canPlayType('application/x-mpegURL').replace(/no/, '')
            || media.canPlayType('application/vnd.apple.mpegURL').replace(/no/, ''));
}

export function enableHlsJsPlayerForCodecs(mediaSource, mediaType) {
    // Workaround for VP9 HLS support on desktop Safari
    // Force using HLS.js because desktop Safari's native HLS player does not play VP9 over HLS
    // browser.osx will return true on iPad, cannot use
    if (!browser.iOS && browser.safari && mediaSource.MediaStreams.some(x => x.Codec === 'vp9')) {
        return true;
    }
    return enableHlsJsPlayer(mediaSource.RunTimeTicks, mediaType);
}

export function enableHlsJsPlayer(runTimeTicks, mediaType) {
    if (window.MediaSource == null) {
        return false;
    }

    // hls.js is only in beta. needs more testing.
    if (browser.iOS) {
        return false;
    }

    // The native players on these devices support seeking live streams, no need to use hls.js here
    if (browser.tizen || browser.web0s) {
        return false;
    }

    if (canPlayNativeHls()) {
        // Android Webview's native HLS has performance and compatiblity issues
        if (browser.android && (mediaType === 'Audio' || mediaType === 'Video')) {
            return true;
        }

        // Chromium 141+ brings native HLS support that does not support switching HDR/SDR playlists.
        // Always use hls.js to avoid falling back to transcoding from remuxing and client side tone-mapping.
        if (browser.chrome || browser.edgeChromium || browser.opera) {
            return true;
        }

        // simple playback should use the native support
        if (runTimeTicks) {
            return false;
        }
    }

    return true;
}

export function handleHlsJsMediaError(instance, reject) {
    const hlsPlayer = instance._hlsPlayer;

    if (!hlsPlayer) {
        return false;
    }

    const playbackSession = instance._ptvPlaybackSession;

    if (playbackSession?.recoverFromMediaError) {
        const recovered = playbackSession.recoverFromMediaError(hlsPlayer);

        if (recovered) return true;

        playbackSession.markFailed('media-recovery-exhausted');
        hlsPlayer.destroy();
        if (instance._hlsPlayer === hlsPlayer) instance._hlsPlayer = null;

        if (reject) {
            reject();
        } else {
            onErrorInternal(instance, MediaError.FATAL_HLS_ERROR);
        }

        return false;
    }

    instance._hlsMediaRecoveryCount = (instance._hlsMediaRecoveryCount || 0) + 1;

    if (instance._hlsMediaRecoveryCount === 1) {
        console.debug('try to recover media Error ...');
        hlsPlayer.recoverMediaError();
        return true;
    } else if (instance._hlsMediaRecoveryCount === 2) {
        console.debug('try to swap Audio Codec and recover media Error ...');
        hlsPlayer.swapAudioCodec();
        hlsPlayer.recoverMediaError();
        return true;
    } else {
        console.error('cannot recover, last media error recovery failed ...');

        if (reject) {
            reject();
        } else {
            onErrorInternal(instance, MediaError.FATAL_HLS_ERROR);
        }

        return false;
    }
}

export function onErrorInternal(instance, type) {
    // Needed for video
    if (instance.destroyCustomTrack) {
        instance.destroyCustomTrack(instance._mediaElement);
    }

    Events.trigger(instance, 'error', [{ type }]);
}

export function isValidDuration(duration) {
    return duration
            && !isNaN(duration)
            && duration !== Number.POSITIVE_INFINITY
            && duration !== Number.NEGATIVE_INFINITY;
}

function setCurrentTimeIfNeeded(element, seconds) {
    // If it's worth skipping (1 sec or less of a difference)
    if (Math.abs((element.currentTime || 0) - seconds) >= 1) {
        element.currentTime = seconds;
    }
}

export function seekOnPlaybackStart(instance, element, ticks, onMediaReady) {
    const seconds = (ticks || 0) / 10000000;

    if (seconds) {
        // Appending #t=xxx to the query string doesn't seem to work with HLS
        // For plain video files, not all browsers support it either

        if (element.duration >= seconds) {
            // media is ready, seek immediately
            setCurrentTimeIfNeeded(element, seconds);
            if (onMediaReady) onMediaReady();
        } else {
            // update video player position when media is ready to be sought
            const events = ['durationchange', 'loadeddata', 'play', 'loadedmetadata'];
            const onMediaChange = function(e) {
                if (element.currentTime === 0 && element.duration >= seconds) {
                    // seek only when video position is exactly zero,
                    // as this is true only if video hasn't started yet or
                    // user rewound to the very beginning
                    // (but rewinding cannot happen as the first event with media of non-empty duration)
                    console.debug(`seeking to ${seconds} on ${e.type} event`);
                    setCurrentTimeIfNeeded(element, seconds);
                    events.forEach(name => {
                        element.removeEventListener(name, onMediaChange);
                    });
                    if (onMediaReady) onMediaReady();
                }
            };
            events.forEach(name => {
                element.addEventListener(name, onMediaChange);
            });
        }
    }
}

export function applySrc(elem, src, options) {
    if (window.Windows && options.mediaSource?.IsLocal) {
        return Windows.Storage.StorageFile.getFileFromPathAsync(options.url).then(function (file) {
            const playlist = new Windows.Media.Playback.MediaPlaybackList();

            const source1 = Windows.Media.Core.MediaSource.createFromStorageFile(file);
            const startTime = (options.playerStartPositionTicks || 0) / 10000;
            playlist.items.append(new Windows.Media.Playback.MediaPlaybackItem(source1, startTime));
            elem.src = URL.createObjectURL(playlist, { oneTimeOnly: true });
            return Promise.resolve();
        });
    } else {
        elem.src = src;
    }

    return Promise.resolve();
}

export function resetSrc(elem) {
    elem.src = '';
    elem.innerHTML = '';
    elem.removeAttribute('src');
}

function onSuccessfulPlay(elem, onErrorFn) {
    elem.addEventListener('error', onErrorFn);
}

export function playWithPromise(elem, onErrorFn) {
    try {
        return elem.play()
            .catch((e) => {
                const errorName = (e.name || '').toLowerCase();
                // safari uses aborterror
                if (errorName === 'notallowederror'
                        || errorName === 'aborterror') {
                    // swallow this error because the user can still click the play button on the video element
                    return Promise.resolve();
                }
                return Promise.reject(e);
            })
            .then(() => {
                onSuccessfulPlay(elem, onErrorFn);
                return Promise.resolve();
            });
    } catch (err) {
        console.error('error calling video.play: ' + err);
        return Promise.reject();
    }
}

export function destroyCastPlayer(instance) {
    const player = instance._castPlayer;
    if (player) {
        try {
            player.unload();
        } catch (err) {
            console.error(err);
        }

        instance._castPlayer = null;
    }
}

export function destroyHlsPlayer(instance) {
    instance._ptvCancelHlsBinding?.();
    instance._ptvCancelHlsBinding = null;
    const player = instance._hlsPlayer;
    if (player) {
        try {
            player.destroy();
        } catch (err) {
            console.error(err);
        }

        instance._hlsPlayer = null;
    }
}

export function destroyFlvPlayer(instance) {
    const player = instance._flvPlayer;
    if (player) {
        try {
            player.unload();
            player.detachMediaElement();
            player.destroy();
        } catch (err) {
            console.error(err);
        }

        instance._flvPlayer = null;
    }
}

export function bindEventsToHlsPlayer(instance, hls, elem, onErrorFn, resolve, reject, ownership = {}) {
    let settled = false;
    const isCurrentSource = ownership.isCurrentSource || (() => true);
    const settleResolve = () => {
        if (settled) return;

        settled = true;
        resolve();
    };
    const settleReject = error => {
        if (settled) return;

        settled = true;
        reject(error);
    };

    const destroyOwnedHls = () => {
        hls.destroy();
        if (instance._hlsPlayer === hls) instance._hlsPlayer = null;
    };

    hls.on(Hls.Events.MANIFEST_PARSED, function () {
        if (!isCurrentSource()) return;

        instance._hlsMediaRecoveryCount = 0;
        instance._ptvPlaybackSession?.recordPlayerAction?.('play');
        playWithPromise(elem, onErrorFn).then(function () {
            settleResolve();
        }, settleReject);
    });

    hls.on(Hls.Events.ERROR, function (event, data) {
        if (!isCurrentSource()) return;

        console.error('HLS Error: Type: ' + data.type + ' Details: ' + (data.details || '') + ' Fatal: ' + (data.fatal || false));

        // Non-fatal manifest and fragment retries are owned by hls.js. Calling
        // startLoad here would restart an active stream-controller load.
        if (!data.fatal) return;

        switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR: {
                const responseCode = data.response?.code || 0;

                if (instance._ptvPlaybackSession?.recoverFromFatalNetwork?.(hls, responseCode, data)) return;

                instance._ptvPlaybackSession?.markFailed?.('fatal-network');
                destroyOwnedHls();

                const errorType = responseCode === 0 ? MediaError.NETWORK_ERROR : MediaError.SERVER_ERROR;
                if (!settled) {
                    settleReject(errorType);
                } else {
                    onErrorInternal(instance, errorType);
                }
                break;
            }
            case Hls.ErrorTypes.MEDIA_ERROR:
                console.debug('fatal media error encountered, try to recover');
                handleHlsJsMediaError(instance, settled ? null : settleReject);
                break;
            default:
                console.debug('Cannot recover from hls error - destroy and trigger error');
                instance._ptvPlaybackSession?.markFailed?.('fatal-hls');
                destroyOwnedHls();

                if (!settled) {
                    settleReject(MediaError.FATAL_HLS_ERROR);
                } else {
                    onErrorInternal(instance, MediaError.FATAL_HLS_ERROR);
                }
                break;
        }
    });

    return settleResolve;
}

export function onEndedInternal(instance, elem, onErrorFn) {
    elem.removeEventListener('error', onErrorFn);

    resetSrc(elem);

    destroyHlsPlayer(instance);
    destroyFlvPlayer(instance);
    destroyCastPlayer(instance);

    const stopInfo = {
        src: instance._currentSrc
    };

    Events.trigger(instance, 'stopped', [stopInfo]);

    instance._currentTime = null;
    instance._currentSrc = null;
    instance._currentPlayOptions = null;
}

export function getBufferedRanges(instance, elem) {
    const ranges = [];
    const seekable = elem.buffered || [];

    let offset;
    const currentPlayOptions = instance._currentPlayOptions;
    if (currentPlayOptions) {
        offset = currentPlayOptions.transcodingOffsetTicks;
    }

    offset = offset || 0;

    for (let i = 0, length = seekable.length; i < length; i++) {
        let start = seekable.start(i);
        let end = seekable.end(i);

        if (!isValidDuration(start)) {
            start = 0;
        }
        if (!isValidDuration(end)) {
            // eslint-disable-next-line sonarjs/no-dead-store
            end = 0;
            continue;
        }

        ranges.push({
            start: (start * 10000000) + offset,
            end: (end * 10000000) + offset
        });
    }

    return ranges;
}
