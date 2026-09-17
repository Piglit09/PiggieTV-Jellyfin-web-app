/** Point-in-time presentation proof only. Jellyfin remains the item-access authority. */
type PresentationAuthority = { version: 1; scope: string; generation: string };
export type ConfiguredRowFreshnessSnapshot = Readonly<{
    status: 'UNKNOWN' | 'VERIFYING' | 'CURRENT' | 'STALE' | 'ERROR';
    authority: string | null;
    identityKey: string | null;
    revision: number;
    reason: string;
}>;
export type ConfiguredRowVerification = Readonly<{ revision: number }>;
export type ConfiguredRowProof = Readonly<{ verified: true }>;
type ProofState = {
    revision: number;
    authority: PresentationAuthority;
    bindings: Set<string>;
};

const opaque = /^[a-f0-9]{64}$/;
const listeners = new Set<() => void>();
const proofs = new WeakMap<ConfiguredRowProof, ProofState>();
const consumedVerifications = new WeakSet<ConfiguredRowVerification>();
let activeVerification: ConfiguredRowVerification | null = null;
let expectedAuthority: string | null = null;
let snapshot: ConfiguredRowFreshnessSnapshot = Object.freeze({
    status: 'UNKNOWN', authority: null, identityKey: null, revision: 0, reason: 'unverified'
});

function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ?
        value as Record<string, unknown> : null;
}

export function parseConfiguredPresentationAuthority(value: unknown): PresentationAuthority | null {
    const candidate = record(value);
    return candidate && Object.keys(candidate).length === 3 && candidate.version === 1
        && typeof candidate.scope === 'string' && opaque.test(candidate.scope)
        && typeof candidate.generation === 'string' && opaque.test(candidate.generation) ?
        { version: 1, scope: candidate.scope, generation: candidate.generation } : null;
}

function authorityKey(value: PresentationAuthority | null): string | null {
    return value ? `${value.scope}.${value.generation}` : null;
}

export function readConfiguredPresentationAuthority(value: unknown) {
    return parseConfiguredPresentationAuthority(readExactField(value, 'currentPresentationAuthority'));
}

function readExactField(value: unknown, name: string) {
    const candidate = record(value);
    const markers = candidate && Object.keys(candidate).filter(key => key.toLowerCase() === name.toLowerCase());
    return markers?.length === 1 && markers[0] === name ? candidate![name] : null;
}

function publish(next: ConfiguredRowFreshnessSnapshot) {
    snapshot = Object.freeze(next);
    listeners.forEach(listener => {
        try {
            listener();
        } catch {
            // A presentation subscriber must not break an authoritative API read or other listeners.
        }
    });
}

export function getConfiguredRowFreshnessSnapshot() {
    return snapshot;
}

export function subscribeConfiguredRowFreshness(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function retireConfiguredRowFreshness(reason: string) {
    activeVerification = null;
    expectedAuthority = null;
    publish({ ...snapshot, authority: null, revision: snapshot.revision + 1,
        status: snapshot.status === 'CURRENT' ? 'STALE' : 'UNKNOWN', reason });
}

export function beginConfiguredRowVerification(identityKey: string | null): ConfiguredRowVerification {
    const verification = Object.freeze({ revision: snapshot.revision + 1 });
    activeVerification = identityKey ? verification : null;
    expectedAuthority = null;
    publish({ status: identityKey ? 'VERIFYING' : 'UNKNOWN', authority: null, identityKey,
        revision: verification.revision, reason: identityKey ? 'verifying' : 'identity-unavailable' });
    return verification;
}

/** Observations may invalidate, never promote, including late ordinary cached status reads. */
export function observeConfiguredRowAuthority(value: unknown) {
    const observed = authorityKey(parseConfiguredPresentationAuthority(value));
    const expected = snapshot.authority || expectedAuthority;
    if (expected && observed !== expected) {
        retireConfiguredRowFreshness(observed ? 'authority-changed' : 'authority-uncertain');
    } else if (snapshot.status === 'UNKNOWN') {
        // Observability does not grant authority to this unsolicited response.
        publish({ ...snapshot, reason: 'unverified-observation' });
    }
}

function currentVerification(verification: ConfiguredRowVerification, isCurrent?: () => boolean) {
    return activeVerification === verification && snapshot.revision === verification.revision
        && !!snapshot.identityKey && (!isCurrent || isCurrent());
}

function failVerification(verification: ConfiguredRowVerification, reason: string) {
    if (activeVerification === verification) {
        activeVerification = null;
        expectedAuthority = null;
        publish({ ...snapshot, status: 'ERROR', authority: null,
            revision: snapshot.revision + 1, reason });
    }
    return null;
}

function parseBindings(value: unknown): Set<string> | null {
    if (!Array.isArray(value)) return null;
    const pairs = new Set<string>();
    const sections = new Set<string>();
    for (const entry of value) {
        const item = record(entry);
        if (!item || Object.keys(item).length !== 2 || typeof item.rule !== 'string' || !opaque.test(item.rule)
            || typeof item.section !== 'string' || !opaque.test(item.section)
            || sections.has(item.section)) return null;
        sections.add(item.section);
        pairs.add(`${item.rule}.${item.section}`);
    }
    return pairs;
}

/** Invoke only after both response inputs have resolved; readAuthority creates a fresh transport. */
export async function verifyConfiguredRowFreshness(options: {
    verification: ConfiguredRowVerification;
    settings: unknown;
    featured: unknown;
    readAuthority: () => Promise<unknown>;
    isCurrent?: () => boolean;
}): Promise<ConfiguredRowProof | null> {
    const { verification, isCurrent } = options;
    if (!currentVerification(verification, isCurrent) || consumedVerifications.has(verification)) return null;
    consumedVerifications.add(verification);
    const settings = readConfiguredPresentationAuthority(options.settings);
    const featured = readConfiguredPresentationAuthority(options.featured);
    const key = authorityKey(settings);
    if (!key || key !== authorityKey(featured)) return failVerification(verification, 'input-authority-mismatch');
    expectedAuthority = key;
    try {
        const response = record(await options.readAuthority());
        if (!currentVerification(verification, isCurrent)) return null;
        const finalAuthority = readConfiguredPresentationAuthority(response);
        const bindings = parseBindings(readExactField(response, 'configuredPresentationBindings'));
        if (!finalAuthority || authorityKey(finalAuthority) !== key || !bindings) {
            return failVerification(verification, 'final-authority-unproven');
        }
        const proof: ConfiguredRowProof = Object.freeze({ verified: true });
        proofs.set(proof, { revision: verification.revision, authority: finalAuthority, bindings });
        publish({ ...snapshot, status: 'CURRENT', authority: key, reason: 'final-read-verified' });
        return proof;
    } catch (error) {
        const status = record(error)?.status;
        return failVerification(verification, status === 401 || status === 403 ?
            'authority-rejected' : 'authority-uncertain');
    }
}

function getCurrentProof(proof: ConfiguredRowProof | null | undefined) {
    const state = proof && proofs.get(proof);
    return state && snapshot.status === 'CURRENT' && snapshot.revision === state.revision
        && snapshot.authority === authorityKey(state.authority) ? state : null;
}

export function getConfiguredRowProofAuthority(proof: ConfiguredRowProof | null | undefined): string | undefined {
    return authorityKey(getCurrentProof(proof)?.authority || null) || undefined;
}

export function isConfiguredPayloadVerified(payload: unknown, proof: ConfiguredRowProof | null | undefined) {
    const state = getCurrentProof(proof);
    return !!state && authorityKey(readConfiguredPresentationAuthority(payload))
        === authorityKey(state.authority);
}

export function isConfiguredSectionVerified(section: unknown, proof: ConfiguredRowProof | null | undefined) {
    const state = getCurrentProof(proof);
    const association = record(record(section)?.configuredRowAssociation);
    return !!state && association?.version === 1 && association.scope === state.authority.scope
        && typeof association.rule === 'string' && typeof association.section === 'string'
        && state.bindings.has(`${association.rule}.${association.section}`);
}

export function isConfiguredRowPresentationCurrent(row: unknown, identityKey?: string | null) {
    const value = record(row);
    if (!value) return false;
    const configured = value.rowType === 'configured-rule' || value.type === 'configured-rule'
        || value.sourceType === 'configured-rule' || value.renderedSource === 'row-builder'
        || !!value.sourceRuleId || !!value.ruleId
        || Object.keys(value).some(key => /configured.*(?:association|authority)/i.test(key) && value[key] != null);
    if (!configured) return true;
    return snapshot.status === 'CURRENT' && !!snapshot.identityKey
        && (identityKey === undefined || identityKey === snapshot.identityKey)
        && value.configuredPresentationAuthority === snapshot.authority;
}
