import type { EncodingOptions } from '@jellyfin/sdk/lib/generated-client/models/encoding-options';

import {
    AdminPlaybackServiceError,
    type AdminPlaybackServiceErrorCode
} from './adminPlaybackSettingsModel';

/**
 * Every editable value exposed by Jellyfin's 10.11 transcoding administrator
 * page, plus the read-only FFmpeg path needed by the native summary.
 *
 * Enum-like values intentionally remain strings. This lets a newer server or
 * plugin-provided value remain visible and survive a save even when this web
 * build does not yet have a friendly label for it.
 */
export type AdminTranscodingSettings = Readonly<{
    allowAv1Encoding: boolean;
    allowHevcEncoding: boolean;
    deinterlaceDoubleRate: boolean;
    deinterlaceMethod: string;
    downMixAudioBoost: number;
    downMixStereoAlgorithm: string;
    enableAudioVbr: boolean;
    enableDecodingColorDepth10Hevc: boolean;
    enableDecodingColorDepth10HevcRext: boolean;
    enableDecodingColorDepth10Vp9: boolean;
    enableDecodingColorDepth12HevcRext: boolean;
    enableEnhancedNvdecDecoder: boolean;
    enableFallbackFont: boolean;
    enableHardwareEncoding: boolean;
    enableIntelLowPowerH264HwEncoder: boolean;
    enableIntelLowPowerHevcHwEncoder: boolean;
    enableSegmentDeletion: boolean;
    enableSubtitleExtraction: boolean;
    enableThrottling: boolean;
    enableTonemapping: boolean;
    enableVideoToolboxTonemapping: boolean;
    enableVppTonemapping: boolean;
    encoderAppPathDisplay: string | null;
    encoderPreset: string | null;
    encodingThreadCount: number;
    fallbackFontPath: string | null;
    h264Crf: number;
    h265Crf: number;
    hardwareAccelerationType: string;
    hardwareDecodingCodecs: readonly string[];
    maxMuxingQueueSize: number;
    preferSystemNativeHwDecoder: boolean;
    qsvDevice: string | null;
    segmentKeepSeconds: number;
    throttleDelaySeconds: number;
    tonemappingAlgorithm: string;
    tonemappingDesat: number;
    tonemappingMode: string;
    tonemappingParam: number;
    tonemappingPeak: number;
    tonemappingRange: string;
    transcodingTempPath: string | null;
    vaapiDevice: string | null;
    vppTonemappingBrightness: number;
    vppTonemappingContrast: number;
}>;

/** Complete named resource retained for safe read-modify-write persistence. */
export type AdminTranscodingConfigurationDocument = EncodingOptions & Record<string, unknown>;

export type AdminTranscodingSnapshot = Readonly<{
    configuration: AdminTranscodingConfigurationDocument;
    settings: AdminTranscodingSettings;
}>;

export type AdminTranscodingServiceErrorCode = AdminPlaybackServiceErrorCode;

/** A user-safe error that never exposes paths, headers, or raw configuration. */
export class AdminTranscodingServiceError extends AdminPlaybackServiceError {
    public constructor(code: AdminTranscodingServiceErrorCode, message: string) {
        super(code, message);
        this.name = 'AdminTranscodingServiceError';
    }
}
