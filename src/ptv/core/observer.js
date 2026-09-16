import { emit } from './events';
import { schedule } from './scheduler';
import { ptvSafeConsole } from './safeConsole';

const OBSERVER_STATE_KEY = '__PTV_OBSERVERS__';

function isDebugEnabled() {
    return window.PTV_DEBUG === true;
}

function debugLog(message, detail) {
    if (!isDebugEnabled()) return;

    ptvSafeConsole.debug(`[PiggieTV Observer] ${message}`, detail);
}

function createObserverState() {
    return {
        callbackIds: new WeakMap(),
        created: 0,
        disconnected: 0,
        nextCallbackId: 1,
        observer: null,
        pendingStart: false,
        scopedWatchers: new Set(),
        watcherKeys: new Map()
    };
}

function getObserverState() {
    window[OBSERVER_STATE_KEY] ||= createObserverState();

    return window[OBSERVER_STATE_KEY];
}

const observerState = getObserverState();
const scopedWatchers = observerState.scopedWatchers;

function shouldIgnoreMutation(mutation) {
    const target = mutation.target;

    if (!(target instanceof Element)) return false;

    return Boolean(
        target.closest('.nowPlayingBar')
        || target.closest('.playbackProgress')
        || target.closest('.osdControls')
        || target.closest('.ptv-ignore-observer')
    );
}

function processScopedWatchers() {
    for (const watcher of scopedWatchers) {
        const root = document.querySelector(watcher.selector);

        if (!root) {
            if (watcher.active && watcher.onMissing) {
                watcher.onMissing();
            }

            watcher.active = false;
            continue;
        }

        if (!watcher.active) {
            watcher.active = true;
            runWatcherCallback(watcher, root);
            continue;
        }

        if (!watcher.once) {
            runWatcherCallback(watcher, root);
        }
    }

    emit('domchange');
}

function runWatcherCallback(watcher, root) {
    try {
        watcher.callback(root);
    } catch (err) {
        ptvSafeConsole.error(`[PiggieTV] DOM watcher failed: ${watcher.selector}`, err);
    }
}

function onMutations(mutations) {
    if (mutations.every(shouldIgnoreMutation)) return;

    schedule('dom-watchers', processScopedWatchers);
}

export function watchElement(selector, callback, options = {}) {
    if (typeof selector !== 'string' || typeof callback !== 'function') {
        return () => undefined;
    }

    const watcherKey = getWatcherKey(selector, callback, options);
    const existingWatcher = observerState.watcherKeys.get(watcherKey);

    if (existingWatcher) {
        existingWatcher.refs += 1;

        return () => {
            existingWatcher.refs -= 1;

            if (existingWatcher.refs > 0) return;

            scopedWatchers.delete(existingWatcher);
            observerState.watcherKeys.delete(watcherKey);
            if (!scopedWatchers.size) {
                stopObserver();
            }
            debugLog('watcher disposed', {
                selector,
                watchers: scopedWatchers.size
            });
        };
    }

    const watcher = {
        selector,
        callback,
        active: false,
        once: Boolean(options.once),
        onMissing: options.onMissing,
        refs: 1
    };

    scopedWatchers.add(watcher);
    observerState.watcherKeys.set(watcherKey, watcher);
    startObserver();

    debugLog('watcher registered', {
        selector,
        watchers: scopedWatchers.size
    });

    schedule('dom-watchers', processScopedWatchers);

    return () => {
        watcher.refs -= 1;

        if (watcher.refs > 0) return;

        scopedWatchers.delete(watcher);
        observerState.watcherKeys.delete(watcherKey);
        if (!scopedWatchers.size) {
            stopObserver();
        }
        debugLog('watcher disposed', {
            selector,
            watchers: scopedWatchers.size
        });
    };
}

export function watchDom(callback) {
    return watchElement('body', callback);
}

export function startObserver() {
    if (observerState.observer) return observerState.observer;

    if (!document.body) {
        if (!observerState.pendingStart) {
            observerState.pendingStart = true;
            document.addEventListener('DOMContentLoaded', () => {
                observerState.pendingStart = false;
                startObserver();
            }, { once: true });
        }

        return null;
    }

    observerState.observer = new MutationObserver(onMutations);

    observerState.observer.observe(document.body, {
        childList: true,
        subtree: true
    });
    observerState.created += 1;
    debugLog('root observer created', {
        created: observerState.created,
        watchers: scopedWatchers.size
    });

    return observerState.observer;
}

export function stopObserver() {
    if (!observerState.observer) return;

    observerState.observer.disconnect();
    observerState.observer = null;
    observerState.disconnected += 1;
    debugLog('root observer disconnected', {
        disconnected: observerState.disconnected
    });
}

export function getObserverDiagnostics() {
    return {
        created: observerState.created,
        disconnected: observerState.disconnected,
        running: Boolean(observerState.observer),
        watchers: scopedWatchers.size
    };
}

export function clearDomWatchers() {
    scopedWatchers.clear();
    observerState.watcherKeys.clear();
    stopObserver();
}

function getCallbackId(callback) {
    if (!observerState.callbackIds.has(callback)) {
        observerState.callbackIds.set(callback, observerState.nextCallbackId);
        observerState.nextCallbackId += 1;
    }

    return observerState.callbackIds.get(callback);
}

function getWatcherKey(selector, callback, options = {}) {
    return [
        selector,
        getCallbackId(callback),
        options.once ? 'once' : 'many'
    ].join(':');
}

startObserver();
