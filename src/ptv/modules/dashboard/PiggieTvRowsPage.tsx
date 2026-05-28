/* eslint-disable @stylistic/operator-linebreak, max-params, no-nested-ternary, react/jsx-no-bind, react/no-array-index-key, sonarjs/anchor-precedence, sonarjs/no-nested-conditional */
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid2';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Page from 'components/Page';

import { clearPtvDebugReport, getPtvDebugReport, isPtvDebugEnabled, setPtvDebug } from '../../core/observability';
import {
    getCurrentPtvPluginApiClient,
    getPtvPluginApiDiagnostics,
    normalizePtvApiError,
    type PtvPluginApiDiagnostics
} from '../../core/pluginApi';
import {
    FEATURED_CACHE_UPDATED_EVENT,
    getFeaturedContentCacheStatus
} from '../cache/featuredContentCache';

import './dashboard.scss';

type RowMediaType = 'anime' | 'books' | 'cartoons' | 'liveTv' | 'mixed' | 'movies' | 'music' | 'shows';
type RowSourceType = 'collection' | 'continueWatching' | 'genre' | 'latest' | 'library' | 'requested' | 'seasonal' | 'studio';
type RowGenerationMode = 'highestRated' | 'latest' | 'popular' | 'random';
type RowPresentation = 'auto' | 'compact' | 'featured' | 'library-hub' | 'mini' | 'standard';
type HealthLabel = 'Good' | 'Heavy' | 'Moderate' | 'Risky';

type PtvRowSeasonalSettings = {
    endDay?: number | null;
    endMonth?: number | null;
    mode: string;
    startDay?: number | null;
    startMonth?: number | null;
};

type PtvRowBuilderRule = {
    enabled: boolean;
    generationMode: RowGenerationMode;
    groupTitle: string;
    id: string;
    includeSubgenres: boolean;
    itemLimit: number;
    mediaType: RowMediaType;
    name: string;
    providerHints: string[];
    presentation: RowPresentation;
    rowCount: number;
    seasonal: PtvRowSeasonalSettings | null;
    sortPriority: number;
    sourceType: RowSourceType;
    sourceValue: string;
    subgenreRowCount: number;
    tier: number;
};

type LegacyCategory = {
    enabled?: boolean;
    entries?: string[];
    generationMode?: string;
    id?: string;
    mediaType?: RowMediaType;
    rowCount?: number;
    sourcePoolFilters?: string[];
    sourceType?: string;
};

type PtvRowBuilderSettings = {
    categories?: LegacyCategory[];
    defaultsInitialized: boolean;
    enabled: boolean;
    rules: PtvRowBuilderRule[];
    schemaVersion: number;
};

type PtvRowPreviewItem = {
    empty?: boolean;
    generationMode?: string;
    id: string;
    itemCount: number;
    mediaType?: string;
    providerUsed?: string;
    ruleId?: string;
    ruleName?: string;
    source?: string;
    sourceType?: string;
    title: string;
    warnings?: string[];
    weak?: boolean;
};

type PtvRowGenerationDiagnostic = {
    emptyResultReason?: string | null;
    filteredDuplicateCount?: number;
    generationMode?: string;
    generationTimeMs?: number;
    itemCount?: number;
    mediaType?: string;
    providerError?: string | null;
    providerUsed?: string;
    ruleId?: string;
    ruleName?: string;
    searchTerm?: string;
    sourceType?: string;
    sourceValue?: string;
};

type PtvRowPreviewResponse = {
    diagnostics?: PtvRowGenerationDiagnostic[];
    ok?: boolean;
    providerStatus?: Record<string, unknown>;
    rows?: PtvRowPreviewItem[];
    settings?: PtvRowBuilderSettings;
    validation?: {
        errors?: string[];
        ok?: boolean;
        warnings?: string[];
    };
};

type PtvStatusMessage = {
    severity: 'error' | 'info' | 'success' | 'warning';
    text: string;
};

type PerformanceEstimate = {
    estimatedCacheCost: string;
    estimatedFrontendCost: string;
    expectedItemCount: number;
    expectedRowCount: number;
    health: HealthLabel;
    providerCalls: number;
    reasons: string[];
};

const CUSTOM_GENRE = '__custom__';

const MEDIA_TYPES: Array<{ label: string; value: RowMediaType }> = [
    { label: 'Movies', value: 'movies' },
    { label: 'Shows', value: 'shows' },
    { label: 'Cartoons', value: 'cartoons' },
    { label: 'Anime', value: 'anime' },
    { label: 'Music', value: 'music' },
    { label: 'Books', value: 'books' },
    { label: 'Live TV', value: 'liveTv' },
    { label: 'Mixed', value: 'mixed' }
];

const SOURCE_TYPES: Array<{ label: string; value: RowSourceType }> = [
    { label: 'Genre', value: 'genre' },
    { label: 'Studio', value: 'studio' },
    { label: 'Library', value: 'library' },
    { label: 'Collection', value: 'collection' },
    { label: 'Requested', value: 'requested' },
    { label: 'Continue Watching', value: 'continueWatching' },
    { label: 'Latest', value: 'latest' },
    { label: 'Seasonal / Holiday', value: 'seasonal' }
];

const GENERATION_MODES: Array<{ label: string; value: RowGenerationMode }> = [
    { label: 'Random', value: 'random' },
    { label: 'Latest', value: 'latest' },
    { label: 'Popular', value: 'popular' },
    { label: 'Highest Rated', value: 'highestRated' }
];

const ROW_TIERS = [
    { label: 'Auto', value: 0 },
    { label: 'Tier 1', value: 1 },
    { label: 'Tier 2', value: 2 },
    { label: 'Tier 3', value: 3 }
];

const ROW_PRESENTATIONS: Array<{ label: string; value: RowPresentation }> = [
    { label: 'Auto', value: 'auto' },
    { label: 'Featured', value: 'featured' },
    { label: 'Standard', value: 'standard' },
    { label: 'Compact', value: 'compact' },
    { label: 'Mini', value: 'mini' },
    { label: 'Library Hub', value: 'library-hub' }
];

const SEASONAL_MODES = [
    { label: 'Auto Seasonal', value: 'auto' },
    { label: 'Halloween', value: 'halloween' },
    { label: 'Christmas', value: 'christmas' },
    { label: 'Thanksgiving', value: 'thanksgiving' },
    { label: "Valentine's Day", value: 'valentines' },
    { label: 'Summer', value: 'summer' },
    { label: 'Winter', value: 'winter' },
    { label: 'New Year', value: 'newYear' },
    { label: 'Custom Date Range', value: 'custom' }
];

const COMMON_GENRES = [
    'Action',
    'Adventure',
    'Animation',
    'Comedy',
    'Crime',
    'Documentary',
    'Drama',
    'Family',
    'Fantasy',
    'Horror',
    'Mystery',
    'Romance',
    'Science Fiction',
    'Thriller',
    'War',
    'Western'
];

const GENRES_BY_MEDIA: Record<string, string[]> = {
    anime: ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Isekai', 'Mecha', 'Romance', 'Shonen', 'Shojo', 'Slice of Life', 'Supernatural'],
    books: ['Fantasy', 'Science Fiction', 'Horror', 'Mystery', 'Thriller', 'Manga', 'Comics'],
    cartoons: COMMON_GENRES,
    liveTv: COMMON_GENRES,
    movies: COMMON_GENRES,
    music: ['Rock', 'Metal', 'Hip-Hop', 'Pop', 'Country', 'Jazz', 'Electronic', 'Soundtrack'],
    shows: COMMON_GENRES
};

const STUDIO_OPTIONS = [
    'Disney',
    'Pixar',
    'Marvel Studios',
    'Lucasfilm',
    'Warner Bros.',
    'Universal Pictures',
    'Paramount',
    'HBO',
    'Netflix',
    'Studio Ghibli',
    'Toei Animation',
    'MAPPA',
    'Bones',
    'Madhouse'
];

const DEFAULT_SETTINGS: PtvRowBuilderSettings = {
    enabled: true,
    schemaVersion: 2,
    defaultsInitialized: true,
    rules: [
        makeRule('continue-watching', 'Continue Watching', 'mixed', 'continueWatching', 'continue', 'latest', 16, 1, 0),
        makeRule('latest-movies', 'Latest Movies', 'movies', 'latest', 'movies', 'latest', 16, 1, 10),
        makeRule('latest-shows', 'Latest Shows', 'shows', 'latest', 'shows', 'latest', 16, 1, 20),
        makeRule('latest-cartoons', 'Latest Cartoons', 'cartoons', 'latest', 'cartoons', 'latest', 16, 1, 30),
        makeRule('latest-anime', 'Latest Anime', 'anime', 'latest', 'anime', 'latest', 16, 1, 40),
        makeRule('latest-music', 'Latest Music', 'music', 'latest', 'music', 'latest', 16, 1, 50),
        {
            ...makeRule('requested-by-you', 'Requested By You', 'mixed', 'requested', 'jellyseerr', 'latest', 16, 1, 60),
            enabled: false
        }
    ]
};

function makeRule(
    id: string,
    name: string,
    mediaType: RowMediaType,
    sourceType: RowSourceType,
    sourceValue: string,
    generationMode: RowGenerationMode,
    itemLimit: number,
    rowCount: number,
    sortPriority: number
): PtvRowBuilderRule {
    return {
        id,
        enabled: true,
        name,
        mediaType,
        sourceType,
        sourceValue,
        generationMode,
        itemLimit,
        rowCount,
        includeSubgenres: false,
        subgenreRowCount: 0,
        seasonal: sourceType === 'seasonal' ? { mode: 'auto' } : null,
        providerHints: [],
        sortPriority,
        tier: 0,
        presentation: 'auto',
        groupTitle: ''
    };
}

function slugify(value: string) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        || `rule-${Date.now()}`;
}

function migrateLegacyCategory(category: LegacyCategory, index: number): PtvRowBuilderRule[] {
    const mediaType = category.mediaType || 'movies';
    const sourceType: RowSourceType = category.sourceType === 'studio' ? 'studio' : category.sourceType === 'genre' ? 'genre' : 'collection';

    if (category.generationMode === 'specific') {
        return (category.entries || []).map((entry, entryIndex) => makeRule(
            slugify(`${category.id || 'legacy'}-${entry}`),
            entry,
            mediaType,
            sourceType,
            entry,
            'popular',
            16,
            1,
            (index * 100) + entryIndex
        ));
    }

    const sources = category.sourcePoolFilters?.length ? category.sourcePoolFilters : [category.id || mediaType];

    return sources.map((source, sourceIndex) => makeRule(
        slugify(`${category.id || 'legacy'}-${source}`),
        source,
        mediaType,
        sourceType,
        source,
        'random',
        16,
        Math.max(1, category.rowCount || 1),
        (index * 100) + sourceIndex
    ));
}

function normalizeRuleTier(value: unknown) {
    const tier = Number(value);

    return [0, 1, 2, 3].includes(tier) ? tier : 0;
}

function normalizeRulePresentation(value: unknown): RowPresentation {
    return ROW_PRESENTATIONS.some(option => option.value === value) ? value as RowPresentation : 'auto';
}

function getDefaultSourceValue(
    rule: Partial<PtvRowBuilderRule>,
    sourceType: RowSourceType,
    mediaType: RowMediaType,
    seasonal: PtvRowSeasonalSettings | null
) {
    if (rule.sourceValue) return rule.sourceValue;
    if (sourceType === 'latest') return mediaType;
    if (sourceType === 'continueWatching') return 'continue';
    if (sourceType === 'requested') return 'jellyseerr';
    if (sourceType === 'seasonal') return seasonal?.mode || 'auto';

    return '';
}

function normalizeRule(rule: Partial<PtvRowBuilderRule>, index: number): PtvRowBuilderRule {
    const sourceType = (rule.sourceType || 'genre') as RowSourceType;
    const mediaType = (rule.mediaType || 'movies') as RowMediaType;
    const seasonal = sourceType === 'seasonal'
        ? rule.seasonal || { mode: 'auto' }
        : null;
    const sourceValue = getDefaultSourceValue(rule, sourceType, mediaType, seasonal);

    return {
        id: rule.id || slugify(rule.name || `row-${index + 1}`),
        enabled: rule.enabled !== false,
        name: rule.name || `Row ${index + 1}`,
        mediaType,
        sourceType,
        sourceValue,
        generationMode: (rule.generationMode || 'random') as RowGenerationMode,
        itemLimit: Number.isFinite(rule.itemLimit) ? Number(rule.itemLimit) : 16,
        rowCount: Number.isFinite(rule.rowCount) ? Number(rule.rowCount) : 1,
        includeSubgenres: Boolean(rule.includeSubgenres),
        subgenreRowCount: Number.isFinite(rule.subgenreRowCount) ? Number(rule.subgenreRowCount) : 0,
        seasonal,
        providerHints: [...(rule.providerHints || [])],
        sortPriority: Number.isFinite(rule.sortPriority) ? Number(rule.sortPriority) : index * 10,
        tier: normalizeRuleTier(rule.tier),
        presentation: normalizeRulePresentation(rule.presentation),
        groupTitle: rule.groupTitle || ''
    };
}

function cloneSettings(settings?: Partial<PtvRowBuilderSettings> | null): PtvRowBuilderSettings {
    if (!settings) return structuredCloneSafe(DEFAULT_SETTINGS);

    const migratedRules = settings.rules?.length
        ? settings.rules
        : (settings.categories || []).flatMap(migrateLegacyCategory);
    const rules = (migratedRules.length ? migratedRules : DEFAULT_SETTINGS.rules)
        .map(normalizeRule)
        .sort((left, right) => left.sortPriority - right.sortPriority);

    return {
        enabled: settings.enabled !== false,
        schemaVersion: 2,
        defaultsInitialized: true,
        rules
    };
}

function structuredCloneSafe<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function getGenres(mediaType: RowMediaType) {
    return GENRES_BY_MEDIA[mediaType] || COMMON_GENRES;
}

function isBuiltInGenre(rule: PtvRowBuilderRule) {
    return getGenres(rule.mediaType).some(genre => genre.toLowerCase() === rule.sourceValue.toLowerCase());
}

function estimateRuleRows(rule: PtvRowBuilderRule) {
    if (!rule.enabled) return 0;
    if (rule.sourceType === 'genre' && rule.generationMode === 'random' && rule.includeSubgenres) {
        return Math.max(1, rule.subgenreRowCount || rule.rowCount || 1);
    }

    return 1;
}

function estimatePerformance(settings: PtvRowBuilderSettings): PerformanceEstimate {
    const enabledRules = settings.enabled ? settings.rules.filter(rule => rule.enabled) : [];
    const expectedRowCount = enabledRules.reduce((total, rule) => total + estimateRuleRows(rule), 0);
    const expectedItemCount = enabledRules.reduce((total, rule) => total + (estimateRuleRows(rule) * Math.max(1, rule.itemLimit || 16)), 0);
    const providerCalls = enabledRules.filter(rule => ['anime', 'cartoons', 'movies', 'music', 'shows'].includes(rule.mediaType)).length;
    const reasons: string[] = [];

    if (expectedRowCount > 30) reasons.push('many generated rows');
    if (expectedItemCount > 500) reasons.push('large item payload');
    if (providerCalls > 20) reasons.push('provider-heavy matching');

    let health: HealthLabel = 'Good';

    if (expectedRowCount > 45 || expectedItemCount > 800) health = 'Risky';
    else if (expectedRowCount > 28 || expectedItemCount > 500) health = 'Heavy';
    else if (expectedRowCount > 16 || expectedItemCount > 260) health = 'Moderate';

    return {
        expectedRowCount,
        expectedItemCount,
        providerCalls,
        health,
        reasons,
        estimatedCacheCost: health === 'Good' ? 'low' : health === 'Moderate' ? 'medium' : 'high',
        estimatedFrontendCost: expectedRowCount > 28 ? 'high' : expectedRowCount > 16 ? 'medium' : 'low'
    };
}

function localValidation(settings: PtvRowBuilderSettings) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const ids = new Set<string>();

    settings.rules.forEach(rule => {
        if (!rule.id.trim()) {
            errors.push('Every rule needs an id.');
        } else if (ids.has(rule.id.toLowerCase())) {
            errors.push(`Duplicate rule id '${rule.id}'.`);
        }

        ids.add(rule.id.toLowerCase());

        if (!rule.name.trim()) {
            errors.push(`Rule '${rule.id}' needs a row name.`);
        }

        if (['collection', 'genre', 'library', 'studio'].includes(rule.sourceType) && !rule.sourceValue.trim()) {
            errors.push(`Rule '${rule.name}' needs a source value.`);
        }

        if (rule.sourceType === 'requested') {
            warnings.push(`Rule '${rule.name}' requires Jellyseerr/Jellyseer to be configured.`);
        }
    });

    const estimate = estimatePerformance(settings);

    if (estimate.health === 'Heavy' || estimate.health === 'Risky') {
        warnings.push(`Estimated performance is ${estimate.health}: ${estimate.reasons.join(', ') || 'large row plan'}.`);
    }

    return { errors, warnings };
}

function redactedDebugReport() {
    return {
        cacheStatus: getFeaturedContentCacheStatus(),
        debugReport: getPtvDebugReport(),
        pluginApi: getPtvPluginApiDiagnostics()
    };
}

function createRowsAbortController() {
    // eslint-disable-next-line compat/compat
    return typeof AbortController === 'function' ? new AbortController() : null;
}

function getPreviewChipColor(row: PtvRowPreviewItem): 'error' | 'success' | 'warning' {
    if (row.empty) return 'error';
    if (row.weak) return 'warning';

    return 'success';
}

function formatDiagnosticSummary(diagnostic: PtvRowGenerationDiagnostic) {
    const parts = [
        `${diagnostic.ruleId || diagnostic.ruleName}: ${diagnostic.mediaType}/${diagnostic.sourceType}/${diagnostic.generationMode}`,
        `${diagnostic.searchTerm || diagnostic.sourceValue || 'source'}: ${diagnostic.itemCount ?? 0} item(s)`,
        `${diagnostic.filteredDuplicateCount ?? 0} duplicate(s)`,
        `${diagnostic.generationTimeMs ?? 0} ms`
    ];

    if (diagnostic.providerError) parts.push(`provider: ${diagnostic.providerError}`);
    if (diagnostic.emptyResultReason) parts.push(diagnostic.emptyResultReason);

    return parts.join(', ');
}

function formatMemory(usedRatio?: number) {
    return usedRatio ? `${Math.round(usedRatio * 1000) / 10}%` : 'n/a';
}

function makeNewRule(index: number): PtvRowBuilderRule {
    return makeRule(`genre-row-${index + 1}`, 'New Genre Row', 'movies', 'genre', 'Action', 'random', 16, 1, index * 10);
}

const PiggieTvRowsPage = () => {
    const hydratedRef = useRef(false);
    const loadRequestRef = useRef<Promise<void> | null>(null);
    const previewAbortRef = useRef<AbortController | null>(null);
    const refreshRequestRef = useRef<Promise<void> | null>(null);
    const saveRequestRef = useRef<Promise<void> | null>(null);
    const importInputRef = useRef<HTMLInputElement | null>(null);
    const [debugEnabled, setDebugEnabledState] = useState(isPtvDebugEnabled());
    const [form, setForm] = useState<PtvRowBuilderSettings>(() => cloneSettings(DEFAULT_SETTINGS));
    const [saved, setSaved] = useState<PtvRowBuilderSettings>(() => cloneSettings(DEFAULT_SETTINGS));
    const [preview, setPreview] = useState<PtvRowPreviewResponse | null>(null);
    const [cacheStatus, setCacheStatus] = useState(() => getFeaturedContentCacheStatus());
    const [debugReport, setDebugReport] = useState(() => getPtvDebugReport());
    const [pluginDiagnostics, setPluginDiagnostics] = useState<PtvPluginApiDiagnostics>(() => getPtvPluginApiDiagnostics());
    const [statusMessage, setStatusMessage] = useState<PtvStatusMessage | null>(null);
    const [loading, setLoading] = useState(true);
    const [previewing, setPreviewing] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);

    const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);
    const validation = useMemo(() => localValidation(form), [form]);
    const estimate = useMemo(() => estimatePerformance(form), [form]);
    const imageTrackerResetCount = useMemo(() => (
        debugReport.events || []
    ).filter(event => event.name === 'image-tracker-reset').length, [debugReport.events]);
    const refreshState = useMemo(() => {
        if (refreshing) return 'refreshing';
        if (cacheStatus.readInProgress) return 'reading cache';

        return 'idle';
    }, [cacheStatus.readInProgress, refreshing]);

    const refreshDiagnostics = useCallback(() => {
        setCacheStatus(getFeaturedContentCacheStatus());
        setDebugReport(getPtvDebugReport());
        setPluginDiagnostics(getPtvPluginApiDiagnostics());
    }, []);

    const loadRows = useCallback(() => {
        if (loadRequestRef.current) return loadRequestRef.current;

        const request = (async () => {
            const api = getCurrentPtvPluginApiClient();

            if (!api) throw new Error('PiggieTV plugin API client is unavailable.');

            let rows: PtvRowBuilderSettings | null = null;

            try {
                rows = await api.getRows<PtvRowBuilderSettings>();
            } catch {
                const settings = await api.getSettings<{ rows?: PtvRowBuilderSettings }>();
                rows = settings.rows || null;
            }

            const normalizedRows = cloneSettings(rows || DEFAULT_SETTINGS);
            setForm(normalizedRows);
            setSaved(normalizedRows);
            setPreview(null);
            setStatusMessage({ severity: 'success', text: 'Row settings loaded.' });
        })()
            .catch(error => {
                setStatusMessage({ severity: 'error', text: normalizePtvApiError(error).message });
            })
            .finally(() => {
                hydratedRef.current = true;
                loadRequestRef.current = null;
                setLoading(false);
                refreshDiagnostics();
            });

        loadRequestRef.current = request;

        return request;
    }, [refreshDiagnostics]);

    useEffect(() => {
        if (!hydratedRef.current) {
            void loadRows();
        }

        const onCacheUpdated = () => refreshDiagnostics();
        window.addEventListener(FEATURED_CACHE_UPDATED_EVENT, onCacheUpdated);

        return () => {
            window.removeEventListener(FEATURED_CACHE_UPDATED_EVENT, onCacheUpdated);
            previewAbortRef.current?.abort();
        };
    }, [loadRows, refreshDiagnostics]);

    const updateForm = useCallback((updater: (settings: PtvRowBuilderSettings) => PtvRowBuilderSettings) => {
        setForm(current => updater(cloneSettings(current)));
    }, []);

    const updateRule = useCallback((index: number, patch: Partial<PtvRowBuilderRule>) => {
        updateForm(settings => ({
            ...settings,
            rules: settings.rules.map((rule, ruleIndex) => (
                ruleIndex === index ? normalizeRule({ ...rule, ...patch }, index) : rule
            ))
        }));
    }, [updateForm]);

    const addRule = useCallback(() => {
        updateForm(settings => ({
            ...settings,
            rules: [...settings.rules, makeNewRule(settings.rules.length)]
        }));
    }, [updateForm]);

    const removeRule = useCallback((index: number) => {
        updateForm(settings => ({
            ...settings,
            rules: settings.rules.filter((_, ruleIndex) => ruleIndex !== index)
        }));
    }, [updateForm]);

    const restoreDefaults = useCallback(() => {
        setForm(cloneSettings(DEFAULT_SETTINGS));
        setPreview(null);
        setStatusMessage({ severity: 'info', text: 'Default row rules restored locally. Save to persist.' });
    }, []);

    const previewRows = useCallback(async () => {
        if (previewing || validation.errors.length) return;

        previewAbortRef.current?.abort();
        const abortController = createRowsAbortController();
        previewAbortRef.current = abortController;
        setPreviewing(true);
        setStatusMessage({ severity: 'info', text: 'Generating row plan preview...' });

        try {
            const api = getCurrentPtvPluginApiClient();

            if (!api) throw new Error('PiggieTV plugin API client is unavailable.');

            const response = await api.previewRows<PtvRowPreviewResponse, PtvRowBuilderSettings>(
                form,
                abortController ? { signal: abortController.signal } : undefined
            );
            setPreview(response);
            setStatusMessage({
                severity: response.validation?.errors?.length ? 'warning' : 'success',
                text: `Preview generated: ${response.rows?.length || 0} row(s).`
            });
        } catch (error) {
            if (!abortController?.signal.aborted) {
                setStatusMessage({ severity: 'error', text: normalizePtvApiError(error).message });
            }
        } finally {
            if (previewAbortRef.current === abortController) previewAbortRef.current = null;
            setPreviewing(false);
            refreshDiagnostics();
        }
    }, [form, previewing, refreshDiagnostics, validation.errors.length]);

    const saveRows = useCallback(async () => {
        if (saving || saveRequestRef.current || validation.errors.length) return;
        if (estimate.health === 'Risky' && !window.confirm('This row plan is estimated as Risky. Save it anyway?')) return;

        setSaving(true);
        setStatusMessage({ severity: 'info', text: 'Saving row rules...' });

        const request = (async () => {
            const api = getCurrentPtvPluginApiClient();

            if (!api) throw new Error('PiggieTV plugin API client is unavailable.');

            const response = await api.saveRows<PtvRowBuilderSettings, PtvRowBuilderSettings>(form);
            const normalizedRows = cloneSettings(response);
            setForm(normalizedRows);
            setSaved(normalizedRows);
            setStatusMessage({ severity: 'success', text: 'Row rules saved.' });
        })();

        saveRequestRef.current = request;

        try {
            await request;
        } catch (error) {
            setStatusMessage({ severity: 'error', text: normalizePtvApiError(error).message });
        } finally {
            if (saveRequestRef.current === request) saveRequestRef.current = null;
            setSaving(false);
            refreshDiagnostics();
        }
    }, [estimate.health, form, refreshDiagnostics, saving, validation.errors.length]);

    const refreshCache = useCallback(async () => {
        if (refreshing || refreshRequestRef.current) return;

        setRefreshing(true);
        setStatusMessage({ severity: 'info', text: 'Refreshing featured cache with saved row rules...' });

        const request = (async () => {
            const api = getCurrentPtvPluginApiClient();

            if (!api) throw new Error('PiggieTV plugin API client is unavailable.');

            await api.refreshFeaturedContentCacheDocument();
            setStatusMessage({ severity: 'success', text: 'Featured cache refresh started. Refresh status to verify completion.' });
        })();

        refreshRequestRef.current = request;

        try {
            await request;
        } catch (error) {
            setStatusMessage({ severity: 'error', text: normalizePtvApiError(error).message });
        } finally {
            if (refreshRequestRef.current === request) refreshRequestRef.current = null;
            setRefreshing(false);
            refreshDiagnostics();
        }
    }, [refreshDiagnostics, refreshing]);

    const toggleDebug = useCallback(() => {
        const next = setPtvDebug(!debugEnabled);
        setDebugEnabledState(next);
        refreshDiagnostics();
    }, [debugEnabled, refreshDiagnostics]);

    const clearDebug = useCallback(() => {
        clearPtvDebugReport();
        refreshDiagnostics();
    }, [refreshDiagnostics]);

    const exportObject = useCallback((value: unknown, filename: string) => {
        const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
        // eslint-disable-next-line compat/compat
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        // eslint-disable-next-line compat/compat
        URL.revokeObjectURL(url);
    }, []);

    const exportConfig = useCallback(() => {
        exportObject(form, `piggietv-row-rules-${Date.now()}.json`);
    }, [exportObject, form]);

    const exportDebug = useCallback(() => {
        exportObject(redactedDebugReport(), `piggietv-row-debug-${Date.now()}.json`);
    }, [exportObject]);

    const importConfig = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';

        if (!file) return;

        const reader = new FileReader();

        reader.onload = () => {
            try {
                const imported = JSON.parse(String(reader.result || '{}')) as PtvRowBuilderSettings;
                setForm(cloneSettings(imported));
                setPreview(null);
                setStatusMessage({ severity: 'success', text: 'Row config imported locally. Preview and save to persist.' });
            } catch (error) {
                setStatusMessage({ severity: 'error', text: normalizePtvApiError(error).message });
            }
        };

        reader.readAsText(file);
    }, []);

    return (
        <Page
            id='ptvRowsPage'
            title='PiggieTV Rows'
            className='mainAnimatedPage type-interior ptv-dashboard-control-page'
        >
            <Box className='content-primary ptv-dashboard-control-content'>
                <Stack spacing={2}>
                    <Box>
                        <Stack direction='row' spacing={1} alignItems='center' flexWrap='wrap'>
                            <Typography variant='h1'>Row Builder</Typography>
                            <Chip className='ptv-status-badge ptv-status-badge-info' label={dirty ? 'unsaved changes' : 'saved'} size='small' />
                        </Stack>
                        <Typography variant='body1' color='text.secondary'>
                            Build every PiggieTV homepage row from one rule list, preview the plan, then refresh the featured cache when ready.
                        </Typography>
                    </Box>

                    {statusMessage && <Alert severity={statusMessage.severity}>{statusMessage.text}</Alert>}
                    {validation.errors.map(error => <Alert key={error} severity='error'>{error}</Alert>)}
                    {validation.warnings.map(warning => <Alert key={warning} severity='warning'>{warning}</Alert>)}

                    <Grid container spacing={2}>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <Card className='ptv-dashboard-card ptv-control-card'>
                                <CardContent>
                                    <Stack spacing={1}>
                                        <Typography variant='h2'>Estimated Performance</Typography>
                                        <Stack direction='row' spacing={1} flexWrap='wrap'>
                                            <Chip label={estimate.health} color={estimate.health === 'Risky' ? 'error' : estimate.health === 'Heavy' ? 'warning' : 'success'} />
                                            <Chip label={`${estimate.expectedRowCount} rows`} />
                                            <Chip label={`${estimate.expectedItemCount} items`} />
                                            <Chip label={`${estimate.providerCalls} provider checks`} />
                                        </Stack>
                                        <Typography>Cache generation: {estimate.estimatedCacheCost}</Typography>
                                        <Typography>Frontend render cost: {estimate.estimatedFrontendCost}</Typography>
                                        {!!estimate.reasons.length && <Typography color='warning.main'>{estimate.reasons.join(', ')}</Typography>}
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <Card className='ptv-dashboard-card ptv-control-card'>
                                <CardContent>
                                    <Stack spacing={1}>
                                        <Typography variant='h2'>Real World Monitor</Typography>
                                        <Stack direction='row' spacing={1} flexWrap='wrap'>
                                            <Chip label={`refresh ${cacheStatus.lastRefreshDurationMs ?? 'n/a'} ms`} />
                                            <Chip label={`render p95 ${debugReport.render?.p95Ms ?? 'n/a'} ms`} />
                                            <Chip label={`images ${debugReport.images?.timings?.count ?? 0}`} />
                                            <Chip label={`memory ${formatMemory(debugReport.memory?.usedRatio)}`} />
                                        </Stack>
                                        <Typography>API requests: {pluginDiagnostics.attemptedUrls.length}</Typography>
                                        <Typography>Cache hits/misses: {debugReport.cache?.hits ?? 0}/{debugReport.cache?.misses ?? 0}</Typography>
                                        <Typography>Provider errors: {Object.values(preview?.providerStatus || {}).filter(value => JSON.stringify(value).includes('error')).length}</Typography>
                                        <Typography>Image tracker resets: {imageTrackerResetCount}</Typography>
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>
                    </Grid>

                    <Card className='ptv-dashboard-card ptv-control-card'>
                        <CardContent>
                            <Stack spacing={1.5}>
                                <Stack direction='row' spacing={1.5} alignItems='center' flexWrap='wrap'>
                                    <FormControlLabel
                                        control={<Switch checked={form.enabled} onChange={event => updateForm(settings => ({ ...settings, enabled: event.target.checked }))} />}
                                        label='Enable Row Builder'
                                    />
                                    <Button className='ptv-button' variant='contained' onClick={addRule}>Add Rule</Button>
                                    <Button className='ptv-button' variant='outlined' disabled={previewing || Boolean(validation.errors.length)} onClick={previewRows}>
                                        {previewing ? 'Previewing...' : 'Preview'}
                                    </Button>
                                    <Button className='ptv-button' variant='contained' disabled={saving || !dirty || Boolean(validation.errors.length)} onClick={saveRows}>
                                        {saving ? 'Saving...' : 'Save'}
                                    </Button>
                                    <Button className='ptv-button' variant='outlined' disabled={refreshing || dirty} onClick={refreshCache}>
                                        {refreshing ? 'Refreshing...' : 'Refresh Featured Cache'}
                                    </Button>
                                    <Button variant='outlined' onClick={restoreDefaults}>Restore Defaults</Button>
                                    <Button variant='outlined' onClick={exportConfig}>Export Config</Button>
                                    <Button variant='outlined' onClick={() => importInputRef.current?.click()}>Import Config</Button>
                                    <Button href='/dashboard/piggietv' variant='text'>Back to Status</Button>
                                    <input ref={importInputRef} hidden type='file' accept='application/json,.json' onChange={importConfig} />
                                </Stack>
                                {loading && <Alert severity='info'>Loading row settings...</Alert>}
                            </Stack>
                        </CardContent>
                    </Card>

                    <Card className='ptv-dashboard-card ptv-control-card'>
                        <CardContent>
                            <Stack spacing={1.5}>
                                <Typography variant='h2'>Row Rules</Typography>
                                {form.rules.map((rule, index) => {
                                    const genreOptions = getGenres(rule.mediaType);
                                    const genreValue = rule.sourceType === 'genre' && isBuiltInGenre(rule) ? rule.sourceValue : CUSTOM_GENRE;
                                    const showCustomGenre = rule.sourceType === 'genre' && genreValue === CUSTOM_GENRE;
                                    const canSubgenre = rule.sourceType === 'genre' && rule.generationMode === 'random';

                                    return (
                                        <Box key={`${rule.id}-${index}`} className='ptv-dashboard-list-row'>
                                            <Grid container spacing={1.25} alignItems='center'>
                                                <Grid size={{ xs: 12, md: 1 }}>
                                                    <FormControlLabel
                                                        control={<Switch checked={rule.enabled} onChange={event => updateRule(index, { enabled: event.target.checked })} />}
                                                        label='On'
                                                    />
                                                </Grid>
                                                <Grid size={{ xs: 12, md: 2 }}>
                                                    <TextField fullWidth label='Row Name' value={rule.name} onChange={event => updateRule(index, { name: event.target.value, id: slugify(event.target.value) })} />
                                                </Grid>
                                                <Grid size={{ xs: 12, md: 1.4 }}>
                                                    <TextField fullWidth select label='Media' value={rule.mediaType} onChange={event => updateRule(index, { mediaType: event.target.value as RowMediaType })}>
                                                        {MEDIA_TYPES.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                                                    </TextField>
                                                </Grid>
                                                <Grid size={{ xs: 12, md: 1.8 }}>
                                                    <TextField fullWidth select label='Source' value={rule.sourceType} onChange={event => updateRule(index, { sourceType: event.target.value as RowSourceType })}>
                                                        {SOURCE_TYPES.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                                                    </TextField>
                                                </Grid>
                                                <Grid size={{ xs: 12, md: 2 }}>
                                                    {rule.sourceType === 'genre' && (
                                                        <Stack direction='row' spacing={1}>
                                                            <TextField fullWidth select label='Genre' value={genreValue} onChange={event => updateRule(index, { sourceValue: event.target.value === CUSTOM_GENRE ? '' : event.target.value })}>
                                                                {genreOptions.map(genre => <MenuItem key={genre} value={genre}>{genre}</MenuItem>)}
                                                                <MenuItem value={CUSTOM_GENRE}>Custom...</MenuItem>
                                                            </TextField>
                                                            {showCustomGenre && <TextField fullWidth label='Custom Genre' value={rule.sourceValue} onChange={event => updateRule(index, { sourceValue: event.target.value })} />}
                                                        </Stack>
                                                    )}
                                                    {rule.sourceType === 'studio' && (
                                                        <TextField fullWidth select label='Studio' value={STUDIO_OPTIONS.includes(rule.sourceValue) ? rule.sourceValue : ''} helperText={!STUDIO_OPTIONS.length ? 'No studio metadata found yet.' : 'Suggestions come from known metadata/provider values.'} onChange={event => updateRule(index, { sourceValue: event.target.value })}>
                                                            {STUDIO_OPTIONS.map(studio => <MenuItem key={studio} value={studio}>{studio}</MenuItem>)}
                                                        </TextField>
                                                    )}
                                                    {['collection', 'library'].includes(rule.sourceType) && (
                                                        <TextField fullWidth label='Source Value' value={rule.sourceValue} onChange={event => updateRule(index, { sourceValue: event.target.value })} />
                                                    )}
                                                    {rule.sourceType === 'seasonal' && (
                                                        <TextField fullWidth select label='Seasonal Mode' value={rule.seasonal?.mode || 'auto'} onChange={event => updateRule(index, { sourceValue: event.target.value, seasonal: { ...(rule.seasonal || { mode: 'auto' }), mode: event.target.value } })}>
                                                            {SEASONAL_MODES.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                                                        </TextField>
                                                    )}
                                                    {['continueWatching', 'latest', 'requested'].includes(rule.sourceType) && (
                                                        <TextField fullWidth disabled label='Source Value' value={rule.sourceValue} />
                                                    )}
                                                </Grid>
                                                <Grid size={{ xs: 12, md: 1.4 }}>
                                                    <TextField fullWidth select label='Mode' value={rule.generationMode} onChange={event => updateRule(index, { generationMode: event.target.value as RowGenerationMode })}>
                                                        {GENERATION_MODES.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                                                    </TextField>
                                                </Grid>
                                                <Grid size={{ xs: 6, md: 0.9 }}>
                                                    <TextField fullWidth label={rule.generationMode === 'random' && rule.sourceType === 'genre' ? 'Rows' : 'Limit'} type='number' value={rule.generationMode === 'random' && rule.sourceType === 'genre' ? rule.rowCount : rule.itemLimit} onChange={event => updateRule(index, rule.generationMode === 'random' && rule.sourceType === 'genre' ? { rowCount: Number(event.target.value) } : { itemLimit: Number(event.target.value) })} />
                                                </Grid>
                                                <Grid size={{ xs: 6, md: 0.9 }}>
                                                    <TextField fullWidth label='Priority' type='number' value={rule.sortPriority} onChange={event => updateRule(index, { sortPriority: Number(event.target.value) })} />
                                                </Grid>
                                                <Grid size={{ xs: 12, md: 1.6 }}>
                                                    <Stack direction='row' spacing={1} alignItems='center'>
                                                        {canSubgenre && (
                                                            <>
                                                                <FormControlLabel
                                                                    control={<Switch checked={rule.includeSubgenres} onChange={event => updateRule(index, { includeSubgenres: event.target.checked })} />}
                                                                    label='Subgenres'
                                                                />
                                                                {rule.includeSubgenres && <TextField label='Subrows' type='number' value={rule.subgenreRowCount} onChange={event => updateRule(index, { subgenreRowCount: Number(event.target.value) })} />}
                                                            </>
                                                        )}
                                                        <Button color='error' variant='outlined' onClick={() => removeRule(index)}>Remove</Button>
                                                    </Stack>
                                                </Grid>
                                            </Grid>
                                            <Grid container spacing={1.25} sx={{ mt: 1 }}>
                                                <Grid size={{ xs: 12, md: 1.5 }}>
                                                    <TextField fullWidth select label='Tier' value={rule.tier} onChange={event => updateRule(index, { tier: Number(event.target.value) })}>
                                                        {ROW_TIERS.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                                                    </TextField>
                                                </Grid>
                                                <Grid size={{ xs: 12, md: 2 }}>
                                                    <TextField fullWidth select label='Presentation' value={rule.presentation} onChange={event => updateRule(index, { presentation: event.target.value as RowPresentation })}>
                                                        {ROW_PRESENTATIONS.map(option => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
                                                    </TextField>
                                                </Grid>
                                                <Grid size={{ xs: 12, md: 3 }}>
                                                    <TextField fullWidth label='Group Label' value={rule.groupTitle} onChange={event => updateRule(index, { groupTitle: event.target.value })} />
                                                </Grid>
                                            </Grid>
                                        </Box>
                                    );
                                })}
                            </Stack>
                        </CardContent>
                    </Card>

                    <Grid container spacing={2}>
                        <Grid size={{ xs: 12, lg: 7 }}>
                            <Card className='ptv-dashboard-card ptv-control-card'>
                                <CardContent>
                                    <Stack spacing={1.5}>
                                        <Typography variant='h2'>Preview</Typography>
                                        {!preview?.rows?.length && <Typography color='text.secondary'>No preview generated yet.</Typography>}
                                        {preview?.validation?.errors?.map(error => <Alert key={error} severity='error'>{error}</Alert>)}
                                        {preview?.validation?.warnings?.map(warning => <Alert key={warning} severity='warning'>{warning}</Alert>)}
                                        {preview?.rows?.map(row => (
                                            <Box key={row.id} className='ptv-dashboard-list-row'>
                                                <Stack direction='row' spacing={1} alignItems='center' flexWrap='wrap'>
                                                    <Typography variant='h3'>{row.title}</Typography>
                                                    <Chip size='small' label={`${row.itemCount} items`} color={getPreviewChipColor(row)} />
                                                    <Chip size='small' label={row.mediaType || 'mixed'} />
                                                    <Chip size='small' label={row.sourceType || 'source'} />
                                                    <Chip size='small' label={row.generationMode || 'mode'} />
                                                    <Chip size='small' label={row.providerUsed || 'jellyfin'} />
                                                </Stack>
                                                {!!row.warnings?.length && <Typography variant='body2' color='warning.main'>{row.warnings.join(' ')}</Typography>}
                                            </Box>
                                        ))}
                                        {!!preview?.diagnostics?.length && (
                                            <>
                                                <Divider />
                                                <Typography variant='h3'>Row Diagnostics</Typography>
                                                {preview.diagnostics.slice(0, 16).map((diagnostic, index) => (
                                                    <Typography key={`${diagnostic.ruleId}-${diagnostic.searchTerm}-${index}`} variant='body2'>
                                                        {formatDiagnosticSummary(diagnostic)}
                                                    </Typography>
                                                ))}
                                            </>
                                        )}
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>

                        <Grid size={{ xs: 12, lg: 5 }}>
                            <Card className='ptv-dashboard-card ptv-control-card'>
                                <CardContent>
                                    <Stack spacing={1.25}>
                                        <Typography variant='h2'>Diagnostics / Integrations</Typography>
                                        <Stack direction='row' spacing={1} flexWrap='wrap'>
                                            <Button variant='outlined' onClick={toggleDebug}>{debugEnabled ? 'Disable Debug' : 'Enable Debug'}</Button>
                                            <Button variant='outlined' onClick={clearDebug}>Clear Events</Button>
                                            <Button variant='outlined' onClick={exportDebug}>Export Debug JSON</Button>
                                            <Button variant='outlined' onClick={refreshDiagnostics}>Refresh Status</Button>
                                        </Stack>
                                        <Divider />
                                        <Typography>Cache: {cacheStatus.storage} / {cacheStatus.isFresh ? 'fresh' : 'stale'}</Typography>
                                        <Typography>Rows: {preview?.rows?.length ?? cacheStatus.sectionCount}</Typography>
                                        <Typography>Items: {cacheStatus.itemCount}</Typography>
                                        <Typography>Heroes: {cacheStatus.heroCount}</Typography>
                                        <Typography>Last refresh: {cacheStatus.lastRefreshDurationMs ?? 'n/a'} ms</Typography>
                                        <Typography>API requests: {pluginDiagnostics.attemptedUrls.length}</Typography>
                                        <Typography>Image p95: {debugReport.images?.timings?.p95Ms ?? 'n/a'} ms</Typography>
                                        <Typography>Refresh state: {refreshState}</Typography>
                                        <Divider />
                                        <Typography variant='h3'>API Origins</Typography>
                                        {(pluginDiagnostics.attemptedOrigins || []).slice(-8).map(originEntry => (
                                            <Typography key={`${originEntry.originKind}-${originEntry.url}`} variant='body2'>
                                                {originEntry.originKind}: {originEntry.origin}
                                            </Typography>
                                        ))}
                                        <Divider />
                                        <Typography variant='h3'>Provider Status</Typography>
                                        <Typography variant='body2'>API keys are saved and tested in the PiggieTV Integrations dashboard. Row generation uses Jellyfin metadata first and only enriches when providers are configured.</Typography>
                                        {Object.entries(preview?.providerStatus || {}).map(([provider, value]) => (
                                            <Typography key={provider} variant='body2'>
                                                {provider}: {JSON.stringify(value)}
                                            </Typography>
                                        ))}
                                        <Divider />
                                        <Typography variant='h3'>Recent Events</Typography>
                                        {(debugReport.events || []).slice(-8).map((event, index) => (
                                            <Typography key={`${event.name}-${index}`} variant='body2'>
                                                {event.type}:{event.name}
                                            </Typography>
                                        ))}
                                    </Stack>
                                </CardContent>
                            </Card>
                        </Grid>
                    </Grid>
                </Stack>
            </Box>
        </Page>
    );
};

export default PiggieTvRowsPage;
/* eslint-enable @stylistic/operator-linebreak, max-params, no-nested-ternary, react/jsx-no-bind, react/no-array-index-key, sonarjs/anchor-precedence, sonarjs/no-nested-conditional */
