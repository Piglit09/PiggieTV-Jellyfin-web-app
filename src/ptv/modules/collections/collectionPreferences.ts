import { currentSettings } from '../../../scripts/settings/userSettings';

import {
    getPtvCurrentUserId,
    getPtvServerId
} from '../../api';
import {
    PTV_COLLECTION_SECTION_IDS,
    type PtvCollectionOrderMode,
    type PtvCollectionRelationshipReason,
    type PtvCollectionSectionId
} from './collectionTypes';

export const PTV_COLLECTION_PREFERENCE_SCHEMA_VERSION = 1;
export const PTV_COLLECTION_PREFERENCE_SETTINGS_KEY = 'ptv.collections.preferences.v1';

const MAX_COLLECTION_KEYS = 100;
const MAX_UNDO_KEYS = 25;
const VALID_DENSITIES = new Set(['comfortable', 'compact']);
const VALID_ORDER_MODES = new Set<PtvCollectionOrderMode>([
    'collection',
    'release',
    'recently-added',
    'timeline',
    'title'
]);
const VALID_REASON_CATEGORIES = new Set<PtvCollectionRelationshipReason>([
    'configured-franchise',
    'creator',
    'jellyfin-collection',
    'provider-series',
    'reading-series',
    'seasonal-rule',
    'shared-tag',
    'soundtrack',
    'studio-brand',
    'user-history'
]);

export type PtvCollectionPreferenceScope = Readonly<{
    serverId: string;
    userId: string;
}>;

export type PtvCollectionPreferences = Readonly<{
    crossLibraryEnabled: boolean;
    defaultOrder: PtvCollectionOrderMode;
    density: 'comfortable' | 'compact';
    heroEnabled: boolean;
    hiddenCollectionKeys: readonly string[];
    personalizedEnabled: boolean;
    pinnedCollectionKeys: readonly string[];
    sectionOrder: readonly PtvCollectionSectionId[];
    sectionVisibility: Readonly<Record<PtvCollectionSectionId, boolean>>;
    showFewerReasonCategories: readonly PtvCollectionRelationshipReason[];
    undoHiddenKeys: readonly string[];
}>;

export type PtvCollectionPreferenceDocument = Readonly<{
    preferences: PtvCollectionPreferences;
    revision: number;
    schemaVersion: typeof PTV_COLLECTION_PREFERENCE_SCHEMA_VERSION;
    scope: PtvCollectionPreferenceScope;
    updatedAt: number;
}>;

export class PtvCollectionPreferenceStaleError extends Error {
    constructor() {
        super('Collection preference write was retired because a newer revision owns the scope.');
        this.name = 'PtvCollectionPreferenceStaleError';
    }
}

function normalizeIdentity(value: unknown) {
    return typeof value === 'string' ? value.trim().slice(0, 256) : '';
}

function normalizeKey(value: unknown) {
    return typeof value === 'string' ?
        value.trim().toLocaleLowerCase('en-US').slice(0, 180) :
        '';
}

function normalizeKeyList(value: unknown, limit = MAX_COLLECTION_KEYS) {
    if (!Array.isArray(value)) return [];

    return [...new Set(value.map(normalizeKey).filter(Boolean))].slice(0, limit);
}

export function normalizePtvCollectionPreferenceScope(value: unknown): PtvCollectionPreferenceScope | null {
    if (!value || typeof value !== 'object') return null;

    const candidate = value as Partial<PtvCollectionPreferenceScope>;
    const serverId = normalizeIdentity(candidate.serverId);
    const userId = normalizeIdentity(candidate.userId);

    return serverId && userId ? { serverId, userId } : null;
}

export function getCurrentPtvCollectionPreferenceScope() {
    return normalizePtvCollectionPreferenceScope({
        serverId: getPtvServerId(),
        userId: getPtvCurrentUserId()
    });
}

function getDefaultSectionVisibility() {
    return Object.fromEntries(PTV_COLLECTION_SECTION_IDS.map(id => [id, true])) as Record<PtvCollectionSectionId, boolean>;
}

export function createDefaultPtvCollectionPreferenceDocument(
    scope: PtvCollectionPreferenceScope
): PtvCollectionPreferenceDocument {
    const normalizedScope = normalizePtvCollectionPreferenceScope(scope);

    if (!normalizedScope) throw new Error('A server and user identity are required for Collection preferences.');

    return {
        preferences: {
            crossLibraryEnabled: true,
            defaultOrder: 'collection',
            density: 'comfortable',
            heroEnabled: true,
            hiddenCollectionKeys: [],
            personalizedEnabled: true,
            pinnedCollectionKeys: [],
            sectionOrder: [...PTV_COLLECTION_SECTION_IDS],
            sectionVisibility: getDefaultSectionVisibility(),
            showFewerReasonCategories: [],
            undoHiddenKeys: []
        },
        revision: 0,
        schemaVersion: PTV_COLLECTION_PREFERENCE_SCHEMA_VERSION,
        scope: normalizedScope,
        updatedAt: 0
    };
}

function normalizeSectionOrder(value: unknown) {
    const requested = Array.isArray(value) ?
        value.filter((id): id is PtvCollectionSectionId => (
            typeof id === 'string' && PTV_COLLECTION_SECTION_IDS.includes(id as PtvCollectionSectionId)
        )) :
        [];

    return [
        ...new Set(requested),
        ...PTV_COLLECTION_SECTION_IDS.filter(id => !requested.includes(id))
    ];
}

function normalizeSectionVisibility(value: unknown) {
    const record = value && typeof value === 'object' && !Array.isArray(value) ?
        value as Record<string, unknown> :
        {};

    return Object.fromEntries(PTV_COLLECTION_SECTION_IDS.map(id => [
        id,
        record[id] !== false
    ])) as Record<PtvCollectionSectionId, boolean>;
}

function normalizePreferences(value: unknown): PtvCollectionPreferences {
    const defaults = createDefaultPtvCollectionPreferenceDocument({
        serverId: 'default-server',
        userId: 'default-user'
    }).preferences;
    const candidate = value && typeof value === 'object' ? value as Partial<PtvCollectionPreferences> : {};
    const density = VALID_DENSITIES.has(String(candidate.density)) ?
        candidate.density as PtvCollectionPreferences['density'] :
        defaults.density;
    const defaultOrder = VALID_ORDER_MODES.has(candidate.defaultOrder as PtvCollectionOrderMode) ?
        candidate.defaultOrder as PtvCollectionOrderMode :
        defaults.defaultOrder;
    const reasons = Array.isArray(candidate.showFewerReasonCategories) ?
        candidate.showFewerReasonCategories.filter(
            (reason): reason is PtvCollectionRelationshipReason => VALID_REASON_CATEGORIES.has(reason)
        ) :
        [];

    return {
        crossLibraryEnabled: candidate.crossLibraryEnabled !== false,
        defaultOrder,
        density,
        heroEnabled: candidate.heroEnabled !== false,
        hiddenCollectionKeys: normalizeKeyList(candidate.hiddenCollectionKeys),
        personalizedEnabled: candidate.personalizedEnabled !== false,
        pinnedCollectionKeys: normalizeKeyList(candidate.pinnedCollectionKeys),
        sectionOrder: normalizeSectionOrder(candidate.sectionOrder),
        sectionVisibility: normalizeSectionVisibility(candidate.sectionVisibility),
        showFewerReasonCategories: [...new Set(reasons)],
        undoHiddenKeys: normalizeKeyList(candidate.undoHiddenKeys, MAX_UNDO_KEYS)
    };
}

export function normalizePtvCollectionPreferenceDocument(
    value: unknown,
    scope: PtvCollectionPreferenceScope
): PtvCollectionPreferenceDocument {
    const normalizedScope = normalizePtvCollectionPreferenceScope(scope);

    if (!normalizedScope) throw new Error('A server and user identity are required for Collection preferences.');

    if (!value || typeof value !== 'object') return createDefaultPtvCollectionPreferenceDocument(normalizedScope);

    const candidate = value as Partial<PtvCollectionPreferenceDocument>;
    const storedScope = normalizePtvCollectionPreferenceScope(candidate.scope);

    if (!storedScope || storedScope.serverId !== normalizedScope.serverId || storedScope.userId !== normalizedScope.userId) {
        return createDefaultPtvCollectionPreferenceDocument(normalizedScope);
    }

    return {
        preferences: normalizePreferences(candidate.preferences),
        revision: Math.max(0, Math.floor(Number(candidate.revision) || 0)),
        schemaVersion: PTV_COLLECTION_PREFERENCE_SCHEMA_VERSION,
        scope: normalizedScope,
        updatedAt: Math.max(0, Math.floor(Number(candidate.updatedAt) || 0))
    };
}

export function parsePtvCollectionPreferenceDocument(
    value: unknown,
    scope: PtvCollectionPreferenceScope
) {
    if (typeof value !== 'string') return normalizePtvCollectionPreferenceDocument(value, scope);

    try {
        return normalizePtvCollectionPreferenceDocument(JSON.parse(value), scope);
    } catch {
        return createDefaultPtvCollectionPreferenceDocument(scope);
    }
}

function scopeMatchesCurrent(scope: PtvCollectionPreferenceScope) {
    const current = getCurrentPtvCollectionPreferenceScope();

    return Boolean(current && current.serverId === scope.serverId && current.userId === scope.userId);
}

export function loadPtvCollectionPreferenceDocument(
    scope = getCurrentPtvCollectionPreferenceScope()
): PtvCollectionPreferenceDocument {
    if (!scope) throw new Error('A server and user identity are required for Collection preferences.');
    if (!scopeMatchesCurrent(scope)) return createDefaultPtvCollectionPreferenceDocument(scope);

    return parsePtvCollectionPreferenceDocument(
        currentSettings.get(PTV_COLLECTION_PREFERENCE_SETTINGS_KEY, true),
        scope
    );
}

export function updatePtvCollectionPreferenceDocument(
    document: PtvCollectionPreferenceDocument,
    changes: Partial<PtvCollectionPreferences>,
    expectedRevision = document.revision
) {
    if (document.revision !== expectedRevision) throw new PtvCollectionPreferenceStaleError();

    return normalizePtvCollectionPreferenceDocument({
        ...document,
        preferences: {
            ...document.preferences,
            ...changes
        },
        revision: document.revision + 1,
        updatedAt: Date.now()
    }, document.scope);
}

export function stagePtvCollectionPreferenceDocument(
    document: PtvCollectionPreferenceDocument,
    expectedRevision = document.revision - 1
) {
    if (!scopeMatchesCurrent(document.scope)) {
        throw new Error('Collection preferences are not bound to the current server user.');
    }
    if (!currentSettings.getData()) {
        throw new Error('Collection preferences cannot be saved before user settings are initialized.');
    }

    const current = loadPtvCollectionPreferenceDocument(document.scope);

    if (current.revision !== expectedRevision) throw new PtvCollectionPreferenceStaleError();

    const normalized = normalizePtvCollectionPreferenceDocument(document, document.scope);

    currentSettings.set(
        PTV_COLLECTION_PREFERENCE_SETTINGS_KEY,
        JSON.stringify(normalized),
        true
    );
    return normalized;
}

export async function flushPtvCollectionPreferenceDocument() {
    await currentSettings.flushServerPreferences();
}

export function setPtvCollectionHidden(
    document: PtvCollectionPreferenceDocument,
    collectionKey: string,
    hidden: boolean
) {
    const key = normalizeKey(collectionKey);
    const hiddenKeys = document.preferences.hiddenCollectionKeys.filter(existing => existing !== key);
    const undoHiddenKeys = document.preferences.undoHiddenKeys.filter(existing => existing !== key);

    if (hidden && key) {
        hiddenKeys.unshift(key);
        undoHiddenKeys.unshift(key);
    }

    return updatePtvCollectionPreferenceDocument(document, {
        hiddenCollectionKeys: hiddenKeys,
        undoHiddenKeys: undoHiddenKeys.slice(0, MAX_UNDO_KEYS)
    });
}

export function undoPtvCollectionHidden(document: PtvCollectionPreferenceDocument) {
    const [key, ...undoHiddenKeys] = document.preferences.undoHiddenKeys;

    if (!key) return document;

    return updatePtvCollectionPreferenceDocument(document, {
        hiddenCollectionKeys: document.preferences.hiddenCollectionKeys.filter(existing => existing !== key),
        undoHiddenKeys
    });
}

export function setPtvCollectionPinned(
    document: PtvCollectionPreferenceDocument,
    collectionKey: string,
    pinned: boolean
) {
    const key = normalizeKey(collectionKey);
    const pinnedKeys = document.preferences.pinnedCollectionKeys.filter(existing => existing !== key);

    if (pinned && key) pinnedKeys.unshift(key);

    return updatePtvCollectionPreferenceDocument(document, {
        pinnedCollectionKeys: pinnedKeys
    });
}

export function resetPtvCollectionVisibility(document: PtvCollectionPreferenceDocument) {
    return updatePtvCollectionPreferenceDocument(document, {
        hiddenCollectionKeys: [],
        showFewerReasonCategories: [],
        undoHiddenKeys: []
    });
}
