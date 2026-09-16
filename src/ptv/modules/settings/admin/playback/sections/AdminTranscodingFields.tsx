import React from 'react';

/* eslint-disable react/jsx-no-bind */

import {
    AdminConfigurationNotice,
    AdminConfigurationNumber,
    AdminConfigurationPanel,
    AdminConfigurationSelect,
    AdminConfigurationText,
    AdminConfigurationToggle
} from '../../configuration/AdminConfigurationPrimitives';
import {
    ADMIN_TRANSCODING_DEINTERLACE_METHODS,
    ADMIN_TRANSCODING_DOWNMIX_ALGORITHMS,
    ADMIN_TRANSCODING_ENCODER_PRESETS,
    ADMIN_TRANSCODING_HARDWARE_ACCELERATION_OPTIONS,
    ADMIN_TRANSCODING_TONEMAPPING_ALGORITHMS,
    ADMIN_TRANSCODING_TONEMAPPING_MODES,
    ADMIN_TRANSCODING_TONEMAPPING_RANGES,
    getAdminTranscodingCodecOptions
} from '../adminTranscodingAdapters';
import {
    isAdminTranscodingNumericFieldValid,
    type AdminTranscodingForm,
    type AdminTranscodingNumericField
} from './adminTranscodingForm';

type UpdateTranscodingField = <K extends keyof AdminTranscodingForm>(
    field: K,
    value: AdminTranscodingForm[K]
) => void;

type FieldsProps = Readonly<{
    disabled: boolean;
    form: AdminTranscodingForm;
    update: UpdateTranscodingField;
}>;

const TEN_BIT_HARDWARE = new Set([ 'amf', 'nvenc', 'qsv', 'vaapi', 'rkmpp' ]);
const REXT_HARDWARE = new Set([ 'nvenc', 'qsv', 'vaapi' ]);
const GENERAL_TONE_HARDWARE = new Set([ 'amf', 'nvenc', 'qsv', 'vaapi', 'rkmpp', 'videotoolbox' ]);

function labelEnum(value: string) {
    return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, first => first.toUpperCase());
}

function optionWithCurrent(options: readonly string[], current: string | null) {
    return current && !options.includes(current) ? [ current, ...options ] : options;
}

async function showServerDirectoryPicker({
    header,
    instruction,
    onSelect,
    validateWriteable = false
}: Readonly<{
    header: string;
    instruction: string;
    onSelect: (path: string) => void;
    validateWriteable?: boolean;
}>) {
    const { default: DirectoryBrowser } = await import(
        /* webpackChunkName: "ptv-admin-directory-browser" */
        'components/directorybrowser/directorybrowser'
    );
    const picker = new DirectoryBrowser();
    picker.show({
        callback: (path: string) => {
            onSelect(path);
            picker.close();
        },
        header,
        instruction,
        validateWriteable
    });
}

function numericError(form: AdminTranscodingForm, field: AdminTranscodingNumericField) {
    return isAdminTranscodingNumericFieldValid(form, field) ?
        '' :
        'Enter a value within the supported range.';
}

function HardwarePanel({ disabled, form, update }: FieldsProps) {
    const hardware = form.hardwareAccelerationType;
    const availableCodecs = getAdminTranscodingCodecOptions(hardware);
    const availableValues = new Set(availableCodecs.map(codec => codec.value));
    const unavailableConfigured = form.hardwareDecodingCodecs.filter(codec => !availableValues.has(codec));
    const selectedHardwareIsKnown = ADMIN_TRANSCODING_HARDWARE_ACCELERATION_OPTIONS.some(
        option => option.value === hardware
    );
    const hardwareActive = hardware !== 'none';

    return (
        <AdminConfigurationPanel description='Select the server encoder and the formats it may decode or produce.' title='Hardware Acceleration'>
            <AdminConfigurationSelect description='Choose a Jellyfin-supported acceleration mode. This does not detect or install server drivers.' disabled={disabled} id='ptv-transcoding-hardware' label='Hardware acceleration' onChange={value => update('hardwareAccelerationType', value)} value={hardware}>
                {!selectedHardwareIsKnown ? <option value={hardware}>{hardware} (configured, unavailable)</option> : null}
                {ADMIN_TRANSCODING_HARDWARE_ACCELERATION_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </AdminConfigurationSelect>
            {hardware === 'vaapi' ? <AdminConfigurationText description='Server device path used by VAAPI. The value is preserved verbatim.' disabled={disabled} id='ptv-transcoding-vaapi-device' label='VAAPI device' onChange={value => update('vaapiDevice', value)} value={form.vaapiDevice ?? ''} /> : null}
            {hardware === 'qsv' ? <AdminConfigurationText description='Server device path used by Intel Quick Sync.' disabled={disabled} id='ptv-transcoding-qsv-device' label='Quick Sync device' onChange={value => update('qsvDevice', value)} value={form.qsvDevice ?? ''} /> : null}
            {hardwareActive ? (
                <>
                    <AdminConfigurationNotice tone='warning'>
                        <strong>Verify server drivers before enabling acceleration</strong>
                        <p>Hardware acceleration can be unstable when the server operating system or video drivers are not compatible.</p>
                    </AdminConfigurationNotice>
                    <div className='ptv-admin-playback-codecs'>
                        {availableCodecs.map(codec => (
                            <AdminConfigurationToggle
                                checked={form.hardwareDecodingCodecs.includes(codec.value)}
                                description={`Allow hardware decoding for ${codec.label}.`}
                                disabled={disabled}
                                id={`ptv-transcoding-codec-${codec.value}`}
                                key={codec.value}
                                label={codec.label}
                                onChange={checked => update('hardwareDecodingCodecs', checked ? [ ...form.hardwareDecodingCodecs, codec.value ] : form.hardwareDecodingCodecs.filter(value => value !== codec.value))}
                            />
                        ))}
                        {unavailableConfigured.map(codec => <AdminConfigurationToggle checked description='Preserved because this codec is configured but unavailable for the selected mode.' disabled id={`ptv-transcoding-codec-unavailable-${codec}`} key={codec} label={`${codec} (unavailable)`} onChange={() => undefined} />)}
                    </div>
                    {TEN_BIT_HARDWARE.has(hardware) ? <>
                        <AdminConfigurationToggle checked={form.enableDecodingColorDepth10Hevc} description='Allow supported 10-bit HEVC hardware decoding.' disabled={disabled} id='ptv-transcoding-hevc-10bit' label='HEVC 10-bit decoding' onChange={value => update('enableDecodingColorDepth10Hevc', value)} />
                        <AdminConfigurationToggle checked={form.enableDecodingColorDepth10Vp9} description='Allow supported 10-bit VP9 hardware decoding.' disabled={disabled} id='ptv-transcoding-vp9-10bit' label='VP9 10-bit decoding' onChange={value => update('enableDecodingColorDepth10Vp9', value)} />
                    </> : null}
                    {REXT_HARDWARE.has(hardware) ? <>
                        <AdminConfigurationToggle checked={form.enableDecodingColorDepth10HevcRext} description='Allow HEVC range-extension 8/10-bit profiles.' disabled={disabled} id='ptv-transcoding-hevc-rext-10bit' label='HEVC RExt 8/10-bit decoding' onChange={value => update('enableDecodingColorDepth10HevcRext', value)} />
                        <AdminConfigurationToggle checked={form.enableDecodingColorDepth12HevcRext} description='Allow HEVC range-extension 12-bit profiles.' disabled={disabled} id='ptv-transcoding-hevc-rext-12bit' label='HEVC RExt 12-bit decoding' onChange={value => update('enableDecodingColorDepth12HevcRext', value)} />
                    </> : null}
                    {hardware === 'nvenc' ? <AdminConfigurationToggle checked={form.enableEnhancedNvdecDecoder} description='Use the enhanced NVDEC decoder implementation.' disabled={disabled} id='ptv-transcoding-enhanced-nvdec' label='Enhanced NVDEC decoder' onChange={value => update('enableEnhancedNvdecDecoder', value)} /> : null}
                    {hardware === 'qsv' ? <AdminConfigurationToggle checked={form.preferSystemNativeHwDecoder} description='Prefer the operating system’s native hardware decoder.' disabled={disabled} id='ptv-transcoding-native-decoder' label='Prefer native decoder' onChange={value => update('preferSystemNativeHwDecoder', value)} /> : null}
                    <AdminConfigurationToggle checked={form.enableHardwareEncoding} description='Use hardware encoding for compatible transcodes.' disabled={disabled} id='ptv-transcoding-hw-encoding' label='Hardware encoding' onChange={value => update('enableHardwareEncoding', value)} />
                    {(hardware === 'qsv' || hardware === 'vaapi') ? <>
                        <AdminConfigurationToggle checked={form.enableIntelLowPowerH264HwEncoder} description='Enable Intel low-power H.264 hardware encoding.' disabled={disabled} id='ptv-transcoding-low-power-h264' label='Intel low-power H.264' onChange={value => update('enableIntelLowPowerH264HwEncoder', value)} />
                        <AdminConfigurationToggle checked={form.enableIntelLowPowerHevcHwEncoder} description='Enable Intel low-power HEVC hardware encoding.' disabled={disabled} id='ptv-transcoding-low-power-hevc' label='Intel low-power HEVC' onChange={value => update('enableIntelLowPowerHevcHwEncoder', value)} />
                    </> : null}
                </>
            ) : null}
        </AdminConfigurationPanel>
    );
}

function EncodingPanel({ disabled, form, update }: FieldsProps) {
    const presets = optionWithCurrent(ADMIN_TRANSCODING_ENCODER_PRESETS, form.encoderPreset);
    return (
        <AdminConfigurationPanel description='Control output formats, software encoding quality, and FFmpeg workload.' title='Encoding'>
            <AdminConfigurationToggle checked={form.allowHevcEncoding} description='Allow HEVC output when a playback profile supports it.' disabled={disabled} id='ptv-transcoding-allow-hevc' label='Allow HEVC encoding' onChange={value => update('allowHevcEncoding', value)} />
            <AdminConfigurationToggle checked={form.allowAv1Encoding} description='Allow AV1 output when a playback profile supports it.' disabled={disabled} id='ptv-transcoding-allow-av1' label='Allow AV1 encoding' onChange={value => update('allowAv1Encoding', value)} />
            <AdminConfigurationSelect description='FFmpeg speed and compression preset for software encoding.' disabled={disabled} id='ptv-transcoding-preset' label='Encoding preset' onChange={value => update('encoderPreset', value || null)} value={form.encoderPreset ?? ''}><option value=''>Server default</option>{presets.map(value => <option key={value} value={value}>{labelEnum(value)}{!ADMIN_TRANSCODING_ENCODER_PRESETS.includes(value as typeof ADMIN_TRANSCODING_ENCODER_PRESETS[number]) ? ' (configured)' : ''}</option>)}</AdminConfigurationSelect>
            <AdminConfigurationNumber description='Software H.264 quality from 0 to 51. Lower values are higher quality.' disabled={disabled} error={numericError(form, 'h264Crf')} id='ptv-transcoding-h264-crf' label='H.264 CRF' max={51} min={0} onChange={value => update('h264Crf', value)} value={form.h264Crf} />
            <AdminConfigurationNumber description='Software H.265 quality from 0 to 51. Lower values are higher quality.' disabled={disabled} error={numericError(form, 'h265Crf')} id='ptv-transcoding-h265-crf' label='H.265 CRF' max={51} min={0} onChange={value => update('h265Crf', value)} value={form.h265Crf} />
            <AdminConfigurationSelect description='Use Auto for FFmpeg automatic behavior or Maximum for unrestricted threads.' disabled={disabled} id='ptv-transcoding-threads' label='Encoding threads' onChange={value => update('encodingThreadCount', value)} value={form.encodingThreadCount}><option value='-1'>Auto</option>{Array.from({ length: 16 }, (_, index) => index + 1).map(value => <option key={value} value={value}>{value}</option>)}<option value='0'>Maximum</option></AdminConfigurationSelect>
        </AdminConfigurationPanel>
    );
}

function StoragePanel({ disabled, form, update }: FieldsProps) {
    return (
        <AdminConfigurationPanel description='Server paths used for temporary media and subtitle font processing.' title='Transcode Storage'>
            <AdminConfigurationText action={<button aria-label='Browse for transcoding temporary path' disabled={disabled} onClick={() => { showServerDirectoryPicker({ header: 'Select transcoding path', instruction: 'Choose a writable server folder for temporary transcode files.', onSelect: value => update('transcodingTempPath', value), validateWriteable: true }).catch(() => undefined); }} type='button'>Browse</button>} description='Blank uses Jellyfin’s default cache/transcodes folder. Paths are sent verbatim to the server.' disabled={disabled} id='ptv-transcoding-temp-path' label='Transcoding temporary path' onChange={value => update('transcodingTempPath', value)} value={form.transcodingTempPath ?? ''} />
            <AdminConfigurationText action={<span className='ptv-admin-playback-readonly-badge'>Server managed</span>} description='The FFmpeg executable currently selected by Jellyfin.' id='ptv-transcoding-ffmpeg-path' label='FFmpeg path' readOnly value={form.encoderAppPathDisplay ?? ''} />
            <AdminConfigurationText action={<button aria-label='Browse for fallback font path' disabled={disabled} onClick={() => { showServerDirectoryPicker({ header: 'Select fallback font path', instruction: 'Choose the server folder containing fallback fonts.', onSelect: value => update('fallbackFontPath', value) }).catch(() => undefined); }} type='button'>Browse</button>} description='Server folder containing fallback fonts used for subtitle rendering.' disabled={disabled} id='ptv-transcoding-font-path' label='Fallback font path' onChange={value => update('fallbackFontPath', value)} value={form.fallbackFontPath ?? ''} />
            <AdminConfigurationToggle checked={form.enableFallbackFont} description='Use fonts from the configured fallback folder when needed.' disabled={disabled} id='ptv-transcoding-fallback-font' label='Fallback fonts' onChange={value => update('enableFallbackFont', value)} />
        </AdminConfigurationPanel>
    );
}

function AudioAndProcessingPanel({ disabled, form, update }: FieldsProps) {
    const downmixOptions = optionWithCurrent(ADMIN_TRANSCODING_DOWNMIX_ALGORITHMS, form.downMixStereoAlgorithm);
    const deinterlaceOptions = optionWithCurrent(ADMIN_TRANSCODING_DEINTERLACE_METHODS, form.deinterlaceMethod);
    return (
        <AdminConfigurationPanel description='Technical audio, subtitle, muxing, and deinterlacing behavior.' title='Audio & Processing'>
            <AdminConfigurationToggle checked={form.enableAudioVbr} description='Use variable bitrate for supported audio encoders.' disabled={disabled} id='ptv-transcoding-audio-vbr' label='Variable-bitrate audio' onChange={value => update('enableAudioVbr', value)} />
            <AdminConfigurationNumber description='Volume multiplier used while downmixing audio.' disabled={disabled} error={numericError(form, 'downMixAudioBoost')} id='ptv-transcoding-downmix-boost' label='Downmix audio boost' max={3} min={0.5} onChange={value => update('downMixAudioBoost', value)} step={0.1} value={form.downMixAudioBoost} />
            <AdminConfigurationSelect description='Channel mixing algorithm used for stereo output.' disabled={disabled} id='ptv-transcoding-downmix-algorithm' label='Stereo downmix algorithm' onChange={value => update('downMixStereoAlgorithm', value)} value={form.downMixStereoAlgorithm}>{downmixOptions.map(value => <option key={value} value={value}>{labelEnum(value)}</option>)}</AdminConfigurationSelect>
            <AdminConfigurationNumber description='Maximum queued packets before FFmpeg begins muxing.' disabled={disabled} error={numericError(form, 'maxMuxingQueueSize')} id='ptv-transcoding-muxing-queue' label='Maximum muxing queue' max={2_147_483_647} min={-2_147_483_648} onChange={value => update('maxMuxingQueueSize', value)} value={form.maxMuxingQueueSize} />
            <AdminConfigurationSelect description='Filter used when interlaced video must be converted.' disabled={disabled} id='ptv-transcoding-deinterlace-method' label='Deinterlace method' onChange={value => update('deinterlaceMethod', value)} value={form.deinterlaceMethod}>{deinterlaceOptions.map(value => <option key={value} value={value}>{value.toUpperCase()}</option>)}</AdminConfigurationSelect>
            <AdminConfigurationToggle checked={form.deinterlaceDoubleRate} description='Produce one progressive frame per interlaced field.' disabled={disabled} id='ptv-transcoding-double-rate' label='Double-rate deinterlacing' onChange={value => update('deinterlaceDoubleRate', value)} />
            <AdminConfigurationToggle checked={form.enableSubtitleExtraction} description='Allow subtitle extraction without transcoding video when supported.' disabled={disabled} id='ptv-transcoding-subtitle-extraction' label='On-the-fly subtitle extraction' onChange={value => update('enableSubtitleExtraction', value)} />
        </AdminConfigurationPanel>
    );
}

function ThrottlingPanel({ disabled, form, update }: FieldsProps) {
    return (
        <AdminConfigurationPanel description='Slow advanced transcodes and remove old downloaded HLS segments.' title='Throttling & Segments'>
            <AdminConfigurationToggle checked={form.enableThrottling} description='Slow FFmpeg when playback is sufficiently buffered.' disabled={disabled} id='ptv-transcoding-throttling' label='Transcode throttling' onChange={value => update('enableThrottling', value)} />
            <AdminConfigurationNumber description='Buffered duration before throttling may begin.' disabled={disabled} error={numericError(form, 'throttleDelaySeconds')} id='ptv-transcoding-throttle-delay' label='Throttle delay' max={3600} min={10} onChange={value => update('throttleDelaySeconds', value)} suffix='seconds' value={form.throttleDelaySeconds} />
            <AdminConfigurationToggle checked={form.enableSegmentDeletion} description='Delete old HLS segments after the client has downloaded them.' disabled={disabled} id='ptv-transcoding-segment-deletion' label='Segment deletion' onChange={value => update('enableSegmentDeletion', value)} />
            <AdminConfigurationNumber description='Minimum age before an old downloaded segment may be removed.' disabled={disabled} error={numericError(form, 'segmentKeepSeconds')} id='ptv-transcoding-segment-retention' label='Segment retention' max={3600} min={10} onChange={value => update('segmentKeepSeconds', value)} suffix='seconds' value={form.segmentKeepSeconds} />
            <AdminConfigurationNotice tone='info'><strong>May affect active transcodes</strong><p>Jellyfin rereads throttling and segment-cleanup options while jobs are running.</p></AdminConfigurationNotice>
        </AdminConfigurationPanel>
    );
}

function ToneMappingPanel({ disabled, form, update }: FieldsProps) {
    const hardware = form.hardwareAccelerationType;
    const softwareMode = hardware === 'none';
    if (!softwareMode && !GENERAL_TONE_HARDWARE.has(hardware)) return null;
    const algorithms = optionWithCurrent(ADMIN_TRANSCODING_TONEMAPPING_ALGORITHMS, form.tonemappingAlgorithm);
    const modes = optionWithCurrent(ADMIN_TRANSCODING_TONEMAPPING_MODES, form.tonemappingMode);
    const ranges = optionWithCurrent(ADMIN_TRANSCODING_TONEMAPPING_RANGES, form.tonemappingRange);
    const supportsVpp = hardware === 'qsv' || hardware === 'vaapi';
    return (
        <AdminConfigurationPanel description='Convert HDR video for displays and clients that need SDR output.' title='Tone Mapping'>
            {supportsVpp ? <>
                <AdminConfigurationToggle checked={form.enableVppTonemapping} description='Use Intel VPP tone mapping when supported.' disabled={disabled} id='ptv-transcoding-vpp-tone' label='VPP tone mapping' onChange={value => update('enableVppTonemapping', value)} />
                <AdminConfigurationNumber description='VPP brightness adjustment.' disabled={disabled} error={numericError(form, 'vppTonemappingBrightness')} id='ptv-transcoding-vpp-brightness' label='VPP brightness' max={100} min={0} onChange={value => update('vppTonemappingBrightness', value)} step={0.00001} value={form.vppTonemappingBrightness} />
                <AdminConfigurationNumber description='VPP contrast adjustment.' disabled={disabled} error={numericError(form, 'vppTonemappingContrast')} id='ptv-transcoding-vpp-contrast' label='VPP contrast' max={2} min={1} onChange={value => update('vppTonemappingContrast', value)} step={0.00001} value={form.vppTonemappingContrast} />
            </> : null}
            {hardware === 'videotoolbox' ? <AdminConfigurationToggle checked={form.enableVideoToolboxTonemapping} description='Use Apple VideoToolbox tone mapping.' disabled={disabled} id='ptv-transcoding-videotoolbox-tone' label='VideoToolbox tone mapping' onChange={value => update('enableVideoToolboxTonemapping', value)} /> : null}
            {!softwareMode ? <AdminConfigurationToggle checked={form.enableTonemapping} description='Enable the general FFmpeg tone-mapping filter.' disabled={disabled} id='ptv-transcoding-tone' label='Tone mapping' onChange={value => update('enableTonemapping', value)} /> : null}
            <AdminConfigurationSelect description='Algorithm used by the general tone-mapping filter.' disabled={disabled || (!softwareMode && !form.enableTonemapping)} id='ptv-transcoding-tone-algorithm' label='Algorithm' onChange={value => update('tonemappingAlgorithm', value)} value={form.tonemappingAlgorithm}>{algorithms.map(value => <option key={value} value={value}>{labelEnum(value)}</option>)}</AdminConfigurationSelect>
            {!softwareMode ? <AdminConfigurationSelect description='Signal component used to calculate tone mapping.' disabled={disabled || !form.enableTonemapping} id='ptv-transcoding-tone-mode' label='Mode' onChange={value => update('tonemappingMode', value)} value={form.tonemappingMode}>{modes.map(value => <option key={value} value={value}>{value.toUpperCase()}</option>)}</AdminConfigurationSelect> : null}
            <AdminConfigurationSelect description='Output color range used for tone-mapped video.' disabled={disabled || (!softwareMode && !form.enableTonemapping)} id='ptv-transcoding-tone-range' label='Range' onChange={value => update('tonemappingRange', value)} value={form.tonemappingRange}>{ranges.map(value => <option key={value} value={value}>{value.toUpperCase()}</option>)}</AdminConfigurationSelect>
            <AdminConfigurationNumber description='Desaturate highlights above this threshold.' disabled={disabled || (!softwareMode && !form.enableTonemapping)} error={numericError(form, 'tonemappingDesat')} id='ptv-transcoding-tone-desat' label='Desaturation' min={0} onChange={value => update('tonemappingDesat', value)} step={0.00001} value={form.tonemappingDesat} />
            <AdminConfigurationNumber description='Override source peak brightness; zero preserves the configured value.' disabled={disabled || (!softwareMode && !form.enableTonemapping)} error={numericError(form, 'tonemappingPeak')} id='ptv-transcoding-tone-peak' label='Peak' min={0} onChange={value => update('tonemappingPeak', value)} step={0.00001} value={form.tonemappingPeak} />
            <AdminConfigurationNumber description='Algorithm-specific parameter.' disabled={disabled || (!softwareMode && !form.enableTonemapping)} error={numericError(form, 'tonemappingParam')} id='ptv-transcoding-tone-param' label='Parameter' min={0} onChange={value => update('tonemappingParam', value)} step={0.00001} value={form.tonemappingParam} />
        </AdminConfigurationPanel>
    );
}

export default function AdminTranscodingFields(props: FieldsProps) {
    return (
        <div className='ptv-admin-configuration-grid'>
            <HardwarePanel {...props} />
            <EncodingPanel {...props} />
            <StoragePanel {...props} />
            <details className='ptv-admin-playback-details'>
                <summary>Advanced Transcoding</summary>
                <div className='ptv-admin-playback-details-grid'>
                    <AudioAndProcessingPanel {...props} />
                    <ThrottlingPanel {...props} />
                    <ToneMappingPanel {...props} />
                </div>
            </details>
        </div>
    );
}
/* eslint-enable react/jsx-no-bind */
