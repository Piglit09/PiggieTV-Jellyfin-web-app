import type { Api } from '@jellyfin/sdk';
import type { LibraryOptionsResultDto } from '@jellyfin/sdk/lib/generated-client/models/library-options-result-dto';
import type { VirtualFolderInfo } from '@jellyfin/sdk/lib/generated-client/models/virtual-folder-info';
import type { ApiClient } from 'jellyfin-apiclient';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeAdminLibraryOptions } from './adminLibrariesAdapters';

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
        const signal = { aborted: false } as AbortSignal;

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
        const signal = { aborted: false } as AbortSignal;
        sdkMocks.getDirectoryContents.mockResolvedValue({
            data: [{ IsDirectory: true, Name: 'Movies', Path: '/media/Movies' }]
        });

        await expect(loadAdminLibraryDirectory(api, undefined, signal)).resolves.toEqual({
            entries: [{ IsDirectory: true, Name: 'Movies', Path: '/media/Movies' }],
            parentPath: '/',
            path: '/media'
        });
        expect(sdkMocks.getDefaultDirectoryBrowser).toHaveBeenCalledWith({ signal });
        expect(sdkMocks.getDirectoryContents).toHaveBeenCalledWith({
            includeDirectories: true,
            includeFiles: false,
            path: '/media'
        }, { signal });
        expect(sdkMocks.getParentPath).toHaveBeenCalledWith({ path: '/media' }, { signal });
    });

    it('loads drives at the server root and maps browse failures to a safe message', async () => {
        sdkMocks.getDefaultDirectoryBrowser.mockResolvedValue({ data: { Path: '' } });
        sdkMocks.getDrives.mockResolvedValue({ data: [
            { Name: 'Data', Path: 'D:\\' },
            { Name: 'Duplicate Data', Path: 'D:\\' },
            { Name: 'Unavailable' }
        ] });
        await expect(loadAdminLibraryDirectory(api)).resolves.toMatchObject({
            entries: [{ Name: 'Data', Path: 'D:\\' }],
            path: ''
        });

        sdkMocks.getDirectoryContents.mockRejectedValue(new Error('sensitive backend detail'));
        await expect(loadAdminLibraryDirectory(api, '/denied')).rejects.toMatchObject({
            code: 'directory-unavailable',
            message: 'This server folder could not be opened.'
        });
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
        const signal = { aborted: false } as AbortSignal;
        await expect(validateAdminLibraryPath(api, ' /mnt/media ', signal)).resolves.toBe(' /mnt/media ');
        expect(sdkMocks.validatePath).toHaveBeenCalledWith({
            validatePathDto: {
                IsFile: false,
                Path: ' /mnt/media ',
                ValidateWritable: false
            }
        }, { signal });
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
        const signal = { aborted: false } as AbortSignal;

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

    it('uses the existing recursive item refresh contract and isolates flights by source and id', async () => {
        const releases = new Map<string, () => void>();
        const clientA = {
            refreshItem: vi.fn((id: string) => new Promise<void>(resolve => {
                releases.set(id, resolve);
            }))
        } as unknown as ApiClient;
        const clientB = {
            refreshItem: vi.fn().mockResolvedValue(undefined)
        } as unknown as ApiClient;

        const first = startAdminLibraryScan(clientA, 'library-a');
        const duplicate = startAdminLibraryScan(clientA, 'library-a');
        const otherLibrary = startAdminLibraryScan(clientA, 'library-b');
        const otherServer = startAdminLibraryScan(clientB, 'library-a');

        expect(first).toBe(duplicate);
        expect(clientA.refreshItem).toHaveBeenCalledTimes(2);
        expect(clientB.refreshItem).toHaveBeenCalledOnce();
        expect(clientA.refreshItem).toHaveBeenCalledWith('library-a', {
            ImageRefreshMode: 'Default',
            MetadataRefreshMode: 'Default',
            Recursive: true,
            RegenerateTrickplay: false,
            ReplaceAllImages: false,
            ReplaceAllMetadata: false
        });

        releases.get('library-a')?.();
        releases.get('library-b')?.();
        await Promise.all([first, otherLibrary, otherServer]);
    });
});
