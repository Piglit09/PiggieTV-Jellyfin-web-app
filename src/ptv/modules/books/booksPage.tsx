/* eslint-disable react/jsx-no-bind, no-void */
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from 'react';
import { useLocation } from 'react-router-dom';

import Page from 'components/Page';

import './books.scss';

import { setPtvFavorite } from '../../api';
import {
    clearPtvImageFailuresForItem,
    markPtvImageCandidateFailed
} from '../../api/images';
import { createPtvAbortController } from '../../core/abortController';
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
import {
    capturePtvRouteCriticalLifecycleOwner,
    type PtvRouteCriticalTerminalOutcome
} from '../../shell/routeCriticalLifecycle';
import { usePtvAdminDebugVisibility } from '../../utils/usePtvAdminDebugVisibility';
import { PtvIcon } from '../icons';
import { loadReaderProgress } from '../reader/readerProgressStore';
import { playPtvReaderItem } from '../reader/readerLoader';
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
    getPtvReadingArtworkResolution,
    getPtvReadingImagePlaceholder,
    getPtvReadingItemKind,
    getPtvReadingRouteKind,
    getPtvReadingSeries,
    getPtvReadingStableId,
    getPtvReadingTitle,
    invalidatePtvReadingHomeCache,
    invalidatePtvReadingMetadataCache,
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
    PtvReadingArtworkImage
} from './readingArtworkImage';
import type {
    PtvReadingArtworkLifecycleOutcome
} from './readingArtworkLifecycle';
import {
    createPtvReadingImageFailureRegistry,
    normalizePtvReadingImageRoute
} from './readingImageFailures';
import {
    createPtvReadingIdentifyReconciliationCoordinator
} from './readingIdentifyReconciliation';
import { ReadingCardMenu, ReadingCardMenuOwner } from './readingCardMenuLifecycle';
import { usePtvReadingGridVisibleLimit } from './readingGridLifecycle';
import {
    getPtvReadingAdminDialogClosePolicy,
    getPtvReadingMetadataUpdateAuthority,
    getPtvReadingMetadataUpdateDetail,
    isPtvReadingMetadataUpdateOwnedBy,
    PTV_READING_ITEM_METADATA_UPDATED_EVENT,
    replacePtvReadingItemInHomeData,
    replacePtvReadingItemInList
} from './readingMetadataUpdateLifecycle';
import { shouldPreservePtvReadingIndex } from './readingProgressiveIndex';
import {
    getPtvReadingRouteHomeGate,
    shouldStartPtvReadingLibraryIndexImmediately
} from './readingRoutePolicy';
import {
    getPtvReadingFailedReadCount,
    getPtvReadingHomeState
} from './readingHomeState';
import {
    createPtvReadingRouteCriticalLifecycle,
    getPtvReadingRouteCriticalIdentity,
    getPtvReadingRouteCriticalPlan
} from './readingRouteCriticalLifecycle';
import type {
    PtvReadingHomeData,
    PtvReadingItem,
    PtvReadingItemKind,
    PtvReadingLibraryDebug,
    PtvReadingLibraryIndex,
    PtvReadingRouteKind,
    PtvReadingSection
} from './booksTypes';

type ReadingView = 'collections' | 'explore' | 'home' | 'item' | 'library' | 'series';

let readingMetadataOwnerSequence = 0;

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

function clearReadingImageFailuresForItem(
    itemOrId: PtvReadingItem | null | string | undefined,
    route?: string | null
) {
    const item = typeof itemOrId === 'string' ? null : itemOrId;
    const itemId = typeof itemOrId === 'string' ? itemOrId : item?.Id;
    const relatedItemIds = new Set([
        itemId,
        item?.PrimaryImageItemId as string | undefined,
        item?.ParentPrimaryImageItemId as string | undefined,
        item?.AlbumPrimaryImageItemId as string | undefined,
        item?.ParentId,
        item?.AlbumId,
        item?.ParentBackdropItemId,
        item?.BackdropItemId as string | undefined,
        item?.ParentThumbItemId,
        item?.SeriesId
    ].filter((id): id is string => Boolean(id)));
    const routeKey = getReadingImageRoute(route);

    relatedItemIds.forEach(relatedItemId => {
        readingImageFailures.clearForItem(routeKey, relatedItemId);
        clearPtvImageFailuresForItem(relatedItemId);
    });
}

function logReadingPageEvent(name: string, detail: Record<string, unknown> = {}) {
    recordPtvEvent('render', name, detail);
}

function openReadingAdminDialog(
    item: PtvReadingItem,
    action: ReadingAdminAction,
    readingOwnerGeneration: number
) {
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
        .then(itemIdentifier => itemIdentifier.show(itemId, serverId, {
            readingOwnerGeneration
        }));
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

function getReadingKindCount(items: PtvReadingItem[], kind: PtvReadingItemKind) {
    return items.filter(item => getPtvReadingItemKind(item) === kind).length;
}

function getReadingSectionItemCount(
    sections: PtvReadingSection[],
    sectionId: string,
    fallback: number
) {
    return sections.find(section => section.id === sectionId)?.items.length || fallback;
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

function getReadingProfileImageSize(size: number, minimum = 220) {
    if (typeof document === 'undefined') return size;

    const root = document.documentElement;
    const isLowPower = root.classList.contains('ptv-client-low-power')
        || root.classList.contains('ptv-client-firetv');

    return isLowPower ? Math.max(minimum, Math.round(size * 0.68)) : size;
}

function ReadingArtwork({
    item,
    loading = 'lazy',
    routeKind,
    size = 360
}: Readonly<{
    item: PtvReadingItem;
    loading?: 'eager' | 'lazy';
    routeKind: PtvReadingRouteKind;
    size?: number;
}>) {
    const placeholderSrc = getPtvReadingImagePlaceholder();
    const profileSize = getReadingProfileImageSize(size);
    const artwork = useMemo(
        () => getPtvReadingArtworkResolution(item, profileSize, 'cover'),
        [ item, profileSize ]
    );
    const sources = artwork.candidates.map(candidate => ({
        kind: candidate.kind,
        src: candidate.src
    }));
    const stableId = getPtvReadingStableId(item);
    const identity = `${routeKind}:cover:${stableId}`;
    const retryEpoch = readingImageFailures.getRetryEpoch(routeKind, item.Id || stableId);
    const recordArtworkOutcome = useCallback((outcome: PtvReadingArtworkLifecycleOutcome) => {
        if (outcome.status === 'loaded' && outcome.source === 'primary') return;

        const imageFailures = getReadingImageFailureState(routeKind);

        if (outcome.status === 'failed' && outcome.source !== 'placeholder') {
            const failedCandidate = artwork.candidates.find(candidate => candidate.src === outcome.src);

            if (failedCandidate) {
                markPtvImageCandidateFailed({
                    imageItemId: failedCandidate.imageItemId,
                    imageType: failedCandidate.imageType,
                    requestedType: failedCandidate.requestedType,
                    tag: failedCandidate.tag,
                    tagMode: 'reading-cover',
                    url: failedCandidate.src
                });
            }
        }
        if (
            outcome.status === 'failed'
            && outcome.nextSource
            && outcome.nextSource !== 'placeholder'
        ) {
            imageFailures.alternateImageUsedCount += 1;
        }
        if (outcome.status === 'failed' && outcome.nextSource === 'placeholder') {
            imageFailures.fallbackPosterRenderedCount += 1;
            imageFailures.missingPrimaryImageCount += 1;
        }

        recordPtvEvent('image', 'reading-artwork-generation-settled', {
            nextSource: outcome.nextSource,
            route: routeKind,
            source: outcome.source,
            status: outcome.status,
            terminal: outcome.terminal
        });
    }, [ artwork.candidates, routeKind ]);

    return (
        <PtvReadingArtworkImage
            alt=''
            data-ptv-reading-artwork='cover'
            data-ptv-reading-route={routeKind}
            decoding='async'
            generation={JSON.stringify([ artwork.generation, retryEpoch ])}
            identity={identity}
            loading={loading}
            placeholderSrc={placeholderSrc}
            sources={sources}
            onCurrentGenerationFailure={recordArtworkOutcome}
            onCurrentGenerationSuccess={recordArtworkOutcome}
        />
    );
}

function ReadingBackdropArtwork({
    item,
    loading = 'lazy',
    route,
    size = 1200
}: Readonly<{
    item: PtvReadingItem | null;
    loading?: 'eager' | 'lazy';
    route: PtvReadingRouteKind;
    size?: number;
}>) {
    const placeholderSrc = PTV_READING_FALLBACK_BACKGROUND_URL || getPtvReadingImagePlaceholder();
    const profileSize = getReadingProfileImageSize(size, 640);
    const artwork = useMemo(
        () => getPtvReadingArtworkResolution(item, profileSize, 'backdrop'),
        [ item, profileSize ]
    );
    const sources = artwork.candidates.map(candidate => ({
        kind: candidate.kind,
        src: candidate.src
    }));
    const stableId = getPtvReadingStableId(item);
    const identity = `${route}:backdrop:${stableId}`;
    const retryEpoch = readingImageFailures.getRetryEpoch(route, item?.Id || stableId);
    const recordArtworkOutcome = useCallback((outcome: PtvReadingArtworkLifecycleOutcome) => {
        if (outcome.status === 'loaded' && outcome.source === 'backdrop') return;

        const imageFailures = getReadingImageFailureState(route);

        if (outcome.status === 'failed' && outcome.source !== 'placeholder') {
            const failedCandidate = artwork.candidates.find(candidate => candidate.src === outcome.src);

            imageFailures.failedUrls.add(outcome.src);
            if (failedCandidate) {
                markPtvImageCandidateFailed({
                    imageItemId: failedCandidate.imageItemId,
                    imageType: failedCandidate.imageType,
                    requestedType: failedCandidate.requestedType,
                    tag: failedCandidate.tag,
                    tagMode: 'reading-backdrop',
                    url: failedCandidate.src
                });
            }
        }
        if (outcome.status === 'failed' && outcome.nextSource === 'placeholder') {
            imageFailures.fallbackPosterRenderedCount += 1;
        }

        recordPtvEvent('image', 'reading-backdrop-generation-settled', {
            nextSource: outcome.nextSource,
            route,
            source: outcome.source,
            status: outcome.status,
            terminal: outcome.terminal
        });
    }, [ artwork.candidates, route ]);

    return (
        <PtvReadingArtworkImage
            alt=''
            data-ptv-reading-artwork='backdrop'
            data-ptv-reading-item-id={item?.Id || undefined}
            data-ptv-reading-route={route}
            decoding='async'
            generation={JSON.stringify([ artwork.generation, retryEpoch ])}
            identity={identity}
            loading={loading}
            placeholderSrc={placeholderSrc}
            sources={sources}
            onCurrentGenerationFailure={recordArtworkOutcome}
            onCurrentGenerationSuccess={recordArtworkOutcome}
        />
    );
}

function readPtvItem(item: PtvReadingItem) {
    recordPtvEvent('render', 'reading-item-opened', {
        itemId: item.Id || null,
        kind: getPtvReadingItemKind(item)
    });

    return playPtvReaderItem({
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
    return (
        <div className={`ptv-books-page-backdrop ptv-books-page-backdrop-${route}`} aria-hidden='true'>
            <ReadingBackdropArtwork
                item={item}
                loading='eager'
                route={route}
                size={1400}
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
                <ReadingArtwork item={item} routeKind={routeKind} size={320} />
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
                <ReadingCardMenu
                    label={`More actions for ${title}`}
                    trigger={<PtvIcon name='more' />}
                >
                    <a href={href} role='menuitem'>
                        <PtvIcon name='books' />
                        <span>Open</span>
                    </a>
                    <a href={detailsHref} role='menuitem'>
                        <PtvIcon name='metadata' />
                        <span>Details</span>
                    </a>
                    <a href={libraryHref} role='menuitem'>
                        <PtvIcon name='library' />
                        <span>Open library</span>
                    </a>
                    {isAdmin && item.Id ? (
                        <>
                            <button type='button' role='menuitem' onClick={() => onAction(item, 'identify')}>
                                <PtvIcon name='search' />
                                <span>Identify</span>
                            </button>
                            <button type='button' role='menuitem' onClick={() => onAction(item, 'metadata')}>
                                <PtvIcon name='metadata' />
                                <span>Edit metadata</span>
                            </button>
                            <button type='button' role='menuitem' onClick={() => onAction(item, 'images')}>
                                <PtvIcon name='image' />
                                <span>Images</span>
                            </button>
                        </>
                    ) : null}
                </ReadingCardMenu>
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
    const [visibleLimit, setVisibleLimit] = usePtvReadingGridVisibleLimit(
        allGridItems,
        routeKind,
        PTV_READING_GRID_RENDER_LIMIT
    );
    const gridItems = allGridItems.slice(0, visibleLimit);

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
                <ReadingArtwork item={series.coverItem} routeKind={routeKind} size={320} />
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

function ReadingHero({ homeData, pageState, routeKind }: Readonly<{
    homeData: PtvReadingHomeData;
    pageState: ReturnType<typeof getPtvReadingHomeState>;
    routeKind: PtvReadingRouteKind;
}>) {
    const heroItem = getHeroItems(homeData, routeKind)[0] || null;
    const routeTitle = getRouteTitle(routeKind);

    if (!heroItem) {
        const statusMessage = {
            'authoritative-empty': 'Readable Jellyfin items will appear here after a books library is available.',
            failed: 'Reading shelves are unavailable because the authoritative reads failed.',
            loading: 'Loading latest reading shelves.',
            partial: 'Some Reading data could not be loaded.',
            populated: ''
        }[pageState];

        return (
            <section className='ptv-books-home-hero ptv-books-home-hero-empty'>
                <div className='ptv-books-home-hero-copy'>
                    <p className='ptv-books-kicker'>{getRouteKicker(routeKind)}</p>
                    <h2>{routeTitle}</h2>
                    <p>{statusMessage}</p>
                    {pageState === 'loading' ? null : (
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
                <ReadingBackdropArtwork
                    item={heroItem}
                    loading='eager'
                    route={routeKind}
                    size={1000}
                />
            </div>
            <div className='ptv-books-home-hero-cover'>
                <ReadingArtwork item={heroItem} loading='eager' routeKind={routeKind} size={380} />
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
    const pageState = getPtvReadingHomeState(homeData);

    return (
        <div className='ptv-books-view ptv-books-home-view' data-ptv-reading-state={pageState}>
            <ReadingHero homeData={homeData} pageState={pageState} routeKind={routeKind} />
            <ReadingChips homeData={homeData} routeKind={routeKind} />
            <ReadingLibraryDebugPanel cacheDiagnostics={homeData.cacheDiagnostics} debug={homeData.libraryDebug} />
            {pageState === 'failed' ? (
                <section className='ptv-books-error' role='alert'>
                    <PtvIcon name='alerts' />
                    <h2>Reading Content Could Not Be Loaded</h2>
                    <p>Jellyfin did not return an authoritative Reading result. Retry the failed sections below.</p>
                </section>
            ) : null}
            {pageState === 'authoritative-empty' ? (
                <section className='ptv-books-empty'>
                    <PtvIcon name='books' />
                    <h2>No {getRouteTitle(routeKind)} Content Found</h2>
                    <p>No books, comics, or manga items were returned by Jellyfin for this library.</p>
                </section>
            ) : null}
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

function ReadingLibraryView({ homeData, isLoading, onSeriesOverrideChange, routeKind, seriesOverrides }: Readonly<{
    homeData: PtvReadingHomeData;
    isLoading: boolean;
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

    if ((!homeData.isPartial || libraryItems.length) && (!isLoading || sourceItems.length)) {
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
            {(isLoading || homeData.isPartial) && !sourceItems.length && !librarySection?.error ? (
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
                    <ReadingArtwork item={series.coverItem} loading='eager' routeKind={routeKind} size={380} />
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
                <ReadingArtwork item={item} loading='eager' routeKind={routeKind} size={420} />
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

function isReadingRequestAbort(error: unknown) {
    const errorRecord = error && typeof error === 'object' ? error as {
        message?: unknown;
        name?: unknown;
    } : null;
    const message = typeof errorRecord?.message === 'string' ? errorRecord.message : '';

    return errorRecord?.name === 'AbortError' || /abort|cancel|superseded/i.test(message);
}

function getReadingRouteCriticalOutcome(
    homeData: PtvReadingHomeData
): PtvRouteCriticalTerminalOutcome {
    const state = getPtvReadingHomeState(homeData);

    if (state === 'populated') return 'success';
    if (state === 'authoritative-empty') return 'empty';
    if (state === 'failed') return 'failed';

    return 'partial';
}

export default function PiggieTvBooksPage() {
    const location = useLocation();
    const route = useMemo(() => getReadingRoute(location.pathname, location.search), [location.pathname, location.search]);
    const readingMetadataOwnerRef = useRef({
        generation: 0,
        routeKey: ''
    });
    const readingMetadataOwnerRouteKey = `${route.kind}:${route.view}:${route.id}:${route.search}`;
    const readingRouteCriticalIdentity = getPtvReadingRouteCriticalIdentity(route);

    if (readingMetadataOwnerRef.current.routeKey !== readingMetadataOwnerRouteKey) {
        readingMetadataOwnerSequence += 1;
        readingMetadataOwnerRef.current = {
            generation: readingMetadataOwnerSequence,
            routeKey: readingMetadataOwnerRouteKey
        };
    }
    const readingRouteRef = useRef(route);
    readingRouteRef.current = route;
    const performanceProfile = useMemo(() => getPtvPerformanceProfile(), []);
    const readingLoadStartedAtRef = useRef(performance.now());
    const readingFirstShelfRecordedRef = useRef(false);
    const readingInitialRecordedRef = useRef(false);
    const readingFullyLoadedRecordedRef = useRef(false);
    const readingLibraryIndexRequestIdRef = useRef(0);
    const readingMountedRef = useRef(false);
    const readingPageRenderIdentityRef = useRef('');
    const readingRequestIdRef = useRef(0);
    const readingRouteCriticalLifecycleRef = useRef<ReturnType<typeof createPtvReadingRouteCriticalLifecycle> | null>(null);
    const readingRouteWorkControllerRef = useRef<AbortController | null>(null);
    const readingSectionRetryControllersRef = useRef(new Map<string, AbortController>());
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

    useLayoutEffect(() => {
        const routeCriticalLifecycle = createPtvReadingRouteCriticalLifecycle(
            capturePtvRouteCriticalLifecycleOwner('reading'),
            getPtvReadingRouteCriticalPlan(route.view, route.search)
        );

        readingRouteCriticalLifecycleRef.current?.retire();
        readingRouteCriticalLifecycleRef.current = routeCriticalLifecycle;

        return () => {
            routeCriticalLifecycle.retire();
            if (readingRouteCriticalLifecycleRef.current === routeCriticalLifecycle) {
                readingRouteCriticalLifecycleRef.current = null;
            }
        };
    }, [readingRouteCriticalIdentity, route.search, route.view]);

    useEffect(() => {
        if (route.view !== 'item' && !(route.view === 'explore' && route.search)) return;

        const homeGate = getPtvReadingRouteHomeGate(route.view, {
            hasError: Boolean(errorMessage),
            hasHomeSections: homeData.kind === route.kind && homeData.sections.length > 0,
            isLoading
        });

        if (homeGate === 'loading') return;
        readingRouteCriticalLifecycleRef.current?.complete(
            'initial-home-gate',
            homeGate === 'error' ? 'failed' : 'success'
        );
    }, [errorMessage, homeData.kind, homeData.sections.length, isLoading, readingRouteCriticalIdentity, route.kind, route.search, route.view]);

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
        ownerRequestId = readingRequestIdRef.current,
        signal?: AbortSignal
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
            onProgress: libraryIndex => applyLibraryIndex(libraryIndex, 'reading-library-index-background-progress'),
            signal
        })
            .then(libraryIndex => {
                applyLibraryIndex(libraryIndex, 'reading-library-index-background-loaded');

                if (!libraryIndex.items.length && getPtvReadingFailedReadCount(libraryIndex.debug)) {
                    throw new Error(libraryIndex.debug.dropReasons[0]);
                }

                return libraryIndex;
            })
            .catch(error => {
                if (signal?.aborted || isReadingRequestAbort(error)) return null;

                recordPtvEvent('api', 'reading-library-index-background-failed', {
                    error: getReadingErrorMessage(error),
                    kind
                });

                throw error;
            });
    }, []);

    const applyAuthoritativeReadingItem = useCallback((_itemId: string, item: PtvReadingItem) => {
        if (!readingMountedRef.current || !item.Id) return;
        const currentRoute = readingRouteRef.current;

        clearReadingImageFailuresForItem(item, currentRoute.kind);
        invalidatePtvReadingMetadataCache(item);
        setHomeData(previous => replacePtvReadingItemInHomeData(previous, item));
        setSearchResults(previous => replacePtvReadingItemInList(previous, item));

        if (currentRoute.view === 'item' && currentRoute.id === item.Id) {
            setItemDetail({
                error: '',
                isLoading: false,
                item
            });
        }
    }, []);

    const readingIdentifyReconciliation = useMemo(() => (
        createPtvReadingIdentifyReconciliationCoordinator<PtvReadingItem>({
            onDiagnostic: event => {
                recordPtvEvent('api', 'reading-identify-reconciliation', event);
            },
            publish: applyAuthoritativeReadingItem,
            read: (itemId, options) => fetchPtvReadingItem(itemId, options)
        })
    ), [ applyAuthoritativeReadingItem ]);

    const publishAuthoritativeReadingItem = useCallback((item: PtvReadingItem) => {
        if (!item.Id) return;

        readingIdentifyReconciliation.publishAuthoritative(item.Id, item);
    }, [ readingIdentifyReconciliation ]);

    const refreshReadingMetadataItem = useCallback((itemId: string, reason: string) => {
        return readingIdentifyReconciliation.requestReadback(itemId)
            .then(result => {
                recordPtvEvent('api', 'reading-metadata-item-readback-settled', {
                    reason,
                    status: result.status
                });

                return result;
            });
    }, [ readingIdentifyReconciliation ]);

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
        readingRouteWorkControllerRef.current?.abort();
        const routeWorkController = createPtvAbortController();

        readingRouteWorkControllerRef.current = routeWorkController;
        const { signal } = routeWorkController;
        const requestId = ++readingRequestIdRef.current;
        const routeCriticalLifecycle = readingRouteCriticalLifecycleRef.current;
        const isCurrentRequest = () => readingMountedRef.current
            && requestId === readingRequestIdRef.current
            && !signal.aborted;

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
                    void loadReadingLibraryIndex(route.kind, forceRefresh, requestId, signal)
                        .then(libraryIndex => {
                            if (!startsLibraryIndexImmediately) return;
                            if (!isCurrentRequest() || !libraryIndex) {
                                routeCriticalLifecycle?.retire();
                                return;
                            }

                            const failedReadCount = getPtvReadingFailedReadCount(libraryIndex.debug);
                            let outcome: PtvRouteCriticalTerminalOutcome = failedReadCount ? 'failed' : 'empty';

                            if (libraryIndex.items.length > 0) {
                                outcome = failedReadCount ? 'partial' : 'success';
                            }

                            routeCriticalLifecycle?.complete('library-index', outcome);
                        })
                        .catch(error => {
                            if (!isCurrentRequest() || isReadingRequestAbort(error)) {
                                routeCriticalLifecycle?.retire();
                                return;
                            }

                            setErrorMessage(getReadingErrorMessage(error) || 'Reading library could not be loaded.');
                            if (startsLibraryIndexImmediately) {
                                routeCriticalLifecycle?.complete('library-index', 'failed');
                            }
                        })
                        .finally(() => {
                            if (isCurrentRequest()) setLoading(false);
                        });
                }
            }, route.view === 'library' ? 0 : PTV_READING_LIBRARY_INDEX_LOAD_DELAY_MS);
        };
        const startsLibraryIndexImmediately = shouldStartPtvReadingLibraryIndexImmediately(route.view);

        if (startsLibraryIndexImmediately) {
            scheduleLibraryIndex();
            return Promise.resolve();
        }

        const loadFullReadingData = (
            bypassCacheForRefresh = false,
            completesCriticalLifecycle = false,
            initialHomeData?: PtvReadingHomeData
        ) => {
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

            void getPtvReadingHome(route.kind, {
                forceRefresh: forceRefresh || bypassCacheForRefresh,
                signal,
                view: route.view
            })
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
                    if (completesCriticalLifecycle) {
                        routeCriticalLifecycle?.complete('home', getReadingRouteCriticalOutcome(refreshedHomeData));
                    }
                })
                .catch(error => {
                    if (!isCurrentRequest() || isReadingRequestAbort(error)) {
                        if (completesCriticalLifecycle) routeCriticalLifecycle?.retire();
                        return;
                    }

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
                    if (completesCriticalLifecycle) {
                        const retainedItems = initialHomeData ? getAllReadingItems(initialHomeData).length : 0;

                        routeCriticalLifecycle?.complete('home', retainedItems ? 'partial' : 'failed');
                    }
                });
        };

        return getPtvReadingHome(route.kind, {
            forceRefresh,
            initialOnly: true,
            signal,
            view: route.view
        })
            .then(nextHomeData => {
                if (!isCurrentRequest()) return;

                setHomeData(previous => startsLibraryIndexImmediately ?
                    mergeReadingHomeRefresh(previous, nextHomeData, 'catalog-initial') :
                    nextHomeData);
                setLoading(false);
                if (!startsLibraryIndexImmediately) scheduleLibraryIndex();
                recordReadingLoadMetrics(nextHomeData, nextHomeData.cacheDiagnostics?.source || 'initial');
                const requiresAuthoritativeRefresh = Boolean(
                    nextHomeData.isPartial || nextHomeData.cacheDiagnostics?.staleHit
                );

                if (!requiresAuthoritativeRefresh) {
                    routeCriticalLifecycle?.complete('home', getReadingRouteCriticalOutcome(nextHomeData));
                }

                if (requiresAuthoritativeRefresh) {
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
                        if (isCurrentRequest()) {
                            loadFullReadingData(bypassCacheForRefresh, true, nextHomeData);
                        }
                    }, PTV_READING_FULL_HOME_LOAD_DELAY_MS);
                }
            })
            .catch(error => {
                if (!isCurrentRequest() || isReadingRequestAbort(error)) {
                    routeCriticalLifecycle?.retire();
                    return;
                }

                setErrorMessage(getReadingErrorMessage(error) || 'Reading library could not be loaded.');
                recordPtvEvent('render', 'reading-page-error', {
                    error: getReadingErrorMessage(error),
                    kind: route.kind,
                    stage: 'reading-shell-data'
                });
                setLoading(false);
                routeCriticalLifecycle?.complete('home', 'failed');
            });
    }, [loadReadingLibraryIndex, recordReadingLoadMetrics, route.kind, route.view]);

    const retryReadingSection = useCallback((sectionId: string) => {
        readingSectionRetryControllersRef.current.get(sectionId)?.abort();
        const controller = createPtvAbortController();
        const routeSignal = readingRouteWorkControllerRef.current?.signal;
        const abortFromRoute = () => {
            controller.abort();
        };
        const isCurrentRetry = () => readingMountedRef.current
            && readingSectionRetryControllersRef.current.get(sectionId) === controller
            && !controller.signal.aborted;

        if (routeSignal?.aborted) controller.abort();
        else routeSignal?.addEventListener('abort', abortFromRoute, { once: true });
        readingSectionRetryControllersRef.current.set(sectionId, controller);
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

        void fetchPtvReadingHomeSection(route.kind, sectionId, undefined, {
            signal: controller.signal
        })
            .then(section => {
                if (!isCurrentRetry()) return;

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
                                book: getReadingKindCount(allItems, 'book'),
                                comic: getReadingKindCount(allItems, 'comic'),
                                manga: getReadingKindCount(allItems, 'manga')
                            },
                            sectionDiagnostics
                        } : previous.libraryDebug,
                        sectionDiagnostics,
                        sections,
                        stats: {
                            ...previous.stats,
                            favoriteCount: getReadingSectionItemCount(
                                sections,
                                'favorites',
                                previous.stats.favoriteCount
                            ),
                            resumedCount: getReadingSectionItemCount(
                                sections,
                                'continue-reading',
                                previous.stats.resumedCount
                            )
                        }
                    };
                });
            })
            .catch(error => {
                if (!isCurrentRetry() || isReadingRequestAbort(error)) return;

                recordPtvEvent('api', 'reading-section-retry-failed', {
                    error: getReadingErrorMessage(error),
                    kind: route.kind,
                    sectionId
                });
            })
            .finally(() => {
                routeSignal?.removeEventListener('abort', abortFromRoute);
                if (readingSectionRetryControllersRef.current.get(sectionId) === controller) {
                    readingSectionRetryControllersRef.current.delete(sectionId);
                }
            });
    }, [route.kind]);

    const openAdminAction = useCallback((item: PtvReadingItem, action: ReadingAdminAction) => {
        if (!item.Id) return;

        const itemId = item.Id;
        const ownerRequestId = readingRequestIdRef.current;

        recordPtvEvent('render', 'reading-admin-action-opened', {
            action,
            kind: getPtvReadingItemKind(item)
        });

        void openReadingAdminDialog(item, action, readingMetadataOwnerRef.current.generation)
            .then(updatedItem => {
                if (!readingMountedRef.current || ownerRequestId !== readingRequestIdRef.current) return;

                const refreshedItem = updatedItem as PtvReadingItem | undefined;
                const closePolicy = getPtvReadingAdminDialogClosePolicy(action, refreshedItem);

                clearReadingImageFailuresForItem(item, readingRouteRef.current.kind);
                // Identify publishes a typed event whose readback code determines
                // whether its item is authoritative. Never bypass that guard with
                // the dialog's best-effort fallback value.
                if (closePolicy === 'identify-event') return;

                if (closePolicy === 'publish-item' && refreshedItem) {
                    publishAuthoritativeReadingItem(refreshedItem);
                } else {
                    // Upstream admin dialogs resolve without an item on both
                    // cancel and save. A targeted authoritative readback is safe
                    // for either outcome and avoids replacing the whole grid with
                    // a lightweight library-index snapshot.
                    void refreshReadingMetadataItem(itemId, `${action}-dialog-closed`);
                }
            })
            .catch(() => {
                recordPtvEvent('render', 'reading-admin-action-closed', {
                    action
                });
            });
    }, [publishAuthoritativeReadingItem, refreshReadingMetadataItem]);

    const adminControls = useMemo<ReadingAdminContextValue>(() => ({
        canShowDebug,
        debugEnabled,
        isAdmin,
        onAction: openAdminAction
    }), [canShowDebug, debugEnabled, isAdmin, openAdminAction]);

    useEffect(() => {
        const handleMetadataUpdate = (event: Event) => {
            const detail = getPtvReadingMetadataUpdateDetail(event);

            if (!detail) return;
            if (!isPtvReadingMetadataUpdateOwnedBy(
                detail,
                readingMetadataOwnerRef.current.generation
            )) {
                recordPtvEvent('render', 'reading-metadata-item-update-retired', {
                    reason: 'owner-generation-mismatch'
                });
                return;
            }
            const authority = getPtvReadingMetadataUpdateAuthority(detail);

            recordPtvEvent('render', 'reading-metadata-item-update-received', {
                authority,
                artworkStatus: detail.artworkStatus || null,
                metadataStatus: detail.metadataStatus || null,
                operationGeneration: detail.operationGeneration || null,
                outcome: detail.outcome || null,
                readbackCode: detail.readbackCode || null
            });

            if (detail.operationGeneration) {
                readingIdentifyReconciliation.reconcileMutation(detail.itemId, detail.item, {
                    authority: authority === 'READBACK_CONFIRMED_MUTATION' ? 'confirmed' : 'unconfirmed',
                    operationGeneration: detail.operationGeneration
                });
            }

            // An event without operation identity cannot be ordered against a
            // newer local reconciliation, so retain the current item.
        };

        window.addEventListener(PTV_READING_ITEM_METADATA_UPDATED_EVENT, handleMetadataUpdate);

        return () => {
            window.removeEventListener(PTV_READING_ITEM_METADATA_UPDATED_EVENT, handleMetadataUpdate);
        };
    }, [readingIdentifyReconciliation]);

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
        const sectionRetryControllers = readingSectionRetryControllersRef.current;

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
            readingRouteWorkControllerRef.current?.abort();
            readingRouteWorkControllerRef.current = null;
            readingIdentifyReconciliation.cancelAll();
            sectionRetryControllers.forEach(controller => {
                controller.abort();
            });
            sectionRetryControllers.clear();
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
    }, [loadReadingData, readingIdentifyReconciliation, route.kind]);

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
        const controller = createPtvAbortController();
        const routeCriticalLifecycle = readingRouteCriticalLifecycleRef.current;

        setSearchResults([]);

        if (route.view !== 'explore' || !route.search) return undefined;

        void searchPtvReading(route.kind, route.search, 60, {
            signal: controller.signal
        })
            .then(results => {
                if (isMounted) {
                    setSearchResults(results);
                    routeCriticalLifecycle?.complete('search', results.length ? 'success' : 'empty');
                }
            })
            .catch(error => {
                if (controller.signal.aborted || isReadingRequestAbort(error)) {
                    routeCriticalLifecycle?.retire();
                    return;
                }

                recordPtvEvent('api', 'reading-search-failed', {
                    error: getReadingErrorMessage(error),
                    kind: route.kind,
                    query: route.search
                });

                if (isMounted) {
                    setSearchResults([]);
                    routeCriticalLifecycle?.complete('search', 'failed');
                }
            });

        return () => {
            isMounted = false;
            controller.abort();
            routeCriticalLifecycle?.retire();
        };
    }, [route.kind, route.search, route.view]);

    useEffect(() => {
        let isMounted = true;
        const controller = createPtvAbortController();
        const routeCriticalLifecycle = readingRouteCriticalLifecycleRef.current;

        if (route.view !== 'item' || !route.id) {
            setItemDetail(getInitialItemDetail());
            return undefined;
        }

        setItemDetail({
            ...getInitialItemDetail(),
            isLoading: true
        });

        void fetchPtvReadingItem(route.id, {
            signal: controller.signal
        })
            .then(item => {
                if (isMounted) {
                    setItemDetail({
                        error: '',
                        isLoading: false,
                        item
                    });
                    routeCriticalLifecycle?.complete('item', item ? 'success' : 'failed');
                }
            })
            .catch(error => {
                if (controller.signal.aborted || isReadingRequestAbort(error)) {
                    routeCriticalLifecycle?.retire();
                    return;
                }

                if (isMounted) {
                    setItemDetail({
                        ...getInitialItemDetail(),
                        error: getReadingErrorMessage(error) || 'Item could not be loaded.',
                        isLoading: false
                    });
                    routeCriticalLifecycle?.complete('item', 'failed');
                }
            });

        return () => {
            isMounted = false;
            controller.abort();
            routeCriticalLifecycle?.retire();
        };
    }, [route.id, route.view]);

    const refresh = () => {
        void loadReadingData(true);
    };

    const renderView = () => {
        if (homeData.kind !== route.kind) return <ReadingLoading label={`Loading ${getRouteTitle(route.kind)}`} />;
        const homeGate = getPtvReadingRouteHomeGate(route.view, {
            hasError: Boolean(errorMessage),
            hasHomeSections: homeData.sections.length > 0,
            isLoading
        });

        if (homeGate === 'loading') return <ReadingLoading label={`Loading ${getRouteTitle(route.kind)}`} />;
        if (homeGate === 'error') return <ReadingError message={errorMessage} />;

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
                        isLoading={isLoading}
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
    const readingCardMenuContentVersion = useMemo(() => ({
        homeData,
        itemDetail,
        searchResults
    }), [homeData, itemDetail, searchResults]);

    return (
        <Page
            id='ptvBooksPage'
            title={getRouteTitle(route.kind)}
            className='mainAnimatedPage type-interior ptv-books-page'
            isMenuButtonEnabled
        >
            <PTVShell
                backdropSource={`reading-${route.kind}`}
                className='ptv-books-shell'
                contextualLinks={getReadingContextLinks(route)}
                section='reading'
                title='Reading'
            >
                {route.view === 'home' ? null : (
                    <ReadingPageBackdrop item={heroItem} route={route.kind} />
                )}
                <main
                    className={`ptv-books-app ptv-books-app-shell ptv-books-route-${route.view} ptv-books-kind-${route.kind}${performanceProfile.isLowPower ? ' ptv-books-low-power' : ''}`}
                    data-ptv-client-profile={performanceProfile.clientKind}
                    data-ptv-render-profile={performanceProfile.renderProfile.id}
                >
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
                                <ReadingCardMenuOwner
                                    contentVersion={readingCardMenuContentVersion}
                                    routeKey={`${route.kind}:${route.view}:${route.id}:${route.search}`}
                                >
                                    <READING_ADMIN_CONTEXT.Provider value={adminControls}>
                                        {renderView()}
                                    </READING_ADMIN_CONTEXT.Provider>
                                </ReadingCardMenuOwner>
                            </div>
                        </section>
                    </div>
                </main>
            </PTVShell>
        </Page>
    );
}

/* eslint-enable react/jsx-no-bind, no-void */
