import { on } from '../../core/events';
import { PTV_ASSETS, PTV_BRANDING } from '../../core/config';
import { applyPtvResponsiveImage } from '../../core/images';
import { registerModule } from '../../core/lifecycle';
import { resetRuntimeScope } from '../../core/scope';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { getUserViewsQuery } from 'hooks/useUserViews';
import { toApi } from 'utils/jellyfin-apiclient/compat';
import { queryClient } from 'utils/query/queryClient';
import {
    forceRefreshFeaturedContentCache,
    getFeaturedContentCacheStatus,
    setFeaturedContentCacheTtlMs
} from '../cache/featuredContentCache';
import {
    createFeaturedContentFetcher,
    loadGenreMap,
    loadStudioMap,
    PTV_HOME_ROWS
} from '../../pages/home/ptvRows';
import {
    applyPtvStockPrimitives,
    PTV_STOCK_FORM_FIELD_SELECTOR as ADMIN_FORM_FIELD_SELECTOR,
    PTV_STOCK_FORM_SECTION_SELECTOR as ADMIN_FORM_SECTION_SELECTOR,
    PTV_STOCK_TABLE_SELECTOR,
    PTV_STOCK_TABLE_SHELL_SELECTOR
} from '../../primitives/stockPatterns';
import { wasApplied, markApplied } from '../../utils/dom';
import { iconNameFromText, iconUrl, runIconEngine } from '../../utils/icons';

import './dashboard.scss';

const DASHBOARD_DOCUMENT_SELECTOR = '.dashboardDocument';
const DASHBOARD_DRAWER_SELECTOR = '.dashboardDocument .MuiDrawer-paper';
const DASHBOARD_RETRY_DELAYS = [0, 100, 300, 750, 1500, 2500];
const FEATURED_CACHE_TASK_SELECTOR = '[data-ptv-featured-cache-task="true"]';
const PTV_DRAWER_BRAND_SELECTOR = '[data-ptv-brand="drawer"], .ptv-admin-brand';
const PTV_DRAWER_LOGO_SELECTOR = '[data-ptv-logo="drawer"], .ptv-admin-brand-logo, .ptv-dashboard-drawer-logo';
const DASHBOARD_DRAWER_PRIMITIVE_SELECTOR = [
    '.dashboardDocument .ptv-admin-sidebar .MuiList-root',
    '.dashboardDocument .ptv-admin-sidebar .MuiListItem-root',
    '.dashboardDocument .ptv-admin-sidebar .MuiListItemButton-root',
    '.dashboardDocument .ptv-admin-sidebar .MuiCollapse-root',
    '.dashboardDocument .ptv-admin-sidebar .navMenuOption',
    '.dashboardDocument .ptv-admin-sidebar .lnkManageServer'
].join(',');
const DASHBOARD_DRAWER_PRIMITIVE_CLASSES = [
    'ptv-button',
    'ptv-button-ghost',
    'ptv-dashboard-card',
    'ptv-list',
    'ptv-list-item',
    'ptv-panel',
    'ptv-stock-button',
    'ptv-stock-list',
    'ptv-stock-list-item',
    'ptv-stock-panel'
];

let dashboardRunScheduled = false;
const dashboardScope = resetRuntimeScope('dashboard-listeners');

const DASHBOARD_DRAWER_ICON_MAP = [
    [/piggietv|piggie\s?tv/, 'piggieHub'],
    [/dashboard/, 'dashboard'],
    [/general|settings/, 'general'],
    [/branding/, 'branding'],
    [/signup|invite/, 'users'],
    [/user/, 'users'],
    [/librar/, 'libraries'],
    [/playback/, 'playback'],
    [/device/, 'devices'],
    [/activity/, 'activity'],
    [/live tv/, 'liveTv'],
    [/dvr/, 'dvr'],
    [/dlna/, 'dlna'],
    [/plugin/, 'plugins'],
    [/logs?/, 'logs'],
    [/task/, 'tasks'],
    [/api|key/, 'server'],
    [/backup/, 'backups'],
    [/network/, 'networking'],
    [/path/, 'paths'],
    [/metadata/, 'metadata']
];

const WIDGET_CLASS_RULES = [
    [/server|settings/, 'ptv-dashboard-widget-server'],
    [/activity/, 'ptv-dashboard-widget-activity'],
    [/alert/, 'ptv-dashboard-widget-alerts'],
    [/path|storage/, 'ptv-dashboard-widget-paths'],
    [/device|session/, 'ptv-dashboard-widget-devices'],
    [/running|task/, 'ptv-dashboard-widget-tasks']
];

const ADMIN_DATA_SELECTOR = [
    PTV_STOCK_TABLE_SHELL_SELECTOR,
    PTV_STOCK_TABLE_SELECTOR,
    '.MuiDataGrid-root',
    '.material-react-table'
].join(',');

const ADMIN_LAYOUT_CLASSES = [
    'ptv-admin-page',
    'ptv-admin-narrow',
    'ptv-admin-medium',
    'ptv-admin-wide',
    'ptv-admin-data-page',
    'ptv-admin-users-page',
    'ptv-density-dense',
    'ptv-density-comfortable',
    'ptv-density-expanded'
];

const DASHBOARD_OVERVIEW_CONTENT_CLASSES = [
    'ptv-dashboard-overview',
    'ptv-dashboard-overview-page'
];

const DASHBOARD_OVERVIEW_GRID_CLASSES = [
    'ptv-dashboard-overview-grid'
];

const DASHBOARD_OVERVIEW_COLUMN_CLASSES = [
    'ptv-dashboard-overview-column',
    'ptv-dashboard-overview-main',
    'ptv-dashboard-overview-activity',
    'ptv-dashboard-overview-side'
];

const ROUTE_END = '(?:$|\\s|[?#])';

const ADMIN_WIDTH_RULES = [
    [new RegExp(`/dashboard/(?:devices|activity|plugins|libraries${ROUTE_END}|users${ROUTE_END}|users/signup-invites|tasks|logs/|backups|livetv${ROUTE_END})`), 'ptv-admin-wide'],
    [/\/dashboard\/(?:settings|branding|networking|playback\/(?:transcoding|trickplay)|libraries\/(?:metadata|display|nfo)|livetv\/recordings|users\/(?:profile|access|parentalcontrol))/, 'ptv-admin-medium'],
    [/\/dashboard\/(?:playback\/(?:resume|streaming)|users\/(?:add|password)|logs(?:$|[?#]))/, 'ptv-admin-narrow']
];

const ADMIN_DENSITY_RULES = [
    [/\/dashboard\/(?:settings|general|branding|networking|playback|libraries\/(?:metadata|display|nfo)|metadata|livetv\/recordings|users\/(?:profile|access|parentalcontrol|add|password))/, 'ptv-density-dense'],
    [new RegExp(`/dashboard/(?:devices|activity|plugins|libraries${ROUTE_END}|users${ROUTE_END}|users/signup-invites|tasks|logs|backups|livetv${ROUTE_END})`), 'ptv-density-comfortable'],
    [/\/dashboard(?:$|\s|[?#])/, 'ptv-density-expanded']
];

function getDashboardRouteText() {
    return `${window.location.pathname} ${window.location.hash}`.toLowerCase();
}

function isDashboardTasksRoute() {
    return /\/dashboard\/tasks(?:$|[?#\s])/.test(getDashboardRouteText());
}

function isDashboardActive() {
    return getDashboardRouteText().includes('/dashboard') || Boolean(document.querySelector('.dashboardDocument'));
}

function scheduleDashboardRun() {
    if (dashboardRunScheduled) return;

    dashboardRunScheduled = true;

    window.requestAnimationFrame(() => {
        dashboardRunScheduled = false;

        runDashboard();
    });
}

function scheduleDashboardRetryPasses() {
    DASHBOARD_RETRY_DELAYS.forEach((delay) => {
        dashboardScope.timeout(scheduleDashboardRun, delay);
    });
}

function normalizeDrawerLogo(logo, className) {
    if (!(logo instanceof HTMLImageElement)) return;

    applyPtvResponsiveImage(logo, PTV_ASSETS.responsive.logos.sidebar);
    logo.alt = PTV_BRANDING.appName;
    logo.loading = 'eager';
    logo.decoding = 'async';
    logo.dataset.ptvLogo = 'drawer';
    logo.className = className;
}

function cleanupDrawerBrandLogos(brand, className) {
    const logos = Array.from(brand.querySelectorAll(`${PTV_DRAWER_LOGO_SELECTOR}, :scope > img`));
    const [logo, ...extraLogos] = logos;

    extraLogos.forEach(extraLogo => {
        extraLogo.remove();
    });

    if (logo instanceof HTMLImageElement) {
        normalizeDrawerLogo(logo, className);
        return logo;
    }

    return null;
}

function cleanupDrawerBrands(drawer) {
    const ptvBrands = Array.from(drawer.querySelectorAll(PTV_DRAWER_BRAND_SELECTOR));
    const stockBrand = drawer.querySelector('.adminDrawerLogo');
    const primaryBrand = ptvBrands[0] || stockBrand;

    ptvBrands.slice(1).forEach(brand => {
        brand.remove();
    });

    if (stockBrand && primaryBrand && stockBrand !== primaryBrand) {
        stockBrand.remove();
    }

    if (primaryBrand instanceof HTMLElement) {
        primaryBrand.dataset.ptvBrand = 'drawer';
    }

    return primaryBrand;
}

function enhanceAdminBrand() {
    const drawers = document.querySelectorAll('.dashboardDocument .mainDrawer-scrollContainer, .dashboardDocument .mainDrawer .scrollContainer');

    drawers.forEach((drawer) => {
        const existingBrand = cleanupDrawerBrands(drawer);

        if (existingBrand instanceof HTMLElement) {
            existingBrand.classList.add('ptv-admin-brand');

            if (!cleanupDrawerBrandLogos(existingBrand, 'ptv-admin-brand-logo ptv-drawer-logo')) {
                const logo = document.createElement('img');

                normalizeDrawerLogo(logo, 'ptv-admin-brand-logo ptv-drawer-logo');
                existingBrand.prepend(logo);
            }

            return;
        }

        const brand = document.createElement('div');
        const logo = document.createElement('img');

        brand.className = 'ptv-admin-brand';
        brand.dataset.ptvBrand = 'drawer';
        normalizeDrawerLogo(logo, 'ptv-admin-brand-logo ptv-drawer-logo');
        brand.appendChild(logo);
        drawer.prepend(brand);
    });
}

function enhanceDashboardPrimitiveClasses() {
    document.querySelectorAll(DASHBOARD_DOCUMENT_SELECTOR).forEach((dashboard) => {
        dashboard.classList.add('ptv-admin-document');

        dashboard.querySelectorAll('.skinBody, .mainAnimatedPage').forEach(element => {
            element.classList.add('ptv-admin-canvas');
        });

        dashboard.querySelectorAll('.mainDrawer, .MuiDrawer-paper').forEach(element => {
            element.classList.add('ptv-admin-sidebar', 'ptv-panel', 'ptv-ignore-stock-bridge');
        });

        dashboard.querySelectorAll('.content-primary').forEach(element => {
            element.classList.add('ptv-admin-content', 'ptv-admin-shell-spaced');
        });

        dashboard.querySelectorAll('.navMenuOption, .lnkManageServer, .MuiDrawer-paper .MuiListItemButton-root, .MuiDrawer-paper a.MuiListItemButton-root').forEach(element => {
            element.classList.add('ptv-admin-nav-item', 'ptv-button-ghost');
        });

        dashboard.querySelectorAll('.sectionTitle, .sectionTitleTextButton').forEach(element => {
            element.classList.add('ptv-section-title');
        });

        dashboard.querySelectorAll('.MuiLinearProgress-bar, .MuiLinearProgress-bar1Buffer, .MuiLinearProgress-bar2Buffer, .playbackProgress > div, .transcodingProgress > div, .backgroundProgress > div').forEach(element => {
            element.classList.add('ptv-progress-bar');
        });
    });
}

function cleanupDashboardDrawerPrimitives() {
    document.querySelectorAll(DASHBOARD_DRAWER_PRIMITIVE_SELECTOR).forEach((element) => {
        element.classList.remove(...DASHBOARD_DRAWER_PRIMITIVE_CLASSES);
    });
}

function getDashboardDrawerIconName(text) {
    const normalizedText = String(text || '').toLowerCase();
    const explicitMatch = DASHBOARD_DRAWER_ICON_MAP.find(([pattern]) => pattern.test(normalizedText));

    return explicitMatch?.[1] || iconNameFromText(normalizedText) || 'settings';
}

function createDashboardDrawerIcon(iconName) {
    const icon = document.createElement('span');

    icon.className = 'ptv-icon ptv-dashboard-drawer-icon';
    icon.setAttribute('data-ptv-icon', iconName);
    icon.setAttribute('data-icon', iconName);
    icon.setAttribute('data-ptv-engine', 'dashboard-drawer');
    icon.setAttribute('aria-hidden', 'true');
    applyDashboardDrawerIconStyle(icon, iconName);

    return icon;
}

function applyDashboardDrawerIconStyle(icon, iconName) {
    const assetUrl = iconUrl(iconName);
    const maskUrl = `url("${assetUrl}")`;

    icon.setAttribute('class', 'ptv-icon ptv-dashboard-drawer-icon');
    icon.setAttribute('data-ptv-icon', iconName);
    icon.setAttribute('data-icon', iconName);
    icon.setAttribute('data-ptv-engine', 'dashboard-drawer');
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '';
    icon.style.setProperty('--ptv-icon-url', maskUrl);
    icon.style.setProperty('background', 'linear-gradient(135deg, #ff8dc3 0%, #c9b5ff 36%, #a78bfa 58%, #7dd6ff 100%)', 'important');
    icon.style.setProperty('background-image', 'linear-gradient(135deg, #ff8dc3 0%, #c9b5ff 36%, #a78bfa 58%, #7dd6ff 100%)', 'important');
    icon.style.setProperty('mask-image', maskUrl, 'important');
    icon.style.setProperty('mask-position', 'center', 'important');
    icon.style.setProperty('mask-repeat', 'no-repeat', 'important');
    icon.style.setProperty('mask-size', 'contain', 'important');
    icon.style.setProperty('-webkit-mask-image', maskUrl, 'important');
    icon.style.setProperty('-webkit-mask-position', 'center', 'important');
    icon.style.setProperty('-webkit-mask-repeat', 'no-repeat', 'important');
    icon.style.setProperty('-webkit-mask-size', 'contain', 'important');
}

function createDashboardLogo() {
    const image = document.createElement('img');

    normalizeDrawerLogo(image, 'ptv-dashboard-drawer-logo ptv-drawer-logo');

    return image;
}

function replaceSlotContent(slot, child) {
    while (slot.firstChild) {
        slot.removeChild(slot.firstChild);
    }

    slot.appendChild(child);
}

function enhanceMuiDashboardBrand() {
    const drawerHeaders = document.querySelectorAll(`${DASHBOARD_DRAWER_SELECTOR} .MuiList-root:first-child .MuiListItem-root:first-child a`);

    drawerHeaders.forEach((header) => {
        header.classList.add('ptv-dashboard-drawer-brand');
        header.dataset.ptvBrand = 'drawer';

        const iconSlot = header.querySelector('.MuiListItemIcon-root');
        const logos = Array.from(header.querySelectorAll(PTV_DRAWER_LOGO_SELECTOR));
        const [currentLogo, ...extraLogos] = logos;

        extraLogos.forEach(logo => {
            logo.remove();
        });

        if (iconSlot && !currentLogo) {
            replaceSlotContent(iconSlot, createDashboardLogo());
        } else if (currentLogo instanceof HTMLImageElement) {
            normalizeDrawerLogo(currentLogo, 'ptv-dashboard-drawer-logo ptv-drawer-logo');

            if (iconSlot && !iconSlot.contains(currentLogo)) {
                replaceSlotContent(iconSlot, currentLogo);
            }
        }

        const text = header.querySelector('.MuiListItemText-root');
        if (text) text.classList.add('ptv-dashboard-drawer-brand-text');
    });
}

function enhanceMuiDashboardDrawerIcons() {
    const rows = document.querySelectorAll(`${DASHBOARD_DRAWER_SELECTOR} .MuiListItemButton-root, ${DASHBOARD_DRAWER_SELECTOR} a.MuiListItemButton-root`);

    rows.forEach((row) => {
        if (row?.classList.contains('ptv-dashboard-drawer-brand')) return;

        let slot = row.querySelector('.MuiListItemIcon-root');

        if (!slot) {
            slot = document.createElement('span');
            slot.className = 'MuiListItemIcon-root ptv-dashboard-drawer-icon-slot';
            row.prepend(slot);
        }

        const text = row?.querySelector('.MuiListItemText-root')?.textContent || row?.textContent || slot.textContent || '';
        const iconName = getDashboardDrawerIconName(text);
        const existingIcon = slot.querySelector(':scope > span.ptv-icon[data-ptv-icon]');

        slot.classList.add('ptv-dashboard-drawer-icon-slot');

        if (
            existingIcon
            && existingIcon instanceof HTMLSpanElement
            && String(existingIcon.getAttribute('data-ptv-icon') || '') === String(iconName)
            && slot.children.length === 1
        ) {
            applyDashboardDrawerIconStyle(existingIcon, iconName);
            return;
        }

        replaceSlotContent(slot, createDashboardDrawerIcon(iconName));
    });
}

function getWidgetClass(text) {
    const normalizedText = text.toLowerCase();
    const match = WIDGET_CLASS_RULES.find(([pattern]) => pattern.test(normalizedText));

    return match?.[1] || 'ptv-dashboard-widget-secondary';
}

function enhanceDashboardWidgets() {
    const titleButtons = document.querySelectorAll(
        '.dashboardDocument .content-primary > .MuiGrid-container .MuiButton-root'
    );

    titleButtons.forEach((button) => {
        const widget = button.parentElement;

        if (!widget) return;

        const text = button.textContent?.trim();

        if (!text) return;

        widget.classList.add('ptv-dashboard-widget', getWidgetClass(text));
        button.classList.add('ptv-dashboard-widget-title');

        widget.querySelectorAll('.MuiButton-root:not(.ptv-dashboard-widget-title)').forEach((actionButton) => {
            actionButton.classList.add('ptv-dashboard-action-button');

            if (actionButton.parentElement instanceof HTMLElement) {
                actionButton.parentElement.classList.add('ptv-dashboard-action-row');
            }
        });
    });
}

function cleanupDashboardOverviewClasses(content) {
    content.classList.remove(...DASHBOARD_OVERVIEW_CONTENT_CLASSES);

    content.querySelectorAll('.ptv-dashboard-overview-grid').forEach((grid) => {
        grid.classList.remove(...DASHBOARD_OVERVIEW_GRID_CLASSES);
    });

    content.querySelectorAll('.ptv-dashboard-overview-column').forEach((column) => {
        column.classList.remove(...DASHBOARD_OVERVIEW_COLUMN_CLASSES);
    });

    content.querySelectorAll('.ptv-dashboard-metric-grid').forEach((grid) => {
        grid.classList.remove('ptv-dashboard-metric-grid');
        grid.querySelectorAll('.ptv-dashboard-metric-item, .ptv-dashboard-metric-card').forEach((element) => {
            element.classList.remove('ptv-dashboard-metric-item', 'ptv-dashboard-metric-card');
        });
    });

    content.querySelectorAll('.ptv-dashboard-widget-metrics').forEach((widget) => {
        widget.classList.remove('ptv-dashboard-widget', 'ptv-dashboard-widget-metrics');
    });
}

function classifyDashboardOverviewColumn(column) {
    if (column.querySelector('.ptv-dashboard-widget-server')) return 'ptv-dashboard-overview-main';
    if (column.querySelector('.ptv-dashboard-widget-activity')) return 'ptv-dashboard-overview-activity';
    if (column.querySelector('.ptv-dashboard-widget-alerts, .ptv-dashboard-widget-paths')) return 'ptv-dashboard-overview-side';

    return null;
}

function enhanceDashboardMetricGrid(content) {
    content.querySelectorAll('.ptv-dashboard-metric-grid').forEach((grid) => {
        grid.classList.remove('ptv-dashboard-metric-grid');
    });

    content.querySelectorAll('.ptv-dashboard-widget-metrics').forEach((widget) => {
        widget.classList.remove('ptv-dashboard-widget', 'ptv-dashboard-widget-metrics');
    });

    content.querySelectorAll('.ptv-dashboard-overview-main .MuiGrid-container').forEach((grid) => {
        const metricCards = Array.from(grid.children).filter((item) => (
            item instanceof HTMLElement
                && (
                    item.classList.contains('MuiCard-root')
                    || Boolean(item.querySelector('.MuiCard-root'))
                )
        ));

        if (metricCards.length < 2) return;

        grid.classList.add('ptv-dashboard-metric-grid');
        Array.from(grid.children).forEach((item) => {
            if (!(item instanceof HTMLElement)) return;

            item.classList.add('ptv-dashboard-metric-item');

            const card = item.classList.contains('MuiCard-root') ?
                item :
                item.querySelector('.MuiCard-root');

            if (card instanceof HTMLElement) {
                card.classList.add('ptv-dashboard-metric-card');
            }
        });

        if (grid.parentElement instanceof HTMLElement) {
            grid.parentElement.classList.add('ptv-dashboard-widget', 'ptv-dashboard-widget-metrics');
        }
    });
}

function enhanceDashboardOverviewLayout() {
    const contents = document.querySelectorAll('.dashboardDocument .content-primary');

    contents.forEach((content) => {
        const overviewGrid = content.querySelector(':scope > .MuiGrid-container');

        if (!overviewGrid || !content.querySelector('.ptv-dashboard-widget-server')) {
            cleanupDashboardOverviewClasses(content);
            return;
        }

        content.classList.add('ptv-dashboard-overview', 'ptv-dashboard-overview-page');
        overviewGrid.classList.add('ptv-dashboard-overview-grid');

        Array.from(overviewGrid.children).forEach((column) => {
            if (!(column instanceof HTMLElement)) return;

            column.classList.remove(...DASHBOARD_OVERVIEW_COLUMN_CLASSES);

            const columnClass = classifyDashboardOverviewColumn(column);

            if (!columnClass) return;

            column.classList.add('ptv-dashboard-overview-column', columnClass);
        });

        enhanceDashboardMetricGrid(content);
    });
}

function enhanceDashboardCards() {
    const cards = document.querySelectorAll(
        '.dashboardDocument .activeSession, .dashboardDocument .card, .dashboardDocument .cardBox, .dashboardDocument .paperList, .dashboardDocument .listItem, .dashboardDocument .section, .dashboardDocument .visualCardBox, .dashboardDocument .MuiPaper-root, .dashboardDocument .MuiCard-root, .dashboardDocument .MuiList-root'
    );

    cards.forEach((card) => {
        if (card.closest('.ptv-admin-sidebar, .mainDrawer, .MuiDrawer-paper')) return;
        if (wasApplied(card, 'ptvDashboardCard') && card.classList.contains('ptv-dashboard-card')) return;

        markApplied(card, 'ptvDashboardCard');
        card.classList.add('ptv-dashboard-card', 'ptv-panel');
    });
}

function removeAdminFormClasses(content) {
    content.classList.remove('ptv-dashboard-form-page');
    content.querySelectorAll('.ptv-dashboard-form-card, .ptv-dashboard-form-section').forEach((element) => {
        element.classList.remove('ptv-dashboard-form-card', 'ptv-dashboard-form-section');
    });
}

function hasAdminFormFields(element) {
    return Boolean(element?.querySelector?.(ADMIN_FORM_FIELD_SELECTOR));
}

function isAdminFormPage(content) {
    const routeText = getDashboardRouteText();

    if (!routeText.includes('/dashboard')) return false;
    if (content.classList.contains('ptv-admin-data-page')) return false;

    return Boolean(content.querySelector('form, .dashboardHostingForm, .editUserProfileForm, .newUserProfileForm'));
}

function getAdminWidthClass(content) {
    const routeText = getDashboardRouteText();
    const match = ADMIN_WIDTH_RULES.find(([pattern]) => pattern.test(routeText));

    if (match) return match[1];

    if (content.querySelector(ADMIN_DATA_SELECTOR)) return 'ptv-admin-wide';
    if (hasAdminFormFields(content)) return 'ptv-admin-medium';

    return 'ptv-admin-wide';
}

function getAdminDensityClass(content) {
    const routeText = getDashboardRouteText();
    const match = ADMIN_DENSITY_RULES.find(([pattern]) => pattern.test(routeText));

    if (match) return match[1];

    if (content.querySelector(ADMIN_DATA_SELECTOR)) return 'ptv-density-comfortable';
    if (hasAdminFormFields(content)) return 'ptv-density-dense';

    return 'ptv-density-expanded';
}

function enhanceDashboardLayout() {
    const contents = document.querySelectorAll('.dashboardDocument .content-primary');

    contents.forEach((content) => {
        content.classList.remove(...ADMIN_LAYOUT_CLASSES);
        content.classList.add('ptv-admin-page', getAdminWidthClass(content), getAdminDensityClass(content));

        if (content.querySelector(ADMIN_DATA_SELECTOR)) {
            content.classList.add('ptv-admin-data-page');
        }

        if (content.querySelector('.localUsers, .userProfilesPage, .editUserProfileForm, .newUserProfileForm')) {
            content.classList.add('ptv-admin-users-page');
        }
    });
}

function enhanceDashboardStockPatterns() {
    document.querySelectorAll('.dashboardDocument').forEach((dashboard) => {
        applyPtvStockPrimitives(dashboard);
    });
}

function enhanceDashboardForms() {
    const contents = document.querySelectorAll('.dashboardDocument .content-primary');

    contents.forEach((content) => {
        if (!isAdminFormPage(content)) {
            removeAdminFormClasses(content);
            return;
        }

        content.classList.add('ptv-dashboard-form-page');

        const directFormChildren = Array.from(content.children)
            .filter((child) => child instanceof HTMLElement && hasAdminFormFields(child));

        const cards = directFormChildren.length ?
            directFormChildren :
            Array.from(content.querySelectorAll('form, .readOnlyContent, .verticalSection, .dashboardSection'))
                .filter((child) => child instanceof HTMLElement && hasAdminFormFields(child));

        cards.forEach((card) => {
            card.classList.add('ptv-dashboard-form-card', 'ptv-panel');
        });

        content.querySelectorAll(ADMIN_FORM_SECTION_SELECTOR).forEach((section) => {
            section.classList.add('ptv-dashboard-form-section');
        });
    });
}

function enhanceDashboardIcons() {
    const targets = document.querySelectorAll(
        '.dashboardDocument .mainDrawer a, .dashboardDocument .mainDrawer button, .dashboardDocument .mainDrawer .listItem'
    );

    targets.forEach((target) => {
        if (wasApplied(target, 'ptvDashboardIcon') && target.classList.contains('ptv-dashboard-icon-row')) return;

        markApplied(target, 'ptvDashboardIcon');
        target.classList.add('ptv-dashboard-icon-row');
    });

    runIconEngine(document);
}

function formatDateTime(timestamp) {
    if (!timestamp) return 'Not cached yet';

    return new Date(timestamp).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
    });
}

function formatDurationHours(ttlMs) {
    return Math.max(1, Math.round(ttlMs / (60 * 60 * 1000)));
}

function getFeaturedPayloadSummary(payload) {
    const heroCount = Array.isArray(payload?.heroItems) ? payload.heroItems.length : 0;
    const sectionItems = payload?.sectionItems || {};
    const sectionIds = Object.keys(sectionItems);
    const itemCount = sectionIds.reduce((count, sectionId) => {
        const items = sectionItems[sectionId];

        return count + (Array.isArray(items) ? items.length : 0);
    }, 0);

    return {
        heroCount,
        itemCount,
        sectionCount: sectionIds.length
    };
}

function setFeaturedCacheTaskMessage(panel, message, state = 'idle') {
    const messageElement = panel.querySelector('[data-ptv-featured-cache-message]');

    panel.dataset.ptvFeaturedCacheRunState = state;

    if (messageElement) {
        messageElement.textContent = message;
    }
}

function updateFeaturedCacheTaskPanel(panel) {
    const status = getFeaturedContentCacheStatus();
    const ttlInput = panel.querySelector('[data-ptv-featured-cache-ttl]');
    const statusText = panel.querySelector('[data-ptv-featured-cache-status]');
    const expiresText = panel.querySelector('[data-ptv-featured-cache-expires]');
    const sectionText = panel.querySelector('[data-ptv-featured-cache-sections]');

    if (ttlInput instanceof HTMLInputElement && document.activeElement !== ttlInput) {
        ttlInput.value = String(formatDurationHours(status.ttlMs));
    }

    if (statusText) {
        let label = 'Stale or empty';

        if (status.isFresh) {
            if (status.storage === 'plugin') {
                label = 'Fresh on PTV plugin';
            } else if (status.storage === 'named-config') {
                label = 'Fresh in named config';
            } else {
                label = status.isStored ? 'Fresh on server' : 'Fresh in memory';
            }
        }

        statusText.textContent = label;
    }

    if (expiresText) {
        expiresText.textContent = formatDateTime(status.expiresAt);
    }

    if (sectionText) {
        sectionText.textContent = [
            `${status.heroCount} hero`,
            `${status.itemCount} row items`,
            `${status.sectionCount} sections`
        ].join(' / ');
    }

    if (status.writeError) {
        setFeaturedCacheTaskMessage(
            panel,
            `Cache is available for this page, but the server did not save it: ${status.writeError}`,
            'error'
        );
    }
}

function fetchDashboardFeaturedContent() {
    const apiClient = ServerConnections.currentApiClient?.();
    const userId = apiClient?.getCurrentUserId?.();

    if (!apiClient || !userId) {
        return Promise.reject(new Error('No active Jellyfin API client is available.'));
    }

    const userViewsPromise = queryClient
        .fetchQuery(getUserViewsQuery(toApi(apiClient), userId))
        .catch(() => (
            typeof apiClient.getUserViews === 'function' ?
                apiClient.getUserViews({}, userId) :
                { Items: [] }
        ));

    return userViewsPromise
        .then(result => result.Items || [])
        .then(userViews => Promise.all([
            loadGenreMap(apiClient, userId),
            loadStudioMap(apiClient, userId)
        ])
            .then(([genresByName, studiosByName]) => createFeaturedContentFetcher(
                apiClient,
                userId,
                PTV_HOME_ROWS,
                {
                    genresByName,
                    studiosByName
                },
                userViews
            )()));
}

function createFeaturedCacheTaskPanel() {
    const panel = document.createElement('section');
    const header = document.createElement('div');
    const title = document.createElement('h2');
    const meta = document.createElement('p');
    const controls = document.createElement('div');
    const intervalLabel = document.createElement('label');
    const intervalInput = document.createElement('input');
    const saveButton = document.createElement('button');
    const forceButton = document.createElement('button');
    const runMessage = document.createElement('p');
    const statusGrid = document.createElement('dl');

    panel.className = 'ptv-featured-cache-task ptv-dashboard-card ptv-panel';
    panel.dataset.ptvFeaturedCacheTask = 'true';

    header.className = 'ptv-featured-cache-task-header';
    title.className = 'ptv-featured-cache-task-title';
    title.textContent = 'PiggieTV Featured Content Refresh';
    meta.className = 'ptv-featured-cache-task-meta';
    meta.textContent = 'Controls the shared server-side hero and home-row featured content cache.';
    header.append(title, meta);

    controls.className = 'ptv-featured-cache-task-controls';

    intervalLabel.className = 'ptv-featured-cache-task-field';
    intervalLabel.textContent = 'Refresh every';
    intervalInput.className = 'ptv-field-control ptv-featured-cache-task-input';
    intervalInput.dataset.ptvFeaturedCacheTtl = 'true';
    intervalInput.type = 'number';
    intervalInput.min = '1';
    intervalInput.max = '168';
    intervalInput.step = '1';
    intervalInput.inputMode = 'numeric';
    intervalLabel.append(intervalInput, document.createTextNode(' hours'));

    saveButton.type = 'button';
    saveButton.className = 'ptv-button ptv-button-ghost ptv-featured-cache-task-button';
    saveButton.textContent = 'Save Interval';
    saveButton.addEventListener('click', () => {
        const nextHours = Number(intervalInput.value || 12);

        setFeaturedContentCacheTtlMs(nextHours * 60 * 60 * 1000);
        updateFeaturedCacheTaskPanel(panel);
    });

    forceButton.type = 'button';
    forceButton.className = 'ptv-button ptv-button-primary ptv-featured-cache-task-button';
    forceButton.textContent = 'Force Run';
    forceButton.addEventListener('click', () => {
        forceButton.disabled = true;
        forceButton.textContent = 'Running...';
        setFeaturedCacheTaskMessage(panel, 'Refreshing featured content...', 'running');

        forceRefreshFeaturedContentCache(fetchDashboardFeaturedContent)
            .then(payload => {
                const summary = getFeaturedPayloadSummary(payload);

                updateFeaturedCacheTaskPanel(panel);

                const status = getFeaturedContentCacheStatus();

                if (!status.writeError) {
                    setFeaturedCacheTaskMessage(
                        panel,
                        `Finished: ${summary.heroCount} hero items, ${summary.itemCount} row items across ${summary.sectionCount} sections.`,
                        'success'
                    );
                }
            })
            .catch(err => {
                console.warn('[PTV Dashboard] Failed to force featured cache refresh', err);
                setFeaturedCacheTaskMessage(
                    panel,
                    `Refresh failed: ${err?.message || 'Unable to fetch featured content.'}`,
                    'error'
                );
            })
            .finally(() => {
                forceButton.disabled = false;
                forceButton.textContent = 'Force Run';
            });
    });

    controls.append(intervalLabel, saveButton, forceButton);

    runMessage.className = 'ptv-featured-cache-task-message';
    runMessage.dataset.ptvFeaturedCacheMessage = 'true';
    runMessage.textContent = 'Ready to refresh featured content.';

    statusGrid.className = 'ptv-featured-cache-task-status';
    statusGrid.innerHTML = [
        '<div><dt>Status</dt><dd data-ptv-featured-cache-status></dd></div>',
        '<div><dt>Expires</dt><dd data-ptv-featured-cache-expires></dd></div>',
        '<div><dt>Payload</dt><dd data-ptv-featured-cache-sections></dd></div>'
    ].join('');

    panel.append(header, controls, runMessage, statusGrid);
    updateFeaturedCacheTaskPanel(panel);

    return panel;
}

function enhanceFeaturedCacheScheduledTask() {
    document.querySelectorAll(FEATURED_CACHE_TASK_SELECTOR).forEach((panel) => {
        if (!isDashboardTasksRoute()) {
            panel.remove();
        }
    });

    if (!isDashboardTasksRoute()) return;

    const content = document.querySelector('.dashboardDocument .content-primary');
    if (!content) return;

    const existingPanel = content.querySelector(FEATURED_CACHE_TASK_SELECTOR);

    if (existingPanel instanceof HTMLElement) {
        updateFeaturedCacheTaskPanel(existingPanel);
        return;
    }

    content.prepend(createFeaturedCacheTaskPanel());
}

function runDashboard() {
    if (!isDashboardActive()) return;

    enhanceDashboardPrimitiveClasses();
    cleanupDashboardDrawerPrimitives();
    enhanceAdminBrand();
    enhanceMuiDashboardBrand();
    enhanceMuiDashboardDrawerIcons();
    enhanceDashboardStockPatterns();
    cleanupDashboardDrawerPrimitives();
    enhanceDashboardLayout();
    enhanceDashboardWidgets();
    enhanceDashboardOverviewLayout();
    enhanceDashboardCards();
    enhanceDashboardForms();
    enhanceDashboardIcons();
    enhanceFeaturedCacheScheduledTask();
}

dashboardScope.watchDom(() => scheduleDashboardRun());

registerModule({
    density: 'comfortable',
    features: ['admin', 'dashboard', 'forms', 'tables'],
    layout: 'admin',
    name: 'dashboard',
    permissions: ['admin'],
    route: {
        density: 'comfortable',
        id: 'dashboard',
        layout: 'admin',
        navigationItemId: 'dashboard',
        pageType: 'dashboard',
        pattern: ({ full }) => /\/dashboard/i.test(full),
        surface: 1
    },
    surface: 1,
    widgets: [
        {
            density: 'comfortable',
            id: 'admin-drawer',
            surface: 2,
            type: 'navigation'
        },
        {
            density: 'comfortable',
            id: 'admin-data-page',
            surface: 2,
            type: 'data-table'
        },
        {
            density: 'dense',
            id: 'admin-form-page',
            surface: 2,
            type: 'form'
        }
    ]
});

on('routechange', ({ detail }) => {
    if (!detail?.isDashboard) return;

    scheduleDashboardRetryPasses();
});

dashboardScope.listen(window, 'hashchange', scheduleDashboardRetryPasses);
dashboardScope.listen(window, 'popstate', scheduleDashboardRetryPasses);

scheduleDashboardRetryPasses();
