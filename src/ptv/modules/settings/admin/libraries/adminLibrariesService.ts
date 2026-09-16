import type { Api } from '@jellyfin/sdk';
import type { CollectionType } from '@jellyfin/sdk/lib/generated-client/models/collection-type';
import type { CollectionTypeOptions } from '@jellyfin/sdk/lib/generated-client/models/collection-type-options';
import type { FileSystemEntryInfo } from '@jellyfin/sdk/lib/generated-client/models/file-system-entry-info';
import type { LibraryOptions } from '@jellyfin/sdk/lib/generated-client/models/library-options';
import type { LibraryOptionsResultDto } from '@jellyfin/sdk/lib/generated-client/models/library-options-result-dto';
import { MetadataRefreshMode } from '@jellyfin/sdk/lib/generated-client/models/metadata-refresh-mode';
import type { TaskInfo } from '@jellyfin/sdk/lib/generated-client/models/task-info';
import type { VirtualFolderInfo } from '@jellyfin/sdk/lib/generated-client/models/virtual-folder-info';
import { getEnvironmentApi } from '@jellyfin/sdk/lib/utils/api/environment-api';
import { getItemRefreshApi } from '@jellyfin/sdk/lib/utils/api/item-refresh-api';
import { getLibraryApi } from '@jellyfin/sdk/lib/utils/api/library-api';
import { getLibraryStructureApi } from '@jellyfin/sdk/lib/utils/api/library-structure-api';
import { getScheduledTasksApi } from '@jellyfin/sdk/lib/utils/api/scheduled-tasks-api';

import { createPtvCoreRequestCancellation } from '../../../../core/api/apiContracts';
import { isPtvTimeoutError, withPtvTimeout } from '../../../../utils/withPtvTimeout';
import {
    areAdminLibraryProviderConfigurationsEqual,
    areAdminLibraryOptionsEqual,
    buildDefaultAdminLibraryOptions,
    getAdminLibraryLocations,
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
    | 'creation-outcome-uncertain'
    | 'conflict'
    | 'directory-unavailable'
    | 'invalid-library'
    | 'invalid-library-name'
    | 'invalid-library-path'
    | 'libraries-unavailable'
    | 'library-options-unavailable'
    | 'scan-authentication'
    | 'scan-cancelled'
    | 'scan-conflict'
    | 'scan-invalid-request'
    | 'scan-network'
    | 'scan-not-found'
    | 'scan-server-error'
    | 'scan-timeout'
    | 'scan-unavailable'
    | 'tasks-unavailable';

export const ADMIN_LIBRARY_DIRECTORY_TIMEOUT_MS = 15_000;
export const ADMIN_LIBRARY_PATH_VALIDATION_TIMEOUT_MS = 15_000;
export const ADMIN_LIBRARY_SCAN_START_TIMEOUT_MS = 15_000;

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

function normalizeCreateFingerprintInputCollectionType(value: string) {
    const normalized = value.trim().toLowerCase();
    return !normalized || normalized === 'mixed' ? 'mixed' : normalized;
}

function normalizeCreateFingerprintServerCollectionType(value: unknown) {
    return value === undefined || value === null || value === '' || value === 'mixed' ?
        'mixed' : value;
}

function haveExactPaths(left: readonly string[], right: readonly string[]) {
    const leftPaths = new Set(left);
    const rightPaths = new Set(right);
    return leftPaths.size === rightPaths.size
        && Array.from(leftPaths).every(path => rightPaths.has(path));
}

function findExactCreateMatches(
    libraries: readonly VirtualFolderInfo[],
    name: string,
    collectionType: string,
    locations: readonly string[]
) {
    const normalizedType = normalizeCreateFingerprintInputCollectionType(collectionType);
    return libraries.filter(library => (
        typeof library.Name === 'string'
        && library.Name.trim() === name
        && normalizeCreateFingerprintServerCollectionType(library.CollectionType) === normalizedType
        && haveExactPaths(getAdminLibraryLocations(library), locations)
    ));
}

function resolveExactCreateMatch(matches: readonly VirtualFolderInfo[]) {
    return matches.length === 1 ? matches[0] : null;
}

function uncertainCreateOutcome() {
    return new AdminLibrariesServiceError(
        'creation-outcome-uncertain',
        'Jellyfin may have created this library, but the result could not be confirmed. Review the Libraries list before trying again.'
    );
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
    const request = createPtvCoreRequestCancellation({ signal });
    try {
        await withPtvTimeout(
            getEnvironmentApi(api).validatePath({
                validatePathDto: {
                    IsFile: false,
                    Path: value,
                    ValidateWritable: false
                }
            }, { signal: request.signal }),
            ADMIN_LIBRARY_PATH_VALIDATION_TIMEOUT_MS,
            'Server path validation timed out.',
            request.abort,
            signal
        );
        return value;
    } catch (error) {
        request.abort();
        if (signal?.aborted) throw error;
        if (isPtvTimeoutError(error)) {
            throw new AdminLibrariesServiceError(
                'invalid-library-path',
                'Server path validation took too long. Try again.'
            );
        }
        throw new AdminLibrariesServiceError(
            'invalid-library-path',
            'That server path could not be validated.'
        );
    } finally {
        request.dispose();
    }
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

async function loadAdminLibraryDirectoryRequest(
    environment: ReturnType<typeof getEnvironmentApi>,
    requestedPath: string | undefined,
    signal: AbortSignal
): Promise<AdminLibraryDirectory> {
    if (!requestedPath) {
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
            path: requestedPath
        }, { signal }),
        environment.getParentPath({ path: requestedPath }, { signal })
    ]);
    return {
        entries: uniqueDirectoryEntries(contents.data),
        parentPath: typeof parent.data === 'string' ? parent.data : '',
        path: requestedPath
    };
}

export async function loadAdminLibraryDirectory(
    api: Api,
    requestedPath?: string,
    signal?: AbortSignal
): Promise<AdminLibraryDirectory> {
    const environment = getEnvironmentApi(api);
    const request = createPtvCoreRequestCancellation({ signal });
    try {
        return await withPtvTimeout(
            loadAdminLibraryDirectoryRequest(environment, requestedPath, request.signal),
            ADMIN_LIBRARY_DIRECTORY_TIMEOUT_MS,
            'Server folder loading timed out.',
            request.abort,
            signal
        );
    } catch (error) {
        request.abort();
        if (signal?.aborted) throw error;
        if (isPtvTimeoutError(error)) {
            throw new AdminLibrariesServiceError(
                'directory-unavailable',
                'Server folders took too long to load. Try again.'
            );
        }
        throw new AdminLibrariesServiceError(
            'directory-unavailable',
            'This server folder could not be opened.'
        );
    } finally {
        request.dispose();
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
    const preflightMatches = findExactCreateMatches(
        await loadAdminLibraries(api, signal),
        name,
        input.collectionType,
        locations
    );
    if (preflightMatches.length > 0) return resolveExactCreateMatch(preflightMatches);

    try {
        await getLibraryStructureApi(api).addVirtualFolder({
            addVirtualFolderDto: {
                LibraryOptions: buildDefaultAdminLibraryOptions(availableOptions, locations)
            },
            collectionType: normalizeCreateCollectionType(input.collectionType),
            name,
            paths: [ ...locations ],
            refreshLibrary: false
        }, { signal });
    } catch {
        try {
            const matches = findExactCreateMatches(
                await loadAdminLibraries(api, signal),
                name,
                input.collectionType,
                locations
            );
            if (matches.length === 1) return matches[0];
            if (matches.length > 1) return null;
        } catch {
            throw uncertainCreateOutcome();
        }
        throw uncertainCreateOutcome();
    }

    // Creation returns void. Refetch once to discover an unambiguous server-assigned
    // ItemId. A failed discovery must not turn an accepted create into a retry prompt.
    try {
        const libraries = await loadAdminLibraries(api, signal);
        return resolveExactCreateMatch(findExactCreateMatches(
            libraries,
            name,
            input.collectionType,
            locations
        ));
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

function readHttpStatus(error: unknown) {
    if (!error || typeof error !== 'object') return null;
    const record = error as {
        response?: { status?: unknown };
        status?: unknown;
        statusCode?: unknown;
    };
    const status = record.response?.status ?? record.status ?? record.statusCode;
    return typeof status === 'number' ? status : null;
}

function toAdminLibraryScanError(error: unknown, signal?: AbortSignal) {
    if (error instanceof AdminLibrariesServiceError) return error;
    if (signal?.aborted) {
        return new AdminLibrariesServiceError(
            'scan-cancelled',
            'The library scan could not start because the request was cancelled.'
        );
    }
    if (isPtvTimeoutError(error)) {
        return new AdminLibrariesServiceError(
            'scan-timeout',
            'The library scan could not start because Jellyfin did not respond in time.'
        );
    }
    const status = readHttpStatus(error);
    if (status === 400) {
        return new AdminLibrariesServiceError(
            'scan-invalid-request',
            'The library scan could not start because Jellyfin rejected the library identity.'
        );
    }
    if (status === 401 || status === 403) {
        return new AdminLibrariesServiceError(
            'scan-authentication',
            'The library scan could not start because administrator access is required.'
        );
    }
    if (status === 404) {
        return new AdminLibrariesServiceError(
            'scan-not-found',
            'The library scan could not start because this library no longer exists.'
        );
    }
    if (status === 409) {
        return new AdminLibrariesServiceError(
            'scan-conflict',
            'The library scan could not start because Jellyfin reported a conflicting operation.'
        );
    }
    if (status !== null && status >= 500) {
        return new AdminLibrariesServiceError(
            'scan-server-error',
            'The library scan could not start because Jellyfin returned a server error.'
        );
    }
    return new AdminLibrariesServiceError(
        'scan-network',
        'The library scan could not start because Jellyfin could not be reached.'
    );
}

const libraryScanFlights = new WeakMap<Api, Map<string, Promise<void>>>();

/** Queues one exact CollectionFolder refresh through Jellyfin's generated API. */
export function startAdminLibraryScan(api: Api, libraryId: string, signal?: AbortSignal) {
    const id = requireLibraryId(libraryId);
    let flights = libraryScanFlights.get(api);
    if (!flights) {
        flights = new Map<string, Promise<void>>();
        libraryScanFlights.set(api, flights);
    }
    const active = flights.get(id);
    if (active) return active;
    const request = createPtvCoreRequestCancellation({ signal });
    const promise = withPtvTimeout(
        getItemRefreshApi(api).refreshItem({
            imageRefreshMode: MetadataRefreshMode.Default,
            itemId: id,
            metadataRefreshMode: MetadataRefreshMode.Default,
            regenerateTrickplay: false,
            replaceAllImages: false,
            replaceAllMetadata: false
        }, { signal: request.signal }).then(() => undefined),
        ADMIN_LIBRARY_SCAN_START_TIMEOUT_MS,
        'Individual library scan start timed out.',
        request.abort,
        signal
    ).catch(error => {
        request.abort();
        throw toAdminLibraryScanError(error, signal);
    }).finally(() => {
        request.dispose();
        flights?.delete(id);
    });
    flights.set(id, promise);
    return promise;
}
