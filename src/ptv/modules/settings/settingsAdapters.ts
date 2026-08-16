import type { ApiClient } from 'jellyfin-apiclient';

import appSettings from '../../../scripts/settings/appSettings';
import { currentSettings } from '../../../scripts/settings/userSettings';

export type PtvPlaybackSettings = Readonly<{
    automaticallyPlayNextEpisode: boolean;
    homeNetworkBitrate: number;
    rememberAudioSelection: boolean;
    rememberSubtitleSelection: boolean;
    remoteBitrate: number;
}>;

export type PtvSubtitleSettings = Readonly<{
    language: string;
    mode: string;
    textSize: string;
}>;

export type PtvControlSettings = Readonly<{
    gamepadNavigation: boolean;
    smoothScroll: boolean;
}>;

export type PtvConnectedDevice = Readonly<{
    app: string;
    current: boolean;
    id: string;
    lastActive: string;
    name: string;
}>;

export type PtvConnectionInfo = Readonly<{
    id: string;
    name: string;
    status: 'connected';
    version: string;
}>;

export const PTV_VIDEO_QUALITY_OPTIONS = [
    { label: 'Auto', value: 0 },
    { label: 'Original', value: 150_000_000 },
    { label: '20 Mbps', value: 20_000_000 },
    { label: '15 Mbps', value: 15_000_000 },
    { label: '10 Mbps', value: 10_000_000 },
    { label: '8 Mbps', value: 8_000_000 },
    { label: '5 Mbps', value: 5_000_000 }
] as const;

let userConfigurationSaveQueue = Promise.resolve();

function getServerId(apiClient: ApiClient) {
    return typeof apiClient.serverId === 'function' ? apiClient.serverId() : '';
}

export async function ensurePtvSettingsUser(apiClient: ApiClient, userId: string) {
    const settingsServerId = currentSettings.currentApiClient
        && typeof currentSettings.currentApiClient.serverId === 'function' ?
        currentSettings.currentApiClient.serverId() :
        '';

    if (
        currentSettings.currentUserId === userId
        && settingsServerId === getServerId(apiClient)
        && currentSettings.getData()
    ) return;

    await currentSettings.setUserInfo(userId, apiClient);
}

export async function loadPtvPlaybackSettings(apiClient: ApiClient, userId: string): Promise<PtvPlaybackSettings> {
    await ensurePtvSettingsUser(apiClient, userId);
    const user = await apiClient.getUser(userId);
    const configuration = user.Configuration || {};

    return {
        automaticallyPlayNextEpisode: Boolean(configuration.EnableNextEpisodeAutoPlay),
        homeNetworkBitrate: appSettings.enableAutomaticBitrateDetection(true, 'Video') ?
            0 : appSettings.maxStreamingBitrate(true, 'Video'),
        rememberAudioSelection: Boolean(configuration.RememberAudioSelections),
        rememberSubtitleSelection: Boolean(configuration.RememberSubtitleSelections),
        remoteBitrate: appSettings.enableAutomaticBitrateDetection(false, 'Video') ?
            0 : appSettings.maxStreamingBitrate(false, 'Video')
    };
}

function savePtvUserConfiguration(
    apiClient: ApiClient,
    userId: string,
    update: (configuration: Record<string, unknown>) => void
) {
    const save = userConfigurationSaveQueue.then(async () => {
        const user = await apiClient.getUser(userId);
        const configuration = { ...(user.Configuration || {}) } as Record<string, unknown>;

        update(configuration);
        await apiClient.updateUserConfiguration(userId, configuration);
    });

    userConfigurationSaveQueue = save.catch(() => undefined);
    return save;
}

function writeVideoQuality(isInNetwork: boolean, value: number) {
    const automatic = value === 0;

    appSettings.enableAutomaticBitrateDetection(isInNetwork, 'Video', automatic);
    if (!automatic) appSettings.maxStreamingBitrate(isInNetwork, 'Video', value);
}

export async function savePtvPlaybackSettings(
    apiClient: ApiClient,
    userId: string,
    settings: PtvPlaybackSettings
) {
    await savePtvUserConfiguration(apiClient, userId, configuration => {
        configuration.EnableNextEpisodeAutoPlay = settings.automaticallyPlayNextEpisode;
        configuration.RememberAudioSelections = settings.rememberAudioSelection;
        configuration.RememberSubtitleSelections = settings.rememberSubtitleSelection;
    });
    writeVideoQuality(true, settings.homeNetworkBitrate);
    writeVideoQuality(false, settings.remoteBitrate);
}

export async function loadPtvSubtitleSettings(apiClient: ApiClient, userId: string): Promise<PtvSubtitleSettings> {
    await ensurePtvSettingsUser(apiClient, userId);
    const user = await apiClient.getUser(userId);
    const appearance = currentSettings.getSubtitleAppearanceSettings(undefined) as { textSize?: string };

    return {
        language: user.Configuration?.SubtitleLanguagePreference || '',
        mode: user.Configuration?.SubtitleMode || 'Default',
        textSize: appearance.textSize || 'medium'
    };
}

export async function savePtvSubtitleSettings(
    apiClient: ApiClient,
    userId: string,
    settings: PtvSubtitleSettings
) {
    await savePtvUserConfiguration(apiClient, userId, configuration => {
        configuration.SubtitleLanguagePreference = settings.language;
        configuration.SubtitleMode = settings.mode;
    });

    const previousAppearance = currentSettings.getSubtitleAppearanceSettings(undefined) as Record<string, unknown>;
    currentSettings.setSubtitleAppearanceSettings({
        ...previousAppearance,
        textSize: settings.textSize
    }, undefined);
}

export function loadPtvControlSettings(): PtvControlSettings {
    return {
        gamepadNavigation: appSettings.enableGamepad(undefined),
        smoothScroll: appSettings.enableSmoothScroll(undefined)
    };
}

export function savePtvControlSettings(settings: PtvControlSettings) {
    appSettings.enableGamepad(settings.gamepadNavigation);
    appSettings.enableSmoothScroll(settings.smoothScroll);
}

function getPtvDeviceAppLabel(client?: string | null, version?: string | null) {
    const label = String(client || version || 'PiggieTV');
    return /jellyfin web/i.test(label) ? 'PiggieTV Web' : label;
}

export async function loadPtvConnectedDevices(apiClient: ApiClient, userId: string): Promise<PtvConnectedDevice[]> {
    const sessions = await apiClient.getSessions({ userId });

    return sessions
        .filter(session => !session.UserId || session.UserId === userId)
        .map((session, index) => ({
            app: getPtvDeviceAppLabel(session.Client, session.ApplicationVersion),
            current: Boolean(session.DeviceId && session.DeviceId === apiClient.deviceId()),
            id: String(session.Id || session.DeviceId || index),
            lastActive: session.LastActivityDate ? new Date(session.LastActivityDate).toLocaleString() : 'Recently active',
            name: String(session.DeviceName || session.DeviceId || 'PiggieTV device')
        }));
}

export async function loadPtvConnectionInfo(apiClient: ApiClient): Promise<PtvConnectionInfo> {
    const info = await apiClient.getPublicSystemInfo();

    return {
        id: String(info.Id || ''),
        name: String(info.ServerName || 'PiggieTV'),
        status: 'connected',
        version: String(info.Version || '')
    };
}
