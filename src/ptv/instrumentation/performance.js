import { getModuleDiagnostics } from '../core/lifecycle';
import { getPtvImageManagerMetrics } from '../core/imageManager';
import { getPtvDebugReport, shouldCollectDiagnostics } from '../core/observability';
import { getRuntimeDiagnostics, resetRuntimeScope } from '../core/scope';

const LOW_FX_CLASS = 'ptv-lowfx';
const PERFORMANCE_OVERLAY_CLASS = 'ptv-performance-overlay-active';
const PERFORMANCE_OVERLAY_ID = 'ptv-performance-overlay';
const PTV_DOM_SAMPLE_LIMIT = 360;
const PTV_PERF_STORAGE_KEY = 'ptv:performance-monitor';
const PTV_PERF_OVERLAY_STORAGE_KEY = 'ptv:performance-overlay';
const PTV_PERF_OVERLAY_UPDATE_MS = 1000;
const PTV_PERF_SAMPLE_LIMIT = 90;
const PTV_FRAME_BUDGET_MS = 16.7;
const PTV_DROPPED_FRAME_MS = 50;
const PTV_REPAINT_HEAVY_LIMIT = 6;

const PERFORMANCE_DOM_SELECTOR = [
    '.ptv-panel',
    '.ptv-glass-card',
    '.ptv-table-shell',
    '.ptv-skinHeader',
    '.skinHeader',
    '.ptv-sidebar',
    '.mainDrawer',
    '.ptv-card',
    '.card',
    '.cardBox',
    '.ptv-hero',
    '.ptv-hero-bg',
    '.dashboardDocument .MuiPaper-root',
    '.dashboardDocument .MuiCard-root',
    '.dashboardDocument .paperList',
    '.dashboardDocument .dashboardSection',
    '.backdropContainer',
    '.backgroundContainer',
    '[class*="backdrop"]',
    '[class*="glass"]',
    '[style*="backdrop-filter"]',
    '[style*="filter"]',
    '[style*="transform"]'
].join(',');

let performanceFrame = 0;
let performanceFpsLastTick = 0;
let performanceLastFrameAt = 0;
let performanceFrameCount = 0;
let performanceObserverCleanup = [];
let performanceOverlayRoot = null;
let performanceOverlayStartedMonitor = false;
let performanceOverlayTimer = 0;
const performanceScope = resetRuntimeScope('performance-instrumentation');

const performanceMetrics = {
    active: false,
    averageFrameMs: 0,
    currentFps: 0,
    currentFrameMs: 0,
    averageFps: 0,
    minFps: 0,
    maxFps: 0,
    maxFrameMs: 0,
    droppedFrameCount: 0,
    frameBudgetOverrunCount: 0,
    frameMsSamples: [],
    longTaskCount: 0,
    longTaskTime: 0,
    layoutShiftScore: 0,
    samples: [],
    startedAt: 0
};

function shouldPreferLowEffects() {
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    const lowMemory = Number(navigator['deviceMemory'] || 8) <= 4;
    const lowCpu = Number(navigator['hardwareConcurrency'] || 8) <= 4;
    const smallViewport = Math.min(window.innerWidth || 0, window.innerHeight || 0) < 720;

    return Boolean(reducedMotion || lowMemory || lowCpu || smallViewport);
}

export function applyPerformanceMode() {
    document.documentElement.classList.toggle(LOW_FX_CLASS, shouldPreferLowEffects());
}

function resetPerformanceMetrics() {
    performanceMetrics.averageFrameMs = 0;
    performanceMetrics.currentFps = 0;
    performanceMetrics.currentFrameMs = 0;
    performanceMetrics.averageFps = 0;
    performanceMetrics.minFps = 0;
    performanceMetrics.maxFps = 0;
    performanceMetrics.maxFrameMs = 0;
    performanceMetrics.droppedFrameCount = 0;
    performanceMetrics.frameBudgetOverrunCount = 0;
    performanceMetrics.frameMsSamples = [];
    performanceMetrics.longTaskCount = 0;
    performanceMetrics.longTaskTime = 0;
    performanceMetrics.layoutShiftScore = 0;
    performanceMetrics.samples = [];
    performanceMetrics.startedAt = performance.now();
    performanceFpsLastTick = 0;
    performanceLastFrameAt = 0;
    performanceFrameCount = 0;
}

function addFpsSample(fps) {
    const roundedFps = Math.round(fps);

    performanceMetrics.currentFps = roundedFps;
    performanceMetrics.samples.push(roundedFps);

    if (performanceMetrics.samples.length > PTV_PERF_SAMPLE_LIMIT) {
        performanceMetrics.samples.shift();
    }

    performanceMetrics.minFps = Math.min(...performanceMetrics.samples);
    performanceMetrics.maxFps = Math.max(...performanceMetrics.samples);
    performanceMetrics.averageFps = Math.round(
        performanceMetrics.samples.reduce((sum, sample) => sum + sample, 0) / performanceMetrics.samples.length
    );
}

function addFrameMsSample(frameMs) {
    const roundedFrameMs = Number(frameMs.toFixed(1));

    performanceMetrics.currentFrameMs = roundedFrameMs;
    performanceMetrics.frameMsSamples.push(roundedFrameMs);

    if (performanceMetrics.frameMsSamples.length > PTV_PERF_SAMPLE_LIMIT) {
        performanceMetrics.frameMsSamples.shift();
    }

    performanceMetrics.maxFrameMs = Math.max(...performanceMetrics.frameMsSamples);
    performanceMetrics.averageFrameMs = Number((
        performanceMetrics.frameMsSamples.reduce((sum, sample) => sum + sample, 0) / performanceMetrics.frameMsSamples.length
    ).toFixed(1));

    if (frameMs > PTV_FRAME_BUDGET_MS) {
        performanceMetrics.frameBudgetOverrunCount += 1;
    }

    if (frameMs >= PTV_DROPPED_FRAME_MS) {
        performanceMetrics.droppedFrameCount += 1;
    }
}

function measureFrame(now) {
    if (!performanceMetrics.active) return;

    if (performanceLastFrameAt) {
        addFrameMsSample(now - performanceLastFrameAt);
    }

    performanceLastFrameAt = now;

    if (!performanceFpsLastTick) {
        performanceFpsLastTick = now;
    }

    performanceFrameCount += 1;

    const elapsed = now - performanceFpsLastTick;

    if (elapsed >= 1000) {
        addFpsSample((performanceFrameCount * 1000) / elapsed);
        performanceFrameCount = 0;
        performanceFpsLastTick = now;
    }

    performanceFrame = window.requestAnimationFrame(measureFrame);
}

function observePerformanceEntry(type, callback) {
    const PerformanceObserverCtor = window['PerformanceObserver'];

    if (!PerformanceObserverCtor) return;

    try {
        const observer = new PerformanceObserverCtor((list) => {
            list.getEntries().forEach(callback);
        });

        observer.observe({ type, buffered: true });
        performanceObserverCleanup.push(() => observer.disconnect());
    } catch {
        // Some TV browsers expose PerformanceObserver but not every entry type.
    }
}

function startPerformanceObservers() {
    observePerformanceEntry('longtask', (entry) => {
        performanceMetrics.longTaskCount += 1;
        performanceMetrics.longTaskTime += Math.round(entry.duration || 0);
    });

    observePerformanceEntry('layout-shift', (entry) => {
        if (!entry.hadRecentInput) {
            performanceMetrics.layoutShiftScore += Number(entry.value || 0);
        }
    });
}

function stopPerformanceObservers() {
    performanceObserverCleanup.forEach((cleanup) => {
        cleanup();
    });
    performanceObserverCleanup = [];
}

function formatBytes(bytes) {
    if (!bytes) return 'n/a';

    const megabytes = bytes / 1048576;

    if (megabytes >= 1024) {
        return `${(megabytes / 1024).toFixed(1)} GB`;
    }

    return `${Math.round(megabytes)} MB`;
}

function getPerformanceMemoryLabel(memory) {
    if (!memory) return 'n/a';

    if (memory.usedJsHeap) {
        return `${formatBytes(memory.usedJsHeap)} / ${formatBytes(memory.jsHeapLimit)}`;
    }

    if (memory.deviceMemory) {
        return `${memory.deviceMemory} GB device`;
    }

    return 'n/a';
}

function hasRealStyleValue(value) {
    const normalized = String(value || '').trim();

    return Boolean(
        normalized
        && normalized !== 'auto'
        && normalized !== 'normal'
        && !/^none(,\s*none)*$/i.test(normalized)
        && normalized !== 'matrix(1, 0, 0, 1, 0, 0)'
    );
}

function hasBlurFilter(value) {
    return Boolean(value && /blur\((?!0(?:px|rem|em|%)?\))/i.test(value));
}

function getElementLabel(element) {
    const moduleName = element.getAttribute('data-ptv-module')
        || element.getAttribute('data-role')
        || element.getAttribute('aria-label');

    if (moduleName) return moduleName;

    const id = element.id ? `#${element.id}` : '';
    const className = typeof element.className === 'string' ?
        element.className
            .split(/\s+/)
            .filter((name) => /^ptv-|^Mui|card|drawer|header|backdrop|paper|dashboard/i.test(name))
            .slice(0, 3)
            .join('.') :
        '';
    const classes = className ? `.${className}` : '';

    return `${element.tagName.toLowerCase()}${id}${classes}`;
}

function addRepaintCandidate(map, element, reasons) {
    const label = getElementLabel(element);
    const score = reasons.reduce((total, reason) => {
        if (reason === 'blur') return total + 4;
        if (reason === 'filter') return total + 3;
        if (reason === 'animation') return total + 2;
        return total + 1;
    }, 0);
    const existing = map.get(label);

    if (existing) {
        existing.count += 1;
        existing.score += score;
        reasons.forEach((reason) => {
            existing.reasons.add(reason);
        });
        return;
    }

    map.set(label, {
        count: 1,
        label,
        reasons: new Set(reasons),
        score
    });
}

function getDomPerformanceCandidates() {
    const candidates = [];
    const seen = new Set();

    document.querySelectorAll(PERFORMANCE_DOM_SELECTOR).forEach((element) => {
        if (
            candidates.length >= PTV_DOM_SAMPLE_LIMIT
            || element.nodeType !== 1
            || seen.has(element)
            || element.closest(`#${PERFORMANCE_OVERLAY_ID}`)
        ) {
            return;
        }

        seen.add(element);
        candidates.push(element);
    });

    return candidates;
}

export function getPerformanceDomReport() {
    const repaintCandidates = new Map();
    let activeBlurLayers = 0;
    let fixedOrStickyLayers = 0;
    let sampledElements = 0;

    getDomPerformanceCandidates().forEach((element) => {
        const style = window.getComputedStyle(element);

        if (
            style.display === 'none'
            || style.visibility === 'hidden'
            || !element.getClientRects().length
        ) {
            return;
        }

        sampledElements += 1;

        const backdropFilter = style.backdropFilter || style.webkitBackdropFilter || '';
        const filter = style.filter || '';
        const reasons = [];

        if (hasBlurFilter(backdropFilter)) {
            activeBlurLayers += 1;
            reasons.push('blur');
        } else if (hasRealStyleValue(backdropFilter)) {
            reasons.push('backdrop-filter');
        }

        if (hasRealStyleValue(filter)) {
            reasons.push('filter');
        }

        if (hasRealStyleValue(style.animationName)) {
            reasons.push('animation');
        }

        if (hasRealStyleValue(style.transform)) {
            reasons.push('transform');
        }

        if (style.position === 'fixed' || style.position === 'sticky') {
            fixedOrStickyLayers += 1;
            reasons.push(style.position);
        }

        if (hasRealStyleValue(style.boxShadow)) {
            reasons.push('shadow');
        }

        if (hasRealStyleValue(style.willChange)) {
            reasons.push('will-change');
        }

        if (reasons.length) {
            addRepaintCandidate(repaintCandidates, element, reasons);
        }
    });

    return {
        activeBlurLayers,
        fixedOrStickyLayers,
        repaintHeavyModules: Array.from(repaintCandidates.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, PTV_REPAINT_HEAVY_LIMIT)
            .map((candidate) => ({
                count: candidate.count,
                label: candidate.label,
                reasons: Array.from(candidate.reasons)
            })),
        sampledElements
    };
}

export function startPerformanceMonitor() {
    if (performanceMetrics.active) return getPerformanceReport();

    resetPerformanceMetrics();
    performanceMetrics.active = true;
    startPerformanceObservers();
    performanceFrame = window.requestAnimationFrame(measureFrame);

    return getPerformanceReport();
}

export function stopPerformanceMonitor() {
    performanceMetrics.active = false;

    if (performanceFrame) {
        window.cancelAnimationFrame(performanceFrame);
        performanceFrame = 0;
    }

    stopPerformanceObservers();

    return getPerformanceReport();
}

export function getPerformanceReport() {
    const getEntriesByType = performance['getEntriesByType'];
    const memory = performance['memory'];
    const paintEntries = typeof getEntriesByType === 'function' ?
        getEntriesByType.call(performance, 'paint') :
        [];

    const runtime = getRuntimeDiagnostics();
    const modules = getModuleDiagnostics();
    const imageManager = getPtvImageManagerMetrics();

    return {
        ...performanceMetrics,
        debug: getPtvDebugReport(),
        frameBudgetMs: PTV_FRAME_BUDGET_MS,
        lowFx: document.documentElement.classList.contains(LOW_FX_CLASS),
        memory: memory ? {
            jsHeapLimit: memory.jsHeapSizeLimit || 0,
            totalJsHeap: memory.totalJSHeapSize || 0,
            usedJsHeap: memory.usedJSHeapSize || 0
        } : {
            deviceMemory: Number(navigator['deviceMemory'] || 0)
        },
        paints: paintEntries.map((entry) => ({
            name: entry.name,
            startTime: Math.round(entry.startTime)
        })),
        renderProfile: {
            id: document.documentElement.dataset.ptvRenderProfile || 'unknown',
            tier: document.documentElement.dataset.ptvRenderTier || 'unknown'
        },
        dom: getPerformanceDomReport(),
        imageManager,
        modules,
        runtime,
        uptime: performanceMetrics.startedAt ?
            Math.round(performance.now() - performanceMetrics.startedAt) :
            0
    };
}

export function markPerformance(name) {
    const markName = `ptv:${name}`;
    const mark = performance['mark'];

    if (typeof mark === 'function') {
        mark.call(performance, markName);
    }

    return markName;
}

function appendTextElement(parent, className, text, tagName = 'div') {
    const element = document.createElement(tagName);

    element.className = className;
    element.textContent = text;
    parent.appendChild(element);

    return element;
}

function appendMetric(parent, label, value, detail = '') {
    const metric = appendTextElement(parent, 'ptv-performance-overlay-metric', '');

    appendTextElement(metric, 'ptv-performance-overlay-label', label);
    appendTextElement(metric, 'ptv-performance-overlay-value', value);

    if (detail) {
        appendTextElement(metric, 'ptv-performance-overlay-detail', detail);
    }
}

function getLayoutThrashLabel(report) {
    return [
        `${report.frameBudgetOverrunCount} slow frames`,
        `${report.longTaskCount} long tasks`,
        `CLS ${report.layoutShiftScore.toFixed(3)}`
    ].join(' / ');
}

function renderPerformanceOverlay() {
    if (!performanceOverlayRoot) return;

    const report = getPerformanceReport();
    const dom = report.dom || {};
    const memory = getPerformanceMemoryLabel(report.memory);
    const paints = report.paints.map((entry) => `${entry.name}: ${entry.startTime} ms`).join(', ');

    performanceOverlayRoot.textContent = '';

    const header = appendTextElement(performanceOverlayRoot, 'ptv-performance-overlay-header', '');
    const status = report.lowFx ? 'Low FX' : 'Live';
    const body = document.createElement('div');

    appendTextElement(header, 'ptv-performance-overlay-title', 'PTV Performance');
    appendTextElement(header, 'ptv-performance-overlay-status', status);

    const closeButton = document.createElement('button');

    closeButton.className = 'ptv-performance-overlay-close';
    closeButton.type = 'button';
    closeButton.textContent = 'Close';
    closeButton.setAttribute('aria-label', 'Close performance overlay');
    closeButton.addEventListener('click', () => {
        togglePerformanceOverlay(false);
    });
    header.appendChild(closeButton);

    body.className = 'ptv-performance-overlay-body';
    performanceOverlayRoot.appendChild(body);

    appendMetric(
        body,
        'FPS',
        String(report.currentFps || 0),
        `avg ${report.averageFps || 0}, ${report.averageFrameMs || 0} ms/frame`
    );
    appendMetric(body, 'Dropped Frames', String(report.droppedFrameCount), `${report.maxFrameMs || 0} ms max frame`);
    appendMetric(body, 'Memory', memory, report.memory?.usedJsHeap ? 'JS heap' : 'browser estimate');
    appendMetric(
        body,
        'Render Profile',
        report.renderProfile.id,
        `${report.renderProfile.tier} / debug ${report.debug.active ? 'on' : 'off'}`
    );
    appendMetric(body, 'Layout Thrash', getLayoutThrashLabel(report), `${report.longTaskTime} ms long-task time`);
    appendMetric(body, 'Active Blur Layers', String(dom.activeBlurLayers || 0), `${dom.fixedOrStickyLayers || 0} fixed/sticky layers`);
    appendMetric(
        body,
        'Runtime Scopes',
        `${report.runtime.totals.activeScopes}/${report.runtime.totals.scopes}`,
        `${report.runtime.totals.resources} resources`
    );
    appendMetric(
        body,
        'Runtime Hooks',
        `${report.runtime.totals.listeners} listeners`,
        `${report.runtime.totals.observers} observers / ${report.runtime.totals.timers} timers / ${report.runtime.totals.fetches} fetches`
    );
    appendMetric(
        body,
        'Modules',
        `${report.modules.modules.filter(module => module.active).length} active`,
        `${report.modules.staleModules.length} stale warnings`
    );

    appendMetric(body, 'Paint', paints || 'n/a');
    appendMetric(
        body,
        'Cache',
        `${report.debug.cache.hits} hits / ${report.debug.cache.misses} misses`,
        `${report.debug.cache.staleHits} stale / ${report.debug.cache.timings.averageMs} ms avg`
    );
    appendMetric(
        body,
        'Images',
        `${report.debug.images.timings.count} samples`,
        `${report.debug.images.timings.averageMs} ms avg / ${report.debug.images.errors} errors`
    );
    appendMetric(
        body,
        'Image Queue',
        `${report.imageManager.activeRequests} active / ${report.imageManager.queuedRequests} queued`,
        `${report.imageManager.cacheHits} hits / ${report.imageManager.cacheMisses} misses`
    );
    appendMetric(
        body,
        'Rows',
        `${report.debug.rowFetch.count} fetches`,
        `${report.debug.rowFetch.averageMs} ms avg / ${report.debug.rowFetch.p95Ms} ms p95`
    );
    appendMetric(
        body,
        'Recommendations',
        `${report.debug.recommendations.count} runs`,
        `${report.debug.recommendations.averageMs} ms avg / ${report.debug.recommendations.p95Ms} ms p95`
    );

    const list = appendTextElement(performanceOverlayRoot, 'ptv-performance-overlay-list', '');

    appendTextElement(list, 'ptv-performance-overlay-list-title', 'Repaint-heavy modules');

    if (dom.repaintHeavyModules?.length) {
        dom.repaintHeavyModules.forEach((module) => {
            appendTextElement(
                list,
                'ptv-performance-overlay-list-item',
                `${module.label} (${module.count}) - ${module.reasons.join(', ')}`
            );
        });
    } else {
        appendTextElement(list, 'ptv-performance-overlay-list-item', 'No heavy candidates in current sample');
    }
}

function createPerformanceOverlay() {
    if (!document.body) return null;

    const overlay = document.createElement('section');

    overlay.id = PERFORMANCE_OVERLAY_ID;
    overlay.className = 'ptv-performance-overlay';
    overlay.setAttribute('aria-label', 'PiggieTV performance overlay');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('role', 'dialog');

    document.body.appendChild(overlay);

    return overlay;
}

export function togglePerformanceOverlay(enabled) {
    const shouldEnable = typeof enabled === 'boolean' ? enabled : !performanceOverlayRoot;

    if (!shouldEnable) {
        if (performanceOverlayTimer) {
            window.clearInterval(performanceOverlayTimer);
            performanceOverlayTimer = 0;
        }

        performanceOverlayRoot?.remove();
        performanceOverlayRoot = null;
        document.documentElement.classList.remove(PERFORMANCE_OVERLAY_CLASS);

        if (performanceOverlayStartedMonitor) {
            stopPerformanceMonitor();
            performanceOverlayStartedMonitor = false;
        }

        return getPerformanceReport();
    }

    if (!performanceMetrics.active) {
        performanceOverlayStartedMonitor = true;
        startPerformanceMonitor();
    }

    if (!performanceOverlayRoot) {
        performanceOverlayRoot = createPerformanceOverlay();
    }

    if (!performanceOverlayRoot) return getPerformanceReport();

    document.documentElement.classList.add(PERFORMANCE_OVERLAY_CLASS);
    renderPerformanceOverlay();

    if (!performanceOverlayTimer) {
        performanceOverlayTimer = window.setInterval(renderPerformanceOverlay, PTV_PERF_OVERLAY_UPDATE_MS);
    }

    return getPerformanceReport();
}

function installPerformanceApi() {
    const ptv = window.PTV || (window.PTV = {});

    ptv.performance = {
        applyMode: applyPerformanceMode,
        domReport: getPerformanceDomReport,
        mark: markPerformance,
        overlay: togglePerformanceOverlay,
        report: getPerformanceReport,
        start: startPerformanceMonitor,
        stop: stopPerformanceMonitor
    };
    ptv.performanceOverlay = togglePerformanceOverlay;
}

function shouldAutoStartPerformanceMonitor() {
    if (window.location.search.includes('ptvPerf=1')) return true;

    return shouldCollectDiagnostics() && window.localStorage?.getItem(PTV_PERF_STORAGE_KEY) === '1';
}

function shouldAutoStartPerformanceOverlay() {
    if (window.location.search.includes('ptvPerfOverlay=1')) return true;

    return shouldCollectDiagnostics() && window.localStorage?.getItem(PTV_PERF_OVERLAY_STORAGE_KEY) === '1';
}

applyPerformanceMode();
installPerformanceApi();

if (shouldAutoStartPerformanceMonitor()) {
    startPerformanceMonitor();
}

if (shouldAutoStartPerformanceOverlay()) {
    togglePerformanceOverlay(true);
}

performanceScope.listen(window, 'resize', applyPerformanceMode, { passive: true });
performanceScope.listen(window, 'ptv:debug:change', (event) => {
    if (event.detail?.canCollectDiagnostics) {
        startPerformanceMonitor();
    } else {
        stopPerformanceMonitor();
    }
});
const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');

if (reducedMotionQuery?.addEventListener) {
    performanceScope.listen(reducedMotionQuery, 'change', applyPerformanceMode);
}
