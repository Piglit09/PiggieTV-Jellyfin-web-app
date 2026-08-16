import { describe, expect, it } from 'vitest';

/* eslint-disable sonarjs/no-clear-text-protocols -- HTTP fixture proves non-secret tuner discovery behavior. */

import {
    createAdminLiveTvConfigurationSnapshot,
    createAdminLiveTvTunerDraft,
    getAdminLiveTvEditorKind,
    normalizeAdminLiveTvCapability,
    normalizeAdminLiveTvCountries,
    normalizeAdminLiveTvLineups,
    normalizeAdminLiveTvTuner,
    patchAdminLiveTvDvrConfiguration,
    patchAdminLiveTvTuner,
    patchAdminSchedulesDirectAccount,
    patchAdminXmlTvProvider
} from './adminLiveTvAdapters';
import type {
    AdminLiveTvConfigurationDocument,
    AdminLiveTvDvrSettings,
    AdminLiveTvTunerDraft
} from './adminLiveTvModel';

const TEST_STORED_PASSWORD = [ 'server', 'only', 'password' ].join('-');
const TEST_OPAQUE_PASSWORD = [ 'opaque', 'server', 'value' ].join('-');

function tuner(overrides: Record<string, unknown> = {}) {
    return {
        AllowFmp4TranscodingContainer: false,
        AllowHWTranscoding: true,
        AllowStreamSharing: true,
        DeviceId: 'device-a',
        EnableStreamLooping: false,
        FallbackMaxStreamingBitrate: 30_000_000,
        FriendlyName: 'Roof antenna',
        Id: 'tuner-a',
        IgnoreDts: true,
        ImportFavoritesOnly: false,
        ReadAtNativeFramerate: false,
        Source: 'server',
        TunerCount: 2,
        Type: 'M3U',
        Url: 'https://account:password@example.test/playlist.m3u?token=secret',
        UserAgent: 'PiggieTV test',
        ...overrides
    };
}

function provider(overrides: Record<string, unknown> = {}) {
    return {
        Country: null,
        EnableAllTuners: true,
        EnabledTuners: [],
        Id: 'provider-a',
        KidsCategories: [ 'kids' ],
        ListingsId: null,
        MovieCategories: [ 'movie' ],
        MoviePrefix: null,
        NewsCategories: [ 'news' ],
        Password: TEST_STORED_PASSWORD,
        Path: 'https://guide.test/feed.xml?token=guide-secret',
        SportsCategories: [ 'sports' ],
        Type: 'XmlTv',
        UserAgent: null,
        Username: null,
        ZipCode: null,
        ...overrides
    };
}

function configuration(overrides: Record<string, unknown> = {}): AdminLiveTvConfigurationDocument {
    return {
        GuideDays: null,
        ListingProviders: [ provider() ],
        MovieRecordingPath: null,
        PostPaddingSeconds: 180,
        PrePaddingSeconds: 120,
        RecordingPath: null,
        RecordingPostProcessor: null,
        RecordingPostProcessorArguments: null,
        SaveRecordingImages: true,
        SaveRecordingNFO: false,
        SeriesRecordingPath: null,
        TunerHosts: [ tuner() ],
        ...overrides
    } as AdminLiveTvConfigurationDocument;
}

function tunerDraft(overrides: Partial<AdminLiveTvTunerDraft> = {}): AdminLiveTvTunerDraft {
    return {
        allowFmp4TranscodingContainer: false,
        allowHardwareTranscoding: true,
        allowStreamSharing: true,
        deviceId: 'device-a',
        enableStreamLooping: false,
        fallbackMaxStreamingBitrate: 30_000_000,
        friendlyName: 'Roof antenna',
        id: 'tuner-a',
        ignoreDts: true,
        importFavoritesOnly: false,
        preserveUrl: true,
        readAtNativeFramerate: false,
        source: 'server',
        tunerCount: 2,
        type: 'M3U',
        url: null,
        userAgent: 'PiggieTV test',
        ...overrides
    };
}

describe('adminLiveTvAdapters', () => {
    it('creates a redacted UI snapshot without stored URLs or passwords', () => {
        const snapshot = createAdminLiveTvConfigurationSnapshot(configuration());
        const serialized = JSON.stringify(snapshot);

        expect(snapshot.tuners[0]).toMatchObject({
            connectionConfigured: true,
            connectionSummary: 'example.test'
        });
        expect(snapshot.providers[0]).toMatchObject({
            hasStoredPassword: true,
            pathConfigured: true
        });
        expect(snapshot.tuners[0]).not.toHaveProperty('url');
        expect(snapshot.providers[0]).not.toHaveProperty('path');
        expect(serialized).not.toContain('password');
        expect(serialized).not.toContain('token=secret');
        expect(serialized).not.toContain('guide-secret');
    });

    it('preserves an authoritative secret URL when an unrelated tuner field changes', () => {
        const raw = tuner({ FutureTunerOption: { enabled: true } });
        const patched = patchAdminLiveTvTuner(raw, tunerDraft({ friendlyName: 'Antenna' }));

        expect(patched.Url).toBe(raw.Url);
        expect(patched.FriendlyName).toBe('Antenna');
        expect(patched.FutureTunerOption).toEqual({ enabled: true });
    });

    it('does not expose a credential-bearing discovery URL', () => {
        const discovered = createAdminLiveTvTunerDraft('M3U', tuner({ Id: null }));

        expect(discovered.id).toBe('');
        expect(discovered.preserveUrl).toBe(false);
        expect(discovered.url).toBeNull();
    });

    it('allows a non-secret explicitly discovered address', () => {
        const discovered = createAdminLiveTvTunerDraft('HDHomeRun', tuner({
            Id: null,
            Type: 'HDHomeRun',
            Url: 'http://192.0.2.20:5004'
        }));

        expect(discovered.url).toBe('http://192.0.2.20:5004');
    });

    it('patches only DVR-owned fields in the complete latest document', () => {
        const source = configuration({
            FuturePluginValue: { keep: [ 1, 2, 3 ] },
            UnknownNestedValue: { secretServerState: true }
        });
        const desired: AdminLiveTvDvrSettings = {
            ...createAdminLiveTvConfigurationSnapshot(source).dvr,
            guideDays: 10,
            prePaddingSeconds: 240,
            saveRecordingNfo: true
        };
        const patched = patchAdminLiveTvDvrConfiguration(source, desired);

        expect(patched.GuideDays).toBe(10);
        expect(patched.PrePaddingSeconds).toBe(240);
        expect(patched.SaveRecordingNFO).toBe(true);
        expect(patched.FuturePluginValue).toEqual({ keep: [ 1, 2, 3 ] });
        expect(patched.UnknownNestedValue).toEqual({ secretServerState: true });
    });

    it('preserves an opaque XMLTV path when no replacement is supplied', () => {
        const raw = provider({ FutureProviderField: 'keep-me' });
        const patched = patchAdminXmlTvProvider(raw, {
            enableAllTuners: true,
            enabledTunerIds: [],
            id: 'provider-a',
            kidsCategories: [ 'kids' ],
            movieCategories: [ 'movie' ],
            moviePrefix: null,
            newsCategories: [ 'news' ],
            path: '',
            preservePath: true,
            sportsCategories: [ 'sports' ],
            userAgent: null
        });

        expect(patched.Path).toBe(raw.Path);
        expect(patched.FutureProviderField).toBe('keep-me');
    });

    it('preserves a stored Schedules Direct password when the edit leaves it blank', () => {
        const raw = provider({ Password: TEST_OPAQUE_PASSWORD, Type: 'SchedulesDirect' });
        const patched = patchAdminSchedulesDirectAccount(raw, {
            id: 'provider-a',
            password: '',
            username: 'piggie'
        });

        expect(patched.Password).toBe(TEST_OPAQUE_PASSWORD);
        expect(patched.Username).toBe('piggie');
    });

    it('retains unknown provider types without assigning a native editor', () => {
        expect(getAdminLiveTvEditorKind('PluginGuide')).toBe('unknown');
    });

    it('normalizes capability, country, and lineup responses safely', () => {
        expect(normalizeAdminLiveTvCapability({ IsEnabled: true, Services: [ {} ] })).toEqual({
            availability: 'available',
            serviceCount: 1
        });
        expect(normalizeAdminLiveTvCountries({
            NA: [ { fullName: 'United States', shortName: 'USA' } ],
            ZZZ: [ { fullName: 'Ignore', shortName: 'ZZZ' } ]
        })).toEqual([ { code: 'USA', label: 'United States' } ]);
        expect(normalizeAdminLiveTvLineups([ { Id: 'lineup-a', Name: 'Local lineup' } ])).toEqual([
            { id: 'lineup-a', label: 'Local lineup' }
        ]);
    });

    it('rejects malformed authoritative configuration instead of inventing defaults', () => {
        expect(() => createAdminLiveTvConfigurationSnapshot(configuration({ SaveRecordingNFO: null }))).toThrow(
            'Live TV configuration could not be read.'
        );
        expect(() => normalizeAdminLiveTvTuner(tuner({ TunerCount: undefined }))).toThrow(
            'Live TV configuration could not be read.'
        );
    });
});

/* eslint-enable sonarjs/no-clear-text-protocols */
