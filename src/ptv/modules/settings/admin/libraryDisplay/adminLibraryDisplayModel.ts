import type { MetadataConfiguration } from '@jellyfin/sdk/lib/generated-client/models/metadata-configuration';
import type { ServerConfiguration } from '@jellyfin/sdk/lib/generated-client/models/server-configuration';

/** The six server-owned settings presented by PiggieTV Library Display. */
export type AdminLibraryDisplaySettings = Readonly<{
    displayFolderView: boolean;
    displaySpecialsWithinSeasons: boolean;
    groupMoviesIntoCollections: boolean;
    groupSeriesIntoCollections: boolean;
    includeExternalContentInSuggestions: boolean;
    useFileCreationTimeForDateAdded: boolean;
}>;

/**
 * One authoritative composite read. The raw documents are retained so writes
 * can preserve fields that are not managed by the Library Display page.
 */
export type AdminLibraryDisplaySnapshot = Readonly<{
    metadataConfiguration: MetadataConfiguration;
    serverConfiguration: ServerConfiguration;
    settings: AdminLibraryDisplaySettings;
}>;

export type AdminLibraryDisplayServiceErrorCode =
    | 'conflict'
    | 'invalid-response'
    | 'load-unavailable'
    | 'rollback-failed'
    | 'save-failed';

/** A user-safe error that never exposes a raw server response. */
export class AdminLibraryDisplayServiceError extends Error {
    public readonly code: AdminLibraryDisplayServiceErrorCode;

    public constructor(code: AdminLibraryDisplayServiceErrorCode, message: string) {
        super(message);
        this.code = code;
        this.name = 'AdminLibraryDisplayServiceError';
    }
}
