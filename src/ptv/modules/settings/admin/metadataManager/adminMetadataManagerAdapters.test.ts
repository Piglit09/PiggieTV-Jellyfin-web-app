import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type';
import { MetadataField } from '@jellyfin/sdk/lib/generated-client/models/metadata-field';
import type { MetadataEditorInfo } from '@jellyfin/sdk/lib/generated-client/models/metadata-editor-info';
import { describe, expect, it, vi } from 'vitest';

import {
    areAdminMetadataFormsEqual,
    createAdminMetadataItemBundle,
    getAdminMetadataIdentifyType,
    getAdminMetadataEditableFields,
    normalizeAdminMetadataArtwork,
    normalizeAdminMetadataCatalogPage,
    normalizeAdminMetadataEditor,
    normalizeAdminMetadataForm,
    normalizeAdminMetadataIdentifyResults,
    normalizeAdminMetadataRemoteImagePage,
    normalizeAdminMetadataRemoteImageProviders,
    normalizeAdminMetadataRoot,
    patchAdminMetadataItem,
    requireAdminMetadataForm
} from './adminMetadataManagerAdapters';
import { ADMIN_METADATA_CATALOG_PAGE_SIZE } from './adminMetadataManagerModel';

function rawItem(overrides: Partial<BaseItemDto> = {}): BaseItemDto {
    return {
        BackdropImageTags: [ 'backdrop-tag' ],
        CommunityRating: 8.1,
        CriticRating: 77,
        CustomRating: 'PG-13',
        EndDate: '2025-05-06T12:00:00Z',
        ForcedSortName: 'Example, The',
        Genres: [ 'Drama' ],
        Id: 'item-a',
        ImageTags: { Primary: 'primary-tag' },
        IndexNumber: 3,
        IsFolder: false,
        LockData: false,
        LockedFields: [ MetadataField.Overview ],
        Name: 'The Example',
        OfficialRating: 'PG',
        OriginalTitle: 'Original Example',
        Overview: 'An overview.',
        ParentId: 'parent-a',
        ParentIndexNumber: 2,
        People: [{
            Id: 'person-a',
            Name: 'Actor One',
            Role: 'Lead',
            Type: 'Actor',
            FuturePersonField: { retained: true }
        } as never],
        PremiereDate: '2024-01-02T05:00:00Z',
        ProductionLocations: [ 'US' ],
        ProductionYear: 2024,
        ProviderIds: { Imdb: 'tt123', UnknownPlugin: 'plugin-7' },
        RunTimeTicks: 3_600_000_000,
        Studios: [{ Id: 'studio-a', Name: 'Studio One', FutureStudioField: true } as never],
        Taglines: [ 'First tagline', 'Preserved secondary tagline' ],
        Tags: [ 'Featured' ],
        Type: 'Movie',
        ...overrides
    };
}

const editorInfo: MetadataEditorInfo = {
    ExternalIdInfos: [
        { Key: 'Imdb', Name: 'IMDb', Type: 'Movie' },
        { Key: 'Tmdb', Name: 'TheMovieDb', Type: 'Movie' }
    ],
    ParentalRatingOptions: [ { Name: 'PG' }, { Name: 'R' } ]
};

describe('Metadata Manager adapters', () => {
    it('normalizes roots without exposing paths and fails closed for incomplete identity', () => {
        const root = normalizeAdminMetadataRoot(rawItem({
            ChildCount: 42,
            CollectionType: 'movies',
            IsFolder: true,
            Path: 'C:\\private\\movies',
            Type: 'CollectionFolder'
        }));

        expect(root).toEqual({
            childCount: 42,
            collectionType: 'movies',
            id: 'item-a',
            name: 'The Example',
            primaryImageTag: 'primary-tag',
            type: 'CollectionFolder'
        });
        expect(root).not.toHaveProperty('Path');
        expect(() => normalizeAdminMetadataRoot(rawItem({ Id: undefined }))).toThrowError(
            expect.objectContaining({ code: 'invalid-response' })
        );
    });

    it('normalizes bounded catalog pages without converting an unknown total to zero', () => {
        const page = normalizeAdminMetadataCatalogPage({
            Items: Array.from({ length: ADMIN_METADATA_CATALOG_PAGE_SIZE }, (_, index) =>
                rawItem({ Id: `item-${index}`, Name: `Item ${index}` })),
            TotalRecordCount: undefined
        }, 0, 'search');

        expect(page.limit).toBe(50);
        expect(page.totalRecordCount).toBeNull();
        expect(page.hasNextPage).toBe(true);
        expect(page.scope).toBe('search');
        expect(page.items[0]).not.toHaveProperty('ProviderIds');
        expect(normalizeAdminMetadataCatalogPage({ Items: null, TotalRecordCount: 0 }, 0, 'children').items)
            .toEqual([]);
    });

    it('creates normalized item, form, editor and ancestor projections', () => {
        const bundle = createAdminMetadataItemBundle(
            rawItem(),
            editorInfo,
            [ rawItem({ Id: 'library-a', Name: 'Movies', Type: 'CollectionFolder' }) ]
        );

        expect(bundle.item).toMatchObject({ id: 'item-a', name: 'The Example', type: 'Movie' });
        expect(bundle.form).toMatchObject({
            endDate: '2025-05-06',
            premiereDate: '2024-01-02',
            runtimeMinutes: 6
        });
        expect(bundle.ancestors).toEqual([{ id: 'library-a', name: 'Movies', type: 'CollectionFolder' }]);
        expect(bundle.editor.providerFields).toEqual([
            { available: true, key: 'Imdb', label: 'IMDb', type: 'Movie', value: 'tt123' },
            { available: true, key: 'Tmdb', label: 'TheMovieDb', type: 'Movie', value: null },
            { available: false, key: 'UnknownPlugin', label: 'UnknownPlugin', type: null, value: 'plugin-7' }
        ]);
        expect(bundle.editor.parentalRatings).toEqual([
            { label: 'PG', value: 'PG' },
            { label: 'R', value: 'R' }
        ]);
    });

    it('computes safe field relevance for episodes, series and unknown types', () => {
        const episodeFields = getAdminMetadataEditableFields(rawItem({ Type: 'Episode' }), editorInfo);
        expect(episodeFields).toEqual(expect.arrayContaining([
            'indexNumber', 'parentIndexNumber', 'people', 'premiereDate', 'providerIds'
        ]));
        expect(episodeFields).not.toContain('endDate');
        expect(episodeFields).not.toContain('runtimeMinutes');

        const seriesFields = getAdminMetadataEditableFields(rawItem({ Type: 'Series' }), editorInfo);
        expect(seriesFields).toEqual(expect.arrayContaining([ 'endDate', 'runtimeMinutes' ]));

        const readingFields = getAdminMetadataEditableFields(rawItem({
            ProviderIds: undefined,
            Type: 'Book'
        }), {});
        expect(readingFields).toEqual(expect.arrayContaining([
            'indexNumber', 'parentIndexNumber', 'providerIds'
        ]));

        const unknownFields = getAdminMetadataEditableFields(rawItem({
            LockedFields: undefined,
            LockData: undefined,
            ProviderIds: undefined,
            Type: 'FuturePluginItem' as never
        }), {});
        expect(unknownFields).toEqual([ 'name', 'sortName', 'overview', 'genres', 'tags' ]);
    });

    it('compares material values while ignoring raw source-object identity and provider key order', () => {
        const left = normalizeAdminMetadataForm(rawItem());
        const right = {
            ...left,
            people: left.people.map(person => ({
                ...person,
                source: { ...person.source, AnotherUnknownField: true } as never
            })),
            providerIds: { UnknownPlugin: 'plugin-7', Imdb: 'tt123' }
        };

        expect(areAdminMetadataFormsEqual(left, right)).toBe(true);
        expect(areAdminMetadataFormsEqual(left, { ...right, overview: 'Changed' })).toBe(false);
        expect(areAdminMetadataFormsEqual(left, { ...right, name: '' })).toBe(false);
    });

    it('patches only changed relevant fields onto a deep fresh clone', () => {
        const original = rawItem({
            FutureTopLevel: { nested: [ { retained: true } ] }
        } as never);
        const confirmed = normalizeAdminMetadataForm(original);
        const desired = {
            ...confirmed,
            name: 'Renamed',
            overview: 'Updated overview',
            people: confirmed.people.map(person => ({ ...person, role: 'Updated role' })),
            providerIds: { ...confirmed.providerIds, Imdb: 'tt999' },
            tagline: ''
        };
        const fresh = rawItem({
            ...original,
            People: [{
                ...original.People![0],
                FuturePersonField: { retained: 'fresh' }
            } as never]
        });

        const patched = patchAdminMetadataItem(
            fresh,
            desired,
            confirmed,
            getAdminMetadataEditableFields(fresh, editorInfo)
        );

        expect(patched.Name).toBe('Renamed');
        expect(patched.Overview).toBe('Updated overview');
        expect(patched.Taglines).toEqual([ 'Preserved secondary tagline' ]);
        expect(patched.ProviderIds).toEqual({ Imdb: 'tt999', UnknownPlugin: 'plugin-7' });
        expect(Reflect.get(patched, 'FutureTopLevel')).toEqual({ nested: [ { retained: true } ] });
        expect(Reflect.get(patched.People![0], 'FuturePersonField')).toEqual({ retained: 'fresh' });
        expect(patched.People![0].Role).toBe('Updated role');
        expect(Reflect.get(patched.Studios![0], 'FutureStudioField')).toBe(true);
        expect(patched).not.toBe(fresh);
        expect(patched.People).not.toBe(fresh.People);
    });

    it('does not patch a changed form field that is irrelevant for the item type', () => {
        const folder = rawItem({ Type: 'Folder' });
        const confirmed = normalizeAdminMetadataForm(folder);
        const desired = { ...confirmed, productionYear: 2040 };
        const patched = patchAdminMetadataItem(
            folder,
            desired,
            confirmed,
            getAdminMetadataEditableFields(folder, editorInfo)
        );

        expect(patched.ProductionYear).toBe(folder.ProductionYear);
    });

    it('validates title, dates, numbers, provider IDs, people and studios', () => {
        const valid = normalizeAdminMetadataForm(rawItem());
        expect(requireAdminMetadataForm(valid)).toBe(valid);
        expect(() => requireAdminMetadataForm({ ...valid, name: ' ' })).toThrowError(
            expect.objectContaining({ code: 'invalid-input' })
        );
        expect(() => requireAdminMetadataForm({ ...valid, premiereDate: 'not-a-date' })).toThrow();
        expect(() => requireAdminMetadataForm({ ...valid, productionYear: 2024.5 })).toThrow();
        expect(() => requireAdminMetadataForm({
            ...valid,
            people: [{ id: null, name: '', role: '', source: null, type: 'Actor' }]
        })).toThrow();
    });

    it('normalizes artwork without exposing server filesystem paths', () => {
        const getItemImageUrlById = vi.fn(() => '/Items/item-a/Images/Primary');
        const images = normalizeAdminMetadataArtwork({ getItemImageUrlById } as never, 'item-a', [{
            Height: 900,
            ImageIndex: null,
            ImageTag: 'tag-a',
            ImageType: ImageType.Primary,
            Path: 'C:\\private\\poster.jpg',
            Size: 1234,
            Width: 600
        }]);

        expect(images[0]).toMatchObject({
            height: 900,
            imageType: ImageType.Primary,
            index: 0,
            itemId: 'item-a',
            previewUrl: '/Items/item-a/Images/Primary',
            size: 1234,
            width: 600
        });
        expect(images[0]).not.toHaveProperty('path');
        expect(getItemImageUrlById).toHaveBeenCalledWith('item-a', ImageType.Primary, {
            imageIndex: 0,
            maxWidth: 400,
            tag: 'tag-a'
        });
    });

    it('normalizes remote provider and paged result models independently', () => {
        const providers = normalizeAdminMetadataRemoteImageProviders([
            { Name: 'TMDb', SupportedImages: [ ImageType.Primary ] },
            { Name: 'TMDb', SupportedImages: [ ImageType.Backdrop ] },
            { Name: '' }
        ]);
        const page = normalizeAdminMetadataRemoteImagePage({
            Images: [{
                CommunityRating: 8,
                Height: 1500,
                Language: 'en',
                ProviderName: 'TMDb',
                ThumbnailUrl: 'https://images/thumb.jpg',
                Type: ImageType.Primary,
                Url: 'https://images/full.jpg',
                Width: 1000
            }],
            TotalRecordCount: 31
        }, 0);

        expect(providers).toEqual([{ name: 'TMDb', supportedImageTypes: [ ImageType.Primary ] }]);
        expect(page).toMatchObject({ hasNextPage: true, limit: 30, startIndex: 0, totalRecordCount: 31 });
        expect(page.items[0]).toMatchObject({
            imageType: ImageType.Primary,
            providerName: 'TMDb',
            url: 'https://images/full.jpg'
        });
    });

    it('normalizes provider descriptions and image URLs while preserving the apply source', () => {
        const source = {
            ImageUrl: 'https://images/poster.jpg',
            Name: '<b>Untrusted title</b>',
            Overview: '<script>not visible</script><p><em>Readable provider prose.</em></p>',
            ProductionYear: 1999,
            ProviderIds: { Imdb: 'tt0133093' },
            SearchProviderName: 'TMDb'
        };
        const results = normalizeAdminMetadataIdentifyResults([ source ]);

        expect(results[0]).toMatchObject({
            name: '<b>Untrusted title</b>',
            overview: 'Readable provider prose.',
            providerName: 'TMDb',
            year: 1999
        });
        expect(results[0].imageUrl).toBe('https://images/poster.jpg');
        expect(results[0].source).toBe(source);
        expect(getAdminMetadataIdentifyType('Movie')).toBe('Movie');
        expect(getAdminMetadataIdentifyType('Episode')).toBeNull();
    });

    it('rejects unsafe identify result images and sanitizes encoded provider markup', () => {
        const javascriptUrl = `${[ 'java', 'script' ].join('')}:alert(1)`;
        const [ result ] = normalizeAdminMetadataIdentifyResults([{
            ImageUrl: javascriptUrl,
            Name: 'Provider candidate',
            Overview: '&lt;p&gt;First paragraph.&lt;/p&gt;&lt;p onmouseover=alert(1)&gt;Second paragraph.&lt;/p&gt;',
            SearchProviderName: 'Comic Vine'
        }]);

        expect(result.imageUrl).toBeNull();
        expect(result.overview).toBe('First paragraph.\n\nSecond paragraph.');
    });

    it('normalizes a provider stored outside current capability discovery as unavailable', () => {
        const editor = normalizeAdminMetadataEditor(rawItem({
            ProviderIds: { RemovedPlugin: 'kept' }
        }), { ExternalIdInfos: [] });

        expect(editor.providerFields).toEqual([{
            available: false,
            key: 'RemovedPlugin',
            label: 'RemovedPlugin',
            type: null,
            value: 'kept'
        }]);
    });
});
