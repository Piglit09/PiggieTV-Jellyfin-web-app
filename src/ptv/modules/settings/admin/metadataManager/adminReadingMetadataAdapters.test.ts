import { MetadataField } from '@jellyfin/sdk/lib/generated-client/models/metadata-field';
import { describe, expect, it } from 'vitest';

import {
    adminReadingProviderDisplayName,
    createAdminMetadataFormFromReadingCandidate,
    findAdminStoredReadingProviderIdentity,
    normalizeAdminReadingMetadataProviders,
    normalizeAdminReadingIdentityAssessment,
    normalizeAdminReadingMetadataSearchResponse,
    toAdminMetadataIdentifyResult
} from './adminReadingMetadataAdapters';
import pluginSearchFixture from './fixtures/plugin-reading-search.json';
import type { AdminMetadataForm } from './adminMetadataManagerModel';
import type { AdminReadingMetadataCandidate } from './adminReadingMetadataModel';

function metadataForm(overrides: Partial<AdminMetadataForm> = {}): AdminMetadataForm {
    return {
        communityRating: null,
        criticRating: null,
        customRating: '',
        endDate: '',
        genres: [ 'Existing genre' ],
        indexNumber: null,
        lockData: false,
        lockedFields: [],
        name: 'Existing title',
        officialRating: '',
        originalTitle: '',
        overview: 'Existing overview',
        parentIndexNumber: null,
        people: [],
        premiereDate: '',
        productionLocations: [],
        productionYear: 2001,
        providerIds: { ExistingProvider: 'keep-me' },
        runtimeMinutes: null,
        sortName: '',
        studios: [],
        tagline: '',
        tags: [ 'Existing tag' ],
        ...overrides
    };
}

function readingCandidate(
    overrides: Partial<AdminReadingMetadataCandidate> = {}
): AdminReadingMetadataCandidate {
    return {
        alternateTitles: [ 'Alternate title' ],
        artists: [{ name: 'Artist One', providerId: 'artist-1', role: null }],
        authors: [{ name: 'Writer One', providerId: 'writer-1', role: null }],
        bannerUrl: null,
        chapterNumber: '31',
        countryOfOrigin: 'JP',
        coverUrl: 'https://images.example/cover.jpg',
        description: 'Provider overview',
        endYear: 2024,
        externalIds: { AniList: '30013', MangaDex: 'manga-13' },
        genres: [ 'Action' ],
        isbn10: null,
        isbn13: null,
        issueNumber: '7',
        language: 'ja',
        localizedTitles: { en: 'English title', ja: '日本語タイトル' },
        mediaClass: 'manga',
        provider: 'AniList + MangaDex',
        providerId: 'merged-30013-manga-13',
        publisher: 'Publisher One',
        score: 94,
        scoreReasons: [{
            code: 'TITLE_MATCH',
            evidence: 'Exact normalized title',
            impact: 30,
            isPositive: true,
            message: 'The title is an exact match.'
        }],
        seriesTitle: 'Series title',
        sourceUrl: 'https://provider.example/title',
        startYear: 2023,
        status: 'releasing',
        tags: [ 'Manga' ],
        title: 'Matched title',
        totalChapters: 40,
        totalVolumes: 8,
        volumeNumber: '4',
        year: 2023,
        ...overrides
    };
}

function identityRecord(source: string, overrides: Record<string, unknown> = {}) {
    return {
        Source: source, HasRedactedIdentity: false, RunEvidenceKind: 'Unknown', ProviderIds: [],
        SeriesTitle: null, IssueNumber: null, VolumeOrRunLabel: null,
        IssuePublicationYear: null, IssuePublicationDate: null, ...overrides
    };
}

function completeAssessment() {
    return {
        ItemId: 'item-a', Provider: 'gcd', ProviderId: '123', SearchGeneration: 'search-1',
        ArchiveRevision: 'revision-1', AssessmentDigest: 'digest-1', RevisionChanged: false,
        Sources: {
            ArchiveState: 'inspected', ArchiveReasonCode: null,
            FileName: identityRecord('FileName'), ImmediateFolder: identityRecord('ImmediateFolder'),
            ComicInfo: identityRecord('ComicInfo', { SeriesTitle: 'Embedded series' }),
            CurrentItem: identityRecord('CurrentItem')
        },
        Candidate: identityRecord('Provider', { SeriesTitle: 'Provider series' }), Findings: [],
        RequiresConflictAcknowledgment: false, RequiresUnverifiedAcknowledgment: false
    };
}

describe('Reading metadata response adapters', () => {
    it('preserves a signed context through the Plugin 16 KiB token limit without truncation', () => {
        const accepted = 'a'.repeat(16 * 1024);
        const rejected = `${accepted}a`;
        const normalize = (context: string) => normalizeAdminReadingMetadataSearchResponse({
            Candidates: [{ Provider: 'gcd', ProviderId: '123', Title: 'Fixture', AssessmentContext: context }]
        }).candidates[0].assessmentContext;
        expect(normalize(accepted)).toBe(accepted);
        expect(normalize(rejected)).toBeNull();
        expect(normalize('signed-context')).toBe('signed-context');
    });

    it.each([
        ['primitive candidate', { Candidate: 'provider' }],
        ['missing findings', { Findings: undefined }],
        ['missing sources', { Sources: undefined }],
        ['missing revision change flag', { RevisionChanged: undefined }]
    ])('rejects incomplete reassessment: %s', (_label, override) => {
        const complete = { ...completeAssessment(), ...override };
        expect(() => normalizeAdminReadingIdentityAssessment(complete)).toThrow('invalid response');
    });

    it.each([ 'SeriesTitle', 'IssueNumber', 'VolumeOrRunLabel', 'IssuePublicationYear', 'IssuePublicationDate' ])(
        'rejects omitted ComicInfo %s rather than erasing displayed evidence', field => {
            const complete = completeAssessment();
            const comicInfo = { ...complete.Sources.ComicInfo, [field]: undefined };
            expect(() => normalizeAdminReadingIdentityAssessment({
                ...complete, Sources: { ...complete.Sources, ComicInfo: comicInfo }
            })).toThrow('invalid response');
        }
    );

    it('rejects an omitted provider title', () => {
        const complete = completeAssessment();
        expect(() => normalizeAdminReadingIdentityAssessment({
            ...complete, Candidate: { ...complete.Candidate, SeriesTitle: undefined }
        })).toThrow('invalid response');
    });

    it('rejects an unverified archive without a reason', () => {
        const complete = completeAssessment();
        expect(() => normalizeAdminReadingIdentityAssessment({
            ...complete, Sources: { ...complete.Sources, ArchiveState: 'unverified', ArchiveReasonCode: undefined }
        })).toThrow('invalid response');
    });

    it('preserves source-labeled Reading identity, unknown GCD run evidence, and bounded findings', () => {
        const response = normalizeAdminReadingMetadataSearchResponse({
            SearchGeneration: 'search-1',
            IdentitySources: {
                ArchiveState: 'inspected', ArchiveReasonCode: null,
                FileName: { Source: 'FileName', SeriesTitle: 'Fixture', IssueNumber: '9', RunEvidenceKind: 'Unknown' },
                ImmediateFolder: { Source: 'ImmediateFolder', VolumeOrRunLabel: '2019', RunEvidenceKind: 'ExplicitRun' },
                ComicInfo: { Source: 'ComicInfo', VolumeOrRunLabel: '2018', IssuePublicationYear: 2019, RunEvidenceKind: 'ExplicitRun' }
            },
            Query: {
                Year: 2019, SeriesStartYear: 2018, IssuePublicationYear: 2019,
                SeriesStartYearEvidence: 'local-metadata', IssuePublicationEvidence: 'local-metadata',
                IdentityConflicts: [{ Field: 'run', PreferredSource: 'local-metadata', PreferredValue: '2018', ConflictingSource: 'folder', ConflictingValue: '2019' }]
            },
            Candidates: [{
                Provider: 'gcd', ProviderId: '123', Title: 'Fixture #9', Year: 2019, StartYear: 2018,
                RunEvidenceKind: 'Unknown', SeriesStartYearEvidence: 'unknown',
                IssuePublicationYear: 2019, IssuePublicationEvidence: 'provider',
                AssessmentContext: 'signed-context', ArchiveRevision: 'opaque-revision', AssessmentDigest: 'digest-1',
                IdentityAssessment: {
                    ItemId: 'item-a', Provider: 'gcd', ProviderId: '123', SearchGeneration: 'search-1',
                    ArchiveRevision: 'opaque-revision', AssessmentDigest: 'digest-1',
                    Sources: { ArchiveState: 'inspected', ArchiveReasonCode: null, FileName: identityRecord('FileName'),
                        ImmediateFolder: identityRecord('ImmediateFolder'),
                        ComicInfo: identityRecord('ComicInfo', { VolumeOrRunLabel: '2018' }),
                        CurrentItem: identityRecord('CurrentItem') },
                    Candidate: identityRecord('Provider', { IssuePublicationYear: 2019 }),
                    RevisionChanged: false,
                    Findings: [{ Code: 'RUN_CONFLICT', Field: 'run', LeftSource: 'ComicInfo', LeftValue: '2018', RightSource: 'ImmediateFolder', RightValue: '2019', IsConflict: true, IsMaterialUncertainty: false }],
                    RequiresConflictAcknowledgment: true, RequiresUnverifiedAcknowledgment: true
                }
            }]
        });
        expect(response.searchGeneration).toBe('search-1');
        expect(response.identitySources?.comicInfo).toMatchObject({ source: 'ComicInfo', volumeOrRunLabel: '2018', issuePublicationYear: 2019 });
        expect(response.query.identityConflicts?.[0]).toMatchObject({ preferredSource: 'local-metadata', conflictingSource: 'folder' });
        expect(response.candidates[0]).toMatchObject({
            assessmentContext: 'signed-context', archiveRevision: 'opaque-revision', assessmentDigest: 'digest-1',
            runEvidenceKind: 'Unknown', issuePublicationYear: 2019, issuePublicationEvidence: 'provider',
            identityAssessment: { requiresConflictAcknowledgment: true, requiresUnverifiedAcknowledgment: true,
                findings: [{ leftSource: 'ComicInfo', rightSource: 'ImmediateFolder', isConflict: true }] }
        });
        const oldPlugin = normalizeAdminReadingMetadataSearchResponse({ Candidates: [{ Provider: 'gcd', ProviderId: '123', Title: 'Fixture', Year: 2019, StartYear: 2018 }] });
        expect(oldPlugin.candidates[0]).toMatchObject({ assessmentContext: null, issuePublicationYear: null, runEvidenceKind: 'Unknown' });
    });

    it('keeps typed archive-unverified reassessment and removes unsafe display values', () => {
        const assessment = normalizeAdminReadingIdentityAssessment({
            ItemId: 'item-a', Provider: 'gcd', ProviderId: '123', SearchGeneration: 'search-1',
            ArchiveRevision: 'revision-2', RevisionChanged: true, AssessmentDigest: 'digest-2',
            Sources: { ArchiveState: 'unverified', ArchiveReasonCode: 'HELPER_UNAVAILABLE',
                FileName: identityRecord('FileName'), ImmediateFolder: identityRecord('ImmediateFolder'),
                ComicInfo: identityRecord('ComicInfo', { HasRedactedIdentity: true, SeriesTitle: 'C:\\private\\book.cbz' }),
                CurrentItem: identityRecord('CurrentItem') },
            Candidate: identityRecord('Provider', { IssuePublicationYear: 2019 }),
            Findings: [{ Code: 'IDENTITY_TEXT_REDACTED', Field: 'series', LeftSource: 'ComicInfo', LeftValue: 'https://private.example/book?token=secret', RightSource: 'Provider', RightValue: 'Safe'.repeat(200), IsConflict: false, IsMaterialUncertainty: true }],
            RequiresConflictAcknowledgment: false, RequiresUnverifiedAcknowledgment: true
        });
        expect(assessment.sources.archiveReasonCode).toBe('HELPER_UNAVAILABLE');
        expect(assessment.sources.comicInfo).toMatchObject({ hasRedactedIdentity: true, seriesTitle: null });
        expect(assessment.findings[0]).toMatchObject({ code: 'IDENTITY_TEXT_REDACTED', leftValue: null, isMaterialUncertainty: true });
        expect(assessment.findings[0].rightValue?.length).toBeLessThanOrEqual(256);
    });
    it('normalizes production PascalCase DTOs without rewriting provider or locale map keys', () => {
        const providers = normalizeAdminReadingMetadataProviders({
            Providers: [{
                DisplayName: 'AniList',
                Message: null,
                Provider: 'anilist',
                RetryAfterSeconds: null,
                State: 'available'
            }]
        });
        const response = normalizeAdminReadingMetadataSearchResponse({
            Candidates: [{
                AlternateTitles: [ 'Alternate title' ],
                Artists: [{ Name: 'Artist One', ProviderId: 'artist-1', Role: 'Artist' }],
                Authors: [{ Name: 'Writer One', ProviderId: 'writer-1', Role: 'Writer' }],
                ChapterNumber: '31',
                ExternalIds: { AniList: '30013', MangaDex: 'manga-13' },
                IssueNumber: '7',
                LocalizedTitles: { en: 'English title', 'x-romaji': 'Romaji title' },
                MediaClass: 'manga',
                Provider: 'anilist',
                ProviderId: '30013',
                Score: 91,
                ScoreReasons: [{
                    Code: 'TITLE_MATCH',
                    Evidence: 'Exact title',
                    Impact: 30,
                    Message: 'The title agrees.'
                }],
                Title: 'Matched title',
                VolumeNumber: '4',
                Year: 2023
            }],
            LocalMetadata: {
                Sources: [ 'ComicInfo.xml' ],
                State: 'inspected',
                Warnings: []
            },
            ProviderResults: [{
                CacheHit: true,
                Candidates: [],
                DurationMilliseconds: 42,
                Failure: {
                    Code: 'PROVIDER_TIMEOUT',
                    Kind: 'timeout',
                    Message: 'Timed out.',
                    Provider: 'mangadex',
                    RetryAfterSeconds: 10
                },
                Provider: 'mangadex',
                State: 'unreachable'
            }],
            Query: {
                Classification: {
                    Confidence: 0.9,
                    MediaClass: 'manga',
                    Reasons: [ 'Manga context.' ]
                },
                ExistingProviderIds: { AniList: '30013' },
                MediaClass: 'manga',
                ProviderId: { Id: '30013', Provider: 'anilist' },
                RawTitle: 'Matched title'
            }
        });

        expect(providers.providers).toEqual([ expect.objectContaining({
            displayName: 'AniList',
            provider: 'anilist',
            state: 'available'
        }) ]);
        expect(response.candidates[0]).toMatchObject({
            artists: [{ name: 'Artist One', providerId: 'artist-1', role: 'Artist' }],
            authors: [{ name: 'Writer One', providerId: 'writer-1', role: 'Writer' }],
            externalIds: { AniList: '30013', MangaDex: 'manga-13' },
            localizedTitles: { en: 'English title', 'x-romaji': 'Romaji title' },
            provider: 'anilist',
            providerId: '30013',
            scoreReasons: [ expect.objectContaining({ code: 'TITLE_MATCH', impact: 30 }) ]
        });
        expect(response.localMetadata).toEqual({
            sources: [ 'ComicInfo.xml' ],
            state: 'inspected',
            warnings: []
        });
        expect(response.providerResults[0]).toMatchObject({
            cacheHit: true,
            failure: { kind: 'timeout', provider: 'mangadex', retryAfterSeconds: 10 },
            provider: 'mangadex',
            state: 'unreachable'
        });
        expect(response.query).toMatchObject({
            existingProviderIds: { AniList: '30013' },
            mediaClass: 'manga',
            providerId: { id: '30013', provider: 'anilist' },
            rawTitle: 'Matched title'
        });
    });

    it('normalizes untrusted boundaries while keeping issue, volume and chapter distinct', () => {
        const unsafeSourceUrl = `${[ 'java', 'script' ].join('')}:alert(1)`;
        const response = normalizeAdminReadingMetadataSearchResponse({
            candidates: [{
                ...readingCandidate(),
                bannerUrl: 'https://user:secret@images.example/banner.jpg',
                chapterNumber: '31',
                coverUrl: 'https://images.example/cover.jpg?api_key=private',
                description: '<script>hidden()</script><p><em>Safe provider prose.</em></p>',
                issueNumber: '7',
                score: 140,
                sourceUrl: unsafeSourceUrl,
                volumeNumber: '4'
            }],
            providerResults: [{
                cacheHit: false,
                candidates: [],
                durationMilliseconds: 83,
                failure: {
                    code: 'FUTURE_PROVIDER_FAILURE',
                    kind: 'new-failure-kind',
                    message: 'Provider returned a bounded failure.',
                    provider: 'MangaDex',
                    retryAfterSeconds: 12
                },
                provider: 'MangaDex',
                state: 'future-state'
            }],
            query: {
                alternateTitles: [],
                author: 'Writer One',
                chapterNumber: '31',
                classification: {
                    confidence: 2,
                    mediaClass: 'manga',
                    reasons: [ 'Manga filename pattern' ]
                },
                cleanedTitle: 'Matched title',
                editionKind: 'standard',
                existingProviderIds: { AniList: '30013' },
                ignoredFilenameTokens: [ '1080p' ],
                isbn: null,
                issueNumber: '7',
                mediaClass: 'manga',
                originalLanguage: 'ja',
                providerId: { id: '30013', provider: 'AniList' },
                rawFileName: 'Matched.Title.v04.c031.issue007.cbz',
                rawTitle: 'Matched Title',
                seriesTitle: 'Series title',
                volumeNumber: '4',
                year: 2023
            }
        });

        expect(response.query).toMatchObject({
            chapterNumber: '31',
            issueNumber: '7',
            volumeNumber: '4'
        });
        expect(response.query.classification.confidence).toBe(1);
        expect(response.candidates[0]).toMatchObject({
            chapterNumber: '31',
            description: 'Safe provider prose.',
            issueNumber: '7',
            score: 100,
            volumeNumber: '4'
        });
        expect(response.candidates[0].coverUrl).toBeNull();
        expect(response.candidates[0].bannerUrl).toBeNull();
        expect(response.candidates[0].sourceUrl).toBeNull();
        expect(response.providerResults[0]).toMatchObject({
            failure: { kind: 'unknown', retryAfterSeconds: 12 },
            provider: 'MangaDex',
            state: 'unknown'
        });

        const credentialBearingSource = normalizeAdminReadingMetadataSearchResponse({
            candidates: [ readingCandidate({
                sourceUrl: 'https://provider.example/title?access_token=do-not-cache'
            }) ]
        });
        expect(credentialBearingSource.candidates[0].sourceUrl).toBeNull();
    });

    it('preserves server-ranked candidates and independent partial provider failures', () => {
        const response = normalizeAdminReadingMetadataSearchResponse({
            candidates: [
                readingCandidate({ provider: 'AniList', providerId: 'best', score: 91, title: 'Best match' }),
                readingCandidate({ provider: 'MangaDex', providerId: 'second', score: 76, title: 'Second match' })
            ],
            providerResults: [{
                cacheHit: true,
                candidates: [ readingCandidate({ provider: 'AniList', providerId: 'best' }) ],
                durationMilliseconds: 14,
                failure: null,
                provider: 'AniList',
                state: 'available'
            }, {
                cacheHit: false,
                candidates: [],
                durationMilliseconds: 15_000,
                failure: {
                    code: 'PROVIDER_TIMEOUT',
                    kind: 'timeout',
                    message: 'MangaDex did not respond in time.',
                    provider: 'MangaDex',
                    retryAfterSeconds: null
                },
                provider: 'MangaDex',
                state: 'unreachable'
            }],
            query: {}
        });

        expect(response.candidates.map(candidate => candidate.providerId)).toEqual([ 'best', 'second' ]);
        expect(response.providerResults).toHaveLength(2);
        expect(response.providerResults[0]).toMatchObject({ cacheHit: true, failure: null });
        expect(response.providerResults[1]).toMatchObject({
            candidates: [],
            failure: { kind: 'timeout' },
            state: 'unreachable'
        });
        expect(toAdminMetadataIdentifyResult(response.candidates[0], 0)).toMatchObject({
            name: 'Best match',
            providerName: 'AniList',
            readingCandidate: response.candidates[0],
            source: null
        });
    });

    it('carries parsed identity into review and keeps issue, volume and original title distinct on apply', () => {
        const parsedQuery = normalizeAdminReadingMetadataSearchResponse({
            candidates: [ readingCandidate() ],
            query: {
                chapterNumber: '31',
                issueNumber: '12',
                volumeNumber: '6'
            }
        }).query;
        const match = toAdminMetadataIdentifyResult(readingCandidate(), 0, parsedQuery);
        const desired = createAdminMetadataFormFromReadingCandidate(
            metadataForm(),
            readingCandidate({ issueNumber: '7', volumeNumber: '4' }),
            [ 'originalTitle', 'indexNumber', 'parentIndexNumber' ],
            match.readingQuery
        );

        expect(match.readingQuery).toBe(parsedQuery);
        expect(desired.indexNumber).toBe(12);
        expect(desired.parentIndexNumber).toBe(6);
        expect(desired.originalTitle).toBe('日本語タイトル');
    });

    it('uses a lone volume as the item index without duplicating it into the parent index', () => {
        const desired = createAdminMetadataFormFromReadingCandidate(
            metadataForm({ parentIndexNumber: 9 }),
            readingCandidate({ chapterNumber: null, issueNumber: null, volumeNumber: '5' }),
            [ 'indexNumber', 'parentIndexNumber' ]
        );

        expect(desired.indexNumber).toBe(5);
        expect(desired.parentIndexNumber).toBe(9);
    });

    it('merges real AniList and MangaDex IDs without inventing a combined provider ID', () => {
        const candidate = readingCandidate();
        const desired = createAdminMetadataFormFromReadingCandidate(
            metadataForm(),
            candidate,
            [ 'name', 'providerIds' ]
        );

        expect(desired.providerIds).toEqual({
            AniList: '30013',
            ExistingProvider: 'keep-me',
            MangaDex: 'manga-13'
        });
        expect(desired.providerIds).not.toHaveProperty(candidate.provider);
        expect(desired.providerIds).not.toHaveProperty('AniListMangaDex');
    });

    it('preserves an immutable GCD issue identity and presents its first-party provider name', () => {
        const desired = createAdminMetadataFormFromReadingCandidate(
            metadataForm(),
            readingCandidate({
                externalIds: { GCDSeries: '152889' },
                mediaClass: 'comic',
                provider: 'gcd',
                providerId: '2177121',
                startYear: 2020,
                year: null
            }),
            [ 'productionYear', 'providerIds' ]
        );

        expect(desired.providerIds).toMatchObject({
            ExistingProvider: 'keep-me',
            GCD: '2177121',
            GCDSeries: '152889'
        });
        expect(adminReadingProviderDisplayName('gcd')).toBe('Grand Comics Database (GCD)');
        expect(desired.productionYear).toBe(2001);
    });

    it('changes only editable, unlocked fields and preserves confirmed values otherwise', () => {
        const confirmed = metadataForm({
            genres: [ 'Locked genre' ],
            lockedFields: [ MetadataField.Overview, MetadataField.Genres ],
            overview: 'Locked overview',
            people: [{ id: null, name: 'Existing person', role: '', source: null, type: 'Writer' }]
        });
        const desired = createAdminMetadataFormFromReadingCandidate(
            confirmed,
            readingCandidate(),
            [ 'overview', 'productionYear', 'indexNumber', 'genres', 'tags', 'studios', 'providerIds' ]
        );

        expect(desired.name).toBe('Existing title');
        expect(desired.overview).toBe('Locked overview');
        expect(desired.genres).toEqual([ 'Locked genre' ]);
        expect(desired.productionYear).toBe(2023);
        expect(desired.indexNumber).toBe(7);
        expect(desired.tags).toEqual([ 'Existing tag', 'Manga' ]);
        expect(desired.people).toEqual(confirmed.people);
        expect(desired.studios).toEqual([{ id: null, name: 'Publisher One', source: null }]);
        expect(desired.providerIds).toMatchObject({
            AniList: '30013',
            ExistingProvider: 'keep-me',
            MangaDex: 'manga-13'
        });
        expect(confirmed.tags).toEqual([ 'Existing tag' ]);
        expect(confirmed.studios).toEqual([]);
    });

    it('finds one exact stored identity with stable provider priority and punctuation-insensitive keys', () => {
        expect(findAdminStoredReadingProviderIdentity({
            AniList: '30013',
            'Comic Vine': '40014',
            GoogleBooks: 'book-a',
            MangaDex: 'manga-a'
        })).toEqual({ displayName: 'Comic Vine', provider: 'comic-vine', providerId: '40014' });
        expect(findAdminStoredReadingProviderIdentity({ 'Google-Books': 'book-a' }))
            .toEqual({ displayName: 'Google Books', provider: 'google-books', providerId: 'book-a' });
        expect(findAdminStoredReadingProviderIdentity({ GCD: '2177121' }))
            .toEqual({ displayName: 'Grand Comics Database (GCD)', provider: 'gcd', providerId: '2177121' });
        expect(findAdminStoredReadingProviderIdentity({ Imdb: 'tt123' })).toBeNull();
    });
});

describe('serialized Plugin producer contract', () => {
    it('accepts ranked and per-provider assessments and preserves unchanged fresh review evidence', () => {
        const search = normalizeAdminReadingMetadataSearchResponse(pluginSearchFixture.Search);
        const fresh = normalizeAdminReadingIdentityAssessment(pluginSearchFixture.Reassessment);
        expect(search.candidates).toHaveLength(1);
        expect(search.providerResults).toHaveLength(1);
        for (const candidate of [ ...search.candidates, ...search.providerResults.flatMap(result => result.candidates) ]) {
            expect(candidate.identityAssessment).toEqual(fresh);
            expect(candidate.identityAssessment?.itemId).toBe('11111111111111111111111111111111');
            expect(candidate.identityAssessment?.provider).toBe(candidate.provider);
            expect(candidate.identityAssessment?.providerId).toBe(candidate.providerId);
            expect(candidate.identityAssessment?.searchGeneration).toBe(search.searchGeneration);
            expect(candidate.identityAssessment?.archiveRevision).toBe(candidate.archiveRevision);
            expect(candidate.identityAssessment?.assessmentDigest).toBe(candidate.assessmentDigest);
        }
        expect(fresh.revisionChanged).toBe(false);
    });
});
