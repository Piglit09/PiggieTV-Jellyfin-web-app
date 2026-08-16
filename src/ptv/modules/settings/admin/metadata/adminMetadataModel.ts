import type { ImageResolution } from '@jellyfin/sdk/lib/generated-client/models/image-resolution';
import type { ServerConfiguration } from '@jellyfin/sdk/lib/generated-client/models/server-configuration';

/** The four global metadata defaults owned by the native Metadata page. */
export type AdminMetadataSettings = Readonly<{
    chapterImageResolution: ImageResolution;
    dummyChapterDurationSeconds: number;
    preferredCountryCode: string;
    preferredLanguage: string;
}>;

/**
 * The complete server document is retained so an update can preserve every
 * field that is outside the Metadata page's ownership.
 */
export type AdminMetadataSnapshot = Readonly<{
    serverConfiguration: ServerConfiguration;
    settings: AdminMetadataSettings;
}>;

export type AdminMetadataCatalogOption = Readonly<{
    available: boolean;
    label: string;
    value: string;
}>;

export type AdminMetadataServiceErrorCode =
    | 'conflict'
    | 'countries-unavailable'
    | 'cultures-unavailable'
    | 'invalid-response'
    | 'load-unavailable'
    | 'save-failed';

/** A user-safe error that does not include raw server responses. */
export class AdminMetadataServiceError extends Error {
    public readonly code: AdminMetadataServiceErrorCode;

    public constructor(code: AdminMetadataServiceErrorCode, message: string) {
        super(message);
        this.code = code;
        this.name = 'AdminMetadataServiceError';
    }
}
