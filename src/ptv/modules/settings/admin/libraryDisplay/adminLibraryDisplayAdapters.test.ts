import type { MetadataConfiguration } from '@jellyfin/sdk/lib/generated-client/models/metadata-configuration';
import type { ServerConfiguration } from '@jellyfin/sdk/lib/generated-client/models/server-configuration';
import { describe, expect, it } from 'vitest';

import {
    areAdminLibraryDisplaySettingsEqual,
    createAdminLibraryDisplaySnapshot,
    normalizeAdminLibraryDisplaySettings,
    patchAdminLibraryDisplayDocuments
} from './adminLibraryDisplayAdapters';
import {
    AdminLibraryDisplayServiceError,
    type AdminLibraryDisplaySettings
} from './adminLibraryDisplayModel';

function rawServer(): ServerConfiguration {
    return {
        DisplaySpecialsWithinSeasons: true,
        EnableExternalContentInSuggestions: false,
        EnableFolderView: false,
        EnableGroupingMoviesIntoCollections: true,
        EnableGroupingShowsIntoCollections: false
    };
}

function rawMetadata(): MetadataConfiguration {
    return { UseFileCreationTimeForDateAdded: true };
}

const settings: AdminLibraryDisplaySettings = {
    displayFolderView: false,
    displaySpecialsWithinSeasons: true,
    groupMoviesIntoCollections: true,
    groupSeriesIntoCollections: false,
    includeExternalContentInSuggestions: false,
    useFileCreationTimeForDateAdded: true
};

describe('administrator Library Display adapters', () => {
    it('normalizes the exact six backend booleans without changing false values', () => {
        expect(normalizeAdminLibraryDisplaySettings(rawServer(), rawMetadata())).toEqual(settings);
    });

    it.each([
        'EnableFolderView',
        'DisplaySpecialsWithinSeasons',
        'EnableGroupingMoviesIntoCollections',
        'EnableGroupingShowsIntoCollections',
        'EnableExternalContentInSuggestions'
    ] as const)('fails closed when server field %s is missing', field => {
        const server = rawServer() as Record<string, unknown>;
        delete server[field];

        expect(() => normalizeAdminLibraryDisplaySettings(
            server as ServerConfiguration,
            rawMetadata()
        )).toThrowError(expect.objectContaining({
            code: 'invalid-response'
        } satisfies Partial<AdminLibraryDisplayServiceError>));
    });

    it.each([ null, undefined, 0, 'false' ])(
        'fails closed for malformed named metadata value %s',
        value => {
            expect(() => normalizeAdminLibraryDisplaySettings(rawServer(), {
                UseFileCreationTimeForDateAdded: value
            } as MetadataConfiguration)).toThrowError(expect.objectContaining({
                code: 'invalid-response'
            } satisfies Partial<AdminLibraryDisplayServiceError>));
        }
    );

    it('retains both authoritative documents in a composite snapshot', () => {
        const server = rawServer();
        const metadata = rawMetadata();
        const snapshot = createAdminLibraryDisplaySnapshot(server, metadata);

        expect(snapshot.serverConfiguration).toBe(server);
        expect(snapshot.metadataConfiguration).toBe(metadata);
        expect(snapshot.settings).toEqual(settings);
    });

    it('shallow-clones documents while preserving unknown fields and nested references', () => {
        const nestedServerValue = [{ plugin: 'preserved' }];
        const nestedMetadataValue = { future: true };
        const server = {
            ...rawServer(),
            FutureServerField: 'keep',
            MetadataOptions: nestedServerValue
        } as ServerConfiguration;
        const metadata = {
            ...rawMetadata(),
            PluginField: nestedMetadataValue
        } as MetadataConfiguration;
        const desired = {
            ...settings,
            groupMoviesIntoCollections: false,
            useFileCreationTimeForDateAdded: false
        };

        const patched = patchAdminLibraryDisplayDocuments(server, metadata, desired);

        expect(patched.serverConfiguration).not.toBe(server);
        expect(patched.metadataConfiguration).not.toBe(metadata);
        expect(patched.serverConfiguration.MetadataOptions).toBe(nestedServerValue);
        expect(Reflect.get(patched.serverConfiguration, 'FutureServerField')).toBe('keep');
        expect(Reflect.get(patched.metadataConfiguration, 'PluginField')).toBe(nestedMetadataValue);
        expect(server.EnableGroupingMoviesIntoCollections).toBe(true);
        expect(metadata.UseFileCreationTimeForDateAdded).toBe(true);
    });

    it('compares all six normalized values', () => {
        expect(areAdminLibraryDisplaySettingsEqual(settings, { ...settings })).toBe(true);
        expect(areAdminLibraryDisplaySettingsEqual(settings, {
            ...settings,
            displayFolderView: true
        })).toBe(false);
        expect(areAdminLibraryDisplaySettingsEqual(settings, {
            ...settings,
            useFileCreationTimeForDateAdded: false
        })).toBe(false);
    });

    it('rejects a wrong six-boolean object instead of patching undefined values', () => {
        expect(() => patchAdminLibraryDisplayDocuments(
            rawServer(),
            rawMetadata(),
            {
                five: true,
                four: false,
                one: true,
                six: false,
                three: false,
                two: true
            } as unknown as AdminLibraryDisplaySettings
        )).toThrowError(expect.objectContaining({ code: 'invalid-response' }));
    });
});
