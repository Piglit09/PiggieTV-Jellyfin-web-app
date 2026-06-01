import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    getPtvCurrentUser,
    getPtvItems,
    getPtvNextUp,
    getPtvRecentlyAdded,
    getPtvResumeItems,
    getPtvUserViews,
    type PtvItem,
    type PtvLibrary,
    type PtvUser
} from '../../api';
import {
    getCachedFeaturedContentPayload,
    type FeaturedPayload
} from '../../modules/cache/featuredContentCache';
import {
    recordPtvEvent,
    recordPtvTiming,
    timePtvAsync
} from '../../core/observability';
import {
    clearPtvShellStatus,
    setPtvShellError,
    setPtvShellLoading
} from '../../shell/foundation';

export type NativeHomeRowKind = 'items' | 'libraries';
export type NativeHomeRowSource = 'featured-cache' | 'libraries' | 'next-up' | 'recently-added' | 'resume';

export type NativeHomeRow = {
    id: string;
    items: Array<PtvItem | PtvLibrary>;
    kind: NativeHomeRowKind;
    source: NativeHomeRowSource;
    subtitle: string;
    title: string;
};

export type NativeHomeState = {
    error: string | null;
    heroItem: PtvItem | null;
    isLoading: boolean;
    rows: NativeHomeRow[];
    user: PtvUser | null;
};

const ITEM_FIELDS = [
    'Overview',
    'Genres',
    'PrimaryImageAspectRatio',
    'CommunityRating',
    'CriticRating',
    'OfficialRating',
    'RunTimeTicks',
    'ProductionYear',
    'DateCreated'
].join(',');

const VIDEO_IMAGE_TYPES = 'Primary,Backdrop,Logo,Thumb';
const RECENT_ITEM_TYPES = 'Movie,Series,Episode,MusicAlbum,Audio,Book';
const MAX_CACHED_ROWS = 12;

function getItems<T>(result: { Items?: T[] } | T[] | null | undefined): T[] {
    if (Array.isArray(result)) return result;

    return result?.Items || [];
}

function safeLoad<T>(request: Promise<T>, fallback: T): Promise<T> {
    return request.catch(() => fallback);
}

function getSectionTitle(section: unknown, fallback: string) {
    if (!section || typeof section !== 'object') return fallback;

    const value = section as Record<string, unknown>;

    return String(value.title || value.name || value.source || fallback);
}

function getSectionSubtitle(section: unknown) {
    if (!section || typeof section !== 'object') return 'Featured from your PiggieTV cache';

    const value = section as Record<string, unknown>;

    return String(value.rowKicker || value.groupTitle || value.groupKicker || 'Featured from your PiggieTV cache');
}

function firstUsableHeroItem(rows: NativeHomeRow[]): PtvItem | null {
    const candidateRows = rows.filter(row => row.kind === 'items');

    for (const row of candidateRows) {
        const item = row.items.find(candidate => {
            const typedItem = candidate as PtvItem;

            return Boolean(
                typedItem.Id
                && (
                    typedItem.BackdropImageTags?.length
                    || typedItem.ImageTags?.Primary
                    || typedItem.ImageTags?.Logo
                )
            );
        });

        if (item) return item as PtvItem;
    }

    return null;
}

function recordFeaturedPayloadShape(payload: FeaturedPayload | null) {
    const sectionItems = payload?.sectionItems || {};
    const sectionItemEntries = Object.entries(sectionItems);

    recordPtvEvent('cache', 'native-home-featured-cache-shape', {
        hasPayload: Boolean(payload),
        heroCount: Array.isArray(payload?.heroItems) ? payload.heroItems.length : 0,
        rowDiagnosticCount: Array.isArray(payload?.rowDiagnostics) ? payload.rowDiagnostics.length : 0,
        sectionCount: Array.isArray(payload?.sections) ? payload.sections.length : 0,
        sectionItemKeyCount: sectionItemEntries.length,
        sectionItemCounts: sectionItemEntries.slice(0, MAX_CACHED_ROWS).map(([sectionId, items]) => ({
            itemCount: Array.isArray(items) ? items.length : 0,
            sectionId
        }))
    });
}

function createRows(
    resumeItems: PtvItem[],
    nextUpItems: PtvItem[],
    recentlyAddedItems: PtvItem[],
    libraries: PtvLibrary[]
): NativeHomeRow[] {
    const rows: NativeHomeRow[] = [
        {
            id: 'resume',
            items: resumeItems,
            kind: 'items',
            source: 'resume',
            subtitle: 'Pick up where you left off',
            title: 'Resume'
        },
        {
            id: 'next-up',
            items: nextUpItems,
            kind: 'items',
            source: 'next-up',
            subtitle: 'Fresh episodes from your shows',
            title: 'Next Up'
        },
        {
            id: 'recently-added',
            items: recentlyAddedItems,
            kind: 'items',
            source: 'recently-added',
            subtitle: 'New arrivals from your server',
            title: 'Recently Added'
        },
        {
            id: 'libraries',
            items: libraries,
            kind: 'libraries',
            source: 'libraries',
            subtitle: 'Jump into your Jellyfin libraries',
            title: 'Library Tiles'
        }
    ];

    return rows.filter(row => row.items.length);
}

function createRowsFromFeaturedPayload(payload: FeaturedPayload | null): NativeHomeRow[] {
    if (!payload?.sectionItems) return [];

    const sections = Array.isArray(payload.sections) ? payload.sections : [];
    const sectionIds = sections.length
        ? sections.map(section => String((section as Record<string, unknown>)?.id || ''))
        : Object.keys(payload.sectionItems);

    return sectionIds
        .filter(Boolean)
        .slice(0, MAX_CACHED_ROWS)
        .map((sectionId, index) => {
            const section = sections.find(entry => String((entry as Record<string, unknown>)?.id || '') === sectionId);
            const items = payload.sectionItems[sectionId] || [];

            return {
                id: `featured-${sectionId}`,
                items: items as PtvItem[],
                kind: 'items' as const,
                source: 'featured-cache' as const,
                subtitle: getSectionSubtitle(section),
                title: getSectionTitle(section, sectionId || `Featured ${index + 1}`)
            };
        })
        .filter(row => row.items.length);
}

function createNativeRowFetch<T>(
    name: string,
    task: () => Promise<T>,
    fallback: T
): Promise<T> {
    return timePtvAsync('row-fetch', name, task)
        .catch(() => fallback);
}

export function useNativeHomeData(): NativeHomeState {
    const [state, setState] = useState<NativeHomeState>({
        error: null,
        heroItem: null,
        isLoading: true,
        rows: [],
        user: null
    });

    useEffect(() => {
        let disposed = false;
        const startedAt = performance.now();

        recordPtvEvent('render', 'native-home-mount-start', {
            route: window.location.hash || window.location.pathname
        });
        recordPtvEvent('row-fetch', 'native-home-data-fetch-start', {
            route: window.location.hash || window.location.pathname
        });
        setPtvShellLoading(true);
        clearPtvShellStatus();
        setState(previous => ({
            ...previous,
            error: null,
            isLoading: true
        }));

        getPtvCurrentUser()
            .then(user => {
                if (!user?.Id) {
                    throw new Error('A signed-in Jellyfin user is required for the native PiggieTV home.');
                }

                return Promise.all([
                    createNativeRowFetch('native-home-featured-cache', () => getCachedFeaturedContentPayload({ allowStale: true }), null),
                    createNativeRowFetch('native-home-resume', () => getPtvResumeItems<PtvItem>({
                        EnableImageTypes: VIDEO_IMAGE_TYPES,
                        Fields: ITEM_FIELDS,
                        Limit: 16,
                        MediaTypes: 'Video'
                    }, { userId: user.Id }), { Items: [] }),
                    createNativeRowFetch('native-home-next-up', () => getPtvNextUp<PtvItem>({
                        EnableImageTypes: VIDEO_IMAGE_TYPES,
                        Fields: ITEM_FIELDS,
                        Limit: 16,
                        UserId: user.Id
                    }), { Items: [] }),
                    createNativeRowFetch('native-home-recently-added', () => getPtvRecentlyAdded<PtvItem>({
                        EnableImageTypes: VIDEO_IMAGE_TYPES,
                        Fields: ITEM_FIELDS,
                        IncludeItemTypes: RECENT_ITEM_TYPES,
                        Limit: 20
                    }, { userId: user.Id }), []),
                    createNativeRowFetch('native-home-libraries', () => getPtvUserViews({
                        userId: user.Id
                    }), { Items: [] }),
                    createNativeRowFetch('native-home-hero-fallback', () => getPtvItems<PtvItem>({
                        EnableImageTypes: VIDEO_IMAGE_TYPES,
                        Fields: ITEM_FIELDS,
                        ImageTypes: 'Backdrop',
                        IncludeItemTypes: 'Movie,Series',
                        Limit: 8,
                        Recursive: true,
                        SortBy: 'Random'
                    }, { userId: user.Id }), { Items: [] })
                ]).then(([
                    featuredPayload,
                    resumeResult,
                    nextUpResult,
                    recentResult,
                    librariesResult,
                    heroResult
                ]) => {
                    recordFeaturedPayloadShape(featuredPayload);

                    return {
                        cachedRows: createRowsFromFeaturedPayload(featuredPayload),
                        featuredHeroItems: getItems(featuredPayload?.heroItems as PtvItem[] | undefined),
                        heroItems: getItems(heroResult),
                        libraries: getItems(librariesResult),
                        nextUpItems: getItems(nextUpResult),
                        recentlyAddedItems: getItems(recentResult),
                        resumeItems: getItems(resumeResult),
                        user
                    };
                });
            })
            .then(payload => {
                if (disposed) return;

                const rows = createRows(
                    payload.resumeItems,
                    payload.nextUpItems,
                    payload.recentlyAddedItems,
                    payload.libraries
                );
                const userRows = rows.filter(row => row.id === 'resume' || row.id === 'next-up');
                const libraryRows = rows.filter(row => row.id === 'libraries');
                const recentRows = rows.filter(row => row.id === 'recently-added');
                const mergedRows = [
                    ...userRows,
                    ...recentRows,
                    ...payload.cachedRows,
                    ...libraryRows
                ];
                const heroItems = payload.featuredHeroItems.length ? payload.featuredHeroItems : payload.heroItems;
                const heroItem = heroItems.find(item => (
                    item.BackdropImageTags?.length
                    || item.ImageTags?.Primary
                    || item.ImageTags?.Logo
                )) || firstUsableHeroItem(mergedRows);

                clearPtvShellStatus();
                recordPtvTiming('recommendation', 'native-home-row-plan', performance.now() - startedAt, {
                    cachedRows: payload.cachedRows.length,
                    source: payload.cachedRows.length ? 'featured-cache' : 'jellyfin-api'
                });
                recordPtvTiming('render', 'native-home-render-complete', performance.now() - startedAt, {
                    cachedRows: payload.cachedRows.length,
                    rowCount: mergedRows.length
                });
                setState({
                    error: null,
                    heroItem,
                    isLoading: false,
                    rows: mergedRows,
                    user: payload.user
                });
            })
            .catch(error => {
                if (disposed) return;

                const message = error instanceof Error ? error.message : 'PiggieTV native home could not load.';

                recordPtvEvent('render', 'native-home-fallback-used', {
                    error: message
                });
                setPtvShellError(message);
                setState({
                    error: message,
                    heroItem: null,
                    isLoading: false,
                    rows: [],
                    user: null
                });
            })
            .finally(() => {
                if (!disposed) {
                    setPtvShellLoading(false);
                }
            });

        return () => {
            disposed = true;
            setPtvShellLoading(false);
        };
    }, []);

    return state;
}

export function useNativeHomeVirtualRows(rows: NativeHomeRow[]) {
    const [mountedRowIds, setMountedRowIds] = useState<Set<string>>(() => new Set());
    const observerRef = useRef<IntersectionObserver | null>(null);
    const nodeMap = useRef(new Map<string, HTMLElement>());

    const initialRowIds = useMemo(
        () => rows.slice(0, 3).map(row => row.id),
        [rows]
    );

    useEffect(() => {
        setMountedRowIds(previous => {
            const next = new Set(previous);

            initialRowIds.forEach(id => next.add(id));

            return next;
        });
    }, [initialRowIds]);

    useEffect(() => {
        if (!('IntersectionObserver' in window)) {
            setMountedRowIds(new Set(rows.map(row => row.id)));
            return undefined;
        }

        observerRef.current?.disconnect();
        observerRef.current = new IntersectionObserver(entries => {
            const enteredIds = entries
                .filter(entry => entry.isIntersecting)
                .map(entry => (entry.target as HTMLElement).dataset.ptvNativeRowId)
                .filter(Boolean) as string[];

            if (!enteredIds.length) return;

            setMountedRowIds(previous => {
                const next = new Set(previous);

                enteredIds.forEach(id => next.add(id));

                return next;
            });
        }, {
            root: null,
            rootMargin: '900px 0px',
            threshold: 0.01
        });

        nodeMap.current.forEach(node => observerRef.current?.observe(node));

        return () => {
            observerRef.current?.disconnect();
            observerRef.current = null;
        };
    }, [rows]);

    const registerRowRef = useCallback((rowId: string) => (node: HTMLElement | null) => {
        const previousNode = nodeMap.current.get(rowId);

        if (previousNode && observerRef.current) {
            observerRef.current.unobserve(previousNode);
        }

        if (!node) {
            nodeMap.current.delete(rowId);
            return;
        }

        node.dataset.ptvNativeRowId = rowId;
        nodeMap.current.set(rowId, node);
        observerRef.current?.observe(node);
    }, []);

    const isRowMounted = useCallback((rowId: string) => mountedRowIds.has(rowId), [mountedRowIds]);

    return {
        isRowMounted,
        mountedRowCount: mountedRowIds.size,
        registerRowRef
    };
}
