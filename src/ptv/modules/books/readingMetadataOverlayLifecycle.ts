import type { PtvReadingItem } from './booksTypes';

type PtvReadingMetadataOverlay = Readonly<{
    epoch: number;
    item: PtvReadingItem;
}>;

export function createPtvReadingMetadataOverlayLifecycle(getScopeKey: () => string) {
    const itemOverlays = new Map<string, PtvReadingMetadataOverlay>();
    let epoch = 0;

    const getItemKey = (itemId: string) => (
        `${getScopeKey()}:${itemId.trim().toLowerCase()}`
    );

    return {
        apply(items: PtvReadingItem[], requestEpoch: number | null = null) {
            let changed = false;
            const nextItems = items.map(item => {
                const itemId = String(item.Id || '').trim();
                const overlayEntry = itemId ? itemOverlays.get(getItemKey(itemId)) : undefined;
                const overlay = overlayEntry
                    && (requestEpoch === null || overlayEntry.epoch > requestEpoch) ?
                    overlayEntry.item :
                    undefined;

                if (!overlay) return item;

                changed = true;
                return {
                    ...item,
                    ...overlay,
                    PtvReadingLibraryKindHint: overlay.PtvReadingLibraryKindHint || item.PtvReadingLibraryKindHint,
                    PtvReadingLibraryName: overlay.PtvReadingLibraryName || item.PtvReadingLibraryName
                };
            });

            return changed ? nextItems : items;
        },

        clear() {
            itemOverlays.clear();
        },

        getEpoch() {
            return epoch;
        },

        getWriteOptions() {
            const writeEpoch = epoch;

            return {
                shouldWrite: () => epoch === writeEpoch
            };
        },

        record(item?: PtvReadingItem) {
            epoch += 1;
            const itemId = String(item?.Id || '').trim();

            if (item && itemId) {
                itemOverlays.set(getItemKey(itemId), {
                    epoch,
                    item
                });
            }

            return epoch;
        },

        retire(items: PtvReadingItem[], requestEpoch: number) {
            items.forEach(item => {
                const itemId = String(item.Id || '').trim();

                if (!itemId) return;

                const key = getItemKey(itemId);
                const overlay = itemOverlays.get(key);

                if (overlay && overlay.epoch <= requestEpoch) {
                    itemOverlays.delete(key);
                }
            });
        }
    };
}
