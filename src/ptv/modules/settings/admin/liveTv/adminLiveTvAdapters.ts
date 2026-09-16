import type { ListingsProviderInfo } from '@jellyfin/sdk/lib/generated-client/models/listings-provider-info';
import type { LiveTvInfo } from '@jellyfin/sdk/lib/generated-client/models/live-tv-info';
import type { NameIdPair } from '@jellyfin/sdk/lib/generated-client/models/name-id-pair';
import type { TunerHostInfo } from '@jellyfin/sdk/lib/generated-client/models/tuner-host-info';

import {
    AdminLiveTvServiceError,
    type AdminLiveTvCapability,
    type AdminLiveTvConfigurationDocument,
    type AdminLiveTvConfigurationSnapshot,
    type AdminLiveTvCountry,
    type AdminLiveTvDvrSettings,
    type AdminLiveTvEditorKind,
    type AdminLiveTvGuideProvider,
    type AdminLiveTvLineup,
    type AdminLiveTvSchedulesDirectAccountDraft,
    type AdminLiveTvSchedulesDirectListingDraft,
    type AdminLiveTvTuner,
    type AdminLiveTvTunerDraft,
    type AdminLiveTvTunerType,
    type AdminLiveTvXmlTvDraft
} from './adminLiveTvModel';

const SCHEDULES_DIRECT_TYPE = 'schedulesdirect';
const XMLTV_TYPE = 'xmltv';

function invalidResponse(): never {
    throw new AdminLiveTvServiceError(
        'invalid-response',
        'Live TV configuration could not be read.'
    );
}

function requireObject(value: unknown): asserts value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalidResponse();
}

function requireBoolean(value: unknown) {
    if (typeof value !== 'boolean') invalidResponse();
    return value;
}

function requireInteger(value: unknown) {
    if (!Number.isInteger(value)) invalidResponse();
    return value as number;
}

function nullableText(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string') invalidResponse();
    return value;
}

function displayText(value: unknown) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireId(value: unknown, label: string) {
    const id = displayText(value);
    if (!id) {
        throw new AdminLiveTvServiceError('invalid-input', `${label} is unavailable.`);
    }
    return id;
}

function requireNonNegativeInteger(value: unknown, label: string) {
    if (!Number.isInteger(value) || Number(value) < 0) {
        throw new AdminLiveTvServiceError('invalid-input', `${label} must be a non-negative whole number.`);
    }
    return Number(value);
}

function redactConnection(value: unknown) {
    const raw = displayText(value);
    if (!raw) return 'No connection configured';
    const webAuthority = /^https?:\/\/([^/?#]+)/i.exec(raw)?.[1];
    if (webAuthority) {
        return webAuthority.split('@').pop() || 'Configured connection';
    }
    if (/^[a-z]:[\\/]/i.test(raw) || raw.startsWith('/') || raw.startsWith('\\\\')) {
        return 'Server file';
    }
    return raw.includes('@') || raw.includes('?') ? 'Configured connection' : raw;
}

export function getAdminLiveTvEditorKind(type: unknown) {
    const normalized = displayText(type)?.toLowerCase();
    if (normalized === SCHEDULES_DIRECT_TYPE) return 'schedules-direct' as const;
    if (normalized === XMLTV_TYPE) return 'xmltv' as const;
    return 'unknown' as const;
}

function tunerLabel(raw: TunerHostInfo) {
    const friendly = displayText(raw.FriendlyName);
    if (friendly) return friendly;
    const source = displayText(raw.Source);
    if (source?.toLowerCase() === 'nextpvr') return 'NextPVR';
    const type = displayText(raw.Type);
    const known: Record<string, string> = {
        hauppauge: 'Hauppauge',
        hdhomerun: 'HDHomeRun',
        m3u: 'M3U tuner',
        satip: 'SAT>IP tuner'
    };
    return type ? (known[type.toLowerCase()] || type) : 'Configured tuner';
}

export function normalizeAdminLiveTvTuner(raw: TunerHostInfo): AdminLiveTvTuner {
    requireObject(raw);
    return {
        allowFmp4TranscodingContainer: requireBoolean(raw.AllowFmp4TranscodingContainer),
        allowHardwareTranscoding: requireBoolean(raw.AllowHWTranscoding),
        allowStreamSharing: requireBoolean(raw.AllowStreamSharing),
        connectionConfigured: Boolean(displayText(raw.Url)),
        connectionSummary: redactConnection(raw.Url),
        deviceId: nullableText(raw.DeviceId),
        enableStreamLooping: requireBoolean(raw.EnableStreamLooping),
        fallbackMaxStreamingBitrate: requireInteger(raw.FallbackMaxStreamingBitrate),
        friendlyName: nullableText(raw.FriendlyName),
        id: requireId(raw.Id, 'Tuner identifier'),
        ignoreDts: requireBoolean(raw.IgnoreDts),
        importFavoritesOnly: requireBoolean(raw.ImportFavoritesOnly),
        label: tunerLabel(raw),
        readAtNativeFramerate: requireBoolean(raw.ReadAtNativeFramerate),
        source: nullableText(raw.Source),
        tunerCount: requireInteger(raw.TunerCount),
        type: requireId(raw.Type, 'Tuner type'),
        userAgent: nullableText(raw.UserAgent)
    };
}

function providerLabel(type: string) {
    const editor = getAdminLiveTvEditorKind(type);
    if (editor === 'schedules-direct') return 'Schedules Direct';
    if (editor === 'xmltv') return 'XMLTV';
    return type;
}

function providerDetail(
    editor: AdminLiveTvEditorKind,
    listingsId: string | null,
    pathConfigured: boolean
) {
    if (editor === 'schedules-direct') {
        return listingsId ? 'Lineup configured' : 'Account connected';
    }
    if (editor === 'xmltv') {
        return pathConfigured ? 'XMLTV source configured' : 'Source required';
    }
    return 'Provider configuration retained';
}

function stringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string');
}

export function normalizeAdminLiveTvProvider(raw: ListingsProviderInfo): AdminLiveTvGuideProvider {
    requireObject(raw);
    const type = requireId(raw.Type, 'Guide provider type');
    const editor = getAdminLiveTvEditorKind(type);
    const listingsId = nullableText(raw.ListingsId);
    const pathConfigured = Boolean(displayText(raw.Path));
    const detail = providerDetail(editor, listingsId, pathConfigured);
    const enabledTuners = Array.isArray(raw.EnabledTuners) ?
        raw.EnabledTuners.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())) : [];
    return {
        country: nullableText(raw.Country),
        detail,
        editor,
        enableAllTuners: requireBoolean(raw.EnableAllTuners),
        enabledTunerIds: enabledTuners,
        hasStoredPassword: Boolean(displayText(raw.Password)),
        id: requireId(raw.Id, 'Guide provider identifier'),
        kidsCategories: stringArray(raw.KidsCategories),
        label: providerLabel(type),
        listingsId,
        movieCategories: stringArray(raw.MovieCategories),
        moviePrefix: nullableText(raw.MoviePrefix),
        newsCategories: stringArray(raw.NewsCategories),
        pathConfigured,
        postalCode: nullableText(raw.ZipCode),
        sportsCategories: stringArray(raw.SportsCategories),
        type,
        userAgent: nullableText(raw.UserAgent),
        username: nullableText(raw.Username)
    };
}

export function normalizeAdminLiveTvDvrSettings(
    configuration: AdminLiveTvConfigurationDocument
): AdminLiveTvDvrSettings {
    requireObject(configuration);
    const guideDays = configuration.GuideDays;
    if (guideDays !== null && guideDays !== undefined && (!Number.isInteger(guideDays) || guideDays < 1 || guideDays > 14)) {
        invalidResponse();
    }
    return {
        guideDays: guideDays ?? null,
        movieRecordingPath: nullableText(configuration.MovieRecordingPath),
        postPaddingSeconds: requireInteger(configuration.PostPaddingSeconds),
        prePaddingSeconds: requireInteger(configuration.PrePaddingSeconds),
        recordingPath: nullableText(configuration.RecordingPath),
        recordingPostProcessor: nullableText(configuration.RecordingPostProcessor),
        recordingPostProcessorArguments: nullableText(configuration.RecordingPostProcessorArguments),
        saveRecordingImages: requireBoolean(configuration.SaveRecordingImages),
        saveRecordingNfo: requireBoolean(configuration.SaveRecordingNFO),
        seriesRecordingPath: nullableText(configuration.SeriesRecordingPath)
    };
}

export function createAdminLiveTvConfigurationSnapshot(
    configuration: unknown
): AdminLiveTvConfigurationSnapshot {
    requireObject(configuration);
    const document = configuration as AdminLiveTvConfigurationDocument;
    const tuners = document.TunerHosts;
    const providers = document.ListingProviders;
    if (!Array.isArray(tuners) || !Array.isArray(providers)) invalidResponse();
    return {
        dvr: normalizeAdminLiveTvDvrSettings(document),
        providers: providers.map(normalizeAdminLiveTvProvider),
        tuners: tuners.map(normalizeAdminLiveTvTuner)
    };
}

export function areAdminLiveTvDvrSettingsEqual(
    left: AdminLiveTvDvrSettings,
    right: AdminLiveTvDvrSettings
) {
    return Object.keys(left).every(key => (
        left[key as keyof AdminLiveTvDvrSettings] === right[key as keyof AdminLiveTvDvrSettings]
    ));
}

export function requireAdminLiveTvDvrSettings(settings: AdminLiveTvDvrSettings) {
    requireObject(settings);
    if (settings.guideDays !== null && (!Number.isInteger(settings.guideDays) || settings.guideDays < 1 || settings.guideDays > 14)) {
        throw new AdminLiveTvServiceError('invalid-input', 'Guide days must be Auto or a whole number from 1 to 14.');
    }
    requireNonNegativeInteger(settings.prePaddingSeconds, 'Start padding');
    requireNonNegativeInteger(settings.postPaddingSeconds, 'End padding');
    if (typeof settings.saveRecordingImages !== 'boolean' || typeof settings.saveRecordingNfo !== 'boolean') {
        throw new AdminLiveTvServiceError('invalid-input', 'Recording metadata choices are invalid.');
    }
    return settings;
}

/** Clones the complete latest document and patches only the ten DVR-owned fields. */
export function patchAdminLiveTvDvrConfiguration(
    configuration: AdminLiveTvConfigurationDocument,
    settings: AdminLiveTvDvrSettings
): AdminLiveTvConfigurationDocument {
    createAdminLiveTvConfigurationSnapshot(configuration);
    const desired = requireAdminLiveTvDvrSettings(settings);
    return {
        ...configuration,
        GuideDays: desired.guideDays,
        MovieRecordingPath: desired.movieRecordingPath,
        PostPaddingSeconds: desired.postPaddingSeconds,
        PrePaddingSeconds: desired.prePaddingSeconds,
        RecordingPath: desired.recordingPath,
        RecordingPostProcessor: desired.recordingPostProcessor,
        RecordingPostProcessorArguments: desired.recordingPostProcessorArguments,
        SaveRecordingImages: desired.saveRecordingImages,
        SaveRecordingNFO: desired.saveRecordingNfo,
        SeriesRecordingPath: desired.seriesRecordingPath
    };
}

export function normalizeAdminLiveTvCapability(raw: LiveTvInfo): AdminLiveTvCapability {
    requireObject(raw);
    let availability: AdminLiveTvCapability['availability'] = 'unknown';
    if (raw.IsEnabled === true) availability = 'available';
    else if (raw.IsEnabled === false) availability = 'unavailable';
    return {
        availability,
        serviceCount: Array.isArray(raw.Services) ? raw.Services.length : null
    };
}

export function normalizeAdminLiveTvTunerTypes(raw: unknown): AdminLiveTvTunerType[] {
    if (!Array.isArray(raw)) invalidResponse();
    const seen = new Set<string>();
    return raw.flatMap(value => {
        const pair = value as NameIdPair;
        const id = displayText(pair?.Id);
        if (!id || seen.has(id.toLowerCase())) return [];
        seen.add(id.toLowerCase());
        return [{ id, label: displayText(pair.Name) || id }];
    });
}

export function requireAdminLiveTvTunerDraft(
    draft: AdminLiveTvTunerDraft,
    authoritativeUrl?: unknown
) {
    requireObject(draft);
    const type = requireId(draft.type, 'Tuner type');
    const url = nullableText(draft.url);
    const preservedUrl = draft.preserveUrl ? nullableText(authoritativeUrl) : null;
    if ((type.toLowerCase() === 'm3u' || type.toLowerCase() === 'hdhomerun') && !url && !preservedUrl) {
        throw new AdminLiveTvServiceError('invalid-input', 'This tuner requires a server path or address.');
    }
    requireNonNegativeInteger(draft.tunerCount, 'Tuner count');
    requireNonNegativeInteger(draft.fallbackMaxStreamingBitrate, 'Fallback bitrate');
    return { ...draft, type, url: draft.preserveUrl ? preservedUrl : url };
}

function safeDiscoveredUrl(value: unknown) {
    const raw = displayText(value);
    if (!raw) return null;
    if (/[?#]/.test(raw) || /^https?:\/\/[^/]*@/i.test(raw)) return null;
    return raw;
}

export function createAdminLiveTvTunerDraft(
    type: string,
    raw?: Partial<TunerHostInfo>
): AdminLiveTvTunerDraft {
    const normalized = normalizeAdminLiveTvTuner({
        AllowFmp4TranscodingContainer: false,
        AllowHWTranscoding: true,
        AllowStreamSharing: true,
        DeviceId: null,
        EnableStreamLooping: false,
        FallbackMaxStreamingBitrate: 30_000_000,
        FriendlyName: null,
        IgnoreDts: true,
        ImportFavoritesOnly: false,
        ReadAtNativeFramerate: false,
        Source: null,
        TunerCount: 0,
        Url: null,
        UserAgent: null,
        ...raw,
        Id: raw?.Id || 'draft',
        Type: type || raw?.Type || ''
    });
    return {
        allowFmp4TranscodingContainer: normalized.allowFmp4TranscodingContainer,
        allowHardwareTranscoding: normalized.allowHardwareTranscoding,
        allowStreamSharing: normalized.allowStreamSharing,
        deviceId: normalized.deviceId,
        enableStreamLooping: normalized.enableStreamLooping,
        fallbackMaxStreamingBitrate: normalized.fallbackMaxStreamingBitrate,
        friendlyName: normalized.friendlyName,
        id: raw?.Id || '',
        ignoreDts: normalized.ignoreDts,
        importFavoritesOnly: normalized.importFavoritesOnly,
        preserveUrl: false,
        readAtNativeFramerate: normalized.readAtNativeFramerate,
        source: normalized.source,
        tunerCount: normalized.tunerCount,
        type: normalized.type,
        url: safeDiscoveredUrl(raw?.Url),
        userAgent: normalized.userAgent
    };
}

export function patchAdminLiveTvTuner(
    raw: TunerHostInfo & Record<string, unknown>,
    draft: AdminLiveTvTunerDraft
): TunerHostInfo & Record<string, unknown> {
    const valid = requireAdminLiveTvTunerDraft(draft, raw.Url);
    return {
        ...raw,
        AllowFmp4TranscodingContainer: valid.allowFmp4TranscodingContainer,
        AllowHWTranscoding: valid.allowHardwareTranscoding,
        AllowStreamSharing: valid.allowStreamSharing,
        DeviceId: valid.deviceId,
        EnableStreamLooping: valid.enableStreamLooping,
        FallbackMaxStreamingBitrate: valid.fallbackMaxStreamingBitrate,
        FriendlyName: valid.friendlyName,
        Id: valid.id || null,
        IgnoreDts: valid.ignoreDts,
        ImportFavoritesOnly: valid.importFavoritesOnly,
        ReadAtNativeFramerate: valid.readAtNativeFramerate,
        Source: valid.source,
        TunerCount: valid.tunerCount,
        Type: valid.type,
        Url: valid.url,
        UserAgent: valid.userAgent
    };
}

function normalizedIds(values: readonly string[]) {
    return [ ...new Set(values.map(value => value.trim()).filter(Boolean)) ];
}

export function patchAdminXmlTvProvider(
    raw: ListingsProviderInfo & Record<string, unknown>,
    draft: AdminLiveTvXmlTvDraft
): ListingsProviderInfo & Record<string, unknown> {
    const path = draft.preservePath ? displayText(raw.Path) : displayText(draft.path);
    if (!path) throw new AdminLiveTvServiceError('invalid-input', 'An XMLTV file or URL is required.');
    return {
        ...raw,
        EnableAllTuners: draft.enableAllTuners,
        EnabledTuners: draft.enableAllTuners ? [] : normalizedIds(draft.enabledTunerIds),
        Id: draft.id || null,
        KidsCategories: normalizedIds(draft.kidsCategories),
        MovieCategories: normalizedIds(draft.movieCategories),
        MoviePrefix: nullableText(draft.moviePrefix),
        NewsCategories: normalizedIds(draft.newsCategories),
        Path: path,
        SportsCategories: normalizedIds(draft.sportsCategories),
        Type: XMLTV_TYPE,
        UserAgent: nullableText(draft.userAgent)
    };
}

export function patchAdminSchedulesDirectAccount(
    raw: ListingsProviderInfo & Record<string, unknown>,
    draft: AdminLiveTvSchedulesDirectAccountDraft
): ListingsProviderInfo & Record<string, unknown> {
    const username = displayText(draft.username);
    const password = displayText(draft.password);
    if (!username) throw new AdminLiveTvServiceError('invalid-input', 'A Schedules Direct username is required.');
    if (!password && !displayText(raw.Password)) {
        throw new AdminLiveTvServiceError('invalid-input', 'A Schedules Direct password is required.');
    }
    return {
        ...raw,
        EnableAllTuners: raw.EnableAllTuners ?? true,
        Id: draft.id || null,
        Password: password || raw.Password,
        Type: 'SchedulesDirect',
        Username: username
    };
}

export function patchAdminSchedulesDirectListing(
    raw: ListingsProviderInfo & Record<string, unknown>,
    draft: AdminLiveTvSchedulesDirectListingDraft
): ListingsProviderInfo & Record<string, unknown> {
    const id = requireId(draft.id, 'Guide provider identifier');
    const listingsId = displayText(draft.listingsId);
    const country = displayText(draft.country);
    const postalCode = displayText(draft.postalCode);
    if (!listingsId || !country || !postalCode) {
        throw new AdminLiveTvServiceError('invalid-input', 'Country, postal code, and lineup are required.');
    }
    return {
        ...raw,
        Country: country,
        EnableAllTuners: draft.enableAllTuners,
        EnabledTuners: draft.enableAllTuners ? [] : normalizedIds(draft.enabledTunerIds),
        Id: id,
        ListingsId: listingsId,
        Type: 'SchedulesDirect',
        ZipCode: postalCode
    };
}

export function normalizeAdminLiveTvLineups(raw: unknown): AdminLiveTvLineup[] {
    if (!Array.isArray(raw)) invalidResponse();
    return raw.flatMap(value => {
        const pair = value as NameIdPair;
        const id = displayText(pair?.Id);
        if (!id) return [];
        return [{ id, label: displayText(pair.Name) || 'Unnamed lineup' }];
    });
}

/** SDK declares this endpoint as File; the Jellyfin server proxies region arrays. */
export function normalizeAdminLiveTvCountries(raw: unknown): AdminLiveTvCountry[] {
    requireObject(raw);
    const countries: AdminLiveTvCountry[] = [];
    const seen = new Set<string>();
    Object.entries(raw).forEach(([ region, value ]) => {
        if (region === 'ZZZ' || !Array.isArray(value)) return;
        value.forEach(entry => {
            if (!entry || typeof entry !== 'object') return;
            const code = displayText(Reflect.get(entry, 'shortName'));
            const label = displayText(Reflect.get(entry, 'fullName'));
            if (!code || !label || seen.has(code.toLowerCase())) return;
            seen.add(code.toLowerCase());
            countries.push({ code, label });
        });
    });
    return countries.sort((left, right) => left.label.localeCompare(right.label));
}
