import { appHost } from 'components/apphost';
import viewContainer from 'components/viewContainer';
import { AppFeature } from 'constants/appFeature';
import { ServerConnections } from 'lib/jellyfin-apiclient';

import toast from '../components/toast/toast';
import loading from '../components/loading/loading';
import { appRouter } from '../components/router/appRouter';
import baseAlert from '../components/alert';
import baseConfirm from '../components/confirm/confirm';
import globalize from '../lib/globalize';
import * as webSettings from '../scripts/settings/webSettings';
import datetime from '../scripts/datetime';
import { setBackdropTransparency } from '../components/backdrop/backdrop';
import DirectoryBrowser from '../components/directorybrowser/directorybrowser';
import dialogHelper from '../components/dialogHelper/dialogHelper';
import itemIdentifier from '../components/itemidentifier/itemidentifier';
import { getLocationSearch } from './url.ts';
import { queryClient } from './query/queryClient';
import { PTV_CONFIG } from 'ptv/core/config';
import { isPtvWebpackDevServerOrigin } from 'ptv/core/urlOrigins';

const SERVER_DISCOVERY_TIMEOUT_MS = 2200;

export function getCurrentUser() {
    return window.ApiClient.getCurrentUser(false);
}

// TODO: investigate url prefix support for serverAddress function
export async function serverAddress() {
    const apiClient = window.ApiClient;

    if (apiClient) {
        const currentServerAddress = apiClient.serverAddress();

        if (!isDevStaticServerUrl(currentServerAddress)) {
            return Promise.resolve(currentServerAddress);
        }
    }

    // Use servers specified in config.json
    const configuredUrls = await webSettings.getServers();
    const urls = [];

    function addServerUrl(url) {
        const normalizedUrl = trimTrailingSlash(String(url || '').trim());

        if (normalizedUrl && !urls.includes(normalizedUrl)) {
            urls.push(normalizedUrl);
        }
    }

    (PTV_CONFIG.runtime.jellyfinServerUrlCandidates || [PTV_CONFIG.serverUrl]).forEach(addServerUrl);
    configuredUrls.forEach(addServerUrl);

    if (urls.length === 0) {
        // Otherwise use computed base URL
        let url;
        const index = window.location.href.toLowerCase().lastIndexOf('/web');
        if (index != -1) {
            url = window.location.href.substring(0, index);
        } else {
            // fallback to location without path
            url = window.location.origin;
        }

        // Don't use bundled app URL (file:) as server URL
        if (url.startsWith('file:')) {
            return Promise.resolve();
        }

        urls.push(url);
    }

    console.debug('URL candidates:', urls);

    const promises = urls.map(url => fetchServerInfoWithTimeout(url));

    return Promise.all(promises).then(responses => {
        return responses.filter(obj => obj?.config);
    }).then(configs => {
        const selection = configs.find(obj => !obj.config.StartupWizardCompleted) || configs[0];
        return selection?.url || getFallbackServerUrl(urls);
    }).catch(error => {
        console.error(error);

        return getFallbackServerUrl(urls);
    });
}

function fetchServerInfo(url) {
    return fetch(`${url}/System/Info/Public`, { cache: 'no-cache' })
        .then(async resp => {
            if (!resp.ok) {
                return;
            }

            let config;
            try {
                config = await resp.json();
            } catch {
                return;
            }

            return {
                url,
                config
            };
        }).catch(error => {
            console.debug('[PTV] Server discovery candidate failed:', url, error);
        });
}

function fetchServerInfoWithTimeout(url) {
    return Promise.race([
        fetchServerInfo(url),
        new Promise(resolve => {
            window.setTimeout(() => {
                console.debug('[PTV] Server discovery candidate timed out:', url);
                resolve(undefined);
            }, SERVER_DISCOVERY_TIMEOUT_MS);
        })
    ]);
}

function getFallbackServerUrl(urls) {
    return urls.find(url => !isDevStaticServerUrl(url)) || urls[0];
}

function isDevStaticServerUrl(url) {
    if (!url) return false;

    try {
        const parsedUrl = document.createElement('a');

        parsedUrl.href = url;

        return isPtvWebpackDevServerOrigin(parsedUrl.hostname, parsedUrl.port);
    } catch {
        return false;
    }
}

function trimTrailingSlash(value) {
    let nextValue = value;

    while (nextValue.endsWith('/')) {
        nextValue = nextValue.slice(0, -1);
    }

    return nextValue;
}

export function getCurrentUserId() {
    const apiClient = window.ApiClient;

    if (apiClient) {
        return apiClient.getCurrentUserId();
    }

    return null;
}

export function onServerChanged(_userId, _accessToken, apiClient) {
    ServerConnections.setLocalApiClient(apiClient);
}

export function logout() {
    ServerConnections.logout().then(function () {
        // Clear the query cache
        queryClient.clear();
        // Reset cached views
        viewContainer.reset();
        appHost.supports(AppFeature.MultiServer) ?
            navigate('selectserver') : navigate('login');
    });
}

export function getPluginUrl(name) {
    return 'configurationpage?name=' + encodeURIComponent(name);
}

export function getConfigurationResourceUrl(name) {
    return ApiClient.getUrl('web/ConfigurationPage', {
        name: name
    });
}

/**
 * Navigate to a url.
 * @param {string} url - The url to navigate to.
 * @param {boolean} [preserveQueryString] - A flag to indicate the current query string should be appended to the new url.
 * @returns {Promise<any>}
 */
export function navigate(url, preserveQueryString) {
    if (!url) {
        throw new Error('url cannot be null or empty');
    }

    const queryString = getLocationSearch();

    if (preserveQueryString && queryString) {
        url += queryString;
    }

    return appRouter.show(url);
}

export function processPluginConfigurationUpdateResult() {
    loading.hide();
    toast(globalize.translate('SettingsSaved'));
}

export function processServerConfigurationUpdateResult() {
    loading.hide();
    toast(globalize.translate('SettingsSaved'));
}

export function processErrorResponse(response) {
    loading.hide();

    let status = '' + response.status;

    if (response.statusText) {
        status = response.statusText;
    }

    baseAlert({
        title: status,
        text: response.headers ? response.headers.get('X-Application-Error-Code') : null
    });
}

export function alert(options) {
    if (typeof options == 'string') {
        toast({
            text: options
        });
    } else {
        baseAlert({
            title: options.title || globalize.translate('HeaderAlert'),
            text: options.message
        }).then(options.callback || function () { /* no-op */ });
    }
}

export function capabilities(host) {
    return Object.assign({
        PlayableMediaTypes: ['Audio', 'Video'],
        SupportedCommands: ['MoveUp', 'MoveDown', 'MoveLeft', 'MoveRight', 'PageUp', 'PageDown', 'PreviousLetter', 'NextLetter', 'ToggleOsd', 'ToggleContextMenu', 'Select', 'Back', 'SendKey', 'SendString', 'GoHome', 'GoToSettings', 'VolumeUp', 'VolumeDown', 'Mute', 'Unmute', 'ToggleMute', 'SetVolume', 'SetAudioStreamIndex', 'SetSubtitleStreamIndex', 'DisplayContent', 'GoToSearch', 'DisplayMessage', 'SetRepeatMode', 'SetShuffleQueue', 'ChannelUp', 'ChannelDown', 'PlayMediaSource', 'PlayTrailers'],
        SupportsPersistentIdentifier: window.appMode === 'cordova' || window.appMode === 'android',
        SupportsMediaControl: true
    }, host.getPushTokenInfo());
}

export function selectServer() {
    if (window.NativeShell && typeof window.NativeShell.selectServer === 'function') {
        window.NativeShell.selectServer();
    } else {
        navigate('selectserver');
    }
}

export function hideLoadingMsg() {
    loading.hide();
}

export function showLoadingMsg() {
    loading.show();
}

export function confirm(message, title, callback) {
    baseConfirm(message, title).then(function() {
        callback(true);
    }).catch(function() {
        callback(false);
    });
}

export const pageClassOn = function(eventName, className, fn) {
    document.addEventListener(eventName, function (event) {
        const target = event.target;

        if (target.classList.contains(className)) {
            fn.call(target, event);
        }
    });
};

export const pageIdOn = function(eventName, id, fn) {
    document.addEventListener(eventName, function (event) {
        const target = event.target;

        if (target.id === id) {
            fn.call(target, event);
        }
    });
};

const Dashboard = {
    alert,
    capabilities,
    confirm,
    getPluginUrl,
    getConfigurationResourceUrl,
    getCurrentUser,
    getCurrentUserId,
    hideLoadingMsg,
    logout,
    navigate,
    onServerChanged,
    processErrorResponse,
    processPluginConfigurationUpdateResult,
    processServerConfigurationUpdateResult,
    selectServer,
    serverAddress,
    showLoadingMsg,
    datetime,
    DirectoryBrowser,
    dialogHelper,
    itemIdentifier,
    setBackdropTransparency
};

// This is used in plugins and templates, so keep it defined for now.
// TODO: Remove once plugins don't need it
window.Dashboard = Dashboard;

export default Dashboard;
