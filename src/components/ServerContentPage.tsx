import { FunctionComponent, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import viewManager from './viewManager/viewManager';
import globalize from 'lib/globalize';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import type { RestoreViewFailResponse } from 'types/viewManager';

import { qualifyPluginConfigurationResourceUrls } from './serverContentResources';

interface ServerContentPageProps {
    view: string
}

type ServerContentViewOptions = Parameters<typeof viewManager.tryRestoreView>[0];

async function loadServerContent(
    view: string,
    search: string,
    viewOptions: ServerContentViewOptions
) {
    const apiClient = ServerConnections.currentApiClient();
    if (!apiClient) return;

    const html = await apiClient.get(apiClient.getUrl(view + search));
    const translatedViewHtml = globalize.translateHtml(html);
    const viewHtml = translatedViewHtml && view === '/web/configurationpage' ?
        qualifyPluginConfigurationResourceUrls(
            translatedViewHtml,
            path => apiClient.getUrl(path)
        ) : translatedViewHtml;

    viewManager.loadView({
        ...viewOptions,
        view: viewHtml
    });
}

async function restoreOrLoadServerContent(
    view: string,
    search: string,
    viewOptions: ServerContentViewOptions
) {
    try {
        await viewManager.tryRestoreView(viewOptions);
    } catch (result) {
        if (!(result as RestoreViewFailResponse | undefined)?.cancelled) {
            await loadServerContent(view, search, viewOptions);
        }
    }
}

/**
 * Page component that renders html content from a server request.
 * Uses the ViewManager to dynamically load and execute the page JS.
 */
const ServerContentPage: FunctionComponent<ServerContentPageProps> = ({ view }) => {
    const location = useLocation();

    useEffect(() => {
        const loadPage = () => {
            const viewOptions = {
                url: location.pathname + location.search,
                state: location.state,
                autoFocus: false,
                options: {
                    supportsThemeMedia: false,
                    enableMediaControl: true
                }
            };

            void restoreOrLoadServerContent(view, location.search, viewOptions);
        };

        loadPage();
    },
    // location.state is NOT included as a dependency here since dialogs will update state while the current view stays the same
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
        view,
        location.pathname,
        location.search
    ]);

    return null;
};

export default ServerContentPage;
