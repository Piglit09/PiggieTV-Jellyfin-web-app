import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

import Page from 'components/Page';

import {
    getPtvItemImageUrl,
    getPtvItems,
    getPtvResumeItems,
    type PtvItem,
    type PtvItemQuery
} from '../../api';
import { PTV_BRANDING, PTV_ROUTES } from '../../core/config';
import {
    recordPtvItemRouteClick,
    resolvePtvItemRoute
} from '../../core/itemRoutes';
import { recordPtvEvent, shouldCollectDiagnostics } from '../../core/observability';
import PTVShell, { type PtvShellSection } from '../../shell/PTVShell';
import { registerPtvNativeRoute } from '../../shell/routeController';
import { usePtvAdminDebugVisibility } from '../../utils/usePtvAdminDebugVisibility';
import {
    getPtvQualityPillClass,
    getPtvQualityTags
} from '../../modules/cards/qualityTags';
import { PtvIcon } from '../../modules/icons';

import './nativeBrowse.scss';

type PtvBrowseKind = 'collections' | 'movies' | 'shows';

type PtvBrowseConfig = Readonly<{
    browseTitle: string;
    collectionTitle: string;
    continueIncludeItemTypes: string;
    description: string;
    featuredTitle: string;
    genreFilter: string;
    icon: string;
    includeItemTypes: string;
    kind: PtvBrowseKind;
    recommendationsTitle: string;
    recentlyTitle: string;
    title: string;
}>;

type PtvBrowseSection = Readonly<{
    id: string;
    kicker: string;
    title: string;
    items: PtvItem[];
    status: 'empty' | 'loading' | 'ready';
}>;

type PtvBrowseDiagnostic = Readonly<{
    count: number;
    durationMs: number;
    section: string;
    status: 'error' | 'ready';
}>;

type PtvBrowseState = Readonly<{
    diagnostics: PtvBrowseDiagnostic[];
    error: string;
    heroItem: PtvItem | null;
    isLoading: boolean;
    sections: PtvBrowseSection[];
    tags: {
        genres: string[];
        studios: string[];
    };
}>;

type PtvBrowseMemory = Readonly<{
    focusedItemId: string;
    focusedSectionId: string;
    lastFilter: string;
    scrollY: number;
    updatedAt: number;
}>;

const PTV_BROWSE_MEMORY_PREFIX = 'ptv:browse:memory:v1:';

const BROWSE_FIELDS = [
    'CanDownload',
    'Container',
    'CriticRating',
    'DateCreated',
    'Genres',
    'ImageTags',
    'MediaSources',
    'MediaStreams',
    'OfficialRating',
    'Overview',
    'ParentBackdropImageTags',
    'ParentBackdropItemId',
    'ParentLogoImageTag',
    'ParentLogoItemId',
    'Path',
    'PremiereDate',
    'PrimaryImageAspectRatio',
    'ProductionYear',
    'ProviderIds',
    'RunTimeTicks',
    'SortName',
    'Studios',
    'Tags',
    'UserData'
].join(',');

const EMPTY_BROWSE_STATE: PtvBrowseState = {
    diagnostics: [],
    error: '',
    heroItem: null,
    isLoading: true,
    sections: [],
    tags: {
        genres: [],
        studios: []
    }
};

const EMPTY_BROWSE_MEMORY: PtvBrowseMemory = {
    focusedItemId: '',
    focusedSectionId: '',
    lastFilter: '',
    scrollY: 0,
    updatedAt: 0
};

function getPtvBrowseMemoryKey(pathname: string, search: string) {
    return `${PTV_BROWSE_MEMORY_PREFIX}${pathname}${search}`;
}

function loadPtvBrowseMemory(key: string): PtvBrowseMemory {
    try {
        const raw = window.localStorage?.getItem(key);
        const parsed = raw ? JSON.parse(raw) as Partial<PtvBrowseMemory> : {};

        return {
            focusedItemId: typeof parsed.focusedItemId === 'string' ? parsed.focusedItemId : '',
            focusedSectionId: typeof parsed.focusedSectionId === 'string' ? parsed.focusedSectionId : '',
            lastFilter: typeof parsed.lastFilter === 'string' ? parsed.lastFilter : '',
            scrollY: typeof parsed.scrollY === 'number' && Number.isFinite(parsed.scrollY) ? parsed.scrollY : 0,
            updatedAt: typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : 0
        };
    } catch {
        return EMPTY_BROWSE_MEMORY;
    }
}

function savePtvBrowseMemory(key: string, memory: PtvBrowseMemory) {
    try {
        window.localStorage?.setItem(key, JSON.stringify(memory));
    } catch {
        // Memory is a polish feature; storage failures should not affect browsing.
    }
}

function getText(value: unknown) {
    return typeof value === 'string' ? value : '';
}

function getNumber(value: unknown) {
    const parsed = typeof value === 'number' ? value : Number(value);

    return Number.isFinite(parsed) ? parsed : 0;
}

function getArrayText(value: unknown): string[] {
    if (!Array.isArray(value)) return [];

    return value
        .map(entry => {
            if (typeof entry === 'string') return entry;
            if (entry && typeof entry === 'object') {
                return getText((entry as Record<string, unknown>).Name || (entry as Record<string, unknown>).name);
            }

            return '';
        })
        .filter(Boolean);
}

function getPtvBrowseConfig(pathname: string, search: string): PtvBrowseConfig {
    const params = new URLSearchParams(search);
    const parentHint = (params.get('topParentId') || params.get('kind') || '').toLowerCase();

    if (pathname.includes('collections')) {
        return {
            browseTitle: 'Browse Collections',
            collectionTitle: 'Collection Hubs',
            continueIncludeItemTypes: 'Movie,Series,Episode',
            description: 'Curated sets, franchises, and watch paths.',
            featuredTitle: 'Featured Collections',
            genreFilter: '',
            icon: 'collections',
            includeItemTypes: 'BoxSet',
            kind: 'collections',
            recommendationsTitle: 'Recommended Collections',
            recentlyTitle: 'Recently Added Collections',
            title: 'Collections'
        };
    }

    if (pathname.includes('shows') || pathname.includes('tv')) {
        if (parentHint === 'anime') {
            return {
                browseTitle: 'Browse Anime',
                collectionTitle: 'Anime Collections',
                continueIncludeItemTypes: 'Episode,Series',
                description: 'Series, seasons, and episodes from your anime library.',
                featuredTitle: 'Featured Anime',
                genreFilter: 'Anime',
                icon: 'anime',
                includeItemTypes: 'Series',
                kind: 'shows',
                recommendationsTitle: 'Recommended Anime',
                recentlyTitle: 'Recently Added Anime',
                title: 'Anime'
            };
        }

        if (parentHint === 'cartoons') {
            return {
                browseTitle: 'Browse Cartoons',
                collectionTitle: 'Cartoon Collections',
                continueIncludeItemTypes: 'Episode,Series',
                description: 'Animated series, comfort shows, and weekend cartoons.',
                featuredTitle: 'Featured Cartoons',
                genreFilter: 'Animation',
                icon: 'cartoons',
                includeItemTypes: 'Series',
                kind: 'shows',
                recommendationsTitle: 'Recommended Cartoons',
                recentlyTitle: 'Recently Added Cartoons',
                title: 'Cartoons'
            };
        }

        return {
            browseTitle: 'Browse Shows',
            collectionTitle: 'Show Collections',
            continueIncludeItemTypes: 'Episode,Series',
            description: 'Series, next-up episodes, genres, studios, and discovery shelves.',
            featuredTitle: 'Featured Shows',
            genreFilter: '',
            icon: 'shows',
            includeItemTypes: 'Series',
            kind: 'shows',
            recommendationsTitle: 'Recommended Shows',
            recentlyTitle: 'Recently Added Shows',
            title: 'Shows'
        };
    }

    if (parentHint === 'animemovies') {
        return {
            browseTitle: 'Browse AniMovies',
            collectionTitle: 'Anime Movie Collections',
            continueIncludeItemTypes: 'Movie',
            description: 'Anime films, specials, and cinematic picks.',
            featuredTitle: 'Featured AniMovies',
            genreFilter: 'Anime',
            icon: 'animeMovies',
            includeItemTypes: 'Movie',
            kind: 'movies',
            recommendationsTitle: 'Recommended AniMovies',
            recentlyTitle: 'Recently Added AniMovies',
            title: 'AniMovies'
        };
    }

    return {
        browseTitle: 'Browse Movies',
        collectionTitle: 'Movie Collections',
        continueIncludeItemTypes: 'Movie',
        description: 'Movies, studios, genres, collections, and discovery shelves.',
        featuredTitle: 'Featured Movies',
        genreFilter: '',
        icon: 'movies',
        includeItemTypes: 'Movie',
        kind: 'movies',
        recommendationsTitle: 'Recommended Movies',
        recentlyTitle: 'Recently Added Movies',
        title: 'Movies'
    };
}

function getPtvBrowseShellSection(config: PtvBrowseConfig): PtvShellSection {
    if (config.title === 'AniMovies' || config.title === 'Anime') return 'anime';
    if (config.title === 'Cartoons') return 'cartoons';
    if (config.kind === 'collections') return 'collections';

    return config.kind;
}

function getBaseQuery(config: PtvBrowseConfig, overrides: PtvItemQuery = {}): PtvItemQuery {
    const query: PtvItemQuery = {
        EnableImages: true,
        EnableImageTypes: 'Primary,Backdrop,Thumb,Logo',
        Fields: BROWSE_FIELDS,
        ImageTypeLimit: 1,
        IncludeItemTypes: config.includeItemTypes,
        Limit: 20,
        Recursive: true,
        ...overrides
    };

    if (config.genreFilter) {
        query.Genres = config.genreFilter;
    }

    return query;
}

function dedupeBrowseItems(items: PtvItem[]) {
    const seen = new Set<string>();

    return items.filter(item => {
        const id = getText(item.Id);

        if (!id || seen.has(id)) return false;

        seen.add(id);
        return true;
    });
}

function getBrowseItemYear(item: PtvItem) {
    const year = getNumber(item.ProductionYear);

    if (year) return String(year);

    const premiereDate = getText(item.PremiereDate);

    return premiereDate ? premiereDate.slice(0, 4) : '';
}

function getBrowseItemTypeLabel(item: PtvItem) {
    const itemType = getText(item.Type);

    if (itemType === 'BoxSet') return 'Collection';
    if (itemType === 'Series') return 'Series';
    if (itemType === 'Episode') return 'Episode';
    if (itemType === 'Movie') return 'Movie';

    return itemType || 'Item';
}

function getBrowseMetadata(item: PtvItem) {
    return [
        getBrowseItemYear(item),
        getBrowseItemTypeLabel(item),
        getText(item.OfficialRating)
    ].filter(Boolean).join(' | ');
}

function getBrowsePrimaryImage(item: PtvItem) {
    return getPtvItemImageUrl(item, {
        fillHeight: 558,
        fillWidth: 372,
        imageType: 'Primary',
        quality: 92
    });
}

function getBrowseBackdropImage(item: PtvItem | null) {
    if (!item) return '';

    return getPtvItemImageUrl(item, {
        imageType: 'Backdrop',
        maxWidth: 1920,
        quality: 88
    });
}

function getBrowseLogoImage(item: PtvItem | null) {
    if (!item || !item.ImageTags?.Logo) return '';

    return getPtvItemImageUrl(item, {
        imageType: 'Logo',
        maxWidth: 520,
        quality: 92
    });
}

function getBrowseRoute(item: PtvItem) {
    return resolvePtvItemRoute(item, {
        fallbackHref: `#/details?id=${encodeURIComponent(getText(item.Id))}`,
        source: 'ptv-browse'
    });
}

function getDistinctTags(items: PtvItem[], key: 'Genres' | 'Studios') {
    const counts = new Map<string, number>();

    items.forEach(item => {
        getArrayText(item[key]).forEach(tag => {
            counts.set(tag, (counts.get(tag) || 0) + 1);
        });
    });

    return [...counts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([tag]) => tag)
        .slice(0, 18);
}

async function fetchBrowseItems(section: string, query: PtvItemQuery): Promise<{
    diagnostic: PtvBrowseDiagnostic;
    items: PtvItem[];
}> {
    const startedAt = performance.now();

    try {
        const result = await getPtvItems<PtvItem>(query);
        const items = dedupeBrowseItems(result.Items || []);

        return {
            diagnostic: {
                count: items.length,
                durationMs: Number((performance.now() - startedAt).toFixed(1)),
                section,
                status: 'ready'
            },
            items
        };
    } catch {
        return {
            diagnostic: {
                count: 0,
                durationMs: Number((performance.now() - startedAt).toFixed(1)),
                section,
                status: 'error'
            },
            items: []
        };
    }
}

async function fetchBrowseResumeItems(section: string, query: PtvItemQuery): Promise<{
    diagnostic: PtvBrowseDiagnostic;
    items: PtvItem[];
}> {
    const startedAt = performance.now();

    try {
        const result = await getPtvResumeItems<PtvItem>(query);
        const items = dedupeBrowseItems(result.Items || []);

        return {
            diagnostic: {
                count: items.length,
                durationMs: Number((performance.now() - startedAt).toFixed(1)),
                section,
                status: 'ready'
            },
            items
        };
    } catch {
        return {
            diagnostic: {
                count: 0,
                durationMs: Number((performance.now() - startedAt).toFixed(1)),
                section,
                status: 'error'
            },
            items: []
        };
    }
}

function makeSection(id: string, title: string, kicker: string, items: PtvItem[], isLoading = false): PtvBrowseSection {
    return {
        id,
        items,
        kicker,
        status: isLoading ? 'loading' : items.length ? 'ready' : 'empty',
        title
    };
}

function getInitialSections(config: PtvBrowseConfig, featuredItems: PtvItem[]): PtvBrowseSection[] {
    return [
        makeSection('featured', config.featuredTitle, 'Featured', featuredItems),
        makeSection('continue', 'Continue', 'Pick up where you left off', [], true),
        makeSection('recommendations', config.recommendationsTitle, 'Recommended', [], true),
        makeSection('recently-added', config.recentlyTitle, 'Recently Added', [], true),
        makeSection('browse', config.browseTitle, 'Browse', [], true),
        makeSection('collections', config.collectionTitle, 'Collections', [], true)
    ];
}

function getCompleteSections(
    config: PtvBrowseConfig,
    featuredItems: PtvItem[],
    resumeItems: PtvItem[],
    recommendationItems: PtvItem[],
    recentlyAddedItems: PtvItem[],
    browseItems: PtvItem[],
    collectionItems: PtvItem[]
): PtvBrowseSection[] {
    return [
        makeSection('featured', config.featuredTitle, 'Featured', featuredItems),
        makeSection('continue', 'Continue', 'Pick up where you left off', resumeItems),
        makeSection('recommendations', config.recommendationsTitle, 'Recommendations', recommendationItems),
        makeSection('recently-added', config.recentlyTitle, 'Recently Added', recentlyAddedItems),
        makeSection('browse', config.browseTitle, 'Browse', browseItems),
        makeSection('collections', config.collectionTitle, 'Collections', collectionItems)
    ];
}

function PtvBrowseHero({ config, item }: Readonly<{ config: PtvBrowseConfig; item: PtvItem | null }>) {
    const backdropUrl = getBrowseBackdropImage(item);
    const logoUrl = getBrowseLogoImage(item);
    const title = getText(item?.Name) || config.title;
    const overview = getText(item?.Overview) || config.description;
    const route = item ? getBrowseRoute(item) : null;

    return (
        <section className='ptv-browse-hero'>
            {backdropUrl ? <img className='ptv-browse-hero-backdrop' src={backdropUrl} alt='' /> : null}
            <div className='ptv-browse-hero-vignette' />
            <div className='ptv-browse-hero-copy'>
                <div className='ptv-browse-section-kicker'>
                    <PtvIcon name={config.icon} />
                    <span>{config.title}</span>
                </div>
                {logoUrl ? (
                    <img className='ptv-browse-hero-logo' src={logoUrl} alt={title} />
                ) : (
                    <h1>{title}</h1>
                )}
                {item ? <p className='ptv-browse-hero-meta'>{getBrowseMetadata(item)}</p> : null}
                <p className='ptv-browse-hero-overview'>{overview}</p>
                <div className='ptv-browse-hero-actions'>
                    {route ? (
                        <a className='ptv-browse-primary-action' href={route.href}>
                            <PtvIcon name='play' />
                            <span>Open</span>
                        </a>
                    ) : null}
                    <a className='ptv-browse-secondary-action' href={PTV_ROUTES.home}>
                        <PtvIcon name='home' />
                        <span>Home</span>
                    </a>
                </div>
            </div>
        </section>
    );
}

function PtvBrowseCard({
    item,
    onFocusItem,
    sectionId
}: Readonly<{
    item: PtvItem;
    onFocusItem: (sectionId: string, item: PtvItem) => void;
    sectionId: string;
}>) {
    const route = useMemo(() => getBrowseRoute(item), [item]);
    const imageUrl = getBrowsePrimaryImage(item);
    const tags = useMemo(() => getPtvQualityTags(item, { maxTags: 3 }), [item]);
    const title = getText(item.Name) || 'Untitled';

    return (
        <a
            className='ptv-browse-card'
            data-ptv-browse-item-id={getText(item.Id)}
            data-ptv-browse-section-id={sectionId}
            href={route.href}
            onClick={() => recordPtvItemRouteClick(item, route, {
                action: 'browse-card',
                source: 'ptv-browse'
            })}
            onFocus={() => onFocusItem(sectionId, item)}
        >
            <span className='ptv-browse-card-art'>
                {imageUrl ? <img src={imageUrl} alt='' loading='lazy' /> : <span className='ptv-browse-card-fallback'>{title.slice(0, 1)}</span>}
                {tags.length ? (
                    <span className='ptv-browse-quality-stack'>
                        {tags.map(tag => (
                            <span key={tag.id} className={`ptv-browse-quality ${getPtvQualityPillClass(tag)}`}>
                                {tag.label}
                            </span>
                        ))}
                    </span>
                ) : null}
            </span>
            <span className='ptv-browse-card-title'>{title}</span>
            <span className='ptv-browse-card-meta'>{getBrowseMetadata(item)}</span>
        </a>
    );
}

function PtvBrowseSectionView({
    onFocusItem,
    section
}: Readonly<{
    onFocusItem: (sectionId: string, item: PtvItem) => void;
    section: PtvBrowseSection;
}>) {
    return (
        <section className={`ptv-browse-row is-${section.status}`}>
            <header className='ptv-browse-row-header'>
                <div>
                    <span className='ptv-browse-section-kicker'>{section.kicker}</span>
                    <h2>{section.title}</h2>
                </div>
            </header>
            {section.items.length ? (
                <div className='ptv-browse-card-rail'>
                    {section.items.map(item => (
                        <PtvBrowseCard
                            key={getText(item.Id)}
                            item={item}
                            onFocusItem={onFocusItem}
                            sectionId={section.id}
                        />
                    ))}
                </div>
            ) : (
                <div className='ptv-browse-row-empty'>
                    {section.status === 'loading' ? 'Loading...' : 'Nothing to show here yet.'}
                </div>
            )}
        </section>
    );
}

function PtvBrowseTagSection({ tags, title, type }: Readonly<{ tags: string[]; title: string; type: 'genre' | 'studio' }>) {
    return (
        <section className='ptv-browse-tag-section'>
            <header className='ptv-browse-row-header'>
                <div>
                    <span className='ptv-browse-section-kicker'>{type === 'genre' ? 'Genres' : 'Studios'}</span>
                    <h2>{title}</h2>
                </div>
            </header>
            {tags.length ? (
                <div className='ptv-browse-chip-grid'>
                    {tags.map(tag => (
                        <a
                            key={tag}
                            className='ptv-browse-chip'
                            href={`#/search?query=${encodeURIComponent(tag)}`}
                        >
                            {tag}
                        </a>
                    ))}
                </div>
            ) : (
                <div className='ptv-browse-row-empty'>More categories will appear as this section loads.</div>
            )}
        </section>
    );
}

function PtvBrowseDebugPanel({ diagnostics, state }: Readonly<{ diagnostics: PtvBrowseDiagnostic[]; state: PtvBrowseState }>) {
    const canShowDebug = usePtvAdminDebugVisibility();

    if (!canShowDebug) return null;

    return (
        <details className='ptv-browse-debug'>
            <summary>Browse diagnostics</summary>
            <dl>
                <dt>sectionCount</dt>
                <dd>{state.sections.length}</dd>
                <dt>heroItem</dt>
                <dd>{getText(state.heroItem?.Name) || 'none'}</dd>
                <dt>genres</dt>
                <dd>{state.tags.genres.join(', ') || 'none'}</dd>
                <dt>studios</dt>
                <dd>{state.tags.studios.join(', ') || 'none'}</dd>
            </dl>
            <div className='ptv-browse-debug-list'>
                {diagnostics.map(entry => (
                    <span key={entry.section}>
                        {entry.section}: {entry.status}, {entry.count} items, {entry.durationMs}ms
                    </span>
                ))}
            </div>
        </details>
    );
}

function NativeBrowsePage() {
    const location = useLocation();
    const config = useMemo(() => getPtvBrowseConfig(location.pathname, location.search), [location.pathname, location.search]);
    const memoryKey = useMemo(() => getPtvBrowseMemoryKey(location.pathname, location.search), [location.pathname, location.search]);
    const memoryRef = useRef<PtvBrowseMemory>(loadPtvBrowseMemory(memoryKey));
    const memoryRestoredRef = useRef(false);
    const [state, setState] = useState<PtvBrowseState>(EMPTY_BROWSE_STATE);
    const saveBrowseMemory = useCallback((updates: Partial<PtvBrowseMemory>) => {
        const nextMemory: PtvBrowseMemory = {
            ...memoryRef.current,
            ...updates,
            lastFilter: location.search || config.kind,
            updatedAt: Date.now()
        };

        memoryRef.current = nextMemory;
        savePtvBrowseMemory(memoryKey, nextMemory);
    }, [config.kind, location.search, memoryKey]);
    const handleBrowseItemFocus = useCallback((sectionId: string, item: PtvItem) => {
        saveBrowseMemory({
            focusedItemId: getText(item.Id),
            focusedSectionId: sectionId,
            scrollY: Math.max(0, Math.round(window.scrollY || document.documentElement.scrollTop || 0))
        });
    }, [saveBrowseMemory]);

    useEffect(() => {
        memoryRef.current = loadPtvBrowseMemory(memoryKey);
        memoryRestoredRef.current = false;
    }, [memoryKey]);

    useEffect(() => {
        let frame = 0;

        const saveScroll = () => {
            saveBrowseMemory({
                scrollY: Math.max(0, Math.round(window.scrollY || document.documentElement.scrollTop || 0))
            });
        };
        const handleScroll = () => {
            if (frame) return;

            frame = window.requestAnimationFrame(() => {
                frame = 0;
                saveScroll();
            });
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        window.addEventListener('pagehide', saveScroll);

        return () => {
            if (frame) window.cancelAnimationFrame(frame);
            saveScroll();
            window.removeEventListener('scroll', handleScroll);
            window.removeEventListener('pagehide', saveScroll);
        };
    }, [saveBrowseMemory]);

    useEffect(() => {
        let isMounted = true;
        const startedAt = performance.now();

        async function loadBrowsePage() {
            setState({
                ...EMPTY_BROWSE_STATE,
                isLoading: true
            });

            const featured = await fetchBrowseItems('featured', getBaseQuery(config, {
                Limit: 20,
                SortBy: 'Random'
            }));

            if (!isMounted) return;

            setState({
                diagnostics: [featured.diagnostic],
                error: '',
                heroItem: featured.items[0] || null,
                isLoading: true,
                sections: getInitialSections(config, featured.items),
                tags: {
                    genres: getDistinctTags(featured.items, 'Genres'),
                    studios: getDistinctTags(featured.items, 'Studios')
                }
            });

            const [resume, recommendations, recentlyAdded, browse, collections] = await Promise.all([
                fetchBrowseResumeItems('continue', getBaseQuery(config, {
                    IncludeItemTypes: config.continueIncludeItemTypes,
                    Limit: 20,
                    SortBy: 'DatePlayed',
                    SortOrder: 'Descending'
                })),
                fetchBrowseItems('recommendations', getBaseQuery(config, {
                    Limit: 20,
                    SortBy: 'Random'
                })),
                fetchBrowseItems('recently-added', getBaseQuery(config, {
                    Limit: 20,
                    SortBy: 'DateCreated',
                    SortOrder: 'Descending'
                })),
                fetchBrowseItems('browse', getBaseQuery(config, {
                    Limit: 50,
                    SortBy: 'SortName',
                    SortOrder: 'Ascending'
                })),
                fetchBrowseItems('collections', getBaseQuery({
                    ...config,
                    genreFilter: '',
                    includeItemTypes: 'BoxSet'
                }, {
                    Limit: 24,
                    SortBy: 'SortName',
                    SortOrder: 'Ascending'
                }))
            ]);

            if (!isMounted) return;

            const allItems = dedupeBrowseItems([
                ...featured.items,
                ...resume.items,
                ...recommendations.items,
                ...recentlyAdded.items,
                ...browse.items,
                ...collections.items
            ]);
            const diagnostics = [
                featured.diagnostic,
                resume.diagnostic,
                recommendations.diagnostic,
                recentlyAdded.diagnostic,
                browse.diagnostic,
                collections.diagnostic
            ];

            setState({
                diagnostics,
                error: diagnostics.some(entry => entry.status === 'error') ? 'Some shelves could not be loaded.' : '',
                heroItem: featured.items[0] || recentlyAdded.items[0] || recommendations.items[0] || null,
                isLoading: false,
                sections: getCompleteSections(
                    config,
                    featured.items,
                    resume.items,
                    recommendations.items,
                    recentlyAdded.items,
                    browse.items,
                    collections.items
                ),
                tags: {
                    genres: getDistinctTags(allItems, 'Genres'),
                    studios: getDistinctTags(allItems, 'Studios')
                }
            });

            if (shouldCollectDiagnostics()) {
                recordPtvEvent('route', 'browse-page-loaded', {
                    durationMs: Number((performance.now() - startedAt).toFixed(1)),
                    kind: config.kind,
                    sectionCount: diagnostics.length,
                    title: config.title
                });
            }
        }

        void loadBrowsePage();

        return () => {
            isMounted = false;
        };
    }, [config]);

    useEffect(() => {
        if (memoryRestoredRef.current || !state.sections.length) return undefined;

        const memory = memoryRef.current;
        memoryRestoredRef.current = true;

        if (!memory.scrollY && !memory.focusedItemId) return undefined;

        const frame = window.requestAnimationFrame(() => {
            if (memory.scrollY) {
                window.scrollTo({
                    behavior: 'auto',
                    top: memory.scrollY
                });
            }

            if (memory.focusedItemId) {
                const focusedNode = Array.from(document.querySelectorAll<HTMLElement>('[data-ptv-browse-item-id]'))
                    .find(node => node.dataset.ptvBrowseItemId === memory.focusedItemId);

                focusedNode?.focus({ preventScroll: true });
            }

            if (shouldCollectDiagnostics()) {
                recordPtvEvent('route', 'browse-page-memory-restored', {
                    focusedItemId: memory.focusedItemId || null,
                    focusedSectionId: memory.focusedSectionId || null,
                    kind: config.kind,
                    lastFilter: memory.lastFilter || null,
                    scrollY: memory.scrollY
                });
            }
        });

        return () => window.cancelAnimationFrame(frame);
    }, [config.kind, state.sections.length]);

    return (
        <Page
            id='ptv-native-browse-page'
            title={`${PTV_BRANDING.appName} ${config.title}`}
            className='ptv-native-browse-page'
            isBackButtonEnabled={false}
            isMenuButtonEnabled={false}
            isNowPlayingBarEnabled={false}
            isThemeMediaSupported={false}
        >
            <PTVShell
                className='ptv-browse-shell'
                section={getPtvBrowseShellSection(config)}
                title={config.title}
            >
                <PtvBrowseHero config={config} item={state.heroItem} />
                <main className='ptv-browse-content' aria-busy={state.isLoading}>
                    {state.error ? <div className='ptv-browse-error'>{state.error}</div> : null}
                    {state.sections.map(section => (
                        <PtvBrowseSectionView
                            key={section.id}
                            onFocusItem={handleBrowseItemFocus}
                            section={section}
                        />
                    ))}
                    <PtvBrowseTagSection title={`${config.title} Genres`} tags={state.tags.genres} type='genre' />
                    <PtvBrowseTagSection title={`${config.title} Studios`} tags={state.tags.studios} type='studio' />
                    <PtvBrowseDebugPanel diagnostics={state.diagnostics} state={state} />
                </main>
            </PTVShell>
        </Page>
    );
}

registerPtvNativeRoute('/movies', NativeBrowsePage, 'native');
registerPtvNativeRoute('/movies/*', NativeBrowsePage, 'native');
registerPtvNativeRoute('/shows', NativeBrowsePage, 'native');
registerPtvNativeRoute('/shows/*', NativeBrowsePage, 'native');
registerPtvNativeRoute('/tv', NativeBrowsePage, 'native');
registerPtvNativeRoute('/tv/*', NativeBrowsePage, 'native');
registerPtvNativeRoute('/collections', NativeBrowsePage, 'native');
registerPtvNativeRoute('/collections/*', NativeBrowsePage, 'native');

export default NativeBrowsePage;
