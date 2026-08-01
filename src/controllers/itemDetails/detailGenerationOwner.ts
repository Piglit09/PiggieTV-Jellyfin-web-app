type PtvDetailItemLike = {
    Id?: string;
};

const detailItemGenerations = new WeakMap<object, number>();

export function beginPtvDetailPageGeneration(
    page: HTMLElement,
    itemId: string,
    generation: number
) {
    page.dataset.ptvDetailItemId = itemId;
    page.dataset.ptvDetailGeneration = String(generation);
}

export function stampPtvDetailItemGeneration(
    item: PtvDetailItemLike,
    generation: number
) {
    detailItemGenerations.set(item, generation);
}

export function resumePtvDetailPageGeneration<TItem extends PtvDetailItemLike>(
    page: HTMLElement,
    item: TItem,
    generation: number
): TItem {
    const resumedItem = { ...item };

    beginPtvDetailPageGeneration(page, String(resumedItem.Id || ''), generation);
    stampPtvDetailItemGeneration(resumedItem, generation);

    return resumedItem;
}

export function isPtvDetailItemGenerationCurrent(
    page: HTMLElement,
    item: PtvDetailItemLike | null | undefined
) {
    const itemId = String(item?.Id || '');
    const itemGeneration = item && detailItemGenerations.get(item);
    const pageGeneration = Number(page.dataset.ptvDetailGeneration);

    if (page.dataset.ptvDetailItemId && page.dataset.ptvDetailItemId !== itemId) {
        return false;
    }
    if (!Number.isFinite(pageGeneration) || pageGeneration <= 0) return false;

    return itemGeneration === undefined
        || pageGeneration === itemGeneration;
}

export function retirePtvDetailPageGeneration(page: HTMLElement) {
    page.dataset.ptvDetailItemId = '';
    page.dataset.ptvDetailGeneration = '';
}
