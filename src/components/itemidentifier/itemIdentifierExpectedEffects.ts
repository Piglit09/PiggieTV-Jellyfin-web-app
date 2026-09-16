export const GENERIC_IDENTIFY_READBACK_DELAYS_MS = [ 0, 300, 750, 1500, 3000, 5000 ] as const;
export const GENERIC_IDENTIFY_READBACK_TIMEOUT_MS = 20_000;

export type IdentifyAuthorityFailureReason =
    | 'authentication'
    | 'cancelled'
    | 'conflict'
    | 'forbidden'
    | 'http-client'
    | 'http-server'
    | 'network'
    | 'not-found'
    | 'rate-limited'
    | 'timeout'
    | 'unknown';

export function classifyIdentifyAuthorityFailure(error: unknown): IdentifyAuthorityFailureReason {
    if (!error || typeof error !== 'object') return 'unknown';

    const candidate = error as Record<string, unknown>;
    const name = String(candidate.name || '');
    const code = String(candidate.code || '').toLocaleUpperCase();
    const status = Number(candidate.status ?? candidate.StatusCode ?? candidate.statusCode);

    if (/timeout/i.test(name) || [ 'ETIMEDOUT', 'ESOCKETTIMEDOUT' ].includes(code)) return 'timeout';
    if (name === 'AbortError' || code === 'ABORT_ERR') return 'cancelled';
    if (status === 401) return 'authentication';
    if (status === 403) return 'forbidden';
    if (status === 404) return 'not-found';
    if (status === 409) return 'conflict';
    if (status === 429) return 'rate-limited';
    if (status >= 400 && status < 500) return 'http-client';
    if (status >= 500) return 'http-server';
    if (name === 'TypeError' || status === 0 || [ 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH' ].includes(code)) return 'network';

    return 'unknown';
}

export function isIdentifyOwnerCurrent<T extends object>(
    currentOwner: T | null | undefined,
    expectedOwner: T | null | undefined,
    ownerConnected = true
) {
    return Boolean(ownerConnected && expectedOwner && currentOwner === expectedOwner);
}

type IdentifyItem = Readonly<Record<string, unknown>>;

export type IdentifyMetadataField =
    | 'Genres'
    | 'IndexNumber'
    | 'Name'
    | 'OriginalTitle'
    | 'ParentIndexNumber'
    | 'People'
    | 'PremiereDate'
    | 'ProductionYear'
    | 'ProviderIds'
    | 'SeriesName'
    | 'Studios'
    | 'Tags'
    | 'Overview';

export type IdentifyRelationshipField = 'AlbumArtists' | 'ArtistItems';
export type IdentifyIntendedField = IdentifyMetadataField | IdentifyRelationshipField;

export type IdentifyImageType =
    | 'Art'
    | 'Backdrop'
    | 'Banner'
    | 'Disc'
    | 'Logo'
    | 'Primary'
    | 'Thumb';

type ScalarComparison = 'date' | 'number' | 'semantic-text' | 'text';

type IdentifyScalarExpectedEffect = Readonly<{
    category: string;
    comparison: ScalarComparison;
    field: IdentifyMetadataField;
    kind: 'scalar';
    transition: boolean;
    value: unknown;
}>;

type IdentifyProviderIdsExpectedEffect = Readonly<{
    category: 'provider-ids';
    kind: 'provider-ids';
    transition: boolean;
    values: Readonly<Record<string, string>>;
}>;

type IdentifyTextListExpectedEffect = Readonly<{
    category: string;
    field: 'Genres' | 'Studios' | 'Tags';
    kind: 'text-list';
    transition: boolean;
    values: readonly string[];
}>;

type IdentifyPeopleExpectedEffect = Readonly<{
    category: 'people';
    kind: 'people';
    mode: 'names' | 'roles';
    transition: boolean;
    values: readonly unknown[];
}>;

type IdentifyRelationshipIdentity = Readonly<{
    id: string;
    name: string;
    providerIds: Readonly<Record<string, string>>;
}>;

type IdentifyRelationshipExpectedEffect = Readonly<{
    category: 'album-artists' | 'artist-items';
    field: IdentifyRelationshipField;
    kind: 'relationship-set';
    providerBridge: 'musicbrainz-album-artist' | null;
    transition: boolean;
    values: readonly IdentifyRelationshipIdentity[];
}>;

type IdentifyImageExpectedEffect = Readonly<{
    beforeTags: readonly string[];
    category: string;
    imageType: IdentifyImageType;
    kind: 'image-transition';
    transition: true;
}>;

export type PtvIdentifyExpectedEffect =
    | IdentifyImageExpectedEffect
    | IdentifyPeopleExpectedEffect
    | IdentifyProviderIdsExpectedEffect
    | IdentifyRelationshipExpectedEffect
    | IdentifyScalarExpectedEffect
    | IdentifyTextListExpectedEffect;

export type PtvIdentifyExpectedEffectProjection = Readonly<{
    effects: readonly PtvIdentifyExpectedEffect[];
    expectedIdentity: Readonly<{
        itemId: string;
        itemType: string;
    }> | null;
    itemType: string;
    profile: string;
    reason: '' | 'MISSING_EXPECTED_IDENTITY' | 'NO_OBSERVABLE_EFFECT' | 'UNSUPPORTED_EXPECTED_EFFECT' | 'UNSUPPORTED_ITEM_TYPE';
    supported: boolean;
}>;

export type PtvIdentifyReadbackState = Readonly<{
    artworkSettled: boolean;
    metadataSettled: boolean;
    missingCategories: readonly string[];
    settled: boolean;
    supported: boolean;
}>;

type IdentifyProfile = Readonly<{
    fields: ReadonlySet<IdentifyMetadataField>;
    id: string;
}>;

const GENERIC_MUTATION_FIELDS: readonly IdentifyMetadataField[] = [
    'Name',
    'OriginalTitle',
    'SeriesName',
    'IndexNumber',
    'ParentIndexNumber',
    'Overview',
    'Genres',
    'People',
    'Studios',
    'Tags',
    'ProductionYear',
    'PremiereDate',
    'ProviderIds'
];

const COMMON_CONTENT_FIELDS: readonly IdentifyMetadataField[] = [
    'Name',
    'OriginalTitle',
    'Overview',
    'Genres',
    'People',
    'Studios',
    'Tags',
    'ProductionYear',
    'PremiereDate',
    'ProviderIds'
];

const PERSON_FIELDS: readonly IdentifyMetadataField[] = [
    'Name',
    'OriginalTitle',
    'Overview',
    'Genres',
    'Tags',
    'ProductionYear',
    'PremiereDate',
    'ProviderIds'
];

const BOOK_FIELDS: readonly IdentifyMetadataField[] = [
    ...COMMON_CONTENT_FIELDS,
    'SeriesName',
    'IndexNumber',
    'ParentIndexNumber'
];

const MUSIC_REMOTE_SEARCH_FIELDS: readonly IdentifyMetadataField[] = [
    'Name',
    'Overview',
    'ProductionYear',
    'PremiereDate',
    'ProviderIds'
];

function profile(id: string, fields: readonly IdentifyMetadataField[]): IdentifyProfile {
    return {
        fields: new Set(fields),
        id
    };
}

const GENERIC_IDENTIFY_PROFILES: Readonly<Record<string, IdentifyProfile>> = {
    BoxSet: profile('BOX_SET', COMMON_CONTENT_FIELDS),
    Movie: profile('MOVIE', COMMON_CONTENT_FIELDS),
    MusicAlbum: profile('MUSIC_ALBUM', MUSIC_REMOTE_SEARCH_FIELDS),
    MusicArtist: profile('MUSIC_ARTIST', MUSIC_REMOTE_SEARCH_FIELDS),
    Person: profile('PERSON', PERSON_FIELDS),
    Series: profile('SERIES', COMMON_CONTENT_FIELDS),
    Trailer: profile('TRAILER', COMMON_CONTENT_FIELDS)
};

const BOOK_IDENTIFY_PROFILE = profile('BOOK', BOOK_FIELDS);

function normalizeText(value: unknown) {
    return String(value ?? '')
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeSemanticText(value: unknown) {
    return normalizeText(value)
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeComparisonKey(value: unknown) {
    return normalizeText(value).toLocaleLowerCase();
}

function normalizeItemIdentity(value: unknown) {
    return normalizeText(value).toLocaleLowerCase();
}

function normalizeProviderKey(value: unknown) {
    return String(value ?? '').replace(/[^a-z0-9]/gi, '').toLocaleLowerCase();
}

function normalizeDate(value: unknown) {
    const text = normalizeText(value);
    const datePrefix = /^(\d{4}-\d{2}-\d{2})/.exec(text)?.[1];

    if (datePrefix) return datePrefix;

    const timestamp = Date.parse(text);

    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : '';
}

function normalizeNumber(value: unknown) {
    if (value === '' || value == null) return null;

    const number = Number(value);

    return Number.isFinite(number) ? number : null;
}

function getTextEntries(value: unknown): string[] {
    if (!Array.isArray(value)) return [];

    return value.map(entry => {
        if (typeof entry === 'string') return entry;
        if (!entry || typeof entry !== 'object') return '';

        const candidate = entry as Record<string, unknown>;

        return String(candidate.Name ?? candidate.name ?? '');
    }).map(normalizeText).filter(Boolean);
}

function normalizeTextList(value: unknown) {
    return Array.from(new Set(getTextEntries(value).map(normalizeComparisonKey)))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right));
}

function normalizeProviderIds(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

    return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>((result, [ key, id ]) => {
        const normalizedKey = normalizeProviderKey(key);
        const normalizedValue = normalizeText(id);

        if (normalizedKey && normalizedValue) result[normalizedKey] = normalizedValue;

        return result;
    }, {});
}

function getRelationshipProviderKey(providerIds: Readonly<Record<string, string>>) {
    return Object.entries(providerIds)
        .sort(([ left ], [ right ]) => left.localeCompare(right))
        .map(([ key, value ]) => `${key}=${normalizeComparisonKey(value)}`)
        .join('|');
}

function normalizeRelationshipEntry(value: unknown): IdentifyRelationshipIdentity | null {
    if (typeof value === 'string') {
        const name = normalizeComparisonKey(value);

        return name ? { id: '', name, providerIds: {} } : null;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const candidate = value as Record<string, unknown>;
    const id = normalizeItemIdentity(candidate.Id ?? candidate.id);
    const name = normalizeComparisonKey(candidate.Name ?? candidate.name);
    const providerIds = normalizeProviderIds(candidate.ProviderIds ?? candidate.providerIds);

    return id || name || Object.keys(providerIds).length ? { id, name, providerIds } : null;
}

function getRelationshipIdentityKey(entry: IdentifyRelationshipIdentity) {
    if (entry.id) return `id:${entry.id}`;

    const providerKey = getRelationshipProviderKey(entry.providerIds);

    return providerKey ? `provider:${providerKey}` : `name:${entry.name}`;
}

function getRelationshipSource(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (value == null) return [];

    return [ value ];
}

type NormalizedRelationshipSet = Readonly<{
    ambiguous: boolean;
    invalid: boolean;
    values: readonly IdentifyRelationshipIdentity[];
}>;

function normalizeRelationshipSet(value: unknown): NormalizedRelationshipSet {
    const source = getRelationshipSource(value);
    const normalizedEntries = source.map(normalizeRelationshipEntry);
    const entries = normalizedEntries
        .filter((entry): entry is IdentifyRelationshipIdentity => Boolean(entry));
    const deduped = new Map<string, IdentifyRelationshipIdentity>();

    entries.forEach(entry => {
        const identityKey = getRelationshipIdentityKey(entry);

        if (identityKey !== 'name:') deduped.set(identityKey, entry);
    });

    const values = Array.from(deduped.values());
    const nameIdentities = new Map<string, Set<string>>();

    values.forEach(entry => {
        if (!entry.name) return;

        const strongerIdentity = getRelationshipIdentityKey(entry);
        const identities = nameIdentities.get(entry.name) || new Set<string>();

        identities.add(strongerIdentity);
        nameIdentities.set(entry.name, identities);
    });

    return {
        ambiguous: Array.from(nameIdentities.entries()).some(([ name, identities ]) => {
            if (identities.size <= 1) return false;

            return values.some(entry => entry.name === name && !entry.id);
        }),
        invalid: normalizedEntries.some(entry => !entry),
        values
    };
}

function providerIdentityMatches(
    actual: Readonly<Record<string, string>>,
    expected: Readonly<Record<string, string>>
) {
    return Object.entries(expected).every(([ key, value ]) => actual[key] === value);
}

function relationshipEntryMatches(
    actual: IdentifyRelationshipIdentity,
    expected: IdentifyRelationshipIdentity,
    providerBridgeMatches: boolean
) {
    if (expected.id) return Boolean(actual.id) && actual.id === expected.id;

    if (Object.keys(expected.providerIds).length) {
        if (Object.keys(actual.providerIds).length) {
            return providerIdentityMatches(actual.providerIds, expected.providerIds);
        }

        return providerBridgeMatches && (!expected.name || actual.name === expected.name);
    }

    const actualHasStrongerIdentity = Boolean(actual.id) || Object.keys(actual.providerIds).length > 0;

    return !actualHasStrongerIdentity && Boolean(expected.name) && actual.name === expected.name;
}

function relationshipSetsMatch(
    actualValue: unknown,
    expectedValues: readonly IdentifyRelationshipIdentity[],
    providerBridgeMatches: (expected: IdentifyRelationshipIdentity) => boolean = () => false
) {
    const actual = normalizeRelationshipSet(actualValue);

    if (actual.ambiguous || actual.invalid || actual.values.length < expectedValues.length) return false;

    const unusedActual = new Set(actual.values.map((_, index) => index));

    return expectedValues.every(expected => {
        const comparableNameCount = expected.name ?
            Array.from(unusedActual).filter(index => actual.values[index].name === expected.name).length : 0;
        const requiresUniqueName = !expected.id
            && (!Object.keys(expected.providerIds).length || providerBridgeMatches(expected));

        if (requiresUniqueName && comparableNameCount !== 1) return false;

        const matchIndex = Array.from(unusedActual).find(index => relationshipEntryMatches(
            actual.values[index],
            expected,
            providerBridgeMatches(expected)
        ));

        if (matchIndex === undefined) return false;

        unusedActual.delete(matchIndex);
        return true;
    });
}

function musicBrainzAlbumArtistProviderBridgeMatches(item: IdentifyItem, expected: IdentifyRelationshipIdentity) {
    const expectedArtistId = expected.providerIds.musicbrainzartist;
    const actualProviderIds = normalizeProviderIds(item.ProviderIds);

    return Boolean(expectedArtistId)
        && actualProviderIds.musicbrainzalbumartist === expectedArtistId;
}

function getItemRelationshipValue(item: IdentifyItem, field: IdentifyRelationshipField) {
    if (field === 'AlbumArtists') {
        return Array.isArray(item.AlbumArtists) ? item.AlbumArtists : item.AlbumArtist;
    }

    return Array.isArray(item.ArtistItems) ? item.ArtistItems : item.Artists;
}

function normalizePeople(value: unknown, mode: 'names' | 'roles') {
    if (!Array.isArray(value)) return [];

    return Array.from(new Set(value.map(entry => {
        if (typeof entry === 'string') return normalizeComparisonKey(entry);
        if (!entry || typeof entry !== 'object') return '';

        const person = entry as Record<string, unknown>;
        const name = normalizeComparisonKey(person.Name ?? person.name);

        if (!name || mode === 'names') return name;

        const type = normalizeComparisonKey(person.Type ?? person.type);
        const role = normalizeComparisonKey(person.Role ?? person.role);

        return [ name, type, role ].join('|');
    }).filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

function normalizeImageTags(item: IdentifyItem | null | undefined, imageType: IdentifyImageType) {
    if (!item) return [];

    if (imageType === 'Backdrop') {
        return Array.from(new Set((Array.isArray(item.BackdropImageTags) ? item.BackdropImageTags : [])
            .map(normalizeText)
            .filter(Boolean)))
            .sort((left, right) => left.localeCompare(right));
    }

    const imageTags = item.ImageTags && typeof item.ImageTags === 'object' && !Array.isArray(item.ImageTags) ?
        item.ImageTags as Record<string, unknown> : {};
    const tag = normalizeText(imageTags[imageType]
        ?? (imageType === 'Primary' ? item.PrimaryImageTag : ''));

    return tag ? [ tag ] : [];
}

function arraysEqual(left: readonly string[], right: readonly string[]) {
    return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function scalarMatches(comparison: ScalarComparison, actual: unknown, expected: unknown) {
    if (comparison === 'date') return Boolean(normalizeDate(expected)) && normalizeDate(actual) === normalizeDate(expected);
    if (comparison === 'number') return normalizeNumber(expected) !== null && normalizeNumber(actual) === normalizeNumber(expected);
    if (comparison === 'semantic-text') {
        return Boolean(normalizeSemanticText(expected))
            && normalizeSemanticText(actual) === normalizeSemanticText(expected);
    }

    return Boolean(normalizeText(expected)) && normalizeText(actual) === normalizeText(expected);
}

function effectMatches(effect: PtvIdentifyExpectedEffect, item: IdentifyItem | null | undefined) {
    if (!item) return false;

    if (effect.kind === 'scalar') {
        return scalarMatches(effect.comparison, item[effect.field], effect.value);
    }

    if (effect.kind === 'provider-ids') {
        const actual = normalizeProviderIds(item.ProviderIds);

        return Object.entries(effect.values).every(([ key, value ]) => actual[key] === value);
    }

    if (effect.kind === 'text-list') {
        return arraysEqual(normalizeTextList(item[effect.field]), effect.values);
    }

    if (effect.kind === 'people') {
        return arraysEqual(normalizePeople(item.People, effect.mode), normalizePeople(effect.values, effect.mode));
    }

    if (effect.kind === 'relationship-set') {
        const providerBridgeMatches = effect.providerBridge === 'musicbrainz-album-artist' ?
            (expected: IdentifyRelationshipIdentity) => musicBrainzAlbumArtistProviderBridgeMatches(item, expected) :
            undefined;

        return relationshipSetsMatch(getItemRelationshipValue(item, effect.field), effect.values, providerBridgeMatches);
    }

    const currentTags = normalizeImageTags(item, effect.imageType);

    return currentTags.length > 0 && !arraysEqual(currentTags, effect.beforeTags);
}

type CreateRelationshipEffectResult = Readonly<{
    effect: IdentifyRelationshipExpectedEffect | null;
    supported: boolean;
}>;

function createRelationshipEffect(
    beforeItem: IdentifyItem,
    field: IdentifyRelationshipField,
    value: unknown
): CreateRelationshipEffectResult {
    const expected = normalizeRelationshipSet(value);

    if (expected.ambiguous || expected.invalid || !expected.values.length) return { effect: null, supported: false };

    const category = field === 'AlbumArtists' ? 'album-artists' : 'artist-items';
    const values = expected.values;
    const unresolvedProviderIdentities = values.filter(entry => !entry.id && Object.keys(entry.providerIds).length);
    const providerBridge = field === 'AlbumArtists'
        && values.length === 1
        && unresolvedProviderIdentities.length === 1
        && Boolean(unresolvedProviderIdentities[0].providerIds.musicbrainzartist) ?
        'musicbrainz-album-artist' as const : null;

    if (unresolvedProviderIdentities.length && !providerBridge) return { effect: null, supported: false };

    return {
        effect: {
            category,
            field,
            kind: 'relationship-set',
            providerBridge,
            transition: !relationshipSetsMatch(
                getItemRelationshipValue(beforeItem, field),
                values,
                providerBridge ? expectedValue => musicBrainzAlbumArtistProviderBridgeMatches(beforeItem, expectedValue) : undefined
            ),
            values
        },
        supported: true
    };
}

function scalarComparisonForField(field: IdentifyMetadataField, semanticText: boolean): ScalarComparison {
    if (field === 'ProductionYear' || field === 'IndexNumber' || field === 'ParentIndexNumber') return 'number';
    if (field === 'PremiereDate') return 'date';
    if (semanticText) return 'semantic-text';

    return 'text';
}

function getEffectCategory(field: IdentifyMetadataField) {
    return field.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLocaleLowerCase();
}

type CreateFieldEffectOptions = Readonly<{
    beforeItem: IdentifyItem;
    expectedProviderIds?: Readonly<Record<string, unknown>>;
    field: IdentifyMetadataField;
    outboundItem: IdentifyItem;
    peopleMode: 'names' | 'roles';
    semanticText: boolean;
}>;

function createProviderIdsEffect({ beforeItem, expectedProviderIds, outboundItem }: CreateFieldEffectOptions) {
    const outboundProviderIds = normalizeProviderIds(outboundItem.ProviderIds);
    const proposedProviderIds = normalizeProviderIds(expectedProviderIds);
    const beforeProviderIds = normalizeProviderIds(beforeItem.ProviderIds);
    const changedProviderIds = Object.fromEntries(
        Object.entries(outboundProviderIds).filter(([ key, value ]) => beforeProviderIds[key] !== value)
    );
    const values = Object.keys(proposedProviderIds).length ? proposedProviderIds : changedProviderIds;

    if (!Object.keys(values).length) return null;

    return {
        category: 'provider-ids' as const,
        kind: 'provider-ids' as const,
        transition: Object.entries(values).some(([ key, value ]) => beforeProviderIds[key] !== value),
        values
    };
}

function createPeopleEffect({ beforeItem, outboundItem, peopleMode }: CreateFieldEffectOptions) {
    const values = Array.isArray(outboundItem.People) ? outboundItem.People : [];

    if (!values.length) return null;

    return {
        category: 'people' as const,
        kind: 'people' as const,
        mode: peopleMode,
        transition: !arraysEqual(normalizePeople(beforeItem.People, peopleMode), normalizePeople(values, peopleMode)),
        values
    };
}

function createTextListEffect({ beforeItem, field, outboundItem }: CreateFieldEffectOptions) {
    if (field !== 'Genres' && field !== 'Studios' && field !== 'Tags') return null;

    const values = normalizeTextList(outboundItem[field]);

    if (!values.length) return null;

    return {
        category: getEffectCategory(field),
        field,
        kind: 'text-list' as const,
        transition: !arraysEqual(normalizeTextList(beforeItem[field]), values),
        values
    };
}

function createScalarEffect({ beforeItem, field, outboundItem, semanticText }: CreateFieldEffectOptions) {
    const comparison = scalarComparisonForField(field, semanticText);
    const value = outboundItem[field];

    if (comparison === 'number' && normalizeNumber(value) === null) return null;
    if (comparison === 'date' && !normalizeDate(value)) return null;
    if ((comparison === 'text' || comparison === 'semantic-text') && !normalizeText(value)) return null;

    return {
        category: getEffectCategory(field),
        comparison,
        field,
        kind: 'scalar' as const,
        transition: !scalarMatches(comparison, beforeItem[field], value),
        value
    };
}

function createFieldEffect(options: CreateFieldEffectOptions): PtvIdentifyExpectedEffect | null {
    if (options.field === 'ProviderIds') return createProviderIdsEffect(options);
    if (options.field === 'People') return createPeopleEffect(options);
    if (options.field === 'Genres' || options.field === 'Studios' || options.field === 'Tags') {
        return createTextListEffect(options);
    }

    return createScalarEffect(options);
}

function unsupportedProjection(
    itemType: string,
    profileId: string,
    reason: PtvIdentifyExpectedEffectProjection['reason'],
    expectedIdentity: PtvIdentifyExpectedEffectProjection['expectedIdentity'] = null
): PtvIdentifyExpectedEffectProjection {
    return {
        effects: [],
        expectedIdentity,
        itemType,
        profile: profileId,
        reason,
        supported: false
    };
}

function buildProjection({
    beforeItem,
    expectedImageChanges = [],
    expectedProviderIds,
    intendedFields,
    itemType,
    outboundItem,
    peopleMode = 'roles',
    profile: expectedProfile,
    requireObservableTransition = true,
    semanticText = false
}: Readonly<{
    beforeItem: IdentifyItem;
    expectedImageChanges?: readonly IdentifyImageType[];
    expectedProviderIds?: Readonly<Record<string, unknown>>;
    intendedFields?: readonly IdentifyMetadataField[];
    itemType: string;
    outboundItem: IdentifyItem;
    peopleMode?: 'names' | 'roles';
    profile: IdentifyProfile;
    requireObservableTransition?: boolean;
    semanticText?: boolean;
}>): PtvIdentifyExpectedEffectProjection {
    const inferredFields = GENERIC_MUTATION_FIELDS.filter(field => {
        const effect = createFieldEffect({
            beforeItem,
            expectedProviderIds,
            field,
            outboundItem,
            peopleMode,
            semanticText
        });

        return Boolean(effect?.transition);
    });
    const requestedFields = Array.from(new Set(intendedFields === undefined ? inferredFields : intendedFields));

    if (requestedFields.some(field => !expectedProfile.fields.has(field))) {
        return unsupportedProjection(itemType, expectedProfile.id, 'UNSUPPORTED_EXPECTED_EFFECT');
    }

    const effects = requestedFields.map(field => createFieldEffect({
        beforeItem,
        expectedProviderIds,
        field,
        outboundItem,
        peopleMode,
        semanticText
    })).filter((effect): effect is PtvIdentifyExpectedEffect => Boolean(effect));

    expectedImageChanges.forEach(imageType => {
        effects.push({
            beforeTags: normalizeImageTags(beforeItem, imageType),
            category: `image-${imageType.toLocaleLowerCase()}`,
            imageType,
            kind: 'image-transition',
            transition: true
        });
    });

    if (!effects.length || requireObservableTransition && !effects.some(effect => effect.transition)) {
        return unsupportedProjection(itemType, expectedProfile.id, 'NO_OBSERVABLE_EFFECT');
    }

    return {
        effects,
        expectedIdentity: null,
        itemType,
        profile: expectedProfile.id,
        reason: '',
        supported: true
    };
}

export function createIdentifyExpectedEffectProjection({
    beforeItem,
    expectedImageChanges,
    expectedProviderIds,
    intendedFields,
    itemType = 'Book',
    outboundItem,
    peopleMode = 'names',
    requireObservableTransition = false,
    semanticText = true
}: Readonly<{
    beforeItem: IdentifyItem;
    expectedImageChanges?: readonly IdentifyImageType[];
    expectedProviderIds?: Readonly<Record<string, unknown>>;
    intendedFields?: readonly IdentifyMetadataField[];
    itemType?: string;
    outboundItem: IdentifyItem;
    peopleMode?: 'names' | 'roles';
    requireObservableTransition?: boolean;
    semanticText?: boolean;
}>) {
    return buildProjection({
        beforeItem,
        expectedImageChanges,
        expectedProviderIds,
        intendedFields,
        itemType,
        outboundItem,
        peopleMode,
        profile: BOOK_IDENTIFY_PROFILE,
        requireObservableTransition,
        semanticText
    });
}

type GenericMusicRelationshipState = Readonly<{
    albumArtist: unknown;
    hasAlbumArtist: boolean;
    hasArtists: boolean;
    supportsRelationships: boolean;
    unsupported: boolean;
}>;

function hasRelationshipValue(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return Boolean(normalizeText(value));

    return Object.keys(value as Record<string, unknown>).length > 0;
}

function isRemoteRelationshipObject(value: unknown) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) && normalizeRelationshipEntry(value));
}

function getGenericMusicRelationshipState(
    itemType: string,
    mutationResult: IdentifyItem | undefined
): GenericMusicRelationshipState {
    const albumArtist = mutationResult?.AlbumArtist;
    const hasAlbumArtist = hasRelationshipValue(albumArtist);
    const artists = mutationResult?.Artists;
    const hasArtists = Array.isArray(artists) && artists.length > 0;
    const supportsRelationships = itemType === 'MusicAlbum';
    const hasDirectPluralMutation = Array.isArray(mutationResult?.AlbumArtists)
        && mutationResult.AlbumArtists.length > 0
        || Array.isArray(mutationResult?.ArtistItems) && mutationResult.ArtistItems.length > 0;
    const hasMalformedRelationship = supportsRelationships && (
        hasAlbumArtist && !isRemoteRelationshipObject(albumArtist)
        || hasArtists && !(artists as unknown[]).every(isRemoteRelationshipObject)
    );

    return {
        albumArtist,
        hasAlbumArtist,
        hasArtists,
        supportsRelationships,
        unsupported: hasDirectPluralMutation
            || hasMalformedRelationship
            || !supportsRelationships && (hasAlbumArtist || hasArtists)
    };
}

function createMusicRelationshipEffects(
    beforeItem: IdentifyItem,
    mutationResult: IdentifyItem | undefined,
    state: GenericMusicRelationshipState
) {
    const requests = [
        { field: 'AlbumArtists' as const, included: state.hasAlbumArtist, value: state.albumArtist },
        { field: 'ArtistItems' as const, included: state.hasArtists, value: mutationResult?.Artists }
    ];
    const effects: IdentifyRelationshipExpectedEffect[] = [];

    for (const request of requests) {
        if (!request.included) continue;

        const result = createRelationshipEffect(beforeItem, request.field, request.value);

        if (!result.supported || !result.effect) return { effects: [], supported: false };

        effects.push(result.effect);
    }

    return { effects, supported: true };
}

export function createGenericIdentifyExpectedEffectProjection({
    beforeItem,
    expectedProviderIds,
    intendedFields,
    itemType,
    mutationResult,
    outboundItem,
    replaceAllImages = false,
    replaceBackdrop = false,
    replacePrimary = false
}: Readonly<{
    beforeItem: IdentifyItem;
    expectedProviderIds?: Readonly<Record<string, unknown>>;
    intendedFields?: readonly IdentifyIntendedField[];
    itemType: string;
    mutationResult?: IdentifyItem;
    outboundItem: IdentifyItem;
    replaceAllImages?: boolean;
    replaceBackdrop?: boolean;
    replacePrimary?: boolean;
}>): PtvIdentifyExpectedEffectProjection {
    const expectedProfile = GENERIC_IDENTIFY_PROFILES[itemType];
    const expectedIdentity = {
        itemId: normalizeItemIdentity(beforeItem.Id),
        itemType: normalizeItemIdentity(itemType)
    };

    if (!expectedProfile) {
        return unsupportedProjection(itemType, 'UNSUPPORTED', 'UNSUPPORTED_ITEM_TYPE', expectedIdentity);
    }

    if (!expectedIdentity.itemId || !expectedIdentity.itemType) {
        return unsupportedProjection(itemType, expectedProfile.id, 'MISSING_EXPECTED_IDENTITY', expectedIdentity);
    }

    const relationshipState = getGenericMusicRelationshipState(itemType, mutationResult);
    const hasUnmodeledMutation = mutationResult?.IndexNumberEnd != null || relationshipState.unsupported;

    if (replaceAllImages || hasUnmodeledMutation) {
        return unsupportedProjection(itemType, expectedProfile.id, 'UNSUPPORTED_EXPECTED_EFFECT', expectedIdentity);
    }

    const metadataIntendedFields = intendedFields?.filter(
        (field): field is IdentifyMetadataField => field !== 'AlbumArtists' && field !== 'ArtistItems'
    );
    const projection = buildProjection({
        beforeItem,
        expectedImageChanges: [
            ...(replacePrimary ? [ 'Primary' as const ] : []),
            ...(replaceBackdrop ? [ 'Backdrop' as const ] : [])
        ],
        expectedProviderIds,
        intendedFields: metadataIntendedFields,
        itemType,
        outboundItem,
        profile: expectedProfile,
        requireObservableTransition: !relationshipState.supportsRelationships
    });

    if (!projection.supported || !relationshipState.supportsRelationships) {
        return {
            ...projection,
            expectedIdentity
        };
    }

    const relationshipResult = createMusicRelationshipEffects(beforeItem, mutationResult, relationshipState);

    if (!relationshipResult.supported) {
        return unsupportedProjection(itemType, expectedProfile.id, 'UNSUPPORTED_EXPECTED_EFFECT', expectedIdentity);
    }

    const effects = [ ...projection.effects, ...relationshipResult.effects ];

    if (!effects.length || !effects.some(effect => effect.transition)) {
        return unsupportedProjection(itemType, expectedProfile.id, 'NO_OBSERVABLE_EFFECT', expectedIdentity);
    }

    return {
        ...projection,
        effects,
        expectedIdentity
    };
}

export const createGenericIdentifyExpectedEffect = createGenericIdentifyExpectedEffectProjection;

export function evaluateIdentifyExpectedEffects(
    projection: PtvIdentifyExpectedEffectProjection,
    item: IdentifyItem | null | undefined
): PtvIdentifyReadbackState {
    if (!projection.supported || !item) {
        return {
            artworkSettled: false,
            metadataSettled: false,
            missingCategories: projection.effects.map(effect => effect.category),
            settled: false,
            supported: projection.supported
        };
    }

    const identityMatches = !projection.expectedIdentity
        || normalizeItemIdentity(item.Id) === projection.expectedIdentity.itemId
            && normalizeItemIdentity(item.Type) === projection.expectedIdentity.itemType;
    const missingCategories = [
        ...(!identityMatches ? [ 'item-identity' ] : []),
        ...projection.effects
            .filter(effect => !effectMatches(effect, item))
            .map(effect => effect.category)
    ];
    const metadataSettled = identityMatches && projection.effects
        .filter(effect => effect.kind !== 'image-transition')
        .every(effect => !missingCategories.includes(effect.category));
    const artworkSettled = identityMatches && projection.effects
        .filter(effect => effect.kind === 'image-transition')
        .every(effect => !missingCategories.includes(effect.category));

    return {
        artworkSettled,
        metadataSettled,
        missingCategories,
        settled: metadataSettled && artworkSettled,
        supported: true
    };
}

export const getGenericIdentifyReadbackState = evaluateIdentifyExpectedEffects;

function createDefaultTimeoutError(timeoutMs: number) {
    const error = new Error(`Identify readback timed out after ${timeoutMs}ms`);

    error.name = 'PtvIdentifyReadbackTimeoutError';

    return error;
}

export function withIdentifyReadbackDeadline<T>(
    promise: PromiseLike<T> | T,
    timeoutMs: number,
    createTimeoutError: (timeoutMs: number) => Error = createDefaultTimeoutError
) {
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const timer = globalThis.setTimeout(() => {
            if (settled) return;

            settled = true;
            reject(createTimeoutError(timeoutMs));
        }, Math.max(0, timeoutMs));

        Promise.resolve(promise).then(value => {
            if (settled) return;

            settled = true;
            globalThis.clearTimeout(timer);
            resolve(value);
        }, error => {
            if (settled) return;

            settled = true;
            globalThis.clearTimeout(timer);
            reject(error);
        });
    });
}

export type PtvIdentifyPollResult<T> = Readonly<{
    attempts: number;
    error: unknown;
    item: T | null;
    status: 'confirmed' | 'retired' | 'unconfirmed';
}>;

type IdentifyPollOptions<T> = Readonly<{
    createTimeoutError?: (timeoutMs: number) => Error;
    delays?: readonly number[];
    isCurrent?: () => boolean;
    isSettled: (item: T) => boolean;
    loadItem: () => Promise<T>;
    now?: () => number;
    onAttempt?: (detail: Readonly<{ ordinal: number; result: 'confirmed' | 'failed' | 'unconfirmed' }>) => void;
    onUnconfirmedItem?: (detail: Readonly<{ item: T; ordinal: number }>) => Promise<'continue' | 'retired' | 'stop' | void>;
    retainLastUnconfirmedItem?: boolean;
    timeoutMs?: number;
    waitFor?: (delayMs: number) => Promise<unknown>;
}>;

type IdentifyPollState<T> = {
    attempts: number;
    lastError: unknown;
    lastItem: T | null;
};

type IdentifyPollLoadOutcome<T> =
    | Readonly<{ error: unknown; kind: 'failed' }>
    | Readonly<{ item: T; kind: 'item' }>
    | Readonly<{ kind: 'exhausted' }>
    | Readonly<{ kind: 'retired' }>;

type IdentifyPollStepOutcome<T> =
    | Readonly<{ kind: 'continue' | 'exhausted' | 'retired' }>
    | Readonly<{ kind: 'confirmed'; result: PtvIdentifyPollResult<T> }>;

function getRemainingTime(timeoutMs: number, startedAt: number, now: () => number) {
    return timeoutMs - (now() - startedAt);
}

async function loadIdentifyPollItem<T>({
    createTimeoutError,
    delayMs,
    isCurrent,
    loadItem,
    now,
    startedAt,
    state,
    timeoutMs,
    waitFor
}: Readonly<{
    createTimeoutError?: (timeoutMs: number) => Error;
    delayMs: number;
    isCurrent: () => boolean;
    loadItem: () => Promise<T>;
    now: () => number;
    startedAt: number;
    state: IdentifyPollState<T>;
    timeoutMs: number;
    waitFor: (delayMs: number) => Promise<unknown>;
}>): Promise<IdentifyPollLoadOutcome<T>> {
    if (!isCurrent()) return { kind: 'retired' };

    const remainingBeforeDelay = getRemainingTime(timeoutMs, startedAt, now);

    if (remainingBeforeDelay <= 0) return { kind: 'exhausted' };

    try {
        if (delayMs > 0) {
            await withIdentifyReadbackDeadline(waitFor(delayMs), remainingBeforeDelay, createTimeoutError);
        }

        if (!isCurrent()) return { kind: 'retired' };

        const remainingBeforeRead = getRemainingTime(timeoutMs, startedAt, now);

        if (remainingBeforeRead <= 0) return { kind: 'exhausted' };

        state.attempts += 1;
        const item = await withIdentifyReadbackDeadline(loadItem(), remainingBeforeRead, createTimeoutError);

        return isCurrent() ? { item, kind: 'item' } : { kind: 'retired' };
    } catch (error) {
        return { error, kind: 'failed' };
    }
}

async function handleIdentifyPollItem<T>({
    createTimeoutError,
    isSettled,
    item,
    now,
    onAttempt,
    onUnconfirmedItem,
    startedAt,
    state,
    timeoutMs
}: Readonly<{
    createTimeoutError?: (timeoutMs: number) => Error;
    isSettled: (item: T) => boolean;
    item: T;
    now: () => number;
    onAttempt?: IdentifyPollOptions<T>['onAttempt'];
    onUnconfirmedItem?: IdentifyPollOptions<T>['onUnconfirmedItem'];
    startedAt: number;
    state: IdentifyPollState<T>;
    timeoutMs: number;
}>): Promise<IdentifyPollStepOutcome<T>> {
    state.lastItem = item;
    if (isSettled(item)) {
        onAttempt?.({ ordinal: state.attempts, result: 'confirmed' });
        return {
            kind: 'confirmed',
            result: { attempts: state.attempts, error: null, item, status: 'confirmed' }
        };
    }

    onAttempt?.({ ordinal: state.attempts, result: 'unconfirmed' });
    if (!onUnconfirmedItem) return { kind: 'continue' };

    const remainingBeforeCallback = getRemainingTime(timeoutMs, startedAt, now);

    if (remainingBeforeCallback <= 0) return { kind: 'exhausted' };

    const callbackResult = await withIdentifyReadbackDeadline(
        onUnconfirmedItem({ item, ordinal: state.attempts }),
        remainingBeforeCallback,
        createTimeoutError
    );

    if (callbackResult === 'retired') return { kind: 'retired' };

    return { kind: callbackResult === 'stop' ? 'exhausted' : 'continue' };
}

export async function pollIdentifyExpectedEffectReadback<T>({
    createTimeoutError,
    delays = GENERIC_IDENTIFY_READBACK_DELAYS_MS,
    isCurrent = () => true,
    isSettled,
    loadItem,
    now = () => Date.now(),
    onAttempt,
    onUnconfirmedItem,
    retainLastUnconfirmedItem = false,
    timeoutMs = GENERIC_IDENTIFY_READBACK_TIMEOUT_MS,
    waitFor = delayMs => new Promise<void>(resolve => globalThis.setTimeout(resolve, delayMs))
}: IdentifyPollOptions<T>): Promise<PtvIdentifyPollResult<T>> {
    const startedAt = now();
    const state: IdentifyPollState<T> = {
        attempts: 0,
        lastError: null,
        lastItem: null
    };

    for (const delayMs of delays) {
        const loadOutcome = await loadIdentifyPollItem({
            createTimeoutError,
            delayMs,
            isCurrent,
            loadItem,
            now,
            startedAt,
            state,
            timeoutMs,
            waitFor
        });

        if (loadOutcome.kind === 'retired') {
            return { attempts: state.attempts, error: state.lastError, item: null, status: 'retired' };
        }
        if (loadOutcome.kind === 'exhausted') break;
        if (loadOutcome.kind === 'failed') {
            state.lastError = loadOutcome.error;
            onAttempt?.({ ordinal: state.attempts, result: 'failed' });
            continue;
        }

        const stepOutcome = await handleIdentifyPollItem({
            createTimeoutError,
            isSettled,
            item: loadOutcome.item,
            now,
            onAttempt,
            onUnconfirmedItem,
            startedAt,
            state,
            timeoutMs
        });

        if (stepOutcome.kind === 'confirmed') return stepOutcome.result;
        if (stepOutcome.kind === 'retired') {
            return { attempts: state.attempts, error: state.lastError, item: null, status: 'retired' };
        }
        if (stepOutcome.kind === 'exhausted') break;
    }

    return {
        attempts: state.attempts,
        error: state.lastError,
        item: retainLastUnconfirmedItem ? state.lastItem : null,
        status: 'unconfirmed'
    };
}

export async function pollGenericIdentifyReadback<T extends IdentifyItem>({
    expectedEffect,
    isCurrent,
    loadItem,
    waitFor
}: Readonly<{
    expectedEffect: PtvIdentifyExpectedEffectProjection;
    isCurrent?: () => boolean;
    loadItem: () => Promise<T>;
    waitFor?: (delayMs: number) => Promise<unknown>;
}>) {
    if (!expectedEffect.supported) {
        return {
            attempts: 0,
            error: null,
            item: null,
            status: 'unsupported' as const
        };
    }

    return pollIdentifyExpectedEffectReadback({
        isCurrent,
        isSettled: item => evaluateIdentifyExpectedEffects(expectedEffect, item).settled,
        loadItem,
        onUnconfirmedItem: async ({ item }) => evaluateIdentifyExpectedEffects(expectedEffect, item)
            .missingCategories.includes('item-identity') ? 'stop' : 'continue',
        waitFor
    });
}

export type GenericIdentifyConfirmationResult<T> = Readonly<{
    attempts: number;
    error: unknown;
    expectedEffect: PtvIdentifyExpectedEffectProjection;
    fallbackWrites: number;
    item: T | null;
    status: 'confirmed' | 'retired' | 'unconfirmed' | 'unsupported';
}>;

export async function confirmGenericIdentifyMutation<T extends IdentifyItem>({
    buildFallbackProjection,
    delays = GENERIC_IDENTIFY_READBACK_DELAYS_MS,
    expectedEffect,
    isCurrent = () => true,
    loadItem,
    now,
    onAttempt,
    timeoutMs = GENERIC_IDENTIFY_READBACK_TIMEOUT_MS,
    waitFor,
    writeFallback
}: Readonly<{
    buildFallbackProjection?: (item: T) => PtvIdentifyExpectedEffectProjection;
    delays?: readonly number[];
    expectedEffect: PtvIdentifyExpectedEffectProjection;
    isCurrent?: () => boolean;
    loadItem: () => Promise<T>;
    now?: () => number;
    onAttempt?: IdentifyPollOptions<T>['onAttempt'];
    timeoutMs?: number;
    waitFor?: (delayMs: number) => Promise<unknown>;
    writeFallback?: (item: T, projection: PtvIdentifyExpectedEffectProjection) => Promise<unknown>;
}>): Promise<GenericIdentifyConfirmationResult<T>> {
    if (!expectedEffect.supported) {
        return {
            attempts: 0,
            error: null,
            expectedEffect,
            fallbackWrites: 0,
            item: null,
            status: 'unsupported'
        };
    }

    let activeExpectedEffect = expectedEffect;
    let fallbackAttempted = false;
    let fallbackWrites = 0;
    const result = await pollIdentifyExpectedEffectReadback({
        delays,
        isCurrent,
        isSettled: item => evaluateIdentifyExpectedEffects(activeExpectedEffect, item).settled,
        loadItem,
        now,
        onAttempt,
        onUnconfirmedItem: async ({ item, ordinal }) => {
            if (evaluateIdentifyExpectedEffects(activeExpectedEffect, item).missingCategories.includes('item-identity')) return 'stop';
            if (ordinal !== 1 || fallbackAttempted || !buildFallbackProjection || !writeFallback) return 'continue';
            if (!isCurrent()) return 'retired';

            const fallbackProjection = buildFallbackProjection(item);

            if (!isCurrent()) return 'retired';
            if (!fallbackProjection.supported) return 'stop';

            fallbackAttempted = true;
            fallbackWrites += 1;

            try {
                await writeFallback(item, fallbackProjection);
            } catch {
                return isCurrent() ? 'continue' : 'retired';
            }

            if (!isCurrent()) return 'retired';

            activeExpectedEffect = fallbackProjection;

            return 'continue';
        },
        timeoutMs,
        waitFor
    });

    return {
        ...result,
        expectedEffect: activeExpectedEffect,
        fallbackWrites
    };
}
