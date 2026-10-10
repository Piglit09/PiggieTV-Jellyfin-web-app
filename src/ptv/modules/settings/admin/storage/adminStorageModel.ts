import type { FolderStorageDto } from '@jellyfin/sdk/lib/generated-client/models/folder-storage-dto';
import type { SystemStorageDto } from '@jellyfin/sdk/lib/generated-client/models/system-storage-dto';

export type AdminStorageRow = Readonly<{
    freeBytes: number | null;
    name: string;
    paths: readonly string[];
    totalBytes: number | null;
    usedBytes: number | null;
    usedPercent: number | null;
}>;

type LabeledFolder = Readonly<{ folder?: FolderStorageDto; label: string }>;

const SYSTEM_FOLDERS = [
    [ 'Cache', 'CacheFolder' ],
    [ 'Image cache', 'ImageCacheFolder' ],
    [ 'Program data', 'ProgramDataFolder' ],
    [ 'Logs', 'LogFolder' ],
    [ 'Metadata', 'InternalMetadataFolder' ],
    [ 'Transcodes', 'TranscodingTempFolder' ],
    [ 'Web', 'WebFolder' ]
] as const;

function validBytes(value?: number): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function metrics(folder: FolderStorageDto) {
    const freeBytes = validBytes(folder.FreeSpace);
    const usedBytes = validBytes(folder.UsedSpace);
    const total = freeBytes !== null && usedBytes !== null ? freeBytes + usedBytes : null;
    const totalBytes = total !== null && Number.isFinite(total) && total > 0 ? total : null;
    return {
        freeBytes,
        totalBytes,
        usedBytes,
        usedPercent: totalBytes === null || usedBytes === null ? null : usedBytes / totalBytes * 100
    };
}

function reportedFolders(storage: SystemStorageDto): LabeledFolder[] {
    const system = SYSTEM_FOLDERS.map(([ label, key ]) => ({ folder: storage[key], label }));
    const libraries = (storage.Libraries || []).flatMap(library => (
        (library.Folders || []).map(folder => ({
            folder,
            label: library.Name?.trim() || 'Library'
        }))
    ));
    return [ ...system, ...libraries ];
}

function appendFolder(groups: Map<string, AdminStorageRow>, { folder, label }: LabeledFolder) {
    if (!folder) return;
    const path = folder.Path?.trim() || '';
    const deviceId = folder.DeviceId?.trim() || '';
    if (!path && !deviceId) return;
    const reportedMetrics = metrics(folder);
    // Jellyfin's DeviceId may be a mount label rather than a physical-disk UUID.
    // Share a row only when that label and both reported capacity readings agree.
    const key = deviceId && reportedMetrics.totalBytes !== null ?
        JSON.stringify([ 'device', deviceId, reportedMetrics.usedBytes, reportedMetrics.freeBytes ]) :
        JSON.stringify([ 'path', deviceId, path, reportedMetrics.usedBytes, reportedMetrics.freeBytes ]);
    const pathLabel = path ? `${label}: ${path}` : label;
    const existing = groups.get(key);
    if (existing) {
        groups.set(key, {
            ...existing,
            paths: existing.paths.includes(pathLabel) ? existing.paths : [ ...existing.paths, pathLabel ]
        });
        return;
    }
    groups.set(key, {
        ...reportedMetrics,
        name: deviceId || path,
        paths: [ pathLabel ]
    });
}

/** Capacity belongs to a reported mount, never to each library path using it. */
export function projectAdminStorage(storage?: SystemStorageDto | null): AdminStorageRow[] {
    if (!storage) return [];

    const groups = new Map<string, AdminStorageRow>();
    reportedFolders(storage).forEach(entry => {
        appendFolder(groups, entry);
    });
    return [ ...groups.values() ];
}
