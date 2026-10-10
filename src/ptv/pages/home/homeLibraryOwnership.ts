import { matchesHomeTopologyClaim, matchesHomeUserAccessClaim, parseCurrentHomeTopology,
    parseCurrentHomeUserAccess, type CurrentHomeTopology } from './homeLibraryTransitionFreshness';
import { getVerifiedHomeTransitionBinding, isConfiguredPayloadVerified, type ConfiguredRowProof } from './configuredRowFreshness';
import { normalizePtvRowLibraryScope } from '../../modules/dashboard/rowBuilderImport';
import type { ConfiguredRowAssociationResult } from './configuredRowAssociation';

type HomeStructuralType = 'Movie' | 'MusicAlbum' | 'Series';
type HomeCollectionType = 'movies' | 'music' | 'tvshows';

export type HomeLibraryOwnershipClaim =
    | Readonly<{ kind: 'global'; ruleId: string; sectionId: string }>
    | Readonly<{
        kind: 'library';
        libraryId: string;
        ruleId: string;
        sectionId: string;
        structuralTypes: readonly HomeStructuralType[];
        expectedCollectionType: HomeCollectionType;
    }>
    | Readonly<{ kind: 'rejected'; reason: string }>;

type ClaimInput = Readonly<{
    rule: unknown;
    section: unknown;
    sectionId: string;
    payload: unknown;
    association: ConfiguredRowAssociationResult;
    expectedRowConfigHash: string;
    featuredCacheVersion: number;
    currentHomeTopology: unknown;
    currentHomeUserAccess: unknown;
    currentHomeUserId: string;
    configuredProof?: ConfiguredRowProof | null;
}>;

const LIBRARY_ID = /^[0-9a-f]{32}$/;
const validLibraryId = (value: unknown): value is string =>
    typeof value === 'string' && LIBRARY_ID.test(value) && value !== '0'.repeat(32);
const record = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const reject = (reason: string): HomeLibraryOwnershipClaim => ({ kind: 'rejected', reason });

function isAuthorizedOwnedProjection(section: Record<string, unknown>) {
    return section.source === 'authorized' && section.scopeType === 'library'
        && section.rowType === 'configured-rule';
}

function matchesCurrentAssociation(ruleId: string, section: Record<string, unknown>, input: ClaimInput) {
    const marker = record(section.configuredRowAssociation);
    const redacted = isAuthorizedOwnedProjection(section);
    return section.id === input.sectionId
        && (section.sourceRuleId === ruleId || (redacted && section.sourceRuleId == null))
        && (section.ruleId == null || section.ruleId === ruleId)
        && input.association.kind === 'matched'
        && input.association.ruleId === ruleId
        && marker?.section === input.association.section;
}

function matchesCurrentConfig(section: Record<string, unknown>, payload: Record<string, unknown>, hash: string) {
    return Boolean(hash) && payload.rowConfigHash === hash && payload.rowConfigVersion === 3
        && (section.rowConfigHash === hash
            || (isAuthorizedOwnedProjection(section) && section.rowConfigHash == null));
}

function structuralScope(mediaType: unknown): {
    expectedCollectionType: HomeCollectionType;
    structuralTypes: readonly HomeStructuralType[];
} | null {
    if (mediaType === 'movies') return { expectedCollectionType: 'movies', structuralTypes: [ 'Movie' ] };
    if (mediaType === 'music') return { expectedCollectionType: 'music', structuralTypes: [ 'MusicAlbum' ] };
    if (mediaType === 'shows' || mediaType === 'anime' || mediaType === 'cartoons') {
        return { expectedCollectionType: 'tvshows', structuralTypes: [ 'Series' ] };
    }
    return null;
}

/** Mirrors the Plugin's schema-1 hash; a rename cannot change this binding. */
export function computeHomeResolvedScopeHash(rule: unknown, status: 'resolved' | 'global' = 'resolved'): string {
    const value = record(rule);
    const scope = record(value?.libraryScope);
    const id = typeof value?.id === 'string' ? value.id.trim().toLowerCase() : '';
    const canonical = [ '1', id, scope?.mode || 'invalid', scope?.defaultKey || '',
        scope?.virtualFolderId || '', status ].join('|');
    let hash = 5381;
    for (let index = 0; index < canonical.length; index += 1) {
        hash = (hash * 33 + canonical.charCodeAt(index)) % 2147483647;
    }
    return String(hash);
}

function resolveOwnedBinding(
    scope: ReturnType<typeof normalizePtvRowLibraryScope>,
    section: Record<string, unknown>,
    payload: Record<string, unknown>,
    input: ClaimInput,
    topology: CurrentHomeTopology | null
) {
    if (scope.mode !== 'defaultLibrary' && scope.mode !== 'virtualFolder') return null;
    const libraryId = section.libraryId;
    const savedId = scope.virtualFolderId;
    if (!validLibraryId(libraryId) || savedId && !validLibraryId(savedId)
        || scope.mode === 'virtualFolder' && !savedId) return null;
    const rebound = getVerifiedHomeTransitionBinding(section, input.configuredProof);
    const attestationApplies = rebound?.explicitRebind === true
        || rebound?.explicitRebind === false && scope.mode === 'defaultLibrary' && !savedId;
    const reboundMatches = Boolean(attestationApplies && rebound
        && isConfiguredPayloadVerified(payload, input.configuredProof)
        && rebound.libraryId === libraryId && rebound.topologyEpoch === topology?.epoch
        && rebound.topologyEpoch === section.topologyEpoch
        && rebound.bindingGeneration === section.bindingGeneration);
    if (!reboundMatches && (rebound || savedId !== libraryId)) return null;
    return { libraryId, effectiveScope: savedId === libraryId ? scope : { ...scope, virtualFolderId: libraryId } };
}

/** Claims are matched against the current rule and server-issued section association. */
export function resolveHomeLibraryOwnershipClaim(input: ClaimInput): HomeLibraryOwnershipClaim {
    const rule = record(input.rule);
    const section = record(input.section);
    const payload = record(input.payload);
    if (!rule || !section || !payload || typeof rule.id !== 'string' || !rule.id.trim()
        || rule.enabled === false || !input.sectionId || !matchesCurrentAssociation(rule.id, section, input)) {
        return reject('home-poisoned-payload-rejected');
    }

    const hash = input.expectedRowConfigHash;
    if (!matchesCurrentConfig(section, payload, hash)) return reject('home-poisoned-payload-rejected');

    const scope = normalizePtvRowLibraryScope(rule, 3);
    if (scope.mode === 'invalid') return reject('home-scope-unresolved');
    if (scope.mode === 'global') {
        if (rule.sourceType === 'library' || section.scopeType !== 'global'
            || section.resolvedScopeHash !== computeHomeResolvedScopeHash({ ...rule, libraryScope: scope }, 'global')
            || section.libraryId != null) return reject('home-poisoned-payload-rejected');
        return { kind: 'global', ruleId: rule.id, sectionId: input.sectionId };
    }

    if (input.featuredCacheVersion !== 9 || payload.scopeSchemaVersion !== 2) {
        return reject('home-legacy-scoped-rejected');
    }
    const topology = parseCurrentHomeTopology({ currentHomeTopology: input.currentHomeTopology });
    if (!matchesHomeTopologyClaim(section, topology)) {
        return reject('home-topology-unproven');
    }
    const access = parseCurrentHomeUserAccess({ currentHomeUserAccess: input.currentHomeUserAccess });
    if (!matchesHomeUserAccessClaim(section, access, input.currentHomeUserId)) {
        return reject('home-user-access-unproven');
    }
    const structural = structuralScope(rule.mediaType);
    const binding = resolveOwnedBinding(scope, section, payload, input, topology);
    if (!structural || !binding) return reject('home-scope-unresolved');
    const bindingMatches = scope.mode === 'defaultLibrary' ?
        section.bindingKey === scope.defaultKey :
        section.bindingKey == null;
    if (section.scopeType !== 'library' || !bindingMatches) {
        return reject('home-scope-unresolved');
    }
    if (section.resolvedScopeHash !== computeHomeResolvedScopeHash({ ...rule, libraryScope: binding.effectiveScope })) {
        return reject('home-scope-hash-mismatch');
    }

    return { kind: 'library', libraryId: binding.libraryId, ruleId: rule.id, sectionId: input.sectionId, ...structural };
}

/** Keep exact Plugin ordering; a gap remains vacant when an ID lacks proof. */
export function filterOwnedHomeRowInPluginOrder<TItem extends { Id?: string }>(
    claim: HomeLibraryOwnershipClaim,
    items: readonly TItem[],
    provenIds: ReadonlySet<string>
): TItem[] {
    if (claim.kind === 'rejected') return [];
    if (claim.kind === 'global') return [ ...items ];
    return items.filter(item => typeof item.Id === 'string' && provenIds.has(item.Id.toLowerCase()));
}
