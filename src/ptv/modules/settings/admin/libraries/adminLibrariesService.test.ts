import type { Api } from '@jellyfin/sdk';
import {
    ItemRefreshApiAxiosParamCreator as createItemRefreshApiAxiosParams
} from '@jellyfin/sdk/lib/generated-client/api/item-refresh-api';
import type { LibraryOptions } from '@jellyfin/sdk/lib/generated-client/models/library-options';
import type { LibraryOptionsResultDto } from '@jellyfin/sdk/lib/generated-client/models/library-options-result-dto';
import { MetadataRefreshMode } from '@jellyfin/sdk/lib/generated-client/models/metadata-refresh-mode';
import type { VirtualFolderInfo } from '@jellyfin/sdk/lib/generated-client/models/virtual-folder-info';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeTransitionResponse } from '../../../../core/pluginApi';

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

const transitionMocks = vi.hoisted(() => ({ begin: vi.fn(), complete: vi.fn(), retire: vi.fn(), acknowledge: vi.fn(), clearHint: vi.fn(), current: vi.fn() }));
vi.mock('../../../../core/pluginApi', () => ({
    getCurrentPtvPluginApiClient: () => ({
        getCurrentServerId: () => 'server-a',
        matchesSdkApi: () => true,
        beginHomeTransition: transitionMocks.begin,
        completeHomeTransition: transitionMocks.complete,
        getCurrentHomeTransition: transitionMocks.current
    })
}));
vi.mock('../../../../pages/home/homeLibraryTransitionFreshness', () => ({
    retireHomeLibraryAuthority: transitionMocks.retire,
    acknowledgeHomeLibraryBeginEpoch: transitionMocks.acknowledge,
    clearHomeLibraryRetirementHint: transitionMocks.clearHint
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
    rebindAdminLibraryTransition,
    retryAdminLibraryTransitionConvergence,
    retryAdminLibraryTransitionGeneration,
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

const testEpoch = 'a'.repeat(64);

beforeEach(() => {
    let intent: { operationId?: string; intendedLibrary?: { libraryId: string; name: string; collectionType: string; roots: string[]; options: LibraryOptions } } = {};
    transitionMocks.begin.mockImplementation(async value => {
        intent = value;
        return { operationId: value.operationId, epoch: testEpoch, held: true, state: 'pending', writeAllowed: true };
    });
    transitionMocks.complete.mockImplementation(async () => ({ operationId: intent.operationId, epoch: testEpoch, held: true, state: 'pending', authority: 'binding-required', library: intent.intendedLibrary ? {
        ItemId: intent.intendedLibrary.libraryId || 'library-a', Name: intent.intendedLibrary.name,
        CollectionType: intent.intendedLibrary.collectionType, Locations: intent.intendedLibrary.roots, LibraryOptions: intent.intendedLibrary.options
    } : null }));
    transitionMocks.retire.mockReset();
    transitionMocks.acknowledge.mockReset();
    transitionMocks.clearHint.mockReset();
});

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
        sdkMocks.getVirtualFolders
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({
                data: [library({
                    ItemId: 'new-id',
                    LibraryOptions: { PathInfos: [{ Path: ' /media/b ' }] },
                    Locations: ['/media/a'],
                    Name: 'New Movies'
                })]
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
        expect(sdkMocks.getVirtualFolders).toHaveBeenCalledTimes(2);
    });

    it('reuses one exact preflight match among same-name and same-path decoys without requiring ItemId', async () => {
        const exact = library({
            CollectionType: 'movies',
            ItemId: undefined,
            LibraryOptions: {
                PathInfos: [
                    { Path: '/media/archive' },
                    { Path: '/media/movies' },
                    { Path: '/media/archive' }
                ]
            },
            Locations: ['/media/movies'],
            Name: 'Cinema'
        });
        sdkMocks.getVirtualFolders.mockResolvedValue({
            data: [
                library({ Name: 'Cinema Archive' }),
                library({ Locations: ['/media/archive', '/media/movies'], Name: 'cinema' }),
                library({ CollectionType: 'music', Name: 'Cinema' }),
                library({ Locations: ['/media/movies'], Name: 'Cinema' }),
                library({ Locations: ['/media/movies', '/media/archive', '/media/extra'], Name: 'Cinema' }),
                library({ Locations: ['/media/movies', '/media/other'], Name: 'Cinema' }),
                library({ Locations: ['/MEDIA/movies', '/media/archive'], Name: 'Cinema' }),
                library({ Locations: ['\\media\\movies', '/media/archive'], Name: 'Cinema' }),
                exact
            ]
        });

        await expect(createAdminLibrary(api, {
            collectionType: 'movies',
            locations: ['/media/archive', '/media/movies'],
            name: ' Cinema '
        }, creationOptions())).resolves.toBe(exact);

        expect(sdkMocks.getVirtualFolders).toHaveBeenCalledOnce();
        expect(sdkMocks.addVirtualFolder).not.toHaveBeenCalled();
    });

    it('accepts multiple exact preflight matches as unresolved without another POST', async () => {
        sdkMocks.getVirtualFolders.mockResolvedValue({
            data: [
                library({
                    ItemId: 'match-a',
                    LibraryOptions: { PathInfos: [{ Path: '/media/new' }] },
                    Locations: ['/media/new'],
                    Name: 'New Movies'
                }),
                library({
                    ItemId: undefined,
                    LibraryOptions: { PathInfos: [{ Path: '/media/new' }] },
                    Locations: [],
                    Name: 'New Movies'
                })
            ]
        });

        await expect(createAdminLibrary(api, {
            collectionType: 'movies',
            locations: ['/media/new'],
            name: 'New Movies'
        }, creationOptions())).resolves.toBeNull();

        expect(sdkMocks.getVirtualFolders).toHaveBeenCalledOnce();
        expect(sdkMocks.addVirtualFolder).not.toHaveBeenCalled();
    });

    it('treats an absent configured collection type as the same Mixed definition', async () => {
        const exact = library({
            CollectionType: undefined,
            ItemId: undefined,
            LibraryOptions: { PathInfos: [{ Path: '/media/mixed' }] },
            Locations: [],
            Name: 'Mixed'
        });
        sdkMocks.getVirtualFolders.mockResolvedValue({ data: [exact] });

        await expect(createAdminLibrary(api, {
            collectionType: 'mixed',
            locations: ['/media/mixed'],
            name: 'Mixed'
        }, creationOptions())).resolves.toBe(exact);

        expect(sdkMocks.getVirtualFolders).toHaveBeenCalledOnce();
        expect(sdkMocks.addVirtualFolder).not.toHaveBeenCalled();
    });

    it('does not suppress a create for noncanonical returned collection type case or whitespace', async () => {
        sdkMocks.getVirtualFolders
            .mockResolvedValueOnce({ data: [
                library({
                    CollectionType: 'Movies' as never,
                    LibraryOptions: { PathInfos: [] },
                    Locations: ['/media/new'],
                    Name: 'New Movies'
                }),
                library({
                    CollectionType: ' movies ' as never,
                    LibraryOptions: { PathInfos: [] },
                    Locations: ['/media/new'],
                    Name: 'New Movies'
                })
            ] })
            .mockResolvedValueOnce({ data: [] });

        await expect(createAdminLibrary(api, {
            collectionType: 'movies',
            locations: ['/media/new'],
            name: 'New Movies'
        }, creationOptions())).resolves.toBeNull();

        expect(sdkMocks.addVirtualFolder).toHaveBeenCalledOnce();
        expect(sdkMocks.getVirtualFolders).toHaveBeenCalledTimes(2);
    });

    it('does not reconcile a rejected Mixed create from an invalid non-string returned type', async () => {
        const invalidType = library({
            CollectionType: 42 as never,
            LibraryOptions: { PathInfos: [] },
            Locations: ['/media/mixed'],
            Name: 'Mixed'
        });
        sdkMocks.getVirtualFolders
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [invalidType] });
        sdkMocks.addVirtualFolder.mockRejectedValueOnce(new Error('server returned 500'));

        await expect(createAdminLibrary(api, {
            collectionType: 'mixed',
            locations: ['/media/mixed'],
            name: 'Mixed'
        }, creationOptions())).rejects.toMatchObject({
            code: 'creation-outcome-uncertain'
        });

        expect(sdkMocks.addVirtualFolder).toHaveBeenCalledOnce();
        expect(sdkMocks.getVirtualFolders).toHaveBeenCalledTimes(2);
    });

    it('reconciles one exact match after a rejected POST without retrying the mutation', async () => {
        const exact = library({
            ItemId: 'created-id',
            LibraryOptions: { PathInfos: [{ Path: '/media/archive' }] },
            Locations: ['/media/new'],
            Name: 'New Movies'
        });
        sdkMocks.getVirtualFolders
            .mockResolvedValueOnce({ data: [
                library({ ItemId: 'name-decoy', Locations: ['/media/other'], Name: 'New Movies' }),
                library({ ItemId: 'path-decoy', Locations: ['/media/new', '/media/archive'], Name: 'New Movies Archive' })
            ] })
            .mockResolvedValueOnce({ data: [
                library({ CollectionType: 'music', ItemId: 'type-decoy', Locations: ['/media/new', '/media/archive'], Name: 'New Movies' }),
                exact
            ] });
        sdkMocks.addVirtualFolder.mockRejectedValueOnce(new Error('server returned 500'));

        await expect(createAdminLibrary(api, {
            collectionType: 'movies',
            locations: ['/media/archive', '/media/new'],
            name: 'New Movies'
        }, creationOptions())).resolves.toBe(exact);

        expect(sdkMocks.addVirtualFolder).toHaveBeenCalledOnce();
        expect(sdkMocks.getVirtualFolders).toHaveBeenCalledTimes(2);
    });

    it('accepts multiple exact rejected-POST readback matches as unresolved without retrying', async () => {
        sdkMocks.getVirtualFolders
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [
                library({
                    ItemId: 'match-a',
                    LibraryOptions: { PathInfos: [{ Path: '/media/new' }] },
                    Locations: ['/media/new'],
                    Name: 'New Movies'
                }),
                library({
                    ItemId: 'match-b',
                    LibraryOptions: { PathInfos: [{ Path: '/media/new' }] },
                    Locations: ['/media/new'],
                    Name: 'New Movies'
                })
            ] });
        sdkMocks.addVirtualFolder.mockRejectedValueOnce(new Error('server returned 500'));

        await expect(createAdminLibrary(api, {
            collectionType: 'movies',
            locations: ['/media/new'],
            name: 'New Movies'
        }, creationOptions())).resolves.toBeNull();

        expect(sdkMocks.addVirtualFolder).toHaveBeenCalledOnce();
        expect(sdkMocks.getVirtualFolders).toHaveBeenCalledTimes(2);
    });

    it('raises a typed uncertain outcome when rejected-POST readback has no exact match or fails', async () => {
        sdkMocks.getVirtualFolders
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [
                library({ Locations: ['/media/different'], Name: 'New Movies' }),
                library({ Locations: ['/media/new'], Name: 'New Movies Archive' })
            ] });
        sdkMocks.addVirtualFolder.mockRejectedValueOnce(new Error('server returned 500'));

        await expect(createAdminLibrary(api, {
            collectionType: 'movies',
            locations: ['/media/new'],
            name: 'New Movies'
        }, creationOptions())).rejects.toMatchObject({
            code: 'creation-outcome-uncertain'
        });
        expect(sdkMocks.addVirtualFolder).toHaveBeenCalledOnce();

        vi.clearAllMocks();
        sdkMocks.validatePath.mockResolvedValue({ data: undefined });
        sdkMocks.getVirtualFolders
            .mockResolvedValueOnce({ data: [] })
            .mockRejectedValueOnce(new Error('list unavailable'));
        sdkMocks.addVirtualFolder.mockRejectedValueOnce(new Error('server returned 500'));

        await expect(createAdminLibrary(api, {
            collectionType: 'movies',
            locations: ['/media/new'],
            name: 'New Movies'
        }, creationOptions())).rejects.toMatchObject({
            code: 'creation-outcome-uncertain'
        });
        expect(sdkMocks.addVirtualFolder).toHaveBeenCalledOnce();
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
        sdkMocks.getVirtualFolders
            .mockResolvedValueOnce({ data: [] })
            .mockRejectedValueOnce(new Error('list unavailable'));
        await expect(createAdminLibrary(api, {
            collectionType: 'movies',
            locations: ['/media/new'],
            name: 'New Movies'
        }, creationOptions())).resolves.toBeNull();
        expect(sdkMocks.addVirtualFolder).toHaveBeenCalledOnce();

        vi.clearAllMocks();
        sdkMocks.addVirtualFolder.mockResolvedValue({ data: undefined });
        sdkMocks.validatePath.mockResolvedValue({ data: undefined });
        sdkMocks.getVirtualFolders
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [
                library({
                    ItemId: 'new-a',
                    LibraryOptions: { PathInfos: [{ Path: '/media/new' }] },
                    Locations: ['/media/new'],
                    Name: 'New Movies'
                }),
                library({
                    ItemId: 'new-b',
                    LibraryOptions: { PathInfos: [{ Path: '/media/new' }] },
                    Locations: ['/media/new'],
                    Name: 'New Movies'
                })
            ] });
        await expect(createAdminLibrary(api, {
            collectionType: 'movies',
            locations: ['/media/new'],
            name: 'New Movies'
        }, creationOptions())).resolves.toBeNull();
        expect(sdkMocks.addVirtualFolder).toHaveBeenCalledOnce();

        vi.clearAllMocks();
        sdkMocks.addVirtualFolder.mockResolvedValue({ data: undefined });
        sdkMocks.validatePath.mockResolvedValue({ data: undefined });
        sdkMocks.getVirtualFolders
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [] });
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

        if (!saved) throw new Error('Plugin readback must prove this saved definition');
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

        if (!saved) throw new Error('Plugin readback must prove this saved definition');
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

        if (!saved) throw new Error('Plugin readback must prove this saved definition');
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

describe('controlled library transition envelope', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        sdkMocks.getVirtualFolders.mockResolvedValue({ data: [library()] });
        sdkMocks.validatePath.mockResolvedValue({ data: undefined });
        transitionMocks.begin.mockImplementation(async value => ({ operationId: value.operationId, epoch: testEpoch, held: true, state: 'pending', writeAllowed: true }));
        transitionMocks.complete.mockResolvedValue({ operationId: 'operation-a', epoch: testEpoch, held: true, state: 'pending', authority: 'unresolved', library: null });
    });
    it.each(['create', 'rename', 'delete', 'add-path', 'remove-path', 'options', 'providers'])('orders retirement, durable Begin, one %s write and Plugin Complete', async kind => {
        const order: string[] = [];
        transitionMocks.retire.mockImplementation(() => order.push('retire'));
        transitionMocks.acknowledge.mockImplementation(() => order.push('acknowledge'));
        transitionMocks.clearHint.mockImplementation(() => order.push('clear-hint'));
        transitionMocks.begin.mockImplementation(async value => {
            order.push('begin');
            return { operationId: value.operationId, epoch: testEpoch, held: true, state: 'pending', writeAllowed: true };
        });
        transitionMocks.complete.mockImplementation(async () => {
            order.push('complete');
            return { operationId: 'operation-a', epoch: testEpoch, held: true, state: 'pending', authority: 'unresolved', library: null };
        });
        const write = async () => {
            order.push('write');
            return { data: undefined };
        };
        for (const name of ['addVirtualFolder', 'renameVirtualFolder', 'removeVirtualFolder', 'addMediaPath', 'removeMediaPath', 'updateLibraryOptions'] as const) sdkMocks[name].mockImplementation(write);
        if (kind === 'create') await createAdminLibrary(api, { name: 'New', collectionType: 'movies', locations: ['/new'] }, creationOptions());
        if (kind === 'rename') await renameAdminLibrary(api, 'library-a', 'Films', 'Movies');
        if (kind === 'delete') await removeAdminLibrary(api, 'library-a');
        if (kind === 'add-path') await addAdminLibraryPath(api, 'library-a', '/new');
        if (kind === 'remove-path') await removeAdminLibraryPath(api, 'library-a', '/media/movies');
        if (kind === 'options') await updateAdminLibraryOptions(api, 'library-a', { enabled: false }, normalizeAdminLibraryOptions(library().LibraryOptions!));
        if (kind === 'providers') {
            const providers = { metadataSavers: [], groups: [] } as unknown as AdminLibraryProviderSummary;
            await updateAdminLibraryProviders(api, 'library-a', providers, providers, library().LibraryOptions!);
        }
        expect(order).toEqual(['retire', 'begin', 'acknowledge', 'clear-hint', 'write', 'complete']);
    });
    it('records Mixed and final-root removal exactly while keeping the stock no-refresh write', async () => {
        sdkMocks.getVirtualFolders.mockResolvedValueOnce({ data: [library({ CollectionType: undefined })] });
        await removeAdminLibraryPath(api, 'library-a', '/media/movies');
        expect(transitionMocks.begin.mock.calls[0][0]).toMatchObject({ expectedLibrary: { collectionType: 'mixed', roots: ['/media/movies'] }, intendedLibrary: { collectionType: 'mixed', roots: [], options: { PathInfos: [] } } });
        expect(sdkMocks.removeMediaPath).toHaveBeenCalledWith({ name: 'Movies', path: '/media/movies', refreshLibrary: false }, { signal: undefined });
    });
    it('never repeats a stock write after a replayed Begin', async () => {
        transitionMocks.begin.mockImplementationOnce(async value => ({ operationId: value.operationId, epoch: testEpoch, held: true, state: 'pending', writeAllowed: false }));
        await expect(removeAdminLibrary(api, 'library-a')).rejects.toThrow();
        expect(sdkMocks.removeVirtualFolder).not.toHaveBeenCalled();
    });
    it('creates an operation ID on HTTP clients with getRandomValues but no randomUUID', async () => {
        vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(7) });
        try {
            await removeAdminLibrary(api, 'library-a');
            expect(transitionMocks.begin.mock.calls[0][0].operationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        } finally { vi.unstubAllGlobals(); }
    });
    it('rejects a Begin acknowledgment for a different operation before stock write', async () => {
        transitionMocks.begin.mockResolvedValueOnce({ operationId: 'different-operation', epoch: testEpoch, held: true, state: 'pending', writeAllowed: true });
        await expect(removeAdminLibrary(api, 'library-a')).rejects.toThrow();
        expect(sdkMocks.removeVirtualFolder).not.toHaveBeenCalled();
        expect(transitionMocks.acknowledge).not.toHaveBeenCalled();
        expect(transitionMocks.clearHint).toHaveBeenCalledOnce();
    });
    it('rejects a malformed Begin epoch before stock write', async () => {
        transitionMocks.begin.mockImplementationOnce(async value => ({ operationId: value.operationId, epoch: 'not-a-valid-epoch', held: true, state: 'pending', writeAllowed: true }));
        await expect(removeAdminLibrary(api, 'library-a')).rejects.toThrow();
        expect(sdkMocks.removeVirtualFolder).not.toHaveBeenCalled();
        expect(transitionMocks.acknowledge).not.toHaveBeenCalled();
        expect(transitionMocks.clearHint).toHaveBeenCalledOnce();
    });
    it('performs zero Jellyfin writes when Begin persistence fails', async () => {
        transitionMocks.begin.mockRejectedValueOnce(new Error('persistence failed'));
        await expect(removeAdminLibrary(api, 'library-a')).rejects.toThrow('persistence failed');
        expect(sdkMocks.removeVirtualFolder).not.toHaveBeenCalled();
        expect(transitionMocks.complete).not.toHaveBeenCalled();
        expect(transitionMocks.clearHint).toHaveBeenCalledOnce();
    });
    it('leaves an uncertain stock write held without Complete or retry', async () => {
        sdkMocks.renameVirtualFolder.mockRejectedValueOnce(new Error('connection lost'));
        await expect(renameAdminLibrary(api, 'library-a', 'Films', 'Movies')).rejects.toThrow();
        expect(transitionMocks.begin).toHaveBeenCalledOnce();
        expect(sdkMocks.renameVirtualFolder).toHaveBeenCalledOnce();
        expect(transitionMocks.complete).not.toHaveBeenCalled();
    });
    it('does not adopt an old folder attached to unresolved completion evidence', async () => {
        transitionMocks.complete.mockImplementationOnce(async operationId => ({ operationId, epoch: testEpoch, held: true, state: 'pending', authority: 'unresolved', library: library() }));
        sdkMocks.renameVirtualFolder.mockResolvedValueOnce({ status: 204 });
        expect(await renameAdminLibrary(api, 'library-a', 'Films', 'Movies')).toBeNull();
    });
    it('does not adopt readback for a mismatched completion operation', async () => {
        transitionMocks.complete.mockResolvedValueOnce({ operationId: 'different', epoch: testEpoch, held: true, state: 'pending', authority: 'binding-required', library: library({ Name: 'Films' }) });
        sdkMocks.renameVirtualFolder.mockResolvedValueOnce({ status: 204 });
        expect(await renameAdminLibrary(api, 'library-a', 'Films', 'Movies')).toBeNull();
    });
    it('does not adopt a synthetic old ID after rename 204 with null authoritative ID', async () => {
        sdkMocks.renameVirtualFolder.mockResolvedValueOnce({ status: 204 });
        sdkMocks.getVirtualFolders.mockResolvedValueOnce({ data: [library()] }).mockResolvedValue({ data: [library({ Name: 'Films', ItemId: null })] });
        expect(await renameAdminLibrary(api, 'library-a', 'Films', 'Movies')).toBeNull();
    });

    it('uses an empty diagnostic Complete body and passes the AbortSignal separately', async () => {
        const controller = new globalThis['AbortController']();
        sdkMocks.removeVirtualFolder.mockResolvedValueOnce({ status: 204 });
        await removeAdminLibrary(api, 'library-a', undefined, controller.signal);
        expect(transitionMocks.complete).toHaveBeenCalledWith(expect.any(String), {}, { signal: controller.signal });
    });
});

describe('explicit administrator home binding', () => {
    const selectedId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const diagnostic = (): HomeTransitionResponse => ({
        operationId: 'operation-a', epoch: testEpoch, held: true, state: 'pending' as const,
        authority: 'binding-required' as const, affectedRuleIds: ['anime', 'movies'], writeAllowed: false,
        library: library({ ItemId: selectedId })
    });
    const bindings = [
        { ruleId: 'anime', libraryId: selectedId },
        { ruleId: 'movies', libraryId: selectedId }
    ];
    beforeEach(() => {
        vi.clearAllMocks();
    });
    it('submits every explicitly selected rule and records only the verified new Plugin epoch', async () => {
        const nextEpoch = 'b'.repeat(64);
        transitionMocks.complete.mockResolvedValueOnce({
            operationId: 'operation-a', epoch: nextEpoch, held: false,
            state: 'complete', authority: 'bound', affectedRuleIds: [],
            library: library({ ItemId: selectedId })
        });
        const result = await rebindAdminLibraryTransition(api, diagnostic(), bindings);
        expect(result.state).toBe('complete');
        expect(transitionMocks.complete).toHaveBeenCalledWith('operation-a', { bindings }, { signal: undefined });
        expect(transitionMocks.acknowledge).toHaveBeenCalledWith(nextEpoch);
    });
    it('rebinds a verified completed operation after the broad hold has been released', async () => {
        const released = { ...diagnostic(), state: 'complete' as const, held: false };
        const nextEpoch = 'b'.repeat(64);
        transitionMocks.complete.mockResolvedValueOnce({
            ...released, epoch: nextEpoch, authority: 'bound'
        });
        const result = await rebindAdminLibraryTransition(api, released, bindings);
        expect(result.epoch).toBe(nextEpoch);
        expect(transitionMocks.complete).toHaveBeenCalledWith('operation-a', { bindings }, { signal: undefined });
        expect(transitionMocks.acknowledge).toHaveBeenCalledWith(nextEpoch);
    });
    it('accepts an already-rotated completed diagnostic only when an idempotent retry finally binds that same epoch', async () => {
        const released = { ...diagnostic(), state: 'complete' as const, held: false };
        transitionMocks.complete.mockResolvedValueOnce({ ...released, authority: 'bound', affectedRuleIds: [] });
        const result = await rebindAdminLibraryTransition(api, released, bindings);
        expect(result.epoch).toBe(testEpoch);
        expect(result.authority).toBe('bound');
        expect(transitionMocks.complete).toHaveBeenCalledWith('operation-a', { bindings }, { signal: undefined });
        expect(transitionMocks.acknowledge).toHaveBeenCalledWith(testEpoch);
    });
    it('rejects a same-epoch bound response when the input diagnostic is still held before rebind', async () => {
        transitionMocks.complete.mockResolvedValueOnce({
            ...diagnostic(), held: false, state: 'complete', authority: 'bound', affectedRuleIds: []
        });
        await expect(rebindAdminLibraryTransition(api, diagnostic(), bindings)).rejects.toThrow();
        expect(transitionMocks.acknowledge).not.toHaveBeenCalled();
    });
    it.each([
        ['missing candidate', { ...diagnostic(), library: null }, bindings],
        ['unresolved candidate', { ...diagnostic(), authority: 'unresolved' as const }, bindings],
        ['released but unresolved', { ...diagnostic(), state: 'complete' as const, held: false, authority: 'unresolved' as const }, bindings],
        ['released but still pending', { ...diagnostic(), state: 'pending' as const, held: false }, bindings],
        ['malformed diagnostic epoch', { ...diagnostic(), epoch: 'storage-hint' }, bindings],
        ['wrong folder', diagnostic(), [{ ruleId: 'anime', libraryId: 'wrong' }, bindings[1]]],
        ['partial rules', diagnostic(), [bindings[0]]],
        ['duplicate rules', diagnostic(), [bindings[0], bindings[0]]],
        ['wrong rule', diagnostic(), [bindings[0], { ruleId: 'other', libraryId: selectedId }]]
    ])('refuses %s without sending a rebind request', async (_name, current, selection) => {
        await expect(rebindAdminLibraryTransition(api, current, selection)).rejects.toThrow();
        expect(transitionMocks.complete).not.toHaveBeenCalled();
        expect(transitionMocks.acknowledge).not.toHaveBeenCalled();
    });
    it('keeps the old expected epoch if the Plugin returns a different operation', async () => {
        transitionMocks.complete.mockResolvedValueOnce({
            operationId: 'operation-b', epoch: 'b'.repeat(64), held: false, state: 'complete'
        });
        await expect(rebindAdminLibraryTransition(api, diagnostic(), bindings)).rejects.toThrow();
        expect(transitionMocks.acknowledge).not.toHaveBeenCalled();
    });
    it('rejects same-epoch unresolved Plugin readback without acknowledging it', async () => {
        transitionMocks.complete.mockResolvedValueOnce({
            operationId: 'operation-a', epoch: testEpoch, held: true, state: 'pending',
            authority: 'unresolved', library: null, affectedRuleIds: ['anime', 'movies']
        });
        await expect(rebindAdminLibraryTransition(api, diagnostic(), bindings)).rejects.toThrow();
        expect(transitionMocks.acknowledge).not.toHaveBeenCalled();
    });
    it('rejects a released same-epoch non-bound retry while preserving local retirement', async () => {
        const released = { ...diagnostic(), state: 'complete' as const, held: false };
        transitionMocks.complete.mockResolvedValueOnce({ ...released, authority: 'binding-required' });
        await expect(rebindAdminLibraryTransition(api, released, bindings)).rejects.toThrow();
        expect(transitionMocks.acknowledge).not.toHaveBeenCalled();
    });
    it('keeps local authority retired while fresh generation is still held', async () => {
        const nextEpoch = 'b'.repeat(64);
        transitionMocks.complete.mockResolvedValueOnce({
            operationId: 'operation-a', epoch: nextEpoch, held: true, state: 'pending',
            authority: 'binding-required', library: library({ ItemId: selectedId }),
            affectedRuleIds: ['anime', 'movies']
        });
        const result = await rebindAdminLibraryTransition(api, diagnostic(), bindings);
        expect(result.held).toBe(true);
        expect(transitionMocks.acknowledge).not.toHaveBeenCalled();
    });
    it.each([
        ['unresolved', false, 'complete'],
        ['binding-required', false, 'complete'],
        ['bound', true, 'complete'],
        ['bound', true, 'pending']
    ] as const)('does not acknowledge a rotated but %s / held=%s / %s Plugin response', async (authority, held, state) => {
        const nextEpoch = 'b'.repeat(64);
        transitionMocks.complete.mockResolvedValueOnce({
            operationId: 'operation-a', epoch: nextEpoch, held, state, authority,
            affectedRuleIds: ['anime', 'movies'], library: library({ ItemId: selectedId })
        });
        const result = await rebindAdminLibraryTransition(api, diagnostic(), bindings);
        expect(result.epoch).toBe(nextEpoch);
        expect(transitionMocks.acknowledge).not.toHaveBeenCalled();
    });
});

describe('explicit administrator Home generation retry', () => {
    const diagnostic = (): HomeTransitionResponse => ({
        operationId: 'operation-a', epoch: testEpoch, held: false, state: 'complete',
        authority: 'generation-pending', affectedRuleIds: [], writeAllowed: false, library: null
    });
    beforeEach(() => vi.clearAllMocks());

    it('retries the verified current operation without bindings and only acknowledges final bound authority', async () => {
        const current = diagnostic();
        const signal = new globalThis['AbortController']().signal;
        transitionMocks.complete.mockResolvedValueOnce({ ...current, authority: 'bound' });
        const result = await retryAdminLibraryTransitionGeneration(api, current, signal);
        expect(result.authority).toBe('bound');
        expect(transitionMocks.complete).toHaveBeenCalledWith('operation-a', {}, { signal });
        expect(transitionMocks.acknowledge).toHaveBeenCalledWith(testEpoch);
    });

    it.each([
        ['still pending', { authority: 'generation-pending', held: false, state: 'complete' }],
        ['unresolved', { authority: 'unresolved', held: false, state: 'complete' }],
        ['held', { authority: 'bound', held: true, state: 'pending' }]
    ] as const)('keeps local retirement sticky when retry is %s', async (_name, overrides) => {
        const current = diagnostic();
        transitionMocks.complete.mockResolvedValueOnce({ ...current, ...overrides });
        await retryAdminLibraryTransitionGeneration(api, current);
        expect(transitionMocks.acknowledge).not.toHaveBeenCalled();
    });

    it.each([
        ['a pending rule', { affectedRuleIds: ['anime'] as string[] }],
        ['the wrong authority', { authority: 'binding-required' }],
        ['a held operation', { held: true }],
        ['a malformed epoch', { epoch: 'storage-hint' }],
        ['a missing operation', { operationId: null }]
    ] as const)('refuses retry for %s', async (_name, overrides) => {
        await expect(retryAdminLibraryTransitionGeneration(api, { ...diagnostic(), ...overrides })).rejects.toThrow();
        expect(transitionMocks.complete).not.toHaveBeenCalled();
        expect(transitionMocks.acknowledge).not.toHaveBeenCalled();
    });

    it.each([
        ['changed operation', { operationId: 'operation-b' }],
        ['rotated epoch', { epoch: 'b'.repeat(64) }],
        ['malformed epoch', { epoch: 'storage-hint' }]
    ])('refuses a %s response without acknowledging it', async (_name, overrides) => {
        transitionMocks.complete.mockResolvedValueOnce({ ...diagnostic(), authority: 'bound', ...overrides });
        await expect(retryAdminLibraryTransitionGeneration(api, diagnostic())).rejects.toThrow();
        expect(transitionMocks.acknowledge).not.toHaveBeenCalled();
    });
});

describe('explicit administrator Jellyfin convergence retry', () => {
    const diagnostic = (state: 'pending' | 'failed' = 'pending'): HomeTransitionResponse => ({
        operationId: 'operation-a', epoch: testEpoch, held: true, state,
        authority: 'unresolved', affectedRuleIds: ['anime'], writeAllowed: false, library: null
    });
    beforeEach(() => vi.clearAllMocks());

    it.each(['pending', 'failed'] as const)('retries a held %s operation once without stock writes or authority acknowledgment', async state => {
        const current = diagnostic(state);
        const signal = new globalThis['AbortController']().signal;
        transitionMocks.complete.mockResolvedValueOnce(current);
        const result = await retryAdminLibraryTransitionConvergence(api, current, signal);
        expect(result).toEqual(current);
        expect(transitionMocks.complete).toHaveBeenCalledOnce();
        expect(transitionMocks.complete).toHaveBeenCalledWith('operation-a', {}, { signal });
        expect(transitionMocks.acknowledge).not.toHaveBeenCalled();
        for (const stockWrite of [ sdkMocks.addVirtualFolder, sdkMocks.removeVirtualFolder,
            sdkMocks.renameVirtualFolder, sdkMocks.updateLibraryOptions, sdkMocks.addMediaPath,
            sdkMocks.removeMediaPath, sdkMocks.refreshItem, sdkMocks.startTask ]) {
            expect(stockWrite).not.toHaveBeenCalled();
        }
    });

    it('leaves local Home authority retired after unique readback while affected rules need binding', async () => {
        const current = diagnostic();
        transitionMocks.complete.mockResolvedValueOnce({ ...current, held: false, state: 'complete',
            authority: 'binding-required', library: library({ ItemId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }) });
        const result = await retryAdminLibraryTransitionConvergence(api, current);
        expect(result.authority).toBe('binding-required');
        expect(transitionMocks.acknowledge).not.toHaveBeenCalled();
    });

    it('acknowledges only the final durable release with bound authority and no affected rules', async () => {
        const current = diagnostic();
        transitionMocks.complete.mockResolvedValueOnce({ ...current, held: false, state: 'complete',
            authority: 'bound', affectedRuleIds: [] });
        const result = await retryAdminLibraryTransitionConvergence(api, current);
        expect(result.authority).toBe('bound');
        expect(transitionMocks.acknowledge).toHaveBeenCalledWith(testEpoch);
    });

    it.each([
        ['no operation', { operationId: null }],
        ['blank operation', { operationId: '  ' }],
        ['malformed epoch', { epoch: 'storage-hint' }],
        ['malformed hold', { held: 'true' as unknown as boolean }],
        ['released hold', { held: false }],
        ['completed operation', { state: 'complete' }],
        ['binding choice', { authority: 'binding-required' }]
    ] as const)('rejects a %s diagnostic before Complete', async (_name, overrides) => {
        await expect(retryAdminLibraryTransitionConvergence(api, { ...diagnostic(), ...overrides })).rejects.toThrow();
        expect(transitionMocks.complete).not.toHaveBeenCalled();
        expect(transitionMocks.acknowledge).not.toHaveBeenCalled();
    });

    it.each([
        ['changed operation', { operationId: 'operation-b' }],
        ['changed epoch', { epoch: 'b'.repeat(64) }],
        ['malformed epoch', { epoch: 'storage-hint' }],
        ['malformed hold', { held: 'false' }],
        ['missing write authorization status', { writeAllowed: undefined }],
        ['released pending state', { held: false, state: 'pending' }],
        ['bound with affected rules', { held: false, state: 'complete', authority: 'bound' }]
    ])('rejects a %s Complete response without acknowledging it', async (_name, overrides) => {
        transitionMocks.complete.mockResolvedValueOnce({ ...diagnostic(), ...overrides });
        await expect(retryAdminLibraryTransitionConvergence(api, diagnostic())).rejects.toThrow();
        expect(transitionMocks.acknowledge).not.toHaveBeenCalled();
    });
});
