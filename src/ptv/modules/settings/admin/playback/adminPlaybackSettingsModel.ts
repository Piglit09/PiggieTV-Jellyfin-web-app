import type { ProcessPriorityClass } from '@jellyfin/sdk/lib/generated-client/models/process-priority-class';
import type { ServerConfiguration } from '@jellyfin/sdk/lib/generated-client/models/server-configuration';
import type { TrickplayScanBehavior } from '@jellyfin/sdk/lib/generated-client/models/trickplay-scan-behavior';

/** Server-wide remote streaming limits. Zero means unlimited in Jellyfin. */
export type AdminStreamingSettings = Readonly<{
    remoteBitrateLimitBitsPerSecond: number;
}>;

/** Human-friendly streaming form values. Zero Mbps means unlimited. */
export type AdminStreamingForm = Readonly<{
    remoteBitrateLimitMbps: number;
}>;

export type AdminResumeSettings = Readonly<{
    audiobookCompletionRemainingMinutes: number;
    audiobookMinimumElapsedMinutes: number;
    maximumResumePercentage: number;
    minimumEligibleDurationSeconds: number;
    minimumResumePercentage: number;
}>;

export type AdminTrickplaySettings = Readonly<{
    enableHardwareDecoding: boolean;
    enableHardwareEncoding: boolean;
    enableKeyFrameOnlyExtraction: boolean;
    imageIntervalMilliseconds: number;
    jpegQuality: number;
    processPriority: ProcessPriorityClass;
    processThreads: number;
    qscale: number;
    scanBehavior: TrickplayScanBehavior;
    tileHeight: number;
    tileWidth: number;
    widthResolutionsPixels: readonly number[];
}>;

export type AdminStreamingSnapshot = Readonly<{
    serverConfiguration: ServerConfiguration;
    settings: AdminStreamingSettings;
}>;

export type AdminResumeSnapshot = Readonly<{
    serverConfiguration: ServerConfiguration;
    settings: AdminResumeSettings;
}>;

export type AdminTrickplaySnapshot = Readonly<{
    serverConfiguration: ServerConfiguration;
    settings: AdminTrickplaySettings;
}>;

export type AdminPlaybackServiceErrorCode =
    | 'conflict'
    | 'invalid-input'
    | 'invalid-response'
    | 'load-unavailable'
    | 'save-failed';

/** A user-safe error that never exposes raw configuration or server details. */
export class AdminPlaybackServiceError extends Error {
    public readonly code: AdminPlaybackServiceErrorCode;

    public constructor(code: AdminPlaybackServiceErrorCode, message: string) {
        super(message);
        this.code = code;
        this.name = 'AdminPlaybackServiceError';
    }
}
