import type { LibraryOptions } from '@jellyfin/sdk/lib/generated-client/models/library-options';
import type { PtvIconName } from '../../../icons/iconRegistry';

export type AdminLibraryKind =
    | 'movies'
    | 'shows'
    | 'music'
    | 'books'
    | 'home-videos'
    | 'music-videos'
    | 'mixed'
    | 'collections'
    | 'other';

export type AdminLibraryScanState = 'idle' | 'running' | 'requested' | 'unavailable';

export type AdminLibrarySummary = Readonly<{
    collectionType: string;
    displayType: string;
    folderCount: number;
    icon: PtvIconName;
    id: string | null;
    kind: AdminLibraryKind;
    locations: readonly string[];
    manageable: boolean;
    name: string;
    optionsAvailable: boolean;
    pathManagementSupported: boolean;
    removable: boolean;
    refreshProgress: number | null;
    scanState: AdminLibraryScanState;
    warning: string | null;
}>;

export type AdminLibraryOptionValue = boolean | null;

export type AdminLibraryOptionsForm = Readonly<{
    automaticallyAddToCollection: AdminLibraryOptionValue;
    automaticSeriesGrouping: AdminLibraryOptionValue;
    chapterImages: AdminLibraryOptionValue;
    chapterImagesDuringScan: AdminLibraryOptionValue;
    embeddedEpisodeInfo: AdminLibraryOptionValue;
    embeddedExtrasTitles: AdminLibraryOptionValue;
    embeddedTitles: AdminLibraryOptionValue;
    enabled: AdminLibraryOptionValue;
    lufsAnalysis: AdminLibraryOptionValue;
    photos: AdminLibraryOptionValue;
    realTimeMonitoring: AdminLibraryOptionValue;
    saveTrickplayWithMedia: AdminLibraryOptionValue;
    trickplayImages: AdminLibraryOptionValue;
    trickplayImagesDuringScan: AdminLibraryOptionValue;
}>;

export type AdminLibraryProviderGroup = Readonly<{
    imageProviders: readonly string[];
    mediaType: string;
    metadataProviders: readonly string[];
}>;

export type AdminLibraryProviderSummary = Readonly<{
    groups: readonly AdminLibraryProviderGroup[];
    metadataSavers: readonly string[];
}>;

export type AdminLibraryDetail = AdminLibrarySummary & Readonly<{
    options: AdminLibraryOptionsForm | null;
    providerSummary: AdminLibraryProviderSummary | null;
    rawOptions: LibraryOptions | null;
}>;

export type CreateAdminLibraryInput = Readonly<{
    collectionType: string;
    locations: readonly string[];
    name: string;
}>;

export type AdminLibraryOptionsPatch = Partial<AdminLibraryOptionsForm>;

export type AdminLibraryFilter = AdminLibraryKind | 'all';
