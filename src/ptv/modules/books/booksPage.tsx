/* eslint-disable react/jsx-no-bind, no-void */
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react';
import { useLocation } from 'react-router-dom';

import Page from 'components/Page';
import { playbackManager } from 'components/playback/playbackmanager';

import './books.scss';

import { setPtvFavorite } from '../../api';
import { PTV_ASSETS, PTV_ROUTES } from '../../core/config';
import { getPtvPerformanceProfile } from '../../core/clientProfile';
import { recordPtvEvent } from '../../core/observability';
import { scheduleRouteCheck } from '../../core/router';
import { notifyPtvTvFocusContentReady } from '../../core/tvFocus';
import { resolvePtvStaticAssetUrl } from '../../core/urlOrigins';
import PTVShell, { type PtvShellNavLink } from '../../shell/PTVShell';
import {
    getPtvRouteControllerState,
    recordPtvRouteGenerationLifecycle
} from '../../shell/routeController';
import { usePtvAdminDebugVisibility } from '../../utils/usePtvAdminDebugVisibility';
import { PtvIcon } from '../icons';
import { loadReaderProgress } from '../reader/readerProgressStore';
import {
    buildPtvReadingSeries,
    findPtvReadingSeriesById,
    getPtvReadingSeriesInfo,
    getPtvReadingSeriesItemOverrideKey,
    type PtvReadingSeries,
    type PtvReadingSeriesOverride
} from './booksSeries';
import {
    loadPtvReadingSeriesOverrides,
    loadPtvReadingSeriesOverridesFromServer,
    savePtvReadingSeriesOverrides
} from './booksSeriesOverrides';

import {
    getPtvReadingMetadataProviders
} from './booksMetadataProviders';
import {
    fetchPtvReadingItem,
    fetchPtvReadingHomeSection,
    fetchPtvReadingLibraryIndex,
    getPtvReadingAuthors,
    getPtvReadingExtension,
    getPtvReadingFormat,
    getPtvReadingFormatLabel,
    getPtvReadingGenres,
    getPtvReadingHome,
    getPtvReadingImagePlaceholder,
    getPtvReadingImageUrl,
    getPtvReadingItemKind,
    getPtvReadingRouteKind,
    getPtvReadingSeries,
    getPtvReadingStableId,
    getPtvReadingTitle,
    invalidatePtvReadingHomeCache,
    mergePtvReadingLibraryIndex,
    searchPtvReading,
    uniquePtvReadingItems
} from './booksApi';
import {
    buildReadingDiagnosticSections,
    canShowReadingDiagnostics
} from './readingDiagnostics';
import {
    getReadingPageRenderIdentity,
    shouldPublishReadingIndexProgress
} from './readingIndexPublishing';
import {
    createPtvReadingImageFailureRegistry,
    normalizePtvReadingImageRoute
} from './readingImageFailures';
import { shouldPreservePtvReadingIndex } from './readingProgressiveIndex';
import type {
    PtvReadingHomeData,
    PtvReadingItem,
    PtvReadingLibraryDebug,
    PtvReadingLibraryIndex,
    PtvReadingRouteKind,
    PtvReadingSection
} from './booksTypes';

type ReadingView = 'collections' | 'explore' | 'home' | 'item' | 'library' | 'series';

type ReadingRouteState = Readonly<{
    id: string;
    kind: PtvReadingRouteKind;
    search: string;
    view: ReadingView;
}>;

type ReadingBrowseFilter = 'all' | 'favorites' | 'in-progress' | 'read' | 'unread';

type ReadingBrowseFormatFilter = 'all' | 'book' | 'comic' | 'epub' | 'pdf';

type ReadingBrowseSort = 'author' | 'format' | 'recent' | 'series' | 'title' | 'year';

type ReadingBrowseViewMode = 'items' | 'series';

const READING_BROWSE_VIEW_MODE_KEY_PREFIX = 'ptv:reading:browse-view:';

type ReadingSeriesOverridesByKind = Partial<Record<PtvReadingRouteKind, Record<string, PtvReadingSeriesOverride>>>;

type ReadingSeriesOverrideUpdate = Readonly<{
    item: PtvReadingItem;
    override: Omit<PtvReadingSeriesOverride, 'itemId'>;
}>;

type ReadingSeriesOverrideDiagnostics = Readonly<{
    groupedSeriesCount: number;
    manualSeriesCount: number;
    overrideCount: number;
    overrideItemIds: string[];
}>;

function getDefaultReadingBrowseViewMode(routeKind: PtvReadingRouteKind): ReadingBrowseViewMode {
    return routeKind === 'comics' || routeKind === 'manga' ? 'series' : 'items';
}

function getStoredReadingBrowseViewMode(routeKind: PtvReadingRouteKind): ReadingBrowseViewMode {
    if (typeof localStorage === 'undefined') return getDefaultReadingBrowseViewMode(routeKind);

    try {
        const storedMode = localStorage.getItem(`${READING_BROWSE_VIEW_MODE_KEY_PREFIX}${routeKind}`);

        return storedMode === 'items' || storedMode === 'series' ? storedMode : getDefaultReadingBrowseViewMode(routeKind);
    } catch {
        return getDefaultReadingBrowseViewMode(routeKind);
    }
}

function storeReadingBrowseViewMode(routeKind: PtvReadingRouteKind, viewMode: ReadingBrowseViewMode) {
    if (typeof localStorage === 'undefined') return;

    try {
        localStorage.setItem(`${READING_BROWSE_VIEW_MODE_KEY_PREFIX}${routeKind}`, viewMode);
    } catch {
        // Non-critical preference; ignore storage failures on private or restricted browsers.
    }
}

function getReadingSeriesOverrideKinds(routeKind: PtvReadingRouteKind): PtvReadingRouteKind[] {
    return routeKind === 'reading' ? ['books', 'comics', 'manga', 'reading'] : [routeKind];
}

function loadReadingSeriesOverridesForRoute(routeKind: PtvReadingRouteKind): ReadingSeriesOverridesByKind {
    return getReadingSeriesOverrideKinds(routeKind).reduce<ReadingSeriesOverridesByKind>((overrides, kind) => {
        overrides[kind] = loadPtvReadingSeriesOverrides(kind);

        return overrides;
    }, {});
}

async function loadReadingSeriesOverridesForRouteFromServer(routeKind: PtvReadingRouteKind) {
    const kinds = getReadingSeriesOverrideKinds(routeKind);
    const loadedOverrides = await Promise.all(kinds.map(async kind => ({
        kind,
        overrides: await loadPtvReadingSeriesOverridesFromServer(kind)
    })));

    return loadedOverrides.reduce<ReadingSeriesOverridesByKind>((overridesByKind, entry) => {
        overridesByKind[entry.kind] = entry.overrides;

        return overridesByKind;
    }, {});
}

function getReadingSeriesOverridesForRoute(
    routeKind: PtvReadingRouteKind,
    overridesByKind: ReadingSeriesOverridesByKind
) {
    return getReadingSeriesOverrideKinds(routeKind).reduce<Record<string, PtvReadingSeriesOverride>>((overrides, kind) => ({
        ...overrides,
        ...(overridesByKind[kind] || {})
    }), {});
}

function getReadingSeriesOverrideKind(routeKind: PtvReadingRouteKind, item: PtvReadingItem) {
    return routeKind === 'reading' ? getReadingSeriesRouteKindForItem(item) : routeKind;
}

function parsePromptYear(value: string | null) {
    if (value === null) return undefined;

    const trimmedValue = value.trim();

    if (!trimmedValue) return null;

    const parsedValue = Number(trimmedValue);

    return Number.isFinite(parsedValue) ? parsedValue : null;
}

function parsePromptOptionalNumber(value: string | null) {
    if (value === null) return undefined;

    const trimmedValue = value.trim();

    if (!trimmedValue) return undefined;

    const parsedValue = Number(trimmedValue);

    return Number.isFinite(parsedValue) ? parsedValue : undefined;
}

function getReadingSeriesPromptOverride(
    item: PtvReadingItem,
    series: PtvReadingSeries,
    existingOverride?: PtvReadingSeriesOverride
) {
    if (typeof window === 'undefined') return null;

    const inferredInfo = getPtvReadingSeriesInfo(item);
    const title = window.prompt('Series name', existingOverride?.seriesTitle || series.title || inferredInfo.seriesTitle);

    if (title === null) return null;

    const nextTitle = title.trim();

    if (!nextTitle) return null;

    const year = parsePromptYear(window.prompt('Series year', String(existingOverride?.seriesYear ?? series.year ?? inferredInfo.year ?? '')));
    const volumeNumber = parsePromptOptionalNumber(window.prompt('Volume number', String(existingOverride?.volumeNumber ?? inferredInfo.volumeNumber ?? '')));
    const issueNumber = parsePromptOptionalNumber(window.prompt('Issue number', String(existingOverride?.issueNumber ?? inferredInfo.issueNumber ?? '')));

    return {
        excluded: false,
        issueNumber,
        seriesTitle: nextTitle,
        seriesYear: year ?? null,
        volumeNumber
    } satisfies Omit<PtvReadingSeriesOverride, 'itemId'>;
}

function getReadingSeriesGroupPromptOverride(series: PtvReadingSeries) {
    if (typeof window === 'undefined') return null;

    const title = window.prompt('Series name', series.title);

    if (title === null) return null;

    const nextTitle = title.trim();

    if (!nextTitle) return null;

    const year = parsePromptYear(window.prompt('Series year', String(series.year ?? '')));

    return {
        excluded: false,
        seriesTitle: nextTitle,
        seriesYear: year ?? null
    } satisfies Omit<PtvReadingSeriesOverride, 'itemId'>;
}

function getReadingSeriesDiagnostics(
    groupedSeries: PtvReadingSeries[],
    seriesOverrides: Record<string, PtvReadingSeriesOverride>
): ReadingSeriesOverrideDiagnostics {
    return {
        groupedSeriesCount: groupedSeries.length,
        manualSeriesCount: groupedSeries.filter(series => series.confidence === 'manual').length,
        overrideCount: Object.keys(seriesOverrides).length,
        overrideItemIds: Object.keys(seriesOverrides).slice(0, 12)
    };
}

type ItemDetailState = Readonly<{
    error: string;
    isLoading: boolean;
    item: PtvReadingItem | null;
}>;

type ReadingAdminAction = 'identify' | 'images' | 'metadata';

type ReadingAdminContextValue = Readonly<{
    canShowDebug: boolean;
    debugEnabled: boolean;
    isAdmin: boolean;
    onAction: (item: PtvReadingItem, action: ReadingAdminAction) => void;
}>;

const READING_ADMIN_CONTEXT = createContext<ReadingAdminContextValue>({
    canShowDebug: false,
    debugEnabled: false,
    isAdmin: false,
    onAction: () => undefined
});

const EMPTY_HOME_DATA: PtvReadingHomeData = {
    generatedAt: 0,
    kind: 'books',
    libraries: [],
    sections: [],
    stats: {
        favoriteCount: 0,
        itemCount: 0,
        libraryCount: 0,
        metadata: {
            itemCount: 0,
            providerCounts: {
                comicvine: 0,
                googlebooks: 0,
                openlibrary: 0
            }
        },
        resumedCount: 0
    }
};

function getEmptyReadingHomeData(kind: PtvReadingRouteKind): PtvReadingHomeData {
    return {
        ...EMPTY_HOME_DATA,
        kind,
        libraries: [],
        sections: [],
        stats: {
            ...EMPTY_HOME_DATA.stats,
            metadata: {
                itemCount: 0,
                providerCounts: {
                    comicvine: 0,
                    googlebooks: 0,
                    openlibrary: 0
                }
            }
        }
    };
}

const PTV_READING_FALLBACK_BACKGROUND_URL = resolvePtvStaticAssetUrl(PTV_ASSETS.backgrounds.page);
const PTV_READING_FULL_HOME_LOAD_DELAY_MS = 2500;
const PTV_READING_LIBRARY_INDEX_LOAD_DELAY_MS = 5000;
const PTV_READING_GRID_RENDER_LIMIT = 24;
const PTV_READING_SKELETON_KEYS = [
    'reading-skeleton-1',
    'reading-skeleton-2',
    'reading-skeleton-3',
    'reading-skeleton-4',
    'reading-skeleton-5',
    'reading-skeleton-6',
    'reading-skeleton-7',
    'reading-skeleton-8'
];
const readingImageFailures = createPtvReadingImageFailureRegistry();

function getReadingImageRoute(route?: string | null) {
    return normalizePtvReadingImageRoute(route
        || (typeof document !== 'undefined' ? document.body?.dataset.ptvReadingRoute : ''));
}

function getReadingImageFailureState(route?: string | null) {
    return readingImageFailures.get(getReadingImageRoute(route));
}

function clearReadingImageFailuresForItem(itemId: string | null | undefined, route?: string | null) {
    readingImageFailures.clearForItem(getReadingImageRoute(route), itemId);
}

function applyReadingImageFallbackToItem(itemId: string | undefined, fallbackUrl: string, route?: string | null) {
    if (!itemId || typeof document === 'undefined') return;

    const routeKey = getReadingImageRoute(route);

    document.querySelectorAll<HTMLImageElement>('img[data-ptv-reading-item-id]').forEach(image => {
        if (image.dataset.ptvReadingItemId !== itemId) return;
        if (getReadingImageRoute(image.dataset.ptvReadingRoute) !== routeKey) return;
        if (image.dataset.ptvFallbackApplied === 'true') return;

        image.dataset.ptvFallbackApplied = 'true';
        image.src = fallbackUrl;
    });
}

function recordReadingCachedFailureHit(url: string, itemId?: string, route?: string | null) {
    const routeKey = getReadingImageRoute(route);
    const imageFailures = getReadingImageFailureState(routeKey);

    if (imageFailures.reportedCachedFailureUrls.has(url)) return;

    imageFailures.reportedCachedFailureUrls.add(url);
    imageFailures.cachedFailureHitCount += 1;
    recordPtvEvent('image', 'reading-image-cached-failure-hit', {
        cachedFailureHit: true,
        itemId: itemId || null,
        route: routeKey,
        url
    });
}

function logReadingPageEvent(name: string, detail: Record<string, unknown> = {}) {
    recordPtvEvent('render', name, detail);
}

function openReadingAdminDialog(item: PtvReadingItem, action: ReadingAdminAction) {
    const itemId = item.Id;

    if (!itemId) return Promise.resolve();

    const serverId = item.ServerId;

    if (action === 'images') {
        return import('components/imageeditor/imageeditor')
            .then(({ default: imageEditor }) => imageEditor.show({
                itemId,
                serverId
            }));
    }

    if (action === 'metadata') {
        return import('components/metadataEditor/metadataEditor')
            .then(({ default: metadataEditor }) => metadataEditor.show(itemId, serverId));
    }

    return import('components/itemidentifier/itemidentifier')
        .then(itemIdentifier => itemIdentifier.show(itemId, serverId));
}

function cleanupReadingRouteState() {
    document.documentElement.classList.remove('ptv-route-reading-mounted');
    document.body.classList.remove('ptv-route-reading-mounted');
    delete document.documentElement.dataset.ptvReadingRouteMounted;
    delete document.body.dataset.ptvReadingRouteMounted;
}

function navigateToPtvHome(event?: React.MouseEvent<HTMLElement>) {
    event?.preventDefault();
    cleanupReadingRouteState();
    window.location.hash = '#/home';
    window.setTimeout(() => {
        scheduleRouteCheck(true);

        const routeState = getPtvRouteControllerState();

        logReadingPageEvent('reading-navigation-home', {
            currentRoute: routeState.routeId,
            hash: window.location.hash,
            mode: routeState.mode
        });
    }, 0);
}

function verifyReadingShell() {
    const headerRoot = document.querySelector('.ptv-app-header-root');
    const header = document.querySelector('.ptv-skinHeader, .ptv-legacy-skinHeader, .skinHeader');
    const sidebar = document.querySelector('.ptv-sidebar, .mainDrawer');
    const missing = [
        !headerRoot && !header ? 'header' : '',
        !sidebar ? 'sidebar' : ''
    ].filter(Boolean);

    if (missing.length) {
        recordPtvEvent('render', 'reading-shell-missing', { missing });

        const routeController = window.PTV?.routeController as {
            refresh?: () => unknown;
        } | undefined;

        routeController?.refresh?.();
        return false;
    }

    recordPtvEvent('render', 'reading-shell-ready', {
        header: Boolean(header),
        headerRoot: Boolean(headerRoot),
        sidebar: true
    });

    return true;
}

function getQueryParam(search: string, key: string) {
    const query = search.startsWith('?') ? search.slice(1) : search;
    const pairs = query ? query.split('&') : [];

    for (const pair of pairs) {
        const [rawKey, rawValue = ''] = pair.split('=');

        if (decodeURIComponent(rawKey || '') === key) {
            return decodeURIComponent(rawValue.replace(/\+/g, ' '));
        }
    }

    return '';
}

function getReadingRouteState(
    kind: PtvReadingRouteKind,
    view: ReadingView,
    search: string,
    id = ''
): ReadingRouteState {
    return {
        id,
        kind,
        search,
        view
    };
}

function isScopedReadingKind(segment: string) {
    return segment === 'books' || segment === 'comics' || segment === 'manga' || segment === 'maga';
}

function getReadingRouteForKind(
    kind: PtvReadingRouteKind,
    viewSegment: string,
    idSegment: string,
    search: string,
    fallbackView: ReadingView
) {
    switch (viewSegment) {
        case 'explore':
            return getReadingRouteState(kind, 'explore', search);
        case 'library':
            return getReadingRouteState(kind, 'library', search);
        case 'collections':
            return getReadingRouteState(kind, 'collections', search);
        case 'series':
            return getReadingRouteState(kind, 'series', search, decodeURIComponent(idSegment || ''));
        case 'book':
        case 'item':
            return getReadingRouteState(kind, 'item', search, decodeURIComponent(idSegment || ''));
        default:
            return getReadingRouteState(kind, fallbackView, search);
    }
}

function getRootReadingRoute(parts: string[], search: string) {
    const segment = parts[1] || 'home';

    if (isScopedReadingKind(segment)) {
        return getReadingRouteForKind(
            getPtvReadingRouteKind(segment),
            parts[2] || 'library',
            parts[3] || '',
            search,
            'library'
        );
    }

    return getReadingRouteForKind('reading', segment, parts[2] || '', search, 'home');
}

function getReadingRoute(pathname: string, search: string): ReadingRouteState {
    const parts = pathname.split('/').filter(Boolean);
    const searchTerm = getQueryParam(search, 'search');
    const routeRoot = parts[0] || 'reading';

    if (routeRoot === 'reading') {
        return getRootReadingRoute(parts, searchTerm);
    }

    return getReadingRouteForKind(
        getPtvReadingRouteKind(routeRoot),
        parts[1] || 'library',
        parts[2] || '',
        searchTerm,
        'home'
    );
}

function getRouteBase(kind: PtvReadingRouteKind) {
    if (kind === 'reading') return 'reading';

    return kind === 'manga' ? 'manga' : kind;
}

function getRouteTitle(kind: PtvReadingRouteKind) {
    if (kind === 'reading') return 'Reading';
    if (kind === 'comics') return 'Comics';
    if (kind === 'manga') return 'Manga';

    return 'Books';
}

function getReadingRoutePageTitle(route: ReadingRouteState) {
    if (route.view === 'collections') return 'Collections';
    if (route.view === 'explore') return 'Explore';
    if (route.view === 'item') return 'Details';
    if (route.view === 'library') return getRouteTitle(route.kind);
    if (route.view === 'series') return 'Series';

    return getRouteTitle(route.kind);
}

function getReadingContextLinks(route: ReadingRouteState): PtvShellNavLink[] {
    return [
        { active: route.kind === 'reading' && route.view === 'home', href: PTV_ROUTES.reading, icon: 'home', id: 'reading-home', label: 'Home' },
        { active: route.kind === 'reading' && route.view === 'explore', href: PTV_ROUTES.readingExplore, icon: 'shuffle', id: 'reading-explore', label: 'Explore' },
        { active: route.kind === 'books' && (route.view === 'library' || route.view === 'item' || route.view === 'series'), href: PTV_ROUTES.readingBooks, icon: 'books', id: 'reading-books', label: 'Books' },
        { active: route.kind === 'comics' && (route.view === 'library' || route.view === 'item' || route.view === 'series'), href: PTV_ROUTES.readingComics, icon: 'collections', id: 'reading-comics', label: 'Comics' },
        { active: route.kind === 'manga' && (route.view === 'library' || route.view === 'item' || route.view === 'series'), href: PTV_ROUTES.readingManga, icon: 'anime', id: 'reading-manga', label: 'Manga' },
        { active: route.kind === 'reading' && route.view === 'collections', href: PTV_ROUTES.readingCollections, icon: 'collections', id: 'reading-collections', label: 'Collections' }
    ];
}

function shouldShowReadingToolbarTitle(view: ReadingView) {
    return !['collections', 'library'].includes(view);
}

function getRouteKicker(kind: PtvReadingRouteKind) {
    if (kind === 'reading') return 'Books - Comics - Manga';
    if (kind === 'comics') return 'Comics library';
    if (kind === 'manga') return 'Manga library';

    return 'Books library';
}

function getItemHref(item: PtvReadingItem, kind: PtvReadingRouteKind) {
    if (kind === 'reading') {
        const itemKind = getPtvReadingItemKind(item);
        let routeBase = 'books';

        if (itemKind === 'comic') routeBase = 'comics';
        if (itemKind === 'manga') routeBase = 'manga';

        return item.Id ? `#/reading/${routeBase}/item/${encodeURIComponent(item.Id)}` : PTV_ROUTES.reading;
    }

    return item.Id ? `#/${getRouteBase(kind)}/item/${encodeURIComponent(item.Id)}` : `#/${getRouteBase(kind)}`;
}

function getSeriesHref(series: PtvReadingSeries, kind: PtvReadingRouteKind) {
    if (kind === 'reading') {
        return `#/reading/series/${encodeURIComponent(series.id)}`;
    }

    return `#/${getRouteBase(kind)}/series/${encodeURIComponent(series.id)}`;
}

function getLibraryHref(kind: PtvReadingRouteKind) {
    if (kind === 'reading') return PTV_ROUTES.readingBooks;

    return `#/${getRouteBase(kind)}/library`;
}

function getDetailsHref(item: PtvReadingItem) {
    const serverParam = item.ServerId ? `&serverId=${encodeURIComponent(item.ServerId)}` : '';

    return item.Id ? `#/details?id=${encodeURIComponent(item.Id)}${serverParam}` : '#/home';
}

function getSection(homeData: PtvReadingHomeData, id: string) {
    return homeData.sections.find(section => section.id === id);
}

function getReadingSeriesRouteKindForItem(item: PtvReadingItem): PtvReadingRouteKind {
    const itemKind = getPtvReadingItemKind(item);

    if (itemKind === 'comic') return 'comics';
    if (itemKind === 'manga') return 'manga';

    return 'books';
}

function buildReadingSeriesForRoute(
    items: PtvReadingItem[],
    routeKind: PtvReadingRouteKind,
    seriesOverrides: Record<string, PtvReadingSeriesOverride> = {}
) {
    if (routeKind !== 'reading') return buildPtvReadingSeries(items, routeKind, { overrides: seriesOverrides });

    const itemsByKind = new Map<PtvReadingRouteKind, PtvReadingItem[]>();

    items.forEach(item => {
        const itemRouteKind = getReadingSeriesRouteKindForItem(item);
        const scopedItems = itemsByKind.get(itemRouteKind) || [];

        scopedItems.push(item);
        itemsByKind.set(itemRouteKind, scopedItems);
    });

    return Array.from(itemsByKind.entries())
        .flatMap(([scopedKind, scopedItems]) => buildPtvReadingSeries(scopedItems, scopedKind, { overrides: seriesOverrides }))
        .sort((left, right) => left.title.localeCompare(right.title));
}

function getSectionItems(homeData: PtvReadingHomeData, id: string) {
    return getSection(homeData, id)?.items || [];
}

function getAllReadingItems(homeData: PtvReadingHomeData) {
    return uniquePtvReadingItems(homeData.sections.reduce<PtvReadingItem[]>((items, section) => items.concat(section.items), []));
}

export function mergeReadingHomeRefresh(previous: PtvReadingHomeData, nextHomeData: PtvReadingHomeData, stage: string) {
    if (previous.kind !== nextHomeData.kind) return nextHomeData;

    const previousItemCount = getAllReadingItems(previous).length;
    const nextItemCount = getAllReadingItems(nextHomeData).length;
    const previousIndexCount = previous.libraryDebug?.indexAccumulatedCount || 0;
    const nextIndexCount = nextHomeData.libraryDebug?.indexAccumulatedCount || 0;

    if (shouldPreservePtvReadingIndex(previousIndexCount, nextIndexCount, nextItemCount)) {
        recordPtvEvent('cache', 'reading-background-refresh-preserved-progressive-index', {
            kind: nextHomeData.kind,
            nextIndexCount,
            nextItemCount,
            previousIndexCount,
            previousItemCount,
            reason: 'background-refresh-less-complete-than-active-index',
            stage
        });

        return {
            ...previous,
            cacheDiagnostics: nextHomeData.cacheDiagnostics || previous.cacheDiagnostics
        };
    }

    if (previousItemCount > 0 && nextItemCount === 0) {
        recordPtvEvent('cache', 'reading-background-refresh-preserved-visible-cache', {
            kind: nextHomeData.kind,
            nextCacheStatus: nextHomeData.cacheDiagnostics?.status || 'none',
            nextIsPartial: Boolean(nextHomeData.isPartial),
            previousItemCount,
            reason: 'background-refresh-empty',
            stage
        });

        return {
            ...previous,
            cacheDiagnostics: nextHomeData.cacheDiagnostics || previous.cacheDiagnostics,
            libraryDebug: nextHomeData.libraryDebug || previous.libraryDebug,
            sectionDiagnostics: nextHomeData.sectionDiagnostics?.length ? nextHomeData.sectionDiagnostics : previous.sectionDiagnostics
        };
    }

    if (!previous.isPartial && nextHomeData.isPartial) {
        recordPtvEvent('cache', 'reading-background-refresh-preserved-full-cache', {
            kind: nextHomeData.kind,
            nextItemCount,
            previousItemCount,
            reason: 'background-refresh-partial',
            stage
        });

        return {
            ...previous,
            cacheDiagnostics: nextHomeData.cacheDiagnostics || previous.cacheDiagnostics,
            libraryDebug: nextHomeData.libraryDebug || previous.libraryDebug,
            sectionDiagnostics: nextHomeData.sectionDiagnostics?.length ? nextHomeData.sectionDiagnostics : previous.sectionDiagnostics
        };
    }

    return nextHomeData;
}

function replaceReadingSection(sections: PtvReadingSection[], nextSection: PtvReadingSection) {
    const nextSections = sections.map(section => section.id === nextSection.id ? nextSection : section);

    if (!nextSections.some(section => section.id === nextSection.id)) {
        nextSections.push(nextSection);
    }

    return nextSections;
}

function replaceReadingItemInHomeData(homeData: PtvReadingHomeData, updatedItem: PtvReadingItem) {
    if (!updatedItem.Id) return homeData;

    let replaced = false;
    const sections = homeData.sections.map(section => {
        let sectionChanged = false;
        const items = section.items.map(item => {
            if (item.Id !== updatedItem.Id) return item;

            replaced = true;
            sectionChanged = true;
            return {
                ...item,
                ...updatedItem,
                PtvReadingLibraryKindHint: updatedItem.PtvReadingLibraryKindHint || item.PtvReadingLibraryKindHint,
                PtvReadingLibraryName: updatedItem.PtvReadingLibraryName || item.PtvReadingLibraryName
            };
        });

        return sectionChanged ? {
            ...section,
            items
        } : section;
    });

    if (!replaced) return homeData;

    return {
        ...homeData,
        sections
    };
}

function getReadingSectionDiagnostics(sections: PtvReadingSection[]) {
    return sections
        .map(section => section.diagnostics)
        .filter((diagnostic): diagnostic is NonNullable<PtvReadingSection['diagnostics']> => Boolean(diagnostic));
}

function getHeroItems(homeData: PtvReadingHomeData, routeKind: PtvReadingRouteKind) {
    const continueItems = getSectionItems(homeData, 'continue-reading');
    const continueItemIds = new Set(continueItems.map(item => item.Id).filter(Boolean));
    const preferredSectionIds = [
        'recently-added',
        'library',
        'favorites',
        ...(routeKind === 'reading' ? ['comics', 'manga'] : [])
    ];
    const preferredItems = preferredSectionIds.reduce<PtvReadingItem[]>((items, sectionId) => (
        items.concat(getSectionItems(homeData, sectionId))
    ), []);
    const nonContinueItems = getAllReadingItems(homeData).filter(item => !item.Id || !continueItemIds.has(item.Id));

    return uniquePtvReadingItems([
        ...preferredItems.filter(item => !item.Id || !continueItemIds.has(item.Id)),
        ...nonContinueItems,
        ...continueItems
    ]).slice(0, 24);
}

function getReadableFormatLabel(item: PtvReadingItem) {
    const format = getPtvReadingFormat(item);

    if (format === 'unsupported') return `${getPtvReadingFormatLabel(item)} unsupported`;

    return getPtvReadingFormatLabel(item);
}

function getItemMeta(item: PtvReadingItem) {
    return [
        getPtvReadingAuthors(item),
        getPtvReadingSeries(item),
        item.ProductionYear ? String(item.ProductionYear) : ''
    ].filter(Boolean).join(' - ');
}

function getReadingProgressPercent(item: PtvReadingItem) {
    const progress = loadReaderProgress(getPtvReadingStableId(item));

    return typeof progress?.percent === 'number' ? progress.percent : 0;
}

function getKindLabel(item: PtvReadingItem) {
    const kind = getPtvReadingItemKind(item);

    if (kind === 'manga') return 'Manga';
    if (kind === 'comic') return 'Comic';

    return 'Book';
}

function getProgressLabel(item: PtvReadingItem) {
    const percent = getReadingProgressPercent(item);

    if (percent < 1) return '';

    return `${Math.round(percent)}% read`;
}

function isReadingItemRead(item: PtvReadingItem) {
    return Boolean(item.UserData?.Played) || getReadingProgressPercent(item) >= 99;
}

function getReadingBrowseSearchText(item: PtvReadingItem) {
    return [
        getPtvReadingTitle(item),
        getPtvReadingAuthors(item),
        getPtvReadingSeries(item),
        getReadableFormatLabel(item),
        getKindLabel(item),
        item.CollectionName,
        item.Album,
        item.ProductionYear ? String(item.ProductionYear) : '',
        item.IndexNumber ? String(item.IndexNumber) : '',
        getPtvReadingGenres(item).join(' ')
    ].filter(Boolean).join(' ').toLocaleLowerCase();
}

function getReadingSortValue(item: PtvReadingItem, sort: ReadingBrowseSort) {
    if (sort === 'author') return getPtvReadingAuthors(item) || getPtvReadingTitle(item);
    if (sort === 'format') return getReadableFormatLabel(item);
    if (sort === 'series') return getPtvReadingSeries(item) || getPtvReadingTitle(item);
    if (sort === 'year') return String(item.ProductionYear || 0).padStart(4, '0');

    return getPtvReadingTitle(item);
}

function sortReadingBrowseItems(items: PtvReadingItem[], sort: ReadingBrowseSort) {
    return [...items].sort((left, right) => {
        if (sort === 'recent') {
            const leftTime = left.DateCreated ? Date.parse(left.DateCreated) : 0;
            const rightTime = right.DateCreated ? Date.parse(right.DateCreated) : 0;

            return rightTime - leftTime || getPtvReadingTitle(left).localeCompare(getPtvReadingTitle(right));
        }

        if (sort === 'year') {
            return getReadingSortValue(right, sort).localeCompare(getReadingSortValue(left, sort))
                || getPtvReadingTitle(left).localeCompare(getPtvReadingTitle(right));
        }

        return getReadingSortValue(left, sort).localeCompare(getReadingSortValue(right, sort))
            || getPtvReadingTitle(left).localeCompare(getPtvReadingTitle(right));
    });
}

function getReadingBrowseItems(
    items: PtvReadingItem[],
    query: string,
    filter: ReadingBrowseFilter,
    formatFilter: ReadingBrowseFormatFilter,
    sort: ReadingBrowseSort
) {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    return sortReadingBrowseItems(items.filter(item => {
        if (formatFilter !== 'all' && getPtvReadingFormat(item) !== formatFilter) return false;

        if (filter === 'favorites' && !item.UserData?.IsFavorite) return false;
        if (filter === 'in-progress') {
            const percent = getReadingProgressPercent(item);

            if (percent < 1 || percent >= 99) return false;
        }
        if (filter === 'read' && !isReadingItemRead(item)) return false;
        if (filter === 'unread' && isReadingItemRead(item)) return false;

        return !normalizedQuery || getReadingBrowseSearchText(item).includes(normalizedQuery);
    }), sort);
}

function getMetadataProviderLabels(item: PtvReadingItem) {
    return getPtvReadingMetadataProviders(item).map(provider => provider.label);
}

const READING_HTML_ENTITIES: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"'
};

function stripReadingHtmlTags(value: string) {
    let output = '';
    let insideTag = false;

    for (const char of value) {
        if (char === '<') {
            insideTag = true;
            output += ' ';
            continue;
        }

        if (char === '>') {
            insideTag = false;
            output += ' ';
            continue;
        }

        if (!insideTag) {
            output += char;
        }
    }

    return output;
}

function decodeReadingHtmlEntities(value: string) {
    if (!value) return '';

    if (typeof document !== 'undefined') {
        const textarea = document.createElement('textarea');

        textarea.innerHTML = value;

        return textarea.value;
    }

    return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
        const normalizedEntity = String(entity || '').toLowerCase();

        if (normalizedEntity.startsWith('#x')) {
            const parsed = Number.parseInt(normalizedEntity.slice(2), 16);

            return Number.isFinite(parsed) ? String.fromCharCode(parsed) : match;
        }

        if (normalizedEntity.startsWith('#')) {
            const parsed = Number.parseInt(normalizedEntity.slice(1), 10);

            return Number.isFinite(parsed) ? String.fromCharCode(parsed) : match;
        }

        return READING_HTML_ENTITIES[normalizedEntity] || match;
    });
}

function getReadingOverviewText(value: string | null | undefined) {
    return decodeReadingHtmlEntities(stripReadingHtmlTags(String(value || ''))).replace(/\s+/g, ' ').trim();
}

function getMetadataProviderSummaryLabels(homeData: PtvReadingHomeData) {
    const { providerCounts } = homeData.stats.metadata;

    return [
        providerCounts.googlebooks ? `${providerCounts.googlebooks} Google Books` : '',
        providerCounts.openlibrary ? `${providerCounts.openlibrary} OpenLibrary` : '',
        providerCounts.comicvine ? `${providerCounts.comicvine} Comic Vine` : ''
    ].filter(Boolean);
}

function getReadingImageErrorHandler() {
    return (event: React.SyntheticEvent<HTMLImageElement>) => {
        const failedUrl = event.currentTarget.currentSrc || event.currentTarget.src;
        const failedItemId = event.currentTarget.dataset.ptvReadingItemId;
        const alternateUrl = event.currentTarget.dataset.ptvReadingAlternateUrl || '';
        const route = event.currentTarget.dataset.ptvReadingRoute
            || (typeof document !== 'undefined' ? document.body?.dataset.ptvReadingRoute : '')
            || 'unknown';
        const imageFailures = getReadingImageFailureState(route);

        if (failedUrl && failedUrl !== getPtvReadingImagePlaceholder()) {
            imageFailures.failedUrls.add(failedUrl);
        }

        if (
            alternateUrl
            && alternateUrl !== failedUrl
            && alternateUrl !== getPtvReadingImagePlaceholder()
            && event.currentTarget.dataset.ptvAlternateApplied !== 'true'
            && !imageFailures.failedUrls.has(alternateUrl)
        ) {
            event.currentTarget.dataset.ptvAlternateApplied = 'true';
            imageFailures.alternateImageUsedCount += 1;
            recordPtvEvent('image', 'reading-alternate-image-used', {
                alternateImageUsed: true,
                failedUrl,
                itemId: failedItemId || null,
                nextUrl: alternateUrl,
                route
            });
            event.currentTarget.src = alternateUrl;
            return;
        }

        if (failedItemId) imageFailures.failedCoverItemIds.add(failedItemId);

        if (event.currentTarget.dataset.ptvFallbackApplied === 'true') {
            event.currentTarget.hidden = true;
            return;
        }

        event.currentTarget.dataset.ptvFallbackApplied = 'true';
        imageFailures.fallbackPosterRenderedCount += 1;
        imageFailures.missingPrimaryImageCount += 1;
        recordPtvEvent('image', 'reading-fallback-poster-rendered', {
            fallbackPosterRendered: true,
            failedUrl,
            itemId: failedItemId || null,
            missingPrimaryImage: true,
            route
        });
        applyReadingImageFallbackToItem(failedItemId, getPtvReadingImagePlaceholder(), route);
        event.currentTarget.src = getPtvReadingImagePlaceholder();
    };
}

function getReadingBackdropErrorHandler() {
    return (event: React.SyntheticEvent<HTMLImageElement>) => {
        const failedUrl = event.currentTarget.currentSrc || event.currentTarget.src;
        const failedItemId = event.currentTarget.dataset.ptvReadingItemId;
        const route = event.currentTarget.dataset.ptvReadingRoute
            || (typeof document !== 'undefined' ? document.body?.dataset.ptvReadingRoute : '')
            || 'unknown';
        const imageFailures = getReadingImageFailureState(route);

        if (failedUrl && failedUrl !== PTV_READING_FALLBACK_BACKGROUND_URL) {
            imageFailures.failedUrls.add(failedUrl);
        }

        if (failedItemId) imageFailures.failedBackdropItemIds.add(failedItemId);

        applyReadingImageFallbackToItem(failedItemId, PTV_READING_FALLBACK_BACKGROUND_URL || getPtvReadingImagePlaceholder(), route);

        if (event.currentTarget.dataset.ptvFallbackApplied === 'true') {
            event.currentTarget.hidden = true;
            return;
        }

        event.currentTarget.dataset.ptvFallbackApplied = 'true';
        recordPtvEvent('image', 'reading-backdrop-fallback-rendered', {
            failedUrl,
            itemId: failedItemId || null,
            missingBackdropImage: true,
            route
        });
        event.currentTarget.src = PTV_READING_FALLBACK_BACKGROUND_URL || getPtvReadingImagePlaceholder();
    };
}

function getReadingProfileImageSize(size: number, minimum = 220) {
    if (typeof document === 'undefined') return size;

    const root = document.documentElement;
    const isLowPower = root.classList.contains('ptv-client-low-power')
        || root.classList.contains('ptv-client-firetv');

    return isLowPower ? Math.max(minimum, Math.round(size * 0.68)) : size;
}

function getCachedReadingImageUrl(
    item: PtvReadingItem | null | undefined,
    size = 360,
    preferredImageType: 'Backdrop' | 'Primary' | 'Thumb' = 'Primary'
) {
    const imageFailures = getReadingImageFailureState();

    if (item?.Id && imageFailures.failedCoverItemIds.has(item.Id)) return getPtvReadingImagePlaceholder();

    const imageUrl = getPtvReadingImageUrl(item, getReadingProfileImageSize(size), preferredImageType);

    if (!imageUrl) {
        imageFailures.missingPrimaryImageCount += 1;
        return getPtvReadingImagePlaceholder();
    }

    if (imageFailures.failedUrls.has(imageUrl)) {
        recordReadingCachedFailureHit(imageUrl, item?.Id);
        return getPtvReadingImagePlaceholder();
    }

    return imageUrl;
}

function getReadingAlternateImageUrl(
    item: PtvReadingItem | null | undefined,
    size = 360,
    preferredImageType: 'Primary' | 'Thumb' = 'Thumb'
) {
    const imageFailures = getReadingImageFailureState();
    const imageUrl = getPtvReadingImageUrl(item, getReadingProfileImageSize(size), preferredImageType);

    if (!imageUrl || imageFailures.failedUrls.has(imageUrl)) return '';

    return imageUrl;
}

function getCachedReadingBackdropUrl(item: PtvReadingItem | null | undefined, size = 1200) {
    const imageFailures = getReadingImageFailureState();

    if (item?.Id && imageFailures.failedBackdropItemIds.has(item.Id)) {
        return PTV_READING_FALLBACK_BACKGROUND_URL || getPtvReadingImagePlaceholder();
    }

    const imageUrl = getPtvReadingImageUrl(item, getReadingProfileImageSize(size, 640), 'Backdrop');

    if (!imageUrl || imageFailures.failedUrls.has(imageUrl)) {
        return PTV_READING_FALLBACK_BACKGROUND_URL || getPtvReadingImagePlaceholder();
    }

    return imageUrl;
}

function readPtvItem(item: PtvReadingItem) {
    recordPtvEvent('render', 'reading-item-opened', {
        itemId: item.Id || null,
        kind: getPtvReadingItemKind(item)
    });

    return playbackManager.play({
        items: [item],
        serverId: item.ServerId,
        startPositionTicks: item.UserData?.PlaybackPositionTicks || 0
    }).catch((error: unknown) => {
        recordPtvEvent('render', 'reading-item-open-failed', {
            error: error instanceof Error ? error.message : String(error),
            itemId: item.Id || null
        });
        window.location.hash = getDetailsHref(item).replace(/^#/, '');
    });
}

function ReadingPageBackdrop({ item, route }: Readonly<{
    item: PtvReadingItem | null;
    route: PtvReadingRouteKind;
}>) {
    const imageUrl = item ? getCachedReadingBackdropUrl(item, 1400) : PTV_READING_FALLBACK_BACKGROUND_URL;

    return (
        <div className={`ptv-books-page-backdrop ptv-books-page-backdrop-${route}`} aria-hidden='true'>
            <img
                alt=''
                data-ptv-reading-item-id={item?.Id || undefined}
                decoding='async'
                loading='eager'
                src={imageUrl || PTV_READING_FALLBACK_BACKGROUND_URL || getPtvReadingImagePlaceholder()}
                onError={getReadingBackdropErrorHandler()}
            />
        </div>
    );
}

function ReadingChips({ homeData, routeKind }: Readonly<{
    homeData: PtvReadingHomeData;
    routeKind: PtvReadingRouteKind;
}>) {
    const routeBase = getRouteBase(routeKind);
    const genres = Array.from(new Set(getAllReadingItems(homeData).reduce<string[]>((items, item) => items.concat(getPtvReadingGenres(item)), [])));
    let routeChip = 'Books';

    if (routeKind === 'comics') routeChip = 'Comics';
    if (routeKind === 'manga') routeChip = 'Manga';

    const chips = [
        'Favorites',
        'Continue Reading',
        'Recently Added',
        'Full Library',
        routeChip,
        ...genres
    ].filter((chip, index, values) => values.indexOf(chip) === index).slice(0, 14);

    if (!chips.length) return null;

    return (
        <div className='ptv-books-chip-row' aria-label='Reading filters'>
            {chips.map(chip => (
                <a key={chip} href={chip === 'Full Library' ? getLibraryHref(routeKind) : `#/${routeBase}/explore?search=${encodeURIComponent(chip)}`}>
                    {chip}
                </a>
            ))}
        </div>
    );
}

function ReadingBadges({ item }: Readonly<{ item: PtvReadingItem }>) {
    const badges = [
        getKindLabel(item),
        getReadableFormatLabel(item),
        getProgressLabel(item),
        ...getMetadataProviderLabels(item)
    ].filter(Boolean).slice(0, 5);

    if (!badges.length) return null;

    return (
        <div className='ptv-books-badges' aria-label='Reading metadata'>
            {badges.map(label => (
                <span key={label}>{label}</span>
            ))}
        </div>
    );
}

function ReadingMetadataProviderLinks({ item, compact = false }: Readonly<{
    compact?: boolean;
    item: PtvReadingItem;
}>) {
    const providers = getPtvReadingMetadataProviders(item);

    if (!providers.length) return null;

    return (
        <div className={`ptv-books-provider-links${compact ? ' ptv-books-provider-links-compact' : ''}`} aria-label='Metadata sources'>
            {providers.map(provider => (
                <a
                    key={provider.id}
                    className={`ptv-books-provider-link ptv-books-provider-${provider.id}`}
                    href={provider.url}
                    rel='noreferrer'
                    target='_blank'
                    title={`${provider.label}: ${provider.value}`}
                >
                    <PtvIcon name='metadata' />
                    <span>{provider.label}</span>
                </a>
            ))}
        </div>
    );
}

function useReadingAdminControls() {
    return useContext(READING_ADMIN_CONTEXT);
}

function ReadingAdminActions({ item, compact = false }: Readonly<{
    compact?: boolean;
    item: PtvReadingItem;
}>) {
    const { isAdmin, onAction } = useReadingAdminControls();
    const title = getPtvReadingTitle(item);
    const actions: Array<{
        action: ReadingAdminAction;
        icon: string;
        label: string;
    }> = [
        {
            action: 'identify',
            icon: 'search',
            label: 'Identify'
        },
        {
            action: 'metadata',
            icon: 'metadata',
            label: 'Edit Metadata'
        },
        {
            action: 'images',
            icon: 'image',
            label: 'Images'
        }
    ];

    if (!isAdmin || !item.Id) return null;

    return (
        <div className={`ptv-books-admin-actions${compact ? ' ptv-books-admin-actions-compact' : ''}`} aria-label={`${title} admin actions`}>
            {actions.map(entry => (
                <button
                    key={entry.action}
                    type='button'
                    title={entry.label}
                    onClick={() => onAction(item, entry.action)}
                    aria-label={`${entry.label} ${title}`}
                >
                    <PtvIcon name={entry.icon} />
                    {compact ? null : <span>{entry.label}</span>}
                </button>
            ))}
        </div>
    );
}

function ReadingCard({ item, routeKind }: Readonly<{
    item: PtvReadingItem;
    routeKind: PtvReadingRouteKind;
}>) {
    const { isAdmin, onAction } = useReadingAdminControls();
    const [isFavorite, setFavorite] = useState(Boolean(item.UserData?.IsFavorite));
    const title = getPtvReadingTitle(item);
    const href = getItemHref(item, routeKind);
    const meta = getItemMeta(item);
    const detailsHref = getDetailsHref(item);
    const libraryHref = getLibraryHref(routeKind);

    useEffect(() => {
        setFavorite(Boolean(item.UserData?.IsFavorite));
    }, [item.UserData?.IsFavorite]);

    const toggleFavorite = () => {
        if (!item.Id) return;

        const nextValue = !isFavorite;

        setFavorite(nextValue);
        void setPtvFavorite(item.Id, nextValue, {
            serverId: item.ServerId
        }).catch(() => {
            setFavorite(!nextValue);
        });
    };

    return (
        <article className={`ptv-books-card ptv-books-card-${getPtvReadingItemKind(item)}`}>
            <button
                type='button'
                className='ptv-books-card-cover'
                data-ptv-focus-key={`reading-card:${item.Id || title}`}
                onClick={() => void readPtvItem(item)}
                aria-label={`Read ${title}`}
            >
                <img
                    alt=''
                    data-ptv-reading-alternate-url={getReadingAlternateImageUrl(item, 320, 'Thumb') || undefined}
                    data-ptv-reading-item-id={item.Id || undefined}
                    decoding='async'
                    loading='lazy'
                    src={getCachedReadingImageUrl(item, 320)}
                    onError={getReadingImageErrorHandler()}
                />
                <ReadingBadges item={item} />
                <span><PtvIcon name='play' /></span>
            </button>
            <div className='ptv-books-card-text'>
                <a href={href}>{title}</a>
                <p>{meta}</p>
                <ReadingMetadataProviderLinks item={item} compact />
            </div>
            <div className='ptv-books-card-actions'>
                <button type='button' onClick={() => void readPtvItem(item)} aria-label={`Read ${title}`}>
                    <PtvIcon name='play' />
                </button>
                <button
                    type='button'
                    className={isFavorite ? 'ptv-books-favorited' : ''}
                    onClick={toggleFavorite}
                    aria-label={`${isFavorite ? 'Unfavorite' : 'Favorite'} ${title}`}
                >
                    <PtvIcon name='favorite' />
                </button>
                <details className='ptv-books-card-overflow'>
                    <summary aria-label={`More actions for ${title}`} title={`More actions for ${title}`}>
                        <PtvIcon name='more' />
                    </summary>
                    <div className='ptv-books-card-overflow-menu'>
                        <a href={href}>
                            <PtvIcon name='books' />
                            <span>Open</span>
                        </a>
                        <a href={detailsHref}>
                            <PtvIcon name='metadata' />
                            <span>Details</span>
                        </a>
                        <a href={libraryHref}>
                            <PtvIcon name='library' />
                            <span>Open library</span>
                        </a>
                        {isAdmin && item.Id ? (
                            <>
                                <button type='button' onClick={() => onAction(item, 'identify')}>
                                    <PtvIcon name='search' />
                                    <span>Identify</span>
                                </button>
                                <button type='button' onClick={() => onAction(item, 'metadata')}>
                                    <PtvIcon name='metadata' />
                                    <span>Edit metadata</span>
                                </button>
                                <button type='button' onClick={() => onAction(item, 'images')}>
                                    <PtvIcon name='image' />
                                    <span>Images</span>
                                </button>
                            </>
                        ) : null}
                    </div>
                </details>
            </div>
        </article>
    );
}

function ReadingRowSkeleton({ subtitle, title }: Readonly<{
    subtitle?: string;
    title: string;
}>) {
    return (
        <section className='ptv-books-section ptv-books-section-loading' aria-busy='true'>
            <div className='ptv-books-section-heading'>
                <div>
                    {subtitle ? <p className='ptv-books-kicker'>{subtitle}</p> : null}
                    <h2>{title}</h2>
                </div>
            </div>
            <div className='ptv-books-row ptv-books-row-skeleton' aria-hidden='true'>
                {PTV_READING_SKELETON_KEYS.slice(0, 6).map(key => (
                    <i key={`${title}-${key}`} />
                ))}
            </div>
        </section>
    );
}

function ReadingRow({ eager = false, error, isLoading = false, items, onRetry, routeKind, sectionId, subtitle, title, viewAllHref, viewAllLabel }: Readonly<{
    eager?: boolean;
    error?: string;
    isLoading?: boolean;
    items: PtvReadingItem[];
    onRetry?: (sectionId: string) => void;
    routeKind: PtvReadingRouteKind;
    sectionId?: string;
    subtitle?: string;
    title: string;
    viewAllHref?: string;
    viewAllLabel?: string;
}>) {
    const sectionRef = useRef<HTMLElement | null>(null);
    const setSectionRef = useCallback((node: HTMLElement | null) => {
        sectionRef.current = node;
    }, []);
    const [isHydrated, setHydrated] = useState(eager);
    const rowRef = useRef<HTMLDivElement>(null);
    const rowItems = uniquePtvReadingItems(items).slice(0, 24);

    useEffect(() => {
        if (isHydrated && rowItems.length) notifyPtvTvFocusContentReady(`reading-row:${sectionId || title}`);
    }, [isHydrated, rowItems.length, sectionId, title]);

    useEffect(() => {
        if (eager || isHydrated) return undefined;

        const section = sectionRef.current;

        if (!section || typeof IntersectionObserver !== 'function') {
            setHydrated(true);
            return undefined;
        }

        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) {
                setHydrated(true);
                observer.disconnect();
            }
        }, {
            rootMargin: '520px 0px'
        });

        observer.observe(section);

        return () => observer.disconnect();
    }, [eager, isHydrated]);

    if (isLoading) return <ReadingRowSkeleton subtitle={subtitle} title={title} />;

    if (error) {
        return (
            <section ref={setSectionRef} className='ptv-books-section ptv-books-section-error'>
                <div className='ptv-books-section-heading'>
                    <div>
                        {subtitle ? <p className='ptv-books-kicker'>{subtitle}</p> : null}
                        <h2>{title}</h2>
                    </div>
                    {sectionId && onRetry ? (
                        <button type='button' onClick={() => onRetry(sectionId)}>
                            <PtvIcon name='refresh' />
                            <span>Retry</span>
                        </button>
                    ) : null}
                </div>
                <p>{error}</p>
            </section>
        );
    }

    if (!rowItems.length) return null;
    if (!isHydrated) return <div ref={setSectionRef}><ReadingRowSkeleton subtitle={subtitle} title={title} /></div>;

    const scrollRow = (direction: 1 | -1) => {
        rowRef.current?.scrollBy({
            behavior: 'smooth',
            left: direction * Math.max(340, rowRef.current.clientWidth * 0.78)
        });
    };

    return (
        <section ref={setSectionRef} className='ptv-books-section'>
            <div className='ptv-books-section-heading'>
                <div>
                    {subtitle ? <p className='ptv-books-kicker'>{subtitle}</p> : null}
                    <h2>{title}</h2>
                </div>
                <div className='ptv-books-row-controls'>
                    {viewAllHref ? (
                        <a className='ptv-books-view-all-link' href={viewAllHref}>
                            <PtvIcon name='library' />
                            <span>{viewAllLabel || 'View All'}</span>
                        </a>
                    ) : null}
                    <button type='button' aria-label={`Scroll ${title} left`} onClick={() => scrollRow(-1)}>
                        <PtvIcon name='skipPrevious' />
                    </button>
                    <button type='button' aria-label={`Scroll ${title} right`} onClick={() => scrollRow(1)}>
                        <PtvIcon name='skipNext' />
                    </button>
                </div>
            </div>
            <div ref={rowRef} className='ptv-books-row'>
                {rowItems.map(item => (
                    <ReadingCard
                        key={item.Id || `${title}-${getPtvReadingTitle(item)}`}
                        item={item}
                        routeKind={routeKind}
                    />
                ))}
            </div>
        </section>
    );
}

function ReadingGrid({ items, routeKind }: Readonly<{
    items: PtvReadingItem[];
    routeKind: PtvReadingRouteKind;
}>) {
    const allGridItems = useMemo(() => uniquePtvReadingItems(items), [items]);
    const [visibleLimit, setVisibleLimit] = useState(PTV_READING_GRID_RENDER_LIMIT);
    const gridItems = allGridItems.slice(0, visibleLimit);

    useEffect(() => {
        setVisibleLimit(PTV_READING_GRID_RENDER_LIMIT);
    }, [allGridItems, routeKind]);

    if (!gridItems.length) {
        return (
            <section className='ptv-books-empty'>
                <PtvIcon name='books' />
                <h2>No items found</h2>
                <p>Jellyfin did not return readable items for this view.</p>
            </section>
        );
    }

    return (
        <>
            <div className='ptv-books-grid'>
                {gridItems.map(item => (
                    <ReadingCard
                        key={item.Id || `grid-${getPtvReadingTitle(item)}`}
                        item={item}
                        routeKind={routeKind}
                    />
                ))}
            </div>
            {gridItems.length < allGridItems.length ? (
                <div className='ptv-books-load-more'>
                    <button
                        type='button'
                        onClick={() => setVisibleLimit(limit => limit + PTV_READING_GRID_RENDER_LIMIT)}
                    >
                        <PtvIcon name='more' />
                        <span>Load More</span>
                    </button>
                    <span>{gridItems.length} of {allGridItems.length}</span>
                </div>
            ) : null}
        </>
    );
}

function ReadingSeriesCard({ onSeriesOverrideChange, routeKind, series }: Readonly<{
    onSeriesOverrideChange?: (updates: ReadingSeriesOverrideUpdate[]) => void;
    routeKind: PtvReadingRouteKind;
    series: PtvReadingSeries;
}>) {
    const { isAdmin } = useReadingAdminControls();
    const href = getSeriesHref(series, routeKind);
    const progress = Math.round(series.progressPercent);
    const manageSeries = () => {
        const override = getReadingSeriesGroupPromptOverride(series);

        if (!override) return;

        onSeriesOverrideChange?.(series.items.map(item => ({
            item,
            override
        })));
    };

    return (
        <article className='ptv-books-card ptv-books-series-card'>
            <a
                className='ptv-books-card-cover'
                data-ptv-focus-key={`reading-series:${series.id || series.title}`}
                href={href}
                aria-label={`Open ${series.title}`}
            >
                <img
                    alt=''
                    data-ptv-reading-alternate-url={getReadingAlternateImageUrl(series.coverItem, 320, 'Thumb') || undefined}
                    data-ptv-reading-item-id={series.coverItem.Id || undefined}
                    decoding='async'
                    loading='lazy'
                    src={getCachedReadingImageUrl(series.coverItem, 320)}
                    onError={getReadingImageErrorHandler()}
                />
                <div className='ptv-books-badges' aria-label='Series metadata'>
                    <span>{series.itemCount} items</span>
                    {series.inProgressCount ? <span>{series.inProgressCount} in progress</span> : null}
                </div>
                <span><PtvIcon name='library' /></span>
            </a>
            <div className='ptv-books-card-text'>
                <a href={href}>{series.title}</a>
                <p>{[
                    series.year ? String(series.year) : '',
                    `${series.readCount} read`,
                    progress ? `${progress}% complete` : ''
                ].filter(Boolean).join(' - ')}</p>
            </div>
            <div className='ptv-books-card-actions'>
                <a href={href} aria-label={`Open ${series.title}`}>
                    <PtvIcon name='library' />
                </a>
                <button type='button' onClick={() => void readPtvItem(series.nextItem)} aria-label={`Read next ${series.title}`}>
                    <PtvIcon name='play' />
                </button>
                {isAdmin && onSeriesOverrideChange ? (
                    <button type='button' onClick={manageSeries} aria-label={`Manage series ${series.title}`}>
                        <PtvIcon name='metadata' />
                    </button>
                ) : null}
            </div>
        </article>
    );
}

function ReadingSeriesGrid({ onSeriesOverrideChange, routeKind, series }: Readonly<{
    onSeriesOverrideChange?: (updates: ReadingSeriesOverrideUpdate[]) => void;
    routeKind: PtvReadingRouteKind;
    series: PtvReadingSeries[];
}>) {
    const [visibleLimit, setVisibleLimit] = useState(PTV_READING_GRID_RENDER_LIMIT);
    const visibleSeries = series.slice(0, visibleLimit);

    useEffect(() => {
        setVisibleLimit(PTV_READING_GRID_RENDER_LIMIT);
    }, [routeKind, series]);

    if (!visibleSeries.length) {
        return (
            <section className='ptv-books-empty'>
                <PtvIcon name='collections' />
                <h2>No series found</h2>
                <p>Jellyfin did not return grouped reading items for this view.</p>
            </section>
        );
    }

    return (
        <>
            <div className='ptv-books-grid ptv-books-series-grid'>
                {visibleSeries.map(entry => (
                    <ReadingSeriesCard
                        key={entry.id}
                        onSeriesOverrideChange={onSeriesOverrideChange}
                        routeKind={routeKind}
                        series={entry}
                    />
                ))}
            </div>
            {visibleSeries.length < series.length ? (
                <div className='ptv-books-load-more'>
                    <button
                        type='button'
                        onClick={() => setVisibleLimit(limit => limit + PTV_READING_GRID_RENDER_LIMIT)}
                    >
                        <PtvIcon name='more' />
                        <span>Load More</span>
                    </button>
                    <span>{visibleSeries.length} of {series.length}</span>
                </div>
            ) : null}
        </>
    );
}

function ReadingHero({ homeData, routeKind }: Readonly<{
    homeData: PtvReadingHomeData;
    routeKind: PtvReadingRouteKind;
}>) {
    const heroItem = getHeroItems(homeData, routeKind)[0] || null;
    const routeTitle = getRouteTitle(routeKind);

    if (!heroItem) {
        return (
            <section className='ptv-books-home-hero ptv-books-home-hero-empty'>
                <div className='ptv-books-home-hero-copy'>
                    <p className='ptv-books-kicker'>{getRouteKicker(routeKind)}</p>
                    <h2>{routeTitle}</h2>
                    <p>{homeData.isPartial ? 'Loading latest reading shelves.' : 'Readable Jellyfin items will appear here after a books library is available.'}</p>
                    {homeData.isPartial ? null : (
                        <a href='#/home' onClick={navigateToPtvHome}>
                            <PtvIcon name='home' />
                            <span>Back to Home</span>
                        </a>
                    )}
                </div>
            </section>
        );
    }

    return (
        <section className='ptv-books-home-hero'>
            <div className='ptv-books-home-hero-backdrop' aria-hidden='true'>
                <img
                    alt=''
                    data-ptv-reading-alternate-url={getReadingAlternateImageUrl(heroItem, 480, 'Thumb') || undefined}
                    data-ptv-reading-item-id={heroItem.Id || undefined}
                    decoding='async'
                    loading='eager'
                    src={getCachedReadingBackdropUrl(heroItem, 1000)}
                    onError={getReadingBackdropErrorHandler()}
                />
            </div>
            <div className='ptv-books-home-hero-cover'>
                <img
                    alt=''
                    data-ptv-reading-item-id={heroItem.Id || undefined}
                    decoding='async'
                    loading='eager'
                    src={getCachedReadingImageUrl(heroItem, 380)}
                    onError={getReadingImageErrorHandler()}
                />
            </div>
            <div className='ptv-books-home-hero-copy'>
                <p className='ptv-books-kicker'>{getRouteKicker(routeKind)}</p>
                <h2>{getPtvReadingTitle(heroItem)}</h2>
                <p>{getItemMeta(heroItem)}</p>
                <div className='ptv-books-hero-badges'>
                    <span>{getKindLabel(heroItem)}</span>
                    <span>{getReadableFormatLabel(heroItem)}</span>
                    {getProgressLabel(heroItem) ? <span>{getProgressLabel(heroItem)}</span> : null}
                    {getMetadataProviderLabels(heroItem).map(label => (
                        <span key={label}>{label}</span>
                    ))}
                </div>
                <ReadingMetadataProviderLinks item={heroItem} />
                <div className='ptv-books-hero-actions'>
                    <button type='button' onClick={() => void readPtvItem(heroItem)}>
                        <PtvIcon name='play' />
                        <span>{getProgressLabel(heroItem) ? 'Resume' : 'Read'}</span>
                    </button>
                    <a href={getItemHref(heroItem, routeKind)}>
                        <PtvIcon name='books' />
                        <span>Open</span>
                    </a>
                    <a href={getLibraryHref(routeKind)}>
                        <PtvIcon name='library' />
                        <span>Library</span>
                    </a>
                    <a href={getDetailsHref(heroItem)}>
                        <PtvIcon name='metadata' />
                        <span>Details</span>
                    </a>
                </div>
            </div>
        </section>
    );
}

function ReadingHomeView({ homeData, onRetrySection, routeKind }: Readonly<{
    homeData: PtvReadingHomeData;
    onRetrySection: (sectionId: string) => void;
    routeKind: PtvReadingRouteKind;
}>) {
    const rows = homeData.sections;

    return (
        <div className='ptv-books-view ptv-books-home-view'>
            <ReadingHero homeData={homeData} routeKind={routeKind} />
            <ReadingChips homeData={homeData} routeKind={routeKind} />
            <ReadingLibraryDebugPanel cacheDiagnostics={homeData.cacheDiagnostics} debug={homeData.libraryDebug} />
            {rows.map((section, index) => (
                <ReadingRow
                    key={section.id}
                    eager={index < 2}
                    error={section.error}
                    isLoading={section.isLoading}
                    items={section.items}
                    onRetry={onRetrySection}
                    routeKind={routeKind}
                    sectionId={section.id}
                    subtitle={section.subtitle || section.kind}
                    title={section.title}
                    viewAllHref={section.id === 'library' ? getLibraryHref(routeKind) : undefined}
                    viewAllLabel={section.id === 'library' ? `View all ${getRouteTitle(routeKind)}` : undefined}
                />
            ))}
        </div>
    );
}

function ReadingExploreView({ homeData, routeKind, search, searchResults }: Readonly<{
    homeData: PtvReadingHomeData;
    routeKind: PtvReadingRouteKind;
    search: string;
    searchResults: PtvReadingItem[];
}>) {
    const genreSections = homeData.sections.filter(section => section.id.startsWith('genre-'));

    return (
        <div className='ptv-books-view'>
            <ReadingChips homeData={homeData} routeKind={routeKind} />
            {search ? (
                <ReadingRow
                    eager
                    items={searchResults}
                    routeKind={routeKind}
                    subtitle='Search'
                    title={`Results for "${search}"`}
                />
            ) : null}
            <ReadingRow
                eager
                items={getSectionItems(homeData, 'favorites')}
                routeKind={routeKind}
                subtitle='Saved reads'
                title='Favorites'
            />
            {genreSections.map((section, index) => (
                <ReadingRow
                    key={section.id}
                    eager={index < 1}
                    items={section.items}
                    routeKind={routeKind}
                    subtitle={section.subtitle}
                    title={section.title}
                />
            ))}
            {!search ? (
                <ReadingGrid
                    items={getAllReadingItems(homeData).slice(0, 48)}
                    routeKind={routeKind}
                />
            ) : null}
        </div>
    );
}

function ReadingLibraryDebugPanel({ cacheDiagnostics, debug, seriesDiagnostics }: Readonly<{
    cacheDiagnostics?: PtvReadingHomeData['cacheDiagnostics'];
    debug?: PtvReadingLibraryDebug;
    seriesDiagnostics?: ReadingSeriesOverrideDiagnostics;
}>) {
    const { debugEnabled, isAdmin } = useReadingAdminControls();

    if (!canShowReadingDiagnostics(isAdmin, debugEnabled)) return null;
    if (!debug) return null;

    const imageFailures = getReadingImageFailureState();
    const diagnosticSections = buildReadingDiagnosticSections({
        cacheDiagnostics,
        debug,
        runtime: {
            alternateImageUsed: imageFailures.alternateImageUsedCount,
            cachedFailureHit: imageFailures.cachedFailureHitCount,
            failedCoverUrls: Array.from(imageFailures.failedUrls).slice(-8),
            fallbackPosterRendered: imageFailures.fallbackPosterRenderedCount,
            missingPrimaryImage: imageFailures.missingPrimaryImageCount
        },
        seriesDiagnostics
    });

    return (
        <details className='ptv-books-library-debug'>
            <summary>Reading diagnostics</summary>
            <div className='ptv-books-library-debug-sections'>
                {diagnosticSections.map(section => (
                    <section key={section.id}>
                        <h3>{section.title}</h3>
                        <dl>
                            {section.rows.map(diagnosticRow => (
                                <React.Fragment key={`${section.id}-${diagnosticRow.label}`}>
                                    <dt>{diagnosticRow.label}</dt>
                                    <dd>{diagnosticRow.value}</dd>
                                </React.Fragment>
                            ))}
                        </dl>
                    </section>
                ))}
            </div>
        </details>
    );
}

function ReadingBrowseTools({ filter, formatFilter, itemCount, query, routeKind, seriesCount = 0, setFilter, setFormatFilter, setQuery, setSort, setViewMode, showSeriesToggle = false, sort, totalCount, viewMode = 'items' }: Readonly<{
    filter: ReadingBrowseFilter;
    formatFilter: ReadingBrowseFormatFilter;
    itemCount: number;
    query: string;
    routeKind: PtvReadingRouteKind;
    seriesCount?: number;
    setFilter: (value: ReadingBrowseFilter) => void;
    setFormatFilter: (value: ReadingBrowseFormatFilter) => void;
    setQuery: (value: string) => void;
    setSort: (value: ReadingBrowseSort) => void;
    setViewMode?: (value: ReadingBrowseViewMode) => void;
    showSeriesToggle?: boolean;
    sort: ReadingBrowseSort;
    totalCount: number;
    viewMode?: ReadingBrowseViewMode;
}>) {
    const routeTitle = getRouteTitle(routeKind).toLocaleLowerCase();

    return (
        <section className='ptv-books-browse-tools' aria-label={`${getRouteTitle(routeKind)} browse tools`}>
            <label className='ptv-books-browse-search'>
                <PtvIcon name='search' />
                <input
                    aria-label={`Search ${routeTitle}`}
                    placeholder={`Search ${routeTitle}`}
                    type='search'
                    value={query}
                    onChange={event => setQuery(event.currentTarget.value)}
                />
            </label>
            <label>
                <span>Status</span>
                <select
                    aria-label='Filter reading status'
                    value={filter}
                    onChange={event => setFilter(event.currentTarget.value as ReadingBrowseFilter)}
                >
                    <option value='all'>All</option>
                    <option value='favorites'>Favorites</option>
                    <option value='in-progress'>In progress</option>
                    <option value='unread'>Unread</option>
                    <option value='read'>Read</option>
                </select>
            </label>
            <label>
                <span>Format</span>
                <select
                    aria-label='Filter reading format'
                    value={formatFilter}
                    onChange={event => setFormatFilter(event.currentTarget.value as ReadingBrowseFormatFilter)}
                >
                    <option value='all'>All formats</option>
                    <option value='book'>Books</option>
                    <option value='comic'>Comics</option>
                    <option value='epub'>EPUB</option>
                    <option value='pdf'>PDF</option>
                </select>
            </label>
            <label>
                <span>Sort</span>
                <select
                    aria-label='Sort reading library'
                    value={sort}
                    onChange={event => setSort(event.currentTarget.value as ReadingBrowseSort)}
                >
                    <option value='recent'>Recently added</option>
                    <option value='title'>Title</option>
                    <option value='author'>Author</option>
                    <option value='series'>Series</option>
                    <option value='year'>Year</option>
                    <option value='format'>Format</option>
                </select>
            </label>
            {showSeriesToggle && setViewMode ? (
                <div className='ptv-books-view-mode-toggle' role='group' aria-label='Reading browse view'>
                    <button
                        type='button'
                        className={viewMode === 'series' ? 'is-active' : ''}
                        onClick={() => setViewMode('series')}
                    >
                        Series
                    </button>
                    <button
                        type='button'
                        className={viewMode === 'items' ? 'is-active' : ''}
                        onClick={() => setViewMode('items')}
                    >
                        Individual Items
                    </button>
                </div>
            ) : null}
            <p>{viewMode === 'series' ? `${seriesCount} series` : `${itemCount} of ${totalCount} shown`}</p>
        </section>
    );
}

function ReadingLibraryView({ homeData, onSeriesOverrideChange, routeKind, seriesOverrides }: Readonly<{
    homeData: PtvReadingHomeData;
    onSeriesOverrideChange: (updates: ReadingSeriesOverrideUpdate[]) => void;
    routeKind: PtvReadingRouteKind;
    seriesOverrides: Record<string, PtvReadingSeriesOverride>;
}>) {
    const [browseFilter, setBrowseFilter] = useState<ReadingBrowseFilter>('all');
    const [browseFormatFilter, setBrowseFormatFilter] = useState<ReadingBrowseFormatFilter>('all');
    const [browseQuery, setBrowseQuery] = useState('');
    const [browseSort, setBrowseSort] = useState<ReadingBrowseSort>('recent');
    const showSeriesToggle = routeKind === 'comics' || routeKind === 'manga';
    const [browseViewMode, setBrowseViewMode] = useState<ReadingBrowseViewMode>(() => getStoredReadingBrowseViewMode(routeKind));
    const libraryItems = getSectionItems(homeData, 'library');
    const librarySection = getSection(homeData, 'library');
    const metadataProviderSummaryLabels = getMetadataProviderSummaryLabels(homeData);
    const updateBrowseViewMode = useCallback((nextMode: ReadingBrowseViewMode) => {
        setBrowseViewMode(nextMode);
        storeReadingBrowseViewMode(routeKind, nextMode);
    }, [routeKind]);
    const sourceItems = useMemo(() => (
        libraryItems.length ? libraryItems : getAllReadingItems(homeData)
    ), [homeData, libraryItems]);
    const browseItems = useMemo(() => getReadingBrowseItems(
        sourceItems,
        browseQuery,
        browseFilter,
        browseFormatFilter,
        browseSort
    ), [browseFilter, browseFormatFilter, browseQuery, browseSort, sourceItems]);
    const groupingReady = homeData.libraryDebug?.indexIsComplete ?? !homeData.isPartial;
    const groupedSeries = useMemo(() => {
        if (!groupingReady) return [];

        const startedAt = performance.now();
        const result = buildReadingSeriesForRoute(browseItems, routeKind, seriesOverrides);

        recordPtvEvent('render', 'reading-series-grouping-completed', {
            durationMs: Number((performance.now() - startedAt).toFixed(1)),
            final: true,
            itemCount: browseItems.length,
            routeKind,
            seriesCount: result.length
        });

        return result;
    }, [browseItems, groupingReady, routeKind, seriesOverrides]);
    const seriesDiagnostics = useMemo(() => getReadingSeriesDiagnostics(groupedSeries, seriesOverrides), [groupedSeries, seriesOverrides]);

    useEffect(() => {
        setBrowseViewMode(getStoredReadingBrowseViewMode(routeKind));
    }, [routeKind]);

    useEffect(() => {
        if (!showSeriesToggle) return;

        recordPtvEvent('render', 'reading-series-grouping-ready', {
            accumulatedItemCount: homeData.libraryDebug?.indexAccumulatedCount || browseItems.length,
            final: homeData.libraryDebug?.indexIsComplete ?? !homeData.isPartial,
            groupingDeferred: !groupingReady,
            itemCount: browseItems.length,
            page: homeData.libraryDebug?.pageCount || 0,
            routeKind,
            seriesCount: groupedSeries.length,
            stage: homeData.libraryDebug?.indexStage || (homeData.isPartial ? 'initial' : 'complete'),
            viewMode: browseViewMode
        });
    }, [
        browseItems.length,
        browseViewMode,
        groupedSeries.length,
        homeData.isPartial,
        homeData.libraryDebug?.indexAccumulatedCount,
        homeData.libraryDebug?.indexIsComplete,
        homeData.libraryDebug?.indexStage,
        homeData.libraryDebug?.pageCount,
        routeKind,
        showSeriesToggle
    ]);

    let libraryContent: React.ReactNode = null;

    if (!homeData.isPartial || libraryItems.length) {
        libraryContent = showSeriesToggle && browseViewMode === 'series' ? (
            <ReadingSeriesGrid
                onSeriesOverrideChange={onSeriesOverrideChange}
                routeKind={routeKind}
                series={groupedSeries}
            />
        ) : (
            <ReadingGrid items={browseItems} routeKind={routeKind} />
        );
    }

    return (
        <div className='ptv-books-view'>
            <section className='ptv-books-library-hero'>
                <p className='ptv-books-kicker'>Your collection</p>
                <h1>{getRouteTitle(routeKind)}</h1>
                <div>
                    <span>{homeData.stats.itemCount} items</span>
                    <span>{homeData.stats.resumedCount} in progress</span>
                    <span>{homeData.stats.favoriteCount} favorites</span>
                    <span>{homeData.stats.libraryCount} libraries</span>
                    {homeData.libraryDebug && !homeData.libraryDebug.indexIsComplete ? (
                        <span>
                            Indexing {homeData.libraryDebug.indexAccumulatedCount} of {homeData.libraryDebug.totalRecordCountFromApi}
                        </span>
                    ) : null}
                    {homeData.stats.metadata.itemCount ? <span>{homeData.stats.metadata.itemCount} enriched</span> : null}
                    {metadataProviderSummaryLabels.map(label => (
                        <span key={label}>{label}</span>
                    ))}
                </div>
            </section>
            <ReadingLibraryDebugPanel
                cacheDiagnostics={homeData.cacheDiagnostics}
                debug={homeData.libraryDebug}
                seriesDiagnostics={seriesDiagnostics}
            />
            {homeData.isPartial && !libraryItems.length && !librarySection?.error ? (
                <ReadingLoading label='Loading library shelf' />
            ) : null}
            {librarySection?.error ? (
                <ReadingError message={librarySection.error} />
            ) : null}
            {sourceItems.length ? (
                <ReadingBrowseTools
                    filter={browseFilter}
                    formatFilter={browseFormatFilter}
                    itemCount={browseItems.length}
                    query={browseQuery}
                    routeKind={routeKind}
                    seriesCount={groupedSeries.length}
                    setFilter={setBrowseFilter}
                    setFormatFilter={setBrowseFormatFilter}
                    setQuery={setBrowseQuery}
                    setSort={setBrowseSort}
                    setViewMode={updateBrowseViewMode}
                    showSeriesToggle={showSeriesToggle}
                    sort={browseSort}
                    totalCount={sourceItems.length}
                    viewMode={browseViewMode}
                />
            ) : null}
            {libraryContent}
        </div>
    );
}

function ReadingSeriesManagementPanel({ onSeriesOverrideChange, onSeriesOverrideRemove, series, seriesOverrides }: Readonly<{
    onSeriesOverrideChange: (updates: ReadingSeriesOverrideUpdate[]) => void;
    onSeriesOverrideRemove: (items: PtvReadingItem[]) => void;
    series: PtvReadingSeries;
    seriesOverrides: Record<string, PtvReadingSeriesOverride>;
}>) {
    const { isAdmin } = useReadingAdminControls();

    if (!isAdmin) return null;

    const editItem = (item: PtvReadingItem) => {
        const itemKey = getPtvReadingSeriesItemOverrideKey(item);
        const override = getReadingSeriesPromptOverride(item, series, seriesOverrides[itemKey]);

        if (!override) return;

        onSeriesOverrideChange([{
            item,
            override
        }]);
    };
    const removeFromSeries = (item: PtvReadingItem) => {
        onSeriesOverrideChange([{
            item,
            override: {
                excluded: true,
                seriesTitle: getPtvReadingTitle(item)
            }
        }]);
    };
    const setSeriesCover = (item: PtvReadingItem) => {
        const itemKey = getPtvReadingSeriesItemOverrideKey(item);

        if (!itemKey) return;

        onSeriesOverrideChange(series.items.map(seriesItem => ({
            item: seriesItem,
            override: {
                ...(seriesOverrides[getPtvReadingSeriesItemOverrideKey(seriesItem)] || {}),
                coverItemId: itemKey,
                excluded: false,
                seriesTitle: series.title,
                seriesYear: series.year
            }
        })));
    };

    return (
        <section className='ptv-books-series-management' aria-label={`${series.title} series management`}>
            <div>
                <p className='ptv-books-kicker'>Series tools</p>
                <h2>Correct grouping</h2>
                <p>Manual corrections override provider and filename grouping for this browser.</p>
            </div>
            <div className='ptv-books-series-management-list'>
                {series.items.map(item => {
                    const itemKey = getPtvReadingSeriesItemOverrideKey(item);
                    const override = seriesOverrides[itemKey];
                    const info = getPtvReadingSeriesInfo(item);

                    return (
                        <article key={itemKey || getPtvReadingTitle(item)} className='ptv-books-series-management-item'>
                            <div>
                                <strong>{getPtvReadingTitle(item)}</strong>
                                <span>
                                    {override ? 'Manual override' : info.confidence}
                                    {info.issueNumber == null ? '' : ` - issue ${info.issueNumber}`}
                                    {override?.excluded ? ' - removed from series' : ''}
                                </span>
                            </div>
                            <div>
                                <button type='button' onClick={() => editItem(item)}>
                                    <PtvIcon name='metadata' />
                                    <span>Move</span>
                                </button>
                                <button type='button' onClick={() => removeFromSeries(item)}>
                                    <PtvIcon name='delete' />
                                    <span>Remove</span>
                                </button>
                                <button type='button' onClick={() => setSeriesCover(item)}>
                                    <PtvIcon name='image' />
                                    <span>Cover</span>
                                </button>
                                <button type='button' disabled={!override} onClick={() => onSeriesOverrideRemove([item])}>
                                    <PtvIcon name='refresh' />
                                    <span>Reset</span>
                                </button>
                            </div>
                        </article>
                    );
                })}
            </div>
        </section>
    );
}

function ReadingSeriesDetailView({ homeData, onSeriesOverrideChange, onSeriesOverrideRemove, routeKind, seriesId, seriesOverrides }: Readonly<{
    homeData: PtvReadingHomeData;
    onSeriesOverrideChange: (updates: ReadingSeriesOverrideUpdate[]) => void;
    onSeriesOverrideRemove: (items: PtvReadingItem[]) => void;
    routeKind: PtvReadingRouteKind;
    seriesId: string;
    seriesOverrides: Record<string, PtvReadingSeriesOverride>;
}>) {
    const allItems = useMemo(() => getAllReadingItems(homeData), [homeData]);
    const groupingReady = homeData.libraryDebug?.indexIsComplete ?? !homeData.isPartial;
    const groupedSeries = useMemo(() => {
        if (!groupingReady) return [];

        const startedAt = performance.now();
        const result = buildReadingSeriesForRoute(allItems, routeKind, seriesOverrides);

        recordPtvEvent('render', 'reading-series-grouping-completed', {
            durationMs: Number((performance.now() - startedAt).toFixed(1)),
            final: true,
            itemCount: allItems.length,
            routeKind,
            seriesCount: result.length
        });

        return result;
    }, [allItems, groupingReady, routeKind, seriesOverrides]);
    const series = findPtvReadingSeriesById(groupedSeries, seriesId);
    const progress = Math.round(series?.progressPercent || 0);

    if (!series) {
        if (homeData.isPartial) {
            return <ReadingLoading label='Loading series' />;
        }

        return (
            <div className='ptv-books-view'>
                <section className='ptv-books-empty'>
                    <PtvIcon name='collections' />
                    <h2>Series not found</h2>
                    <p>This virtual reading series is no longer available in the current library snapshot.</p>
                    <a href={getLibraryHref(routeKind)}>Back to {getRouteTitle(routeKind)}</a>
                </section>
            </div>
        );
    }

    return (
        <div className='ptv-books-view'>
            <section className='ptv-books-library-hero ptv-books-series-hero'>
                <div className='ptv-books-series-hero-cover'>
                    <img
                        alt=''
                        data-ptv-reading-alternate-url={getReadingAlternateImageUrl(series.coverItem, 320, 'Thumb') || undefined}
                        data-ptv-reading-item-id={series.coverItem.Id || undefined}
                        decoding='async'
                        loading='eager'
                        src={getCachedReadingImageUrl(series.coverItem, 380)}
                        onError={getReadingImageErrorHandler()}
                    />
                </div>
                <div>
                    <p className='ptv-books-kicker'>Series</p>
                    <h1>{series.title}</h1>
                    <div>
                        <span>{series.itemCount} items</span>
                        <span>{series.readCount} read</span>
                        {series.inProgressCount ? <span>{series.inProgressCount} in progress</span> : null}
                        {progress ? <span>{progress}% complete</span> : null}
                        {series.year ? <span>{series.year}</span> : null}
                    </div>
                    <div className='ptv-books-hero-actions'>
                        <button type='button' onClick={() => void readPtvItem(series.nextItem)}>
                            <PtvIcon name='play' />
                            <span>{series.inProgressCount ? 'Resume' : 'Read Next'}</span>
                        </button>
                        <a href={getLibraryHref(routeKind)}>
                            <PtvIcon name='library' />
                            <span>Back to Library</span>
                        </a>
                    </div>
                </div>
            </section>
            <ReadingSeriesManagementPanel
                onSeriesOverrideChange={onSeriesOverrideChange}
                onSeriesOverrideRemove={onSeriesOverrideRemove}
                series={series}
                seriesOverrides={seriesOverrides}
            />
            <ReadingGrid items={series.items} routeKind={routeKind} />
        </div>
    );
}

function getReadingCollectionItems(homeData: PtvReadingHomeData) {
    return uniquePtvReadingItems(getAllReadingItems(homeData).filter(item => (
        item.Type === 'BoxSet'
    )));
}

function ReadingCollectionsView({ homeData, routeKind }: Readonly<{
    homeData: PtvReadingHomeData;
    routeKind: PtvReadingRouteKind;
}>) {
    const collectionItems = getReadingCollectionItems(homeData);

    return (
        <div className='ptv-books-view'>
            <section className='ptv-books-library-hero'>
                <p className='ptv-books-kicker'>Browse</p>
                <h1>Collections</h1>
                <div>
                    <span>{collectionItems.length} collections</span>
                    <span>{getRouteTitle(routeKind)}</span>
                </div>
            </section>
            {homeData.isPartial && !collectionItems.length ? (
                <ReadingLoading label='Loading collections' />
            ) : null}
            {!homeData.isPartial && !collectionItems.length ? (
                <section className='ptv-books-empty'>
                    <PtvIcon name='collections' />
                    <h2>No collections found</h2>
                    <p>Jellyfin did not return collection or series items for this reading library.</p>
                </section>
            ) : null}
            {collectionItems.length ? (
                <ReadingGrid items={collectionItems} routeKind={routeKind} />
            ) : null}
        </div>
    );
}

function ItemDetailView({ detail, routeKind }: Readonly<{
    detail: ItemDetailState;
    routeKind: PtvReadingRouteKind;
}>) {
    const item = detail.item;

    if (detail.isLoading) return <ReadingLoading label='Loading item' />;
    if (detail.error) return <ReadingError message={detail.error} />;
    if (!item) return <ReadingError message='Item could not be loaded.' />;

    const title = getPtvReadingTitle(item);
    const genres = getPtvReadingGenres(item).slice(0, 5);
    const extension = getPtvReadingExtension(item);
    const overview = getReadingOverviewText(item.Overview);

    return (
        <div className='ptv-books-view ptv-books-detail-view'>
            <section className='ptv-books-detail-hero'>
                <img
                    alt=''
                    data-ptv-reading-alternate-url={getReadingAlternateImageUrl(item, 480, 'Thumb') || undefined}
                    data-ptv-reading-item-id={item.Id || undefined}
                    decoding='async'
                    loading='eager'
                    src={getCachedReadingImageUrl(item, 420)}
                    onError={getReadingImageErrorHandler()}
                />
                <div>
                    <p className='ptv-books-kicker'>{getKindLabel(item)}</p>
                    <h1>{title}</h1>
                    <p>{getItemMeta(item)}</p>
                    <div className='ptv-books-detail-badges'>
                        <span>{getReadableFormatLabel(item)}</span>
                        {extension ? <span>.{extension}</span> : null}
                        {getProgressLabel(item) ? <span>{getProgressLabel(item)}</span> : null}
                        {getMetadataProviderLabels(item).map(label => (
                            <span key={label}>{label}</span>
                        ))}
                    </div>
                    <ReadingMetadataProviderLinks item={item} />
                    <div className='ptv-books-detail-actions'>
                        <button type='button' onClick={() => void readPtvItem(item)}>
                            <PtvIcon name='play' />
                            <span>{getProgressLabel(item) ? 'Resume' : 'Read'}</span>
                        </button>
                        <a href={getDetailsHref(item)}>
                            <PtvIcon name='metadata' />
                            <span>Jellyfin Details</span>
                        </a>
                    </div>
                    <ReadingAdminActions item={item} />
                </div>
            </section>
            {overview ? (
                <section className='ptv-books-overview'>
                    <p>{overview}</p>
                </section>
            ) : null}
            {genres.length ? (
                <section className='ptv-books-tag-strip'>
                    {genres.map(genre => (
                        <a key={genre} href={`#/${getRouteBase(routeKind)}/explore?search=${encodeURIComponent(genre)}`}>
                            {genre}
                        </a>
                    ))}
                </section>
            ) : null}
        </div>
    );
}

function ReadingLoading({ label }: Readonly<{ label: string }>) {
    return (
        <section className='ptv-books-loading' aria-live='polite'>
            <span />
            <p>{label}</p>
            <div className='ptv-books-skeleton-grid' aria-hidden='true'>
                {PTV_READING_SKELETON_KEYS.map(key => (
                    <i key={key} />
                ))}
            </div>
        </section>
    );
}

function ReadingError({ message }: Readonly<{ message: string }>) {
    return (
        <section className='ptv-books-error'>
            <PtvIcon name='alerts' />
            <p>{message}</p>
        </section>
    );
}

function getInitialItemDetail(): ItemDetailState {
    return {
        error: '',
        isLoading: false,
        item: null
    };
}

function getReadingErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

export default function PiggieTvBooksPage() {
    const location = useLocation();
    const route = useMemo(() => getReadingRoute(location.pathname, location.search), [location.pathname, location.search]);
    const performanceProfile = useMemo(() => getPtvPerformanceProfile(), []);
    const readingLoadStartedAtRef = useRef(performance.now());
    const readingFirstShelfRecordedRef = useRef(false);
    const readingInitialRecordedRef = useRef(false);
    const readingFullyLoadedRecordedRef = useRef(false);
    const readingLibraryIndexRequestIdRef = useRef(0);
    const readingMountedRef = useRef(false);
    const readingPageRenderIdentityRef = useRef('');
    const readingRequestIdRef = useRef(0);
    const [homeData, setHomeData] = useState<PtvReadingHomeData>(EMPTY_HOME_DATA);
    const [searchResults, setSearchResults] = useState<PtvReadingItem[]>([]);
    const [itemDetail, setItemDetail] = useState<ItemDetailState>(getInitialItemDetail);
    const [seriesOverridesByKind, setSeriesOverridesByKind] = useState<ReadingSeriesOverridesByKind>(() => loadReadingSeriesOverridesForRoute(route.kind));
    const { canShowDebug, debugEnabled, isAdmin } = usePtvAdminDebugVisibility();
    const [isLoading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState('');
    const seriesOverrides = useMemo(() => getReadingSeriesOverridesForRoute(route.kind, seriesOverridesByKind), [route.kind, seriesOverridesByKind]);
    const heroItem = useMemo(() => (
        itemDetail.item || (homeData.kind === route.kind ? getHeroItems(homeData, route.kind)[0] : null) || null
    ), [homeData, itemDetail.item, route.kind]);

    const recordReadingLoadMetrics = useCallback((nextHomeData: PtvReadingHomeData, stage: string) => {
        const elapsedMs = Math.max(0, Math.round(performance.now() - readingLoadStartedAtRef.current));
        const firstReadySection = nextHomeData.sections.find(section => section.items.length > 0);
        const slowFetchesAborted = [
            ...(nextHomeData.libraryDebug?.libraryDiagnostics || []).filter(diagnostic => diagnostic.timeoutReason).map(diagnostic => diagnostic.name),
            ...(nextHomeData.sectionDiagnostics || []).filter(diagnostic => diagnostic.timeoutReason).map(diagnostic => diagnostic.title)
        ];
        const detail = {
            kind: nextHomeData.kind,
            readingCacheRenderMs: nextHomeData.cacheDiagnostics?.status === 'hit' || nextHomeData.cacheDiagnostics?.status === 'stale-hit' ?
                nextHomeData.cacheDiagnostics.refreshDurationMs || 0 :
                null,
            readingFirstShelfMs: firstReadySection ? elapsedMs : null,
            readingFullyLoadedMs: !nextHomeData.isPartial ? elapsedMs : null,
            readingInitialRenderMs: elapsedMs,
            readingLibraryDiscoveryMs: nextHomeData.libraryDebug?.requestDurationMs ?? null,
            readingSlowFetchesAborted: slowFetchesAborted,
            route: route.view,
            sectionCount: nextHomeData.sections.length,
            source: nextHomeData.cacheDiagnostics?.source || stage,
            stage
        };

        if (!readingInitialRecordedRef.current) {
            readingInitialRecordedRef.current = true;
            recordPtvEvent('render', 'reading-page-interactive', detail);
            recordPtvEvent('render', 'readingInitialRenderMs', detail);
        }

        if (firstReadySection && !readingFirstShelfRecordedRef.current) {
            readingFirstShelfRecordedRef.current = true;
            recordPtvEvent('render', 'readingFirstShelfMs', {
                ...detail,
                firstShelfId: firstReadySection.id,
                firstShelfItemCount: firstReadySection.items.length
            });
        }

        if (!nextHomeData.isPartial && !readingFullyLoadedRecordedRef.current) {
            readingFullyLoadedRecordedRef.current = true;
            recordPtvEvent('render', 'readingFullyLoadedMs', detail);
        }
    }, [route.view]);

    const loadReadingLibraryIndex = useCallback((
        kind: PtvReadingRouteKind,
        forceRefresh = false,
        ownerRequestId = readingRequestIdRef.current
    ) => {
        const libraryRequestId = ++readingLibraryIndexRequestIdRef.current;
        let lastPublishedIndex: PtvReadingLibraryIndex | null = null;
        const isCurrentIndexRequest = () => readingMountedRef.current
            && ownerRequestId === readingRequestIdRef.current
            && libraryRequestId === readingLibraryIndexRequestIdRef.current;
        const applyLibraryIndex = (libraryIndex: PtvReadingLibraryIndex, eventName: string) => {
            if (!isCurrentIndexRequest()) return;
            if (
                eventName === 'reading-library-index-background-progress'
                && !shouldPublishReadingIndexProgress(lastPublishedIndex, libraryIndex)
            ) return;

            setHomeData(previous => (
                previous.kind === kind ? mergePtvReadingLibraryIndex(previous, libraryIndex) : previous
            ));
            if (
                !lastPublishedIndex
                || libraryIndex.debug.indexAccumulatedCount >= lastPublishedIndex.debug.indexAccumulatedCount
            ) {
                lastPublishedIndex = libraryIndex;
            }
            recordPtvEvent('api', eventName, {
                accumulatedCount: libraryIndex.debug.indexAccumulatedCount,
                final: libraryIndex.debug.indexIsComplete,
                itemCount: libraryIndex.items.length,
                kind,
                pageCount: libraryIndex.debug.pageCount,
                stage: libraryIndex.debug.indexStage,
                totalRecordCount: libraryIndex.debug.totalRecordCountFromApi
            });
        };

        return fetchPtvReadingLibraryIndex(kind, {
            forceRefresh,
            isCurrent: isCurrentIndexRequest,
            onProgress: libraryIndex => applyLibraryIndex(libraryIndex, 'reading-library-index-background-progress')
        })
            .then(libraryIndex => {
                applyLibraryIndex(libraryIndex, 'reading-library-index-background-loaded');
            })
            .catch(error => {
                recordPtvEvent('api', 'reading-library-index-background-failed', {
                    error: getReadingErrorMessage(error),
                    kind
                });
            });
    }, []);

    const refreshReadingItemDetail = useCallback((itemId: string) => {
        setItemDetail(previous => ({
            ...previous,
            error: '',
            isLoading: true
        }));

        return fetchPtvReadingItem(itemId)
            .then(item => {
                setItemDetail({
                    error: '',
                    isLoading: false,
                    item
                });
            })
            .catch(error => {
                setItemDetail({
                    ...getInitialItemDetail(),
                    error: getReadingErrorMessage(error) || 'Item could not be loaded.',
                    isLoading: false
                });
            });
    }, []);

    const saveReadingSeriesOverrideUpdates = useCallback((updates: ReadingSeriesOverrideUpdate[]) => {
        if (!updates.length) return;

        const nextOverridesByKind: ReadingSeriesOverridesByKind = {
            ...seriesOverridesByKind
        };
        const touchedKinds = new Set<PtvReadingRouteKind>();
        const itemIds: string[] = [];

        updates.forEach(({ item, override }) => {
            const itemId = getPtvReadingSeriesItemOverrideKey(item);

            if (!itemId) return;

            const overrideKind = getReadingSeriesOverrideKind(route.kind, item);
            const existingOverrides = nextOverridesByKind[overrideKind] || loadPtvReadingSeriesOverrides(overrideKind);
            const nextOverrides = {
                ...existingOverrides,
                [itemId]: {
                    ...existingOverrides[itemId],
                    ...override,
                    itemId
                }
            };

            nextOverridesByKind[overrideKind] = nextOverrides;
            touchedKinds.add(overrideKind);
            itemIds.push(itemId);
        });

        setSeriesOverridesByKind(nextOverridesByKind);
        void Promise.all(Array.from(touchedKinds).map(kind => (
            savePtvReadingSeriesOverrides(kind, nextOverridesByKind[kind] || {})
        ))).then(results => {
            recordPtvEvent('render', 'reading-series-overrides-persisted', {
                persistedCount: results.filter(Boolean).length,
                routeKind: route.kind,
                touchedKinds: Array.from(touchedKinds)
            });
        }).catch(error => {
            recordPtvEvent('render', 'reading-series-overrides-persist-failed', {
                message: getReadingErrorMessage(error),
                routeKind: route.kind,
                touchedKinds: Array.from(touchedKinds)
            });
        });
        recordPtvEvent('render', 'reading-series-overrides-saved', {
            itemCount: itemIds.length,
            itemIds: itemIds.slice(0, 12),
            routeKind: route.kind,
            touchedKinds: Array.from(touchedKinds)
        });
    }, [route.kind, seriesOverridesByKind]);

    const resetReadingSeriesOverrides = useCallback((items: PtvReadingItem[]) => {
        if (!items.length) return;

        const nextOverridesByKind: ReadingSeriesOverridesByKind = {
            ...seriesOverridesByKind
        };
        const touchedKinds = new Set<PtvReadingRouteKind>();
        const itemIds: string[] = [];

        items.forEach(item => {
            const itemId = getPtvReadingSeriesItemOverrideKey(item);

            if (!itemId) return;

            const overrideKind = getReadingSeriesOverrideKind(route.kind, item);
            const existingOverrides = nextOverridesByKind[overrideKind] || loadPtvReadingSeriesOverrides(overrideKind);
            const nextOverrides = {
                ...existingOverrides
            };

            delete nextOverrides[itemId];
            nextOverridesByKind[overrideKind] = nextOverrides;
            touchedKinds.add(overrideKind);
            itemIds.push(itemId);
        });

        setSeriesOverridesByKind(nextOverridesByKind);
        void Promise.all(Array.from(touchedKinds).map(kind => (
            savePtvReadingSeriesOverrides(kind, nextOverridesByKind[kind] || {})
        ))).catch(error => {
            recordPtvEvent('render', 'reading-series-overrides-reset-persist-failed', {
                message: getReadingErrorMessage(error),
                routeKind: route.kind,
                touchedKinds: Array.from(touchedKinds)
            });
        });
        recordPtvEvent('render', 'reading-series-overrides-reset', {
            itemCount: itemIds.length,
            itemIds: itemIds.slice(0, 12),
            routeKind: route.kind,
            touchedKinds: Array.from(touchedKinds)
        });
    }, [route.kind, seriesOverridesByKind]);

    const loadReadingData = useCallback((forceRefresh = false) => {
        const requestId = ++readingRequestIdRef.current;
        const isCurrentRequest = () => readingMountedRef.current && requestId === readingRequestIdRef.current;

        readingLoadStartedAtRef.current = performance.now();
        readingFirstShelfRecordedRef.current = false;
        readingInitialRecordedRef.current = false;
        readingFullyLoadedRecordedRef.current = false;
        setLoading(true);
        setErrorMessage('');
        setHomeData(previous => previous.kind === route.kind ? previous : getEmptyReadingHomeData(route.kind));

        if (forceRefresh) {
            invalidatePtvReadingHomeCache();
        }

        const scheduleLibraryIndex = () => {
            if (route.view === 'home') return;

            window.setTimeout(() => {
                if (isCurrentRequest()) {
                    void loadReadingLibraryIndex(route.kind, forceRefresh, requestId);
                }
            }, route.view === 'library' ? 0 : PTV_READING_LIBRARY_INDEX_LOAD_DELAY_MS);
        };
        const loadFullReadingData = (bypassCacheForRefresh = false) => {
            const refreshStartedAt = performance.now();

            setHomeData(previous => previous.kind === route.kind ? {
                ...previous,
                cacheDiagnostics: previous.cacheDiagnostics ? {
                    ...previous.cacheDiagnostics,
                    backgroundRefreshCompleted: false,
                    backgroundRefreshDurationMs: null,
                    backgroundRefreshStarted: true,
                    freshCacheWritten: false,
                    freshRenderApplied: false,
                    refreshError: ''
                } : previous.cacheDiagnostics
            } : previous);

            void getPtvReadingHome(route.kind, { forceRefresh: forceRefresh || bypassCacheForRefresh, view: route.view })
                .then(nextHomeData => {
                    if (!isCurrentRequest()) return;

                    const durationMs = Number((performance.now() - refreshStartedAt).toFixed(1));
                    const refreshedHomeData = {
                        ...nextHomeData,
                        cacheDiagnostics: nextHomeData.cacheDiagnostics ? {
                            ...nextHomeData.cacheDiagnostics,
                            backgroundRefreshCompleted: true,
                            backgroundRefreshDurationMs: durationMs,
                            backgroundRefreshStarted: true,
                            cacheAgeMs: 0,
                            cacheFresh: true,
                            freshCacheWritten: true,
                            freshRenderApplied: true,
                            refreshError: ''
                        } : nextHomeData.cacheDiagnostics
                    };

                    recordReadingLoadMetrics(refreshedHomeData, 'background-home-refresh');
                    setHomeData(previous => mergeReadingHomeRefresh(previous, refreshedHomeData, 'background-home-refresh'));
                    recordPtvEvent('cache', 'reading-background-refresh-completed', {
                        bypassCacheForRefresh,
                        durationMs,
                        itemCount: getAllReadingItems(refreshedHomeData).length,
                        kind: route.kind,
                        readingBackgroundRefreshCompleted: true,
                        readingFreshCacheWritten: true,
                        readingFreshRenderApplied: true,
                        staleCacheRevalidated: bypassCacheForRefresh
                    });
                })
                .catch(error => {
                    const refreshErrorMessage = getReadingErrorMessage(error);

                    setHomeData(previous => previous.kind === route.kind ? {
                        ...previous,
                        cacheDiagnostics: previous.cacheDiagnostics ? {
                            ...previous.cacheDiagnostics,
                            backgroundRefreshCompleted: false,
                            backgroundRefreshDurationMs: Number((performance.now() - refreshStartedAt).toFixed(1)),
                            backgroundRefreshStarted: true,
                            refreshError: refreshErrorMessage
                        } : previous.cacheDiagnostics
                    } : previous);
                    recordPtvEvent('render', 'reading-page-error', {
                        error: refreshErrorMessage,
                        kind: route.kind,
                        readingBackgroundRefreshCompleted: false,
                        readingRefreshError: refreshErrorMessage,
                        stage: 'reading-shell-background-data'
                    });
                });
        };

        return getPtvReadingHome(route.kind, { forceRefresh, initialOnly: true, view: route.view })
            .then(nextHomeData => {
                if (!isCurrentRequest()) return;

                setHomeData(nextHomeData);
                setLoading(false);
                scheduleLibraryIndex();
                recordReadingLoadMetrics(nextHomeData, nextHomeData.cacheDiagnostics?.source || 'initial');

                if (route.view === 'library') {
                    void fetchPtvReadingHomeSection(route.kind, 'library')
                        .then(section => {
                            if (!isCurrentRequest()) return;

                            setHomeData(previous => {
                                if (previous.kind !== route.kind) return previous;

                                const sections = replaceReadingSection(previous.sections, section);

                                return {
                                    ...previous,
                                    sectionDiagnostics: getReadingSectionDiagnostics(sections),
                                    sections
                                };
                            });
                        })
                        .catch(error => {
                            recordPtvEvent('api', 'reading-library-preview-failed', {
                                error: getReadingErrorMessage(error),
                                kind: route.kind
                            });
                        });
                }

                if (nextHomeData.isPartial || nextHomeData.cacheDiagnostics?.staleHit) {
                    const bypassCacheForRefresh = Boolean(nextHomeData.cacheDiagnostics?.staleHit);

                    if (bypassCacheForRefresh) {
                        recordPtvEvent('cache', 'reading-stale-cache-refresh-scheduled', {
                            cacheAgeMs: Math.max(0, Date.now() - nextHomeData.generatedAt),
                            kind: route.kind,
                            readingBackgroundRefreshStarted: true,
                            readingCacheFresh: false,
                            staleCacheRevalidationScheduled: true
                        });
                    }

                    window.setTimeout(() => {
                        if (isCurrentRequest()) loadFullReadingData(bypassCacheForRefresh);
                    }, PTV_READING_FULL_HOME_LOAD_DELAY_MS);
                }
            })
            .catch(error => {
                if (!isCurrentRequest()) return;

                setErrorMessage(getReadingErrorMessage(error) || 'Reading library could not be loaded.');
                recordPtvEvent('render', 'reading-page-error', {
                    error: getReadingErrorMessage(error),
                    kind: route.kind,
                    stage: 'reading-shell-data'
                });
                setLoading(false);
            });
    }, [loadReadingLibraryIndex, recordReadingLoadMetrics, route.kind, route.view]);

    const retryReadingSection = useCallback((sectionId: string) => {
        setHomeData(previous => {
            if (previous.kind !== route.kind) return previous;

            const sections = replaceReadingSection(previous.sections, {
                diagnostics: {
                    id: sectionId,
                    itemCount: 0,
                    lastQueriedUrl: '',
                    requestDurationMs: null,
                    source: 'retry',
                    status: 'loading',
                    statusCode: null,
                    title: previous.sections.find(section => section.id === sectionId)?.title || sectionId,
                    updatedAt: Date.now()
                },
                id: sectionId,
                isLoading: true,
                items: [],
                subtitle: previous.sections.find(section => section.id === sectionId)?.subtitle,
                title: previous.sections.find(section => section.id === sectionId)?.title || sectionId
            });

            return {
                ...previous,
                sectionDiagnostics: getReadingSectionDiagnostics(sections),
                sections
            };
        });

        void fetchPtvReadingHomeSection(route.kind, sectionId)
            .then(section => {
                setHomeData(previous => {
                    if (previous.kind !== route.kind) return previous;

                    const sections = replaceReadingSection(previous.sections, section);
                    const sectionDiagnostics = getReadingSectionDiagnostics(sections);
                    const allItems = getAllReadingItems({
                        ...previous,
                        sections
                    });

                    return {
                        ...previous,
                        libraryDebug: previous.libraryDebug ? {
                            ...previous.libraryDebug,
                            fetchedItemCount: allItems.length,
                            jellyfinRouteItemTotal: allItems.length,
                            kindCounts: {
                                book: allItems.filter(item => getPtvReadingItemKind(item) === 'book').length,
                                comic: allItems.filter(item => getPtvReadingItemKind(item) === 'comic').length,
                                manga: allItems.filter(item => getPtvReadingItemKind(item) === 'manga').length
                            },
                            sectionDiagnostics
                        } : previous.libraryDebug,
                        sectionDiagnostics,
                        sections,
                        stats: {
                            ...previous.stats,
                            favoriteCount: sections.find(entry => entry.id === 'favorites')?.items.length || previous.stats.favoriteCount,
                            resumedCount: sections.find(entry => entry.id === 'continue-reading')?.items.length || previous.stats.resumedCount
                        }
                    };
                });
            })
            .catch(error => {
                recordPtvEvent('api', 'reading-section-retry-failed', {
                    error: getReadingErrorMessage(error),
                    kind: route.kind,
                    sectionId
                });
            });
    }, [route.kind]);

    const openAdminAction = useCallback((item: PtvReadingItem, action: ReadingAdminAction) => {
        if (!item.Id) return;

        const itemId = item.Id;

        recordPtvEvent('render', 'reading-admin-action-opened', {
            action,
            itemId,
            kind: getPtvReadingItemKind(item)
        });

        void openReadingAdminDialog(item, action)
            .then(updatedItem => {
                const refreshedItem = updatedItem as PtvReadingItem | undefined;

                clearReadingImageFailuresForItem(itemId);
                invalidatePtvReadingHomeCache();

                if (refreshedItem?.Id) {
                    clearReadingImageFailuresForItem(refreshedItem.Id);
                    setHomeData(previous => replaceReadingItemInHomeData(previous, refreshedItem));

                    if (route.view === 'item' && route.id === itemId) {
                        setItemDetail({
                            error: '',
                            isLoading: false,
                            item: refreshedItem
                        });
                    }
                }

                void loadReadingData(true);

                if ((action !== 'identify' || !refreshedItem?.Id) && route.view === 'item' && route.id === itemId) {
                    void refreshReadingItemDetail(itemId);
                }

                if (action === 'identify') {
                    window.setTimeout(() => {
                        clearReadingImageFailuresForItem(itemId);
                        invalidatePtvReadingHomeCache();
                        void loadReadingData(true);

                        if (route.view === 'item' && route.id === itemId) {
                            void refreshReadingItemDetail(itemId);
                        }
                    }, 3500);
                }
            })
            .catch(() => {
                recordPtvEvent('render', 'reading-admin-action-closed', {
                    action,
                    itemId
                });
            });
    }, [loadReadingData, refreshReadingItemDetail, route.id, route.view]);

    const adminControls = useMemo<ReadingAdminContextValue>(() => ({
        canShowDebug,
        debugEnabled,
        isAdmin,
        onAction: openAdminAction
    }), [canShowDebug, debugEnabled, isAdmin, openAdminAction]);

    useEffect(() => {
        setSeriesOverridesByKind(loadReadingSeriesOverridesForRoute(route.kind));
        let active = true;

        void loadReadingSeriesOverridesForRouteFromServer(route.kind).then(overrides => {
            if (active) setSeriesOverridesByKind(overrides);
        });

        return () => {
            active = false;
        };
    }, [route.kind]);

    useEffect(() => {
        readingMountedRef.current = true;
        document.documentElement.classList.add('ptv-route-reading-mounted');
        document.body.classList.add('ptv-route-reading-mounted');
        document.body.dataset.ptvReadingRoute = route.kind;
        document.documentElement.dataset.ptvReadingRouteMounted = 'true';
        document.body.dataset.ptvReadingRouteMounted = 'true';
        recordPtvRouteGenerationLifecycle('page-mount', {
            hash: window.location.hash,
            kind: route.kind,
            page: 'reading'
        });
        recordPtvEvent('render', 'reading-page-mounted', {
            hash: window.location.hash,
            kind: route.kind
        });
        window.setTimeout(() => {
            verifyReadingShell();
        }, 0);
        void loadReadingData();

        return () => {
            readingMountedRef.current = false;
            if (document.body.dataset.ptvReadingRoute === route.kind) {
                delete document.body.dataset.ptvReadingRoute;
            }
            readingRequestIdRef.current += 1;
            cleanupReadingRouteState();
            recordPtvRouteGenerationLifecycle('page-unmount', {
                hash: window.location.hash,
                page: 'reading'
            });
            recordPtvEvent('render', 'reading-page-unmounted', {
                hash: window.location.hash
            });
            window.setTimeout(() => {
                scheduleRouteCheck(true);
            }, 0);
        };
    }, [loadReadingData, route.kind]);

    useEffect(() => {
        if (!homeData.generatedAt) return;

        const renderIdentity = getReadingPageRenderIdentity(homeData, route.kind, route.view);

        if (readingPageRenderIdentityRef.current === renderIdentity) return;
        readingPageRenderIdentityRef.current = renderIdentity;

        recordPtvEvent('render', 'reading-page-rendered', {
            itemCount: homeData.stats.itemCount,
            kind: route.kind,
            route: route.view,
            sectionCount: homeData.sections.length
        });
        recordPtvRouteGenerationLifecycle('page-render', {
            itemCount: homeData.stats.itemCount,
            kind: route.kind,
            page: 'reading',
            route: route.view,
            sectionCount: homeData.sections.length
        });
    }, [homeData, route.kind, route.view]);

    useEffect(() => {
        let isMounted = true;

        setSearchResults([]);

        if (route.view !== 'explore' || !route.search) return undefined;

        void searchPtvReading(route.kind, route.search, 60)
            .then(results => {
                if (isMounted) {
                    setSearchResults(results);
                }
            })
            .catch(error => {
                recordPtvEvent('api', 'reading-search-failed', {
                    error: getReadingErrorMessage(error),
                    kind: route.kind,
                    query: route.search
                });

                if (isMounted) {
                    setSearchResults([]);
                }
            });

        return () => {
            isMounted = false;
        };
    }, [route.kind, route.search, route.view]);

    useEffect(() => {
        let isMounted = true;

        if (route.view !== 'item' || !route.id) {
            setItemDetail(getInitialItemDetail());
            return undefined;
        }

        setItemDetail({
            ...getInitialItemDetail(),
            isLoading: true
        });

        void fetchPtvReadingItem(route.id)
            .then(item => {
                if (isMounted) {
                    setItemDetail({
                        error: '',
                        isLoading: false,
                        item
                    });
                }
            })
            .catch(error => {
                if (isMounted) {
                    setItemDetail({
                        ...getInitialItemDetail(),
                        error: getReadingErrorMessage(error) || 'Item could not be loaded.',
                        isLoading: false
                    });
                }
            });

        return () => {
            isMounted = false;
        };
    }, [route.id, route.view]);

    const refresh = () => {
        void loadReadingData(true);
    };

    const renderView = () => {
        if (homeData.kind !== route.kind) return <ReadingLoading label={`Loading ${getRouteTitle(route.kind)}`} />;
        if (isLoading && !homeData.sections.length) return <ReadingLoading label={`Loading ${getRouteTitle(route.kind)}`} />;
        if (errorMessage && !homeData.sections.length) return <ReadingError message={errorMessage} />;

        switch (route.view) {
            case 'explore':
                return (
                    <ReadingExploreView
                        homeData={homeData}
                        routeKind={route.kind}
                        search={route.search}
                        searchResults={searchResults}
                    />
                );
            case 'library':
                return (
                    <ReadingLibraryView
                        homeData={homeData}
                        onSeriesOverrideChange={saveReadingSeriesOverrideUpdates}
                        routeKind={route.kind}
                        seriesOverrides={seriesOverrides}
                    />
                );
            case 'collections':
                return <ReadingCollectionsView homeData={homeData} routeKind={route.kind} />;
            case 'item':
                return <ItemDetailView detail={itemDetail} routeKind={route.kind} />;
            case 'series':
                return (
                    <ReadingSeriesDetailView
                        homeData={homeData}
                        onSeriesOverrideChange={saveReadingSeriesOverrideUpdates}
                        onSeriesOverrideRemove={resetReadingSeriesOverrides}
                        routeKind={route.kind}
                        seriesId={route.id}
                        seriesOverrides={seriesOverrides}
                    />
                );
            case 'home':
            default:
                return <ReadingHomeView homeData={homeData} onRetrySection={retryReadingSection} routeKind={route.kind} />;
        }
    };
    const showToolbarTitle = shouldShowReadingToolbarTitle(route.view);

    return (
        <Page
            id='ptvBooksPage'
            title={getRouteTitle(route.kind)}
            className='mainAnimatedPage type-interior ptv-books-page'
            isMenuButtonEnabled
        >
            <PTVShell
                backdropSource={`reading-${route.kind}`}
                backdropUrl={heroItem ? getCachedReadingBackdropUrl(heroItem, 1400) : ''}
                className='ptv-books-shell'
                contextualLinks={getReadingContextLinks(route)}
                section='reading'
                title='Reading'
            >
                <main
                    className={`ptv-books-app ptv-books-app-shell ptv-books-route-${route.view} ptv-books-kind-${route.kind}${performanceProfile.isLowPower ? ' ptv-books-low-power' : ''}`}
                    data-ptv-client-profile={performanceProfile.clientKind}
                    data-ptv-render-profile={performanceProfile.renderProfile.id}
                >
                    <ReadingPageBackdrop item={heroItem} route={route.kind} />
                    <div className='ptv-books-body'>
                        <section className='ptv-books-main' aria-label='PiggieTV Reading'>
                            <div className='ptv-books-main-scroll'>
                                {showToolbarTitle || isAdmin ? (
                                    <div className={`ptv-books-main-toolbar${showToolbarTitle ? '' : ' ptv-books-main-toolbar-compact'}`}>
                                        {showToolbarTitle ? (
                                            <div>
                                                <p className='ptv-books-kicker'>PiggieTV</p>
                                                <h1>{getReadingRoutePageTitle(route)}</h1>
                                                {homeData.libraries.length ? (
                                                    <span className='ptv-books-toolbar-sync'>
                                                        {homeData.libraries.map(library => library.name).slice(0, 3).join(' - ')}
                                                    </span>
                                                ) : null}
                                            </div>
                                        ) : <span aria-hidden='true' />}
                                        {isAdmin ? (
                                            <button type='button' onClick={refresh}>
                                                <PtvIcon name='refresh' />
                                                <span>Refresh</span>
                                            </button>
                                        ) : null}
                                    </div>
                                ) : null}
                                <READING_ADMIN_CONTEXT.Provider value={adminControls}>
                                    {renderView()}
                                </READING_ADMIN_CONTEXT.Provider>
                            </div>
                        </section>
                    </div>
                </main>
            </PTVShell>
        </Page>
    );
}

/* eslint-enable react/jsx-no-bind, no-void */
