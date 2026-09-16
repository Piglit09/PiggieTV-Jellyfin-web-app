import type { Api } from '@jellyfin/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const configurationApi = vi.hoisted(() => ({
    getNamedConfiguration: vi.fn(),
    updateNamedConfiguration: vi.fn()
}));
const liveTvApi = vi.hoisted(() => ({
    addListingProvider: vi.fn(),
    addTunerHost: vi.fn(),
    deleteListingProvider: vi.fn(),
    deleteTunerHost: vi.fn(),
    discoverTuners: vi.fn(),
    getDefaultListingProvider: vi.fn(),
    getLineups: vi.fn(),
    getLiveTvInfo: vi.fn(),
    getSchedulesDirectCountries: vi.fn(),
    getTunerHostTypes: vi.fn()
}));

vi.mock('@jellyfin/sdk/lib/utils/api/configuration-api', () => ({
    getConfigurationApi: () => configurationApi
}));
vi.mock('@jellyfin/sdk/lib/utils/api/live-tv-api', () => ({
    getLiveTvApi: () => liveTvApi
}));

import {
    discoverAdminLiveTvTuners,
    loadAdminLiveTvConfiguration,
    saveAdminLiveTvDvr,
    saveAdminLiveTvTuner
} from './adminLiveTvService';
import type { AdminLiveTvDvrSettings, AdminLiveTvTuner } from './adminLiveTvModel';

const api = {} as Api;
const TEST_STORED_PASSWORD = [ 'server', 'only', 'password' ].join('-');

function rawTuner(overrides: Record<string, unknown> = {}) {
    return {
        AllowFmp4TranscodingContainer: false,
        AllowHWTranscoding: true,
        AllowStreamSharing: true,
        DeviceId: 'device-a',
        EnableStreamLooping: false,
        FallbackMaxStreamingBitrate: 30_000_000,
        FriendlyName: 'Antenna',
        Id: 'tuner-a',
        IgnoreDts: true,
        ImportFavoritesOnly: false,
        ReadAtNativeFramerate: false,
        Source: null,
        TunerCount: 2,
        Type: 'M3U',
        Url: 'https://account:password@example.test/live.m3u?token=secret',
        UserAgent: null,
        ...overrides
    };
}

function rawProvider() {
    return {
        Country: null,
        EnableAllTuners: true,
        EnabledTuners: [],
        Id: 'provider-a',
        KidsCategories: [],
        ListingsId: null,
        MovieCategories: [],
        MoviePrefix: null,
        NewsCategories: [],
        Password: TEST_STORED_PASSWORD,
        Path: 'https://guide.test/guide.xml?token=secret',
        SportsCategories: [],
        Type: 'XmlTv',
        UserAgent: null,
        Username: null,
        ZipCode: null
    };
}

function rawConfiguration(overrides: Record<string, unknown> = {}) {
    return {
        GuideDays: null,
        ListingProviders: [ rawProvider() ],
        MovieRecordingPath: null,
        PostPaddingSeconds: 180,
        PrePaddingSeconds: 120,
        RecordingPath: null,
        RecordingPostProcessor: null,
        RecordingPostProcessorArguments: null,
        SaveRecordingImages: true,
        SaveRecordingNFO: false,
        SeriesRecordingPath: null,
        TunerHosts: [ rawTuner() ],
        ...overrides
    };
}

function confirmedDvr(): AdminLiveTvDvrSettings {
    return {
        guideDays: null,
        movieRecordingPath: null,
        postPaddingSeconds: 180,
        prePaddingSeconds: 120,
        recordingPath: null,
        recordingPostProcessor: null,
        recordingPostProcessorArguments: null,
        saveRecordingImages: true,
        saveRecordingNfo: false,
        seriesRecordingPath: null
    };
}

function confirmedTuner(): AdminLiveTvTuner {
    return {
        allowFmp4TranscodingContainer: false,
        allowHardwareTranscoding: true,
        allowStreamSharing: true,
        connectionConfigured: true,
        connectionSummary: 'example.test',
        deviceId: 'device-a',
        enableStreamLooping: false,
        fallbackMaxStreamingBitrate: 30_000_000,
        friendlyName: 'Antenna',
        id: 'tuner-a',
        ignoreDts: true,
        importFavoritesOnly: false,
        label: 'Antenna',
        readAtNativeFramerate: false,
        source: null,
        tunerCount: 2,
        type: 'M3U',
        userAgent: null
    };
}

describe('adminLiveTvService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configurationApi.getNamedConfiguration.mockResolvedValue({ data: rawConfiguration() });
        configurationApi.updateNamedConfiguration.mockResolvedValue({});
        liveTvApi.addTunerHost.mockResolvedValue({});
        liveTvApi.discoverTuners.mockResolvedValue({ data: [] });
    });

    it('performs an observational redacted load with no mutation', async () => {
        const snapshot = await loadAdminLiveTvConfiguration(api);

        expect(configurationApi.getNamedConfiguration).toHaveBeenCalledOnce();
        expect(configurationApi.updateNamedConfiguration).not.toHaveBeenCalled();
        expect(liveTvApi.addTunerHost).not.toHaveBeenCalled();
        expect(liveTvApi.discoverTuners).not.toHaveBeenCalled();
        expect(JSON.stringify(snapshot)).not.toContain('password');
        expect(JSON.stringify(snapshot)).not.toContain('token=secret');
    });

    it('detects a DVR conflict before writing', async () => {
        configurationApi.getNamedConfiguration.mockResolvedValue({
            data: rawConfiguration({ PrePaddingSeconds: 999 })
        });

        await expect(saveAdminLiveTvDvr(api, {
            ...confirmedDvr(),
            guideDays: 10
        }, confirmedDvr())).rejects.toMatchObject({ code: 'conflict' });
        expect(configurationApi.updateNamedConfiguration).not.toHaveBeenCalled();
    });

    it('writes a complete DVR document and refetches server-confirmed state', async () => {
        const latest = rawConfiguration({
            FuturePluginField: { retained: true },
            MediaLocationsCreated: [ '/server/owned' ]
        });
        const confirmedAfterWrite = rawConfiguration({
            FuturePluginField: { retained: true },
            GuideDays: 8,
            MediaLocationsCreated: [ '/server/owned' ]
        });
        configurationApi.getNamedConfiguration
            .mockResolvedValueOnce({ data: latest })
            .mockResolvedValueOnce({ data: confirmedAfterWrite });

        const snapshot = await saveAdminLiveTvDvr(api, {
            ...confirmedDvr(),
            guideDays: 8
        }, confirmedDvr());

        expect(configurationApi.getNamedConfiguration).toHaveBeenCalledTimes(2);
        expect(configurationApi.updateNamedConfiguration).toHaveBeenCalledOnce();
        const outgoing = configurationApi.updateNamedConfiguration.mock.calls[0][0].body;
        expect(outgoing.GuideDays).toBe(8);
        expect(outgoing.FuturePluginField).toEqual({ retained: true });
        expect(outgoing.MediaLocationsCreated).toEqual([ '/server/owned' ]);
        expect(snapshot.dvr.guideDays).toBe(8);
    });

    it('rejects a post-write DVR mismatch instead of publishing it as success', async () => {
        configurationApi.getNamedConfiguration
            .mockResolvedValueOnce({ data: rawConfiguration() })
            .mockResolvedValueOnce({ data: rawConfiguration({ GuideDays: 9 }) });

        await expect(saveAdminLiveTvDvr(api, {
            ...confirmedDvr(),
            guideDays: 8
        }, confirmedDvr())).rejects.toMatchObject({
            code: 'save-confirmation-failed',
            message: 'The server accepted the change, but its updated DVR settings did not match the requested settings.'
        });
        expect(configurationApi.updateNamedConfiguration).toHaveBeenCalledOnce();
    });

    it('starts a retry only after the prior aborted DVR write fully settles', async () => {
        let resolveFirstWrite!: () => void;
        configurationApi.getNamedConfiguration
            .mockResolvedValueOnce({ data: rawConfiguration() })
            .mockResolvedValueOnce({ data: rawConfiguration({ GuideDays: 8 }) })
            .mockResolvedValueOnce({ data: rawConfiguration() })
            .mockResolvedValueOnce({ data: rawConfiguration({ GuideDays: 8 }) });
        configurationApi.updateNamedConfiguration
            .mockImplementationOnce(() => new Promise<void>(resolve => {
                resolveFirstWrite = resolve;
            }))
            .mockResolvedValueOnce({});
        // eslint-disable-next-line compat/compat
        const firstController = new AbortController();
        // eslint-disable-next-line compat/compat
        const retryController = new AbortController();
        const desired = { ...confirmedDvr(), guideDays: 8 };

        const first = saveAdminLiveTvDvr(api, desired, confirmedDvr(), firstController.signal);
        await vi.waitFor(() => expect(configurationApi.updateNamedConfiguration).toHaveBeenCalledOnce());
        firstController.abort();

        const retry = saveAdminLiveTvDvr(api, desired, confirmedDvr(), retryController.signal);
        expect(retry).not.toBe(first);
        await Promise.resolve();
        expect(configurationApi.updateNamedConfiguration).toHaveBeenCalledOnce();

        resolveFirstWrite();
        await first;
        await retry;
        expect(configurationApi.updateNamedConfiguration).toHaveBeenCalledTimes(2);
    });

    it('does not start a queued DVR write after that generation is aborted', async () => {
        let resolveFirstWrite!: () => void;
        configurationApi.getNamedConfiguration
            .mockResolvedValueOnce({ data: rawConfiguration() })
            .mockResolvedValueOnce({ data: rawConfiguration({ GuideDays: 8 }) });
        configurationApi.updateNamedConfiguration.mockImplementationOnce(
            () => new Promise<void>(resolve => {
                resolveFirstWrite = resolve;
            })
        );
        // eslint-disable-next-line compat/compat
        const firstController = new AbortController();
        // eslint-disable-next-line compat/compat
        const queuedController = new AbortController();
        const desired = { ...confirmedDvr(), guideDays: 8 };

        const first = saveAdminLiveTvDvr(api, desired, confirmedDvr(), firstController.signal);
        await vi.waitFor(() => expect(configurationApi.updateNamedConfiguration).toHaveBeenCalledOnce());
        firstController.abort();
        const queued = saveAdminLiveTvDvr(api, desired, confirmedDvr(), queuedController.signal);
        queuedController.abort();
        const queuedRejection = expect(queued).rejects.toMatchObject({ name: 'AbortError' });

        resolveFirstWrite();
        await first;
        await queuedRejection;
        expect(configurationApi.updateNamedConfiguration).toHaveBeenCalledOnce();
    });

    it('preserves a plain AbortError instead of converting it to an operation failure', async () => {
        const abortError = new Error('cancelled');
        abortError.name = 'AbortError';
        configurationApi.getNamedConfiguration.mockRejectedValueOnce(abortError);

        await expect(saveAdminLiveTvDvr(api, {
            ...confirmedDvr(),
            guideDays: 8
        }, confirmedDvr())).rejects.toBe(abortError);
    });

    it('preserves a stored secret tuner URL through an unrelated focused edit', async () => {
        const latest = rawConfiguration({ TunerHosts: [ rawTuner({ FutureTunerField: 'keep' }) ] });
        const confirmedAfterWrite = rawConfiguration({
            TunerHosts: [ rawTuner({ FriendlyName: 'Updated antenna', FutureTunerField: 'keep' }) ]
        });
        configurationApi.getNamedConfiguration
            .mockResolvedValueOnce({ data: latest })
            .mockResolvedValueOnce({ data: confirmedAfterWrite });

        await saveAdminLiveTvTuner(api, {
            allowFmp4TranscodingContainer: false,
            allowHardwareTranscoding: true,
            allowStreamSharing: true,
            deviceId: 'device-a',
            enableStreamLooping: false,
            fallbackMaxStreamingBitrate: 30_000_000,
            friendlyName: 'Updated antenna',
            id: 'tuner-a',
            ignoreDts: true,
            importFavoritesOnly: false,
            preserveUrl: true,
            readAtNativeFramerate: false,
            source: null,
            tunerCount: 2,
            type: 'M3U',
            url: null,
            userAgent: null
        }, confirmedTuner());

        expect(liveTvApi.addTunerHost).toHaveBeenCalledOnce();
        const outgoing = liveTvApi.addTunerHost.mock.calls[0][0].tunerHostInfo;
        expect(outgoing.Url).toBe(rawTuner().Url);
        expect(outgoing.FutureTunerField).toBe('keep');
        expect(outgoing.FriendlyName).toBe('Updated antenna');
    });

    it('redacts credential-bearing explicit discovery results', async () => {
        liveTvApi.discoverTuners.mockResolvedValue({ data: [ rawTuner({ Id: null }) ] });

        const result = await discoverAdminLiveTvTuners(api);

        expect(result[0].url).toBeNull();
        expect(JSON.stringify(result)).not.toContain('token=secret');
    });
});
