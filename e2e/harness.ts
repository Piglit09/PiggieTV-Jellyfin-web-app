/* eslint-disable @stylistic/operator-linebreak, compat/compat, no-nested-ternary, sonarjs/cognitive-complexity, sonarjs/no-nested-conditional, sonarjs/no-nested-functions -- The deterministic harness keeps explicit stage-to-contract mappings visible and targets Playwright Chromium only. */

import {
    isPtvAuthenticationRoute,
    shouldMountPtvAuthenticatedHeader
} from '../src/ptv/shell/authenticationRoutes';
import { parsePtvBrowseRoute } from '../src/ptv/pages/browse/browseRoute';
import {
    getPtvSearchFilterConfig,
    normalizePtvSearchFilter,
    PTV_SEARCH_FILTERS,
    serializePtvSearchParams,
    type PtvSearchGroupId
} from '../src/ptv/pages/search/nativeSearchState';
import type { NativeHomeRow } from '../src/ptv/pages/home/hooks';
import {
    applyPtvRecommendationFeedback,
    filterPtvRecommendationCandidates,
    getPtvRecommendationFeedbackTerms,
    normalizePtvRecommendationFeedbackState,
    undoPtvRecommendationFeedback
} from '../src/ptv/modules/recommendations/feedback/recommendationFeedback';
import type {
    PtvRecommendationFeedbackAction,
    PtvRecommendationFeedbackState,
    PtvRecommendationItem
} from '../src/ptv/modules/recommendations/types/recommendationTypes';
import {
    getPtvFocusedBrowseLoaderKey,
    PtvFocusedBrowseLoadOwner,
    type PtvFocusedBrowseLoaderScope
} from '../src/ptv/pages/browse/focusedBrowseLoader';
import { PtvUpdateService } from '../src/ptv/services/updateService';
import { getPtvRouteOwnership } from '../src/ptv/shell/routes';
import {
    getPtvDropdownOverlayPosition,
    getPtvDropdownViewport,
    hasPtvDropdownPointerMoved
} from '../src/ptv/shell/primaryNavigationDropdown';
import { preparePtvDetailsLayout } from '../src/ptv/modules/details/detailsLayout';
import {
    createPtvDiagnosticHealth,
    type PtvFocusGraphDiagnostic,
    type PtvFocusScopeDiagnostic,
    type PtvRemoteInputSource,
    type PtvRemoteInputStage,
    type PtvSafeRemoteAction
} from '../src/ptv/core/diagnostics/diagnosticContracts';
import { detectPtvTvClientFromSignals } from '../src/ptv/core/clientProfile';
import {
    classifyPtvTvFocusElement,
    getPtvTvNavigationSnapshot,
    getPtvSafeFocusFingerprint,
    notifyPtvTvFocusContentReady,
    subscribePtvTvNavigation,
    syncPtvTvFocusEngine
} from '../src/ptv/core/tvFocus';
import { getPtvDiagnosticStore } from '../src/ptv/services/diagnostics/diagnosticStore';
import '../src/ptv/modules/details/details.scss';
import '../src/ptv/modules/music/music.scss';
import '../src/ptv/pages/home/homeCustomizationDialog.scss';
import '../src/ptv/pages/home/nativeHome.scss';
import '../src/ptv/pages/search/nativeSearch.scss';
import '../src/ptv/shell/ptvShell.scss';
import '../src/ptv/styles/profiles/tv.scss';
import '../src/ptv/styles/profiles/webos.scss';

const root = document.getElementById('app');

if (!root) throw new Error('PiggieTV browser harness root is missing.');

const style = document.createElement('style');

style.textContent = `
    * { box-sizing: border-box; }
    html { min-height: 100%; background: #090812; color: #fff; font-family: sans-serif; }
    body { min-height: 140vh; margin: 0; }
    button, a { min-height: 2.75rem; }
    .authenticated-header { display: grid; }
    .primary-navigation-header { position: relative; z-index: 50; padding: 1rem; background: #211635; }
    .primary-navigation-scroll { display: flex; gap: .75rem; overflow-x: auto; overflow-y: hidden; padding: .5rem; backdrop-filter: blur(18px); }
    .primary-navigation-trigger { flex: 0 0 auto; min-width: 7rem; border: 1px solid #7955a5; border-radius: 1.4rem; color: #fff; background: #2b1b42; }
    .primary-navigation-panel { position: fixed; z-index: 10050; display: grid; gap: .25rem; overflow-y: auto; padding: .65rem; border: 1px solid #a77ad8; border-radius: 1rem; background: rgba(35, 20, 57, .96); box-shadow: 0 1rem 3rem rgba(0, 0, 0, .55); }
    .primary-navigation-panel a { display: flex; align-items: center; padding: .25rem .75rem; color: #fff; text-decoration: none; }
    .auth-card, .browse-page { margin: 5rem auto; width: min(90%, 60rem); padding: 2rem; border: 1px solid #7955a5; }
    .browse-items { display: flex; gap: 1rem; overflow-x: auto; }
    .browse-card { flex: 0 0 10rem; padding: 1rem; background: #2b1b42; }
    .directory-mode { display: flex; gap: 1rem; }
    .is-active { outline: 3px solid #bc7cff; }
    #diagnostics { padding: 1rem; background: #16101f; }
    #update-notice { position: fixed; z-index: 12000; right: 1rem; bottom: 1rem; padding: 1rem; background: #321c4f; }
    body.ptv-e2e-details { min-height: 100vh; }
    body.ptv-e2e-details .authenticated-header { position: fixed; z-index: 9500; }
    .itemDetailPage .itemBackdrop { position: relative; height: 40vh; background: linear-gradient(135deg, #203b56, #47205d); }
    .itemDetailPage .detailPageWrapperContainer { display: flex; flex-direction: column; min-height: 60vh; }
    .itemDetailPage .detailRibbon { height: 7.2em; margin-top: -7.2em; padding-left: 32.45vw; }
    .itemDetailPage .detailPagePrimaryContent { padding-right: 2%; padding-left: 32.45vw; }
    .itemDetailPage .detailLogo { position: absolute; top: 10vh; right: 25vw; }
    .itemDetailPage .detailImageContainer .card { position: relative; top: -12.96em; left: 3.3%; width: 25vw; margin-bottom: -12.96em; }
    .detail-poster-fixture { display: grid; aspect-ratio: 2 / 3; place-items: center; min-height: 18rem; background: linear-gradient(145deg, #69469e, #171027); font-size: 1.5rem; }
    .detail-shelf-fixture { display: flex; gap: 1rem; overflow-x: auto; }
    .detail-shelf-fixture > div { flex: 0 0 10rem; min-height: 7rem; padding: 1rem; background: #2b1b42; }
    .ptv-e2e-native-home { display: grid; gap: 1.5rem; width: min(100%, 96rem); margin: 0 auto; padding: 7rem 2rem 4rem; }
    .ptv-e2e-native-home-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
    .ptv-e2e-native-home-toolbar h1 { margin: 0; }
    .ptv-e2e-native-home-toolbar button,
    .ptv-e2e-native-home button { border: 1px solid #9c70d0; border-radius: .75rem; color: #fff; background: #2b1b42; }
    .ptv-e2e-native-home-hero { display: grid; min-height: 15rem; align-content: end; padding: 2rem; border-radius: 1.5rem; background: linear-gradient(135deg, #673b9b, #171027 70%); }
    .ptv-e2e-native-home-hero[hidden] { display: none; }
    .ptv-e2e-native-home-rows { display: grid; gap: 1.5rem; }
    .ptv-e2e-native-home-row { display: grid; gap: .75rem; }
    .ptv-e2e-native-home-row h2 { margin: 0; }
    .ptv-e2e-native-home-rail { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; }
    .ptv-e2e-native-home-card { display: grid; min-width: 0; min-height: 10rem; align-content: end; gap: .5rem; padding: 1rem; border: 1px solid rgba(187, 126, 255, .5); border-radius: 1rem; background: linear-gradient(145deg, #452867, #171027); }
    .ptv-e2e-native-home-card strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ptv-e2e-native-home-card button { justify-self: start; }
    .ptv-e2e-native-home.is-density-compact .ptv-e2e-native-home-rows { gap: .75rem; }
    .ptv-e2e-native-home.is-density-compact .ptv-e2e-native-home-card { min-height: 7rem; padding: .7rem; }
    .ptv-e2e-home-feedback-notice { display: flex; align-items: center; gap: .75rem; }
    .ptv-e2e-home-feedback-notice[hidden] { display: none; }
    .ptv-e2e-item-action-backdrop { position: fixed; z-index: 11000; inset: 0; display: grid; place-items: center; padding: 1rem; background: rgba(4, 2, 9, .72); }
    .ptv-e2e-item-action-menu { display: grid; width: min(28rem, 100%); gap: .5rem; padding: 1.25rem; border: 1px solid #a77ad8; border-radius: 1rem; background: #211635; box-shadow: 0 1rem 3rem rgba(0, 0, 0, .55); }
    .ptv-e2e-item-action-menu h2 { margin: 0 0 .5rem; }
    .ptv-e2e-item-action-menu button { width: 100%; text-align: left; }
    .hide-desktop { display: none; }
    @media (max-width: 900px) {
        .hide-mobile { display: none !important; }
        .hide-desktop { display: block; }
        .ptv-e2e-native-home { padding: 6rem 1rem 3rem; }
        .ptv-e2e-native-home-toolbar { align-items: flex-start; flex-direction: column; }
        .ptv-e2e-native-home-rail { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 520px) {
        .ptv-e2e-native-home-rail { grid-template-columns: 1fr; }
    }
`;
document.head.append(style);

const scope: PtvFocusedBrowseLoaderScope = {
    alias: '',
    libraryIds: [],
    status: 'unscoped'
};
const loadOwner = new PtvFocusedBrowseLoadOwner();
const scrollPositions = new Map<string, number>();
let activeHash = '';
let renderedIds: string[] = [];
let cleanupPrimaryNavigation = () => undefined;
let cleanupDiagnosticsDashboard = () => undefined;
let cleanupSearch = () => undefined;
let cleanupHome = () => undefined;
const diagnosticStore = getPtvDiagnosticStore();

const SEARCH_FIXTURE_GROUPS: Readonly<Record<PtvSearchGroupId, Readonly<{
    itemType: string;
    title: string;
}>>> = {
    albums: { itemType: 'MusicAlbum', title: 'Albums' },
    artists: { itemType: 'MusicArtist', title: 'Artists' },
    collections: { itemType: 'BoxSet', title: 'Collections' },
    episodes: { itemType: 'Episode', title: 'Episodes' },
    movies: { itemType: 'Movie', title: 'Movies' },
    music: { itemType: 'Audio', title: 'Songs' },
    people: { itemType: 'Person', title: 'People' },
    reading: { itemType: 'Book', title: 'Reading' },
    shows: { itemType: 'Series', title: 'Shows' }
};
const retriedFixtureSearches = new Set<string>();
const HOME_FIXTURE_STORAGE_PREFIX = 'ptv:e2e:home-preferences:';

type FixtureHomeScope = {
    serverId: string;
    userId: string;
};

type FixtureHomeLayout = {
    density: 'compact' | 'comfortable';
    heroEnabled: boolean;
    rowOrder: string[];
    rowVisibility: Record<string, boolean>;
};

type FixtureHomePreferenceDocument = {
    feedback: PtvRecommendationFeedbackState;
    layout: FixtureHomeLayout;
    schemaVersion: 1;
    scope: FixtureHomeScope;
    updatedAt: number;
};

type FixtureHomeCustomizationRow = Readonly<{
    id: string;
    title: string;
}>;

function createFixtureHomeItem(
    id: string,
    name: string,
    genres: readonly string[]
): NativeHomeRow['items'][number] {
    return {
        Genres: [...genres],
        Id: id,
        Name: name,
        ServerId: 'fixture-server',
        Type: 'Movie',
        UserData: {
            Played: false
        }
    } as NativeHomeRow['items'][number];
}

const HOME_FIXTURE_ROWS: NativeHomeRow[] = [{
    id: 'continue-watching',
    items: [
        createFixtureHomeItem('fixture-resume-1', 'Continue One', ['Drama']),
        createFixtureHomeItem('fixture-resume-2', 'Continue Two', ['Comedy'])
    ],
    kind: 'items',
    source: 'resume',
    subtitle: 'Resume where you left off',
    title: 'Continue Watching'
}, {
    id: 'recommended-for-you',
    items: [
        createFixtureHomeItem('fixture-recommendation-target', 'Recommended Pick One', ['Adventure', 'Mystery']),
        createFixtureHomeItem('fixture-recommendation-nearby', 'Recommended Pick Two', ['Adventure']),
        createFixtureHomeItem('fixture-recommendation-other', 'Recommended Pick Three', ['Science Fiction'])
    ],
    kind: 'items',
    renderedSource: 'recommendation-settings',
    rowType: 'generated-recommendation',
    source: 'recommendation',
    subtitle: 'Selected from this profile history',
    title: 'Recommended For You'
}, {
    id: 'because-you-watched',
    items: [
        createFixtureHomeItem('fixture-because-1', 'Because Pick One', ['Mystery']),
        createFixtureHomeItem('fixture-because-2', 'Because Pick Two', ['Thriller'])
    ],
    kind: 'items',
    renderedSource: 'recommendation-settings',
    rowType: 'generated-recommendation',
    source: 'because-you-watched',
    subtitle: 'Connected to recent viewing',
    title: 'Because You Watched'
}];

const HOME_CUSTOMIZATION_ROWS: FixtureHomeCustomizationRow[] = HOME_FIXTURE_ROWS.map(row => ({
    id: row.id,
    title: row.title
}));

function addElement<K extends keyof HTMLElementTagNameMap>(
    parent: HTMLElement,
    tagName: K,
    options: Readonly<{ className?: string; id?: string; text?: string }> = {}
) {
    const element = document.createElement(tagName);

    if (options.className) element.className = options.className;
    if (options.id) element.id = options.id;
    if (options.text) element.textContent = options.text;
    parent.append(element);
    return element;
}

function addFixtureIcon(parent: HTMLElement, size = 24) {
    const icon = addElement(parent, 'span', { className: 'ptv-icon' });

    icon.setAttribute('aria-hidden', 'true');
    icon.style.display = 'block';
    icon.style.flex = '0 0 auto';
    icon.style.height = `${size}px`;
    icon.style.setProperty('--ptv-icon-size', `${size}px`);
    icon.style.width = `${size}px`;
    return icon;
}

function getLocationState() {
    return {
        full: window.location.href,
        hash: window.location.hash,
        pathname: window.location.pathname,
        search: window.location.search
    };
}

function getHashRoute() {
    const value = (window.location.hash || '#/home').slice(1);
    const queryIndex = value.indexOf('?');

    return {
        path: queryIndex >= 0 ? value.slice(0, queryIndex) : value,
        search: queryIndex >= 0 ? value.slice(queryIndex) : ''
    };
}

function getFixtureItems(label: string) {
    return Array.from({ length: 4 }, (_value, index) => ({
        id: `${label.toLocaleLowerCase('en-US').replace(/\W+/g, '-')}-${index + 1}`,
        name: `${label} ${index + 1}`
    }));
}

function replaceFixtureSearchRoute(query: string, filter: string) {
    const search = serializePtvSearchParams(query, normalizePtvSearchFilter(filter));

    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/search?${search}`);
    renderRoute();
}

function getFixtureSearchItems(query: string, groupId: PtvSearchGroupId) {
    const group = SEARCH_FIXTURE_GROUPS[groupId];

    return Array.from({ length: 2 }, (_value, index) => ({
        id: `search-${groupId}-${index + 1}`,
        meta: `${group.itemType} | 2026`,
        name: `${query} ${group.title.slice(0, -1) || group.title} ${index + 1}`,
        type: group.itemType
    }));
}

function renderFixtureSearchGroup(
    results: HTMLElement,
    query: string,
    groupId: PtvSearchGroupId
) {
    const config = SEARCH_FIXTURE_GROUPS[groupId];
    const section = addElement(results, 'section', {
        className: 'ptv-search-group is-success'
    });
    const headingId = `ptv-search-group-${groupId}`;

    section.setAttribute('aria-labelledby', headingId);
    const header = addElement(section, 'header', { className: 'ptv-search-group-header' });
    const headingContainer = addElement(header, 'div');

    addElement(headingContainer, 'span', { text: `${config.title} results` });
    const heading = addElement(headingContainer, 'h2', { id: headingId, text: config.title });
    const rail = addElement(section, 'div', { className: 'ptv-search-card-rail' });

    heading.tabIndex = -1;
    getFixtureSearchItems(query, groupId).forEach(item => {
        const card = addElement(rail, 'a', { className: 'ptv-search-card' });

        card.dataset.ptvSearchItemId = item.id;
        card.dataset.ptvSearchItemType = item.type;
        card.dataset.ptvSearchSourceGroup = groupId;
        card.href = item.type === 'BoxSet' ?
            `#/collections?view=details&collectionId=${encodeURIComponent(`jellyfin:${item.id}`)}` :
            `#/details?id=${encodeURIComponent(item.id)}`;
        addElement(card, 'span', {
            className: 'ptv-search-card-art',
            text: item.name.slice(0, 1)
        });
        addElement(card, 'span', {
            className: 'ptv-search-card-title',
            text: item.name
        });
        addElement(card, 'span', {
            className: 'ptv-search-card-meta',
            text: item.meta
        });
    });
}

function renderSearch(search: string) {
    const params = new URLSearchParams(search);
    const query = (params.get('query') || '').trim();
    const activeFilter = normalizePtvSearchFilter(params.get('filter'));
    const activeFilterConfig = getPtvSearchFilterConfig(activeFilter);
    const queryReady = query.length >= 2;
    const normalizedQuery = query.toLocaleLowerCase('en-US');
    const isEmpty = queryReady && normalizedQuery.includes('no match');
    const isError = queryReady
        && normalizedQuery.includes('server error')
        && !retriedFixtureSearches.has(normalizedQuery);
    const page = addElement(root, 'main', {
        className: 'ptv-native-search-page ptv-search-page'
    });
    const hero = addElement(page, 'section', { className: 'ptv-search-hero' });

    addElement(hero, 'p', { text: 'PiggieTV' });
    addElement(hero, 'h1', { text: 'Search' });
    const form = addElement(hero, 'form', { className: 'ptv-search-hero-form' });
    const icon = addElement(form, 'span', { className: 'ptv-icon' });
    const input = addElement(form, 'input');

    form.setAttribute('role', 'search');
    icon.setAttribute('aria-hidden', 'true');
    input.setAttribute('aria-describedby', 'ptv-search-status');
    input.setAttribute('aria-label', 'Search PiggieTV');
    input.autocomplete = 'off';
    input.dataset.ptvFocusKey = 'search-input';
    input.dataset.ptvInitialFocus = 'search';
    input.inputMode = 'search';
    input.maxLength = 160;
    input.placeholder = 'Search movies, shows, people, music, reading';
    input.type = 'search';
    input.value = query;

    let debounce = 0;
    const commitInput = () => replaceFixtureSearchRoute(input.value.trim(), activeFilter);

    input.addEventListener('input', () => {
        window.clearTimeout(debounce);
        debounce = window.setTimeout(commitInput, 300);
    });
    form.addEventListener('submit', event => {
        event.preventDefault();
        window.clearTimeout(debounce);
        commitInput();
    });
    cleanupSearch = () => {
        window.clearTimeout(debounce);
        cleanupSearch = () => undefined;
    };

    const filters = addElement(hero, 'nav', { className: 'ptv-search-filters' });

    filters.setAttribute('aria-label', 'Search result filters');
    PTV_SEARCH_FILTERS.forEach(filter => {
        const button = addElement(filters, 'button', {
            className: activeFilter === filter.id ? 'is-active' : '',
            text: filter.label
        });

        button.type = 'button';
        button.dataset.ptvFocusKey = `search-filter-${filter.id}`;
        button.dataset.ptvSearchFilter = filter.id;
        button.setAttribute('aria-controls', 'ptv-search-results');
        button.setAttribute('aria-pressed', String(activeFilter === filter.id));
        button.addEventListener('click', () => replaceFixtureSearchRoute(query, filter.id));
    });

    const status = addElement(hero, 'p', {
        className: queryReady ? 'ptv-search-summary' : 'ptv-search-suggestions',
        id: 'ptv-search-status'
    });

    status.setAttribute('aria-atomic', 'true');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('role', 'status');
    status.textContent = queryReady
        ? isError
            ? `Search in ${activeFilterConfig.label} could not be completed.`
            : isEmpty
                ? `No results in ${activeFilterConfig.label} for "${query}".`
                : `${activeFilterConfig.groups.length * 2} results in ${activeFilterConfig.label} for "${query}".`
        : 'Start typing at least two characters.';

    if (queryReady && (isEmpty || isError)) {
        const feedback = addElement(page, 'section', {
            className: `ptv-search-result-state ${isError ? 'is-error' : 'is-empty'}`
        });
        const feedbackHeadingId = 'ptv-search-result-state-title';

        feedback.setAttribute('aria-labelledby', feedbackHeadingId);
        addElement(feedback, 'h2', {
            id: feedbackHeadingId,
            text: isError ? 'Search could not finish' : 'No matches found'
        });
        addElement(feedback, 'p', {
            text: isError
                ? 'The server did not return this result group. Try the search again.'
                : 'Try a shorter title, a creator name, or another result filter.'
        });
        const actions = addElement(feedback, 'div', {
            className: 'ptv-search-result-state-actions'
        });

        if (isError) {
            const retry = addElement(actions, 'button', { text: 'Try again' });

            retry.type = 'button';
            retry.addEventListener('click', () => {
                retriedFixtureSearches.add(normalizedQuery);
                renderRoute();
            });
        }
        const clear = addElement(actions, 'button', { text: 'Clear search' });

        clear.type = 'button';
        clear.addEventListener('click', () => replaceFixtureSearchRoute('', activeFilter));
    }

    const results = addElement(page, 'section', {
        className: 'ptv-search-groups',
        id: 'ptv-search-results'
    });

    results.setAttribute('aria-busy', 'false');
    results.setAttribute('aria-describedby', 'ptv-search-status');
    results.setAttribute('aria-label', `${activeFilterConfig.label} search results`);

    if (queryReady && !isEmpty && !isError) {
        activeFilterConfig.groups.forEach(groupId => {
            renderFixtureSearchGroup(results, query, groupId);
        });
    }

    if (
        window.innerWidth > 900
        && !window.matchMedia('(pointer: coarse)').matches
    ) {
        window.queueMicrotask(() => input.focus());
    }
}

function normalizeFixtureHomeIdentity(value: string | null, fallback: string) {
    const normalized = String(value || '')
        .trim()
        .replace(/[^a-z0-9._-]/gi, '')
        .slice(0, 48);

    return normalized || fallback;
}

function createDefaultFixtureHomePreferenceDocument(
    preferenceScope: FixtureHomeScope
): FixtureHomePreferenceDocument {
    return {
        feedback: normalizePtvRecommendationFeedbackState(null),
        layout: {
            density: 'comfortable',
            heroEnabled: true,
            rowOrder: [],
            rowVisibility: {}
        },
        schemaVersion: 1,
        scope: {
            ...preferenceScope
        },
        updatedAt: 0
    };
}

function normalizeFixtureHomeRowOrder(value: unknown) {
    if (!Array.isArray(value)) return [];

    return Array.from(new Set(value
        .filter((rowId): rowId is string => typeof rowId === 'string')
        .map(rowId => rowId.trim())
        .filter(rowId => HOME_FIXTURE_ROWS.some(row => row.id === rowId))));
}

function normalizeFixtureHomeRowVisibility(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

    return Object.fromEntries(
        Object.entries(value)
            .filter(([rowId, visible]) => (
                typeof visible === 'boolean'
                && HOME_FIXTURE_ROWS.some(row => row.id === rowId)
            ))
    ) as Record<string, boolean>;
}

function normalizeFixtureHomePreferenceDocument(
    value: unknown,
    preferenceScope: FixtureHomeScope
): FixtureHomePreferenceDocument {
    const defaults = createDefaultFixtureHomePreferenceDocument(preferenceScope);

    if (!value || typeof value !== 'object') return defaults;

    const candidate = value as Partial<FixtureHomePreferenceDocument>;
    const candidateScope = candidate.scope;

    if (
        candidate.schemaVersion !== 1
        || candidateScope?.serverId !== preferenceScope.serverId
        || candidateScope.userId !== preferenceScope.userId
    ) {
        return defaults;
    }

    const layout = candidate.layout && typeof candidate.layout === 'object'
        ? candidate.layout
        : defaults.layout;
    const updatedAt = Number(candidate.updatedAt);

    return {
        feedback: normalizePtvRecommendationFeedbackState(candidate.feedback),
        layout: {
            density: layout.density === 'compact' ? 'compact' : 'comfortable',
            heroEnabled: typeof layout.heroEnabled === 'boolean' ? layout.heroEnabled : true,
            rowOrder: normalizeFixtureHomeRowOrder(layout.rowOrder),
            rowVisibility: normalizeFixtureHomeRowVisibility(layout.rowVisibility)
        },
        schemaVersion: 1,
        scope: {
            ...preferenceScope
        },
        updatedAt: Number.isFinite(updatedAt) ? Math.max(0, Math.floor(updatedAt)) : 0
    };
}

function orderFixtureHomeCustomizationRows(
    rows: readonly FixtureHomeCustomizationRow[],
    rowOrder: readonly string[]
) {
    const rowsById = new Map(rows.map(row => [row.id, row]));

    return [
        ...rowOrder.map(rowId => rowsById.get(rowId))
            .filter((row): row is FixtureHomeCustomizationRow => Boolean(row)),
        ...rows.filter(row => !rowOrder.includes(row.id))
    ];
}

function moveFixtureHomeCustomizationRow(
    rows: readonly FixtureHomeCustomizationRow[],
    rowId: string,
    direction: 'down' | 'up'
) {
    const orderedRows = [...rows];
    const currentIndex = orderedRows.findIndex(row => row.id === rowId);

    if (currentIndex < 0) return orderedRows;

    const nextIndex = direction === 'up'
        ? Math.max(0, currentIndex - 1)
        : Math.min(orderedRows.length - 1, currentIndex + 1);

    if (nextIndex === currentIndex) return orderedRows;

    const [row] = orderedRows.splice(currentIndex, 1);

    orderedRows.splice(nextIndex, 0, row);
    return orderedRows;
}

function filterFixtureHomeRecommendationRows(
    rows: NativeHomeRow[],
    feedback: PtvRecommendationFeedbackState
) {
    return rows.flatMap(row => {
        if (row.source === 'resume') return [row];

        const items = filterPtvRecommendationCandidates(
            row.items as PtvRecommendationItem[],
            feedback
        ) as NativeHomeRow['items'];

        return items.length ? [{
            ...row,
            items
        }] : [];
    });
}

function decorateFixtureHomeRows(
    rows: NativeHomeRow[],
    layout: FixtureHomeLayout
) {
    const rowOrder = new Map(layout.rowOrder.map((rowId, index) => [rowId, index]));

    return rows
        .map((row, index) => ({
            index,
            row
        }))
        .filter(({ row }) => layout.rowVisibility[row.id] !== false)
        .sort((left, right) => {
            const leftOrder = rowOrder.get(left.row.id);
            const rightOrder = rowOrder.get(right.row.id);

            if (leftOrder != null && rightOrder != null) return leftOrder - rightOrder;
            if (leftOrder != null) return -1;
            if (rightOrder != null) return 1;

            return left.index - right.index;
        })
        .map(({ row }) => row);
}

function getFixtureHomeScope(): FixtureHomeScope {
    const params = new URLSearchParams(window.location.search);

    return {
        serverId: normalizeFixtureHomeIdentity(params.get('e2eServer'), 'fixture-server-a'),
        userId: normalizeFixtureHomeIdentity(params.get('e2eUser'), 'fixture-user-a')
    };
}

function getFixtureHomeStorageKey(preferenceScope: FixtureHomeScope) {
    return `${HOME_FIXTURE_STORAGE_PREFIX}${preferenceScope.serverId}:${preferenceScope.userId}`;
}

function loadFixtureHomePreferenceDocument(preferenceScope: FixtureHomeScope) {
    const rawValue = window.localStorage.getItem(getFixtureHomeStorageKey(preferenceScope));

    if (!rawValue) return createDefaultFixtureHomePreferenceDocument(preferenceScope);

    try {
        return normalizeFixtureHomePreferenceDocument(JSON.parse(rawValue), preferenceScope);
    } catch {
        return createDefaultFixtureHomePreferenceDocument(preferenceScope);
    }
}

function saveFixtureHomePreferenceDocument(
    document: FixtureHomePreferenceDocument,
    preferenceScope: FixtureHomeScope
) {
    const normalized = normalizeFixtureHomePreferenceDocument({
        ...document,
        updatedAt: Date.now()
    }, preferenceScope);

    window.localStorage.setItem(
        getFixtureHomeStorageKey(preferenceScope),
        JSON.stringify(normalized)
    );
    return normalized;
}

function getFixtureHomeFeedbackMessage(action: PtvRecommendationFeedbackAction) {
    if (action === 'hide-from-home') {
        return 'Hidden from Home. This title remains available in the library.';
    }
    if (action === 'show-fewer-like-this') {
        return 'PiggieTV will show fewer recommendations like this.';
    }

    return 'This title will no longer be recommended on Home.';
}

function getFixtureHomeFocusableElements(container: HTMLElement) {
    return Array.from(container.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    )).filter(element => !element.hidden);
}

function renderNativeHome() {
    const homeScope = getFixtureHomeScope();
    let preferenceDocument = loadFixtureHomePreferenceDocument(homeScope);
    let activeActionBackdrop: HTMLElement | null = null;
    let activeActionTrigger: HTMLButtonElement | null = null;
    let customizationBackdrop: HTMLElement | null = null;
    const page = addElement(root, 'main', {
        className: 'ptv-native-home ptv-e2e-native-home'
    });
    const toolbar = addElement(page, 'header', {
        className: 'ptv-e2e-native-home-toolbar'
    });
    const toolbarCopy = addElement(toolbar, 'div');

    addElement(toolbarCopy, 'span', { text: 'Personalized for this profile' });
    addElement(toolbarCopy, 'h1', { text: 'Home' });
    const customizeButton = addElement(toolbar, 'button', { text: 'Customize Home' });
    const feedbackNotice = addElement(page, 'div', {
        className: 'ptv-e2e-home-feedback-notice'
    });
    const hero = addElement(page, 'section', {
        className: 'ptv-native-home-hero ptv-e2e-native-home-hero'
    });
    const rowsHost = addElement(page, 'div', {
        className: 'ptv-native-home-rows ptv-e2e-native-home-rows'
    });

    customizeButton.type = 'button';
    customizeButton.dataset.ptvHomeCustomizeTrigger = 'true';
    feedbackNotice.setAttribute('aria-atomic', 'true');
    feedbackNotice.setAttribute('aria-live', 'polite');
    feedbackNotice.setAttribute('role', 'status');
    hero.dataset.ptvNativeHomeHero = 'true';
    hero.setAttribute('aria-label', 'Featured');
    page.dataset.ptvHomePreferenceServer = homeScope.serverId;
    page.dataset.ptvHomePreferenceUser = homeScope.userId;
    page.dataset.ptvPlaybackCallCount = '0';

    const closeActionMenu = (restoreFocus = true) => {
        const trigger = activeActionTrigger;

        activeActionBackdrop?.remove();
        activeActionBackdrop = null;
        activeActionTrigger = null;
        if (restoreFocus && trigger?.isConnected) trigger.focus();
    };
    const closeCustomization = (restoreFocus = true) => {
        customizationBackdrop?.remove();
        customizationBackdrop = null;
        if (restoreFocus && customizeButton.isConnected) customizeButton.focus();
    };
    const getRenderedRows = () => {
        const filteredRows = filterFixtureHomeRecommendationRows(
            HOME_FIXTURE_ROWS.map(row => ({
                ...row,
                items: [...row.items]
            })),
            preferenceDocument.feedback
        );

        return decorateFixtureHomeRows(
            filteredRows,
            preferenceDocument.layout
        );
    };
    const renderFeedbackNotice = () => {
        feedbackNotice.replaceChildren();
        const [currentFeedback] = preferenceDocument.feedback.entries;
        const canUndo = preferenceDocument.feedback.undoStack.length > 0;

        feedbackNotice.hidden = !canUndo;
        if (!canUndo) return;

        addElement(feedbackNotice, 'span', {
            text: currentFeedback
                ? getFixtureHomeFeedbackMessage(currentFeedback.action)
                : 'Recommendation feedback updated.'
        });
        const undo = addElement(feedbackNotice, 'button', { text: 'Undo' });

        undo.type = 'button';
        undo.addEventListener('click', () => {
            preferenceDocument = saveFixtureHomePreferenceDocument(
                {
                    ...preferenceDocument,
                    feedback: undoPtvRecommendationFeedback(preferenceDocument.feedback),
                    updatedAt: Date.now()
                },
                homeScope
            );
            applyDocument();
        });
    };
    const commitFeedback = (
        item: NativeHomeRow['items'][number],
        action: PtvRecommendationFeedbackAction
    ) => {
        const recommendationItem = item as PtvRecommendationItem;

        closeActionMenu(false);
        preferenceDocument = saveFixtureHomePreferenceDocument(
            {
                ...preferenceDocument,
                feedback: applyPtvRecommendationFeedback(preferenceDocument.feedback, {
                    action,
                    itemId: String(recommendationItem.Id || ''),
                    now: Date.now(),
                    terms: getPtvRecommendationFeedbackTerms(recommendationItem)
                }),
                updatedAt: Date.now()
            },
            homeScope
        );
        page.dataset.ptvLastHomeFeedbackAction = action;
        applyDocument();
    };
    const openActionMenu = (
        trigger: HTMLButtonElement,
        item: NativeHomeRow['items'][number]
    ) => {
        closeActionMenu(false);
        activeActionTrigger = trigger;
        const itemName = String(item.Name || 'item');
        const backdrop = addElement(page, 'div', {
            className: 'ptv-e2e-item-action-backdrop'
        });
        const menu = addElement(backdrop, 'section', {
            className: 'ptv-e2e-item-action-menu'
        });
        const headingId = 'ptv-e2e-item-actions-title';

        activeActionBackdrop = backdrop;
        backdrop.dataset.ptvItemActionOwner = 'canonical';
        menu.dataset.ptvItemActionMenu = 'canonical';
        menu.setAttribute('aria-labelledby', headingId);
        menu.setAttribute('aria-modal', 'true');
        menu.setAttribute('role', 'dialog');
        addElement(menu, 'h2', {
            id: headingId,
            text: `Actions for ${itemName}`
        });
        const close = addElement(menu, 'button', { text: 'Close' });

        close.type = 'button';
        close.setAttribute('aria-label', 'Close item actions');
        close.addEventListener('click', () => closeActionMenu());
        const details = addElement(menu, 'button', { text: 'View Details' });

        details.type = 'button';
        details.addEventListener('click', () => {
            closeActionMenu(false);
            window.location.hash = `#/details?id=${encodeURIComponent(String(item.Id || ''))}`;
        });

        const feedbackActions: ReadonlyArray<{
            action: PtvRecommendationFeedbackAction;
            label: string;
        }> = [{
            action: 'not-interested',
            label: 'Not Interested'
        }, {
            action: 'hide-from-home',
            label: 'Hide From Home'
        }, {
            action: 'show-fewer-like-this',
            label: 'Show Fewer Like This'
        }];

        feedbackActions.forEach(({ action, label }) => {
            const command = addElement(menu, 'button', { text: label });

            command.type = 'button';
            command.dataset.ptvHomeFeedbackAction = action;
            command.addEventListener('click', () => commitFeedback(item, action));
        });
        menu.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeActionMenu();
                return;
            }
            if (event.key !== 'Tab') return;

            const focusable = getFixtureHomeFocusableElements(menu);
            const first = focusable[0];
            const last = focusable.at(-1);

            if (!first || !last) return;

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });
        backdrop.addEventListener('mousedown', event => {
            if (event.target === backdrop) closeActionMenu();
        });
        window.queueMicrotask(() => close.focus());
    };
    const renderRows = () => {
        rowsHost.replaceChildren();

        getRenderedRows().forEach(row => {
            const section = addElement(rowsHost, 'section', {
                className: 'ptv-native-home-row ptv-e2e-native-home-row'
            });
            const headingId = `ptv-e2e-home-row-${row.id}`;

            section.dataset.ptvNativeRowId = row.id;
            section.setAttribute('aria-labelledby', headingId);
            addElement(section, 'h2', {
                id: headingId,
                text: row.title
            });
            addElement(section, 'p', { text: row.subtitle });
            const rail = addElement(section, 'div', {
                className: 'ptv-e2e-native-home-rail'
            });

            row.items.forEach(item => {
                const itemId = String(item.Id || '');
                const itemName = String(item.Name || 'Untitled');
                const card = addElement(rail, 'article', {
                    className: 'ptv-e2e-native-home-card'
                });

                card.dataset.ptvHomeItemId = itemId;
                addElement(card, 'strong', { text: itemName });
                const more = addElement(card, 'button', { text: 'More Actions' });

                more.type = 'button';
                more.dataset.ptvItemActionMenuTrigger = 'canonical';
                more.setAttribute('aria-label', `More Actions for ${itemName}`);
                more.addEventListener('click', () => openActionMenu(more, item));
            });
        });
    };
    const applyDocument = () => {
        page.className = [
            'ptv-native-home',
            'ptv-e2e-native-home',
            `is-density-${preferenceDocument.layout.density}`,
            preferenceDocument.layout.heroEnabled ? '' : 'is-hero-disabled'
        ].filter(Boolean).join(' ');
        page.dataset.ptvShelfDensity = preferenceDocument.layout.density;
        hero.hidden = !preferenceDocument.layout.heroEnabled;
        hero.replaceChildren();
        if (preferenceDocument.layout.heroEnabled) {
            addElement(hero, 'span', { text: 'Featured for you' });
            addElement(hero, 'h2', { text: 'A stable personalized hero' });
            addElement(hero, 'p', { text: 'Selected without delaying the first shelf.' });
        }
        renderFeedbackNotice();
        renderRows();
    };
    const commitLayout = (layout: FixtureHomePreferenceDocument['layout']) => {
        preferenceDocument = saveFixtureHomePreferenceDocument({
            ...preferenceDocument,
            layout
        }, homeScope);
        applyDocument();
    };
    const openCustomization = () => {
        closeCustomization(false);
        const backdrop = addElement(page, 'div', {
            className: 'ptv-home-customize-backdrop'
        });
        const dialog = addElement(backdrop, 'section', {
            className: 'ptv-home-customize-dialog'
        });
        const headingId = 'ptv-e2e-home-customize-title';
        const descriptionId = 'ptv-e2e-home-customize-description';

        customizationBackdrop = backdrop;
        backdrop.dataset.ptvHomeCustomizeBackdrop = 'true';
        dialog.setAttribute('aria-describedby', descriptionId);
        dialog.setAttribute('aria-labelledby', headingId);
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('role', 'dialog');
        const header = addElement(dialog, 'header');
        const headerCopy = addElement(header, 'div');

        addElement(headerCopy, 'h2', {
            id: headingId,
            text: 'Customize Home'
        });
        addElement(headerCopy, 'p', {
            id: descriptionId,
            text: 'Changes apply immediately and stay with this server profile.'
        });
        const close = addElement(header, 'button', { text: 'Close' });

        close.type = 'button';
        close.setAttribute('aria-label', 'Close Home customization');
        close.addEventListener('click', () => closeCustomization());
        const content = addElement(dialog, 'div', {
            className: 'ptv-home-customize-content'
        });
        const experience = addElement(content, 'fieldset');

        addElement(experience, 'legend', { text: 'Experience' });
        const heroLabel = addElement(experience, 'label');
        const heroToggle = addElement(heroLabel, 'input');

        heroToggle.type = 'checkbox';
        heroToggle.checked = preferenceDocument.layout.heroEnabled;
        addElement(heroLabel, 'span', { text: 'Featured hero' });
        heroToggle.addEventListener('change', () => commitLayout({
            ...preferenceDocument.layout,
            heroEnabled: heroToggle.checked
        }));

        const density = addElement(content, 'fieldset');

        addElement(density, 'legend', { text: 'Shelf density' });
        (['comfortable', 'compact'] as const).forEach(value => {
            const label = addElement(density, 'label');
            const input = addElement(label, 'input');

            input.type = 'radio';
            input.name = 'ptv-e2e-home-density';
            input.value = value;
            input.checked = preferenceDocument.layout.density === value;
            addElement(label, 'span', {
                text: value === 'comfortable' ? 'Comfortable' : 'Compact'
            });
            input.addEventListener('change', () => {
                if (!input.checked) return;

                commitLayout({
                    ...preferenceDocument.layout,
                    density: value
                });
            });
        });

        const rowsFieldset = addElement(content, 'fieldset');

        addElement(rowsFieldset, 'legend', { text: 'Rows' });
        const rowList = addElement(rowsFieldset, 'ol', {
            className: 'ptv-home-customize-rows'
        });
        const renderCustomizationRows = () => {
            rowList.replaceChildren();
            const orderedRows = orderFixtureHomeCustomizationRows(
                HOME_CUSTOMIZATION_ROWS,
                preferenceDocument.layout.rowOrder
            );

            orderedRows.forEach((row, index) => {
                const listItem = addElement(rowList, 'li');
                const label = addElement(listItem, 'label');
                const visibility = addElement(label, 'input');

                visibility.type = 'checkbox';
                visibility.checked = preferenceDocument.layout.rowVisibility[row.id] !== false;
                visibility.dataset.ptvHomeRowVisibility = row.id;
                addElement(label, 'span', { text: row.title });
                visibility.addEventListener('change', () => {
                    commitLayout({
                        ...preferenceDocument.layout,
                        rowVisibility: {
                            ...preferenceDocument.layout.rowVisibility,
                            [row.id]: visibility.checked
                        }
                    });
                });
                const actions = addElement(listItem, 'div');
                const up = addElement(actions, 'button', { text: 'Move up' });
                const down = addElement(actions, 'button', { text: 'Move down' });

                up.type = 'button';
                down.type = 'button';
                up.disabled = index === 0;
                down.disabled = index === orderedRows.length - 1;
                up.setAttribute('aria-label', `Move ${row.title} up`);
                down.setAttribute('aria-label', `Move ${row.title} down`);
                const move = (direction: 'down' | 'up') => {
                    const nextRows = moveFixtureHomeCustomizationRow(
                        orderedRows,
                        row.id,
                        direction
                    );

                    commitLayout({
                        ...preferenceDocument.layout,
                        rowOrder: nextRows.map(value => value.id)
                    });
                    renderCustomizationRows();
                };

                up.addEventListener('click', () => move('up'));
                down.addEventListener('click', () => move('down'));
            });
        };

        renderCustomizationRows();
        const footer = addElement(dialog, 'footer');
        const restore = addElement(footer, 'button', { text: 'Restore defaults' });
        const done = addElement(footer, 'button', { text: 'Done' });

        restore.type = 'button';
        done.type = 'button';
        restore.addEventListener('click', () => {
            commitLayout(createDefaultFixtureHomePreferenceDocument(homeScope).layout);
            closeCustomization();
        });
        done.addEventListener('click', () => closeCustomization());
        dialog.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeCustomization();
                return;
            }
            if (event.key !== 'Tab') return;

            const focusable = getFixtureHomeFocusableElements(dialog);
            const first = focusable[0];
            const last = focusable.at(-1);

            if (!first || !last) return;

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });
        backdrop.addEventListener('mousedown', event => {
            if (event.target === backdrop) closeCustomization();
        });
        window.queueMicrotask(() => close.focus());
    };

    customizeButton.addEventListener('click', openCustomization);
    applyDocument();
    cleanupHome = () => {
        closeActionMenu(false);
        closeCustomization(false);
        cleanupHome = () => undefined;
    };
}

function renderBasicHeader() {
    root.classList.add('ptv-shell-frame');
    const header = addElement(root, 'header', {
        className: 'authenticated-header ptv-shell-header'
    });
    const left = addElement(header, 'div', { className: 'ptv-shell-header-left' });
    const home = addElement(left, 'a', { className: 'ptv-shell-brand', text: 'Home' });

    home.href = '#/home';
    const navigation = addElement(header, 'nav', { className: 'ptv-shell-nav ptv-shell-header-primary' });
    const navigationPill = addElement(navigation, 'div', { className: 'ptv-shell-nav-primary' });
    const movies = addElement(navigationPill, 'a', { className: 'ptv-shell-nav-button', text: 'Movies' });

    movies.href = '#/movies';
    const right = addElement(header, 'div', { className: 'ptv-shell-header-right' });
    const actions = addElement(right, 'div', { className: 'ptv-shell-actions' });

    for (const label of ['Notifications', 'Settings', 'User menu']) {
        const action = addElement(actions, 'button', { className: 'ptv-shell-icon-button' });

        action.setAttribute('aria-label', label);
        addFixtureIcon(action);
    }
    const search = addElement(right, 'form', { className: 'ptv-shell-search' });
    const searchButton = addElement(search, 'button', { className: 'ptv-shell-search-trigger' });

    searchButton.setAttribute('aria-label', 'Search');
    addFixtureIcon(searchButton);
}

function renderPrimaryNavigationHeader() {
    const header = addElement(root, 'header', { className: 'primary-navigation-header' });
    const navigation = addElement(header, 'nav', { className: 'primary-navigation-scroll' });
    const menus = [{
        id: 'movies',
        label: 'Movies',
        links: [
            { href: '#/movies', label: 'Movies' },
            { href: '#/movies?view=anime', label: 'AniMovies' },
            { href: '#/movies?view=collections', label: 'Collections' }
        ]
    }, {
        id: 'shows',
        label: 'Shows',
        links: [
            { href: '#/shows', label: 'TV Shows' },
            { href: '#/shows?view=anime', label: 'Anime' },
            { href: '#/shows?view=cartoons', label: 'Cartoons' }
        ]
    }];
    let activeMenuId = '';
    let activePanel: HTMLElement | null = null;
    let activeTrigger: HTMLButtonElement | null = null;
    let positionFrame = 0;
    let gesture: Readonly<{ id: number; moved: boolean; startX: number; startY: number }> | null = null;
    let suppressNextClick = false;

    const closeMenu = (restoreFocus = false) => {
        const trigger = activeTrigger;

        activePanel?.remove();
        activePanel = null;
        activeMenuId = '';
        activeTrigger = null;
        navigation.querySelectorAll('button').forEach(button => {
            button.setAttribute('aria-expanded', 'false');
        });
        if (restoreFocus) trigger?.focus();
    };
    const updatePosition = () => {
        positionFrame = 0;
        if (!activePanel || !activeTrigger) return;
        const position = getPtvDropdownOverlayPosition(
            activeTrigger.getBoundingClientRect(),
            getPtvDropdownViewport(),
            activePanel.getBoundingClientRect().height || 180
        );

        Object.assign(activePanel.style, {
            left: `${position.left}px`,
            maxHeight: `${position.maxHeight}px`,
            top: `${position.top}px`,
            width: `${position.width}px`
        });
    };
    const schedulePosition = () => {
        if (positionFrame) return;
        positionFrame = window.requestAnimationFrame(updatePosition);
    };
    const openMenu = (trigger: HTMLButtonElement, menu: typeof menus[number], focusFirst = false) => {
        closeMenu();
        activeMenuId = menu.id;
        activeTrigger = trigger;
        trigger.setAttribute('aria-expanded', 'true');
        const panel = document.createElement('div');

        panel.className = 'primary-navigation-panel';
        panel.dataset.e2ePrimaryMenu = menu.id;
        panel.id = `primary-navigation-menu-${menu.id}`;
        panel.setAttribute('aria-labelledby', trigger.id);
        panel.setAttribute('role', 'menu');
        menu.links.forEach(link => {
            const anchor = addElement(panel, 'a', { text: link.label });

            anchor.href = link.href;
            anchor.setAttribute('role', 'menuitem');
            anchor.addEventListener('click', () => {
                document.documentElement.dataset.dropdownNavigationCount = String(
                    Number(document.documentElement.dataset.dropdownNavigationCount || 0) + 1
                );
                closeMenu();
            });
        });
        document.body.append(panel);
        activePanel = panel;
        updatePosition();
        if (focusFirst) panel.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    };

    menus.forEach(menu => {
        const trigger = addElement(navigation, 'button', {
            className: 'primary-navigation-trigger',
            text: `${menu.label} ⌄`
        });

        trigger.type = 'button';
        trigger.id = `primary-navigation-trigger-${menu.id}`;
        trigger.setAttribute('aria-controls', `primary-navigation-menu-${menu.id}`);
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-haspopup', 'menu');
        trigger.addEventListener('pointerdown', event => {
            gesture = { id: event.pointerId, moved: false, startX: event.clientX, startY: event.clientY };
        });
        trigger.addEventListener('pointermove', event => {
            if (!gesture || event.pointerId !== gesture.id) return;
            gesture = {
                ...gesture,
                moved: gesture.moved || hasPtvDropdownPointerMoved(
                    gesture.startX,
                    gesture.startY,
                    event.clientX,
                    event.clientY
                )
            };
        });
        trigger.addEventListener('pointerup', event => {
            if (!gesture || event.pointerId !== gesture.id) return;
            suppressNextClick = gesture.moved;
            gesture = null;
        });
        trigger.addEventListener('pointercancel', () => {
            suppressNextClick = true;
            gesture = null;
        });
        trigger.addEventListener('click', event => {
            if (suppressNextClick && event.detail !== 0) {
                suppressNextClick = false;
                return;
            }
            suppressNextClick = false;
            if (activeMenuId === menu.id) closeMenu();
            else openMenu(trigger, menu);
        });
        trigger.addEventListener('keydown', event => {
            if (event.key !== 'ArrowDown') return;
            event.preventDefault();
            openMenu(trigger, menu, true);
        });
    });
    for (const [label, href] of [
        ['Music', '#/music'],
        ['Reading', '#/reading'],
        ['Request', '#/requests']
    ]) {
        const link = addElement(navigation, 'a', { text: label });

        link.href = href;
    }

    const onPointerDown = (event: PointerEvent) => {
        const target = event.target as Node | null;

        if (!activePanel || !target || activePanel.contains(target) || activeTrigger?.contains(target)) return;
        closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && activePanel) closeMenu(true);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', schedulePosition);
    window.addEventListener('orientationchange', schedulePosition);
    navigation.addEventListener('scroll', schedulePosition, { passive: true });
    window.visualViewport?.addEventListener('resize', schedulePosition);
    window.visualViewport?.addEventListener('scroll', schedulePosition);
    cleanupPrimaryNavigation = () => {
        closeMenu();
        if (positionFrame) window.cancelAnimationFrame(positionFrame);
        document.removeEventListener('pointerdown', onPointerDown, true);
        document.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('resize', schedulePosition);
        window.removeEventListener('orientationchange', schedulePosition);
        navigation.removeEventListener('scroll', schedulePosition);
        window.visualViewport?.removeEventListener('resize', schedulePosition);
        window.visualViewport?.removeEventListener('scroll', schedulePosition);
        cleanupPrimaryNavigation = () => undefined;
    };
}

function renderHeader() {
    if (new URLSearchParams(window.location.search).get('dropdown') === '1') {
        renderPrimaryNavigationHeader();
    } else {
        renderBasicHeader();
    }
}

function renderAuthentication() {
    const compatibilityDrawer = addElement(root, 'div', { className: 'mainDrawer' });
    const compatibilityHeader = addElement(root, 'div', { className: 'skinHeader' });

    compatibilityDrawer.hidden = true;
    compatibilityHeader.hidden = true;
    compatibilityDrawer.dataset.ptvCompatibilityAnchor = 'true';
    compatibilityHeader.dataset.ptvCompatibilityAnchor = 'true';

    const card = addElement(root, 'main', { className: 'auth-card' });

    addElement(card, 'h1', { text: 'Sign in to PiggieTV' });
    const input = addElement(card, 'input');

    input.setAttribute('aria-label', 'Username');
    const signIn = addElement(card, 'button', { text: 'Sign in' });

    signIn.type = 'button';
    signIn.addEventListener('click', () => {
        window.location.hash = '#/home';
    });
}

function getBrowseLabel(path: string, search: string) {
    const route = parsePtvBrowseRoute(path, search);

    if (route.filterValue) return route.filterValue;
    if (route.view === 'latest') return `${route.kind} latest`;
    return `${route.kind} landing`;
}

function renderBrowseItems(container: HTMLElement, items: readonly { id: string; name: string }[]) {
    container.replaceChildren();
    items.forEach(item => {
        const card = addElement(container, 'button', {
            className: 'browse-card',
            text: item.name
        });

        card.dataset.itemId = item.id;
        card.type = 'button';
    });
}

async function loadBrowse(container: HTMLElement, path: string, search: string) {
    const route = parsePtvBrowseRoute(path, search);
    const key = getPtvFocusedBrowseLoaderKey(route, scope);
    const token = loadOwner.begin(key);
    const label = getBrowseLabel(path, search);
    const delay = label.toLocaleLowerCase('en-US') === 'crime' ? 120 : 10;

    container.dataset.loaderKey = key;
    container.dataset.loading = 'true';
    await new Promise(resolve => window.setTimeout(resolve, delay));

    if (!loadOwner.isActive(token)) {
        container.dataset.staleSuppressed = 'true';
        root.dataset.staleSuppressionCount = String(Number(root.dataset.staleSuppressionCount || 0) + 1);
        return;
    }

    renderedIds = getFixtureItems(label).map(item => item.id);
    renderBrowseItems(container, getFixtureItems(label));
    container.dataset.activeFilter = label;
    container.dataset.loading = 'false';
}

function renderDirectoryMode(page: HTMLElement) {
    const modeGroup = addElement(page, 'div', { className: 'directory-mode' });
    const currentMode = window.localStorage.getItem('ptv:e2e:genre-mode') || 'curated';

    ['curated', 'all'].forEach(mode => {
        const button = addElement(modeGroup, 'button', {
            className: currentMode === mode ? 'is-active' : '',
            text: mode === 'curated' ? 'Curated' : 'All metadata genres'
        });

        button.type = 'button';
        button.dataset.mode = mode;
        button.addEventListener('click', () => {
            window.localStorage.setItem('ptv:e2e:genre-mode', mode);
            renderRoute();
        });
    });
}

function renderBrowse(path: string, search: string) {
    const route = parsePtvBrowseRoute(path, search);
    const page = addElement(root, 'main', { className: 'browse-page' });

    page.dataset.canonicalRoute = route.canonicalRouteKey;
    addElement(page, 'h1', { text: getBrowseLabel(path, search) });
    if (route.view === 'genres') renderDirectoryMode(page);
    const container = addElement(page, 'div', { className: 'browse-items', id: 'browse-items' });
    const more = addElement(page, 'button', { id: 'load-more', text: 'Load More' });

    more.type = 'button';
    more.addEventListener('click', () => {
        const nextItems = getFixtureItems(`${getBrowseLabel(path, search)} page 2`)
            .filter(item => !renderedIds.includes(item.id));

        renderedIds = [...renderedIds, ...nextItems.map(item => item.id)];
        nextItems.forEach(item => {
            const card = addElement(container, 'button', {
                className: 'browse-card',
                text: item.name
            });

            card.dataset.itemId = item.id;
            card.type = 'button';
        });
    });
    void loadBrowse(container, path, search);
}

function isCurrentFixtureDetails(page: HTMLElement, itemId: string) {
    const route = getHashRoute();
    const params = new URLSearchParams(route.search);

    return page.isConnected
        && route.path === '/details'
        && (params.get('id') || '') === itemId;
}

function renderFixtureDetailsDiscovery(page: HTMLElement) {
    const route = getHashRoute();
    const itemId = new URLSearchParams(route.search).get('id') || '';
    const generation = activeHash;

    page.dataset.ptvDetailsDiscoveryGeneration = generation;
    page.dataset.ptvDetailsDiscoveryPendingItemId = itemId;

    window.requestAnimationFrame(() => {
        import('../src/ptv/modules/details/detailsDiscoveryModel')
            .then(({ getPtvDetailsDiscoveryLinks }) => {
                if (!isCurrentFixtureDetails(page, itemId)) return;

                const links = getPtvDetailsDiscoveryLinks({
                    CollectionName: 'Fixture Collection',
                    Genres: ['Action', 'Drama'],
                    People: [{
                        Name: 'Fixture Director',
                        Type: 'Director'
                    }],
                    Studios: [{
                        Name: 'Fixture Studio'
                    }],
                    Type: 'Movie'
                });

                delete page.dataset.ptvDetailsDiscoveryPendingItemId;
                page.dataset.ptvDetailsDiscoveryGeneration = generation;
                page.dataset.ptvDetailsDiscoveryItemId = itemId;
                if (!links.length) return;

                const section = document.createElement('section');
                const heading = document.createElement('h2');
                const description = document.createElement('p');
                const linkStrip = document.createElement('nav');
                const headingId = 'ptv-details-discovery-heading';

                section.className = 'ptv-details-discovery verticalSection detailVerticalSection ptv-details-glass';
                section.setAttribute('aria-labelledby', headingId);
                heading.id = headingId;
                heading.className = 'sectionTitle sectionTitle-cards';
                heading.textContent = 'Discover more';
                description.className = 'ptv-details-discovery-description';
                description.textContent = 'Explore the people, places, and themes connected to this title.';
                linkStrip.className = 'ptv-details-discovery-links';
                linkStrip.setAttribute('aria-label', 'Related discovery searches');

                links.forEach((link, index) => {
                    const anchor = document.createElement('a');
                    const label = document.createElement('strong');
                    const meta = document.createElement('span');

                    anchor.className = `ptv-details-discovery-link ptv-details-discovery-link--${link.kind}`;
                    anchor.dataset.ptvFocusKey = `details:discover:${index}`;
                    anchor.href = link.href;
                    anchor.setAttribute('aria-label', link.ariaLabel);
                    label.textContent = link.label;
                    meta.textContent = link.meta;
                    anchor.append(label, meta);
                    linkStrip.append(anchor);
                });

                section.append(heading, description, linkStrip);
                const similarSection = page.querySelector('#similarCollapsible');
                const host = similarSection?.parentElement
                    || page.querySelector('.detailPageContent');

                if (!host || !isCurrentFixtureDetails(page, itemId)) return;

                if (similarSection?.parentElement === host) {
                    host.insertBefore(section, similarSection);
                } else {
                    host.append(section);
                }
            })
            .catch(() => {
                if (!isCurrentFixtureDetails(page, itemId)) return;

                delete page.dataset.ptvDetailsDiscoveryPendingItemId;
                page.dataset.ptvDetailsDiscoveryGeneration = generation;
                page.dataset.ptvDetailsDiscoveryItemId = itemId;
            });
    });
}

function renderDetails() {
    document.body.classList.add('ptv-e2e-details');
    const page = addElement(root, 'main', {
        className: 'itemDetailPage',
        id: 'itemDetailPage'
    });

    page.innerHTML = `
        <div class="itemBackdrop" style="background-image: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221600%22 height=%22900%22%3E%3Crect width=%221600%22 height=%22900%22 fill=%22%23211a4a%22/%3E%3Ccircle cx=%221150%22 cy=%22280%22 r=%22360%22 fill=%22%237d3fc7%22/%3E%3C/svg%3E')"></div>
        <div class="detailLogo" aria-label="Fixture title logo"></div>
        <div class="detailPageWrapperContainer">
            <div class="detailPagePrimaryContainer">
                <div class="detailImageContainer hide-mobile">
                    <div class="card"><div class="detail-poster-fixture">Poster</div></div>
                </div>
                <div class="detailRibbon">
                    <div class="infoWrapper">
                        <div class="detailImageContainer hide-desktop">
                            <div class="card"><div class="detail-poster-fixture">Poster</div></div>
                        </div>
                        <div class="detailNameContainer">
                            <h1 class="itemName">PiggieTV Native Details</h1>
                            <div class="itemMiscInfo">
                                <span class="mediaInfoItem">2026</span>
                                <span class="mediaInfoItem">PG-13</span>
                                <span class="mediaInfoItem">2h 5m</span>
                            </div>
                        </div>
                    </div>
                    <div class="mainDetailButtons">
                        <button class="detailButton btnPlay" type="button">Play</button>
                        <button class="detailButton" type="button">More</button>
                    </div>
                </div>
                <div class="detailPagePrimaryContent padded-right">
                    <div class="detailSection">
                        <div class="detailSectionContent">
                            <p class="itemGenres"><a href="#genre-action">Action</a><a href="#genre-drama">Drama</a><a href="#genre-scifi">Science Fiction</a></p>
                            <p class="overview">A representative overview long enough to prove that native details metadata retains a readable line length instead of inheriting Jellyfin's large desktop left offset.</p>
                            <div class="itemTags"><a href="#tag-one">Adventure</a><a href="#tag-two">Character drama</a><a href="#tag-three">Mystery</a></div>
                        </div>
                        <div class="itemDetailsGroup">
                            <div class="detailsGroupItem genresGroup">
                                <div class="label">Genres</div>
                                <div class="genres content"><a href="#genre-action">Action</a><a href="#genre-drama">Drama</a></div>
                            </div>
                            <div class="detailsGroupItem studiosGroup">
                                <div class="label">Studios</div>
                                <div class="studios content"><a href="#studio-one">PiggieTV Studios</a><a href="#studio-two">Example Pictures</a></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="detailPageSecondaryContainer">
                <div class="detailPageContent">
                    <section class="verticalSection detailVerticalSection" id="castCollapsible">
                        <h2 class="sectionTitle padded-right">Cast &amp; Crew</h2>
                        <div is="emby-scroller"><div class="itemsContainer detail-shelf-fixture"><div>Person 1</div><div>Person 2</div></div></div>
                    </section>
                    <section class="verticalSection detailVerticalSection" id="similarCollapsible">
                        <h2 class="sectionTitle padded-right">More Like This</h2>
                        <div is="emby-scroller"><div class="itemsContainer detail-shelf-fixture"><div>Title 1</div><div>Title 2</div></div></div>
                    </section>
                </div>
            </div>
        </div>
    `;
    preparePtvDetailsLayout(page);
    renderFixtureDetailsDiscovery(page);
}

function renderMusicFullscreenLayout() {
    document.documentElement.classList.add('ptv-render-tv', 'ptv-platform-webos', 'ptv-route-music-mounted');
    document.body.classList.add('ptv-route-music-mounted');
    const page = addElement(root, 'main', {
        className: 'mainAnimatedPage ptv-music-page',
        id: 'ptvMusicPage'
    });

    page.style.height = '1080px';
    page.style.inset = '0';
    page.style.overflowY = 'auto';
    page.style.position = 'absolute';
    const shell = addElement(page, 'div', {
        className: 'ptv-shell-frame ptv-shell-frame-music ptv-shell-frame-fullscreen-music'
    });

    shell.style.minHeight = '1185px';
    const header = addElement(shell, 'header', { className: 'ptv-shell-header' });

    addElement(header, 'a', { className: 'ptv-shell-brand', text: 'PiggieTV' });
    const headerNav = addElement(header, 'nav', { className: 'ptv-shell-nav ptv-shell-header-primary' });

    addElement(headerNav, 'button', { className: 'ptv-shell-nav-button', text: 'Music' });
    const contextNav = addElement(shell, 'nav', { className: 'ptv-shell-context-nav' });

    for (const label of ['Home', 'Explore', 'Library']) {
        addElement(contextNav, 'a', { className: 'ptv-shell-context-link', text: label });
    }
    const shellMain = addElement(shell, 'div', { className: 'ptv-shell-main ptv-shell-page-content' });
    const player = addElement(shellMain, 'div', {
        className: 'ptv-music-view ptv-music-now-playing-view ptv-music-fullscreen-player'
    });
    const backdrop = addElement(player, 'div', { className: 'ptv-music-now-playing-backdrop' });
    const backdropImage = addElement(backdrop, 'img');

    backdropImage.alt = '';
    backdropImage.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221920%22 height=%221080%22%3E%3Crect width=%221920%22 height=%221080%22 fill=%22%23140c20%22/%3E%3C/svg%3E';
    const main = addElement(player, 'section', { className: 'ptv-music-now-playing-main' });
    const toggle = addElement(main, 'div', { className: 'ptv-music-song-video-toggle' });

    addElement(toggle, 'button', { className: 'ptv-music-toggle-active', text: 'Song' });
    const art = addElement(main, 'img', { className: 'ptv-music-now-playing-art' });

    art.alt = '';
    art.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22480%22 height=%22480%22%3E%3Crect width=%22480%22 height=%22480%22 fill=%22%237336a8%22/%3E%3C/svg%3E';
    const metadata = addElement(main, 'div', { className: 'ptv-music-now-playing-meta' });

    addElement(metadata, 'h1', { text: 'Now Playing' });
    addElement(metadata, 'p', { text: 'Artist - Album' });
    const quality = addElement(metadata, 'div');

    addElement(quality, 'span', { text: 'AUDIO' });
    const progress = addElement(main, 'div', { className: 'ptv-music-now-playing-progress' });
    const seek = addElement(progress, 'input');

    seek.type = 'range';
    const time = addElement(progress, 'div');

    addElement(time, 'span', { text: '0:30' });
    addElement(time, 'span', { text: '3:30' });
    const controls = addElement(main, 'div', { className: 'ptv-music-now-playing-controls' });

    for (const label of ['Shuffle', 'Previous', 'Favorite', 'Pause', 'Next', 'Repeat', 'Add']) {
        const control = addElement(controls, 'button', {
            className: label === 'Pause' ? 'ptv-music-action ptv-music-action-primary' : 'ptv-music-action'
        });

        control.setAttribute('aria-label', label);
        if (label === 'Add') {
            addElement(control, 'span', { text: '+' });
        } else {
            addFixtureIcon(control, label === 'Pause' ? 21 : 19);
        }
    }
    const volume = addElement(main, 'div', { className: 'ptv-music-volume-strip' });

    const mute = addElement(volume, 'button');

    mute.setAttribute('aria-label', 'Mute');
    addFixtureIcon(mute, 19);
    const volumeRange = addElement(volume, 'input');

    volumeRange.type = 'range';
    addElement(volume, 'span', { text: '50%' });
    const panel = addElement(player, 'aside', { className: 'ptv-music-player-panel' });
    const tabs = addElement(panel, 'div', { className: 'ptv-music-player-tabs' });

    tabs.setAttribute('aria-label', 'Now playing panels');
    tabs.setAttribute('role', 'tablist');
    for (const label of ['Up Next', 'Lyrics', 'Related']) {
        const tab = addElement(tabs, 'button', {
            className: label === 'Up Next' ? 'ptv-music-player-tab-active' : '',
            text: label
        });

        tab.setAttribute('aria-selected', String(label === 'Up Next'));
        tab.setAttribute('role', 'tab');
        tab.setAttribute('tabindex', label === 'Up Next' ? '0' : '-1');
    }
    const panelActions = addElement(panel, 'div', { className: 'ptv-music-player-panel-actions' });
    const panelCopy = addElement(panelActions, 'div');

    addElement(panelCopy, 'strong', { text: 'Playing from' });
    addElement(panelCopy, 'span', { text: 'Album' });
    addElement(panelActions, 'button', { text: 'Save queue' });
    const queueNote = addElement(panel, 'div', { className: 'ptv-music-related-queue-note' });

    addElement(queueNote, 'strong', { text: 'Related queue' });
    const queue = addElement(panel, 'ol', { className: 'ptv-music-queue-list' });

    for (let index = 0; index < 24; index += 1) {
        const current = index === 0;
        const item = addElement(queue, 'li', {
            className: current
                ? 'ptv-music-queue-item ptv-music-queue-item-current'
                : 'ptv-music-queue-item'
        });
        const button = addElement(item, 'button', { className: 'ptv-music-queue-item-main' });

        if (current) button.setAttribute('disabled', '');
        addElement(button, 'span', { text: current ? '●' : String(index + 1) });
        const copy = addElement(button, 'span');

        addElement(copy, 'strong', { text: `Queue track ${index + 1}` });
        addElement(copy, 'small', { text: 'Artist' });
        if (current) {
            addElement(button, 'em', { text: 'Playing' });
        } else {
            const actions = addElement(item, 'span', { className: 'ptv-music-queue-item-actions' });

            addElement(actions, 'button', { text: '↑' });
            addElement(actions, 'button', { text: '↓' });
            addElement(actions, 'button', { text: '×' });
        }
    }

    page.scrollTop = 105;
}

function renderMusicHeaderLayout() {
    document.documentElement.classList.add('ptv-render-tv', 'ptv-platform-webos', 'ptv-route-music-mounted');
    document.body.classList.add('ptv-route-music-mounted');
    root.classList.add('ptv-music-page', 'ptv-music-shell', 'ptv-shell-frame-music');
    const contextNav = addElement(root, 'nav', { className: 'ptv-shell-context-nav' });

    for (const label of ['Home', 'Explore', 'Artists', 'Albums', 'Songs', 'Playlists']) {
        const link = addElement(contextNav, 'a', { className: 'ptv-shell-context-link' });

        link.href = `#/music/${label.toLowerCase()}`;
        addFixtureIcon(link, 18);
        addElement(link, 'span', { text: label });
    }
    const app = addElement(root, 'main', { className: 'ptv-music-app ptv-music-app-shell' });
    const body = addElement(app, 'div', { className: 'ptv-music-body' });
    const main = addElement(body, 'section', { className: 'ptv-music-main' });
    const scroll = addElement(main, 'div', { className: 'ptv-music-main-scroll' });
    const toolbar = addElement(scroll, 'div', { className: 'ptv-music-main-toolbar' });
    const heading = addElement(toolbar, 'div');

    addElement(heading, 'p', { className: 'ptv-music-kicker', text: 'PiggieTV' });
    addElement(heading, 'h1', { text: 'Music' });
    addElement(heading, 'span', { className: 'ptv-music-toolbar-sync', text: 'Library' });
    const refresh = addElement(toolbar, 'button');

    refresh.setAttribute('aria-label', 'Refresh');
    addFixtureIcon(refresh, 19);
    addElement(refresh, 'span', { text: 'Refresh' });
    addElement(scroll, 'section', { className: 'ptv-music-home-hero', text: 'Music hero' });
}

function renderDiagnostics() {
    const params = new URLSearchParams(window.location.search);
    const allowed = params.get('admin') === '1' && params.get('debug') === '1';

    if (allowed) addElement(root, 'aside', { id: 'diagnostics', text: 'Sanitized diagnostics' });
    root.dataset.diagnosticsVisible = String(allowed);
}

function renderDiagnosticsDashboard() {
    const profile = detectPtvTvClientFromSignals({
        userAgent: navigator.userAgent
    });
    const routeSessionId = diagnosticStore.startRoute(window.location.hash);

    diagnosticStore.markRoutePhase(routeSessionId, 'initialized');
    diagnosticStore.markRoutePhase(routeSessionId, 'first-content');
    diagnosticStore.markRoutePhase(routeSessionId, 'first-focusable');
    diagnosticStore.markRoutePhase(routeSessionId, 'settled');
    diagnosticStore.setFocus({
        candidateCount: profile.isTv ? 4 : 0,
        currentCandidatePresent: profile.isTv,
        currentCategory: profile.isTv ? 'nav-item' : 'unknown',
        currentFingerprint: profile.isTv ? 'element-tv-fixture' : 'none',
        currentRoute: 'dashboard/piggietv/diagnostics',
        currentScope: profile.isTv ? 'main-content' : 'unknown',
        currentVisible: profile.isTv,
        disabledReason: profile.isTv ? '' : 'non-tv-profile',
        disposalCount: 0,
        duplicateListenerCount: 0,
        engineEnabled: profile.isTv,
        engineRequested: profile.isTv,
        enableReason: profile.reason,
        graphRebuildCount: profile.isTv ? 1 : 0,
        health: createPtvDiagnosticHealth(
            profile.isTv ? 'healthy' : 'unsupported',
            profile.isTv ? 'The TV focus collector is active.' : 'TV focus is unsupported for this non-TV browser.',
            { collectorAvailable: profile.isTv }
        ),
        initializationCount: profile.isTv ? 1 : 0,
        initializationReason: profile.reason,
        isTv: profile.isTv,
        lastRebuildReason: profile.isTv ? 'initialization' : 'none',
        listenerInstallCount: profile.isTv ? 1 : 0
    });
    diagnosticStore.recordFrame({
        approximateFps: 60,
        collectorOverheadMs: 0.1,
        frameCount: 60,
        jankyFrameCount: 1,
        jankyFramePercentage: 1.7,
        longestFrameMs: 34,
        longTaskCount: 0,
        p50FrameMs: 16.7,
        p90FrameMs: 17,
        p95FrameMs: 18,
        p99FrameMs: 34,
        reducedMotion: false,
        routeFamily: 'dashboard/piggietv/diagnostics',
        sampledAt: new Date().toISOString(),
        visibilityState: 'visible'
    });

    const page = addElement(root, 'main', {
        className: 'browse-page',
        id: 'diagnostics-dashboard'
    });
    addElement(page, 'h1', { text: 'PiggieTV Diagnostics' });
    const overview = addElement(page, 'section', { id: 'diagnostics-overview' });
    addElement(overview, 'h2', { text: 'Overview' });
    const health = addElement(overview, 'p', { id: 'diagnostics-health' });
    const requestCount = addElement(overview, 'p', { id: 'diagnostics-request-count' });
    const routeCount = addElement(overview, 'p', { id: 'diagnostics-route-count' });
    const focus = addElement(overview, 'p', { id: 'diagnostics-focus-status' });
    const lastInput = addElement(overview, 'p', { id: 'diagnostics-last-input' });
    const graphState = addElement(overview, 'p', { id: 'diagnostics-graph-state' });
    const createRequest = addElement(page, 'button', { text: 'Generate request metric' });
    const toggleOverlay = addElement(page, 'button', { text: 'Toggle diagnostics overlay' });
    const exportButton = addElement(page, 'button', { text: 'Export diagnostics' });
    const resetButton = addElement(page, 'button', { text: 'Reset diagnostic session' });
    const exportPreview = addElement(page, 'pre', { id: 'diagnostics-export' });
    const focusFixture = addElement(page, 'section', { id: 'diagnostics-focus-fixture' });
    const focusOrigin = addElement(focusFixture, 'button', { text: 'TV focus origin' });
    const focusRight = addElement(focusFixture, 'button', { text: 'TV focus right target' });
    const focusNoTarget = addElement(focusFixture, 'button', { text: 'TV focus isolated target' });
    const openModal = addElement(focusFixture, 'button', { text: 'Open TV focus modal' });
    const offscreenFocus = addElement(focusFixture, 'button', { text: 'Off-screen TV focus target' });

    focusOrigin.dataset.ptvFocusKey = 'diagnostic-origin';
    focusRight.dataset.ptvFocusKey = 'diagnostic-right';
    focusNoTarget.dataset.ptvFocusKey = 'diagnostic-isolated';
    openModal.dataset.ptvFocusKey = 'diagnostic-modal-trigger';
    offscreenFocus.dataset.ptvFocusKey = 'diagnostic-offscreen';
    focusFixture.style.display = 'grid';
    focusFixture.style.gridTemplateColumns = 'repeat(2, 12rem)';
    focusFixture.style.gap = '1rem';
    focusNoTarget.style.gridColumn = '1';
    focusNoTarget.style.marginTop = '8rem';
    offscreenFocus.style.position = 'absolute';
    offscreenFocus.style.top = '180vh';
    offscreenFocus.style.left = '1rem';

    openModal.addEventListener('click', () => {
        const existing = document.getElementById('diagnostics-focus-modal');

        if (existing) {
            existing.remove();
            notifyPtvTvFocusContentReady('content-ready');
            return;
        }
        const dialog = addElement(document.body, 'section', { id: 'diagnostics-focus-modal' });
        const only = addElement(dialog, 'button', { text: 'Only modal focus target' });

        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('role', 'dialog');
        dialog.dataset.ptvFocusReturnId = 'diagnostics-focus-modal-trigger';
        openModal.id = 'diagnostics-focus-modal-trigger';
        only.dataset.ptvFocusKey = 'diagnostic-modal-only';
        only.addEventListener('click', () => dialog.remove());
        notifyPtvTvFocusContentReady('content-ready');
    });

    [createRequest, toggleOverlay, exportButton, resetButton].forEach(button => {
        button.type = 'button';
    });

    const platformSnapshot = diagnosticStore.getSnapshot().platform;

    diagnosticStore.updateContext({
        platform: {
            ...platformSnapshot,
            eligibilitySource: profile.reason,
            eligibilityTimestamp: new Date().toISOString(),
            isAndroidTv: profile.isAndroidTv,
            isFireTv: profile.isFireTv,
            isTv: profile.isTv,
            isWebOs: profile.isWebOs,
            layoutMode: profile.isTv ? 'ten-foot' : 'desktop',
            profile: profile.isWebOs ? 'webos' : profile.isFireTv ? 'firetv' : profile.isTv ? 'tv' : 'desktop',
            userAgentClassification: profile.isWebOs ? 'webos'
                : profile.isFireTv ? 'fire-tv'
                    : profile.isAndroidTv ? 'android-tv'
                        : profile.isTv ? 'generic-tv'
                            : 'desktop'
        }
    });
    document.documentElement.dataset.ptvRouteOwner = 'native';
    document.documentElement.dataset.ptvRoutePageType = 'diagnostics';
    const applyFocusSnapshot = (navigation: ReturnType<typeof getPtvTvNavigationSnapshot>) => {
        const active = document.activeElement;
        const focusHealth = !profile.isTv ? 'unsupported'
            : navigation.focusManagerReady && navigation.focusTargetCount > 0 ? 'healthy'
                : navigation.focusManagerReady ? 'degraded'
                    : 'failing';

        diagnosticStore.setFocus({
            candidateCount: navigation.focusTargetCount,
            currentCandidatePresent: navigation.focusGraphSummary.currentCandidatePresent,
            currentCategory: classifyPtvTvFocusElement(active),
            currentFingerprint: getPtvSafeFocusFingerprint(active),
            currentRoute: 'dashboard/piggietv/diagnostics',
            currentScope: navigation.focusGraphSummary.activeScope,
            currentVisible: navigation.focusGraphSummary.currentRegion === 'overlapping',
            disabledReason: profile.isTv ? navigation.focusManagerReady ? '' : 'not-initialized' : 'non-tv-profile',
            disposalCount: navigation.focusEngineDisposalCount,
            duplicateListenerCount: navigation.focusEngineDuplicateListenerCount,
            engineEnabled: profile.isTv && navigation.focusManagerReady,
            engineRequested: navigation.focusEngineRequested,
            enableReason: navigation.focusEngineEnableReason,
            graphRebuildCount: navigation.focusGraphRebuildCount,
            health: createPtvDiagnosticHealth(
                focusHealth,
                !profile.isTv ? 'TV focus is unsupported for this non-TV browser.'
                    : navigation.focusTargetCount > 0 ? 'The TV focus collector is active.'
                        : 'The TV focus engine is active without candidates.',
                { collectorAvailable: profile.isTv }
            ),
            initializationCount: navigation.focusEngineInitializationCount,
            initializationReason: profile.reason,
            isTv: profile.isTv,
            lastRebuildReason: navigation.focusGraphSummary.lastRebuildReason,
            listenerInstallCount: navigation.focusEngineListenerInstallCount
        });
    };
    const focusDiagnosticListener = (event: Event) => {
        const payload = (event as CustomEvent<{
            detail?: Record<string, unknown>;
            name?: string;
        }>).detail;
        const detail = payload?.detail || {};
        const name = payload?.name || '';
        const occurredAt = new Date().toISOString();

        if (name === 'ptv-tv-input-pipeline') {
            const stage = String(detail.inputStage || 'completed') as PtvRemoteInputStage;
            const safeAction = String(detail.keyCategory || 'unknown') as PtvSafeRemoteAction;
            const source = String(detail.inputSource || 'keyboard') as PtvRemoteInputSource;
            const elapsedMs = Number(detail.elapsedMs) || 0;
            const movementAttempted = detail.movementAttempted === true
                || ['focus-movement-requested', 'focus-event-observed', 'movement-confirmed', 'movement-timed-out'].includes(stage);
            const movementSucceeded = stage === 'movement-confirmed' || detail.movementConfirmed === true;

            diagnosticStore.recordInput({
                activeRequests: diagnosticStore.getRequestSummary().active,
                currentCandidateResolved: detail.currentCandidateResolved === true,
                defaultPreventedAfter: detail.defaultPreventedAfter === true,
                defaultPreventedBefore: detail.defaultPreventedBefore === true,
                delayClassification: stage === 'target-rejected' ? 'target-search'
                    : stage === 'movement-timed-out' ? 'browser-focus-application'
                        : 'unknown',
                direction: ['up', 'down', 'left', 'right'].includes(safeAction)
                    ? safeAction as 'down' | 'left' | 'right' | 'up' : 'unknown',
                elapsedMs,
                eventPhase: detail.eventPhase === 'capture' || detail.eventPhase === 'target'
                    ? detail.eventPhase : 'unknown',
                eventType: detail.eventType === 'keyup' ? 'keyup' : 'keydown',
                failureReason: String(detail.failureReason || 'none'),
                frameP95Ms: diagnosticStore.getSnapshot().frames.at(-1)?.p95FrameMs || 0,
                handlerReached: detail.handlerReached === true,
                inputId: String(detail.inputId || ''),
                movementAttempted,
                movementResult: movementSucceeded ? 'confirmed'
                    : stage === 'movement-timed-out' ? 'timed-out'
                        : stage === 'target-rejected' ? 'failed'
                            : movementAttempted ? 'pending'
                                : 'not-attempted',
                movementSucceeded,
                nextFocusFingerprint: String(detail.focusedFingerprint || detail.targetFingerprint || 'none'),
                occurredAt,
                pendingImages: 0,
                pendingShelves: 0,
                previousFocusFingerprint: getPtvSafeFocusFingerprint(document.activeElement),
                propagationStopped: detail.propagationStopped === true,
                repeat: detail.repeat === true,
                repeatCount: Number(detail.repeatCount) || 0,
                routeFamily: 'dashboard/piggietv/diagnostics',
                routeSettled: true,
                safeAction,
                source,
                stage,
                stageSequence: Number(detail.stageSequence) || 0,
                targetCandidateFound: detail.targetFound === true || stage === 'target-found' || movementSucceeded,
                targetCategory: classifyPtvTvFocusElement(document.activeElement)
            });
            if (movementSucceeded) diagnosticStore.markRouteFocusPhase('first-directional-movement');
            return;
        }

        if (name === 'ptv-tv-focus-graph' && detail.graphSummary && typeof detail.graphSummary === 'object') {
            diagnosticStore.recordFocusGraph({
                ...(detail.graphSummary as Omit<PtvFocusGraphDiagnostic, 'routeFamily'>),
                generatedAt: occurredAt,
                routeFamily: 'dashboard/piggietv/diagnostics'
            });
            diagnosticStore.markRouteFocusPhase('focus-graph-ready');
            return;
        }

        if (name === 'ptv-tv-focus-change') {
            const active = document.activeElement;
            const category = classifyPtvTvFocusElement(active);
            const visible = detail.visible === true;

            diagnosticStore.recordFocusChange({
                candidatePresent: detail.candidatePresent === true,
                category,
                fingerprint: getPtvSafeFocusFingerprint(active),
                inputId: String(detail.inputId || ''),
                occurredAt,
                previousCategory: String(detail.previousCategory || 'unknown') as typeof category,
                reason: String(detail.reason || 'focus-observed'),
                routeFamily: 'dashboard/piggietv/diagnostics',
                scope: String(detail.scope || 'unknown') as PtvFocusScopeDiagnostic['scope'],
                visible
            });
            diagnosticStore.recordFocusVisibility({
                detachedDuringAnimation: false,
                focusMovedBeforeScrollSettled: false,
                focusToVisibleDurationMs: visible ? 0 : null,
                focusedCategory: category,
                inputId: String(detail.inputId || ''),
                obscuredBy: 'unobscured',
                occurredAt,
                routeFamily: 'dashboard/piggietv/diagnostics',
                scrollContainer: String(detail.scope || 'unknown') as PtvFocusScopeDiagnostic['scope'],
                status: 'focus-observed',
                visible,
                virtualizedNodeReplaced: false
            });
            diagnosticStore.markRouteFocusPhase('initial-focus');
            return;
        }

        if (name === 'ptv-tv-focus-scope') {
            diagnosticStore.recordFocusScope({
                candidateCount: Number(detail.candidateCount) || 0,
                initialFocusedCategory: String(detail.initialFocusedCategory || 'unknown') as PtvFocusScopeDiagnostic['initialFocusedCategory'],
                leakedFocusOutsideScope: detail.leakedFocusOutsideScope === true,
                occurredAt,
                orphanedAfterRouteChange: detail.orphanedAfterRouteChange === true,
                previousFocusRestored: typeof detail.previousFocusRestored === 'boolean'
                    ? detail.previousFocusRestored : null,
                routeFamily: 'dashboard/piggietv/diagnostics',
                scope: String(detail.scope || 'unknown') as PtvFocusScopeDiagnostic['scope'],
                status: String(detail.scopeStatus || 'activated') as PtvFocusScopeDiagnostic['status'],
                trapActive: detail.trapActive === true
            });
        }
    };

    window.addEventListener('ptv:focus-diagnostic', focusDiagnosticListener);
    const unsubscribeFocus = subscribePtvTvNavigation(applyFocusSnapshot);

    syncPtvTvFocusEngine({
        isAndroidTv: profile.isAndroidTv,
        isFireTv: profile.isFireTv,
        isTv: profile.isTv,
        isWebOs: profile.isWebOs,
        tvDetectionReason: profile.reason
    });
    applyFocusSnapshot(getPtvTvNavigationSnapshot());

    const update = () => {
        const snapshot = diagnosticStore.getSnapshot('2026-07-25T12:00:00.000Z');
        const recentInput = [...snapshot.inputs].reverse().find(input => input.stage === 'completed')
            || snapshot.inputs.at(-1);
        const latestGraph = snapshot.focusGraphs.at(-1);

        health.textContent = `Overall health: ${snapshot.health.status}`;
        requestCount.textContent = `Requests: ${snapshot.requests.length}`;
        routeCount.textContent = `Routes: ${snapshot.routes.length}`;
        focus.textContent = `TV focus: ${snapshot.latestFocus.health.status}; isTv=${snapshot.latestFocus.isTv}`;
        lastInput.textContent = `Remote input: ${recentInput?.safeAction || 'none'}; stage=${recentInput?.stage || 'none'}; handler=${recentInput?.handlerReached || false}`;
        graphState.textContent = `Focus graph: ${latestGraph?.generation || 0}; candidates=${latestGraph?.totalCandidateCount || snapshot.latestFocus.candidateCount}; scope=${latestGraph?.activeScope || snapshot.latestFocus.currentScope}`;
        root.dataset.diagnosticsSubscribers = String(snapshot.self.subscriberCount);
    };

    createRequest.addEventListener('click', () => {
        const requestId = diagnosticStore.beginRequest({
            // eslint-disable-next-line sonarjs/no-clear-text-protocols -- Redaction coverage requires a deliberately private absolute URL sentinel.
            endpoint: 'http://192.168.1.50:8096/Users/private-user/Items/private-item?api_key=secret',
            route: window.location.hash
        });

        diagnosticStore.completeRequest(requestId, {
            responseByteEstimate: 128,
            status: 200,
            success: true
        });
    });
    toggleOverlay.addEventListener('click', () => {
        const existing = document.querySelector('[data-ptv-diagnostics-overlay="true"]');

        if (existing) {
            existing.remove();
            return;
        }

        const overlay = addElement(document.body, 'aside', {
            className: 'ptv-diagnostics-overlay',
            text: 'FPS 60 · requests 0 · focus nav-item'
        });

        overlay.dataset.ptvDiagnosticsOverlay = 'true';
        overlay.setAttribute('aria-hidden', 'true');
    });
    exportButton.addEventListener('click', () => {
        exportPreview.textContent = JSON.stringify(diagnosticStore.createExport({
            generatedAt: '2026-07-25T12:00:00.000Z'
        }));
    });
    resetButton.addEventListener('click', () => diagnosticStore.resetSession());

    const unsubscribe = diagnosticStore.subscribe(update);

    update();
    cleanupDiagnosticsDashboard = () => {
        unsubscribe();
        unsubscribeFocus();
        window.removeEventListener('ptv:focus-diagnostic', focusDiagnosticListener);
        syncPtvTvFocusEngine({ isTv: false });
        delete document.documentElement.dataset.ptvRouteOwner;
        delete document.documentElement.dataset.ptvRoutePageType;
        document.querySelector('[data-ptv-diagnostics-overlay="true"]')?.remove();
        document.getElementById('diagnostics-focus-modal')?.remove();
        root.dataset.diagnosticsSubscribers = String(diagnosticStore.getSnapshot().self.subscriberCount);
        cleanupDiagnosticsDashboard = () => undefined;
    };
}

type FixtureCollection = Readonly<{
    key: string;
    members: readonly string[];
    source: 'cross-library' | 'curated' | 'jellyfin';
    title: string;
}>;

type FixtureCollectionPreferences = {
    hidden: string[];
    pinned: string[];
};

const FIXTURE_COLLECTIONS: readonly FixtureCollection[] = [
    { key: 'jellyfin:saga', members: ['First Chapter', 'Second Chapter', 'Final Chapter'], source: 'jellyfin', title: 'The Great Saga' },
    { key: 'jellyfin:animation', members: ['Animated Movie', 'Animated Series'], source: 'jellyfin', title: 'Animation Worlds' },
    { key: 'curated:seasonal', members: ['Autumn Story', 'Winter Story'], source: 'curated', title: 'Seasonal Stories' },
    { key: 'cross:aurora', members: ['Aurora Movie', 'Aurora Series', 'Aurora Soundtrack', 'Aurora Book'], source: 'cross-library', title: 'Aurora Across Libraries' }
];

function getFixtureCollectionPreferences() {
    const scope = window.localStorage.getItem('ptv:e2e:collection-scope') || 'server-a:user-a';
    const key = `ptv:e2e:collections:${scope}`;
    let preferences: FixtureCollectionPreferences = { hidden: [], pinned: [] };

    try {
        preferences = {
            ...preferences,
            ...JSON.parse(window.localStorage.getItem(key) || '{}') as Partial<FixtureCollectionPreferences>
        };
    } catch {
        // Invalid validation-only state retires to defaults.
    }

    return {
        key,
        preferences,
        save(next: FixtureCollectionPreferences) {
            window.localStorage.setItem(key, JSON.stringify(next));
        }
    };
}

function addFixtureCollectionCard(
    container: HTMLElement,
    collection: FixtureCollection,
    preferences: ReturnType<typeof getFixtureCollectionPreferences>,
    initialFocus = false
) {
    const article = addElement(container, 'article', { className: 'ptv-collection-card' });

    article.dataset.collectionKey = collection.key;
    article.dataset.ptvCollectionSource = collection.source;
    const link = addElement(article, 'a', { text: collection.title });

    link.href = `#/collections?view=details&collectionId=${encodeURIComponent(collection.key)}`;
    link.dataset.ptvFocusKey = `collections-card-${collection.key.replace(/[^a-z0-9]/gi, '-')}`;
    if (initialFocus) link.dataset.ptvInitialFocus = 'true';
    addElement(article, 'span', { text: `${collection.members.length} members | ${collection.source}` });
    const pin = addElement(article, 'button', {
        text: preferences.preferences.pinned.includes(collection.key) ? 'Unpin' : 'Pin'
    });

    pin.type = 'button';
    pin.addEventListener('click', () => {
        const pinned = preferences.preferences.pinned.filter(key => key !== collection.key);

        if (!preferences.preferences.pinned.includes(collection.key)) pinned.unshift(collection.key);
        preferences.save({ ...preferences.preferences, pinned });
        renderRoute();
    });
    const hide = addElement(article, 'button', { text: 'Hide' });

    hide.type = 'button';
    hide.addEventListener('click', () => {
        preferences.save({
            ...preferences.preferences,
            hidden: [...new Set([...preferences.preferences.hidden, collection.key])]
        });
        renderRoute();
    });
}

function renderFixtureCollectionDetails(params: URLSearchParams) {
    const collectionKey = params.get('collectionId') || '';
    const collection = FIXTURE_COLLECTIONS.find(candidate => candidate.key === collectionKey)
        || { ...FIXTURE_COLLECTIONS[0], key: collectionKey || FIXTURE_COLLECTIONS[0].key };
    const page = addElement(root, 'main', { className: 'ptv-collections ptv-collection-details' });

    page.dataset.ptvCollectionsView = 'details';
    page.dataset.ptvDuplicateRequestKeys = '0';
    page.dataset.ptvRuntimeCount = '1';
    page.dataset.ptvShellCount = '1';
    page.dataset.collectionKey = collection.key;
    page.style.paddingTop = '6rem';
    const back = addElement(page, 'a', { text: 'Collections' });

    back.href = '#/collections';
    back.dataset.ptvFocusKey = 'collection-back-to-browse';
    addElement(page, 'span', { text: `${collection.source} collection` });
    addElement(page, 'h1', { text: collection.title });
    addElement(page, 'p', { text: 'A cinematic destination with explicit, explainable library relationships.' });
    const primary = addElement(page, 'a', { text: 'Start next chapter' });

    primary.href = '#/details?id=fixture-member-1';
    primary.dataset.ptvFocusKey = 'collection-primary-action';
    primary.dataset.ptvInitialFocus = 'true';
    const ordering = addElement(page, 'nav', { className: 'ptv-collection-ordering' });

    ordering.setAttribute('aria-label', 'Collection ordering modes');
    ['Collection order', 'Release order', 'Title'].forEach(label => addElement(ordering, 'button', { text: label }));
    const section = addElement(page, 'section', { className: 'ptv-collection-members' });

    addElement(section, 'h2', { text: collection.source === 'cross-library' ? 'Cross-Library Worlds' : 'Main Timeline' });
    const grid = addElement(section, 'div', { className: 'ptv-collection-memberGrid' });

    collection.members.forEach((member, index) => {
        const card = addElement(grid, 'a', { text: member });

        card.href = `#/details?id=fixture-member-${index + 1}`;
        card.dataset.ptvFocusKey = `collection-member-${index + 1}`;
    });
}

function renderCollections(search: string) {
    const params = new URLSearchParams(search);
    const view = params.get('view') || 'landing';

    if (view === 'details') {
        renderFixtureCollectionDetails(params);
        return;
    }

    const preferences = getFixtureCollectionPreferences();
    const visible = FIXTURE_COLLECTIONS.filter(collection => !preferences.preferences.hidden.includes(collection.key));
    const page = addElement(root, 'main', { className: 'ptv-collections ptv-collections-page' });

    page.dataset.ptvCollectionsView = view;
    page.dataset.ptvDeferredConcurrency = '1';
    page.dataset.ptvDuplicateRequestKeys = '0';
    page.dataset.ptvRuntimeCount = '1';
    page.dataset.ptvShellCount = '1';
    page.style.paddingTop = '6rem';
    const header = addElement(page, 'header', { className: 'ptv-collections-masthead' });

    addElement(header, 'h1', { text: 'Collections' });
    const navigation = addElement(header, 'nav');

    navigation.setAttribute('aria-label', 'Collection views');
    for (const [label, href] of [
        ['Featured', '#/collections?view=featured'],
        ['All', '#/collections?view=all'],
        ['Genres', '#/collections?view=genres']
    ]) {
        const link = addElement(navigation, 'a', { text: label });

        link.href = href;
    }

    if (view === 'genres') {
        const genres = addElement(page, 'section', { className: 'ptv-collection-genreDirectory' });

        addElement(genres, 'h2', { text: 'Browse collection genres' });
        for (const name of ['Adventure', 'Animation', 'Seasonal']) {
            const link = addElement(genres, 'a', { text: name });

            link.href = `#/collections?view=genre&genre=${encodeURIComponent(name)}`;
            link.dataset.ptvFocusKey = `collections-genre-${name.toLocaleLowerCase('en-US')}`;
        }
    } else {
        if (view !== 'all' && view !== 'genre' && visible[0]) {
            const hero = addElement(page, 'section', { className: 'ptv-collection-hero' });

            addElement(hero, 'h2', { text: visible[0].title });
            const link = addElement(hero, 'a', { text: 'Explore collection' });

            link.href = `#/collections?view=details&collectionId=${encodeURIComponent(visible[0].key)}`;
            link.dataset.ptvFocusKey = 'collections-hero-open';
            link.dataset.ptvInitialFocus = 'true';
        }

        const pinned = visible.filter(collection => preferences.preferences.pinned.includes(collection.key));
        const sections = view === 'featured' ?
            [['Featured Collections', visible.slice(0, 3)] as const] :
            view === 'all' || view === 'genre' ?
                [['All Collections', visible] as const] :
                [
                    ...(pinned.length ? [['Pinned Collections', pinned] as const] : []),
                    ['Featured Collections', visible.slice(0, 3)] as const,
                    ['Your Jellyfin Collections', visible.filter(collection => collection.source === 'jellyfin')] as const,
                    ['Cross-Library Worlds', visible.filter(collection => collection.source === 'cross-library')] as const
                ];

        sections.filter(([, collections]) => collections.length > 0).forEach(([title, collections], sectionIndex) => {
            const section = addElement(page, 'section', { className: 'ptv-collection-section' });

            addElement(section, 'h2', { text: title });
            const row = addElement(section, 'div', { className: 'ptv-collection-row' });

            collections.forEach((collection, index) => addFixtureCollectionCard(
                row,
                collection,
                preferences,
                view === 'all' && sectionIndex === 0 && index === 0
            ));
        });
    }

    if (params.get('sourceFailure') === '1') {
        addElement(page, 'p', { className: 'ptv-collection-deferred', text: 'Optional cross-library source unavailable. Jellyfin Collections remain ready.' });
    }
    const reset = addElement(page, 'button', { text: 'Reset hidden collections' });

    reset.type = 'button';
    reset.addEventListener('click', () => {
        preferences.save({ hidden: [], pinned: [] });
        renderRoute();
    });
}

function renderRoute() {
    if (activeHash) scrollPositions.set(activeHash, window.scrollY);
    activeHash = window.location.hash || '#/home';
    cleanupPrimaryNavigation();
    cleanupDiagnosticsDashboard();
    cleanupSearch();
    cleanupHome();
    document.body.classList.remove('ptv-e2e-details');
    document.body.classList.remove('ptv-route-music-mounted');
    document.documentElement.classList.remove('ptv-render-tv', 'ptv-platform-webos', 'ptv-route-music-mounted');
    root.classList.remove('ptv-music-page', 'ptv-music-shell', 'ptv-shell-frame-music', 'ptv-shell-frame-fullscreen-music');
    root.replaceChildren();
    root.dataset.authenticationRoute = String(isPtvAuthenticationRoute(getLocationState()));
    const ownership = getPtvRouteOwnership(getLocationState());

    root.dataset.routeId = ownership.id;
    root.dataset.routeOwner = ownership.owner;

    if (!shouldMountPtvAuthenticatedHeader(getLocationState())) {
        renderAuthentication();
        return;
    }

    renderHeader();
    const { path, search } = getHashRoute();

    if (path === '/dashboard/piggietv/diagnostics') {
        renderDiagnosticsDashboard();
    } else if (path === '/e2e/music-fullscreen-layout') {
        renderMusicFullscreenLayout();
    } else if (path === '/e2e/music-header-layout') {
        renderMusicHeaderLayout();
    } else if (path === '/movies' || path === '/shows') {
        renderBrowse(path, search);
    } else if (path === '/collections') {
        renderCollections(search);
    } else if (path === '/search') {
        renderSearch(search);
    } else if (path === '/details' || path.startsWith('/item/')) {
        renderDetails();
    } else if (path === '/home') {
        renderNativeHome();
    } else {
        addElement(root, 'main', { className: 'browse-page', text: 'PiggieTV Home' });
    }

    renderDiagnostics();
    window.requestAnimationFrame(() => {
        window.scrollTo(0, scrollPositions.get(activeHash) || 0);
    });
}

async function startUpdateScenario() {
    const params = new URLSearchParams(window.location.search);

    if (params.get('update') !== 'waiting') return;

    const controllerListeners = new Map<string, () => void>();
    const waitingWorker = {
        postMessage: () => {
            document.documentElement.dataset.skipWaitingRequested = 'true';
            window.queueMicrotask(() => controllerListeners.get('controllerchange')?.());
        },
        state: 'installed'
    };
    const service = new PtvUpdateService({
        getActivityReason: () => params.get('active') === '1' ? 'Playback is active.' : '',
        reload: () => {
            document.documentElement.dataset.reloadRequested = 'true';
        },
        serviceWorker: {
            addEventListener: (type, listener) => controllerListeners.set(type, listener),
            controller: {},
            getRegistration: async () => ({ waiting: waitingWorker })
        },
        sessionStorage: window.sessionStorage
    });

    service.subscribe(snapshot => {
        document.getElementById('update-notice')?.remove();
        if (!['available', 'deferred'].includes(snapshot.state)) return;

        const notice = addElement(document.body, 'aside', {
            id: 'update-notice',
            text: snapshot.state === 'deferred' ? snapshot.activityReason : 'PiggieTV update available'
        });
        const apply = addElement(notice, 'button', { text: 'Reload' });

        apply.type = 'button';
        apply.addEventListener('click', () => service.applyWhenSafe());
    });
    await service.start();
}

window.addEventListener('hashchange', renderRoute);
window.addEventListener('popstate', renderRoute);
renderRoute();
void startUpdateScenario();

/* eslint-enable @stylistic/operator-linebreak, compat/compat, no-nested-ternary, sonarjs/cognitive-complexity, sonarjs/no-nested-conditional, sonarjs/no-nested-functions */
