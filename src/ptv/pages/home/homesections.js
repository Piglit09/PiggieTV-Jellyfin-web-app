import mountPtvHomeHero, {
    cleanupDisconnectedPtvHomeHeroes,
    unmountPtvHomeHero
} from 'ptv/pages/home/mountHero';
import { trimPtvImageManagerMemory } from 'ptv/core/imageManager';
import {
    cleanupPtvCardEnhancements,
    enhancePtvCards
} from 'ptv/modules/cards/CardEnhancer';
import {
    FEATURED_CACHE_UPDATED_EVENT,
    getFeaturedContent
} from 'ptv/modules/cache/featuredContentCache';
import { getPtvPerformanceProfile } from 'ptv/core/clientProfile';
import { getPtvFeatureSettings } from 'ptv/core/featureSettings';
import { recordPtvEvent, timePtvAsync } from 'ptv/core/observability';
import { ptvSafeConsole } from 'ptv/core/safeConsole';
import { getPtvUserViews } from 'ptv/api/libraries';
import { retirePtvRouteLifetime } from 'ptv/shell/routeController';
import {
    capturePtvRouteCriticalLifecycleOwner,
    recordPtvRouteCriticalPending,
    recordPtvRouteCriticalTerminal
} from 'ptv/shell/routeCriticalLifecycle';
import globalize from 'lib/globalize';
import { DEFAULT_SECTIONS } from 'types/homeSectionType';
import Dashboard from 'utils/dashboard';

import {
    createOwnedHomeApiClient,
    createFeaturedContentFetcher,
    getRowsFromFeaturedPayload,
    loadGenreMap,
    loadStudioMap,
    PTV_HOME_ROWS,
    cleanupPtvRowBackdrops,
    renderLibraryRow,
    renderMediaRow,
    resumePtvRowVisuals
} from './ptvRows';
import { runBoundedHomeWork } from './homeWorkPlan';
import { canRestoreLegacyHomeRow, isLegacyConfiguredRow } from './legacyConfiguredPresentation';

import 'elements/emby-button/paper-icon-button-light';
import 'elements/emby-itemscontainer/emby-itemscontainer';
import 'elements/emby-scroller/emby-scroller';
import 'elements/emby-button/emby-button';

import 'components/homesections/homesections.scss';

const VIRTUAL_ROW_WORK_CONCURRENCY = 2;
const VIRTUAL_ROW_IDLE_CLEANUP_MS = 2600;
const VIRTUAL_ROW_UNMOUNT_HYSTERESIS_MS = 2400;
const VIRTUAL_ROW_RECENT_MOUNT_GRACE_MS = 3200;
const DESKTOP_OVERSCAN_ROWS_ABOVE = 5;
const DESKTOP_OVERSCAN_ROWS_BELOW = 8;
const DEFAULT_OVERSCAN_ROWS_ABOVE = 3;
const DEFAULT_OVERSCAN_ROWS_BELOW = 5;
const HIGH_PRIORITY_ROW_IDS = new Set([
    'my-media',
    'continue-watching',
    'requested-by-you',
    'latest-movies',
    'latest-shows',
    'latest-music'
]);

export function getDefaultSection(index) {
    if (index < 0 || index > DEFAULT_SECTIONS.length) return '';
    return DEFAULT_SECTIONS[index];
}

function limitRowsForPerformance(rows, performanceProfile) {
    const limit = performanceProfile.homeRowLimit;

    if (!limit || limit >= rows.length) return rows;

    const pinnedRows = rows.filter(row => row.id === 'my-media' || row.id === 'continue-watching');
    const remainingRows = rows.filter(row => row.id !== 'my-media' && row.id !== 'continue-watching');

    return [
        ...pinnedRows,
        ...remainingRows
    ].slice(0, limit);
}

function getHomeRowsForPayload(featuredPayload, performanceProfile) {
    const payloadRows = getRowsFromFeaturedPayload(featuredPayload, PTV_HOME_ROWS)
        .filter(row => !isLegacyConfiguredRow(row));

    if (featuredPayload?.rowConfigApplied === true || featuredPayload?.sections?.length) {
        return payloadRows;
    }

    return limitRowsForPerformance(payloadRows, performanceProfile);
}

function getSharedFeaturedContent(fetchFeaturedContent) {
    return getFeaturedContent(fetchFeaturedContent);
}

function isHomeRouteLifetimeCurrent(elem, lifetime = elem?.ptvRouteLifetime) {
    if (!elem || !lifetime || elem.ptvRouteLifetime !== lifetime || lifetime.signal?.aborted) return false;

    try {
        return lifetime.active === true && lifetime.isCurrent() === true;
    } catch {
        return false;
    }
}

function createHomeHeroOptions(elem, baseOptions, lifetime) {
    const apiClient = baseOptions?.apiClient;

    return {
        apiClient: createOwnedHomeApiClient(apiClient, {
            scope: 'route',
            serverId: apiClient?.serverId?.(),
            signal: lifetime.signal
        }),
        ...(baseOptions?.featuredContentPromise ? {
            featuredContentPromise: baseOptions.featuredContentPromise
        } : {}),
        isCurrent: () => isHomeRouteLifetimeCurrent(elem, lifetime),
        user: baseOptions?.user
    };
}

function cleanupHomeRouteLifetimeBinding(elem) {
    if (typeof elem?.ptvRouteLifetimeCleanup === 'function') {
        elem.ptvRouteLifetimeCleanup();
    }

    if (elem) {
        elem.ptvRouteLifetimeCleanup = null;
    }
}

function clearHomeRouteTimers(elem) {
    if (!elem?.ptvRouteTimerCleanups) return;

    for (const cleanup of Array.from(elem.ptvRouteTimerCleanups)) {
        cleanup();
    }

    elem.ptvRouteTimerCleanups.clear();
}

function scheduleHomeRouteTimer(elem, lifetime, callback, delayMs, onCancel = null) {
    if (!isHomeRouteLifetimeCurrent(elem, lifetime)) {
        onCancel?.();
        return null;
    }

    if (!elem.ptvRouteTimerCleanups) {
        elem.ptvRouteTimerCleanups = new Set();
    }

    let active = true;
    let timer = 0;
    const cleanup = () => {
        if (!active) return;

        active = false;
        window.clearTimeout(timer);
        elem.ptvRouteTimerCleanups?.delete(cleanup);
        onCancel?.();
    };

    timer = window.setTimeout(() => {
        if (!active) return;

        active = false;
        elem.ptvRouteTimerCleanups?.delete(cleanup);

        if (isHomeRouteLifetimeCurrent(elem, lifetime)) {
            callback();
        } else {
            onCancel?.();
        }
    }, delayMs);
    elem.ptvRouteTimerCleanups.add(cleanup);

    return cleanup;
}

function bindHomeRouteLifetime(elem, lifetime) {
    if (!lifetime || lifetime.signal?.aborted || lifetime.isCurrent?.() !== true) return false;

    const previousLifetime = elem.ptvRouteLifetime;

    cleanupHomeRouteLifetimeBinding(elem);

    if (previousLifetime && previousLifetime !== lifetime) {
        retirePtvRouteLifetime(previousLifetime);
    }

    elem.ptvRouteLifetime = lifetime;
    const handleAbort = () => {
        if (elem.ptvRouteLifetime !== lifetime) return;

        cleanupHomeRouteLifetimeBinding(elem);
        elem.ptvRouteLifetime = null;
        cleanupHomeRouteResources(elem);
    };

    lifetime.signal.addEventListener('abort', handleAbort, { once: true });
    elem.ptvRouteLifetimeCleanup = () => {
        lifetime.signal.removeEventListener('abort', handleAbort);
    };

    return isHomeRouteLifetimeCurrent(elem, lifetime);
}

function retireBoundHomeRouteLifetime(elem) {
    const lifetime = elem?.ptvRouteLifetime;

    cleanupHomeRouteLifetimeBinding(elem);

    if (elem) {
        elem.ptvRouteLifetime = null;
    }

    if (lifetime) {
        retirePtvRouteLifetime(lifetime);
    }
}

function cleanupFeaturedCacheListener(elem) {
    if (typeof elem.ptvFeaturedCacheCleanup === 'function') {
        elem.ptvFeaturedCacheCleanup();
        elem.ptvFeaturedCacheCleanup = null;
    }
}

function delay(ms, elem, lifetime) {
    if (!ms) return Promise.resolve(isHomeRouteLifetimeCurrent(elem, lifetime));

    return new Promise(resolve => {
        scheduleHomeRouteTimer(elem, lifetime, () => resolve(true), ms, () => resolve(false));
    });
}

function deferHomeRouteWork(elem, lifetime) {
    return new Promise(resolve => {
        scheduleHomeRouteTimer(elem, lifetime, () => resolve(true), 0, () => resolve(false));
    });
}

function enhanceCurrentHomeCards(elem, lifetime) {
    if (!isHomeRouteLifetimeCurrent(elem, lifetime)) return;

    enhancePtvCards(elem, {
        isCurrent: () => isHomeRouteLifetimeCurrent(elem, lifetime)
    });
}

function createLookupMaps() {
    return {
        genresByName: new Map(),
        studiosByName: new Map()
    };
}

function hydrateLookupMaps(lookupMaps, apiClient, userId) {
    return Promise.all([
        loadGenreMap(apiClient, userId),
        loadStudioMap(apiClient, userId)
    ])
        .then(([genresByName, studiosByName]) => {
            lookupMaps.genresByName = genresByName;
            lookupMaps.studiosByName = studiosByName;

            return lookupMaps;
        });
}

function clearDeferredResumeTimers(elem) {
    if (!elem?.ptvDeferredResumeTimers) return;

    for (const timer of elem.ptvDeferredResumeTimers) {
        window.clearTimeout(timer);
    }

    elem.ptvDeferredResumeTimers.clear();
}

function getVirtualRowStateCache(elem) {
    if (!elem.ptvVirtualRowStateCache) {
        elem.ptvVirtualRowStateCache = new Map();
    }

    return elem.ptvVirtualRowStateCache;
}

function getVirtualRowState(elem, row, index) {
    const rowId = getVirtualRowId(row, index);
    const cache = getVirtualRowStateCache(elem);
    let state = cache.get(rowId);

    if (!state) {
        state = {
            cardCount: 0,
            distantSince: 0,
            height: 0,
            html: '',
            genericPresentationVerified: false,
            hydrated: false,
            mountedAt: 0,
            remountCount: 0,
            rowDataKey: '',
            scrollLeft: 0
        };
        cache.set(rowId, state);
    }

    return state;
}

function getVirtualRowId(row, index) {
    return row?.id || row?.title || `row-${index}`;
}

function getVirtualRowDataKey(row) {
    return [
        row?.id || '',
        row?.type || '',
        row?.title || '',
        row?.itemLimit || '',
        row?.queryLimit || '',
        row?.presentation || '',
        row?.tier || '',
        row?.sourceValue || ''
    ].join('|');
}

function getRowItemContainer(sectionElem) {
    return sectionElem?.querySelector('.itemsContainer');
}

function getRowCardCount(sectionElem) {
    return sectionElem?.querySelectorAll('.card, .ptv-card, .ptv-row-empty-card, .ptv-row-more-card').length || 0;
}

function rememberRowState(elem, sectionElem, row, index) {
    if (!sectionElem) return null;

    const state = getVirtualRowState(elem, row, index);
    const scroller = sectionElem.querySelector('.emby-scrollslider, .scrollSlider, .itemsContainer');
    const height = Math.round(sectionElem.getBoundingClientRect?.().height || sectionElem.offsetHeight || 0);

    state.cardCount = getRowCardCount(sectionElem);
    state.className = sectionElem.className;
    state.height = height || state.height || 0;
    state.html = sectionElem.dataset.ptvRowResumed === 'true' ? sectionElem.innerHTML : state.html;
    state.genericPresentationVerified = !isLegacyConfiguredRow(row);
    state.hydrated = state.hydrated || sectionElem.dataset.ptvRowResumed === 'true';
    state.rowDataKey = getVirtualRowDataKey(row);
    state.scrollLeft = Math.round(scroller?.scrollLeft || Number(sectionElem.dataset.ptvScrollLeft || 0) || 0);
    state.styleBackdropImage = sectionElem.style.getPropertyValue('--ptv-row-backdrop-image') || '';

    return state;
}

function noteMountedRow(elem, sectionElem, row, index, reason) {
    const state = getVirtualRowState(elem, row, index);
    const now = Date.now();

    state.distantSince = 0;
    state.mountedAt = now;
    state.remountReason = reason;
    state.rowDataKey = getVirtualRowDataKey(row);
    sectionElem.dataset.ptvRowMountedAt = String(now);
    sectionElem.dataset.ptvRowRemountReason = reason;
}

function noteHydratedRow(elem, sectionElem, row, index) {
    const state = rememberRowState(elem, sectionElem, row, index);

    if (state) {
        state.hydrated = true;
        state.hydratedAt = Date.now();
    }

    sectionElem.dataset.ptvRowHydrated = 'true';
}

function cleanupViewportResumeObserver(elem) {
    if (!elem) return;

    elem.ptvViewportResumeObserver?.disconnect();
    elem.ptvViewportResumeObserver = null;
}

function cleanupRowMountObserver(elem) {
    if (!elem) return;

    elem.ptvRowMountObserver?.disconnect();
    elem.ptvRowMountObserver = null;

    if (typeof elem.ptvRowMountCleanup === 'function') {
        elem.ptvRowMountCleanup();
        elem.ptvRowMountCleanup = null;
    }
}

function markSectionResumed(section) {
    section.dataset.ptvRowResumed = 'true';

    if (section.parentContainer) {
        section.parentContainer.dataset.ptvRowResumed = 'true';
    }
}

function scheduleDeferredResume(elem, sections, options, lifetime = elem.ptvRouteLifetime) {
    if (!sections.length) return;
    if (!isHomeRouteLifetimeCurrent(elem, lifetime)) return;

    if (!elem.ptvDeferredResumeTimers) {
        elem.ptvDeferredResumeTimers = new Set();
    }

    const timer = window.setTimeout(() => {
        elem.ptvDeferredResumeTimers?.delete(timer);

        if (!isHomeRouteLifetimeCurrent(elem, lifetime)) return;

        const connectedSections = sections.filter(section => (
            section.isConnected && isHomeRouteLifetimeCurrent(elem, lifetime)
        ));
        if (!connectedSections.length) return;

        void timePtvAsync(
            'render',
            'home-sections-resume-deferred',
            () => runBoundedHomeWork(
                connectedSections,
                VIRTUAL_ROW_WORK_CONCURRENCY,
                section => resumeSection(section, options, elem, lifetime),
                () => isHomeRouteLifetimeCurrent(elem, lifetime)
            ),
            {
                sections: connectedSections.length
            }
        )
            .then(() => {
                if (isHomeRouteLifetimeCurrent(elem, lifetime)) {
                    enhanceCurrentHomeCards(elem, lifetime);
                }
            })
            .catch(err => {
                if (isHomeRouteLifetimeCurrent(elem, lifetime)) {
                    ptvSafeConsole.warn('[PTV Home] Failed resuming deferred sections', err);
                }
            });
    }, 450);

    elem.ptvDeferredResumeTimers.add(timer);
}

function getRowMountRootMargin(performanceProfile) {
    return performanceProfile.homeRowViewportRootMargin || '520px 0px';
}

function getRowMountRootMarginPixels(performanceProfile) {
    const rootMargin = getRowMountRootMargin(performanceProfile);
    const firstMargin = rootMargin.split(/\s+/)[0] || '';
    const value = Number(firstMargin.replace('px', ''));

    return Number.isFinite(value) ? value : 520;
}

function isScrollableElement(element) {
    if (!element || element === document.body || element === document.documentElement) return false;

    const style = window.getComputedStyle(element);
    const overflow = `${style.overflowY} ${style.overflow}`;

    return /(auto|scroll|overlay)/i.test(overflow)
        && element.scrollHeight > element.clientHeight + 4;
}

function getRowScrollRoot(elem) {
    let current = elem;

    while (current && current !== document.body && current !== document.documentElement) {
        if (isScrollableElement(current)) {
            return current;
        }

        current = current.parentElement;
    }

    const candidates = [
        elem?.closest?.('.mainAnimatedPage'),
        elem?.closest?.('.page'),
        elem?.closest?.('.view'),
        document.querySelector('.mainAnimatedPage:not(.hide)'),
        document.querySelector('.page:not(.hide)'),
        document.querySelector('.view:not(.hide)')
    ];

    return candidates.find(isScrollableElement) || null;
}

function getViewportBounds(scrollRoot) {
    if (scrollRoot && typeof scrollRoot.getBoundingClientRect === 'function') {
        const rect = scrollRoot.getBoundingClientRect();

        return {
            bottom: rect.bottom,
            height: rect.height,
            top: rect.top
        };
    }

    const height = window.innerHeight || document.documentElement.clientHeight || 0;

    return {
        bottom: height,
        height,
        top: 0
    };
}

function getScrollRootDebugName(scrollRoot) {
    if (!scrollRoot) return 'window';

    const id = scrollRoot.id ? `#${scrollRoot.id}` : '';
    const classes = scrollRoot.className && typeof scrollRoot.className === 'string' ?
        `.${scrollRoot.className.trim().split(/\s+/).filter(Boolean).join('.')}` :
        '';

    return `${scrollRoot.tagName?.toLowerCase() || 'element'}${id}${classes}`;
}

function getRowSlot(elem, index) {
    return elem.querySelector('.section' + index);
}

function getPendingVirtualRows(elem, rows) {
    return rows
        .map((row, index) => ({
            row,
            index,
            slot: getRowSlot(elem, index)
        }))
        .filter(entry => entry.slot
            && entry.slot.dataset.ptvRowMounted !== 'true'
            && entry.slot.dataset.ptvRowMounting !== 'true');
}

function getMountedUnresumedVirtualRows(elem, rows) {
    return rows
        .map((row, index) => ({
            row,
            index,
            slot: getRowSlot(elem, index)
        }))
        .filter(entry => entry.slot
            && entry.slot.dataset.ptvRowMounted === 'true'
            && entry.slot.dataset.ptvRowResumed !== 'true'
            && entry.slot.dataset.ptvRowMounting !== 'true'
            && typeof entry.slot.querySelector('.itemsContainer')?.resume === 'function');
}

function getResumedVirtualRowCount(elem, rows) {
    return rows
        .map((row, index) => getRowSlot(elem, index))
        .filter(slot => slot?.dataset.ptvRowResumed === 'true')
        .length;
}

function isRowSlotNearViewport(slot, performanceProfile, scrollRoot = null) {
    const margin = getRowMountRootMarginPixels(performanceProfile);
    const viewport = getViewportBounds(scrollRoot);
    const rect = slot.getBoundingClientRect();

    return rect.top <= viewport.bottom + margin && rect.bottom >= viewport.top - margin;
}

function isRowSlotVisible(slot, scrollRoot = null) {
    const viewport = getViewportBounds(scrollRoot);
    const rect = slot.getBoundingClientRect();

    return rect.top <= viewport.bottom && rect.bottom >= viewport.top;
}

function getOverscanRowsAbove(performanceProfile) {
    return performanceProfile.clientKind === 'desktop' ?
        DESKTOP_OVERSCAN_ROWS_ABOVE :
        DEFAULT_OVERSCAN_ROWS_ABOVE;
}

function getOverscanRowsBelow(performanceProfile) {
    return performanceProfile.clientKind === 'desktop' ?
        DESKTOP_OVERSCAN_ROWS_BELOW :
        DEFAULT_OVERSCAN_ROWS_BELOW;
}

function getVisibleRowIndexes(elem, rows, scrollRoot = null) {
    return rows
        .map((row, index) => ({
            index,
            slot: getRowSlot(elem, index)
        }))
        .filter(entry => entry.slot && isRowSlotVisible(entry.slot, scrollRoot))
        .map(entry => entry.index);
}

function getOverscanRowRange(elem, rows, performanceProfile, scrollRoot = null) {
    const visibleIndexes = getVisibleRowIndexes(elem, rows, scrollRoot);

    if (!visibleIndexes.length) {
        const nearIndex = rows.findIndex((row, index) => {
            const slot = getRowSlot(elem, index);

            return slot && isRowSlotNearViewport(slot, performanceProfile, scrollRoot);
        });
        const anchorIndex = nearIndex === -1 ? 0 : nearIndex;

        return {
            end: Math.min(rows.length - 1, anchorIndex + getOverscanRowsBelow(performanceProfile)),
            start: Math.max(0, anchorIndex - getOverscanRowsAbove(performanceProfile))
        };
    }

    return {
        end: Math.min(rows.length - 1, Math.max(...visibleIndexes) + getOverscanRowsBelow(performanceProfile)),
        start: Math.max(0, Math.min(...visibleIndexes) - getOverscanRowsAbove(performanceProfile))
    };
}

function isRowIndexInOverscan(index, elem, rows, performanceProfile, scrollRoot = null) {
    const range = getOverscanRowRange(elem, rows, performanceProfile, scrollRoot);

    return index >= range.start && index <= range.end;
}

function isHighPriorityRow(row) {
    return HIGH_PRIORITY_ROW_IDS.has(row?.id);
}

function isRowSlotDistantFromViewport(slot, performanceProfile, scrollRoot = null) {
    const baseMargin = getRowMountRootMarginPixels(performanceProfile);
    const viewport = getViewportBounds(scrollRoot);
    const margin = Math.max(baseMargin * 3, viewport.height * 1.5);
    const rect = slot.getBoundingClientRect();

    return rect.top > viewport.bottom + margin || rect.bottom < viewport.top - margin;
}

function saveRowScrollPosition(sectionElem) {
    const scroller = sectionElem.querySelector('.emby-scrollslider, .scrollSlider, .itemsContainer');

    if (scroller) {
        sectionElem.dataset.ptvScrollLeft = String(Math.round(scroller.scrollLeft || 0));
    }
}

function getVirtualizationMetrics(elem, rows, scrollRoot = null) {
    const slots = rows
        .map((row, index) => ({
            row,
            index,
            slot: getRowSlot(elem, index)
        }))
        .filter(entry => entry.slot);
    const mountedEntries = slots.filter(entry => entry.slot.dataset.ptvRowMounted === 'true');
    const unmountedEntries = slots.filter(entry => entry.slot.dataset.ptvRowMounted !== 'true');
    const hydratedEntries = slots.filter(entry => entry.slot.dataset.ptvRowHydrated === 'true' || entry.slot.dataset.ptvRowResumed === 'true');
    const range = getOverscanRowRange(elem, rows, getPtvPerformanceProfile(), scrollRoot);
    const stateCache = getVirtualRowStateCache(elem);
    const reusedRowIds = Array.from(stateCache.entries())
        .filter(([, state]) => state.remountCount > 0)
        .map(([rowId]) => rowId);
    const mountedRows = mountedEntries.length;
    const resumedRows = slots.filter(entry => entry.slot.dataset.ptvRowResumed === 'true').length;
    const unresumedMountedRows = Math.max(0, mountedRows - resumedRows);
    const actualViewportRows = slots.filter(entry => isRowSlotVisible(entry.slot, scrollRoot)).length;
    const pendingRows = getPendingVirtualRows(elem, rows).length;

    return {
        actualViewportRows,
        deferredRows: Math.max(0, rows.length - mountedRows),
        hydratedRowIds: hydratedEntries.map(entry => getVirtualRowId(entry.row, entry.index)),
        hydrationQueueLength: pendingRows + unresumedMountedRows,
        lastHydrationReason: elem.ptvLastHydrationReason || '',
        manualViewportPassCount: elem.ptvRowManualViewportPassCount || 0,
        mountedRows,
        mountedRowIds: mountedEntries.map(entry => getVirtualRowId(entry.row, entry.index)),
        observerTriggerCount: elem.ptvRowObserverTriggerCount || 0,
        resumeQueueLength: unresumedMountedRows,
        resumedRows,
        reusedRowIds,
        scrollRoot: getScrollRootDebugName(scrollRoot),
        totalRows: rows.length,
        unmountedRowIds: unmountedEntries.map(entry => getVirtualRowId(entry.row, entry.index)),
        unmountReason: elem.ptvLastUnmountReason || '',
        viewportOverscan: range
    };
}

function recordVirtualizationMetrics(elem, rows, origin, scrollRoot = null) {
    recordPtvEvent('render', 'home-row-virtualization', {
        ...getVirtualizationMetrics(elem, rows, scrollRoot),
        origin
    });
}

function setRowSlotMetadata(sectionElem, row, index) {
    sectionElem.dataset.ptvRowId = row.id || '';
    sectionElem.dataset.ptvRowIndex = String(index);
    sectionElem.dataset.ptvRowDataKey = getVirtualRowDataKey(row);
    sectionElem.dataset.ptvRowPresentation = row.presentation || '';
    sectionElem.dataset.ptvRowTier = String(row.tier || '');
    sectionElem.dataset.ptvRowType = row.type || '';
    sectionElem.dataset.ptvRowMounted = 'false';
    sectionElem.dataset.ptvRowHydrated = 'false';
    sectionElem.classList.add('ptv-row-virtual-slot', 'ptv-row-virtual-placeholder');
    Array.from(sectionElem.classList)
        .filter(className => className.startsWith('ptv-row-tier-')
            || className.startsWith('ptv-row-presentation-'))
        .forEach(className => {
            sectionElem.classList.remove(className);
        });

    if (row.tier) {
        sectionElem.classList.add(`ptv-row-tier-${row.tier}`);
    }

    if (row.presentation) {
        sectionElem.classList.add(`ptv-row-presentation-${row.presentation}`);
    }

    sectionElem.classList.toggle('ptv-row-group-start', row.showGroupHeader === true);
    sectionElem.classList.toggle('ptv-row-personalized', row.isPersonalized === true);
}

function getRowMountOptions(context) {
    return {
        enableOverflow: enableScrollX(),
        featuredContentSource: context.featuredContentSource,
        isRouteCurrent: context.isRouteCurrent,
        performanceProfile: context.performanceProfile,
        routeOwnerRef: context.routeOwnerRef
    };
}

function restoreRowScrollPosition(sectionElem) {
    const scrollLeft = Number(sectionElem.dataset.ptvScrollLeft || 0);
    if (!scrollLeft) return;

    const scroller = sectionElem.querySelector('.emby-scrollslider, .scrollSlider, .itemsContainer');
    if (scroller) {
        scroller.scrollLeft = scrollLeft;
    }
}

function restoreCachedVirtualRow(elem, sectionElem, row, index, reason) {
    const state = getVirtualRowState(elem, row, index);
    const rowDataKey = getVirtualRowDataKey(row);

    if (!canRestoreLegacyHomeRow(row, state) || !state.html || state.rowDataKey !== rowDataKey || !state.hydrated) {
        return null;
    }

    sectionElem.className = state.className || sectionElem.className;
    sectionElem.innerHTML = state.html;
    sectionElem.classList.remove('ptv-row-virtual-placeholder', 'hide');
    sectionElem.style.removeProperty('min-height');
    sectionElem.dataset.ptvRowMounted = 'true';
    sectionElem.dataset.ptvRowHydrated = 'true';
    sectionElem.dataset.ptvRowResumed = 'true';
    sectionElem.dataset.ptvRowId = row.id || '';
    sectionElem.dataset.ptvRowIndex = String(index);
    sectionElem.dataset.ptvRowType = row.type || '';
    sectionElem.dataset.ptvRowDataKey = rowDataKey;

    if (state.styleBackdropImage) {
        sectionElem.style.setProperty('--ptv-row-backdrop-image', state.styleBackdropImage);
    }

    noteMountedRow(elem, sectionElem, row, index, reason);
    state.remountCount++;
    restoreRowScrollPosition(sectionElem);
    recordPtvEvent('render', 'home-row-cache-hit', {
        cardCount: state.cardCount,
        row: row.id || '',
        rowIndex: index,
        rowType: row.type || ''
    });

    return getRowItemContainer(sectionElem);
}

function mountVirtualRow(elem, sectionElem, row, index, context, reason = 'mount') {
    if (!isHomeRouteLifetimeCurrent(elem, context.routeOwnerRef.lifetime)) return null;

    if (!sectionElem || sectionElem.dataset.ptvRowMounted === 'true') {
        return getRowItemContainer(sectionElem);
    }

    const cachedSection = restoreCachedVirtualRow(elem, sectionElem, row, index, reason);

    if (cachedSection) {
        return cachedSection;
    }

    sectionElem.classList.remove('ptv-row-virtual-placeholder');
    sectionElem.style.removeProperty('min-height');
    sectionElem.dataset.ptvRowMounted = 'true';
    sectionElem.dataset.ptvRowHydrated = 'false';
    sectionElem.dataset.ptvRowId = row.id || '';
    sectionElem.dataset.ptvRowIndex = String(index);
    sectionElem.dataset.ptvRowType = row.type || '';
    sectionElem.dataset.ptvRowDataKey = getVirtualRowDataKey(row);
    noteMountedRow(elem, sectionElem, row, index, reason);

    const options = getRowMountOptions(context);

    if (row.type === 'libraries') {
        renderLibraryRow(sectionElem, context.apiClient, context.userViews, options, row);
    } else {
        renderMediaRow(sectionElem, context.apiClient, context.userId, row, context.lookupMaps, context.userViews, options);
    }

    restoreRowScrollPosition(sectionElem);

    recordPtvEvent('render', 'home-row-cache-miss', {
        row: row.id || '',
        rowIndex: index,
        rowType: row.type || ''
    });

    return getRowItemContainer(sectionElem);
}

function unmountVirtualRow(elem, sectionElem, row, index, reason = 'distant') {
    if (!sectionElem || sectionElem.dataset.ptvRowMounted !== 'true') {
        return false;
    }

    if (sectionElem.contains(document.activeElement)) {
        return false;
    }

    saveRowScrollPosition(sectionElem);
    const state = rememberRowState(elem, sectionElem, row, index);
    cleanupPtvRowBackdrops(sectionElem);

    sectionElem.querySelectorAll('.itemsContainer').forEach(itemsContainer => {
        itemsContainer.pause?.();
        itemsContainer.fetchData = null;
        itemsContainer.parentContainer = null;
        itemsContainer.getItemsHtml = null;
        itemsContainer.afterRefresh = null;
        itemsContainer.ptvDataOwner = null;
        itemsContainer.isDataOwnerCurrent = null;
        itemsContainer.ptvLastRowItems = null;
        itemsContainer.ptvRefreshGeneration = (Number(itemsContainer.ptvRefreshGeneration) || 0) + 1;
        itemsContainer.ptvRefreshInFlightGeneration = 0;
        itemsContainer.ptvRowOptions = null;
    });

    sectionElem.innerHTML = '';
    sectionElem.classList.add('ptv-row-virtual-placeholder');
    sectionElem.classList.remove('ptv-dynamic-row', 'ptv-row-has-backdrop', 'hide');
    sectionElem.style.removeProperty('--ptv-row-backdrop-image');
    sectionElem.dataset.ptvRowMounted = 'false';
    sectionElem.dataset.ptvRowUnmountReason = reason;
    if (state?.height) {
        sectionElem.style.minHeight = `${state.height}px`;
    }
    delete sectionElem.dataset.ptvRowMounting;
    delete sectionElem.dataset.ptvRowResumed;

    return true;
}

function mountAndResumeVirtualRow(elem, entry, context, origin) {
    const lifetime = context.routeOwnerRef.lifetime;

    if (!isHomeRouteLifetimeCurrent(elem, lifetime)) return Promise.resolve(null);
    if (!entry.slot || entry.slot.dataset.ptvRowMounted === 'true' || entry.slot.dataset.ptvRowMounting === 'true') {
        return Promise.resolve(null);
    }

    entry.slot.dataset.ptvRowMounting = 'true';
    entry.slot.ptvRowMountLifetimeIdentity = lifetime.identity;

    return timePtvAsync(
        'render',
        'home-row-mount-viewport',
        () => Promise.resolve().then(() => {
            if (!isHomeRouteLifetimeCurrent(elem, lifetime)) return null;

            const section = mountVirtualRow(elem, entry.slot, entry.row, entry.index, context, origin);
            if (entry.slot.dataset.ptvRowResumed === 'true') {
                if (isHomeRouteLifetimeCurrent(elem, lifetime)) {
                    noteHydratedRow(elem, entry.slot, entry.row, entry.index);
                }

                return null;
            }

            if (!section || typeof section.resume !== 'function') {
                return null;
            }

            return resumeSection(section, {
                deferContinue: false,
                refresh: true
            }, elem, lifetime).then(result => {
                if (isHomeRouteLifetimeCurrent(elem, lifetime)) {
                    noteHydratedRow(elem, entry.slot, entry.row, entry.index);
                }

                return result;
            });
        }),
        {
            origin,
            row: entry.row.id || '',
            rowIndex: entry.index,
            rowType: entry.row.type || ''
        }
    )
        .catch(err => {
            if (isHomeRouteLifetimeCurrent(elem, lifetime)) {
                ptvSafeConsole.warn('[PTV Home] Failed mounting viewport row', err);
            }
        })
        .finally(() => {
            if (entry.slot.ptvRowMountLifetimeIdentity === lifetime.identity) {
                delete entry.slot.dataset.ptvRowMounting;
                entry.slot.ptvRowMountLifetimeIdentity = null;
            }
        });
}

function resumeMountedVirtualRow(elem, entry, origin, lifetime = elem.ptvRouteLifetime) {
    const section = entry.slot?.querySelector('.itemsContainer');

    if (!isHomeRouteLifetimeCurrent(elem, lifetime)) return Promise.resolve(null);
    if (!entry.slot
        || entry.slot.dataset.ptvRowResumed === 'true'
        || entry.slot.dataset.ptvRowMounting === 'true'
        || !section
        || typeof section.resume !== 'function'
    ) {
        return Promise.resolve(null);
    }

    entry.slot.dataset.ptvRowMounting = 'true';
    entry.slot.ptvRowMountLifetimeIdentity = lifetime.identity;

    return timePtvAsync(
        'render',
        'home-row-resume-mounted',
        () => resumeSection(section, {
            deferContinue: false,
            refresh: true
        }, elem, lifetime).then(result => {
            if (isHomeRouteLifetimeCurrent(elem, lifetime)) {
                noteHydratedRow(elem, entry.slot, entry.row, entry.index);
            }

            return result;
        }),
        {
            origin,
            row: entry.row.id || '',
            rowIndex: entry.index,
            rowType: entry.row.type || ''
        }
    )
        .catch(err => {
            if (isHomeRouteLifetimeCurrent(elem, lifetime)) {
                ptvSafeConsole.warn('[PTV Home] Failed resuming mounted viewport row', err);
            }
        })
        .finally(() => {
            if (entry.slot.ptvRowMountLifetimeIdentity === lifetime.identity) {
                delete entry.slot.dataset.ptvRowMounting;
                entry.slot.ptvRowMountLifetimeIdentity = null;
            }
        });
}

function getHydrationBufferRows(performanceProfile) {
    if (performanceProfile.clientKind === 'desktop') return 5;
    if (performanceProfile.clientKind === 'mobile') return 3;
    if (performanceProfile.isLowPower) return 3;

    return 4;
}

function getInitialHydrationTarget(elem, rows, performanceProfile, scrollRoot = null) {
    const actualViewportRows = rows
        .map((row, index) => getRowSlot(elem, index))
        .filter(slot => slot && isRowSlotVisible(slot, scrollRoot))
        .length;
    const viewportWithBuffer = actualViewportRows + getHydrationBufferRows(performanceProfile);

    return Math.min(rows.length, Math.max(getInitialRowCount(performanceProfile), viewportWithBuffer));
}

function getMinimumHydratedRows(elem, rows, performanceProfile, scrollRoot = null) {
    return getInitialHydrationTarget(elem, rows, performanceProfile, scrollRoot);
}

function takeUniqueRowEntries(entries, limit) {
    const seenSlots = new Set();
    const result = [];

    entries.forEach(entry => {
        if (!entry.slot || seenSlots.has(entry.slot) || result.length >= limit) return;

        seenSlots.add(entry.slot);
        result.push(entry);
    });

    return result;
}

function mountInitialRows(elem, rows, context, scrollRoot = null) {
    const lifetime = context.routeOwnerRef.lifetime;

    if (!isHomeRouteLifetimeCurrent(elem, lifetime)) return Promise.resolve([]);

    const pendingRows = getPendingVirtualRows(elem, rows);
    const targetCount = getInitialHydrationTarget(elem, rows, context.performanceProfile, scrollRoot);
    const visibleRows = pendingRows
        .filter(entry => isRowSlotVisible(entry.slot, scrollRoot))
        .slice(0, targetCount);
    const nearRows = pendingRows
        .filter(entry => isRowSlotNearViewport(entry.slot, context.performanceProfile, scrollRoot));
    const initialRows = takeUniqueRowEntries([
        ...visibleRows,
        ...nearRows,
        ...pendingRows
    ], targetCount);

    elem.ptvLastHydrationReason = 'initial';

    return runBoundedHomeWork(
        initialRows,
        VIRTUAL_ROW_WORK_CONCURRENCY,
        entry => mountAndResumeVirtualRow(elem, entry, context, 'initial'),
        () => isHomeRouteLifetimeCurrent(elem, lifetime)
    ).finally(() => {
        if (isHomeRouteLifetimeCurrent(elem, lifetime)) {
            recordVirtualizationMetrics(elem, rows, 'initial', scrollRoot);
        }
    });
}

function observeVirtualRowSlots(elem, rows, context, scrollRoot = null) {
    const lifetime = context.routeOwnerRef.lifetime;

    cleanupRowMountObserver(elem);

    if (!isHomeRouteLifetimeCurrent(elem, lifetime)) return;

    const slots = getPendingVirtualRows(elem, rows);

    let pumpFrame = 0;
    let pumpRunning = false;
    let pendingPumpOrigin = '';
    let cleanupTimer = 0;
    let observer = null;
    const observedSlots = new Set();
    const entriesBySlot = new WeakMap();
    const fallbackTimers = new Set();

    const observeSlot = (entry) => {
        if (!observer || !entry.slot || entry.slot.dataset.ptvRowMounted === 'true') return;
        if (entry.slot.dataset.ptvRowMounting === 'true' || observedSlots.has(entry.slot)) return;

        entriesBySlot.set(entry.slot, entry);
        observer.observe(entry.slot);
        observedSlots.add(entry.slot);
    };

    const unobserveSlot = (slot) => {
        if (!observer || !slot) return;

        observer.unobserve(slot);
        observedSlots.delete(slot);
    };

    const canUnmountRow = (row, index, slot) => {
        if (!slot
            || slot.dataset.ptvRowMounted !== 'true'
            || slot.dataset.ptvRowMounting === 'true'
            || slot.dataset.ptvRowHydrating === 'true'
            || slot.contains(document.activeElement)
        ) {
            return false;
        }

        if (isHighPriorityRow(row)) return false;
        if (isRowSlotVisible(slot, scrollRoot)) return false;
        if (isRowIndexInOverscan(index, elem, rows, context.performanceProfile, scrollRoot)) return false;
        if (isRowSlotNearViewport(slot, context.performanceProfile, scrollRoot)) return false;

        const state = getVirtualRowState(elem, row, index);
        const mountedAt = Number(slot.dataset.ptvRowMountedAt || state.mountedAt || 0);
        const now = Date.now();

        if (mountedAt && now - mountedAt < VIRTUAL_ROW_RECENT_MOUNT_GRACE_MS) return false;
        if (!isRowSlotDistantFromViewport(slot, context.performanceProfile, scrollRoot)) {
            state.distantSince = 0;
            return false;
        }

        if (!state.distantSince) {
            state.distantSince = now;
            return false;
        }

        return now - state.distantSince >= VIRTUAL_ROW_UNMOUNT_HYSTERESIS_MS;
    };

    const cleanupDistantRows = (origin = 'scan') => {
        if (!isHomeRouteLifetimeCurrent(elem, lifetime)) return;

        let unmountedRows = 0;
        const unmountedRowIds = [];

        rows.forEach((row, index) => {
            const slot = getRowSlot(elem, index);

            if (!canUnmountRow(row, index, slot)) {
                return;
            }

            if (unmountVirtualRow(elem, slot, row, index, origin)) {
                unmountedRows++;
                unmountedRowIds.push(getVirtualRowId(row, index));
                observeSlot({ row, index, slot });
            }
        });

        if (unmountedRows) {
            elem.ptvLastUnmountReason = origin;
            recordPtvEvent('render', 'home-row-unmount', {
                origin,
                unmountedRowIds
            });
            recordVirtualizationMetrics(elem, rows, `${origin}-unmount`, scrollRoot);
        }
    };

    const scheduleIdleCleanup = (origin = 'idle') => {
        if (!isHomeRouteLifetimeCurrent(elem, lifetime)) return;

        if (cleanupTimer) {
            window.clearTimeout(cleanupTimer);
        }

        cleanupTimer = window.setTimeout(() => {
            cleanupTimer = 0;
            if (isHomeRouteLifetimeCurrent(elem, lifetime)) {
                cleanupDistantRows(origin);
            }
        }, VIRTUAL_ROW_IDLE_CLEANUP_MS);
    };

    const getRowsToMount = (origin = 'scan') => {
        const pendingRows = getPendingVirtualRows(elem, rows);
        const overscanRows = pendingRows.filter(entry =>
            isRowIndexInOverscan(entry.index, elem, rows, context.performanceProfile, scrollRoot)
        );
        const nearRows = pendingRows.filter(entry => isRowSlotNearViewport(entry.slot, context.performanceProfile, scrollRoot));
        const mountedRows = rows
            .map((row, index) => getRowSlot(elem, index))
            .filter(slot => slot?.dataset.ptvRowMounted === 'true')
            .length;
        const minimumHydratedRows = getMinimumHydratedRows(elem, rows, context.performanceProfile, scrollRoot);
        const needsFallbackFill = /fallback|layout-settle|route|keyboard|wheel|touch/.test(origin)
            && mountedRows < minimumHydratedRows;
        const fallbackRows = needsFallbackFill ?
            pendingRows.filter(entry => !nearRows.includes(entry)).slice(0, minimumHydratedRows - mountedRows) :
            [];

        return takeUniqueRowEntries([
            ...overscanRows,
            ...nearRows,
            ...fallbackRows
        ], VIRTUAL_ROW_WORK_CONCURRENCY);
    };

    const getRowsToResume = (origin = 'scan') => {
        const mountedRows = getMountedUnresumedVirtualRows(elem, rows);
        const overscanRows = mountedRows.filter(entry =>
            isRowIndexInOverscan(entry.index, elem, rows, context.performanceProfile, scrollRoot)
        );
        const nearRows = mountedRows.filter(entry => isRowSlotNearViewport(entry.slot, context.performanceProfile, scrollRoot));
        const needsFallbackFill = /fallback|layout-settle|route|keyboard|wheel|touch|initial/.test(origin);
        const fallbackRows = needsFallbackFill ?
            mountedRows.filter(entry => !nearRows.includes(entry)) :
            [];

        return takeUniqueRowEntries([
            ...overscanRows,
            ...nearRows,
            ...fallbackRows
        ], VIRTUAL_ROW_WORK_CONCURRENCY);
    };

    const pumpRows = (origin = 'scan') => {
        if (!isHomeRouteLifetimeCurrent(elem, lifetime)) return Promise.resolve();

        if (pumpRunning) {
            pendingPumpOrigin = origin;
            return Promise.resolve();
        }

        elem.ptvLastHydrationReason = origin;
        elem.ptvRowManualViewportPassCount = (elem.ptvRowManualViewportPassCount || 0) + 1;

        const rowsToResume = getRowsToResume(origin);
        const rowsToMount = rowsToResume.length ? [] : getRowsToMount(origin);

        if (!rowsToResume.length && !rowsToMount.length) {
            scheduleIdleCleanup(`${origin}-idle`);
            recordVirtualizationMetrics(elem, rows, `${origin}-steady`, scrollRoot);
            return Promise.resolve();
        }

        pumpRunning = true;
        rowsToMount.forEach(entry => {
            unobserveSlot(entry.slot);
        });

        const rowWork = [
            ...rowsToResume.map(entry => ({ entry, type: 'resume' })),
            ...rowsToMount.map(entry => ({ entry, type: 'mount' }))
        ];

        return runBoundedHomeWork(
            rowWork,
            VIRTUAL_ROW_WORK_CONCURRENCY,
            work => work.type === 'resume' ?
                resumeMountedVirtualRow(elem, work.entry, origin, lifetime) :
                mountAndResumeVirtualRow(elem, work.entry, context, origin),
            () => isHomeRouteLifetimeCurrent(elem, lifetime)
        )
            .then(() => {
                if (!isHomeRouteLifetimeCurrent(elem, lifetime)) return;

                enhanceCurrentHomeCards(elem, lifetime);
                scheduleIdleCleanup(`${origin}-idle`);
                recordVirtualizationMetrics(elem, rows, origin, scrollRoot);

                const pendingRows = getPendingVirtualRows(elem, rows).length;
                const unresumedRows = getMountedUnresumedVirtualRows(elem, rows).length;
                const resumedRows = getResumedVirtualRowCount(elem, rows);
                const minimumHydratedRows = getMinimumHydratedRows(elem, rows, context.performanceProfile, scrollRoot);

                if (/fallback|layout-settle/.test(origin)
                    && (pendingRows || unresumedRows)
                    && resumedRows < minimumHydratedRows
                ) {
                    const timer = window.setTimeout(() => {
                        fallbackTimers.delete(timer);

                        if (isHomeRouteLifetimeCurrent(elem, lifetime)) {
                            schedulePump(`${origin}-continue`);
                        }
                    }, 180);
                    fallbackTimers.add(timer);
                }
            })
            .finally(() => {
                if (!isHomeRouteLifetimeCurrent(elem, lifetime)) return;

                pumpRunning = false;

                if (pendingPumpOrigin) {
                    const nextOrigin = pendingPumpOrigin;
                    pendingPumpOrigin = '';
                    schedulePump(nextOrigin);
                }
            });
    };

    const schedulePump = (origin = 'event') => {
        if (!isHomeRouteLifetimeCurrent(elem, lifetime)) return;
        if (pumpFrame) return;

        pumpFrame = window.requestAnimationFrame(() => {
            pumpFrame = 0;
            if (isHomeRouteLifetimeCurrent(elem, lifetime)) {
                void pumpRows(origin);
            }
        });
    };

    const onScrollOrResize = () => {
        schedulePump('scroll');
    };
    const onWheel = () => schedulePump('wheel');
    const onTouchMove = () => schedulePump('touch');
    const onKeyboardNavigation = (event) => {
        if (!['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' '].includes(event.key)) return;

        schedulePump('keyboard');
    };

    if (typeof IntersectionObserver === 'function') {
        observer = new IntersectionObserver((entries) => {
            if (!isHomeRouteLifetimeCurrent(elem, lifetime)) return;

            const visibleEntries = entries.filter(entry => entry.isIntersecting && entriesBySlot.has(entry.target));

            if (!visibleEntries.length) return;

            elem.ptvRowObserverTriggerCount = (elem.ptvRowObserverTriggerCount || 0) + visibleEntries.length;
            schedulePump('observer');
        }, {
            root: scrollRoot,
            rootMargin: getRowMountRootMargin(context.performanceProfile),
            threshold: 0.01
        });

        slots.forEach(observeSlot);
        elem.ptvRowMountObserver = observer;
    }

    document.addEventListener('scroll', onScrollOrResize, {
        capture: true,
        passive: true
    });
    scrollRoot?.addEventListener('scroll', onScrollOrResize, {
        passive: true
    });
    window.addEventListener('resize', onScrollOrResize, {
        passive: true
    });
    document.addEventListener('keydown', onKeyboardNavigation);
    document.addEventListener('wheel', onWheel, {
        capture: true,
        passive: true
    });
    document.addEventListener('touchmove', onTouchMove, {
        capture: true,
        passive: true
    });

    elem.ptvRowMountCleanup = () => {
        document.removeEventListener('scroll', onScrollOrResize, {
            capture: true
        });
        scrollRoot?.removeEventListener('scroll', onScrollOrResize);
        window.removeEventListener('resize', onScrollOrResize);
        document.removeEventListener('keydown', onKeyboardNavigation);
        document.removeEventListener('wheel', onWheel, {
            capture: true
        });
        document.removeEventListener('touchmove', onTouchMove, {
            capture: true
        });

        if (pumpFrame) {
            window.cancelAnimationFrame(pumpFrame);
            pumpFrame = 0;
        }

        if (cleanupTimer) {
            window.clearTimeout(cleanupTimer);
            cleanupTimer = 0;
        }

        fallbackTimers.forEach(timer => {
            window.clearTimeout(timer);
        });
        fallbackTimers.clear();

        observedSlots.clear();
    };

    schedulePump('initial-scan');
    [
        [ 'layout-settle', 250 ],
        [ 'fallback-early', 420 ],
        [ 'fallback-late', 780 ],
        [ 'layout-settle-late', 1000 ]
    ].forEach(([ origin, delayMs ]) => {
        const timer = window.setTimeout(() => {
            fallbackTimers.delete(timer);
            if (isHomeRouteLifetimeCurrent(elem, lifetime)) {
                schedulePump(origin);
            }
        }, delayMs);

        fallbackTimers.add(timer);
    });
}

export function loadSections(elem, apiClient, user, userSettings, lifetime) {
    void userSettings;
    cleanupHomeRouteResources(elem, { preserveRowVisuals: false });

    if (!bindHomeRouteLifetime(elem, lifetime)) return Promise.resolve();

    const isCurrent = () => isHomeRouteLifetimeCurrent(elem, lifetime);
    const routeCriticalOwner = capturePtvRouteCriticalLifecycleOwner('home');
    let routeCriticalOutcome = 'failed';

    elem.dataset.ptvRouteCriticalPending = 'true';
    elem.dataset.ptvRouteCriticalGeneration = String(lifetime.generation);
    recordPtvRouteCriticalPending(routeCriticalOwner);
    window.__PTV_HOME_INITIALIZED__ = true;
    elem.ptvVirtualRows = null;
    elem.ptvVirtualRowContext = null;
    elem.ptvVirtualRowStateCache = new Map();
    elem.ptvLastHydrationReason = '';
    elem.ptvRowObserverTriggerCount = 0;
    elem.ptvRowManualViewportPassCount = 0;
    elem.ptvLastUnmountReason = '';
    elem.ptvHomeHeroOptions = null;
    elem.ptvHomeHeroBaseOptions = null;
    trimPtvImageManagerMemory();

    const userId = user.Id || apiClient.getCurrentUserId();
    const loadPromise = timePtvAsync('render', 'home-sections-load', () => getPtvUserViews({
        scope: 'route',
        serverId: apiClient.serverId?.(),
        signal: lifetime.signal,
        userId
    })
        .then(result => isCurrent() ? result.Items || [] : null)
        .then(function (userViews) {
            if (!userViews || !isCurrent()) {
                routeCriticalOutcome = 'cancelled';
                return undefined;
            }

            let html = '';
            const performanceProfile = getPtvPerformanceProfile();
            const featureSettings = getPtvFeatureSettings();

            if (featureSettings.heroEnabled) {
                html += '<div class="ptvHeroMount"></div>';
            }

            if (userViews.length) {
                const seedRows = featureSettings.homeRowsEnabled ?
                    limitRowsForPerformance(PTV_HOME_ROWS, performanceProfile) :
                    [];
                const lookupMaps = createLookupMaps();
                const lookupMapsPromise = hydrateLookupMaps(lookupMaps, apiClient, userId)
                    .catch(() => lookupMaps);
                const fetchFeaturedContent = () => lookupMapsPromise
                    .then(() => createFeaturedContentFetcher(
                        apiClient,
                        userId,
                        seedRows,
                        lookupMaps,
                        userViews,
                        { performanceProfile }
                    )());
                let featuredContentPromise = seedRows.length ?
                    getSharedFeaturedContent(fetchFeaturedContent) :
                    Promise.resolve({
                        heroItems: [],
                        sectionItems: {},
                        sections: []
                    });

                return featuredContentPromise
                    .catch(() => null)
                    .then(featuredPayload => {
                        if (!isCurrent()) {
                            routeCriticalOutcome = 'cancelled';
                            return undefined;
                        }

                        const featuredCriticalOutcome = featuredPayload ? 'success' : 'partial';

                        const rows = featureSettings.homeRowsEnabled ?
                            getHomeRowsForPayload(featuredPayload, performanceProfile) :
                            [];

                        if (featuredPayload) {
                            featuredContentPromise = Promise.resolve(featuredPayload);
                        }

                        for (let i = 0; i < rows.length; i++) {
                            html += '<div class="verticalSection section' + i + '"></div>';
                        }

                        if (!isCurrent()) return undefined;

                        elem.innerHTML = html;
                        elem.classList.add('homeSectionsContainer');
                        elem.classList.toggle('ptv-home-low-power', performanceProfile.isLowPower);
                        elem.dataset.ptvClientProfile = performanceProfile.clientKind;
                        elem.dataset.ptvRenderProfile = performanceProfile.renderProfile.id;
                        elem.dataset.ptvRenderTier = performanceProfile.renderProfile.tier;

                        const heroBaseOptions = rows.length ? {
                            apiClient,
                            featuredContentPromise,
                            user
                        } : {
                            apiClient,
                            user
                        };
                        const heroOptions = createHomeHeroOptions(elem, heroBaseOptions, lifetime);

                        elem.ptvHomeHeroBaseOptions = heroBaseOptions;
                        elem.ptvHomeHeroOptions = heroOptions;

                        if (!rows.length) {
                            if (isCurrent()) {
                                mountPtvHomeHero(elem, heroOptions);
                                routeCriticalOutcome = featuredCriticalOutcome;
                            }

                            return undefined;
                        }

                        const featuredContentSource = {
                            get: () => featuredContentPromise
                        };
                        const handleFeaturedCacheUpdated = () => {
                            if (!isCurrent()) return;

                            featuredContentPromise = getFeaturedContent(fetchFeaturedContent);
                            elem.ptvHomeHeroBaseOptions.featuredContentPromise = featuredContentPromise;

                            void resume(elem, {
                                deferContinue: true,
                                refresh: true
                            }, lifetime)
                                .then(() => {
                                    if (isCurrent()) {
                                        enhanceCurrentHomeCards(elem, lifetime);
                                    }
                                })
                                .catch(err => {
                                    if (isCurrent()) {
                                        ptvSafeConsole.warn('[PTV Home] Failed refreshing featured cache content', err);
                                    }
                                });
                        };

                        if (!isCurrent()) return undefined;

                        cleanupFeaturedCacheListener(elem);
                        window.addEventListener(FEATURED_CACHE_UPDATED_EVENT, handleFeaturedCacheUpdated);
                        elem.ptvFeaturedCacheCleanup = () => {
                            window.removeEventListener(FEATURED_CACHE_UPDATED_EVENT, handleFeaturedCacheUpdated);
                        };

                        mountPtvHomeHero(elem, heroOptions);

                        for (let i = 0; i < rows.length; i++) {
                            if (!isCurrent()) return undefined;

                            setRowSlotMetadata(getRowSlot(elem, i), rows[i], i);
                        }

                        const routeOwnerRef = {
                            lifetime
                        };
                        const rowMountContext = {
                            apiClient,
                            featuredContentSource,
                            isRouteCurrent: () => isHomeRouteLifetimeCurrent(elem, routeOwnerRef.lifetime),
                            lookupMaps,
                            performanceProfile,
                            routeOwnerRef,
                            userId,
                            userViews
                        };
                        const rowScrollRoot = getRowScrollRoot(elem);
                        elem.ptvVirtualRows = rows;
                        elem.ptvVirtualRowContext = rowMountContext;

                        // Delay for polyfilled CustomElements (webOS 1.2). The
                        // route owner cancels this continuation on retirement.
                        return deferHomeRouteWork(elem, lifetime)
                            .then(continued => continued ?
                                mountInitialRows(elem, rows, rowMountContext, rowScrollRoot) :
                                undefined)
                            .then(() => {
                                if (!isCurrent()) return;

                                enhanceCurrentHomeCards(elem, lifetime);
                                observeVirtualRowSlots(elem, rows, rowMountContext, rowScrollRoot);
                                recordPtvEvent('render', 'home-route-critical-shelves-settled', {
                                    deferredRows: Math.max(0, rows.length - getResumedVirtualRowCount(elem, rows)),
                                    routeCriticalRows: getResumedVirtualRowCount(elem, rows)
                                });
                                routeCriticalOutcome = featuredCriticalOutcome;
                            });
                    });
            }

            let noLibDescription;
            if (user.Policy?.IsAdministrator) {
                noLibDescription = globalize.translate('NoCreatedLibraries', '<br><a id="button-createLibrary" class="button-link">', '</a>');
            } else {
                noLibDescription = globalize.translate('AskAdminToCreateLibrary');
            }

            html += '<div class="centerMessage padded-left padded-right">';
            html += '<h2>' + globalize.translate('MessageNothingHere') + '</h2>';
            html += '<p>' + noLibDescription + '</p>';
            html += '</div>';

            if (!isCurrent()) return undefined;

            routeCriticalOutcome = 'empty';
            elem.innerHTML = html;

            const createNowLink = elem.querySelector('#button-createLibrary');
            if (createNowLink && isCurrent()) {
                createNowLink.addEventListener('click', function () {
                    if (isCurrent()) {
                        Dashboard.navigate('dashboard/libraries');
                    }
                });
            }

            return undefined;
        }));

    return loadPromise.finally(() => {
        if (elem.dataset.ptvRouteCriticalGeneration === String(lifetime.generation)) {
            delete elem.dataset.ptvRouteCriticalPending;
            delete elem.dataset.ptvRouteCriticalGeneration;
        }

        recordPtvRouteCriticalTerminal(
            routeCriticalOwner,
            !isCurrent() || lifetime.signal.aborted ? 'cancelled' : routeCriticalOutcome
        );
    });
}

function pauseHomeItemContainers(elem) {
    const elems = elem.querySelectorAll('.itemsContainer');

    for (const e of elems) {
        e.pause?.();
    }
}

function cleanupHomeRouteResources(elem, options = {}) {
    const preserveRowVisuals = options.preserveRowVisuals !== false;

    delete elem.dataset.ptvRouteCriticalPending;
    delete elem.dataset.ptvRouteCriticalGeneration;
    clearHomeRouteTimers(elem);
    clearDeferredResumeTimers(elem);
    cleanupViewportResumeObserver(elem);
    cleanupRowMountObserver(elem);
    cleanupFeaturedCacheListener(elem);
    unmountPtvHomeHero(elem);
    cleanupPtvCardEnhancements(elem);
    cleanupPtvRowBackdrops(elem, { preserveStyles: preserveRowVisuals });
    pauseHomeItemContainers(elem);
}

export function destroySections(elem) {
    retireBoundHomeRouteLifetime(elem);
    cleanupHomeRouteResources(elem, { preserveRowVisuals: false });
    cleanupDisconnectedPtvHomeHeroes();
    trimPtvImageManagerMemory();

    const elems = elem.querySelectorAll('.itemsContainer');
    for (const e of elems) {
        e.fetchData = null;
        e.parentContainer = null;
        e.getItemsHtml = null;
        e.afterRefresh = null;
        e.ptvDataOwner = null;
        e.isDataOwnerCurrent = null;
        e.ptvLastRowItems = null;
        e.ptvRefreshGeneration = (Number(e.ptvRefreshGeneration) || 0) + 1;
        e.ptvRefreshInFlightGeneration = 0;
        e.ptvRowOptions = null;
    }

    elem.ptvHomeHeroOptions = null;
    elem.ptvHomeHeroBaseOptions = null;
    elem.ptvVirtualRows = null;
    elem.ptvVirtualRowContext = null;
    elem.ptvVirtualRowStateCache = null;
    elem.innerHTML = '';
}

export function pause(elem) {
    retireBoundHomeRouteLifetime(elem);
    cleanupHomeRouteResources(elem);
}

function getInitialRowCount(performanceProfile) {
    return Math.max(1, Number(performanceProfile.homeInitialRowCount) || 4);
}

function getRowIndex(section) {
    return Number(section.dataset.ptvRowIndex || section.parentContainer?.dataset.ptvRowIndex || 0);
}

function getImmediateResumeSections(sections, options, performanceProfile) {
    if (options?.deferContinue === false) return sections;

    if (options?.virtualizeRows === false) {
        return sections.filter(section => section.dataset.ptvRowType !== 'continue');
    }

    const initialRowCount = getInitialRowCount(performanceProfile);

    return sections.filter(section => {
        if (section.parentContainer?.dataset.ptvRowMounting === 'true') return false;
        if (section.dataset.ptvRowResumed === 'true') return true;
        if (section.dataset.ptvRowType === 'continue') return false;

        return getRowIndex(section) < initialRowCount;
    });
}

function getDeferredResumeSections(sections, options, performanceProfile) {
    if (options?.deferContinue === false) return [];

    if (options?.virtualizeRows === false) {
        return sections.filter(section => section.dataset.ptvRowType === 'continue');
    }

    const immediateSections = new Set(getImmediateResumeSections(sections, options, performanceProfile));

    return sections.filter(section => !immediateSections.has(section));
}

function resumeSection(section, options, elem, lifetime) {
    if (!isHomeRouteLifetimeCurrent(elem, lifetime)) return Promise.resolve(null);

    if (section.ptvResumePromise && section.ptvResumeLifetimeIdentity === lifetime.identity) {
        return section.ptvResumePromise;
    }

    const resumePromise = section.resume(options)
        .then(result => {
            if (isHomeRouteLifetimeCurrent(elem, lifetime)) {
                markSectionResumed(section);
            }

            return result;
        })
        .finally(() => {
            if (section.ptvResumePromise === resumePromise
                && section.ptvResumeLifetimeIdentity === lifetime.identity) {
                section.ptvResumePromise = null;
                section.ptvResumeLifetimeIdentity = null;
            }
        });

    section.ptvResumePromise = resumePromise;
    section.ptvResumeLifetimeIdentity = lifetime.identity;

    return resumePromise;
}

function observeDeferredResumeSections(elem, sections, options, performanceProfile, lifetime) {
    cleanupViewportResumeObserver(elem);

    if (!isHomeRouteLifetimeCurrent(elem, lifetime)) return;
    if (!sections.length) return;

    if (typeof IntersectionObserver !== 'function') {
        scheduleDeferredResume(elem, sections, {
            ...options,
            batchDelayMs: options?.batchDelayMs ?? performanceProfile.sectionResumeBatchDelayMs,
            batchSize: options?.batchSize ?? Math.max(1, performanceProfile.sectionResumeBatchSize || 2),
            deferContinue: false
        }, lifetime);
        return;
    }

    const rootMargin = performanceProfile.homeRowViewportRootMargin || '520px 0px';
    const scrollRoot = getRowScrollRoot(elem);
    const targetsBySection = new WeakMap();
    const observer = new IntersectionObserver((entries) => {
        if (!isHomeRouteLifetimeCurrent(elem, lifetime)) return;

        entries
            .filter(entry => entry.isIntersecting)
            .forEach(entry => {
                const section = targetsBySection.get(entry.target) || entry.target;

                observer.unobserve(entry.target);

                if (section.parentContainer?.dataset.ptvRowMounting === 'true'
                    || section.dataset.ptvRowResumed === 'true'
                    || typeof section.resume !== 'function') {
                    return;
                }

                void timePtvAsync(
                    'render',
                    'home-section-resume-viewport',
                    () => resumeSection(section, options, elem, lifetime),
                    {
                        row: section.dataset.ptvRowId || '',
                        rowIndex: getRowIndex(section),
                        rowType: section.dataset.ptvRowType || ''
                    }
                )
                    .then(() => {
                        if (isHomeRouteLifetimeCurrent(elem, lifetime)) {
                            enhanceCurrentHomeCards(elem, lifetime);
                        }
                    })
                    .catch(err => {
                        if (isHomeRouteLifetimeCurrent(elem, lifetime)) {
                            ptvSafeConsole.warn('[PTV Home] Failed resuming viewport section', err);
                        }
                    });
            });
    }, {
        root: scrollRoot,
        rootMargin
    });

    sections.forEach(section => {
        if (!isHomeRouteLifetimeCurrent(elem, lifetime)) return;

        const target = section.parentContainer || section.closest?.('.verticalSection') || section;

        targetsBySection.set(target, section);
        observer.observe(target);
    });
    elem.ptvViewportResumeObserver = observer;
}

export function resume(elem, options = {}, lifetime = elem.ptvRouteLifetime) {
    const adoptingLifetime = elem.ptvRouteLifetime !== lifetime;

    if (adoptingLifetime && !bindHomeRouteLifetime(elem, lifetime)) return Promise.resolve([]);
    if (!isHomeRouteLifetimeCurrent(elem, lifetime)) return Promise.resolve([]);

    clearDeferredResumeTimers(elem);

    if (elem.ptvVirtualRowContext?.routeOwnerRef) {
        elem.ptvVirtualRowContext.routeOwnerRef.lifetime = lifetime;
    }

    const sections = Array.from(elem.querySelectorAll('.itemsContainer'))
        .filter(section => typeof section.resume === 'function');

    sections.forEach(section => {
        section.ptvDataOwner = lifetime.identity;
        section.isDataOwnerCurrent = () => isHomeRouteLifetimeCurrent(elem, lifetime);
    });

    if (adoptingLifetime && elem.ptvHomeHeroBaseOptions && isHomeRouteLifetimeCurrent(elem, lifetime)) {
        const heroOptions = createHomeHeroOptions(elem, elem.ptvHomeHeroBaseOptions, lifetime);

        elem.ptvHomeHeroOptions = heroOptions;
        mountPtvHomeHero(elem, heroOptions);
    }

    if (adoptingLifetime) {
        resumePtvRowVisuals(elem);

        if (elem.ptvVirtualRows?.length && elem.ptvVirtualRowContext) {
            observeVirtualRowSlots(
                elem,
                elem.ptvVirtualRows,
                elem.ptvVirtualRowContext,
                getRowScrollRoot(elem)
            );
        }
    }

    const performanceProfile = getPtvPerformanceProfile();
    const immediateSections = getImmediateResumeSections(sections, options, performanceProfile);
    const deferredSections = getDeferredResumeSections(sections, options, performanceProfile);
    const batchSize = options?.batchSize || performanceProfile.sectionResumeBatchSize;
    const batchDelay = options?.batchDelayMs ?? performanceProfile.sectionResumeBatchDelayMs;

    observeDeferredResumeSections(elem, deferredSections, options, performanceProfile, lifetime);

    if (!batchSize || batchSize <= 0) {
        return timePtvAsync(
            'render',
            'home-sections-resume',
            () => Promise.all(immediateSections.map(section => resumeSection(section, options, elem, lifetime))),
            {
                deferredSections: deferredSections.length,
                sections: immediateSections.length
            }
        );
    }

    const results = [];
    const batches = [];

    for (let i = 0; i < immediateSections.length; i += batchSize) {
        batches.push(immediateSections.slice(i, i + batchSize));
    }

    return timePtvAsync('render', 'home-sections-resume-batched', () => batches.reduce((chain, batch, index) => chain
        .then(() => isHomeRouteLifetimeCurrent(elem, lifetime) ?
            Promise.all(batch.map(section => resumeSection(section, options, elem, lifetime))) :
            [])
        .then(batchResults => {
            if (!isHomeRouteLifetimeCurrent(elem, lifetime)) return null;

            results.push(...batchResults);

            if (index < batches.length - 1) {
                return delay(batchDelay, elem, lifetime);
            }

            return null;
        }), Promise.resolve())
        .then(() => results), {
        batches: batches.length,
        deferredSections: deferredSections.length,
        sections: immediateSections.length
    });
}

function enableScrollX() {
    return true;
}

export default {
    getDefaultSection,
    loadSections,
    destroySections,
    pause,
    resume
};
