import type { NativeHomeProfile } from './homeProfileService';
import type { NativeHomePersonalizationSettings } from './homeLayoutService';
import type { NativeHomeRow } from '../hooks';

export type NativeHomeRowScore = {
    pinned: boolean;
    reason: string;
    rowId: string;
    score: number;
    title: string;
};

function rowText(row: NativeHomeRow) {
    return `${row.id} ${row.source} ${row.title} ${row.subtitle} ${row.sourceValue || ''}`.toLowerCase();
}

function includesAny(value: string, terms: string[]) {
    return terms.some(term => value.includes(term.toLowerCase()));
}

export function scoreNativeHomeRow(
    row: NativeHomeRow,
    profile: NativeHomeProfile,
    settings: NativeHomePersonalizationSettings
): NativeHomeRowScore {
    const text = rowText(row);
    const pinnedIndex = settings.pinnedRows.indexOf(row.id);
    const pinned = pinnedIndex >= 0;
    let score = 20;
    const reasons: string[] = [];

    if (row.id === 'today-for-you' || row.source === 'adaptive-today') {
        score += 96;
        reasons.push('contextual today row');
    }

    if (/continue[-\s]watching|resume/.test(text)) {
        score += 100 + Math.min(20, profile.continueCounts.watching * 5);
        reasons.push('unfinished video');
    }

    if (/continue[-\s]reading/.test(text)) {
        score += 72 + Math.min(18, profile.continueCounts.reading * 6);
        reasons.push('unfinished reading');
    }

    if (/continue[-\s]listening/.test(text)) {
        score += 70 + Math.min(18, profile.continueCounts.listening * 6);
        reasons.push('unfinished listening');
    }

    if (/latest|recently[-\s]added/.test(text)) {
        score += profile.context.isWeekend ? 64 : 58;
        reasons.push('fresh media');
    }

    if (row.source === 'recommendation' || row.rowType === 'generated-recommendation') {
        const itemRatio = Math.min(1, row.items.length / 18);
        score += 54 + Math.round(itemRatio * 18);
        if (row.recommendationItemsHydrated) score += 4;
        reasons.push('accepted recommendation');
    }

    if (row.rowType === 'configured-rule') {
        score += Math.max(0, 34 - (row.sourceSortIndex || 0));
        reasons.push('configured row');
    }

    if (settings.moodRecommendations && profile.topGenres.some(genre => text.includes(genre.toLowerCase()))) {
        score += 12;
        reasons.push('matches profile genres');
    }

    if (settings.moodRecommendations && includesAny(text, [profile.mood])) {
        score += 10;
        reasons.push('matches current mood');
    }

    if (settings.seasonalRows && profile.seasonal.keywords.length && includesAny(text, profile.seasonal.keywords)) {
        score += 8;
        reasons.push(`seasonal ${profile.seasonal.label}`);
    }

    if (pinned) {
        score += 10000 - pinnedIndex;
        reasons.unshift('pinned');
    }

    return {
        pinned,
        reason: reasons.join(', ') || 'balanced placement',
        rowId: row.id,
        score,
        title: row.title
    };
}

export function rankNativeHomeRows(
    rows: NativeHomeRow[],
    profile: NativeHomeProfile,
    settings: NativeHomePersonalizationSettings
) {
    const startedAt = performance.now();
    const scoredRows = rows.map((row, index) => ({
        index,
        row,
        score: scoreNativeHomeRow(row, profile, settings)
    }));

    if (settings.autoReorder !== false && settings.adaptiveRows !== false) {
        scoredRows.sort((left, right) => right.score.score - left.score.score || left.index - right.index);
    }

    return {
        rankingMs: Number((performance.now() - startedAt).toFixed(1)),
        rowScores: scoredRows.map(entry => entry.score),
        rows: scoredRows.map(entry => ({
            ...entry.row,
            adaptivePriorityScore: entry.score.score,
            adaptiveReason: entry.score.reason,
            homeProfileMood: profile.mood,
            homeProfileMoodConfidence: profile.moodConfidence,
            pinned: entry.score.pinned,
            personalizationSource: settings.adaptiveRows === false ? 'static' : 'adaptive-home'
        }))
    };
}
