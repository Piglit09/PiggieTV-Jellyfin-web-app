import type { PtvClientProfile } from './clientProfile';
import { getPtvRouteControllerState, type PtvRouteControllerState } from '../shell/routeController';

export type PtvDirection = 'down' | 'left' | 'right' | 'up';

type PtvRemoteKeyEvent = Readonly<{
    code?: string;
    key?: string;
    keyCode?: number;
    which?: number;
}>;

type PtvPlaybackFocusEvent = Readonly<{
    active?: boolean;
}>;

type PtvFocusMemory = Readonly<{
    key: string;
    routeKey: string;
}>;

type PtvFocusLayer = Readonly<{
    element: HTMLElement;
    returnFocus: PtvFocusMemory | null;
}>;

type PtvFocusCache = Readonly<{
    candidates: HTMLElement[];
    graph: Map<HTMLElement, Partial<Record<PtvDirection, HTMLElement>>>;
    keys: Map<HTMLElement, string>;
    missing: string[];
    scope: HTMLElement;
}>;

export type PtvTvNavigationHistoryEntry = Readonly<{
    at: string;
    element: string;
    key: string;
    reason: string;
    route: string;
}>;

export type PtvTvNavigationGraphNode = Readonly<{
    down: string;
    key: string;
    label: string;
    left: string;
    right: string;
    up: string;
}>;

export type PtvTvNavigationSnapshot = Readonly<{
    brokenNavigationPaths: string[];
    currentFocusedElement: string;
    focusGraphRebuildCount: number;
    focusManagerReady: boolean;
    focusRecoveryCount: number;
    focusScopeCount: number;
    focusTargetCount: number;
    focusHistory: PtvTvNavigationHistoryEntry[];
    fullPageRerenderEstimate: number;
    geometryFallbackCount: number;
    focusableElementCount: number;
    lastKeyPressed: string;
    lastRoute: string;
    missingFocusableElements: string[];
    navigationMoves: number;
    routeOwner: string;
    navigationGraph: PtvTvNavigationGraphNode[];
    averageNavigationMs: number;
    duplicateKeySuppressedCount: number;
    maxNavigationMs: number;
    p95NavigationMs: number;
    routeDefaultFailureCount?: number;
    activeFocusTarget: string;
    activeNavigationScope: string;
    scope: string;
}>;

type PtvNavigationSubscriber = (snapshot: PtvTvNavigationSnapshot) => void;

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[contenteditable="true"]',
    '[role="button"]:not([aria-disabled="true"])',
    '[role="checkbox"]:not([aria-disabled="true"])',
    '[role="link"]:not([aria-disabled="true"])',
    '[role="menuitem"]:not([aria-disabled="true"])',
    '[role="option"]:not([aria-disabled="true"])',
    '[role="radio"]:not([aria-disabled="true"])',
    '[role="slider"]:not([aria-disabled="true"])',
    '[role="switch"]:not([aria-disabled="true"])',
    '[role="tab"]:not([aria-disabled="true"])',
    '[tabindex]:not([tabindex="-1"])',
    '[data-ptv-focusable="true"]',
    'summary'
].join(',');

const DIRECTIONAL_KEY_REPEAT_SUPPRESSION_MS = 55;
const MAX_NAVIGATION_TIMING_SAMPLES = 80;
const TARGET_LOOKUP_LIMIT = 3;
const SCOPE_SELECTOR_PREFIX = 'data-ptv-focus-scope';

const PAGE_SCOPE_SELECTOR = [
    '.ptv-shell-frame',
    '.ptv-reader',
    '.ptv-settings-page',
    '.ptv-detail-page',
    '.mainAnimatedPage:not(.hide)',
    '.page:not(.hide):not([aria-hidden="true"])',
    '[data-role="page"]:not(.hide):not([aria-hidden="true"])'
].join(',');

const LAYER_SELECTOR = [
    'dialog[open]',
    '[role="dialog"]',
    '[role="menu"]',
    '[aria-modal="true"]',
    '.actionSheet',
    '.MuiDialog-paper',
    '.MuiMenu-paper',
    '.MuiPopover-paper',
    '.ptv-books-card-overflow[open]',
    '.ptv-dialog',
    '.ptv-dropdown-menu',
    '.ptv-music-item-menu-popover',
    '.ptv-native-drawer',
    '.ptv-overlay-surface',
    '.ptv-performance-overlay',
    '.ptv-shell-dialog',
    '.ptv-shell-drawer',
    '.ptv-shell-dropdown-panel',
    '.ptv-shell-menu',
    '.ptv-shell-modal'
].join(',');

const CLOSE_BUTTON_SELECTOR = [
    '[aria-label*="close" i]',
    '.btnCancel',
    '.dialogCloseButton',
    '.dialog-close',
    '.drawer-close',
    '.ptv-close-button',
    '.ptv-shell-drawer-close',
    '[data-close]'
].join(',');

const MISSING_FOCUS_SELECTOR = [
    '[onclick]:not(a):not(button):not(input):not(select):not(textarea)',
    '[role="button"]:not([tabindex]):not(button)',
    '[role="link"]:not([tabindex]):not(a)',
    '[data-action]:not(a):not(button):not(input):not(select):not(textarea):not([tabindex])',
    '[data-ptv-clickable="true"]:not([tabindex])'
].join(',');

const BACK_KEYS = new Set(['Back', 'Backspace', 'BrowserBack', 'Escape', 'GoBack', 'XF86Back']);
const REMOTE_SELECT_KEYS = new Set([' ', 'Accept', 'Enter', 'OK', 'Return', 'Select', 'Space', 'Spacebar']);
// Android Back is 4, LG webOS Back is 461, and Samsung Tizen Back is 10009.
const LEGACY_REMOTE_BACK_CODES = new Set([4, 8, 27, 461, 10009]);
// Android DPAD_CENTER is 23 and Android ENTER is 66.
const LEGACY_REMOTE_SELECT_CODES = new Set([13, 23, 32, 66]);
const DIRECTIONS: readonly PtvDirection[] = ['up', 'down', 'left', 'right'];
const NON_EDITING_INPUT_TYPES = new Set([
    'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'
]);
const NATIVE_DIRECTION_INPUT_TYPES = new Set(['color', 'date', 'datetime-local', 'month', 'number', 'range', 'time', 'week']);
const FOCUS_HISTORY_LIMIT = 80;
const GRAPH_DIAGNOSTIC_LIMIT = 160;
const VIEWPORT_EPSILON = 1;
const FOCUS_RECOVERY_MAX_ATTEMPTS = 8;

const INITIAL_FOCUS_SELECTORS: Readonly<Record<string, readonly string[]>> = {
    books: [
        '[data-ptv-initial-focus]',
        '.ptv-books-row .ptv-books-card-cover',
        '.ptv-books-grid .ptv-books-card-cover'
    ],
    comics: [
        '[data-ptv-initial-focus]',
        '.ptv-books-row .ptv-books-card-cover',
        '.ptv-books-grid .ptv-books-card-cover'
    ],
    details: [
        '[data-ptv-initial-focus]',
        '.ptv-detail-page .btnPlay:not(.hide)',
        '.ptv-detail-page .btnReplay:not(.hide)',
        '.ptv-detail-page .detailButton:not(.hide)'
    ],
    home: [
        '[data-ptv-initial-focus="home-primary"]',
        '.ptv-native-home-primary-action',
        '.ptv-native-home-card-media-link',
        '.ptv-browse-card'
    ],
    login: [
        '[data-ptv-initial-focus]',
        'input:not([type="hidden"])',
        'button[type="submit"]'
    ],
    manga: [
        '[data-ptv-initial-focus]',
        '.ptv-books-row .ptv-books-card-cover',
        '.ptv-books-grid .ptv-books-card-cover'
    ],
    music: [
        '[data-ptv-initial-focus]',
        '.ptv-music-row .ptv-music-card-art',
        '.ptv-music-track-row button',
        '.ptv-music-main button'
    ],
    playback: [
        '[data-ptv-initial-focus]',
        '.ptv-player-top-back',
        '.ptv-player-pause-content',
        '.videoOsdBottom button:not(.hide)'
    ],
    reading: [
        '[data-ptv-initial-focus]',
        '.ptv-books-row .ptv-books-card-cover',
        '.ptv-books-grid .ptv-books-card-cover'
    ],
    search: [
        '[data-ptv-initial-focus="search"]',
        '.ptv-search-hero-form input',
        '#searchTextInput',
        'input[type="search"]'
    ],
    settings: [
        '[data-ptv-initial-focus]',
        '.ptv-settings-page input:not([type="hidden"])',
        '.ptv-settings-page select',
        '.ptv-settings-page button',
        '#myPreferencesMenuPage .listItem-border'
    ]
};

function getLegacyKeyCode(event: PtvRemoteKeyEvent) {
    return event.keyCode || event.which || 0;
}

function allowsLegacyRemoteCode(event: PtvRemoteKeyEvent) {
    return !event.key || event.key === 'Unidentified' || event.key === 'Process';
}

export function isPtvRemoteSelectKey(event: PtvRemoteKeyEvent) {
    if (event.key && REMOTE_SELECT_KEYS.has(event.key)) return true;
    if (event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'Space') return true;

    return allowsLegacyRemoteCode(event) && LEGACY_REMOTE_SELECT_CODES.has(getLegacyKeyCode(event));
}

export function isPtvRemoteBackKey(event: PtvRemoteKeyEvent) {
    if (event.key && BACK_KEYS.has(event.key)) return true;

    return allowsLegacyRemoteCode(event) && LEGACY_REMOTE_BACK_CODES.has(getLegacyKeyCode(event));
}

export function getPtvRemoteDirection(event: PtvRemoteKeyEvent): PtvDirection | null {
    switch (event.key) {
        case 'ArrowDown': return 'down';
        case 'ArrowLeft': return 'left';
        case 'ArrowRight': return 'right';
        case 'ArrowUp': return 'up';
        default: break;
    }

    switch (event.code) {
        case 'ArrowDown': return 'down';
        case 'ArrowLeft': return 'left';
        case 'ArrowRight': return 'right';
        case 'ArrowUp': return 'up';
        default: break;
    }

    if (!allowsLegacyRemoteCode(event)) return null;

    switch (getLegacyKeyCode(event)) {
        case 19:
        case 38: return 'up';
        case 20:
        case 40: return 'down';
        case 21:
        case 37: return 'left';
        case 22:
        case 39: return 'right';
        default: return null;
    }
}

function getLocationRouteKey() {
    if (typeof window === 'undefined') return '';

    return `${window.location.pathname}${window.location.hash}`;
}

function describeRouteOwner(owner = '') {
    if (!owner) return 'unknown';

    return owner;
}

function calculatePercentile(values: number[], percentile: number) {
    if (!values.length) return 0;

    const ordered = [...values].sort((left, right) => left - right);
    const index = Math.min(ordered.length - 1, Math.max(0, Math.floor((ordered.length - 1) * percentile)));

    return ordered[index];
}

function average(values: number[]) {
    if (!values.length) return 0;

    return Number.parseFloat((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function getElementRect(element: HTMLElement) {
    return element.getBoundingClientRect();
}

function hasUsableRect(element: HTMLElement) {
    const rect = getElementRect(element);

    if (rect.width > 0 && rect.height > 0) return true;

    // jsdom and a few older WebViews can expose layout through the bounding rect
    // while getClientRects is empty. A connected semantic control remains usable.
    return element.isConnected && element.matches(FOCUSABLE_SELECTOR) && typeof window !== 'undefined'
        && /jsdom/i.test(window.navigator?.userAgent || '');
}

function isElementStyleVisible(element: HTMLElement, boundary?: HTMLElement) {
    let current: HTMLElement | null = element;

    while (current) {
        const style = window.getComputedStyle(current);
        const opacity = Number.parseFloat(style.opacity);

        if (
            current.hidden
            || current.getAttribute('aria-hidden') === 'true'
            || current.hasAttribute('inert')
            || style.display === 'none'
            || style.visibility === 'hidden'
            || style.visibility === 'collapse'
            || style.opacity === '0'
            || (Number.isFinite(opacity) && opacity <= 0)
        ) {
            return false;
        }

        if (current === boundary) break;
        current = current.parentElement;
    }

    return true;
}

export function isPtvFocusableCandidate(element: HTMLElement, boundary?: HTMLElement) {
    if (!element.isConnected || !element.matches(FOCUSABLE_SELECTOR)) return false;
    if (!hasUsableRect(element)) return false;
    if (element.matches('[disabled], [aria-disabled="true"]')) return false;
    if (!isElementStyleVisible(element, boundary)) return false;

    const style = window.getComputedStyle(element);

    return style.pointerEvents !== 'none';
}

function isOnScreen(element: HTMLElement) {
    const rect = getElementRect(element);
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

    if (viewportWidth <= 0 || viewportHeight <= 0) return false;

    return rect.right >= -VIEWPORT_EPSILON
        && rect.left <= viewportWidth + VIEWPORT_EPSILON
        && rect.bottom >= -VIEWPORT_EPSILON
        && rect.top <= viewportHeight + VIEWPORT_EPSILON;
}

function isEditable(element: Element | null) {
    return (element instanceof HTMLInputElement && !NON_EDITING_INPUT_TYPES.has(element.type))
        || element instanceof HTMLSelectElement
        || element instanceof HTMLTextAreaElement
        || (element instanceof HTMLElement && element.isContentEditable);
}

function ownsNativeDirectionalNavigation(element: Element | null) {
    return element instanceof HTMLSelectElement
        || (element instanceof HTMLInputElement && NATIVE_DIRECTION_INPUT_TYPES.has(element.type));
}

function getDirectionalGap(rangeAStart: number, rangeAEnd: number, rangeBStart: number, rangeBEnd: number) {
    if (rangeBEnd <= rangeAStart) return rangeAStart - rangeBEnd;
    if (rangeAEnd <= rangeBStart) return rangeBStart - rangeAEnd;

    return 0;
}

function isInDirection(deltaX: number, deltaY: number, direction: PtvDirection) {
    switch (direction) {
        case 'down': return deltaY > 1;
        case 'left': return deltaX < -1;
        case 'right': return deltaX > 1;
        case 'up': return deltaY < -1;
    }
}

function getDirectionalDistance(origin: DOMRect, candidate: DOMRect, direction: PtvDirection) {
    const originX = origin.left + origin.width / 2;
    const originY = origin.top + origin.height / 2;
    const candidateX = candidate.left + candidate.width / 2;
    const candidateY = candidate.top + candidate.height / 2;
    const deltaX = candidateX - originX;
    const deltaY = candidateY - originY;

    if (!isInDirection(deltaX, deltaY, direction)) return Number.POSITIVE_INFINITY;

    const horizontal = direction === 'left' || direction === 'right';
    const primary = horizontal ? Math.abs(deltaX) : Math.abs(deltaY);
    const secondary = horizontal ? Math.abs(deltaY) : Math.abs(deltaX);
    const crossAxisGap = horizontal ?
        getDirectionalGap(origin.top, origin.bottom, candidate.top, candidate.bottom) :
        getDirectionalGap(origin.left, origin.right, candidate.left, candidate.right);
    const crossAxisScale = horizontal ?
        Math.min(origin.height, candidate.height) :
        Math.min(origin.width, candidate.width);
    const crossPenalty = (crossAxisGap / Math.max(1, crossAxisScale)) * 120;

    // The large cross-axis penalty keeps movement inside a row/column before
    // considering diagonally closer controls on a different rail.
    return primary + secondary * 2.2 + crossPenalty;
}

function findDirectionalTargetFromRects(
    current: HTMLElement,
    elements: readonly HTMLElement[],
    rects: ReadonlyMap<HTMLElement, DOMRect>,
    direction: PtvDirection
) {
    const origin = rects.get(current) || getElementRect(current);

    return elements
        .filter(element => element !== current)
        .map(element => ({
            distance: getDirectionalDistance(origin, rects.get(element) || getElementRect(element), direction),
            element,
            rect: rects.get(element) || getElementRect(element)
        }))
        .filter(candidate => Number.isFinite(candidate.distance))
        .sort((left, right) => {
            if (left.distance !== right.distance) return left.distance - right.distance;
            if (left.rect.top !== right.rect.top) return left.rect.top - right.rect.top;

            return left.rect.left - right.rect.left;
        })[0]?.element || null;
}

export function findPtvTvDirectionalTarget(
    current: HTMLElement,
    elements: HTMLElement[],
    direction: PtvDirection
) {
    const candidates = elements.filter(element => element === current || isPtvFocusableCandidate(element));
    const rects = new Map(candidates.map(element => [element, getElementRect(element)]));

    return findDirectionalTargetFromRects(current, candidates, rects, direction);
}

function focusElement(element: HTMLElement) {
    try {
        element.focus({ preventScroll: true });
    } catch {
        element.focus();
    }
}

function scrollFocusedElementIntoView(element: HTMLElement) {
    if (typeof element.scrollIntoView !== 'function') return;

    try {
        element.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
    } catch {
        element.scrollIntoView(false);
    }
}

function describeElement(element: Element | null) {
    if (!(element instanceof HTMLElement)) return 'none';

    const tag = element.tagName.toLowerCase();
    const id = element.id ? `#${element.id}` : '';
    const className = Array.from(element.classList).slice(0, 3).map(name => `.${name}`).join('');
    const label = element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent?.trim().slice(0, 60) || '';

    const labelDescription = label ? ` (${label})` : '';

    return `${tag}${id}${className}${labelDescription}`;
}

function getStructuralFocusKey(element: HTMLElement, boundary: HTMLElement) {
    const segments: string[] = [];
    let current: HTMLElement | null = element;

    while (current && current !== boundary && segments.length < 5) {
        const siblings = current.parentElement ? Array.from(current.parentElement.children) : [];
        const index = Math.max(0, siblings.indexOf(current));
        segments.unshift(`${current.tagName.toLowerCase()}:${index}`);
        current = current.parentElement;
    }

    return segments.join('/');
}

function getFocusKey(element: HTMLElement, boundary: HTMLElement) {
    const explicitKey = element.dataset.ptvFocusKey;

    if (explicitKey) return explicitKey;

    const itemContainer = element.closest<HTMLElement>(
        '[data-ptv-browse-item-id], [data-ptv-item-id], [data-id], [data-itemid], [data-item-id]'
    );
    const itemId = itemContainer?.dataset.ptvBrowseItemId
        || itemContainer?.dataset.ptvItemId
        || itemContainer?.dataset.id
        || itemContainer?.dataset.itemid
        || itemContainer?.dataset.itemId
        || '';
    const role = element.getAttribute('role') || element.tagName.toLowerCase();
    const classToken = Array.from(element.classList).find(name => !name.startsWith('ptv-tv-focus')) || '';

    if (itemId) return `item:${itemId}:${role}:${classToken}`;
    if (element.id) return `id:${element.id}`;

    const href = element.getAttribute('href');

    if (href) return `href:${href}:${classToken}`;

    const label = element.getAttribute('aria-label') || element.getAttribute('name') || element.getAttribute('title');

    if (label) return `label:${label}:${role}:${classToken}`;

    return `path:${getStructuralFocusKey(element, boundary)}`;
}

function dispatchFocusDiagnostic(name: string, detail: Record<string, unknown>) {
    if (typeof window === 'undefined') return;

    const event = document.createEvent('CustomEvent');

    // Older webOS WebViews do not consistently expose the CustomEvent constructor.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    event.initCustomEvent('ptv:focus-diagnostic', false, false, { detail, name });
    window.dispatchEvent(event);
}

function findVisibleElements(selector: string) {
    return Array.from(document.querySelectorAll<HTMLElement>(selector))
        .filter(element => element.isConnected && isElementStyleVisible(element));
}

function getTopVisibleElement(selector: string) {
    const elements = findVisibleElements(selector);

    return elements[elements.length - 1] || null;
}

function getRecoveryBaseReason(reason: string) {
    return reason.split(':retry:')[0];
}

function getRecoveryAttemptFromReason(reason: string) {
    const match = /:retry:(\d+)$/.exec(reason);

    return match ? Number.parseInt(match[1], 10) : 0;
}

function cssSafe(value: string) {
    return value && typeof window !== 'undefined' && 'CSS' in window && window.CSS?.escape
        ? window.CSS.escape(value)
        : value
            .replace(/(["'`\\])/g, '\\$1')
            .replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
}

function clampRouteScopeLookup(value: string) {
    return (value || '').toLowerCase().trim().slice(0, TARGET_LOOKUP_LIMIT);
}

function shouldAttemptFocusRecovery(reason: string) {
    const baseReason = getRecoveryBaseReason(reason);

    return baseReason === 'manager-start'
        || baseReason === 'content-ready'
        || baseReason === 'runtime-content-ready'
        || baseReason === 'route-change'
        || baseReason === 'direction-without-focus'
        || baseReason === 'select-without-focus'
        || baseReason === 'focus-lost'
        || baseReason === 'scope-changed'
        || baseReason === 'dynamic-content'
        || baseReason.startsWith('layer-')
        || baseReason === 'visibility-resume';
}

function getLayerTrigger(layer: HTMLElement) {
    const explicitId = layer.dataset.ptvFocusReturnId;
    const labelledId = layer.getAttribute('aria-labelledby');
    const triggerId = explicitId || labelledId;
    const trigger = triggerId ? document.getElementById(triggerId) : null;

    if (!(trigger instanceof HTMLElement) || layer.contains(trigger)) return null;

    const controlledIds = (trigger.getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean);
    const controlsLayer = Boolean(layer.id && controlledIds.includes(layer.id));
    const isToggle = trigger.hasAttribute('aria-expanded') || controlsLayer || Boolean(explicitId);

    return isToggle && trigger.matches(FOCUSABLE_SELECTOR) ? trigger : null;
}

function getLayerCloseControl(layer: HTMLElement) {
    const explicit = layer.querySelector<HTMLElement>(CLOSE_BUTTON_SELECTOR);

    if (explicit) return explicit;

    return Array.from(layer.querySelectorAll<HTMLElement>('button, [role="button"]')).find(candidate => {
        const label = candidate.getAttribute('aria-label') || candidate.textContent || '';

        return /^(back|cancel|close|dismiss|done|exit)$/i.test(label.trim());
    }) || null;
}

class PtvTvFocusManager {
    private cache: PtvFocusCache | null = null;
    private cacheDirty = true;
    private routeOwner = 'shell';
    private enabled = false;
    private defaultFocusByRoute = new Map<string, string>();
    private focusScopes = new Map<string, HTMLElement>();
    private focusTimings: number[] = [];
    private focusTargetCount = 0;
    private geometryFallbackCount = 0;
    private focusGraphRebuildCount = 0;
    private navigationMoveCount = 0;
    private duplicateKeySuppressedCount = 0;
    private focusHistory: PtvTvNavigationHistoryEntry[] = [];
    private focusMemory = new Map<string, PtvFocusMemory>();
    private geometryFramePending = false;
    private routeDefaultFailureCount = 0;
    private lastFocusedElement: HTMLElement | null = null;
    private lastKeyPressed = '';
    private lastKeyHandledAt = 0;
    private lastKeyHandledWasRepeat = false;
    private lastHandledDirection = '';
    private lastRestoreTarget?: PtvFocusMemory;
    private lastRouteKey = getLocationRouteKey();
    private layerStack: PtvFocusLayer[] = [];
    private layerReturnPending: PtvFocusMemory | null = null;
    private processingRemoteKey = false;
    private mutationFramePending = false;
    private observer: MutationObserver | null = null;
    private pageType = '';
    private routeRecoveryCount = 0;
    private pendingRestoreReason = '';
    private pendingRestoreMemory: PtvFocusMemory | null = null;
    private playbackActive = false;
    private playbackReturnFocus: PtvFocusMemory | null = null;
    private restoreSequence = 0;
    private subscribers = new Set<PtvNavigationSubscriber>();
    private nextFocusReason = '';
    private lastRecoveryAttempt = 0;

    private readonly handleVisibilityChange = () => {
        if (!this.enabled || document.hidden) return;

        this.scheduleRestore('visibility-resume');
    };

    private readonly handlePageShow = () => {
        if (!this.enabled) return;

        this.cacheDirty = true;
        this.lastRecoveryAttempt = 0;
        this.scheduleRestore('pageshow');
    };

    private readonly handleFocusIn = (event: FocusEvent) => {
        const target = event.target instanceof HTMLElement ? event.target : null;

        if (!target || !this.enabled) return;

        const activeLayer = this.getActiveLayer();

        if (activeLayer && !activeLayer.contains(target)) {
            this.scheduleRestore('focus-trap');
            return;
        }

        const scope = this.cache?.scope || this.findActiveScope();

        if (!scope.contains(target) && target !== scope) return;

        this.markFocusedElement(target, this.nextFocusReason || 'focusin');
        this.nextFocusReason = '';
        this.pendingRestoreReason = '';
    };

    private readonly handleFocusOut = () => {
        if (!this.enabled) return;

        window.requestAnimationFrame(() => {
            if (!this.enabled || document.hidden) return;

            const active = document.activeElement;

            if (!(active instanceof HTMLElement) || active === document.body || !active.isConnected) {
                this.scheduleRestore('focus-lost');
            }
        });
    };

    private readonly handleKeyDown = (event: KeyboardEvent) => {
        if (!this.enabled) return;

        if (!this.canHandleRouteOwnedKey()) return;

        const now = performance.now();
        const previousKey = this.lastKeyPressed;

        this.lastKeyPressed = event.key || event.code || `keyCode:${getLegacyKeyCode(event)}`;
        const isRepeatAction = (
            event.repeat
            && this.processingRemoteKey
            && now - this.lastKeyHandledAt < DIRECTIONAL_KEY_REPEAT_SUPPRESSION_MS
            && previousKey === this.lastKeyPressed
        );

        if (isRepeatAction) {
            this.duplicateKeySuppressedCount += 1;
            this.recordDiagnostic('ptv-tv-focus-duplicate-key-suppressed', {
                direction: this.lastHandledDirection,
                duplicateKeyCount: this.duplicateKeySuppressedCount,
                key: this.lastKeyPressed,
                routeOwner: this.routeOwner
            });
            return;
        }

        this.lastKeyHandledAt = now;
        this.lastHandledDirection = this.lastKeyPressed;
        this.lastKeyHandledWasRepeat = event.repeat;
        this.processingRemoteKey = true;
        window.requestAnimationFrame(() => {
            this.processingRemoteKey = false;
        });

        if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;

        const direction = getPtvRemoteDirection(event);
        const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const editable = isEditable(current);
        const cache = this.getCache();

        if (this.handleLayerTab(event, cache, current)) return;
        if (this.isReaderOwnedKey(cache, direction, event)) return;
        if (this.handleBackKey(event, cache, editable)) return;
        if (this.handleSelectKey(event, cache, current, editable)) return;
        this.handleDirectionKey(event, cache, current, direction, editable);

        this.publishSnapshot();
    };

    private canHandleRouteOwnedKey() {
        const datasetOwner = document.documentElement.dataset.ptvRouteOwner || '';
        const activeOwner = datasetOwner || this.routeOwner || 'shell';

        // If ownership metadata is available and shell owns the route, keep
        // route key handling with Jellyfin.
        if (activeOwner === 'shell' && datasetOwner) return false;

        return activeOwner !== 'shell';
    }

    private handleLayerTab(event: KeyboardEvent, cache: PtvFocusCache, current: HTMLElement | null) {
        if (event.key !== 'Tab' || !this.getActiveLayer()) return false;

        event.preventDefault();
        if (cache.candidates.length) {
            this.moveFocus(this.getTabTrapTarget(cache, current, event.shiftKey), 'dialog-tab-trap');
        } else {
            this.focusSentinel(cache.scope);
        }

        return true;
    }

    private isReaderOwnedKey(cache: PtvFocusCache, direction: PtvDirection | null, event: KeyboardEvent) {
        const isReader = cache.scope.closest('.ptv-reader') || cache.scope.matches('.ptv-reader');

        if (!isReader) return false;

        // Reader page-turning owns Left/Right/Space/Escape. Its document listener
        // is intentionally allowed to run after the focus manager.
        return direction === 'left'
            || direction === 'right'
            || isPtvRemoteSelectKey(event)
            || isPtvRemoteBackKey(event);
    }

    private handleBackKey(event: KeyboardEvent, cache: PtvFocusCache, editable: boolean) {
        if (!isPtvRemoteBackKey(event) || (editable && event.key === 'Backspace')) return false;

        if (this.getActiveLayer()) {
            if (this.closeActiveLayer('back')) event.preventDefault();

            // If the layer has its own close lifecycle, leave the event available
            // to that implementation instead of navigating the page behind it.
            return true;
        }

        event.preventDefault();
        if (this.playbackActive && this.activatePlaybackBack(cache)) return true;

        window.history.back();
        this.recordDiagnostic('ptv-tv-focus-back', { remoteKey: this.lastKeyPressed });

        return true;
    }

    private handleSelectKey(
        event: KeyboardEvent,
        cache: PtvFocusCache,
        current: HTMLElement | null,
        editable: boolean
    ) {
        if (!isPtvRemoteSelectKey(event)) return false;
        if (editable || ownsNativeDirectionalNavigation(current)) return true;

        if (!current || !cache.scope.contains(current) || !isPtvFocusableCandidate(current, cache.scope)) {
            event.preventDefault();
            this.restoreFocus('select-without-focus');

            return true;
        }

        event.preventDefault();
        current.click();
        this.recordDiagnostic('ptv-tv-focus-selected', {
            focusedKey: cache.keys.get(current) || '',
            remoteKey: this.lastKeyPressed
        });

        return true;
    }

    private handleDirectionKey(
        event: KeyboardEvent,
        cache: PtvFocusCache,
        current: HTMLElement | null,
        direction: PtvDirection | null,
        editable: boolean
    ) {
        if (!direction || ownsNativeDirectionalNavigation(current)) return;

        event.preventDefault();
        if (current && this.handleMenuTriggerDirection(current, direction, event)) return;
        const focused = this.moveInDirection(direction, cache, current, editable);

        if (!focused) {
            const active = cache.scope.contains(current || cache.scope) ? current : null;

            this.restoreFocus(active ? 'direction-without-focus' : 'direction-without-focus');
        }
    }

    private readonly handleMutation = (records: MutationRecord[]) => {
        if (!this.enabled) return;

        const meaningful = records.some(record => {
            if (record.type !== 'attributes' || record.attributeName !== 'class') return true;

            const target = record.target instanceof HTMLElement ? record.target : null;
            const previous = new Set(String(record.oldValue || '').split(/\s+/).filter(Boolean));
            const current = new Set(Array.from(target?.classList || []));
            previous.delete('ptv-tv-focus-visible');
            current.delete('ptv-tv-focus-visible');

            return previous.size !== current.size || Array.from(previous).some(token => !current.has(token));
        });

        if (!meaningful) return;

        this.cacheDirty = true;
        this.scheduleMutationRefresh();
    };

    private readonly handleContentReady = () => {
        this.notifyContentReady('runtime-content-ready');
    };

    private readonly handlePlaybackFocus = (event: Event) => {
        const detail = event instanceof CustomEvent ? event.detail as PtvPlaybackFocusEvent | undefined : undefined;

        this.setPlaybackActive(Boolean(detail?.active), detail?.active ? 'playback-start' : 'playback-stop');
    };

    private readonly handleRouteChange = (event: Event) => {
        this.rememberCurrentFocus();

        const detail = event instanceof CustomEvent ? event.detail as PtvRouteControllerState | undefined : undefined;
        const routeState = detail || getPtvRouteControllerState();

        this.lastRouteKey = routeState?.routeKey || getLocationRouteKey();
        this.pageType = routeState?.pageType || document.documentElement.dataset.ptvRoutePageType || '';
        this.routeOwner = routeState?.owner || document.documentElement.dataset.ptvRouteOwner || this.routeOwner;
        this.layerStack = [];
        this.pendingRestoreMemory = null;
        this.cacheDirty = true;
        this.scheduleRestore('route-change');
    };

    private readonly handleScroll = () => {
        if (!this.enabled || this.geometryFramePending) return;

        this.geometryFramePending = true;
        window.requestAnimationFrame(() => {
            this.geometryFramePending = false;
            this.refreshGeometry();
        });
    };

    enable() {
        if (this.enabled || typeof window === 'undefined' || typeof document === 'undefined') return;

        this.enabled = true;
        const initialRoute = getPtvRouteControllerState();
        this.lastRouteKey = initialRoute?.routeKey || getLocationRouteKey();
        this.pageType = initialRoute?.pageType || document.documentElement.dataset.ptvRoutePageType || '';
        this.routeOwner = initialRoute?.owner || document.documentElement.dataset.ptvRouteOwner || 'shell';
        this.playbackActive = document.documentElement.classList.contains('ptv-playing');

        document.addEventListener('focusin', this.handleFocusIn);
        document.addEventListener('focusout', this.handleFocusOut);
        document.addEventListener('keydown', this.handleKeyDown, true);
        document.addEventListener('scroll', this.handleScroll, true);
        window.addEventListener('hashchange', this.handleRouteChange);
        window.addEventListener('popstate', this.handleRouteChange);
        window.addEventListener('ptv:focus-content-ready', this.handleContentReady);
        window.addEventListener('ptv:playback-focus', this.handlePlaybackFocus);
        window.addEventListener('ptv:ready', this.handleContentReady);
        window.addEventListener('ptv:routechange', this.handleRouteChange);
        window.addEventListener('ptv:routecontrollerchange', this.handleRouteChange);
        // Temporary compatibility for builds that emitted the pre-prefix event.
        window.addEventListener('routecontrollerchange', this.handleRouteChange);
        window.addEventListener('visibilitychange', this.handleVisibilityChange);
        window.addEventListener('resize', this.handleScroll, { passive: true });
        window.addEventListener('jellyfin:pageshow', this.handlePageShow);
        window.addEventListener('pageshow', this.handlePageShow);

        this.observer = new MutationObserver(this.handleMutation);
        this.observer.observe(document.documentElement, {
            attributeFilter: ['aria-disabled', 'aria-hidden', 'class', 'disabled', 'hidden', 'inert', 'open', 'style', 'tabindex'],
            attributeOldValue: true,
            attributes: true,
            childList: true,
            subtree: true
        });

        this.lastRecoveryAttempt = 0;
        this.installPublicApi();
        this.scheduleRestore('manager-start');
        window.setTimeout(() => {
            this.scheduleRestore('startup-ready');
        }, 1);
    }

    disable() {
        if (!this.enabled) return;

        this.enabled = false;
        document.removeEventListener('focusin', this.handleFocusIn);
        document.removeEventListener('focusout', this.handleFocusOut);
        document.removeEventListener('keydown', this.handleKeyDown, true);
        document.removeEventListener('scroll', this.handleScroll, true);
        window.removeEventListener('hashchange', this.handleRouteChange);
        window.removeEventListener('popstate', this.handleRouteChange);
        window.removeEventListener('ptv:focus-content-ready', this.handleContentReady);
        window.removeEventListener('ptv:playback-focus', this.handlePlaybackFocus);
        window.removeEventListener('ptv:ready', this.handleContentReady);
        window.removeEventListener('ptv:routechange', this.handleRouteChange);
        window.removeEventListener('ptv:routecontrollerchange', this.handleRouteChange);
        window.removeEventListener('routecontrollerchange', this.handleRouteChange);
        window.removeEventListener('visibilitychange', this.handleVisibilityChange);
        window.removeEventListener('resize', this.handleScroll);
        window.removeEventListener('jellyfin:pageshow', this.handlePageShow);
        window.removeEventListener('pageshow', this.handlePageShow);
        this.observer?.disconnect();
        this.observer = null;
        this.cache = null;
        this.cacheDirty = true;
        this.layerStack = [];
        this.pendingRestoreReason = '';
        this.pendingRestoreMemory = null;
        this.restoreSequence += 1;
        document.querySelectorAll('.ptv-tv-focus-visible').forEach(element => {
            element.classList.remove('ptv-tv-focus-visible');
        });
    }

    clearHistory() {
        this.focusHistory = [];
        this.publishSnapshot();
    }

    private resolveScope(scope: string | HTMLElement) {
        if (scope instanceof HTMLElement) return scope;
        if (typeof scope !== 'string') return null;

        const trimmed = scope.trim();
        const lookupId = clampRouteScopeLookup(trimmed);
        const cachedScope = trimmed ? this.focusScopes.get(lookupId) : null;

        if (cachedScope) return cachedScope;

        if (!trimmed) return null;

        const byScopeAttr = document.querySelector<HTMLElement>(`[data-ptv-focus-scope="${cssSafe(trimmed)}"]`);

        if (byScopeAttr) return byScopeAttr;

        return document.querySelector<HTMLElement>(trimmed);
    }

    private findCandidateByTargetId(cache: PtvFocusCache, targetId: string) {
        if (!targetId) return null;

        const direct = cache.candidates.find(candidate => cache.keys.get(candidate) === targetId);

        if (direct) return direct;

        const byId = cache.candidates.find(candidate => candidate.id === targetId || candidate.getAttribute('data-ptv-focus-key') === targetId);

        if (byId) return byId;

        if (!targetId.includes('[') && !targetId.includes(']') && !targetId.includes(':')) {
            const matched = cache.scope.querySelector<HTMLElement>(`#${cssSafe(targetId)}`);

            if (matched) return matched;
        }

        return null;
    }

    private moveInDirection(
        direction: PtvDirection,
        cache: PtvFocusCache,
        active: HTMLElement | null,
        editable = false
    ) {
        if (editable && (direction === 'left' || direction === 'right')) return false;
        if (!direction || !active || !cache.scope.contains(active) || !cache.graph.has(active)) {
            this.recordDiagnostic('ptv-tv-focus-move-failed', {
                direction,
                focusMoveFailures: 1,
                reason: 'direction-without-focus'
            });

            return false;
        }

        if (direction === 'left' && this.getActiveLayer()?.matches('[role="menu"], .ptv-dropdown-menu, details[open]')) {
            this.closeActiveLayer('left');
            return false;
        }

        const startedAt = performance.now();
        const target = cache.graph.get(active)?.[direction] || this.getLayerWrapTarget(cache, active, direction);

        if (!target) {
            this.navigationMoveCount += 1;
            this.geometryFallbackCount += 1;
            this.recordNavigationTiming(performance.now() - startedAt);
            this.recordDiagnostic('ptv-tv-focus-move-failed', {
                direction,
                focusGraphNodeCount: cache.candidates.length,
                focusMoveFailures: 1,
                focusedKey: cache.keys.get(active) || '',
                reason: 'no-directional-target'
            });
            return false;
        }

        this.navigationMoveCount += 1;
        const focused = this.moveFocus(target, `direction:${direction}`);
        this.recordNavigationTiming(performance.now() - startedAt);
        this.recordDiagnostic('ptv-tv-focus-moved', {
            direction,
            focusGraphNodeCount: cache.candidates.length,
            focusGraphTargetKey: cache.keys.get(target) || '',
            focusGraphSourceKey: cache.keys.get(active) || '',
            focusMoveDurationMs: Math.round((performance.now() - startedAt) * 10) / 10,
            focusedKey: cache.keys.get(target) || '',
            focusMoveSuccess: focused
        });

        if (!focused) {
            this.recordDiagnostic('ptv-tv-focus-move-failed', {
                direction,
                focusGraphNodeCount: cache.candidates.length,
                focusMoveFailures: 1,
                focusedKey: cache.keys.get(target) || '',
                reason: 'focus-apply-failed'
            });
        }

        return focused;
    }

    registerScope(scope: string | HTMLElement) {
        const resolved = this.resolveScope(scope);

        if (!resolved) return null;

        const id = resolved.id || resolved.dataset.ptvFocusScope || `scope-${Date.now()}-${this.focusScopes.size + 1}`;

        resolved.dataset.ptvFocusScope = id;
        this.focusScopes.set(id, resolved);

        return id;
    }

    unregisterScope(scopeId: string) {
        const scope = this.focusScopes.get(scopeId);

        if (scope) {
            delete scope.dataset.ptvFocusScope;
        }
        this.focusScopes.delete(scopeId);
    }

    setDefaultTarget(targetId: string) {
        const cache = this.getCache();
        const target = this.findCandidateByTargetId(cache, targetId);

        if (!target) return false;

        const key = cache.keys.get(target) || getFocusKey(target, cache.scope);

        this.defaultFocusByRoute.set(this.lastRouteKey, key);
        return true;
    }

    focusDefault() {
        const cache = this.getCache();
        const routeDefaultKey = this.defaultFocusByRoute.get(this.lastRouteKey);
        const target = routeDefaultKey ? this.findCandidateByTargetId(cache, routeDefaultKey) : null;
        const restoreMemory = target ? {
            key: cache.keys.get(target) || routeDefaultKey || '',
            routeKey: this.lastRouteKey
        } : null;

        if (!routeDefaultKey || !restoreMemory || !target) {
            return this.restoreFocus('default-focus');
        }

        this.lastRestoreTarget = restoreMemory;
        this.routeDefaultFailureCount = Math.max(0, this.routeDefaultFailureCount - 1);
        this.restoreFocus('default-focus', restoreMemory);
        return true;
    }

    move(direction: PtvDirection) {
        const cache = this.getCache();
        const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;

        return this.moveInDirection(direction, cache, active);
    }

    remember(routeKey: string, targetId: string) {
        if (!routeKey || !targetId) return false;

        this.focusMemory.set(routeKey, {
            key: targetId,
            routeKey
        });
        return true;
    }

    restore(routeKey?: string) {
        if (routeKey && routeKey !== this.lastRouteKey) {
            this.lastRouteKey = routeKey;
            this.cacheDirty = true;
        }

        this.scheduleRestore('api-restore', routeKey ? this.focusMemory.get(routeKey) || null : null);
        return true;
    }

    pushModal(scopeId: string) {
        const scope = this.resolveScope(scopeId);

        if (!scope || this.layerStack.some(entry => entry.element === scope)) return false;

        const returnFocus = this.captureFocusMemoryWithoutCache(document.activeElement instanceof HTMLElement ? document.activeElement : this.lastFocusedElement || scope, this.findActiveScope());
        this.layerStack.push({
            element: scope,
            returnFocus
        });
        this.cacheDirty = true;
        this.scheduleRestore('modal-open');

        return true;
    }

    popModal() {
        const layer = this.layerStack.pop();

        if (!layer) return false;

        this.cacheDirty = true;
        this.scheduleRestore('modal-close', layer.returnFocus);
        return true;
    }

    recoverFocus() {
        this.routeRecoveryCount += 1;
        return this.recoverFocusIfNeeded('api-recover', this.lastRestoreTarget || null);
    }

    focus(element: HTMLElement, reason = 'api') {
        if (!element.isConnected) return false;

        if (!this.enabled) {
            focusElement(element);
            return document.activeElement === element;
        }

        return this.moveFocus(element, reason);
    }

    getSnapshot(): PtvTvNavigationSnapshot {
        const cache = this.enabled ? this.getCache() : this.cache;
        const graph = cache ? this.getDiagnosticGraph(cache) : [];
        const brokenNavigationPaths = cache ? this.getBrokenNavigationPaths(cache, graph) : [];
        const navigationTimings = [...this.focusTimings];
        const averageNavigationMs = average(navigationTimings);
        const p95NavigationMs = calculatePercentile(navigationTimings, 0.95);
        const maxNavigationMs = navigationTimings.length ? Math.max(...navigationTimings) : 0;
        const activeTarget = document.activeElement instanceof HTMLElement ? cache?.keys.get(document.activeElement) || getFocusKey(document.activeElement, cache?.scope || document.body) : '';
        const activeScope = cache?.scope || this.findActiveScope();

        return {
            brokenNavigationPaths,
            currentFocusedElement: describeElement(document.activeElement),
            focusHistory: [...this.focusHistory],
            focusableElementCount: cache?.candidates.length || 0,
            focusGraphRebuildCount: this.focusGraphRebuildCount,
            focusManagerReady: this.enabled,
            focusRecoveryCount: this.routeRecoveryCount,
            focusScopeCount: this.focusScopes.size,
            focusTargetCount: this.focusTargetCount,
            fullPageRerenderEstimate: 0,
            geometryFallbackCount: this.geometryFallbackCount,
            lastKeyPressed: this.lastKeyPressed || 'none',
            lastRoute: this.lastRouteKey || getLocationRouteKey() || 'none',
            missingFocusableElements: [...(cache?.missing || [])],
            navigationGraph: graph,
            navigationMoves: this.navigationMoveCount,
            routeOwner: describeRouteOwner(this.routeOwner),
            averageNavigationMs,
            duplicateKeySuppressedCount: this.duplicateKeySuppressedCount,
            maxNavigationMs,
            p95NavigationMs,
            routeDefaultFailureCount: this.routeDefaultFailureCount,
            activeFocusTarget: activeTarget,
            activeNavigationScope: describeElement(activeScope),
            scope: describeElement(cache?.scope || null)
        };
    }

    notifyContentReady(reason = 'content-ready') {
        if (!this.enabled) return;

        this.cacheDirty = true;
        this.scheduleRestore(reason);
    }

    setPlaybackActive(active: boolean, reason = 'playback') {
        if (!this.enabled || active === this.playbackActive) return;

        if (active) {
            this.rememberCurrentFocus();
            this.playbackReturnFocus = this.captureFocusMemory();
        }

        this.playbackActive = active;
        this.cacheDirty = true;

        if (!active) {
            this.scheduleRestore(`${reason}:return`, this.playbackReturnFocus);
            this.playbackReturnFocus = null;
        } else {
            this.scheduleRestore(reason);
        }
    }

    subscribe(subscriber: PtvNavigationSubscriber) {
        this.subscribers.add(subscriber);
        subscriber(this.getSnapshot());

        return () => {
            this.subscribers.delete(subscriber);
        };
    }

    private activatePlaybackBack(cache: PtvFocusCache) {
        const backButton = cache.candidates.find(candidate => (
            candidate.matches('.ptv-player-top-back')
            || candidate.getAttribute('aria-label')?.toLowerCase() === 'back'
        ));

        if (!backButton) return false;

        backButton.click();
        return true;
    }

    private buildCache(scope: HTMLElement): PtvFocusCache {
        const candidates = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

        if (scope.matches(FOCUSABLE_SELECTOR)) candidates.unshift(scope);

        const usableCandidates = candidates.filter((candidate, index) => (
            candidates.indexOf(candidate) === index && isPtvFocusableCandidate(candidate, scope)
        ));
        const rects = new Map(usableCandidates.map(element => [element, getElementRect(element)]));
        const keys = new Map<HTMLElement, string>();
        const keyCounts = new Map<string, number>();

        usableCandidates.forEach(element => {
            const baseKey = getFocusKey(element, scope);
            const count = keyCounts.get(baseKey) || 0;

            keyCounts.set(baseKey, count + 1);
            keys.set(element, count ? `${baseKey}#${count + 1}` : baseKey);
        });

        const graph = new Map<HTMLElement, Partial<Record<PtvDirection, HTMLElement>>>();

        usableCandidates.forEach(element => {
            const edges: Partial<Record<PtvDirection, HTMLElement>> = {};

            DIRECTIONS.forEach(direction => {
                const target = findDirectionalTargetFromRects(element, usableCandidates, rects, direction);

                if (target) edges[direction] = target;
            });
            graph.set(element, edges);
        });

        const missing = Array.from(scope.querySelectorAll<HTMLElement>(MISSING_FOCUS_SELECTOR))
            .filter(element => isElementStyleVisible(element, scope))
            .slice(0, 80)
            .map(describeElement);

        if (!usableCandidates.length) missing.unshift(`No focusable elements in ${describeElement(scope)}`);
        this.focusGraphRebuildCount += 1;
        this.focusTargetCount = usableCandidates.length;

        return { candidates: usableCandidates, graph, keys, missing, scope };
    }

    private captureFocusMemory(): PtvFocusMemory | null {
        const active = document.activeElement instanceof HTMLElement ? document.activeElement : this.lastFocusedElement;
        const cache = this.getCache();

        if (!active || !cache.scope.contains(active)) return null;

        return {
            key: cache.keys.get(active) || getFocusKey(active, cache.scope),
            routeKey: this.lastRouteKey
        };
    }

    private closeActiveLayer(reason: string) {
        const layer = this.getActiveLayer();

        if (!layer) return false;

        const layerState = [...this.layerStack].reverse().find(entry => entry.element === layer);
        const layerTrigger = getLayerTrigger(layer);
        const details = layer instanceof HTMLDetailsElement ? layer : layer.closest<HTMLDetailsElement>('details[open]');

        if (details?.open) {
            details.open = false;
        } else if (layer instanceof HTMLDialogElement && layer.open) {
            layer.close();
        } else if (layerTrigger) {
            layerTrigger.click();
        } else {
            const closeButton = getLayerCloseControl(layer);

            if (!closeButton) return false;
            closeButton.click();
        }

        this.layerStack = this.layerStack.filter(entry => entry.element !== layer);
        this.cacheDirty = true;
        this.scheduleRestore(`layer-close:${reason}`, layerState?.returnFocus || null);
        return true;
    }

    private findActiveScope() {
        const layer = getTopVisibleElement(LAYER_SELECTOR);

        if (layer) return layer;

        if (this.playbackActive) {
            const playbackScope = getTopVisibleElement('#videoOsdPage, .videoOsdPage, .ptv-player-chrome-root');

            if (playbackScope) return playbackScope;
        }

        return getTopVisibleElement(PAGE_SCOPE_SELECTOR) || document.body;
    }

    private findMemoryTarget(cache: PtvFocusCache, memory: PtvFocusMemory | null) {
        if (!memory || memory.routeKey !== this.lastRouteKey) return null;

        return cache.candidates.find(candidate => cache.keys.get(candidate) === memory.key) || null;
    }

    private findInitialTarget(cache: PtvFocusCache) {
        const selectors = INITIAL_FOCUS_SELECTORS[this.pageType]
            || INITIAL_FOCUS_SELECTORS[document.documentElement.dataset.ptvRoutePageType || '']
            || ['[data-ptv-initial-focus]'];

        for (const selector of selectors) {
            const candidate = cache.candidates.find(element => element.matches(selector));

            if (candidate) return candidate;
        }

        const pageCandidate = cache.candidates.find(candidate => (
            candidate.closest('main, .detailPageWrapperContainer, .ptv-music-main, .ptv-books-main, .ptv-search-page')
        ));

        return pageCandidate || cache.candidates.find(isOnScreen) || cache.candidates[0] || null;
    }

    private findBodyFallbackTarget() {
        const candidates = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
            .filter(candidate => candidate !== document.body && candidate.isConnected && isElementStyleVisible(candidate, document.body));

        if (!candidates.length) return null;

        const explicit = candidates.find(candidate => candidate.matches('[data-ptv-initial-focus]'));

        if (explicit) return explicit;

        return candidates.find(candidate => (
            candidate.closest('main, .detailPageWrapperContainer, .ptv-music-main, .ptv-books-main, .ptv-search-page')
        )) || candidates[0] || null;
    }

    private getActiveLayer() {
        return [...this.layerStack].reverse().find(entry => (
            entry.element.isConnected && isElementStyleVisible(entry.element)
        ))?.element || null;
    }

    private getBrokenNavigationPaths(cache: PtvFocusCache, graph: readonly PtvTvNavigationGraphNode[]) {
        const broken: string[] = [];

        if (!cache.candidates.length) broken.push('The active page has no focusable element.');

        graph.forEach(node => {
            if (!node.up && !node.down && !node.left && !node.right && cache.candidates.length > 1) {
                broken.push(`${node.key} is isolated from every directional path.`);
            }
        });

        if (cache.missing.length) broken.push(`${cache.missing.length} visible interactive element(s) are missing focus semantics.`);

        return broken.slice(0, 80);
    }

    private getCache() {
        if (!this.cacheDirty && this.cache?.scope.isConnected) return this.cache;

        const scope = this.findActiveScope();

        this.syncLayers(scope);
        this.cache = this.buildCache(scope);
        this.cacheDirty = false;

        return this.cache;
    }

    private getDiagnosticGraph(cache: PtvFocusCache) {
        return cache.candidates.slice(0, GRAPH_DIAGNOSTIC_LIMIT).map(element => {
            const edges = cache.graph.get(element) || {};

            return {
                down: edges.down ? cache.keys.get(edges.down) || '' : '',
                key: cache.keys.get(element) || '',
                label: describeElement(element),
                left: edges.left ? cache.keys.get(edges.left) || '' : '',
                right: edges.right ? cache.keys.get(edges.right) || '' : '',
                up: edges.up ? cache.keys.get(edges.up) || '' : ''
            };
        });
    }

    private getLayerWrapTarget(cache: PtvFocusCache, current: HTMLElement, direction: PtvDirection) {
        if (!cache.scope.matches(LAYER_SELECTOR) || cache.candidates.length < 2) return null;

        const vertical = direction === 'up' || direction === 'down';

        if (!vertical && cache.scope.matches('[role="menu"], .ptv-dropdown-menu')) return null;

        const ordered = [...cache.candidates].sort((left, right) => {
            const leftRect = getElementRect(left);
            const rightRect = getElementRect(right);

            return vertical ? leftRect.top - rightRect.top || leftRect.left - rightRect.left :
                leftRect.left - rightRect.left || leftRect.top - rightRect.top;
        });
        const currentIndex = ordered.indexOf(current);

        if (currentIndex < 0) return ordered[0] || null;
        if (direction === 'down' || direction === 'right') return ordered[(currentIndex + 1) % ordered.length] || null;

        return ordered[(currentIndex - 1 + ordered.length) % ordered.length] || null;
    }

    private getTabTrapTarget(cache: PtvFocusCache, current: HTMLElement | null, reverse: boolean) {
        if (!cache.candidates.length) return cache.scope;

        const currentIndex = current ? cache.candidates.indexOf(current) : -1;

        if (currentIndex < 0) return reverse ? cache.candidates[cache.candidates.length - 1] : cache.candidates[0];

        const offset = reverse ? -1 : 1;
        const index = (currentIndex + offset + cache.candidates.length) % cache.candidates.length;

        return cache.candidates[index] || cache.candidates[0];
    }

    private handleMenuTriggerDirection(current: HTMLElement, direction: PtvDirection, event: KeyboardEvent) {
        if (!current.matches('[aria-haspopup="menu"]') || (direction !== 'down' && direction !== 'up')) return false;

        if (current.getAttribute('aria-expanded') !== 'true') current.click();
        event.preventDefault();
        this.cacheDirty = true;
        this.pendingRestoreReason = direction === 'up' ? 'menu-open-last' : 'menu-open-first';
        this.scheduleRestore(this.pendingRestoreReason);
        return true;
    }

    private installPublicApi() {
        const root = window as unknown as {
            PTV?: Record<string, unknown> & {
                tvFocus?: Record<string, unknown>;
            };
        };

        root.PTV ||= {};
        root.PTV.tvFocus = {
            clearHistory: () => this.clearHistory(),
            focus: (element: HTMLElement, reason?: string) => this.focus(element, reason),
            focusDefault: () => this.focusDefault(),
            getActiveRoute: () => this.lastRouteKey,
            move: (direction: string) => (
                direction === 'up' || direction === 'down' || direction === 'left' || direction === 'right'
                    ? this.move(direction as PtvDirection)
                    : false
            ),
            getSnapshot: () => this.getSnapshot(),
            popModal: () => this.popModal(),
            pushModal: (scopeId: string) => this.pushModal(scopeId),
            recoverFocus: () => this.recoverFocus(),
            registerScope: (scope: string | HTMLElement) => this.registerScope(scope),
            remember: (routeKey: string, targetId: string) => this.remember(routeKey, targetId),
            notifyContentReady: (reason?: string) => this.notifyContentReady(reason),
            restore: (routeKey?: string) => this.restore(routeKey),
            setDefaultTarget: (targetId: string) => this.setDefaultTarget(targetId),
            unregisterScope: (scopeId: string) => this.unregisterScope(scopeId)
        };
    }

    private markFocusedElement(element: HTMLElement, reason: string) {
        if (this.lastFocusedElement && this.lastFocusedElement !== element) {
            this.lastFocusedElement.classList.remove('ptv-tv-focus-visible');
        }
        element.classList.add('ptv-tv-focus-visible');
        this.lastFocusedElement = element;

        const cache = this.getCache();
        const key = cache.keys.get(element) || getFocusKey(element, cache.scope);
        const entry: PtvFocusMemory = { key, routeKey: this.lastRouteKey };

        if (!this.getActiveLayer()) this.focusMemory.set(this.lastRouteKey, entry);

        const historyEntry: PtvTvNavigationHistoryEntry = {
            at: new Date().toISOString(),
            element: describeElement(element),
            key,
            reason,
            route: this.lastRouteKey
        };
        const previous = this.focusHistory[this.focusHistory.length - 1];

        if (!previous || previous.key !== historyEntry.key || previous.reason !== historyEntry.reason) {
            this.focusHistory = [...this.focusHistory, historyEntry].slice(-FOCUS_HISTORY_LIMIT);
        }

        scrollFocusedElementIntoView(element);
        this.publishSnapshot();
    }

    private moveFocus(element: HTMLElement, reason: string): boolean {
        this.nextFocusReason = reason;
        focusElement(element);
        scrollFocusedElementIntoView(element);

        if (document.activeElement === element && this.nextFocusReason) {
            this.markFocusedElement(element, reason);
            this.nextFocusReason = '';
            return true;
        }
        this.handleScroll();
        return false;
    }

    private publishSnapshot() {
        if (!this.subscribers.size) return;

        const snapshot = this.getSnapshot();

        this.subscribers.forEach(subscriber => {
            subscriber(snapshot);
        });
    }

    private recordNavigationTiming(durationMs: number) {
        if (!Number.isFinite(durationMs) || durationMs < 0) return;

        this.focusTimings = [...this.focusTimings, durationMs].slice(-MAX_NAVIGATION_TIMING_SAMPLES);
    }

    private recordDiagnostic(name: string, detail: Record<string, unknown>) {
        dispatchFocusDiagnostic(name, {
            ...detail,
            route: this.lastRouteKey
        });
    }

    private refreshGeometry() {
        if (!this.enabled || !this.cache || this.cacheDirty) return;

        const candidates = this.cache.candidates.filter(candidate => isPtvFocusableCandidate(candidate, this.cache?.scope));

        if (candidates.length !== this.cache.candidates.length) {
            this.cacheDirty = true;
            this.scheduleMutationRefresh();
            return;
        }

        const rects = new Map(candidates.map(element => [element, getElementRect(element)]));
        const graph = new Map<HTMLElement, Partial<Record<PtvDirection, HTMLElement>>>();

        candidates.forEach(element => {
            const edges: Partial<Record<PtvDirection, HTMLElement>> = {};

            DIRECTIONS.forEach(direction => {
                const target = findDirectionalTargetFromRects(element, candidates, rects, direction);

                if (target) edges[direction] = target;
            });
            graph.set(element, edges);
        });
        this.cache = { ...this.cache, graph };
        this.publishSnapshot();
    }

    private rememberCurrentFocus() {
        const memory = this.captureFocusMemory();

        if (memory) this.focusMemory.set(memory.routeKey, memory);
    }

    private restoreFocus(reason: string, requestedMemory: PtvFocusMemory | null = null) {
        if (!this.enabled || document.hidden) return false;

        const cache = this.getCache();
        let target = this.findMemoryTarget(cache, requestedMemory || this.focusMemory.get(this.lastRouteKey) || null);
        let source = requestedMemory ? 'requested-memory' : 'route-memory';

        if (!target && reason === 'menu-open-last') {
            target = cache.candidates[cache.candidates.length - 1] || null;
            source = 'layer-last';
        }

        if (!target) {
            target = this.findInitialTarget(cache);
            source = 'initial-rule';
        }

        if (!target) {
            if (reason === 'default-focus' && !requestedMemory) {
                this.routeDefaultFailureCount += 1;
            }

            this.focusSentinel(cache.scope);
            const focusedFallback = document.activeElement === cache.scope || document.activeElement instanceof HTMLElement
                && document.activeElement !== document.body;

            if (focusedFallback) {
                this.pendingRestoreReason = '';
                this.lastRecoveryAttempt = 0;
                this.recordDiagnostic('ptv-tv-focus-restored', {
                    focusRestoreSource: 'sentinel',
                    focusRestoreSuccess: true,
                    focusedKey: cache.keys.get(cache.scope) || '',
                    reason
                });
                return false;
            }

            this.pendingRestoreReason = reason;
            if (this.recoverFocusIfNeeded(reason, requestedMemory)) {
                return false;
            }
            this.recordDiagnostic('ptv-tv-focus-restore-pending', {
                focusRestoreSource: 'sentinel',
                focusRestoreSuccess: false,
                reason
            });
            return false;
        }

        this.pendingRestoreReason = '';
        const focusRestored = this.moveFocus(target, `restore:${reason}`);
        this.recordDiagnostic('ptv-tv-focus-restored', {
            focusRestoreSource: source,
            focusRestoreSuccess: focusRestored,
            focusedKey: cache.keys.get(target) || '',
            reason
        });

        if (!focusRestored) {
            this.recoverFocusIfNeeded(reason, requestedMemory);
        } else {
            this.lastRecoveryAttempt = 0;
        }

        return focusRestored;
    }

    private recoverFocusIfNeeded(reason: string, requestedMemory: PtvFocusMemory | null = null) {
        const baseReason = getRecoveryBaseReason(reason);
        const attempt = getRecoveryAttemptFromReason(reason);

        if (!shouldAttemptFocusRecovery(baseReason)) return false;
        if (attempt >= FOCUS_RECOVERY_MAX_ATTEMPTS) {
            this.recordDiagnostic('ptv-tv-focus-restore-retry-stopped', {
                baseReason,
                attempt,
                focusRecoveryLimit: FOCUS_RECOVERY_MAX_ATTEMPTS,
                reason
            });
            return false;
        }

        this.lastRecoveryAttempt = attempt + 1;
        const recoveryReason = `${baseReason}:retry:${this.lastRecoveryAttempt}`;

        this.recordDiagnostic('ptv-tv-focus-restore-retry', {
            baseReason,
            focusRecoveryAttempt: this.lastRecoveryAttempt,
            reason
        });
        this.scheduleRestore(recoveryReason, requestedMemory);
        return true;
    }

    private focusSentinel(scope: HTMLElement) {
        if (scope === document.body) {
            const fallback = this.findBodyFallbackTarget();

            if (fallback) {
                this.moveFocus(fallback, 'fallback-body');
                return;
            }
            return;
        }

        if (scope.getAttribute('tabindex') !== '-1') scope.setAttribute('tabindex', '-1');
        if (scope.dataset.ptvFocusSentinel !== 'true') scope.dataset.ptvFocusSentinel = 'true';
        focusElement(scope);
    }

    private scheduleMutationRefresh() {
        if (this.mutationFramePending) return;

        this.mutationFramePending = true;
        window.requestAnimationFrame(() => {
            this.mutationFramePending = false;
            if (!this.enabled) return;

            const previousLayer = this.getActiveLayer();

            this.cacheDirty = true;
            const cache = this.getCache();
            const nextLayer = this.getActiveLayer();
            const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            const layerReturn = this.layerReturnPending;

            this.layerReturnPending = null;

            if (layerReturn) {
                this.scheduleRestore('layer-dismissed', layerReturn);
            } else if (nextLayer && nextLayer !== previousLayer && (!active || !nextLayer.contains(active))) {
                this.scheduleRestore('layer-open');
            } else if (this.pendingRestoreReason || !active || active === document.body || !active.isConnected) {
                this.scheduleRestore(this.pendingRestoreReason || 'dynamic-content');
            } else if (!cache.scope.contains(active) && active !== cache.scope) {
                this.scheduleRestore('scope-changed');
            }
        });
    }

    private scheduleRestore(reason: string, memory: PtvFocusMemory | null = null) {
        if (!this.enabled) return;

        this.pendingRestoreReason = reason;

        if (memory) {
            this.focusMemory.set(memory.routeKey, memory);
            this.pendingRestoreMemory = memory;
        }
        const sequence = ++this.restoreSequence;

        window.requestAnimationFrame(() => {
            if (sequence !== this.restoreSequence) return;

            const requestedMemory = this.pendingRestoreMemory;

            this.pendingRestoreMemory = null;
            this.cacheDirty = true;
            this.restoreFocus(this.pendingRestoreReason || reason, requestedMemory);
        });
    }

    private syncLayers(scope: HTMLElement) {
        const visibleLayers = findVisibleElements(LAYER_SELECTOR);
        const removedLayer = [...this.layerStack].reverse().find(layer => !visibleLayers.includes(layer.element));
        const retained = this.layerStack.filter(layer => (
            visibleLayers.includes(layer.element) && layer.element.isConnected
        ));

        if (removedLayer?.returnFocus) this.layerReturnPending = removedLayer.returnFocus;

        visibleLayers.forEach(layer => {
            if (retained.some(entry => entry.element === layer)) return;

            const active = document.activeElement instanceof HTMLElement ? document.activeElement : this.lastFocusedElement;
            const trigger = getLayerTrigger(layer);
            let returnElement: HTMLElement | null = null;

            if (active && !layer.contains(active)) {
                returnElement = active;
            } else if (trigger) {
                returnElement = trigger;
            }
            const returnFocus = returnElement ? this.captureFocusMemoryWithoutCache(returnElement, scope) : null;

            retained.push({ element: layer, returnFocus });
        });
        this.layerStack = retained;
    }

    private captureFocusMemoryWithoutCache(element: HTMLElement, scope: HTMLElement): PtvFocusMemory | null {
        if (!element.isConnected) return null;

        const boundary = scope.contains(element) ? scope : this.cache?.scope || document.body;

        return {
            key: this.cache?.keys.get(element) || getFocusKey(element, boundary),
            routeKey: this.lastRouteKey
        };
    }
}

const tvFocusManager = new PtvTvFocusManager();

export function clearPtvTvNavigationHistory() {
    tvFocusManager.clearHistory();
}

export function focusPtvTvElement(element: HTMLElement, reason?: string) {
    return tvFocusManager.focus(element, reason);
}

export function getPtvTvNavigationSnapshot() {
    return tvFocusManager.getSnapshot();
}

export function notifyPtvTvFocusContentReady(reason?: string) {
    tvFocusManager.notifyContentReady(reason);
}

export function notifyPtvTvPlaybackFocus(active: boolean) {
    tvFocusManager.setPlaybackActive(active);
}

export function subscribePtvTvNavigation(subscriber: PtvNavigationSubscriber) {
    return tvFocusManager.subscribe(subscriber);
}

export function syncPtvTvFocusEngine(profile: Pick<PtvClientProfile, 'isTv'>) {
    if (profile.isTv) tvFocusManager.enable();
    else tvFocusManager.disable();
}
