import type { Api } from '@jellyfin/sdk';
import type { ApiClient } from 'jellyfin-apiclient';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ownershipMocks = vi.hoisted(() => ({
    enableAutomaticBitrateDetection: vi.fn(),
    getConfiguration: vi.fn(),
    maxStreamingBitrate: vi.fn(),
    updateConfiguration: vi.fn()
}));

vi.mock('@jellyfin/sdk/lib/utils/api/configuration-api', () => ({
    getConfigurationApi: () => ({
        getConfiguration: ownershipMocks.getConfiguration,
        updateConfiguration: ownershipMocks.updateConfiguration
    })
}));

vi.mock('../../../../../scripts/settings/appSettings', () => ({
    default: {
        enableAutomaticBitrateDetection: ownershipMocks.enableAutomaticBitrateDetection,
        maxStreamingBitrate: ownershipMocks.maxStreamingBitrate
    }
}));

vi.mock('../../../../../scripts/settings/userSettings', () => ({
    currentSettings: {
        currentApiClient: null,
        currentUserId: null,
        getData: vi.fn(),
        setUserInfo: vi.fn()
    }
}));

import { savePtvPlaybackSettings } from '../../settingsAdapters';
import { saveAdminStreaming } from './adminPlaybackSettingsService';

describe('member and administrator Playback mutation isolation', () => {
    const memberSettings = {
        automaticallyPlayNextEpisode: true,
        homeNetworkBitrate: 20_000_000,
        rememberAudioSelection: true,
        rememberSubtitleSelection: false,
        remoteBitrate: 8_000_000
    };

    beforeEach(() => {
        vi.clearAllMocks();
        ownershipMocks.getConfiguration.mockResolvedValue({
            data: { RemoteClientBitrateLimit: 10_000_000 }
        });
        ownershipMocks.updateConfiguration.mockResolvedValue({});
    });

    it('member Playback saves user configuration and app preferences, never server configuration', async () => {
        const getUser = vi.fn().mockResolvedValue({
            Configuration: { FutureUserPreference: 'preserved' }
        });
        const updateUserConfiguration = vi.fn().mockResolvedValue(undefined);
        const memberApi = { getUser, updateUserConfiguration } as unknown as ApiClient;

        await savePtvPlaybackSettings(memberApi, 'member-a', memberSettings);

        expect(updateUserConfiguration).toHaveBeenCalledOnce();
        expect(updateUserConfiguration).toHaveBeenCalledWith('member-a', expect.objectContaining({
            EnableNextEpisodeAutoPlay: true,
            FutureUserPreference: 'preserved',
            RememberAudioSelections: true,
            RememberSubtitleSelections: false
        }));
        expect(ownershipMocks.enableAutomaticBitrateDetection).toHaveBeenCalledTimes(2);
        expect(ownershipMocks.getConfiguration).not.toHaveBeenCalled();
        expect(ownershipMocks.updateConfiguration).not.toHaveBeenCalled();
    });

    it('Administration Playback saves server configuration, never member preferences', async () => {
        const memberApi = {
            getUser: vi.fn(),
            updateUserConfiguration: vi.fn()
        };

        await saveAdminStreaming(
            {} as Api,
            { remoteBitrateLimitBitsPerSecond: 20_000_000 },
            { remoteBitrateLimitBitsPerSecond: 10_000_000 }
        );

        expect(ownershipMocks.getConfiguration).toHaveBeenCalledOnce();
        expect(ownershipMocks.updateConfiguration).toHaveBeenCalledOnce();
        expect(memberApi.getUser).not.toHaveBeenCalled();
        expect(memberApi.updateUserConfiguration).not.toHaveBeenCalled();
        expect(ownershipMocks.enableAutomaticBitrateDetection).not.toHaveBeenCalled();
        expect(ownershipMocks.maxStreamingBitrate).not.toHaveBeenCalled();
    });
});
