export const DEFAULT_HLS_BUFFER_LENGTH_SECONDS = 30;
export const HIGH_BITRATE_HLS_BUFFER_LENGTH_SECONDS = 6;
export const HIGH_BITRATE_HLS_THRESHOLD = 25000000;
export const VOD_TRANSCODE_FRAGMENT_TTFB_TIMEOUT_MS = 20000;

function getFinitePositiveNumber(value) {
    const number = Number(value);

    return Number.isFinite(number) && number > 0 ? number : null;
}

export function getHlsLevelBitrate(level) {
    return getFinitePositiveNumber(level?.maxBitrate)
        ?? getFinitePositiveNumber(level?.bitrate)
        ?? getFinitePositiveNumber(level?.averageBitrate);
}

export function getParsedManifestBitrate(data) {
    const firstLevel = Number.isInteger(data?.firstLevel) ? data.firstLevel : 0;

    return getHlsLevelBitrate(data?.levels?.[firstLevel]);
}

export function getHlsBufferLength(bitrate, isAffectedBrowser) {
    if (isAffectedBrowser && getFinitePositiveNumber(bitrate) >= HIGH_BITRATE_HLS_THRESHOLD) {
        return HIGH_BITRATE_HLS_BUFFER_LENGTH_SECONDS;
    }

    return DEFAULT_HLS_BUFFER_LENGTH_SECONDS;
}

export function createHlsBufferPolicyController(hls, isAffectedBrowser) {
    let appliedBufferLength = DEFAULT_HLS_BUFFER_LENGTH_SECONDS;

    return bitrate => {
        const nextBufferLength = getHlsBufferLength(bitrate, isAffectedBrowser);

        if (nextBufferLength === appliedBufferLength) return false;

        hls.config.maxBufferLength = nextBufferLength;
        hls.config.maxMaxBufferLength = nextBufferLength;
        appliedBufferLength = nextBufferLength;

        return true;
    };
}

export function bindHlsBufferPolicy(hls, events, isAffectedBrowser) {
    const applyBufferPolicy = createHlsBufferPolicyController(hls, isAffectedBrowser);

    hls.on(events.MANIFEST_PARSED, (_event, data) => {
        applyBufferPolicy(getParsedManifestBitrate(data));
    });
    hls.on(events.LEVEL_SWITCHING, (_event, data) => {
        applyBufferPolicy(getHlsLevelBitrate(data));
    });
}

export function createVodTranscodeFragmentLoadPolicy(defaultPolicy, options) {
    if (options?.playMethod !== 'Transcode' || !getFinitePositiveNumber(options?.mediaSource?.RunTimeTicks)) {
        return null;
    }

    return {
        ...defaultPolicy,
        default: {
            ...defaultPolicy?.default,
            maxTimeToFirstByteMs: VOD_TRANSCODE_FRAGMENT_TTFB_TIMEOUT_MS
        }
    };
}
