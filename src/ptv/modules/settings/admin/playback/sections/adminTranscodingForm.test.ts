import { describe, expect, it } from 'vitest';

import { normalizeAdminTranscodingSettings } from '../adminTranscodingAdapters';
import { rawTranscodingConfiguration } from '../adminTranscodingTestFixtures';
import {
    areAdminTranscodingFormsEqual,
    parseAdminTranscodingForm,
    toAdminTranscodingForm,
    type AdminTranscodingForm
} from './adminTranscodingForm';

function form(overrides: Partial<AdminTranscodingForm> = {}): AdminTranscodingForm {
    return {
        ...toAdminTranscodingForm(normalizeAdminTranscodingSettings(
            rawTranscodingConfiguration()
        )),
        ...overrides
    };
}

describe('administrator Transcoding form adapters', () => {
    it('formats every numeric value without changing path or unknown values', () => {
        const settings = normalizeAdminTranscodingSettings({
            ...rawTranscodingConfiguration(),
            EncoderPreset: 'future-preset',
            HardwareAccelerationType: 'future-hardware',
            HardwareDecodingCodecs: [ 'h264', 'future-codec' ],
            TranscodingTempPath: String.raw`D:\Piggie Transcodes`
        });

        const result = toAdminTranscodingForm(settings);

        expect(result).toMatchObject({
            downMixAudioBoost: '2',
            encoderPreset: 'future-preset',
            encodingThreadCount: '-1',
            h264Crf: '23',
            hardwareAccelerationType: 'future-hardware',
            hardwareDecodingCodecs: [ 'h264', 'future-codec' ],
            transcodingTempPath: String.raw`D:\Piggie Transcodes`
        });
        expect(result.hardwareDecodingCodecs).not.toBe(settings.hardwareDecodingCodecs);
    });

    it('ignores the read-only FFmpeg runtime path and codec ordering', () => {
        const baseline = form();

        expect(areAdminTranscodingFormsEqual(baseline, {
            ...baseline,
            encoderAppPathDisplay: '/new/runtime/ffmpeg'
        })).toBe(true);
        expect(areAdminTranscodingFormsEqual(baseline, {
            ...baseline,
            hardwareDecodingCodecs: [ 'future-codec', 'h264', 'vc1' ]
        })).toBe(true);
        expect(areAdminTranscodingFormsEqual(baseline, {
            ...baseline,
            hardwareDecodingCodecs: [ 'future-codec', 'h264', 'vc1', 'vc1' ]
        })).toBe(true);
        expect(areAdminTranscodingFormsEqual(baseline, {
            ...baseline,
            hardwareDecodingCodecs: [ 'future-codec', 'h264', 'av1' ]
        })).toBe(false);
    });

    it('parses values without normalizing server paths or unknown selections', () => {
        const edited = form({
            encoderPreset: 'future-preset',
            hardwareAccelerationType: 'future-hardware',
            hardwareDecodingCodecs: [ 'h264', 'future-codec' ],
            maxMuxingQueueSize: '-1',
            qsvDevice: String.raw`QSV:\device`,
            transcodingTempPath: String.raw`D:\Piggie Transcodes`,
            vaapiDevice: '/dev/dri/by-path/custom'
        });

        const parsed = parseAdminTranscodingForm(edited);

        expect(parsed).toMatchObject({
            encoderPreset: 'future-preset',
            hardwareAccelerationType: 'future-hardware',
            hardwareDecodingCodecs: [ 'h264', 'future-codec' ],
            maxMuxingQueueSize: -1,
            qsvDevice: String.raw`QSV:\device`,
            transcodingTempPath: String.raw`D:\Piggie Transcodes`,
            vaapiDevice: '/dev/dri/by-path/custom'
        });
        expect(parsed?.hardwareDecodingCodecs).not.toBe(edited.hardwareDecodingCodecs);
    });

    it.each([
        [ 'downMixAudioBoost', '0.49' ],
        [ 'encodingThreadCount', '17' ],
        [ 'h264Crf', '-1' ],
        [ 'h265Crf', '52' ],
        [ 'maxMuxingQueueSize', '2147483648' ],
        [ 'segmentKeepSeconds', '9' ],
        [ 'throttleDelaySeconds', '3601' ],
        [ 'tonemappingDesat', '-0.1' ],
        [ 'tonemappingParam', '' ],
        [ 'tonemappingPeak', 'not-a-number' ],
        [ 'vppTonemappingBrightness', '101' ],
        [ 'vppTonemappingContrast', '0.99' ]
    ] as const)('rejects invalid %s value %s', (field, value) => {
        expect(parseAdminTranscodingForm(form({ [field]: value }))).toBeNull();
    });

    it('accepts exact boundary and sentinel values', () => {
        expect(parseAdminTranscodingForm(form({
            downMixAudioBoost: '0.5',
            encodingThreadCount: '0',
            h264Crf: '0',
            h265Crf: '51',
            maxMuxingQueueSize: '-2147483648',
            segmentKeepSeconds: '10',
            throttleDelaySeconds: '3600',
            tonemappingDesat: '0',
            tonemappingParam: '0',
            tonemappingPeak: '0',
            vppTonemappingBrightness: '100',
            vppTonemappingContrast: '2'
        }))).not.toBeNull();
    });
});
