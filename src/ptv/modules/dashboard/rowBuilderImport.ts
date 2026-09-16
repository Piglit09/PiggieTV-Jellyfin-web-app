export const MAX_PTV_ROW_IMPORT_BYTES = 512 * 1024;
export const MAX_PTV_IMPORTED_ROWS = 250;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validateNativeRules(rules: unknown[]) {
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
        && (!Number.isInteger(schemaVersion) || Number(schemaVersion) < 1 || Number(schemaVersion) > 2)
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
    if (Array.isArray(parsed.rules)) validateNativeRules(parsed.rules);

    return parsed;
}
