import { recordPtvEvent, shouldCollectDiagnostics } from '../core/observability';
import { registerPtvRuntimeListener } from '../core/runtime';

type PtvPerformanceEntryKind =
    | 'component'
    | 'long-task'
    | 'navigation'
    | 'playback'
    | 'request'
    | 'route';

type PtvPerformanceEntry = {
    at: number;
    detail?: Record<string, unknown>;
    durationMs?: number;
    kind: PtvPerformanceEntryKind;
    name: string;
};

type PtvPerformanceCounters = {
    abortedRequestCount: number;
    activeShellCount: number;
    deduplicatedRequestCount: number;
    dockRenderCount: number;
    duplicateShellCount: number;
    localStorageQuotaFailureCount: number;
    fallbackSurfaceMountCount: number;
    nativeShellMountCount: number;
    pageMountCount: number;
    pageUnmountCount: number;
    persistentRuntimeMountCount: number;
    playbackEventsReceived: number;
    playbackProviderMountCount: number;
    playbackRenderCount: number;
    playbackSubscriptionCount: number;
    playbackUpdatesPublished: number;
    playbackUpdatesSuppressed: number;
    requestCount: number;
    routePageMountCount: number;
    shellMountCount: number;
    storageEvictionCount: number;
    timeoutCount: number;
};

type PtvPerformanceWindow = Window & {
    PTV?: Record<string, unknown> & {
        performanceMonitor?: {
            clear: typeof clearPtvPerformanceMonitor;
            exportReport: () => string;
            report: typeof getPtvPerformanceReport;
        };
    };
};

const MAX_PERFORMANCE_ENTRIES = 500;
const entries: PtvPerformanceEntry[] = [];
const counters: PtvPerformanceCounters = {
    abortedRequestCount: 0,
    activeShellCount: 0,
    deduplicatedRequestCount: 0,
    dockRenderCount: 0,
    duplicateShellCount: 0,
    fallbackSurfaceMountCount: 0,
    localStorageQuotaFailureCount: 0,
    nativeShellMountCount: 0,
    pageMountCount: 0,
    pageUnmountCount: 0,
    persistentRuntimeMountCount: 0,
    playbackEventsReceived: 0,
    playbackProviderMountCount: 0,
    playbackRenderCount: 0,
    playbackSubscriptionCount: 0,
    playbackUpdatesPublished: 0,
    playbackUpdatesSuppressed: 0,
    requestCount: 0,
    routePageMountCount: 0,
    shellMountCount: 0,
    storageEvictionCount: 0,
    timeoutCount: 0
};

let longTaskObserver: PerformanceObserver | null = null;
let monitorStarted = false;
let previousRoute = '';

function trimEntries() {
    if (entries.length <= MAX_PERFORMANCE_ENTRIES) return;

    entries.splice(0, entries.length - MAX_PERFORMANCE_ENTRIES);
}

function supportsPerformanceEntryType(entryType: string) {
    if (typeof PerformanceObserver === 'undefined') return false;

    const supportedEntryTypes = PerformanceObserver.supportedEntryTypes || [];

    return supportedEntryTypes.indexOf(entryType) >= 0;
}

function now() {
    return Number(performance.now().toFixed(1));
}

export function recordPtvPerformanceEntry(
    kind: PtvPerformanceEntryKind,
    name: string,
    detail: Record<string, unknown> = {},
    durationMs?: number
) {
    const entry: PtvPerformanceEntry = {
        at: now(),
        detail,
        durationMs,
        kind,
        name
    };

    entries.push(entry);
    trimEntries();

    if (shouldCollectDiagnostics()) {
        recordPtvEvent(kind === 'playback' ? 'playback' : kind === 'request' ? 'api' : 'render', `perf:${name}`, {
            ...detail,
            durationMs,
            kind
        });
    }
}

export function incrementPtvPerformanceCounter(
    counter: keyof PtvPerformanceCounters,
    detail: Record<string, unknown> = {}
) {
    counters[counter] += 1;
    recordPtvPerformanceEntry('component', counter, {
        ...detail,
        value: counters[counter]
    });

    return counters[counter];
}

export function setPtvPerformanceCounter(
    counter: keyof PtvPerformanceCounters,
    value: number,
    detail: Record<string, unknown> = {}
) {
    counters[counter] = Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
    recordPtvPerformanceEntry('component', counter, {
        ...detail,
        value: counters[counter]
    });

    return counters[counter];
}

export function setPtvPlaybackSubscriptionCount(count: number) {
    counters.playbackSubscriptionCount = Math.max(0, Math.round(count));
    recordPtvPerformanceEntry('playback', 'playback-subscription-count', {
        playbackSubscriptionCount: counters.playbackSubscriptionCount
    });
}

export function recordPtvRouteTransition(destinationRoute: string) {
    const sourceRoute = previousRoute || '';

    previousRoute = destinationRoute;
    recordPtvPerformanceEntry('navigation', 'route-transition', {
        destinationRoute,
        sourceRoute
    });
}

export function clearPtvPerformanceMonitor() {
    entries.splice(0, entries.length);
    counters.abortedRequestCount = 0;
    counters.activeShellCount = 0;
    counters.deduplicatedRequestCount = 0;
    counters.dockRenderCount = 0;
    counters.duplicateShellCount = 0;
    counters.fallbackSurfaceMountCount = 0;
    counters.localStorageQuotaFailureCount = 0;
    counters.nativeShellMountCount = 0;
    counters.pageMountCount = 0;
    counters.pageUnmountCount = 0;
    counters.persistentRuntimeMountCount = 0;
    counters.playbackEventsReceived = 0;
    counters.playbackProviderMountCount = 0;
    counters.playbackRenderCount = 0;
    counters.playbackSubscriptionCount = 0;
    counters.playbackUpdatesPublished = 0;
    counters.playbackUpdatesSuppressed = 0;
    counters.requestCount = 0;
    counters.routePageMountCount = 0;
    counters.shellMountCount = 0;
    counters.storageEvictionCount = 0;
    counters.timeoutCount = 0;
    previousRoute = '';
}

export function getPtvPerformanceReport() {
    const longTasks = entries.filter(entry => entry.kind === 'long-task');
    const latestRoute = entries
        .filter(entry => entry.kind === 'navigation')
        .slice(-1)[0] || null;

    return {
        counters: { ...counters },
        entries: entries.slice(),
        generatedAt: new Date().toISOString(),
        latestRoute,
        longTaskCount: longTasks.length,
        longTaskTotalMs: Number(longTasks.reduce((total, entry) => total + (entry.durationMs || 0), 0).toFixed(1)),
        largestLongTaskMs: Number(longTasks.reduce((max, entry) => Math.max(max, entry.durationMs || 0), 0).toFixed(1)),
        route: window.location.hash || window.location.pathname
    };
}

export function startPtvPerformanceMonitor() {
    if (monitorStarted) return;

    monitorStarted = true;
    recordPtvRouteTransition(window.location.hash || window.location.pathname);

    registerPtvRuntimeListener('performance-monitor:hashchange', () => {
        const handleHashChange = () => {
            recordPtvRouteTransition(window.location.hash || window.location.pathname);
        };

        window.addEventListener('hashchange', handleHashChange);

        return () => window.removeEventListener('hashchange', handleHashChange);
    });

    if (supportsPerformanceEntryType('longtask')) {
        longTaskObserver = new PerformanceObserver(list => {
            list.getEntries().forEach(entry => {
                recordPtvPerformanceEntry('long-task', entry.name || 'long-task', {
                    startTime: Number(entry.startTime.toFixed(1))
                }, Number(entry.duration.toFixed(1)));
            });
        });

        try {
            longTaskObserver.observe({ entryTypes: ['longtask'] });
        } catch {
            longTaskObserver = null;
        }
    }

    const root = (window as PtvPerformanceWindow).PTV || ((window as PtvPerformanceWindow).PTV = {});

    root.performanceMonitor = {
        clear: clearPtvPerformanceMonitor,
        exportReport: () => JSON.stringify(getPtvPerformanceReport(), null, 2),
        report: getPtvPerformanceReport
    };
}
