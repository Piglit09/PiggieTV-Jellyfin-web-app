/* eslint-disable compat/compat -- This deterministic test harness targets Playwright Chromium only. */

import {
    isPtvAuthenticationRoute,
    shouldMountPtvAuthenticatedHeader
} from '../src/ptv/shell/authenticationRoutes';
import { parsePtvBrowseRoute } from '../src/ptv/pages/browse/browseRoute';
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
import '../src/ptv/modules/details/details.scss';
import '../src/ptv/shell/ptvShell.scss';

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
    #update-notice { position: fixed; right: 1rem; bottom: 1rem; padding: 1rem; background: #321c4f; }
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
    .hide-desktop { display: none; }
    @media (max-width: 900px) {
        .hide-mobile { display: none !important; }
        .hide-desktop { display: block; }
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

    for (const label of ['Notifications', 'Settings', 'Profile']) {
        const action = addElement(actions, 'button', { className: 'ptv-shell-icon-button', text: label.slice(0, 1) });

        action.setAttribute('aria-label', label);
    }
    const search = addElement(right, 'form', { className: 'ptv-shell-search' });
    const searchButton = addElement(search, 'button', { className: 'ptv-shell-search-trigger', text: 'S' });

    searchButton.setAttribute('aria-label', 'Search');
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
}

function renderDiagnostics() {
    const params = new URLSearchParams(window.location.search);
    const allowed = params.get('admin') === '1' && params.get('debug') === '1';

    if (allowed) addElement(root, 'aside', { id: 'diagnostics', text: 'Sanitized diagnostics' });
    root.dataset.diagnosticsVisible = String(allowed);
}

function renderRoute() {
    if (activeHash) scrollPositions.set(activeHash, window.scrollY);
    activeHash = window.location.hash || '#/home';
    cleanupPrimaryNavigation();
    document.body.classList.remove('ptv-e2e-details');
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

    if (path === '/movies' || path === '/shows') {
        renderBrowse(path, search);
    } else if (path === '/details' || path.startsWith('/item/')) {
        renderDetails();
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

/* eslint-enable compat/compat */
