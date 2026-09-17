import type { Api } from '@jellyfin/sdk';
import { ProcessPriorityClass } from '@jellyfin/sdk/lib/generated-client/models/process-priority-class';
import type { ServerConfiguration } from '@jellyfin/sdk/lib/generated-client/models/server-configuration';
import { TrickplayScanBehavior } from '@jellyfin/sdk/lib/generated-client/models/trickplay-scan-behavior';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
    getConfiguration: vi.fn(),
    updateConfiguration: vi.fn()
}));

vi.mock('@jellyfin/sdk/lib/utils/api/configuration-api', () => ({
    getConfigurationApi: () => ({
        getConfiguration: apiMocks.getConfiguration,
        updateConfiguration: apiMocks.updateConfiguration
    })
}));

import {
    loadAdminResume,
    loadAdminStreaming,
    loadAdminTrickplay,
    saveAdminResume,
    saveAdminStreaming,
    saveAdminTrickplay
} from './adminPlaybackSettingsService';
import type {
    AdminResumeSettings,
    AdminStreamingSettings,
    AdminTrickplaySettings
} from './adminPlaybackSettingsModel';

const api = {} as Api;

function rawConfiguration(): ServerConfiguration {
    return {
        MaxAudiobookResume: 5,
        MaxResumePct: 90,
        MinAudiobookResume: 5,
        MinResumeDurationSeconds: 300,
        MinResumePct: 5,
        RemoteClientBitrateLimit: 10_000_000,
        TrickplayOptions: {
            EnableHwAcceleration: false,
            EnableHwEncoding: false,
            EnableKeyFrameOnlyExtraction: false,
            Interval: 10_000,
            JpegQuality: 90,
            ProcessPriority: ProcessPriorityClass.BelowNormal,
            ProcessThreads: 1,
            Qscale: 4,
            ScanBehavior: TrickplayScanBehavior.NonBlocking,
            TileHeight: 10,
            TileWidth: 10,
            WidthResolutions: [ 320 ]
        }
    };
}

const streaming: AdminStreamingSettings = {
    remoteBitrateLimitBitsPerSecond: 10_000_000
};
const resume: AdminResumeSettings = {
    audiobookCompletionRemainingMinutes: 5,
    audiobookMinimumElapsedMinutes: 5,
    maximumResumePercentage: 90,
    minimumEligibleDurationSeconds: 300,
    minimumResumePercentage: 5
};
const trickplay: AdminTrickplaySettings = {
    enableHardwareDecoding: false,
    enableHardwareEncoding: false,
    enableKeyFrameOnlyExtraction: false,
    imageIntervalMilliseconds: 10_000,
    jpegQuality: 90,
    processPriority: ProcessPriorityClass.BelowNormal,
    processThreads: 1,
    qscale: 4,
    scanBehavior: TrickplayScanBehavior.NonBlocking,
    tileHeight: 10,
    tileWidth: 10,
    widthResolutionsPixels: [ 320 ]
};

describe('administrator Playback settings service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiMocks.getConfiguration.mockResolvedValue({ data: rawConfiguration() });
        apiMocks.updateConfiguration.mockResolvedValue({});
    });

    it('loads each section with exactly one authoritative GET and an AbortSignal', async () => {
        // eslint-disable-next-line compat/compat
        const controller = new AbortController();

        expect((await loadAdminStreaming(api, controller.signal)).settings).toEqual(streaming);
        expect((await loadAdminResume(api, controller.signal)).settings).toEqual(resume);
        expect((await loadAdminTrickplay(api, controller.signal)).settings).toEqual(trickplay);

        expect(apiMocks.getConfiguration).toHaveBeenCalledTimes(3);
        expect(apiMocks.getConfiguration).toHaveBeenNthCalledWith(1, { signal: controller.signal });
        expect(apiMocks.getConfiguration).toHaveBeenNthCalledWith(2, { signal: controller.signal });
        expect(apiMocks.getConfiguration).toHaveBeenNthCalledWith(3, { signal: controller.signal });
        expect(apiMocks.updateConfiguration).not.toHaveBeenCalled();
    });

    it.each([
        [ 'Streaming', loadAdminStreaming ],
        [ 'Resume', loadAdminResume ],
        [ 'Trickplay', loadAdminTrickplay ]
    ] as const)('sanitizes %s transport failures', async (section, load) => {
        apiMocks.getConfiguration.mockRejectedValue(new Error('token and raw server data'));

        await expect(load(api)).rejects.toMatchObject({
            code: 'load-unavailable',
            message: `${section} settings could not be loaded.`
        });
    });

    it('preserves an ordinary Error named AbortError', async () => {
        const aborted = Object.assign(new Error('request aborted'), { name: 'AbortError' });
        apiMocks.getConfiguration.mockRejectedValueOnce(aborted);

        await expect(loadAdminStreaming(api)).rejects.toBe(aborted);
    });

    it('fails closed on missing required values without writing', async () => {
        apiMocks.getConfiguration.mockResolvedValue({
            data: { ...rawConfiguration(), RemoteClientBitrateLimit: undefined }
        });

        await expect(loadAdminStreaming(api)).rejects.toMatchObject({ code: 'invalid-response' });
        expect(apiMocks.updateConfiguration).not.toHaveBeenCalled();
    });

    it('refetches authority, safely saves Streaming only, and verifies the write', async () => {
        const future = { nested: [ 'preserved' ] };
        const authoritative = { ...rawConfiguration(), FutureField: future };
        apiMocks.getConfiguration
            .mockResolvedValueOnce({ data: authoritative })
            .mockResolvedValueOnce({
                data: { ...authoritative, RemoteClientBitrateLimit: 0 }
            });

        const saved = await saveAdminStreaming(api, {
            remoteBitrateLimitBitsPerSecond: 0
        }, streaming);

        expect(apiMocks.getConfiguration).toHaveBeenCalledTimes(2);
        expect(apiMocks.updateConfiguration).toHaveBeenCalledOnce();
        const outgoing = apiMocks.updateConfiguration.mock.calls[0][0]
            .serverConfiguration as ServerConfiguration;
        expect(outgoing.RemoteClientBitrateLimit).toBe(0);
        expect(outgoing.MinResumePct).toBe(5);
        expect(Reflect.get(outgoing, 'FutureField')).toEqual(future);
        expect(saved.settings.remoteBitrateLimitBitsPerSecond).toBe(0);
    });

    it('refetches authority, safely saves Resume only, and verifies the write', async () => {
        const desired = { ...resume, minimumEligibleDurationSeconds: 600 };
        apiMocks.getConfiguration
            .mockResolvedValueOnce({ data: rawConfiguration() })
            .mockResolvedValueOnce({
                data: { ...rawConfiguration(), MinResumeDurationSeconds: 600 }
            });

        const saved = await saveAdminResume(api, desired, resume);

        const outgoing = apiMocks.updateConfiguration.mock.calls[0][0]
            .serverConfiguration as ServerConfiguration;
        expect(outgoing.MinResumeDurationSeconds).toBe(600);
        expect(outgoing.RemoteClientBitrateLimit).toBe(10_000_000);
        expect(outgoing.TrickplayOptions).toEqual(rawConfiguration().TrickplayOptions);
        expect(saved.settings).toEqual(desired);
    });

    it('refetches authority, safely saves Trickplay only, and verifies the write', async () => {
        const authoritative = {
            ...rawConfiguration(),
            TrickplayOptions: {
                ...rawConfiguration().TrickplayOptions,
                PluginFutureField: { retained: true }
            }
        };
        const desired = {
            ...trickplay,
            enableHardwareEncoding: true,
            imageIntervalMilliseconds: 20_000
        };
        apiMocks.getConfiguration
            .mockResolvedValueOnce({ data: authoritative })
            .mockResolvedValueOnce({
                data: {
                    ...authoritative,
                    TrickplayOptions: {
                        ...authoritative.TrickplayOptions,
                        EnableHwEncoding: true,
                        Interval: 20_000
                    }
                }
            });

        const saved = await saveAdminTrickplay(api, desired, trickplay);

        const outgoing = apiMocks.updateConfiguration.mock.calls[0][0]
            .serverConfiguration as ServerConfiguration;
        expect(outgoing.TrickplayOptions?.EnableHwEncoding).toBe(true);
        expect(outgoing.TrickplayOptions?.Interval).toBe(20_000);
        expect(Reflect.get(outgoing.TrickplayOptions!, 'PluginFutureField'))
            .toEqual({ retained: true });
        expect(outgoing.RemoteClientBitrateLimit).toBe(10_000_000);
        expect(saved.settings).toEqual(desired);
    });

    it.each([
        [ 'Streaming', saveAdminStreaming, streaming, { ...streaming, remoteBitrateLimitBitsPerSecond: 20_000_000 } ],
        [ 'Resume', saveAdminResume, resume, { ...resume, minimumEligibleDurationSeconds: 600 } ],
        [ 'Trickplay', saveAdminTrickplay, trickplay, { ...trickplay, processThreads: 2 } ]
    ] as const)('does not POST when fresh %s values already match the desired state', async (
        _section,
        save,
        confirmed,
        desired
    ) => {
        const raw = rawConfiguration();
        if ('remoteBitrateLimitBitsPerSecond' in desired) {
            raw.RemoteClientBitrateLimit = desired.remoteBitrateLimitBitsPerSecond;
        } else if ('minimumEligibleDurationSeconds' in desired) {
            raw.MinResumeDurationSeconds = desired.minimumEligibleDurationSeconds;
        } else {
            raw.TrickplayOptions!.ProcessThreads = desired.processThreads;
        }
        apiMocks.getConfiguration.mockResolvedValue({ data: raw });

        // The fresh source differs from the old confirmed baseline, so this is
        // correctly a conflict even when it happens to equal the desired form.
        await expect((save as typeof saveAdminStreaming)(
            api,
            desired as AdminStreamingSettings,
            confirmed as AdminStreamingSettings
        )).rejects.toMatchObject({ code: 'conflict' });
        expect(apiMocks.updateConfiguration).not.toHaveBeenCalled();
    });

    it('performs no POST when confirmed, desired and fresh Streaming agree', async () => {
        const saved = await saveAdminStreaming(api, streaming, streaming);

        expect(saved.settings).toEqual(streaming);
        expect(apiMocks.updateConfiguration).not.toHaveBeenCalled();
    });

    it('detects a section-managed conflict before writing', async () => {
        apiMocks.getConfiguration.mockResolvedValue({
            data: { ...rawConfiguration(), MinResumePct: 10 }
        });

        await expect(saveAdminResume(api, {
            ...resume,
            minimumEligibleDurationSeconds: 600
        }, resume)).rejects.toMatchObject({
            code: 'conflict',
            message: 'These settings changed on the server while you were editing. Reload before saving.'
        });
        expect(apiMocks.updateConfiguration).not.toHaveBeenCalled();
    });

    it('ignores unrelated fresh changes during managed-field conflict comparison', async () => {
        const authoritative = { ...rawConfiguration(), ServerName: 'Changed elsewhere' };
        apiMocks.getConfiguration
            .mockResolvedValueOnce({ data: authoritative })
            .mockResolvedValueOnce({
                data: { ...authoritative, RemoteClientBitrateLimit: 20_000_000 }
            });

        await expect(saveAdminStreaming(api, {
            remoteBitrateLimitBitsPerSecond: 20_000_000
        }, streaming)).resolves.toMatchObject({
            settings: { remoteBitrateLimitBitsPerSecond: 20_000_000 }
        });
        const outgoing = apiMocks.updateConfiguration.mock.calls[0][0]
            .serverConfiguration as ServerConfiguration;
        expect(outgoing.ServerName).toBe('Changed elsewhere');
    });

    it('rejects a post-write managed-value mismatch instead of publishing it as success', async () => {
        apiMocks.getConfiguration
            .mockResolvedValueOnce({ data: rawConfiguration() })
            .mockResolvedValueOnce({
                data: {
                    ...rawConfiguration(),
                    RemoteClientBitrateLimit: 19_000_000,
                    ServerName: 'Normalized by server'
                }
            });

        await expect(saveAdminStreaming(api, {
            remoteBitrateLimitBitsPerSecond: 20_000_000
        }, streaming)).rejects.toMatchObject({
            code: 'save-unverified',
            message: 'Streaming settings were saved, but the latest server values did not match the requested settings. Reload before saving again.'
        });

        expect(apiMocks.updateConfiguration.mock.calls[0][0]
            .serverConfiguration.RemoteClientBitrateLimit).toBe(20_000_000);
    });

    it.each([
        [ 'Streaming', saveAdminStreaming, streaming, { ...streaming, remoteBitrateLimitBitsPerSecond: 20_000_000 } ],
        [ 'Resume', saveAdminResume, resume, { ...resume, minimumEligibleDurationSeconds: 600 } ],
        [ 'Trickplay', saveAdminTrickplay, trickplay, { ...trickplay, processThreads: 2 } ]
    ] as const)('returns a user-safe %s save failure', async (section, save, confirmed, desired) => {
        apiMocks.updateConfiguration.mockRejectedValue(new Error('raw config containing paths'));

        await expect((save as typeof saveAdminStreaming)(
            api,
            desired as AdminStreamingSettings,
            confirmed as AdminStreamingSettings
        )).rejects.toMatchObject({
            code: 'save-failed',
            message: `We couldn't save ${section} settings.`
        });
    });

    it.each([
        [ 'Streaming', saveAdminStreaming, streaming, { ...streaming, remoteBitrateLimitBitsPerSecond: 20_000_000 } ],
        [ 'Resume', saveAdminResume, resume, { ...resume, minimumEligibleDurationSeconds: 600 } ],
        [ 'Trickplay', saveAdminTrickplay, trickplay, { ...trickplay, processThreads: 2 } ]
    ] as const)('returns a user-safe %s verification failure after a successful write', async (
        section,
        save,
        confirmed,
        desired
    ) => {
        apiMocks.getConfiguration
            .mockResolvedValueOnce({ data: rawConfiguration() })
            .mockRejectedValueOnce(new Error('raw response containing private values'));

        await expect((save as typeof saveAdminStreaming)(
            api,
            desired as AdminStreamingSettings,
            confirmed as AdminStreamingSettings
        )).rejects.toMatchObject({
            code: 'save-unverified',
            message: `${section} settings were saved, but the latest server values could not be verified. Reload before saving again.`
        });
        expect(apiMocks.updateConfiguration).toHaveBeenCalledOnce();
    });

    it('passes AbortSignal to the authoritative reads and POST', async () => {
        // eslint-disable-next-line compat/compat
        const controller = new AbortController();
        apiMocks.getConfiguration
            .mockResolvedValueOnce({ data: rawConfiguration() })
            .mockResolvedValueOnce({
                data: {
                    ...rawConfiguration(),
                    TrickplayOptions: {
                        ...rawConfiguration().TrickplayOptions,
                        ProcessThreads: 2
                    }
                }
            });

        await saveAdminTrickplay(api, {
            ...trickplay,
            processThreads: 2
        }, trickplay, controller.signal);

        expect(apiMocks.getConfiguration).toHaveBeenCalledTimes(2);
        expect(apiMocks.getConfiguration).toHaveBeenNthCalledWith(1, { signal: controller.signal });
        expect(apiMocks.getConfiguration).toHaveBeenNthCalledWith(2, { signal: controller.signal });
        expect(apiMocks.updateConfiguration).toHaveBeenCalledWith(
            expect.objectContaining({ serverConfiguration: expect.any(Object) }),
            { signal: controller.signal }
        );
    });

    it('preserves cancellation from the post-write authoritative readback', async () => {
        const canceled = { code: 'ERR_CANCELED', name: 'CanceledError' };
        apiMocks.getConfiguration
            .mockResolvedValueOnce({ data: rawConfiguration() })
            .mockRejectedValueOnce(canceled);

        await expect(saveAdminStreaming(api, {
            remoteBitrateLimitBitsPerSecond: 20_000_000
        }, streaming)).rejects.toBe(canceled);
        expect(apiMocks.updateConfiguration).toHaveBeenCalledOnce();
    });
});
