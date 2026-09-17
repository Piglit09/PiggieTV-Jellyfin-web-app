import { getConfigurationPagesQueryKey } from 'apps/dashboard/features/plugins/api/queryKey';

const ADMIN_PLUGINS_QUERY_SCOPE = 'PtvAdminPlugins';

export function getAdminPluginsQueryKeys(serverKey: string, pluginId?: string) {
    const server = serverKey.trim() || 'current-server';
    const scope = [ ADMIN_PLUGINS_QUERY_SCOPE, server ] as const;
    const normalizedId = pluginId?.replace(/[{}-]/g, '').trim().toLowerCase() || '';

    return {
        catalog: [ ...scope, 'catalog' ] as const,
        configurationPages: getConfigurationPagesQueryKey(server),
        detail: [ ...scope, 'detail', normalizedId ] as const,
        installed: [ ...scope, 'installed' ] as const,
        mainMenuConfigurationPages: getConfigurationPagesQueryKey(server, true),
        repositories: [ ...scope, 'repositories' ] as const,
        root: scope
    };
}
