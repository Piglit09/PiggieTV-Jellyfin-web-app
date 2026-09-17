import { ProcessPriorityClass } from '@jellyfin/sdk/lib/generated-client/models/process-priority-class';
import type { ServerConfiguration } from '@jellyfin/sdk/lib/generated-client/models/server-configuration';
import { TrickplayScanBehavior } from '@jellyfin/sdk/lib/generated-client/models/trickplay-scan-behavior';
import { describe, expect, it } from 'vitest';

import {
    adminStreamingFormToSettings,
    adminStreamingSettingsToForm,
    areAdminResumeSettingsEqual,
    areAdminStreamingSettingsEqual,
    areAdminTrickplaySettingsEqual,
    normalizeAdminResumeSettings,
    normalizeAdminStreamingSettings,
    normalizeAdminTrickplaySettings,
    patchAdminResumeConfiguration,
    patchAdminStreamingConfiguration,
    patchAdminTrickplayConfiguration,
    requireAdminResumeSettings,
    requireAdminTrickplaySettings
} from './adminPlaybackSettingsAdapters';
import type {
    AdminResumeSettings,
    AdminStreamingSettings,
    AdminTrickplaySettings
} from './adminPlaybackSettingsModel';

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

describe('administrator Playback settings adapters', () => {
    it('normalizes each section from its exact global server fields', () => {
        const raw = rawConfiguration();

        expect(normalizeAdminStreamingSettings(raw)).toEqual(streaming);
        expect(normalizeAdminResumeSettings(raw)).toEqual(resume);
        expect(normalizeAdminTrickplaySettings(raw)).toEqual(trickplay);
    });

    it('converts decimal Mbps to integer bits per second without mixing byte units', () => {
        expect(adminStreamingFormToSettings({ remoteBitrateLimitMbps: 12.25 })).toEqual({
            remoteBitrateLimitBitsPerSecond: 12_250_000
        });
        expect(adminStreamingSettingsToForm({
            remoteBitrateLimitBitsPerSecond: 12_250_000
        })).toEqual({ remoteBitrateLimitMbps: 12.25 });
    });

    it('preserves the Jellyfin zero sentinel as Unlimited', () => {
        expect(adminStreamingFormToSettings({ remoteBitrateLimitMbps: 0 })).toEqual({
            remoteBitrateLimitBitsPerSecond: 0
        });
        expect(adminStreamingSettingsToForm({
            remoteBitrateLimitBitsPerSecond: 0
        })).toEqual({ remoteBitrateLimitMbps: 0 });
    });

    it.each([ -1, Number.NaN, Number.POSITIVE_INFINITY, 2_148 ])(
        'rejects invalid or out-of-range Mbps value %s',
        value => {
            expect(() => adminStreamingFormToSettings({
                remoteBitrateLimitMbps: value
            })).toThrowError(expect.objectContaining({ code: 'invalid-input' }));
        }
    );

    it.each([
        [ 'RemoteClientBitrateLimit', undefined ],
        [ 'RemoteClientBitrateLimit', -1 ],
        [ 'RemoteClientBitrateLimit', 1.5 ]
    ])('fails closed on malformed Streaming %s=%s', (field, value) => {
        expect(() => normalizeAdminStreamingSettings({
            ...rawConfiguration(),
            [field]: value
        })).toThrowError(expect.objectContaining({ code: 'invalid-response' }));
    });

    it.each([
        'MinResumePct',
        'MaxResumePct',
        'MinResumeDurationSeconds',
        'MinAudiobookResume',
        'MaxAudiobookResume'
    ] as const)('fails closed when Resume field %s is absent', field => {
        const raw = rawConfiguration() as Record<string, unknown>;
        delete raw[field];

        expect(() => normalizeAdminResumeSettings(raw as ServerConfiguration))
            .toThrowError(expect.objectContaining({ code: 'invalid-response' }));
    });

    it('accepts all Resume zero sentinels returned by Jellyfin', () => {
        expect(normalizeAdminResumeSettings({
            ...rawConfiguration(),
            MaxAudiobookResume: 0,
            MinAudiobookResume: 0,
            MinResumeDurationSeconds: 0,
            MinResumePct: 0
        })).toMatchObject({
            audiobookCompletionRemainingMinutes: 0,
            audiobookMinimumElapsedMinutes: 0,
            minimumEligibleDurationSeconds: 0,
            minimumResumePercentage: 0
        });
    });

    it('requires the edited minimum Resume percentage to remain below maximum', () => {
        expect(() => requireAdminResumeSettings({
            ...resume,
            minimumResumePercentage: 90
        })).toThrowError(expect.objectContaining({ code: 'invalid-input' }));
        expect(() => requireAdminResumeSettings({
            ...resume,
            minimumResumePercentage: 91
        })).toThrowError(expect.objectContaining({ code: 'invalid-input' }));
    });

    it.each([
        [ 'EnableHwAcceleration', undefined ],
        [ 'ScanBehavior', 'FutureBehavior' ],
        [ 'ProcessPriority', 'FuturePriority' ],
        [ 'Interval', 999 ],
        [ 'WidthResolutions', [] ],
        [ 'WidthResolutions', [ 0 ] ],
        [ 'TileWidth', 0 ],
        [ 'TileHeight', 0 ],
        [ 'Qscale', 1 ],
        [ 'Qscale', 32 ],
        [ 'JpegQuality', 0 ],
        [ 'JpegQuality', 101 ],
        [ 'ProcessThreads', -1 ]
    ])('fails closed on malformed Trickplay %s=%j', (field, value) => {
        expect(() => normalizeAdminTrickplaySettings({
            ...rawConfiguration(),
            TrickplayOptions: {
                ...rawConfiguration().TrickplayOptions,
                [field]: value
            }
        })).toThrowError(expect.objectContaining({ code: 'invalid-response' }));
    });

    it('accepts operational Trickplay boundaries and zero auto-thread sentinel', () => {
        const boundary = {
            ...trickplay,
            imageIntervalMilliseconds: 1_000,
            jpegQuality: 1,
            processThreads: 0,
            qscale: 31,
            tileHeight: 1,
            tileWidth: 1
        };

        expect(requireAdminTrickplaySettings(boundary)).toBe(boundary);
    });

    it('compares only managed fields including ordered Trickplay widths', () => {
        expect(areAdminStreamingSettingsEqual(streaming, { ...streaming })).toBe(true);
        expect(areAdminResumeSettingsEqual(resume, { ...resume })).toBe(true);
        expect(areAdminTrickplaySettingsEqual(trickplay, { ...trickplay })).toBe(true);
        expect(areAdminTrickplaySettingsEqual(trickplay, {
            ...trickplay,
            widthResolutionsPixels: [ 640, 320 ]
        })).toBe(false);
    });

    it('deep-clones Streaming and patches only its owned field', () => {
        const raw = {
            ...rawConfiguration(),
            FutureField: { nested: [ 'preserve' ] }
        } as ServerConfiguration;
        const patched = patchAdminStreamingConfiguration(raw, {
            remoteBitrateLimitBitsPerSecond: 0
        });

        expect(patched).not.toBe(raw);
        expect(patched.RemoteClientBitrateLimit).toBe(0);
        expect(Reflect.get(patched, 'FutureField')).toEqual({ nested: [ 'preserve' ] });
        expect(Reflect.get(patched, 'FutureField')).not.toBe(Reflect.get(raw, 'FutureField'));
        expect(patched.MinResumePct).toBe(raw.MinResumePct);
    });

    it('patches only Resume-owned fields and preserves unrelated nested data', () => {
        const raw = {
            ...rawConfiguration(),
            FutureField: { plugin: true }
        } as ServerConfiguration;
        const desired = { ...resume, minimumEligibleDurationSeconds: 600 };
        const patched = patchAdminResumeConfiguration(raw, desired);

        expect(patched.MinResumeDurationSeconds).toBe(600);
        expect(patched.RemoteClientBitrateLimit).toBe(raw.RemoteClientBitrateLimit);
        expect(patched.TrickplayOptions).toEqual(raw.TrickplayOptions);
        expect(Reflect.get(patched, 'FutureField')).toEqual({ plugin: true });
    });

    it('patches only Trickplay-owned nested fields while retaining future fields', () => {
        const raw = {
            ...rawConfiguration(),
            TrickplayOptions: {
                ...rawConfiguration().TrickplayOptions,
                FutureTrickplayOption: { preserve: true }
            }
        } as ServerConfiguration;
        const desired = {
            ...trickplay,
            enableHardwareDecoding: true,
            widthResolutionsPixels: [ 320, 640 ]
        };
        const patched = patchAdminTrickplayConfiguration(raw, desired);

        expect(patched.TrickplayOptions?.EnableHwAcceleration).toBe(true);
        expect(patched.TrickplayOptions?.WidthResolutions).toEqual([ 320, 640 ]);
        expect(Reflect.get(patched.TrickplayOptions!, 'FutureTrickplayOption'))
            .toEqual({ preserve: true });
        expect(raw.TrickplayOptions?.EnableHwAcceleration).toBe(false);
        expect(patched.MinResumePct).toBe(raw.MinResumePct);
    });
});
