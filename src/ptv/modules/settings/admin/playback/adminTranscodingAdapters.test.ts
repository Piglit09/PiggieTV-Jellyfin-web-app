import { describe, expect, it } from 'vitest';

import {
    ADMIN_TRANSCODING_ENCODER_PRESETS,
    ADMIN_TRANSCODING_HARDWARE_ACCELERATION_OPTIONS,
    areAdminTranscodingSettingsEqual,
    createAdminTranscodingSnapshot,
    getAdminTranscodingCodecOptions,
    normalizeAdminTranscodingSettings,
    patchAdminTranscodingConfiguration,
    requireAdminTranscodingSettings
} from './adminTranscodingAdapters';
import type {
    AdminTranscodingConfigurationDocument,
    AdminTranscodingSettings
} from './adminTranscodingModel';
import { rawTranscodingConfiguration } from './adminTranscodingTestFixtures';

function settings(): AdminTranscodingSettings {
    return createAdminTranscodingSnapshot(rawTranscodingConfiguration()).settings;
}

const REQUIRED_BACKEND_FIELDS = [
    'AllowAv1Encoding',
    'AllowHevcEncoding',
    'DeinterlaceDoubleRate',
    'DeinterlaceMethod',
    'DownMixAudioBoost',
    'DownMixStereoAlgorithm',
    'EnableAudioVbr',
    'EnableDecodingColorDepth10Hevc',
    'EnableDecodingColorDepth10HevcRext',
    'EnableDecodingColorDepth10Vp9',
    'EnableDecodingColorDepth12HevcRext',
    'EnableEnhancedNvdecDecoder',
    'EnableFallbackFont',
    'EnableHardwareEncoding',
    'EnableIntelLowPowerH264HwEncoder',
    'EnableIntelLowPowerHevcHwEncoder',
    'EnableSegmentDeletion',
    'EnableSubtitleExtraction',
    'EnableThrottling',
    'EnableTonemapping',
    'EnableVideoToolboxTonemapping',
    'EnableVppTonemapping',
    'EncoderPreset',
    'EncodingThreadCount',
    'H264Crf',
    'H265Crf',
    'HardwareAccelerationType',
    'HardwareDecodingCodecs',
    'MaxMuxingQueueSize',
    'PreferSystemNativeHwDecoder',
    'SegmentKeepSeconds',
    'ThrottleDelaySeconds',
    'TonemappingAlgorithm',
    'TonemappingDesat',
    'TonemappingMode',
    'TonemappingParam',
    'TonemappingPeak',
    'TonemappingRange',
    'VppTonemappingBrightness',
    'VppTonemappingContrast'
] as const;

const NULLABLE_PATH_BACKEND_FIELDS = [
    'EncoderAppPathDisplay',
    'FallbackFontPath',
    'QsvDevice',
    'TranscodingTempPath',
    'VaapiDevice'
] as const;

describe('administrator Transcoding adapters', () => {
    it('normalizes every visible legacy value and retains the complete document', () => {
        const raw = rawTranscodingConfiguration();
        const snapshot = createAdminTranscodingSnapshot(raw);

        expect(snapshot.configuration).toBe(raw);
        expect(snapshot.settings).toMatchObject({
            encoderAppPathDisplay: '/usr/lib/jellyfin-ffmpeg/ffmpeg',
            hardwareAccelerationType: 'none',
            hardwareDecodingCodecs: [ 'h264', 'vc1', 'future-codec' ],
            tonemappingParam: 0,
            transcodingTempPath: null
        });
        expect(Object.keys(snapshot.settings)).toHaveLength(45);
    });

    it.each(REQUIRED_BACKEND_FIELDS)('fails closed when %s is absent', field => {
        const raw = rawTranscodingConfiguration();
        delete raw[field];

        expect(() => normalizeAdminTranscodingSettings(raw)).toThrowError(
            expect.objectContaining({ code: 'invalid-response' })
        );
    });

    it('preserves null path and encoder-preset sentinel states', () => {
        const raw = {
            ...rawTranscodingConfiguration(),
            EncoderAppPathDisplay: null,
            EncoderPreset: null,
            FallbackFontPath: null,
            QsvDevice: null,
            TranscodingTempPath: null,
            VaapiDevice: null
        };

        expect(normalizeAdminTranscodingSettings(raw)).toMatchObject({
            encoderAppPathDisplay: null,
            encoderPreset: null,
            fallbackFontPath: null,
            qsvDevice: null,
            transcodingTempPath: null,
            vaapiDevice: null
        });
    });

    it('accepts omitted nullable path fields from the Jellyfin JSON contract', () => {
        const raw = rawTranscodingConfiguration();
        NULLABLE_PATH_BACKEND_FIELDS.forEach(field => {
            delete raw[field];
        });

        expect(normalizeAdminTranscodingSettings(raw)).toMatchObject({
            encoderAppPathDisplay: null,
            fallbackFontPath: null,
            qsvDevice: null,
            transcodingTempPath: null,
            vaapiDevice: null
        });
    });

    it('does not add omitted nullable paths while saving an unrelated setting', () => {
        const raw = rawTranscodingConfiguration();
        NULLABLE_PATH_BACKEND_FIELDS.forEach(field => {
            delete raw[field];
        });
        const desired = {
            ...normalizeAdminTranscodingSettings(raw),
            enableAudioVbr: true
        };

        const patched = patchAdminTranscodingConfiguration(raw, desired);

        expect(patched.EnableAudioVbr).toBe(true);
        NULLABLE_PATH_BACKEND_FIELDS.forEach(field => {
            expect(Object.prototype.hasOwnProperty.call(patched, field)).toBe(false);
        });
    });

    it('keeps unknown enum and codec values instead of coercing or deleting them', () => {
        const normalized = normalizeAdminTranscodingSettings({
            ...rawTranscodingConfiguration(),
            EncoderPreset: 'future-preset',
            HardwareAccelerationType: 'future-hardware',
            HardwareDecodingCodecs: [ 'h264', 'future-codec' ],
            TonemappingAlgorithm: 'future-tonemap'
        });

        expect(normalized.encoderPreset).toBe('future-preset');
        expect(normalized.hardwareAccelerationType).toBe('future-hardware');
        expect(normalized.hardwareDecodingCodecs).toEqual([ 'h264', 'future-codec' ]);
        expect(normalized.tonemappingAlgorithm).toBe('future-tonemap');
    });

    it('derives hardware values from the SDK and codecs from the retained compatibility matrix', () => {
        expect(ADMIN_TRANSCODING_HARDWARE_ACCELERATION_OPTIONS.map(option => option.value)).toEqual([
            'none', 'amf', 'qsv', 'nvenc', 'v4l2m2m', 'vaapi', 'videotoolbox', 'rkmpp'
        ]);
        expect(getAdminTranscodingCodecOptions('v4l2m2m')).toEqual([
            { label: 'H264', value: 'h264' }
        ]);
        expect(getAdminTranscodingCodecOptions('future-hardware')).toEqual([]);
        expect(ADMIN_TRANSCODING_ENCODER_PRESETS).not.toContain('placebo');
    });

    it('compares every editable field while treating codecs as an unordered set', () => {
        const baseline = settings();
        expect(areAdminTranscodingSettingsEqual(baseline, { ...baseline })).toBe(true);
        expect(areAdminTranscodingSettingsEqual(baseline, {
            ...baseline,
            enableThrottling: true
        })).toBe(false);
        expect(areAdminTranscodingSettingsEqual(baseline, {
            ...baseline,
            hardwareDecodingCodecs: [ 'vc1', 'h264', 'future-codec' ]
        })).toBe(true);
        expect(areAdminTranscodingSettingsEqual(baseline, {
            ...baseline,
            hardwareDecodingCodecs: [ 'future-codec', 'h264', 'vc1', 'h264' ]
        })).toBe(true);
        expect(areAdminTranscodingSettingsEqual(baseline, {
            ...baseline,
            hardwareDecodingCodecs: [ 'vc1', 'h264', 'av1' ]
        })).toBe(false);
    });

    it('does not treat the read-only FFmpeg display path as an editable conflict', () => {
        const baseline = settings();
        expect(areAdminTranscodingSettingsEqual(baseline, {
            ...baseline,
            encoderAppPathDisplay: '/new/runtime/path'
        })).toBe(true);
    });

    it('deep-clones the authoritative resource and patches only changed owned values', () => {
        const nested = { plugin: { mode: 'preserve' } };
        const raw: AdminTranscodingConfigurationDocument = {
            ...rawTranscodingConfiguration(),
            EncoderAppPath: '/protected/encoder',
            FutureNested: nested
        };
        const desired: AdminTranscodingSettings = {
            ...normalizeAdminTranscodingSettings(raw),
            enableThrottling: true,
            hardwareDecodingCodecs: [ 'h264', 'future-codec' ],
            transcodingTempPath: '/new/transcodes'
        };

        const patched = patchAdminTranscodingConfiguration(raw, desired);

        expect(patched).not.toBe(raw);
        expect(patched.FutureNested).not.toBe(nested);
        expect(patched.FutureNested).toEqual(nested);
        expect(patched.EncoderAppPath).toBe('/protected/encoder');
        expect(patched.EncoderAppPathDisplay).toBe('/usr/lib/jellyfin-ffmpeg/ffmpeg');
        expect(patched.AllowOnDemandMetadataBasedKeyframeExtractionForExtensions).toEqual([ 'mkv' ]);
        expect(patched.EnableThrottling).toBe(true);
        expect(patched.TranscodingTempPath).toBe('/new/transcodes');
        expect(patched.HardwareDecodingCodecs).toEqual([ 'h264', 'future-codec' ]);
        expect(raw.EnableThrottling).toBe(false);
        expect(raw.TranscodingTempPath).toBeNull();
    });

    it('preserves authoritative codec order when only another setting changes', () => {
        const raw = {
            ...rawTranscodingConfiguration(),
            HardwareDecodingCodecs: [ 'future-codec', 'vc1', 'h264' ]
        };
        const desired = {
            ...normalizeAdminTranscodingSettings(rawTranscodingConfiguration()),
            enableThrottling: true
        };

        const patched = patchAdminTranscodingConfiguration(raw, desired);

        expect(patched.HardwareDecodingCodecs).toEqual([ 'future-codec', 'vc1', 'h264' ]);
        expect(patched.EnableThrottling).toBe(true);
    });

    it('never writes the read-only FFmpeg display path', () => {
        const raw = rawTranscodingConfiguration();
        const desired = {
            ...settings(),
            encoderAppPathDisplay: '/attempted/change',
            enableAudioVbr: true
        };

        const patched = patchAdminTranscodingConfiguration(raw, desired);

        expect(patched.EncoderAppPathDisplay).toBe('/usr/lib/jellyfin-ffmpeg/ffmpeg');
        expect(patched.EnableAudioVbr).toBe(true);
    });

    it.each([
        [ 'downMixAudioBoost', 0.49 ],
        [ 'downMixAudioBoost', 3.01 ],
        [ 'encodingThreadCount', -2 ],
        [ 'encodingThreadCount', 17 ],
        [ 'h264Crf', -1 ],
        [ 'h265Crf', 52 ],
        [ 'maxMuxingQueueSize', 2_147_483_648 ],
        [ 'segmentKeepSeconds', 9 ],
        [ 'segmentKeepSeconds', 3_601 ],
        [ 'throttleDelaySeconds', 9 ],
        [ 'tonemappingDesat', -0.1 ],
        [ 'vppTonemappingBrightness', 101 ],
        [ 'vppTonemappingContrast', 0.99 ],
        [ 'vppTonemappingContrast', 2.01 ]
    ] as const)('rejects invalid %s value %s', (field, value) => {
        expect(() => requireAdminTranscodingSettings({
            ...settings(),
            [field]: value
        })).toThrowError(expect.objectContaining({ code: 'invalid-input' }));
    });

    it.each([
        [ 'downMixAudioBoost', 0.5 ],
        [ 'downMixAudioBoost', 3 ],
        [ 'encodingThreadCount', -1 ],
        [ 'encodingThreadCount', 0 ],
        [ 'encodingThreadCount', 16 ],
        [ 'h264Crf', 0 ],
        [ 'h265Crf', 51 ],
        [ 'maxMuxingQueueSize', -2_147_483_648 ],
        [ 'maxMuxingQueueSize', 2_147_483_647 ],
        [ 'segmentKeepSeconds', 10 ],
        [ 'throttleDelaySeconds', 3_600 ],
        [ 'vppTonemappingBrightness', 100 ],
        [ 'vppTonemappingContrast', 1 ],
        [ 'vppTonemappingContrast', 2 ]
    ] as const)('accepts boundary %s value %s', (field, value) => {
        expect(() => requireAdminTranscodingSettings({
            ...settings(),
            [field]: value
        })).not.toThrow();
    });

    it('rejects malformed types without manufacturing defaults', () => {
        expect(() => normalizeAdminTranscodingSettings({
            ...rawTranscodingConfiguration(),
            EnableThrottling: undefined
        })).toThrowError(expect.objectContaining({ code: 'invalid-response' }));
        expect(() => normalizeAdminTranscodingSettings({
            ...rawTranscodingConfiguration(),
            TonemappingParam: '0'
        })).toThrowError(expect.objectContaining({ code: 'invalid-response' }));
        expect(() => normalizeAdminTranscodingSettings({
            ...rawTranscodingConfiguration(),
            HardwareDecodingCodecs: null
        })).toThrowError(expect.objectContaining({ code: 'invalid-response' }));
    });
});
