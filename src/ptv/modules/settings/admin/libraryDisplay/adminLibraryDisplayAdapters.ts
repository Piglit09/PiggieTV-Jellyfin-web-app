import type { MetadataConfiguration } from '@jellyfin/sdk/lib/generated-client/models/metadata-configuration';
import type { ServerConfiguration } from '@jellyfin/sdk/lib/generated-client/models/server-configuration';

import {
    AdminLibraryDisplayServiceError,
    type AdminLibraryDisplaySettings,
    type AdminLibraryDisplaySnapshot
} from './adminLibraryDisplayModel';

const SERVER_FIELDS = [
    'displayFolderView',
    'displaySpecialsWithinSeasons',
    'groupMoviesIntoCollections',
    'groupSeriesIntoCollections',
    'includeExternalContentInSuggestions'
] as const satisfies readonly (keyof AdminLibraryDisplaySettings)[];

function requireDocument(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new AdminLibraryDisplayServiceError(
            'invalid-response',
            'Library display settings are unavailable.'
        );
    }
}

function requireBoolean(value: unknown): boolean {
    if (typeof value !== 'boolean') {
        throw new AdminLibraryDisplayServiceError(
            'invalid-response',
            'Library display settings are unavailable.'
        );
    }
    return value;
}

/** Converts both Jellyfin configuration documents into one strict UI model. */
export function normalizeAdminLibraryDisplaySettings(
    serverConfiguration: ServerConfiguration,
    metadataConfiguration: MetadataConfiguration
): AdminLibraryDisplaySettings {
    requireDocument(serverConfiguration);
    requireDocument(metadataConfiguration);

    return {
        displayFolderView: requireBoolean(serverConfiguration.EnableFolderView),
        displaySpecialsWithinSeasons: requireBoolean(serverConfiguration.DisplaySpecialsWithinSeasons),
        groupMoviesIntoCollections: requireBoolean(serverConfiguration.EnableGroupingMoviesIntoCollections),
        groupSeriesIntoCollections: requireBoolean(serverConfiguration.EnableGroupingShowsIntoCollections),
        includeExternalContentInSuggestions: requireBoolean(
            serverConfiguration.EnableExternalContentInSuggestions
        ),
        useFileCreationTimeForDateAdded: requireBoolean(
            metadataConfiguration.UseFileCreationTimeForDateAdded
        )
    };
}

export function createAdminLibraryDisplaySnapshot(
    serverConfiguration: ServerConfiguration,
    metadataConfiguration: MetadataConfiguration
): AdminLibraryDisplaySnapshot {
    return {
        metadataConfiguration,
        serverConfiguration,
        settings: normalizeAdminLibraryDisplaySettings(serverConfiguration, metadataConfiguration)
    };
}

/** Validates UI input before it is considered for persistence. */
export function requireAdminLibraryDisplaySettings(
    settings: AdminLibraryDisplaySettings
): AdminLibraryDisplaySettings {
    requireDocument(settings);
    if (
        typeof settings.useFileCreationTimeForDateAdded !== 'boolean'
        || SERVER_FIELDS.some(field => typeof settings[field] !== 'boolean')
    ) {
        throw new AdminLibraryDisplayServiceError(
            'invalid-response',
            'Library display settings are unavailable.'
        );
    }
    return settings;
}

export function areAdminLibraryDisplaySettingsEqual(
    left: AdminLibraryDisplaySettings,
    right: AdminLibraryDisplaySettings
) {
    return (
        left.useFileCreationTimeForDateAdded === right.useFileCreationTimeForDateAdded
        && SERVER_FIELDS.every(field => left[field] === right[field])
    );
}

export function hasAdminLibraryDisplayServerChanges(
    current: AdminLibraryDisplaySettings,
    desired: AdminLibraryDisplaySettings
) {
    return SERVER_FIELDS.some(field => current[field] !== desired[field]);
}

export function hasAdminLibraryDisplayMetadataChanges(
    current: AdminLibraryDisplaySettings,
    desired: AdminLibraryDisplaySettings
) {
    return current.useFileCreationTimeForDateAdded !== desired.useFileCreationTimeForDateAdded;
}

/**
 * Shallow-clones both authoritative documents and patches only the six owned
 * fields. Unmanaged fields and nested references remain untouched.
 */
export function patchAdminLibraryDisplayDocuments(
    serverConfiguration: ServerConfiguration,
    metadataConfiguration: MetadataConfiguration,
    settings: AdminLibraryDisplaySettings
) {
    requireAdminLibraryDisplaySettings(settings);
    const nextServerConfiguration: ServerConfiguration = {
        ...serverConfiguration,
        DisplaySpecialsWithinSeasons: settings.displaySpecialsWithinSeasons,
        EnableExternalContentInSuggestions: settings.includeExternalContentInSuggestions,
        EnableFolderView: settings.displayFolderView,
        EnableGroupingMoviesIntoCollections: settings.groupMoviesIntoCollections,
        EnableGroupingShowsIntoCollections: settings.groupSeriesIntoCollections
    };
    const nextMetadataConfiguration: MetadataConfiguration = {
        ...metadataConfiguration,
        UseFileCreationTimeForDateAdded: settings.useFileCreationTimeForDateAdded
    };

    return {
        metadataConfiguration: nextMetadataConfiguration,
        serverConfiguration: nextServerConfiguration
    } as const;
}
