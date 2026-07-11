import escapeHtml from 'escape-html';

export type PtvQualityCategory =
    | 'resolution'
    | 'source'
    | 'video-format'
    | 'video-feature'
    | 'audio';

export interface PtvQualityTag {
    category: PtvQualityCategory;
    id: string;
    label: string;
    priority: number;
}

export interface PtvQualityOptions {
    enabledCategories?: PtvQualityCategory[];
    maxTags?: number;
}

export interface PtvQualityItem extends Record<string, unknown> {
    MediaSources?: unknown;
    MediaStreams?: unknown;
    MediaType?: unknown;
    PtvQualityTags?: unknown;
    Type?: unknown;
}

type PtvQualityRecord = Record<string, unknown>;

const DEFAULT_MAX_TAGS = 6;
const DEFAULT_ENABLED_CATEGORIES: PtvQualityCategory[] = [
    'resolution',
    'source',
    'video-feature',
    'video-format',
    'audio'
];

const VIDEO_ITEM_TYPES = new Set([
    'episode',
    'movie',
    'season',
    'series',
    'video'
]);

const AUDIO_PRIORITY_TAGS = [
    { id: 'atmos', label: 'ATMOS', priority: 50 },
    { id: 'dts-x', label: 'DTS-X', priority: 49 },
    { id: 'truehd', label: 'TRUEHD', priority: 48 },
    { id: 'dts', label: 'DTS', priority: 47 },
    { id: 'dolby-digital-plus', label: 'Dolby Digital+', priority: 46 },
    { id: '7-1', label: '7.1', priority: 45 },
    { id: '5-1', label: '5.1', priority: 44 }
];

const PRECOMPUTED_CATEGORY_HINTS: Array<{
    category: PtvQualityCategory;
    patterns: RegExp[];
}> = [
    {
        category: 'resolution',
        patterns: [/^\d+k$/i, /^\d{3,4}p$/i, /^low-res$/i]
    },
    {
        category: 'source',
        patterns: [/bluray/i, /hd dvd/i, /^dvd$/i, /^vhs$/i, /hdtv/i, /physical/i]
    },
    {
        category: 'video-feature',
        patterns: [/dolby vision/i, /hdr/i, /^3d$/i]
    },
    {
        category: 'video-format',
        patterns: [/^av1$/i, /^hevc$/i, /^h265$/i, /^vp9$/i, /^h264$/i]
    },
    {
        category: 'audio',
        patterns: [/atmos/i, /dts/i, /truehd/i, /dolby digital/i, /^[57]\.1$/i]
    }
];

function isRecord(value: unknown): value is PtvQualityRecord {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function getRecordArray(value: unknown): PtvQualityRecord[] {
    if (!Array.isArray(value)) return [];

    return value.filter(isRecord);
}

function getText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);

    return '';
}

function getLowerText(...values: unknown[]): string {
    return values
        .map(getText)
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

function getNumber(...values: unknown[]): number {
    for (const value of values) {
        const parsed = typeof value === 'number' ? value : Number(value);

        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }

    return 0;
}

function getCandidateSources(item: PtvQualityItem): PtvQualityRecord[] {
    const mediaSources = getRecordArray(item.MediaSources);

    return mediaSources.length ? mediaSources : [item];
}

function getStreams(item: PtvQualityItem, source: PtvQualityRecord): PtvQualityRecord[] {
    const sourceStreams = getRecordArray(source.MediaStreams);

    if (sourceStreams.length) return sourceStreams;

    return getRecordArray(item.MediaStreams);
}

function getStreamsByType(item: PtvQualityItem, source: PtvQualityRecord, type: string): PtvQualityRecord[] {
    const expectedType = type.toLowerCase();

    return getStreams(item, source).filter(stream => getText(stream.Type).toLowerCase() === expectedType);
}

function isVideoItem(item: PtvQualityItem): boolean {
    const mediaType = getText(item.MediaType).toLowerCase();
    const itemType = getText(item.Type).toLowerCase();

    return mediaType === 'video' || VIDEO_ITEM_TYPES.has(itemType);
}

function addTag(tags: PtvQualityTag[], tag: PtvQualityTag | null) {
    if (!tag || tags.some(existingTag => existingTag.id === tag.id)) return;

    tags.push(tag);
}

function getSlug(value: string): string {
    return value.toLowerCase()
        .replace(/\+/g, 'plus')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-/, '')
        .replace(/-$/, '');
}

function inferPrecomputedCategory(label: string): PtvQualityCategory {
    const matchedHint = PRECOMPUTED_CATEGORY_HINTS.find(hint =>
        hint.patterns.some(pattern => pattern.test(label))
    );

    return matchedHint?.category || 'video-feature';
}

function getPrecomputedLabel(value: unknown): string {
    if (typeof value === 'string') return value;

    if (isRecord(value)) {
        return getText(value.label || value.Label || value.name || value.Name);
    }

    return '';
}

function getPrecomputedQualityTags(item: PtvQualityItem): PtvQualityTag[] {
    if (!Array.isArray(item.PtvQualityTags)) return [];

    return item.PtvQualityTags
        .map(getPrecomputedLabel)
        .filter(Boolean)
        .slice(0, 12)
        .map((label, index) => ({
            category: inferPrecomputedCategory(label),
            id: getSlug(label),
            label,
            priority: 120 - index
        }));
}

function getBestDimensions(item: PtvQualityItem) {
    let bestWidth = getNumber(item.Width);
    let bestHeight = getNumber(item.Height);

    for (const source of getCandidateSources(item)) {
        bestWidth = Math.max(bestWidth, getNumber(source.Width));
        bestHeight = Math.max(bestHeight, getNumber(source.Height));

        for (const stream of getStreamsByType(item, source, 'Video')) {
            bestWidth = Math.max(bestWidth, getNumber(stream.Width));
            bestHeight = Math.max(bestHeight, getNumber(stream.Height));
        }
    }

    return {
        height: bestHeight,
        width: bestWidth
    };
}

function getResolutionTag(item: PtvQualityItem): PtvQualityTag | null {
    const { height, width } = getBestDimensions(item);

    if (!width && !height) return null;
    if (!isVideoItem(item)) return null;

    if (width >= 7600 || height >= 4320) {
        return { category: 'resolution', id: '8k', label: '8K', priority: 100 };
    }

    if (width >= 3800 || height >= 2160) {
        return { category: 'resolution', id: '4k', label: '4K', priority: 99 };
    }

    if (width >= 1800 || height >= 1080) {
        return { category: 'resolution', id: '1080p', label: '1080p', priority: 98 };
    }

    if (width >= 1200 || height >= 720) {
        return { category: 'resolution', id: '720p', label: '720p', priority: 97 };
    }

    if (width >= 700 || height >= 480) {
        return { category: 'resolution', id: '480p', label: '480p', priority: 96 };
    }

    return { category: 'resolution', id: 'low-res', label: 'LOW-RES', priority: 95 };
}

function getSourceText(item: PtvQualityItem): string {
    const sourceText = getCandidateSources(item)
        .map(source => getLowerText(
            source.Name,
            source.Path,
            source.Container,
            source.Protocol,
            source.Type,
            source.MediaSourceType
        ))
        .join(' ');

    return getLowerText(item.Path, item.LocationType, item.MediaSourceType, sourceText);
}

function getSourceTag(item: PtvQualityItem): PtvQualityTag | null {
    const sourceText = getSourceText(item);

    if (!sourceText) return null;

    if (/blu[\s._-]?ray|bdremux|bdrip|brrip/.test(sourceText)) {
        return { category: 'source', id: 'bluray', label: 'BluRay', priority: 90 };
    }

    if (/hd[\s._-]?dvd/.test(sourceText)) {
        return { category: 'source', id: 'hd-dvd', label: 'HD DVD', priority: 89 };
    }

    if (/\bdvd\b|dvdrip|dvdremux/.test(sourceText)) {
        return { category: 'source', id: 'dvd', label: 'DVD', priority: 88 };
    }

    if (/\bvhs\b|vhsrip/.test(sourceText)) {
        return { category: 'source', id: 'vhs', label: 'VHS', priority: 87 };
    }

    if (/\bhdtv\b/.test(sourceText)) {
        return { category: 'source', id: 'hdtv', label: 'HDTV', priority: 86 };
    }

    if (/placeholder|offline|physical/.test(sourceText)) {
        return { category: 'source', id: 'physical', label: 'Physical', priority: 85 };
    }

    return null;
}

function getVideoText(item: PtvQualityItem): string {
    return getCandidateSources(item)
        .map(source => {
            const sourceText = getLowerText(
                item.VideoRange,
                source.VideoRange,
                source.VideoCodec,
                source.Video3DFormat,
                source.Container
            );
            const streamText = getStreamsByType(item, source, 'Video')
                .map(stream => getLowerText(
                    stream.Codec,
                    stream.CodecTag,
                    stream.Profile,
                    stream.Title,
                    stream.DisplayTitle,
                    stream.VideoRange,
                    stream.VideoRangeType,
                    stream.VideoDoViTitle,
                    stream.Video3DFormat
                ))
                .join(' ');

            return `${sourceText} ${streamText}`;
        })
        .join(' ');
}

function getVideoFeatureTags(item: PtvQualityItem): PtvQualityTag[] {
    const text = getVideoText(item);
    const tags: PtvQualityTag[] = [];

    if (/dovi|dolby\s*vision|\bdvhe\b|\bdv\b/.test(text)) {
        addTag(tags, { category: 'video-feature', id: 'dolby-vision', label: 'Dolby Vision', priority: 80 });
    }

    if (/hdr10\+|hdr10plus/.test(text)) {
        addTag(tags, { category: 'video-feature', id: 'hdr10-plus', label: 'HDR10+', priority: 79 });
    }

    if (/\bhdr\b|hdr10|hlg/.test(text)) {
        addTag(tags, { category: 'video-feature', id: 'hdr', label: 'HDR', priority: 78 });
    }

    if (/\b3d\b|mvc|half[\s._-]?sbs|half[\s._-]?ou/.test(text)) {
        addTag(tags, { category: 'video-feature', id: '3d', label: '3D', priority: 77 });
    }

    return tags;
}

function getVideoFormatTag(item: PtvQualityItem): PtvQualityTag | null {
    const text = getVideoText(item);

    if (/\bav1\b|av01/.test(text)) {
        return { category: 'video-format', id: 'av1', label: 'AV1', priority: 70 };
    }

    if (/\bhevc\b|h\.?265|x265/.test(text)) {
        return { category: 'video-format', id: text.includes('hevc') ? 'hevc' : 'h265', label: text.includes('hevc') ? 'HEVC' : 'H265', priority: 69 };
    }

    if (/\bvp9\b/.test(text)) {
        return { category: 'video-format', id: 'vp9', label: 'VP9', priority: 68 };
    }

    if (/\bh\.?264\b|\bavc\b|x264/.test(text)) {
        return { category: 'video-format', id: 'h264', label: 'H264', priority: 67 };
    }

    return null;
}

function getAudioTextForStream(stream: PtvQualityRecord): string {
    return getLowerText(
        stream.Codec,
        stream.CodecTag,
        stream.Profile,
        stream.Title,
        stream.DisplayTitle
    );
}

function addAudioCodecTags(foundTags: Set<string>, text: string) {
    if (/atmos/.test(text)) foundTags.add('atmos');
    if (/dts[\s._-]?x|dtsx/.test(text)) foundTags.add('dts-x');
    if (/true[\s._-]?hd|truehd/.test(text)) foundTags.add('truehd');
    if (/\bdts\b|dca/.test(text)) foundTags.add('dts');
    if (/e[\s._-]?ac[\s._-]?3|dd\+|dolby\s*digital\s*plus/.test(text)) foundTags.add('dolby-digital-plus');
}

function addAudioChannelTags(foundTags: Set<string>, channels: number) {
    if (channels >= 8) foundTags.add('7-1');
    if (channels >= 6) foundTags.add('5-1');
}

function addAudioStreamTags(foundTags: Set<string>, stream: PtvQualityRecord) {
    addAudioCodecTags(foundTags, getAudioTextForStream(stream));
    addAudioChannelTags(foundTags, getNumber(stream.Channels));
}

function getAudioTags(item: PtvQualityItem): PtvQualityTag[] {
    const foundTags = new Set<string>();

    for (const source of getCandidateSources(item)) {
        for (const stream of getStreamsByType(item, source, 'Audio')) {
            addAudioStreamTags(foundTags, stream);
        }
    }

    return AUDIO_PRIORITY_TAGS
        .filter(tag => foundTags.has(tag.id))
        .map(tag => ({
            category: 'audio' as const,
            id: tag.id,
            label: tag.label,
            priority: tag.priority
        }));
}

function shouldIncludeCategory(category: PtvQualityCategory, options: PtvQualityOptions): boolean {
    const enabledCategories = options.enabledCategories || DEFAULT_ENABLED_CATEGORIES;

    return enabledCategories.indexOf(category) !== -1;
}

export function getPtvQualityTags(item: PtvQualityItem, options: PtvQualityOptions = {}): PtvQualityTag[] {
    const tags: PtvQualityTag[] = getPrecomputedQualityTags(item);

    if (shouldIncludeCategory('resolution', options)) addTag(tags, getResolutionTag(item));
    if (shouldIncludeCategory('source', options)) addTag(tags, getSourceTag(item));

    if (shouldIncludeCategory('video-feature', options)) {
        getVideoFeatureTags(item).forEach(tag => {
            addTag(tags, tag);
        });
    }

    if (shouldIncludeCategory('video-format', options)) addTag(tags, getVideoFormatTag(item));

    if (shouldIncludeCategory('audio', options)) {
        getAudioTags(item).forEach(tag => {
            addTag(tags, tag);
        });
    }

    tags.sort((a, b) => b.priority - a.priority);

    return tags.slice(0, options.maxTags || DEFAULT_MAX_TAGS);
}

export function getPtvQualityPillClass(tag: PtvQualityTag): string {
    return [
        'ptv-card-quality-pill',
        `ptv-card-quality-pill-${tag.category}`,
        `ptv-card-quality-pill-${tag.id || getSlug(tag.label)}`
    ].join(' ');
}

export function getPtvQualityAttribute(item: PtvQualityItem): string {
    return getPtvQualityTags(item, { maxTags: 12 })
        .map(tag => tag.label)
        .join(',');
}

export function getPtvQualityPillsHtml(item: PtvQualityItem): string {
    const quality = getPtvQualityTags(item);

    if (!quality.length) return '';

    return '<div class="ptv-card-quality-stack">'
        + quality
            .map(tag => '<span'
                + ` class="${getPtvQualityPillClass(tag)}"`
                + ` data-ptv-quality-category="${escapeHtml(tag.category)}"`
                + ` title="${escapeHtml(tag.label)}"`
                + `>${escapeHtml(tag.label)}</span>`)
            .join('')
        + '</div>';
}
