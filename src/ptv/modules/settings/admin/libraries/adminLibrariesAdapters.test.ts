import type { LibraryOptionsResultDto } from '@jellyfin/sdk/lib/generated-client/models/library-options-result-dto';
import type { LibraryOptions } from '@jellyfin/sdk/lib/generated-client/models/library-options';
import type { TaskInfo } from '@jellyfin/sdk/lib/generated-client/models/task-info';
import type { VirtualFolderInfo } from '@jellyfin/sdk/lib/generated-client/models/virtual-folder-info';
import { describe, expect, it } from 'vitest';

import {
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
    selectAdminLibraries
} from './adminLibrariesAdapters';
import type { AdminLibraryOptionsForm } from './adminLibrariesModel';

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

    it('treats Collections as server managed and reports scan state from real signals', () => {
        const tasks: TaskInfo[] = [{ Key: 'RefreshLibrary', State: 'Running' }];
        const [ collection ] = normalizeAdminLibraries([ folder({
            CollectionType: 'boxsets',
            Name: 'Collections'
        }) ], tasks);

        expect(collection).toMatchObject({
            displayType: 'Collections',
            kind: 'collections',
            pathManagementSupported: false,
            removable: false,
            scanState: 'running'
        });
    });

    it('recognizes active item refresh state without treating persisted zero progress as scanning', () => {
        expect(normalizeAdminLibraries([
            folder({ RefreshProgress: 0 }),
            folder({ ItemId: 'library-b', Name: 'Shows', RefreshStatus: 'Scanning media' }),
            folder({ ItemId: 'library-c', Name: 'Music' })
        ]).map(value => [ value.scanState, value.refreshProgress ])).toEqual([
            [ 'idle', 0 ],
            [ 'running', null ],
            [ 'idle', null ]
        ]);
    });

    it('marks scan status unavailable when the task source failed without hiding item-level activity', () => {
        expect(normalizeAdminLibraries([
            folder(),
            folder({ ItemId: 'library-b', Name: 'Shows', RefreshProgress: 12 })
        ], [], false).map(value => value.scanState)).toEqual([
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
            Enabled: undefined
        })).toMatchObject({
            enabled: null,
            photos: false,
            realTimeMonitoring: true,
            trickplayImages: null
        });
    });

    it('uses configured providers and server defaults only when configuration is absent', () => {
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
                MetadataFetchers: [{ DefaultEnabled: true, Name: 'TheMovieDb' }],
                Type: 'Movie'
            }]
        };

        const normalized = normalizeAdminLibraryProviders({
            MetadataSavers: [],
            TypeOptions: [{
                ImageFetchers: ['Fanart'],
                MetadataFetchers: undefined,
                Type: 'Movie'
            }]
        }, available);

        expect(normalized.metadataSavers).toEqual([]);
        expect(normalized.groups).toEqual([{
            imageProviders: ['Fanart'],
            mediaType: 'Movie',
            metadataProviders: ['TheMovieDb']
        }]);
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
