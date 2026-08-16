import { ProcessPriorityClass } from '@jellyfin/sdk/lib/generated-client/models/process-priority-class';
import type { ServerConfiguration } from '@jellyfin/sdk/lib/generated-client/models/server-configuration';
import { TrickplayScanBehavior } from '@jellyfin/sdk/lib/generated-client/models/trickplay-scan-behavior';

import {
    AdminPlaybackServiceError,
    type AdminResumeSettings,
    type AdminResumeSnapshot,
    type AdminStreamingForm,
    type AdminStreamingSettings,
    type AdminStreamingSnapshot,
    type AdminTrickplaySettings,
    type AdminTrickplaySnapshot
} from './adminPlaybackSettingsModel';

const BITS_PER_MEGABIT = 1_000_000;
const INT32_MAX = 2_147_483_647;
const PROCESS_PRIORITIES = new Set<string>([
    ProcessPriorityClass.High,
    ProcessPriorityClass.AboveNormal,
    ProcessPriorityClass.Normal,
    ProcessPriorityClass.BelowNormal,
    ProcessPriorityClass.Idle
]);
const SCAN_BEHAVIORS = new Set<string>(Object.values(TrickplayScanBehavior));

function invalidResponse(section: string): never {
    throw new AdminPlaybackServiceError(
        'invalid-response',
        `${section} settings are unavailable.`
    );
}

function invalidInput(section: string): never {
    throw new AdminPlaybackServiceError(
        'invalid-input',
        `${section} settings contain an invalid value.`
    );
}

function requireDocument(value: unknown, section: string) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        invalidResponse(section);
    }
}

function requireInteger(value: unknown, section: string, minimum: number, maximum = INT32_MAX) {
    if (
        typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value < minimum
        || value > maximum
    ) {
        invalidResponse(section);
    }
    return value;
}

function requireInputInteger(value: unknown, section: string, minimum: number, maximum = INT32_MAX) {
    if (
        typeof value !== 'number'
        || !Number.isSafeInteger(value)
        || value < minimum
        || value > maximum
    ) {
        invalidInput(section);
    }
    return value;
}

function requireBoolean(value: unknown, section: string) {
    if (typeof value !== 'boolean') invalidResponse(section);
    return value;
}

function requireInputBoolean(value: unknown, section: string) {
    if (typeof value !== 'boolean') invalidInput(section);
    return value;
}

/** Strictly normalizes the server's bits-per-second limit. Zero is unlimited. */
export function normalizeAdminStreamingSettings(
    serverConfiguration: ServerConfiguration
): AdminStreamingSettings {
    requireDocument(serverConfiguration, 'Streaming');
    return {
        remoteBitrateLimitBitsPerSecond: requireInteger(
            serverConfiguration.RemoteClientBitrateLimit,
            'Streaming',
            0
        )
    };
}

export function createAdminStreamingSnapshot(
    serverConfiguration: ServerConfiguration
): AdminStreamingSnapshot {
    return {
        serverConfiguration,
        settings: normalizeAdminStreamingSettings(serverConfiguration)
    };
}

export function requireAdminStreamingSettings(settings: AdminStreamingSettings) {
    requireDocument(settings, 'Streaming');
    requireInputInteger(settings.remoteBitrateLimitBitsPerSecond, 'Streaming', 0);
    return settings;
}

export function areAdminStreamingSettingsEqual(
    left: AdminStreamingSettings,
    right: AdminStreamingSettings
) {
    return left.remoteBitrateLimitBitsPerSecond === right.remoteBitrateLimitBitsPerSecond;
}

export function adminStreamingSettingsToForm(
    settings: AdminStreamingSettings
): AdminStreamingForm {
    requireAdminStreamingSettings(settings);
    return {
        remoteBitrateLimitMbps: settings.remoteBitrateLimitBitsPerSecond / BITS_PER_MEGABIT
    };
}

/** Converts decimal Mbps to Jellyfin's integer bits-per-second value. */
export function adminStreamingFormToSettings(
    form: AdminStreamingForm
): AdminStreamingSettings {
    requireDocument(form, 'Streaming');
    const megabits = form.remoteBitrateLimitMbps;
    if (typeof megabits !== 'number' || !Number.isFinite(megabits) || megabits < 0) {
        invalidInput('Streaming');
    }
    const bits = Math.trunc(megabits * BITS_PER_MEGABIT);
    if (!Number.isSafeInteger(bits) || bits > INT32_MAX) invalidInput('Streaming');
    return { remoteBitrateLimitBitsPerSecond: bits };
}

export function patchAdminStreamingConfiguration(
    serverConfiguration: ServerConfiguration,
    settings: AdminStreamingSettings
): ServerConfiguration {
    requireDocument(serverConfiguration, 'Streaming');
    requireAdminStreamingSettings(settings);
    const patched = cloneServerConfiguration(serverConfiguration);
    patched.RemoteClientBitrateLimit = settings.remoteBitrateLimitBitsPerSecond;
    return patched;
}

export function normalizeAdminResumeSettings(
    serverConfiguration: ServerConfiguration
): AdminResumeSettings {
    requireDocument(serverConfiguration, 'Resume');
    return {
        audiobookCompletionRemainingMinutes: requireInteger(
            serverConfiguration.MaxAudiobookResume,
            'Resume',
            0
        ),
        audiobookMinimumElapsedMinutes: requireInteger(
            serverConfiguration.MinAudiobookResume,
            'Resume',
            0
        ),
        maximumResumePercentage: requireInteger(serverConfiguration.MaxResumePct, 'Resume', 0, 100),
        minimumEligibleDurationSeconds: requireInteger(
            serverConfiguration.MinResumeDurationSeconds,
            'Resume',
            0
        ),
        minimumResumePercentage: requireInteger(serverConfiguration.MinResumePct, 'Resume', 0, 100)
    };
}

export function createAdminResumeSnapshot(
    serverConfiguration: ServerConfiguration
): AdminResumeSnapshot {
    return {
        serverConfiguration,
        settings: normalizeAdminResumeSettings(serverConfiguration)
    };
}

export function requireAdminResumeSettings(settings: AdminResumeSettings) {
    requireDocument(settings, 'Resume');
    requireInputInteger(settings.audiobookCompletionRemainingMinutes, 'Resume', 0);
    requireInputInteger(settings.audiobookMinimumElapsedMinutes, 'Resume', 0);
    requireInputInteger(settings.maximumResumePercentage, 'Resume', 0, 100);
    requireInputInteger(settings.minimumEligibleDurationSeconds, 'Resume', 0);
    requireInputInteger(settings.minimumResumePercentage, 'Resume', 0, 100);
    if (settings.minimumResumePercentage >= settings.maximumResumePercentage) {
        invalidInput('Resume');
    }
    return settings;
}

export function areAdminResumeSettingsEqual(
    left: AdminResumeSettings,
    right: AdminResumeSettings
) {
    return (
        left.audiobookCompletionRemainingMinutes === right.audiobookCompletionRemainingMinutes
        && left.audiobookMinimumElapsedMinutes === right.audiobookMinimumElapsedMinutes
        && left.maximumResumePercentage === right.maximumResumePercentage
        && left.minimumEligibleDurationSeconds === right.minimumEligibleDurationSeconds
        && left.minimumResumePercentage === right.minimumResumePercentage
    );
}

export function patchAdminResumeConfiguration(
    serverConfiguration: ServerConfiguration,
    settings: AdminResumeSettings
): ServerConfiguration {
    requireDocument(serverConfiguration, 'Resume');
    requireAdminResumeSettings(settings);
    const patched = cloneServerConfiguration(serverConfiguration);
    patched.MaxAudiobookResume = settings.audiobookCompletionRemainingMinutes;
    patched.MaxResumePct = settings.maximumResumePercentage;
    patched.MinAudiobookResume = settings.audiobookMinimumElapsedMinutes;
    patched.MinResumeDurationSeconds = settings.minimumEligibleDurationSeconds;
    patched.MinResumePct = settings.minimumResumePercentage;
    return patched;
}

function requireProcessPriority(value: unknown) {
    if (typeof value !== 'string' || !PROCESS_PRIORITIES.has(value)) {
        invalidResponse('Trickplay');
    }
    return value as AdminTrickplaySettings['processPriority'];
}

function requireInputProcessPriority(value: unknown) {
    if (typeof value !== 'string' || !PROCESS_PRIORITIES.has(value)) {
        invalidInput('Trickplay');
    }
    return value as AdminTrickplaySettings['processPriority'];
}

function requireScanBehavior(value: unknown) {
    if (typeof value !== 'string' || !SCAN_BEHAVIORS.has(value)) {
        invalidResponse('Trickplay');
    }
    return value as AdminTrickplaySettings['scanBehavior'];
}

function requireInputScanBehavior(value: unknown) {
    if (typeof value !== 'string' || !SCAN_BEHAVIORS.has(value)) {
        invalidInput('Trickplay');
    }
    return value as AdminTrickplaySettings['scanBehavior'];
}

function requireWidths(value: unknown, input = false): readonly number[] {
    const fail = input ? invalidInput : invalidResponse;
    if (
        !Array.isArray(value)
        || value.length === 0
        || value.some(width => !Number.isSafeInteger(width) || width <= 0 || width > INT32_MAX)
    ) {
        fail('Trickplay');
    }
    return value as number[];
}

export function normalizeAdminTrickplaySettings(
    serverConfiguration: ServerConfiguration
): AdminTrickplaySettings {
    requireDocument(serverConfiguration, 'Trickplay');
    const options = serverConfiguration.TrickplayOptions;
    requireDocument(options, 'Trickplay');
    return {
        enableHardwareDecoding: requireBoolean(options?.EnableHwAcceleration, 'Trickplay'),
        enableHardwareEncoding: requireBoolean(options?.EnableHwEncoding, 'Trickplay'),
        enableKeyFrameOnlyExtraction: requireBoolean(options?.EnableKeyFrameOnlyExtraction, 'Trickplay'),
        imageIntervalMilliseconds: requireInteger(options?.Interval, 'Trickplay', 1_000),
        jpegQuality: requireInteger(options?.JpegQuality, 'Trickplay', 1, 100),
        processPriority: requireProcessPriority(options?.ProcessPriority),
        processThreads: requireInteger(options?.ProcessThreads, 'Trickplay', 0),
        qscale: requireInteger(options?.Qscale, 'Trickplay', 2, 31),
        scanBehavior: requireScanBehavior(options?.ScanBehavior),
        tileHeight: requireInteger(options?.TileHeight, 'Trickplay', 1),
        tileWidth: requireInteger(options?.TileWidth, 'Trickplay', 1),
        widthResolutionsPixels: requireWidths(options?.WidthResolutions)
    };
}

export function createAdminTrickplaySnapshot(
    serverConfiguration: ServerConfiguration
): AdminTrickplaySnapshot {
    return {
        serverConfiguration,
        settings: normalizeAdminTrickplaySettings(serverConfiguration)
    };
}

export function requireAdminTrickplaySettings(settings: AdminTrickplaySettings) {
    requireDocument(settings, 'Trickplay');
    requireInputBoolean(settings.enableHardwareDecoding, 'Trickplay');
    requireInputBoolean(settings.enableHardwareEncoding, 'Trickplay');
    requireInputBoolean(settings.enableKeyFrameOnlyExtraction, 'Trickplay');
    requireInputInteger(settings.imageIntervalMilliseconds, 'Trickplay', 1_000);
    requireInputInteger(settings.jpegQuality, 'Trickplay', 1, 100);
    requireInputProcessPriority(settings.processPriority);
    requireInputInteger(settings.processThreads, 'Trickplay', 0);
    requireInputInteger(settings.qscale, 'Trickplay', 2, 31);
    requireInputScanBehavior(settings.scanBehavior);
    requireInputInteger(settings.tileHeight, 'Trickplay', 1);
    requireInputInteger(settings.tileWidth, 'Trickplay', 1);
    requireWidths(settings.widthResolutionsPixels, true);
    return settings;
}

export function areAdminTrickplaySettingsEqual(
    left: AdminTrickplaySettings,
    right: AdminTrickplaySettings
) {
    return (
        left.enableHardwareDecoding === right.enableHardwareDecoding
        && left.enableHardwareEncoding === right.enableHardwareEncoding
        && left.enableKeyFrameOnlyExtraction === right.enableKeyFrameOnlyExtraction
        && left.imageIntervalMilliseconds === right.imageIntervalMilliseconds
        && left.jpegQuality === right.jpegQuality
        && left.processPriority === right.processPriority
        && left.processThreads === right.processThreads
        && left.qscale === right.qscale
        && left.scanBehavior === right.scanBehavior
        && left.tileHeight === right.tileHeight
        && left.tileWidth === right.tileWidth
        && left.widthResolutionsPixels.length === right.widthResolutionsPixels.length
        && left.widthResolutionsPixels.every((width, index) => width === right.widthResolutionsPixels[index])
    );
}

export function patchAdminTrickplayConfiguration(
    serverConfiguration: ServerConfiguration,
    settings: AdminTrickplaySettings
): ServerConfiguration {
    requireDocument(serverConfiguration, 'Trickplay');
    requireDocument(serverConfiguration.TrickplayOptions, 'Trickplay');
    requireAdminTrickplaySettings(settings);
    const patched = cloneServerConfiguration(serverConfiguration);
    const options = patched.TrickplayOptions;
    if (!options) invalidResponse('Trickplay');
    requireDocument(options, 'Trickplay');
    options.EnableHwAcceleration = settings.enableHardwareDecoding;
    options.EnableHwEncoding = settings.enableHardwareEncoding;
    options.EnableKeyFrameOnlyExtraction = settings.enableKeyFrameOnlyExtraction;
    options.Interval = settings.imageIntervalMilliseconds;
    options.JpegQuality = settings.jpegQuality;
    options.ProcessPriority = settings.processPriority;
    options.ProcessThreads = settings.processThreads;
    options.Qscale = settings.qscale;
    options.ScanBehavior = settings.scanBehavior;
    options.TileHeight = settings.tileHeight;
    options.TileWidth = settings.tileWidth;
    options.WidthResolutions = [ ...settings.widthResolutionsPixels ];
    return patched;
}

/** Jellyfin configuration responses are JSON documents; clone before patching. */
function cloneServerConfiguration(configuration: ServerConfiguration): ServerConfiguration {
    return JSON.parse(JSON.stringify(configuration)) as ServerConfiguration;
}
