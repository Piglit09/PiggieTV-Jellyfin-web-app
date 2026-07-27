export const PTV_CORE_CONTRACT_VERSION = '1.0' as const;
export const PTV_CORE_SCHEMA_VERSION = 1 as const;

export type PtvCoreContractVersion = typeof PTV_CORE_CONTRACT_VERSION;

export type PtvCorePlatform =
    | 'android'
    | 'android-tv'
    | 'fire-tv'
    | 'plugin'
    | 'unknown'
    | 'web'
    | 'webos';

export type PtvCoreScopeKind = 'device' | 'global' | 'server' | 'user';

export type PtvCoreScope = Readonly<{
    deviceId?: string;
    kind: PtvCoreScopeKind;
    serverId?: string;
    userId?: string;
}>;
