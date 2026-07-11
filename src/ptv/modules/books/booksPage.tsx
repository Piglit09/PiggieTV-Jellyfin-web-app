/* eslint-disable react/jsx-no-bind, no-void */
import React, {
    createContext,
    FormEvent,
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

import {
    hasPtvImageUrlFailed,
    markPtvImageUrlFailed,
    setPtvFavorite
} from '../../api';
import { PTV_ASSETS } from '../../core/config';
import { getPtvPerformanceProfile } from '../../core/clientProfile';
import { recordPtvEvent } from '../../core/observability';
import { scheduleRouteCheck } from '../../core/router';
import { resolvePtvStaticAssetUrl } from '../../core/urlOrigins';
import PTVShell from '../../shell/PTVShell';
import { getPtvRouteControllerState } from '../../shell/routeController';
import { usePtvAdminDebugVisibility } from '../../utils/usePtvAdminDebugVisibility';
import { PtvIcon } from '../icons';
import { loadReaderProgress } from '../reader/readerProgressStore';

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
import type {
    PtvReadingHomeData,
    PtvReadingItem,
    PtvReadingLibraryDebug,
    PtvReadingRouteKind,
    PtvReadingSection
} from './booksTypes';

type ReadingView = 'explore' | 'home' | 'item' | 'library';

type ReadingRouteState = Readonly<{
    id: string;
    kind: PtvReadingRouteKind;
    search: string;
    view: ReadingView;
}>;

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

const PTV_READING_LOGO_URL = resolvePtvStaticAssetUrl(PTV_ASSETS.logos.icon);
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
const failedReadingImageUrls = new Set<string>();
const failedReadingCoverItemIds = new Set<string>();
const failedReadingBackdropItemIds = new Set<string>();

function applyReadingImageFallbackToItem(itemId: string | undefined, fallbackUrl: string) {
    if (!itemId || typeof document === 'undefined') return;

    document.querySelectorAll<HTMLImageElement>('img[data-ptv-reading-item-id]').forEach(image => {
        if (image.dataset.ptvReadingItemId !== itemId) return;

        image.src = fallbackUrl;
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

function getReadingRoute(pathname: string, search: string): ReadingRouteState {
    const parts = pathname.split('/').filter(Boolean);
    const kind = getPtvReadingRouteKind(parts[0]);
    const viewSegment = parts[1] || 'home';
    const searchTerm = getQueryParam(search, 'search');

    if (viewSegment === 'explore') {
        return {
            id: '',
            kind,
            search: searchTerm,
            view: 'explore'
        };
    }

    if (viewSegment === 'library') {
        return {
            id: '',
            kind,
            search: searchTerm,
            view: 'library'
        };
    }

    if (viewSegment === 'item' || viewSegment === 'book') {
        return {
            id: decodeURIComponent(parts[2] || ''),
            kind,
            search: searchTerm,
            view: 'item'
        };
    }

    return {
        id: '',
        kind,
        search: searchTerm,
        view: 'home'
    };
}

function getRouteBase(kind: PtvReadingRouteKind) {
    return kind === 'manga' ? 'manga' : kind;
}

function getRouteTitle(kind: PtvReadingRouteKind) {
    if (kind === 'comics') return 'Comics';
    if (kind === 'manga') return 'Manga';

    return 'Books';
}

function getRouteKicker(kind: PtvReadingRouteKind) {
    if (kind === 'comics') return 'Comics library';
    if (kind === 'manga') return 'Manga library';

    return 'Reading library';
}

function getLibraryRouteKind(kind: string): PtvReadingRouteKind {
    if (kind === 'comic') return 'comics';
    if (kind === 'manga') return 'manga';

    return 'books';
}

function getLibraryKindLabel(kind: string) {
    if (kind === 'comic') return 'Comics';
    if (kind === 'manga') return 'Manga';

    return 'Books';
}

function getItemHref(item: PtvReadingItem, kind: PtvReadingRouteKind) {
    return item.Id ? `#/${getRouteBase(kind)}/item/${encodeURIComponent(item.Id)}` : `#/${getRouteBase(kind)}`;
}

function getLibraryHref(kind: PtvReadingRouteKind) {
    return `#/${getRouteBase(kind)}/library`;
}

function getDetailsHref(item: PtvReadingItem) {
    const serverParam = item.ServerId ? `&serverId=${encodeURIComponent(item.ServerId)}` : '';

    return item.Id ? `#/details?id=${encodeURIComponent(item.Id)}${serverParam}` : '#/home';
}

function getSection(homeData: PtvReadingHomeData, id: string) {
    return homeData.sections.find(section => section.id === id);
}

function getSectionItems(homeData: PtvReadingHomeData, id: string) {
    return getSection(homeData, id)?.items || [];
}

function getAllReadingItems(homeData: PtvReadingHomeData) {
    return uniquePtvReadingItems(homeData.sections.reduce<PtvReadingItem[]>((items, section) => items.concat(section.items), []));
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
        ...(routeKind === 'books' ? ['comics', 'manga'] : [])
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

function getKindLabel(item: PtvReadingItem) {
    const kind = getPtvReadingItemKind(item);

    if (kind === 'manga') return 'Manga';
    if (kind === 'comic') return 'Comic';

    return 'Book';
}

function getProgressLabel(item: PtvReadingItem) {
    const progress = loadReaderProgress(getPtvReadingStableId(item));

    if (!progress?.percent || progress.percent < 1) return '';

    return `${Math.round(progress.percent)}% read`;
}

function getMetadataProviderLabels(item: PtvReadingItem) {
    return getPtvReadingMetadataProviders(item).map(provider => provider.label);
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

        if (failedUrl && failedUrl !== getPtvReadingImagePlaceholder()) {
            failedReadingImageUrls.add(failedUrl);
            markPtvImageUrlFailed(failedUrl);
        }

        if (failedItemId) failedReadingCoverItemIds.add(failedItemId);

        applyReadingImageFallbackToItem(failedItemId, getPtvReadingImagePlaceholder());

        if (event.currentTarget.dataset.ptvFallbackApplied === 'true') {
            event.currentTarget.hidden = true;
            return;
        }

        event.currentTarget.dataset.ptvFallbackApplied = 'true';
        event.currentTarget.src = getPtvReadingImagePlaceholder();
    };
}

function getReadingBackdropErrorHandler() {
    return (event: React.SyntheticEvent<HTMLImageElement>) => {
        const failedUrl = event.currentTarget.currentSrc || event.currentTarget.src;
        const failedItemId = event.currentTarget.dataset.ptvReadingItemId;

        if (failedUrl && failedUrl !== PTV_READING_FALLBACK_BACKGROUND_URL) {
            failedReadingImageUrls.add(failedUrl);
            markPtvImageUrlFailed(failedUrl);
        }

        if (failedItemId) failedReadingBackdropItemIds.add(failedItemId);

        applyReadingImageFallbackToItem(failedItemId, PTV_READING_FALLBACK_BACKGROUND_URL || getPtvReadingImagePlaceholder());

        if (event.currentTarget.dataset.ptvFallbackApplied === 'true') {
            event.currentTarget.hidden = true;
            return;
        }

        event.currentTarget.dataset.ptvFallbackApplied = 'true';
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
    if (item?.Id && failedReadingCoverItemIds.has(item.Id)) return getPtvReadingImagePlaceholder();

    const imageUrl = getPtvReadingImageUrl(item, getReadingProfileImageSize(size), preferredImageType);

    if (!imageUrl || failedReadingImageUrls.has(imageUrl) || hasPtvImageUrlFailed(imageUrl)) return getPtvReadingImagePlaceholder();

    return imageUrl;
}

function getCachedReadingBackdropUrl(item: PtvReadingItem | null | undefined, size = 1200) {
    if (item?.Id && failedReadingBackdropItemIds.has(item.Id)) {
        return PTV_READING_FALLBACK_BACKGROUND_URL || getPtvReadingImagePlaceholder();
    }

    const imageUrl = getPtvReadingImageUrl(item, getReadingProfileImageSize(size, 640), 'Backdrop');

    if (!imageUrl || failedReadingImageUrls.has(imageUrl) || hasPtvImageUrlFailed(imageUrl)) {
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

function ReadingTopBar({ route }: Readonly<{
    route: ReadingRouteState;
}>) {
    const [searchTerm, setSearchTerm] = useState(route.search);
    const routeBase = getRouteBase(route.kind);
    const tabs = [
        {
            href: `#/${routeBase}`,
            id: 'home',
            label: getRouteTitle(route.kind)
        },
        {
            href: `#/${routeBase}/explore`,
            id: 'explore',
            label: 'Explore'
        },
        {
            href: `#/${routeBase}/library`,
            id: 'library',
            label: 'Library'
        }
    ];

    useEffect(() => {
        setSearchTerm(route.search);
    }, [route.search]);

    const onSubmit = (event: FormEvent) => {
        event.preventDefault();
        const normalizedSearchTerm = searchTerm.trim();

        window.location.hash = normalizedSearchTerm ?
            `#/${routeBase}/explore?search=${encodeURIComponent(normalizedSearchTerm)}` :
            `#/${routeBase}/explore`;
    };

    return (
        <header className='ptv-books-top'>
            <a className='ptv-books-brand' href={`#/${routeBase}`} aria-label={`${getRouteTitle(route.kind)} home`}>
                <span className='ptv-books-brand-mark'>
                    <img
                        alt=''
                        decoding='async'
                        loading='eager'
                        src={PTV_READING_LOGO_URL}
                    />
                </span>
                <strong>PiggieTV Reading</strong>
            </a>
            <form className='ptv-books-search' onSubmit={onSubmit}>
                <PtvIcon name='search' />
                <input
                    value={searchTerm}
                    onChange={event => setSearchTerm(event.target.value)}
                    placeholder='Search books, comics, manga'
                    aria-label='Search reading library'
                />
            </form>
            <nav className='ptv-books-top-tabs' aria-label='Reading tabs'>
                {tabs.map(tab => (
                    <a
                        key={tab.id}
                        className={route.view === tab.id ? 'ptv-books-top-tab-active' : ''}
                        href={tab.href}
                    >
                        {tab.label}
                    </a>
                ))}
            </nav>
            <div className='ptv-books-top-actions'>
                <a href='#/home' aria-label='Go to PiggieTV home' onClick={navigateToPtvHome}>
                    <PtvIcon name='home' />
                </a>
                <a href={`#/${routeBase}/library`} aria-label='Open reading library'>
                    <PtvIcon name='library' />
                </a>
                <a href='#/music' aria-label='Open music'>
                    <PtvIcon name='music' />
                </a>
            </div>
        </header>
    );
}

function ReadingSidebar({ homeData, route }: Readonly<{
    homeData: PtvReadingHomeData;
    route: ReadingRouteState;
}>) {
    const routeBase = getRouteBase(route.kind);
    const navItems = [
        {
            href: '#/home',
            icon: 'home',
            id: 'ptv-home',
            label: 'PTV Home'
        },
        {
            href: '#/books',
            icon: 'books',
            id: 'books',
            label: 'Books'
        },
        {
            href: '#/comics',
            icon: 'collections',
            id: 'comics',
            label: 'Comics'
        },
        {
            href: '#/manga',
            icon: 'anime',
            id: 'manga',
            label: 'Manga'
        },
        {
            href: `#/${routeBase}/explore`,
            icon: 'shuffle',
            id: 'explore',
            label: 'Explore'
        },
        {
            href: `#/${routeBase}/library`,
            icon: 'library',
            id: 'library',
            label: 'Library'
        }
    ];

    const activeId = route.view === 'home' ? route.kind : route.view;

    return (
        <aside className='ptv-books-sidebar' aria-label='Reading navigation'>
            <nav className='ptv-books-sidebar-nav'>
                {navItems.map(item => (
                    <a
                        key={item.id}
                        className={activeId === item.id ? 'ptv-books-nav-active' : ''}
                        href={item.href}
                        onClick={item.id === 'ptv-home' ? navigateToPtvHome : undefined}
                    >
                        <PtvIcon name={item.icon} />
                        <span>{item.label}</span>
                    </a>
                ))}
            </nav>
            <div className='ptv-books-sidebar-libraries'>
                <p className='ptv-books-sidebar-heading'>Libraries</p>
                {homeData.libraries.slice(0, 18).map(library => (
                    <a key={library.id} href={`#/${getRouteBase(getLibraryRouteKind(library.kind))}/library`}>
                        <strong>{library.name}</strong>
                        <span>{getLibraryKindLabel(library.kind)}</span>
                    </a>
                ))}
                {!homeData.libraries.length ? (
                    <p className='ptv-books-sidebar-empty'>No Jellyfin book libraries found</p>
                ) : null}
            </div>
        </aside>
    );
}

function ReadingChips({ homeData, routeKind }: Readonly<{
    homeData: PtvReadingHomeData;
    routeKind: PtvReadingRouteKind;
}>) {
    const routeBase = getRouteBase(routeKind);
    const genres = Array.from(new Set(getAllReadingItems(homeData).reduce<string[]>((items, item) => items.concat(getPtvReadingGenres(item)), [])));
    const routeChip = routeKind === 'comics' ? 'Comics' : routeKind === 'manga' ? 'Manga' : 'Books';
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
    const [isFavorite, setFavorite] = useState(Boolean(item.UserData?.IsFavorite));
    const title = getPtvReadingTitle(item);
    const href = getItemHref(item, routeKind);
    const meta = getItemMeta(item);

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
            <button type='button' className='ptv-books-card-cover' onClick={() => void readPtvItem(item)} aria-label={`Read ${title}`}>
                <img
                    alt=''
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
                <a href={href} aria-label={`Open ${title}`}>
                    <PtvIcon name='books' />
                </a>
                <button
                    type='button'
                    className={isFavorite ? 'ptv-books-favorited' : ''}
                    onClick={toggleFavorite}
                    aria-label={`${isFavorite ? 'Unfavorite' : 'Favorite'} ${title}`}
                >
                    <PtvIcon name='favorite' />
                </button>
            </div>
            <ReadingAdminActions item={item} compact />
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
                    <span>{homeData.stats.itemCount} items</span>
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

function ReadingLibraryDebugPanel({ cacheDiagnostics, debug }: Readonly<{
    cacheDiagnostics?: PtvReadingHomeData['cacheDiagnostics'];
    debug?: PtvReadingLibraryDebug;
}>) {
    const { canShowDebug } = useReadingAdminControls();

    if (!canShowDebug) return null;
    if (!debug) return null;

    const debugRows = [
        ['selectedReadingLibraryIds', debug.selectedReadingLibraryIds.join(', ') || 'none'],
        ['readingLibraryNames', debug.readingLibraryNames.join(', ') || 'none'],
        ['routeKind', debug.routeKind],
        ['jellyfinItemTotal', debug.jellyfinItemTotal],
        ['jellyfinRouteItemTotal', debug.jellyfinRouteItemTotal],
        ['fetchedItemCount', debug.fetchedItemCount],
        ['totalRecordCountFromApi', debug.totalRecordCountFromApi],
        ['pageSize', debug.pageSize],
        ['pageCount', debug.pageCount],
        ['requestDurationMs', debug.requestDurationMs ?? 'n/a'],
        ['statusCode', debug.statusCode ?? 'n/a'],
        ['timeoutReason', debug.timeoutReason || 'none'],
        ['cacheStatus', cacheDiagnostics?.status || 'none'],
        ['cacheSource', cacheDiagnostics?.source || 'none'],
        ['cacheStaleHit', cacheDiagnostics ? String(cacheDiagnostics.staleHit) : 'none'],
        ['cacheRefreshDurationMs', cacheDiagnostics?.refreshDurationMs ?? 'n/a'],
        ['cachePayloadSize', cacheDiagnostics?.payloadSize ?? 0],
        ['cacheItemCount', cacheDiagnostics?.itemCount ?? 0],
        ['lastReadingQueryUrl', debug.lastReadingQueryUrl || 'none'],
        ['failedCoverUrlCount', failedReadingImageUrls.size],
        ['failedCoverUrls', Array.from(failedReadingImageUrls).slice(-5).join(' | ') || 'none'],
        ['droppedItemCount', debug.droppedItemCount],
        ['kindCounts', JSON.stringify(debug.kindCounts)],
        ['libraryDiagnostics', debug.libraryDiagnostics.map(entry => `${entry.name} (${entry.id}) type=${entry.collectionType || 'unknown'} count=${entry.itemCount} status=${entry.statusCode ?? 'n/a'} duration=${entry.requestDurationMs ?? 'n/a'}ms url=${entry.lastQueriedUrl || 'none'} timeout=${entry.timeoutReason || 'none'}`).join(' | ') || 'none'],
        ['sectionDiagnostics', debug.sectionDiagnostics.map(entry => `${entry.title} status=${entry.status} count=${entry.itemCount} duration=${entry.requestDurationMs ?? 'n/a'}ms url=${entry.lastQueriedUrl || 'none'} timeout=${entry.timeoutReason || 'none'}`).join(' | ') || 'none'],
        ['dropReasons', debug.dropReasons.length ? debug.dropReasons.join(' | ') : 'none']
    ];

    return (
        <details className='ptv-books-library-debug'>
            <summary>Reading library debug</summary>
            <dl>
                {debugRows.map(([label, value]) => (
                    <React.Fragment key={String(label)}>
                        <dt>{label}</dt>
                        <dd>{String(value)}</dd>
                    </React.Fragment>
                ))}
            </dl>
        </details>
    );
}

function ReadingLibraryView({ homeData, routeKind }: Readonly<{
    homeData: PtvReadingHomeData;
    routeKind: PtvReadingRouteKind;
}>) {
    const libraryItems = getSectionItems(homeData, 'library');
    const librarySection = getSection(homeData, 'library');
    const metadataProviderSummaryLabels = getMetadataProviderSummaryLabels(homeData);

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
                    {homeData.stats.metadata.itemCount ? <span>{homeData.stats.metadata.itemCount} enriched</span> : null}
                    {metadataProviderSummaryLabels.map(label => (
                        <span key={label}>{label}</span>
                    ))}
                </div>
            </section>
            <ReadingLibraryDebugPanel cacheDiagnostics={homeData.cacheDiagnostics} debug={homeData.libraryDebug} />
            {homeData.isPartial && !libraryItems.length && !librarySection?.error ? (
                <ReadingLoading label='Loading library shelf' />
            ) : null}
            {librarySection?.error ? (
                <ReadingError message={librarySection.error} />
            ) : null}
            {homeData.isPartial && !libraryItems.length ? null : (
                <ReadingGrid items={libraryItems.length ? libraryItems : getAllReadingItems(homeData)} routeKind={routeKind} />
            )}
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

    return (
        <div className='ptv-books-view ptv-books-detail-view'>
            <section className='ptv-books-detail-hero'>
                <img
                    alt=''
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
            {item.Overview ? (
                <section className='ptv-books-overview'>
                    <p>{item.Overview}</p>
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
    const readingRequestIdRef = useRef(0);
    const [homeData, setHomeData] = useState<PtvReadingHomeData>(EMPTY_HOME_DATA);
    const [searchResults, setSearchResults] = useState<PtvReadingItem[]>([]);
    const [itemDetail, setItemDetail] = useState<ItemDetailState>(getInitialItemDetail);
    const { canShowDebug, debugEnabled, isAdmin } = usePtvAdminDebugVisibility();
    const [isLoading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState('');
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

        return fetchPtvReadingLibraryIndex(kind, { forceRefresh })
            .then(libraryIndex => {
                if (
                    !readingMountedRef.current
                    || ownerRequestId !== readingRequestIdRef.current
                    || libraryRequestId !== readingLibraryIndexRequestIdRef.current
                ) {
                    return;
                }

                setHomeData(previous => (
                    previous.kind === kind ? mergePtvReadingLibraryIndex(previous, libraryIndex) : previous
                ));
                recordPtvEvent('api', 'reading-library-index-background-loaded', {
                    itemCount: libraryIndex.items.length,
                    kind,
                    libraryDebug: libraryIndex.debug
                });
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
        const loadFullReadingData = () => {
            void getPtvReadingHome(route.kind, { forceRefresh })
                .then(nextHomeData => {
                    if (!isCurrentRequest()) return;

                    recordReadingLoadMetrics(nextHomeData, 'background-home-refresh');
                    setHomeData(nextHomeData);
                })
                .catch(error => {
                    recordPtvEvent('render', 'reading-page-error', {
                        error: getReadingErrorMessage(error),
                        kind: route.kind,
                        stage: 'reading-shell-background-data'
                    });
                });
        };

        return getPtvReadingHome(route.kind, { forceRefresh, initialOnly: true })
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
                    window.setTimeout(() => {
                        if (isCurrentRequest()) loadFullReadingData();
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
            .then(() => {
                invalidatePtvReadingHomeCache();
                void loadReadingData(true);

                if (route.view === 'item' && route.id === itemId) {
                    void refreshReadingItemDetail(itemId);
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
        readingMountedRef.current = true;
        document.documentElement.classList.add('ptv-route-reading-mounted');
        document.body.classList.add('ptv-route-reading-mounted');
        document.documentElement.dataset.ptvReadingRouteMounted = 'true';
        document.body.dataset.ptvReadingRouteMounted = 'true';
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
            readingRequestIdRef.current += 1;
            cleanupReadingRouteState();
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

        recordPtvEvent('render', 'reading-page-rendered', {
            itemCount: homeData.stats.itemCount,
            kind: route.kind,
            route: route.view,
            sectionCount: homeData.sections.length
        });
        verifyReadingShell();
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
                return <ReadingLibraryView homeData={homeData} routeKind={route.kind} />;
            case 'item':
                return <ItemDetailView detail={itemDetail} routeKind={route.kind} />;
            case 'home':
            default:
                return <ReadingHomeView homeData={homeData} onRetrySection={retryReadingSection} routeKind={route.kind} />;
        }
    };

    return (
        <Page
            id='ptvBooksPage'
            title={getRouteTitle(route.kind)}
            className='mainAnimatedPage type-interior ptv-books-page'
            isMenuButtonEnabled
        >
            <PTVShell className='ptv-books-shell' section='reading' title='Reading'>
                <main
                    className={`ptv-books-app ptv-books-app-shell ptv-books-route-${route.view} ptv-books-kind-${route.kind}${performanceProfile.isLowPower ? ' ptv-books-low-power' : ''}`}
                    data-ptv-client-profile={performanceProfile.clientKind}
                    data-ptv-render-profile={performanceProfile.renderProfile.id}
                >
                    <ReadingPageBackdrop item={heroItem} route={route.kind} />
                    <div className='ptv-books-body'>
                        <ReadingSidebar homeData={homeData} route={route} />
                        <section className='ptv-books-main' aria-label='PiggieTV Reading'>
                            <div className='ptv-books-main-scroll'>
                                <div className='ptv-books-main-toolbar'>
                                    <div>
                                        <p className='ptv-books-kicker'>PiggieTV</p>
                                        <h1>{route.view === 'home' ? getRouteTitle(route.kind) : route.view}</h1>
                                        {homeData.libraries.length ? (
                                            <span className='ptv-books-toolbar-sync'>
                                                {homeData.libraries.map(library => library.name).slice(0, 3).join(' - ')}
                                            </span>
                                        ) : null}
                                    </div>
                                    {isAdmin ? (
                                        <button type='button' onClick={refresh}>
                                            <PtvIcon name='refresh' />
                                            <span>Refresh</span>
                                        </button>
                                    ) : null}
                                </div>
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
