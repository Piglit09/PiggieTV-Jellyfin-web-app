import type { LibraryOptionsResultDto } from '@jellyfin/sdk/lib/generated-client/models/library-options-result-dto';
import type { LibraryOptions } from '@jellyfin/sdk/lib/generated-client/models/library-options';
import type { VirtualFolderInfo } from '@jellyfin/sdk/lib/generated-client/models/virtual-folder-info';
import { describe, expect, it } from 'vitest';

import {
    areAdminLibraryProviderConfigurationsEqual,
    areAdminLibraryProvidersEqual,
    areAdminLibraryOptionsEqual,
    buildAdminLibraryOptionsPatch,
    buildDefaultAdminLibraryOptions,
    getAdminLibraryLocations,
    getAdminLibraryTypePresentation,
    normalizeAdminLibraries,
    normalizeAdminLibraryDetail,
    normalizeAdminLibraryOptions,
    normalizeAdminLibraryProviders,
    patchAdminLibraryOptions,
    patchAdminLibraryProviders,
    selectAdminLibraries
} from './adminLibrariesAdapters';
import type {
    AdminLibraryOptionsForm,
    AdminLibraryProviderSummary
} from './adminLibrariesModel';

function folder(overrides: Partial<VirtualFolderInfo> = {}): VirtualFolderInfo {
    return {
        CollectionType: 'movies',
        ItemId: 'library-a',
        LibraryOptions: {
            Enabled: true,
            PathInfos: [{ Path: '/media/movies' }]
        },
        Locations: ['/media/movies'],
        Name: 'Movies',
        ...overrides
    };
}

function optionsForm(overrides: Partial<AdminLibraryOptionsForm> = {}): AdminLibraryOptionsForm {
    return {
        automaticallyAddToCollection: false,
        automaticSeriesGrouping: false,
        chapterImages: false,
        chapterImagesDuringScan: false,
        embeddedEpisodeInfo: false,
        embeddedExtrasTitles: false,
        embeddedTitles: false,
        enabled: true,
        lufsAnalysis: true,
        photos: true,
        realTimeMonitoring: true,
        saveLocalMetadata: false,
        saveTrickplayWithMedia: false,
        trickplayImages: false,
        trickplayImagesDuringScan: false,
        ...overrides
    };
}

describe('administrator library normalization', () => {
    it('maps known content types and keeps an unknown type explicit', () => {
        expect(getAdminLibraryTypePresentation(' TVSHOWS ')).toEqual({
            icon: 'shows',
            kind: 'shows',
            label: 'Shows'
        });
        expect(getAdminLibraryTypePresentation('concerts')).toEqual({
            icon: 'library',
            kind: 'other',
            label: 'Other'
        });
        expect(getAdminLibraryTypePresentation(undefined)).toEqual({
            icon: 'libraries',
            kind: 'mixed',
            label: 'Mixed Media'
        });
    });

    it('normalizes malformed libraries without turning them into manageable records', () => {
        const [ malformed ] = normalizeAdminLibraries([ folder({
            CollectionType: undefined,
            ItemId: ' ',
            LibraryOptions: undefined,
            Locations: undefined,
            Name: undefined
        }) ]);

        expect(malformed).toMatchObject({
            collectionType: '',
            displayType: 'Mixed Media',
            folderCount: 0,
            id: null,
            kind: 'mixed',
            manageable: false,
            name: 'Unnamed library',
            optionsAvailable: false,
            warning: 'The server did not provide a library name.'
        });
    });

    it('deduplicates locations across both authoritative location fields', () => {
        const value = folder({
            LibraryOptions: {
                PathInfos: [
                    { Path: '/media/movies' },
                    { Path: '/media/archive' },
                    { Path: '' }
                ]
            },
            Locations: ['/media/movies', '/media/new', undefined as unknown as string]
        });

        expect(getAdminLibraryLocations(value)).toEqual([
            '/media/movies',
            '/media/new',
            '/media/archive'
        ]);
    });

    it('treats Collections as server managed and reports scan state from its own signal', () => {
        const [ collection ] = normalizeAdminLibraries([ folder({
            CollectionType: 'boxsets',
            Name: 'Collections',
            RefreshStatus: 'Active'
        }) ]);

        expect(collection).toMatchObject({
            displayType: 'Collections',
            kind: 'collections',
            pathManagementSupported: false,
            removable: false,
            scanState: 'running'
        });
    });

    it('recognizes Jellyfin Queued and Active refresh states without treating idle zero progress as scanning', () => {
        expect(normalizeAdminLibraries([
            folder({ RefreshProgress: 0, RefreshStatus: 'Idle' }),
            folder({ ItemId: 'library-b', Name: 'Shows', RefreshProgress: 0, RefreshStatus: 'Queued' }),
            folder({ ItemId: 'library-c', Name: 'Music', RefreshStatus: 'Active' }),
            folder({ ItemId: 'library-d', Name: 'Archive', RefreshStatus: 'Idle' })
        ]).map(value => [ value.scanState, value.refreshProgress ])).toEqual([
            [ 'idle', 0 ],
            [ 'running', 0 ],
            [ 'running', null ],
            [ 'idle', null ]
        ]);
    });

    it('marks scan status unavailable when its source failed without hiding item-level activity', () => {
        expect(normalizeAdminLibraries([
            folder(),
            folder({ ItemId: 'library-b', Name: 'Shows', RefreshProgress: 12 })
        ], false).map(value => value.scanState)).toEqual([
            'unavailable',
            'running'
        ]);
    });

    it('filters and searches normalized records locally', () => {
        const libraries = normalizeAdminLibraries([
            folder(),
            folder({ CollectionType: 'tvshows', ItemId: 'library-b', Name: 'Family Shows' })
        ]);

        expect(selectAdminLibraries(libraries, {
            filter: 'shows',
            query: ' FAMILY '
        }).map(value => value.id)).toEqual(['library-b']);
    });
});

describe('administrator library options normalization', () => {
    it('keeps unavailable booleans distinct from false', () => {
        expect(normalizeAdminLibraryOptions({
            EnablePhotos: false,
            EnableRealtimeMonitor: true,
            SaveLocalMetadata: false,
            Enabled: undefined
        })).toMatchObject({
            enabled: null,
            photos: false,
            realTimeMonitoring: true,
            saveLocalMetadata: false,
            trickplayImages: null
        });
    });

    it('normalizes ordered provider choices without losing unavailable configured names', () => {
        const available: LibraryOptionsResultDto = {
            MetadataSavers: [
                { DefaultEnabled: true, Name: 'Nfo' },
                { DefaultEnabled: false, Name: 'Custom saver' }
            ],
            TypeOptions: [{
                ImageFetchers: [
                    { DefaultEnabled: true, Name: 'TheMovieDb' },
                    { DefaultEnabled: false, Name: 'Fanart' }
                ],
                MetadataFetchers: [
                    { DefaultEnabled: true, Name: 'TheMovieDb' },
                    { DefaultEnabled: false, Name: 'Secondary metadata' }
                ],
                Type: 'Movie'
            }]
        };

        const normalized = normalizeAdminLibraryProviders({
            MetadataSavers: [],
            TypeOptions: [{
                ImageFetcherOrder: [
                    'TheMovieDb',
                    'Fanart',
                    'Removed ordered provider',
                    'Removed selected provider'
                ],
                ImageFetchers: ['Fanart', 'Removed selected provider'],
                MetadataFetcherOrder: ['Secondary metadata', 'TheMovieDb'],
                MetadataFetchers: undefined,
                Type: 'Movie'
            }]
        }, available);

        expect(normalized.metadataSavers).toEqual([
            { available: true, enabled: false, name: 'Nfo' },
            { available: true, enabled: false, name: 'Custom saver' }
        ]);
        expect(normalized.groups).toEqual([{
            imageProviders: [
                { available: true, enabled: false, name: 'TheMovieDb' },
                { available: true, enabled: true, name: 'Fanart' },
                { available: false, enabled: false, name: 'Removed ordered provider' },
                { available: false, enabled: true, name: 'Removed selected provider' }
            ],
            mediaType: 'Movie',
            metadataProviders: [
                { available: true, enabled: false, name: 'Secondary metadata' },
                { available: true, enabled: true, name: 'TheMovieDb' }
            ]
        }]);
    });

    it('uses discovery defaults only when a configured provider array is absent', () => {
        const available: LibraryOptionsResultDto = {
            TypeOptions: [{
                MetadataFetchers: [
                    { DefaultEnabled: true, Name: 'Default provider' },
                    { DefaultEnabled: false, Name: 'Optional provider' }
                ],
                Type: 'Movie'
            }]
        };

        const absent = normalizeAdminLibraryProviders({ TypeOptions: [{ Type: 'Movie' }] }, available);
        const explicitEmpty = normalizeAdminLibraryProviders({
            TypeOptions: [{ MetadataFetchers: [], Type: 'Movie' }]
        }, available);

        expect(absent.groups[0]?.metadataProviders.map(choice => choice.enabled)).toEqual([ true, false ]);
        expect(explicitEmpty.groups[0]?.metadataProviders.map(choice => choice.enabled)).toEqual([ false, false ]);
    });

    it('compares provider edits while ignoring availability-only changes', () => {
        const left: AdminLibraryProviderSummary = {
            groups: [{
                imageProviders: [{ available: true, enabled: false, name: 'Artwork' }],
                mediaType: 'Movie',
                metadataProviders: [
                    { available: true, enabled: true, name: 'Primary' },
                    { available: false, enabled: false, name: 'Secondary' }
                ]
            }],
            metadataSavers: [{ available: true, enabled: true, name: 'Nfo' }]
        };
        const availabilityChanged: AdminLibraryProviderSummary = {
            groups: [{
                imageProviders: [{ available: false, enabled: false, name: 'Artwork' }],
                mediaType: 'Movie',
                metadataProviders: [
                    { available: false, enabled: true, name: 'Primary' },
                    { available: true, enabled: false, name: 'Secondary' }
                ]
            }],
            metadataSavers: [{ available: false, enabled: true, name: 'Nfo' }]
        };

        expect(areAdminLibraryProvidersEqual(left, availabilityChanged)).toBe(true);
        expect(areAdminLibraryProvidersEqual(left, {
            ...availabilityChanged,
            groups: [{
                ...availabilityChanged.groups[0]!,
                metadataProviders: [ ...availabilityChanged.groups[0]!.metadataProviders ].reverse()
            }]
        })).toBe(false);
        expect(areAdminLibraryProvidersEqual(left, {
            ...availabilityChanged,
            metadataSavers: [{ available: false, enabled: false, name: 'Nfo' }]
        })).toBe(false);
    });

    it('patches only changed enabled selections and preserves untouched inherited categories', () => {
        const authoritative = {
            FutureBackendField: { Keep: true },
            TypeOptions: [{
                ImageFetcherOrder: ['Artwork A', 'Artwork B'],
                ImageFetchers: ['Artwork A'],
                ImageOptions: [{ Limit: 1, Type: 'Primary' }],
                MetadataFetcherOrder: ['Metadata A', 'Metadata B'],
                MetadataFetchers: ['Metadata A'],
                Type: 'Movie',
                UnknownProviderState: { Keep: true }
            }, {
                ImageFetcherOrder: ['Episode artwork'],
                ImageFetchers: ['Episode artwork'],
                Type: 'Episode'
            }]
        } as unknown as LibraryOptions;
        const confirmedProviders: AdminLibraryProviderSummary = {
            groups: [{
                imageProviders: [
                    { available: true, enabled: true, name: 'Artwork A' },
                    { available: true, enabled: false, name: 'Artwork B' }
                ],
                mediaType: 'Movie',
                metadataProviders: [
                    { available: true, enabled: true, name: 'Metadata A' },
                    { available: true, enabled: false, name: 'Metadata B' }
                ]
            }, {
                imageProviders: [
                    { available: true, enabled: true, name: 'Inherited series artwork' }
                ],
                mediaType: 'Series',
                metadataProviders: []
            }],
            metadataSavers: [
                { available: true, enabled: true, name: 'Nfo' },
                { available: true, enabled: false, name: 'Json' }
            ]
        };
        const providers: AdminLibraryProviderSummary = {
            groups: [{
                imageProviders: [
                    { available: false, enabled: false, name: 'Artwork B' },
                    { available: true, enabled: true, name: 'Artwork A' }
                ],
                mediaType: 'Movie',
                metadataProviders: [
                    { available: true, enabled: true, name: 'Metadata B' },
                    { available: true, enabled: false, name: 'Metadata A' }
                ]
            }, {
                imageProviders: [
                    { available: true, enabled: true, name: 'Inherited series artwork' }
                ],
                mediaType: 'Series',
                metadataProviders: []
            }],
            metadataSavers: [
                { available: true, enabled: false, name: 'Json' },
                { available: false, enabled: true, name: 'Nfo' }
            ]
        };

        const patched = patchAdminLibraryProviders(
            authoritative,
            providers,
            confirmedProviders
        );

        expect(patched).toMatchObject({
            FutureBackendField: { Keep: true },
            TypeOptions: [{
                ImageFetcherOrder: ['Artwork A', 'Artwork B'],
                ImageFetchers: ['Artwork A'],
                ImageOptions: [{ Limit: 1, Type: 'Primary' }],
                MetadataFetcherOrder: ['Metadata A', 'Metadata B'],
                MetadataFetchers: ['Metadata B'],
                Type: 'Movie',
                UnknownProviderState: { Keep: true }
            }, {
                ImageFetcherOrder: ['Episode artwork'],
                ImageFetchers: ['Episode artwork'],
                Type: 'Episode'
            }]
        });
        expect('MetadataSavers' in patched).toBe(false);
        expect(patched.TypeOptions?.find(value => value.Type === 'Series')).toBeUndefined();
        expect(patched).not.toBe(authoritative);
        expect(patched.TypeOptions).not.toBe(authoritative.TypeOptions);
        expect(authoritative.TypeOptions?.[0]?.MetadataFetchers).toEqual(['Metadata A']);
    });

    it('leaves absent provider categories absent when no choices are represented', () => {
        const authoritative: LibraryOptions = {
            TypeOptions: [{ ImageOptions: [{ Limit: 1, Type: 'Primary' }], Type: 'Movie' }]
        };
        const patched = patchAdminLibraryProviders(authoritative, {
            groups: [{ imageProviders: [], mediaType: 'Movie', metadataProviders: [] }],
            metadataSavers: []
        }, {
            groups: [{ imageProviders: [], mediaType: 'Movie', metadataProviders: [] }],
            metadataSavers: []
        });

        expect('MetadataSavers' in patched).toBe(false);
        expect('MetadataFetchers' in patched.TypeOptions![0]!).toBe(false);
        expect('MetadataFetcherOrder' in patched.TypeOptions![0]!).toBe(false);
        expect('ImageFetchers' in patched.TypeOptions![0]!).toBe(false);
        expect('ImageFetcherOrder' in patched.TypeOptions![0]!).toBe(false);
        expect(patched.TypeOptions?.[0]?.ImageOptions).toEqual([{ Limit: 1, Type: 'Primary' }]);
    });

    it('materializes only a changed inherited selection with explicit-empty semantics', () => {
        const authoritative: LibraryOptions = { Enabled: true };
        const patched = patchAdminLibraryProviders(authoritative, {
            groups: [{
                imageProviders: [],
                mediaType: 'Movie',
                metadataProviders: [
                    { available: true, enabled: false, name: 'Metadata A' },
                    { available: true, enabled: true, name: 'Metadata B' }
                ]
            }, {
                imageProviders: [],
                mediaType: 'Episode',
                metadataProviders: []
            }],
            metadataSavers: []
        }, {
            groups: [{
                imageProviders: [],
                mediaType: 'Movie',
                metadataProviders: [
                    { available: true, enabled: true, name: 'Metadata A' },
                    { available: true, enabled: false, name: 'Metadata B' }
                ]
            }, {
                imageProviders: [],
                mediaType: 'Episode',
                metadataProviders: []
            }],
            metadataSavers: []
        });

        expect(patched.TypeOptions).toEqual([{
            MetadataFetchers: ['Metadata B'],
            Type: 'Movie'
        }]);
        expect('TypeOptions' in authoritative).toBe(false);
    });

    it('writes an explicit empty selection only when the user disabled an inherited default', () => {
        const authoritative: LibraryOptions = {};
        const patched = patchAdminLibraryProviders(authoritative, {
            groups: [{
                imageProviders: [{ available: true, enabled: false, name: 'Default artwork' }],
                mediaType: 'Movie',
                metadataProviders: []
            }],
            metadataSavers: [{ available: true, enabled: true, name: 'Nfo' }]
        }, {
            groups: [{
                imageProviders: [{ available: true, enabled: true, name: 'Default artwork' }],
                mediaType: 'Movie',
                metadataProviders: []
            }],
            metadataSavers: [{ available: true, enabled: true, name: 'Nfo' }]
        });

        expect(patched).toEqual({
            TypeOptions: [{ ImageFetchers: [], Type: 'Movie' }]
        });
        expect('MetadataSavers' in patched).toBe(false);
        expect('ImageFetcherOrder' in patched.TypeOptions![0]!).toBe(false);
    });

    it('compares only raw provider configuration with absent and empty kept distinct', () => {
        const left: LibraryOptions = {
            Enabled: true,
            MetadataSavers: ['Nfo'],
            TypeOptions: [{
                ImageFetcherOrder: ['Artwork A', 'Artwork B'],
                ImageFetchers: ['Artwork A'],
                ImageOptions: [{ Limit: 1, Type: 'Primary' }],
                MetadataFetcherOrder: ['Metadata A', 'Metadata B'],
                MetadataFetchers: ['Metadata A'],
                Type: 'Movie'
            }]
        };
        const sameProviders: LibraryOptions = {
            Enabled: false,
            MetadataSavers: ['Nfo'],
            TypeOptions: [{ Type: 'Episode' }, {
                ImageFetcherOrder: ['Artwork A', 'Artwork B'],
                ImageFetchers: ['Artwork A'],
                ImageOptions: [{ Limit: 9, Type: 'Primary' }],
                MetadataFetcherOrder: ['Metadata A', 'Metadata B'],
                MetadataFetchers: ['Metadata A'],
                Type: 'Movie'
            }]
        };

        expect(areAdminLibraryProviderConfigurationsEqual(left, sameProviders)).toBe(true);
        expect(areAdminLibraryProviderConfigurationsEqual(left, {
            ...sameProviders,
            TypeOptions: [{
                ...sameProviders.TypeOptions![1],
                MetadataFetchers: []
            }]
        })).toBe(false);
        expect(areAdminLibraryProviderConfigurationsEqual({}, { MetadataSavers: [] })).toBe(false);
        expect(areAdminLibraryProviderConfigurationsEqual({
            TypeOptions: [{ Type: 'Movie' }]
        }, {
            TypeOptions: [{ MetadataFetchers: [], Type: 'Movie' }]
        })).toBe(false);
    });

    it('does not invent detail options when the server omitted them', () => {
        const detail = normalizeAdminLibraryDetail(folder({ LibraryOptions: undefined }), {});
        expect(detail.options).toBeNull();
        expect(detail.providerSummary).toBeNull();
        expect(detail.rawOptions).toBeNull();
    });

    it('deep-clones the authoritative object and preserves unknown nested fields', () => {
        const authoritative = {
            Enabled: true,
            EnableRealtimeMonitor: true,
            FutureBackendField: {
                Nested: [{ Enabled: true, Value: 'preserve-me' }]
            },
            TypeOptions: [{
                ImageFetchers: ['Provider A'],
                MetadataFetchers: ['Provider B'],
                Type: 'Movie',
                UnknownProviderState: { Priority: 7 }
            }]
        } as unknown as LibraryOptions & {
            FutureBackendField: { Nested: Array<{ Enabled: boolean; Value: string }> };
        };

        const patched = patchAdminLibraryOptions(authoritative, {
            enabled: false,
            photos: null,
            realTimeMonitoring: false
        });

        expect(patched).toMatchObject({
            Enabled: false,
            EnableRealtimeMonitor: false,
            FutureBackendField: {
                Nested: [{ Enabled: true, Value: 'preserve-me' }]
            },
            TypeOptions: [{ UnknownProviderState: { Priority: 7 } }]
        });
        expect(patched).not.toBe(authoritative);
        expect(patched.TypeOptions).not.toBe(authoritative.TypeOptions);
        expect(authoritative.Enabled).toBe(true);
        expect(authoritative.EnableRealtimeMonitor).toBe(true);
        expect('EnablePhotos' in patched).toBe(false);
    });

    it('builds a minimal boolean patch and excludes null or unchanged values', () => {
        const confirmed = optionsForm({ embeddedTitles: null, photos: false });
        const current = optionsForm({
            embeddedTitles: true,
            photos: null,
            realTimeMonitoring: false
        });

        expect(buildAdminLibraryOptionsPatch(current, confirmed)).toEqual({
            embeddedTitles: true,
            realTimeMonitoring: false
        });
    });

    it('compares the complete managed option baseline without backend extras', () => {
        const confirmed = optionsForm();
        expect(areAdminLibraryOptionsEqual(confirmed, { ...confirmed })).toBe(true);
        expect(areAdminLibraryOptionsEqual(confirmed, {
            ...confirmed,
            chapterImages: true
        })).toBe(false);
    });

    it('builds creation defaults from discovered providers and exact paths', () => {
        const available: LibraryOptionsResultDto = {
            LyricFetchers: [
                { DefaultEnabled: true, Name: 'Built in' },
                { DefaultEnabled: false, Name: 'Remote' }
            ],
            MetadataSavers: [{ DefaultEnabled: true, Name: 'Nfo' }],
            TypeOptions: [{
                DefaultImageOptions: [{ Limit: 1, Type: 'Primary' }],
                ImageFetchers: [
                    { DefaultEnabled: true, Name: 'Primary art' },
                    { DefaultEnabled: false, Name: 'Optional art' }
                ],
                MetadataFetchers: [{ DefaultEnabled: true, Name: 'Metadata' }],
                Type: 'Movie'
            }]
        };

        const defaults = buildDefaultAdminLibraryOptions(available, [
            ' /server/path ',
            '\\\\server\\share'
        ]);

        expect(defaults).toMatchObject({
            DisabledLyricFetchers: ['Remote'],
            Enabled: true,
            MetadataSavers: ['Nfo'],
            PathInfos: [
                { Path: ' /server/path ' },
                { Path: '\\\\server\\share' }
            ],
            TypeOptions: [{
                ImageFetcherOrder: ['Primary art', 'Optional art'],
                ImageFetchers: ['Primary art'],
                MetadataFetcherOrder: ['Metadata'],
                MetadataFetchers: ['Metadata'],
                Type: 'Movie'
            }]
        });
    });
});
