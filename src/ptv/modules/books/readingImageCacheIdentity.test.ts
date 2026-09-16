import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
    getPtvItemImageCandidates: vi.fn(),
    getPtvServerId: vi.fn(() => 'current-server')
}));

vi.mock('../../api', () => ({
    cleanPtvQuery: vi.fn((query: Record<string, unknown> | undefined) => query),
    getPtvApiUrl: vi.fn((endpoint: string) => `https://jellyfin.test/${endpoint}`),
    getPtvCurrentUserId: vi.fn(() => 'user-a'),
    getPtvItem: vi.fn(),
    getPtvItemImageCandidates: apiMocks.getPtvItemImageCandidates,
    getPtvItems: vi.fn(),
    getPtvServerId: apiMocks.getPtvServerId,
    getPtvUserViews: vi.fn()
}));

vi.mock('../../core/observability', () => ({
    recordPtvEvent: vi.fn(),
    recordPtvTiming: vi.fn(),
    timePtvAsync: vi.fn(async (
        _category: string,
        _name: string,
        task: () => Promise<unknown>
    ) => task())
}));

vi.mock('../../services/runtimeStability', () => ({
    clearPtvLocalStorageByPrefix: vi.fn(() => 0),
    readPtvLocalStorageJson: vi.fn((_key: string, fallback: unknown) => fallback),
    removePtvLocalStorageKey: vi.fn(),
    writePtvLocalStorageJson: vi.fn(() => true)
}));

vi.mock('../../utils/libraryIndexCache', () => ({
    deletePtvLibraryIndexCache: vi.fn(async () => undefined),
    deletePtvLibraryIndexCacheByPrefix: vi.fn(async () => undefined),
    ['PTV_LIBRARY_INDEX_CACHE_TTL_MS']: 24 * 60 * 60 * 1000,
    readPtvLibraryIndexCache: vi.fn(async () => null),
    writePtvLibraryIndexCache: vi.fn(async () => true)
}));

import { getPtvReadingImagePlaceholder, getPtvReadingImageUrl } from './booksApi';
import type { PtvReadingItem } from './booksTypes';

type CandidateOptions = {
    baseOptions?: {
        fillHeight?: number;
        fillWidth?: number;
        quality?: number;
        serverId?: string;
    };
    order?: string[];
};

function getRecordString(record: Record<string, unknown>, key: string) {
    const value = record[key];

    return typeof value === 'string' ? value : '';
}

describe('Reading image URL cache identity', () => {
    beforeEach(() => {
        apiMocks.getPtvItemImageCandidates.mockReset();
        apiMocks.getPtvItemImageCandidates.mockImplementation((
            item: PtvReadingItem,
            options: CandidateOptions = {}
        ) => {
            const imageTags = item.ImageTags || {};
            const primaryTag = imageTags.Primary || getRecordString(item, 'PrimaryImageTag');
            const backdropTag = item.BackdropImageTags?.[0] || '';
            const requestedType = (options.order || [ 'Primary', 'Backdrop' ])
                .find(type => {
                    if (type === 'Primary') return Boolean(primaryTag);
                    if (type === 'Backdrop') return Boolean(backdropTag);

                    return false;
                });
            const tag = requestedType === 'Backdrop' ? backdropTag : primaryTag;

            if (!tag || !requestedType) return [];

            const imageItemId = item.Id || 'missing-item';
            const serverId = item.ServerId || options.baseOptions?.serverId || 'missing-server';
            const params = [
                `fillHeight=${options.baseOptions?.fillHeight || ''}`,
                `fillWidth=${options.baseOptions?.fillWidth || ''}`,
                `quality=${options.baseOptions?.quality || ''}`,
                `tag=${tag}`
            ].join('&');

            return [{
                imageItemId,
                imageType: requestedType,
                requestedType,
                tag,
                tagMode: `tagged-${requestedType.toLowerCase()}`,
                url: `https://${serverId}.test/Items/${imageItemId}/Images/${requestedType}?${params}`
            }];
        });
    });

    it('returns the newly tagged URL when a top-level PrimaryImageTag changes', () => {
        const originalUrl = getPtvReadingImageUrl({
            Id: 'same-reading-item',
            PrimaryImageTag: 'primary-before',
            ServerId: 'server-a'
        } as PtvReadingItem);
        const refreshedUrl = getPtvReadingImageUrl({
            Id: 'same-reading-item',
            PrimaryImageTag: 'primary-after',
            ServerId: 'server-a'
        } as PtvReadingItem);

        expect(originalUrl).toContain('tag=primary-before');
        expect(refreshedUrl).toContain('tag=primary-after');
        expect(refreshedUrl).not.toBe(originalUrl);
    });

    it('does not retain a placeholder after a top-level PrimaryImageTag becomes available', () => {
        const withoutArtwork = getPtvReadingImageUrl({
            Id: 'newly-identified-reading-item',
            ServerId: 'server-a'
        } as PtvReadingItem);
        const withArtwork = getPtvReadingImageUrl({
            Id: 'newly-identified-reading-item',
            PrimaryImageTag: 'identified-artwork-tag',
            ServerId: 'server-a'
        } as PtvReadingItem);

        expect(withoutArtwork).toBe(getPtvReadingImagePlaceholder());
        expect(withArtwork).toContain('tag=identified-artwork-tag');
    });

    it('does not resolve backdrop-only artwork as a portrait cover', () => {
        const coverUrl = getPtvReadingImageUrl({
            BackdropImageTags: [ 'backdrop-only-tag' ],
            Id: 'backdrop-only-reading-item',
            ServerId: 'server-a'
        } as PtvReadingItem, 420, 'Primary');

        expect(coverUrl).toBe(getPtvReadingImagePlaceholder());
    });

    it('isolates identical item and tag identities across Jellyfin servers', () => {
        const firstServerUrl = getPtvReadingImageUrl({
            Id: 'shared-reading-item',
            PrimaryImageTag: 'shared-primary-tag',
            ServerId: 'server-one'
        } as PtvReadingItem);
        const secondServerUrl = getPtvReadingImageUrl({
            Id: 'shared-reading-item',
            PrimaryImageTag: 'shared-primary-tag',
            ServerId: 'server-two'
        } as PtvReadingItem);

        expect(firstServerUrl).toContain('https://server-one.test/');
        expect(secondServerUrl).toContain('https://server-two.test/');
        expect(secondServerUrl).not.toBe(firstServerUrl);
    });
});
