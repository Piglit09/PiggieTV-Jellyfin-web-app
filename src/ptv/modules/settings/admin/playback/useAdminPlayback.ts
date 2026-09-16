import type { Api } from '@jellyfin/sdk';
import type { ApiClient } from 'jellyfin-apiclient';

import {
    loadAdminResume,
    loadAdminStreaming,
    loadAdminTrickplay,
    saveAdminResume,
    saveAdminStreaming,
    saveAdminTrickplay
} from './adminPlaybackSettingsService';
import {
    loadAdminTranscoding,
    saveAdminTranscoding
} from './adminTranscodingService';
import { useAdminPlaybackResource } from './useAdminPlaybackResource';

export function useAdminStreaming(api?: Api, apiClient?: ApiClient) {
    return useAdminPlaybackResource({
        api,
        apiClient,
        load: loadAdminStreaming,
        save: saveAdminStreaming,
        section: 'streaming',
        source: 'System/Configuration'
    });
}

export function useAdminResume(api?: Api, apiClient?: ApiClient) {
    return useAdminPlaybackResource({
        api,
        apiClient,
        load: loadAdminResume,
        save: saveAdminResume,
        section: 'resume',
        source: 'System/Configuration'
    });
}

export function useAdminTrickplay(api?: Api, apiClient?: ApiClient) {
    return useAdminPlaybackResource({
        api,
        apiClient,
        load: loadAdminTrickplay,
        save: saveAdminTrickplay,
        section: 'trickplay',
        source: 'System/Configuration'
    });
}

export function useAdminTranscoding(api?: Api, apiClient?: ApiClient) {
    return useAdminPlaybackResource({
        api,
        apiClient,
        load: loadAdminTranscoding,
        save: saveAdminTranscoding,
        section: 'transcoding',
        source: 'System/Configuration/encoding'
    });
}
