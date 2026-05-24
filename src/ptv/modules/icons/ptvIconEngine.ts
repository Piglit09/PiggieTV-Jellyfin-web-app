import {
    getPtvIconNameFromText,
    getPtvIconUrl,
    isPtvIconName,
    MATERIAL_TO_PTV_ICON,
    PTV_ICON_REGISTRY,
    PtvIconName
} from './iconRegistry';
import { watchDom } from '../../core/observer';
import { resetRuntimeScope } from '../../core/scope';

const STOCK_ICON_SELECTOR = [
    '.material-icons',
    '.material-icons-round',
    '.material-icons-outlined',
    'i[class*="material-icons"]',
    'svg[data-testid$="Icon"]',
    'svg.MuiSvgIcon-root'
].join(', ');

const PTV_ICON_SELECTOR = '.ptv-icon[data-ptv-icon]';
const ENGINE_ICON_SELECTOR = '.ptv-icon[data-ptv-icon][data-ptv-engine="true"]';
const ICON_SELECTOR = `${STOCK_ICON_SELECTOR}, ${PTV_ICON_SELECTOR}`;
const ICON_CONTAINER_SELECTOR = [
    'button',
    'a',
    '.listItem',
    '.ptv-sidebar-item',
    '.headerButton',
    '.paper-icon-button-light'
].join(', ');
const SETTINGS_ICON_SCOPE_SELECTOR = [
    '.userPreferencesPage',
    '.settingsPage',
    '#myPreferencesMenuPage',
    '#userProfilePage'
].join(', ');
const DYNAMIC_PLAYER_ICON_SCOPE_SELECTOR = [
    '#videoOsdPage',
    '.videoOsdPage',
    '.videoOsdBottom',
    '.osdControls',
    '.osdHeader',
    '.nowPlayingBar',
    '.nowPlayingBarTop',
    '.playPauseButton',
    '.btnPause',
    '.btnPlay',
    '.btnPlayPause'
].join(', ');
const BLOCKED_ICON_SCOPE_SELECTOR = [
    '.card',
    '.cardBox',
    '.cardImageContainer',
    '.itemsContainer',
    '.homeSection',
    '.homeSectionsContainer',
    '.verticalSection',
    '.emby-scroller',
    '.portraitCard',
    '.backdropCard',
    '.dashboardDocument .content-primary'
].join(', ');

let scheduled = false;
let started = false;
let stopWatchingDom: (() => void) | null = null;
const iconEngineScope = resetRuntimeScope('icon-engine');

function normalizeIconKey(value: string | null | undefined) {
    return String(value || '').trim().toLowerCase();
}

function getMaterialIconKey(element: Element) {
    const textKey = normalizeIconKey(element.textContent);
    if (MATERIAL_TO_PTV_ICON[textKey]) return textKey;

    for (const className of Array.from(element.classList)) {
        const key = normalizeIconKey(className);
        if (MATERIAL_TO_PTV_ICON[key]) return key;
    }

    return '';
}

function getExistingPtvIconName(element: Element) {
    const dataIcon = element.getAttribute('data-ptv-icon') || element.getAttribute('data-icon');

    return isPtvIconName(dataIcon) ? dataIcon : '';
}

function getIconContextText(element: Element) {
    const container = element.closest(ICON_CONTAINER_SELECTOR);

    return [
        element.getAttribute('title'),
        element.getAttribute('aria-label'),
        element.textContent,
        Array.from(element.classList).join(' '),
        container?.getAttribute('title'),
        container?.getAttribute('aria-label'),
        container?.textContent,
        container ? Array.from(container.classList).join(' ') : ''
    ].filter(Boolean).join(' ');
}

function resolveIconName(element: Element): PtvIconName | '' {
    const existingIconName = getExistingPtvIconName(element);
    if (existingIconName) return existingIconName;

    const materialKey = getMaterialIconKey(element);
    if (materialKey) return MATERIAL_TO_PTV_ICON[materialKey];

    return getPtvIconNameFromText(getIconContextText(element), '');
}

function getIconAssetPath(iconName: PtvIconName) {
    const assetName = PTV_ICON_REGISTRY[iconName];

    return assetName ? getPtvIconUrl(iconName) : '';
}

function isStockIconElement(element: Element) {
    return element.matches(STOCK_ICON_SELECTOR);
}

function isPtvDomIconElement(element: Element) {
    return element.matches(ENGINE_ICON_SELECTOR);
}

function isInBlockedIconScope(element: Element) {
    if (element.closest(SETTINGS_ICON_SCOPE_SELECTOR)) return false;
    if (element.closest(DYNAMIC_PLAYER_ICON_SCOPE_SELECTOR)) return true;
    if (element.closest('.dashboardDocument') && !element.closest('.mainDrawer, .MuiDrawer-paper')) return true;

    return Boolean(element.closest(BLOCKED_ICON_SCOPE_SELECTOR));
}

function isInDynamicPlayerIconScope(element: Element) {
    return Boolean(element.closest(DYNAMIC_PLAYER_ICON_SCOPE_SELECTOR));
}

function isNormalizedDomIcon(element: Element, iconName: PtvIconName) {
    return element.getAttribute('data-ptv-icon') === iconName
        && element.getAttribute('class') === 'ptv-icon'
        && element.getAttribute('data-ptv-engine') === 'true'
        && !element.childNodes.length
        && !element.textContent;
}

function normalizeIconElement(element: Element, iconName: PtvIconName) {
    if (element instanceof SVGElement) {
        element.setAttribute('class', 'ptv-icon');
        element.setAttribute('data-ptv-icon', iconName);
        element.setAttribute('data-icon', iconName);
        element.setAttribute('data-ptv-engine', 'true');
        element.setAttribute('aria-hidden', 'true');

        return;
    }

    element.setAttribute('class', 'ptv-icon');
    element.setAttribute('data-ptv-icon', iconName);
    element.setAttribute('data-icon', iconName);
    element.setAttribute('data-ptv-engine', 'true');
    element.setAttribute('aria-hidden', 'true');
    element.textContent = '';

    while (element.firstChild) {
        element.removeChild(element.firstChild);
    }
}

function normalizeStockIcons(root: ParentNode) {
    const icons = [
        ...(root instanceof Element && root.matches(ICON_SELECTOR) ? [root] : []),
        ...Array.from(root.querySelectorAll(ICON_SELECTOR))
    ];

    icons.forEach((icon) => {
        if (isInBlockedIconScope(icon)) return;
        if (icon.matches(PTV_ICON_SELECTOR) && !isPtvDomIconElement(icon)) return;

        const iconName = resolveIconName(icon);
        if (!iconName) return;

        const assetPath = getIconAssetPath(iconName);
        if (!assetPath) return;

        if (isStockIconElement(icon)) {
            if (isNormalizedDomIcon(icon, iconName)) return;

            normalizeIconElement(icon, iconName);
        }
    });
}

function removeBlockedPtvIcons(root: ParentNode) {
    const icons = [
        ...(root instanceof Element && root.matches(PTV_ICON_SELECTOR) ? [root] : []),
        ...Array.from(root.querySelectorAll(PTV_ICON_SELECTOR))
    ];

    icons.forEach((icon) => {
        if (isInDynamicPlayerIconScope(icon)) return;
        if (isInBlockedIconScope(icon)) icon.remove();
    });
}

function getDirectIconChildren(container: Element) {
    return Array.from(container.children).filter(child => child.matches(ICON_SELECTOR));
}

function cleanupDuplicateIcons(root: ParentNode) {
    const containers = [
        ...(root instanceof Element && root.matches(ICON_CONTAINER_SELECTOR) ? [root] : []),
        ...Array.from(root.querySelectorAll(ICON_CONTAINER_SELECTOR))
    ];

    containers.forEach((container) => {
        if (isInDynamicPlayerIconScope(container)) return;

        const icons = getDirectIconChildren(container);
        if (icons.length < 2) return;

        const preferredIcon = icons.find(icon => icon.matches(ENGINE_ICON_SELECTOR));
        if (!preferredIcon) return;

        icons.forEach((icon) => {
            if (icon !== preferredIcon && !icon.matches(PTV_ICON_SELECTOR)) icon.remove();
        });
    });
}

export function runPtvIconEngine(root: ParentNode = document) {
    removeBlockedPtvIcons(root);
    normalizeStockIcons(root);
    cleanupDuplicateIcons(root);
}

export function schedulePtvIconEngine(root: ParentNode = document) {
    if (scheduled) return;

    scheduled = true;

    iconEngineScope.animationFrame(() => {
        scheduled = false;
        runPtvIconEngine(root);
    });
}

export function startPtvIconEngine() {
    if (started) return;

    started = true;
    runPtvIconEngine(document);

    iconEngineScope.listen(window, 'hashchange', () => schedulePtvIconEngine(document));
    iconEngineScope.listen(window, 'popstate', () => schedulePtvIconEngine(document));
    iconEngineScope.listen(document, 'click', (event: Event) => {
        const target = event.target instanceof Element ? event.target : null;

        if (target?.closest('.mainDrawerButton, .headerButton, button, a')) {
            iconEngineScope.timeout(() => schedulePtvIconEngine(document), 0);
        }
    });

    stopWatchingDom ||= iconEngineScope.add(watchDom(() => {
        schedulePtvIconEngine(document);
    }), {
        label: 'icon dom watcher',
        type: 'observer'
    });
}
