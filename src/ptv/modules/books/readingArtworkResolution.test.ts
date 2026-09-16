import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
    getPtvItemImageCandidates: vi.fn(),
    getPtvItems: vi.fn(),
    getPtvServerId: vi.fn(() => 'current-server'),
    getPtvUserViews: vi.fn()
}));

vi.mock('../../api', () => ({
    cleanPtvQuery: vi.fn((query: Record<string, unknown> | undefined) => query),
    getPtvApiUrl: vi.fn((endpoint: string) => `https://jellyfin.test/${endpoint}`),
    getPtvCurrentUserId: vi.fn(() => 'user-a'),
    getPtvItem: vi.fn(),
    getPtvItemImageCandidates: apiMocks.getPtvItemImageCandidates,
    getPtvItems: apiMocks.getPtvItems,
    getPtvServerId: apiMocks.getPtvServerId,
    getPtvUserViews: apiMocks.getPtvUserViews
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

import {
    getPtvReadingArtworkResolution,
    type PtvReadingArtworkResolution
} from './booksApi';
import {
    createPtvReadingArtworkLifecycle,
    getPtvReadingArtworkActiveSource,
    transitionPtvReadingArtworkLifecycle
} from './readingArtworkLifecycle';
import type { PtvReadingItem } from './booksTypes';

type CandidateRequest = 'Backdrop' | 'ParentPrimary' | 'Primary' | 'SeriesPrimary' | 'Thumb';
type CandidateOptions = Readonly<{
    baseOptions?: Readonly<{
        fillHeight?: number;
        fillWidth?: number;
        quality?: number;
        serverId?: string;
    }>;
    order?: readonly CandidateRequest[];
}>;

function getString(item: PtvReadingItem, key: keyof PtvReadingItem) {
    const value = item[key];

    return typeof value === 'string' ? value : '';
}

function createCandidate(
    item: PtvReadingItem,
    requestedType: CandidateRequest,
    options: CandidateOptions
) {
    const ownPrimaryTag = item.ImageTags?.Primary || getString(item, 'PrimaryImageTag');
    const ownThumbTag = item.ImageTags?.Thumb || getString(item, 'ThumbImageTag');
    const definitions = {
        Backdrop: {
            imageItemId: item.Id || '',
            imageType: 'Backdrop',
            tag: item.BackdropImageTags?.[0] || ''
        },
        ParentPrimary: {
            imageItemId: getString(item, 'ParentPrimaryImageItemId'),
            imageType: 'Primary',
            tag: getString(item, 'ParentPrimaryImageTag')
        },
        Primary: {
            imageItemId: item.Id || '',
            imageType: 'Primary',
            tag: ownPrimaryTag
        },
        SeriesPrimary: {
            imageItemId: item.SeriesId || '',
            imageType: 'Primary',
            tag: getString(item, 'SeriesPrimaryImageTag')
        },
        Thumb: {
            imageItemId: item.Id || '',
            imageType: 'Thumb',
            tag: ownThumbTag
        }
    } as const;
    const definition = definitions[requestedType];

    if (!definition.imageItemId || !definition.tag) return null;

    const serverId = item.ServerId || options.baseOptions?.serverId || 'missing-server';
    const params = [
        `fillHeight=${options.baseOptions?.fillHeight || ''}`,
        `fillWidth=${options.baseOptions?.fillWidth || ''}`,
        `quality=${options.baseOptions?.quality || ''}`,
        `tag=${definition.tag}`
    ].join('&');

    return {
        ...definition,
        requestedType,
        tagMode: `tagged-${requestedType.toLowerCase()}`,
        url: `https://${serverId}.test/Items/${definition.imageItemId}/Images/${definition.imageType}?${params}`
    };
}

function toLifecycle(resolution: PtvReadingArtworkResolution) {
    return createPtvReadingArtworkLifecycle({
        generation: resolution.generation,
        identity: `reading:${resolution.surface}`,
        placeholderSrc: '/reading-placeholder.svg',
        sources: resolution.candidates.map(candidate => ({
            kind: candidate.kind,
            src: candidate.src
        }))
    });
}

function failActiveSource(state: ReturnType<typeof createPtvReadingArtworkLifecycle>) {
    return transitionPtvReadingArtworkLifecycle(state, {
        attemptKey: state.attemptKey,
        lifecycleKey: state.lifecycleKey,
        type: 'error'
    });
}

describe('Reading surface artwork resolution', () => {
    beforeEach(() => {
        apiMocks.getPtvItemImageCandidates.mockReset();
        apiMocks.getPtvItems.mockReset();
        apiMocks.getPtvUserViews.mockReset();
        apiMocks.getPtvItemImageCandidates.mockImplementation((
            item: PtvReadingItem,
            options: CandidateOptions = {}
        ) => (options.order || []).flatMap(requestedType => {
            const candidate = createCandidate(item, requestedType, options);

            return candidate ? [ candidate ] : [];
        }));
    });

    it('A: keeps Primary for portrait covers while preferring Backdrop on backdrop surfaces', () => {
        const item = {
            BackdropImageTags: [ 'backdrop-tag' ],
            Id: 'primary-and-backdrop',
            ImageTags: { Primary: 'primary-tag' },
            ServerId: 'server-a'
        } as PtvReadingItem;
        const cover = getPtvReadingArtworkResolution(item, 420, 'cover');
        const backdrop = getPtvReadingArtworkResolution(item, 900, 'backdrop');

        expect(cover.candidates.map(candidate => candidate.kind)).toEqual([ 'primary' ]);
        expect(backdrop.candidates.map(candidate => candidate.kind)).toEqual([ 'backdrop', 'primary' ]);
        expect(cover.generation).not.toBe(backdrop.generation);
    });

    it('B: uses Primary on both cover and backdrop surfaces when it is the only art', () => {
        const item = {
            Id: 'primary-only',
            ImageTags: { Primary: 'primary-only-tag' },
            ServerId: 'server-a'
        } as PtvReadingItem;

        expect(getPtvReadingArtworkResolution(item, 420, 'cover').candidates.map(candidate => candidate.kind))
            .toEqual([ 'primary' ]);
        expect(getPtvReadingArtworkResolution(item, 900, 'backdrop').candidates.map(candidate => candidate.kind))
            .toEqual([ 'primary' ]);
    });

    it('C: resolves Backdrop only for surfaces that permit landscape artwork', () => {
        const item = {
            BackdropImageTags: [ 'backdrop-only-tag' ],
            Id: 'backdrop-only',
            ServerId: 'server-a'
        } as PtvReadingItem;
        const cover = getPtvReadingArtworkResolution(item, 420, 'cover');
        const backdrop = getPtvReadingArtworkResolution(item, 900, 'backdrop');

        expect(cover.candidates).toEqual([]);
        expect(backdrop.candidates).toHaveLength(1);
        expect(backdrop.candidates[0]).toMatchObject({
            imageItemId: 'backdrop-only',
            imageType: 'Backdrop',
            kind: 'backdrop',
            requestedType: 'Backdrop',
            tag: 'backdrop-only-tag'
        });
    });

    it('D: leaves candidate lists empty when no suitable artwork exists', () => {
        const item = {
            Id: 'missing-art',
            ServerId: 'server-a'
        } as PtvReadingItem;

        expect(getPtvReadingArtworkResolution(item, 420, 'cover').candidates).toEqual([]);
        expect(getPtvReadingArtworkResolution(item, 900, 'backdrop').candidates).toEqual([]);
    });

    it('E: preserves a valid Backdrop independently of a failing Primary on a backdrop surface', () => {
        const resolution = getPtvReadingArtworkResolution({
            BackdropImageTags: [ 'usable-backdrop-tag' ],
            Id: 'primary-failure-with-backdrop',
            ImageTags: { Primary: 'broken-primary-tag' },
            ServerId: 'server-a'
        } as PtvReadingItem, 900, 'backdrop');
        const initial = toLifecycle(resolution);

        expect(initial.sources.map(source => source.kind)).toEqual([ 'backdrop', 'primary', 'placeholder' ]);
        expect(getPtvReadingArtworkActiveSource(initial).kind).toBe('backdrop');
    });

    it('F: advances from a failed Backdrop to Primary and then the terminal placeholder', () => {
        const resolution = getPtvReadingArtworkResolution({
            BackdropImageTags: [ 'broken-backdrop-tag' ],
            Id: 'backdrop-failure-chain',
            ImageTags: { Primary: 'primary-fallback-tag' },
            ServerId: 'server-a'
        } as PtvReadingItem, 900, 'backdrop');
        const initial = toLifecycle(resolution);
        const backdropFailure = failActiveSource(initial);
        const primaryFailure = failActiveSource(backdropFailure.state);
        const placeholderFailure = failActiveSource(primaryFailure.state);

        expect(backdropFailure.outcome).toMatchObject({
            nextSource: 'primary',
            source: 'backdrop',
            terminal: false
        });
        expect(getPtvReadingArtworkActiveSource(backdropFailure.state).kind).toBe('primary');
        expect(primaryFailure.outcome).toMatchObject({
            nextSource: 'placeholder',
            source: 'primary',
            terminal: false
        });
        expect(placeholderFailure.outcome).toMatchObject({
            source: 'placeholder',
            terminal: true
        });
    });

    it('isolates artwork resolution from User Views and collection-list requests', () => {
        const resolution = getPtvReadingArtworkResolution({
            BackdropImageTags: [ 'backdrop-only-tag' ],
            Id: 'isolated-artwork-item',
            ServerId: 'server-a'
        } as PtvReadingItem, 900, 'backdrop');

        expect(resolution.candidates).toHaveLength(1);
        expect(new Set(resolution.candidates.map(candidate => candidate.src)).size)
            .toBe(resolution.candidates.length);
        expect(apiMocks.getPtvUserViews).not.toHaveBeenCalled();
        expect(apiMocks.getPtvItems).not.toHaveBeenCalled();
    });
});
