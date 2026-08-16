type ServerUrlResolver = (path: string) => string;

/**
 * Plugin configuration HTML is fetched from Jellyfin and can reference its
 * companion resources with server-relative `configurationpage?...` URLs.
 * Qualify only those known resource URLs so a separately hosted web client
 * (including the local development server) still executes the plugin-owned
 * page from the connected Jellyfin server.
 */
export function qualifyPluginConfigurationResourceUrls(
    html: string,
    getServerUrl: ServerUrlResolver
) {
    const template = document.createElement('template');
    template.innerHTML = html;

    const qualify = (element: Element, attribute: 'href' | 'src') => {
        const rawValue = element.getAttribute(attribute)?.trim();
        if (!rawValue) {
            element.remove();
            return;
        }
        const value = rawValue.startsWith('./') ? rawValue.slice(2) : rawValue;
        let serverPath: string | null = null;
        if (/^configurationpage\?/i.test(value)) {
            serverPath = `/web/${value}`;
        } else if (/^web\/configurationpage\?/i.test(value)) {
            serverPath = `/${value}`;
        } else if (/^\/web\/configurationpage\?/i.test(value)) {
            serverPath = value;
        }
        if (serverPath) {
            element.setAttribute(attribute, getServerUrl(serverPath));
            return;
        }

        // Plugin configuration markup is server-controlled, but it is loaded
        // into the web client's origin. Never allow it to bootstrap arbitrary
        // external, protocol-relative, data/javascript, or unrelated relative
        // script/style resources. Plugin-owned companion files must use the
        // Jellyfin configurationpage resource contract above.
        element.remove();
    };

    template.content.querySelectorAll('script[src]').forEach(element => {
        qualify(element, 'src');
    });
    template.content.querySelectorAll('link[href]').forEach(element => {
        qualify(element, 'href');
    });
    return template.innerHTML;
}
