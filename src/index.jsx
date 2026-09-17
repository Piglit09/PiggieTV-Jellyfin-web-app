// Import legacy browser polyfills
import 'lib/legacy';

import React from 'react';
import { createRoot } from 'react-dom/client';

// NOTE: We need to import this first to initialize the connection
import { ServerConnections } from 'lib/jellyfin-apiclient';

import { appHost } from './components/apphost';
import autoFocuser from './components/autoFocuser';
import loading from 'components/loading/loading';
import { pluginManager } from './components/pluginManager';
import { appRouter } from './components/router/appRouter';
import { AppFeature } from 'constants/appFeature';
import globalize, {
    CULTURE_CHANGED_EVENT,
    cultureEvents
} from './lib/globalize';
import { loadCoreDictionary } from 'lib/globalize/loader';
import { initialize as initializeAutoCast } from 'scripts/autocast';
import browser from './scripts/browser';
import keyboardNavigation from './scripts/keyboardNavigation';
import { getPlugins } from './scripts/settings/webSettings';
import taskButton from './scripts/taskbutton';
import { createNotoFontLoader } from './styles/notoFontLoader';
import { pageClassOn, serverAddress } from './utils/dashboard';
import Events from './utils/events';
import { initializeServerConnections } from './scripts/serverNotifications';
import { getPtvServiceWorkerScriptUrl } from './ptv/services/updateService';
import {
    clearPtvChunkRecoveryQuery,
    installPtvChunkAssetVersioning
} from './ptv/services/chunkLoadRecovery';
import { initializePtvWebAppOnce } from './ptv/core/initialization/webAppBootstrap';

import RootApp from './RootApp';

function bindRequestFailureHandler(apiClient) {
    Events.off(apiClient, 'requestfail', appRouter.onRequestFail);
    Events.on(apiClient, 'requestfail', appRouter.onRequestFail);
}

function onApiClientCreated(_event, apiClient) {
    bindRequestFailureHandler(apiClient);
}

// Import the button webcomponent for use throughout the site
// NOTE: This is a bit of a hack, files should ensure the component is imported before use
import './elements/emby-button/emby-button';

// Import auto-running components
// NOTE: This is an anti-pattern
import './components/playback/displayMirrorManager';
import './components/themeMediaPlayer';
import './scripts/autoThemes';
import './scripts/mouseManager';
import './scripts/screensavermanager';
// Import site styles
import './styles/site.scss';
import './styles/livetv.scss';
import './styles/dashboard.scss';
import './styles/detailtable.scss';
import './styles/librarybrowser.scss';

// Base component styles that PTV intentionally overrides.
import './elements/emby-scroller/emby-scroller.scss';
// PiggieTV styles and runtime hooks. Keep this after stock styles so PTV owns the visual layer.
import './ptv/styles/ptv.scss';
import './ptv/core/app';
import './ptv/modules/header';
import './ptv/modules/settings';
import './ptv/modules/playback';

if (process.env.NODE_ENV === 'production') {
    // Webpack and DefinePlugin provide these values to the production entry module.
    // eslint-disable-next-line no-undef
    installPtvChunkAssetVersioning(__webpack_require__, `${__PTV_BUILD_ID__}-${__COMMIT_SHA__}`);
    clearPtvChunkRecoveryQuery();
}

async function init() {
    // Log current version to console to help out with issue triage and debugging
    console.info(
        `[${__PACKAGE_JSON_NAME__}]
version: ${__PACKAGE_JSON_VERSION__}
commit: ${__COMMIT_SHA__}
build: ${__JF_BUILD_VERSION__}`);

    // Register globals used in plugins
    window.Events = Events;
    window.TaskButton = taskButton;

    // Register handlers to update header classes
    pageClassOn('viewshow', 'standalonePage', function () {
        document.querySelector('.skinHeader').classList.add('noHeaderRight');
    });
    pageClassOn('viewhide', 'standalonePage', function () {
        document.querySelector('.skinHeader').classList.remove('noHeaderRight');
    });

    // Initialize app host
    await appHost.init();

    // ===== PTV SERVER BOOTSTRAP =====

    const initializeConfiguredServer = serverAddress().then(serverUrl => {
        if (serverUrl) {
            if (__WEBPACK_SERVE__) {
                console.info('[PTV] Using the configured development Jellyfin server.');
            }

            ServerConnections.initApiClient(serverUrl);
        }
    });

    // Initialize automatic (default) cast target
    initializeAutoCast();

    // Server discovery and the core dictionary are independent. Starting both now
    // avoids a network waterfall while retaining the same pre-render guarantees.
    await Promise.all([
        initializeConfiguredServer,
        loadCoreDictionary()
    ]);
    // Use the culture module as the single owner for account and live settings
    // changes. Font loading subscribes to the same normalized culture signal.
    Events.on(cultureEvents, CULTURE_CHANGED_EVENT, updateFontsForCulture);
    Events.on(ServerConnections, 'localusersignedin', globalize.updateCurrentCulture);
    Events.on(ServerConnections, 'localusersignedout', globalize.updateCurrentCulture);

    // Load the font styles
    loadFonts();

    // Load iOS specific styles
    if (browser.iOS) {
        import('./styles/ios.scss');
    }

    // Establish the websocket connection
    Events.on(appHost, 'resume', () => {
        ServerConnections.currentApiClient()?.ensureWebSocket();
    });

    // Register API request error handlers
    ServerConnections.getApiClients().forEach(bindRequestFailureHandler);
    Events.off(ServerConnections, 'apiclientcreated', onApiClientCreated);
    Events.on(ServerConnections, 'apiclientcreated', onApiClientCreated);

    // Start server notifications
    initializeServerConnections();

    // Render the app
    await renderApp();

    // The useful shell must not wait for optional frontend plugins. Start those
    // modules after React has mounted so a slow plugin can never strand the
    // static splash screen.
    loadPlatformFeatures();
    void loadPlugins();

    // Enable navigation controls
    keyboardNavigation.enable();
    autoFocuser.enable();
}

function loadNotoLocaleFont(profile) {
    switch (profile) {
        case 'hk':
            return import('./styles/fonts.noto.hk.scss');
        case 'jp':
            return import('./styles/fonts.noto.jp.scss');
        case 'kr':
            return import('./styles/fonts.noto.kr.scss');
        case 'sc':
            return import('./styles/fonts.noto.sc.scss');
        case 'tc':
            return import('./styles/fonts.noto.tc.scss');
        default:
            return Promise.resolve();
    }
}

const loadNotoFonts = createNotoFontLoader({
    getLocale: () => globalize.getCurrentLocale() || document.documentElement.lang,
    loadBase: () => import('./styles/fonts.noto.scss'),
    loadLocale: loadNotoLocaleFont,
    applyProfile: profile => {
        document.documentElement.dataset.ptvNotoFontProfile = profile;
    },
    onError: error => {
        console.warn('[PTV] Failed to load locale font styles.', error);
    }
});

function updateFontsForCulture() {
    if (!(browser.tv && !browser.android) && !__USE_SYSTEM_FONTS__) {
        void loadNotoFonts();
    }
}

function loadFonts() {
    if (browser.tv && !browser.android) {
        console.debug('using system fonts with explicit sizes');
        void import('./styles/fonts.sized.scss');
    } else if (__USE_SYSTEM_FONTS__) {
        console.debug('using system fonts');
        void import('./styles/fonts.scss');
    } else {
        console.debug('using default fonts');
        void import('./styles/fonts.scss');
        void loadNotoFonts();
    }
}

async function loadPlugins() {
    console.groupCollapsed('loading installed plugins');
    console.dir(pluginManager);

    try {
        let list = await getPlugins();
        if (!appHost.supports(AppFeature.RemoteControl)) {
            // Disable remote player plugins if not supported
            list = list.filter(plugin => !plugin.startsWith('sessionPlayer')
                && !plugin.startsWith('chromecastPlayer'));
        } else if (!browser.chrome && !browser.edgeChromium && !browser.opera) {
            // Disable chromecast player in unsupported browsers
            list = list.filter(plugin => !plugin.startsWith('chromecastPlayer'));
        }

        // add any native plugins
        if (window.NativeShell) {
            list = list.concat(window.NativeShell.getPlugins());
        }

        await Promise.all(list.map(plugin => pluginManager.loadPlugin(plugin)));
        console.debug('finished loading plugins');
    } catch (e) {
        console.warn('failed loading plugins', e);
    }

    console.groupEnd('loading installed plugins');
}

function loadPlatformFeatures() {
    if (!browser.tv && !browser.xboxOne && !browser.ps4) {
        import('./components/nowPlayingBar/nowPlayingBar');
    }

    if (appHost.supports(AppFeature.RemoteControl)) {
        import('./components/playback/playerSelectionMenu');
        import('./components/playback/remotecontrolautoplay');
    }

    if (!appHost.supports(AppFeature.PhysicalVolumeControl) || browser.touch) {
        import('./components/playback/volumeosd');
    }

    if (!browser.tv && !browser.xboxOne) {
        import('./components/playback/playbackorientation');
        registerServiceWorker();

        if (window.Notification) {
            import('./components/notifications/notifications');
        }
    }
}

function registerServiceWorker() {
    if (process.env.NODE_ENV !== 'production') {
        console.info('[PTV] Service worker disabled in development.');
        return;
    }

    if (!('serviceWorker' in navigator)) {
        console.warn('[PTV] Service worker unsupported.');
        return;
    }

    // eslint-disable-next-line compat/compat
    navigator.serviceWorker.register(getPtvServiceWorkerScriptUrl()).catch(err => {
        console.warn('[PTV] Service worker registration failed:', err);
    });
}

async function renderApp() {
    const container = document.getElementById('reactRoot');
    // Remove the splash logo
    container.innerHTML = '';

    loading.show();

    const root = createRoot(container);
    root.render(
        <RootApp />
    );
}

void initializePtvWebAppOnce(init);
