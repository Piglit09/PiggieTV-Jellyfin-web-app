import { getCurrentPtvPluginApiClient } from '../../../../core/pluginApi';
import { AdminMetadataManagerServiceError } from './adminMetadataManagerModel';
import {
    normalizeAdminReadingMetadataProviders,
    normalizeAdminReadingIdentityAssessment,
    normalizeAdminReadingMetadataSearchResponse
} from './adminReadingMetadataAdapters';
import type {
    AdminReadingApplyApproval,
    AdminReadingMetadataCandidate,
    AdminReadingIdentityAssessment,
    AdminReadingIdentityReassessRequest,
    AdminReadingMetadataSearchRequest,
    AdminReadingMetadataSearchResponse,
    AdminReadingMetadataProvidersResponse
} from './adminReadingMetadataModel';

export type AdminReadingMetadataApiClient = NonNullable<ReturnType<typeof getCurrentPtvPluginApiClient>>;

function requireClient(client?: AdminReadingMetadataApiClient | null) {
    if (!client?.searchReadingMetadata || !client.getReadingMetadataProviders) {
        const error = new Error('The PiggieTV Reading identification service is unavailable.') as AdminMetadataManagerServiceError;
        throw error;
    }
    return client;
}

export async function loadAdminReadingMetadataProviders(
    client: AdminReadingMetadataApiClient | null | undefined,
    signal?: AbortSignal
): Promise<AdminReadingMetadataProvidersResponse> {
    try {
        const response = await requireClient(client).getReadingMetadataProviders<unknown>({ signal });
        return normalizeAdminReadingMetadataProviders(response);
    } catch {
        throw new Error('Reading metadata providers are temporarily unavailable.');
    }
}

export async function searchAdminReadingMetadata(
    client: AdminReadingMetadataApiClient | null | undefined,
    request: AdminReadingMetadataSearchRequest,
    signal?: AbortSignal
): Promise<AdminReadingMetadataSearchResponse> {
    try {
        const response = await requireClient(client).searchReadingMetadata<unknown, AdminReadingMetadataSearchRequest>(
            request,
            { signal }
        );
        return normalizeAdminReadingMetadataSearchResponse(response);
    } catch {
        throw new Error('Reading identification results could not be loaded.');
    }
}

/** A failed POST remains a blocked Apply; only a valid 200 body can describe unverified archive evidence. */
export async function reassessAdminReadingIdentity(
    client: AdminReadingMetadataApiClient,
    request: AdminReadingIdentityReassessRequest,
    signal?: AbortSignal
): Promise<AdminReadingIdentityAssessment> {
    if (!client?.reassessReadingMetadata || !request.itemId || !request.candidateContext) {
        throw new Error('Reading identity reassessment is unavailable.');
    }
    try {
        const response = await client.reassessReadingMetadata<unknown, unknown>({
            ItemId: request.itemId,
            CandidateContext: request.candidateContext,
            DisplayedRevision: request.displayedRevision
        }, { signal, bypassCache: true });
        return normalizeAdminReadingIdentityAssessment(response);
    } catch {
        throw new Error('Reading identity could not be reassessed. Apply is blocked.');
    }
}

export type AdminReadingApplyGuard = Readonly<{
    approval: AdminReadingApplyApproval;
    isCurrent: () => boolean;
}>;

export class AdminReadingAssessmentChangedError extends AdminMetadataManagerServiceError {
    constructor(public readonly assessment: AdminReadingIdentityAssessment) {
        super('conflict', 'Reading identity changed. Review the updated evidence and acknowledge it again before applying.');
    }
}

/** Canonical comparison includes all displayed values, source evidence and acknowledgment requirements. */
export function adminReadingAssessmentKey(value: unknown): string {
    return JSON.stringify(value, (_key, entry: unknown) => {
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
            return Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right)));
        }
        return entry;
    });
}

export function requireAdminReadingApproval(
    candidate: AdminReadingMetadataCandidate,
    approval: AdminReadingApplyApproval | undefined,
    itemId: string,
    fresh?: AdminReadingIdentityAssessment
) {
    const reviewed = candidate.identityAssessment;
    if (!approval || !reviewed || !candidate.assessmentContext
        || approval.assessmentContext !== candidate.assessmentContext
        || approval.assessmentDigest !== candidate.assessmentDigest || approval.assessmentDigest !== reviewed.assessmentDigest
        || approval.archiveRevision !== candidate.archiveRevision || approval.archiveRevision !== reviewed.archiveRevision
        || approval.searchGeneration !== reviewed.searchGeneration || reviewed.itemId !== itemId
        || reviewed.provider !== candidate.provider || reviewed.providerId !== candidate.providerId) {
        throw new AdminMetadataManagerServiceError('conflict', 'Search again and review the current Reading match before applying.');
    }
    if (fresh) {
        if (fresh.itemId !== itemId || fresh.provider !== candidate.provider || fresh.providerId !== candidate.providerId
            || fresh.searchGeneration !== approval.searchGeneration) {
            throw new AdminMetadataManagerServiceError('conflict', 'The Reading match no longer belongs to this review. Search again.');
        }
        if (adminReadingAssessmentKey({ ...fresh, revisionChanged: false }) !== adminReadingAssessmentKey({ ...reviewed, revisionChanged: false })) {
            throw new AdminReadingAssessmentChangedError(fresh);
        }
    }
    const assessment = fresh || reviewed;
    const conflicts = assessment.findings.filter(finding => finding.isConflict).map(finding => finding.code);
    const unverified = assessment.findings.filter(finding => finding.isMaterialUncertainty).map(finding => finding.code);
    if ((assessment.requiresConflictAcknowledgment && (!conflicts.length || !conflicts.every(code => approval.acknowledgedConflictCodes.includes(code))))
        || (assessment.requiresUnverifiedAcknowledgment && (!unverified.length || !unverified.every(code => approval.acknowledgedUnverifiedCodes.includes(code))))) {
        throw new AdminMetadataManagerServiceError('conflict', 'Review and acknowledge the current Reading identity warnings before applying.');
    }
}
