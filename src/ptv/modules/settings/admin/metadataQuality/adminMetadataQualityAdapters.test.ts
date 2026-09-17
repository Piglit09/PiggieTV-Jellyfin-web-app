import { describe, expect, it } from 'vitest';

import {
    adminMetadataQualityAiTestMessage,
    normalizeAdminMetadataQualityAiStatus,
    normalizeAdminMetadataQualityAiTestResult,
    normalizeAdminMetadataQualityDetail,
    normalizeAdminMetadataQualityResult,
    normalizeAdminMetadataQualityResultPage,
    normalizeAdminMetadataQualitySettings,
    normalizeAdminMetadataQualitySummary
} from './adminMetadataQualityAdapters';

describe('Metadata Quality adapters', () => {
    it('normalizes the server summary without turning missing data into zero', () => {
        const summary = normalizeAdminMetadataQualitySummary({
            Counts: {
                Healthy: 92,
                Incomplete: 3,
                LikelyIncorrect: 1,
                NeedsReview: 4,
                TotalScanned: 100
            },
            LastScanAt: '2026-08-13T12:00:00Z',
            Libraries: [ { Id: 'library-a', Name: 'Movies' } ],
            RuleVersion: '2',
            Scan: {
                ItemCount: 100,
                Mode: 'changed',
                ProcessedCount: 25,
                RunId: 'run-a',
                State: 'running'
            },
            ScannerVersion: '3'
        });

        expect(summary).toMatchObject({
            counts: {
                healthy: 92,
                incomplete: 3,
                likelyIncorrect: 1,
                needsReview: 4,
                totalScanned: 100,
                unavailable: null
            },
            libraries: [ { id: 'library-a', name: 'Movies' } ],
            ruleVersion: '2',
            scan: {
                itemCount: 100,
                mode: 'changed',
                processedCount: 25,
                runId: 'run-a',
                state: 'scanning'
            },
            scannerVersion: '3'
        });
    });

    it('normalizes explainable result evidence and clamps invalid scores', () => {
        const result = normalizeAdminMetadataQualityDetail({
            AiReviewed: true,
            Candidates: [ {
                Name: 'The Thing',
                ProductionYear: 1982,
                ProviderIds: { Tmdb: '1091' },
                Score: 96,
                Source: 'TMDb'
            } ],
            CompletenessScore: 112,
            CurrentMatch: {
                Name: 'The Thing',
                ProductionYear: 2011,
                ProviderIds: { Tmdb: '60935' },
                RuntimeMinutes: 103
            },
            FileName: 'The.Thing.1982.2160p.mkv',
            FolderName: 'The Thing (1982)',
            ItemId: 'item-a',
            ItemType: 'Movie',
            MatchConfidence: -4,
            ProviderVerified: true,
            Reasons: [ {
                Code: 'YEAR_MISMATCH',
                Evidence: '1982 versus 2011',
                Severity: 'error'
            } ],
            Signals: { FilenameYear: 1982, ProviderIdConflict: true },
            Status: 'likely_wrong',
            SuggestedMatch: {
                Name: 'The Thing',
                ProductionYear: 1982,
                ProviderIds: { Tmdb: '1091' },
                RuntimeMinutes: 109
            },
            Title: 'The Thing'
        });

        expect(result).toMatchObject({
            candidates: [ { score: 96, source: 'TMDb', title: 'The Thing', year: 1982 } ],
            completenessScore: 100,
            fileName: 'The.Thing.1982.2160p.mkv',
            folderName: 'The Thing (1982)',
            itemId: 'item-a',
            matchConfidence: 0,
            providerVerified: true,
            reasons: [ {
                code: 'YEAR_MISMATCH',
                evidence: '1982 versus 2011',
                message: 'The production year conflicts with the available file or provider evidence.',
                severity: 'error'
            } ],
            signals: { FilenameYear: 1982, ProviderIdConflict: true },
            status: 'likely_wrong'
        });
    });

    it('preserves structured comic identity and bounded candidate confidence', () => {
        const result = normalizeAdminMetadataQualityDetail({
            Candidates: [ {
                Confidence: 'rejected',
                HasHardConflict: true,
                IssueNumber: 6,
                Name: '#006',
                ProviderIds: { ComicVine: '4000-6' },
                Score: 12,
                SeriesStartYear: 2026,
                SeriesTitle: 'Deadpool',
                Source: 'Comic Vine'
            } ],
            ItemId: 'deadpool-9',
            ItemType: 'Book',
            ProviderVerified: true,
            Status: 'likely_wrong',
            SuggestedMatch: {
                NormalizedIssueNumber: '009',
                IssuePublicationDate: '2020-12-16',
                IssuePublicationYear: 2020,
                MediaClass: 'comic',
                Name: '#9',
                ProviderIds: { ComicVine: '4000-77815' },
                ProviderName: 'Comic Vine',
                Publisher: 'Marvel',
                SeriesStartYear: 2019,
                SeriesTitle: 'Deadpool',
                VolumeId: '4050-120205'
            },
            Title: 'Deadpool 009 (2019) (Digital) (Zone-Empire)'
        });

        expect(result?.suggestedMatch).toMatchObject({
            issueNumber: '009',
            issuePublicationDate: '2020-12-16',
            issuePublicationYear: 2020,
            mediaClass: 'comic',
            provider: 'Comic Vine',
            publisher: 'Marvel',
            seriesStartYear: 2019,
            seriesTitle: 'Deadpool',
            volumeId: '4050-120205'
        });
        expect(result?.candidates).toEqual([ expect.objectContaining({
            confidence: 'rejected',
            hasHardConflict: true,
            issueNumber: '6',
            score: 12,
            seriesStartYear: 2026,
            seriesTitle: 'Deadpool'
        }) ]);
    });

    it('deduplicates identical reasons returned by the scanner', () => {
        const duplicateReason = {
            Code: 'DUPLICATE_PROVIDER_ID',
            Evidence: 'TMDb 1091',
            Severity: 'warning'
        };
        const result = normalizeAdminMetadataQualityResult({
            ItemId: 'item-a',
            Reasons: [ duplicateReason, duplicateReason ],
            Status: 'review',
            Title: 'The Thing'
        });

        expect(result?.reasons).toEqual([ {
            code: 'DUPLICATE_PROVIDER_ID',
            evidence: 'TMDb 1091',
            message: 'The same provider identifier appears on another unrelated item.',
            severity: 'warning'
        } ]);
    });

    it('derives dismissed and resolved presentation states from review outcomes', () => {
        expect(normalizeAdminMetadataQualityResult({
            Dismissed: true,
            ItemId: 'item-a',
            Status: 'review',
            Title: 'Dismissed title'
        })?.status).toBe('dismissed');
        expect(normalizeAdminMetadataQualityResult({
            ItemId: 'item-b',
            Resolution: { State: 'kept_current' },
            Status: 'review',
            Title: 'Resolved title'
        })?.status).toBe('resolved');
    });

    it('keeps result pages bounded and ignores malformed result identities', () => {
        expect(normalizeAdminMetadataQualityResultPage({
            Items: [
                { ItemId: 'item-a', Status: 'healthy', Title: 'Valid' },
                { ItemId: 'item/a', Status: 'review', Title: 'Unsafe separator' },
                { ItemId: 'item\u0000a', Status: 'review', Title: 'Unsafe control character' },
                { Status: 'review', Title: 'Missing identity' }
            ],
            Limit: 500,
            StartIndex: 50,
            TotalRecordCount: 151
        })).toMatchObject({
            items: [ { itemId: 'item-a', title: 'Valid' } ],
            limit: 50,
            startIndex: 50,
            totalRecordCount: 151
        });
    });

    it('normalizes all safe server settings while exposing no credential field', () => {
        const settings = normalizeAdminMetadataQualitySettings({
            AiConfigured: true,
            AiEnabled: true,
            AiMaxItemsPerRun: 25,
            AiMinimumConfidence: 35,
            AiModel: 'test-model',
            AiThreshold: 70,
            Enabled: true,
            LikelyWrongThreshold: 50,
            ProviderMaximumRequestsPerRun: 250,
            ProviderVerificationEnabled: true,
            ProviderVerificationThreshold: 85,
            ReviewThreshold: 70,
            Revision: 4,
            ScheduledIncrementalScan: true,
            SelectedLibraryIds: [ 'library-a' ],
            OpenAiApiKey: 'must-not-be-normalized'
        });

        expect(settings).toEqual({
            aiEnabled: true,
            aiMaxItemsPerRun: 25,
            aiMinimumConfidence: 35,
            aiModel: 'test-model',
            aiThreshold: 70,
            enabled: true,
            likelyWrongThreshold: 50,
            providerMaximumRequestsPerRun: 250,
            providerVerificationEnabled: true,
            providerVerificationThreshold: 85,
            reviewThreshold: 70,
            revision: 4,
            scheduledIncrementalScan: true,
            selectedLibraryIds: [ 'library-a' ]
        });
        expect(JSON.stringify(settings)).not.toContain('must-not-be-normalized');
    });

    it('normalizes nested and legacy flat AI status without retaining credential material', () => {
        const nested = normalizeAdminMetadataQualityAiStatus({
            Ai: {
                ConfiguredModel: 'test-model',
                CredentialConfigured: true,
                CredentialSource: 'environment',
                EffectiveModel: 'environment-test-model',
                LastTestAt: '2026-08-13T12:00:00Z',
                LastTestModel: 'environment-test-model',
                LastTestStatus: 'success',
                ModelSource: 'environment',
                OpenAiApiKey: 'test-openai-key'
            }
        });
        const flat = normalizeAdminMetadataQualityAiStatus({
            AiConfigured: true,
            AiCredentialSource: 'environment',
            AiEnabled: true,
            AiModel: 'flat-test-model',
            AiModelSource: 'settings'
        });
        const failed = normalizeAdminMetadataQualityAiStatus({
            Ai: {
                CredentialConfigured: true,
                CredentialSource: 'environment',
                EffectiveModel: 'test-model',
                LastTestErrorCode: 'invalid-model',
                LastTestStatus: 'failure',
                ModelSource: 'invalid'
            }
        });

        expect(nested).toMatchObject({
            configuredModel: 'test-model',
            credentialConfigured: true,
            credentialSource: 'environment',
            effectiveModel: 'environment-test-model',
            lastTestStatus: 'success',
            modelSource: 'environment'
        });
        expect(flat).toMatchObject({
            credentialConfigured: true,
            credentialSource: 'environment',
            effectiveModel: 'flat-test-model',
            enabled: true,
            modelSource: 'settings'
        });
        expect(failed).toMatchObject({
            lastTestErrorCode: 'invalid-model',
            lastTestStatus: 'invalid-model',
            modelSource: 'invalid'
        });
        expect(JSON.stringify(nested)).not.toContain('test-openai-key');
    });

    it.each([
        [ 'success', true, 'OpenAI connection succeeded.' ],
        [ 'missing-credential', false, 'No OpenAI API credential is configured.' ],
        [ 'invalid-credential', false, 'OpenAI authentication failed. Check the configured API key.' ],
        [ 'invalid-model', false, 'The configured OpenAI model ID is invalid.' ],
        [ 'permission-denied', false, 'The OpenAI API key does not have permission to use this request.' ],
        [ 'model-unavailable', false, 'Configured OpenAI model is unavailable.' ],
        [ 'quota-unavailable', false, 'OpenAI API quota is unavailable for this project.' ],
        [ 'rate-limited', false, 'OpenAI rate limit reached.' ],
        [ 'timeout', false, 'The OpenAI connection test timed out.' ],
        [ 'api-unavailable', false, 'The OpenAI API is currently unavailable.' ],
        [ 'malformed-response', false, 'OpenAI returned an unexpected response.' ],
        [ 'response-too-large', false, 'The OpenAI response exceeded the safe size limit.' ],
        [ 'refused', false, 'OpenAI declined the synthetic connection-test request.' ],
        [ 'test-in-progress', false, 'Another OpenAI connection test is already running.' ],
        [ 'unknown-failure', false, 'The OpenAI connection test could not be completed.' ]
    ])('normalizes the %s connection-test state to fixed safe copy', (status, success, message) => {
        const normalizedStatus = status as Parameters<typeof adminMetadataQualityAiTestMessage>[0];
        expect(normalizeAdminMetadataQualityAiTestResult({
            Message: 'raw provider detail must not render',
            Model: 'test-model',
            Status: normalizedStatus,
            Success: success,
            TestedAt: '2026-08-13T12:00:00Z'
        })).toEqual({
            message,
            model: 'test-model',
            status: normalizedStatus,
            success,
            testedAt: '2026-08-13T12:00:00Z'
        });
        expect(adminMetadataQualityAiTestMessage(normalizedStatus)).toBe(message);
    });
});
