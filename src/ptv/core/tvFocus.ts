import type { PtvClientProfile } from './clientProfile';

export type PtvDirection = 'down' | 'left' | 'right' | 'up';

type PtvRemoteKeyEvent = Readonly<{
    code?: string;
    key?: string;
    keyCode?: number;
    which?: number;
}>;

type FocusCandidate = {
    element: HTMLElement;
    rect: DOMRect;
};

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    'summary'
].join(',');
const BACK_KEYS = new Set(['Back', 'BrowserBack', 'GoBack', 'XF86Back']);
const REMOTE_SELECT_KEYS = new Set(['Accept', 'Enter', 'OK', 'Select']);
// LG webOS Back is 461; 10009 keeps the same focus contract on Tizen remotes.
const LEGACY_REMOTE_BACK_CODES = new Set([461, 10009]);
// Some TV WebViews leak native Android center/enter codes instead of a DOM Enter key.
const LEGACY_REMOTE_SELECT_CODES = new Set([13, 23, 66]);
const focusMemory = new Map<string, string>();
let uninstallActiveFocusEngine: (() => void) | null = null;

function recordFocusDiagnostic(name: string, detail: Record<string, unknown>) {
    window.dispatchEvent(new CustomEvent('ptv:focus-diagnostic', {
        detail: { detail, name }
    }));
}

function getRouteKey() {
    return `${window.location.pathname}${window.location.hash.split('?')[0]}`;
}

function getFocusKey(element: HTMLElement) {
    return element.dataset.ptvFocusKey
        || element.getAttribute('href')
        || element.getAttribute('aria-label')
        || element.id
        || '';
}

function isEditable(element: Element | null) {
    return element instanceof HTMLInputElement
        || element instanceof HTMLSelectElement
        || element instanceof HTMLTextAreaElement
        || (element instanceof HTMLElement && element.isContentEditable);
}

function isVisible(element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);

    return rect.width > 0
        && rect.height > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden';
}

function getLegacyKeyCode(event: PtvRemoteKeyEvent) {
    return event.keyCode || event.which || 0;
}

function allowsLegacyRemoteCode(event: PtvRemoteKeyEvent) {
    return !event.key || event.key === 'Unidentified' || event.key === 'Process';
}

export function isPtvRemoteSelectKey(event: PtvRemoteKeyEvent) {
    if (event.key && REMOTE_SELECT_KEYS.has(event.key)) return true;
    if (event.code === 'Enter' || event.code === 'NumpadEnter') return true;

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

    if (!allowsLegacyRemoteCode(event)) return null;

    switch (getLegacyKeyCode(event)) {
        case 38: return 'up';
        case 40: return 'down';
        case 37: return 'left';
        case 39: return 'right';
        default: return null;
    }
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
    const primary = direction === 'left' || direction === 'right' ? Math.abs(deltaX) : Math.abs(deltaY);
    const secondary = direction === 'left' || direction === 'right' ? Math.abs(deltaY) : Math.abs(deltaX);
    const inDirection = isInDirection(deltaX, deltaY, direction);

    return inDirection ? primary + secondary * 2.2 : Number.POSITIVE_INFINITY;
}

export function findPtvTvDirectionalTarget(
    current: HTMLElement,
    elements: HTMLElement[],
    direction: PtvDirection
) {
    const origin = current.getBoundingClientRect();

    return elements
        .filter(element => element !== current && isVisible(element))
        .map<FocusCandidate>(element => ({ element, rect: element.getBoundingClientRect() }))
        .map(candidate => ({
            ...candidate,
            distance: getDirectionalDistance(origin, candidate.rect, direction)
        }))
        .filter(candidate => Number.isFinite(candidate.distance))
        .sort((left, right) => left.distance - right.distance)[0]?.element || null;
}

function scrollFocusedElementIntoView(element: HTMLElement) {
    if (typeof element.scrollIntoView !== 'function') return;

    try {
        element.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
    } catch {
        element.scrollIntoView(false);
    }
}

function focusElement(element: HTMLElement) {
    try {
        element.focus({ preventScroll: true });
    } catch {
        element.focus();
    }
}

function restoreFocus() {
    const scope = document.querySelector<HTMLElement>('.ptv-shell-frame, .ptv-settings-page');
    if (!scope) return;

    const focusKey = focusMemory.get(getRouteKey());
    const candidates = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    let target: HTMLElement | undefined = candidates[0];

    if (focusKey) {
        target = candidates.find(candidate => getFocusKey(candidate) === focusKey);
    }

    if (!target || !isVisible(target)) return;

    focusElement(target);
    scrollFocusedElementIntoView(target);
    recordFocusDiagnostic('ptv-tv-focus-restored', {
        focusRestoreSource: focusKey ? 'route-memory' : 'first-focusable',
        focusRestoreSuccess: true,
        focusedKey: getFocusKey(target),
        route: getRouteKey()
    });
}

function closeNearestFocusLayer() {
    const openMenu = document.querySelector<HTMLElement>('[role="menu"].ptv-shell-dropdown-panel');

    if (openMenu) {
        const triggerId = openMenu.getAttribute('aria-labelledby');
        const trigger = triggerId ? document.getElementById(triggerId) : null;

        if (trigger instanceof HTMLElement) {
            trigger.click();
            window.requestAnimationFrame(() => focusElement(trigger));
            return true;
        }
    }

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const closeButton = dialog?.querySelector<HTMLElement>('[aria-label*="close" i], .btnCancel, .dialogCloseButton');

    if (closeButton) {
        closeButton.click();
        return true;
    }

    return false;
}

function installFocusEngine() {
    const handleFocusIn = (event: FocusEvent) => {
        const target = event.target instanceof HTMLElement ? event.target : null;
        if (!target?.closest('.ptv-shell-frame, .ptv-settings-page, [role="menu"], [role="dialog"]')) return;

        document.querySelectorAll('.ptv-tv-focus-visible').forEach(element => {
            if (element !== target) element.classList.remove('ptv-tv-focus-visible');
        });
        target.classList.add('ptv-tv-focus-visible');
        const focusKey = getFocusKey(target);
        if (focusKey) focusMemory.set(getRouteKey(), focusKey);
        scrollFocusedElementIntoView(target);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.defaultPrevented || isEditable(document.activeElement)) return;

        if (isPtvRemoteBackKey(event)) {
            event.preventDefault();
            if (!closeNearestFocusLayer()) window.history.back();
            return;
        }

        const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const scope = current?.closest<HTMLElement>('[role="menu"], [role="dialog"], .ptv-shell-frame, .ptv-settings-page');

        if (isPtvRemoteSelectKey(event) && current?.matches(FOCUSABLE_SELECTOR) && scope) {
            event.preventDefault();
            current.click();
            recordFocusDiagnostic('ptv-tv-focus-selected', {
                focusedKey: getFocusKey(current),
                remoteKey: event.key || `legacy-${getLegacyKeyCode(event)}`,
                route: getRouteKey()
            });
            return;
        }

        const direction = getPtvRemoteDirection(event);
        if (!direction || !current || !scope) return;

        const startedAt = performance.now();
        const candidates = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
        const target = findPtvTvDirectionalTarget(current, candidates, direction);
        if (!target) {
            recordFocusDiagnostic('ptv-tv-focus-move-failed', {
                direction,
                focusGraphNodeCount: candidates.length,
                focusMoveFailures: 1,
                focusedKey: getFocusKey(current),
                route: getRouteKey()
            });
            return;
        }

        event.preventDefault();
        focusElement(target);
        scrollFocusedElementIntoView(target);
        recordFocusDiagnostic('ptv-tv-focus-moved', {
            direction,
            focusGraphNodeCount: candidates.length,
            focusMoveDurationMs: Math.round((performance.now() - startedAt) * 10) / 10,
            focusedKey: getFocusKey(target),
            route: getRouteKey()
        });
    };
    const handleRouteChange = () => window.requestAnimationFrame(restoreFocus);

    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('hashchange', handleRouteChange);
    window.addEventListener('popstate', handleRouteChange);

    return () => {
        document.removeEventListener('focusin', handleFocusIn);
        document.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('hashchange', handleRouteChange);
        window.removeEventListener('popstate', handleRouteChange);
        document.querySelectorAll('.ptv-tv-focus-visible').forEach(element => {
            element.classList.remove('ptv-tv-focus-visible');
        });
    };
}

export function syncPtvTvFocusEngine(profile: Pick<PtvClientProfile, 'isTv'>) {
    uninstallActiveFocusEngine?.();
    uninstallActiveFocusEngine = null;

    if (typeof window === 'undefined' || typeof document === 'undefined' || !profile.isTv) return;

    uninstallActiveFocusEngine = installFocusEngine();
}
