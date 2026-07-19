import { recordPtvEvent } from '../../ptv/core/observability';

type MediaStreamLike = Record<string, unknown> & {
    AverageFrameRate?: number | null;
    BitDepth?: number | null;
    BitRate?: number | null;
    Channels?: number | null;
    Codec?: string | null;
    Height?: number | null;
    IsExternal?: boolean | null;
    Language?: string | null;
    PixelFormat?: string | null;
    Profile?: string | null;
    SampleRate?: number | null;
    Type?: string | null;
    VideoRangeType?: string | null;
    Width?: number | null;
};

type MediaSourceLike = Record<string, unknown> & {
    BitRate?: number | null;
    Bitrate?: number | null;
    Container?: string | null;
    Id?: string | null;
    MediaStreams?: MediaStreamLike[] | null;
    Name?: string | null;
    Path?: string | null;
    RunTimeTicks?: number | null;
    Size?: number | null;
};

type TechnicalSignal =
    | 'audio-streams'
    | 'bitrate'
    | 'container'
    | 'media-name'
    | 'runtime'
    | 'size'
    | 'video-streams';

type ComparisonSignal = TechnicalSignal | 'id' | 'path';

export type MediaSourceComparisonReason =
    | 'id-match'
    | 'insufficient-technical-evidence'
    | 'normalized-path-match'
    | 'technical-signature-conflict'
    | 'technical-signature-match';

export type MediaSourceComparisonExplanation = {
    conflictingSignals: ComparisonSignal[];
    equivalent: boolean;
    matchingSignals: ComparisonSignal[];
    reason: MediaSourceComparisonReason;
};

type MediaSourceComparisonDiagnostic = MediaSourceComparisonExplanation & {
    candidateIndex: number;
    retainedIndex: number;
};

export type MediaSourceDeduplicationDiagnostic = {
    comparisons: MediaSourceComparisonDiagnostic[];
    inputCount: number;
    mergedCount: number;
    outputCount: number;
    truncated: boolean;
};

type TechnicalSignature = Record<TechnicalSignal, string>;

const TECHNICAL_SIGNALS: TechnicalSignal[] = [
    'media-name',
    'container',
    'runtime',
    'bitrate',
    'size',
    'video-streams',
    'audio-streams'
];

const TECHNICAL_SIGNAL_WEIGHT: Record<TechnicalSignal, number> = {
    'audio-streams': 2,
    bitrate: 1,
    container: 1,
    'media-name': 1,
    runtime: 2,
    size: 4,
    'video-streams': 3
};

const MAX_DIAGNOSTIC_COMPARISONS = 24;

function normalizeText(value: unknown): string {
    return String(value ?? '').trim().toLowerCase();
}

function normalizePath(value: unknown): string {
    let path = normalizeText(value).split('\\').join('/');

    while (path.endsWith('/')) path = path.slice(0, -1);

    return path;
}

function normalizePositiveNumber(value: unknown): string {
    const number = Number(value);

    return Number.isFinite(number) && number > 0 ? String(number) : '';
}

function normalizeBitRate(value: unknown): string {
    const number = Number(value);

    // Probe results can differ by a few bits per second for the same file.
    return Number.isFinite(number) && number > 0 ?
        String(Math.max(1, Math.round(number / 1000))) :
        '';
}

function normalizeRuntime(value: unknown): string {
    const number = Number(value);

    // Jellyfin runtime values use 100ns ticks. Millisecond precision is sufficient
    // to identify a file while avoiding inconsequential probe rounding differences.
    return Number.isFinite(number) && number > 0 ?
        String(Math.max(1, Math.round(number / 10_000))) :
        '';
}

function normalizeContainer(value: unknown): string {
    return normalizeText(value)
        .split(/[;,]/)
        .map(part => part.trim())
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right))
        .join(',');
}

function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function stripFileExtension(value: string): string {
    return value.replace(/\.[a-z\d]{1,10}$/i, '');
}

function normalizeMediaName(source: MediaSourceLike): string {
    const pathWithoutQuery = normalizePath(source.Path).split(/[?#]/)[0];
    const pathName = pathWithoutQuery.split('/').pop();
    const name = pathName || normalizeText(source.Name);

    return stripFileExtension(safeDecode(name || ''))
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeFrameRate(value: unknown): string {
    const number = Number(value);

    return Number.isFinite(number) && number > 0 ? number.toFixed(3) : '';
}

function getStreamSignature(stream: MediaStreamLike, type: 'audio' | 'video'): string {
    const common = [
        normalizeText(stream.Codec),
        normalizeText(stream.Profile),
        normalizeBitRate(stream.BitRate),
        normalizePositiveNumber(stream.BitDepth)
    ];
    const typeSpecific = type === 'video' ? [
        normalizePositiveNumber(stream.Width),
        normalizePositiveNumber(stream.Height),
        normalizeText(stream.PixelFormat),
        normalizeText(stream.VideoRangeType),
        normalizeFrameRate(stream.AverageFrameRate)
    ] : [
        normalizePositiveNumber(stream.Channels),
        normalizePositiveNumber(stream.SampleRate),
        normalizeText(stream.Language)
    ];
    const values = [...common, ...typeSpecific];

    return values.some(Boolean) ? values.join('|') : '';
}

function getStreamsSignature(source: MediaSourceLike, type: 'audio' | 'video'): string {
    return (source.MediaStreams || [])
        .filter(stream => normalizeText(stream.Type) === type && stream.IsExternal !== true)
        .map(stream => getStreamSignature(stream, type))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right))
        .join('~');
}

function getTechnicalSignature(source: MediaSourceLike): TechnicalSignature {
    return {
        'audio-streams': getStreamsSignature(source, 'audio'),
        bitrate: normalizeBitRate(source.BitRate ?? source.Bitrate),
        container: normalizeContainer(source.Container),
        'media-name': normalizeMediaName(source),
        runtime: normalizeRuntime(source.RunTimeTicks),
        size: normalizePositiveNumber(source.Size),
        'video-streams': getStreamsSignature(source, 'video')
    };
}

function getTechnicalComparison(left: TechnicalSignature, right: TechnicalSignature) {
    const matchingSignals: TechnicalSignal[] = [];
    const conflictingSignals: TechnicalSignal[] = [];

    for (const signal of TECHNICAL_SIGNALS) {
        if (!left[signal] || !right[signal]) continue;

        if (left[signal] === right[signal]) {
            matchingSignals.push(signal);
        } else {
            conflictingSignals.push(signal);
        }
    }

    const confidence = matchingSignals.reduce(
        (total, signal) => total + TECHNICAL_SIGNAL_WEIGHT[signal],
        0
    );
    const hasStrongMediaSignal = matchingSignals.some(signal => (
        signal === 'size'
        || signal === 'video-streams'
        || signal === 'audio-streams'
    ));
    const hardConflicts = conflictingSignals.filter(signal => signal !== 'media-name');
    const hasOnlyNameConflict = conflictingSignals.length === 1
        && conflictingSignals[0] === 'media-name';
    const minimumConfidence = matchingSignals.includes('size') ? 6 : 8;

    return {
        conflictingSignals,
        isStrongMatch: hardConflicts.length === 0
            && hasStrongMediaSignal
            && matchingSignals.length >= 2
            && confidence >= Math.max(minimumConfidence, hasOnlyNameConflict ? 9 : 0),
        matchingSignals
    };
}

function hasHardTechnicalConflict(left: MediaSourceLike, right: MediaSourceLike): boolean {
    const technical = getTechnicalComparison(
        getTechnicalSignature(left),
        getTechnicalSignature(right)
    );

    return technical.conflictingSignals.some(signal => signal !== 'media-name');
}

/**
 * Explains a comparison using signal names only. Raw paths, source IDs, names,
 * and technical values are intentionally excluded so diagnostics are safe to share.
 */
export function explainMediaSourceComparison(
    left: MediaSourceLike,
    right: MediaSourceLike
): MediaSourceComparisonExplanation {
    const leftPath = normalizePath(left.Path);
    const rightPath = normalizePath(right.Path);
    const leftId = normalizeText(left.Id);
    const rightId = normalizeText(right.Id);
    const technical = getTechnicalComparison(
        getTechnicalSignature(left),
        getTechnicalSignature(right)
    );
    const matchingSignals: ComparisonSignal[] = [...technical.matchingSignals];
    const conflictingSignals: ComparisonSignal[] = [...technical.conflictingSignals];

    if (leftPath && rightPath) {
        (leftPath === rightPath ? matchingSignals : conflictingSignals).unshift('path');
    }

    if (leftId && rightId) {
        (leftId === rightId ? matchingSignals : conflictingSignals).push('id');
    }

    if (leftPath && leftPath === rightPath) {
        return {
            conflictingSignals,
            equivalent: true,
            matchingSignals,
            reason: 'normalized-path-match'
        };
    }

    if (leftId && leftId === rightId && technical.conflictingSignals.length === 0) {
        return {
            conflictingSignals,
            equivalent: true,
            matchingSignals,
            reason: 'id-match'
        };
    }

    if (technical.isStrongMatch) {
        return {
            conflictingSignals,
            equivalent: true,
            matchingSignals,
            reason: 'technical-signature-match'
        };
    }

    return {
        conflictingSignals,
        equivalent: false,
        matchingSignals,
        reason: technical.conflictingSignals.length ?
            'technical-signature-conflict' :
            'insufficient-technical-evidence'
    };
}

export function getMediaSourceIdentity(source: MediaSourceLike): string {
    const path = normalizePath(source.Path);
    const id = normalizeText(source.Id);
    const technical = getTechnicalSignature(source);

    if (path) return `path:${path}`;
    if (id) return `id:${id}`;

    const signature = TECHNICAL_SIGNALS.map(signal => technical[signal]).join('|');

    return `technical:${signature}`;
}

function getSourceRichness(source: MediaSourceLike): number {
    const sourceFieldCount = Object.keys(source)
        .filter(key => source[key] !== null && source[key] !== undefined && source[key] !== '')
        .length;
    const streamFieldCount = (source.MediaStreams || []).reduce(
        (total, stream) => total + Object.keys(stream)
            .filter(key => stream[key] !== null && stream[key] !== undefined && stream[key] !== '')
            .length,
        0
    );

    return sourceFieldCount + streamFieldCount + (source.MediaStreams?.length || 0) * 5;
}

function selectRicherSource(current: MediaSourceLike, candidate: MediaSourceLike): MediaSourceLike {
    return getSourceRichness(candidate) > getSourceRichness(current) ? candidate : current;
}

function clustersHaveHardTechnicalConflict<T extends MediaSourceLike>(
    leftMembers: Array<{ source: T }>,
    rightMembers: Array<{ source: T }>
): boolean {
    return leftMembers.some(left => (
        rightMembers.some(right => hasHardTechnicalConflict(left.source, right.source))
    ));
}

function compareSourceToCluster<T extends MediaSourceLike>(
    members: Array<{ originalIndex: number; source: T }>,
    source: T
) {
    let hasEquivalentMember = false;
    let hasBlockingConflict = false;
    const comparisons = members.map(member => {
        const explanation = explainMediaSourceComparison(member.source, source);

        if (explanation.equivalent) hasEquivalentMember = true;
        if (
            explanation.reason !== 'normalized-path-match'
            && hasHardTechnicalConflict(member.source, source)
        ) {
            hasBlockingConflict = true;
        }

        return { explanation, retainedIndex: member.originalIndex };
    });

    return {
        comparisons,
        isMatch: hasEquivalentMember && !hasBlockingConflict
    };
}

function dedupeWithDiagnostics<T extends MediaSourceLike>(sources?: T[] | null) {
    const input = sources || [];
    const uniqueSources: Array<{
        members: Array<{ originalIndex: number; source: T }>;
        source: T;
    }> = [];
    const comparisons: MediaSourceComparisonDiagnostic[] = [];
    let comparisonCount = 0;

    input.forEach((source, candidateIndex) => {
        const matchedSources: Array<typeof uniqueSources[number]> = [];

        for (const retained of uniqueSources) {
            const clusterComparison = compareSourceToCluster(retained.members, source);

            for (const comparison of clusterComparison.comparisons) {
                comparisonCount += 1;
                if (comparisons.length < MAX_DIAGNOSTIC_COMPARISONS) {
                    comparisons.push({
                        ...comparison.explanation,
                        candidateIndex,
                        retainedIndex: comparison.retainedIndex
                    });
                }
            }

            if (clusterComparison.isMatch) matchedSources.push(retained);
        }

        const primaryMatch = matchedSources[0];

        if (primaryMatch) {
            for (const additionalMatch of matchedSources.slice(1)) {
                if (clustersHaveHardTechnicalConflict(
                    primaryMatch.members,
                    additionalMatch.members
                )) continue;

                primaryMatch.members.push(...additionalMatch.members);
                primaryMatch.source = selectRicherSource(
                    primaryMatch.source,
                    additionalMatch.source
                ) as T;
                uniqueSources.splice(uniqueSources.indexOf(additionalMatch), 1);
            }

            primaryMatch.members.push({ originalIndex: candidateIndex, source });
            primaryMatch.source = selectRicherSource(primaryMatch.source, source) as T;
        } else {
            uniqueSources.push({
                members: [{ originalIndex: candidateIndex, source }],
                source
            });
        }
    });

    return {
        diagnostic: {
            comparisons,
            inputCount: input.length,
            mergedCount: input.length - uniqueSources.length,
            outputCount: uniqueSources.length,
            truncated: comparisonCount > comparisons.length
        } satisfies MediaSourceDeduplicationDiagnostic,
        sources: uniqueSources.map(entry => entry.source)
    };
}

export function getMediaSourceDeduplicationDiagnostic(
    sources?: MediaSourceLike[] | null
): MediaSourceDeduplicationDiagnostic {
    return dedupeWithDiagnostics(sources).diagnostic;
}

export function dedupeMediaSources<T extends MediaSourceLike>(sources?: T[] | null): T[] {
    const result = dedupeWithDiagnostics(sources);

    if (result.diagnostic.inputCount > 1) {
        recordPtvEvent('render', 'media-source-deduplication', result.diagnostic);
    }

    return result.sources;
}

export function getUniqueMediaSourceCount(item: Record<string, unknown>): number {
    if (Array.isArray(item.MediaSources) && item.MediaSources.length) {
        return dedupeMediaSources(item.MediaSources as MediaSourceLike[]).length;
    }

    return Number(item.MediaSourceCount) || 1;
}

export function normalizeItemMediaSources<T extends Record<string, unknown>>(item: T): T {
    const sources = dedupeMediaSources(item.MediaSources as MediaSourceLike[] | undefined);

    if (!Array.isArray(item.MediaSources)) return item;

    return {
        ...item,
        MediaSourceCount: sources.length,
        MediaSources: sources
    };
}
