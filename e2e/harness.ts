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

const root = document.getElementById('app');

if (!root) throw new Error('PiggieTV browser harness root is missing.');

const style = document.createElement('style');

style.textContent = `
    * { box-sizing: border-box; }
    html { min-height: 100%; background: #090812; color: #fff; font-family: sans-serif; }
    body { min-height: 140vh; margin: 0; }
    button, a { min-height: 2.75rem; }
    .authenticated-header { display: flex; gap: 1rem; padding: 1rem; background: #211635; }
    .auth-card, .browse-page { margin: 5rem auto; width: min(90%, 60rem); padding: 2rem; border: 1px solid #7955a5; }
    .browse-items { display: flex; gap: 1rem; overflow-x: auto; }
    .browse-card { flex: 0 0 10rem; padding: 1rem; background: #2b1b42; }
    .directory-mode { display: flex; gap: 1rem; }
    .is-active { outline: 3px solid #bc7cff; }
    #diagnostics { padding: 1rem; background: #16101f; }
    #update-notice { position: fixed; right: 1rem; bottom: 1rem; padding: 1rem; background: #321c4f; }
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

function renderHeader() {
    const header = addElement(root, 'header', {
        className: 'authenticated-header',
        text: 'PiggieTV authenticated navigation'
    });
    const home = addElement(header, 'a', { text: 'Home' });

    home.href = '#/home';
    const movies = addElement(header, 'a', { text: 'Movies' });

    movies.href = '#/movies';
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

function renderDiagnostics() {
    const params = new URLSearchParams(window.location.search);
    const allowed = params.get('admin') === '1' && params.get('debug') === '1';

    if (allowed) addElement(root, 'aside', { id: 'diagnostics', text: 'Sanitized diagnostics' });
    root.dataset.diagnosticsVisible = String(allowed);
}

function renderRoute() {
    if (activeHash) scrollPositions.set(activeHash, window.scrollY);
    activeHash = window.location.hash || '#/home';
    root.replaceChildren();
    root.dataset.authenticationRoute = String(isPtvAuthenticationRoute(getLocationState()));

    if (!shouldMountPtvAuthenticatedHeader(getLocationState())) {
        renderAuthentication();
        return;
    }

    renderHeader();
    const { path, search } = getHashRoute();

    if (path === '/movies' || path === '/shows') {
        renderBrowse(path, search);
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

    const waitingWorker = {
        postMessage: () => {
            document.documentElement.dataset.skipWaitingRequested = 'true';
        },
        state: 'installed'
    };
    const service = new PtvUpdateService({
        getActivityReason: () => params.get('active') === '1' ? 'Playback is active.' : '',
        reload: () => {
            document.documentElement.dataset.reloadRequested = 'true';
        },
        serviceWorker: {
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
