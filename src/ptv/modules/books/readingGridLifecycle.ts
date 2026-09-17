import {
    type Dispatch,
    type SetStateAction,
    useEffect,
    useMemo,
    useState
} from 'react';

import type { PtvReadingItem } from './booksTypes';

function getReadingGridItemIdentity(item: PtvReadingItem, index: number) {
    const itemId = String(item.Id || '').trim();

    if (itemId) return `${String(item.ServerId || '').trim()}:${itemId}`;

    return `missing-id:${index}`;
}

export function getPtvReadingGridDatasetKey(items: PtvReadingItem[]) {
    return items.map(getReadingGridItemIdentity).join('|');
}

export function usePtvReadingGridVisibleLimit(
    items: PtvReadingItem[],
    routeKey: string,
    initialLimit: number
): readonly [number, Dispatch<SetStateAction<number>>] {
    const datasetKey = useMemo(() => getPtvReadingGridDatasetKey(items), [items]);
    const [visibleLimit, setVisibleLimit] = useState(initialLimit);

    useEffect(() => {
        setVisibleLimit(initialLimit);
    }, [datasetKey, initialLimit, routeKey]);

    return [ visibleLimit, setVisibleLimit ] as const;
}
