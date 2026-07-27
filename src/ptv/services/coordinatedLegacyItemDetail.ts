import {
    coordinatePtvJsonRequest,
    getPtvRequestCoordinatorKey
} from './requestCoordinator';

type LegacyItemDetailApiClient<TItem> = {
    getCurrentUserId: () => string;
    getItem: (userId: string, itemId: string) => Promise<TItem>;
    serverId?: () => string;
};

export function getCoordinatedLegacyItemDetail<TItem>(
    apiClient: LegacyItemDetailApiClient<TItem>,
    itemId: string
): Promise<TItem> {
    const userId = apiClient.getCurrentUserId();
    const requestIdentity = [
        'jellyfin:legacy-item-detail',
        apiClient.serverId?.() || '',
        userId,
        itemId
    ].join(':');
    const requestKey = getPtvRequestCoordinatorKey('GET', requestIdentity, true);

    return coordinatePtvJsonRequest(
        requestKey,
        () => apiClient.getItem(userId, itemId),
        {
            diagnosticKey: 'GET auth jellyfin:legacy-item-detail',
            endpoint: 'Items/{item}',
            includeAuthorization: true,
            method: 'GET',
            source: 'legacy-item-details'
        }
    );
}
