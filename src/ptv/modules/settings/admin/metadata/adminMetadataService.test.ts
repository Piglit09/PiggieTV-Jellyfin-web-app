import type { Api } from '@jellyfin/sdk';
import { ImageResolution } from '@jellyfin/sdk/lib/generated-client/models/image-resolution';
import type { ServerConfiguration } from '@jellyfin/sdk/lib/generated-client/models/server-configuration';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
    getConfiguration: vi.fn(),
    getCountries: vi.fn(),
    getCultures: vi.fn(),
    updateConfiguration: vi.fn()
}));

vi.mock('@jellyfin/sdk/lib/utils/api/configuration-api', () => ({
    getConfigurationApi: () => ({
        getConfiguration: apiMocks.getConfiguration,
        updateConfiguration: apiMocks.updateConfiguration
    })
}));
vi.mock('@jellyfin/sdk/lib/utils/api/localization-api', () => ({
    getLocalizationApi: () => ({
        getCountries: apiMocks.getCountries,
        getCultures: apiMocks.getCultures
    })
}));

import {
    loadAdminMetadataConfiguration,
    loadAdminMetadataCountries,
    loadAdminMetadataCultures,
    saveAdminMetadata
} from './adminMetadataService';
import type { AdminMetadataSettings } from './adminMetadataModel';

const api = {} as Api;

function rawConfiguration(): ServerConfiguration {
    return {
        ChapterImageResolution: ImageResolution.P720,
        DummyChapterDuration: 300,
        MetadataCountryCode: 'US',
        PreferredMetadataLanguage: 'en'
    };
}

const confirmed: AdminMetadataSettings = {
    chapterImageResolution: ImageResolution.P720,
    dummyChapterDurationSeconds: 300,
    preferredCountryCode: 'US',
    preferredLanguage: 'en'
};

describe('administrator Metadata service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        apiMocks.getConfiguration.mockResolvedValue({ data: rawConfiguration() });
        apiMocks.getCultures.mockResolvedValue({
            data: [{ DisplayName: 'English', TwoLetterISOLanguageName: 'en' }]
        });
        apiMocks.getCountries.mockResolvedValue({
            data: [{ DisplayName: 'United States', TwoLetterISORegionName: 'US' }]
        });
        apiMocks.updateConfiguration.mockResolvedValue({});
    });

    it('loads the authoritative full configuration with an AbortSignal', async () => {
        // eslint-disable-next-line compat/compat
        const controller = new AbortController();

        const result = await loadAdminMetadataConfiguration(api, controller.signal);

        expect(apiMocks.getConfiguration).toHaveBeenCalledWith({ signal: controller.signal });
        expect(result.settings).toEqual(confirmed);
    });

    it('loads culture and country catalogs independently with AbortSignals', async () => {
        // eslint-disable-next-line compat/compat
        const controller = new AbortController();

        await loadAdminMetadataCultures(api, controller.signal);
        await loadAdminMetadataCountries(api, controller.signal);

        expect(apiMocks.getCultures).toHaveBeenCalledWith({ signal: controller.signal });
        expect(apiMocks.getCountries).toHaveBeenCalledWith({ signal: controller.signal });
        expect(apiMocks.getConfiguration).not.toHaveBeenCalled();
    });

    it('sanitizes configuration transport failures', async () => {
        apiMocks.getConfiguration.mockRejectedValue(new Error('secret configuration body'));

        await expect(loadAdminMetadataConfiguration(api)).rejects.toMatchObject({
            code: 'load-unavailable',
            message: 'Metadata settings could not be loaded.'
        });
    });

    it('fails closed when the authoritative response is malformed', async () => {
        apiMocks.getConfiguration.mockResolvedValue({
            data: { ...rawConfiguration(), DummyChapterDuration: undefined }
        });

        await expect(loadAdminMetadataConfiguration(api)).rejects.toMatchObject({
            code: 'invalid-response'
        });
    });

    it('reports each optional catalog failure without loading configuration', async () => {
        apiMocks.getCultures.mockRejectedValue(new Error('raw cultures'));
        apiMocks.getCountries.mockResolvedValue({ data: null });

        await expect(loadAdminMetadataCultures(api)).rejects.toMatchObject({
            code: 'cultures-unavailable',
            message: 'Metadata languages are temporarily unavailable.'
        });
        await expect(loadAdminMetadataCountries(api)).rejects.toMatchObject({
            code: 'countries-unavailable',
            message: 'Metadata countries are temporarily unavailable.'
        });
        expect(apiMocks.getConfiguration).not.toHaveBeenCalled();
    });

    it('refetches and patches the full document while preserving unmanaged fields', async () => {
        const nested = [{ provider: 'preserved' }];
        apiMocks.getConfiguration.mockResolvedValue({
            data: {
                ...rawConfiguration(),
                FutureField: { retained: true },
                MetadataOptions: nested
            }
        });
        const desired = {
            ...confirmed,
            dummyChapterDurationSeconds: 600,
            preferredLanguage: 'fr'
        };

        const saved = await saveAdminMetadata(api, desired, confirmed);

        expect(apiMocks.getConfiguration).toHaveBeenCalledOnce();
        expect(apiMocks.updateConfiguration).toHaveBeenCalledOnce();
        const outgoing = apiMocks.updateConfiguration.mock.calls[0][0]
            .serverConfiguration as ServerConfiguration;
        expect(outgoing.DummyChapterDuration).toBe(600);
        expect(outgoing.PreferredMetadataLanguage).toBe('fr');
        expect(outgoing.MetadataOptions).toBe(nested);
        expect(Reflect.get(outgoing, 'FutureField')).toEqual({ retained: true });
        expect(saved.settings).toEqual(desired);
    });

    it('performs no write when fresh values already match the desired state', async () => {
        const saved = await saveAdminMetadata(api, confirmed, confirmed);

        expect(saved.settings).toEqual(confirmed);
        expect(apiMocks.updateConfiguration).not.toHaveBeenCalled();
    });

    it('detects a managed-field conflict before writing', async () => {
        apiMocks.getConfiguration.mockResolvedValue({
            data: { ...rawConfiguration(), MetadataCountryCode: 'CA' }
        });

        await expect(saveAdminMetadata(api, {
            ...confirmed,
            dummyChapterDurationSeconds: 600
        }, confirmed)).rejects.toMatchObject({ code: 'conflict' });
        expect(apiMocks.updateConfiguration).not.toHaveBeenCalled();
    });

    it('returns a sanitized save failure and never exposes the response', async () => {
        apiMocks.updateConfiguration.mockRejectedValue(new Error('secret server response'));

        await expect(saveAdminMetadata(api, {
            ...confirmed,
            chapterImageResolution: ImageResolution.P1080
        }, confirmed)).rejects.toMatchObject({
            code: 'save-failed',
            message: "We couldn't save Metadata settings."
        });
    });
});
