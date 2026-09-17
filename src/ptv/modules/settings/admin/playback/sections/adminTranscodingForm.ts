import { areAdminTranscodingCodecSetsEqual } from '../adminTranscodingAdapters';
import type { AdminTranscodingSettings } from '../adminTranscodingModel';

export type AdminTranscodingNumericField =
    | 'downMixAudioBoost'
    | 'encodingThreadCount'
    | 'h264Crf'
    | 'h265Crf'
    | 'maxMuxingQueueSize'
    | 'segmentKeepSeconds'
    | 'throttleDelaySeconds'
    | 'tonemappingDesat'
    | 'tonemappingParam'
    | 'tonemappingPeak'
    | 'vppTonemappingBrightness'
    | 'vppTonemappingContrast';

export type AdminTranscodingForm = Omit<AdminTranscodingSettings, AdminTranscodingNumericField> & {
    [K in AdminTranscodingNumericField]: string;
};

const NUMERIC_FIELDS: readonly AdminTranscodingNumericField[] = [
    'downMixAudioBoost',
    'encodingThreadCount',
    'h264Crf',
    'h265Crf',
    'maxMuxingQueueSize',
    'segmentKeepSeconds',
    'throttleDelaySeconds',
    'tonemappingDesat',
    'tonemappingParam',
    'tonemappingPeak',
    'vppTonemappingBrightness',
    'vppTonemappingContrast'
];

export function toAdminTranscodingForm(settings: AdminTranscodingSettings): AdminTranscodingForm {
    return {
        ...settings,
        downMixAudioBoost: String(settings.downMixAudioBoost),
        encodingThreadCount: String(settings.encodingThreadCount),
        h264Crf: String(settings.h264Crf),
        h265Crf: String(settings.h265Crf),
        hardwareDecodingCodecs: [ ...settings.hardwareDecodingCodecs ],
        maxMuxingQueueSize: String(settings.maxMuxingQueueSize),
        segmentKeepSeconds: String(settings.segmentKeepSeconds),
        throttleDelaySeconds: String(settings.throttleDelaySeconds),
        tonemappingDesat: String(settings.tonemappingDesat),
        tonemappingParam: String(settings.tonemappingParam),
        tonemappingPeak: String(settings.tonemappingPeak),
        vppTonemappingBrightness: String(settings.vppTonemappingBrightness),
        vppTonemappingContrast: String(settings.vppTonemappingContrast)
    };
}

export function areAdminTranscodingFormsEqual(
    left: AdminTranscodingForm,
    right: AdminTranscodingForm
) {
    return Object.keys(left).every(key => {
        const field = key as keyof AdminTranscodingForm;
        // Jellyfin owns this runtime path. It is informational, cannot make
        // the form dirty, and must not create a managed-field conflict.
        if (field === 'encoderAppPathDisplay') return true;
        if (field === 'hardwareDecodingCodecs') {
            return areAdminTranscodingCodecSetsEqual(
                left.hardwareDecodingCodecs,
                right.hardwareDecodingCodecs
            );
        }
        return left[field] === right[field];
    });
}

function decimal(value: string, minimum: number, maximum = Number.MAX_VALUE) {
    if (!value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function integer(value: string, minimum: number, maximum: number) {
    if (!/^-?\d+$/.test(value)) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

const NUMERIC_PARSERS: Readonly<Record<
    AdminTranscodingNumericField,
    (value: string) => number | null
>> = {
    downMixAudioBoost: value => decimal(value, 0.5, 3),
    encodingThreadCount: value => integer(value, -1, 16),
    h264Crf: value => integer(value, 0, 51),
    h265Crf: value => integer(value, 0, 51),
    // Jellyfin defines this as an Int32 and its retained administrator UI
    // does not impose a narrower range.
    maxMuxingQueueSize: value => integer(value, -2_147_483_648, 2_147_483_647),
    segmentKeepSeconds: value => integer(value, 10, 3_600),
    throttleDelaySeconds: value => integer(value, 10, 3_600),
    tonemappingDesat: value => decimal(value, 0),
    tonemappingParam: value => decimal(value, 0),
    tonemappingPeak: value => decimal(value, 0),
    vppTonemappingBrightness: value => decimal(value, 0, 100),
    vppTonemappingContrast: value => decimal(value, 1, 2)
};

export function isAdminTranscodingNumericFieldValid(
    form: AdminTranscodingForm,
    field: AdminTranscodingNumericField
) {
    return NUMERIC_PARSERS[field](form[field]) !== null;
}

/** Converts the editable string representation without guessing any missing value. */
export function parseAdminTranscodingForm(
    form: AdminTranscodingForm
): AdminTranscodingSettings | null {
    const parsed = {
        downMixAudioBoost: NUMERIC_PARSERS.downMixAudioBoost(form.downMixAudioBoost),
        encodingThreadCount: NUMERIC_PARSERS.encodingThreadCount(form.encodingThreadCount),
        h264Crf: NUMERIC_PARSERS.h264Crf(form.h264Crf),
        h265Crf: NUMERIC_PARSERS.h265Crf(form.h265Crf),
        maxMuxingQueueSize: NUMERIC_PARSERS.maxMuxingQueueSize(form.maxMuxingQueueSize),
        segmentKeepSeconds: NUMERIC_PARSERS.segmentKeepSeconds(form.segmentKeepSeconds),
        throttleDelaySeconds: NUMERIC_PARSERS.throttleDelaySeconds(form.throttleDelaySeconds),
        tonemappingDesat: NUMERIC_PARSERS.tonemappingDesat(form.tonemappingDesat),
        tonemappingParam: NUMERIC_PARSERS.tonemappingParam(form.tonemappingParam),
        tonemappingPeak: NUMERIC_PARSERS.tonemappingPeak(form.tonemappingPeak),
        vppTonemappingBrightness: NUMERIC_PARSERS.vppTonemappingBrightness(form.vppTonemappingBrightness),
        vppTonemappingContrast: NUMERIC_PARSERS.vppTonemappingContrast(form.vppTonemappingContrast)
    };
    if (NUMERIC_FIELDS.some(field => parsed[field] === null)) return null;

    return {
        ...form,
        downMixAudioBoost: parsed.downMixAudioBoost!,
        encodingThreadCount: parsed.encodingThreadCount!,
        h264Crf: parsed.h264Crf!,
        h265Crf: parsed.h265Crf!,
        hardwareDecodingCodecs: [ ...form.hardwareDecodingCodecs ],
        maxMuxingQueueSize: parsed.maxMuxingQueueSize!,
        segmentKeepSeconds: parsed.segmentKeepSeconds!,
        throttleDelaySeconds: parsed.throttleDelaySeconds!,
        tonemappingDesat: parsed.tonemappingDesat!,
        tonemappingParam: parsed.tonemappingParam!,
        tonemappingPeak: parsed.tonemappingPeak!,
        vppTonemappingBrightness: parsed.vppTonemappingBrightness!,
        vppTonemappingContrast: parsed.vppTonemappingContrast!
    };
}
