import { recordPtvEvent } from '../../core/observability';

export const HLS_LOW_BUFFER_SECONDS = 2;
export const HLS_ZERO_BUFFER_SECONDS = 0.05;
export const HLS_STALL_CONFIRMATION_MS = 12_000;
export const HLS_MEDIA_RECOVERY_DEDUP_MS = 3_000;

const MAX_FRAGMENT_LATENCIES = 256;
const MAX_FRAGMENT_TRACKING = 32;
const MAX_MANIFEST_LATENCIES = 32;
const MAX_READY_STATE_TRANSITIONS = 16;
const MAX_STALL_EPISODES = 20;
const SNAPSHOT_PUBLISH_INTERVAL_MS = 1_000;
const SAFE_RECOVERY_RESULTS = new Set([
    'cancelled',
    'failed',
    'load-restarted',
    'media-error-recovered',
    'not-needed',
    'recovered',
    'source-replaced',
    'timed-out',
    'unknown'
]);

export type HlsPlaybackSessionState =
    | 'IDLE'
    | 'LOADING'
    | 'BUFFERING'
    | 'PLAYING'
    | 'DEGRADED'
    | 'STALLED'
    | 'RECOVERING'
    | 'ENDED'
    | 'FAILED';

export type HlsPlaybackSessionSignal =
    | 'SOURCE_ASSIGNED'
    | 'MANIFEST_LOADING'
    | 'MANIFEST_READY'
    | 'BUFFERING'
    | 'PLAYING'
    | 'LOW_BUFFER'
    | 'STALL_CONFIRMED'
    | 'RECOVERY_STARTED'
    | 'RECOVERY_SUCCEEDED'
    | 'ENDED'
    | 'FAILED';

export type PlaybackRouteClassification =
    | 'LAN_DIRECT'
    | 'LOCAL_VIA_PUBLIC_HOSTNAME'
    | 'PUBLIC_PROXY'
    | 'CLOUDFLARE_TUNNEL'
    | 'VPN_PATH'
    | 'UNKNOWN';

export type PlaybackMediaMode = 'Direct Play' | 'Direct Stream' | 'HLS Transcode' | 'Unknown';

type HlsEventListener = (...args: unknown[]) => void;

type HlsLike = {
    loadingEnabled?: boolean;
    on: (event: string, listener: HlsEventListener) => void;
    off?: (event: string, listener: HlsEventListener) => void;
    recoverMediaError?: () => void;
    startLoad?: (position?: number) => void;
    swapAudioCodec?: () => void;
};

type HlsEventMap = Readonly<Record<string, string | undefined>>;

type PlaybackSessionOptions = Readonly<{
    events?: HlsEventMap;
    hls?: HlsLike | null;
    isCurrent: () => boolean;
    media: HTMLMediaElement;
    mediaMode: PlaybackMediaMode;
    routeClassification: PlaybackRouteClassification;
    routeFamily: string;
    sourceGeneration: number;
}>;

type ReadyStateTransition = Readonly<{
    atMs: number;
    from: number;
    to: number;
}>;

type FragmentAttempt = {
    retryCount: number;
    startedAt: number;
};

const RETRYABLE_NETWORK_STATUS_CODES = new Set([ 0, 404, 408, 409, 425, 429, 500, 502, 503, 504 ]);

let playbackDiagnosticSequence = 0;

function now() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function' ?
        performance.now() :
        Date.now();
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finiteNumber(value: unknown, fallback = 0) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : fallback;
}

function rounded(value: number, digits = 2) {
    return Number(Math.max(0, value).toFixed(digits));
}

function percentile(values: readonly number[], quantile: number) {
    if (!values.length) return 0;

    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * quantile) - 1));

    return rounded(sorted[index], 1);
}

function average(values: readonly number[]) {
    if (!values.length) return 0;

    return rounded(values.reduce((sum, value) => sum + value, 0) / values.length, 1);
}

function boundedPush<T>(values: T[], value: T, limit: number) {
    values.push(value);

    if (values.length > limit) values.splice(0, values.length - limit);
}

function safeRecoveryResult(value: string) {
    const normalized = value.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);

    if (SAFE_RECOVERY_RESULTS.has(normalized)) return normalized;
    if (/media|codec/.test(normalized)) return 'media-error-recovered';
    if (/restart/.test(normalized)) return 'load-restarted';
    if (/replace/.test(normalized)) return 'source-replaced';
    if (/recover|playing|progress|resolved/.test(normalized)) return 'recovered';
    if (/seek/.test(normalized)) return 'not-needed';
    if (/end|stop|dispose|cancel/.test(normalized)) return 'cancelled';

    return 'unknown';
}

function isPrivateHostname(hostname: string) {
    const lowerHostname = hostname.toLowerCase();
    const normalized = lowerHostname.startsWith('[') && lowerHostname.endsWith(']') ?
        lowerHostname.slice(1, -1) :
        lowerHostname;

    if (normalized === 'localhost' || normalized.endsWith('.local') || normalized === '::1') return true;
    if (normalized.startsWith('127.') || normalized.startsWith('10.') || normalized.startsWith('192.168.')) return true;

    const match = /^172\.(\d{1,3})\./.exec(normalized);

    return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

export function classifyPlaybackRoute(
    mediaUrl: string,
    pageUrl = typeof window === 'undefined' ? '' : window.location.href
): PlaybackRouteClassification {
    try {
        // eslint-disable-next-line compat/compat -- supported PTV Web playback browsers provide URL.
        const page = new URL(pageUrl);
        // eslint-disable-next-line compat/compat -- supported PTV Web playback browsers provide URL.
        const media = new URL(mediaUrl, page);
        const pageIsPrivate = isPrivateHostname(page.hostname);
        const mediaIsPrivate = isPrivateHostname(media.hostname);

        if (mediaIsPrivate) return 'LAN_DIRECT';
        if (pageIsPrivate && !mediaIsPrivate) return 'LOCAL_VIA_PUBLIC_HOSTNAME';
        if (media.origin === page.origin || (!pageIsPrivate && !mediaIsPrivate)) return 'PUBLIC_PROXY';
    } catch {
        return 'UNKNOWN';
    }

    return 'UNKNOWN';
}

export function getPlaybackRouteFamily(value = typeof window === 'undefined' ? '' : window.location.hash) {
    const normalized = value.toLowerCase();

    if (/livetv|live-tv/.test(normalized)) return 'live-tv';
    if (/nowplaying/.test(normalized)) return 'now-playing';
    if (/playback|videoosd|video/.test(normalized)) return 'playback';

    return 'other';
}

export function getPlaybackMediaMode(playMethod: unknown, hls: boolean): PlaybackMediaMode {
    const normalized = String(playMethod || '').toLowerCase();

    if (normalized === 'directplay') return 'Direct Play';
    if (normalized === 'directstream') return 'Direct Stream';
    if (normalized === 'transcode' && hls) return 'HLS Transcode';

    return 'Unknown';
}

export function reduceHlsPlaybackState(
    state: HlsPlaybackSessionState,
    signal: HlsPlaybackSessionSignal
): HlsPlaybackSessionState {
    if (signal === 'SOURCE_ASSIGNED') return 'LOADING';
    if (signal === 'FAILED') return 'FAILED';
    if (signal === 'ENDED') return state === 'FAILED' ? state : 'ENDED';
    if (state === 'ENDED' || state === 'FAILED') return state;

    switch (signal) {
        case 'MANIFEST_LOADING':
            return 'LOADING';
        case 'MANIFEST_READY':
        case 'BUFFERING':
            return state === 'IDLE' || state === 'LOADING' || state === 'PLAYING' ? 'BUFFERING' : state;
        case 'PLAYING':
        case 'RECOVERY_SUCCEEDED':
            return 'PLAYING';
        case 'LOW_BUFFER':
            return state === 'PLAYING' ? 'DEGRADED' : state;
        case 'STALL_CONFIRMED':
            return state === 'PLAYING' || state === 'DEGRADED' || state === 'BUFFERING' ? 'STALLED' : state;
        case 'RECOVERY_STARTED':
            return state === 'STALLED' || state === 'DEGRADED' || state === 'BUFFERING' || state === 'LOADING' ? 'RECOVERING' : state;
        default:
            return state;
    }
}

function getBufferAhead(media: HTMLMediaElement) {
    const currentTime = finiteNumber(media.currentTime);
    const buffered = media.buffered;

    for (let index = 0; index < buffered.length; index += 1) {
        try {
            if (buffered.start(index) <= currentTime && buffered.end(index) >= currentTime) {
                return rounded(buffered.end(index) - currentTime);
            }
        } catch {
            return 0;
        }
    }

    return 0;
}

function getLoadLatency(statsValue: unknown) {
    const stats = asRecord(statsValue);
    const loading = asRecord(stats.loading);
    const start = finiteNumber(loading.start, Number.NaN);
    const end = finiteNumber(loading.end, Number.NaN);

    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}

function getFragmentKey(dataValue: unknown) {
    const data = asRecord(dataValue);
    const fragment = asRecord(data.frag);
    const part = asRecord(data.part);
    const type = String(fragment.type || 'main').replace(/[^a-z0-9_-]/gi, '').slice(0, 16) || 'main';
    const level = finiteNumber(fragment.level, -1);
    const sequence = String(fragment.sn ?? 'unknown').replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'unknown';
    const partIndex = finiteNumber(part.index, -1);

    return `${type}:${level}:${sequence}:${partIndex}`;
}

export function createHlsPlaybackSession(options: PlaybackSessionOptions) {
    const sessionStartedAt = now();
    const diagnosticSessionId = `playback-${++playbackDiagnosticSequence}`;
    const media = options.media;
    const hlsListeners: Array<Readonly<{ event: string; listener: HlsEventListener }>> = [];
    const mediaListeners: Array<Readonly<{ event: string; listener: EventListener }>> = [];
    const manifestLatencies: number[] = [];
    const fragmentLatencies: number[] = [];
    const inFlightFragments = new Map<string, FragmentAttempt>();
    const fragmentRetryCounts = new Map<string, number>();
    const readyStateTransitions: ReadyStateTransition[] = [];
    const stallDurations: number[] = [];
    const stallRecoveryResults: string[] = [];
    let state: HlsPlaybackSessionState = reduceHlsPlaybackState('IDLE', 'SOURCE_ASSIGNED');
    let disposed = false;
    let terminal = false;
    let currentBufferAhead = 0;
    let minimumBufferAhead = Number.POSITIVE_INFINITY;
    let maximumBufferAhead = 0;
    let bufferSampleCount = 0;
    let bufferSampleSum = 0;
    let belowTwoSecondsCount = 0;
    let zeroBufferCount = 0;
    let wasBelowTwoSeconds = false;
    let wasZeroBuffer = false;
    let lastReadyState = media.readyState;
    let waitingCount = 0;
    let stalledCount = 0;
    let activeStallStartedAt: number | null = null;
    let cumulativeStallDurationMs = 0;
    let longestStallDurationMs = 0;
    let manifestRequestCount = 0;
    let manifestSuccessCount = 0;
    let manifestStartedAt = 0;
    let fragmentRequestCount = 0;
    let fragmentSuccessCount = 0;
    let fragmentFailureCount = 0;
    let fragmentTimeoutCount = 0;
    let fragmentRetryCount = 0;
    let duplicateFragmentRequestCount = 0;
    let droppedFragmentTrackingCount = 0;
    let mediaSourceAssignments = 1;
    let sourceReplacements = 0;
    const mountCount = 1;
    let unmountCount = 0;
    let playCalls = 0;
    let pauseCalls = 0;
    let programmaticSeeks = 0;
    let qualitySwitches = 0;
    let recoveryActions = 0;
    let activeLoadRestarts = 0;
    let staleEventsIgnored = 0;
    let hasEverPlayed = false;
    let seeking = false;
    let seekGraceUntil = 0;
    let lastMediaTime = finiteNumber(media.currentTime);
    let lastProgressAt = sessionStartedAt;
    let lastFragmentSuccessAt = sessionStartedAt;
    let lastPublishedAt = 0;
    let networkRecoveryUsed = false;
    let mediaRecoveryCount = 0;
    let lastMediaRecoveryAt = Number.NEGATIVE_INFINITY;
    let activeQualityLevel: number | null = null;
    let attachedHls = options.hls || null;

    const isCurrent = () => !disposed && options.isCurrent();

    const transition = (signal: HlsPlaybackSessionSignal) => {
        state = reduceHlsPlaybackState(state, signal);
    };

    const getSnapshot = () => ({
        buffer: {
            averageAheadSeconds: bufferSampleCount ? rounded(bufferSampleSum / bufferSampleCount) : 0,
            belowTwoSecondsCount,
            currentAheadSeconds: currentBufferAhead,
            maximumAheadSeconds: rounded(maximumBufferAhead),
            minimumAheadSeconds: Number.isFinite(minimumBufferAhead) ? rounded(minimumBufferAhead) : 0,
            sampleCount: bufferSampleCount,
            zeroBufferCount
        },
        diagnosticSessionId,
        hls: {
            droppedFragmentTrackingCount,
            duplicateFragmentRequestCount,
            fragmentAverageLatencyMs: average(fragmentLatencies),
            fragmentFailureCount,
            fragmentLongestLatencyMs: fragmentLatencies.length ? rounded(Math.max(...fragmentLatencies), 1) : 0,
            fragmentP95LatencyMs: percentile(fragmentLatencies, 0.95),
            fragmentRequestCount,
            fragmentRetryCount,
            fragmentSuccessCount,
            fragmentTimeoutCount,
            manifestAverageLatencyMs: average(manifestLatencies),
            manifestP95LatencyMs: percentile(manifestLatencies, 0.95),
            manifestRequestCount,
            manifestSuccessCount
        },
        mediaMode: options.mediaMode,
        player: {
            activeLoadRestarts,
            mediaSourceAssignments,
            mountCount,
            pauseCalls,
            playCalls,
            programmaticSeeks,
            qualitySwitches,
            recoveryActions,
            sourceReplacements,
            staleEventsIgnored,
            unmountCount
        },
        readyStateTransitions: [...readyStateTransitions],
        routeClassification: options.routeClassification,
        routeFamily: options.routeFamily,
        sourceGeneration: options.sourceGeneration,
        stalls: {
            cumulativeDurationMs: rounded(cumulativeStallDurationMs, 1),
            episodeDurationsMs: [...stallDurations],
            longestDurationMs: rounded(longestStallDurationMs, 1),
            recoveryResults: [...stallRecoveryResults],
            stalledCount,
            waitingCount
        },
        state,
        terminal,
        updatedAt: new Date().toISOString()
    });

    const publish = (force = false) => {
        const publishedAt = now();

        if (!force && publishedAt - lastPublishedAt < SNAPSHOT_PUBLISH_INTERVAL_MS) return;

        lastPublishedAt = publishedAt;
        recordPtvEvent('playback', 'ptv-playback-session-snapshot', getSnapshot());
    };

    const captureReadyState = () => {
        const nextReadyState = media.readyState;

        if (nextReadyState === lastReadyState) return;

        boundedPush(readyStateTransitions, {
            atMs: rounded(now() - sessionStartedAt, 1),
            from: lastReadyState,
            to: nextReadyState
        }, MAX_READY_STATE_TRANSITIONS);
        lastReadyState = nextReadyState;
    };

    const finishStall = (result: string) => {
        if (activeStallStartedAt === null) return;

        const duration = Math.max(0, now() - activeStallStartedAt);

        activeStallStartedAt = null;
        cumulativeStallDurationMs += duration;
        longestStallDurationMs = Math.max(longestStallDurationMs, duration);
        boundedPush(stallDurations, rounded(duration, 1), MAX_STALL_EPISODES);
        boundedPush(stallRecoveryResults, safeRecoveryResult(result), MAX_STALL_EPISODES);
    };

    const capturePlaybackProgress = (mediaTime: number) => {
        if (Math.abs(mediaTime - lastMediaTime) >= 0.05) {
            lastMediaTime = mediaTime;
            lastProgressAt = now();

            if (!media.paused && !media.ended) {
                hasEverPlayed = true;
                finishStall(state === 'RECOVERING' ? 'recovered' : 'progress-resumed');
                transition(state === 'RECOVERING' ? 'RECOVERY_SUCCEEDED' : 'PLAYING');
            }
        }
    };

    const captureBufferThresholds = () => {
        bufferSampleCount += 1;
        bufferSampleSum += currentBufferAhead;
        minimumBufferAhead = Math.min(minimumBufferAhead, currentBufferAhead);
        maximumBufferAhead = Math.max(maximumBufferAhead, currentBufferAhead);

        const belowTwoSeconds = currentBufferAhead < HLS_LOW_BUFFER_SECONDS;
        const zeroBuffer = currentBufferAhead <= HLS_ZERO_BUFFER_SECONDS;

        if (belowTwoSeconds && !wasBelowTwoSeconds) belowTwoSecondsCount += 1;
        if (zeroBuffer && !wasZeroBuffer) zeroBufferCount += 1;
        wasBelowTwoSeconds = belowTwoSeconds;
        wasZeroBuffer = zeroBuffer;

        if (!media.paused && !seeking && now() >= seekGraceUntil && belowTwoSeconds) {
            transition('LOW_BUFFER');
        }

        const stalledLongEnough = zeroBuffer
            && !media.paused
            && !seeking
            && now() >= seekGraceUntil
            && now() - lastProgressAt >= HLS_STALL_CONFIRMATION_MS
            && now() - lastFragmentSuccessAt >= HLS_STALL_CONFIRMATION_MS
            && inFlightFragments.size === 0;

        if (stalledLongEnough) transition('STALL_CONFIRMED');
    };

    const sampleBuffer = () => {
        if (!isCurrent()) return;

        captureReadyState();
        currentBufferAhead = getBufferAhead(media);
        capturePlaybackProgress(finiteNumber(media.currentTime));

        if (hasEverPlayed) captureBufferThresholds();

        publish();
    };

    const beginStall = (kind: 'stalled' | 'waiting') => {
        if (!isCurrent() || media.paused || media.ended || seeking) return;

        if (kind === 'waiting') waitingCount += 1;
        if (kind === 'stalled') stalledCount += 1;
        if (activeStallStartedAt === null) activeStallStartedAt = now();
        transition('LOW_BUFFER');
        sampleBuffer();
        publish(true);
    };

    const listenMedia = (event: string, handler: EventListener) => {
        media.addEventListener(event, handler);
        mediaListeners.push({ event, listener: handler });
    };

    listenMedia('playing', () => {
        if (!isCurrent()) return;

        hasEverPlayed = true;
        lastProgressAt = now();
        finishStall(state === 'RECOVERING' ? 'recovered' : 'playing');
        transition(state === 'RECOVERING' ? 'RECOVERY_SUCCEEDED' : 'PLAYING');
        sampleBuffer();
        publish(true);
    });
    listenMedia('waiting', () => beginStall('waiting'));
    listenMedia('stalled', () => beginStall('stalled'));
    listenMedia('timeupdate', sampleBuffer);
    listenMedia('progress', sampleBuffer);
    listenMedia('loadedmetadata', sampleBuffer);
    listenMedia('canplay', sampleBuffer);
    listenMedia('seeking', () => {
        if (!isCurrent()) return;

        seeking = true;
        transition('BUFFERING');
        publish(true);
    });
    listenMedia('seeked', () => {
        if (!isCurrent()) return;

        seeking = false;
        seekGraceUntil = now() + 3_000;
        lastMediaTime = finiteNumber(media.currentTime);
        lastProgressAt = now();
        finishStall('seek-completed');
        publish(true);
    });
    listenMedia('ended', () => {
        terminal = true;
        finishStall('ended');
        transition('ENDED');
        publish(true);
    });

    const accountRetries = (key: string, statsValue: unknown) => {
        const stats = asRecord(statsValue);
        const current = Math.max(0, finiteNumber(stats.retry));
        const previous = fragmentRetryCounts.get(key) || 0;

        if (current > previous) fragmentRetryCount += current - previous;
        fragmentRetryCounts.set(key, Math.max(previous, current));

        while (fragmentRetryCounts.size > MAX_FRAGMENT_TRACKING * 2) {
            const oldest = fragmentRetryCounts.keys().next().value as string | undefined;

            if (!oldest) break;
            fragmentRetryCounts.delete(oldest);
        }
    };

    const listenHls = (eventName: string | undefined, handler: (data: Record<string, unknown>) => void) => {
        if (!eventName || !attachedHls) return;

        const listener: HlsEventListener = (...args) => {
            if (!isCurrent()) {
                staleEventsIgnored += 1;
                return;
            }

            handler(asRecord(args[1]));
        };

        attachedHls.on(eventName, listener);
        hlsListeners.push({ event: eventName, listener });
    };

    const bindHls = (hls: HlsLike, events: HlsEventMap) => {
        attachedHls = hls;

        listenHls(events.MANIFEST_LOADING, () => {
            manifestRequestCount += 1;
            manifestStartedAt = now();
            transition('MANIFEST_LOADING');
            publish(true);
        });
        listenHls(events.MANIFEST_LOADED, data => {
            manifestSuccessCount += 1;
            const measured = getLoadLatency(data.stats);
            const latency = measured ?? (manifestStartedAt ? now() - manifestStartedAt : null);

            if (latency !== null) boundedPush(manifestLatencies, latency, MAX_MANIFEST_LATENCIES);
            transition('MANIFEST_READY');
            publish(true);
        });
        listenHls(events.MANIFEST_PARSED, () => {
            transition('MANIFEST_READY');
            publish(true);
        });
        listenHls(events.FRAG_LOADING, data => {
            const key = getFragmentKey(data);
            const fragment = asRecord(data.frag);

            fragmentRequestCount += 1;
            if (inFlightFragments.has(key)) duplicateFragmentRequestCount += 1;
            inFlightFragments.set(key, {
                retryCount: finiteNumber(asRecord(fragment.stats).retry),
                startedAt: now()
            });

            while (inFlightFragments.size > MAX_FRAGMENT_TRACKING) {
                const oldest = inFlightFragments.keys().next().value as string | undefined;

                if (!oldest) break;
                inFlightFragments.delete(oldest);
                droppedFragmentTrackingCount += 1;
            }
            publish();
        });
        listenHls(events.FRAG_LOADED, data => {
            const key = getFragmentKey(data);
            const fragment = asRecord(data.frag);
            const attempt = inFlightFragments.get(key);
            const measured = getLoadLatency(fragment.stats);
            const latency = measured ?? (attempt ? now() - attempt.startedAt : null);

            fragmentSuccessCount += 1;
            lastFragmentSuccessAt = now();
            inFlightFragments.delete(key);
            accountRetries(key, fragment.stats);
            if (latency !== null) boundedPush(fragmentLatencies, latency, MAX_FRAGMENT_LATENCIES);
            sampleBuffer();
            publish();
        });
        listenHls(events.FRAG_LOAD_EMERGENCY_ABORTED, data => {
            const key = getFragmentKey(data);

            fragmentFailureCount += 1;
            inFlightFragments.delete(key);
            accountRetries(key, data.stats);
            publish(true);
        });
        listenHls(events.LEVEL_SWITCHING, data => {
            const nextLevel = finiteNumber(data.level, Number.NaN);

            if (Number.isFinite(nextLevel)) activeQualityLevel = nextLevel;
            if (hasEverPlayed) qualitySwitches += 1;
            publish();
        });
        listenHls(events.STALL_RESOLVED, () => {
            finishStall('hls-stall-resolved');
            transition('PLAYING');
            sampleBuffer();
            publish(true);
        });
        listenHls(events.ERROR, data => {
            const details = String(data.details || '');

            if (/fragLoadTimeOut/i.test(details)) fragmentTimeoutCount += 1;
            if (/fragLoad(?:Error|TimeOut)/i.test(details)) {
                fragmentFailureCount += 1;
                const key = getFragmentKey(data);

                inFlightFragments.delete(key);
                accountRetries(key, data.stats || asRecord(data.frag).stats);
            }
            if (/bufferStalledError/i.test(details)) beginStall('stalled');
            publish(Boolean(data.fatal));
        });
    };

    if (attachedHls && options.events) bindHls(attachedHls, options.events);

    const sampleTimer = globalThis.setInterval(sampleBuffer, 1_000);

    publish(true);

    return {
        bindHls,
        dispose(reason = 'disposed') {
            if (disposed) return;

            finishStall(reason);
            if (reason === 'source-replaced') sourceReplacements += 1;
            terminal = true;
            if (state !== 'FAILED') transition('ENDED');
            unmountCount = 1;
            globalThis.clearInterval(sampleTimer);
            mediaListeners.forEach(({ event, listener }) => {
                media.removeEventListener(event, listener);
            });
            hlsListeners.forEach(({ event, listener }) => {
                attachedHls?.off?.(event, listener);
            });
            inFlightFragments.clear();
            disposed = true;
            publish(true);
        },
        end(reason = 'ended') {
            if (terminal) return;

            terminal = true;
            finishStall(reason);
            transition('ENDED');
            publish(true);
        },
        getSnapshot,
        markFailed(reason = 'failed') {
            terminal = true;
            finishStall(reason);
            transition('FAILED');
            publish(true);
        },
        recordPlayerAction(action: string) {
            if (disposed) return;

            switch (action) {
                case 'media-source-assigned':
                    mediaSourceAssignments += 1;
                    break;
                case 'source-replaced':
                    sourceReplacements += 1;
                    break;
                case 'play':
                    playCalls += 1;
                    break;
                case 'pause':
                    pauseCalls += 1;
                    break;
                case 'seek':
                    programmaticSeeks += 1;
                    break;
                default:
                    return;
            }
            publish();
        },
        recoverFromFatalNetwork(activeHls: HlsLike, responseCode = 0, errorData?: unknown) {
            if (!isCurrent()
                || activeHls !== attachedHls
                || typeof activeHls.startLoad !== 'function') return false;

            const errorFragment = asRecord(asRecord(errorData).frag);
            const errorLevel = finiteNumber(errorFragment.level, Number.NaN);

            // A late fatal callback from the retired quality level belongs to
            // hls.js' cancelled work, not to the current source recovery path.
            if (activeQualityLevel !== null
                && Number.isFinite(errorLevel)
                && errorLevel !== activeQualityLevel) {
                staleEventsIgnored += 1;
                publish(true);
                return true;
            }

            if (networkRecoveryUsed || !RETRYABLE_NETWORK_STATUS_CODES.has(responseCode)) return false;

            const startupFailure = !hasEverPlayed && (state === 'LOADING' || state === 'BUFFERING');
            const confirmedDepletion = hasEverPlayed
                && !media.paused
                && !seeking
                && currentBufferAhead <= HLS_ZERO_BUFFER_SECONDS
                && now() - lastProgressAt >= HLS_STALL_CONFIRMATION_MS
                && inFlightFragments.size === 0;

            if (!startupFailure && !confirmedDepletion) return false;

            networkRecoveryUsed = true;
            recoveryActions += 1;
            activeLoadRestarts += 1;
            transition('RECOVERY_STARTED');
            boundedPush(stallRecoveryResults, 'load-restarted', MAX_STALL_EPISODES);

            try {
                activeHls.startLoad(Number.isFinite(media.currentTime) ? media.currentTime : -1);
                publish(true);
                return true;
            } catch {
                transition('FAILED');
                publish(true);
                return false;
            }
        },
        recoverFromMediaError(activeHls: HlsLike) {
            if (!isCurrent() || activeHls !== attachedHls || typeof activeHls.recoverMediaError !== 'function') return false;

            const recoveryStartedAt = now();

            // hls.js and the native media element can report the same decoder
            // incident independently. Consume the duplicate without spending
            // the next bounded recovery attempt.
            if (recoveryStartedAt - lastMediaRecoveryAt < HLS_MEDIA_RECOVERY_DEDUP_MS) return true;

            if (mediaRecoveryCount >= 2) return false;

            recoveryActions += 1;
            mediaRecoveryCount += 1;
            lastMediaRecoveryAt = recoveryStartedAt;
            transition('RECOVERY_STARTED');

            try {
                if (mediaRecoveryCount === 2 && typeof activeHls.swapAudioCodec === 'function') {
                    activeHls.swapAudioCodec();
                    boundedPush(stallRecoveryResults, 'media-error-recovered', MAX_STALL_EPISODES);
                } else {
                    boundedPush(stallRecoveryResults, 'media-error-recovered', MAX_STALL_EPISODES);
                }
                activeHls.recoverMediaError();
                publish(true);
                return true;
            } catch {
                transition('FAILED');
                publish(true);
                return false;
            }
        }
    };
}

export type HlsPlaybackSession = ReturnType<typeof createHlsPlaybackSession>;
