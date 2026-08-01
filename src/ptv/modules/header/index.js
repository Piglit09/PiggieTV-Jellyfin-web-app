import { PTV_ASSETS, PTV_BRANDING, PTV_EVENTS, PTV_ROUTES } from '../../core/config';
import { applyPtvResponsiveImage } from '../../core/images';
import { registerModule } from '../../core/lifecycle';
import { resetRuntimeScope } from '../../core/scope';
import { appRouter } from '../../../components/router/appRouter';
import { create } from '../../utils/dom';
import { createIcon, iconNameFromText, runIconEngine } from '../../utils/icons';
import { startPtvIconEngine } from '../icons';
import { getPtvPlatformFeaturePolicy } from '../../core/platformFeatures';
import {
    cancelPendingPtvRequestActivation,
    closePtvRequestPortal,
    openPtvRequestPortal
} from '../request/requestLoader';

const HEADER_ICON_TARGET_SELECTOR = [
    '.ptv-skinHeader button',
    '.skinHeader button',
    '.ptv-skinHeader .paper-icon-button-light',
    '.skinHeader .paper-icon-button-light'
].join(', ');
const HEADER_REPAIR_DELAYS = [0, 100, 300, 750, 1500];
const HEADER_ICON_CLASS_MAP = [
    ['headerBackButton', 'back'],
    ['headerHomeButton', 'home'],
    ['mainDrawerButton', 'menu'],
    ['barsMenuButton', 'menu'],
    ['headerSyncButton', 'users'],
    ['syncButton', 'users'],
    ['headerAudioPlayerButton', 'music'],
    ['audioPlayerButton', 'music'],
    ['headerCastButton', 'cast'],
    ['castButton', 'cast'],
    ['headerSearchButton', 'search'],
    ['headerUserButton', 'user']
];
const OWNED_TABS_SELECTOR = '[data-ptv-owned-tabs="true"]';
const STOCK_TABS_HIDDEN_CLASS = 'ptv-stock-home-tabs-hidden';
const TOP_TABS = [
    {
        icon: 'home',
        id: 'home',
        index: 0,
        label: 'Home'
    },
    {
        icon: 'favorites',
        id: 'favorites',
        index: 1,
        label: 'Favorites'
    },
    {
        icon: 'music',
        id: 'music',
        index: 2,
        label: 'Music'
    },
    {
        icon: 'books',
        id: 'reading',
        index: 3,
        label: 'PTV Reading'
    },
    {
        icon: 'request',
        id: 'request',
        index: 4,
        label: 'Request'
    }
];

let headerRepairPending = false;
let homeTabSelectionToken = 0;
const headerScope = resetRuntimeScope('header-listeners');

function isHomeRoute() {
    const hash = window.location.hash || '';

    return hash === PTV_ROUTES.home
        || hash === PTV_ROUTES.homeHtml
        || hash.startsWith(`${PTV_ROUTES.home}?`)
        || hash.startsWith(`${PTV_ROUTES.homeHtml}?`);
}

function isRequestRoute() {
    return document.documentElement.classList.contains('ptv-request-active');
}

function isHomeTabsRoute() {
    return isHomeRoute() || isRequestRoute() || isMusicRoute() || isReadingRoute();
}

function getActiveTopTab() {
    const hash = window.location.hash || '';

    if (isRequestRoute()) return 'request';
    if (isReadingRoute()) return 'reading';
    if (isMusicRoute()) return 'music';
    if (hash.startsWith(PTV_ROUTES.favoritesLegacy) || hash.includes('tab=1')) return 'favorites';

    return 'home';
}

function isMusicRoute() {
    const hash = window.location.hash || '';

    return hash === PTV_ROUTES.music || hash.startsWith(`${PTV_ROUTES.music}/`) || hash.startsWith(`${PTV_ROUTES.music}?`);
}

function isReadingRoute() {
    return /^#\/(?:reading|books|comics|manga|maga)(?:[/?]|$)/i.test(window.location.hash || '');
}

function openRequestTab(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
    void openPtvRequestPortal();
}

function openMusicTab() {
    closeRequestForHomeTab();
    setOwnedTabActive('music');

    void appRouter.show('music/').catch(() => {
        window.location.hash = '#/music/';
        dispatchSyntheticHashChange();
    });
}

function openReadingTab() {
    closeRequestForHomeTab();
    setOwnedTabActive('reading');

    void appRouter.show('reading').catch(() => {
        window.location.hash = PTV_ROUTES.reading;
        dispatchSyntheticHashChange();
    });
}

function closeRequestForHomeTab() {
    cancelPendingPtvRequestActivation();

    if (!isRequestRoute()) return;

    void closePtvRequestPortal({
        useHistory: false
    });
}

function setOwnedTabActive(tabId) {
    document.querySelectorAll(`${OWNED_TABS_SELECTOR} [data-ptv-tab]`).forEach((tab) => {
        const isActive = tab.dataset.ptvTab === tabId;

        tab.classList.toggle('emby-tab-button-active', isActive);
        tab.classList.toggle('ptv-nav-link-active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
        tab.setAttribute('tabindex', isActive ? '0' : '-1');
    });
}

function syncOwnedTopTabs() {
    setOwnedTabActive(getActiveTopTab());
}

function dispatchSyntheticHashChange() {
    if (typeof HashChangeEvent === 'function') {
        window.dispatchEvent(new HashChangeEvent('hashchange'));
        return;
    }

    if (typeof Event === 'function') {
        window.dispatchEvent(new Event('hashchange'));
    }
}

function getCleanHistoryState() {
    const state = window.history.state;

    if (!state?.ptvRequestActive) return state;

    const nextState = { ...state };
    delete nextState.ptvRequestActive;

    return nextState;
}

function selectJellyfinHomeTab(index) {
    const token = ++homeTabSelectionToken;
    const fallbackClick = () => {
        const stockTab = document.querySelector(`.headerTabs [data-index="${index}"]`);

        if (!stockTab) return;

        if (typeof MouseEvent !== 'function') {
            stockTab.click?.();
            return;
        }

        stockTab.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window
        }));
    };
    const select = () => {
        import('../../../components/maintabsmanager')
            .then((tabsManager) => {
                if (token !== homeTabSelectionToken) return;

                tabsManager.selectedTabIndex(index);
            })
            .catch(fallbackClick);
    };

    select();
    window.setTimeout(select, 60);
}

function selectHomeTab(tabId, event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();

    if (tabId === 'music') {
        openMusicTab();
        return;
    }

    if (tabId === 'reading') {
        openReadingTab();
        return;
    }

    if (tabId === 'request') {
        openRequestTab(event);
        syncOwnedTopTabs();
        return;
    }

    const tabIndex = tabId === 'favorites' ? 1 : 0;
    const route = tabId === 'favorites' ? PTV_ROUTES.favorites : PTV_ROUTES.home;

    closeRequestForHomeTab();
    setOwnedTabActive(tabId);

    if (window.location.hash !== route) {
        window.history.pushState(getCleanHistoryState(), '', route);
        dispatchSyntheticHashChange();
    }

    selectJellyfinHomeTab(tabIndex);
}

function createOwnedTopTab(tabConfig) {
    const tab = create('button', {
        className: [
            'emby-tab-button',
            'ptv-top-tab',
            'ptv-owned-top-tab',
            `ptv-top-tab-${tabConfig.id}`
        ].join(' '),
        attrs: {
            'aria-selected': 'false',
            'data-index': String(tabConfig.index),
            'data-ptv-tab': tabConfig.id,
            role: 'tab',
            tabindex: '-1',
            type: 'button'
        }
    });

    if (tabConfig.id === 'request') {
        tab.dataset.ptvRequestTrigger = 'true';
    }

    tab.append(
        createIcon(tabConfig.icon, 'ptv-icon ptv-top-tab-icon'),
        create('span', {
            className: 'emby-button-foreground ptv-top-tab-label',
            text: tabConfig.label
        })
    );

    tab.addEventListener('click', (event) => selectHomeTab(tabConfig.id, event), {
        capture: true
    });
    tab.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;

        selectHomeTab(tabConfig.id, event);
    }, {
        capture: true
    });

    return tab;
}

function ensureOwnedTopTabs(header) {
    const existingTabs = Array.from(document.querySelectorAll(OWNED_TABS_SELECTOR));
    const [ownedTabs, ...extraTabs] = existingTabs;

    extraTabs.forEach(tab => {
        tab.remove();
    });

    if (ownedTabs instanceof HTMLElement) {
        if (ownedTabs.parentElement !== header) {
            header.append(ownedTabs);
        }

        syncOwnedTopTabs();
        return ownedTabs;
    }

    const tabs = create('nav', {
        className: 'ptv-owned-top-tabs ptv-top-tabs',
        attrs: {
            'aria-label': 'PiggieTV home tabs',
            'data-ptv-owned-tabs': 'true',
            role: 'tablist'
        }
    });

    const featurePolicy = getPtvPlatformFeaturePolicy();

    TOP_TABS.filter(tabConfig => (
        (tabConfig.id !== 'reading' || featurePolicy.reading)
        && (tabConfig.id !== 'request' || featurePolicy.request)
    )).forEach(tabConfig => {
        tabs.append(createOwnedTopTab(tabConfig));
    });

    header.append(tabs);
    syncOwnedTopTabs();

    return tabs;
}

function hideStockHomeTabs(tabsContainer) {
    if (!tabsContainer) return;

    tabsContainer.classList.add(STOCK_TABS_HIDDEN_CLASS);
    tabsContainer.setAttribute('aria-hidden', 'true');
}

function restoreStockHomeTabs(tabsContainer) {
    if (!tabsContainer) return;

    tabsContainer.classList.remove(STOCK_TABS_HIDDEN_CLASS);
    tabsContainer.removeAttribute('aria-hidden');
}

function ensureHomeTabs(header) {
    const tabsContainer = header?.querySelector('.headerTabs');

    if (!isHomeTabsRoute()) {
        document.querySelectorAll(OWNED_TABS_SELECTOR).forEach(tabs => {
            tabs.remove();
        });

        restoreStockHomeTabs(tabsContainer);
        return;
    }

    ensureOwnedTopTabs(header);
    hideStockHomeTabs(tabsContainer);
    document.body.classList.add('withSectionTabs');

    window.CustomElements?.upgradeSubtree?.(header);
}

function normalizeSidebarLogo(logo, brandType) {
    if (!(logo instanceof HTMLImageElement)) return;

    logo.dataset.ptvLogo = brandType;
    logo.dataset.ptvImageComponent = brandType === 'sidebar' ? 'sidebar-logo' : 'drawer-logo';
    applyPtvResponsiveImage(
        logo,
        brandType === 'sidebar' ?
            PTV_ASSETS.responsive.logos.sidebar :
            PTV_ASSETS.responsive.logos.bannerLight
    );
    logo.alt = PTV_BRANDING.appName;
    logo.loading = 'eager';
    logo.decoding = 'async';
    logo.draggable = false;

    if (brandType === 'sidebar') {
        logo.className = 'ptv-sidebar-logo ptv-sidebar-logo-image';
        logo.width = 226;
        logo.height = 58;
        return;
    }

    logo.className = 'ptv-drawer-logo';
    logo.width = 172;
    logo.height = 48;
}

function cleanupBrandLogos(brand, brandType) {
    const logoSelector = brandType === 'sidebar' ?
        '[data-ptv-logo="sidebar"], .ptv-sidebar-logo, :scope > img[src*="assets/logo/"]' :
        '[data-ptv-logo="drawer"], .ptv-drawer-logo, :scope > img[src*="assets/logo/"]';
    const logos = Array.from(brand.querySelectorAll(logoSelector));
    const [logo, ...extraLogos] = logos;

    extraLogos.forEach(extraLogo => {
        extraLogo.remove();
    });

    if (logo instanceof HTMLImageElement) {
        normalizeSidebarLogo(logo, brandType);
    }
}

function cleanupSidebarBranding() {
    document.querySelectorAll('.ptv-sidebar').forEach((sidebar) => {
        const brands = Array.from(sidebar.querySelectorAll(':scope > [data-ptv-brand="sidebar"], :scope > .ptv-sidebar-brand'));
        const [brand, ...extraBrands] = brands;

        extraBrands.forEach(extraBrand => {
            extraBrand.remove();
        });

        if (brand instanceof HTMLElement) {
            brand.dataset.ptvBrand = 'sidebar';
            brand.classList.add('ptv-sidebar-brand');
            cleanupBrandLogos(brand, 'sidebar');
        }

        sidebar.querySelectorAll(':scope > img[src*="assets/logo/"]').forEach(logo => {
            logo.remove();
        });
    });

    document.querySelectorAll('.ptv-mainDrawer, .mainDrawer').forEach((drawer) => {
        const brands = Array.from(drawer.querySelectorAll(':scope .ptv-main-drawer-brand'));
        const [brand, ...extraBrands] = brands;

        extraBrands.forEach(extraBrand => {
            extraBrand.remove();
        });

        if (brand instanceof HTMLElement) {
            brand.dataset.ptvBrand = 'drawer';
            cleanupBrandLogos(brand, 'drawer');
        }
    });
}

function isAvatarHeaderButton(button) {
    return button.classList.contains('headerUserButtonRound')
        || Boolean(button.querySelector('.headerUserButtonRound'))
        || Boolean(button.getAttribute('style')?.includes('background-image'));
}

function getHeaderIconKey(button) {
    const existingIcon = button.querySelector('.ptv-icon[data-ptv-icon]');
    const existingIconName = existingIcon?.getAttribute('data-ptv-icon');

    if (existingIconName) return existingIconName;

    for (const [className, iconName] of HEADER_ICON_CLASS_MAP) {
        if (button.classList.contains(className)) return iconName;
    }

    const legacyIcon = button.querySelector('.material-icons, .material-icons-round, .material-icons-outlined');
    const text = [
        legacyIcon?.textContent,
        legacyIcon ? Array.from(legacyIcon.classList).join(' ') : '',
        button.getAttribute('title'),
        button.getAttribute('aria-label'),
        Array.from(button.classList).join(' ')
    ].filter(Boolean).join(' ');

    return iconNameFromText(text);
}

function cleanupHeaderButtonIcons(button) {
    const icons = Array.from(button.querySelectorAll(':scope > .ptv-icon'));
    const [firstIcon, ...extraIcons] = icons;

    extraIcons.forEach(icon => {
        icon.remove();
    });

    return firstIcon;
}

function mountHeaderIcon(button, iconName) {
    if (!iconName || isAvatarHeaderButton(button)) return;

    runIconEngine(button);

    const existingIcon = cleanupHeaderButtonIcons(button) || button.querySelector('.ptv-icon');
    if (existingIcon) {
        existingIcon.setAttribute('data-ptv-icon', iconName);
        existingIcon.setAttribute('data-icon', iconName);
        existingIcon.setAttribute('aria-hidden', 'true');
        existingIcon.classList.add('ptv-header-mounted-icon');
        return;
    }

    const icon = createIcon(iconName, 'ptv-icon ptv-header-mounted-icon');
    button.prepend(icon);
}

function repairHeaderIcons() {
    document
        .querySelectorAll(HEADER_ICON_TARGET_SELECTOR)
        .forEach(button => {
            if (isAvatarHeaderButton(button)) {
                button.dataset.ptvHeaderIconReady = 'avatar';
                return;
            }

            const iconName = getHeaderIconKey(button);
            if (!iconName) return;

            const hasIcon = Boolean(button.querySelector('.ptv-icon'));

            if (!hasIcon) {
                mountHeaderIcon(button, iconName);
            } else {
                cleanupHeaderButtonIcons(button);
            }

            button.dataset.ptvHeaderIconReady = 'true';
        });
}

function scheduleHeaderRepair() {
    if (headerRepairPending) return;

    headerRepairPending = true;

    HEADER_REPAIR_DELAYS.forEach((delay, index) => {
        headerScope.timeout(() => {
            repairHeaderIcons();

            if (index === HEADER_REPAIR_DELAYS.length - 1) {
                headerRepairPending = false;
            }
        }, delay);
    });
}

function patchHeaderHistoryEvents() {
    if (window.__ptvHeaderHistoryPatched) return;

    window.__ptvHeaderHistoryPatched = true;

    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    window.history.pushState = function (...args) {
        const result = originalPushState.apply(this, args);
        scheduleHeaderRepair();
        return result;
    };

    window.history.replaceState = function (...args) {
        const result = originalReplaceState.apply(this, args);
        scheduleHeaderRepair();
        return result;
    };
}

function enhanceHeaderIcons() {
    const header = document.querySelector('.ptv-legacy-skinHeader, .skinHeader');
    const headerLeft = header?.querySelector('.headerLeft');

    cleanupSidebarBranding();

    if (headerLeft) {
        const logos = Array.from(headerLeft.querySelectorAll('.ptv-header-logo'));
        const [logo, ...extraLogos] = logos;
        extraLogos.forEach((extraLogo) => {
            extraLogo.remove();
        });

        if (!logo) {
            const headerLogo = create('a', {
                className: 'ptv-header-logo itemAction',
                attrs: {
                    href: PTV_ROUTES.home,
                    'data-action': 'link',
                    'aria-label': 'Go to home'
                }
            });

            const headerLogoImage = create('img', {
                attrs: {
                    alt: PTV_BRANDING.appName,
                    'data-ptv-image-component': 'header-logo',
                    'data-ptv-logo': 'header',
                    loading: 'eager',
                    decoding: 'async'
                }
            });

            applyPtvResponsiveImage(headerLogoImage, PTV_ASSETS.responsive.logos.bannerLight);
            headerLogo.appendChild(headerLogoImage);
            headerLeft.appendChild(headerLogo);
        } else {
            const logoImage = logo.querySelector('img');

            if (logoImage instanceof HTMLImageElement) {
                logoImage.dataset.ptvLogo = 'header';
                logoImage.dataset.ptvImageComponent = 'header-logo';
                applyPtvResponsiveImage(logoImage, PTV_ASSETS.responsive.logos.bannerLight);
                logoImage.alt = PTV_BRANDING.appName;
                logoImage.loading = 'eager';
                logoImage.decoding = 'async';
            }

            logo.setAttribute('class', 'ptv-header-logo itemAction');
            logo.setAttribute('href', PTV_ROUTES.home);
            logo.setAttribute('data-action', 'link');
            logo.setAttribute('aria-label', 'Go to home');
        }

        headerLeft.querySelectorAll('.ptv-stock-header-logo').forEach((extraLogo) => {
            extraLogo.remove();
        });
        headerLeft.querySelectorAll('.ptv-header-logo img + img').forEach((extraLogo) => {
            extraLogo.remove();
        });
    }

    if (!header) return;

    ensureHomeTabs(header);

    header
        .querySelectorAll('button, .headerButton')
        .forEach(button => {
            button.classList.add('ptv-header-stock-button');
        });

    runIconEngine(header);
    repairHeaderIcons();
}

headerScope.watchDom(() => {
    enhanceHeaderIcons();
    cleanupSidebarBranding();
    scheduleHeaderRepair();
});

[
    ['hashchange', window],
    ['popstate', window],
    [PTV_EVENTS.requestStateChange, window],
    ['pageshow', window],
    ['viewshow', document],
    ['viewhide', document],
    ['pagebeforeshow', document]
].forEach(([eventName, target]) => {
    headerScope.listen(target, eventName, () => {
        cleanupSidebarBranding();
        enhanceHeaderIcons();
        scheduleHeaderRepair();
    });
});

patchHeaderHistoryEvents();
registerModule({
    density: 'comfortable',
    features: ['header', 'navigation', 'shell'],
    name: 'header',
    surface: 2,
    widgets: [
        {
            density: 'comfortable',
            id: 'shell-header',
            surface: 2,
            type: 'navigation'
        }
    ]
});

startPtvIconEngine();
enhanceHeaderIcons();
scheduleHeaderRepair();
