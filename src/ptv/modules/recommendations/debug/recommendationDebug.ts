import type {
    PtvRecommendationDebugReport,
    PtvRecommendationDebugSignal,
    PtvRecommendationQualityDebug,
    PtvRecommendationRow,
    PtvRecommendationRunOptions,
    PtvRecommendationScore,
    PtvRecommendationScoreDistribution,
    PtvTasteProfile,
    PtvTasteSignal
} from '../types/recommendationTypes';
import { getRecommendationTitle, hasResolvedRecommendationArtist } from '../scoring/metadata';

const DEFAULT_DEBUG_ITEM_LIMIT = 80;
const EMPTY_SCORE_DISTRIBUTION: PtvRecommendationScoreDistribution = {
    buckets: [
        { count: 0, label: '0-19' },
        { count: 0, label: '20-39' },
        { count: 0, label: '40-59' },
        { count: 0, label: '60-79' },
        { count: 0, label: '80-96' }
    ],
    max: 0,
    median: 0,
    min: 0,
    p25: 0,
    p75: 0,
    p90: 0
};

function getAffinityMatch(item: PtvRecommendationScore) {
    return item.reasons
        .filter(reason => reason.category !== 'discovery')
        .map(reason => `${reason.label} (${reason.category})`)
        .slice(0, 6);
}

function topDebugSignals(bucket: Record<string, PtvTasteSignal>, limit = 8): PtvRecommendationDebugSignal[] {
    return Object.values(bucket)
        .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
        .slice(0, limit)
        .map(signal => ({
            count: signal.count,
            label: signal.label,
            score: Math.round(signal.score)
        }));
}

function getPercentile(sortedScores: number[], percentile: number) {
    if (!sortedScores.length) return 0;

    const index = Math.min(sortedScores.length - 1, Math.max(0, Math.round((sortedScores.length - 1) * percentile)));

    return sortedScores[index];
}

export function getPtvRecommendationScoreDistribution(scores: PtvRecommendationScore[]): PtvRecommendationScoreDistribution {
    if (!scores.length) return EMPTY_SCORE_DISTRIBUTION;

    const sortedScores = scores.map(score => score.score).sort((left, right) => left - right);
    const buckets = [
        { count: scores.filter(score => score.score < 20).length, label: '0-19' },
        { count: scores.filter(score => score.score >= 20 && score.score < 40).length, label: '20-39' },
        { count: scores.filter(score => score.score >= 40 && score.score < 60).length, label: '40-59' },
        { count: scores.filter(score => score.score >= 60 && score.score < 80).length, label: '60-79' },
        { count: scores.filter(score => score.score >= 80).length, label: '80-96' }
    ];

    return {
        buckets,
        max: sortedScores[sortedScores.length - 1],
        median: getPercentile(sortedScores, 0.5),
        min: sortedScores[0],
        p25: getPercentile(sortedScores, 0.25),
        p75: getPercentile(sortedScores, 0.75),
        p90: getPercentile(sortedScores, 0.9)
    };
}

function getRowKey(item: PtvRecommendationScore) {
    return String(
        item.item.Id
        || item.item.ProviderIds?.Imdb
        || item.item.ProviderIds?.Tmdb
        || item.item.ProviderIds?.Tvdb
        || item.item.ProviderIds?.MusicBrainzTrackId
        || item.item.ProviderIds?.MusicBrainzAlbum
        || `${getRecommendationTitle(item.item)}:${item.mediaType}`
    );
}

function getRowOverlapPercentage(rows: PtvRecommendationRow[]) {
    if (rows.length < 2) return 0;

    let pairCount = 0;
    let overlapTotal = 0;

    for (let index = 1; index < rows.length; index += 1) {
        const previous = new Set(rows[index - 1].items.map(getRowKey).filter(Boolean));
        const current = new Set(rows[index].items.map(getRowKey).filter(Boolean));
        const denominator = Math.min(previous.size, current.size);

        if (!denominator) continue;

        let intersection = 0;

        current.forEach(key => {
            if (previous.has(key)) intersection += 1;
        });

        pairCount += 1;
        overlapTotal += intersection / denominator;
    }

    return pairCount ? Math.round((overlapTotal / pairCount) * 100) : 0;
}

function getRecommendationQualityDebug(
    scores: PtvRecommendationScore[],
    rows: PtvRecommendationRow[],
    quality: Partial<PtvRecommendationQualityDebug> = {}
): PtvRecommendationQualityDebug {
    return {
        duplicateItemsRemoved: quality.duplicateItemsRemoved || 0,
        rowDiagnostics: quality.rowDiagnostics || rows
            .map(row => row.diagnostics)
            .filter((diagnostic): diagnostic is NonNullable<PtvRecommendationRow['diagnostics']> => Boolean(diagnostic)),
        rowOverlapPercentage: quality.rowOverlapPercentage ?? getRowOverlapPercentage(rows),
        scoreDistribution: quality.scoreDistribution || getPtvRecommendationScoreDistribution(scores),
        unresolvedArtistCount: quality.unresolvedArtistCount ?? scores
            .filter(score => score.mediaType === 'music')
            .filter(score => !hasResolvedRecommendationArtist(score.item))
            .length
    };
}

export function buildPtvRecommendationDebugReport(
    profile: PtvTasteProfile,
    scores: PtvRecommendationScore[],
    rows: PtvRecommendationRow[] = [],
    quality: Partial<PtvRecommendationQualityDebug> = {},
    limit = DEFAULT_DEBUG_ITEM_LIMIT,
    options: PtvRecommendationRunOptions = {}
): PtvRecommendationDebugReport {
    return {
        generatedAt: options.now || Date.now(),
        items: scores.slice(0, limit).map(score => ({
            affinityMatch: getAffinityMatch(score),
            discoveryWeight: score.discoveryWeight,
            itemId: String(score.item.Id || ''),
            mediaType: score.mediaType,
            reasons: score.reasons,
            score: score.score,
            source: score.source,
            title: getRecommendationTitle(score.item)
        })),
        profile: {
            serverId: profile.serverId,
            topArtists: topDebugSignals(profile.favoriteArtists),
            topAuthors: topDebugSignals(profile.favoriteAuthors),
            topBookGenres: topDebugSignals(profile.favoriteBookGenres),
            topCollections: topDebugSignals(profile.favoriteCollections),
            topCrossMediaTerms: topDebugSignals(profile.crossMediaTerms),
            topGenres: topDebugSignals(profile.favoriteGenres),
            topStudios: topDebugSignals(profile.favoriteStudios),
            updatedAt: profile.updatedAt,
            userId: profile.userId
        },
        profileVersion: profile.profileVersion,
        quality: getRecommendationQualityDebug(scores, rows, quality),
        sourceCounts: profile.sourceCounts,
        sourceFailures: options.sourceFailures || [],
        sourceTimings: options.sourceTimings || []
    };
}
