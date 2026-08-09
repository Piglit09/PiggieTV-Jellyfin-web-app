export function getPtvCollectionRetryHref(pathname: string, search: string) {
    return `#${pathname}${search}`;
}

function normalizeFocusSegment(value: string) {
    return value
        .trim()
        .toLocaleLowerCase('en-US')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-/, '')
        .replace(/-$/, '') || 'unknown';
}

export function getPtvCollectionSurfaceFocusKey(
    surface: string,
    itemKey: string,
    action = 'open'
) {
    return [
        'collections',
        normalizeFocusSegment(surface),
        normalizeFocusSegment(itemKey),
        normalizeFocusSegment(action)
    ].join('-');
}

export type PtvCollectionRouteMemory = Readonly<{
    focusKey: string;
    scrollTop: number;
}>;

const MAX_COLLECTION_ROUTE_MEMORY_ENTRIES = 24;
const collectionRouteMemory = new Map<string, PtvCollectionRouteMemory>();

export function getPtvCollectionRouteMemoryKey(
    identityKey: string,
    pathname: string,
    search: string
) {
    return identityKey ? `${identityKey}\u001f${pathname}${search}` : '';
}

export function loadPtvCollectionRouteMemory(key: string): PtvCollectionRouteMemory {
    return collectionRouteMemory.get(key) || { focusKey: '', scrollTop: 0 };
}

export function savePtvCollectionRouteMemory(
    key: string,
    memory: Partial<PtvCollectionRouteMemory>
) {
    if (!key) return;

    const previous = loadPtvCollectionRouteMemory(key);
    collectionRouteMemory.delete(key);
    collectionRouteMemory.set(key, {
        focusKey: typeof memory.focusKey === 'string' ? memory.focusKey.slice(0, 240) : previous.focusKey,
        scrollTop: Number.isFinite(memory.scrollTop) ? Math.max(0, Math.round(memory.scrollTop || 0)) : previous.scrollTop
    });

    while (collectionRouteMemory.size > MAX_COLLECTION_ROUTE_MEMORY_ENTRIES) {
        const oldestKey = collectionRouteMemory.keys().next().value;
        if (typeof oldestKey !== 'string') break;
        collectionRouteMemory.delete(oldestKey);
    }
}

export function clearPtvCollectionRouteMemory() {
    collectionRouteMemory.clear();
}

export function restorePtvCollectionRouteMemory(
    page: HTMLElement,
    memory: PtvCollectionRouteMemory
) {
    // Focus restoration may scroll the nearest container. Apply the canonical
    // route position last so Back/Forward returns to the exact saved viewport.
    page.scrollTop = memory.scrollTop;
}

export function observePtvCollectionRouteMemory(
    key: string,
    page: HTMLElement
) {
    const saveMemory = () => {
        const active = page.ownerDocument.activeElement;
        const focusKey = active instanceof HTMLElement && page.contains(active) ?
            active.dataset.ptvFocusKey || '' :
            '';

        savePtvCollectionRouteMemory(key, {
            focusKey,
            scrollTop: page.scrollTop
        });
    };

    page.addEventListener('scroll', saveMemory, { passive: true });
    page.addEventListener('focusin', saveMemory);
    page.addEventListener('click', saveMemory, true);

    return () => {
        page.removeEventListener('scroll', saveMemory);
        page.removeEventListener('focusin', saveMemory);
        page.removeEventListener('click', saveMemory, true);
    };
}
