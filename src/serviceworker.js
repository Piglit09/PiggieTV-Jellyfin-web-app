/* eslint-env serviceworker */

import {
    getPtvCompiledUpdateGeneration,
    PTV_UPDATE_GENERATION_REQUEST,
    PTV_UPDATE_GENERATION_RESPONSE
} from './ptv/services/updateGeneration';

function getApiClient(serverId) {
    return Promise.resolve(window.connectionManager.getApiClient(serverId));
}

function executeAction(action, data, serverId) {
    return getApiClient(serverId).then(function (apiClient) {
        switch (action) {
            case 'cancel-install':
                return apiClient.cancelPackageInstallation(data.id);
            case 'restart':
                return apiClient.restartServer();
            default:
                clients.openWindow('/');
                return Promise.resolve();
        }
    });
}

/* eslint-disable-next-line no-restricted-globals -- self is valid in a serviceworker environment */
self.addEventListener('notificationclick', function (event) {
    const notification = event.notification;
    notification.close();

    const data = notification.data;
    const serverId = data.serverId;
    const action = event.action;

    if (!action) {
        clients.openWindow('/');
        event.waitUntil(Promise.resolve());
        return;
    }

    event.waitUntil(executeAction(action, data, serverId));
}, false);

/* eslint-disable-next-line no-restricted-globals -- self is valid in a serviceworker environment */
self.addEventListener('activate', () => self.clients.claim());

/* eslint-disable-next-line no-restricted-globals -- self is valid in a serviceworker environment */
self.addEventListener('message', event => {
    /* eslint-disable-next-line no-restricted-globals -- self is valid in a serviceworker environment */
    if (event.origin !== self.location.origin) return;
    if (event.data?.type === PTV_UPDATE_GENERATION_REQUEST) {
        event.ports?.[0]?.postMessage({
            generation: getPtvCompiledUpdateGeneration(),
            type: PTV_UPDATE_GENERATION_RESPONSE
        });
        return;
    }
    if (event.data?.type === 'SKIP_WAITING') {
        /* eslint-disable-next-line no-restricted-globals -- self is valid in a serviceworker environment */
        event.waitUntil(self.skipWaiting());
    }
});
