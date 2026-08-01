// NOTE: This is used for jsdoc return type
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Api } from '@jellyfin/sdk';
import { Credentials, ApiClient } from 'jellyfin-apiclient';

import { appHost } from 'components/apphost';
import appSettings from 'scripts/settings/appSettings';
import { setUserInfo } from 'scripts/settings/userSettings';
import Dashboard from 'utils/dashboard';
import Events from 'utils/events.ts';
import { toApi } from 'utils/jellyfin-apiclient/compat';

import ConnectionManager from './connectionManager';

const normalizeImageOptions = options => {
    if (!options.quality && (options.maxWidth || options.width || options.maxHeight || options.height || options.fillWidth || options.fillHeight)) {
        options.quality = 90;
    }
};

const normalizeServerAddress = value => String(value || '')
    .trim()
    .replace(/\/+$/, '')
    .toLowerCase();

const WEB_SOCKET_RECONNECT_DELAYS_MS = Object.freeze([
    1000,
    2000,
    5000,
    10000,
    30000
]);

const getMaxBandwidth = () => {
    if (navigator.connection) {
        let max = navigator.connection.downlinkMax;
        if (max && max > 0 && max < Number.POSITIVE_INFINITY) {
            max /= 8;
            max *= 1000000;
            max *= 0.7;
            return parseInt(max, 10);
        }
    }

    return null;
};

export class ServerConnections extends ConnectionManager {
    constructor() {
        super(...arguments);
        this.localApiClient = null;
        this.firstConnection = null;
        this.webSocketReconnectStates = new WeakMap();

        Events.on(this, 'localusersignedout', (_e, logoutInfo) => {
            this.retireWebSocketReconnect(this.localApiClient);
            setUserInfo(null, null);
            // Ensure the updated credentials are persisted to storage
            credentialProvider.credentials(credentialProvider.credentials());

            if (window.NativeShell && typeof window.NativeShell.onLocalUserSignedOut === 'function') {
                window.NativeShell.onLocalUserSignedOut(logoutInfo);
            }
        });

        Events.on(this, 'apiclientcreated', (_e, apiClient) => {
            apiClient.getMaxBandwidth = getMaxBandwidth;
            apiClient.normalizeImageOptions = normalizeImageOptions;
        });
    }

    bindWebSocketReconnect(apiClient) {
        let state = this.webSocketReconnectStates.get(apiClient);

        if (state) {
            return state;
        }

        state = {
            attempt: 0,
            timer: null,
            onClose: () => this.scheduleWebSocketReconnect(apiClient),
            onOpen: () => this.resetWebSocketReconnect(apiClient)
        };

        this.webSocketReconnectStates.set(apiClient, state);
        Events.on(apiClient, 'websocketclose', state.onClose);
        Events.on(apiClient, 'websocketopen', state.onOpen);

        return state;
    }

    scheduleWebSocketReconnect(apiClient) {
        if (
            !apiClient
            || apiClient !== this.localApiClient
            || !apiClient.accessToken?.()
            || apiClient.isWebSocketOpenOrConnecting?.()
        ) {
            return;
        }

        const state = this.bindWebSocketReconnect(apiClient);

        if (state.timer) {
            return;
        }

        const delay = WEB_SOCKET_RECONNECT_DELAYS_MS[
            Math.min(state.attempt, WEB_SOCKET_RECONNECT_DELAYS_MS.length - 1)
        ];
        state.attempt += 1;
        state.timer = setTimeout(() => {
            state.timer = null;

            if (
                apiClient !== this.localApiClient
                || !apiClient.accessToken?.()
                || apiClient.isWebSocketOpenOrConnecting?.()
            ) {
                return;
            }

            try {
                apiClient.ensureWebSocket();
            } catch {
                this.scheduleWebSocketReconnect(apiClient);
            }
        }, delay);
    }

    resetWebSocketReconnect(apiClient) {
        const state = this.webSocketReconnectStates.get(apiClient);

        if (!state) {
            return;
        }

        if (state.timer) {
            clearTimeout(state.timer);
            state.timer = null;
        }

        state.attempt = 0;
    }

    retireWebSocketReconnect(apiClient) {
        const state = apiClient && this.webSocketReconnectStates.get(apiClient);

        if (!state) {
            return;
        }

        if (state.timer) {
            clearTimeout(state.timer);
        }

        Events.off(apiClient, 'websocketclose', state.onClose);
        Events.off(apiClient, 'websocketopen', state.onOpen);
        this.webSocketReconnectStates.delete(apiClient);
    }

    getWebSocketReconnectSnapshot() {
        const state = this.localApiClient && this.webSocketReconnectStates.get(this.localApiClient);

        return {
            attempt: state?.attempt || 0,
            timerCount: state?.timer ? 1 : 0
        };
    }

    initApiClient(server) {
        const normalizedServer = normalizeServerAddress(server);
        const existingApiClient = this.getApiClients().find(apiClient => (
            normalizeServerAddress(apiClient.serverAddress()) === normalizedServer
        ));

        if (existingApiClient) {
            existingApiClient.enableAutomaticNetworking = false;
            existingApiClient.manualAddressOnly = true;
            this.setLocalApiClient(existingApiClient);
            console.debug('reused ApiClient singleton');
            return existingApiClient;
        }

        console.debug('creating ApiClient singleton');

        const apiClient = new ApiClient(
            server,
            appHost.appName(),
            appHost.appVersion(),
            appHost.deviceName(),
            appHost.deviceId()
        );

        apiClient.enableAutomaticNetworking = false;
        apiClient.manualAddressOnly = true;

        this.addApiClient(apiClient);

        this.setLocalApiClient(apiClient);

        console.debug('loaded ApiClient singleton');
        return apiClient;
    }

    connect(options) {
        return super.connect({
            enableAutoLogin: appSettings.enableAutoLogin(),
            ...options
        });
    }

    logout() {
        this.retireWebSocketReconnect(this.localApiClient);
        return super.logout();
    }

    setLocalApiClient(apiClient) {
        if (apiClient) {
            const previousApiClient = this.localApiClient;

            if (previousApiClient && previousApiClient !== apiClient) {
                this.retireWebSocketReconnect(previousApiClient);
                previousApiClient.closeWebSocket?.();
            }

            this.localApiClient = apiClient;
            this.bindWebSocketReconnect(apiClient);
            this.scheduleWebSocketReconnect(apiClient);
            window.ApiClient = apiClient;
        }
    }

    getLocalApiClient() {
        return this.localApiClient;
    }

    /**
     * Gets the ApiClient that is currently connected.
     * @returns {ApiClient|undefined} apiClient
     */
    currentApiClient() {
        let apiClient = this.getLocalApiClient();

        if (!apiClient) {
            const server = this.getLastUsedServer();

            if (server) {
                apiClient = this.getApiClient(server.Id);
            }
        }

        return apiClient;
    }

    /**
     * Gets the Api that is currently connected.
     * @returns {Api|undefined} The current Api instance.
     */
    getCurrentApi() {
        const apiClient = this.currentApiClient();
        if (!apiClient) return;

        return toApi(apiClient);
    }

    /**
     * Gets the ApiClient that is currently connected or throws if not defined.
     * @async
     * @returns {Promise<ApiClient>} The current ApiClient instance.
     */
    async getCurrentApiClientAsync() {
        const apiClient = this.currentApiClient();
        if (!apiClient) throw new Error('[ServerConnection] No current ApiClient instance');

        return apiClient;
    }

    onLocalUserSignedIn(user) {
        const apiClient = this.getApiClient(user.ServerId);
        this.setLocalApiClient(apiClient);
        return setUserInfo(user.Id, apiClient).then(() => {
            if (window.NativeShell && typeof window.NativeShell.onLocalUserSignedIn === 'function') {
                return window.NativeShell.onLocalUserSignedIn(user, apiClient.accessToken());
            }
            return Promise.resolve();
        });
    }
}

const credentialProvider = new Credentials();

const capabilities = Dashboard.capabilities(appHost);

export default new ServerConnections(
    credentialProvider,
    () => appHost.appName(),
    () => appHost.appVersion(),
    () => appHost.deviceName(),
    () => appHost.deviceId(),
    capabilities);
