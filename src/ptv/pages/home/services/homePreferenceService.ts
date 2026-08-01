import { currentSettings } from '../../../../scripts/settings/userSettings';

import {
    getPtvCurrentUserId,
    getPtvServerId
} from '../../../api';
import {
    applyPtvRecommendationFeedback,
    normalizePtvRecommendationFeedbackState,
    resetPtvRecommendationFeedback,
    undoPtvRecommendationFeedback
} from '../../../modules/recommendations/feedback/recommendationFeedback';
import type {
    PtvRecommendationFeedbackAction,
    PtvRecommendationFeedbackState
} from '../../../modules/recommendations/types/recommendationTypes';

export const NATIVE_HOME_PREFERENCE_SCHEMA_VERSION = 1;
export const NATIVE_HOME_PREFERENCE_SETTINGS_KEY = 'ptv.home.preferences.v1';
export const MAX_NATIVE_HOME_STORED_ROWS = 100;

const MAX_ROW_ID_LENGTH = 160;
const VALID_LAYOUT_MODES = new Set<NativeHomeLayoutMode>([
    'balanced',
    'cinematic',
    'compact',
    'focused',
    'minimal'
]);

export type NativeHomeDensity = 'compact' | 'comfortable';
export type NativeHomeLayoutMode = 'balanced' | 'cinematic' | 'compact' | 'focused' | 'minimal';

export type NativeHomePreferenceScope = {
    serverId: string;
    userId: string;
};

export type NativeHomeLayoutPreferences = {
    adaptiveRows: boolean;
    autoReorder: boolean;
    crossMediaRecommendations: boolean;
    density: NativeHomeDensity;
    experimentalRecommendations: boolean;
    heroEnabled: boolean;
    layoutMode: NativeHomeLayoutMode;
    moodRecommendations: boolean;
    pinnedRows: string[];
    recentlyReleasedRows: boolean;
    rowOrder: string[];
    rowVisibility: Record<string, boolean>;
    seasonalRows: boolean;
};

export type NativeHomePreferenceDocument = {
    feedback: PtvRecommendationFeedbackState;
    layout: NativeHomeLayoutPreferences;
    schemaVersion: typeof NATIVE_HOME_PREFERENCE_SCHEMA_VERSION;
    scope: NativeHomePreferenceScope;
    updatedAt: number;
};

export const DEFAULT_NATIVE_HOME_LAYOUT_PREFERENCES: NativeHomeLayoutPreferences = {
    adaptiveRows: true,
    autoReorder: true,
    crossMediaRecommendations: true,
    density: 'comfortable',
    experimentalRecommendations: true,
    heroEnabled: true,
    layoutMode: 'balanced',
    moodRecommendations: true,
    pinnedRows: [],
    recentlyReleasedRows: true,
    rowOrder: [],
    rowVisibility: {},
    seasonalRows: true
};

function normalizeIdentity(value: unknown) {
    return typeof value === 'string' ? value.trim().slice(0, 256) : '';
}

function normalizeRowId(value: unknown) {
    return typeof value === 'string' ? value.trim().slice(0, MAX_ROW_ID_LENGTH) : '';
}

function normalizeRowIds(value: unknown) {
    if (!Array.isArray(value)) return [];

    const seen = new Set<string>();
    const rowIds: string[] = [];

    value.forEach(rawRowId => {
        const rowId = normalizeRowId(rawRowId);

        if (!rowId || seen.has(rowId) || rowIds.length >= MAX_NATIVE_HOME_STORED_ROWS) return;

        seen.add(rowId);
        rowIds.push(rowId);
    });

    return rowIds;
}

function normalizeRowVisibility(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

    const rowVisibility: Record<string, boolean> = {};

    Object.entries(value).some(([rawRowId, visible]) => {
        if (Object.keys(rowVisibility).length >= MAX_NATIVE_HOME_STORED_ROWS) return true;

        const rowId = normalizeRowId(rawRowId);

        if (rowId && typeof visible === 'boolean') {
            rowVisibility[rowId] = visible;
        }

        return false;
    });

    return rowVisibility;
}

function normalizeBoolean(value: unknown, fallback: boolean) {
    return typeof value === 'boolean' ? value : fallback;
}

function normalizeTimestamp(value: unknown) {
    const timestamp = Number(value);

    return Number.isFinite(timestamp) ?
        Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(timestamp))) :
        0;
}

export function normalizeNativeHomePreferenceScope(value: unknown): NativeHomePreferenceScope | null {
    if (!value || typeof value !== 'object') return null;

    const candidate = value as Partial<NativeHomePreferenceScope>;
    const serverId = normalizeIdentity(candidate.serverId);
    const userId = normalizeIdentity(candidate.userId);

    return serverId && userId ? {
        serverId,
        userId
    } : null;
}

export function getCurrentNativeHomePreferenceScope(): NativeHomePreferenceScope | null {
    return normalizeNativeHomePreferenceScope({
        serverId: getPtvServerId(),
        userId: getPtvCurrentUserId()
    });
}

export function createDefaultNativeHomePreferenceDocument(
    scope: NativeHomePreferenceScope
): NativeHomePreferenceDocument {
    const normalizedScope = normalizeNativeHomePreferenceScope(scope);

    if (!normalizedScope) {
        throw new Error('A server and user identity are required for Home preferences.');
    }

    return {
        feedback: {
            entries: [],
            undoStack: []
        },
        layout: {
            ...DEFAULT_NATIVE_HOME_LAYOUT_PREFERENCES,
            pinnedRows: [],
            rowOrder: [],
            rowVisibility: {}
        },
        schemaVersion: NATIVE_HOME_PREFERENCE_SCHEMA_VERSION,
        scope: normalizedScope,
        updatedAt: 0
    };
}

function normalizeLayout(value: unknown): NativeHomeLayoutPreferences {
    const candidate = value && typeof value === 'object' ?
        value as Partial<NativeHomeLayoutPreferences> :
        {};
    const layoutMode = VALID_LAYOUT_MODES.has(candidate.layoutMode as NativeHomeLayoutMode) ?
        candidate.layoutMode as NativeHomeLayoutMode :
        DEFAULT_NATIVE_HOME_LAYOUT_PREFERENCES.layoutMode;

    return {
        adaptiveRows: normalizeBoolean(candidate.adaptiveRows, DEFAULT_NATIVE_HOME_LAYOUT_PREFERENCES.adaptiveRows),
        autoReorder: normalizeBoolean(candidate.autoReorder, DEFAULT_NATIVE_HOME_LAYOUT_PREFERENCES.autoReorder),
        crossMediaRecommendations: normalizeBoolean(
            candidate.crossMediaRecommendations,
            DEFAULT_NATIVE_HOME_LAYOUT_PREFERENCES.crossMediaRecommendations
        ),
        density: candidate.density === 'compact' || candidate.density === 'comfortable' ?
            candidate.density :
            DEFAULT_NATIVE_HOME_LAYOUT_PREFERENCES.density,
        experimentalRecommendations: normalizeBoolean(
            candidate.experimentalRecommendations,
            DEFAULT_NATIVE_HOME_LAYOUT_PREFERENCES.experimentalRecommendations
        ),
        heroEnabled: normalizeBoolean(candidate.heroEnabled, DEFAULT_NATIVE_HOME_LAYOUT_PREFERENCES.heroEnabled),
        layoutMode,
        moodRecommendations: normalizeBoolean(
            candidate.moodRecommendations,
            DEFAULT_NATIVE_HOME_LAYOUT_PREFERENCES.moodRecommendations
        ),
        pinnedRows: normalizeRowIds(candidate.pinnedRows),
        recentlyReleasedRows: normalizeBoolean(
            candidate.recentlyReleasedRows,
            DEFAULT_NATIVE_HOME_LAYOUT_PREFERENCES.recentlyReleasedRows
        ),
        rowOrder: normalizeRowIds(candidate.rowOrder),
        rowVisibility: normalizeRowVisibility(candidate.rowVisibility),
        seasonalRows: normalizeBoolean(candidate.seasonalRows, DEFAULT_NATIVE_HOME_LAYOUT_PREFERENCES.seasonalRows)
    };
}

function scopeMatches(left: NativeHomePreferenceScope | null, right: NativeHomePreferenceScope) {
    return Boolean(
        left
        && left.serverId === right.serverId
        && left.userId === right.userId
    );
}

export function normalizeNativeHomePreferenceDocument(
    value: unknown,
    scope: NativeHomePreferenceScope
): NativeHomePreferenceDocument {
    const normalizedScope = normalizeNativeHomePreferenceScope(scope);

    if (!normalizedScope) {
        throw new Error('A server and user identity are required for Home preferences.');
    }

    const defaults = createDefaultNativeHomePreferenceDocument(normalizedScope);

    if (!value || typeof value !== 'object') return defaults;

    const candidate = value as Partial<NativeHomePreferenceDocument>;

    if (
        candidate.schemaVersion !== NATIVE_HOME_PREFERENCE_SCHEMA_VERSION
        || !scopeMatches(normalizeNativeHomePreferenceScope(candidate.scope), normalizedScope)
    ) {
        return defaults;
    }

    return {
        feedback: normalizePtvRecommendationFeedbackState(candidate.feedback),
        layout: normalizeLayout(candidate.layout),
        schemaVersion: NATIVE_HOME_PREFERENCE_SCHEMA_VERSION,
        scope: normalizedScope,
        updatedAt: normalizeTimestamp(candidate.updatedAt)
    };
}

export function parseNativeHomePreferenceDocument(
    rawValue: unknown,
    scope: NativeHomePreferenceScope
) {
    if (typeof rawValue !== 'string') {
        return normalizeNativeHomePreferenceDocument(rawValue, scope);
    }

    try {
        return normalizeNativeHomePreferenceDocument(JSON.parse(rawValue), scope);
    } catch {
        return createDefaultNativeHomePreferenceDocument(scope);
    }
}

function currentSettingsOwnScope(scope: NativeHomePreferenceScope) {
    const currentUserId = normalizeIdentity(currentSettings.currentUserId);
    const apiClient = currentSettings.currentApiClient;
    const currentServerId = apiClient && typeof apiClient.serverId === 'function' ?
        normalizeIdentity(apiClient.serverId()) :
        '';

    return currentUserId === scope.userId && currentServerId === scope.serverId;
}

function requireOwnedCurrentScope(scope?: NativeHomePreferenceScope) {
    const normalizedScope = normalizeNativeHomePreferenceScope(scope || getCurrentNativeHomePreferenceScope());

    if (!normalizedScope || !currentSettingsOwnScope(normalizedScope)) {
        throw new Error('Home preferences are not bound to the current server user.');
    }

    return normalizedScope;
}

export function loadNativeHomePreferenceDocument(
    scope?: NativeHomePreferenceScope
): NativeHomePreferenceDocument {
    const normalizedScope = normalizeNativeHomePreferenceScope(scope || getCurrentNativeHomePreferenceScope());

    if (!normalizedScope || !currentSettingsOwnScope(normalizedScope)) {
        if (normalizedScope) return createDefaultNativeHomePreferenceDocument(normalizedScope);

        throw new Error('A server and user identity are required for Home preferences.');
    }

    return parseNativeHomePreferenceDocument(
        currentSettings.get(NATIVE_HOME_PREFERENCE_SETTINGS_KEY, true),
        normalizedScope
    );
}

export function stageNativeHomePreferenceDocument(
    document: NativeHomePreferenceDocument,
    scope?: NativeHomePreferenceScope
) {
    const normalizedScope = requireOwnedCurrentScope(scope);
    const documentScope = normalizeNativeHomePreferenceScope(document.scope);

    if (!scopeMatches(documentScope, normalizedScope)) {
        throw new Error('Home preference document identity does not match the current server user.');
    }

    if (!currentSettings.getData()) {
        throw new Error('Home preferences cannot be saved before user settings are initialized.');
    }

    const normalized = normalizeNativeHomePreferenceDocument(document, normalizedScope);
    const staged = {
        ...normalized,
        updatedAt: Date.now()
    };

    currentSettings.set(
        NATIVE_HOME_PREFERENCE_SETTINGS_KEY,
        JSON.stringify(staged),
        true
    );

    return staged;
}

export async function flushNativeHomePreferenceDocument() {
    await currentSettings.flushServerPreferences();
}

export async function saveNativeHomePreferenceDocument(
    document: NativeHomePreferenceDocument,
    scope?: NativeHomePreferenceScope
) {
    const staged = stageNativeHomePreferenceDocument(document, scope);

    await flushNativeHomePreferenceDocument();
    return staged;
}

export function applyNativeHomeRecommendationFeedback(
    document: NativeHomePreferenceDocument,
    input: {
        action: PtvRecommendationFeedbackAction;
        itemId: string;
        now?: number;
        terms?: string[];
    }
) {
    const normalized = normalizeNativeHomePreferenceDocument(document, document.scope);

    return {
        ...normalized,
        feedback: applyPtvRecommendationFeedback(normalized.feedback, input),
        updatedAt: input.now ?? Date.now()
    };
}

export function undoNativeHomeRecommendationFeedback(document: NativeHomePreferenceDocument) {
    const normalized = normalizeNativeHomePreferenceDocument(document, document.scope);

    return {
        ...normalized,
        feedback: undoPtvRecommendationFeedback(normalized.feedback),
        updatedAt: Date.now()
    };
}

export function resetNativeHomeRecommendationFeedback(document: NativeHomePreferenceDocument) {
    const normalized = normalizeNativeHomePreferenceDocument(document, document.scope);

    return {
        ...normalized,
        feedback: resetPtvRecommendationFeedback(),
        updatedAt: Date.now()
    };
}
