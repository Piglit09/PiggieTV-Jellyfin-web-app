export * from './types';
export * from './client';
export * from './auth';
export * from './libraries';
export * from './items';
export * from './images';
export * from './search';
export * from './playback';
export * from './admin';

import {
    cleanPtvQuery,
    getCurrentPtvApiClient,
    getPtvApiClient,
    getPtvApiUrl,
    getPtvCurrentUserId,
    getPtvServerId,
    installPtvApiNamespace,
    requestPtvJson,
    sendPtvJson
} from './client';
import {
    getPtvCurrentUser,
    isPtvAdminUser,
    isPtvAuthenticated,
    requirePtvAdminUser,
    requirePtvCurrentUser
} from './auth';
import {
    getPtvLibraryById,
    getPtvMediaFolders,
    getPtvUserViews
} from './libraries';
import {
    getPtvFavoriteItems,
    getPtvItem,
    getPtvItems,
    getPtvNextUp,
    getPtvRecentlyAdded,
    getPtvResumeItems
} from './items';
import {
    getPtvItemImageCandidates,
    getPtvItemImageUrl,
    getPtvStableImageKey,
    getPtvUserImageUrl
} from './images';
import { searchPtvItems } from './search';
import {
    getPtvCurrentPlaybackState,
    playPtvItem,
    playPtvItems,
    queuePtvItems,
    setPtvFavorite,
    setPtvPlayed,
    shufflePtvItems
} from './playback';
import {
    getPtvAdminLibraries,
    getPtvPublicUsers,
    getPtvUsers
} from './admin';

installPtvApiNamespace({
    cleanQuery: cleanPtvQuery,
    getAdminLibraries: getPtvAdminLibraries,
    getApiClient: getPtvApiClient,
    getCurrentApiClient: getCurrentPtvApiClient,
    getCurrentPlaybackState: getPtvCurrentPlaybackState,
    getCurrentUser: getPtvCurrentUser,
    getCurrentUserId: getPtvCurrentUserId,
    getFavoriteItems: getPtvFavoriteItems,
    getItem: getPtvItem,
    getItemImageCandidates: getPtvItemImageCandidates,
    getItemImageUrl: getPtvItemImageUrl,
    getItems: getPtvItems,
    getLibraryById: getPtvLibraryById,
    getMediaFolders: getPtvMediaFolders,
    getNextUp: getPtvNextUp,
    getPublicUsers: getPtvPublicUsers,
    getRecentlyAdded: getPtvRecentlyAdded,
    getResumeItems: getPtvResumeItems,
    getServerId: getPtvServerId,
    getStableImageKey: getPtvStableImageKey,
    getUrl: getPtvApiUrl,
    getUserImageUrl: getPtvUserImageUrl,
    getUsers: getPtvUsers,
    getUserViews: getPtvUserViews,
    isAdminUser: isPtvAdminUser,
    isAuthenticated: isPtvAuthenticated,
    playItem: playPtvItem,
    playItems: playPtvItems,
    queueItems: queuePtvItems,
    requireAdminUser: requirePtvAdminUser,
    requireCurrentUser: requirePtvCurrentUser,
    requestJson: requestPtvJson,
    searchItems: searchPtvItems,
    sendJson: sendPtvJson,
    setFavorite: setPtvFavorite,
    setPlayed: setPtvPlayed,
    shuffleItems: shufflePtvItems
});
