import {
    getPtvCurrentUserId,
    getPtvApiClient,
    PtvApiError,
    requestPtvJson
} from './client';
import type { PtvItemsResult, PtvLibrary } from './types';

export function getPtvMediaFolders(options: {
    includeHidden?: boolean;
    scope?: 'background' | 'route';
    serverId?: string | null;
    signal?: AbortSignal;
} = {}): Promise<PtvItemsResult<PtvLibrary>> {
    return requestPtvJson<PtvItemsResult<PtvLibrary>>('Library/MediaFolders', {
        params: {
            IsHidden: options.includeHidden ? undefined : false
        },
        scope: options.scope,
        serverId: options.serverId,
        signal: options.signal
    });
}

export function getPtvUserViews(options: {
    scope?: 'background' | 'route';
    serverId?: string | null;
    signal?: AbortSignal;
    userId?: string | null;
} = {}): Promise<PtvItemsResult<PtvLibrary>> {
    const userId = options.userId || getPtvCurrentUserId(options.serverId);
    const apiClient = getPtvApiClient(options.serverId);

    if (options.serverId && !apiClient) {
        return Promise.reject(new PtvApiError(
            'Jellyfin API client does not match the requested server.',
            'Users/current/Views',
            null
        ));
    }

    if (!userId) {
        return Promise.resolve({ Items: [], TotalRecordCount: 0 });
    }

    return requestPtvJson<PtvItemsResult<PtvLibrary>>(`Users/${userId}/Views`, {
        scope: options.scope,
        serverId: options.serverId,
        signal: options.signal
    });
}

export function getPtvLibraryById(libraryId: string, options: {
    scope?: 'background' | 'route';
    serverId?: string | null;
    signal?: AbortSignal;
    userId?: string | null;
} = {}): Promise<PtvLibrary | null> {
    if (!libraryId) return Promise.resolve(null);

    return getPtvUserViews(options).then(result => (
        result.Items || []
    ).find(library => library.Id === libraryId) || null);
}
