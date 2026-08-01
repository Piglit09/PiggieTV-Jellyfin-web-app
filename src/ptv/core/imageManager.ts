import { getPtvPerformanceProfile } from './clientProfile';
import { recordPtvEvent } from './observability';

export type PtvImagePriority =
    | 'below-fold-poster'
    | 'decorative'
    | 'hero-current'
    | 'hero-next'
    | 'visible-poster';

type PtvImageQueueKind = 'background' | 'decorative' | 'hero' | 'poster';

type PtvImageTask = {
    cancelled: boolean;
    consumers: Map<symbol, PtvImageTaskConsumer>;
    image: HTMLImageElement | null;
    kind: PtvImageQueueKind;
    priority: PtvImagePriority;
    priorityScore: number;
    promise: Promise<boolean>;
    reject: (reason?: unknown) => void;
    resolve: (value: boolean) => void;
    scope: string;
    settled: boolean;
    started: boolean;
    url: string;
};

type PtvImageTaskConsumer = {
    cancel: () => void;
    scope: string;
};

export type PtvImageLoadHandle = {
    cancel: () => void;
    promise: Promise<boolean>;
    url: string;
};

type PtvPreloadEntry = {
    handle: PtvImageLoadHandle;
    link: HTMLLinkElement | null;
};

type PtvLazyImageOptions = {
    loadElement?: (element: Element) => void;
    priority?: PtvImagePriority;
    rootMargin?: string;
    selector?: string;
};

type PtvImageManagerMetrics = {
    activeByKind: Record<PtvImageQueueKind, number>;
    activeRequests: number;
    cacheHits: number;
    cacheMisses: number;
    dedupeHits: number;
    failedImageSuppressions: number;
    failedLoads: number;
    preloadCancellations: number;
    preloadSuccesses: number;
    queuedByKind: Record<PtvImageQueueKind, number>;
    queuedRequests: number;
    successfulLoads: number;
};

const FAILED_IMAGE_SUPPRESSION_MS = 5 * 60 * 1000;
const LOADED_URL_CACHE_LIMIT = 800;
const FAILED_URL_CACHE_LIMIT = 240;
const DEFAULT_LAZY_SELECTOR = [
    'img[src]',
    'img[data-src]',
    '.cardImageContainer.lazy[data-src]',
    '.cardFooterLogo.lazy[data-src]'
].join(',');
const PRIORITY_CONFIG: Record<PtvImagePriority, {
    kind: PtvImageQueueKind;
    score: number;
}> = {
    'hero-current': {
        kind: 'hero',
        score: 0
    },
    'hero-next': {
        kind: 'hero',
        score: 1
    },
    'visible-poster': {
        kind: 'poster',
        score: 2
    },
    'below-fold-poster': {
        kind: 'poster',
        score: 3
    },
    decorative: {
        kind: 'decorative',
        score: 4
    }
};
const DEFAULT_LIMITS: Record<PtvImageQueueKind, number> = {
    background: 2,
    decorative: 2,
    hero: 2,
    poster: 4
};
const LOW_POWER_LIMITS: Record<PtvImageQueueKind, number> = {
    background: 1,
    decorative: 1,
    hero: 1,
    poster: 3
};

const activeByKind: Record<PtvImageQueueKind, number> = {
    background: 0,
    decorative: 0,
    hero: 0,
    poster: 0
};
const queues: Record<PtvImageQueueKind, PtvImageTask[]> = {
    background: [],
    decorative: [],
    hero: [],
    poster: []
};
const loadedUrls = new Set<string>();
const failedUrls = new Map<string, number>();
const inflightByUrl = new Map<string, PtvImageTask>();
const scopedPreloads = new Map<string, Map<string, PtvPreloadEntry>>();
const lazyImageObservers = new WeakMap<Element, IntersectionObserver>();
const lazyImageHandles = new WeakMap<Element, PtvImageLoadHandle>();
const metrics: PtvImageManagerMetrics = {
    activeByKind: {
        background: 0,
        decorative: 0,
        hero: 0,
        poster: 0
    },
    activeRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    dedupeHits: 0,
    failedImageSuppressions: 0,
    failedLoads: 0,
    preloadCancellations: 0,
    preloadSuccesses: 0,
    queuedByKind: {
        background: 0,
        decorative: 0,
        hero: 0,
        poster: 0
    },
    queuedRequests: 0,
    successfulLoads: 0
};

function normalizeUrl(url: string) {
    return String(url || '').trim();
}

function isDebugEnabled() {
    return (window as Window & Partial<Record<'PTV_DEBUG', boolean>>).PTV_DEBUG === true;
}

function debugLog(message: string, detail?: unknown) {
    if (!isDebugEnabled()) return;

    console.debug(`[PiggieTV ImageManager] ${message}`, detail);
}

function getLimits() {
    const profile = getPtvPerformanceProfile();

    return profile.isLowPower || profile.isWebOs ? LOW_POWER_LIMITS : DEFAULT_LIMITS;
}

function isRecentlyFailed(url: string) {
    const failedAt = failedUrls.get(url);

    return Boolean(failedAt && Date.now() - failedAt < FAILED_IMAGE_SUPPRESSION_MS);
}

function trimSet<T>(set: Set<T>, maxEntries: number) {
    if (set.size <= maxEntries) return;

    const entriesToDelete = set.size - maxEntries;
    let deleted = 0;

    for (const key of set.keys()) {
        set.delete(key);
        deleted += 1;

        if (deleted >= entriesToDelete) return;
    }
}

function trimMap<TValue>(map: Map<string, TValue>, maxEntries: number) {
    if (map.size <= maxEntries) return;

    const entriesToDelete = map.size - maxEntries;
    let deleted = 0;

    for (const key of map.keys()) {
        map.delete(key);
        deleted += 1;

        if (deleted >= entriesToDelete) return;
    }
}

function pruneImageCaches() {
    trimSet(loadedUrls, LOADED_URL_CACHE_LIMIT);
    trimMap(failedUrls, FAILED_URL_CACHE_LIMIT);
}

function imageScopeMatches(candidate: string, scope: string) {
    return candidate === scope
        || candidate === `preload:${scope}`
        || candidate.startsWith(`${scope}:`)
        || candidate.startsWith(`preload:${scope}:`);
}

function settleTask(task: PtvImageTask, success: boolean) {
    if (task.settled) return;

    task.settled = true;
    task.image = null;
    inflightByUrl.delete(task.url);

    if (task.started) {
        activeByKind[task.kind] = Math.max(0, activeByKind[task.kind] - 1);
    }

    if (success) {
        loadedUrls.add(task.url);
        metrics.successfulLoads += 1;

        if (task.scope.startsWith('preload:')) {
            metrics.preloadSuccesses += 1;
        }
    } else if (!task.cancelled) {
        failedUrls.set(task.url, Date.now());
        metrics.failedLoads += 1;
    }

    task.resolve(success);
    pruneImageCaches();
    updateMetrics();
    processQueue(task.kind);
}

function cancelTask(task: PtvImageTask) {
    if (task.settled) return;

    task.cancelled = true;

    if (!task.started) {
        removeQueuedTask(task);
    } else if (task.image) {
        task.image.onload = null;
        task.image.onerror = null;
        task.image.src = '';
    }

    if (task.scope.startsWith('preload:')) {
        metrics.preloadCancellations += 1;
        recordPtvEvent('image', 'preload-cancellation', {
            priority: task.priority,
            url: task.url
        });
    }

    settleTask(task, false);
}

function removeQueuedTask(task: PtvImageTask) {
    const queue = queues[task.kind];
    const taskIndex = queue.indexOf(task);

    if (taskIndex !== -1) {
        queue.splice(taskIndex, 1);
    }
}

function startTask(task: PtvImageTask) {
    if (task.cancelled || task.settled) {
        settleTask(task, false);
        return;
    }

    task.started = true;
    activeByKind[task.kind] += 1;

    const image = new Image();
    task.image = image;
    image.decoding = 'async';
    image.loading = task.priority === 'hero-current' ? 'eager' : 'lazy';
    image.onload = () => {
        if (image.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
            recordPtvEvent('image', 'preload-success', {
                priority: task.priority,
                url: task.url
            });
            settleTask(task, true);
            return;
        }

        settleTask(task, false);
    };
    image.onerror = () => {
        recordPtvEvent('image', 'preload-failed', {
            priority: task.priority,
            url: task.url
        });
        settleTask(task, false);
    };
    image.src = task.url;
    updateMetrics();
}

function processQueue(kind: PtvImageQueueKind) {
    const limits = getLimits();
    const queue = queues[kind];

    queue.sort((a, b) => a.priorityScore - b.priorityScore);

    while (activeByKind[kind] < limits[kind] && queue.length) {
        const task = queue.shift();

        if (task) {
            startTask(task);
        }
    }

    updateMetrics();
}

function updateMetrics() {
    const queuedByKind = Object.fromEntries(
        Object.entries(queues).map(([kind, queue]) => [kind, queue.length])
    ) as Record<PtvImageQueueKind, number>;

    metrics.activeByKind = { ...activeByKind };
    metrics.queuedByKind = queuedByKind;
    metrics.activeRequests = Object.values(activeByKind).reduce((sum, count) => sum + count, 0);
    metrics.queuedRequests = Object.values(queuedByKind).reduce((sum, count) => sum + count, 0);
}

function attachTaskConsumer(
    task: PtvImageTask,
    scope: string
): PtvImageLoadHandle {
    const token = Symbol(scope);
    let consumerSettled = false;
    let settleConsumer: (value: boolean) => void = value => Boolean(value);
    const promise = new Promise<boolean>(resolve => {
        settleConsumer = resolve;
    });
    const detach = () => {
        task.consumers.delete(token);
    };
    const cancel = () => {
        if (consumerSettled) return;

        consumerSettled = true;
        detach();
        settleConsumer(false);

        if (!task.settled && task.consumers.size === 0) {
            cancelTask(task);
        }
    };

    task.consumers.set(token, {
        cancel,
        scope
    });
    task.promise.then(result => {
        if (consumerSettled) return;

        consumerSettled = true;
        detach();
        settleConsumer(result);
    }).catch(() => {
        if (consumerSettled) return;

        consumerSettled = true;
        detach();
        settleConsumer(false);
    });

    return {
        cancel,
        promise,
        url: task.url
    };
}

function queueTask(
    url: string,
    priority: PtvImagePriority,
    scope: string
): PtvImageLoadHandle {
    const normalizedUrl = normalizeUrl(url);

    if (!normalizedUrl) {
        return {
            cancel: () => undefined,
            promise: Promise.resolve(false),
            url: normalizedUrl
        };
    }

    if (loadedUrls.has(normalizedUrl)) {
        metrics.cacheHits += 1;

        return {
            cancel: () => undefined,
            promise: Promise.resolve(true),
            url: normalizedUrl
        };
    }

    if (isRecentlyFailed(normalizedUrl)) {
        metrics.failedImageSuppressions += 1;
        recordPtvEvent('image', 'failed-image-suppression', { url: normalizedUrl });

        return {
            cancel: () => undefined,
            promise: Promise.resolve(false),
            url: normalizedUrl
        };
    }

    const existingTask = inflightByUrl.get(normalizedUrl);

    if (existingTask && !existingTask.cancelled && !existingTask.settled) {
        metrics.dedupeHits += 1;

        return attachTaskConsumer(existingTask, scope);
    }

    metrics.cacheMisses += 1;

    const config = PRIORITY_CONFIG[priority];
    let taskPromiseResolve: (value: boolean) => void = () => undefined;
    let taskPromiseReject: (reason?: unknown) => void = () => undefined;
    const promise = new Promise<boolean>((resolve, reject) => {
        taskPromiseResolve = resolve;
        taskPromiseReject = reject;
    });
    const task: PtvImageTask = {
        cancelled: false,
        consumers: new Map<symbol, PtvImageTaskConsumer>(),
        image: null,
        kind: config.kind,
        promise,
        priority,
        priorityScore: config.score,
        reject: taskPromiseReject,
        resolve: taskPromiseResolve,
        scope,
        settled: false,
        started: false,
        url: normalizedUrl
    };

    inflightByUrl.set(normalizedUrl, task);
    queues[task.kind].push(task);
    const handle = attachTaskConsumer(task, scope);

    debugLog('queued image', {
        priority,
        scope,
        url: normalizedUrl
    });
    processQueue(task.kind);

    return handle;
}

function getElementImageUrl(element: Element) {
    if (element instanceof HTMLImageElement) {
        return element.currentSrc || element.src || element.getAttribute('data-src') || '';
    }

    return element.getAttribute('data-src')
        || element.getAttribute('data-original')
        || element.getAttribute('data-lazy-src')
        || '';
}

function markLazyAttributes(element: Element) {
    if (!(element instanceof HTMLImageElement)) return;

    element.loading = element.loading || 'lazy';
    element.decoding = 'async';
}

export function loadPtvImage(
    url: string,
    priority: PtvImagePriority = 'below-fold-poster',
    scope = 'image'
) {
    return queueTask(url, priority, scope);
}

export function preloadPtvImage(
    url: string,
    priority: PtvImagePriority = 'decorative',
    scope = 'manual'
) {
    return queueTask(url, priority, `preload:${scope}`);
}

export function syncPtvManagedPreloads(
    scope: string,
    urls: Array<string | undefined>,
    priorities: PtvImagePriority[] = ['hero-current', 'hero-next']
) {
    const profile = getPtvPerformanceProfile();
    const maxPreloads = profile.isLowPower || profile.isWebOs ? 1 : 2;
    const activeUrls = new Set(
        urls
            .filter(Boolean)
            .slice(0, maxPreloads)
            .map(url => normalizeUrl(String(url)))
    );
    const scopedEntries = scopedPreloads.get(scope) || new Map<string, PtvPreloadEntry>();

    scopedEntries.forEach((entry, url) => {
        if (activeUrls.has(url)) return;

        entry.handle.cancel();
        entry.link?.remove();
        scopedEntries.delete(url);
    });

    Array.from(activeUrls).forEach((url, index) => {
        if (scopedEntries.has(url)) return;

        const priority = priorities[index] || 'decorative';

        scopedEntries.set(url, {
            handle: preloadPtvImage(url, priority, scope),
            link: null
        });
    });

    scopedPreloads.set(scope, scopedEntries);

    return () => cancelPtvImageScope(scope);
}

export function cancelPtvImageScope(scope: string) {
    const scopedEntries = scopedPreloads.get(scope);

    scopedEntries?.forEach(entry => {
        entry.handle.cancel();
        entry.link?.remove();
    });
    scopedPreloads.delete(scope);

    Array.from(inflightByUrl.values()).forEach(task => {
        for (const consumer of [...task.consumers.values()]) {
            if (imageScopeMatches(consumer.scope, scope)) {
                consumer.cancel();
            }
        }
    });
}

export function enhancePtvLazyImageAttributes(root: ParentNode = document) {
    root.querySelectorAll?.('img').forEach(markLazyAttributes);
}

export function observePtvLazyImages(
    root: ParentNode = document,
    options: PtvLazyImageOptions = {}
) {
    const selector = options.selector || DEFAULT_LAZY_SELECTOR;
    const priority = options.priority || 'below-fold-poster';
    const rootMargin = options.rootMargin || '420px 0px';
    const loadElement = options.loadElement;
    const targets = Array.from(root.querySelectorAll?.(selector) || []);

    enhancePtvLazyImageAttributes(root);

    if (typeof IntersectionObserver !== 'function') {
        targets.forEach(element => {
            const url = getElementImageUrl(element);

            if (!url) {
                loadElement?.(element);
                return;
            }

            const handle = loadPtvImage(url, priority, 'viewport-fallback');

            lazyImageHandles.set(element, handle);
            void handle.promise
                .finally(() => {
                    lazyImageHandles.delete(element);
                    loadElement?.(element);
                });
        });

        return () => {
            targets.forEach(element => {
                lazyImageHandles.get(element)?.cancel();
                lazyImageHandles.delete(element);
            });
        };
    }

    const createdObservers: IntersectionObserver[] = [];

    targets.forEach(element => {
        if (!(element instanceof Element)) return;
        if (lazyImageObservers.has(element)) return;

        const observer = new IntersectionObserver((entries) => {
            if (!entries.some(entry => entry.isIntersecting)) return;

            observer.disconnect();
            lazyImageObservers.delete(element);

            const url = getElementImageUrl(element);

            if (!url) {
                loadElement?.(element);
                return;
            }

            const handle = loadPtvImage(url, priority, 'viewport');

            lazyImageHandles.set(element, handle);
            void handle.promise
                .finally(() => {
                    lazyImageHandles.delete(element);
                    loadElement?.(element);
                });
        }, {
            rootMargin
        });

        lazyImageObservers.set(element, observer);
        observer.observe(element);
        createdObservers.push(observer);
    });

    return () => {
        createdObservers.forEach(observer => {
            observer.disconnect();
        });
        targets.forEach(element => {
            lazyImageHandles.get(element)?.cancel();
            lazyImageHandles.delete(element);
            lazyImageObservers.delete(element);
        });
    };
}

export function cleanupPtvLazyImages(root: ParentNode = document) {
    root.querySelectorAll?.(DEFAULT_LAZY_SELECTOR).forEach(element => {
        const observer = lazyImageObservers.get(element);

        observer?.disconnect();
        lazyImageObservers.delete(element);
        lazyImageHandles.get(element)?.cancel();
        lazyImageHandles.delete(element);
    });
}

export function trimPtvImageManagerMemory() {
    pruneImageCaches();
    updateMetrics();
}

export function clearPtvImageManagerMemory(options: { includeLoaded?: boolean } = {}) {
    if (options.includeLoaded) {
        loadedUrls.clear();
    }

    failedUrls.clear();
    updateMetrics();
}

export function disposePtvImageManager() {
    Array.from(scopedPreloads.keys()).forEach(cancelPtvImageScope);
    Object.values(queues).forEach(queue => {
        [...queue].forEach(cancelTask);
        queue.splice(0, queue.length);
    });
    Array.from(inflightByUrl.values()).forEach(cancelTask);
    scopedPreloads.clear();
    updateMetrics();
}

export function getPtvImageManagerMetrics(): PtvImageManagerMetrics {
    updateMetrics();

    return {
        ...metrics,
        activeByKind: { ...metrics.activeByKind },
        queuedByKind: { ...metrics.queuedByKind }
    };
}

function installImageManagerApi() {
    const ptvWindow = window as Window & {
        PTV?: Record<string, unknown>;
    };
    const ptv = ptvWindow.PTV || (ptvWindow.PTV = {});

    ptv.imageManager = {
        cancelScope: cancelPtvImageScope,
        clearMemory: clearPtvImageManagerMemory,
        dispose: disposePtvImageManager,
        load: loadPtvImage,
        observeLazyImages: observePtvLazyImages,
        preload: preloadPtvImage,
        report: getPtvImageManagerMetrics,
        syncPreloads: syncPtvManagedPreloads
    };
}

installImageManagerApi();
