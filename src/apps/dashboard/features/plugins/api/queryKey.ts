export enum QueryKey {
    ConfigurationPages = 'ConfigurationPages',
    Packages = 'Packages',
    Plugins = 'Plugins',
    Repositories = 'Repositories'
}

export function getConfigurationPagesQueryKey(
    serverId: string,
    enableInMainMenu?: boolean
) {
    return [ QueryKey.ConfigurationPages, serverId, enableInMainMenu ] as const;
}
