import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { BaseItemPerson } from '@jellyfin/sdk/lib/generated-client/models/base-item-person';
import type { ExternalIdMediaType } from '@jellyfin/sdk/lib/generated-client/models/external-id-media-type';
import type { ImageType } from '@jellyfin/sdk/lib/generated-client/models/image-type';
import type { MetadataEditorInfo } from '@jellyfin/sdk/lib/generated-client/models/metadata-editor-info';
import type { MetadataField } from '@jellyfin/sdk/lib/generated-client/models/metadata-field';
import type { NameGuidPair } from '@jellyfin/sdk/lib/generated-client/models/name-guid-pair';
import type { RemoteImageInfo } from '@jellyfin/sdk/lib/generated-client/models/remote-image-info';
import type { RemoteSearchResult } from '@jellyfin/sdk/lib/generated-client/models/remote-search-result';
import type {
    AdminReadingMediaClass,
    AdminReadingMetadataCandidate,
    AdminReadingStructuredQuery
} from './adminReadingMetadataModel';

export const ADMIN_METADATA_CATALOG_PAGE_SIZE = 50;
export const ADMIN_METADATA_REMOTE_IMAGE_PAGE_SIZE = 30;

export type AdminMetadataCatalogRoot = Readonly<{
    childCount: number | null;
    collectionType: string;
    id: string;
    name: string;
    primaryImageTag: string | null;
    type: string;
}>;

export type AdminMetadataCatalogItem = Readonly<{
    childCount: number | null;
    id: string;
    indexNumber: number | null;
    isFolder: boolean;
    name: string;
    parentId: string | null;
    parentIndexNumber: number | null;
    primaryImageTag: string | null;
    productionYear: number | null;
    type: string;
}>;

export type AdminMetadataCatalogRequest = Readonly<{
    libraryId?: string;
    parentId?: string;
    searchTerm?: string;
    startIndex?: number;
    userId: string;
}>;

export type AdminMetadataCatalogPage = Readonly<{
    hasNextPage: boolean;
    items: readonly AdminMetadataCatalogItem[];
    limit: number;
    scope: 'children' | 'search';
    startIndex: number;
    totalRecordCount: number | null;
}>;

export type AdminMetadataPerson = Readonly<{
    id: string | null;
    name: string;
    role: string;
    source: BaseItemPerson | null;
    type: string;
}>;

export type AdminMetadataStudio = Readonly<{
    id: string | null;
    name: string;
    source: NameGuidPair | null;
}>;

export type AdminMetadataItem = Readonly<{
    backdropImageTags: readonly string[];
    collectionType: string;
    id: string;
    imageTags: Readonly<Record<string, string>>;
    isFolder: boolean;
    name: string;
    parentId: string | null;
    primaryImageTag: string | null;
    type: string;
}>;

/**
 * Values mirror the editable item contract. Empty strings and nulls are kept
 * distinct from unavailable source documents; a form is never created until
 * the authoritative item has passed validation.
 */
export type AdminMetadataForm = Readonly<{
    communityRating: number | null;
    criticRating: number | null;
    customRating: string;
    endDate: string;
    genres: readonly string[];
    indexNumber: number | null;
    lockData: boolean | null;
    lockedFields: readonly MetadataField[];
    name: string;
    originalTitle: string;
    overview: string;
    parentIndexNumber: number | null;
    people: readonly AdminMetadataPerson[];
    premiereDate: string;
    productionLocations: readonly string[];
    productionYear: number | null;
    providerIds: Readonly<Record<string, string | null>>;
    runtimeMinutes: number | null;
    sortName: string;
    studios: readonly AdminMetadataStudio[];
    tagline: string;
    tags: readonly string[];
    officialRating: string;
}>;

export type AdminMetadataEditableField = keyof AdminMetadataForm;

export type AdminMetadataProviderField = Readonly<{
    available: boolean;
    key: string;
    label: string;
    type: ExternalIdMediaType | null;
    value: string | null;
}>;

export type AdminMetadataRatingOption = Readonly<{
    label: string;
    value: string;
}>;

export type AdminMetadataEditor = Readonly<{
    editableFields: readonly AdminMetadataEditableField[];
    parentalRatings: readonly AdminMetadataRatingOption[];
    providerFields: readonly AdminMetadataProviderField[];
}>;

export type AdminMetadataAncestor = Readonly<{
    id: string;
    name: string;
    type: string;
}>;

/**
 * The raw documents remain inside the data-layer bundle solely so later
 * writes can clone the full authoritative object. UI code should consume the
 * normalized item, form and editor projections.
 */
export type AdminMetadataItemBundle = Readonly<{
    ancestors: readonly AdminMetadataAncestor[];
    authoritativeItem: BaseItemDto;
    editor: AdminMetadataEditor;
    editorInfo: MetadataEditorInfo;
    form: AdminMetadataForm;
    item: AdminMetadataItem;
}>;

export type AdminMetadataArtwork = Readonly<{
    height: number | null;
    id: string;
    imageType: ImageType;
    index: number;
    itemId: string;
    previewUrl: string;
    size: number | null;
    tag: string | null;
    width: number | null;
}>;

export type AdminMetadataRemoteImageProvider = Readonly<{
    name: string;
    supportedImageTypes: readonly ImageType[];
}>;

export type AdminMetadataRemoteImage = Readonly<{
    height: number | null;
    id: string;
    imageType: ImageType | null;
    language: string | null;
    providerName: string;
    rating: number | null;
    source: RemoteImageInfo;
    thumbnailUrl: string | null;
    url: string;
    width: number | null;
}>;

export type AdminMetadataRemoteImagePage = Readonly<{
    hasNextPage: boolean;
    items: readonly AdminMetadataRemoteImage[];
    limit: number;
    startIndex: number;
    totalRecordCount: number | null;
}>;

export const ADMIN_METADATA_IDENTIFY_TYPES = [
    'Movie',
    'Trailer',
    'Series',
    'BoxSet',
    'Person',
    'Book',
    'MusicAlbum',
    'MusicArtist',
    'MusicVideo'
] as const;

export type AdminMetadataIdentifyType = typeof ADMIN_METADATA_IDENTIFY_TYPES[number];

export type AdminMetadataIdentifyQuery = Readonly<{
    author?: string;
    chapterNumber?: string;
    isbn?: string;
    issueNumber?: string;
    mediaClass?: AdminReadingMediaClass;
    name: string;
    providerIds: Readonly<Record<string, string | null>>;
    providerId?: string;
    providerName?: string;
    seriesTitle?: string;
    volumeNumber?: string;
    year: number | null;
}>;

export type AdminMetadataIdentifyResult = Readonly<{
    id: string;
    imageUrl: string | null;
    name: string;
    overview: string;
    providerIds: Readonly<Record<string, string | null>>;
    providerName: string;
    readingCandidate?: AdminReadingMetadataCandidate;
    readingQuery?: AdminReadingStructuredQuery;
    source: RemoteSearchResult | null;
    year: number | null;
}>;

export type AdminMetadataRefreshMode =
    | 'scan'
    | 'missing'
    | 'replace-metadata'
    | 'replace-images'
    | 'replace-all';

export type AdminMetadataRefreshOptions = Readonly<{
    imageMode: 'default' | 'full';
    metadataMode: 'default' | 'full';
    recursive: boolean;
    regenerateTrickplay: boolean;
    replaceAllImages: boolean;
    replaceAllMetadata: boolean;
}>;

export type AdminMetadataManagerServiceErrorCode =
    | 'artwork-unavailable'
    | 'catalog-unavailable'
    | 'conflict'
    | 'identify-unavailable'
    | 'invalid-input'
    | 'invalid-response'
    | 'item-not-found'
    | 'item-unavailable'
    | 'remote-artwork-unavailable'
    | 'refresh-unavailable'
    | 'save-failed'
    | 'unsupported-item-type';

/** User-safe service error; raw response bodies and item content are omitted. */
export class AdminMetadataManagerServiceError extends Error {
    public readonly code: AdminMetadataManagerServiceErrorCode;

    public constructor(code: AdminMetadataManagerServiceErrorCode, message: string) {
        super(message);
        this.code = code;
        this.name = 'AdminMetadataManagerServiceError';
    }
}
