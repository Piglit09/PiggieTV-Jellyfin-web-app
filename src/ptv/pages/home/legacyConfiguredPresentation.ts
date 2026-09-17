const CONFIGURED_FIELDS = new Set([
    'configuredrowassociation',
    'configuredrowassociations',
    'configuredpresentationauthority',
    'currentpresentationauthority'
]);
const RULE_FIELDS = new Set(['ruleid', 'sourceruleid']);
const TYPE_FIELDS = new Set(['rowtype', 'type', 'sourcetype']);

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** The legacy renderer has no final authority verifier or administrator pair map. */
export function isLegacyConfiguredRow(row: unknown) {
    if (!isRecord(row)) return false;
    return Object.entries(row).some(([key, value]) => {
        const name = key.toLowerCase();
        if (CONFIGURED_FIELDS.has(name)) return true;
        if (RULE_FIELDS.has(name)) return typeof value === 'string' && Boolean(value.trim());
        if (name === 'renderedsource' && value === 'row-builder') return true;
        return TYPE_FIELDS.has(name) && typeof value === 'string' && value.trim().toLowerCase() === 'configured-rule';
    });
}

/** Never attest pre-existing HTML by its title, row ID or equal layout options. */
export function canRestoreLegacyHomeRow(row: unknown, state: unknown) {
    return isRecord(row)
        && !isLegacyConfiguredRow(row)
        && isRecord(state)
        && state.genericPresentationVerified === true;
}
