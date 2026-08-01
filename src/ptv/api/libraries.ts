import {
    getPtvCurrentUserId,
    getPtvApiClient,
    requestPtvJson
} from './client';
import type { PtvItemsResult, PtvLibrary } from './types';

export function getPtvMediaFolders(options: {
    includeHidden?: boolean;
    serverId?: string | null;
} = {}): Promise<PtvItemsResult<PtvLibrary>> {
    return requestPtvJson<PtvItemsResult<PtvLibrary>>('Library/MediaFolders', {
        params: {
            IsHidden: options.includeHidden ? undefined : false
        },
        serverId: options.serverId
    });
}

export function getPtvUserViews(options: {
    serverId?: string | null;
    signal?: AbortSignal;
    userId?: string | null;
} = {}): Promise<PtvItemsResult<PtvLibrary>> {
    const userId = options.userId || getPtvCurrentUserId(options.serverId);
    const apiClient = getPtvApiClient(options.serverId);

    if (!userId) {
        return Promise.resolve({ Items: [], TotalRecordCount: 0 });
    }

    if (typeof apiClient?.getJSON === 'function') {
        return requestPtvJson<PtvItemsResult<PtvLibrary>>(`Users/${userId}/Views`, {
            serverId: options.serverId,
            signal: options.signal
        });
    }

    return Promise.resolve({ Items: [], TotalRecordCount: 0 });
}

export function getPtvLibraryById(libraryId: string, options: {
    serverId?: string | null;
    userId?: string | null;
} = {}): Promise<PtvLibrary | null> {
    if (!libraryId) return Promise.resolve(null);

    return getPtvUserViews(options).then(result => (
        result.Items || []
    ).find(library => library.Id === libraryId) || null);
}
