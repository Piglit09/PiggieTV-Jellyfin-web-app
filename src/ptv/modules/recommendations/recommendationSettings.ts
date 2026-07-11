import {
    getPtvCurrentUserId,
    getPtvServerId
} from '../../api';
import { recordPtvEvent } from '../../core/observability';
import {
    getCurrentPtvPluginApiClient,
    normalizePtvApiError
} from '../../core/pluginApi';
import type {
    PtvRecommendationItem,
    PtvRecommendationMediaType,
    PtvRecommendationRowDiagnostics,
    PtvRecommendationSourceTiming
} from './types/recommendationTypes';

export type PtvRecommendationRowRule = {
    enabled?: boolean;
    generationMode?: string;
    groupTitle?: string;
    id?: string;
    mediaType?: string;
    name?: string;
    sourceType?: string;
    sourceValue?: string;
};

export type PtvRecommendationRowSettings = {
    enableRecommendedRows?: boolean;
    enabled?: boolean;
    generatedAt?: number | null;
    recommendationConfigHash?: string;
    rowDiagnostics?: PtvRecommendationRowDiagnosticsSnapshot[];
    rowSettings?: {
        enableRecommendedRows?: boolean;
    };
    rows?: PtvPersistedRecommendationRow[];
    rowConfigHash?: string;
    rules?: PtvRecommendationRowRule[];
    schemaVersion?: number;
    sourceCounts?: PtvRecommendationSourceCountSnapshot[];
    sourceTimings?: PtvRecommendationSourceTiming[];
    sourceTimingsJson?: string;
};

export type PtvRecommendationRowDiagnosticsSnapshot = PtvRecommendationRowDiagnostics & {
    itemCount?: number;
    rowId: string;
    title?: string;
};

export type PtvPersistedRecommendationItem = {
    Album?: string;
    AlbumArtist?: string;
    AlbumId?: string;
    AlbumPrimaryImageItemId?: string;
    AlbumPrimaryImageTag?: string;
    Artists?: string[];
    BackdropImageTags?: string[];
    CommunityRating?: number;
    DateCreated?: string;
    Genres?: string[];
    Id: string;
    ImageTags?: {
        Logo?: string;
        Primary?: string;
        Thumb?: string;
    };
    MediaType?: string;
    Name: string;
    ParentBackdropImageTags?: string[];
    ParentId?: string;
    ParentPrimaryImageItemId?: string;
    ParentPrimaryImageTag?: string;
    ParentThumbImageTag?: string;
    ParentThumbItemId?: string;
    PremiereDate?: string;
    PrimaryImageAspectRatio?: number;
    ProductionYear?: number;
    RunTimeTicks?: number;
    SeriesId?: string;
    SeriesName?: string;
    SeriesPrimaryImageTag?: string;
    Studios?: string[];
    Type: string;
};

export type PtvPersistedRecommendationRow = {
    accepted?: boolean;
    diagnostics?: PtvRecommendationRowDiagnostics;
    draft?: boolean;
    enabled: boolean;
    explanation?: string;
    generatedAt?: number | null;
    id: string;
    items: PtvPersistedRecommendationItem[];
    mediaType?: PtvRecommendationMediaType | 'mixed';
    recommendationConfigHash?: string;
    rowConfigHash?: string;
    sourceCounts?: PtvRecommendationSourceCountSnapshot[];
    sourceTimings?: PtvRecommendationSourceTiming[];
    sourceTimingsJson?: string;
    title: string;
};

export type PtvRecommendationSourceCountSnapshot = {
    count: number;
    source: string;
};

export type PtvRecommendationGenerationGate = {
    enabled: boolean;
    enabledRecommendationRuleCount: number;
    reason: string;
    rowsEndpointCount: number;
    settingSource: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export const PTV_MIN_RECOMMENDATION_ROW_ITEMS = 12;
export const PTV_RECOMMENDATION_DIVERSITY_LIMITS = {
    maxItemsPerAlbum: 2,
    maxItemsPerArtist: 1,
    maxItemsPerFranchise: 2
} as const;

function getBoolean(value: unknown) {
    return typeof value === 'boolean' ? value : null;
}

function toOptionalString(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function toOptionalNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getRecordString(value: Record<string, unknown>, ...keys: string[]) {
    for (const key of keys) {
        const text = toOptionalString(value[key]);

        if (text) return text;
    }

    return '';
}

function getRecordNumber(value: Record<string, unknown>, ...keys: string[]) {
    for (const key of keys) {
        const numberValue = toOptionalNumber(value[key]);

        if (numberValue !== undefined) return numberValue;
    }

    return undefined;
}

function getRecordNumberFromSources(
    primary: Record<string, unknown> | null,
    fallback: Record<string, unknown> | null,
    ...keys: string[]
) {
    return (primary ? getRecordNumber(primary, ...keys) : undefined)
        ?? (fallback ? getRecordNumber(fallback, ...keys) : undefined);
}

function getRecommendationDiagnosticKey(value: string | undefined) {
    return (value || '').trim().toLowerCase();
}

function getRecordStringArray(value: Record<string, unknown>, key: string, maxItems = 12) {
    const source = value[key];

    if (!Array.isArray(source)) return undefined;

    const values = source
        .map(entry => {
            if (typeof entry === 'string') return entry.trim();
            if (isRecord(entry)) return getRecordString(entry, 'Name', 'name');

            return '';
        })
        .filter(Boolean)
        .slice(0, maxItems);

    return values.length ? Array.from(new Set(values)) : undefined;
}

function getRecordImageTags(value: Record<string, unknown>) {
    const imageTags = isRecord(value.ImageTags) ? value.ImageTags : null;
    const tags = {
        Logo: imageTags ? getRecordString(imageTags, 'Logo', 'logo') : '',
        Primary: imageTags ? getRecordString(imageTags, 'Primary', 'primary') : '',
        Thumb: imageTags ? getRecordString(imageTags, 'Thumb', 'thumb') : ''
    };

    return tags.Logo || tags.Primary || tags.Thumb ? {
        ...(tags.Logo ? { Logo: tags.Logo } : {}),
        ...(tags.Primary ? { Primary: tags.Primary } : {}),
        ...(tags.Thumb ? { Thumb: tags.Thumb } : {})
    } : undefined;
}

function getFallbackItemType(mediaType?: string) {
    switch ((mediaType || '').toLowerCase()) {
        case 'anime':
        case 'show':
            return 'Series';
        case 'audiobook':
        case 'book':
        case 'comic':
        case 'manga':
            return 'Book';
        case 'movie':
            return 'Movie';
        case 'music':
            return 'Audio';
        default:
            return 'Item';
    }
}

function withoutEmptyValues<T extends Record<string, unknown>>(value: T) {
    return Object.entries(value).reduce<Record<string, unknown>>((result, [key, entry]) => {
        if (entry === undefined || entry === null) return result;
        if (typeof entry === 'string' && !entry.trim()) return result;
        if (Array.isArray(entry) && !entry.length) return result;
        if (isRecord(entry) && !Object.keys(entry).length) return result;

        result[key] = entry;

        return result;
    }, {}) as T;
}

export function toPtvPersistedRecommendationItem(
    item: PtvRecommendationItem,
    mediaType?: PtvRecommendationMediaType | 'mixed'
): PtvPersistedRecommendationItem | null {
    if (!isRecord(item)) return null;

    const id = getRecordString(item, 'Id', 'id');

    if (!id) return null;

    const resolvedMediaType = getRecordString(item, 'MediaType', 'mediaType') || mediaType || undefined;
    const name = getRecordString(item, 'Name', 'name', 'SeriesName', 'seriesName', 'Album', 'album', 'MusicBrainzTitle') || id;
    const type = getRecordString(item, 'Type', 'type') || getFallbackItemType(resolvedMediaType);
    const artists = getRecordStringArray(item, 'Artists') || getRecordStringArray(item, 'AlbumArtists') || getRecordStringArray(item, 'ArtistItems');

    return withoutEmptyValues({
        Album: getRecordString(item, 'Album', 'album'),
        AlbumArtist: getRecordString(item, 'AlbumArtist', 'AlbumArtistName', 'albumArtist'),
        AlbumId: getRecordString(item, 'AlbumId', 'albumId'),
        AlbumPrimaryImageItemId: getRecordString(item, 'AlbumPrimaryImageItemId', 'albumPrimaryImageItemId'),
        AlbumPrimaryImageTag: getRecordString(item, 'AlbumPrimaryImageTag', 'albumPrimaryImageTag'),
        Artists: artists,
        BackdropImageTags: getRecordStringArray(item, 'BackdropImageTags', 8),
        CommunityRating: getRecordNumber(item, 'CommunityRating', 'communityRating'),
        DateCreated: getRecordString(item, 'DateCreated', 'dateCreated'),
        Genres: getRecordStringArray(item, 'Genres'),
        Id: id,
        ImageTags: getRecordImageTags(item),
        MediaType: resolvedMediaType,
        Name: name,
        ParentBackdropImageTags: getRecordStringArray(item, 'ParentBackdropImageTags', 8),
        ParentId: getRecordString(item, 'ParentId', 'parentId'),
        ParentPrimaryImageItemId: getRecordString(item, 'ParentPrimaryImageItemId', 'ParentBackdropItemId', 'parentPrimaryImageItemId'),
        ParentPrimaryImageTag: getRecordString(item, 'ParentPrimaryImageTag', 'parentPrimaryImageTag'),
        ParentThumbImageTag: getRecordString(item, 'ParentThumbImageTag', 'parentThumbImageTag'),
        ParentThumbItemId: getRecordString(item, 'ParentThumbItemId', 'parentThumbItemId'),
        PremiereDate: getRecordString(item, 'PremiereDate', 'premiereDate'),
        PrimaryImageAspectRatio: getRecordNumber(item, 'PrimaryImageAspectRatio', 'primaryImageAspectRatio'),
        ProductionYear: getRecordNumber(item, 'ProductionYear', 'productionYear'),
        RunTimeTicks: getRecordNumber(item, 'RunTimeTicks', 'runTimeTicks'),
        SeriesId: getRecordString(item, 'SeriesId', 'seriesId'),
        SeriesName: getRecordString(item, 'SeriesName', 'seriesName'),
        SeriesPrimaryImageTag: getRecordString(item, 'SeriesPrimaryImageTag', 'seriesPrimaryImageTag'),
        Studios: getRecordStringArray(item, 'Studios'),
        Type: type
    });
}

function normalizeRecommendationRule(value: unknown): PtvRecommendationRowRule | null {
    if (!isRecord(value)) return null;

    return {
        enabled: getBoolean(value.enabled) ?? undefined,
        generationMode: toOptionalString(value.generationMode) || undefined,
        groupTitle: toOptionalString(value.groupTitle) || undefined,
        id: toOptionalString(value.id) || undefined,
        mediaType: toOptionalString(value.mediaType) || undefined,
        name: toOptionalString(value.name) || undefined,
        sourceType: toOptionalString(value.sourceType) || undefined,
        sourceValue: toOptionalString(value.sourceValue) || undefined
    };
}

function normalizeSourceCounts(value: unknown): PtvRecommendationSourceCountSnapshot[] | undefined {
    if (Array.isArray(value)) {
        const counts = value
            .filter(isRecord)
            .map(entry => ({
                count: typeof entry.count === 'number' && Number.isFinite(entry.count) ? Math.max(0, Math.floor(entry.count)) : 0,
                source: toOptionalString(entry.source)
            }))
            .filter(entry => entry.source);

        return counts.length ? counts : undefined;
    }

    if (!isRecord(value)) return undefined;

    const counts = Object.keys(value).reduce<PtvRecommendationSourceCountSnapshot[]>((result, key) => {
        const count = value[key];

        if (typeof count === 'number' && Number.isFinite(count)) {
            result.push({
                count: Math.max(0, Math.floor(count)),
                source: key
            });
        }

        return result;
    }, []);

    return counts.length ? counts : undefined;
}

function normalizeSourceTimings(value: unknown, sourceTimingsJson?: unknown): PtvRecommendationSourceTiming[] | undefined {
    if (Array.isArray(value)) return value.filter(isRecord) as PtvRecommendationSourceTiming[];
    if (typeof sourceTimingsJson !== 'string' || !sourceTimingsJson.trim()) return undefined;

    try {
        const parsed = JSON.parse(sourceTimingsJson);

        return Array.isArray(parsed) ? parsed.filter(isRecord) as PtvRecommendationSourceTiming[] : undefined;
    } catch {
        return undefined;
    }
}

function normalizeRecommendationItems(value: unknown): PtvPersistedRecommendationItem[] {
    if (!Array.isArray(value)) return [];

    return value
        .filter(isRecord)
        .map(item => toPtvPersistedRecommendationItem(item as PtvRecommendationItem))
        .filter(Boolean) as PtvPersistedRecommendationItem[];
}

function normalizeIdentity(value: unknown) {
    return typeof value === 'string' ?
        value.trim().toLowerCase().replace(/\s+/g, ' ') :
        '';
}

function getItemType(item: PtvPersistedRecommendationItem) {
    return normalizeIdentity(item.Type || item.MediaType || '');
}

function getItemTitleKey(item: PtvPersistedRecommendationItem) {
    return normalizeIdentity(`${item.Type || item.MediaType || 'item'}:${item.Name || ''}:${item.ProductionYear || ''}`);
}

function getSeriesDedupeKey(item: PtvPersistedRecommendationItem) {
    const type = getItemType(item);
    const seriesId = normalizeIdentity(item.SeriesId);
    const seriesName = normalizeIdentity(item.SeriesName);

    if (!seriesId && !seriesName) return '';
    if (type === 'episode' || type === 'season') return `series:${seriesId || seriesName}`;
    if (seriesId && seriesId !== normalizeIdentity(item.Id)) return `series:${seriesId}`;

    return '';
}

function getAlbumDedupeKey(item: PtvPersistedRecommendationItem) {
    const type = getItemType(item);
    const albumId = normalizeIdentity(item.AlbumId);
    const album = normalizeIdentity(item.Album);

    if (type !== 'audio' && type !== 'music') return '';
    if (!albumId && !album) return '';

    return `album:${albumId || album}`;
}

function getArtistKeys(item: PtvPersistedRecommendationItem) {
    const artists = [
        ...(item.Artists || []),
        item.AlbumArtist
    ]
        .map(normalizeIdentity)
        .filter(Boolean);

    return Array.from(new Set(artists));
}

export function dedupePtvPersistedRecommendationItems(items: PtvPersistedRecommendationItem[]) {
    const seenKeys = new Set<string>();
    const albumCounts = new Map<string, number>();
    const artistCounts = new Map<string, number>();
    const seriesCounts = new Map<string, number>();
    const deduped: PtvPersistedRecommendationItem[] = [];

    items.forEach(item => {
        const itemKey = normalizeIdentity(item.Id) || getItemTitleKey(item);
        const seriesKey = getSeriesDedupeKey(item);
        const albumKey = getAlbumDedupeKey(item);
        const exactKeys = [itemKey ? `item:${itemKey}` : ''].filter(Boolean);

        if (exactKeys.some(key => seenKeys.has(key))) return;
        if (seriesKey && (seriesCounts.get(seriesKey) || 0) >= PTV_RECOMMENDATION_DIVERSITY_LIMITS.maxItemsPerFranchise) return;
        if (albumKey && (albumCounts.get(albumKey) || 0) >= PTV_RECOMMENDATION_DIVERSITY_LIMITS.maxItemsPerAlbum) return;

        const artistKeys = getArtistKeys(item);

        if (artistKeys.some(key => (artistCounts.get(key) || 0) >= PTV_RECOMMENDATION_DIVERSITY_LIMITS.maxItemsPerArtist)) {
            return;
        }

        exactKeys.forEach(key => {
            seenKeys.add(key);
        });
        if (seriesKey) seriesCounts.set(seriesKey, (seriesCounts.get(seriesKey) || 0) + 1);
        if (albumKey) albumCounts.set(albumKey, (albumCounts.get(albumKey) || 0) + 1);
        artistKeys.forEach(key => {
            artistCounts.set(key, (artistCounts.get(key) || 0) + 1);
        });
        deduped.push(item);
    });

    return deduped;
}

export function getValidatedPtvPersistedRecommendationRow(row: PtvPersistedRecommendationRow) {
    const items = dedupePtvPersistedRecommendationItems(row.items || []);

    if (items.length < PTV_MIN_RECOMMENDATION_ROW_ITEMS) return null;

    return {
        ...row,
        items
    };
}

function normalizeRecommendationRowDiagnostics(
    value: unknown,
    itemCount: number,
    fallback?: PtvRecommendationRowDiagnosticsSnapshot
): PtvRecommendationRowDiagnostics | undefined {
    const primary = isRecord(value) ? value : null;
    const fallbackRecord = fallback ? fallback as unknown as Record<string, unknown> : null;

    if (!primary && !fallbackRecord) return undefined;

    const candidateCount = getRecordNumberFromSources(primary, fallbackRecord, 'candidateCount') ?? itemCount;
    const dedupeRemovals = getRecordNumberFromSources(primary, fallbackRecord, 'dedupeRemovals') ?? 0;
    const hydrationRemovals = getRecordNumberFromSources(primary, fallbackRecord, 'hydrationRemovals') ?? 0;
    const finalRenderedCount = getRecordNumberFromSources(primary, fallbackRecord, 'finalRenderedCount') ?? itemCount;

    return {
        candidateCount,
        dedupeRemovals: Math.max(0, dedupeRemovals),
        discoveryFallbackCount: getRecordNumberFromSources(primary, fallbackRecord, 'discoveryFallbackCount') ?? 0,
        finalRenderedCount,
        hydrationRemovals: Math.max(0, hydrationRemovals),
        primaryCandidateCount: getRecordNumberFromSources(primary, fallbackRecord, 'primaryCandidateCount') ?? candidateCount,
        secondaryFallbackCount: getRecordNumberFromSources(primary, fallbackRecord, 'secondaryFallbackCount') ?? 0
    };
}

function normalizeRecommendationRowDiagnosticsSnapshot(value: unknown): PtvRecommendationRowDiagnosticsSnapshot | null {
    if (!isRecord(value)) return null;

    const rowId = toOptionalString(value.rowId) || toOptionalString(value.id);
    const itemCount = getRecordNumber(value, 'itemCount', 'finalRenderedCount') ?? 0;
    const diagnostics = normalizeRecommendationRowDiagnostics(value, itemCount);

    if (!rowId || !diagnostics) return null;

    return {
        ...diagnostics,
        itemCount,
        rowId,
        title: toOptionalString(value.title) || undefined
    };
}

function normalizePersistedRecommendationRow(
    value: unknown,
    fallbackDiagnostics?: PtvRecommendationRowDiagnosticsSnapshot
): PtvPersistedRecommendationRow | null {
    if (!isRecord(value)) return null;

    const id = toOptionalString(value.id);
    const title = toOptionalString(value.title) || id;
    const items = normalizeRecommendationItems(value.items);
    const accepted = getBoolean(value.accepted) ?? false;
    const draft = getBoolean(value.draft) ?? !accepted;
    const enabled = getBoolean(value.enabled) ?? accepted;

    if (!id || !title || !items.length) return null;

    return {
        accepted,
        diagnostics: normalizeRecommendationRowDiagnostics(value.diagnostics, items.length, fallbackDiagnostics),
        draft,
        enabled,
        explanation: toOptionalString(value.explanation) || undefined,
        generatedAt: typeof value.generatedAt === 'number' ? value.generatedAt : null,
        id,
        items,
        mediaType: toOptionalString(value.mediaType) as PtvPersistedRecommendationRow['mediaType'] || 'mixed',
        recommendationConfigHash: toOptionalString(value.recommendationConfigHash) || undefined,
        rowConfigHash: toOptionalString(value.rowConfigHash) || undefined,
        sourceCounts: normalizeSourceCounts(value.sourceCounts),
        sourceTimings: normalizeSourceTimings(value.sourceTimings, value.sourceTimingsJson),
        sourceTimingsJson: toOptionalString(value.sourceTimingsJson) || undefined,
        title
    };
}

export function normalizePtvRecommendationRowSettings(value: unknown): PtvRecommendationRowSettings | null {
    if (!isRecord(value)) return null;

    if (isRecord(value.recommendations)) {
        const nestedSettings = normalizePtvRecommendationRowSettings(value.recommendations);

        if (nestedSettings) {
            return {
                ...nestedSettings,
                enableRecommendedRows: nestedSettings.enableRecommendedRows ?? getBoolean(value.enableRecommendedRows) ?? undefined,
                rowSettings: nestedSettings.rowSettings || (isRecord(value.rowSettings) ? {
                    enableRecommendedRows: getBoolean(value.rowSettings.enableRecommendedRows) ?? undefined
                } : undefined)
            };
        }
    }

    const rowSettings = isRecord(value.rowSettings) ? value.rowSettings : null;
    const rules = Array.isArray(value.rules) ?
        value.rules.map(normalizeRecommendationRule).filter(Boolean) as PtvRecommendationRowRule[] :
        undefined;
    const rowDiagnostics = Array.isArray(value.rowDiagnostics) ?
        value.rowDiagnostics
            .map(normalizeRecommendationRowDiagnosticsSnapshot)
            .filter(Boolean) as PtvRecommendationRowDiagnosticsSnapshot[] :
        undefined;
    const diagnosticsByRowId = new Map(
        (rowDiagnostics || [])
            .map(diagnostic => [getRecommendationDiagnosticKey(diagnostic.rowId), diagnostic] as const)
            .filter(([rowId]) => Boolean(rowId))
    );
    const rows = Array.isArray(value.rows) ?
        value.rows
            .map(row => normalizePersistedRecommendationRow(
                row,
                isRecord(row) ? diagnosticsByRowId.get(getRecommendationDiagnosticKey(toOptionalString(row.id))) : undefined
            ))
            .filter(Boolean) as PtvPersistedRecommendationRow[] :
        undefined;

    return {
        enableRecommendedRows: getBoolean(value.enableRecommendedRows) ?? undefined,
        enabled: getBoolean(value.enabled) ?? undefined,
        generatedAt: typeof value.generatedAt === 'number' ? value.generatedAt : null,
        recommendationConfigHash: toOptionalString(value.recommendationConfigHash) || undefined,
        rowDiagnostics,
        rowSettings: rowSettings ? {
            enableRecommendedRows: getBoolean(rowSettings.enableRecommendedRows) ?? undefined
        } : undefined,
        rows,
        rowConfigHash: toOptionalString(value.rowConfigHash) || undefined,
        rules,
        schemaVersion: typeof value.schemaVersion === 'number' ? value.schemaVersion : undefined,
        sourceCounts: normalizeSourceCounts(value.sourceCounts),
        sourceTimings: normalizeSourceTimings(value.sourceTimings, value.sourceTimingsJson),
        sourceTimingsJson: toOptionalString(value.sourceTimingsJson) || undefined
    };
}

function stableStringifyForHash(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringifyForHash).join(',')}]`;
    }

    if (isRecord(value)) {
        return `{${Object.keys(value)
            .sort((left, right) => left.localeCompare(right))
            .map(key => `${JSON.stringify(key)}:${stableStringifyForHash(value[key])}`)
            .join(',')}}`;
    }

    return JSON.stringify(value) ?? 'null';
}

export function getPtvRecommendationSettingsHash(settings: PtvRecommendationRowSettings | null | undefined) {
    const hashableSettings = {
        enabled: settings?.enabled !== false,
        generatedAt: settings?.generatedAt ?? null,
        rowConfigHash: settings?.rowConfigHash || '',
        rowDiagnostics: settings?.rowDiagnostics || [],
        rows: (settings?.rows || []).map(row => ({
            enabled: row.enabled === true,
            accepted: row.accepted === true,
            draft: row.draft === true,
            diagnostics: row.diagnostics || null,
            explanation: row.explanation || '',
            generatedAt: row.generatedAt ?? null,
            id: row.id,
            items: row.items.map(item => ({
                Id: item.Id,
                Name: item.Name,
                Type: item.Type
            })),
            mediaType: row.mediaType || 'mixed',
            rowConfigHash: row.rowConfigHash || '',
            title: row.title
        })),
        schemaVersion: settings?.schemaVersion || 1,
        sourceCounts: settings?.sourceCounts || []
    };
    let hash = 5381;
    const text = stableStringifyForHash(hashableSettings);

    for (let index = 0; index < text.length; index += 1) {
        hash = ((hash * 33) + text.charCodeAt(index)) % 2147483647;
    }

    return String(hash);
}

export function getEnabledPtvPersistedRecommendationRows(settings: PtvRecommendationRowSettings | null | undefined) {
    if (!settings || settings.enabled === false || !Array.isArray(settings.rows)) return [];

    const directToggle = getBoolean(settings.enableRecommendedRows);
    const nestedToggle = getBoolean(settings.rowSettings?.enableRecommendedRows);

    if (nestedToggle === false || directToggle === false) return [];

    return settings.rows
        .filter(row => row.enabled === true && row.accepted === true && row.draft !== true)
        .map(getValidatedPtvPersistedRecommendationRow)
        .filter((row): row is PtvPersistedRecommendationRow => Boolean(row));
}

function getEnabledRecommendationRules(settings: PtvRecommendationRowSettings | null) {
    if (!settings || settings.enabled === false || !Array.isArray(settings.rules)) return [];

    return settings.rules.filter(rule => rule?.enabled !== false && isPtvRecommendationRule(rule));
}

export function isPtvRecommendationRule(rule: PtvRecommendationRowRule | null | undefined) {
    if (!rule) return false;

    const sourceType = (rule.sourceType || '').trim().toLowerCase();

    if (sourceType === 'recommendation' || sourceType === 'ptv-recommendation') {
        return true;
    }

    return [
        rule.id,
        rule.name,
        rule.groupTitle,
        rule.sourceValue,
        rule.generationMode
    ].some(value => (value || '').toLowerCase().includes('recommendation'));
}

export function getPtvRecommendationGenerationGate(
    settings: PtvRecommendationRowSettings | null,
    settingSource = 'unknown'
): PtvRecommendationGenerationGate {
    const rowsEndpointCount = Array.isArray(settings?.rules) ? settings.rules.length : 0;
    const enabledRecommendationRuleCount = getEnabledRecommendationRules(settings).length;
    const directToggle = getBoolean(settings?.enableRecommendedRows);
    const nestedToggle = getBoolean(settings?.rowSettings?.enableRecommendedRows);

    if (!settings) {
        return {
            enabled: false,
            enabledRecommendationRuleCount,
            reason: 'settings-unavailable',
            rowsEndpointCount,
            settingSource
        };
    }

    if (settings.enabled === false) {
        return {
            enabled: false,
            enabledRecommendationRuleCount,
            reason: 'row-builder-disabled',
            rowsEndpointCount,
            settingSource
        };
    }

    if (nestedToggle !== null) {
        return {
            enabled: nestedToggle,
            enabledRecommendationRuleCount,
            reason: nestedToggle ? 'row-settings-toggle-enabled' : 'row-settings-toggle-disabled',
            rowsEndpointCount,
            settingSource
        };
    }

    if (directToggle !== null) {
        return {
            enabled: directToggle,
            enabledRecommendationRuleCount,
            reason: directToggle ? 'recommended-rows-toggle-enabled' : 'recommended-rows-toggle-disabled',
            rowsEndpointCount,
            settingSource
        };
    }

    return {
        enabled: enabledRecommendationRuleCount > 0,
        enabledRecommendationRuleCount,
        reason: enabledRecommendationRuleCount > 0 ? 'recommendation-rule-enabled' : 'no-enabled-recommendation-rule',
        rowsEndpointCount,
        settingSource
    };
}

export function recordPtvRecommendationGateEvent(
    eventName: string,
    gate: PtvRecommendationGenerationGate,
    detail: Record<string, unknown> = {}
) {
    recordPtvEvent('recommendation', eventName, {
        ...detail,
        enabledRecommendationRuleCount: gate.enabledRecommendationRuleCount,
        reason: gate.reason,
        rowsEndpointCount: gate.rowsEndpointCount,
        serverId: getPtvServerId() || null,
        settingSource: gate.settingSource,
        userId: getPtvCurrentUserId() || null
    });
}

export async function fetchPtvRecommendationRowSettings(): Promise<PtvRecommendationRowSettings | null> {
    const pluginApi = getCurrentPtvPluginApiClient();

    if (!pluginApi?.getSettings && !pluginApi?.getRows) return null;

    if (pluginApi.getSettings) {
        try {
            const settings = normalizePtvRecommendationRowSettings(await pluginApi.getSettings());

            if (settings?.rowSettings || settings?.enableRecommendedRows !== undefined) {
                return settings;
            }
        } catch (error) {
            const normalizedError = normalizePtvApiError(error);

            recordPtvEvent('recommendation', 'recommendation-settings-fetch-error', {
                error: normalizedError.message,
                kind: normalizedError.kind,
                source: 'settings',
                status: normalizedError.status ?? null
            });
        }
    }

    if (!pluginApi.getRows) return null;

    try {
        return normalizePtvRecommendationRowSettings(await pluginApi.getRows());
    } catch (error) {
        const normalizedError = normalizePtvApiError(error);

        recordPtvEvent('recommendation', 'recommendation-settings-fetch-error', {
            error: normalizedError.message,
            kind: normalizedError.kind,
            source: 'rows',
            status: normalizedError.status ?? null
        });

        return null;
    }
}
