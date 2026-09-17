import type { BrandingOptionsDto } from '@jellyfin/sdk/lib/generated-client/models/branding-options-dto';
import type { NetworkConfiguration } from '@jellyfin/sdk/lib/generated-client/models/network-configuration';
import type { ServerConfiguration } from '@jellyfin/sdk/lib/generated-client/models/server-configuration';
import { describe, expect, it } from 'vitest';

/* eslint-disable sonarjs/no-hardcoded-ip, sonarjs/no-hardcoded-passwords -- inert configuration fixtures */

import {
    createAdminServerBrandingSnapshot,
    createAdminServerGeneralSnapshot,
    createAdminServerNetworkingSnapshot,
    patchAdminServerBrandingConfiguration,
    patchAdminServerGeneralConfiguration,
    patchAdminServerNetworkingConfiguration,
    requireAdminServerNetworkingSettings
} from './adminServerConfigurationAdapters';

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

function networkDocument(): NetworkConfiguration {
    return {
        AutoDiscovery: true,
        BaseUrl: '',
        CertificatePassword: 'private-password',
        CertificatePath: '/cert.pfx',
        EnableHttps: true,
        EnableIPv4: true,
        EnableIPv6: true,
        EnableRemoteAccess: true,
        InternalHttpPort: 8096,
        InternalHttpsPort: 8920,
        IsRemoteIPFilterBlacklist: true,
        KnownProxies: [ 'proxy.local', '10.0.0.2' ],
        LocalNetworkAddresses: [ '192.168.1.10', '2001:db8::1' ],
        LocalNetworkSubnets: [ '192.168.0.0/16', '2001:db8::/32' ],
        PublicHttpPort: 8096,
        PublicHttpsPort: 8920,
        PublishedServerUriBySubnet: [ 'internal=http://ptv.local:8096', '2001:db8::/32=https://ptv.example' ],
        RemoteIPFilter: [ '203.0.113.0/24', '2001:db8:ffff::/48' ],
        RequireHttps: false
    };
}

describe('server configuration adapters', () => {
    it('normalizes each configuration domain without exposing networking secrets', () => {
        expect(createAdminServerGeneralSnapshot(generalDocument()).settings.serverName).toBe('PiggieTV');
        expect(createAdminServerBrandingSnapshot({
            CustomCss: '.ptv {}',
            LoginDisclaimer: 'Private server',
            SplashscreenEnabled: true
        }).settings).toEqual({
            customCss: '.ptv {}',
            loginDisclaimer: 'Private server',
            splashscreenEnabled: true
        });
        const networking = createAdminServerNetworkingSnapshot(networkDocument(), {});
        expect(networking.settings.certificatePasswordConfigured).toBe(true);
        expect(JSON.stringify(networking)).not.toContain('private-password');
    });

    it('preserves unknown fields while patching only owned values', () => {
        const general = generalDocument();
        Reflect.set(general, 'FutureGeneral', { keep: true });
        const patchedGeneral = patchAdminServerGeneralConfiguration(general, {
            ...createAdminServerGeneralSnapshot(general).settings,
            serverName: 'Updated'
        });
        expect(Reflect.get(patchedGeneral, 'FutureGeneral')).toEqual({ keep: true });
        expect(patchedGeneral.ServerName).toBe('Updated');

        const branding = { CustomCss: '', LoginDisclaimer: '', SplashscreenEnabled: false } as BrandingOptionsDto;
        Reflect.set(branding, 'PluginBrandingField', [ 'keep' ]);
        const patchedBranding = patchAdminServerBrandingConfiguration(branding, {
            customCss: '.new {}',
            loginDisclaimer: '',
            splashscreenEnabled: true
        });
        expect(Reflect.get(patchedBranding, 'PluginBrandingField')).toEqual([ 'keep' ]);

        const network = networkDocument();
        Reflect.set(network, 'FutureNetwork', { keep: true });
        const patchedNetwork = patchAdminServerNetworkingConfiguration(
            network,
            { ...createAdminServerNetworkingSnapshot(network, {}).settings, baseUrl: '/ptv' },
            { mode: 'unchanged' }
        );
        expect(Reflect.get(patchedNetwork, 'FutureNetwork')).toEqual({ keep: true });
        expect(patchedNetwork.CertificatePassword).toBe('private-password');
    });

    it('accepts supported IPv4, IPv6, CIDR, host and published URI forms', () => {
        const settings = createAdminServerNetworkingSnapshot(networkDocument(), {}).settings;
        expect(() => requireAdminServerNetworkingSettings(settings)).not.toThrow();
    });

    it.each([
        [ 'bad IPv4', { remoteIPFilter: [ '999.1.1.1' ] } ],
        [ 'bad IPv6 CIDR', { remoteIPFilter: [ '2001:db8::/129' ] } ],
        [ 'short uncompressed IPv6', { remoteIPFilter: [ '2001:db8:1' ] } ],
        [ 'single-colon IPv6', { remoteIPFilter: [ ':' ] } ],
        [ 'blank CIDR prefix', { remoteIPFilter: [ '192.168.1.0/' ] } ],
        [ 'bad published mapping', { publishedServerUriBySubnet: [ 'external=ftp://server' ] } ],
        [ 'colliding ports', { internalHttpsPort: 8096 } ]
    ])('rejects %s without coercing it', (_label, change) => {
        const settings = {
            ...createAdminServerNetworkingSnapshot(networkDocument(), {}).settings,
            ...change
        };
        expect(() => requireAdminServerNetworkingSettings(settings)).toThrow();
    });
});

/* eslint-enable sonarjs/no-hardcoded-ip, sonarjs/no-hardcoded-passwords */
