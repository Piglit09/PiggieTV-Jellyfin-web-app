// These are maximum output envelopes, not promises of an exact delivered resolution.
// Jellyfin may choose a lower output because of source geometry, bitrate or server policy.
export const VIDEO_QUALITY_TIERS = Object.freeze({
    // eslint-disable-next-line @typescript-eslint/naming-convention -- Public quality tier ID is "4k".
    '4k': { maxWidth: 3840, maxHeight: 2160, bitrateProfiles: { high: 20_000_000, medium: 12_000_000, low: 8_000_000 } },
    'full-hd': { maxWidth: 1920, maxHeight: 1080, bitrateProfiles: { high: 10_000_000, medium: 6_000_000, low: 4_000_000 } },
    hd: { maxWidth: 1280, maxHeight: 720, bitrateProfiles: { high: 5_000_000, medium: 3_000_000, low: 1_500_000 } },
    sd: { maxWidth: 854, maxHeight: 480, bitrateProfiles: { high: 2_000_000, medium: 1_200_000, low: 720_000 } }
});

export function getRemoteVideoQualityLimit(user, endpointInfo) {
    const value = Number(user?.Policy?.RemoteClientBitrateLimit);
    return endpointInfo?.IsInNetwork === true || !Number.isFinite(value) || value <= 0 ? null : value;
}

/** @param {number | null} hardLimit */
export function selectManualVideoBitrate(id, availableBitrate, hardLimit = null) {
    const profiles = VIDEO_QUALITY_TIERS[id]?.bitrateProfiles;
    if (!profiles) return null;

    // Auto's last measured throughput is a hint, not the server's permission
    // ceiling. An explicit manual selection may request the tier's low profile.
    const estimate = Number.isFinite(availableBitrate) && availableBitrate > 0 ?
        Math.max(availableBitrate, profiles.low) : profiles.medium;
    const available = Number.isFinite(hardLimit) && hardLimit > 0 ? Math.min(estimate, hardLimit) : estimate;

    for (const level of ['high', 'medium', 'low']) {
        const bitrate = profiles[level];
        if (bitrate <= available) {
            return { level, bitrate };
        }
    }

    return null;
}

function getVideoDimensions(source) {
    const video = source?.MediaStreams?.find(stream => stream.Type === 'Video');
    const width = Number(video?.Width);
    const height = Number(video?.Height);
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return null;
    return { width, height };
}

export function getVideoQualityBounds(id, source) {
    const tier = VIDEO_QUALITY_TIERS[id];
    const dimensions = getVideoDimensions(source);
    if (!tier || !dimensions) return null;
    return dimensions.height > dimensions.width ?
        { maxWidth: tier.maxHeight, maxHeight: tier.maxWidth } :
        { maxWidth: tier.maxWidth, maxHeight: tier.maxHeight };
}

export function createCappedVideoProfile(profile, id, source) {
    const tier = source ? getVideoQualityBounds(id, source) : VIDEO_QUALITY_TIERS[id];
    if (!tier || !profile) throw new Error('Requested video quality is unavailable');

    // PlaybackInfo serializes this plain DTO. Clone it for this request so a later
    // Auto/Original selection and other players retain their original capabilities.
    const capped = JSON.parse(JSON.stringify(profile));
    const conditions = [
        { Condition: 'LessThanEqual', Property: 'Width', Value: String(tier.maxWidth), IsRequired: true },
        { Condition: 'LessThanEqual', Property: 'Height', Value: String(tier.maxHeight), IsRequired: true }
    ];

    capped.CodecProfiles = capped.CodecProfiles || [];
    capped.CodecProfiles.push({ Type: 'Video', Conditions: conditions.map(condition => ({ ...condition })) });
    for (const transcodingProfile of capped.TranscodingProfiles || []) {
        if (transcodingProfile.Type === 'Video') {
            transcodingProfile.Conditions = [
                ...(transcodingProfile.Conditions || []),
                ...conditions.map(condition => ({ ...condition }))
            ];
        }
    }

    return capped;
}

function getPositiveUrlNumber(url, key) {
    if (!url) return null;
    try {
        const question = url.indexOf('?');
        if (question < 0) return null;
        const query = url.slice(question + 1).split('#', 1)[0];
        for (const param of query.split('&')) {
            const separator = param.indexOf('=');
            if (separator < 0) continue;
            const name = param.slice(0, separator);
            if (name.toLowerCase() === key.toLowerCase()) {
                const number = Number(param.slice(separator + 1));
                return Number.isFinite(number) && number > 0 ? number : null;
            }
        }
    } catch {
        // Never include the URL in diagnostics: Jellyfin may put its API key in it.
    }
    return null;
}

export function validateVideoQualityNegotiation(id, source, negotiated) {
    const tier = getVideoQualityBounds(id, source);
    if (!VIDEO_QUALITY_TIERS[id] || !negotiated) return { valid: false, reason: 'unsupported-quality' };
    if (!tier) return { valid: false, reason: 'source-dimensions-unavailable' };

    const { width, height } = getVideoDimensions(source);

    const sourceExceedsCap = width > tier.maxWidth || height > tier.maxHeight;
    if (sourceExceedsCap && (negotiated.SupportsDirectPlay || negotiated.SupportsDirectStream || negotiated.enableDirectPlay)) {
        return { valid: false, reason: 'unbounded-direct-path' };
    }

    if (!negotiated.SupportsDirectPlay && !negotiated.SupportsDirectStream && !negotiated.enableDirectPlay) {
        if (!negotiated.SupportsTranscoding) return { valid: false, reason: 'no-supported-delivery' };
        const maxWidth = getPositiveUrlNumber(negotiated.TranscodingUrl, 'MaxWidth');
        const maxHeight = getPositiveUrlNumber(negotiated.TranscodingUrl, 'MaxHeight');
        const scale = Math.min(1, tier.maxWidth / width, tier.maxHeight / height);
        const expectedWidth = Math.floor(width * scale);
        const expectedHeight = Math.floor(height * scale);
        if (!maxWidth || !maxHeight || maxWidth > tier.maxWidth || maxHeight > tier.maxHeight
                || maxWidth < expectedWidth - 2 || maxHeight < expectedHeight - 2) {
            return { valid: false, reason: 'unsupported-transcode-envelope' };
        }
    }

    return { valid: true, reason: null };
}
