import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { BaseItemPerson } from '@jellyfin/sdk/lib/generated-client/models/base-item-person';
import type { ExternalIdInfo } from '@jellyfin/sdk/lib/generated-client/models/external-id-info';
import type { ImageInfo } from '@jellyfin/sdk/lib/generated-client/models/image-info';
import type { ImageProviderInfo } from '@jellyfin/sdk/lib/generated-client/models/image-provider-info';
import type { MetadataEditorInfo } from '@jellyfin/sdk/lib/generated-client/models/metadata-editor-info';
import type { MetadataField } from '@jellyfin/sdk/lib/generated-client/models/metadata-field';
import type { NameGuidPair } from '@jellyfin/sdk/lib/generated-client/models/name-guid-pair';
import type { RemoteImageInfo } from '@jellyfin/sdk/lib/generated-client/models/remote-image-info';
import type { RemoteImageResult } from '@jellyfin/sdk/lib/generated-client/models/remote-image-result';
import type { RemoteSearchResult } from '@jellyfin/sdk/lib/generated-client/models/remote-search-result';
import type { ImageUrlsApi } from '@jellyfin/sdk/lib/utils/api/image-urls-api';

import {
    ADMIN_METADATA_CATALOG_PAGE_SIZE,
    ADMIN_METADATA_IDENTIFY_TYPES,
    ADMIN_METADATA_REMOTE_IMAGE_PAGE_SIZE,
    AdminMetadataManagerServiceError,
    type AdminMetadataAncestor,
    type AdminMetadataArtwork,
    type AdminMetadataCatalogItem,
    type AdminMetadataCatalogPage,
    type AdminMetadataCatalogRoot,
    type AdminMetadataEditableField,
    type AdminMetadataEditor,
    type AdminMetadataForm,
    type AdminMetadataIdentifyResult,
    type AdminMetadataItem,
    type AdminMetadataItemBundle,
    type AdminMetadataPerson,
    type AdminMetadataProviderField,
    type AdminMetadataRemoteImage,
    type AdminMetadataRemoteImagePage,
    type AdminMetadataRemoteImageProvider,
    type AdminMetadataStudio
} from './adminMetadataManagerModel';
import {
    normalizeAdminMetadataProviderDescription,
    normalizeAdminMetadataProviderImageUrl
} from './adminMetadataProviderPresentation';

const IDENTIFY_TYPES = new Set<string>(ADMIN_METADATA_IDENTIFY_TYPES);

function invalidResponse(): never {
    throw new AdminMetadataManagerServiceError(
        'invalid-response',
        'Metadata Manager received an incomplete server response.'
    );
}

function requireObject(value: unknown): asserts value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalidResponse();
}

function identity(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
}

function text(value: unknown) {
    return typeof value === 'string' ? value : '';
}

function textOrNull(value: unknown) {
    return typeof value === 'string' && value ? value : null;
}

function numberOrNull(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function integerOrNull(value: unknown) {
    return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function stringArray(value: unknown) {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function arrayOrConfirmedEmpty<T>(
    value: readonly T[] | null | undefined,
    totalRecordCount: number | null
): readonly T[] {
    if (Array.isArray(value)) return value;
    if (value == null && totalRecordCount === 0) return [];
    return invalidResponse();
}

function stringRecord(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
    ));
}

function nullableStringRecord(value: unknown): Record<string, string | null> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(
        (entry): entry is [string, string | null] => entry[1] === null || typeof entry[1] === 'string'
    ));
}

function normalizeDate(value: unknown) {
    if (typeof value !== 'string' || !value) return '';
    const date = value.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function cloneValue<T>(value: T): T {
    if (Array.isArray(value)) return value.map(entry => cloneValue(entry)) as T;
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([ key, nested ]) => [
            key,
            cloneValue(nested)
        ])) as T;
    }
    return value;
}

function requireItemIdentity(item: BaseItemDto) {
    requireObject(item);
    const id = identity(item.Id);
    const name = typeof item.Name === 'string' ? item.Name : '';
    const type = identity(item.Type);
    if (!id || !name.trim() || !type) invalidResponse();
    return { id, name, type };
}

export function normalizeAdminMetadataRoot(item: BaseItemDto): AdminMetadataCatalogRoot {
    const { id, name, type } = requireItemIdentity(item);
    return {
        childCount: integerOrNull(item.ChildCount),
        collectionType: identity(item.CollectionType),
        id,
        name,
        primaryImageTag: textOrNull(item.ImageTags?.Primary),
        type
    };
}

export function normalizeAdminMetadataRoots(items: readonly BaseItemDto[]) {
    if (!Array.isArray(items)) invalidResponse();
    return items.map(normalizeAdminMetadataRoot);
}

export function normalizeAdminMetadataCatalogItem(item: BaseItemDto): AdminMetadataCatalogItem {
    const { id, name, type } = requireItemIdentity(item);
    return {
        childCount: integerOrNull(item.ChildCount),
        id,
        indexNumber: integerOrNull(item.IndexNumber),
        isFolder: item.IsFolder === true,
        name,
        parentId: textOrNull(item.ParentId),
        parentIndexNumber: integerOrNull(item.ParentIndexNumber),
        primaryImageTag: textOrNull(item.ImageTags?.Primary),
        productionYear: integerOrNull(item.ProductionYear),
        type
    };
}

export function normalizeAdminMetadataCatalogPage(
    value: Readonly<{
        Items?: readonly BaseItemDto[] | null;
        TotalRecordCount?: number | null;
    }>,
    startIndex: number,
    scope: 'children' | 'search'
): AdminMetadataCatalogPage {
    requireObject(value);
    const totalRecordCount = integerOrNull(value.TotalRecordCount);
    const sourceItems = arrayOrConfirmedEmpty(value.Items, totalRecordCount);
    const items = sourceItems.map(normalizeAdminMetadataCatalogItem);
    return {
        hasNextPage: totalRecordCount === null ?
            items.length === ADMIN_METADATA_CATALOG_PAGE_SIZE :
            startIndex + items.length < totalRecordCount,
        items,
        limit: ADMIN_METADATA_CATALOG_PAGE_SIZE,
        scope,
        startIndex,
        totalRecordCount
    };
}

function normalizePerson(person: BaseItemPerson): AdminMetadataPerson {
    return {
        id: textOrNull(person.Id),
        name: text(person.Name),
        role: text(person.Role),
        source: cloneValue(person),
        type: identity(person.Type)
    };
}

function normalizeStudio(studio: NameGuidPair): AdminMetadataStudio {
    return {
        id: textOrNull(studio.Id),
        name: text(studio.Name),
        source: cloneValue(studio)
    };
}

export function normalizeAdminMetadataItem(item: BaseItemDto): AdminMetadataItem {
    const { id, name, type } = requireItemIdentity(item);
    return {
        backdropImageTags: stringArray(item.BackdropImageTags),
        collectionType: identity(item.CollectionType),
        id,
        imageTags: stringRecord(item.ImageTags),
        isFolder: item.IsFolder === true,
        name,
        parentId: textOrNull(item.ParentId),
        primaryImageTag: textOrNull(item.ImageTags?.Primary),
        type
    };
}

export function normalizeAdminMetadataForm(item: BaseItemDto): AdminMetadataForm {
    requireItemIdentity(item);
    return {
        communityRating: numberOrNull(item.CommunityRating),
        criticRating: numberOrNull(item.CriticRating),
        customRating: text(item.CustomRating),
        endDate: normalizeDate(item.EndDate),
        genres: stringArray(item.Genres),
        indexNumber: integerOrNull(item.IndexNumber),
        lockData: typeof item.LockData === 'boolean' ? item.LockData : null,
        lockedFields: stringArray(item.LockedFields) as MetadataField[],
        name: item.Name!,
        officialRating: text(item.OfficialRating),
        originalTitle: text(item.OriginalTitle),
        overview: text(item.Overview),
        parentIndexNumber: integerOrNull(item.ParentIndexNumber),
        people: Array.isArray(item.People) ? item.People.map(normalizePerson) : [],
        premiereDate: normalizeDate(item.PremiereDate),
        productionLocations: stringArray(item.ProductionLocations),
        productionYear: integerOrNull(item.ProductionYear),
        providerIds: nullableStringRecord(item.ProviderIds),
        runtimeMinutes: typeof item.RunTimeTicks === 'number' && Number.isFinite(item.RunTimeTicks) ?
            item.RunTimeTicks / 600_000_000 : null,
        sortName: text(item.ForcedSortName),
        studios: Array.isArray(item.Studios) ? item.Studios.map(normalizeStudio) : [],
        tagline: Array.isArray(item.Taglines) ? text(item.Taglines[0]) : '',
        tags: stringArray(item.Tags)
    };
}

const ORIGINAL_TITLE_TYPES = new Set([
    'Audio', 'AudioBook', 'Book', 'BoxSet', 'Episode', 'Movie', 'MusicAlbum',
    'MusicArtist', 'MusicVideo', 'Person', 'Photo', 'Season', 'Series', 'Trailer', 'Video'
]);
const TAGLINE_TYPES = new Set([ 'BoxSet', 'Movie', 'MusicVideo', 'Series', 'Trailer' ]);
const RELEASE_TYPES = new Set([
    'Audio', 'AudioBook', 'Book', 'BoxSet', 'Episode', 'Movie', 'MusicAlbum',
    'MusicArtist', 'MusicVideo', 'Person', 'Season', 'Series', 'Trailer', 'Video'
]);
const END_DATE_TYPES = new Set([ 'Person', 'Series' ]);
const INDEX_TYPES = new Set([ 'Audio', 'AudioBook', 'Book', 'Episode', 'Season' ]);
const PARENT_INDEX_TYPES = new Set([ 'Audio', 'AudioBook', 'Book', 'Episode' ]);
const RATING_TYPES = new Set([
    'AudioBook', 'Book', 'BoxSet', 'Episode', 'Movie', 'MusicVideo', 'Series', 'Trailer', 'Video'
]);
const PEOPLE_TYPES = new Set([
    'Audio', 'AudioBook', 'Book', 'Episode', 'Movie', 'MusicVideo', 'Series', 'Trailer', 'Video'
]);
const STUDIO_TYPES = new Set([
    'Book', 'BoxSet', 'Episode', 'Movie', 'MusicVideo', 'Series', 'Trailer', 'Video'
]);
const PRODUCTION_LOCATION_TYPES = new Set([ 'Movie', 'Person', 'Series' ]);

export function getAdminMetadataEditableFields(
    item: BaseItemDto,
    editorInfo: MetadataEditorInfo
): readonly AdminMetadataEditableField[] {
    const { type } = requireItemIdentity(item);
    const fields: AdminMetadataEditableField[] = [
        'name', 'sortName', 'overview', 'genres', 'tags'
    ];
    if (ORIGINAL_TITLE_TYPES.has(type)) fields.push('originalTitle');
    if (TAGLINE_TYPES.has(type)) fields.push('tagline');
    if (RELEASE_TYPES.has(type)) fields.push('productionYear', 'premiereDate');
    if (END_DATE_TYPES.has(type)) fields.push('endDate');
    if (INDEX_TYPES.has(type)) fields.push('indexNumber');
    if (PARENT_INDEX_TYPES.has(type)) fields.push('parentIndexNumber');
    if (RATING_TYPES.has(type)) {
        fields.push('officialRating', 'customRating', 'communityRating', 'criticRating');
    }
    if (PEOPLE_TYPES.has(type)) fields.push('people');
    if (STUDIO_TYPES.has(type)) fields.push('studios');
    if (PRODUCTION_LOCATION_TYPES.has(type)) fields.push('productionLocations');
    if (type === 'Series') fields.push('runtimeMinutes');
    if (
        type === 'Book'
        || Object.keys(nullableStringRecord(item.ProviderIds)).length
        || (Array.isArray(editorInfo.ExternalIdInfos) && editorInfo.ExternalIdInfos.length)
    ) fields.push('providerIds');
    if (typeof item.LockData === 'boolean') fields.push('lockData');
    if (Array.isArray(item.LockedFields)) fields.push('lockedFields');
    return fields;
}

function normalizeProviderField(
    info: ExternalIdInfo,
    providerIds: Readonly<Record<string, string | null>>
): AdminMetadataProviderField | null {
    const key = identity(info.Key);
    if (!key) return null;
    const name = identity(info.Name);
    return {
        available: true,
        key,
        label: name || key,
        type: info.Type || null,
        value: Object.prototype.hasOwnProperty.call(providerIds, key) ? providerIds[key] : null
    };
}

export function normalizeAdminMetadataEditor(
    item: BaseItemDto,
    editorInfo: MetadataEditorInfo
): AdminMetadataEditor {
    if (!editorInfo || typeof editorInfo !== 'object' || Array.isArray(editorInfo)) invalidResponse();
    const providerIds = nullableStringRecord(item.ProviderIds);
    const providerFields: AdminMetadataProviderField[] = [];
    const seen = new Set<string>();
    (editorInfo.ExternalIdInfos || []).forEach(info => {
        const normalized = normalizeProviderField(info, providerIds);
        if (!normalized || seen.has(normalized.key)) return;
        seen.add(normalized.key);
        providerFields.push(normalized);
    });
    Object.entries(providerIds).forEach(([ key, value ]) => {
        if (seen.has(key)) return;
        seen.add(key);
        providerFields.push({
            available: false,
            key,
            label: key,
            type: null,
            value
        });
    });
    const parentalRatings = (editorInfo.ParentalRatingOptions || []).flatMap(rating => {
        const value = identity(rating.Name);
        return value ? [{ label: value, value }] : [];
    });
    return {
        editableFields: getAdminMetadataEditableFields(item, editorInfo),
        parentalRatings,
        providerFields
    };
}

export function normalizeAdminMetadataAncestors(items: readonly BaseItemDto[]): AdminMetadataAncestor[] {
    if (!Array.isArray(items)) invalidResponse();
    return items.flatMap(item => {
        const id = identity(item.Id);
        const name = typeof item.Name === 'string' ? item.Name : '';
        const type = identity(item.Type);
        return id && name.trim() && type ? [{ id, name, type }] : [];
    });
}

export function createAdminMetadataItemBundle(
    item: BaseItemDto,
    editorInfo: MetadataEditorInfo,
    ancestors: readonly BaseItemDto[]
): AdminMetadataItemBundle {
    return {
        ancestors: normalizeAdminMetadataAncestors(ancestors),
        authoritativeItem: item,
        editor: normalizeAdminMetadataEditor(item, editorInfo),
        editorInfo,
        form: normalizeAdminMetadataForm(item),
        item: normalizeAdminMetadataItem(item)
    };
}

function requireNullableNumber(value: unknown, integer = false) {
    if (value === null) return;
    if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isInteger(value))) {
        throw new AdminMetadataManagerServiceError('invalid-input', 'Review the numeric metadata values.');
    }
}

function requireDate(value: unknown) {
    if (typeof value !== 'string' || (value && !/^\d{4}-\d{2}-\d{2}$/.test(value))) {
        throw new AdminMetadataManagerServiceError('invalid-input', 'Review the metadata dates.');
    }
}

function requireTextArray(value: unknown) {
    if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
        throw new AdminMetadataManagerServiceError('invalid-input', 'Review the metadata list values.');
    }
}

export function requireAdminMetadataForm(form: AdminMetadataForm): AdminMetadataForm {
    requireObject(form);
    if (typeof form.name !== 'string' || !form.name.trim()) {
        throw new AdminMetadataManagerServiceError('invalid-input', 'Enter an item name.');
    }
    [
        form.customRating, form.endDate, form.name, form.officialRating, form.originalTitle,
        form.overview, form.premiereDate, form.sortName, form.tagline
    ].forEach(value => {
        if (typeof value !== 'string') {
            throw new AdminMetadataManagerServiceError('invalid-input', 'Review the metadata text values.');
        }
    });
    requireDate(form.premiereDate);
    requireDate(form.endDate);
    requireNullableNumber(form.productionYear, true);
    requireNullableNumber(form.indexNumber, true);
    requireNullableNumber(form.parentIndexNumber, true);
    requireNullableNumber(form.communityRating);
    requireNullableNumber(form.criticRating);
    requireNullableNumber(form.runtimeMinutes);
    if (form.runtimeMinutes !== null && form.runtimeMinutes < 0) {
        throw new AdminMetadataManagerServiceError('invalid-input', 'Runtime cannot be negative.');
    }
    [ form.genres, form.tags, form.productionLocations, form.lockedFields ].forEach(requireTextArray);
    if (form.lockData !== null && typeof form.lockData !== 'boolean') {
        throw new AdminMetadataManagerServiceError('invalid-input', 'Review the metadata lock setting.');
    }
    if (!form.providerIds || typeof form.providerIds !== 'object' || Array.isArray(form.providerIds)) {
        throw new AdminMetadataManagerServiceError('invalid-input', 'Review the provider identifiers.');
    }
    if (Object.values(form.providerIds).some(value => value !== null && typeof value !== 'string')) {
        throw new AdminMetadataManagerServiceError('invalid-input', 'Review the provider identifiers.');
    }
    if (!Array.isArray(form.people) || form.people.some(person => !person.name.trim())) {
        throw new AdminMetadataManagerServiceError('invalid-input', 'Every person must have a name.');
    }
    if (!Array.isArray(form.studios) || form.studios.some(studio => !studio.name.trim())) {
        throw new AdminMetadataManagerServiceError('invalid-input', 'Every studio must have a name.');
    }
    return form;
}

function materialPerson(person: AdminMetadataPerson) {
    return { id: person.id, name: person.name, role: person.role, type: person.type };
}

function materialStudio(studio: AdminMetadataStudio) {
    return { id: studio.id, name: studio.name };
}

function materialForm(form: AdminMetadataForm, fields: readonly AdminMetadataEditableField[]) {
    const result: Record<string, unknown> = {};
    fields.forEach(field => {
        if (field === 'people') {
            result.people = form.people.map(materialPerson);
        } else if (field === 'studios') {
            result.studios = form.studios.map(materialStudio);
        } else if (field === 'providerIds') {
            result.providerIds = Object.fromEntries(Object.entries(form.providerIds).sort(([ a ], [ b ]) =>
                a.localeCompare(b)));
        } else {
            result[field] = form[field];
        }
    });
    return result;
}

export function areAdminMetadataFormsEqual(
    left: AdminMetadataForm,
    right: AdminMetadataForm,
    fields: readonly AdminMetadataEditableField[] = Object.keys(left) as AdminMetadataEditableField[]
) {
    return JSON.stringify(materialForm(left, fields)) === JSON.stringify(materialForm(right, fields));
}

function toServerDate(value: string) {
    return value ? `${value}T00:00:00.000Z` : null;
}

function findFreshPerson(
    fresh: readonly BaseItemPerson[],
    desired: AdminMetadataPerson,
    index: number
) {
    if (desired.id) return fresh.find(person => identity(person.Id) === desired.id) || desired.source;
    return fresh[index] || desired.source;
}

function patchPeople(
    fresh: readonly BaseItemPerson[],
    desired: readonly AdminMetadataPerson[]
): BaseItemPerson[] {
    return desired.map((person, index) => ({
        ...cloneValue(findFreshPerson(fresh, person, index) || {}),
        Id: person.id || undefined,
        Name: person.name,
        Role: person.role,
        Type: (person.type || undefined) as BaseItemPerson['Type']
    }));
}

function findFreshStudio(
    fresh: readonly NameGuidPair[],
    desired: AdminMetadataStudio,
    index: number
) {
    if (desired.id) return fresh.find(studio => identity(studio.Id) === desired.id) || desired.source;
    return fresh[index] || desired.source;
}

function patchStudios(
    fresh: readonly NameGuidPair[],
    desired: readonly AdminMetadataStudio[]
): NameGuidPair[] {
    return desired.map((studio, index) => ({
        ...cloneValue(findFreshStudio(fresh, studio, index) || {}),
        Id: studio.id || undefined,
        Name: studio.name
    }));
}

const SIMPLE_FIELD_MAP = {
    communityRating: 'CommunityRating',
    criticRating: 'CriticRating',
    customRating: 'CustomRating',
    indexNumber: 'IndexNumber',
    lockData: 'LockData',
    name: 'Name',
    officialRating: 'OfficialRating',
    originalTitle: 'OriginalTitle',
    overview: 'Overview',
    parentIndexNumber: 'ParentIndexNumber',
    productionYear: 'ProductionYear',
    sortName: 'ForcedSortName'
} as const satisfies Partial<Record<AdminMetadataEditableField, keyof BaseItemDto>>;

function patchSimpleAdminMetadataFields(
    result: BaseItemDto,
    desired: AdminMetadataForm,
    changed: ReadonlySet<AdminMetadataEditableField>
) {
    Object.entries(SIMPLE_FIELD_MAP).forEach(([ field, backendField ]) => {
        if (!changed.has(field as AdminMetadataEditableField)) return;
        Reflect.set(result, backendField, desired[field as keyof AdminMetadataForm]);
    });
}

function patchAdminMetadataDatesAndRuntime(
    result: BaseItemDto,
    desired: AdminMetadataForm,
    changed: ReadonlySet<AdminMetadataEditableField>
) {
    if (changed.has('premiereDate')) result.PremiereDate = toServerDate(desired.premiereDate);
    if (changed.has('endDate')) result.EndDate = toServerDate(desired.endDate);
    if (changed.has('runtimeMinutes')) {
        result.RunTimeTicks = desired.runtimeMinutes === null ? null : desired.runtimeMinutes * 600_000_000;
    }
}

function patchAdminMetadataLists(
    result: BaseItemDto,
    authoritative: BaseItemDto,
    desired: AdminMetadataForm,
    changed: ReadonlySet<AdminMetadataEditableField>
) {
    if (changed.has('productionLocations')) result.ProductionLocations = [ ...desired.productionLocations ];
    if (changed.has('genres')) result.Genres = [ ...desired.genres ];
    if (changed.has('tags')) result.Tags = [ ...desired.tags ];
    if (changed.has('studios')) result.Studios = patchStudios(authoritative.Studios || [], desired.studios);
    if (changed.has('people')) result.People = patchPeople(authoritative.People || [], desired.people);
    if (changed.has('providerIds')) result.ProviderIds = cloneValue(desired.providerIds);
    if (changed.has('lockedFields')) result.LockedFields = [ ...desired.lockedFields ];
}

/**
 * Deep-clones the fresh complete DTO and changes only form fields that the
 * user edited. Fresh unknown/nested fields and unknown person properties are
 * retained even when the corresponding known row is edited.
 */
export function patchAdminMetadataItem(
    authoritative: BaseItemDto,
    desired: AdminMetadataForm,
    confirmed: AdminMetadataForm,
    editableFields: readonly AdminMetadataEditableField[]
): BaseItemDto {
    requireItemIdentity(authoritative);
    requireAdminMetadataForm(desired);
    requireAdminMetadataForm(confirmed);
    const result = cloneValue(authoritative);
    const changed = new Set(editableFields.filter(field =>
        JSON.stringify(materialForm(desired, [ field ])) !== JSON.stringify(materialForm(confirmed, [ field ]))));
    patchSimpleAdminMetadataFields(result, desired, changed);
    patchAdminMetadataDatesAndRuntime(result, desired, changed);
    patchAdminMetadataLists(result, authoritative, desired, changed);
    if (changed.has('tagline')) {
        const remaining = Array.isArray(authoritative.Taglines) ? authoritative.Taglines.slice(1) : [];
        result.Taglines = desired.tagline ? [ desired.tagline, ...remaining ] : remaining;
    }
    return result;
}

export function normalizeAdminMetadataArtwork(
    imageApi: ImageUrlsApi,
    itemId: string,
    images: readonly ImageInfo[]
): AdminMetadataArtwork[] {
    const id = identity(itemId);
    if (!id || !Array.isArray(images)) invalidResponse();
    return images.flatMap((image, position) => {
        if (!image.ImageType) return [];
        const index = integerOrNull(image.ImageIndex) ?? 0;
        const tag = textOrNull(image.ImageTag);
        return [{
            height: integerOrNull(image.Height),
            id: `${image.ImageType}:${index}:${tag || position}`,
            imageType: image.ImageType,
            index,
            itemId: id,
            previewUrl: imageApi.getItemImageUrlById(id, image.ImageType, {
                imageIndex: index,
                maxWidth: 400,
                tag: tag || undefined
            }),
            size: integerOrNull(image.Size),
            tag,
            width: integerOrNull(image.Width)
        }];
    });
}

export function normalizeAdminMetadataRemoteImageProviders(
    providers: readonly ImageProviderInfo[]
): AdminMetadataRemoteImageProvider[] {
    if (!Array.isArray(providers)) invalidResponse();
    const seen = new Set<string>();
    return providers.flatMap(provider => {
        const name = identity(provider.Name);
        if (!name || seen.has(name)) return [];
        seen.add(name);
        return [{ name, supportedImageTypes: Array.isArray(provider.SupportedImages) ? provider.SupportedImages : [] }];
    });
}

function normalizeRemoteImage(image: RemoteImageInfo, index: number): AdminMetadataRemoteImage | null {
    const url = identity(image.Url);
    if (!url) return null;
    const providerName = identity(image.ProviderName) || 'Unknown provider';
    return {
        height: integerOrNull(image.Height),
        id: `${index}:${providerName}`,
        imageType: image.Type || null,
        language: textOrNull(image.Language),
        providerName,
        rating: numberOrNull(image.CommunityRating),
        source: image,
        thumbnailUrl: textOrNull(image.ThumbnailUrl),
        url,
        width: integerOrNull(image.Width)
    };
}

export function normalizeAdminMetadataRemoteImagePage(
    value: RemoteImageResult,
    startIndex: number
): AdminMetadataRemoteImagePage {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalidResponse();
    const totalRecordCount = integerOrNull(value.TotalRecordCount);
    const sourceImages = arrayOrConfirmedEmpty(value.Images, totalRecordCount);
    const items = sourceImages.flatMap((image, index) => {
        const normalized = normalizeRemoteImage(image, startIndex + index);
        return normalized ? [ normalized ] : [];
    });
    return {
        hasNextPage: totalRecordCount === null ?
            items.length === ADMIN_METADATA_REMOTE_IMAGE_PAGE_SIZE :
            startIndex + sourceImages.length < totalRecordCount,
        items,
        limit: ADMIN_METADATA_REMOTE_IMAGE_PAGE_SIZE,
        startIndex,
        totalRecordCount
    };
}

export function normalizeAdminMetadataIdentifyResults(
    values: readonly RemoteSearchResult[]
): AdminMetadataIdentifyResult[] {
    if (!Array.isArray(values)) invalidResponse();
    return values.map((value, index) => {
        const providerName = identity(value.SearchProviderName) || 'Unknown provider';
        const providerIds = nullableStringRecord(value.ProviderIds);
        return {
            id: `${index}:${providerName}:${Object.values(providerIds).join(':')}`,
            imageUrl: normalizeAdminMetadataProviderImageUrl(value.ImageUrl),
            name: text(value.Name) || 'Unnamed result',
            overview: normalizeAdminMetadataProviderDescription(value.Overview),
            providerIds,
            providerName,
            source: value,
            year: integerOrNull(value.ProductionYear)
        };
    });
}

export function getAdminMetadataIdentifyType(value: unknown) {
    return typeof value === 'string' && IDENTIFY_TYPES.has(value) ?
        value as typeof ADMIN_METADATA_IDENTIFY_TYPES[number] : null;
}
