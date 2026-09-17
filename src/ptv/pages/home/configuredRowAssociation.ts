/** Server-issued presentation association. It never authorizes or retrieves an item. */
export type ConfiguredRowAssociationResult =
    | { kind: 'legacy' }
    | { kind: 'rejected'; reason: string }
    | { kind: 'matched'; ruleId: string; section: string };

type SectionAssociation = { version: 1; scope: string; rule: string; section: string };
type AssociationIndex = {
    scope: string;
    ruleIds: Map<string, string>;
    sectionRules: Map<string, string>;
};

const TOKEN = /^[a-f0-9]{64}$/;
const SECTION_FIELD = 'configuredRowAssociation';
const SETTINGS_FIELD = 'configuredRowAssociations';
const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isToken = (value: unknown): value is string => typeof value === 'string' && TOKEN.test(value);
const ruleKey = (value: string) => value.trim().toLowerCase();

function getMarker(value: unknown, field: string) {
    if (!isRecord(value)) return { present: false, value: undefined };
    const keys = Object.keys(value).filter(key => key.toLowerCase() === field.toLowerCase());
    return {
        present: keys.length > 0,
        value: keys.length === 1 && keys[0] === field ? value[field] : undefined
    };
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
    const actual = Object.keys(value);
    return actual.length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function parseSectionAssociation(value: unknown): SectionAssociation | null {
    if (!isRecord(value) || !hasExactKeys(value, [ 'version', 'scope', 'rule', 'section' ])) return null;
    if (value.version !== 1 || !isToken(value.scope) || !isToken(value.rule) || !isToken(value.section)) return null;
    return { version: 1, scope: value.scope, rule: value.rule, section: value.section };
}

function getCurrentRuleIds(rules: unknown[]) {
    const currentRules = new Map<string, string>();
    const allRuleKeys = new Set<string>();
    for (const rule of rules) {
        if (!isRecord(rule) || typeof rule.id !== 'string' || !ruleKey(rule.id)) return null;
        const key = ruleKey(rule.id);
        if (allRuleKeys.has(key)) return null;
        allRuleKeys.add(key);
        if (rule.enabled !== false) currentRules.set(key, rule.id);
    }
    return currentRules;
}

function getMappedRuleIds(mappings: unknown[], currentRules: Map<string, string>) {
    const ruleIds = new Map<string, string>();
    const mappedRuleKeys = new Set<string>();
    for (const mapping of mappings) {
        if (!isRecord(mapping) || !hasExactKeys(mapping, [ 'ruleId', 'association' ])) return null;
        if (typeof mapping.ruleId !== 'string' || !isToken(mapping.association)) return null;
        const key = ruleKey(mapping.ruleId);
        const id = currentRules.get(key);
        if (!id || mappedRuleKeys.has(key) || ruleIds.has(mapping.association)) return null;
        mappedRuleKeys.add(key);
        ruleIds.set(mapping.association, id);
    }
    return ruleIds;
}

function getMappedSectionRules(mappings: unknown[], ruleIds: Map<string, string>) {
    const sectionRules = new Map<string, string>();
    for (const mapping of mappings) {
        if (!isRecord(mapping) || !hasExactKeys(mapping, [ 'rule', 'section' ])) return null;
        if (!isToken(mapping.rule) || !isToken(mapping.section) || !ruleIds.has(mapping.rule)) return null;
        if (sectionRules.has(mapping.section)) return null;
        sectionRules.set(mapping.section, mapping.rule);
    }
    return sectionRules;
}

function parseIndex(settings: unknown, value: unknown): AssociationIndex | null {
    if (!isRecord(settings) || settings.enabled === false || !Array.isArray(settings.rules)) return null;
    if (!isRecord(value) || !hasExactKeys(value, [ 'version', 'scope', 'rules', 'sections' ])) return null;
    if (value.version !== 1 || !isToken(value.scope) || !Array.isArray(value.rules) || !Array.isArray(value.sections)) return null;
    const currentRules = getCurrentRuleIds(settings.rules);
    if (!currentRules) return null;
    const ruleIds = getMappedRuleIds(value.rules, currentRules);
    if (!ruleIds) return null;
    const sectionRules = getMappedSectionRules(value.sections, ruleIds);
    if (!sectionRules) return null;
    return { scope: value.scope, ruleIds, sectionRules };
}

function getPublicSectionKey(section: unknown) {
    if (!isRecord(section)) return '';
    const value = section.id ?? section.Id ?? section.key;
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Capture the complete response before row deduplication. Rule aliases may repeat
 * across legitimate subrows; section-instance aliases and public item-map keys may not.
 * This validates server-issued pairing, not a signature over client-owned objects.
 */
export function createConfiguredRowAssociationResolver(settings: unknown, sections: unknown[]) {
    const settingsMarker = getMarker(settings, SETTINGS_FIELD);
    const index = parseIndex(settings, settingsMarker.value);
    const parsedSections = new Map<unknown, SectionAssociation | null>();
    const instanceCounts = new Map<string, number>();
    const publicKeyCounts = new Map<string, number>();
    let responseHasOpaqueMetadata = false;

    sections.forEach(section => {
        const marker = getMarker(section, SECTION_FIELD);
        responseHasOpaqueMetadata ||= marker.present;
        const parsed = parseSectionAssociation(marker.value);
        parsedSections.set(section, parsed);
        if (parsed) instanceCounts.set(parsed.section, (instanceCounts.get(parsed.section) || 0) + 1);
        const publicKey = getPublicSectionKey(section);
        if (publicKey) publicKeyCounts.set(publicKey, (publicKeyCounts.get(publicKey) || 0) + 1);
    });

    return {
        resolve(section: unknown): ConfiguredRowAssociationResult {
            const marker = getMarker(section, SECTION_FIELD);
            if (!settingsMarker.present && !responseHasOpaqueMetadata && !marker.present) return { kind: 'legacy' };
            if (!index) return { kind: 'rejected', reason: 'configured-association-settings-invalid' };
            const parsed = parsedSections.get(section);
            if (!parsed) return { kind: 'rejected', reason: 'configured-association-section-invalid' };
            if (parsed.scope !== index.scope) return { kind: 'rejected', reason: 'configured-association-scope-mismatch' };
            const publicKey = getPublicSectionKey(section);
            if (!publicKey || publicKeyCounts.get(publicKey) !== 1 || instanceCounts.get(parsed.section) !== 1) {
                return { kind: 'rejected', reason: 'configured-association-section-ambiguous' };
            }
            const ruleId = index.ruleIds.get(parsed.rule);
            if (!ruleId || index.sectionRules.get(parsed.section) !== parsed.rule) {
                return { kind: 'rejected', reason: 'configured-association-pair-unissued' };
            }
            return { kind: 'matched', ruleId, section: parsed.section };
        }
    };
}
