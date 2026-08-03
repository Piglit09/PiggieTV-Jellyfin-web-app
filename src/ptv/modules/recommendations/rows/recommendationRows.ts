import type {
    PtvRecommendationMediaType,
    PtvRecommendationMix,
    PtvRecommendationReason,
    PtvRecommendationRow,
    PtvRecommendationRowDiagnostics,
    PtvRecommendationScore,
    PtvTasteProfile,
    PtvTasteSignal
} from '../types/recommendationTypes';
import {
    getRecommendationMetadata,
    getRecommendationTitle,
    getResolvedRecommendationArtists,
    normalizeRecommendationTerm
} from '../scoring/metadata';

const ROW_LIMIT = 18;
const ROW_MIN_ITEMS = 12;
const MIX_LIMIT = 50;
const MIXED_ROW_MEDIA_CAP = 6;
const ROW_ARTIST_CAP = 1;
const ROW_ALBUM_CAP = 2;
const ROW_SERIES_CAP = 2;
const SIGNATURE_MIXES = [
    { id: 'ptv-discovery-mix', title: 'PTV Discovery Mix', terms: [] },
    { id: 'ptv-horror-mix', title: 'PTV Horror Mix', terms: ['horror', 'gothic', 'supernatural', 'vampire'] },
    { id: 'ptv-anime-mix', title: 'PTV Anime Mix', terms: ['anime', 'manga', 'japanese', 'shonen'] },
    { id: 'ptv-metal-mix', title: 'PTV Metal Mix', terms: ['metal', 'metalcore', 'gothic'] },
    { id: 'ptv-country-mix', title: 'PTV Country Mix', terms: ['country', 'western', 'road'] },
    { id: 'ptv-sci-fi-mix', title: 'PTV Sci-Fi Mix', terms: ['science fiction', 'sci fi', 'space', 'alien', 'cyberpunk'] },
    { id: 'ptv-fantasy-mix', title: 'PTV Fantasy Mix', terms: ['fantasy', 'magic', 'dark fantasy'] },
    { id: 'ptv-weekend-mix', title: 'PTV Weekend Mix', terms: ['comedy', 'action', 'adventure', 'family'] },
    { id: 'ptv-driving-mix', title: 'PTV Driving Mix', terms: ['rock', 'country', 'metal', 'pop'] },
    { id: 'ptv-workout-mix', title: 'PTV Workout Mix', terms: ['metal', 'rock', 'electronic', 'action'] },
    { id: 'ptv-late-night-mix', title: 'PTV Late Night Mix', terms: ['ambient', 'gothic', 'horror', 'jazz'] }
];

export type PtvRecommendationRowsResult = {
    duplicateItemsRemoved: number;
    rowDiagnostics: PtvRecommendationRowDiagnostics[];
    rowOverlapPercentage: number;
    rows: PtvRecommendationRow[];
};

type SelectionOptions = {
    blockedKeys?: Set<string>;
    limit?: number;
    maxPerAlbum?: number;
    maxPerArtist?: number;
    maxPerMediaType?: number;
    maxPerSeries?: number;
    sort?: (left: PtvRecommendationScore, right: PtvRecommendationScore) => number;
    state?: SelectionState;
};

type SelectionResult = {
    candidateCount: number;
    duplicateItemsRemoved: number;
    items: PtvRecommendationScore[];
};

type SelectionState = {
    albumCounts: Map<string, number>;
    artistCounts: Map<string, number>;
    mediaCounts: Map<string, number>;
    seenKeys: Set<string>;
    seriesCounts: Map<string, number>;
};

type FilledSelectionResult = SelectionResult & {
    diagnostics: PtvRecommendationRowDiagnostics;
};

function topSignals(bucket: Record<string, PtvTasteSignal>, limit = 4) {
    return Object.values(bucket)
        .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
        .slice(0, limit);
}

function getStringArray(value: unknown) {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function getScoreIdentity(item: PtvRecommendationScore) {
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

function getSeriesIdentity(item: PtvRecommendationScore) {
    return normalizeRecommendationTerm(item.item.SeriesName || item.item.CollectionName || '');
}

function getAlbumIdentity(item: PtvRecommendationScore) {
    if (item.mediaType !== 'music') return '';

    return normalizeRecommendationTerm(
        item.item.AlbumId
        || item.item.ProviderIds?.MusicBrainzAlbum
        || item.item.Album
        || ''
    );
}

function compareTitle(left: PtvRecommendationScore, right: PtvRecommendationScore) {
    return getRecommendationTitle(left.item).localeCompare(getRecommendationTitle(right.item));
}

function compareRecommended(left: PtvRecommendationScore, right: PtvRecommendationScore) {
    return right.affinityScore - left.affinityScore
        || right.score - left.score
        || right.discoveryWeight - left.discoveryWeight
        || compareTitle(left, right);
}

function compareDiscovery(left: PtvRecommendationScore, right: PtvRecommendationScore) {
    const leftBlend = (left.affinityScore * 0.5) + (left.discoveryWeight * 0.5);
    const rightBlend = (right.affinityScore * 0.5) + (right.discoveryWeight * 0.5);

    return rightBlend - leftBlend
        || right.discoveryWeight - left.discoveryWeight
        || right.score - left.score
        || compareTitle(left, right);
}

function getBestReasonScore(item: PtvRecommendationScore, predicate: (reason: PtvRecommendationReason) => boolean) {
    return item.reasons
        .filter(predicate)
        .reduce((best, reason) => Math.max(best, reason.score), 0);
}

function compareWatched(left: PtvRecommendationScore, right: PtvRecommendationScore) {
    const leftHistory = getBestReasonScore(left, reason => reason.source === 'history' || reason.source === 'resume');
    const rightHistory = getBestReasonScore(right, reason => reason.source === 'history' || reason.source === 'resume');

    return rightHistory - leftHistory
        || right.affinityScore - left.affinityScore
        || right.score - left.score
        || compareTitle(left, right);
}

function compareMusicAffinity(left: PtvRecommendationScore, right: PtvRecommendationScore) {
    const leftMusic = getBestReasonScore(left, reason => reason.category === 'artists' || reason.category === 'musicGenres');
    const rightMusic = getBestReasonScore(right, reason => reason.category === 'artists' || reason.category === 'musicGenres');

    return rightMusic - leftMusic
        || right.affinityScore - left.affinityScore
        || right.score - left.score
        || compareTitle(left, right);
}

function compareRediscover(left: PtvRecommendationScore, right: PtvRecommendationScore) {
    const leftPlayCount = Number(left.item.UserData?.PlayCount || 0);
    const rightPlayCount = Number(right.item.UserData?.PlayCount || 0);
    const leftHistoricalScore = left.affinityScore + Math.max(0, 60 - left.discoveryWeight) - (leftPlayCount * 8);
    const rightHistoricalScore = right.affinityScore + Math.max(0, 60 - right.discoveryWeight) - (rightPlayCount * 8);

    return rightHistoricalScore - leftHistoricalScore
        || right.score - left.score
        || compareTitle(left, right);
}

function countMapValue(map: Map<string, number>, key: string) {
    return map.get(key) || 0;
}

function getArtistKeys(item: PtvRecommendationScore) {
    return Array.from(new Set(getResolvedRecommendationArtists(item.item).map(normalizeRecommendationTerm).filter(Boolean)));
}

function isKeyBlocked(key: string, state: SelectionState, options: SelectionOptions) {
    return !key || state.seenKeys.has(key) || Boolean(options.blockedKeys?.has(key));
}

function isMediaLimited(item: PtvRecommendationScore, state: SelectionState, options: SelectionOptions) {
    return Boolean(options.maxPerMediaType && countMapValue(state.mediaCounts, item.mediaType) >= options.maxPerMediaType);
}

function isArtistLimited(artistKeys: string[], state: SelectionState, options: SelectionOptions) {
    const maxPerArtist = options.maxPerArtist;

    if (!maxPerArtist) return false;

    return artistKeys.some(artistKey => countMapValue(state.artistCounts, artistKey) >= maxPerArtist);
}

function isSeriesLimited(seriesKey: string, state: SelectionState, options: SelectionOptions) {
    return Boolean(options.maxPerSeries && seriesKey && countMapValue(state.seriesCounts, seriesKey) >= options.maxPerSeries);
}

function isAlbumLimited(albumKey: string, state: SelectionState, options: SelectionOptions) {
    return Boolean(options.maxPerAlbum && albumKey && countMapValue(state.albumCounts, albumKey) >= options.maxPerAlbum);
}

function createSelectionState(): SelectionState {
    return {
        albumCounts: new Map<string, number>(),
        artistCounts: new Map<string, number>(),
        mediaCounts: new Map<string, number>(),
        seenKeys: new Set<string>(),
        seriesCounts: new Map<string, number>()
    };
}

function recordSelectedScore(
    item: PtvRecommendationScore,
    key: string,
    albumKey: string,
    artistKeys: string[],
    seriesKey: string,
    state: SelectionState
) {
    state.seenKeys.add(key);
    if (albumKey) state.albumCounts.set(albumKey, countMapValue(state.albumCounts, albumKey) + 1);
    state.mediaCounts.set(item.mediaType, countMapValue(state.mediaCounts, item.mediaType) + 1);
    artistKeys.forEach(artistKey => {
        state.artistCounts.set(artistKey, countMapValue(state.artistCounts, artistKey) + 1);
    });
    if (seriesKey) state.seriesCounts.set(seriesKey, countMapValue(state.seriesCounts, seriesKey) + 1);
}

function selectDiverseScores(items: PtvRecommendationScore[], options: SelectionOptions = {}): SelectionResult {
    const limit = options.limit || ROW_LIMIT;
    const sortedItems = options.sort ? items.slice().sort(options.sort) : items.slice();
    const state = options.state || createSelectionState();
    const selected: PtvRecommendationScore[] = [];
    let duplicateItemsRemoved = 0;

    for (const item of sortedItems) {
        if (selected.length >= limit) break;

        const key = getScoreIdentity(item);

        if (isKeyBlocked(key, state, options)) {
            duplicateItemsRemoved += 1;
            continue;
        }

        if (isMediaLimited(item, state, options)) {
            duplicateItemsRemoved += 1;
            continue;
        }

        const artistKeys = getArtistKeys(item);

        if (isArtistLimited(artistKeys, state, options)) {
            duplicateItemsRemoved += 1;
            continue;
        }

        const seriesKey = getSeriesIdentity(item);

        if (isSeriesLimited(seriesKey, state, options)) {
            duplicateItemsRemoved += 1;
            continue;
        }

        const albumKey = getAlbumIdentity(item);

        if (isAlbumLimited(albumKey, state, options)) {
            duplicateItemsRemoved += 1;
            continue;
        }

        recordSelectedScore(item, key, albumKey, artistKeys, seriesKey, state);
        selected.push(item);
    }

    return {
        candidateCount: sortedItems.length,
        duplicateItemsRemoved,
        items: selected
    };
}

function selectFilledDiverseScores(
    primaryItems: PtvRecommendationScore[],
    secondaryItems: PtvRecommendationScore[],
    discoveryItems: PtvRecommendationScore[],
    options: SelectionOptions = {}
): FilledSelectionResult {
    const state = createSelectionState();
    const baseOptions = {
        maxPerAlbum: ROW_ALBUM_CAP,
        maxPerArtist: ROW_ARTIST_CAP,
        maxPerSeries: ROW_SERIES_CAP,
        ...options,
        state
    };
    const selected: PtvRecommendationScore[] = [];
    let duplicateItemsRemoved = 0;
    const takePass = (items: PtvRecommendationScore[], countAsFallback: boolean) => {
        if (selected.length >= ROW_LIMIT) {
            return {
                candidateCount: items.length,
                selectedCount: 0
            };
        }

        const result = selectDiverseScores(items, {
            ...baseOptions,
            limit: ROW_LIMIT - selected.length,
            state
        });

        duplicateItemsRemoved += result.duplicateItemsRemoved;
        selected.push(...result.items);

        return {
            candidateCount: result.candidateCount,
            selectedCount: countAsFallback ? result.items.length : 0
        };
    };
    const primary = takePass(primaryItems, false);
    const secondary = selected.length < ROW_MIN_ITEMS ? takePass(secondaryItems, true) : { candidateCount: secondaryItems.length, selectedCount: 0 };
    const discovery = selected.length < ROW_MIN_ITEMS ? takePass(discoveryItems, true) : { candidateCount: discoveryItems.length, selectedCount: 0 };

    return {
        candidateCount: primary.candidateCount,
        diagnostics: {
            candidateCount: primary.candidateCount,
            dedupeRemovals: duplicateItemsRemoved,
            discoveryFallbackCount: discovery.selectedCount,
            finalRenderedCount: selected.length,
            hydrationRemovals: 0,
            primaryCandidateCount: primary.candidateCount,
            secondaryFallbackCount: secondary.selectedCount
        },
        duplicateItemsRemoved,
        items: selected
    };
}

function getRowKeys(row: PtvRecommendationRow) {
    return new Set(row.items.map(getScoreIdentity).filter(Boolean));
}

function getAdjacentRowOverlapPercentage(rows: PtvRecommendationRow[]) {
    if (rows.length < 2) return 0;

    let adjacentPairs = 0;
    let overlapTotal = 0;

    for (let index = 1; index < rows.length; index += 1) {
        const previousKeys = getRowKeys(rows[index - 1]);
        const currentKeys = getRowKeys(rows[index]);
        const denominator = Math.min(previousKeys.size, currentKeys.size);

        if (!denominator) continue;

        let intersection = 0;

        currentKeys.forEach(key => {
            if (previousKeys.has(key)) intersection += 1;
        });

        adjacentPairs += 1;
        overlapTotal += intersection / denominator;
    }

    if (!adjacentPairs) return 0;

    return Math.round((overlapTotal / adjacentPairs) * 100);
}

function hasTerm(item: PtvRecommendationScore, term: string) {
    const normalized = term.toLowerCase();

    return item.reasons.some(reason => reason.label.toLowerCase().includes(normalized))
        || String(item.item.Name || '').toLowerCase().includes(normalized)
        || String(item.item.Overview || '').toLowerCase().includes(normalized)
        || getStringArray(item.item.Genres).some(genre => genre.toLowerCase().includes(normalized))
        || getStringArray(item.item.Tags).some(tag => tag.toLowerCase().includes(normalized));
}

function isWatchedRecommendation(item: PtvRecommendationScore) {
    return ['anime', 'movie', 'show'].includes(item.mediaType)
        && item.reasons.some(reason => reason.source === 'history' || reason.source === 'resume');
}

function isMusicRecommendation(item: PtvRecommendationScore) {
    return item.mediaType === 'music'
        && hasUserRecommendationSignal(item)
        && item.reasons.some(reason => reason.category === 'artists' || reason.category === 'musicGenres');
}

function isRediscoverRecommendation(item: PtvRecommendationScore) {
    const playCount = Number(item.item.UserData?.PlayCount || 0);

    return hasUserRecommendationSignal(item)
        && playCount <= 1
        && item.item.UserData?.Played !== true
        && item.affinityScore >= 20
        && item.discoveryWeight < 70;
}

function hasUserRecommendationSignal(item: PtvRecommendationScore) {
    return item.reasons.some(reason => (
        reason.source === 'favorite'
        || reason.source === 'history'
        || reason.source === 'recently-viewed'
        || reason.source === 'resume'
    ));
}

function isHiddenGemRecommendation(item: PtvRecommendationScore) {
    return hasUserRecommendationSignal(item)
        && Number(item.item.UserData?.PlayCount || 0) === 0
        && item.item.UserData?.Played !== true
        && item.affinityScore >= 12
        && item.discoveryWeight >= 45;
}

function buildBalancedRecommendationScores(scores: PtvRecommendationScore[]) {
    const personalized = scores.filter(hasUserRecommendationSignal).sort(compareRecommended);
    const aggregate = scores
        .filter(item => !hasUserRecommendationSignal(item) && item.discoveryWeight >= 35)
        .sort(compareDiscovery);

    if (!personalized.length || !aggregate.length) return [];

    const balanced: PtvRecommendationScore[] = [];
    const seen = new Set<string>();
    const add = (item: PtvRecommendationScore | undefined) => {
        if (!item) return;
        const key = getScoreIdentity(item);

        if (!key || seen.has(key)) return;
        seen.add(key);
        balanced.push(item);
    };
    const pairCount = Math.max(personalized.length, aggregate.length);

    for (let index = 0; index < pairCount && balanced.length < ROW_LIMIT; index += 1) {
        add(personalized[index]);
        add(aggregate[index]);
    }

    return balanced;
}

const WATCHED_RELATIONSHIP_CATEGORIES = [
    'actors',
    'collections',
    'directors',
    'genres',
    'series',
    'studios',
    'tags'
] as const;

function getWatchedRelationshipTerms(item: PtvRecommendationScore['item']) {
    const categories = getRecommendationMetadata(item).categories;

    return new Set(
        WATCHED_RELATIONSHIP_CATEGORIES
            .flatMap(category => categories[category] || [])
            .map(normalizeRecommendationTerm)
            .filter(Boolean)
    );
}

function hasStrongWatchedRelationship(
    candidate: PtvRecommendationScore,
    subjectTerms: Set<string>
) {
    if (!subjectTerms.size) return false;

    return [ ...getWatchedRelationshipTerms(candidate.item) ]
        .some(term => subjectTerms.has(term));
}

function buildBecauseYouWatchedRows(
    scores: PtvRecommendationScore[],
    historyItems: PtvRecommendationScore['item'][]
) {
    const rows: Array<{ duplicateItemsRemoved: number; row: PtvRecommendationRow }> = [];
    const blockedKeys = new Set<string>();
    const seenSubjects = new Set<string>();

    for (const subject of historyItems) {
        if (rows.length >= 4) break;

        const subjectKey = normalizeRecommendationTerm(String(subject.Id || getRecommendationTitle(subject)));
        const title = getRecommendationTitle(subject);

        if (!subjectKey || !title || seenSubjects.has(subjectKey)) continue;
        seenSubjects.add(subjectKey);

        const subjectTerms = getWatchedRelationshipTerms(subject);
        const candidates = scores.filter(candidate => (
            getScoreIdentity(candidate) !== String(subject.Id || '')
            && hasStrongWatchedRelationship(candidate, subjectTerms)
        ));
        const selection = selectFilledDiverseScores(candidates, candidates, candidates, {
            blockedKeys,
            maxPerMediaType: MIXED_ROW_MEDIA_CAP,
            maxPerSeries: ROW_SERIES_CAP,
            sort: compareRecommended
        });
        const row = makeRow(
            `because-you-watched-${labelToId(subjectKey)}`,
            `Because You Watched ${title}`,
            'Related through explicit collection, series, genre, studio, tag, cast, or director metadata.',
            selection.items,
            'mixed',
            selection.diagnostics
        );

        if (!row) continue;
        row.items.forEach(item => {
            blockedKeys.add(getScoreIdentity(item));
        });
        rows.push({ duplicateItemsRemoved: selection.duplicateItemsRemoved, row });
    }

    return rows;
}

function makeRow(
    id: string,
    title: string,
    explanation: string,
    items: PtvRecommendationScore[],
    mediaType: PtvRecommendationMediaType | 'mixed',
    diagnostics?: PtvRecommendationRowDiagnostics
): PtvRecommendationRow | null {
    if (items.length < ROW_MIN_ITEMS) return null;

    return {
        diagnostics: {
            candidateCount: diagnostics?.candidateCount ?? items.length,
            dedupeRemovals: diagnostics?.dedupeRemovals ?? 0,
            discoveryFallbackCount: diagnostics?.discoveryFallbackCount ?? 0,
            finalRenderedCount: items.length,
            hydrationRemovals: diagnostics?.hydrationRemovals ?? 0,
            primaryCandidateCount: diagnostics?.primaryCandidateCount ?? diagnostics?.candidateCount ?? items.length,
            secondaryFallbackCount: diagnostics?.secondaryFallbackCount ?? 0
        },
        explanation,
        id,
        items,
        mediaType,
        title
    };
}

function labelToId(label: string) {
    return normalizeRecommendationTerm(label).replace(/[^a-z0-9]+/g, '-').replace(/(?:^-|-$)/g, '');
}

function getTermRow(
    scores: PtvRecommendationScore[],
    signal: PtvTasteSignal
): { duplicateItemsRemoved: number; row: PtvRecommendationRow | null } {
    const result = selectFilledDiverseScores(
        scores.filter(item => hasTerm(item, signal.label)),
        scores.filter(item => item.affinityScore >= 18),
        scores.filter(item => item.discoveryWeight >= 35),
        {
            maxPerArtist: ROW_ARTIST_CAP,
            maxPerMediaType: MIXED_ROW_MEDIA_CAP,
            maxPerSeries: ROW_SERIES_CAP,
            sort: compareRecommended
        }
    );

    return {
        duplicateItemsRemoved: result.duplicateItemsRemoved,
        row: makeRow(
            `because-you-like-${labelToId(signal.label)}`,
            `Because You Like ${signal.label}`,
            `Matched to your ${signal.label} taste profile score of ${Math.round(signal.score)}.`,
            result.items,
            'mixed',
            result.diagnostics
        )
    };
}

function getMediaRow(
    id: string,
    title: string,
    explanation: string,
    scores: PtvRecommendationScore[],
    mediaType: PtvRecommendationMediaType
): { duplicateItemsRemoved: number; row: PtvRecommendationRow | null } {
    const mediaScores = scores.filter(item => item.mediaType === mediaType);
    const result = selectFilledDiverseScores(mediaScores, mediaScores.filter(item => item.affinityScore >= 12), mediaScores.filter(item => item.discoveryWeight >= 35), {
        maxPerArtist: mediaType === 'music' ? ROW_ARTIST_CAP : undefined,
        maxPerSeries: ROW_SERIES_CAP,
        sort: mediaType === 'music' ? compareMusicAffinity : compareRecommended
    });

    return {
        duplicateItemsRemoved: result.duplicateItemsRemoved,
        row: makeRow(id, title, explanation, result.items, mediaType, result.diagnostics)
    };
}

export function buildPtvRecommendationRowsWithQuality(
    profile: PtvTasteProfile,
    scores: PtvRecommendationScore[],
    options: { historyItems?: PtvRecommendationScore['item'][] } = {}
): PtvRecommendationRowsResult {
    const rows: PtvRecommendationRow[] = [];
    let duplicateItemsRemoved = 0;

    function pushSelection(row: PtvRecommendationRow | null, removedCount: number) {
        duplicateItemsRemoved += removedCount;

        if (!row?.items.length) return;

        rows.push(row);
    }

    const personalizedScores = scores.filter(hasUserRecommendationSignal);
    const recommended = selectFilledDiverseScores(personalizedScores, personalizedScores, personalizedScores, {
        maxPerArtist: ROW_ARTIST_CAP,
        maxPerMediaType: MIXED_ROW_MEDIA_CAP,
        maxPerSeries: ROW_SERIES_CAP,
        sort: compareRecommended
    });

    pushSelection(makeRow(
        'recommended-for-you',
        'Made For You',
        'User-only picks supported by your favorites, history, recent activity, or resumable media.',
        recommended.items,
        'mixed',
        recommended.diagnostics
    ), recommended.duplicateItemsRemoved);

    const watchedSubjectRows = buildBecauseYouWatchedRows(scores, options.historyItems || []);

    if (watchedSubjectRows.length) {
        watchedSubjectRows.forEach(result => {
            pushSelection(result.row, result.duplicateItemsRemoved);
        });
    } else {
        const watchedScores = scores.filter(isWatchedRecommendation);
        const watched = selectFilledDiverseScores(watchedScores, watchedScores, watchedScores, {
            maxPerMediaType: MIXED_ROW_MEDIA_CAP,
            maxPerSeries: ROW_SERIES_CAP,
            sort: compareWatched
        });

        pushSelection(makeRow(
            'because-you-watched',
            'Because You Watched...',
            'Movies, shows, and anime matched directly to watch history.',
            watched.items,
            'mixed',
            watched.diagnostics
        ), watched.duplicateItemsRemoved);
    }

    const listened = selectFilledDiverseScores(scores.filter(isMusicRecommendation), scores.filter(item => item.mediaType === 'music'), scores.filter(item => item.mediaType === 'music' && item.discoveryWeight >= 35), {
        maxPerArtist: ROW_ARTIST_CAP,
        sort: compareMusicAffinity
    });

    pushSelection(makeRow(
        'because-you-listen',
        'Because You Listen To...',
        'Music matched through artist and genre affinity.',
        listened.items,
        'music',
        listened.diagnostics
    ), listened.duplicateItemsRemoved);

    const balancedRecommendationScores = buildBalancedRecommendationScores(scores);
    const discovery = selectFilledDiverseScores(balancedRecommendationScores, balancedRecommendationScores, balancedRecommendationScores, {
        maxPerArtist: ROW_ARTIST_CAP,
        maxPerMediaType: MIXED_ROW_MEDIA_CAP,
        maxPerSeries: ROW_SERIES_CAP,
        sort: compareDiscovery
    });

    pushSelection(makeRow(
        'ptv-discovery',
        'PTV Recommendation',
        'A balanced blend of user-specific affinity and aggregate discovery candidates.',
        discovery.items,
        'mixed',
        discovery.diagnostics
    ), discovery.duplicateItemsRemoved);

    const rediscoverScores = scores.filter(isRediscoverRecommendation);
    const rediscover = selectFilledDiverseScores(rediscoverScores, rediscoverScores, rediscoverScores, {
        maxPerArtist: ROW_ARTIST_CAP,
        maxPerMediaType: MIXED_ROW_MEDIA_CAP,
        maxPerSeries: ROW_SERIES_CAP,
        sort: compareRediscover
    });

    pushSelection(makeRow(
        'rediscover',
        'Rediscover',
        'Low-play historical items that still fit your taste profile.',
        rediscover.items,
        'mixed',
        rediscover.diagnostics
    ), rediscover.duplicateItemsRemoved);

    const hiddenGemScores = scores.filter(isHiddenGemRecommendation);
    const hiddenGems = selectFilledDiverseScores(hiddenGemScores, hiddenGemScores, hiddenGemScores, {
        maxPerArtist: ROW_ARTIST_CAP,
        maxPerMediaType: MIXED_ROW_MEDIA_CAP,
        maxPerSeries: ROW_SERIES_CAP,
        sort: compareDiscovery
    });

    pushSelection(makeRow(
        'hidden-gems',
        'Hidden Gems',
        'Unplayed, underexposed items with clear support from your taste signals.',
        hiddenGems.items,
        'mixed',
        hiddenGems.diagnostics
    ), hiddenGems.duplicateItemsRemoved);

    const mediaRows: Array<[
        string,
        string,
        string,
        PtvRecommendationMediaType
    ]> = [
        ['recommended-movies', 'Recommended Movies', 'Movies scored from your full PTV taste profile.', 'movie'],
        ['recommended-shows', 'Recommended Shows', 'Shows scored from your full PTV taste profile.', 'show'],
        ['recommended-anime', 'Recommended Anime', 'Anime matched through genre, manga, music, and watch signals.', 'anime'],
        ['made-for-you-music', 'Made For You', 'Music matched through artists, genres, favorites, and cross-media tone.', 'music'],
        ['recommended-books', 'Recommended Books', 'Reading picks matched from watch, listen, and reading history.', 'book'],
        ['recommended-comics', 'Recommended Comics', 'Comics matched from your genre, studio, author, and tone profile.', 'comic'],
        ['recommended-manga', 'Recommended Manga', 'Manga matched from anime, reading, and music affinity.', 'manga']
    ];

    mediaRows.forEach(([id, title, explanation, mediaType]) => {
        const result = getMediaRow(id, title, explanation, personalizedScores, mediaType);

        pushSelection(result.row, result.duplicateItemsRemoved);
    });

    topSignals(profile.crossMediaTerms, 6).forEach(signal => {
        const result = getTermRow(scores, signal);

        pushSelection(result.row, result.duplicateItemsRemoved);
    });

    topSignals(profile.favoriteArtists, 3).forEach(signal => {
        const primaryScores = scores.filter(item => item.mediaType === 'music' && hasTerm(item, signal.label));
        const result = selectFilledDiverseScores(
            primaryScores,
            scores.filter(item => item.mediaType === 'music'),
            scores.filter(item => item.mediaType === 'music' && item.discoveryWeight >= 35),
            {
                maxPerArtist: ROW_ARTIST_CAP,
                sort: compareMusicAffinity
            }
        );

        pushSelection(makeRow(
            `because-you-listen-to-${labelToId(signal.label)}`,
            `Because You Listen To ${signal.label}`,
            `Artist affinity score ${Math.round(signal.score)} matched against music metadata.`,
            result.items,
            'music',
            result.diagnostics
        ), result.duplicateItemsRemoved);
    });

    return {
        duplicateItemsRemoved,
        rowDiagnostics: rows.map(row => row.diagnostics).filter((diagnostic): diagnostic is PtvRecommendationRowDiagnostics => Boolean(diagnostic)),
        rowOverlapPercentage: getAdjacentRowOverlapPercentage(rows),
        rows
    };
}

export function buildPtvRecommendationRows(
    profile: PtvTasteProfile,
    scores: PtvRecommendationScore[],
    options: { historyItems?: PtvRecommendationScore['item'][] } = {}
): PtvRecommendationRow[] {
    return buildPtvRecommendationRowsWithQuality(profile, scores, options).rows;
}

export function buildPtvRecommendationMixes(scores: PtvRecommendationScore[]): PtvRecommendationMix[] {
    return SIGNATURE_MIXES
        .map(mix => {
            const sourceItems = mix.terms.length ?
                scores.filter(item => mix.terms.some(term => hasTerm(item, term))) :
                scores.filter(item => item.discoveryWeight >= 35);
            const selected = selectDiverseScores(sourceItems, {
                limit: MIX_LIMIT,
                maxPerAlbum: ROW_ALBUM_CAP,
                maxPerArtist: ROW_ARTIST_CAP,
                maxPerMediaType: mix.terms.length ? undefined : MIXED_ROW_MEDIA_CAP + 6,
                maxPerSeries: ROW_SERIES_CAP,
                sort: mix.terms.length ? compareRecommended : compareDiscovery
            });

            return {
                description: `${selected.items.length} local picks generated from affinity plus discovery scoring.`,
                id: mix.id,
                items: selected.items,
                title: mix.title
            };
        })
        .filter(mix => mix.items.length);
}
