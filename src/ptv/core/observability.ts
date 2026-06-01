import { PTV_DEBUG, PTV_EVENTS, PTV_RUNTIME } from './config';
import {
    applyPtvClientProfileClasses,
    getPtvClientProfile,
    getPtvPerformanceProfile,
    type PtvClientProfile,
    type PtvPerformanceProfile
} from './clientProfile';
import { dispatchPtvCustomEvent } from './events';
import { getPtvPluginApiDiagnostics } from './pluginApi';
import { resetRuntimeScope } from './scope';
import { classifyPtvRequestUrl } from './urlOrigins';

type PtvDebugEventType =
    | 'api'
    | 'cache'
    | 'frame'
    | 'image'
    | 'memory'
    | 'profile'
    | 'recommendation'
    | 'render'
    | 'route'
    | 'row-fetch';

type PtvDebugTiming = {
    at: number;
    detail?: unknown;
    durationMs: number;
    name: string;
    type: PtvDebugEventType;
};

type PtvDebugEvent = {
    at: number;
    detail?: unknown;
    name: string;
    type: PtvDebugEventType;
};

type PtvImageTracker = {
    completed: boolean;
    lastEventAt: number;
    lastEventKey: string;
    resetCount: number;
    sourceComponent: string;
    startedAt: number;
    url: string;
};

type PtvDebugSummary = {
    averageMs: number;
    count: number;
    maxMs: number;
    p95Ms: number;
};

type PtvDebugApi = {
    clear: () => void;
    disable: () => void;
    enable: () => void;
    event: (type: PtvDebugEventType, name: string, detail?: unknown) => void;
    report: () => ReturnType<typeof getPtvDebugReport>;
    time: typeof timePtvAsync;
    timing: (type: PtvDebugEventType, name: string, durationMs: number, detail?: unknown) => void;
};

type PtvGlobal = Record<string, unknown> & {
    debug?: PtvDebugApi;
};

type PtvWindow = Window & Partial<Record<'PTV_DEBUG' | '__PTV_IMAGE_TRACKER__' | '__PTV_OBSERVABILITY_INSTALLED__', boolean>> & {
    PTV?: PtvGlobal;
};

type NavigatorWithMemory = Navigator & {
    deviceMemory?: number;
};

type PerformanceWithMemory = Performance & {
    memory?: {
        jsHeapSizeLimit?: number;
        totalJSHeapSize?: number;
        usedJSHeapSize?: number;
    };
};

const ptvWindow = window as PtvWindow;
const dispatchDebugEvent = dispatchPtvCustomEvent as (eventName: string, detail?: unknown) => void;
const timings: PtvDebugTiming[] = [];
const events: PtvDebugEvent[] = [];
const imageTrackers = new WeakMap<HTMLImageElement, PtvImageTracker>();
const imageEventDedupe = new Map<string, number>();
const imageTrackerResetDedupe = new Map<string, number>();
const observedImageFailures = new Map<string, number>();
const observedImageRetrySuppressions = new Map<string, number>();
const observedResourceEntries = new Map<string, number>();
const IMAGE_EVENT_DEDUPE_MS = 15 * 1000;
const IMAGE_ERROR_SUPPRESSION_MS = 5 * 60 * 1000;
const IMAGE_MAX_LIFECYCLE_MS = 2 * 60 * 1000;
const IMAGE_TRACKER_RESET_DEDUPE_MS = 30 * 1000;
const STATIC_LOGO_EVENT_SUPPRESSION_MS = 5 * 60 * 1000;
const IMAGE_DEDUPE_LIMIT = 500;
const ALWAYS_ON_DEBUG_TYPES = new Set<PtvDebugEventType>([
    'api',
    'cache',
    'recommendation',
    'render',
    'route',
    'row-fetch'
]);

let debugEnabled = false;
let debugScope: ReturnType<typeof resetRuntimeScope> | null = null;
let debugCacheStatusProvider: (() => unknown) | null = null;
let debugShellStatusProvider: (() => unknown) | null = null;
let debugSignupStatusProvider: (() => unknown) | null = null;
let resourceObserver: PerformanceObserver | null = null;

function now() {
    return Math.round(performance.now());
}

function trimBuffer<T>(buffer: T[], maxLength: number) {
    if (buffer.length <= maxLength) return;

    buffer.splice(0, buffer.length - maxLength);
}

function getStorage() {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function getInitialDebugValue() {
    return Boolean(
        ptvWindow.PTV_DEBUG === true
        || window.location.search.includes('ptvDebug=1')
        || getStorage()?.getItem(PTV_DEBUG.storageKey) === '1'
    );
}

function getPtvGlobal() {
    ptvWindow.PTV ||= {};

    return ptvWindow.PTV;
}

function debugConsole(message: string, detail?: unknown) {
    if (!debugEnabled) return;

    console.debug(`[PiggieTV Debug] ${message}`, detail);
}

function warnDebug(message: string, detail?: unknown) {
    if (!debugEnabled) return;

    console.warn(`[PiggieTV Debug] ${message}`, detail);
}

function getActiveProfiles(): {
    clientProfile: PtvClientProfile;
    performanceProfile: PtvPerformanceProfile;
} {
    const clientProfile = applyPtvClientProfileClasses();
    const performanceProfile = getPtvPerformanceProfile();

    if (!performanceProfile.renderProfile?.id || !performanceProfile.renderProfile?.tier) {
        warnDebug('Unable to detect active render profile.', {
            clientProfile,
            performanceProfile
        });
    }

    return {
        clientProfile,
        performanceProfile
    };
}

export function recordPtvStartupEvent() {
    if (!debugEnabled) return;

    const {
        clientProfile,
        performanceProfile
    } = getActiveProfiles();

    recordPtvEvent('profile', 'ptv:init', {
        clientProfile: {
            isFireTv: clientProfile.isFireTv,
            isLowPower: clientProfile.isLowPower,
            isMobile: clientProfile.isMobile,
            isTv: clientProfile.isTv,
            isWebOs: clientProfile.isWebOs,
            kind: clientProfile.kind
        },
        renderProfile: performanceProfile.renderProfile
    });
}

function getMemorySnapshot() {
    const memory = (performance as PerformanceWithMemory).memory;
    const deviceMemory = Number((navigator as NavigatorWithMemory).deviceMemory || 0);
    const heapRatio = memory?.jsHeapSizeLimit && memory.usedJSHeapSize ?
        memory.usedJSHeapSize / memory.jsHeapSizeLimit :
        0;

    let mode: 'high' | 'low' | 'medium' | 'unknown' = 'unknown';

    if (deviceMemory > 0 && deviceMemory <= 2) {
        mode = 'low';
    } else if (deviceMemory > 0 && deviceMemory <= 4) {
        mode = 'medium';
    } else if (deviceMemory > 4 || heapRatio > 0) {
        mode = heapRatio > 0.82 ? 'low' : 'high';
    }

    return {
        deviceMemory,
        hardwareConcurrency: Number(navigator['hardwareConcurrency'] || 0),
        jsHeapLimit: memory?.jsHeapSizeLimit || 0,
        mode,
        totalJsHeap: memory?.totalJSHeapSize || 0,
        usedJsHeap: memory?.usedJSHeapSize || 0,
        usedRatio: heapRatio
    };
}

function getTimingSummary(type: PtvDebugEventType): PtvDebugSummary {
    const values = timings
        .filter(timing => timing.type === type)
        .map(timing => timing.durationMs)
        .sort((a, b) => a - b);

    if (!values.length) {
        return {
            averageMs: 0,
            count: 0,
            maxMs: 0,
            p95Ms: 0
        };
    }

    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const p95Index = Math.min(values.length - 1, Math.floor(values.length * 0.95));

    return {
        averageMs: Number(average.toFixed(1)),
        count: values.length,
        maxMs: Number(values[values.length - 1].toFixed(1)),
        p95Ms: Number(values[p95Index].toFixed(1))
    };
}

function getEventCount(type: PtvDebugEventType, name: string) {
    return events.filter(event => event.type === type && event.name === name).length;
}

function installDebugFlagAccessor() {
    const initialValue = getInitialDebugValue();

    debugEnabled = initialValue;

    try {
        Object.defineProperty(ptvWindow, 'PTV_DEBUG', {
            configurable: true,
            get() {
                return debugEnabled;
            },
            set(value: unknown) {
                setPtvDebug(value === true);
            }
        });
    } catch {
        ptvWindow.PTV_DEBUG = initialValue;
    }
}

function setDebugStorage(enabled: boolean) {
    const storage = getStorage();
    if (!storage) return;

    try {
        if (enabled) {
            storage.setItem(PTV_DEBUG.storageKey, '1');
        } else {
            storage.removeItem(PTV_DEBUG.storageKey);
        }
    } catch {
        // Storage can be blocked on some embedded TV browsers.
    }
}

function getImageUrl(image: HTMLImageElement) {
    return image.currentSrc || image.src || image.getAttribute('src') || image.getAttribute('data-src') || '';
}

function normalizeImageTrackerUrl(url: string) {
    if (!url) return '';

    const anchor = document.createElement('a');
    anchor.href = url;

    return anchor.href || url;
}

function isStaticLogoUrl(url: string) {
    return /\/(?:web\/)?assets\/logo\/(?:banner-light|sidebar-logo)\.(?:webp|png)(?:[?#].*)?$/i.test(url);
}

function getImageSourceComponent(image: HTMLImageElement) {
    const explicitComponent = image.dataset.ptvImageComponent;

    if (explicitComponent) return explicitComponent;

    if (image.dataset.ptvLogo) return `${image.dataset.ptvLogo}-logo`;
    if (image.classList.contains('ptv-hero-logo')) return 'hero-logo';
    if (image.classList.contains('ptv-hero-bg')) return 'hero-backdrop';
    if (image.classList.contains('ptv-brand-logo')) return 'header-logo';
    if (image.classList.contains('ptv-sidebar-logo')) return 'sidebar-logo';
    if (image.classList.contains('ptv-drawer-logo')) return 'drawer-logo';

    return 'image';
}

function createImageTracker(
    image: HTMLImageElement,
    url: string,
    previousTracker?: PtvImageTracker,
    completed = false
): PtvImageTracker {
    return {
        completed,
        lastEventAt: previousTracker?.lastEventAt || 0,
        lastEventKey: previousTracker?.lastEventKey || '',
        resetCount: previousTracker?.resetCount || 0,
        sourceComponent: getImageSourceComponent(image),
        startedAt: completed ? previousTracker?.startedAt || performance.now() : performance.now(),
        url
    };
}

function trimMap(map: Map<string, number>, maxEntries = IMAGE_DEDUPE_LIMIT) {
    if (map.size <= maxEntries) return;

    const entriesToDelete = map.size - maxEntries;
    let deleted = 0;

    for (const key of map.keys()) {
        map.delete(key);
        deleted += 1;

        if (deleted >= entriesToDelete) return;
    }
}

function isResolvedImage(image: HTMLImageElement) {
    return Boolean(image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
}

function observeImage(image: HTMLImageElement) {
    const url = normalizeImageTrackerUrl(getImageUrl(image));
    if (!url) return;

    const tracker = imageTrackers.get(image);
    const trackerUrl = normalizeImageTrackerUrl(tracker?.url || '');

    if (trackerUrl === url) return;

    if (isResolvedImage(image)) {
        imageTrackers.set(image, createImageTracker(image, url, tracker, true));
        return;
    }

    imageTrackers.set(image, createImageTracker(image, url, tracker));
}

function observeImages(root: ParentNode = document) {
    root.querySelectorAll?.('img[src], img[data-src]').forEach(image => {
        if (image instanceof HTMLImageElement) {
            observeImage(image);
        }
    });
}

function getCurrentImageTracker(image: HTMLImageElement, url: string) {
    const existingTracker = imageTrackers.get(image);
    const normalizedUrl = normalizeImageTrackerUrl(url);
    const existingUrl = normalizeImageTrackerUrl(existingTracker?.url || '');

    if (!existingTracker || existingUrl === normalizedUrl) {
        return existingTracker;
    }

    const sourceComponent = getImageSourceComponent(image);
    const resetCount = existingTracker.resetCount + 1;
    const resetKey = `${sourceComponent}:${existingUrl}->${normalizedUrl}`;
    const lastResetAt = imageTrackerResetDedupe.get(resetKey);

    existingTracker.resetCount = resetCount;
    existingTracker.sourceComponent = sourceComponent;
    imageTrackerResetDedupe.set(resetKey, Date.now());
    trimMap(imageTrackerResetDedupe);

    if (!lastResetAt || Date.now() - lastResetAt >= IMAGE_TRACKER_RESET_DEDUPE_MS) {
        recordPtvEvent('image', 'image-tracker-reset', {
            nextUrl: normalizedUrl,
            previousUrl: existingUrl,
            resetCount,
            sourceComponent
        });
    }

    return undefined;
}

function getImageEventDetail(image: HTMLImageElement, url: string) {
    const originDetail = getRequestOriginDetail(url);

    return {
        ...originDetail,
        naturalHeight: image.naturalHeight,
        naturalWidth: image.naturalWidth,
        url
    };
}

function getRequestOriginDetail(url: string) {
    const pluginApi = getPtvPluginApiDiagnostics();

    return classifyPtvRequestUrl(url, {
        jellyfinRoot: pluginApi.resolvedRoot,
        pluginRoot: pluginApi.resolvedRoot
    });
}

function handleImageError(image: HTMLImageElement, tracker: PtvImageTracker | undefined, eventName: string, url: string) {
    markImageTrackerComplete(image, tracker, eventName, url);

    const failedAt = observedImageFailures.get(url);
    const suppressLoggedAt = observedImageRetrySuppressions.get(url);
    const isSuppressed = Boolean(failedAt && Date.now() - failedAt < IMAGE_ERROR_SUPPRESSION_MS);

    if (isSuppressed) {
        if (!suppressLoggedAt || Date.now() - suppressLoggedAt >= IMAGE_ERROR_SUPPRESSION_MS) {
            observedImageRetrySuppressions.set(url, Date.now());
            trimMap(observedImageRetrySuppressions);
            recordPtvEvent('image', 'image-retry-suppressed', getImageEventDetail(image, url));
        }

        return;
    }

    observedImageFailures.set(url, Date.now());
    trimMap(observedImageFailures);
    recordPtvEvent('image', 'image-failed-once', getImageEventDetail(image, url));
    warnDebug('Image failed to load.', getImageEventDetail(image, url));
}

function handleImageLoad(image: HTMLImageElement, tracker: PtvImageTracker | undefined, eventName: string, url: string) {
    const durationMs = tracker ? performance.now() - tracker.startedAt : 0;

    markImageTrackerComplete(image, tracker, eventName, url);

    if (isStaticLogoUrl(url) && durationMs > 1000) {
        recordPtvEvent('image', 'static-logo-load-suppressed', {
            ...getImageEventDetail(image, url),
            durationMs: Number(durationMs.toFixed(1))
        });
        return;
    }

    if (durationMs > IMAGE_MAX_LIFECYCLE_MS) {
        recordPtvEvent('image', 'image-duration-discarded', {
            ...getImageEventDetail(image, url),
            durationMs: Number(durationMs.toFixed(1))
        });
        return;
    }

    if (durationMs > 0) {
        recordPtvTiming('image', eventName, durationMs, getImageEventDetail(image, url));
        return;
    }

    recordPtvEvent('image', eventName, getImageEventDetail(image, url));
}

function handleImageDone(event: Event) {
    if (!(event.target instanceof HTMLImageElement)) return;

    const image = event.target;
    const url = normalizeImageTrackerUrl(getImageUrl(image) || imageTrackers.get(image)?.url || '');
    if (!url) return;

    const eventName = event.type === 'error' ? 'image-error' : 'image-load';
    const tracker = getCurrentImageTracker(image, url);

    if (shouldSuppressImageEvent(image, tracker, eventName, url)) return;

    if (event.type === 'error') {
        handleImageError(image, tracker, eventName, url);
        return;
    }

    handleImageLoad(image, tracker, eventName, url);
}

function shouldSuppressImageEvent(
    image: HTMLImageElement,
    tracker: PtvImageTracker | undefined,
    eventName: string,
    url: string
) {
    const eventAt = Date.now();
    const eventKey = `${eventName}:${url}`;
    const lastGlobalEventAt = imageEventDedupe.get(eventKey);

    if (
        tracker?.lastEventKey === eventKey
        && eventAt - tracker.lastEventAt < IMAGE_EVENT_DEDUPE_MS
    ) {
        return true;
    }

    if (lastGlobalEventAt && eventAt - lastGlobalEventAt < IMAGE_EVENT_DEDUPE_MS) {
        return true;
    }

    imageEventDedupe.set(eventKey, eventAt);
    trimMap(imageEventDedupe);
    markImageTrackerComplete(image, tracker, eventName, url);

    return false;
}

function markImageTrackerComplete(
    image: HTMLImageElement,
    tracker: PtvImageTracker | undefined,
    eventName: string,
    url: string
) {
    const nextTracker = tracker || {
        completed: false,
        lastEventAt: 0,
        lastEventKey: '',
        resetCount: 0,
        sourceComponent: getImageSourceComponent(image),
        startedAt: performance.now(),
        url
    };

    nextTracker.completed = true;
    nextTracker.lastEventAt = Date.now();
    nextTracker.lastEventKey = `${eventName}:${url}`;
    nextTracker.sourceComponent = getImageSourceComponent(image);
    nextTracker.url = url;
    imageTrackers.set(image, nextTracker);
}

function startResourceObserver() {
    const PerformanceObserverCtor = window['PerformanceObserver'];

    if (!PerformanceObserverCtor || resourceObserver) return;

    try {
        const setResourceTimingBufferSize = performance['setResourceTimingBufferSize'];

        if (typeof setResourceTimingBufferSize === 'function') {
            setResourceTimingBufferSize.call(performance, PTV_DEBUG.resourceTimingBufferSize);
        }

        resourceObserver = new PerformanceObserverCtor(list => {
            list.getEntries().forEach(entry => {
                if ((entry as PerformanceResourceTiming).initiatorType !== 'img') return;

                if (shouldSuppressResourceEntry(entry as PerformanceResourceTiming)) return;

                recordPtvTiming('image', 'image-resource', entry.duration || 0, {
                    ...getRequestOriginDetail(entry.name),
                    transferSize: (entry as PerformanceResourceTiming).transferSize || 0,
                    url: entry.name
                });
            });
        });
        resourceObserver.observe({
            buffered: true,
            type: 'resource'
        });
    } catch {
        resourceObserver = null;
    }
}

function shouldSuppressResourceEntry(entry: PerformanceResourceTiming) {
    if (isStaticLogoUrl(entry.name)) {
        const staticLogoKey = `static-logo:${entry.name}`;
        const lastStaticLogoAt = observedResourceEntries.get(staticLogoKey);

        if (lastStaticLogoAt && Date.now() - lastStaticLogoAt < STATIC_LOGO_EVENT_SUPPRESSION_MS) {
            return true;
        }

        observedResourceEntries.set(staticLogoKey, Date.now());
    }

    const entryKey = [
        entry.name,
        Math.round(entry.startTime || 0),
        Math.round(entry.duration || 0),
        entry.transferSize || 0
    ].join(':');

    if (observedResourceEntries.has(entryKey)) return true;

    observedResourceEntries.set(entryKey, Date.now());
    trimMap(observedResourceEntries);

    return false;
}

function stopResourceObserver() {
    resourceObserver?.disconnect();
    resourceObserver = null;
}

function startDebugObservers() {
    if (debugScope) return;
    if (!document.body) {
        window.addEventListener('DOMContentLoaded', startDebugObservers, { once: true });
        return;
    }

    debugScope = resetRuntimeScope('debug-observability');
    ptvWindow.__PTV_IMAGE_TRACKER__ = true;
    debugScope.listen(document, 'load', handleImageDone, true);
    debugScope.listen(document, 'error', handleImageDone, true);
    const observer = new MutationObserver((mutations: MutationRecord[]) => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node instanceof HTMLImageElement) {
                    observeImage(node);
                } else if (node instanceof HTMLElement) {
                    observeImages(node);
                }
            });

            if (mutation.target instanceof HTMLImageElement) {
                observeImage(mutation.target);
            }
        });
    });

    observer.observe(document.body, {
        attributeFilter: ['src', 'data-src', 'srcset'],
        attributes: true,
        childList: true,
        subtree: true
    });
    debugScope.add(() => observer.disconnect(), {
        label: 'debug image observer',
        type: 'observer'
    });
    debugConsole('image observer created');
    debugScope.interval(() => {
        recordPtvEvent('memory', 'sample', getMemorySnapshot());
    }, 5000);
    observeImages();
    startResourceObserver();
}

function stopDebugObservers() {
    debugScope?.dispose();
    debugScope = null;
    ptvWindow.__PTV_IMAGE_TRACKER__ = false;
    debugConsole('image tracker disposed');
    stopResourceObserver();
}

export function isPtvDebugEnabled() {
    return debugEnabled;
}

export function setPtvDebug(enabled: boolean) {
    if (debugEnabled === enabled) return debugEnabled;

    debugEnabled = enabled;
    setDebugStorage(enabled);
    document.documentElement.classList.toggle('ptv-debug-mode', enabled);

    if (enabled) {
        startDebugObservers();
        recordPtvStartupEvent();
        recordPtvEvent('profile', 'debug-enabled', getPtvClientProfile());
    } else {
        stopDebugObservers();
    }

    dispatchDebugEvent(PTV_EVENTS.debugChange, {
        enabled
    });
    debugConsole(enabled ? 'enabled' : 'disabled');

    return debugEnabled;
}

export function recordPtvEvent(type: PtvDebugEventType, name: string, detail?: unknown) {
    if (!debugEnabled && !ALWAYS_ON_DEBUG_TYPES.has(type)) return;

    events.push({
        at: Date.now(),
        detail,
        name,
        type
    });
    trimBuffer(events, PTV_DEBUG.maxEvents);
}

export function recordPtvTiming(
    type: PtvDebugEventType,
    name: string,
    durationMs: number,
    detail?: unknown
) {
    if (!debugEnabled && !ALWAYS_ON_DEBUG_TYPES.has(type)) return;

    if (type === 'image' && durationMs > IMAGE_MAX_LIFECYCLE_MS) {
        recordPtvEvent('image', 'image-duration-discarded', {
            detail,
            durationMs: Number(durationMs.toFixed(1)),
            name
        });
        return;
    }

    const roundedDuration = Number(durationMs.toFixed(1));

    timings.push({
        at: Date.now(),
        detail,
        durationMs: roundedDuration,
        name,
        type
    });
    trimBuffer(timings, PTV_DEBUG.maxTimings);

    if (roundedDuration > 500) {
        debugConsole(`${type}:${name} ${roundedDuration}ms`, detail);
    }
}

export function timePtvAsync<T>(
    type: PtvDebugEventType,
    name: string,
    task: () => Promise<T>,
    detail?: unknown
): Promise<T> {
    const startedAt = performance.now();

    return Promise.resolve()
        .then(task)
        .then(result => {
            recordPtvTiming(type, name, performance.now() - startedAt, detail);

            return result;
        })
        .catch((err: unknown) => {
            recordPtvTiming(type, `${name}:error`, performance.now() - startedAt, {
                detail,
                error: err instanceof Error ? err.message : String(err)
            });
            throw err;
        });
}

export function registerPtvDebugCacheStatusProvider(provider: () => unknown) {
    debugCacheStatusProvider = provider;
}

export function registerPtvDebugShellStatusProvider(provider: (() => unknown) | null) {
    debugShellStatusProvider = provider;
}

export function registerPtvDebugSignupStatusProvider(provider: (() => unknown) | null) {
    debugSignupStatusProvider = provider;
}

export function getPtvDebugReport() {
    const {
        clientProfile,
        performanceProfile
    } = getActiveProfiles();
    const renderProfile = performanceProfile.renderProfile || {
        id: document.documentElement.dataset.ptvRenderProfile || 'unknown',
        tier: document.documentElement.dataset.ptvRenderTier || 'unknown'
    };

    return {
        active: debugEnabled,
        cache: {
            errors: getEventCount('cache', 'error'),
            hits: getEventCount('cache', 'hit'),
            misses: getEventCount('cache', 'miss'),
            status: debugCacheStatusProvider?.() || null,
            staleHits: getEventCount('cache', 'stale-hit'),
            timings: getTimingSummary('cache')
        },
        clientProfile: {
            isFireTv: clientProfile.isFireTv,
            isLowPower: clientProfile.isLowPower,
            isMobile: clientProfile.isMobile,
            isTv: clientProfile.isTv,
            isWebOs: clientProfile.isWebOs,
            kind: clientProfile.kind,
            supportsBackdropFilter: clientProfile.supportsBackdropFilter
        },
        events: [...events],
        images: {
            errors: getEventCount('image', 'image-error') + getEventCount('image', 'image-failed-once'),
            resetCount: getEventCount('image', 'image-tracker-reset'),
            timings: getTimingSummary('image')
        },
        memory: getMemorySnapshot(),
        origins: PTV_RUNTIME,
        pluginApi: getPtvPluginApiDiagnostics(),
        recommendations: getTimingSummary('recommendation'),
        render: getTimingSummary('render'),
        renderProfile,
        rowFetch: getTimingSummary('row-fetch'),
        shell: debugShellStatusProvider?.() || null,
        signup: debugSignupStatusProvider?.() || null,
        timings: [...timings],
        timestamp: now()
    };
}

export function clearPtvDebugReport() {
    timings.splice(0, timings.length);
    events.splice(0, events.length);
}

function installDebugApi() {
    const ptv = getPtvGlobal();

    ptv.debug = {
        clear: clearPtvDebugReport,
        disable: () => setPtvDebug(false),
        enable: () => setPtvDebug(true),
        event: recordPtvEvent,
        report: getPtvDebugReport,
        time: timePtvAsync,
        timing: recordPtvTiming
    };
}

export function initPtvObservability() {
    if (ptvWindow.__PTV_OBSERVABILITY_INSTALLED__ === true) return;

    ptvWindow.__PTV_OBSERVABILITY_INSTALLED__ = true;
    installDebugFlagAccessor();
    installDebugApi();
    document.documentElement.classList.toggle('ptv-debug-mode', debugEnabled);

    if (debugEnabled) {
        startDebugObservers();
        recordPtvStartupEvent();
        recordPtvEvent('profile', 'debug-enabled', getPtvClientProfile());
    }
}

initPtvObservability();
