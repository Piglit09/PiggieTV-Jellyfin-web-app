import * as userSettings from '../scripts/settings/userSettings';
import loading from '../components/loading/loading';
import focusManager from '../components/focusManager';
import homeSections from '../components/homesections/homesections';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { ptvSafeConsole } from 'ptv/core/safeConsole';
import { requestPtvJson } from 'ptv/api/client';
import {
    acquirePtvRouteLifetime,
    retirePtvRouteLifetime
} from 'ptv/shell/routeController';

import '../elements/emby-itemscontainer/emby-itemscontainer';

class HomeTab {
    constructor(view, params) {
        this.view = view;
        this.params = params;
        this.apiClient = ServerConnections.currentApiClient();
        this.sectionsContainer = view.querySelector('.sections');
        this.sectionsRendered = false;
        this.paused = true;
        this.destroyed = false;
        this.routeLifetime = null;
        this.loadingLifetime = null;
        this.settingsChangedHandler = onHomeScreenSettingsChanged.bind(this);
        this.sectionsContainer?.addEventListener('settingschange', this.settingsChangedHandler);
    }
    onResume(options = {}) {
        if (this.destroyed) return Promise.resolve();

        this.paused = false;
        const lifetime = this.acquireRouteLifetime();

        if (this.sectionsRendered) {
            const sectionsContainer = this.sectionsContainer;

            if (sectionsContainer) {
                return homeSections.resume(sectionsContainer, options, lifetime);
            }

            return Promise.resolve();
        }

        loading.show();
        this.loadingLifetime = lifetime;
        const view = this.view;
        const apiClient = this.apiClient;
        const serverId = apiClient.serverId?.();
        const userId = apiClient.getCurrentUserId?.();
        this.destroyHomeSections();
        const currentUserRequest = userId ?
            requestPtvJson(`Users/${userId}`, {
                scope: 'route',
                serverId,
                signal: lifetime.signal
            }) :
            Promise.reject(new Error('A current Jellyfin user is required for Home.'));

        return currentUserRequest
            .then(user => {
                if (!this.isRouteLifetimeCurrent(lifetime)) return undefined;

                return homeSections.loadSections(
                    view.querySelector('.sections'),
                    apiClient,
                    user,
                    userSettings,
                    lifetime
                );
            })
            .then(() => {
                if (this.isRouteLifetimeCurrent(lifetime)) {
                    this.sectionsRendered = true;

                    if (options.autoFocus) {
                        focusManager.autoFocus(view);
                    }
                }
            }).catch(err => {
                if (this.isRouteLifetimeCurrent(lifetime) && err?.name !== 'AbortError') {
                    ptvSafeConsole.error('[HomeTab] failed to load home sections', err);
                }
            }).finally(() => {
                this.finishLoading(lifetime);
            });
    }
    onPause() {
        this.paused = true;
        this.retireRouteLifetime();
        const sectionsContainer = this.sectionsContainer;

        if (sectionsContainer) {
            homeSections.pause(sectionsContainer);
        }
    }
    destroy() {
        if (this.destroyed) return;

        this.destroyed = true;
        this.paused = true;
        this.retireRouteLifetime();
        this.sectionsContainer?.removeEventListener('settingschange', this.settingsChangedHandler);
        this.destroyHomeSections();
        this.view = null;
        this.params = null;
        this.apiClient = null;
        this.sectionsContainer = null;
        this.settingsChangedHandler = null;
    }
    destroyHomeSections() {
        const sectionsContainer = this.sectionsContainer;

        if (sectionsContainer) {
            homeSections.destroySections(sectionsContainer);
        }
    }
    acquireRouteLifetime() {
        this.retireRouteLifetime();
        this.routeLifetime = acquirePtvRouteLifetime('legacy-home');

        return this.routeLifetime;
    }
    isRouteLifetimeCurrent(lifetime) {
        return !this.destroyed
            && !this.paused
            && this.routeLifetime === lifetime
            && lifetime.isCurrent();
    }
    retireRouteLifetime() {
        const lifetime = this.routeLifetime;

        if (!lifetime) return;

        retirePtvRouteLifetime(lifetime);
        this.routeLifetime = null;
        this.finishLoading(lifetime);
    }
    finishLoading(lifetime) {
        if (this.loadingLifetime !== lifetime) return;

        this.loadingLifetime = null;
        loading.hide();
    }
}

function onHomeScreenSettingsChanged() {
    this.sectionsRendered = false;

    if (!this.paused) {
        this.onResume({
            refresh: true
        });
    }
}

export default HomeTab;
