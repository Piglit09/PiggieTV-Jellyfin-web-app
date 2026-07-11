import type { NativeHomeProfile } from './homeProfileService';
import { rankNativeHomeRows, type NativeHomeRowScore } from './homeRankingService';
import { getNativeHomeEditorialDescription } from './recommendationReasonService';
import type { NativeHomeRow } from '../hooks';

export type NativeHomeLayoutMode = 'balanced' | 'cinematic' | 'compact' | 'focused' | 'minimal';

export type NativeHomePersonalizationSettings = {
    adaptiveRows: boolean;
    autoReorder: boolean;
    crossMediaRecommendations: boolean;
    experimentalRecommendations: boolean;
    layoutMode: NativeHomeLayoutMode;
    moodRecommendations: boolean;
    pinnedRows: string[];
    recentlyReleasedRows: boolean;
    seasonalRows: boolean;
};

export type NativeHomeAdaptiveDebug = {
    currentMood: string;
    homeGenerationMs: number | null;
    layoutMode: NativeHomeLayoutMode;
    personalizationScore: number;
    profileUpdatedAt: number | null;
    rankingMs: number | null;
    recommendationCacheAgeMs: number | null;
    suppressedHomeRows: Array<{ id: string; title: string }>;
    suppressedHomeRowsCount: number;
    rowScores: NativeHomeRowScore[];
    seasonalContext: string;
    settings: NativeHomePersonalizationSettings;
    topGenres: string[];
    topStudios: string[];
};

const HOME_LAYOUT_STORAGE_KEY = 'ptv.home.layout.v1';

export const DEFAULT_NATIVE_HOME_PERSONALIZATION_SETTINGS: NativeHomePersonalizationSettings = {
    adaptiveRows: true,
    autoReorder: true,
    crossMediaRecommendations: true,
    experimentalRecommendations: false,
    layoutMode: 'balanced',
    moodRecommendations: true,
    pinnedRows: [],
    recentlyReleasedRows: true,
    seasonalRows: true
};

function getStoredSettings(): Partial<NativeHomePersonalizationSettings> {
    try {
        const raw = window.localStorage?.getItem(HOME_LAYOUT_STORAGE_KEY);

        return raw ? JSON.parse(raw) as Partial<NativeHomePersonalizationSettings> : {};
    } catch {
        return {};
    }
}

export function loadNativeHomePersonalizationSettings(): NativeHomePersonalizationSettings {
    const stored = getStoredSettings();

    return {
        ...DEFAULT_NATIVE_HOME_PERSONALIZATION_SETTINGS,
        ...stored,
        pinnedRows: Array.isArray(stored.pinnedRows) ? stored.pinnedRows.filter(Boolean) : []
    };
}

export function saveNativeHomePersonalizationSettings(settings: NativeHomePersonalizationSettings) {
    try {
        window.localStorage?.setItem(HOME_LAYOUT_STORAGE_KEY, JSON.stringify(settings));
    } catch {
        // Home layout preferences are client-side convenience state.
    }
}

export function toggleNativeHomePinnedRow(rowId: string) {
    const settings = loadNativeHomePersonalizationSettings();
    const pinnedRows = settings.pinnedRows.includes(rowId)
        ? settings.pinnedRows.filter(id => id !== rowId)
        : [...settings.pinnedRows, rowId];
    const next = {
        ...settings,
        pinnedRows
    };

    saveNativeHomePersonalizationSettings(next);
    return next;
}

export function moveNativeHomePinnedRow(rowId: string, direction: 'down' | 'up') {
    const settings = loadNativeHomePersonalizationSettings();
    const index = settings.pinnedRows.indexOf(rowId);

    if (index < 0) return settings;

    const nextIndex = direction === 'up' ? Math.max(0, index - 1) : Math.min(settings.pinnedRows.length - 1, index + 1);
    const pinnedRows = [...settings.pinnedRows];
    const [row] = pinnedRows.splice(index, 1);

    pinnedRows.splice(nextIndex, 0, row);

    const next = {
        ...settings,
        pinnedRows
    };

    saveNativeHomePersonalizationSettings(next);
    return next;
}

export function resetNativeHomeLayoutPreferences() {
    saveNativeHomePersonalizationSettings(DEFAULT_NATIVE_HOME_PERSONALIZATION_SETTINGS);
    return DEFAULT_NATIVE_HOME_PERSONALIZATION_SETTINGS;
}

function rowText(row: NativeHomeRow) {
    return [
        row.id,
        row.source,
        row.title,
        row.subtitle,
        row.sourceGroupId,
        row.sourceGroupTitle,
        row.sourceType,
        row.rowType,
        row.renderedSource
    ].filter(Boolean).join(' ').toLowerCase();
}

function isNativeHomePinnedRow(row: NativeHomeRow, settings: NativeHomePersonalizationSettings) {
    return settings.pinnedRows.includes(row.id);
}

function isNativeHomeRecommendationRow(row: NativeHomeRow) {
    return row.source === 'recommendation'
        || row.renderedSource === 'recommendation-settings'
        || row.rowType === 'generated-recommendation';
}

function isNativeHomeContinueRow(row: NativeHomeRow) {
    if (['continue-listening', 'continue-reading', 'next-up', 'resume'].includes(row.source)) return true;

    return /\b(?:continue|resume|next up|pick up)\b/.test(rowText(row));
}

function isNativeHomeLatestRow(row: NativeHomeRow) {
    if (row.source === 'recently-added') return true;

    return /\b(?:latest|recently added|new in|newly added)\b/.test(rowText(row));
}

function isNativeHomeSeasonalRow(row: NativeHomeRow, settings: NativeHomePersonalizationSettings) {
    if (!settings.seasonalRows) return false;

    return /\b(?:seasonal|holiday|christmas|halloween|summer|winter|spring|fall|autumn|award|oscars|featured season)\b/.test(rowText(row));
}

function shouldKeepNativeHomeRow(row: NativeHomeRow, settings: NativeHomePersonalizationSettings) {
    if (isNativeHomePinnedRow(row, settings)) return true;
    if (isNativeHomeRecommendationRow(row)) return true;
    if (isNativeHomeContinueRow(row)) return true;
    if (isNativeHomeLatestRow(row)) return true;
    if (isNativeHomeSeasonalRow(row, settings)) return true;

    return false;
}

function applyNativeHomeInformationArchitecture(rows: NativeHomeRow[], settings: NativeHomePersonalizationSettings) {
    const keptRows = rows.filter(row => shouldKeepNativeHomeRow(row, settings));
    const suppressedRows = rows
        .filter(row => !shouldKeepNativeHomeRow(row, settings))
        .map(row => ({
            id: row.id,
            title: row.title
        }));

    return {
        rows: keptRows.length ? keptRows : rows,
        suppressedRows
    };
}

export function getEmptyNativeHomeAdaptiveDebug(): NativeHomeAdaptiveDebug {
    return {
        currentMood: 'general',
        homeGenerationMs: null,
        layoutMode: DEFAULT_NATIVE_HOME_PERSONALIZATION_SETTINGS.layoutMode,
        personalizationScore: 0,
        profileUpdatedAt: null,
        rankingMs: null,
        recommendationCacheAgeMs: null,
        suppressedHomeRows: [],
        suppressedHomeRowsCount: 0,
        rowScores: [],
        seasonalContext: 'none',
        settings: DEFAULT_NATIVE_HOME_PERSONALIZATION_SETTINGS,
        topGenres: [],
        topStudios: []
    };
}

export function applyNativeHomeAdaptiveLayout(
    rows: NativeHomeRow[],
    profile: NativeHomeProfile,
    options: {
        settings?: NativeHomePersonalizationSettings;
        startedAt?: number;
    } = {}
) {
    const startedAt = options.startedAt ?? performance.now();
    const settings = options.settings || loadNativeHomePersonalizationSettings();
    const rowsWithEditorial = rows.map(row => ({
        ...row,
        editorialDescription: getNativeHomeEditorialDescription(row, profile)
    }));
    const homeInformationArchitecture = applyNativeHomeInformationArchitecture(rowsWithEditorial, settings);
    const candidateRows = homeInformationArchitecture.rows;
    const ranked = rankNativeHomeRows(candidateRows, profile, settings);
    const newestGeneratedAt = Math.max(0, ...ranked.rows.map(row => typeof row.generatedAt === 'number' ? row.generatedAt : 0));
    const debug: NativeHomeAdaptiveDebug = {
        currentMood: profile.mood,
        homeGenerationMs: Number((performance.now() - startedAt).toFixed(1)),
        layoutMode: settings.layoutMode,
        personalizationScore: Math.min(100, Math.round(profile.moodConfidence * 0.56 + ranked.rows.length * 1.8)),
        profileUpdatedAt: profile.updatedAt,
        rankingMs: ranked.rankingMs,
        recommendationCacheAgeMs: newestGeneratedAt ? Math.max(0, Date.now() - newestGeneratedAt) : null,
        suppressedHomeRows: homeInformationArchitecture.suppressedRows.slice(0, 24),
        suppressedHomeRowsCount: homeInformationArchitecture.suppressedRows.length,
        rowScores: ranked.rowScores,
        seasonalContext: profile.seasonal.label,
        settings,
        topGenres: profile.topGenres.slice(0, 6),
        topStudios: profile.topStudios.slice(0, 6)
    };

    return {
        debug,
        profile,
        rows: ranked.rows
    };
}

export function decorateNativeHomeRowsForCurrentLayout(rows: NativeHomeRow[], settings = loadNativeHomePersonalizationSettings()) {
    const pinnedSet = new Set(settings.pinnedRows);

    return rows
        .map((row, index) => ({
            index,
            row: {
                ...row,
                pinned: pinnedSet.has(row.id)
            }
        }))
        .sort((left, right) => {
            const leftPinnedIndex = settings.pinnedRows.indexOf(left.row.id);
            const rightPinnedIndex = settings.pinnedRows.indexOf(right.row.id);
            const leftPinned = leftPinnedIndex >= 0;
            const rightPinned = rightPinnedIndex >= 0;

            if (leftPinned && rightPinned) return leftPinnedIndex - rightPinnedIndex;
            if (leftPinned) return -1;
            if (rightPinned) return 1;

            return left.index - right.index;
        })
        .map(entry => entry.row);
}
