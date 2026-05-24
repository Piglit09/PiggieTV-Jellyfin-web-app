import { PTV_DEBUG, PTV_EVENTS } from './config';
import {
    applyPtvClientProfileClasses,
    getPtvClientProfile,
    getPtvPerformanceProfile,
    type PtvClientProfile,
    type PtvPerformanceProfile
} from './clientProfile';
import { dispatchPtvCustomEvent } from './events';
import { resetRuntimeScope } from './scope';

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

type PtvWindow = Window & Partial<Record<'PTV_DEBUG' | '__PTV_OBSERVABILITY_INSTALLED__', boolean>> & {
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
const imageStartTimes = new WeakMap<HTMLImageElement, number>();
const imageUrls = new WeakMap<HTMLImageElement, string>();

let debugEnabled = false;
let debugScope: ReturnType<typeof resetRuntimeScope> | null = null;
let debugCacheStatusProvider: (() => unknown) | null = null;
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
    return image.currentSrc || image.src || image.getAttribute('data-src') || '';
}

function observeImage(image: HTMLImageElement) {
    const url = getImageUrl(image);
    if (!url) return;

    if (imageUrls.get(image) === url) return;

    imageUrls.set(image, url);
    imageStartTimes.set(image, performance.now());
}

function observeImages(root: ParentNode = document) {
    root.querySelectorAll?.('img[src], img[data-src]').forEach(image => {
        if (image instanceof HTMLImageElement) {
            observeImage(image);
        }
    });
}

function handleImageDone(event: Event) {
    if (!(event.target instanceof HTMLImageElement)) return;

    const image = event.target;
    const startedAt = imageStartTimes.get(image);
    const url = getImageUrl(image);
    const durationMs = startedAt ? performance.now() - startedAt : 0;

    if (durationMs > 0) {
        recordPtvTiming('image', event.type === 'error' ? 'image-error' : 'image-load', durationMs, {
            naturalHeight: image.naturalHeight,
            naturalWidth: image.naturalWidth,
            url
        });
    } else {
        recordPtvEvent('image', event.type === 'error' ? 'image-error' : 'image-load', {
            naturalHeight: image.naturalHeight,
            naturalWidth: image.naturalWidth,
            url
        });
    }
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

                recordPtvTiming('image', 'image-resource', entry.duration || 0, {
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
    debugScope.interval(() => {
        recordPtvEvent('memory', 'sample', getMemorySnapshot());
    }, 5000);
    observeImages();
    startResourceObserver();
}

function stopDebugObservers() {
    debugScope?.dispose();
    debugScope = null;
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
    if (!debugEnabled) return;

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
    if (!debugEnabled) return;

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
    if (!debugEnabled) return task();

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
            errors: getEventCount('image', 'image-error'),
            timings: getTimingSummary('image')
        },
        memory: getMemorySnapshot(),
        recommendations: getTimingSummary('recommendation'),
        render: getTimingSummary('render'),
        renderProfile,
        rowFetch: getTimingSummary('row-fetch'),
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
