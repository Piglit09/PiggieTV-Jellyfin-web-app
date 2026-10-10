import type { AdminReadingIdentityAssessment, AdminReadingIdentityRecord } from './adminReadingMetadataModel';

const record = (source: AdminReadingIdentityRecord['source']): AdminReadingIdentityRecord => ({
    source, hasRedactedIdentity: false, seriesTitle: 'Synthetic Series', issueNumber: '9',
    volumeOrRunLabel: null, issuePublicationYear: null, issuePublicationDate: null,
    runEvidenceKind: 'Unknown', providerIds: []
});

export function identityAssessment(overrides: Partial<AdminReadingIdentityAssessment> = {}): AdminReadingIdentityAssessment {
    return {
        itemId: 'book-a', provider: 'ComicVine', providerId: '4000-123', searchGeneration: 'generation-a',
        archiveRevision: 'revision-a', assessmentDigest: 'digest-a', revisionChanged: false,
        candidate: record('Provider'),
        sources: { archiveState: 'absent', archiveReasonCode: null, fileName: record('FileName'),
            immediateFolder: record('ImmediateFolder'), comicInfo: record('ComicInfo'), currentItem: record('CurrentItem') },
        findings: [], requiresConflictAcknowledgment: false, requiresUnverifiedAcknowledgment: false,
        ...overrides
    };
}
