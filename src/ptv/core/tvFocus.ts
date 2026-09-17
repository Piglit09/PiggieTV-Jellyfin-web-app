/* eslint-disable @stylistic/operator-linebreak, compat/compat, no-nested-ternary, sonarjs/cognitive-complexity, sonarjs/no-nested-conditional -- The authoritative legacy-TV focus owner keeps branch order explicit for input ownership, compatibility, and passive stage diagnostics. */
import type { PtvClientProfile } from './clientProfile';
import { getPtvRouteControllerState, type PtvRouteControllerState } from '../shell/routeController';
import { shouldContinuePtvHiddenVideoDirectionalGesture } from '../modules/playback/videoInputOwnership';
import type {
    PtvFocusElementCategory,
    PtvFocusRegionClass,
    PtvFocusScopeCategory,
    PtvRemoteInputSource,
    PtvSafeRemoteAction
} from './diagnostics/diagnosticContracts';

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

export type PtvPlaybackBackAction = 'controls' | 'video';
export type PtvPlaybackBackHandler = (action: PtvPlaybackBackAction) => boolean;
export type PtvPlaybackSurface = 'full-screen-player' | 'mini-player';

type PtvInputPipelineContext = {
    action: PtvSafeRemoteAction;
    defaultPreventedBefore: boolean;
    handlerReached: boolean;
    inputId: string;
    movementAttempted: boolean;
    movementConfirmed: boolean;
    repeat: boolean;
    repeatCount: number;
    source: PtvRemoteInputSource;
    stageSequence: number;
    startedAt: number;
    targetFound: boolean;
};

type PtvFocusMemory = Readonly<{
    horizontalScrollOwnerKey?: string;
    key: string;
    routeKey: string;
    scrollLeft?: number;
    scrollTop?: number;
    verticalScrollOwnerKey?: string;
}>;

type PtvFocusLayer = Readonly<{
    element: HTMLElement;
    returnFocus: PtvFocusMemory | null;
}>;

type PtvFocusCache = Readonly<{
    candidates: HTMLElement[];
    diagnostics: PtvTvFocusGraphSummary;
    graph: Map<HTMLElement, Partial<Record<PtvDirection, HTMLElement>>>;
    keys: Map<HTMLElement, string>;
    missing: string[];
    scope: HTMLElement;
}>;

export type PtvTvFocusGraphSummary = Readonly<{
    activeScope: PtvFocusScopeCategory;
    buildDurationMs: number;
    candidateCountByCategory: Readonly<Record<PtvFocusElementCategory, number>>;
    containerCount: number;
    currentCandidatePresent: boolean;
    currentRegion: PtvFocusRegionClass;
    enabledCount: number;
    generatedAt: string;
    generation: number;
    lastRebuildReason: string;
    nearestCandidateCategories: Readonly<Record<PtvDirection, PtvFocusElementCategory>>;
    nearestCandidateFingerprints: Readonly<Record<PtvDirection, string>>;
    offscreenCount: number;
    rejectedByReason: Readonly<{
        blockedByModal: number;
        detached: number;
        disabled: number;
        hidden: number;
        outsideActiveScope: number;
        zeroSize: number;
    }>;
    totalCandidateCount: number;
    visibleCount: number;
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
    focusGraphSummary: PtvTvFocusGraphSummary;
    focusEngineDisposalCount: number;
    focusEngineDuplicateListenerCount: number;
    focusEngineEnableReason: string;
    focusEngineInitializationCount: number;
    focusEngineListenerInstallCount: number;
    focusEngineRequested: boolean;
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
const FOCUS_CONFIRMATION_TIMEOUT_MS = 160;
const INPUT_REPEAT_WINDOW_MS = 400;
const MAX_NAVIGATION_TIMING_SAMPLES = 80;
const TARGET_LOOKUP_LIMIT = 3;

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

const FULL_SCREEN_MUSIC_SCOPE_SELECTOR = [
    '.ptv-music-fullscreen-player',
    '.ptv-fullscreen-music-player',
    '.ptv-music-now-playing-view[data-ptv-playback-surface="full-screen-player"]'
].join(',');

const MINI_PLAYER_SCOPE_SELECTOR = '.ptv-media-dock[data-ptv-playback-surface="mini-player"]';
const MINI_PLAYER_PAGE_EXIT_SELECTOR = `${MINI_PLAYER_SCOPE_SELECTOR}[data-ptv-focus-escape-up="page"]`;
const VIDEO_PLAYBACK_SCOPE_SELECTOR = [
    '#videoOsdPage',
    '.videoOsdPage',
    '.ptv-player-chrome-root'
].join(',');
const VIDEO_PLAYBACK_CANDIDATE_SELECTOR = [
    '#videoOsdPage',
    '.videoOsdPage',
    '.videoOsdBottom',
    '.videoOsdTop',
    '.osdControls',
    '.osdHeader',
    '.ptv-player-chrome-root'
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

export function normalizePtvRemoteDiagnosticAction(event: PtvRemoteKeyEvent): PtvSafeRemoteAction {
    const direction = getPtvRemoteDirection(event);

    if (direction) return direction;
    if (isPtvRemoteSelectKey(event)) return 'enter';
    if (isPtvRemoteBackKey(event)) return 'back';

    const key = String(event.key || event.code || '').toLowerCase();

    if (/^(?:mediaplaypause|media(?:play|pause)|play|pause)$/.test(key)) return 'play-pause';
    if (/^(?:contextmenu|menu|menutoggle)$/.test(key)) return 'menu';
    if (/^(?:colorf[0-3](?:red|green|yellow|blue)?|red|green|yellow|blue)$/.test(key)) return 'color-key';

    const legacyCode = allowsLegacyRemoteCode(event) ? getLegacyKeyCode(event) : 0;

    if ([403, 404, 405, 406].includes(legacyCode)) return 'color-key';

    return 'unknown';
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

export function classifyPtvTvFocusElement(element: Element | null): PtvFocusElementCategory {
    if (!(element instanceof HTMLElement)) return 'unknown';
    if (element.closest('[role="dialog"], dialog, .MuiDialog-root, .ptv-dialog')) return 'dialog-control';
    if (element.closest('[role="menu"], .MuiMenu-root, .ptv-dropdown-menu, .ptv-music-item-menu-popover')) return 'menu-item';
    if (element.closest('.ptv-media-dock, .ptv-music-now-playing-controls, .videoOsdBottom, .videoOsdTop, .ptv-player-controls, .ptv-player-chrome-root')) return 'player-control';
    if (element.matches('[data-ptv-hero-action], .ptv-hero-action, .heroButton')) return 'hero-action';
    if (element.closest('[data-ptv-item-id], [data-ptv-browse-item-id], .card, .ptv-card')) return 'media-card';
    if (element.closest('nav, [role="navigation"], .mainDrawer, .ptv-sidebar')) return 'nav-item';
    if (element.matches('button, [role="button"], input, select, textarea, a[href]')) return 'button';

    return 'unknown';
}

export function classifyPtvTvFocusScope(element: Element | null): PtvFocusScopeCategory {
    if (!(element instanceof HTMLElement)) return 'unknown';
    if (element.closest(FULL_SCREEN_MUSIC_SCOPE_SELECTOR)) return 'full-screen-music-player';
    if (element.closest(MINI_PLAYER_SCOPE_SELECTOR)) return 'player-controls';
    if (element === document.body && hasVisibleVideoPlaybackControls()) return 'player-controls';
    if (element.closest('#videoOsdPage, .videoOsdPage, .ptv-player-chrome-root, .ptv-player-controls')) return 'player-controls';
    if (element.closest('.ptv-settings-page, #myPreferencesMenuPage, [data-ptv-settings-panel]')) return 'settings-panel';
    if (element.closest('[role="menu"], .MuiMenu-paper, .ptv-dropdown-menu')) return 'dropdown-menu';
    if (element.closest('.actionSheet, .ptv-context-menu, .ptv-music-item-menu-popover')) return 'context-menu';
    if (element.closest('[role="dialog"], dialog, [aria-modal="true"], .MuiDialog-paper, .ptv-dialog')) return 'modal-dialog';
    if (element.closest('nav, [role="navigation"], .mainDrawer, .ptv-sidebar')) return 'navigation';
    if (element.closest('main, .ptv-shell-frame, .mainAnimatedPage, [data-role="page"]')) return 'main-content';

    return 'unknown';
}

function hashPtvFocusFingerprint(value: string) {
    let hash = 2166136261;

    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return `focus-${(hash >>> 0).toString(36)}`;
}

export function getPtvSafeFocusFingerprint(element: Element | null) {
    if (!(element instanceof HTMLElement)) return 'none';

    const category = classifyPtvTvFocusElement(element);
    const role = element.getAttribute('role') || element.tagName.toLowerCase();
    const parentRole = element.parentElement?.getAttribute('role')
        || element.parentElement?.tagName.toLowerCase()
        || 'none';

    return hashPtvFocusFingerprint(`${category}:${role}:${parentRole}`);
}

function classifyPtvFocusRegion(element: HTMLElement | null): PtvFocusRegionClass {
    if (!element?.isConnected) return 'unknown';

    const rect = getElementRect(element);
    const width = window.innerWidth || document.documentElement.clientWidth || 0;
    const height = window.innerHeight || document.documentElement.clientHeight || 0;

    if (rect.right < 0) return 'left';
    if (rect.left > width) return 'right';
    if (rect.bottom < 0) return 'above';
    if (rect.top > height) return 'below';
    if (!isOnScreen(element)) return 'offscreen';

    return 'overlapping';
}

function createEmptyPtvFocusGraphSummary(): PtvTvFocusGraphSummary {
    return {
        activeScope: 'unknown',
        buildDurationMs: 0,
        candidateCountByCategory: {
            button: 0,
            'dialog-control': 0,
            'hero-action': 0,
            'media-card': 0,
            'menu-item': 0,
            'nav-item': 0,
            'player-control': 0,
            unknown: 0
        },
        containerCount: 0,
        currentCandidatePresent: false,
        currentRegion: 'unknown',
        enabledCount: 0,
        generatedAt: new Date().toISOString(),
        generation: 0,
        lastRebuildReason: 'not-built',
        nearestCandidateCategories: {
            down: 'unknown',
            left: 'unknown',
            right: 'unknown',
            up: 'unknown'
        },
        nearestCandidateFingerprints: {
            down: 'none',
            left: 'none',
            right: 'none',
            up: 'none'
        },
        offscreenCount: 0,
        rejectedByReason: {
            blockedByModal: 0,
            detached: 0,
            disabled: 0,
            hidden: 0,
            outsideActiveScope: 0,
            zeroSize: 0
        },
        totalCandidateCount: 0,
        visibleCount: 0
    };
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

type PtvScrollAxis = 'horizontal' | 'vertical';
type PtvScrollOwner = HTMLElement | Window;

function getPtvScrollOwner(element: HTMLElement, boundary: HTMLElement, axis: PtvScrollAxis): PtvScrollOwner {
    let current = element.parentElement;

    while (current) {
        const style = window.getComputedStyle(current);
        const overflow = axis === 'horizontal' ? style.overflowX : style.overflowY;
        const scrollSize = axis === 'horizontal' ? current.scrollWidth : current.scrollHeight;
        const clientSize = axis === 'horizontal' ? current.clientWidth : current.clientHeight;

        if (/^(?:auto|overlay|scroll)$/.test(overflow) && scrollSize > clientSize + 1) return current;
        if (current === boundary) break;
        current = current.parentElement;
    }

    return window;
}

function getPtvScrollOwnerKey(owner: PtvScrollOwner, boundary: HTMLElement) {
    if (owner === window) return 'window';

    const element = owner as HTMLElement;

    if (element.id) return `id:${element.id}`;
    if (element.dataset.ptvFocusScope) return `scope:${element.dataset.ptvFocusScope}`;

    const shelf = element.closest<HTMLElement>('[data-ptv-shelf-id]');

    if (shelf?.dataset.ptvShelfId) {
        return `shelf:${shelf.dataset.ptvShelfId}:${getStructuralFocusKey(element, shelf)}`;
    }

    return `path:${getStructuralFocusKey(element, boundary)}`;
}

function getPtvScrollOwnerPosition(owner: PtvScrollOwner, axis: PtvScrollAxis) {
    if (owner === window) {
        return axis === 'horizontal' ? window.pageXOffset || 0 : window.pageYOffset || 0;
    }

    return axis === 'horizontal' ? (owner as HTMLElement).scrollLeft : (owner as HTMLElement).scrollTop;
}

function capturePtvFocusMemory(element: HTMLElement, boundary: HTMLElement, routeKey: string): PtvFocusMemory {
    const horizontalOwner = getPtvScrollOwner(element, boundary, 'horizontal');
    const verticalOwner = getPtvScrollOwner(element, boundary, 'vertical');

    return {
        horizontalScrollOwnerKey: getPtvScrollOwnerKey(horizontalOwner, boundary),
        key: getFocusKey(element, boundary),
        routeKey,
        scrollLeft: getPtvScrollOwnerPosition(horizontalOwner, 'horizontal'),
        scrollTop: getPtvScrollOwnerPosition(verticalOwner, 'vertical'),
        verticalScrollOwnerKey: getPtvScrollOwnerKey(verticalOwner, boundary)
    };
}

function restorePtvFocusMemoryScroll(
    element: HTMLElement,
    boundary: HTMLElement,
    memory: PtvFocusMemory
) {
    if (
        memory.scrollLeft === undefined
        || memory.scrollTop === undefined
        || !memory.horizontalScrollOwnerKey
        || !memory.verticalScrollOwnerKey
    ) {
        return false;
    }

    const horizontalOwner = getPtvScrollOwner(element, boundary, 'horizontal');
    const verticalOwner = getPtvScrollOwner(element, boundary, 'vertical');

    if (
        getPtvScrollOwnerKey(horizontalOwner, boundary) !== memory.horizontalScrollOwnerKey
        || getPtvScrollOwnerKey(verticalOwner, boundary) !== memory.verticalScrollOwnerKey
    ) {
        return false;
    }

    if (horizontalOwner === window && verticalOwner === window) {
        try {
            window.scrollTo({
                behavior: 'auto',
                left: memory.scrollLeft,
                top: memory.scrollTop
            });
        } catch {
            window.scrollTo(memory.scrollLeft, memory.scrollTop);
        }
        return true;
    }

    if (horizontalOwner === window) {
        window.scrollTo(memory.scrollLeft, window.pageYOffset || 0);
    } else {
        (horizontalOwner as HTMLElement).scrollLeft = memory.scrollLeft;
    }

    if (verticalOwner === window) {
        window.scrollTo(window.pageXOffset || 0, memory.scrollTop);
    } else {
        (verticalOwner as HTMLElement).scrollTop = memory.scrollTop;
    }

    return true;
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

function hasVisibleVideoPlaybackControls() {
    if (!document.documentElement.classList.contains('ptv-player-osd-visible')) return false;

    return Boolean(getTopVisibleElement([
        '.ptv-player-chrome-root .ptv-player-topbar',
        '#videoOsdPage .videoOsdBottom',
        '.videoOsdPage .videoOsdBottom',
        '#videoOsdPage .osdControls',
        '.videoOsdPage .osdControls'
    ].join(',')));
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
    private graphRebuildReason = 'not-built';
    private routeOwner = 'shell';
    private enabled = false;
    private requested = false;
    private enableReason = 'not-requested';
    private initializationCount = 0;
    private disposalCount = 0;
    private listenerInstallCount = 0;
    private duplicateListenerCount = 0;
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
    private pendingRouteOrigins = new Set<string>();
    private geometryFramePending = false;
    private routeDefaultFailureCount = 0;
    private lastFocusedElement: HTMLElement | null = null;
    private lastKeyPressed = '';
    private lastKeyHandledAt = 0;
    private lastKeyHandledWasRepeat = false;
    private lastHandledDirection = '';
    private lastRepeatAction: PtvSafeRemoteAction = 'unknown';
    private lastRepeatAt = 0;
    private repeatCount = 0;
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
    private playbackBackHandler: PtvPlaybackBackHandler | null = null;
    private playbackReturnFocus: PtvFocusMemory | null = null;
    private inactivePlaybackSurfaceScopes = new Set<HTMLElement>();
    private playbackSurfaceFocusMemory = new Map<PtvPlaybackSurface, PtvFocusMemory>();
    private playbackSurfaceReturnFocus = new Map<PtvPlaybackSurface, PtvFocusMemory | null>();
    private routeRestorePending = false;
    private restoreSequence = 0;
    private subscribers = new Set<PtvNavigationSubscriber>();
    private nextFocusReason = '';
    private lastRecoveryAttempt = 0;
    private inputSequence = 0;
    private activeInput: PtvInputPipelineContext | null = null;
    private inputSource: PtvRemoteInputSource = 'keyboard';
    private pendingMovementConfirmations = new Map<string, {
        context: PtvInputPipelineContext;
        expected: HTMLElement;
        timer: number;
    }>();
    private previousFocusCategory: PtvFocusElementCategory = 'unknown';
    private previousScopeCategory: PtvFocusScopeCategory = 'unknown';
    private suppressFocusScroll = false;

    private recordInputStage(
        context: PtvInputPipelineContext,
        stage: string,
        detail: Record<string, unknown> = {}
    ) {
        context.stageSequence += 1;
        this.recordDiagnostic('ptv-tv-input-pipeline', {
            defaultPreventedBefore: context.defaultPreventedBefore,
            inputId: context.inputId,
            inputSource: context.source,
            inputStage: stage,
            keyCategory: context.action,
            handlerReached: context.handlerReached,
            movementAttempted: context.movementAttempted,
            movementConfirmed: context.movementConfirmed,
            repeat: context.repeat,
            repeatCount: context.repeatCount,
            stageSequence: context.stageSequence,
            ...detail
        });
    }

    private beginInputPipeline(event: KeyboardEvent) {
        const action = normalizePtvRemoteDiagnosticAction(event);
        const now = performance.now();

        if (action === this.lastRepeatAction && now - this.lastRepeatAt <= INPUT_REPEAT_WINDOW_MS) {
            this.repeatCount += 1;
        } else {
            this.repeatCount = 1;
        }
        this.lastRepeatAction = action;
        this.lastRepeatAt = now;

        const context: PtvInputPipelineContext = {
            action,
            defaultPreventedBefore: event.defaultPrevented,
            handlerReached: false,
            inputId: `remote-input-${++this.inputSequence}`,
            movementAttempted: false,
            movementConfirmed: false,
            repeat: event.repeat,
            repeatCount: this.repeatCount,
            source: event.isTrusted ? this.inputSource : 'synthetic-test',
            stageSequence: 0,
            startedAt: now,
            targetFound: false
        };

        this.activeInput = context;
        this.recordInputStage(context, 'browser-event-received', {
            eventPhase: event.eventPhase === Event.CAPTURING_PHASE ? 'capture'
                : event.eventPhase === Event.AT_TARGET ? 'target' : 'unknown',
            eventType: event.type === 'keyup' ? 'keyup' : 'keydown'
        });
        this.recordInputStage(context, 'event-classified', {
            eventType: event.type === 'keyup' ? 'keyup' : 'keydown'
        });
        this.recordInputStage(context, 'key-normalized');
        this.recordInputStage(context, 'platform-mapping-applied', {
            platformMapping: context.source
        });
        this.recordInputStage(context, 'action-resolved', {
            direction: getPtvRemoteDirection(event) || 'unknown'
        });

        return context;
    }

    private finishInputPipeline(event: KeyboardEvent, context: PtvInputPipelineContext) {
        this.recordInputStage(context, 'completed', {
            defaultPreventedAfter: event.defaultPrevented,
            elapsedMs: Number((performance.now() - context.startedAt).toFixed(2)),
            // eslint-disable-next-line @typescript-eslint/no-deprecated -- Passive diagnostics must observe legacy WebOS propagation without changing it.
            propagationStopped: event.cancelBubble,
            targetFound: context.targetFound
        });
        if (this.activeInput === context) this.activeInput = null;
    }

    private requestMovementConfirmation(element: HTMLElement, context: PtvInputPipelineContext) {
        context.movementAttempted = true;
        this.recordInputStage(context, 'focus-movement-requested', {
            targetCategory: classifyPtvTvFocusElement(element),
            targetFingerprint: getPtvSafeFocusFingerprint(element)
        });

        const timer = window.setTimeout(() => {
            const pending = this.pendingMovementConfirmations.get(context.inputId);

            if (!pending) return;

            this.pendingMovementConfirmations.delete(context.inputId);
            this.recordInputStage(context, 'movement-timed-out', {
                elapsedMs: Number((performance.now() - context.startedAt).toFixed(2)),
                failureReason: 'browser-focus-confirmation-timeout',
                targetCategory: classifyPtvTvFocusElement(element)
            });
        }, FOCUS_CONFIRMATION_TIMEOUT_MS);

        this.pendingMovementConfirmations.set(context.inputId, {
            context,
            expected: element,
            timer
        });
    }

    private confirmMovement(target: HTMLElement) {
        const match = [...this.pendingMovementConfirmations.values()].find(pending => pending.expected === target);

        if (!match) return '';

        window.clearTimeout(match.timer);
        this.pendingMovementConfirmations.delete(match.context.inputId);
        match.context.movementConfirmed = true;
        this.recordInputStage(match.context, 'focus-event-observed', {
            focusedCategory: classifyPtvTvFocusElement(target),
            focusedFingerprint: getPtvSafeFocusFingerprint(target)
        });
        this.recordInputStage(match.context, 'movement-confirmed', {
            elapsedMs: Number((performance.now() - match.context.startedAt).toFixed(2)),
            focusedCategory: classifyPtvTvFocusElement(target),
            focusedFingerprint: getPtvSafeFocusFingerprint(target)
        });

        return match.context.inputId;
    }

    private clearPendingMovementConfirmations() {
        this.pendingMovementConfirmations.forEach(pending => {
            window.clearTimeout(pending.timer);
        });
        this.pendingMovementConfirmations.clear();
    }

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
            this.recordDiagnostic('ptv-tv-focus-scope', {
                candidateCount: this.cache?.candidates.length || 0,
                leakedFocusOutsideScope: true,
                scope: classifyPtvTvFocusScope(activeLayer),
                scopeStatus: 'activated',
                trapActive: true
            });
            this.scheduleRestore('focus-trap');
            return;
        }

        if (this.shouldRejectPausedMiniPlayerFocus(target)) {
            this.cacheDirty = true;
            this.scheduleRestore(this.routeRestorePending ? 'route-change' : 'scope-changed');
            return;
        }

        if (target.closest(MINI_PLAYER_SCOPE_SELECTOR)) {
            this.cache = null;
            this.cacheDirty = true;
        }

        const scope = this.cache?.scope || this.findActiveScope();

        if (!scope.contains(target) && target !== scope) return;

        const inputId = this.confirmMovement(target);
        const scopeCategory = classifyPtvTvFocusScope(scope);
        const category = classifyPtvTvFocusElement(target);
        const cache = this.cache || this.getCache();

        this.recordDiagnostic('ptv-tv-focus-change', {
            candidatePresent: cache.candidates.includes(target),
            category,
            fingerprint: getPtvSafeFocusFingerprint(target),
            inputId,
            previousCategory: this.previousFocusCategory,
            reason: this.nextFocusReason || 'focusin',
            scope: scopeCategory,
            visible: isOnScreen(target)
        });
        if (scopeCategory !== this.previousScopeCategory) {
            this.recordDiagnostic('ptv-tv-focus-scope', {
                candidateCount: cache.candidates.length,
                initialFocusedCategory: category,
                leakedFocusOutsideScope: false,
                orphanedAfterRouteChange: false,
                scope: scopeCategory,
                scopeStatus: 'activated',
                trapActive: Boolean(activeLayer)
            });
            this.previousScopeCategory = scopeCategory;
        }
        this.previousFocusCategory = category;
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
                this.recordDiagnostic('ptv-tv-focus-lost', {
                    detachedDuringAnimation: active instanceof HTMLElement && !active.isConnected,
                    previousCategory: this.previousFocusCategory,
                    reason: 'focus-lost'
                });
                this.scheduleRestore('focus-lost');
            }
        });
    };

    private readonly handleKeyDown = (event: KeyboardEvent) => {
        if (!this.enabled) return;

        const context = this.beginInputPipeline(event);

        try {
            if (!this.canHandleRouteOwnedKey()) {
                this.recordInputStage(context, 'handler-rejected', {
                    failureReason: 'route-owned-by-jellyfin',
                    handlerReached: false
                });
                return;
            }

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
                context.handlerReached = true;
                this.recordInputStage(context, 'handler-rejected', {
                    duplicate: true,
                    failureReason: 'duplicate-suppressed-by-existing-owner',
                    handlerReached: true
                });
                this.recordDiagnostic('ptv-tv-focus-duplicate-key-suppressed', {
                    direction: this.lastHandledDirection,
                    duplicateKeyCount: this.duplicateKeySuppressedCount,
                    keyCategory: context.action,
                    routeOwner: this.routeOwner
                });
                return;
            }

            this.lastKeyHandledAt = now;
            this.lastHandledDirection = context.action;
            this.lastKeyHandledWasRepeat = event.repeat;
            this.processingRemoteKey = true;
            window.requestAnimationFrame(() => {
                this.processingRemoteKey = false;
            });

            if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
                this.recordInputStage(context, 'handler-rejected', {
                    failureReason: event.defaultPrevented ? 'default-prevented-before-focus-owner' : 'modified-key',
                    handlerReached: false
                });
                return;
            }

            context.handlerReached = true;
            this.recordInputStage(context, 'focus-handler-reached', {
                handlerReached: true
            });
            const direction = getPtvRemoteDirection(event);

            if (
                this.playbackActive
                && shouldContinuePtvHiddenVideoDirectionalGesture(
                    direction || '',
                    event.repeat
                )
            ) {
                this.recordInputStage(context, 'handler-rejected', {
                    failureReason: 'hidden-video-directional-gesture-owned-by-player',
                    handlerReached: true
                });
                return;
            }

            const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            const editable = isEditable(current);
            const cache = this.getCache();
            const currentCandidateResolved = Boolean(current && cache.candidates.includes(current));

            this.recordInputStage(context, 'current-candidate-resolved', {
                currentCandidateResolved,
                focusedCategory: classifyPtvTvFocusElement(current),
                focusedFingerprint: getPtvSafeFocusFingerprint(current)
            });

            if (this.handleLayerTab(event, cache, current)) return;
            if (this.isReaderOwnedKey(cache, direction, event)) {
                this.recordInputStage(context, 'handler-rejected', {
                    failureReason: 'reader-owned-key',
                    handlerReached: true
                });
                return;
            }
            if (this.handleBackKey(event, cache, editable)) return;
            if (this.handleSelectKey(event, cache, current, editable)) return;
            this.handleDirectionKey(event, cache, current, direction, editable);

            this.publishSnapshot();
        } finally {
            this.finishInputPipeline(event, context);
        }
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

    private consumeOwnedKey(event: KeyboardEvent) {
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    private recordBackDecision(backOwner: string) {
        this.recordDiagnostic('ptv-tv-focus-back', {
            backOwner,
            inputId: this.activeInput?.inputId || '',
            keyCategory: this.activeInput?.action || 'back'
        });
    }

    private handleBackKey(event: KeyboardEvent, cache: PtvFocusCache, editable: boolean) {
        if (!isPtvRemoteBackKey(event) || (editable && event.key === 'Backspace')) return false;

        if (this.reconcileActiveLayerForBack(cache)) {
            if (this.closeActiveLayer('back')) {
                this.consumeOwnedKey(event);
                this.recordBackDecision('transient-layer');
            }

            // If the layer has its own close lifecycle, leave the event available
            // to that implementation instead of navigating the page behind it.
            return true;
        }

        if (
            cache.scope.matches(FULL_SCREEN_MUSIC_SCOPE_SELECTOR)
            || /^#\/music\/player(?:[/?]|$)/i.test(window.location.hash || '')
        ) {
            this.consumeOwnedKey(event);
            window.history.back();
            this.recordBackDecision('full-screen-music');
            return true;
        }

        if (this.playbackActive && hasVisibleVideoPlaybackControls()) {
            const handled = this.playbackBackHandler?.('controls') || false;

            if (handled) {
                this.consumeOwnedKey(event);
                this.cacheDirty = true;
                this.recordBackDecision('video-controls');
                return true;
            }
        }

        if (this.playbackActive) {
            const handled = this.playbackBackHandler?.('video') || this.activatePlaybackBack(cache);

            if (handled) {
                this.consumeOwnedKey(event);
                this.recordBackDecision('video-playback');
                return true;
            }
        }

        this.consumeOwnedKey(event);
        this.recordDiagnostic('ptv-tv-focus-restoration-started', {
            inputId: this.activeInput?.inputId || '',
            reason: 'back-navigation'
        });
        window.history.back();
        this.recordDiagnostic('ptv-tv-focus-back', {
            backOwner: 'route-history',
            inputId: this.activeInput?.inputId || '',
            keyCategory: this.activeInput?.action || 'back'
        });

        return true;
    }

    private reconcileActiveLayerForBack(cache: PtvFocusCache) {
        const liveLayer = getTopVisibleElement(LAYER_SELECTOR);

        if (!liveLayer) return this.getActiveLayer();

        // A physical Back can arrive in the same task that mounts a React menu,
        // before MutationObserver has refreshed the layer stack. Reconcile the
        // live DOM synchronously so Back cannot fall through to route history.
        this.syncLayers(cache.scope);
        return this.getActiveLayer();
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
            focusedCategory: classifyPtvTvFocusElement(current),
            focusedFingerprint: getPtvSafeFocusFingerprint(current),
            inputId: this.activeInput?.inputId || '',
            keyCategory: this.activeInput?.action || 'enter'
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
        if (this.playbackActive && !hasVisibleVideoPlaybackControls()) {
            if (this.activeInput) {
                this.recordInputStage(this.activeInput, 'handler-rejected', {
                    failureReason: 'hidden-video-controls-owned-by-player',
                    handlerReached: true
                });
            }
            return;
        }

        event.preventDefault();
        if (current && this.handleMenuTriggerDirection(current, direction, event)) return;
        if (current && this.moveMiniPlayerFocusToPage(direction, cache, current)) return;
        const focused = this.moveInDirection(direction, cache, current, editable);

        if (!focused) {
            this.restoreFocus('direction-without-focus');
        }
    }

    private moveMiniPlayerFocusToPage(
        direction: PtvDirection,
        miniPlayerCache: PtvFocusCache,
        current: HTMLElement
    ) {
        if (
            direction !== 'up'
            || !current.closest(MINI_PLAYER_PAGE_EXIT_SELECTOR)
            || !miniPlayerCache.scope.matches(MINI_PLAYER_SCOPE_SELECTOR)
        ) {
            return false;
        }

        const pageScope = getTopVisibleElement(PAGE_SCOPE_SELECTOR);

        if (!pageScope) return false;

        const startedAt = performance.now();
        if (this.activeInput) {
            this.recordInputStage(this.activeInput, 'target-search-started', {
                direction,
                focusedCategory: classifyPtvTvFocusElement(current),
                scopeTransition: 'mini-player-to-page'
            });
        }
        this.graphRebuildReason = 'mini-player-exit-up';
        const pageCache = this.buildCache(pageScope);
        const rects = new Map(pageCache.candidates.map(element => [element, getElementRect(element)]));
        const returnTarget = this.findMemoryTarget(
            pageCache,
            this.playbackSurfaceReturnFocus.get('mini-player') || null
        );
        const directionalTarget = findDirectionalTargetFromRects(current, pageCache.candidates, rects, 'up');
        const target = returnTarget
            || directionalTarget
            || pageCache.candidates.find(candidate => classifyPtvTvFocusScope(candidate) === 'navigation')
            || this.findInitialTarget(pageCache);

        if (!target) return false;

        if (this.activeInput) {
            this.activeInput.targetFound = true;
            this.recordInputStage(this.activeInput, 'target-found', {
                targetCategory: classifyPtvTvFocusElement(target),
                targetFingerprint: getPtvSafeFocusFingerprint(target),
                targetFound: true
            });
        }

        this.cache = pageCache;
        this.cacheDirty = false;
        this.navigationMoveCount += 1;
        if (!returnTarget && !directionalTarget) this.geometryFallbackCount += 1;

        const focused = this.moveFocus(target, 'direction:up:mini-player-exit');
        this.recordNavigationTiming(performance.now() - startedAt);
        this.recordDiagnostic('ptv-tv-focus-moved', {
            direction,
            focusGraphNodeCount: pageCache.candidates.length,
            focusGraphTargetKey: pageCache.keys.get(target) || '',
            focusGraphSourceKey: miniPlayerCache.keys.get(current) || '',
            focusMoveDurationMs: Math.round((performance.now() - startedAt) * 10) / 10,
            focusedKey: pageCache.keys.get(target) || '',
            focusMoveSuccess: focused,
            scopeTransition: 'mini-player-to-page'
        });

        if (!focused) {
            this.cache = null;
            this.cacheDirty = true;
        }

        return focused;
    }

    private readonly handleMutation = (records: MutationRecord[]) => {
        if (!this.enabled) return;

        records.forEach(record => {
            const target = record.target instanceof HTMLElement ? record.target : null;

            if (
                record.type === 'attributes'
                && record.attributeName === 'data-ptv-playback-paused'
                && target?.matches(MINI_PLAYER_SCOPE_SELECTOR)
                && target.dataset.ptvPlaybackPaused !== 'true'
            ) {
                this.inactivePlaybackSurfaceScopes.delete(target);
            }
        });
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

        this.graphRebuildReason = 'dom-mutation';
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
        const detail = event instanceof CustomEvent ? event.detail as PtvRouteControllerState | undefined : undefined;
        const routeState = detail || getPtvRouteControllerState();
        const nextRouteKey = routeState?.routeKey || getLocationRouteKey();

        if (nextRouteKey === this.lastRouteKey) {
            this.graphRebuildReason = 'duplicate-route-change';
            this.cacheDirty = true;
            if (this.routeRestorePending) this.scheduleRestore('route-change');
            return;
        }

        this.rememberCurrentFocus();

        this.lastRouteKey = nextRouteKey;
        this.pageType = routeState?.pageType || document.documentElement.dataset.ptvRoutePageType || '';
        this.routeOwner = routeState?.owner || document.documentElement.dataset.ptvRouteOwner || this.routeOwner;
        this.layerStack = [];
        this.pendingRestoreMemory = null;
        this.routeRestorePending = true;
        this.graphRebuildReason = 'route-change';
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

    enable(reason = 'tv-eligible') {
        if (this.enabled) {
            this.publishSnapshot();
            return;
        }
        if (typeof window === 'undefined' || typeof document === 'undefined') return;

        this.enabled = true;
        this.enableReason = reason;
        this.initializationCount += 1;
        this.listenerInstallCount += 1;
        this.graphRebuildReason = 'manager-start';
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
            attributeFilter: [
                'aria-disabled',
                'aria-hidden',
                'class',
                'data-ptv-playback-paused',
                'disabled',
                'hidden',
                'inert',
                'open',
                'style',
                'tabindex'
            ],
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

    disable(reason = 'not-tv-eligible') {
        if (!this.enabled) return;

        this.enabled = false;
        this.enableReason = reason;
        this.disposalCount += 1;
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
        this.inactivePlaybackSurfaceScopes.clear();
        this.playbackSurfaceFocusMemory.clear();
        this.playbackSurfaceReturnFocus.clear();
        this.pendingRestoreReason = '';
        this.pendingRestoreMemory = null;
        this.routeRestorePending = false;
        this.restoreSequence += 1;
        this.clearPendingMovementConfirmations();
        document.querySelectorAll('.ptv-tv-focus-visible').forEach(element => {
            element.classList.remove('ptv-tv-focus-visible');
        });
    }

    syncProfile(profile: Pick<PtvClientProfile, 'isTv'> & Partial<Pick<
        PtvClientProfile,
        'isAndroidTv' | 'isFireTv' | 'isWebOs' | 'tvDetectionReason'
    >>) {
        this.requested = profile.isTv;
        this.inputSource = profile.isWebOs ? 'webos-remote'
            : profile.isFireTv ? 'fire-tv-profile'
                : profile.isAndroidTv ? 'android-tv-profile'
                    : 'keyboard';
        const reason = profile.tvDetectionReason || (profile.isTv ? 'tv-profile' : 'non-tv-profile');

        if (profile.isTv) this.enable(reason);
        else this.disable(reason);
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
            if (this.activeInput) {
                this.recordInputStage(this.activeInput, 'target-rejected', {
                    failureReason: !active ? 'no-current-focus'
                        : !cache.scope.contains(active) ? 'current-outside-active-scope'
                            : !cache.graph.has(active) ? 'current-not-in-focus-graph'
                                : 'direction-unresolved',
                    targetFound: false
                });
            }
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
        if (this.activeInput) {
            this.recordInputStage(this.activeInput, 'target-search-started', {
                direction,
                focusedCategory: classifyPtvTvFocusElement(active)
            });
        }
        const target = cache.graph.get(active)?.[direction] || this.getLayerWrapTarget(cache, active, direction);

        if (!target) {
            if (this.activeInput) {
                this.recordInputStage(this.activeInput, 'target-rejected', {
                    failureReason: 'no-directional-target',
                    targetFound: false
                });
            }
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

        if (this.activeInput) {
            this.activeInput.targetFound = true;
            this.recordInputStage(this.activeInput, 'target-found', {
                targetCategory: classifyPtvTvFocusElement(target),
                targetFingerprint: getPtvSafeFocusFingerprint(target),
                targetFound: true
            });
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

    rememberRouteOrigin(element: HTMLElement, routeKey = getPtvRouteControllerState().routeKey) {
        if (!element.isConnected || !routeKey) return false;

        const boundary = element.closest<HTMLElement>(PAGE_SCOPE_SELECTOR) || document.body;
        const memory = capturePtvFocusMemory(element, boundary, routeKey);

        this.focusMemory.set(routeKey, memory);
        this.pendingRouteOrigins.add(routeKey);

        return true;
    }

    restoreRouteOrigin(scope: HTMLElement, routeKey = getPtvRouteControllerState().routeKey) {
        if (!scope.isConnected || !routeKey || !this.pendingRouteOrigins.has(routeKey)) return false;

        const memory = this.focusMemory.get(routeKey);

        if (!memory) return false;

        const candidates = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

        if (scope.matches(FOCUSABLE_SELECTOR)) candidates.unshift(scope);

        const target = candidates.find(candidate => (
            isPtvFocusableCandidate(candidate, scope)
            && getFocusKey(candidate, scope) === memory.key
        ));

        if (!target || !restorePtvFocusMemoryScroll(target, scope, memory)) return false;

        const focusRestored = this.focusWithoutScroll(target, 'route-origin');

        if (!focusRestored) return false;

        this.focusMemory.set(routeKey, memory);
        this.pendingRouteOrigins.delete(routeKey);
        if (routeKey === this.lastRouteKey) this.routeRestorePending = false;

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
        const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const activeEdges = activeElement ? cache?.graph.get(activeElement) || {} : {};
        const focusGraphSummary = cache ? {
            ...cache.diagnostics,
            activeScope: classifyPtvTvFocusScope(activeScope),
            currentCandidatePresent: Boolean(activeElement && cache.candidates.includes(activeElement)),
            currentRegion: classifyPtvFocusRegion(activeElement),
            nearestCandidateCategories: {
                down: classifyPtvTvFocusElement(activeEdges.down || null),
                left: classifyPtvTvFocusElement(activeEdges.left || null),
                right: classifyPtvTvFocusElement(activeEdges.right || null),
                up: classifyPtvTvFocusElement(activeEdges.up || null)
            },
            nearestCandidateFingerprints: {
                down: getPtvSafeFocusFingerprint(activeEdges.down || null),
                left: getPtvSafeFocusFingerprint(activeEdges.left || null),
                right: getPtvSafeFocusFingerprint(activeEdges.right || null),
                up: getPtvSafeFocusFingerprint(activeEdges.up || null)
            }
        } : createEmptyPtvFocusGraphSummary();

        return {
            brokenNavigationPaths,
            currentFocusedElement: describeElement(document.activeElement),
            focusHistory: [...this.focusHistory],
            focusableElementCount: cache?.candidates.length || 0,
            focusEngineDisposalCount: this.disposalCount,
            focusEngineDuplicateListenerCount: this.duplicateListenerCount,
            focusEngineEnableReason: this.enableReason,
            focusEngineInitializationCount: this.initializationCount,
            focusEngineListenerInstallCount: this.listenerInstallCount,
            focusEngineRequested: this.requested,
            focusGraphRebuildCount: this.focusGraphRebuildCount,
            focusGraphSummary,
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

        this.graphRebuildReason = reason;
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
        this.graphRebuildReason = reason;
        this.cacheDirty = true;

        if (!active) {
            this.scheduleRestore(`${reason}:return`, this.playbackReturnFocus);
            this.playbackReturnFocus = null;
        } else {
            this.scheduleRestore(reason);
        }
    }

    setPlaybackBackHandler(handler: PtvPlaybackBackHandler | null) {
        this.playbackBackHandler = handler;

        return () => {
            if (this.playbackBackHandler === handler) this.playbackBackHandler = null;
        };
    }

    notifyPlaybackSurfaceReady(scope: HTMLElement, surface: PtvPlaybackSurface) {
        if (!this.enabled || !scope.isConnected) return false;

        this.rememberCurrentFocus();
        if (!this.playbackSurfaceReturnFocus.has(surface)) {
            this.playbackSurfaceReturnFocus.set(surface, this.captureFocusMemory());
        }

        this.graphRebuildReason = `playback-surface-ready:${surface}`;
        const preservePageFocus = surface === 'mini-player'
            && scope.dataset.ptvPlaybackPaused === 'true';

        if (preservePageFocus) {
            this.inactivePlaybackSurfaceScopes.add(scope);
            this.cache = null;
            this.cacheDirty = true;
            this.recordDiagnostic('ptv-tv-focus-scope', {
                candidateCount: scope.querySelectorAll(FOCUSABLE_SELECTOR).length,
                initialFocusedCategory: classifyPtvTvFocusElement(
                    document.activeElement instanceof HTMLElement ? document.activeElement : null
                ),
                previousFocusRestored: null,
                scope: classifyPtvTvFocusScope(scope),
                scopeStatus: 'open',
                trapActive: false
            });
            return true;
        }

        this.inactivePlaybackSurfaceScopes.delete(scope);
        this.cache = this.buildCache(scope);
        this.cacheDirty = false;
        const surfaceMemory = this.playbackSurfaceFocusMemory.get(surface) || null;
        const routeMemory = this.focusMemory.get(this.lastRouteKey) || null;
        const requestedMemory = surfaceMemory?.routeKey === this.lastRouteKey ? surfaceMemory : routeMemory;
        const target = this.findMemoryTarget(this.cache, requestedMemory)
            || this.findInitialTarget(this.cache);

        if (!target) {
            this.focusSentinel(scope);
            return false;
        }

        const focused = this.moveFocus(target, `playback-surface-ready:${surface}`);

        this.recordDiagnostic('ptv-tv-focus-scope', {
            candidateCount: this.cache.candidates.length,
            initialFocusedCategory: classifyPtvTvFocusElement(target),
            previousFocusRestored: Boolean(requestedMemory && focused),
            scope: classifyPtvTvFocusScope(scope),
            scopeStatus: 'open',
            trapActive: true
        });

        return focused;
    }

    notifyPlaybackSurfaceDisposed(scope: HTMLElement, surface: PtvPlaybackSurface) {
        this.inactivePlaybackSurfaceScopes.delete(scope);
        this.playbackSurfaceReturnFocus.delete(surface);
        if (this.cache?.scope === scope) this.cache = null;
        this.graphRebuildReason = `playback-surface-disposed:${surface}`;
        this.cacheDirty = true;
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
        const buildStartedAt = performance.now();
        const restrictToVisibleVideoControls = scope === document.body
            && this.playbackActive
            && hasVisibleVideoPlaybackControls();
        const candidates = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
            .filter(candidate => (
                !restrictToVisibleVideoControls
                || Boolean(candidate.closest(VIDEO_PLAYBACK_CANDIDATE_SELECTOR))
            ))
            .filter(candidate => !this.shouldExcludePausedMiniPlayerCandidate(candidate, scope));

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
        const candidateCountByCategory: Record<PtvFocusElementCategory, number> = {
            button: 0,
            'dialog-control': 0,
            'hero-action': 0,
            'media-card': 0,
            'menu-item': 0,
            'nav-item': 0,
            'player-control': 0,
            unknown: 0
        };

        usableCandidates.forEach(candidate => {
            const category = classifyPtvTvFocusElement(candidate);

            candidateCountByCategory[category] += 1;
        });

        const rejectedByReason = {
            blockedByModal: 0,
            detached: 0,
            disabled: 0,
            hidden: 0,
            outsideActiveScope: 0,
            zeroSize: 0
        };
        candidates.filter(candidate => !usableCandidates.includes(candidate)).forEach(candidate => {
            if (!candidate.isConnected) rejectedByReason.detached += 1;
            else if (candidate.matches('[disabled], [aria-disabled="true"]')) rejectedByReason.disabled += 1;
            else if (!isElementStyleVisible(candidate, scope)) rejectedByReason.hidden += 1;
            else if (!hasUsableRect(candidate)) rejectedByReason.zeroSize += 1;
            else rejectedByReason.outsideActiveScope += 1;
        });

        const activeLayer = this.getActiveLayer();

        if (activeLayer) {
            rejectedByReason.blockedByModal = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
                .filter(candidate => candidate.isConnected && !activeLayer.contains(candidate))
                .length;
        }

        const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const edges = active ? graph.get(active) || {} : {};
        const diagnostics: PtvTvFocusGraphSummary = {
            activeScope: classifyPtvTvFocusScope(scope),
            buildDurationMs: Number((performance.now() - buildStartedAt).toFixed(2)),
            candidateCountByCategory,
            containerCount: scope.querySelectorAll(
                '[data-ptv-focus-scope], main, nav, section, [role="dialog"], [role="menu"], [role="navigation"]'
            ).length,
            currentCandidatePresent: Boolean(active && usableCandidates.includes(active)),
            currentRegion: classifyPtvFocusRegion(active),
            enabledCount: usableCandidates.length,
            generatedAt: new Date().toISOString(),
            generation: this.focusGraphRebuildCount,
            lastRebuildReason: this.graphRebuildReason,
            nearestCandidateCategories: {
                down: classifyPtvTvFocusElement(edges.down || null),
                left: classifyPtvTvFocusElement(edges.left || null),
                right: classifyPtvTvFocusElement(edges.right || null),
                up: classifyPtvTvFocusElement(edges.up || null)
            },
            nearestCandidateFingerprints: {
                down: getPtvSafeFocusFingerprint(edges.down || null),
                left: getPtvSafeFocusFingerprint(edges.left || null),
                right: getPtvSafeFocusFingerprint(edges.right || null),
                up: getPtvSafeFocusFingerprint(edges.up || null)
            },
            offscreenCount: usableCandidates.filter(candidate => !isOnScreen(candidate)).length,
            rejectedByReason,
            totalCandidateCount: candidates.length + rejectedByReason.blockedByModal,
            visibleCount: usableCandidates.filter(isOnScreen).length
        };
        const cache = { candidates: usableCandidates, diagnostics, graph, keys, missing, scope };

        this.recordDiagnostic('ptv-tv-focus-graph', {
            graphSummary: diagnostics
        });
        this.graphRebuildReason = 'focus-graph-refresh';

        return cache;
    }

    private captureFocusMemory(): PtvFocusMemory | null {
        const active = document.activeElement instanceof HTMLElement ? document.activeElement : this.lastFocusedElement;
        const cache = this.getCache();

        if (!active || !cache.scope.contains(active)) return null;

        return capturePtvFocusMemory(active, cache.scope, this.lastRouteKey);
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

        this.recordDiagnostic('ptv-tv-focus-scope', {
            candidateCount: this.cache?.candidates.length || 0,
            previousFocusRestored: null,
            scope: classifyPtvTvFocusScope(layer),
            scopeStatus: 'back-or-close',
            trapActive: true
        });
        this.layerStack = this.layerStack.filter(entry => entry.element !== layer);
        this.cacheDirty = true;
        this.scheduleRestore(`layer-close:${reason}`, layerState?.returnFocus || null);
        return true;
    }

    private findActiveScope() {
        const layer = getTopVisibleElement(LAYER_SELECTOR);

        if (layer) return layer;

        const fullScreenMusic = getTopVisibleElement(FULL_SCREEN_MUSIC_SCOPE_SELECTOR);

        if (fullScreenMusic) return fullScreenMusic;

        const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const activeMiniPlayer = activeElement?.closest<HTMLElement>(MINI_PLAYER_SCOPE_SELECTOR);
        const inactiveMiniPlayer = activeMiniPlayer
            ? this.isInactivePlaybackSurfaceScope(activeMiniPlayer)
            : false;
        const blockedPausedMiniPlayer = activeMiniPlayer?.dataset.ptvPlaybackPaused === 'true'
            && (
                this.routeRestorePending
                || inactiveMiniPlayer
            );

        if (
            activeMiniPlayer
            && isElementStyleVisible(activeMiniPlayer)
            && !blockedPausedMiniPlayer
        ) {
            return activeMiniPlayer;
        }

        if (this.playbackActive) {
            if (hasVisibleVideoPlaybackControls()) return document.body;

            const playbackScope = getTopVisibleElement(VIDEO_PLAYBACK_SCOPE_SELECTOR);

            if (playbackScope) return playbackScope;
        }

        const pageScope = getTopVisibleElement(PAGE_SCOPE_SELECTOR);

        // Enhanced Details keeps the Jellyfin-owned page and mounts a separate
        // header-only shell at the end of <body>. The header is not the page
        // scope; use their existing common ancestor so both remain in the one
        // authoritative focus graph.
        if (pageScope?.matches('.ptv-shell-frame-header-only')) return document.body;

        return pageScope || document.body;
    }

    private isInactivePlaybackSurfaceScope(scope: HTMLElement) {
        if (!this.inactivePlaybackSurfaceScopes.has(scope)) return false;
        if (scope.dataset.ptvPlaybackPaused === 'true') return true;

        this.inactivePlaybackSurfaceScopes.delete(scope);
        return false;
    }

    private shouldRejectPausedMiniPlayerFocus(target: HTMLElement) {
        const miniPlayer = target.closest<HTMLElement>(MINI_PLAYER_SCOPE_SELECTOR);

        if (!miniPlayer) return false;

        const inactiveMiniPlayer = this.isInactivePlaybackSurfaceScope(miniPlayer);

        return miniPlayer.dataset.ptvPlaybackPaused === 'true'
            && (this.routeRestorePending || inactiveMiniPlayer);
    }

    private shouldExcludePausedMiniPlayerCandidate(candidate: HTMLElement, scope: HTMLElement) {
        const miniPlayer = candidate.closest<HTMLElement>(MINI_PLAYER_SCOPE_SELECTOR);

        if (!miniPlayer || miniPlayer === scope) return false;

        const inactiveMiniPlayer = this.isInactivePlaybackSurfaceScope(miniPlayer);

        return miniPlayer.dataset.ptvPlaybackPaused === 'true'
            && (this.routeRestorePending || inactiveMiniPlayer);
    }

    private completeRouteRestore(target: HTMLElement, focusRestored: boolean) {
        if (!this.routeRestorePending || !focusRestored) return;

        const pageScope = target.closest<HTMLElement>(PAGE_SCOPE_SELECTOR);

        if (
            pageScope?.isConnected
            && isElementStyleVisible(pageScope)
            && isPtvFocusableCandidate(target, pageScope)
        ) {
            this.routeRestorePending = false;
            this.pendingRouteOrigins.delete(this.lastRouteKey);
        }
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
            .filter(candidate => (
                candidate !== document.body
                && candidate.isConnected
                && isElementStyleVisible(candidate, document.body)
                && !this.shouldExcludePausedMiniPlayerCandidate(candidate, document.body)
            ));

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
        if (
            !current.matches('[aria-haspopup="menu"][data-ptv-directional-menu-open="true"]')
            || (direction !== 'down' && direction !== 'up')
        ) {
            return false;
        }

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

        if (!this.suppressFocusScroll) scrollFocusedElementIntoView(element);

        const cache = this.getCache();
        const entry = capturePtvFocusMemory(element, cache.scope, this.lastRouteKey);
        const key = entry.key;

        if (!this.getActiveLayer() && !this.routeRestorePending) {
            this.focusMemory.set(this.lastRouteKey, entry);
        }
        const playbackSurface = element.closest<HTMLElement>('[data-ptv-playback-surface]');
        const surface = playbackSurface?.dataset.ptvPlaybackSurface;

        if (surface === 'mini-player' || surface === 'full-screen-player') {
            this.playbackSurfaceFocusMemory.set(surface, entry);
        }

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

        this.publishSnapshot();
    }

    private moveFocus(element: HTMLElement, reason: string): boolean {
        this.nextFocusReason = reason;
        if (this.activeInput && reason.startsWith('direction:')) {
            this.requestMovementConfirmation(element, this.activeInput);
        }
        focusElement(element);

        if (document.activeElement === element) {
            this.confirmMovement(element);
            if (this.nextFocusReason) this.markFocusedElement(element, reason);
            this.nextFocusReason = '';
            return true;
        }
        this.handleScroll();
        return false;
    }

    private focusWithoutScroll(element: HTMLElement, reason: string) {
        this.suppressFocusScroll = true;

        try {
            if (this.enabled) return this.moveFocus(element, reason);

            focusElement(element);
            return document.activeElement === element;
        } finally {
            this.suppressFocusScroll = false;
        }
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
        const routeMemory = requestedMemory || this.focusMemory.get(this.lastRouteKey) || null;
        let target = this.findMemoryTarget(cache, routeMemory);
        let source = requestedMemory ? 'requested-memory' : 'route-memory';

        if (!target && routeMemory && this.routeRestorePending) {
            this.pendingRestoreReason = reason;
            this.recordDiagnostic('ptv-tv-focus-restore-pending', {
                focusRestoreSource: source,
                focusRestoreSuccess: false,
                reason,
                scope: classifyPtvTvFocusScope(cache.scope)
            });
            return false;
        }

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
            const activeFallback = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            const focusedFallback = (
                document.activeElement === cache.scope
                || Boolean(activeFallback && activeFallback !== document.body)
            ) && !(activeFallback && this.shouldRejectPausedMiniPlayerFocus(activeFallback));

            if (focusedFallback) {
                this.pendingRestoreReason = '';
                this.lastRecoveryAttempt = 0;
                this.recordDiagnostic('ptv-tv-focus-restored', {
                    focusedCategory: classifyPtvTvFocusElement(document.activeElement),
                    focusedFingerprint: getPtvSafeFocusFingerprint(document.activeElement),
                    focusRestoreSource: 'sentinel',
                    focusRestoreSuccess: true,
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
                scope: classifyPtvTvFocusScope(cache.scope),
                reason
            });
            return false;
        }

        this.pendingRestoreReason = '';
        const scrollRestored = Boolean(
            this.routeRestorePending
            && routeMemory
            && restorePtvFocusMemoryScroll(target, cache.scope, routeMemory)
        );
        const focusRestored = scrollRestored ?
            this.focusWithoutScroll(target, `restore:${reason}`) :
            this.moveFocus(target, `restore:${reason}`);

        if (focusRestored && scrollRestored && routeMemory) {
            this.focusMemory.set(this.lastRouteKey, routeMemory);
        }
        this.completeRouteRestore(target, focusRestored);
        this.recordDiagnostic('ptv-tv-focus-restored', {
            focusedCategory: classifyPtvTvFocusElement(target),
            focusedFingerprint: getPtvSafeFocusFingerprint(target),
            focusRestoreSource: source,
            focusRestoreSuccess: focusRestored,
            reason
        });
        this.recordDiagnostic('ptv-tv-focus-scope', {
            candidateCount: cache.candidates.length,
            initialFocusedCategory: classifyPtvTvFocusElement(target),
            previousFocusRestored: focusRestored,
            scope: classifyPtvTvFocusScope(cache.scope),
            scopeStatus: 'closed',
            trapActive: Boolean(this.getActiveLayer())
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

        return capturePtvFocusMemory(element, boundary, this.lastRouteKey);
    }
}

/* eslint-enable @stylistic/operator-linebreak, compat/compat, no-nested-ternary, sonarjs/cognitive-complexity, sonarjs/no-nested-conditional */

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

export function rememberPtvRouteOrigin(element: HTMLElement, routeKey?: string) {
    return tvFocusManager.rememberRouteOrigin(element, routeKey);
}

export function restorePtvRouteOrigin(scope: HTMLElement, routeKey?: string) {
    return tvFocusManager.restoreRouteOrigin(scope, routeKey);
}

export function notifyPtvTvPlaybackFocus(active: boolean) {
    tvFocusManager.setPlaybackActive(active);
}

export function notifyPtvTvPlaybackSurfaceReady(
    scope: HTMLElement,
    surface: PtvPlaybackSurface
) {
    return tvFocusManager.notifyPlaybackSurfaceReady(scope, surface);
}

export function notifyPtvTvPlaybackSurfaceDisposed(
    scope: HTMLElement,
    surface: PtvPlaybackSurface
) {
    tvFocusManager.notifyPlaybackSurfaceDisposed(scope, surface);
}

export function registerPtvTvPlaybackBackHandler(handler: PtvPlaybackBackHandler) {
    return tvFocusManager.setPlaybackBackHandler(handler);
}

export function subscribePtvTvNavigation(subscriber: PtvNavigationSubscriber) {
    return tvFocusManager.subscribe(subscriber);
}

export function syncPtvTvFocusEngine(profile: Pick<PtvClientProfile, 'isTv'> & Partial<Pick<
    PtvClientProfile,
    'isAndroidTv' | 'isFireTv' | 'isWebOs' | 'tvDetectionReason'
>>) {
    tvFocusManager.syncProfile(profile);
}
