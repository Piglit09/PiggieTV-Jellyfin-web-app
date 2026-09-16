import type { Api } from '@jellyfin/sdk';
import type { ApiClient } from 'jellyfin-apiclient';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const resourceMocks = vi.hoisted(() => ({
    useAdminPlaybackResource: vi.fn()
}));

vi.mock('./useAdminPlaybackResource', () => resourceMocks);

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
import {
    useAdminResume,
    useAdminStreaming,
    useAdminTranscoding,
    useAdminTrickplay
} from './useAdminPlayback';

/* eslint-disable @typescript-eslint/naming-convention */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
/* eslint-enable @typescript-eslint/naming-convention */

const api = {} as Api;
const apiClient = {
    serverId: () => 'server-a'
} as unknown as ApiClient;

function Harness() {
    useAdminStreaming(api, apiClient);
    useAdminTranscoding(api, apiClient);
    useAdminResume(api, apiClient);
    useAdminTrickplay(api, apiClient);
    return null;
}

describe('administrator Playback resource bindings', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('keeps every section on an isolated source-specific resource identity', async () => {
        const container = document.createElement('div');
        document.body.append(container);
        const root = createRoot(container);

        await act(async () => root.render(<Harness />));

        expect(resourceMocks.useAdminPlaybackResource).toHaveBeenNthCalledWith(1, {
            api,
            apiClient,
            load: loadAdminStreaming,
            save: saveAdminStreaming,
            section: 'streaming',
            source: 'System/Configuration'
        });
        expect(resourceMocks.useAdminPlaybackResource).toHaveBeenNthCalledWith(2, {
            api,
            apiClient,
            load: loadAdminTranscoding,
            save: saveAdminTranscoding,
            section: 'transcoding',
            source: 'System/Configuration/encoding'
        });
        expect(resourceMocks.useAdminPlaybackResource).toHaveBeenNthCalledWith(3, {
            api,
            apiClient,
            load: loadAdminResume,
            save: saveAdminResume,
            section: 'resume',
            source: 'System/Configuration'
        });
        expect(resourceMocks.useAdminPlaybackResource).toHaveBeenNthCalledWith(4, {
            api,
            apiClient,
            load: loadAdminTrickplay,
            save: saveAdminTrickplay,
            section: 'trickplay',
            source: 'System/Configuration'
        });

        await act(async () => root.unmount());
        container.remove();
    });
});
