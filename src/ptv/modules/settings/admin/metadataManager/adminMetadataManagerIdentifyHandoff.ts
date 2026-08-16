const HANDOFF_KEY = 'ptvMetadataQualityIdentify';
const HANDOFF_VERSION = 2;
const MAX_ITEM_ID_LENGTH = 256;
const MAX_TITLE_LENGTH = 500;
const MAX_ISSUE_NUMBER_LENGTH = 64;
const MAX_PROVIDER_COUNT = 16;
const MAX_PROVIDER_KEY_LENGTH = 64;
const MAX_PROVIDER_ID_LENGTH = 256;

export type AdminMetadataManagerIdentifyMediaClass =
    | 'book'
    | 'comic'
    | 'graphic-novel'
    | 'manga'
    | 'manhua'
    | 'manhwa'
    | 'unknown';

export type AdminMetadataManagerIdentifyPrefill = Readonly<{
    issueNumber?: string | null;
    itemId: string;
    mediaClass?: AdminMetadataManagerIdentifyMediaClass | null;
    name: string;
    provider?: string | null;
    providerIds: Readonly<Record<string, string>>;
    seriesStartYear?: number | null;
    seriesTitle?: string | null;
    year: number | null;
}>;

type AdminMetadataManagerIdentifyHandoffV1 = Readonly<{
    itemId: string;
    name: string;
    providerIds: Readonly<Record<string, string>>;
    version: 1;
    year: number | null;
}>;

type AdminMetadataManagerIdentifyHandoffV2 = Readonly<{
    issueNumber: string | null;
    itemId: string;
    mediaClass: AdminMetadataManagerIdentifyMediaClass | null;
    name: string;
    provider: string | null;
    providerIds: Readonly<Record<string, string>>;
    seriesStartYear: number | null;
    seriesTitle: string | null;
    version: 2;
    year: number | null;
}>;

type AdminMetadataManagerIdentifyHandoff = AdminMetadataManagerIdentifyHandoffV1 | AdminMetadataManagerIdentifyHandoffV2;

export type AdminMetadataManagerNavigationState = Readonly<{
    [HANDOFF_KEY]: AdminMetadataManagerIdentifyHandoff;
}>;

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function safeText(value: unknown, maximumLength: number) {
    if (typeof value !== 'string') return '';
    const normalized = value.trim();
    const hasControlCharacter = Array.from(normalized).some(character => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127;
    });
    if (!normalized || normalized.length > maximumLength || hasControlCharacter) return '';
    return normalized;
}

function safeYear(value: unknown): number | null | undefined {
    if (value === null || value === undefined) return null;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 9_999) return undefined;
    return value;
}

function safeProviderIds(value: unknown) {
    const source = record(value);
    if (!source) return null;

    const entries: Array<readonly [string, string]> = [];
    for (const [ rawKey, rawValue ] of Object.entries(source)) {
        const key = safeText(rawKey, MAX_PROVIDER_KEY_LENGTH);
        const id = safeText(rawValue, MAX_PROVIDER_ID_LENGTH);
        if (!key || !id) continue;
        entries.push([ key, id ] as const);
        if (entries.length > MAX_PROVIDER_COUNT) return null;
    }

    return entries.length ? Object.fromEntries(entries) : null;
}

function optionalSafeText(value: unknown, maximumLength: number) {
    if (value === null || value === undefined || value === '') return { valid: true, value: null } as const;
    const normalized = safeText(value, maximumLength);
    if (normalized) return { valid: true, value: normalized } as const;
    return { valid: false, value: null } as const;
}

function safeMediaClass(value: unknown) {
    if (value === null || value === undefined || value === '') return { valid: true, value: null } as const;
    switch (value) {
        case 'book': return { valid: true, value: 'book' } as const;
        case 'comic': return { valid: true, value: 'comic' } as const;
        case 'graphic-novel': return { valid: true, value: 'graphic-novel' } as const;
        case 'manga': return { valid: true, value: 'manga' } as const;
        case 'manhua': return { valid: true, value: 'manhua' } as const;
        case 'manhwa': return { valid: true, value: 'manhwa' } as const;
        case 'unknown': return { valid: true, value: 'unknown' } as const;
        default:
            return { valid: false, value: null } as const;
    }
}

function normalizePrefill(
    value: unknown,
    expectedItemId?: string,
    includeStructuredFields = false
): AdminMetadataManagerIdentifyPrefill | null {
    const candidate = record(value);
    if (!candidate) return null;

    const itemId = safeText(candidate.itemId, MAX_ITEM_ID_LENGTH);
    const name = safeText(candidate.name, MAX_TITLE_LENGTH);
    const providerIds = safeProviderIds(candidate.providerIds);
    const year = safeYear(candidate.year);
    if (!itemId || !name || !providerIds || year === undefined || (expectedItemId && itemId !== expectedItemId)) return null;

    const base = { itemId, name, providerIds, year };
    if (!includeStructuredFields) return base;

    const issueNumber = optionalSafeText(candidate.issueNumber, MAX_ISSUE_NUMBER_LENGTH);
    const mediaClass = safeMediaClass(candidate.mediaClass);
    const provider = optionalSafeText(candidate.provider, MAX_PROVIDER_KEY_LENGTH);
    const seriesStartYear = safeYear(candidate.seriesStartYear);
    const seriesTitle = optionalSafeText(candidate.seriesTitle, MAX_TITLE_LENGTH);
    if (!issueNumber.valid
        || !mediaClass.valid
        || !provider.valid
        || seriesStartYear === undefined
        || !seriesTitle.valid) {
        return null;
    }

    return {
        ...base,
        issueNumber: issueNumber.value,
        mediaClass: mediaClass.value,
        provider: provider.value,
        seriesStartYear,
        seriesTitle: seriesTitle.value
    };
}

/**
 * Creates transient router state from a server-verified Metadata Quality
 * candidate. The hint cannot apply metadata; Metadata Manager still performs
 * an authoritative provider search and requires explicit result confirmation.
 */
export function createAdminMetadataManagerIdentifyHandoff(
    candidate: AdminMetadataManagerIdentifyPrefill
): AdminMetadataManagerNavigationState | null {
    const normalized = normalizePrefill(candidate, undefined, true);
    if (!normalized) return null;
    return {
        [HANDOFF_KEY]: {
            issueNumber: normalized.issueNumber ?? null,
            itemId: normalized.itemId,
            mediaClass: normalized.mediaClass ?? null,
            name: normalized.name,
            provider: normalized.provider ?? null,
            providerIds: normalized.providerIds,
            seriesStartYear: normalized.seriesStartYear ?? null,
            seriesTitle: normalized.seriesTitle ?? null,
            version: HANDOFF_VERSION,
            year: normalized.year
        } satisfies AdminMetadataManagerIdentifyHandoffV2
    };
}

/**
 * Treats history state as untrusted input and accepts it only for the immutable
 * item in the current route. A direct load without handoff state safely
 * returns no prefill.
 */
export function readAdminMetadataManagerIdentifyHandoff(
    state: unknown,
    routeItemId: string
): AdminMetadataManagerIdentifyPrefill | null {
    const wrapper = record(state);
    const candidate = wrapper ? record(wrapper[HANDOFF_KEY]) : null;
    if (!candidate || (candidate.version !== 1 && candidate.version !== HANDOFF_VERSION)) return null;
    return normalizePrefill(candidate, routeItemId, candidate.version === HANDOFF_VERSION);
}
