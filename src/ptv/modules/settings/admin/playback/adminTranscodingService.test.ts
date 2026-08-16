import type { Api } from '@jellyfin/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
    getNamedConfiguration: vi.fn(),
    updateNamedConfiguration: vi.fn()
}));

vi.mock('@jellyfin/sdk/lib/utils/api/configuration-api', () => ({
    getConfigurationApi: () => ({
        getNamedConfiguration: apiMocks.getNamedConfiguration,
        updateNamedConfiguration: apiMocks.updateNamedConfiguration
    })
}));

import { normalizeAdminTranscodingSettings } from './adminTranscodingAdapters';
import {
    ENCODING_CONFIGURATION_KEY,
    loadAdminTranscoding,
    saveAdminTranscoding
} from './adminTranscodingService';
import type { AdminTranscodingSettings } from './adminTranscodingModel';
import { rawTranscodingConfiguration } from './adminTranscodingTestFixtures';

const api = {} as Api;

function confirmed(): AdminTranscodingSettings {
    return normalizeAdminTranscodingSettings(rawTranscodingConfiguration());
}

describe('administrator Transcoding service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiMocks.getNamedConfiguration.mockResolvedValue({
            data: rawTranscodingConfiguration()
        });
        apiMocks.updateNamedConfiguration.mockResolvedValue({});
    });

    it('loads the exact named resource with cancellation support', async () => {
        // eslint-disable-next-line compat/compat
        const controller = new AbortController();

        await expect(loadAdminTranscoding(api, controller.signal)).resolves.toMatchObject({
            settings: { hardwareAccelerationType: 'none' }
        });
        expect(apiMocks.getNamedConfiguration).toHaveBeenCalledWith(
            { key: ENCODING_CONFIGURATION_KEY },
            { signal: controller.signal }
        );
        expect(apiMocks.updateNamedConfiguration).not.toHaveBeenCalled();
    });

    it('sanitizes load transport failures', async () => {
        apiMocks.getNamedConfiguration.mockRejectedValue(
            new Error('secret path and raw response')
        );

        await expect(loadAdminTranscoding(api)).rejects.toMatchObject({
            code: 'load-unavailable',
            message: 'Transcoding settings could not be loaded.'
        });
    });

    it('retains a strict invalid-response error for an incomplete document', async () => {
        apiMocks.getNamedConfiguration.mockResolvedValue({
            data: { ...rawTranscodingConfiguration(), EnableHardwareEncoding: undefined }
        });

        await expect(loadAdminTranscoding(api)).rejects.toMatchObject({
            code: 'invalid-response',
            message: 'Transcoding settings are unavailable.'
        });
    });

    it('fresh-reads, deep-clones, and posts the complete named document', async () => {
        const raw = {
            ...rawTranscodingConfiguration(),
            EncoderAppPath: '/protected/ffmpeg',
            FutureNested: { plugin: { enabled: true } }
        };
        apiMocks.getNamedConfiguration.mockResolvedValue({ data: raw });
        const baseline = normalizeAdminTranscodingSettings(raw);
        const desired: AdminTranscodingSettings = {
            ...baseline,
            enableThrottling: true,
            throttleDelaySeconds: 240
        };

        const saved = await saveAdminTranscoding(api, desired, baseline);

        expect(apiMocks.getNamedConfiguration).toHaveBeenCalledOnce();
        expect(apiMocks.updateNamedConfiguration).toHaveBeenCalledOnce();
        const request = apiMocks.updateNamedConfiguration.mock.calls[0][0];
        expect(request.key).toBe('encoding');
        expect(request.body).not.toBe(raw);
        expect(request.body.FutureNested).not.toBe(raw.FutureNested);
        expect(request.body.FutureNested).toEqual(raw.FutureNested);
        expect(request.body.EncoderAppPath).toBe('/protected/ffmpeg');
        expect(request.body.AllowOnDemandMetadataBasedKeyframeExtractionForExtensions).toEqual([ 'mkv' ]);
        expect(request.body.HardwareDecodingCodecs).toEqual([ 'h264', 'vc1', 'future-codec' ]);
        expect(request.body.EnableThrottling).toBe(true);
        expect(request.body.ThrottleDelaySeconds).toBe(240);
        expect(saved.configuration).toBe(request.body);
        expect(saved.settings).toEqual(desired);
    });

    it('preserves fresh unrelated changes without treating them as conflicts', async () => {
        const current = rawTranscodingConfiguration();
        const baseline = normalizeAdminTranscodingSettings(current);
        apiMocks.getNamedConfiguration.mockResolvedValue({
            data: {
                ...current,
                AllowOnDemandMetadataBasedKeyframeExtractionForExtensions: [ 'mkv', 'mp4' ],
                EncoderAppPath: '/fresh/encoder',
                FutureField: 'fresh'
            }
        });

        await saveAdminTranscoding(api, {
            ...baseline,
            enableAudioVbr: true
        }, baseline);

        const outgoing = apiMocks.updateNamedConfiguration.mock.calls[0][0].body;
        expect(outgoing.AllowOnDemandMetadataBasedKeyframeExtractionForExtensions).toEqual([ 'mkv', 'mp4' ]);
        expect(outgoing.EncoderAppPath).toBe('/fresh/encoder');
        expect(outgoing.FutureField).toBe('fresh');
    });

    it('preserves fresh read-only runtime-path changes without conflicting or writing the stale value', async () => {
        const baseline = confirmed();
        apiMocks.getNamedConfiguration.mockResolvedValue({
            data: {
                ...rawTranscodingConfiguration(),
                EncoderAppPathDisplay: '/fresh/runtime/ffmpeg'
            }
        });

        await saveAdminTranscoding(api, {
            ...baseline,
            enableAudioVbr: true
        }, baseline);

        expect(apiMocks.updateNamedConfiguration.mock.calls[0][0].body.EncoderAppPathDisplay)
            .toBe('/fresh/runtime/ffmpeg');
    });

    it('detects a changed managed baseline before writing', async () => {
        const baseline = confirmed();
        apiMocks.getNamedConfiguration.mockResolvedValue({
            data: { ...rawTranscodingConfiguration(), H264Crf: 24 }
        });

        await expect(saveAdminTranscoding(api, {
            ...baseline,
            enableAudioVbr: true
        }, baseline)).rejects.toMatchObject({ code: 'conflict' });
        expect(apiMocks.updateNamedConfiguration).not.toHaveBeenCalled();
    });

    it('detects unknown-codec order and value conflicts without dropping them', async () => {
        const baseline = confirmed();
        apiMocks.getNamedConfiguration.mockResolvedValue({
            data: {
                ...rawTranscodingConfiguration(),
                HardwareDecodingCodecs: [ 'future-codec', 'h264', 'vc1' ]
            }
        });

        await expect(saveAdminTranscoding(api, {
            ...baseline,
            enableAudioVbr: true
        }, baseline)).rejects.toMatchObject({ code: 'conflict' });
        expect(apiMocks.updateNamedConfiguration).not.toHaveBeenCalled();
    });

    it('performs no write when editable values are unchanged', async () => {
        const baseline = confirmed();

        const result = await saveAdminTranscoding(api, baseline, baseline);

        expect(result.settings).toEqual(baseline);
        expect(apiMocks.getNamedConfiguration).toHaveBeenCalledOnce();
        expect(apiMocks.updateNamedConfiguration).not.toHaveBeenCalled();
    });

    it('validates desired values before any network request', async () => {
        const baseline = confirmed();

        await expect(saveAdminTranscoding(api, {
            ...baseline,
            h264Crf: 52
        }, baseline)).rejects.toMatchObject({ code: 'invalid-input' });
        expect(apiMocks.getNamedConfiguration).not.toHaveBeenCalled();
        expect(apiMocks.updateNamedConfiguration).not.toHaveBeenCalled();
    });

    it('sanitizes a failed write and does not return a false saved snapshot', async () => {
        apiMocks.updateNamedConfiguration.mockRejectedValue(
            new Error('/private/transcode/path and raw response')
        );
        const baseline = confirmed();

        await expect(saveAdminTranscoding(api, {
            ...baseline,
            enableThrottling: true
        }, baseline)).rejects.toMatchObject({
            code: 'save-failed',
            message: "We couldn't save Transcoding settings."
        });
    });

    it('passes cancellation through for both read and write operations', async () => {
        const canceled = { code: 'ERR_CANCELED', name: 'CanceledError' };
        apiMocks.getNamedConfiguration.mockRejectedValueOnce(canceled);
        await expect(loadAdminTranscoding(api)).rejects.toBe(canceled);

        const baseline = confirmed();
        apiMocks.getNamedConfiguration.mockResolvedValueOnce({
            data: rawTranscodingConfiguration()
        });
        apiMocks.updateNamedConfiguration.mockRejectedValueOnce(canceled);
        await expect(saveAdminTranscoding(api, {
            ...baseline,
            enableAudioVbr: true
        }, baseline)).rejects.toBe(canceled);
    });
});
