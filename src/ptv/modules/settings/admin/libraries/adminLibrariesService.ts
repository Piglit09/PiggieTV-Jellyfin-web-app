import type { Api } from '@jellyfin/sdk';
import type { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import type { CollectionTypeOptions } from '@jellyfin/sdk/lib/generated-client/models/collection-type-options';
import type { FileSystemEntryInfo } from '@jellyfin/sdk/lib/generated-client/models/file-system-entry-info';
import type { LibraryOptions } from '@jellyfin/sdk/lib/generated-client/models/library-options';
import type { LibraryOptionsResultDto } from '@jellyfin/sdk/lib/generated-client/models/library-options-result-dto';
import type { TaskInfo } from '@jellyfin/sdk/lib/generated-client/models/task-info';
import type { VirtualFolderInfo } from '@jellyfin/sdk/lib/generated-client/models/virtual-folder-info';
import { getEnvironmentApi } from '@jellyfin/sdk/lib/utils/api/environment-api';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { getLibraryStructureApi } from '@jellyfin/sdk/lib/utils/api/library-structure-api';
import { getScheduledTasksApi } from '@jellyfin/sdk/lib/utils/api/scheduled-tasks-api';

import type { ApiClient } from 'jellyfin-apiclient';

import {
    areAdminLibraryProviderConfigurationsEqual,
    areAdminLibraryOptionsEqual,
    buildDefaultAdminLibraryOptions,
    normalizeAdminLibraryOptions,
    patchAdminLibraryOptions,
    patchAdminLibraryProviders
} from './adminLibrariesAdapters';
import type {
    AdminLibraryOptionsForm,
    AdminLibraryOptionsPatch,
    AdminLibraryProviderSummary,
    CreateAdminLibraryInput
} from './adminLibrariesModel';

export type AdminLibrariesServiceErrorCode =
    | 'creation-options-unavailable'
    | 'conflict'
    | 'directory-unavailable'
    | 'invalid-library'
    | 'invalid-library-name'
    | 'invalid-library-path'
    | 'libraries-unavailable'
    | 'library-options-unavailable'
    | 'scan-unavailable'
    | 'tasks-unavailable';

export class AdminLibrariesServiceError extends Error {
    public readonly code: AdminLibrariesServiceErrorCode;

    public constructor(code: AdminLibrariesServiceErrorCode, message: string) {
        super(message);
        this.code = code;
        this.name = 'AdminLibrariesServiceError';
    }
}

function requireLibraryId(libraryId: string) {
    const id = libraryId.trim();
    if (!id) {
        throw new AdminLibrariesServiceError('invalid-library', 'Choose a valid library.');
    }
    return id;
}

function requireLibraryName(name: string) {
    const value = name.trim();
    if (!value) {
        throw new AdminLibrariesServiceError('invalid-library-name', 'Enter a library name.');
    }
    return value;
}

/** Validates emptiness without rewriting the server path. */
function requireLibraryPath(path: string) {
    if (typeof path !== 'string' || !path.trim()) {
        throw new AdminLibrariesServiceError('invalid-library-path', 'Choose a media folder.');
    }
    return path;
}

function uniquePaths(paths: readonly string[]) {
    const result: string[] = [];
    const seen = new Set<string>();
    paths.forEach(path => {
        const value = requireLibraryPath(path);
        if (seen.has(value)) return;
        seen.add(value);
        result.push(value);
    });
    if (!result.length) {
        throw new AdminLibrariesServiceError('invalid-library-path', 'Add at least one media folder.');
    }
    return result;
}

function normalizeContentType(value: string): CollectionType | undefined {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return undefined;
    return normalized as CollectionType;
}

function normalizeCreateCollectionType(value: string): CollectionTypeOptions | undefined {
    const normalized = value.trim().toLowerCase();
    // Jellyfin's established creator represents Mixed by omitting collectionType.
    if (!normalized || normalized === 'mixed') return undefined;
    return normalized as CollectionTypeOptions;
}

export async function loadAdminLibraries(
    api: Api,
    signal?: AbortSignal
): Promise<VirtualFolderInfo[]> {
    const response = await getLibraryStructureApi(api).getVirtualFolders({ signal });
    if (!Array.isArray(response.data)) {
        throw new AdminLibrariesServiceError('libraries-unavailable', 'We could not load your libraries.');
    }
    return response.data;
}

export async function loadAdminLibrary(
    api: Api,
    libraryId: string,
    signal?: AbortSignal
): Promise<VirtualFolderInfo> {
    const libraries = await loadAdminLibraries(api, signal);
    return resolveAdminLibrary(libraries, libraryId);
}

export function resolveAdminLibrary(
    libraries: readonly VirtualFolderInfo[],
    libraryId: string
): VirtualFolderInfo {
    const id = requireLibraryId(libraryId).toLowerCase();
    const library = libraries.find(value => value.ItemId?.trim().toLowerCase() === id);
    if (!library?.ItemId || !library.Name) {
        throw new AdminLibrariesServiceError('invalid-library', 'This library could not be found.');
    }
    return library;
}

export async function loadAdminLibraryOptionsInfo(
    api: Api,
    collectionType: string,
    isNewLibrary: boolean,
    signal?: AbortSignal
): Promise<LibraryOptionsResultDto> {
    const response = await getLibraryApi(api).getLibraryOptionsInfo({
        isNewLibrary,
        libraryContentType: normalizeContentType(collectionType)
    }, { signal });
    if (!response.data || typeof response.data !== 'object') {
        throw new AdminLibrariesServiceError(
            'creation-options-unavailable',
            'Library options are temporarily unavailable.'
        );
    }
    return response.data;
}

export async function loadAdminLibraryTasks(api: Api, signal?: AbortSignal): Promise<TaskInfo[]> {
    const response = await getScheduledTasksApi(api).getTasks({ isHidden: false }, { signal });
    if (!Array.isArray(response.data)) {
        throw new AdminLibrariesServiceError('tasks-unavailable', 'Library scan status is unavailable.');
    }
    return response.data;
}

export async function validateAdminLibraryPath(
    api: Api,
    path: string,
    signal?: AbortSignal
) {
    const value = requireLibraryPath(path);
    await getEnvironmentApi(api).validatePath({
        validatePathDto: {
            IsFile: false,
            Path: value,
            ValidateWritable: false
        }
    }, { signal });
    return value;
}

export type AdminLibraryDirectory = Readonly<{
    entries: readonly FileSystemEntryInfo[];
    parentPath: string;
    path: string;
}>;

function uniqueDirectoryEntries(value: unknown): FileSystemEntryInfo[] {
    if (!Array.isArray(value)) return [];
    const paths = new Set<string>();
    return value.filter((entry: FileSystemEntryInfo) => {
        const path = entry?.Path;
        if (!path || paths.has(path)) return false;
        paths.add(path);
        return true;
    });
}

export async function loadAdminLibraryDirectory(
    api: Api,
    requestedPath?: string,
    signal?: AbortSignal
): Promise<AdminLibraryDirectory> {
    const environment = getEnvironmentApi(api);
    const path = requestedPath === undefined ?
        (await environment.getDefaultDirectoryBrowser({ signal })).data.Path || '' :
        requestedPath;
    try {
        if (!path) {
            const response = await environment.getDrives({ signal });
            return {
                entries: uniqueDirectoryEntries(response.data),
                parentPath: '',
                path: ''
            };
        }
        const [ contents, parent ] = await Promise.all([
            environment.getDirectoryContents({
                includeDirectories: true,
                includeFiles: false,
                path
            }, { signal }),
            environment.getParentPath({ path }, { signal })
        ]);
        return {
            entries: uniqueDirectoryEntries(contents.data),
            parentPath: typeof parent.data === 'string' ? parent.data : '',
            path
        };
    } catch (error) {
        if ((error as { name?: string })?.name === 'AbortError') throw error;
        throw new AdminLibrariesServiceError(
            'directory-unavailable',
            'This server folder could not be opened.'
        );
    }
}

export async function createAdminLibrary(
    api: Api,
    input: CreateAdminLibraryInput,
    availableOptions: LibraryOptionsResultDto,
    signal?: AbortSignal
): Promise<VirtualFolderInfo | null> {
    if (!availableOptions || typeof availableOptions !== 'object') {
        throw new AdminLibrariesServiceError(
            'creation-options-unavailable',
            'Library options could not be verified. No library was created.'
        );
    }
    const name = requireLibraryName(input.name);
    const locations = uniquePaths(input.locations);
    await Promise.all(locations.map(path => validateAdminLibraryPath(api, path, signal)));
    await getLibraryStructureApi(api).addVirtualFolder({
        addVirtualFolderDto: {
            LibraryOptions: buildDefaultAdminLibraryOptions(availableOptions, locations)
        },
        collectionType: normalizeCreateCollectionType(input.collectionType),
        name,
        paths: [ ...locations ],
        refreshLibrary: false
    }, { signal });

    // Creation returns void. Refetch once to discover an unambiguous server-assigned
    // ItemId. A failed discovery must not turn an accepted create into a retry prompt.
    try {
        const libraries = await loadAdminLibraries(api, signal);
        const matches = libraries.filter(library => library.Name === name);
        return matches.length === 1 ? matches[0] : null;
    } catch {
        return null;
    }
}

export async function renameAdminLibrary(
    api: Api,
    libraryId: string,
    newName: string,
    confirmedName: string,
    signal?: AbortSignal
): Promise<VirtualFolderInfo> {
    const library = await loadAdminLibrary(api, libraryId, signal);
    const authoritativeName = requireLibraryName(library.Name!);
    if (authoritativeName !== requireLibraryName(confirmedName)) {
        throw new AdminLibrariesServiceError(
            'conflict',
            'This library changed on the server while you were editing. Reload before saving.'
        );
    }
    const desiredName = requireLibraryName(newName);
    await getLibraryStructureApi(api).renameVirtualFolder({
        name: library.Name!,
        newName: desiredName,
        refreshLibrary: false
    }, { signal });
    return { ...library, Name: desiredName };
}

export async function addAdminLibraryPath(
    api: Api,
    libraryId: string,
    path: string,
    signal?: AbortSignal
) {
    const [ library, validatedPath ] = await Promise.all([
        loadAdminLibrary(api, libraryId, signal),
        validateAdminLibraryPath(api, path, signal)
    ]);
    const existingPaths = [
        ...(library.Locations || []),
        ...(library.LibraryOptions?.PathInfos || []).map(info => info.Path)
    ];
    if (existingPaths.includes(validatedPath)) {
        throw new AdminLibrariesServiceError('invalid-library-path', 'That folder is already in this library.');
    }
    await getLibraryStructureApi(api).addMediaPath({
        mediaPathDto: {
            Name: library.Name!,
            Path: validatedPath,
            PathInfo: { Path: validatedPath }
        },
        refreshLibrary: false
    }, { signal });
}

export async function removeAdminLibraryPath(
    api: Api,
    libraryId: string,
    path: string,
    signal?: AbortSignal
) {
    const value = requireLibraryPath(path);
    const library = await loadAdminLibrary(api, libraryId, signal);
    const existingPaths = [
        ...(library.Locations || []),
        ...(library.LibraryOptions?.PathInfos || []).map(info => info.Path)
    ];
    if (!existingPaths.includes(value)) {
        throw new AdminLibrariesServiceError(
            'invalid-library-path',
            'That folder changed while this page was open. Refresh before removing it.'
        );
    }
    await getLibraryStructureApi(api).removeMediaPath({
        name: library.Name!,
        path: value,
        refreshLibrary: false
    }, { signal });
}

export async function updateAdminLibraryOptions(
    api: Api,
    libraryId: string,
    patch: AdminLibraryOptionsPatch,
    confirmedOptions: AdminLibraryOptionsForm,
    signal?: AbortSignal
): Promise<VirtualFolderInfo> {
    const library = await loadAdminLibrary(api, libraryId, signal);
    if (!library.LibraryOptions) {
        throw new AdminLibrariesServiceError(
            'library-options-unavailable',
            'Library options could not be verified. No changes were made.'
        );
    }
    const authoritativeOptions = normalizeAdminLibraryOptions(library.LibraryOptions);
    if (!areAdminLibraryOptionsEqual(authoritativeOptions, confirmedOptions)) {
        throw new AdminLibrariesServiceError(
            'conflict',
            'This library changed on the server while you were editing. Reload before saving.'
        );
    }
    const options = patchAdminLibraryOptions(library.LibraryOptions, patch);
    await getLibraryStructureApi(api).updateLibraryOptions({
        updateLibraryOptionsDto: {
            Id: library.ItemId!,
            LibraryOptions: options
        }
    }, { signal });
    return { ...library, LibraryOptions: options };
}

export async function updateAdminLibraryProviders(
    api: Api,
    libraryId: string,
    providers: AdminLibraryProviderSummary,
    confirmedProviders: AdminLibraryProviderSummary,
    confirmedOptions: LibraryOptions,
    signal?: AbortSignal
): Promise<VirtualFolderInfo> {
    const library = await loadAdminLibrary(api, libraryId, signal);
    if (!library.LibraryOptions) {
        throw new AdminLibrariesServiceError(
            'library-options-unavailable',
            'Library options could not be verified. No changes were made.'
        );
    }
    if (!areAdminLibraryProviderConfigurationsEqual(library.LibraryOptions, confirmedOptions)) {
        throw new AdminLibrariesServiceError(
            'conflict',
            'This library changed on the server while you were editing. Reload before saving.'
        );
    }
    const options = patchAdminLibraryProviders(
        library.LibraryOptions,
        providers,
        confirmedProviders
    );
    await getLibraryStructureApi(api).updateLibraryOptions({
        updateLibraryOptionsDto: {
            Id: library.ItemId!,
            LibraryOptions: options
        }
    }, { signal });
    return { ...library, LibraryOptions: options };
}

export async function removeAdminLibrary(
    api: Api,
    libraryId: string,
    expectedName?: string,
    signal?: AbortSignal
) {
    const library = await loadAdminLibrary(api, libraryId, signal);
    if (library.CollectionType === 'boxsets') {
        throw new AdminLibrariesServiceError(
            'invalid-library',
            'This server-managed Collections library cannot be removed here.'
        );
    }
    if (expectedName !== undefined && library.Name !== expectedName) {
        throw new AdminLibrariesServiceError(
            'invalid-library',
            'This library was renamed while the confirmation was open. Review it before removing.'
        );
    }
    await getLibraryStructureApi(api).removeVirtualFolder({
        name: library.Name!,
        refreshLibrary: false
    }, { signal });
}

const globalScanFlights = new WeakMap<Api, Promise<TaskInfo>>();

export function startAdminLibrariesScan(api: Api, signal?: AbortSignal) {
    const active = globalScanFlights.get(api);
    if (active) return active;
    const promise = loadAdminLibraryTasks(api, signal).then(async tasks => {
        const task = tasks.find(value => value.Key === 'RefreshLibrary');
        if (!task?.Id) {
            throw new AdminLibrariesServiceError('scan-unavailable', 'Library scanning is unavailable.');
        }
        if (task.State === 'Running' || task.State === 'Cancelling') return task;
        await getScheduledTasksApi(api).startTask({ taskId: task.Id }, { signal });
        return { ...task, State: 'Running' as const };
    }).finally(() => globalScanFlights.delete(api));
    globalScanFlights.set(api, promise);
    return promise;
}

const libraryScanFlights = new WeakMap<ApiClient, Map<string, Promise<void>>>();

/** Uses the exact recursive scan contract already used by Jellyfin's library editor. */
export function startAdminLibraryScan(apiClient: ApiClient, libraryId: string) {
    const id = requireLibraryId(libraryId);
    let flights = libraryScanFlights.get(apiClient);
    if (!flights) {
        flights = new Map<string, Promise<void>>();
        libraryScanFlights.set(apiClient, flights);
    }
    const active = flights.get(id);
    if (active) return active;
    const promise = apiClient.refreshItem(id, {
        ImageRefreshMode: 'Default',
        MetadataRefreshMode: 'Default',
        Recursive: true,
        RegenerateTrickplay: false,
        ReplaceAllImages: false,
        ReplaceAllMetadata: false
    }).finally(() => flights?.delete(id));
    flights.set(id, promise);
    return promise;
}
