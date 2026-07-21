import List from '@mui/material/List';
import React from 'react';
import StorageListItem from 'apps/dashboard/features/storage/components/StorageListItem';
import { groupDashboardStorageFolders } from 'apps/dashboard/features/storage/utils/storage';
import globalize from 'lib/globalize';
import Widget from './Widget';
import { useSystemStorage } from 'apps/dashboard/features/storage/api/useSystemStorage';

const ServerPathWidget = () => {
    const { data: systemStorage } = useSystemStorage();
    const folders = [
        { folder: systemStorage?.CacheFolder, label: globalize.translate('LabelCache') },
        { folder: systemStorage?.ImageCacheFolder, label: globalize.translate('LabelImageCache') },
        { folder: systemStorage?.ProgramDataFolder, label: globalize.translate('LabelProgramData') },
        { folder: systemStorage?.LogFolder, label: globalize.translate('LabelLogs') },
        { folder: systemStorage?.InternalMetadataFolder, label: globalize.translate('LabelMetadata') },
        { folder: systemStorage?.TranscodingTempFolder, label: globalize.translate('LabelTranscodes') },
        { folder: systemStorage?.WebFolder, label: globalize.translate('LabelWeb') }
    ];
    const usageGroups = groupDashboardStorageFolders(folders);
    const hasSharedFilesystemUsage = usageGroups.length === 1 && usageGroups[0].entries.length > 1;

    return (
        <Widget
            title={globalize.translate('HeaderPaths')}
            href='/dashboard/settings'
        >
            <List sx={{ bgcolor: 'background.paper' }}>
                {hasSharedFilesystemUsage ? (
                    <StorageListItem
                        label='Filesystem usage'
                        folder={usageGroups[0].folder}
                        pathLabel='Shared filesystem usage'
                    />
                ) : null}
                {folders.map(entry => (
                    <StorageListItem
                        key={entry.label}
                        label={entry.label}
                        folder={entry.folder}
                        showUsage={!hasSharedFilesystemUsage}
                    />
                ))}
            </List>
        </Widget>
    );
};

export default ServerPathWidget;
