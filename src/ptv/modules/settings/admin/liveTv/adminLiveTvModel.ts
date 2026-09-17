import type { LiveTvOptions } from '@jellyfin/sdk/lib/generated-client/models/live-tv-options';

export type AdminLiveTvAvailability = 'available' | 'unavailable' | 'unknown';
export type AdminLiveTvEditorKind = 'schedules-direct' | 'xmltv' | 'unknown';

export type AdminLiveTvDvrSettings = Readonly<{
    guideDays: number | null;
    movieRecordingPath: string | null;
    postPaddingSeconds: number;
    prePaddingSeconds: number;
    recordingPath: string | null;
    recordingPostProcessor: string | null;
    recordingPostProcessorArguments: string | null;
    saveRecordingImages: boolean;
    saveRecordingNfo: boolean;
    seriesRecordingPath: string | null;
}>;

/** A deliberately redacted projection. Provider passwords never enter UI data. */
export type AdminLiveTvGuideProvider = Readonly<{
    country: string | null;
    detail: string;
    editor: AdminLiveTvEditorKind;
    enableAllTuners: boolean;
    enabledTunerIds: readonly string[];
    hasStoredPassword: boolean;
    id: string;
    label: string;
    listingsId: string | null;
    kidsCategories: readonly string[];
    movieCategories: readonly string[];
    moviePrefix: string | null;
    newsCategories: readonly string[];
    pathConfigured: boolean;
    postalCode: string | null;
    type: string;
    username: string | null;
    sportsCategories: readonly string[];
    userAgent: string | null;
}>;

export type AdminLiveTvTuner = Readonly<{
    allowFmp4TranscodingContainer: boolean;
    allowHardwareTranscoding: boolean;
    allowStreamSharing: boolean;
    connectionConfigured: boolean;
    connectionSummary: string;
    deviceId: string | null;
    enableStreamLooping: boolean;
    fallbackMaxStreamingBitrate: number;
    friendlyName: string | null;
    id: string;
    ignoreDts: boolean;
    importFavoritesOnly: boolean;
    label: string;
    readAtNativeFramerate: boolean;
    source: string | null;
    tunerCount: number;
    type: string;
    userAgent: string | null;
}>;

export type AdminLiveTvConfigurationSnapshot = Readonly<{
    dvr: AdminLiveTvDvrSettings;
    providers: readonly AdminLiveTvGuideProvider[];
    tuners: readonly AdminLiveTvTuner[];
}>;

export type AdminLiveTvCapability = Readonly<{
    availability: AdminLiveTvAvailability;
    serviceCount: number | null;
}>;

export type AdminLiveTvTunerType = Readonly<{
    id: string;
    label: string;
}>;

export type AdminLiveTvTunerDraft = Omit<AdminLiveTvTuner,
    'connectionConfigured' | 'connectionSummary' | 'label'> & Readonly<{
        /** Existing secret-bearing URL stays service-side while this remains true. */
        preserveUrl: boolean;
        url: string | null;
    }>;

export type AdminLiveTvXmlTvDraft = Readonly<{
    enableAllTuners: boolean;
    enabledTunerIds: readonly string[];
    id: string;
    kidsCategories: readonly string[];
    movieCategories: readonly string[];
    moviePrefix: string | null;
    newsCategories: readonly string[];
    path: string;
    /** Existing secret-bearing path/URL stays service-side while this remains true. */
    preservePath: boolean;
    sportsCategories: readonly string[];
    userAgent: string | null;
}>;

export type AdminLiveTvSchedulesDirectAccountDraft = Readonly<{
    id: string;
    password: string;
    username: string;
}>;

export type AdminLiveTvSchedulesDirectListingDraft = Readonly<{
    country: string;
    enableAllTuners: boolean;
    enabledTunerIds: readonly string[];
    id: string;
    listingsId: string;
    postalCode: string;
}>;

export type AdminLiveTvLineup = Readonly<{
    id: string;
    label: string;
}>;

export type AdminLiveTvCountry = Readonly<{
    code: string;
    label: string;
}>;

/** Kept inside the service only; never pass this document to presentation code. */
export type AdminLiveTvConfigurationDocument = LiveTvOptions & Record<string, unknown>;

export type AdminLiveTvServiceErrorCode =
    | 'conflict'
    | 'invalid-input'
    | 'invalid-response'
    | 'load-unavailable'
    | 'not-found'
    | 'operation-failed'
    | 'save-confirmation-failed'
    | 'save-timeout'
    | 'state-changed';

/** User-safe Live TV error. Raw responses, server paths, and credentials are omitted. */
export class AdminLiveTvServiceError extends Error {
    public readonly code: AdminLiveTvServiceErrorCode;

    public constructor(code: AdminLiveTvServiceErrorCode, message: string) {
        super(message);
        this.code = code;
        this.name = 'AdminLiveTvServiceError';
    }
}
