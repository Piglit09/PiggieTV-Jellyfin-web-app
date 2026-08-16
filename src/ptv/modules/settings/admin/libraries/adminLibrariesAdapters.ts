import type { LibraryOptionsResultDto } from '@jellyfin/sdk/lib/generated-client/models/library-options-result-dto';
import type { LibraryOptions } from '@jellyfin/sdk/lib/generated-client/models/library-options';
import type { TaskInfo } from '@jellyfin/sdk/lib/generated-client/models/task-info';
import type { VirtualFolderInfo } from '@jellyfin/sdk/lib/generated-client/models/virtual-folder-info';

import type { PtvIconName } from '../../../icons/iconRegistry';
import type {
    AdminLibraryDetail,
    AdminLibraryFilter,
    AdminLibraryKind,
    AdminLibraryOptionsForm,
    AdminLibraryOptionsPatch,
    AdminLibraryProviderGroup,
    AdminLibraryProviderSummary,
    AdminLibraryScanState,
    AdminLibrarySummary
} from './adminLibrariesModel';

type TypePresentation = Readonly<{
    icon: PtvIconName;
    kind: AdminLibraryKind;
    label: string;
}>;

const TYPE_PRESENTATION: Readonly<Record<string, TypePresentation>> = {
    books: { icon: 'books', kind: 'books', label: 'Books' },
    boxsets: { icon: 'collections', kind: 'collections', label: 'Collections' },
    homevideos: { icon: 'folders', kind: 'home-videos', label: 'Home Videos' },
    mixed: { icon: 'libraries', kind: 'mixed', label: 'Mixed Media' },
    movies: { icon: 'movies', kind: 'movies', label: 'Movies' },
    music: { icon: 'music', kind: 'music', label: 'Music' },
    musicvideos: { icon: 'playback', kind: 'music-videos', label: 'Music Videos' },
    tvshows: { icon: 'shows', kind: 'shows', label: 'Shows' }
};

const OPTION_FIELD_MAP = {
    automaticallyAddToCollection: 'AutomaticallyAddToCollection',
    automaticSeriesGrouping: 'EnableAutomaticSeriesGrouping',
    chapterImages: 'EnableChapterImageExtraction',
    chapterImagesDuringScan: 'ExtractChapterImagesDuringLibraryScan',
    embeddedEpisodeInfo: 'EnableEmbeddedEpisodeInfos',
    embeddedExtrasTitles: 'EnableEmbeddedExtrasTitles',
    embeddedTitles: 'EnableEmbeddedTitles',
    enabled: 'Enabled',
    lufsAnalysis: 'EnableLUFSScan',
    photos: 'EnablePhotos',
    realTimeMonitoring: 'EnableRealtimeMonitor',
    saveTrickplayWithMedia: 'SaveTrickplayWithMedia',
    trickplayImages: 'EnableTrickplayImageExtraction',
    trickplayImagesDuringScan: 'ExtractTrickplayImagesDuringLibraryScan'
} as const satisfies Record<keyof AdminLibraryOptionsForm, keyof LibraryOptions>;

const ADMIN_LIBRARY_OPTION_FIELDS = Object.keys(
    OPTION_FIELD_MAP
) as Array<keyof AdminLibraryOptionsForm>;

function cleanText(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function booleanOrNull(value: unknown) {
    return typeof value === 'boolean' ? value : null;
}

function uniqueText(values: readonly unknown[]) {
    const result: string[] = [];
    const seen = new Set<string>();
    values.forEach(value => {
        if (typeof value !== 'string' || !value.trim() || seen.has(value)) return;
        seen.add(value);
        result.push(value);
    });
    return result;
}

export function getAdminLibraryTypePresentation(collectionType: unknown): TypePresentation {
    const normalized = cleanText(collectionType).toLowerCase();
    if (!normalized) return TYPE_PRESENTATION.mixed;
    return TYPE_PRESENTATION[normalized] || {
        icon: 'library',
        kind: 'other',
        label: 'Other'
    };
}

export function getAdminLibraryIdentity(value: unknown) {
    return cleanText(value).toLowerCase();
}

export function getAdminLibraryLocations(folder: VirtualFolderInfo) {
    const paths = [
        ...(Array.isArray(folder.Locations) ? folder.Locations : []),
        ...(Array.isArray(folder.LibraryOptions?.PathInfos) ?
            folder.LibraryOptions.PathInfos.map(path => path?.Path) : [])
    ];
    return uniqueText(paths);
}

export function normalizeAdminLibrary(
    folder: VirtualFolderInfo,
    scanTask?: TaskInfo | null,
    scanStatusAvailable = true
): AdminLibrarySummary {
    const id = cleanText(folder.ItemId) || null;
    const backendName = cleanText(folder.Name);
    const name = backendName || 'Unnamed library';
    const collectionType = cleanText(folder.CollectionType).toLowerCase();
    const presentation = getAdminLibraryTypePresentation(collectionType);
    const locations = getAdminLibraryLocations(folder);
    const taskRunning = scanTask?.State === 'Running' || scanTask?.State === 'Cancelling';
    const itemRunning = (
        typeof folder.RefreshProgress === 'number'
        && folder.RefreshProgress > 0
        && folder.RefreshProgress < 100
    ) || /running|refresh|scan/i.test(cleanText(folder.RefreshStatus));
    let scanState: AdminLibraryScanState = scanStatusAvailable ? 'idle' : 'unavailable';
    if (taskRunning || itemRunning) {
        scanState = 'running';
    }
    let warning: string | null = null;
    if (!backendName) warning = 'The server did not provide a library name.';
    else if (!id) warning = 'The server did not provide a management identifier.';

    return {
        collectionType,
        displayType: presentation.label,
        folderCount: locations.length,
        icon: presentation.icon,
        id,
        kind: presentation.kind,
        locations,
        manageable: Boolean(id && backendName),
        name,
        optionsAvailable: Boolean(folder.LibraryOptions),
        pathManagementSupported: collectionType !== 'boxsets',
        refreshProgress: typeof folder.RefreshProgress === 'number' ? folder.RefreshProgress : null,
        removable: collectionType !== 'boxsets',
        scanState,
        warning
    };
}

export function normalizeAdminLibraries(
    folders: readonly VirtualFolderInfo[],
    tasks: readonly TaskInfo[] = [],
    scanStatusAvailable = true
) {
    const scanTask = tasks.find(task => task.Key === 'RefreshLibrary') || null;
    return folders.map(folder => normalizeAdminLibrary(folder, scanTask, scanStatusAvailable));
}

export function normalizeAdminLibraryOptions(options: LibraryOptions): AdminLibraryOptionsForm {
    return {
        automaticallyAddToCollection: booleanOrNull(options.AutomaticallyAddToCollection),
        automaticSeriesGrouping: booleanOrNull(options.EnableAutomaticSeriesGrouping),
        chapterImages: booleanOrNull(options.EnableChapterImageExtraction),
        chapterImagesDuringScan: booleanOrNull(options.ExtractChapterImagesDuringLibraryScan),
        embeddedEpisodeInfo: booleanOrNull(options.EnableEmbeddedEpisodeInfos),
        embeddedExtrasTitles: booleanOrNull(options.EnableEmbeddedExtrasTitles),
        embeddedTitles: booleanOrNull(options.EnableEmbeddedTitles),
        enabled: booleanOrNull(options.Enabled),
        lufsAnalysis: booleanOrNull(options.EnableLUFSScan),
        photos: booleanOrNull(options.EnablePhotos),
        realTimeMonitoring: booleanOrNull(options.EnableRealtimeMonitor),
        saveTrickplayWithMedia: booleanOrNull(options.SaveTrickplayWithMedia),
        trickplayImages: booleanOrNull(options.EnableTrickplayImageExtraction),
        trickplayImagesDuringScan: booleanOrNull(options.ExtractTrickplayImagesDuringLibraryScan)
    };
}

/** Compares only the library option fields owned by this native form. */
export function areAdminLibraryOptionsEqual(
    left: AdminLibraryOptionsForm,
    right: AdminLibraryOptionsForm
) {
    return ADMIN_LIBRARY_OPTION_FIELDS.every(field => left[field] === right[field]);
}

function defaultProviderNames(
    values: readonly Readonly<{ DefaultEnabled?: boolean; Name?: string | null }>[] | undefined
) {
    return uniqueText((values || []).filter(value => value.DefaultEnabled).map(value => value.Name));
}

function providerNames(
    configured: readonly string[] | null | undefined,
    available: readonly Readonly<{ DefaultEnabled?: boolean; Name?: string | null }>[] | undefined
) {
    return Array.isArray(configured) ? uniqueText(configured) : defaultProviderNames(available);
}

export function normalizeAdminLibraryProviders(
    options: LibraryOptions,
    available?: LibraryOptionsResultDto | null
): AdminLibraryProviderSummary {
    const configuredTypes = Array.isArray(options.TypeOptions) ? options.TypeOptions : [];
    const availableTypes = Array.isArray(available?.TypeOptions) ? available.TypeOptions : [];
    const mediaTypes = uniqueText([
        ...configuredTypes.map(type => type.Type),
        ...availableTypes.map(type => type.Type)
    ]);
    const groups: AdminLibraryProviderGroup[] = mediaTypes.map(mediaType => {
        const configured = configuredTypes.find(type => type.Type === mediaType);
        const optionsForType = availableTypes.find(type => type.Type === mediaType);
        return {
            imageProviders: providerNames(configured?.ImageFetchers, optionsForType?.ImageFetchers),
            mediaType,
            metadataProviders: providerNames(configured?.MetadataFetchers, optionsForType?.MetadataFetchers)
        };
    });

    return {
        groups,
        metadataSavers: providerNames(options.MetadataSavers, available?.MetadataSavers)
    };
}

export function normalizeAdminLibraryDetail(
    folder: VirtualFolderInfo,
    available?: LibraryOptionsResultDto | null,
    scanTask?: TaskInfo | null,
    scanStatusAvailable = true
): AdminLibraryDetail {
    const summary = normalizeAdminLibrary(folder, scanTask, scanStatusAvailable);
    const rawOptions = folder.LibraryOptions || null;
    return {
        ...summary,
        options: rawOptions ? normalizeAdminLibraryOptions(rawOptions) : null,
        providerSummary: rawOptions ? normalizeAdminLibraryProviders(rawOptions, available) : null,
        rawOptions
    };
}

export function selectAdminLibraries(
    libraries: readonly AdminLibrarySummary[],
    options: Readonly<{ filter: AdminLibraryFilter; query: string }>
) {
    const query = options.query.trim().toLocaleLowerCase();
    return libraries.filter(library => (
        (options.filter === 'all' || library.kind === options.filter)
        && (!query || library.name.toLocaleLowerCase().includes(query))
    ));
}

function cloneValue<T>(value: T): T {
    if (Array.isArray(value)) return value.map(item => cloneValue(item)) as T;
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([ key, nested ]) => [ key, cloneValue(nested) ])
        ) as T;
    }
    return value;
}

/** Clones the complete authoritative object and patches only user-edited fields. */
export function patchAdminLibraryOptions(
    authoritative: LibraryOptions,
    patch: AdminLibraryOptionsPatch
): LibraryOptions {
    const result = cloneValue(authoritative);
    Object.entries(patch).forEach(([ field, value ]) => {
        if (typeof value !== 'boolean') return;
        const backendField = OPTION_FIELD_MAP[field as keyof AdminLibraryOptionsForm];
        result[backendField] = value as never;
    });
    return result;
}

export function buildAdminLibraryOptionsPatch(
    current: AdminLibraryOptionsForm,
    confirmed: AdminLibraryOptionsForm
): AdminLibraryOptionsPatch {
    const patch: AdminLibraryOptionsPatch = {};
    ADMIN_LIBRARY_OPTION_FIELDS.forEach(field => {
        if (current[field] !== confirmed[field] && typeof current[field] === 'boolean') {
            Object.assign(patch, { [field]: current[field] });
        }
    });
    return patch;
}

function allProviderNames(values: readonly Readonly<{ Name?: string | null }>[] | undefined) {
    return uniqueText((values || []).map(value => value.Name));
}

/** Mirrors the defaults presented by Jellyfin's current new-library editor. */
export function buildDefaultAdminLibraryOptions(
    available: LibraryOptionsResultDto,
    locations: readonly string[]
): LibraryOptions {
    return {
        AllowEmbeddedSubtitles: 'AllowAll',
        AutomaticallyAddToCollection: false,
        AutomaticRefreshIntervalDays: 0,
        CustomTagDelimiters: [ '/', '|', ';', '"' ],
        DelimiterWhitelist: [],
        DisabledLocalMetadataReaders: [],
        DisabledLyricFetchers: allProviderNames(available.LyricFetchers)
            .filter(name => !defaultProviderNames(available.LyricFetchers).includes(name)),
        DisabledMediaSegmentProviders: allProviderNames(available.MediaSegmentProviders)
            .filter(name => !defaultProviderNames(available.MediaSegmentProviders).includes(name)),
        DisabledSubtitleFetchers: allProviderNames(available.SubtitleFetchers)
            .filter(name => !defaultProviderNames(available.SubtitleFetchers).includes(name)),
        EnableAutomaticSeriesGrouping: false,
        EnableChapterImageExtraction: false,
        EnableEmbeddedEpisodeInfos: false,
        EnableEmbeddedExtrasTitles: false,
        EnableEmbeddedTitles: false,
        EnableInternetProviders: true,
        EnableLUFSScan: true,
        EnablePhotos: true,
        EnableRealtimeMonitor: true,
        EnableTrickplayImageExtraction: false,
        Enabled: true,
        ExtractChapterImagesDuringLibraryScan: false,
        ExtractTrickplayImagesDuringLibraryScan: false,
        LocalMetadataReaderOrder: allProviderNames(available.MetadataReaders),
        LyricFetcherOrder: allProviderNames(available.LyricFetchers),
        MediaSegmentProviderOrder: allProviderNames(available.MediaSegmentProviders),
        MetadataCountryCode: '',
        MetadataSavers: defaultProviderNames(available.MetadataSavers),
        PathInfos: locations.map(Path => ({ Path })),
        PreferredMetadataLanguage: '',
        PreferNonstandardArtistsTag: false,
        RequirePerfectSubtitleMatch: true,
        SaveLocalMetadata: false,
        SaveLyricsWithMedia: false,
        SaveSubtitlesWithMedia: true,
        SaveTrickplayWithMedia: false,
        SeasonZeroDisplayName: 'Specials',
        SkipSubtitlesIfAudioTrackMatches: false,
        SkipSubtitlesIfEmbeddedSubtitlesPresent: false,
        SubtitleDownloadLanguages: [],
        SubtitleFetcherOrder: allProviderNames(available.SubtitleFetchers),
        TypeOptions: (available.TypeOptions || []).flatMap(type => {
            const Type = cleanText(type.Type);
            if (!Type) return [];
            return [{
                ImageFetcherOrder: allProviderNames(type.ImageFetchers),
                ImageFetchers: defaultProviderNames(type.ImageFetchers),
                ImageOptions: (type.DefaultImageOptions || []).map(option => ({ ...option })),
                MetadataFetcherOrder: allProviderNames(type.MetadataFetchers),
                MetadataFetchers: defaultProviderNames(type.MetadataFetchers),
                Type
            }];
        }),
        UseCustomTagDelimiters: false
    };
}
