import { getPtvApiUrl } from './client';
import { recordPtvEvent, shouldCollectDiagnostics } from '../core/observability';
import type {
    PtvImageOptions,
    PtvItem
} from './types';

export type PtvItemImageCandidate = {
    imageItemId: string;
    imageType: string;
    requestedType: string;
    tag: string;
    tagMode: string;
    untaggedFallbackFor?: string;
    url: string;
};

type PtvImageCandidateRequest = 'Primary' | 'Thumb' | 'Backdrop' | 'SeriesPrimary' | 'ParentPrimary' | 'ArtistPrimary';

export type PtvItemImageCandidateOptions = {
    baseOptions?: PtvImageOptions;
    includeBackdrop?: boolean;
    includeParentPrimary?: boolean;
    includePrimary?: boolean;
    includeSeriesPrimary?: boolean;
    includeThumb?: boolean;
    order?: PtvImageCandidateRequest[];
};

type PtvImageItemInput = PtvItem | string | null | undefined;

const failedPtvImageUrls = new Set<string>();
const failedPtvImageCandidateKeys = new Set<string>();
const MAX_FAILED_IMAGE_URLS = 800;
const MAX_FAILED_IMAGE_CANDIDATE_KEYS = 1200;
const ptvImageFailureDiagnostics = {
    fallbackCount: 0,
    retrySuppressionCount: 0,
    totalFailureCount: 0
};

function normalizePtvImageFailureUrl(url: string) {
    if (!url) return '';

    try {
        const anchor = document.createElement('a');
        anchor.href = url;

        return anchor.href || url;
    } catch {
        return url;
    }
}

function trimFailedImageUrls() {
    if (failedPtvImageUrls.size <= MAX_FAILED_IMAGE_URLS) return;

    const urlsToDelete = failedPtvImageUrls.size - MAX_FAILED_IMAGE_URLS;
    let deleted = 0;

    for (const url of failedPtvImageUrls) {
        failedPtvImageUrls.delete(url);
        deleted += 1;

        if (deleted >= urlsToDelete) return;
    }
}

function trimFailedImageCandidateKeys() {
    if (failedPtvImageCandidateKeys.size <= MAX_FAILED_IMAGE_CANDIDATE_KEYS) return;

    const keysToDelete = failedPtvImageCandidateKeys.size - MAX_FAILED_IMAGE_CANDIDATE_KEYS;
    let deleted = 0;

    for (const key of failedPtvImageCandidateKeys) {
        failedPtvImageCandidateKeys.delete(key);
        deleted += 1;

        if (deleted >= keysToDelete) return;
    }
}

function getPtvImageCandidateFailureKey(candidate: PtvItemImageCandidate | null | undefined) {
    if (!candidate?.imageItemId || !candidate.imageType) return '';

    return [
        candidate.imageItemId,
        candidate.imageType.toLowerCase(),
        candidate.requestedType.toLowerCase(),
        candidate.tag || 'untagged',
        candidate.tagMode || 'unknown'
    ].join(':');
}

export function markPtvImageUrlFailed(url: string) {
    const normalizedUrl = normalizePtvImageFailureUrl(url);

    if (!normalizedUrl) return;

    ptvImageFailureDiagnostics.totalFailureCount += 1;

    if (failedPtvImageUrls.has(normalizedUrl)) {
        ptvImageFailureDiagnostics.retrySuppressionCount += 1;
        if (shouldCollectDiagnostics()) {
            recordPtvEvent('image', 'image-retry-suppressed', {
                ...getPtvImageFailureDiagnostics(),
                url: normalizedUrl
            });
        }
        return;
    }

    failedPtvImageUrls.add(normalizedUrl);
    trimFailedImageUrls();
    if (shouldCollectDiagnostics()) {
        recordPtvEvent('image', 'image-url-failure-cached', {
            failedImageUrlCount: failedPtvImageUrls.size,
            url: normalizedUrl
        });
    }
}

export function markPtvImageCandidateFailed(candidate: PtvItemImageCandidate | null | undefined) {
    if (!candidate) return;

    const key = getPtvImageCandidateFailureKey(candidate);

    if (key) {
        failedPtvImageCandidateKeys.add(key);
        trimFailedImageCandidateKeys();
    }

    markPtvImageUrlFailed(candidate.url);
}

export function hasPtvImageUrlFailed(url: string) {
    const normalizedUrl = normalizePtvImageFailureUrl(url);

    return Boolean(normalizedUrl && failedPtvImageUrls.has(normalizedUrl));
}

export function hasPtvImageCandidateFailed(candidate: PtvItemImageCandidate | null | undefined) {
    if (!candidate) return false;

    const key = getPtvImageCandidateFailureKey(candidate);

    return hasPtvImageUrlFailed(candidate.url) || Boolean(key && failedPtvImageCandidateKeys.has(key));
}

export function recordPtvImageFallback() {
    if (!shouldCollectDiagnostics()) return;

    ptvImageFailureDiagnostics.fallbackCount += 1;
}

export function getPtvImageFailureDiagnostics() {
    return {
        cachedFailures: failedPtvImageUrls.size,
        cachedImageFailures: failedPtvImageCandidateKeys.size,
        failedImageCount: ptvImageFailureDiagnostics.totalFailureCount,
        fallbackCount: ptvImageFailureDiagnostics.fallbackCount,
        retryCount: ptvImageFailureDiagnostics.retrySuppressionCount
    };
}

function getRecordValue<TValue = unknown>(
    item: PtvItem | null | undefined,
    ...keys: string[]
): TValue | null {
    if (!item) return null;

    for (const key of keys) {
        const value = item[key];

        if (value !== undefined && value !== null) {
            return value as TValue;
        }
    }

    return null;
}

function getImageTags(item?: PtvItem | null): Record<string, string> {
    return getRecordValue<Record<string, string>>(item, 'ImageTags', 'imageTags') || {};
}

function getImageTagValue(item: PtvItem | null | undefined, imageType: string): string {
    const tags = getImageTags(item);
    const lowerType = imageType.toLowerCase();
    const exactTag = tags[imageType];

    if (typeof exactTag === 'string' && exactTag) return exactTag;

    const matchedKey = Object.keys(tags).find(key => key.toLowerCase() === lowerType);
    const matchedTag = matchedKey ? tags[matchedKey] : '';

    return typeof matchedTag === 'string' ? matchedTag : '';
}

function getStringValue(item: PtvItem | null | undefined, ...keys: string[]): string {
    const value = getRecordValue(item, ...keys);

    return typeof value === 'string' ? value : '';
}

function getStringArrayValue(item: PtvItem | null | undefined, ...keys: string[]): string[] {
    const value = getRecordValue(item, ...keys);

    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function getRecordArrayValue(item: PtvItem | null | undefined, ...keys: string[]): Record<string, unknown>[] {
    const value = getRecordValue(item, ...keys);

    return Array.isArray(value) ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object') : [];
}

function getFirstNestedStringValue(records: Record<string, unknown>[], ...keys: string[]): string {
    for (const record of records) {
        for (const key of keys) {
            const value = record[key];

            if (typeof value === 'string' && value) return value;
        }
    }

    return '';
}

function addPtvImageCandidate(
    candidates: PtvItemImageCandidate[],
    seenUrls: Set<string>,
    imageItemId: string,
    options: PtvImageOptions,
    tagMode: string,
    requestedType = options.imageType || 'Primary',
    untaggedFallbackFor?: string
) {
    if (!imageItemId) return;

    const imageType = options.imageType || 'Primary';
    const tag = typeof options.tag === 'string' ? options.tag : '';
    const url = getPtvItemImageUrl(imageItemId, options);

    const candidate = {
        imageItemId,
        imageType,
        requestedType,
        tag,
        tagMode,
        untaggedFallbackFor,
        url
    };

    if (!url || seenUrls.has(url)) return;

    if (hasPtvImageCandidateFailed(candidate)) {
        ptvImageFailureDiagnostics.retrySuppressionCount += 1;
        if (shouldCollectDiagnostics()) {
            recordPtvEvent('image', 'image-retry-suppressed', {
                ...getPtvImageFailureDiagnostics(),
                imageItemId,
                imageType,
                requestedType,
                tagMode,
                url
            });
        }
        return;
    }

    seenUrls.add(url);
    candidates.push(candidate);
}

function addTaggedAndUntaggedCandidate(
    candidates: PtvItemImageCandidate[],
    seenUrls: Set<string>,
    imageItemId: string,
    baseOptions: PtvImageOptions,
    options: {
        fallbackMode: string;
        imageIndex?: number;
        imageType: string;
        requestedType: string;
        tag: string;
        taggedMode: string;
        untaggedMode: string;
    }
) {
    if (!imageItemId) return;

    const imageOptions = {
        ...baseOptions,
        imageIndex: options.imageIndex,
        imageType: options.imageType
    };

    if (options.tag) {
        addPtvImageCandidate(candidates, seenUrls, imageItemId, {
            ...imageOptions,
            tag: options.tag
        }, options.taggedMode, options.requestedType);
        return;
    }

    addPtvImageCandidate(candidates, seenUrls, imageItemId, imageOptions,
        options.fallbackMode,
        options.requestedType);
}

function getPrimaryImageTag(item?: PtvItem | null): string | null {
    return getImageTagValue(item, 'Primary')
        || getStringValue(item, 'PrimaryImageTag', 'primaryImageTag')
        || null;
}

function getBackdropTag(item?: PtvItem | null, index = 0): string | null {
    return getStringArrayValue(item, 'BackdropImageTags', 'backdropImageTags')[index]
        || getStringValue(item, 'BackdropImageTag', 'backdropImageTag', 'ParentBackdropImageTag', 'parentBackdropImageTag')
        || null;
}

function getThumbTag(item?: PtvItem | null): string | null {
    return getImageTagValue(item, 'Thumb')
        || getStringValue(item, 'ThumbImageTag', 'thumbImageTag', 'ParentThumbImageTag', 'parentThumbImageTag')
        || null;
}

function getLogoTag(item?: PtvItem | null): string | null {
    return getImageTagValue(item, 'Logo')
        || getStringValue(item, 'LogoImageTag', 'logoImageTag', 'ParentLogoImageTag', 'parentLogoImageTag')
        || null;
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
    const backdropTags = getStringArrayValue(item, 'BackdropImageTags', 'backdropImageTags');
    const parentLogoItemId = getStringValue(item, 'ParentLogoItemId', 'parentLogoItemId');
    const parentThumbItemId = getStringValue(item, 'ParentThumbItemId', 'parentThumbItemId');
    const parentBackdropItemId = getStringValue(item, 'ParentBackdropItemId', 'parentBackdropItemId', 'BackdropItemId', 'backdropItemId');
    const parentPrimaryItemId = getStringValue(
        item,
        'PrimaryImageItemId',
        'primaryImageItemId',
        'ParentPrimaryImageItemId',
        'parentPrimaryImageItemId',
        'AlbumPrimaryImageItemId',
        'albumPrimaryImageItemId'
    );

    if (normalizedType === 'logo' && parentLogoItemId) return parentLogoItemId;
    if (normalizedType === 'thumb' && parentThumbItemId) return parentThumbItemId;
    if (normalizedType === 'backdrop' && parentBackdropItemId && !backdropTags.length) {
        return parentBackdropItemId;
    }
    if (normalizedType === 'primary' && parentPrimaryItemId) return parentPrimaryItemId;

    return getStringValue(item, 'Id', 'id');
}

function getPtvImageRequestItemId(itemOrId: PtvImageItemInput, imageType: string) {
    if (typeof itemOrId === 'string') return itemOrId;
    if (itemOrId) return getImageItemId(itemOrId, imageType);

    return '';
}

export function getPtvItemImageUrl(
    itemOrId: PtvImageItemInput,
    options: PtvImageOptions = {}
): string {
    const imageType = options.imageType || 'Primary';
    const imageIndex = options.imageIndex || 0;
    const item = typeof itemOrId === 'string' ? null : itemOrId;
    const itemId = getPtvImageRequestItemId(itemOrId, imageType);

    if (!itemId) return '';

    const imagePath = imageType.toLowerCase() === 'backdrop' ?
        `Items/${itemId}/Images/Backdrop/${imageIndex}` :
        `Items/${itemId}/Images/${imageType}`;
    const tag = options.tag !== undefined ? options.tag : getItemImageTag(item, imageType, imageIndex);

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

export function getPtvItemImageCandidates(
    item: PtvItem | null | undefined,
    options: PtvItemImageCandidateOptions = {}
): PtvItemImageCandidate[] {
    if (!item) return [];

    const itemId = getStringValue(item, 'Id', 'id');
    const serverId = getStringValue(item, 'ServerId', 'serverId');
    const primaryItemId = getPtvImageRequestItemId(item, 'Primary') || itemId;
    const thumbItemId = getPtvImageRequestItemId(item, 'Thumb') || itemId;
    const backdropItemId = getPtvImageRequestItemId(item, 'Backdrop') || itemId;
    const primaryTag = getPrimaryImageTag(item) || '';
    const thumbTag = getThumbTag(item) || '';
    const backdropTags = getStringArrayValue(item, 'BackdropImageTags', 'backdropImageTags');
    const backdropTag = backdropTags[0] || getBackdropTag(item) || '';
    const seriesPrimaryTag = getStringValue(item, 'SeriesPrimaryImageTag', 'seriesPrimaryImageTag');
    const seriesId = getStringValue(item, 'SeriesId', 'seriesId');
    const parentPrimaryTag = getStringValue(
        item,
        'ParentPrimaryImageTag',
        'parentPrimaryImageTag',
        'AlbumPrimaryImageTag',
        'albumPrimaryImageTag'
    );
    const parentId = getStringValue(
        item,
        'ParentPrimaryImageItemId',
        'parentPrimaryImageItemId',
        'AlbumPrimaryImageItemId',
        'albumPrimaryImageItemId',
        'ParentId',
        'parentId',
        'AlbumId',
        'albumId'
    );
    const artistItems = getRecordArrayValue(item, 'ArtistItems', 'artistItems', 'AlbumArtists', 'albumArtists');
    const artistPrimaryId = getFirstNestedStringValue(artistItems, 'Id', 'id');
    const artistPrimaryTag = getFirstNestedStringValue(artistItems, 'PrimaryImageTag', 'primaryImageTag');
    const baseOptions = {
        ...(options.baseOptions || {}),
        serverId: options.baseOptions?.serverId || serverId || undefined
    };
    const order = options.order || ['Primary', 'Thumb', 'Backdrop', 'SeriesPrimary'];
    const candidates: PtvItemImageCandidate[] = [];
    const seenUrls = new Set<string>();
    const includePrimary = options.includePrimary !== false;
    const includeThumb = options.includeThumb !== false;
    const includeBackdrop = options.includeBackdrop !== false;
    const includeSeriesPrimary = options.includeSeriesPrimary !== false;
    const includeParentPrimary = options.includeParentPrimary !== false;
    const candidateBuilders: Record<PtvImageCandidateRequest, () => void> = {
        ArtistPrimary: () => {
            addTaggedAndUntaggedCandidate(candidates, seenUrls, artistPrimaryId, baseOptions, {
                fallbackMode: 'untagged-artist-primary-fallback',
                imageType: 'Primary',
                requestedType: 'ArtistPrimary',
                tag: artistPrimaryTag,
                taggedMode: 'artist-primary',
                untaggedMode: 'untagged-artist-primary'
            });
        },
        Backdrop: () => {
            if (!includeBackdrop) return;
            addTaggedAndUntaggedCandidate(candidates, seenUrls, backdropItemId, baseOptions, {
                fallbackMode: 'untagged-backdrop-fallback',
                imageIndex: 0,
                imageType: 'Backdrop',
                requestedType: 'Backdrop',
                tag: backdropTag,
                taggedMode: 'tagged-backdrop',
                untaggedMode: 'untagged-backdrop'
            });
        },
        ParentPrimary: () => {
            if (!includeParentPrimary) return;
            addTaggedAndUntaggedCandidate(candidates, seenUrls, parentId, baseOptions, {
                fallbackMode: 'untagged-parent-primary-fallback',
                imageType: 'Primary',
                requestedType: 'ParentPrimary',
                tag: parentPrimaryTag,
                taggedMode: 'parent-primary',
                untaggedMode: 'untagged-parent-primary'
            });
        },
        Primary: () => {
            if (!includePrimary) return;
            addTaggedAndUntaggedCandidate(candidates, seenUrls, primaryItemId, baseOptions, {
                fallbackMode: 'untagged-primary-fallback',
                imageType: 'Primary',
                requestedType: 'Primary',
                tag: primaryTag,
                taggedMode: 'tagged-primary',
                untaggedMode: 'untagged-primary'
            });
        },
        SeriesPrimary: () => {
            if (!includeSeriesPrimary) return;
            addTaggedAndUntaggedCandidate(candidates, seenUrls, seriesId, baseOptions, {
                fallbackMode: 'untagged-series-primary-fallback',
                imageType: 'Primary',
                requestedType: 'SeriesPrimary',
                tag: seriesPrimaryTag,
                taggedMode: 'series-primary',
                untaggedMode: 'untagged-series-primary'
            });
        },
        Thumb: () => {
            if (!includeThumb) return;
            addTaggedAndUntaggedCandidate(candidates, seenUrls, thumbItemId, baseOptions, {
                fallbackMode: 'untagged-thumb-fallback',
                imageType: 'Thumb',
                requestedType: 'Thumb',
                tag: thumbTag,
                taggedMode: 'tagged-thumb',
                untaggedMode: 'untagged-thumb'
            });
        }
    };

    order.forEach(imageType => {
        candidateBuilders[imageType]?.();
    });

    if (!candidates.length && shouldCollectDiagnostics()) {
        recordPtvEvent('image', 'image-candidates-empty', {
            itemId,
            itemName: getStringValue(item, 'Name', 'name'),
            itemType: getStringValue(item, 'Type', 'type'),
            requestedOrder: order
        });
    }

    return candidates;
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
    itemOrId: PtvImageItemInput,
    options: PtvImageOptions = {}
): string {
    const imageType = options.imageType || 'Primary';
    const imageIndex = options.imageIndex || 0;
    const item = typeof itemOrId === 'string' ? null : itemOrId;
    const itemId = getPtvImageRequestItemId(itemOrId, imageType);
    let tag = getItemImageTag(item, imageType, imageIndex) || 'untagged';

    if (options.tag !== undefined) {
        tag = options.tag || 'untagged';
    }

    return [
        getStringValue(item, 'ServerId', 'serverId') || options.serverId || 'current',
        itemId || 'missing',
        imageType.toLowerCase(),
        imageIndex,
        tag,
        options.fillWidth || options.width || options.maxWidth || '',
        options.fillHeight || options.height || options.maxHeight || ''
    ].join(':');
}
