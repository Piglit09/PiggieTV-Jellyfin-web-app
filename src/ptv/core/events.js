const PTV = window.PTV || (window.PTV = {});

PTV.events ||= {};

export function dispatchPtvCustomEvent(eventName, detail = null) {
    const event = document.createEvent('CustomEvent');
    // Older TV WebViews may not support the CustomEvent constructor.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    event.initCustomEvent(eventName, false, false, detail);
    window.dispatchEvent(event);
}

export function emit(name, detail = {}) {
    dispatchPtvCustomEvent(`ptv:${name}`, detail);
}

export function on(name, callback, options) {
    const eventName = `ptv:${name}`;

    window.addEventListener(eventName, callback, options);

    return () => {
        window.removeEventListener(eventName, callback, options);
    };
}

export function ready(callback) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
        callback();
    }
}

export function nextFrame(callback) {
    requestAnimationFrame(() => {
        requestAnimationFrame(callback);
    });
}
