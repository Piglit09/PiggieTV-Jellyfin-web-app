import {
    coordinatePtvJsonRequest,
    getPtvRequestCoordinatorKey
} from './requestCoordinator';
import { requestPtvJson } from '../api/client';

type LegacyItemDetailApiClient<TItem> = {
    getCurrentUserId: () => string;
    getItem: (userId: string, itemId: string) => Promise<TItem>;
    serverId?: () => string;
};

export function getCoordinatedLegacyItemDetail<TItem>(
    apiClient: LegacyItemDetailApiClient<TItem>,
    itemId: string,
    options: {
        signal?: AbortSignal;
    } = {}
): Promise<TItem> {
    const userId = apiClient.getCurrentUserId();
    const serverId = apiClient.serverId?.() || '';
    const requestIdentity = [
        'jellyfin:legacy-item-detail',
        serverId,
        userId,
        itemId
    ].join(':');
    const requestKey = getPtvRequestCoordinatorKey('GET', requestIdentity, true);
    const loadItem = (signal: AbortSignal) => {
        if (!options.signal) return apiClient.getItem(userId, itemId);

        return requestPtvJson<TItem>(`Users/${userId}/Items/${itemId}`, {
            serverId: serverId || undefined,
            signal
        });
    };

    return coordinatePtvJsonRequest(
        requestKey,
        loadItem,
        {
            diagnosticKey: 'GET auth jellyfin:legacy-item-detail',
            endpoint: 'Items/{item}',
            includeAuthorization: true,
            method: 'GET',
            signal: options.signal,
            source: 'legacy-item-details'
        }
    );
}
