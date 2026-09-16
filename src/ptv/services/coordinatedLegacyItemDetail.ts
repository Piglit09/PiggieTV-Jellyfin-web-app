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

const LEGACY_ITEM_DETAIL_REUSE_MS = 3000;

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
    const requestKey = getPtvRequestCoordinatorKey('GET', requestIdentity, true, `${serverId}:${userId}`);
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
            reuseSuccessfulForMs: LEGACY_ITEM_DETAIL_REUSE_MS,
            signal: options.signal,
            source: 'legacy-item-details'
        }
    );
}
