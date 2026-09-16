import type { CountryInfo } from '@jellyfin/sdk/lib/generated-client/models/country-info';
import type { CultureDto } from '@jellyfin/sdk/lib/generated-client/models/culture-dto';
import { ImageResolution } from '@jellyfin/sdk/lib/generated-client/models/image-resolution';
import type { ServerConfiguration } from '@jellyfin/sdk/lib/generated-client/models/server-configuration';

import {
    AdminMetadataServiceError,
    type AdminMetadataCatalogOption,
    type AdminMetadataSettings,
    type AdminMetadataSnapshot
} from './adminMetadataModel';

const IMAGE_RESOLUTIONS = new Set<string>(Object.values(ImageResolution));

function invalidMetadataSettings(): never {
    throw new AdminMetadataServiceError(
        'invalid-response',
        'Metadata settings are unavailable.'
    );
}

function requireDocument(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        invalidMetadataSettings();
    }
}

function requireString(value: unknown) {
    if (typeof value !== 'string') invalidMetadataSettings();
    return value;
}

function requireDuration(value: unknown) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        invalidMetadataSettings();
    }
    return value;
}

function requireImageResolution(value: unknown) {
    if (typeof value !== 'string' || !IMAGE_RESOLUTIONS.has(value)) {
        invalidMetadataSettings();
    }
    return value as ImageResolution;
}

/** Converts the full Jellyfin configuration into the strict four-field model. */
export function normalizeAdminMetadataSettings(
    serverConfiguration: ServerConfiguration
): AdminMetadataSettings {
    requireDocument(serverConfiguration);
    return {
        chapterImageResolution: requireImageResolution(serverConfiguration.ChapterImageResolution),
        dummyChapterDurationSeconds: requireDuration(serverConfiguration.DummyChapterDuration),
        preferredCountryCode: requireString(serverConfiguration.MetadataCountryCode),
        preferredLanguage: requireString(serverConfiguration.PreferredMetadataLanguage)
    };
}

export function createAdminMetadataSnapshot(
    serverConfiguration: ServerConfiguration
): AdminMetadataSnapshot {
    return {
        serverConfiguration,
        settings: normalizeAdminMetadataSettings(serverConfiguration)
    };
}

/** Validates edited input before any comparison or persistence. */
export function requireAdminMetadataSettings(
    settings: AdminMetadataSettings
): AdminMetadataSettings {
    requireDocument(settings);
    requireImageResolution(settings.chapterImageResolution);
    requireDuration(settings.dummyChapterDurationSeconds);
    requireString(settings.preferredCountryCode);
    requireString(settings.preferredLanguage);
    return settings;
}

export function areAdminMetadataSettingsEqual(
    left: AdminMetadataSettings,
    right: AdminMetadataSettings
) {
    return (
        left.chapterImageResolution === right.chapterImageResolution
        && left.dummyChapterDurationSeconds === right.dummyChapterDurationSeconds
        && left.preferredCountryCode === right.preferredCountryCode
        && left.preferredLanguage === right.preferredLanguage
    );
}

/** Shallow-clones the authoritative document and patches only owned fields. */
export function patchAdminMetadataConfiguration(
    serverConfiguration: ServerConfiguration,
    settings: AdminMetadataSettings
): ServerConfiguration {
    requireDocument(serverConfiguration);
    requireAdminMetadataSettings(settings);
    return {
        ...serverConfiguration,
        ChapterImageResolution: settings.chapterImageResolution,
        DummyChapterDuration: settings.dummyChapterDurationSeconds,
        MetadataCountryCode: settings.preferredCountryCode,
        PreferredMetadataLanguage: settings.preferredLanguage
    };
}

function catalogText(value: unknown) {
    return typeof value === 'string' && value.trim() ? value : null;
}

function normalizeCatalog(
    values: readonly Readonly<{ label: unknown; value: unknown }>[],
    configuredValue: string
): readonly AdminMetadataCatalogOption[] {
    const options: AdminMetadataCatalogOption[] = [];
    const seen = new Set<string>();
    values.forEach(item => {
        const value = catalogText(item.value);
        if (!value || seen.has(value)) return;
        seen.add(value);
        options.push({
            available: true,
            label: catalogText(item.label) || value,
            value
        });
    });

    if (!seen.has(configuredValue)) {
        options.unshift({
            available: false,
            label: configuredValue || 'Empty server value',
            value: configuredValue
        });
    }
    return options;
}

/** Retains the configured language even when discovery no longer returns it. */
export function normalizeAdminMetadataLanguages(
    cultures: readonly CultureDto[],
    configuredLanguage: string
) {
    return normalizeCatalog(cultures.map(culture => ({
        label: culture.DisplayName,
        value: culture.TwoLetterISOLanguageName
    })), requireString(configuredLanguage));
}

/** Retains the configured country even when discovery no longer returns it. */
export function normalizeAdminMetadataCountries(
    countries: readonly CountryInfo[],
    configuredCountryCode: string
) {
    return normalizeCatalog(countries.map(country => ({
        label: country.DisplayName,
        value: country.TwoLetterISORegionName
    })), requireString(configuredCountryCode));
}
