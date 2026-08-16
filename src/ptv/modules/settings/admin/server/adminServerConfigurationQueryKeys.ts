const ADMIN_SERVER_CONFIGURATION_QUERY_SCOPE = 'PtvAdminServerConfiguration';

export function getAdminServerConfigurationQueryKeys(serverKey: string) {
    const server = serverKey.trim() || 'unresolved-server';
    const root = [ ADMIN_SERVER_CONFIGURATION_QUERY_SCOPE, server ] as const;

    return {
        branding: [ ...root, 'branding', 'Branding/Configuration' ] as const,
        general: [ ...root, 'general', 'System/Configuration' ] as const,
        localization: [ ...root, 'catalog', 'Localization/Options' ] as const,
        networking: [ ...root, 'networking', 'System/Configuration/network' ] as const,
        root,
        system: [ ...root, 'system', 'System/Info' ] as const
    };
}
