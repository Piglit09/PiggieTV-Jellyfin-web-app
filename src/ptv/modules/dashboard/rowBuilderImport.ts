export const MAX_PTV_ROW_IMPORT_BYTES = 512 * 1024;
export const MAX_PTV_IMPORTED_ROWS = 250;

export type PtvRowDefaultLibraryKey = 'movies' | 'shows' | 'cartoons' | 'anime' | 'music';
export type PtvRowLibraryScope =
    | { mode: 'global' }
    | { mode: 'defaultLibrary'; defaultKey: PtvRowDefaultLibraryKey; virtualFolderId?: string }
    | { mode: 'virtualFolder'; virtualFolderId: string }
    | { mode: 'invalid' };

const DEFAULT_LIBRARY_KEYS: readonly PtvRowDefaultLibraryKey[] = [ 'movies', 'shows', 'cartoons', 'anime', 'music' ];
const VIRTUAL_FOLDER_ID = /^[0-9a-f]{32}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isDefaultLibraryKey(value: unknown): value is PtvRowDefaultLibraryKey {
    return DEFAULT_LIBRARY_KEYS.includes(value as PtvRowDefaultLibraryKey);
}

function canonicalVirtualFolderId(value: unknown): string | null {
    if (typeof value !== 'string' || !VIRTUAL_FOLDER_ID.test(value) || /^0{32}$/.test(value)) return null;
    return value.toLowerCase();
}

export function getPtvBuiltInLibraryKey(rule: Record<string, unknown>): PtvRowDefaultLibraryKey | null {
    const key = typeof rule.id === 'string' && rule.id.startsWith('latest-') ? rule.id.slice(7) : '';
    return isDefaultLibraryKey(key)
        && rule.mediaType === key
        && rule.sourceType === 'latest'
        && rule.sourceValue === key ? key : null;
}

function readScopeFields(rawScope: unknown) {
    if (!isRecord(rawScope) || Object.keys(rawScope).some(key => ![ 'mode', 'defaultKey', 'virtualFolderId' ].includes(key))) {
        return null;
    }
    if ((rawScope.defaultKey != null && typeof rawScope.defaultKey !== 'string')
        || (rawScope.virtualFolderId != null && typeof rawScope.virtualFolderId !== 'string')) {
        return null;
    }

    return {
        defaultKey: typeof rawScope.defaultKey === 'string' ? rawScope.defaultKey.trim() : '',
        mode: typeof rawScope.mode === 'string' ? rawScope.mode.trim() : '',
        rawId: typeof rawScope.virtualFolderId === 'string' ? rawScope.virtualFolderId.trim() : null
    };
}

function normalizeDefaultLibraryScope(
    fields: NonNullable<ReturnType<typeof readScopeFields>>,
    builtInKey: PtvRowDefaultLibraryKey | null
): PtvRowLibraryScope {
    const { defaultKey, rawId } = fields;
    if (!isDefaultLibraryKey(defaultKey) || builtInKey !== defaultKey) return { mode: 'invalid' };
    if (rawId === null) return { mode: 'defaultLibrary', defaultKey };
    const id = canonicalVirtualFolderId(rawId);
    if (id) return { mode: 'defaultLibrary', defaultKey, virtualFolderId: id };
    return { mode: 'invalid' };
}

function normalizeMissingScope(
    rule: Record<string, unknown>,
    schemaVersion: number,
    builtInKey: PtvRowDefaultLibraryKey | null,
    formerlyOwnedId: boolean
): PtvRowLibraryScope {
    if (schemaVersion < 3 && builtInKey) return { mode: 'defaultLibrary', defaultKey: builtInKey };
    if (schemaVersion < 3 && !formerlyOwnedId && rule.sourceType !== 'library') return { mode: 'global' };
    return { mode: 'invalid' };
}

function normalizeExplicitVirtualFolderScope(fields: NonNullable<ReturnType<typeof readScopeFields>>): PtvRowLibraryScope {
    if (fields.defaultKey) return { mode: 'invalid' };
    if (fields.rawId === '') return { mode: 'virtualFolder', virtualFolderId: '' };
    const id = canonicalVirtualFolderId(fields.rawId);
    if (id) return { mode: 'virtualFolder', virtualFolderId: id };
    return { mode: 'invalid' };
}

export function normalizePtvRowLibraryScope(rule: Record<string, unknown>, schemaVersion: number): PtvRowLibraryScope {
    const builtInKey = getPtvBuiltInLibraryKey(rule);
    const formerlyOwnedId = typeof rule.id === 'string' && DEFAULT_LIBRARY_KEYS.some(key => rule.id === `latest-${key}`);
    const rawScope = rule.libraryScope;

    if (rawScope == null) return normalizeMissingScope(rule, schemaVersion, builtInKey, formerlyOwnedId);
    const fields = readScopeFields(rawScope);
    if (!fields) return { mode: 'invalid' };
    const { defaultKey, mode, rawId } = fields;
    if (mode === 'global' && !defaultKey && !rawId && rule.sourceType !== 'library' && !formerlyOwnedId) {
        return { mode: 'global' };
    }
    if (mode === 'defaultLibrary') return normalizeDefaultLibraryScope(fields, builtInKey);
    if (mode === 'virtualFolder') return normalizeExplicitVirtualFolderScope(fields);
    return { mode: 'invalid' };
}

function validateNativeRules(rules: unknown[], schemaVersion: number) {
    const ids = new Set<string>();

    rules.forEach(ruleValue => {
        if (!isRecord(ruleValue)) throw new Error('Every imported row rule must be a JSON object.');

        const id = typeof ruleValue.id === 'string' ? ruleValue.id.trim() : '';
        const name = typeof ruleValue.name === 'string' ? ruleValue.name.trim() : '';
        if (!id) throw new Error('Every imported row rule needs an id.');
        if (!name) throw new Error(`Imported rule '${id}' needs a row name.`);

        const normalizedId = id.toLowerCase();
        if (ids.has(normalizedId)) throw new Error(`Duplicate rule id '${id}'.`);
        ids.add(normalizedId);

        const scope = normalizePtvRowLibraryScope(ruleValue, schemaVersion);
        if (scope.mode === 'invalid' || (scope.mode === 'virtualFolder' && !scope.virtualFolderId)) {
            throw new Error(`Imported rule '${id}' has an invalid library scope.`);
        }
    });
}

/** Parses only a bounded Row Builder document; persistence remains an explicit later action. */
export function parsePtvRowBuilderImport(text: string): Record<string, unknown> {
    if (new Blob([ text ]).size > MAX_PTV_ROW_IMPORT_BYTES) {
        throw new Error('Row configuration is too large. Choose a JSON file smaller than 512 KiB.');
    }

    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) throw new Error('Row configuration must be a JSON object.');

    const schemaVersion = parsed.schemaVersion;
    if (
        schemaVersion !== undefined
        && schemaVersion !== null
        && (!Number.isInteger(schemaVersion) || Number(schemaVersion) < 1 || Number(schemaVersion) > 3)
    ) {
        throw new Error('This Row Builder schema version is not supported.');
    }

    let entries: unknown[] | null = null;

    if (Array.isArray(parsed.rules)) {
        entries = parsed.rules;
    } else if (Array.isArray(parsed.categories)) {
        entries = parsed.categories;
    }
    if (!entries) throw new Error('Row configuration must contain a rules or categories array.');
    if (entries.length > MAX_PTV_IMPORTED_ROWS) {
        throw new Error(`Row configuration cannot contain more than ${MAX_PTV_IMPORTED_ROWS} rows.`);
    }
    if (Array.isArray(parsed.rules)) validateNativeRules(parsed.rules, typeof schemaVersion === 'number' ? schemaVersion : 1);

    return parsed;
}
