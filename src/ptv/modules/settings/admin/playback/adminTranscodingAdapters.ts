import { HardwareAccelerationType } from '@jellyfin/sdk/lib/generated-client/models/hardware-acceleration-type';

import { CODECS } from 'apps/dashboard/features/playback/constants/codecs';

import {
    AdminTranscodingServiceError,
    type AdminTranscodingConfigurationDocument,
    type AdminTranscodingSettings,
    type AdminTranscodingSnapshot
} from './adminTranscodingModel';

const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

/** Values supported by the authoritative Jellyfin 10.11 SDK enum. */
export const ADMIN_TRANSCODING_HARDWARE_ACCELERATION_OPTIONS = [
    { label: 'None', value: HardwareAccelerationType.None },
    { label: 'AMD AMF', value: HardwareAccelerationType.Amf },
    { label: 'Intel Quick Sync (QSV)', value: HardwareAccelerationType.Qsv },
    { label: 'NVIDIA NVENC', value: HardwareAccelerationType.Nvenc },
    { label: 'Video4Linux2 (V4L2)', value: HardwareAccelerationType.V4l2m2m },
    { label: 'Video Acceleration API (VAAPI)', value: HardwareAccelerationType.Vaapi },
    { label: 'Apple VideoToolbox', value: HardwareAccelerationType.Videotoolbox },
    { label: 'Rockchip MPP (RKMPP)', value: HardwareAccelerationType.Rkmpp }
] as const;

/** Values deliberately presented by the retained Jellyfin administrator UI. */
export const ADMIN_TRANSCODING_ENCODER_PRESETS = [
    'auto',
    'veryslow',
    'slower',
    'slow',
    'medium',
    'fast',
    'faster',
    'veryfast',
    'superfast',
    'ultrafast'
] as const;

export const ADMIN_TRANSCODING_TONEMAPPING_ALGORITHMS = [
    'none',
    'clip',
    'linear',
    'gamma',
    'reinhard',
    'hable',
    'mobius',
    'bt2390'
] as const;

export const ADMIN_TRANSCODING_TONEMAPPING_MODES = [
    'auto',
    'max',
    'rgb',
    'lum',
    'itp'
] as const;

export const ADMIN_TRANSCODING_TONEMAPPING_RANGES = [ 'auto', 'tv', 'pc' ] as const;
export const ADMIN_TRANSCODING_DEINTERLACE_METHODS = [ 'yadif', 'bwdif' ] as const;
export const ADMIN_TRANSCODING_DOWNMIX_ALGORITHMS = [
    'None',
    'Dave750',
    'NightmodeDialogue',
    'Rfc7845',
    'Ac4'
] as const;

/** Uses Jellyfin Web's compatibility matrix; it is not browser hardware detection. */
export function getAdminTranscodingCodecOptions(hardwareAccelerationType: string) {
    return CODECS
        .filter(codec => codec.types.includes(hardwareAccelerationType))
        .map(codec => ({ label: codec.name, value: codec.codec }));
}

function invalidResponse(): never {
    throw new AdminTranscodingServiceError(
        'invalid-response',
        'Transcoding settings are unavailable.'
    );
}

function invalidInput(): never {
    throw new AdminTranscodingServiceError(
        'invalid-input',
        'Transcoding settings contain an invalid value.'
    );
}

function requireDocument(value: unknown): asserts value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalidResponse();
}

function responseBoolean(value: unknown) {
    if (typeof value !== 'boolean') invalidResponse();
    return value;
}

function inputBoolean(value: unknown) {
    if (typeof value !== 'boolean') invalidInput();
    return value;
}

function responseFiniteNumber(value: unknown) {
    if (typeof value !== 'number' || !Number.isFinite(value)) invalidResponse();
    return value;
}

function responseInteger(value: unknown) {
    const number = responseFiniteNumber(value);
    if (!Number.isSafeInteger(number)) invalidResponse();
    return number;
}

function inputNumber(value: unknown, minimum: number, maximum = Number.MAX_VALUE) {
    if (
        typeof value !== 'number'
        || !Number.isFinite(value)
        || value < minimum
        || value > maximum
    ) {
        invalidInput();
    }
    return value;
}

function inputInteger(value: unknown, minimum: number, maximum = INT32_MAX) {
    const number = inputNumber(value, minimum, maximum);
    if (!Number.isSafeInteger(number)) invalidInput();
    return number;
}

function responseString(value: unknown) {
    if (typeof value !== 'string' || !value.trim()) invalidResponse();
    return value;
}

function inputString(value: unknown) {
    if (typeof value !== 'string' || !value.trim()) invalidInput();
    return value;
}

function responseNullableString(value: unknown) {
    // Nullable EncodingOptions paths are omitted by Jellyfin's JSON serializer
    // when they have no configured value. Preserve that authoritative
    // "unset" state as null in the form model; the patcher only adds the
    // property if the administrator explicitly edits it.
    if (value === null || value === undefined) return null;
    if (typeof value !== 'string') invalidResponse();
    return value;
}

function inputNullableString(value: unknown) {
    if (value === null) return null;
    if (typeof value !== 'string') invalidInput();
    return value;
}

function responseNullableEnum(value: unknown) {
    if (value === null) return null;
    return responseString(value);
}

function inputNullableEnum(value: unknown) {
    if (value === null) return null;
    return inputString(value);
}

function responseStringArray(value: unknown) {
    if (
        !Array.isArray(value)
        || value.some(item => typeof item !== 'string' || !item.trim())
    ) {
        invalidResponse();
    }
    return [ ...value ] as string[];
}

function inputStringArray(value: unknown) {
    if (
        !Array.isArray(value)
        || value.some(item => typeof item !== 'string' || !item.trim())
    ) {
        invalidInput();
    }
    return [ ...value ] as string[];
}

/** Strictly maps every value visible on the retained Transcoding page. */
export function normalizeAdminTranscodingSettings(
    configuration: unknown
): AdminTranscodingSettings {
    requireDocument(configuration);
    return {
        allowAv1Encoding: responseBoolean(configuration.AllowAv1Encoding),
        allowHevcEncoding: responseBoolean(configuration.AllowHevcEncoding),
        deinterlaceDoubleRate: responseBoolean(configuration.DeinterlaceDoubleRate),
        deinterlaceMethod: responseString(configuration.DeinterlaceMethod),
        downMixAudioBoost: responseFiniteNumber(configuration.DownMixAudioBoost),
        downMixStereoAlgorithm: responseString(configuration.DownMixStereoAlgorithm),
        enableAudioVbr: responseBoolean(configuration.EnableAudioVbr),
        enableDecodingColorDepth10Hevc: responseBoolean(configuration.EnableDecodingColorDepth10Hevc),
        enableDecodingColorDepth10HevcRext: responseBoolean(configuration.EnableDecodingColorDepth10HevcRext),
        enableDecodingColorDepth10Vp9: responseBoolean(configuration.EnableDecodingColorDepth10Vp9),
        enableDecodingColorDepth12HevcRext: responseBoolean(configuration.EnableDecodingColorDepth12HevcRext),
        enableEnhancedNvdecDecoder: responseBoolean(configuration.EnableEnhancedNvdecDecoder),
        enableFallbackFont: responseBoolean(configuration.EnableFallbackFont),
        enableHardwareEncoding: responseBoolean(configuration.EnableHardwareEncoding),
        enableIntelLowPowerH264HwEncoder: responseBoolean(configuration.EnableIntelLowPowerH264HwEncoder),
        enableIntelLowPowerHevcHwEncoder: responseBoolean(configuration.EnableIntelLowPowerHevcHwEncoder),
        enableSegmentDeletion: responseBoolean(configuration.EnableSegmentDeletion),
        enableSubtitleExtraction: responseBoolean(configuration.EnableSubtitleExtraction),
        enableThrottling: responseBoolean(configuration.EnableThrottling),
        enableTonemapping: responseBoolean(configuration.EnableTonemapping),
        enableVideoToolboxTonemapping: responseBoolean(configuration.EnableVideoToolboxTonemapping),
        enableVppTonemapping: responseBoolean(configuration.EnableVppTonemapping),
        encoderAppPathDisplay: responseNullableString(configuration.EncoderAppPathDisplay),
        encoderPreset: responseNullableEnum(configuration.EncoderPreset),
        encodingThreadCount: responseInteger(configuration.EncodingThreadCount),
        fallbackFontPath: responseNullableString(configuration.FallbackFontPath),
        h264Crf: responseInteger(configuration.H264Crf),
        h265Crf: responseInteger(configuration.H265Crf),
        hardwareAccelerationType: responseString(configuration.HardwareAccelerationType),
        hardwareDecodingCodecs: responseStringArray(configuration.HardwareDecodingCodecs),
        maxMuxingQueueSize: responseInteger(configuration.MaxMuxingQueueSize),
        preferSystemNativeHwDecoder: responseBoolean(configuration.PreferSystemNativeHwDecoder),
        qsvDevice: responseNullableString(configuration.QsvDevice),
        segmentKeepSeconds: responseInteger(configuration.SegmentKeepSeconds),
        throttleDelaySeconds: responseInteger(configuration.ThrottleDelaySeconds),
        tonemappingAlgorithm: responseString(configuration.TonemappingAlgorithm),
        tonemappingDesat: responseFiniteNumber(configuration.TonemappingDesat),
        tonemappingMode: responseString(configuration.TonemappingMode),
        tonemappingParam: responseFiniteNumber(configuration.TonemappingParam),
        tonemappingPeak: responseFiniteNumber(configuration.TonemappingPeak),
        tonemappingRange: responseString(configuration.TonemappingRange),
        transcodingTempPath: responseNullableString(configuration.TranscodingTempPath),
        vaapiDevice: responseNullableString(configuration.VaapiDevice),
        vppTonemappingBrightness: responseFiniteNumber(configuration.VppTonemappingBrightness),
        vppTonemappingContrast: responseFiniteNumber(configuration.VppTonemappingContrast)
    };
}

export function createAdminTranscodingSnapshot(
    configuration: unknown
): AdminTranscodingSnapshot {
    return {
        configuration: configuration as AdminTranscodingConfigurationDocument,
        settings: normalizeAdminTranscodingSettings(configuration)
    };
}

/** Validates an edited form against the constraints of the retained page. */
export function requireAdminTranscodingSettings(
    settings: AdminTranscodingSettings
): AdminTranscodingSettings {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) invalidInput();

    inputBoolean(settings.allowAv1Encoding);
    inputBoolean(settings.allowHevcEncoding);
    inputBoolean(settings.deinterlaceDoubleRate);
    inputString(settings.deinterlaceMethod);
    inputNumber(settings.downMixAudioBoost, 0.5, 3);
    inputString(settings.downMixStereoAlgorithm);
    inputBoolean(settings.enableAudioVbr);
    inputBoolean(settings.enableDecodingColorDepth10Hevc);
    inputBoolean(settings.enableDecodingColorDepth10HevcRext);
    inputBoolean(settings.enableDecodingColorDepth10Vp9);
    inputBoolean(settings.enableDecodingColorDepth12HevcRext);
    inputBoolean(settings.enableEnhancedNvdecDecoder);
    inputBoolean(settings.enableFallbackFont);
    inputBoolean(settings.enableHardwareEncoding);
    inputBoolean(settings.enableIntelLowPowerH264HwEncoder);
    inputBoolean(settings.enableIntelLowPowerHevcHwEncoder);
    inputBoolean(settings.enableSegmentDeletion);
    inputBoolean(settings.enableSubtitleExtraction);
    inputBoolean(settings.enableThrottling);
    inputBoolean(settings.enableTonemapping);
    inputBoolean(settings.enableVideoToolboxTonemapping);
    inputBoolean(settings.enableVppTonemapping);
    inputNullableString(settings.encoderAppPathDisplay);
    inputNullableEnum(settings.encoderPreset);
    inputInteger(settings.encodingThreadCount, -1, 16);
    inputNullableString(settings.fallbackFontPath);
    inputInteger(settings.h264Crf, 0, 51);
    inputInteger(settings.h265Crf, 0, 51);
    inputString(settings.hardwareAccelerationType);
    inputStringArray(settings.hardwareDecodingCodecs);
    // Jellyfin exposes this as an Int32 and the retained page defines no
    // narrower range. Avoid manufacturing a client-only minimum.
    inputInteger(settings.maxMuxingQueueSize, INT32_MIN);
    inputBoolean(settings.preferSystemNativeHwDecoder);
    inputNullableString(settings.qsvDevice);
    inputInteger(settings.segmentKeepSeconds, 10, 3_600);
    inputInteger(settings.throttleDelaySeconds, 10, 3_600);
    inputString(settings.tonemappingAlgorithm);
    inputNumber(settings.tonemappingDesat, 0);
    inputString(settings.tonemappingMode);
    inputNumber(settings.tonemappingParam, 0);
    inputNumber(settings.tonemappingPeak, 0);
    inputString(settings.tonemappingRange);
    inputNullableString(settings.transcodingTempPath);
    inputNullableString(settings.vaapiDevice);
    inputNumber(settings.vppTonemappingBrightness, 0, 100);
    inputNumber(settings.vppTonemappingContrast, 1, 2);
    return settings;
}

const EDITABLE_SCALAR_FIELDS = [
    'allowAv1Encoding',
    'allowHevcEncoding',
    'deinterlaceDoubleRate',
    'deinterlaceMethod',
    'downMixAudioBoost',
    'downMixStereoAlgorithm',
    'enableAudioVbr',
    'enableDecodingColorDepth10Hevc',
    'enableDecodingColorDepth10HevcRext',
    'enableDecodingColorDepth10Vp9',
    'enableDecodingColorDepth12HevcRext',
    'enableEnhancedNvdecDecoder',
    'enableFallbackFont',
    'enableHardwareEncoding',
    'enableIntelLowPowerH264HwEncoder',
    'enableIntelLowPowerHevcHwEncoder',
    'enableSegmentDeletion',
    'enableSubtitleExtraction',
    'enableThrottling',
    'enableTonemapping',
    'enableVideoToolboxTonemapping',
    'enableVppTonemapping',
    'encoderPreset',
    'encodingThreadCount',
    'fallbackFontPath',
    'h264Crf',
    'h265Crf',
    'hardwareAccelerationType',
    'maxMuxingQueueSize',
    'preferSystemNativeHwDecoder',
    'qsvDevice',
    'segmentKeepSeconds',
    'throttleDelaySeconds',
    'tonemappingAlgorithm',
    'tonemappingDesat',
    'tonemappingMode',
    'tonemappingParam',
    'tonemappingPeak',
    'tonemappingRange',
    'transcodingTempPath',
    'vaapiDevice',
    'vppTonemappingBrightness',
    'vppTonemappingContrast'
] as const satisfies readonly (keyof AdminTranscodingSettings)[];

/**
 * Compares every editable value. EncoderAppPathDisplay is intentionally
 * excluded because it is observational and must never be written by PTV.
 */
export function areAdminTranscodingSettingsEqual(
    left: AdminTranscodingSettings,
    right: AdminTranscodingSettings
) {
    return (
        EDITABLE_SCALAR_FIELDS.every(field => left[field] === right[field])
        && left.hardwareDecodingCodecs.length === right.hardwareDecodingCodecs.length
        && left.hardwareDecodingCodecs.every(
            (codec, index) => codec === right.hardwareDecodingCodecs[index]
        )
    );
}

function cloneJsonValue<T>(value: T): T {
    if (Array.isArray(value)) return value.map(entry => cloneJsonValue(entry)) as T;
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([ key, nested ]) => [ key, cloneJsonValue(nested) ])
        ) as T;
    }
    return value;
}

const SETTING_TO_CONFIGURATION_FIELD = {
    allowAv1Encoding: 'AllowAv1Encoding',
    allowHevcEncoding: 'AllowHevcEncoding',
    deinterlaceDoubleRate: 'DeinterlaceDoubleRate',
    deinterlaceMethod: 'DeinterlaceMethod',
    downMixAudioBoost: 'DownMixAudioBoost',
    downMixStereoAlgorithm: 'DownMixStereoAlgorithm',
    enableAudioVbr: 'EnableAudioVbr',
    enableDecodingColorDepth10Hevc: 'EnableDecodingColorDepth10Hevc',
    enableDecodingColorDepth10HevcRext: 'EnableDecodingColorDepth10HevcRext',
    enableDecodingColorDepth10Vp9: 'EnableDecodingColorDepth10Vp9',
    enableDecodingColorDepth12HevcRext: 'EnableDecodingColorDepth12HevcRext',
    enableEnhancedNvdecDecoder: 'EnableEnhancedNvdecDecoder',
    enableFallbackFont: 'EnableFallbackFont',
    enableHardwareEncoding: 'EnableHardwareEncoding',
    enableIntelLowPowerH264HwEncoder: 'EnableIntelLowPowerH264HwEncoder',
    enableIntelLowPowerHevcHwEncoder: 'EnableIntelLowPowerHevcHwEncoder',
    enableSegmentDeletion: 'EnableSegmentDeletion',
    enableSubtitleExtraction: 'EnableSubtitleExtraction',
    enableThrottling: 'EnableThrottling',
    enableTonemapping: 'EnableTonemapping',
    enableVideoToolboxTonemapping: 'EnableVideoToolboxTonemapping',
    enableVppTonemapping: 'EnableVppTonemapping',
    encoderPreset: 'EncoderPreset',
    encodingThreadCount: 'EncodingThreadCount',
    fallbackFontPath: 'FallbackFontPath',
    h264Crf: 'H264Crf',
    h265Crf: 'H265Crf',
    hardwareAccelerationType: 'HardwareAccelerationType',
    maxMuxingQueueSize: 'MaxMuxingQueueSize',
    preferSystemNativeHwDecoder: 'PreferSystemNativeHwDecoder',
    qsvDevice: 'QsvDevice',
    segmentKeepSeconds: 'SegmentKeepSeconds',
    throttleDelaySeconds: 'ThrottleDelaySeconds',
    tonemappingAlgorithm: 'TonemappingAlgorithm',
    tonemappingDesat: 'TonemappingDesat',
    tonemappingMode: 'TonemappingMode',
    tonemappingParam: 'TonemappingParam',
    tonemappingPeak: 'TonemappingPeak',
    tonemappingRange: 'TonemappingRange',
    transcodingTempPath: 'TranscodingTempPath',
    vaapiDevice: 'VaapiDevice',
    vppTonemappingBrightness: 'VppTonemappingBrightness',
    vppTonemappingContrast: 'VppTonemappingContrast'
} as const satisfies Record<
    typeof EDITABLE_SCALAR_FIELDS[number],
    keyof AdminTranscodingConfigurationDocument
>;

/**
 * Deep-clones the fresh complete document and changes only PTV-owned fields.
 * Unknown fields, EncoderAppPath, on-demand keyframe extensions, and unknown
 * codec/preset values remain intact unless the administrator edits that field.
 */
export function patchAdminTranscodingConfiguration(
    authoritativeConfiguration: AdminTranscodingConfigurationDocument,
    desiredSettings: AdminTranscodingSettings
): AdminTranscodingConfigurationDocument {
    const authoritativeSettings = normalizeAdminTranscodingSettings(authoritativeConfiguration);
    const desired = requireAdminTranscodingSettings(desiredSettings);
    const patched = cloneJsonValue(authoritativeConfiguration);

    EDITABLE_SCALAR_FIELDS.forEach(field => {
        if (authoritativeSettings[field] !== desired[field]) {
            Reflect.set(patched, SETTING_TO_CONFIGURATION_FIELD[field], desired[field]);
        }
    });
    if (
        authoritativeSettings.hardwareDecodingCodecs.length !== desired.hardwareDecodingCodecs.length
        || authoritativeSettings.hardwareDecodingCodecs.some(
            (codec, index) => codec !== desired.hardwareDecodingCodecs[index]
        )
    ) {
        patched.HardwareDecodingCodecs = [ ...desired.hardwareDecodingCodecs ];
    }
    return patched;
}
