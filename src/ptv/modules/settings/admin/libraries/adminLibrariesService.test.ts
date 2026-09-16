import type { Api } from '@jellyfin/sdk';
import {
    ItemRefreshApiAxiosParamCreator as createItemRefreshApiAxiosParams
} from '@jellyfin/sdk/lib/generated-client/api/item-refresh-api';
import type { LibraryOptions } from '@jellyfin/sdk/lib/generated-client/models/library-options';
import type { LibraryOptionsResultDto } from '@jellyfin/sdk/lib/generated-client/models/library-options-result-dto';
import { MetadataRefreshMode } from '@jellyfin/sdk/lib/generated-client/models/metadata-refresh-mode';
import type { VirtualFolderInfo } from '@jellyfin/sdk/lib/generated-client/models/virtual-folder-info';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeAdminLibraryOptions } from './adminLibrariesAdapters';
import type { AdminLibraryProviderSummary } from './adminLibrariesModel';

const sdkMocks = vi.hoisted(() => ({
    addMediaPath: vi.fn(),
    addVirtualFolder: vi.fn(),
    getDefaultDirectoryBrowser: vi.fn(),
    getDirectoryContents: vi.fn(),
    getDrives: vi.fn(),
    getLibraryOptionsInfo: vi.fn(),
    getParentPath: vi.fn(),
    getTasks: vi.fn(),
    getVirtualFolders: vi.fn(),
    refreshItem: vi.fn(),
    removeMediaPath: vi.fn(),
    removeVirtualFolder: vi.fn(),
    renameVirtualFolder: vi.fn(),
    startTask: vi.fn(),
    updateLibraryOptions: vi.fn(),
    validatePath: vi.fn()
}));

vi.mock('@jellyfin/sdk/lib/utils/api/environment-api', () => ({
    getEnvironmentApi: () => ({
        getDefaultDirectoryBrowser: sdkMocks.getDefaultDirectoryBrowser,
        getDirectoryContents: sdkMocks.getDirectoryContents,
        getDrives: sdkMocks.getDrives,
        getParentPath: sdkMocks.getParentPath,
        validatePath: sdkMocks.validatePath
    })
}));

vi.mock('@jellyfin/sdk/lib/utils/api/library-api', () => ({
    getLibraryApi: () => ({ getLibraryOptionsInfo: sdkMocks.getLibraryOptionsInfo })
}));

vi.mock('@jellyfin/sdk/lib/utils/api/item-refresh-api', () => ({
    getItemRefreshApi: (apiSource: Api) => ({
        refreshItem: (request: unknown, options: unknown) =>
            sdkMocks.refreshItem(apiSource, request, options)
    })
}));

vi.mock('@jellyfin/sdk/lib/utils/api/library-structure-api', () => ({
    getLibraryStructureApi: () => ({
        addMediaPath: sdkMocks.addMediaPath,
        addVirtualFolder: sdkMocks.addVirtualFolder,
        getVirtualFolders: sdkMocks.getVirtualFolders,
        removeMediaPath: sdkMocks.removeMediaPath,
        removeVirtualFolder: sdkMocks.removeVirtualFolder,
        renameVirtualFolder: sdkMocks.renameVirtualFolder,
        updateLibraryOptions: sdkMocks.updateLibraryOptions
    })
}));

vi.mock('@jellyfin/sdk/lib/utils/api/scheduled-tasks-api', () => ({
    getScheduledTasksApi: () => ({
        getTasks: sdkMocks.getTasks,
        startTask: sdkMocks.startTask
    })
}));

import {
    ADMIN_LIBRARY_DIRECTORY_TIMEOUT_MS,
    ADMIN_LIBRARY_PATH_VALIDATION_TIMEOUT_MS,
    ADMIN_LIBRARY_SCAN_START_TIMEOUT_MS,
    AdminLibrariesServiceError,
    addAdminLibraryPath,
    createAdminLibrary,
    loadAdminLibraries,
    loadAdminLibrary,
    loadAdminLibraryDirectory,
    loadAdminLibraryOptionsInfo,
    loadAdminLibraryTasks,
    removeAdminLibrary,
    removeAdminLibraryPath,
    renameAdminLibrary,
    resolveAdminLibrary,
    startAdminLibrariesScan,
    startAdminLibraryScan,
    updateAdminLibraryOptions,
    updateAdminLibraryProviders,
    validateAdminLibraryPath
} from './adminLibrariesService';

const api = {} as Api;

function library(overrides: Partial<VirtualFolderInfo> = {}): VirtualFolderInfo {
    return {
        CollectionType: 'movies',
        ItemId: 'library-a',
        LibraryOptions: {
            Enabled: true,
            EnableRealtimeMonitor: true,
            PathInfos: [{ Path: '/media/movies' }],
            TypeOptions: [{
                ImageFetchers: ['TheMovieDb'],
                MetadataFetchers: ['TheMovieDb'],
                Type: 'Movie'
            }]
        },
        Locations: ['/media/movies'],
        Name: 'Movies',
        ...overrides
    };
}

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>(promiseResolve => {
        resolve = promiseResolve;
    });
    return { promise, resolve };
}

function creationOptions(): LibraryOptionsResultDto {
    return {
        MetadataSavers: [{ DefaultEnabled: true, Name: 'Nfo' }],
        TypeOptions: [{
            ImageFetchers: [{ DefaultEnabled: true, Name: 'TheMovieDb' }],
            MetadataFetchers: [{ DefaultEnabled: true, Name: 'TheMovieDb' }],
            Type: 'Movie'
        }]
    };
}

describe('administrator libraries service reads', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sdkMocks.getDefaultDirectoryBrowser.mockResolvedValue({ data: { Path: '/media' } });
        sdkMocks.getDirectoryContents.mockResolvedValue({ data: [] });
        sdkMocks.getDrives.mockResolvedValue({ data: [] });
        sdkMocks.getLibraryOptionsInfo.mockResolvedValue({ data: creationOptions() });
        sdkMocks.getParentPath.mockResolvedValue({ data: '/' });
        sdkMocks.getTasks.mockResolvedValue({ data: [] });
        sdkMocks.getVirtualFolders.mockResolvedValue({ data: [library()] });
        sdkMocks.validatePath.mockResolvedValue({ data: undefined });
    });

    it('loads the authoritative list with the caller AbortSignal', async () => {
        const AbortControllerConstructor = globalThis['AbortController'];
        const controller = new AbortControllerConstructor();
        const signal = controller.signal;

        await expect(loadAdminLibraries(api, signal)).resolves.toHaveLength(1);
        expect(sdkMocks.getVirtualFolders).toHaveBeenCalledWith({ signal });
    });

    it('fails closed when the list response is malformed', async () => {
        sdkMocks.getVirtualFolders.mockResolvedValue({ data: { Items: [] } });

        await expect(loadAdminLibraries(api)).rejects.toMatchObject({
            code: 'libraries-unavailable'
        });
    });

    it('resolves a stable item id case-insensitively and rejects incomplete records', async () => {
        expect(resolveAdminLibrary([library()], ' LIBRARY-A ')).toMatchObject({ Name: 'Movies' });
        await expect(loadAdminLibrary(api, 'library-a')).resolves.toMatchObject({ ItemId: 'library-a' });

        expect(() => resolveAdminLibrary([
            library({ ItemId: undefined })
        ], 'library-a')).toThrow(AdminLibrariesServiceError);
    });

    it('loads option discovery with source arguments and preserves the Mixed collection type', async () => {
        const signal = { aborted: false } as AbortSignal;

        await loadAdminLibraryOptionsInfo(api, 'mixed', true, signal);
        expect(sdkMocks.getLibraryOptionsInfo).toHaveBeenCalledWith({
            isNewLibrary: true,
            libraryContentType: 'mixed'
        }, { signal });

        await loadAdminLibraryOptionsInfo(api, 'tvshows', false, signal);
        expect(sdkMocks.getLibraryOptionsInfo).toHaveBeenLastCalledWith({
            isNewLibrary: false,
            libraryContentType: 'tvshows'
        }, { signal });
    });

    it('distinguishes malformed option and task sources from empty results', async () => {
        sdkMocks.getLibraryOptionsInfo.mockResolvedValue({ data: null });
        await expect(loadAdminLibraryOptionsInfo(api, 'movies', true)).rejects.toMatchObject({
            code: 'creation-options-unavailable'
        });

        sdkMocks.getTasks.mockResolvedValue({ data: undefined });
        await expect(loadAdminLibraryTasks(api)).rejects.toMatchObject({
            code: 'tasks-unavailable'
        });
    });

    it('uses the server directory API and never asks for files', async () => {
        const AbortControllerConstructor = globalThis['AbortController'];
        const controller = new AbortControllerConstructor();
        sdkMocks.getDirectoryContents.mockResolvedValue({
            data: [{ IsDirectory: true, Name: 'Movies', Path: '/media/Movies' }]
        });

        await expect(loadAdminLibraryDirectory(api, '/media', controller.signal)).resolves.toEqual({
            entries: [{ IsDirectory: true, Name: 'Movies', Path: '/media/Movies' }],
            parentPath: '/',
            path: '/media'
        });
        const requestSignal = sdkMocks.getDirectoryContents.mock.calls[0][1].signal as AbortSignal;
        expect(requestSignal).toBeInstanceOf(AbortSignal);
        expect(requestSignal).not.toBe(controller.signal);
        expect(sdkMocks.getDefaultDirectoryBrowser).not.toHaveBeenCalled();
        expect(sdkMocks.getDirectoryContents).toHaveBeenCalledWith({
            includeDirectories: true,
            includeFiles: false,
            path: '/media'
        }, { signal: requestSignal });
        expect(sdkMocks.getParentPath).toHaveBeenCalledWith({ path: '/media' }, { signal: requestSignal });
    });

    it('loads drives at the server root and maps browse failures to a safe message', async () => {
        sdkMocks.getDrives.mockResolvedValue({ data: [
            { Name: 'Data', Path: 'D:\\' },
            { Name: 'Duplicate Data', Path: 'D:\\' },
            { Name: 'Unavailable' }
        ] });
        await expect(loadAdminLibraryDirectory(api)).resolves.toMatchObject({
            entries: [{ Name: 'Data', Path: 'D:\\' }],
            path: ''
        });
        expect(sdkMocks.getDefaultDirectoryBrowser).not.toHaveBeenCalled();

        sdkMocks.getDirectoryContents.mockRejectedValue(new Error('sensitive backend detail'));
        await expect(loadAdminLibraryDirectory(api, '/denied')).rejects.toMatchObject({
            code: 'directory-unavailable',
            message: 'This server folder could not be opened.'
        });
    });

    it('strictly bounds a stalled root browse and aborts its transport', async () => {
        vi.useFakeTimers();
        try {
            sdkMocks.getDrives.mockReturnValue(new Promise(() => undefined));
            const directoryPromise = loadAdminLibraryDirectory(api);
            const rejection = expect(directoryPromise).rejects.toMatchObject({
                code: 'directory-unavailable',
                message: 'Server folders took too long to load. Try again.'
            });

            await vi.advanceTimersByTimeAsync(ADMIN_LIBRARY_DIRECTORY_TIMEOUT_MS);
            await rejection;

            const requestSignal = sdkMocks.getDrives.mock.calls[0][0].signal as AbortSignal;
            expect(requestSignal.aborted).toBe(true);
            expect(sdkMocks.getDefaultDirectoryBrowser).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('settles immediately when a caller cancels an abort-ignoring browse transport', async () => {
        const AbortControllerConstructor = globalThis['AbortController'];
        const controller = new AbortControllerConstructor();
        sdkMocks.getDrives.mockReturnValue(new Promise(() => undefined));
        const directoryPromise = loadAdminLibraryDirectory(api, undefined, controller.signal);

        controller.abort();

        await expect(directoryPromise).rejects.toMatchObject({ name: 'AbortError' });
        const requestSignal = sdkMocks.getDrives.mock.calls[0][0].signal as AbortSignal;
        expect(requestSignal.aborted).toBe(true);
    });
});

describe('administrator libraries service mutations', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sdkMocks.addMediaPath.mockResolvedValue({ data: undefined });
        sdkMocks.addVirtualFolder.mockResolvedValue({ data: undefined });
        sdkMocks.getLibraryOptionsInfo.mockResolvedValue({ data: creationOptions() });
        sdkMocks.getTasks.mockResolvedValue({
            data: [{ Id: 'refresh-task', Key: 'RefreshLibrary', State: 'Idle' }]
        });
        sdkMocks.getVirtualFolders.mockResolvedValue({ data: [library()] });
        sdkMocks.removeMediaPath.mockResolvedValue({ data: undefined });
        sdkMocks.removeVirtualFolder.mockResolvedValue({ data: undefined });
        sdkMocks.renameVirtualFolder.mockResolvedValue({ data: undefined });
        sdkMocks.startTask.mockResolvedValue({ data: undefined });
        sdkMocks.updateLibraryOptions.mockResolvedValue({ data: undefined });
        sdkMocks.validatePath.mockResolvedValue({ data: undefined });
    });

    it('validates exact paths without trimming or requesting write access', async () => {
        const AbortControllerConstructor = globalThis['AbortController'];
        const controller = new AbortControllerConstructor();
        await expect(validateAdminLibraryPath(api, ' /mnt/media ', controller.signal)).resolves.toBe(' /mnt/media ');
        const requestSignal = sdkMocks.validatePath.mock.calls[0][1].signal as AbortSignal;
        expect(sdkMocks.validatePath).toHaveBeenCalledWith({
            validatePathDto: {
                IsFile: false,
                Path: ' /mnt/media ',
                ValidateWritable: false
            }
        }, { signal: requestSignal });
        expect(requestSignal).not.toBe(controller.signal);
    });

    it('strictly bounds a stalled path validation and aborts its transport', async () => {
        vi.useFakeTimers();
        try {
            sdkMocks.validatePath.mockReturnValue(new Promise(() => undefined));
            const validationPromise = validateAdminLibraryPath(api, '/mnt/stalled');
            const rejection = expect(validationPromise).rejects.toMatchObject({
                code: 'invalid-library-path',
                message: 'Server path validation took too long. Try again.'
            });

            await vi.advanceTimersByTimeAsync(ADMIN_LIBRARY_PATH_VALIDATION_TIMEOUT_MS);
            await rejection;

            const requestSignal = sdkMocks.validatePath.mock.calls[0][1].signal as AbortSignal;
            expect(requestSignal.aborted).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('fails creation closed unless option discovery and at least one valid path exist', async () => {
        await expect(createAdminLibrary(api, {
            collectionType: 'movies',
            locations: ['/media/movies'],
            name: 'Movies'
        }, null as unknown as LibraryOptionsResultDto)).rejects.toMatchObject({
            code: 'creation-options-unavailable'
        });
        await expect(createAdminLibrary(api, {
            collectionType: 'movies',
            locations: [' '],
            name: 'Movies'
        }, creationOptions())).rejects.toMatchObject({ code: 'invalid-library-path' });
        expect(sdkMocks.addVirtualFolder).not.toHaveBeenCalled();
    });

    it('creates once with validated exact unique paths, discovered defaults, and no automatic scan', async () => {
        sdkMocks.getVirtualFolders.mockResolvedValue({
            data: [library({ ItemId: 'new-id', Locations: ['/media/a', '/media/b'], Name: 'New Movies' })]
        });
        const AbortControllerConstructor = globalThis['AbortController'];
        const controller = new AbortControllerConstructor();
        const signal = controller.signal;

        await expect(createAdminLibrary(api, {
            collectionType: ' MOVIES ',
            locations: ['/media/a', '/media/a', ' /media/b '],
            name: ' New Movies '
        }, creationOptions(), signal)).resolves.toMatchObject({ ItemId: 'new-id' });

        expect(sdkMocks.validatePath).toHaveBeenCalledTimes(2);
        expect(sdkMocks.addVirtualFolder).toHaveBeenCalledWith({
            addVirtualFolderDto: {
                LibraryOptions: expect.objectContaining({
                    Enabled: true,
                    MetadataSavers: ['Nfo'],
                    PathInfos: [
                        { Path: '/media/a' },
                        { Path: ' /media/b ' }
                    ]
                })
            },
            collectionType: 'movies',
            name: 'New Movies',
            paths: ['/media/a', ' /media/b '],
            refreshLibrary: false
        }, { signal });
        expect(sdkMocks.getVirtualFolders).toHaveBeenCalledOnce();
    });

    it('uses an omitted collection type for a Mixed library', async () => {
        await createAdminLibrary(api, {
            collectionType: 'mixed',
            locations: ['/media/mixed'],
            name: 'Mixed'
        }, creationOptions());

        expect(sdkMocks.addVirtualFolder).toHaveBeenCalledWith(expect.objectContaining({
            collectionType: undefined
        }), { signal: undefined });
    });

    it('does not invite a duplicate create when post-create identity discovery is unavailable or ambiguous', async () => {
        sdkMocks.getVirtualFolders.mockRejectedValueOnce(new Error('list unavailable'));
        await expect(createAdminLibrary(api, {
            collectionType: 'movies',
            locations: ['/media/new'],
            name: 'New Movies'
        }, creationOptions())).resolves.toBeNull();
        expect(sdkMocks.addVirtualFolder).toHaveBeenCalledOnce();

        vi.clearAllMocks();
        sdkMocks.addVirtualFolder.mockResolvedValue({ data: undefined });
        sdkMocks.validatePath.mockResolvedValue({ data: undefined });
        sdkMocks.getVirtualFolders.mockResolvedValue({
            data: [
                library({ ItemId: 'new-a', Name: 'New Movies' }),
                library({ ItemId: 'new-b', Name: 'New Movies' })
            ]
        });
        await expect(createAdminLibrary(api, {
            collectionType: 'movies',
            locations: ['/media/new'],
            name: 'New Movies'
        }, creationOptions())).resolves.toBeNull();
        expect(sdkMocks.addVirtualFolder).toHaveBeenCalledOnce();
    });

    it('refetches the authoritative library before rename and path mutations', async () => {
        const renamed = await renameAdminLibrary(api, 'library-a', ' New Name ', 'Movies');
        expect(renamed).toMatchObject({ ItemId: 'library-a', Name: 'New Name' });
        expect(sdkMocks.renameVirtualFolder).toHaveBeenCalledWith({
            name: 'Movies',
            newName: 'New Name',
            refreshLibrary: false
        }, { signal: undefined });

        await addAdminLibraryPath(api, 'library-a', '/media/archive');
        expect(sdkMocks.addMediaPath).toHaveBeenCalledWith({
            mediaPathDto: {
                Name: 'Movies',
                Path: '/media/archive',
                PathInfo: { Path: '/media/archive' }
            },
            refreshLibrary: false
        }, { signal: undefined });

        await removeAdminLibraryPath(api, 'library-a', '/media/movies');
        expect(sdkMocks.removeMediaPath).toHaveBeenCalledWith({
            name: 'Movies',
            path: '/media/movies',
            refreshLibrary: false
        }, { signal: undefined });
        expect(sdkMocks.getVirtualFolders).toHaveBeenCalledTimes(3);
    });

    it('rejects a rename conflict before mutation when the authoritative name changed', async () => {
        sdkMocks.getVirtualFolders.mockResolvedValue({
            data: [library({ Name: 'Movies from another admin' })]
        });

        await expect(renameAdminLibrary(
            api,
            'library-a',
            'My Movies',
            'Movies'
        )).rejects.toMatchObject({ code: 'conflict' });
        expect(sdkMocks.renameVirtualFolder).not.toHaveBeenCalled();
    });

    it('blocks duplicate additions and stale removals before mutation', async () => {
        await expect(addAdminLibraryPath(api, 'library-a', '/media/movies')).rejects.toMatchObject({
            code: 'invalid-library-path'
        });
        await expect(removeAdminLibraryPath(api, 'library-a', '/media/removed')).rejects.toMatchObject({
            code: 'invalid-library-path'
        });
        expect(sdkMocks.addMediaPath).not.toHaveBeenCalled();
        expect(sdkMocks.removeMediaPath).not.toHaveBeenCalled();
    });

    it('refetches and preserves unknown deep options before a full-object update', async () => {
        const authoritativeOptions = {
            Enabled: true,
            EnableRealtimeMonitor: true,
            FutureField: { Nested: [{ Keep: 'yes' }] },
            PathInfos: [{ Path: '/media/movies' }],
            TypeOptions: [{
                Type: 'Movie',
                UnknownProviderState: { Rank: 4 }
            }]
        };
        sdkMocks.getVirtualFolders.mockResolvedValue({
            data: [library({ LibraryOptions: authoritativeOptions })]
        });

        const confirmed = normalizeAdminLibraryOptions(library().LibraryOptions!);
        const saved = await updateAdminLibraryOptions(api, 'library-a', {
            enabled: false,
            realTimeMonitoring: false
        }, confirmed);

        expect(saved.LibraryOptions).toMatchObject({
            Enabled: false,
            EnableRealtimeMonitor: false,
            FutureField: { Nested: [{ Keep: 'yes' }] },
            TypeOptions: [{ UnknownProviderState: { Rank: 4 } }]
        });
        expect(sdkMocks.updateLibraryOptions).toHaveBeenCalledWith({
            updateLibraryOptionsDto: {
                Id: 'library-a',
                LibraryOptions: saved.LibraryOptions
            }
        }, { signal: undefined });
        expect(saved.LibraryOptions).not.toBe(authoritativeOptions);
    });

    it('rejects an options conflict before mutation when any managed field changed', async () => {
        const confirmed = normalizeAdminLibraryOptions(library().LibraryOptions!);
        sdkMocks.getVirtualFolders.mockResolvedValue({
            data: [library({
                LibraryOptions: {
                    ...library().LibraryOptions,
                    Enabled: false
                }
            })]
        });

        await expect(updateAdminLibraryOptions(api, 'library-a', {
            realTimeMonitoring: false
        }, confirmed)).rejects.toMatchObject({ code: 'conflict' });
        expect(sdkMocks.updateLibraryOptions).not.toHaveBeenCalled();
    });

    it('fails closed when the fresh read has no options', async () => {
        sdkMocks.getVirtualFolders.mockResolvedValue({
            data: [library({ LibraryOptions: undefined })]
        });

        await expect(updateAdminLibraryOptions(api, 'library-a', {
            enabled: false
        }, normalizeAdminLibraryOptions(library().LibraryOptions!))).rejects.toMatchObject({
            code: 'library-options-unavailable'
        });
        expect(sdkMocks.updateLibraryOptions).not.toHaveBeenCalled();
    });

    it('refetches, conflict-checks, and patches providers on the full authoritative object', async () => {
        const confirmedOptions: LibraryOptions = {
            MetadataSavers: ['Nfo'],
            TypeOptions: [{
                ImageFetcherOrder: ['Artwork A', 'Artwork B'],
                ImageFetchers: ['Artwork A'],
                ImageOptions: [{ Limit: 1, Type: 'Primary' }],
                MetadataFetcherOrder: ['Metadata A', 'Metadata B'],
                MetadataFetchers: ['Metadata A'],
                Type: 'Movie'
            }, {
                ImageFetcherOrder: ['Episode art'],
                ImageFetchers: ['Episode art'],
                Type: 'Episode'
            }]
        };
        const authoritativeOptions = {
            ...confirmedOptions,
            Enabled: false,
            FutureField: { Nested: [{ Keep: 'yes' }] },
            TypeOptions: [{
                ...confirmedOptions.TypeOptions![0],
                ImageOptions: [{ Limit: 4, Type: 'Primary' }],
                UnknownProviderState: { Rank: 8 }
            }, {
                ImageFetcherOrder: ['Episode art'],
                ImageFetchers: ['Episode art'],
                Type: 'Episode'
            }]
        } as unknown as LibraryOptions;
        const providers: AdminLibraryProviderSummary = {
            groups: [{
                imageProviders: [
                    { available: true, enabled: false, name: 'Artwork B' },
                    { available: true, enabled: true, name: 'Artwork A' }
                ],
                mediaType: 'Movie',
                metadataProviders: [
                    { available: true, enabled: true, name: 'Metadata B' },
                    { available: true, enabled: false, name: 'Metadata A' }
                ]
            }],
            metadataSavers: [
                { available: true, enabled: false, name: 'Nfo' },
                { available: true, enabled: true, name: 'Json' }
            ]
        };
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
            }],
            metadataSavers: [
                { available: true, enabled: true, name: 'Nfo' },
                { available: true, enabled: false, name: 'Json' }
            ]
        };
        sdkMocks.getVirtualFolders.mockResolvedValue({
            data: [library({ LibraryOptions: authoritativeOptions })]
        });

        const saved = await updateAdminLibraryProviders(
            api,
            'library-a',
            providers,
            confirmedProviders,
            confirmedOptions
        );

        expect(saved.LibraryOptions).toMatchObject({
            Enabled: false,
            FutureField: { Nested: [{ Keep: 'yes' }] },
            MetadataSavers: ['Json'],
            TypeOptions: [{
                ImageFetcherOrder: ['Artwork A', 'Artwork B'],
                ImageFetchers: ['Artwork A'],
                ImageOptions: [{ Limit: 4, Type: 'Primary' }],
                MetadataFetcherOrder: ['Metadata A', 'Metadata B'],
                MetadataFetchers: ['Metadata B'],
                UnknownProviderState: { Rank: 8 }
            }, {
                ImageFetcherOrder: ['Episode art'],
                ImageFetchers: ['Episode art'],
                Type: 'Episode'
            }]
        });
        expect(sdkMocks.updateLibraryOptions).toHaveBeenCalledWith({
            updateLibraryOptionsDto: {
                Id: 'library-a',
                LibraryOptions: saved.LibraryOptions
            }
        }, { signal: undefined });
        expect(saved.LibraryOptions).not.toBe(authoritativeOptions);
    });

    it('creates options only for the changed default-resolved provider category', async () => {
        const confirmedOptions: LibraryOptions = { Enabled: true };
        sdkMocks.getVirtualFolders.mockResolvedValue({
            data: [library({
                LibraryOptions: {
                    Enabled: false,
                    FutureField: { Keep: true }
                } as unknown as LibraryOptions
            })]
        });

        const saved = await updateAdminLibraryProviders(api, 'library-a', {
            groups: [{
                imageProviders: [{ available: true, enabled: true, name: 'Artwork' }],
                mediaType: 'Movie',
                metadataProviders: [{ available: true, enabled: true, name: 'Metadata' }]
            }],
            metadataSavers: [{ available: true, enabled: true, name: 'Nfo' }]
        }, {
            groups: [{
                imageProviders: [{ available: true, enabled: false, name: 'Artwork' }],
                mediaType: 'Movie',
                metadataProviders: [{ available: true, enabled: true, name: 'Metadata' }]
            }],
            metadataSavers: [{ available: true, enabled: true, name: 'Nfo' }]
        }, confirmedOptions);

        expect(saved.LibraryOptions).toMatchObject({
            Enabled: false,
            FutureField: { Keep: true },
            TypeOptions: [{
                ImageFetchers: ['Artwork'],
                Type: 'Movie'
            }]
        });
        expect('MetadataSavers' in saved.LibraryOptions!).toBe(false);
        expect('MetadataFetchers' in saved.LibraryOptions!.TypeOptions![0]!).toBe(false);
        expect('ImageFetcherOrder' in saved.LibraryOptions!.TypeOptions![0]!).toBe(false);
        expect(sdkMocks.updateLibraryOptions).toHaveBeenCalledOnce();
    });

    it('rejects a provider write when any raw provider selection or order changed', async () => {
        const confirmedOptions = library().LibraryOptions!;
        sdkMocks.getVirtualFolders.mockResolvedValue({
            data: [library({
                LibraryOptions: {
                    ...confirmedOptions,
                    TypeOptions: [{
                        ...confirmedOptions.TypeOptions![0],
                        MetadataFetchers: []
                    }]
                }
            })]
        });

        await expect(updateAdminLibraryProviders(api, 'library-a', {
            groups: [],
            metadataSavers: []
        }, {
            groups: [],
            metadataSavers: []
        }, confirmedOptions)).rejects.toMatchObject({ code: 'conflict' });
        expect(sdkMocks.updateLibraryOptions).not.toHaveBeenCalled();
    });

    it('fails a provider write closed when the fresh read has no options', async () => {
        sdkMocks.getVirtualFolders.mockResolvedValue({
            data: [library({ LibraryOptions: undefined })]
        });

        await expect(updateAdminLibraryProviders(api, 'library-a', {
            groups: [],
            metadataSavers: []
        }, {
            groups: [],
            metadataSavers: []
        }, library().LibraryOptions!)).rejects.toMatchObject({
            code: 'library-options-unavailable'
        });
        expect(sdkMocks.updateLibraryOptions).not.toHaveBeenCalled();
    });

    it('blocks deletion of the server-managed Collections library', async () => {
        sdkMocks.getVirtualFolders.mockResolvedValue({
            data: [library({ CollectionType: 'boxsets' })]
        });

        await expect(removeAdminLibrary(api, 'library-a')).rejects.toMatchObject({
            code: 'invalid-library'
        });
        expect(sdkMocks.removeVirtualFolder).not.toHaveBeenCalled();
    });

    it('removes a normal library by its fresh backend name without starting a scan', async () => {
        await removeAdminLibrary(api, 'library-a');
        expect(sdkMocks.removeVirtualFolder).toHaveBeenCalledWith({
            name: 'Movies',
            refreshLibrary: false
        }, { signal: undefined });
    });

    it('fails removal closed when the confirmed name no longer matches authoritative state', async () => {
        await expect(removeAdminLibrary(api, 'library-a', 'Old Movies')).rejects.toMatchObject({
            code: 'invalid-library'
        });
        expect(sdkMocks.removeVirtualFolder).not.toHaveBeenCalled();
    });
});

describe('administrator library scan requests', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sdkMocks.getTasks.mockResolvedValue({
            data: [{ Id: 'refresh-task', Key: 'RefreshLibrary', State: 'Idle' }]
        });
        sdkMocks.startTask.mockResolvedValue({ data: undefined });
        sdkMocks.refreshItem.mockResolvedValue({ data: undefined, status: 204 });
    });

    it('starts the existing global RefreshLibrary task with the exact SDK contract', async () => {
        await expect(startAdminLibrariesScan(api)).resolves.toMatchObject({
            Id: 'refresh-task',
            State: 'Running'
        });
        expect(sdkMocks.startTask).toHaveBeenCalledWith({ taskId: 'refresh-task' }, {
            signal: undefined
        });
    });

    it('does not start an already-running global scan', async () => {
        sdkMocks.getTasks.mockResolvedValue({
            data: [{ Id: 'refresh-task', Key: 'RefreshLibrary', State: 'Running' }]
        });
        await startAdminLibrariesScan(api);
        expect(sdkMocks.startTask).not.toHaveBeenCalled();
    });

    it('deduplicates a global scan flight per server API source', async () => {
        let release: (() => void) | undefined;
        sdkMocks.startTask.mockImplementation(() => new Promise<void>(resolve => {
            release = resolve;
        }));
        const first = startAdminLibrariesScan(api);
        const second = startAdminLibrariesScan(api);
        expect(first).toBe(second);
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        release?.();
        await first;
        expect(sdkMocks.getTasks).toHaveBeenCalledOnce();
        expect(sdkMocks.startTask).toHaveBeenCalledOnce();
    });

    it('uses Jellyfin generated POST /Items/{itemId}/Refresh without a recursive query', async () => {
        const contract = await createItemRefreshApiAxiosParams().refreshItem(
            'library-a',
            MetadataRefreshMode.Default,
            MetadataRefreshMode.Default,
            false,
            false,
            false
        );
        const [ path, query = '' ] = contract.url.split('?');

        expect(contract.options.method).toBe('POST');
        expect(path).toBe('/Items/library-a/Refresh');
        const alphabetically = (left: string, right: string) => left.localeCompare(right);
        expect(query.split('&').sort(alphabetically)).toEqual([
            'imageRefreshMode=Default',
            'metadataRefreshMode=Default',
            'regenerateTrickplay=false',
            'replaceAllImages=false',
            'replaceAllMetadata=false'
        ].sort(alphabetically));
        expect(query.toLowerCase()).not.toContain('recursive');
    });

    it('passes the exact stable library identity and isolates pending flights by source and id', async () => {
        const apiA = {} as Api;
        const apiB = {} as Api;
        const requests = new Map<string, ReturnType<typeof deferred<{ data: undefined; status: number }>>>();
        sdkMocks.refreshItem.mockImplementation((source: Api, request: { itemId: string }) => {
            const pending = deferred<{ data: undefined; status: number }>();
            requests.set(`${source === apiA ? 'a' : 'b'}:${request.itemId}`, pending);
            return pending.promise;
        });

        const first = startAdminLibraryScan(apiA, 'library-a');
        const duplicate = startAdminLibraryScan(apiA, 'library-a');
        const otherLibrary = startAdminLibraryScan(apiA, 'library-b');
        const otherServer = startAdminLibraryScan(apiB, 'library-a');

        expect(first).toBe(duplicate);
        expect(sdkMocks.refreshItem).toHaveBeenCalledTimes(3);
        expect(sdkMocks.refreshItem).toHaveBeenCalledWith(apiA, {
            imageRefreshMode: MetadataRefreshMode.Default,
            itemId: 'library-a',
            metadataRefreshMode: MetadataRefreshMode.Default,
            regenerateTrickplay: false,
            replaceAllImages: false,
            replaceAllMetadata: false
        }, { signal: expect.any(AbortSignal) });

        requests.get('a:library-a')?.resolve({ data: undefined, status: 204 });
        requests.get('a:library-b')?.resolve({ data: undefined, status: 204 });
        requests.get('b:library-a')?.resolve({ data: undefined, status: 204 });
        await Promise.all([first, otherLibrary, otherServer]);
    });

    it.each([
        [ 400, 'scan-invalid-request' ],
        [ 401, 'scan-authentication' ],
        [ 403, 'scan-authentication' ],
        [ 404, 'scan-not-found' ],
        [ 409, 'scan-conflict' ],
        [ 500, 'scan-server-error' ]
    ])('maps HTTP %i to a terminal safe scan error', async (status, code) => {
        sdkMocks.refreshItem.mockRejectedValueOnce({ response: { status } });

        await expect(startAdminLibraryScan({} as Api, 'library-a')).rejects.toMatchObject({ code });
    });

    it('maps network, timeout, and cancellation failures and releases the flight for retry', async () => {
        const networkApi = {} as Api;
        sdkMocks.refreshItem.mockRejectedValueOnce(new TypeError('synthetic network failure'));
        await expect(startAdminLibraryScan(networkApi, 'library-a')).rejects.toMatchObject({
            code: 'scan-network'
        });
        await expect(startAdminLibraryScan(networkApi, 'library-a')).resolves.toBeUndefined();

        vi.useFakeTimers();
        try {
            let timeoutSignal: AbortSignal | undefined;
            sdkMocks.refreshItem.mockImplementationOnce((
                _source: Api,
                _request: unknown,
                options: { signal?: AbortSignal }
            ) => {
                timeoutSignal = options.signal;
                return new Promise(() => undefined);
            });
            const timeout = startAdminLibraryScan({} as Api, 'library-timeout');
            const timeoutResult = expect(timeout).rejects.toMatchObject({ code: 'scan-timeout' });
            await vi.advanceTimersByTimeAsync(ADMIN_LIBRARY_SCAN_START_TIMEOUT_MS);
            await timeoutResult;
            expect(timeoutSignal?.aborted).toBe(true);

            const controller = new globalThis['AbortController']();
            let cancellationSignal: AbortSignal | undefined;
            sdkMocks.refreshItem.mockImplementationOnce((
                _source: Api,
                _request: unknown,
                options: { signal?: AbortSignal }
            ) => {
                cancellationSignal = options.signal;
                return new Promise(() => undefined);
            });
            const cancelled = startAdminLibraryScan({} as Api, 'library-cancelled', controller.signal);
            const cancelledResult = expect(cancelled).rejects.toMatchObject({ code: 'scan-cancelled' });
            controller.abort();
            await cancelledResult;
            expect(cancellationSignal?.aborted).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});
