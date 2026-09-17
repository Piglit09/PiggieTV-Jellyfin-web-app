import { MetadataField } from '@jellyfin/sdk/lib/generated-client/models/metadata-field';
import {
    normalizeAdminMetadataProviderDescription,
    normalizeAdminMetadataProviderImageUrl,
    normalizeAdminMetadataProviderSourceUrl
} from './adminMetadataProviderPresentation';
import type {
    AdminMetadataEditableField,
    AdminMetadataForm,
    AdminMetadataIdentifyResult,
    AdminMetadataPerson,
    AdminMetadataStudio
} from './adminMetadataManagerModel';
import type {
    AdminReadingMediaClass,
    AdminReadingLocalInspectionState,
    AdminReadingMetadataCandidate,
    AdminReadingMetadataProvidersResponse,
    AdminReadingMetadataSearchResponse,
    AdminReadingPersonCredit,
    AdminReadingProviderFailureKind,
    AdminReadingProviderSearchResult,
    AdminReadingProviderState,
    AdminReadingProviderStatus,
    AdminReadingScoreReason,
    AdminReadingStructuredQuery
} from './adminReadingMetadataModel';

const MEDIA_CLASSES = new Set<AdminReadingMediaClass>([
    'book', 'comic', 'graphic-novel', 'manga', 'manhua', 'manhwa', 'unknown'
]);
const PROVIDER_STATES = new Set<AdminReadingProviderState>([
    'available', 'disabled', 'misconfigured', 'rate-limited', 'unreachable', 'unknown'
]);
const PROVIDER_FAILURE_KINDS = new Set<AdminReadingProviderFailureKind>([
    'authentication', 'bad-request', 'cancelled', 'network', 'parse', 'rate-limit',
    'timeout', 'unavailable', 'unknown'
]);
const LOCAL_INSPECTION_STATES = new Set<AdminReadingLocalInspectionState>([
    'inspected', 'not-found', 'rejected', 'unavailable', 'unknown', 'unsupported'
]);
const STORED_READING_PROVIDERS = [
    { displayName: 'Comic Vine', provider: 'comic-vine' },
    { displayName: 'Grand Comics Database (GCD)', provider: 'gcd' },
    { displayName: 'AniList', provider: 'anilist' },
    { displayName: 'MangaDex', provider: 'mangadex' },
    { displayName: 'Google Books', provider: 'google-books' }
] as const;

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * Jellyfin serializes plugin DTO properties with their declared PascalCase names,
 * while focused frontend fixtures and older PTV transports use camelCase. Keep
 * the normalization boundary tolerant of both without changing map-like payloads
 * such as provider IDs or localized titles.
 */
function transportRecord(value: unknown): Record<string, unknown> {
    const source = record(value);
    const aliases = Object.entries(source).flatMap(([ key, item ]) => {
        const normalizedKey = key ? `${key[0].toLocaleLowerCase()}${key.slice(1)}` : key;
        return normalizedKey === key || Object.prototype.hasOwnProperty.call(source, normalizedKey) ?
            [] : [[ normalizedKey, item ]];
    });
    return { ...Object.fromEntries(aliases), ...source };
}

function text(value: unknown, maximumLength = 512) {
    if (typeof value !== 'string') return '';
    const normalized = value.trim();
    return normalized.length <= maximumLength ? normalized : normalized.slice(0, maximumLength);
}

function nullableText(value: unknown, maximumLength = 512) {
    return text(value, maximumLength) || null;
}

function integer(value: unknown) {
    return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function finiteNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown, maximumItems = 64, maximumLength = 512) {
    return Array.isArray(value) ? Array.from(new Set(value
        .map(entry => text(entry, maximumLength))
        .filter(Boolean))).slice(0, maximumItems) : [];
}

function stringMap(value: unknown, maximumItems = 64, maximumLength = 512) {
    return Object.fromEntries(Object.entries(record(value))
        .map(([ key, item ]) => [ text(key, 64), text(item, maximumLength) ] as const)
        .filter(([ key, item ]) => Boolean(key && item))
        .slice(0, maximumItems));
}

function mediaClass(value: unknown): AdminReadingMediaClass {
    return typeof value === 'string' && MEDIA_CLASSES.has(value as AdminReadingMediaClass) ?
        value as AdminReadingMediaClass : 'unknown';
}

function state(value: unknown): AdminReadingProviderState {
    return typeof value === 'string' && PROVIDER_STATES.has(value as AdminReadingProviderState) ?
        value as AdminReadingProviderState : 'unknown';
}

function failureKind(value: unknown): AdminReadingProviderFailureKind {
    return typeof value === 'string' && PROVIDER_FAILURE_KINDS.has(value as AdminReadingProviderFailureKind) ?
        value as AdminReadingProviderFailureKind : 'unknown';
}

function localInspectionState(value: unknown): AdminReadingLocalInspectionState {
    return typeof value === 'string' && LOCAL_INSPECTION_STATES.has(value as AdminReadingLocalInspectionState) ?
        value as AdminReadingLocalInspectionState : 'unknown';
}

function normalizedProviderKey(value: string) {
    return value.replace(/[^a-z0-9]/gi, '').toLocaleLowerCase();
}

/** Presents stable provider IDs without changing the identity used by requests and saves. */
export function adminReadingProviderDisplayName(value: string) {
    const normalized = normalizedProviderKey(value);
    return STORED_READING_PROVIDERS.find(definition =>
        normalizedProviderKey(definition.provider) === normalized
        || normalizedProviderKey(definition.displayName) === normalized
    )?.displayName || value;
}

export type AdminStoredReadingProviderIdentity = Readonly<{
    displayName: string;
    provider: string;
    providerId: string;
}>;

/** Finds the strongest persisted Reading identity without using labels as item identity. */
export function findAdminStoredReadingProviderIdentity(
    providerIds: Readonly<Record<string, string | null>>
): AdminStoredReadingProviderIdentity | null {
    const values = Object.entries(providerIds).map(([ key, value ]) => ({
        key: normalizedProviderKey(key),
        value: value?.trim() || ''
    }));
    for (const definition of STORED_READING_PROVIDERS) {
        const key = normalizedProviderKey(definition.provider);
        const stored = values.find(value => value.key === key && value.value);
        if (stored) return { ...definition, providerId: stored.value };
    }
    return null;
}

function normalizeCredit(value: unknown): AdminReadingPersonCredit | null {
    const source = transportRecord(value);
    const name = text(source.name);
    return name ? {
        name,
        providerId: nullableText(source.providerId, 256),
        role: nullableText(source.role, 128)
    } : null;
}

function credits(value: unknown) {
    return Array.isArray(value) ? value.map(normalizeCredit).filter(
        (entry): entry is AdminReadingPersonCredit => Boolean(entry)
    ).slice(0, 64) : [];
}

function normalizeReason(value: unknown): AdminReadingScoreReason | null {
    const source = transportRecord(value);
    const code = text(source.code, 128);
    const message = text(source.message, 512);
    if (!code || !message) return null;
    const impact = finiteNumber(source.impact) ?? 0;
    return {
        code,
        evidence: nullableText(source.evidence, 512),
        impact,
        isPositive: impact > 0,
        message
    };
}

export function normalizeAdminReadingMetadataCandidate(value: unknown): AdminReadingMetadataCandidate | null {
    const source = transportRecord(value);
    const provider = text(source.provider, 128);
    const providerId = text(source.providerId, 256);
    const title = text(source.title);
    if (!provider || !providerId || !title) return null;
    const score = finiteNumber(source.score);
    return {
        alternateTitles: stringArray(source.alternateTitles),
        artists: credits(source.artists),
        authors: credits(source.authors),
        bannerUrl: normalizeAdminMetadataProviderImageUrl(source.bannerUrl),
        chapterNumber: nullableText(source.chapterNumber, 32),
        countryOfOrigin: nullableText(source.countryOfOrigin, 64),
        coverUrl: normalizeAdminMetadataProviderImageUrl(source.coverUrl),
        description: normalizeAdminMetadataProviderDescription(source.description) || null,
        endYear: integer(source.endYear),
        externalIds: stringMap(source.externalIds, 32, 256),
        genres: stringArray(source.genres, 64, 128),
        isbn10: nullableText(source.isbn10, 32),
        isbn13: nullableText(source.isbn13, 32),
        issueNumber: nullableText(source.issueNumber, 32),
        language: nullableText(source.language, 64),
        localizedTitles: stringMap(source.localizedTitles),
        mediaClass: mediaClass(source.mediaClass),
        provider,
        providerId,
        publisher: nullableText(source.publisher),
        score: score === null ? null : Math.max(0, Math.min(100, score)),
        scoreReasons: Array.isArray(source.scoreReasons) ? source.scoreReasons.map(normalizeReason).filter(
            (entry): entry is AdminReadingScoreReason => Boolean(entry)
        ).slice(0, 64) : [],
        seriesTitle: nullableText(source.seriesTitle),
        sourceUrl: normalizeAdminMetadataProviderSourceUrl(source.sourceUrl),
        startYear: integer(source.startYear),
        status: nullableText(source.status, 64),
        tags: stringArray(source.tags, 64, 128),
        title,
        totalChapters: integer(source.totalChapters),
        totalVolumes: integer(source.totalVolumes),
        volumeNumber: nullableText(source.volumeNumber, 32),
        year: integer(source.year)
    };
}

function normalizeStructuredQuery(value: unknown): AdminReadingStructuredQuery {
    const source = transportRecord(value);
    const classification = transportRecord(source.classification);
    const providerId = transportRecord(source.providerId);
    return {
        alternateTitles: stringArray(source.alternateTitles),
        author: nullableText(source.author, 256),
        chapterNumber: nullableText(source.chapterNumber, 32),
        classification: {
            confidence: Math.max(0, Math.min(1, finiteNumber(classification.confidence) ?? 0)),
            mediaClass: mediaClass(classification.mediaClass),
            reasons: stringArray(classification.reasons, 32, 256)
        },
        cleanedTitle: text(source.cleanedTitle),
        editionKind: [ 'annual', 'omnibus', 'special', 'trade-paperback' ].includes(text(source.editionKind)) ?
            text(source.editionKind) as AdminReadingStructuredQuery['editionKind'] : 'standard',
        existingProviderIds: stringMap(source.existingProviderIds, 32, 256),
        ignoredFilenameTokens: stringArray(source.ignoredFilenameTokens, 32, 128),
        isbn: nullableText(source.isbn, 64),
        issueNumber: nullableText(source.issueNumber, 32),
        mediaClass: mediaClass(source.mediaClass),
        originalLanguage: nullableText(source.originalLanguage, 64),
        providerId: text(providerId.provider, 128) && text(providerId.id, 256) ? {
            id: text(providerId.id, 256),
            provider: text(providerId.provider, 128)
        } : null,
        rawFileName: text(source.rawFileName),
        rawTitle: text(source.rawTitle),
        seriesTitle: nullableText(source.seriesTitle),
        volumeNumber: nullableText(source.volumeNumber, 32),
        year: integer(source.year)
    };
}

function normalizeProviderResult(value: unknown): AdminReadingProviderSearchResult | null {
    const source = transportRecord(value);
    const provider = text(source.provider, 128);
    if (!provider) return null;
    const failure = transportRecord(source.failure);
    const failureProvider = text(failure.provider, 128);
    return {
        cacheHit: source.cacheHit === true,
        candidates: Array.isArray(source.candidates) ? source.candidates.map(normalizeAdminReadingMetadataCandidate).filter(
            (entry): entry is AdminReadingMetadataCandidate => Boolean(entry)
        ).slice(0, 30) : [],
        durationMilliseconds: Math.max(0, integer(source.durationMilliseconds) ?? 0),
        failure: failureProvider ? {
            code: text(failure.code, 128),
            kind: failureKind(failure.kind),
            message: text(failure.message, 512),
            provider: failureProvider,
            retryAfterSeconds: integer(failure.retryAfterSeconds)
        } : null,
        provider,
        state: state(source.state)
    };
}

export function normalizeAdminReadingMetadataSearchResponse(value: unknown): AdminReadingMetadataSearchResponse {
    const source = transportRecord(value);
    const localMetadata = transportRecord(source.localMetadata);
    const candidates = Array.isArray(source.candidates) ? source.candidates.map(normalizeAdminReadingMetadataCandidate).filter(
        (entry): entry is AdminReadingMetadataCandidate => Boolean(entry)
    ).slice(0, 30) : [];
    return {
        candidates,
        localMetadata: {
            sources: stringArray(localMetadata.sources, 2, 32),
            state: localInspectionState(localMetadata.state),
            warnings: stringArray(localMetadata.warnings, 8, 128)
        },
        providerResults: Array.isArray(source.providerResults) ? source.providerResults.map(normalizeProviderResult).filter(
            (entry): entry is AdminReadingProviderSearchResult => Boolean(entry)
        ) : [],
        query: normalizeStructuredQuery(source.query)
    };
}

function normalizeProviderStatus(value: unknown): AdminReadingProviderStatus | null {
    const source = transportRecord(value);
    const provider = text(source.provider, 128);
    if (!provider) return null;
    return {
        displayName: text(source.displayName, 128) || provider,
        message: nullableText(source.message, 512),
        provider,
        retryAfterSeconds: integer(source.retryAfterSeconds),
        state: state(source.state)
    };
}

export function normalizeAdminReadingMetadataProviders(value: unknown): AdminReadingMetadataProvidersResponse {
    const source = transportRecord(value);
    return {
        providers: Array.isArray(source.providers) ? source.providers.map(normalizeProviderStatus).filter(
            (entry): entry is AdminReadingProviderStatus => Boolean(entry)
        ) : []
    };
}

export function toAdminMetadataIdentifyResult(
    candidate: AdminReadingMetadataCandidate,
    position: number,
    query?: AdminReadingStructuredQuery
): AdminMetadataIdentifyResult {
    return {
        id: `ptv-reading:${candidate.provider}:${candidate.providerId}:${position}`,
        imageUrl: candidate.coverUrl,
        name: candidate.title,
        overview: candidate.description || '',
        providerIds: candidate.externalIds,
        providerName: candidate.provider,
        readingCandidate: candidate,
        readingQuery: query,
        source: null,
        year: candidateProductionYear(candidate)
    };
}

function canEdit(field: AdminMetadataEditableField, editableFields: readonly AdminMetadataEditableField[]) {
    return editableFields.includes(field);
}

function locked(form: AdminMetadataForm, field: MetadataField) {
    return form.lockData === true || form.lockedFields.includes(field);
}

function mergeUnique(left: readonly string[], right: readonly string[]) {
    return Array.from(new Set([ ...left, ...right ].map(value => value.trim()).filter(Boolean)));
}

function candidateProviderIdentity(candidate: AdminReadingMetadataCandidate) {
    const normalized = normalizedProviderKey(candidate.provider);
    const canonical = {
        anilist: 'AniList',
        comicvine: 'ComicVine',
        gcd: 'GCD',
        googlebooks: 'GoogleBooks',
        mangadex: 'MangaDex'
    }[normalized];
    return canonical ? { [canonical]: candidate.providerId } : {};
}

function candidateProductionYear(candidate: AdminReadingMetadataCandidate) {
    // GCD year_began is a catalog value rather than authoritative run evidence. A shallow
    // series candidate must not overwrite the item's year with that catalog year; direct
    // issue responses may still supply an authoritative publication year in `year`.
    return normalizedProviderKey(candidate.provider) === 'gcd' ?
        candidate.year : candidate.startYear ?? candidate.year;
}

function numericIndex(value: string | null | undefined) {
    if (!value || !/^-?\d+(?:\.\d+)?$/.test(value.trim())) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function candidateNumbering(
    candidate: AdminReadingMetadataCandidate,
    query?: AdminReadingStructuredQuery
) {
    const issue = numericIndex(query?.issueNumber) ?? numericIndex(candidate.issueNumber);
    const volume = numericIndex(query?.volumeNumber) ?? numericIndex(candidate.volumeNumber);
    const chapter = numericIndex(query?.chapterNumber) ?? numericIndex(candidate.chapterNumber);
    if (issue !== null) return { indexNumber: issue, parentIndexNumber: volume };
    if (chapter !== null) return { indexNumber: chapter, parentIndexNumber: volume };
    return { indexNumber: volume, parentIndexNumber: null };
}

function candidateOriginalTitle(candidate: AdminReadingMetadataCandidate) {
    const localized = candidate.localizedTitles;
    const choices = [
        candidate.language ? localized[candidate.language] : null,
        localized['x-romaji'],
        ...candidate.alternateTitles,
        ...Object.values(localized)
    ];
    return choices.find(value => value?.trim()
        && value.localeCompare(candidate.title, undefined, { sensitivity: 'accent' }) !== 0)?.trim() || null;
}

function candidatePeople(candidate: AdminReadingMetadataCandidate): AdminMetadataPerson[] {
    return [
        ...candidate.authors.map(person => ({ person, type: 'Writer' })),
        ...candidate.artists.map(person => ({ person, type: 'Artist' }))
    ].filter((entry, index, all) => all.findIndex(candidateEntry =>
        `${candidateEntry.person.name}|${candidateEntry.type}`.localeCompare(
            `${entry.person.name}|${entry.type}`,
            undefined,
            { sensitivity: 'accent' }
        ) === 0) === index).map(({ person, type }) => ({
        id: null,
        name: person.name,
        role: person.role || '',
        source: null,
        type
    }));
}

type MutableAdminMetadataForm = {
    -readonly [Key in keyof AdminMetadataForm]: AdminMetadataForm[Key]
};

function applyCandidateText(
    mutable: MutableAdminMetadataForm,
    confirmed: AdminMetadataForm,
    candidate: AdminReadingMetadataCandidate,
    editableFields: readonly AdminMetadataEditableField[]
) {
    if (canEdit('name', editableFields) && !locked(confirmed, MetadataField.Name)) mutable.name = candidate.title;
    if (canEdit('originalTitle', editableFields) && !locked(confirmed, MetadataField.Name)) {
        mutable.originalTitle = candidateOriginalTitle(candidate) ?? confirmed.originalTitle;
    }
    if (canEdit('overview', editableFields) && !locked(confirmed, MetadataField.Overview) && candidate.description) {
        mutable.overview = candidate.description;
    }
}

function applyCandidateNumbers(
    mutable: MutableAdminMetadataForm,
    confirmed: AdminMetadataForm,
    candidate: AdminReadingMetadataCandidate,
    editableFields: readonly AdminMetadataEditableField[],
    query?: AdminReadingStructuredQuery
) {
    if (canEdit('productionYear', editableFields) && confirmed.lockData !== true) {
        mutable.productionYear = candidateProductionYear(candidate) ?? confirmed.productionYear;
    }
    const numbering = candidateNumbering(candidate, query);
    if (canEdit('indexNumber', editableFields) && confirmed.lockData !== true) {
        mutable.indexNumber = numbering.indexNumber ?? confirmed.indexNumber;
    }
    if (canEdit('parentIndexNumber', editableFields) && confirmed.lockData !== true) {
        mutable.parentIndexNumber = numbering.parentIndexNumber ?? confirmed.parentIndexNumber;
    }
}

function applyCandidateCollections(
    mutable: MutableAdminMetadataForm,
    confirmed: AdminMetadataForm,
    candidate: AdminReadingMetadataCandidate,
    editableFields: readonly AdminMetadataEditableField[]
) {
    if (canEdit('genres', editableFields) && !locked(confirmed, MetadataField.Genres)) {
        mutable.genres = mergeUnique(confirmed.genres, candidate.genres);
    }
    if (canEdit('tags', editableFields) && !locked(confirmed, MetadataField.Tags)) {
        mutable.tags = mergeUnique(confirmed.tags, candidate.tags);
    }
    if (canEdit('people', editableFields) && !locked(confirmed, MetadataField.Cast)) {
        mutable.people = [ ...confirmed.people, ...candidatePeople(candidate) ].filter((person, index, all) =>
            all.findIndex(entry => `${entry.name}|${entry.type}`.toLocaleLowerCase() === `${person.name}|${person.type}`.toLocaleLowerCase()) === index);
    }
}

function applyCandidatePublisher(
    mutable: MutableAdminMetadataForm,
    confirmed: AdminMetadataForm,
    candidate: AdminReadingMetadataCandidate,
    editableFields: readonly AdminMetadataEditableField[]
) {
    if (!canEdit('studios', editableFields)
        || locked(confirmed, MetadataField.Studios)
        || !candidate.publisher) return;
    const publisher: AdminMetadataStudio = { id: null, name: candidate.publisher, source: null };
    mutable.studios = [ ...confirmed.studios, publisher ].filter((studio, index, all) =>
        all.findIndex(entry => entry.name.localeCompare(studio.name, undefined, { sensitivity: 'accent' }) === 0) === index);
}

function applyCandidateProviderIds(
    mutable: MutableAdminMetadataForm,
    confirmed: AdminMetadataForm,
    candidate: AdminReadingMetadataCandidate,
    editableFields: readonly AdminMetadataEditableField[]
) {
    if (!canEdit('providerIds', editableFields)) return;
    mutable.providerIds = {
        ...confirmed.providerIds,
        ...candidate.externalIds,
        ...candidateProviderIdentity(candidate)
    };
}

/** Applies only unlocked, editor-supported candidate fields to a confirmed form. */
export function createAdminMetadataFormFromReadingCandidate(
    confirmed: AdminMetadataForm,
    candidate: AdminReadingMetadataCandidate,
    editableFields: readonly AdminMetadataEditableField[],
    query?: AdminReadingStructuredQuery
): AdminMetadataForm {
    const next: AdminMetadataForm = {
        ...confirmed,
        genres: [ ...confirmed.genres ],
        lockedFields: [ ...confirmed.lockedFields ],
        people: [ ...confirmed.people ],
        productionLocations: [ ...confirmed.productionLocations ],
        providerIds: { ...confirmed.providerIds },
        studios: [ ...confirmed.studios ],
        tags: [ ...confirmed.tags ]
    };
    const mutable = next as MutableAdminMetadataForm;
    applyCandidateText(mutable, confirmed, candidate, editableFields);
    applyCandidateNumbers(mutable, confirmed, candidate, editableFields, query);
    applyCandidateCollections(mutable, confirmed, candidate, editableFields);
    applyCandidatePublisher(mutable, confirmed, candidate, editableFields);
    applyCandidateProviderIds(mutable, confirmed, candidate, editableFields);
    return next;
}
