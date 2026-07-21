import type { FolderStorageDto } from '@jellyfin/sdk/lib/generated-client';

export type DashboardStorageFolder = Readonly<{
    folder?: FolderStorageDto;
    label: string;
}>;

export type DashboardStorageUsageGroup = Readonly<{
    entries: DashboardStorageFolder[];
    folder: FolderStorageDto;
}>;

function getFolderUsageKey(folder?: FolderStorageDto) {
    if (
        !folder
        || typeof folder.UsedSpace !== 'number'
        || typeof folder.FreeSpace !== 'number'
        || folder.UsedSpace < 0
        || folder.FreeSpace < 0
    ) {
        return '';
    }

    return [folder.UsedSpace, folder.FreeSpace].join(':');
}

export function groupDashboardStorageFolders(entries: DashboardStorageFolder[]): DashboardStorageUsageGroup[] {
    const groups = new Map<string, { entries: DashboardStorageFolder[]; folder: FolderStorageDto }>();

    entries.forEach(entry => {
        const key = getFolderUsageKey(entry.folder);

        if (!key || !entry.folder) {
            groups.set(`${entry.label}:${groups.size}`, {
                entries: [entry],
                folder: entry.folder || {}
            });
            return;
        }

        const existing = groups.get(key);

        if (existing) {
            existing.entries.push(entry);
        } else {
            groups.set(key, {
                entries: [entry],
                folder: entry.folder
            });
        }
    });

    return Array.from(groups.values());
}
