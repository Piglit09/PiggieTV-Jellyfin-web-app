import { emit } from './events';
import { schedule } from './scheduler';

let observer = null;
const scopedWatchers = new Set();

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
            watcher.callback(root);
            continue;
        }

        if (!watcher.once) {
            watcher.callback(root);
        }
    }

    emit('domchange');
}

function onMutations(mutations) {
    if (mutations.every(shouldIgnoreMutation)) return;

    schedule('dom-watchers', processScopedWatchers);
}

export function watchElement(selector, callback, options = {}) {
    if (typeof selector !== 'string' || typeof callback !== 'function') {
        return () => undefined;
    }

    const watcher = {
        selector,
        callback,
        active: false,
        once: Boolean(options.once),
        onMissing: options.onMissing
    };

    scopedWatchers.add(watcher);

    schedule('dom-watchers', processScopedWatchers);

    return () => {
        scopedWatchers.delete(watcher);
    };
}

export function watchDom(callback) {
    return watchElement('body', callback);
}

export function startObserver() {
    if (observer) return observer;

    observer = new MutationObserver(onMutations);

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    return observer;
}

export function stopObserver() {
    if (!observer) return;

    observer.disconnect();
    observer = null;
}

startObserver();
