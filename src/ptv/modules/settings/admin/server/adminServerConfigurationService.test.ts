import type { Api } from '@jellyfin/sdk';
import type { BrandingOptionsDto } from '@jellyfin/sdk/lib/generated-client/models/branding-options-dto';
import type { NetworkConfiguration } from '@jellyfin/sdk/lib/generated-client/models/network-configuration';
import type { ServerConfiguration } from '@jellyfin/sdk/lib/generated-client/models/server-configuration';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    deleteCustomSplashscreen: vi.fn(),
    getBrandingOptions: vi.fn(),
    getConfiguration: vi.fn(),
    getLocalizationOptions: vi.fn(),
    getNamedConfiguration: vi.fn(),
    getSystemInfo: vi.fn(),
    restartApplication: vi.fn(),
    shutdownApplication: vi.fn(),
    updateBrandingConfiguration: vi.fn(),
    updateConfiguration: vi.fn(),
    updateNamedConfiguration: vi.fn(),
    uploadCustomSplashscreen: vi.fn()
}));

vi.mock('@jellyfin/sdk/lib/utils/api/branding-api', () => ({
    getBrandingApi: () => ({ getBrandingOptions: mocks.getBrandingOptions })
}));
vi.mock('@jellyfin/sdk/lib/utils/api/configuration-api', () => ({
    getConfigurationApi: () => ({
        getConfiguration: mocks.getConfiguration,
        getNamedConfiguration: mocks.getNamedConfiguration,
        updateBrandingConfiguration: mocks.updateBrandingConfiguration,
        updateConfiguration: mocks.updateConfiguration,
        updateNamedConfiguration: mocks.updateNamedConfiguration
    })
}));
vi.mock('@jellyfin/sdk/lib/utils/api/image-api', () => ({
    getImageApi: () => ({
        deleteCustomSplashscreen: mocks.deleteCustomSplashscreen,
        uploadCustomSplashscreen: mocks.uploadCustomSplashscreen
    })
}));
vi.mock('@jellyfin/sdk/lib/utils/api/localization-api', () => ({
    getLocalizationApi: () => ({ getLocalizationOptions: mocks.getLocalizationOptions })
}));
vi.mock('@jellyfin/sdk/lib/utils/api/system-api', () => ({
    getSystemApi: () => ({
        getSystemInfo: mocks.getSystemInfo,
        restartApplication: mocks.restartApplication,
        shutdownApplication: mocks.shutdownApplication
    })
}));

import {
    loadAdminServerBranding,
    loadAdminServerGeneral,
    loadAdminServerNetworking,
    runAdminServerPowerAction,
    saveAdminServerBranding,
    saveAdminServerGeneral,
    saveAdminServerNetworking
} from './adminServerConfigurationService';

const api = {} as Api;

function generalDocument(): ServerConfiguration {
    return {
        CachePath: '/cache',
        LibraryScanFanoutConcurrency: 2,
        MetadataPath: '/metadata',
        ParallelImageEncodingLimit: 4,
        QuickConnectAvailable: true,
        ServerName: 'PiggieTV',
        UICulture: 'en-US'
    };
}

function brandingDocument(): BrandingOptionsDto {
    return { CustomCss: '', LoginDisclaimer: '', SplashscreenEnabled: true };
}

function networkDocument(password = 'secret'): NetworkConfiguration {
    return {
        AutoDiscovery: true,
        BaseUrl: '',
        CertificatePassword: password,
        CertificatePath: '/cert.pfx',
        EnableHttps: true,
        EnableIPv4: true,
        EnableIPv6: false,
        EnableRemoteAccess: true,
        InternalHttpPort: 8096,
        InternalHttpsPort: 8920,
        IsRemoteIPFilterBlacklist: true,
        KnownProxies: [],
        LocalNetworkAddresses: [],
        LocalNetworkSubnets: [],
        PublicHttpPort: 8096,
        PublicHttpsPort: 8920,
        PublishedServerUriBySubnet: [],
        RemoteIPFilter: [],
        RequireHttps: false
    };
}

describe('server configuration service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.updateConfiguration.mockResolvedValue({});
        mocks.updateBrandingConfiguration.mockResolvedValue({});
        mocks.updateNamedConfiguration.mockResolvedValue({});
    });

    it('refetches, patches, and post-confirms General while preserving unknown fields', async () => {
        const initial = generalDocument();
        Reflect.set(initial, 'FutureField', { keep: true });
        const verified = { ...initial, ServerName: 'PiggieTV Home' };
        mocks.getConfiguration
            .mockResolvedValueOnce({ data: initial })
            .mockResolvedValueOnce({ data: initial })
            .mockResolvedValueOnce({ data: verified });
        const loaded = await loadAdminServerGeneral(api);
        const saved = await saveAdminServerGeneral(api, {
            ...loaded.settings,
            serverName: 'PiggieTV Home'
        }, loaded.settings, null);

        const written = mocks.updateConfiguration.mock.calls[0][0].serverConfiguration;
        expect(Reflect.get(written, 'FutureField')).toEqual({ keep: true });
        expect(saved.settings.serverName).toBe('PiggieTV Home');
        expect(mocks.getConfiguration).toHaveBeenCalledTimes(3);
    });

    it('blocks a General conflict before any write', async () => {
        mocks.getConfiguration.mockResolvedValueOnce({ data: generalDocument() });
        const loaded = await loadAdminServerGeneral(api);
        mocks.getConfiguration.mockResolvedValueOnce({ data: { ...generalDocument(), ServerName: 'External' } });
        await expect(saveAdminServerGeneral(api, {
            ...loaded.settings,
            serverName: 'Desired'
        }, loaded.settings, null)).rejects.toMatchObject({ code: 'general-conflict' });
        expect(mocks.updateConfiguration).not.toHaveBeenCalled();
    });

    it('post-confirms Branding after its focused write', async () => {
        mocks.getBrandingOptions.mockResolvedValueOnce({ data: brandingDocument() });
        const loaded = await loadAdminServerBranding(api);
        const desired = { ...loaded.settings, loginDisclaimer: 'Private server' };
        mocks.getBrandingOptions
            .mockResolvedValueOnce({ data: brandingDocument() })
            .mockResolvedValueOnce({ data: { ...brandingDocument(), LoginDisclaimer: 'Private server' } });
        const saved = await saveAdminServerBranding(api, desired, loaded.settings);
        expect(saved.settings).toEqual(desired);
        expect(mocks.updateBrandingConfiguration).toHaveBeenCalledOnce();
    });

    it.each([
        [ 'clears an existing certificate password', 'secret', { mode: 'clear' as const }, '' ],
        [ 'sets a first certificate password', '', { mode: 'replace' as const, value: 'new-secret' }, 'new-secret' ]
    ])('%s and verifies the derived configured state', async (_label, initialPassword, change, verifiedPassword) => {
        const initial = networkDocument(initialPassword);
        mocks.getNamedConfiguration
            .mockResolvedValueOnce({ data: initial })
            .mockResolvedValueOnce({ data: initial })
            .mockResolvedValueOnce({ data: networkDocument(verifiedPassword) });
        const loaded = await loadAdminServerNetworking(api);
        const result = await saveAdminServerNetworking(api, loaded.settings, loaded, change);

        expect(result.verification).toBe('confirmed');
        expect(result.snapshot.settings.certificatePasswordConfigured).toBe(Boolean(verifiedPassword));
    });

    it('reports an accepted but unverified Networking write after a reconnect failure', async () => {
        const initial = networkDocument();
        mocks.getNamedConfiguration
            .mockResolvedValueOnce({ data: initial })
            .mockResolvedValueOnce({ data: initial })
            .mockRejectedValueOnce(new Error('connection dropped'));
        const loaded = await loadAdminServerNetworking(api);
        const result = await saveAdminServerNetworking(api, {
            ...loaded.settings,
            internalHttpPort: 8097
        }, loaded, { mode: 'unchanged' });
        expect(result.verification).toBe('connection-interrupted');
    });

    it('single-flights each server power action', async () => {
        let finish: (() => void) | undefined;
        mocks.restartApplication.mockReturnValue(new Promise(resolve => {
            finish = () => resolve({});
        }));
        const first = runAdminServerPowerAction(api, 'restart');
        const second = runAdminServerPowerAction(api, 'restart');
        expect(first).toBe(second);
        expect(mocks.restartApplication).toHaveBeenCalledOnce();
        finish?.();
        await first;
    });
});
