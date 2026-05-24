const PTV = window.PTV || (window.PTV = {});

PTV.initializedModules ||= new Set();

export function once(name, callback) {
    if (PTV.initializedModules.has(name)) {
        return false;
    }

    PTV.initializedModules.add(name);
    callback?.();

    return true;
}

export function mark(name) {
    if (PTV.initializedModules.has(name)) {
        return false;
    }

    PTV.initializedModules.add(name);
    return true;
}

export function unmark(name) {
    PTV.initializedModules.delete(name);
}
