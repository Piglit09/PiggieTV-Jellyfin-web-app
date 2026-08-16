import type { CountryInfo } from '@jellyfin/sdk/lib/generated-client/models/country-info';
import type { CultureDto } from '@jellyfin/sdk/lib/generated-client/models/culture-dto';
import { ImageResolution } from '@jellyfin/sdk/lib/generated-client/models/image-resolution';
import type { ServerConfiguration } from '@jellyfin/sdk/lib/generated-client/models/server-configuration';
import { describe, expect, it } from 'vitest';

import {
    areAdminMetadataSettingsEqual,
    normalizeAdminMetadataCountries,
    normalizeAdminMetadataLanguages,
    normalizeAdminMetadataSettings,
    patchAdminMetadataConfiguration,
    requireAdminMetadataSettings
} from './adminMetadataAdapters';
import type { AdminMetadataSettings } from './adminMetadataModel';

function rawConfiguration(): ServerConfiguration {
    return {
        ChapterImageResolution: ImageResolution.P720,
        DummyChapterDuration: 300,
        MetadataCountryCode: 'US',
        PreferredMetadataLanguage: 'en'
    };
}

const settings: AdminMetadataSettings = {
    chapterImageResolution: ImageResolution.P720,
    dummyChapterDurationSeconds: 300,
    preferredCountryCode: 'US',
    preferredLanguage: 'en'
};

describe('administrator Metadata adapters', () => {
    it('normalizes the exact four global metadata values', () => {
        expect(normalizeAdminMetadataSettings({
            ...rawConfiguration(),
            ChapterImageResolution: ImageResolution.P720
        })).toEqual(settings);
    });

    it.each([
        'ChapterImageResolution',
        'DummyChapterDuration',
        'MetadataCountryCode',
        'PreferredMetadataLanguage'
    ] as const)('fails closed when %s is missing', field => {
        const configuration = rawConfiguration() as Record<string, unknown>;
        delete configuration[field];

        expect(() => normalizeAdminMetadataSettings(
            configuration as ServerConfiguration
        )).toThrowError(expect.objectContaining({ code: 'invalid-response' }));
    });

    it.each([
        [ 'ChapterImageResolution', 'P320' ],
        [ 'DummyChapterDuration', -1 ],
        [ 'DummyChapterDuration', 1.5 ],
        [ 'DummyChapterDuration', Number.NaN ],
        [ 'MetadataCountryCode', null ],
        [ 'PreferredMetadataLanguage', 1 ]
    ])('rejects malformed %s values', (field, value) => {
        expect(() => normalizeAdminMetadataSettings({
            ...rawConfiguration(),
            ChapterImageResolution: ImageResolution.P720,
            [field]: value
        })).toThrowError(expect.objectContaining({ code: 'invalid-response' }));
    });

    it.each(Object.values(ImageResolution))('accepts exact ImageResolution value %s', resolution => {
        expect(normalizeAdminMetadataSettings({
            ...rawConfiguration(),
            ChapterImageResolution: resolution
        }).chapterImageResolution).toBe(resolution);
    });

    it('accepts zero duration and preserves empty language/country strings', () => {
        expect(normalizeAdminMetadataSettings({
            ...rawConfiguration(),
            ChapterImageResolution: ImageResolution.MatchSource,
            DummyChapterDuration: 0,
            MetadataCountryCode: '',
            PreferredMetadataLanguage: ''
        })).toEqual({
            chapterImageResolution: ImageResolution.MatchSource,
            dummyChapterDurationSeconds: 0,
            preferredCountryCode: '',
            preferredLanguage: ''
        });
    });

    it('compares only the four owned values', () => {
        expect(areAdminMetadataSettingsEqual(settings, { ...settings })).toBe(true);
        expect(areAdminMetadataSettingsEqual(settings, {
            ...settings,
            dummyChapterDurationSeconds: 0
        })).toBe(false);
    });

    it('shallow-clones and patches only owned fields while preserving unknown data', () => {
        const nested = [{ plugin: true }];
        const raw = {
            ...rawConfiguration(),
            ChapterImageResolution: ImageResolution.P720,
            FutureField: 'preserved',
            MetadataOptions: nested
        } as ServerConfiguration;
        const desired = {
            ...settings,
            chapterImageResolution: ImageResolution.P1080,
            preferredCountryCode: 'CA'
        };

        const patched = patchAdminMetadataConfiguration(raw, desired);

        expect(patched).not.toBe(raw);
        expect(patched.ChapterImageResolution).toBe(ImageResolution.P1080);
        expect(patched.MetadataCountryCode).toBe('CA');
        expect(patched.MetadataOptions).toBe(nested);
        expect(Reflect.get(patched, 'FutureField')).toBe('preserved');
    });

    it('rejects malformed edited models before patching', () => {
        expect(() => requireAdminMetadataSettings({
            ...settings,
            dummyChapterDurationSeconds: -1
        })).toThrowError(expect.objectContaining({ code: 'invalid-response' }));
    });

    it('keeps an unavailable configured language without dropping catalog entries', () => {
        const cultures: CultureDto[] = [
            { DisplayName: 'English', TwoLetterISOLanguageName: 'en' },
            { DisplayName: 'French', TwoLetterISOLanguageName: 'fr' }
        ];

        expect(normalizeAdminMetadataLanguages(cultures, 'pt-BR')).toEqual([
            { available: false, label: 'pt-BR', value: 'pt-BR' },
            { available: true, label: 'English', value: 'en' },
            { available: true, label: 'French', value: 'fr' }
        ]);
    });

    it('keeps an unavailable empty configured value without assigning semantics', () => {
        expect(normalizeAdminMetadataLanguages([], '')).toEqual([
            { available: false, label: 'Empty server value', value: '' }
        ]);
    });

    it('keeps a configured country while filtering malformed and duplicate options', () => {
        const countries: CountryInfo[] = [
            { DisplayName: 'United States', TwoLetterISORegionName: 'US' },
            { DisplayName: 'Duplicate', TwoLetterISORegionName: 'US' },
            { DisplayName: 'Missing code', TwoLetterISORegionName: null },
            { DisplayName: null, TwoLetterISORegionName: 'CA' }
        ];

        expect(normalizeAdminMetadataCountries(countries, 'ZZ')).toEqual([
            { available: false, label: 'ZZ', value: 'ZZ' },
            { available: true, label: 'United States', value: 'US' },
            { available: true, label: 'CA', value: 'CA' }
        ]);
    });
});
