import type {
    PtvReadingHomeData,
    PtvReadingItem
} from './booksTypes';

export const PTV_READING_ITEM_METADATA_UPDATED_EVENT = 'ptv-reading-item-metadata-updated';

export type PtvReadingMetadataUpdateAuthority =
    | 'READBACK_CONFIRMED_MUTATION'
    | 'READBACK_FAILED'
    | 'READBACK_STALE_OR_UNCONFIRMED';

export type PtvReadingMetadataUpdateDetail = Readonly<{
    artworkStatus?: string;
    item: PtvReadingItem;
    itemId: string;
    metadataStatus?: string;
    operationGeneration?: number;
    outcome?: 'FAILURE' | 'FULL_SUCCESS' | 'PARTIAL_SUCCESS';
    readingOwnerGeneration?: number;
    readbackCode?: 'ARTWORK_REFRESH_FAILED' | 'METADATA_REFRESH_FAILED' | 'READBACK_CONFIRMED' | 'READBACK_FAILED' | 'READBACK_NOT_REQUIRED' | 'REFRESH_FAILED';
}>;

const READING_METADATA_UPDATE_OUTCOMES = new Set([
    'FAILURE',
    'FULL_SUCCESS',
    'PARTIAL_SUCCESS'
]);
const READING_METADATA_UPDATE_READBACK_CODES = new Set([
    'ARTWORK_REFRESH_FAILED',
    'METADATA_REFRESH_FAILED',
    'READBACK_CONFIRMED',
    'READBACK_FAILED',
    'READBACK_NOT_REQUIRED',
    'REFRESH_FAILED'
]);

export function getPtvReadingMetadataUpdateDetail(event: Event): PtvReadingMetadataUpdateDetail | null {
    const detail = (event as CustomEvent<unknown>).detail;

    if (!detail || typeof detail !== 'object') return null;

    const candidate = detail as Partial<PtvReadingMetadataUpdateDetail>;
    const itemId = String(candidate.itemId || '').trim();
    const item = candidate.item;

    if (!itemId || !item || typeof item !== 'object' || String(item.Id || '').trim() !== itemId) {
        return null;
    }

    return {
        artworkStatus: typeof candidate.artworkStatus === 'string' ? candidate.artworkStatus : undefined,
        item,
        itemId,
        metadataStatus: typeof candidate.metadataStatus === 'string' ? candidate.metadataStatus : undefined,
        operationGeneration: Number.isSafeInteger(candidate.operationGeneration)
            && Number(candidate.operationGeneration) > 0 ? Number(candidate.operationGeneration) : undefined,
        outcome: candidate.outcome && READING_METADATA_UPDATE_OUTCOMES.has(candidate.outcome) ? candidate.outcome : undefined,
        readingOwnerGeneration: Number.isSafeInteger(candidate.readingOwnerGeneration)
            && Number(candidate.readingOwnerGeneration) > 0 ? Number(candidate.readingOwnerGeneration) : undefined,
        readbackCode: candidate.readbackCode && READING_METADATA_UPDATE_READBACK_CODES.has(candidate.readbackCode) ? candidate.readbackCode : undefined
    };
}

export function isPtvReadingMetadataUpdateAuthoritative(detail: PtvReadingMetadataUpdateDetail) {
    return getPtvReadingMetadataUpdateAuthority(detail) === 'READBACK_CONFIRMED_MUTATION';
}

export function getPtvReadingMetadataUpdateAuthority(
    detail: PtvReadingMetadataUpdateDetail
): PtvReadingMetadataUpdateAuthority {
    if (detail.readbackCode === 'READBACK_CONFIRMED') return 'READBACK_CONFIRMED_MUTATION';
    if (detail.readbackCode === 'READBACK_FAILED') return 'READBACK_FAILED';

    return 'READBACK_STALE_OR_UNCONFIRMED';
}

export function isPtvReadingMetadataUpdateOwnedBy(
    detail: PtvReadingMetadataUpdateDetail,
    readingOwnerGeneration: number
) {
    return Number.isSafeInteger(readingOwnerGeneration)
        && readingOwnerGeneration > 0
        && detail.readingOwnerGeneration === readingOwnerGeneration;
}

export function shouldPublishPtvReadingAdminDialogItem(action: string) {
    return action !== 'identify';
}

export function getPtvReadingAdminDialogClosePolicy(
    action: string,
    updatedItem?: PtvReadingItem | null
) {
    if (!shouldPublishPtvReadingAdminDialogItem(action)) return 'identify-event';
    if (updatedItem?.Id) return 'publish-item';

    return 'targeted-readback';
}

export function replacePtvReadingItemInList(
    items: PtvReadingItem[],
    updatedItem: PtvReadingItem
) {
    if (!updatedItem.Id) return items;

    let changed = false;
    const nextItems = items.map(item => {
        if (item.Id !== updatedItem.Id) return item;

        changed = true;
        return {
            ...item,
            ...updatedItem,
            PtvReadingLibraryKindHint: updatedItem.PtvReadingLibraryKindHint || item.PtvReadingLibraryKindHint,
            PtvReadingLibraryName: updatedItem.PtvReadingLibraryName || item.PtvReadingLibraryName
        };
    });

    return changed ? nextItems : items;
}

export function replacePtvReadingItemInHomeData(
    homeData: PtvReadingHomeData,
    updatedItem: PtvReadingItem
) {
    if (!updatedItem.Id) return homeData;

    let changed = false;
    const sections = homeData.sections.map(section => {
        const items = replacePtvReadingItemInList(section.items, updatedItem);

        if (items === section.items) return section;

        changed = true;
        return {
            ...section,
            items
        };
    });

    return changed ? {
        ...homeData,
        sections
    } : homeData;
}
