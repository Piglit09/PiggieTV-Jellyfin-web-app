import { describe, expect, it, vi } from 'vitest';

import {
    loadAdminReadingMetadataProviders,
    reassessAdminReadingIdentity,
    searchAdminReadingMetadata,
    type AdminReadingMetadataApiClient
} from './adminReadingMetadataService';
import type { AdminReadingMetadataSearchRequest } from './adminReadingMetadataModel';

function client(methods: Partial<AdminReadingMetadataApiClient>): AdminReadingMetadataApiClient {
    return {
        getReadingMetadataProviders: vi.fn(),
        reassessReadingMetadata: vi.fn(),
        searchReadingMetadata: vi.fn(),
        ...methods
    } as unknown as AdminReadingMetadataApiClient;
}

function identityRecord(source: string) {
    return {
        Source: source, HasRedactedIdentity: false, RunEvidenceKind: 'Unknown', ProviderIds: [],
        SeriesTitle: null, IssueNumber: null, VolumeOrRunLabel: null,
        IssuePublicationYear: null, IssuePublicationDate: null
    };
}

describe('Reading metadata service', () => {
    it('posts a signed candidate context and returns only a valid typed reassessment', async () => {
        const reassessReadingMetadata = vi.fn().mockResolvedValue({
            ItemId: 'item-a', Provider: 'gcd', ProviderId: '123', SearchGeneration: 'search-1',
            ArchiveRevision: 'revision-1', RevisionChanged: false, AssessmentDigest: 'digest-1',
            Sources: { ArchiveState: 'unverified', ArchiveReasonCode: 'HELPER_UNAVAILABLE',
                FileName: identityRecord('FileName'), ImmediateFolder: identityRecord('ImmediateFolder'),
                ComicInfo: identityRecord('ComicInfo'), CurrentItem: identityRecord('CurrentItem') },
            Candidate: identityRecord('Provider'), Findings: [],
            RequiresConflictAcknowledgment: false, RequiresUnverifiedAcknowledgment: true
        });
        const request = { itemId: 'item-a', candidateContext: 'signed-context', displayedRevision: 'revision-1' };
        // eslint-disable-next-line compat/compat
        const signal = new AbortController().signal;
        const assessment = await reassessAdminReadingIdentity(client({ reassessReadingMetadata }), request, signal);
        expect(reassessReadingMetadata).toHaveBeenCalledWith({
            ItemId: 'item-a', CandidateContext: 'signed-context', DisplayedRevision: 'revision-1'
        }, { signal, bypassCache: true });
        expect(assessment).toMatchObject({ sources: { archiveState: 'unverified', archiveReasonCode: 'HELPER_UNAVAILABLE' }, requiresUnverifiedAcknowledgment: true });
    });

    it.each([401, 403, 503])('rejects reassessment HTTP %i without fabricating an unverified result', async status => {
        const reassessReadingMetadata = vi.fn().mockRejectedValue({ status, message: 'C:\\private\\secret.cbz' });
        await expect(reassessAdminReadingIdentity(client({ reassessReadingMetadata }), {
            itemId: 'item-a', candidateContext: 'signed-context', displayedRevision: null
        })).rejects.toThrow('Reading identity could not be reassessed. Apply is blocked.');
        expect(reassessReadingMetadata).toHaveBeenCalledOnce();
    });

    it('rejects an old Plugin without the reassessment method and an invalid 200 contract', async () => {
        await expect(reassessAdminReadingIdentity(client({ reassessReadingMetadata: undefined }), {
            itemId: 'item-a', candidateContext: 'signed-context', displayedRevision: null
        })).rejects.toThrow('Reading identity reassessment is unavailable.');
        await expect(reassessAdminReadingIdentity(client({ reassessReadingMetadata: vi.fn().mockResolvedValue({
            Sources: { ArchiveState: 'unverified', ArchiveReasonCode: 'HELPER_UNAVAILABLE' }
        }) }), { itemId: 'item-a', candidateContext: 'signed-context', displayedRevision: null })).rejects.toThrow(
            'Reading identity could not be reassessed. Apply is blocked.'
        );
    });

    it('loads and normalizes provider status through the authenticated plugin client', async () => {
        const getReadingMetadataProviders = vi.fn().mockResolvedValue({
            Providers: [{
                DisplayName: 'AniList',
                Message: null,
                Provider: 'AniList',
                RetryAfterSeconds: null,
                State: 'available'
            }, {
                DisplayName: '',
                Message: 'A future state is not trusted at the browser boundary.',
                Provider: 'Future Provider',
                RetryAfterSeconds: 30,
                State: 'future-state'
            }]
        });
        // eslint-disable-next-line compat/compat
        const signal = new AbortController().signal;

        const response = await loadAdminReadingMetadataProviders(client({
            getReadingMetadataProviders
        }), signal);

        expect(getReadingMetadataProviders).toHaveBeenCalledWith({ signal });
        expect(response.providers).toEqual([{
            displayName: 'AniList',
            message: null,
            provider: 'AniList',
            retryAfterSeconds: null,
            state: 'available'
        }, {
            displayName: 'Future Provider',
            message: 'A future state is not trusted at the browser boundary.',
            provider: 'Future Provider',
            retryAfterSeconds: 30,
            state: 'unknown'
        }]);
    });

    it('forwards every explicit search dimension and its AbortSignal exactly once', async () => {
        const searchReadingMetadata = vi.fn().mockResolvedValue({
            Candidates: [{
                MediaClass: 'manga',
                Provider: 'anilist',
                ProviderId: '30013',
                Score: 91,
                Title: 'Matched title'
            }],
            LocalMetadata: {
                Sources: [ 'ComicInfo.xml' ],
                State: 'inspected',
                Warnings: []
            },
            ProviderResults: [{
                CacheHit: false,
                Candidates: [],
                DurationMilliseconds: 125,
                Failure: null,
                Provider: 'anilist',
                State: 'available'
            }],
            Query: {
                ChapterNumber: '31',
                Classification: {
                    Confidence: 0.9,
                    MediaClass: 'manga',
                    Reasons: [ 'Manga context.' ]
                },
                IssueNumber: '7',
                MediaClass: 'manga',
                VolumeNumber: '4'
            }
        });
        const request: AdminReadingMetadataSearchRequest = {
            searchGeneration: 'deliberate-search-id',
            author: 'Writer One',
            chapterNumber: '31',
            isbn: '9780000000000',
            issueNumber: '7',
            itemId: 'item-a',
            mediaClass: 'manga',
            provider: 'AniList',
            providerId: '30013',
            seriesTitle: 'Series title',
            title: 'Matched title',
            volumeNumber: '4',
            year: 2023
        };
        // eslint-disable-next-line compat/compat
        const signal = new AbortController().signal;

        const response = await searchAdminReadingMetadata(client({ searchReadingMetadata }), request, signal);

        expect(searchReadingMetadata).toHaveBeenCalledOnce();
        expect(searchReadingMetadata).toHaveBeenCalledWith(request, { signal });
        expect(response.query).toMatchObject({
            chapterNumber: '31',
            issueNumber: '7',
            mediaClass: 'manga',
            volumeNumber: '4'
        });
        expect(response.candidates).toEqual([ expect.objectContaining({
            provider: 'anilist',
            providerId: '30013',
            score: 91,
            title: 'Matched title'
        }) ]);
        expect(response.localMetadata).toEqual({
            sources: [ 'ComicInfo.xml' ],
            state: 'inspected',
            warnings: []
        });
        expect(response.providerResults).toEqual([ expect.objectContaining({
            durationMilliseconds: 125,
            provider: 'anilist',
            state: 'available'
        }) ]);
    });

    it('normalizes missing clients and private transport failures without leaking details', async () => {
        await expect(loadAdminReadingMetadataProviders(null)).rejects.toThrow(
            'Reading metadata providers are temporarily unavailable.'
        );
        await expect(searchAdminReadingMetadata(client({
            searchReadingMetadata: vi.fn().mockRejectedValue(new Error(
                'GET /private/server/path?access_token=do-not-leak'
            ))
        }), {
            itemId: 'item-a',
            title: 'Safe title'
        })).rejects.toThrow('Reading identification results could not be loaded.');

        try {
            await searchAdminReadingMetadata(client({
                searchReadingMetadata: vi.fn().mockRejectedValue({
                    response: { data: { privateProviderPayload: true } }
                })
            }), { itemId: 'item-a' });
        } catch (error) {
            expect(String(error)).not.toMatch(/privateProviderPayload|access_token|private\/server/);
        }
    });
});
