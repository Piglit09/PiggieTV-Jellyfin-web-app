import { getPtvClientProfile, type PtvClientProfile } from '../clientProfile';
import { createPtvClientCapabilityReport, type PtvClientCapabilityReport } from './clientCapabilities';

function hasPtvWebLocalStorage() {
    try {
        return typeof window !== 'undefined' && Boolean(window.localStorage);
    } catch {
        return false;
    }
}

function getPtvWebPlatform(profile: PtvClientProfile) {
    if (profile.isWebOs) return 'webos';
    if (profile.isFireTv) return 'fire-tv';
    if (profile.isAndroidTv) return 'android-tv';

    return 'web';
}

function getPtvWebDeviceClass(profile: PtvClientProfile) {
    if (profile.isTv) return 'tv';
    if (profile.isTablet) return 'tablet';
    if (profile.isMobile) return 'mobile';

    return 'desktop';
}

export function getPtvWebCapabilityReport(
    profile: PtvClientProfile = getPtvClientProfile()
): PtvClientCapabilityReport {
    return createPtvClientCapabilityReport({
        capabilities: {
            androidAuto: false,
            audioPlayback: true,
            backgroundAudio: !profile.isWebOs,
            comicPaging: true,
            deepLinks: true,
            downloads: !profile.isTv,
            hardwareDecoding: false,
            keyboardInput: !profile.isTv,
            lockScreenControls: false,
            nativeNotifications: typeof Notification !== 'undefined',
            offlineCache: hasPtvWebLocalStorage(),
            pointerInput: profile.hasHover,
            quickConnect: true,
            reader: true,
            remoteInput: profile.isTv,
            telemetry: true,
            touchInput: profile.isCoarsePointer || profile.isMobile || profile.isTablet,
            tvFocusNavigation: profile.isTv,
            videoPlayback: true
        },
        deviceClass: getPtvWebDeviceClass(profile),
        platform: getPtvWebPlatform(profile)
    });
}
