import { getPtvApiUrl } from './client';
import type {
    PtvImageOptions,
    PtvItem
} from './types';

function getPrimaryImageTag(item?: PtvItem | null): string | null {
    return item?.ImageTags?.Primary || null;
}

function getBackdropTag(item?: PtvItem | null, index = 0): string | null {
    return item?.BackdropImageTags?.[index] || null;
}

function getThumbTag(item?: PtvItem | null): string | null {
    return item?.ImageTags?.Thumb || item?.ParentThumbImageTag || null;
}

function getLogoTag(item?: PtvItem | null): string | null {
    return item?.ImageTags?.Logo || item?.ParentLogoImageTag || null;
}

function getItemImageTag(item: PtvItem | null | undefined, imageType: string, imageIndex = 0): string | null {
    switch (imageType.toLowerCase()) {
        case 'backdrop':
            return getBackdropTag(item, imageIndex);
        case 'logo':
            return getLogoTag(item);
        case 'thumb':
            return getThumbTag(item);
        case 'primary':
        default:
            return getPrimaryImageTag(item);
    }
}

function getImageItemId(item: PtvItem, imageType: string): string {
    const normalizedType = imageType.toLowerCase();

    if (normalizedType === 'logo' && item.ParentLogoItemId) return item.ParentLogoItemId;
    if (normalizedType === 'thumb' && item.ParentThumbItemId) return item.ParentThumbItemId;
    if (normalizedType === 'backdrop' && item.ParentBackdropItemId && !item.BackdropImageTags?.length) {
        return item.ParentBackdropItemId;
    }

    return item.Id || '';
}

export function getPtvItemImageUrl(
    itemOrId: PtvItem | string | null | undefined,
    options: PtvImageOptions = {}
): string {
    const imageType = options.imageType || 'Primary';
    const imageIndex = options.imageIndex || 0;
    const item = typeof itemOrId === 'string' ? null : itemOrId;
    const itemId = typeof itemOrId === 'string'
        ? itemOrId
        : item
            ? getImageItemId(item, imageType)
            : '';

    if (!itemId) return '';

    const imagePath = imageType.toLowerCase() === 'backdrop'
        ? `Items/${itemId}/Images/Backdrop/${imageIndex}`
        : `Items/${itemId}/Images/${imageType}`;
    const tag = options.tag || getItemImageTag(item, imageType, imageIndex);

    return getPtvApiUrl(imagePath, {
        fillHeight: options.fillHeight,
        fillWidth: options.fillWidth,
        height: options.height,
        maxHeight: options.maxHeight,
        maxWidth: options.maxWidth,
        quality: options.quality,
        tag,
        width: options.width
    }, options.serverId || item?.ServerId || null);
}

export function getPtvUserImageUrl(
    userId: string,
    options: {
        serverId?: string | null;
        tag?: string | null;
    } = {}
): string {
    if (!userId) return '';

    return getPtvApiUrl(`Users/${userId}/Images/Primary`, {
        tag: options.tag
    }, options.serverId);
}

export function getPtvStableImageKey(
    itemOrId: PtvItem | string | null | undefined,
    options: PtvImageOptions = {}
): string {
    const imageType = options.imageType || 'Primary';
    const imageIndex = options.imageIndex || 0;
    const item = typeof itemOrId === 'string' ? null : itemOrId;
    const itemId = typeof itemOrId === 'string'
        ? itemOrId
        : item
            ? getImageItemId(item, imageType)
            : '';
    const tag = options.tag || getItemImageTag(item, imageType, imageIndex) || 'untagged';

    return [
        item?.ServerId || options.serverId || 'current',
        itemId || 'missing',
        imageType.toLowerCase(),
        imageIndex,
        tag,
        options.fillWidth || options.width || options.maxWidth || '',
        options.fillHeight || options.height || options.maxHeight || ''
    ].join(':');
}

