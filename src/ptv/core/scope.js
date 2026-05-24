import { watchDom, watchElement } from './observer';

const runtimeScopes = new Map();
const eventTargetIds = new WeakMap();
const listenerCallbackIds = new WeakMap();

let nextScopeId = 1;
let nextTargetId = 1;
let nextListenerCallbackId = 1;

function noop() {
    return undefined;
}

function isRuntimeDebugEnabled() {
    return window['PTV_DEBUG'] === true;
}

function debugWarn(message, detail) {
    if (!isRuntimeDebugEnabled()) return;

    console.warn(`[PiggieTV Runtime] ${message}`, detail);
}

function debugLog(message, detail) {
    if (!isRuntimeDebugEnabled()) return;

    console.debug(`[PiggieTV Runtime] ${message}`, detail);
}

function normalizeDisposer(disposer) {
    return typeof disposer === 'function' ? disposer : noop;
}

function getTargetId(target) {
    if (!eventTargetIds.has(target)) {
        eventTargetIds.set(target, nextTargetId);
        nextTargetId += 1;
    }

    return eventTargetIds.get(target);
}

function getListenerCallbackId(callback) {
    if (!listenerCallbackIds.has(callback)) {
        listenerCallbackIds.set(callback, nextListenerCallbackId);
        nextListenerCallbackId += 1;
    }

    return listenerCallbackIds.get(callback);
}

function getListenerKey(target, eventName, callback, options) {
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);

    return `${getTargetId(target)}:${eventName}:${capture}:${getListenerCallbackId(callback)}`;
}

function getResourceCounts(resources) {
    const counts = {};

    resources.forEach(resource => {
        counts[resource.type] = (counts[resource.type] || 0) + 1;
    });

    return counts;
}

function getScopeSnapshot(scope) {
    const resources = Array.from(scope.resources.values());
    const counts = getResourceCounts(resources);

    return {
        active: !scope.disposed,
        ageMs: Date.now() - scope.createdAt,
        createdAt: scope.createdAt,
        disposed: scope.disposed,
        id: scope.id,
        name: scope.name,
        resources: resources.map(resource => ({
            ageMs: Date.now() - resource.createdAt,
            label: resource.label,
            type: resource.type
        })),
        totals: {
            fetches: counts.fetch || 0,
            listeners: counts.listener || 0,
            observers: counts.observer || 0,
            resources: resources.length,
            timers: (counts.timeout || 0) + (counts.interval || 0) + (counts.animationFrame || 0)
        }
    };
}

export function createRuntimeScope(name) {
    const disposers = new Set();
    const resources = new Map();
    const listenerKeys = new Set();
    let nextResourceId = 1;

    const scope = {
        add(disposer, metadata = {}) {
            if (scope.disposed) {
                debugWarn(`attempted to add "${metadata.label || metadata.type || 'cleanup'}" to disposed scope "${name}"`);
                normalizeDisposer(disposer)();
                return noop;
            }

            const cleanup = normalizeDisposer(disposer);
            const resourceId = nextResourceId;

            nextResourceId += 1;
            disposers.add(cleanup);
            resources.set(resourceId, {
                createdAt: Date.now(),
                label: metadata.label || metadata.type || 'cleanup',
                type: metadata.type || 'cleanup'
            });

            return () => {
                if (!disposers.has(cleanup)) return;

                disposers.delete(cleanup);
                resources.delete(resourceId);
                cleanup();
            };
        },

        animationFrame(callback) {
            let release = noop;
            const frame = window.requestAnimationFrame((timestamp) => {
                release();
                callback(timestamp);
            });

            release = scope.add(() => window.cancelAnimationFrame(frame), {
                label: 'requestAnimationFrame',
                type: 'animationFrame'
            });

            return release;
        },

        dispose() {
            if (scope.disposed) return;

            const pendingResources = resources.size;
            const pendingSnapshot = pendingResources ? getScopeSnapshot(scope) : null;
            const pendingDisposers = Array.from(disposers).reverse();

            disposers.clear();
            resources.clear();
            listenerKeys.clear();
            scope.disposed = true;

            if (pendingResources) {
                debugWarn(`disposing scope with ${pendingResources} active resources`, pendingSnapshot);
            }

            pendingDisposers.forEach(disposer => {
                try {
                    disposer();
                } catch (err) {
                    console.error(`[PiggieTV] Failed to dispose runtime scope: ${name}`, err);
                }
            });
        },

        disposed: false,

        fetch(input, init = {}) {
            const fetchFunction = window.fetch;

            if (typeof fetchFunction !== 'function') {
                return Promise.reject(new Error('Fetch is not available in this browser.'));
            }

            const AbortControllerCtor = window['AbortController'];
            const controller = AbortControllerCtor && !init.signal ? new AbortControllerCtor() : null;
            const requestInit = controller ? {
                ...init,
                signal: controller.signal
            } : init;
            let release = noop;

            release = scope.add(() => {
                controller?.abort();
            }, {
                label: String(input),
                type: 'fetch'
            });

            return fetchFunction.call(window, input, requestInit).finally(() => {
                release();
            });
        },

        id: nextScopeId++,

        interval(callback, delay) {
            const timer = window.setInterval(callback, delay);

            return scope.add(() => window.clearInterval(timer), {
                label: `${delay}ms interval`,
                type: 'interval'
            });
        },

        listen(target, eventName, callback, options) {
            if (!target?.addEventListener || !target?.removeEventListener) return noop;

            const listenerKey = getListenerKey(target, eventName, callback, options);

            if (listenerKeys.has(listenerKey)) {
                debugWarn(`duplicate listener in scope "${name}"`, { eventName });
            }

            listenerKeys.add(listenerKey);
            target.addEventListener(eventName, callback, options);

            return scope.add(() => {
                listenerKeys.delete(listenerKey);
                target.removeEventListener(eventName, callback, options);
            }, {
                label: eventName,
                type: 'listener'
            });
        },

        mutationObserver(callback, target = document.body, options = { childList: true, subtree: true }) {
            const observer = new MutationObserver(callback);
            const label = target === document.body ? 'document.body' : target.tagName?.toLowerCase() || 'element';

            observer.observe(target, options);
            debugLog('observer created', {
                label,
                scope: name
            });

            return scope.add(() => {
                observer.disconnect();
                debugLog('observer disconnected', {
                    label,
                    scope: name
                });
            }, {
                label,
                type: 'observer'
            });
        },

        name,
        resources,

        timeout(callback, delay) {
            let release = noop;
            const timer = window.setTimeout(() => {
                release();
                callback();
            }, delay);

            release = scope.add(() => window.clearTimeout(timer), {
                label: `${delay}ms timeout`,
                type: 'timeout'
            });

            return release;
        },

        watchDom(callback) {
            return scope.add(watchDom(callback), {
                label: 'body',
                type: 'observer'
            });
        },

        watchElement(selector, callback, options) {
            return scope.add(watchElement(selector, callback, options), {
                label: selector,
                type: 'observer'
            });
        }
    };

    return scope;
}

export function getRuntimeScope(name) {
    if (!runtimeScopes.has(name)) {
        runtimeScopes.set(name, createRuntimeScope(name));
    }

    return runtimeScopes.get(name);
}

export function resetRuntimeScope(name) {
    const existingScope = runtimeScopes.get(name);

    if (existingScope && !existingScope.disposed) {
        debugWarn(`resetting active scope "${name}"`, getScopeSnapshot(existingScope));
        existingScope.dispose();
    }

    const scope = createRuntimeScope(name);
    runtimeScopes.set(name, scope);

    return scope;
}

export function disposeRuntimeScope(name) {
    runtimeScopes.get(name)?.dispose();
    runtimeScopes.delete(name);
}

export function disposeRuntimeScopes(predicate) {
    const disposed = [];

    Array.from(runtimeScopes.entries()).forEach(([name, scope]) => {
        if (typeof predicate === 'function' && !predicate(name, scope)) return;

        scope.dispose();
        runtimeScopes.delete(name);
        disposed.push(name);
    });

    return disposed;
}

export function getRuntimeScopeNames() {
    return Array.from(runtimeScopes.keys());
}

export function getRuntimeDiagnostics() {
    const scopes = Array.from(runtimeScopes.values()).map(getScopeSnapshot);
    const totals = scopes.reduce((summary, scope) => ({
        activeScopes: summary.activeScopes + (scope.active ? 1 : 0),
        fetches: summary.fetches + scope.totals.fetches,
        listeners: summary.listeners + scope.totals.listeners,
        observers: summary.observers + scope.totals.observers,
        resources: summary.resources + scope.totals.resources,
        scopes: summary.scopes + 1,
        timers: summary.timers + scope.totals.timers
    }), {
        activeScopes: 0,
        fetches: 0,
        listeners: 0,
        observers: 0,
        resources: 0,
        scopes: 0,
        timers: 0
    });

    return {
        scopes,
        staleScopes: scopes.filter(scope => scope.disposed && scope.totals.resources > 0),
        totals
    };
}

export function logRuntimeDiagnostics() {
    const diagnostics = getRuntimeDiagnostics();

    console.info('[PiggieTV Runtime] diagnostics', diagnostics);

    return diagnostics;
}

function installRuntimeScopeApi() {
    const ptv = window.PTV || (window.PTV = {});

    ptv.runtime = {
        ...(ptv.runtime || {}),
        disposeScope: disposeRuntimeScope,
        log: logRuntimeDiagnostics,
        report: getRuntimeDiagnostics,
        scopes: getRuntimeScopeNames
    };
}

installRuntimeScopeApi();
