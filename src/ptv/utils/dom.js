export function $(selector, root = document) {
    return root.querySelector(selector);
}

export function $$(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
}

export function create(tag, options = {}) {
    const el = document.createElement(tag);

    if (options.className) {
        el.className = options.className;
    }

    if (options.id) {
        el.id = options.id;
    }

    if (options.text) {
        el.textContent = options.text;
    }

    if (options.html) {
        el.innerHTML = options.html;
    }

    if (options.attrs) {
        Object.keys(options.attrs).forEach(key => {
            const value = options.attrs[key];

            if (value != null) {
                el.setAttribute(key, value);
            }
        });
    }

    return el;
}

export function safeRemove(el) {
    if (!el?.parentNode) return;

    try {
        el.parentNode.removeChild(el);
    } catch (err) {
        console.error('[PiggieTV] Failed to remove element:', err);
    }
}

export function replaceChildren(el, children = []) {
    if (!el) return;

    while (el.firstChild) {
        el.removeChild(el.firstChild);
    }

    children.filter(Boolean).forEach(child => {
        el.appendChild(child);
    });
}

export function addClass(el, className) {
    el?.classList?.add(className);
}

export function removeClass(el, className) {
    el?.classList?.remove(className);
}

export function toggleClass(el, className, force) {
    el?.classList?.toggle(className, force);
}

export function setDataset(el, key, value = 'true') {
    if (!el?.dataset) return;
    el.dataset[key] = value;
}

export function wasApplied(el, key = 'ptvApplied') {
    return el?.dataset?.[key] === 'true';
}

export function markApplied(el, key = 'ptvApplied') {
    setDataset(el, key, 'true');
    setDataset(el, 'ptvEnhanced', 'true');
}
