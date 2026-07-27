import {
    PTV_CORE_CONTRACT_VERSION,
    type PtvCoreContractVersion,
    type PtvCorePlatform
} from '../contracts/version';

export const PTV_CORE_CAPABILITIES = [
    'androidAuto',
    'audioPlayback',
    'backgroundAudio',
    'comicPaging',
    'deepLinks',
    'downloads',
    'hardwareDecoding',
    'keyboardInput',
    'lockScreenControls',
    'nativeNotifications',
    'offlineCache',
    'pointerInput',
    'quickConnect',
    'reader',
    'remoteInput',
    'telemetry',
    'touchInput',
    'tvFocusNavigation',
    'videoPlayback'
] as const;

export type PtvCoreCapability = typeof PTV_CORE_CAPABILITIES[number];

export type PtvClientCapabilityReport = Readonly<{
    capabilities: Readonly<Record<string, boolean>>;
    contractVersion: PtvCoreContractVersion;
    deviceClass: string;
    platform: PtvCorePlatform;
}>;

export function createPtvClientCapabilityReport(options: Readonly<{
    capabilities?: Readonly<Record<string, boolean>>;
    deviceClass: string;
    platform: PtvCorePlatform;
}>): PtvClientCapabilityReport {
    return {
        capabilities: { ...options.capabilities },
        contractVersion: PTV_CORE_CONTRACT_VERSION,
        deviceClass: options.deviceClass,
        platform: options.platform
    };
}

export function hasPtvClientCapability(
    report: PtvClientCapabilityReport | null | undefined,
    capability: PtvCoreCapability | string
): boolean {
    return report?.capabilities[capability] === true;
}

export function hasAllPtvClientCapabilities(
    report: PtvClientCapabilityReport | null | undefined,
    capabilities: readonly (PtvCoreCapability | string)[]
): boolean {
    return capabilities.every(capability => hasPtvClientCapability(report, capability));
}
