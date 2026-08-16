using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Audio;
using MediaBrowser.Controller.Entities.Movies;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvMetadataQualityServiceTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "ptv-metadata-quality-service-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task IncrementalScanPersistsLibraryIdentityProgressAndSkipsUnchangedItem()
    {
        var libraryId = Guid.NewGuid();
        var item = Movie("Arrival", "C:\\Media\\Movies\\Arrival (2016)\\Arrival.2016.mkv", 2016, "329865");
        var provider = new RecordingProviderVerifier();
        var service = CreateService(libraryId, "Movies", [item], provider);
        var firstProgress = new RecordingProgress();

        await service.RunScheduledScanAsync(firstProgress, CancellationToken.None);
        await service.RunScheduledScanAsync(new RecordingProgress(), CancellationToken.None);

        var detail = await service.GetResultAsync(item.Id);
        var summary = await service.GetSummaryAsync();
        var store = CreateStore();
        var latest = (await store.ReadAsync()).ScanRuns.OrderByDescending(run => run.StartedAt).First();
        Assert.NotNull(detail);
        Assert.Equal("Movies", detail.LibraryName);
        Assert.Equal(1, summary.Scan.ItemCount);
        Assert.Equal(1, summary.Scan.ProcessedCount);
        Assert.Equal(1, latest.ItemsSkipped);
        Assert.Equal(0, provider.Calls);
        Assert.Equal(100, firstProgress.Values.Last());
    }

    [Fact]
    public void ScannerVersionThreeDoesNotReuseVersionTwoFingerprints()
    {
        var item = new PtvMetadataQualityAnalysisItem
        {
            ItemId = Guid.NewGuid(),
            ItemType = "Book",
            Name = "Deadpool 009 (2019) (Digital) (Zone-Empire)",
            FileName = "Deadpool 009 (2019) (Digital) (Zone-Empire).cbr",
            FolderName = "Deadpool 2019",
            SeriesTitle = "Deadpool",
            SeriesTitleEvidence = PtvReadingIdentityEvidenceSource.FileName,
            NormalizedIssueNumber = "9",
            IssueNumberEvidence = PtvReadingIdentityEvidenceSource.FileName,
            SeriesStartYear = 2019,
            SeriesStartYearEvidence = PtvReadingIdentityEvidenceSource.FileName,
            ReadingMediaClass = PtvReadingMediaClass.Comic
        };

        var versionTwoFingerprint = PtvMetadataQualityFingerprint.Create(item, "2", "2");
        var currentFingerprint = PtvMetadataQualityFingerprint.Create(item);

        Assert.Equal("3", PtvMetadataQualityConstants.ScannerVersion);
        Assert.Equal("3", PtvMetadataQualityConstants.RuleVersion);
        Assert.NotEqual(versionTwoFingerprint, currentFingerprint);
    }

    [Fact]
    public async Task ProviderCacheHitIsCountedAndRemakeCandidateUsesPathEvidence()
    {
        var libraryId = Guid.NewGuid();
        var item = Movie("The Thing", "C:\\Movies\\The Thing (1982)\\The.Thing.1982.2160p.mkv", 2011, "60935");
        var provider = new RecordingProviderVerifier
        {
            Result = new PtvMetadataProviderVerificationResult
            {
                Available = true,
                Attempted = false,
                CacheHit = true,
                Candidates =
                [
                    new PtvMetadataMatchSummary
                    {
                        Name = "The Thing",
                        ProductionYear = 1982,
                        ProviderName = "TMDb",
                        Type = "Movie",
                        ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { ["Tmdb"] = "1091" }
                    },
                    new PtvMetadataMatchSummary
                    {
                        Name = "The Thing",
                        ProductionYear = 2011,
                        ProviderName = "TMDb",
                        Type = "Movie",
                        ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { ["Tmdb"] = "60935" }
                    }
                ]
            }
        };
        var service = CreateService(libraryId, "Movies", [item], provider);

        await service.RunScheduledScanAsync(new RecordingProgress(), CancellationToken.None);

        var detail = Assert.IsType<PtvMetadataQualityResult>(await service.GetResultAsync(item.Id));
        var latest = (await CreateStore().ReadAsync()).ScanRuns.OrderByDescending(run => run.StartedAt).First();
        Assert.Equal(1, provider.Calls);
        Assert.Equal("the thing", provider.LastRequest?.EvidenceName);
        Assert.Equal(1982, provider.LastRequest?.EvidenceYear);
        Assert.NotEmpty(detail.Candidates);
        Assert.NotNull(detail.SuggestedMatch);
        Assert.Equal(1982, detail.SuggestedMatch?.ProductionYear);
        Assert.Equal(PtvMetadataQualityStatuses.LikelyWrong, detail.Status);
        Assert.Contains(detail.Reasons, reason => reason.Code == PtvMetadataQualityReasonCodes.ProviderIdConflict);
        Assert.Equal(1, latest.ProviderCacheHits);
    }

    [Fact]
    public async Task DuplicateProviderIdReclassifiesTheSecondItemForReview()
    {
        var libraryId = Guid.NewGuid();
        var first = Movie("Alien", "C:\\Movies\\Alien (1979)\\Alien.1979.mkv", 1979, "348");
        var second = Movie("Aliens", "C:\\Movies\\Aliens (1986)\\Aliens.1986.mkv", 1986, "348");
        var service = CreateService(libraryId, "Movies", [first, second], new RecordingProviderVerifier());

        await service.RunScheduledScanAsync(new RecordingProgress(), CancellationToken.None);

        var results = new[] { await service.GetResultAsync(first.Id), await service.GetResultAsync(second.Id) };
        var duplicate = Assert.Single(results, result => result!.Reasons.Any(reason => reason.Code == PtvMetadataQualityReasonCodes.DuplicateProviderId));
        Assert.Equal(PtvMetadataQualityStatuses.Review, duplicate!.Status);
        Assert.Equal(69, duplicate.MatchConfidence);
        var summary = await service.GetSummaryAsync();
        Assert.Equal(2, summary.Scan.ItemCount);
        Assert.Equal(2, summary.Scan.ProcessedCount);
    }

    [Fact]
    public async Task ListResponseIsBoundedAndFullEvidenceIsDetailOnly()
    {
        var itemId = Guid.NewGuid();
        var store = CreateStore();
        await store.WriteAsync(new PtvMetadataQualityDocument
        {
            ItemResults = new Dictionary<string, PtvMetadataQualityResult>(StringComparer.OrdinalIgnoreCase)
            {
                [itemId.ToString("N")] = new()
                {
                    ItemId = itemId,
                    Title = "Item",
                    Status = PtvMetadataQualityStatuses.Review,
                    ScanFingerprint = "fingerprint",
                    Signals = new PtvMetadataQualitySignals { CandidateCount = 5 },
                    Candidates = Enumerable.Range(0, 5).Select(index => new PtvMetadataQualityCandidate { Name = $"Candidate {index}" }).ToList(),
                    Reasons = Enumerable.Range(0, 5).Select(index => new PtvMetadataQualityReason { Code = $"REASON_{index}", Message = $"Reason {index}" }).ToList()
                }
            }
        });
        var service = CreateService(Guid.NewGuid(), "Movies", [], new RecordingProviderVerifier());

        var page = await service.GetResultsAsync(new PtvMetadataQualityResultQuery { Limit = 500 });
        var detail = await service.GetResultAsync(itemId);

        Assert.Equal(PtvMetadataQualityConstants.MaximumPageSize, page.Limit);
        Assert.Equal(3, Assert.Single(page.Items).Reasons.Count);
        Assert.Equal(5, detail!.Reasons.Count);
        Assert.Equal(5, detail.Candidates.Count);
        Assert.DoesNotContain(typeof(PtvMetadataQualityResultSummary).GetProperties(), property => property.Name == nameof(PtvMetadataQualityResult.Signals) || property.Name == nameof(PtvMetadataQualityResult.Candidates));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(17)]
    [InlineData(50)]
    [InlineData(51)]
    [InlineData(2000)]
    public async Task ResultPageLimitBoundsRowsWithoutBoundingTheCandidateSet(int resultCount)
    {
        var results = Enumerable.Range(0, resultCount)
            .Select(index => new PtvMetadataQualityResult
            {
                ItemId = Guid.NewGuid(),
                Title = $"Item {index:D4}",
                Status = PtvMetadataQualityStatuses.Review,
                MatchConfidence = index % 100,
                ScanFingerprint = $"fingerprint-{index}"
            })
            .ToDictionary(result => result.ItemId.ToString("N"), StringComparer.OrdinalIgnoreCase);
        var store = new RecordingStore
        {
            Document = new PtvMetadataQualityDocument { ItemResults = results }
        };
        var service = CreateService(
            Guid.NewGuid(),
            "Movies",
            [],
            new RecordingProviderVerifier(),
            store,
            new RecordingAiAnalyzer());

        var page = await service.GetResultsAsync(new PtvMetadataQualityResultQuery { Limit = int.MaxValue });

        Assert.Equal(resultCount, page.TotalRecordCount);
        Assert.Equal(Math.Min(resultCount, PtvMetadataQualityConstants.MaximumPageSize), page.Items.Count);
        Assert.Equal(PtvMetadataQualityConstants.MaximumPageSize, page.Limit);
        Assert.Equal(0, store.Writes);
        Assert.Equal(0, store.Updates);
    }

    [Fact]
    public async Task ReadEndpointsNeverStartAnalysisOrWriteState()
    {
        var store = new RecordingStore();
        var provider = new RecordingProviderVerifier();
        var ai = new RecordingAiAnalyzer();
        var queryCalls = 0;
        var service = new PtvMetadataQualityService(
            () => [],
            (_, _, _) =>
            {
                queryCalls++;
                return new PtvMetadataQualityItemBatch([], 0);
            },
            store,
            new PtvMetadataQualityRuleEngine(),
            provider,
            ai,
            NullLogger<PtvMetadataQualityService>.Instance);

        await service.GetSummaryAsync();
        await service.GetStatusAsync();
        await service.GetResultsAsync(new PtvMetadataQualityResultQuery());
        await service.GetResultAsync(Guid.NewGuid());
        await service.GetSettingsAsync();

        Assert.Equal(0, store.Writes);
        Assert.Equal(0, store.Updates);
        Assert.Equal(0, queryCalls);
        Assert.Equal(0, provider.Calls);
        Assert.Equal(0, ai.Calls);
    }

    [Fact]
    public async Task ManualAndScheduledScansAreSingleFlightAndCancellationIsPersisted()
    {
        var libraryId = Guid.NewGuid();
        using var queryEntered = new ManualResetEventSlim();
        using var releaseQuery = new ManualResetEventSlim();
        var service = new PtvMetadataQualityService(
            () => [new PtvMetadataQualityLibrarySummary { Id = libraryId, Name = "Movies" }],
            (_, _, _) =>
            {
                queryEntered.Set();
                releaseQuery.Wait(TimeSpan.FromSeconds(5));
                return new PtvMetadataQualityItemBatch([], 0);
            },
            CreateStore(),
            new PtvMetadataQualityRuleEngine(),
            new RecordingProviderVerifier(),
            new RecordingAiAnalyzer(),
            NullLogger<PtvMetadataQualityService>.Instance);

        await service.StartScanAsync(new PtvMetadataQualityScanRequest { Mode = "full" });
        Assert.True(queryEntered.Wait(TimeSpan.FromSeconds(2)));
        var collision = await Assert.ThrowsAsync<PtvMetadataQualityServiceException>(() =>
            service.RunScheduledScanAsync(new RecordingProgress(), CancellationToken.None));
        Assert.Equal("PTV_METADATA_QUALITY_SCAN_RUNNING", collision.Code);

        await service.CancelScanAsync();
        releaseQuery.Set();
        PtvMetadataQualityStatusResponse status = new();
        for (var attempt = 0; attempt < 50; attempt++)
        {
            status = await service.GetStatusAsync();
            if (status.State == PtvMetadataQualityScanStates.Idle) break;
            await Task.Delay(20);
        }

        Assert.Equal(PtvMetadataQualityScanStates.Idle, status.State);
        var run = Assert.Single((await CreateStore().ReadAsync()).ScanRuns);
        Assert.Equal(PtvMetadataQualityScanStates.Cancelled, run.State);
        Assert.Equal("full", run.Mode);
    }

    [Fact]
    public async Task StoredSummaryRemainsAvailableWhenLibraryEnumerationFails()
    {
        var itemId = Guid.NewGuid();
        var store = new RecordingStore
        {
            Document = new PtvMetadataQualityDocument
            {
                ItemResults = new Dictionary<string, PtvMetadataQualityResult>(StringComparer.OrdinalIgnoreCase)
                {
                    [itemId.ToString("N")] = new() { ItemId = itemId, Status = PtvMetadataQualityStatuses.Healthy }
                }
            }
        };
        var service = new PtvMetadataQualityService(
            () => throw new InvalidOperationException("library unavailable"),
            (_, _, _) => new PtvMetadataQualityItemBatch([], 0),
            store,
            new PtvMetadataQualityRuleEngine(),
            new RecordingProviderVerifier(),
            new RecordingAiAnalyzer(),
            NullLogger<PtvMetadataQualityService>.Instance);

        var summary = await service.GetSummaryAsync();

        Assert.Equal(1, summary.Counts.Healthy);
        Assert.Empty(summary.Libraries);
    }

    [Fact]
    public async Task OptionalAiNeverRunsForHardConflictEvenWhenCandidatesExist()
    {
        var libraryId = Guid.NewGuid();
        var item = Movie("The Thing", "C:\\Movies\\The Thing (1982)\\The.Thing.1982.mkv", 2011, "60935");
        var store = CreateStore();
        await store.WriteSettingsAsync(new PtvMetadataQualitySettings
        {
            AiEnabled = true,
            AiMinimumConfidence = 0,
            AiThreshold = 100,
            AiMaxItemsPerRun = 100
        });
        var provider = new RecordingProviderVerifier
        {
            Result = new PtvMetadataProviderVerificationResult
            {
                Available = true,
                Attempted = true,
                Candidates = [new PtvMetadataMatchSummary { Name = "The Thing", ProductionYear = 1982, Type = "Movie" }]
            }
        };
        var ai = new RecordingAiAnalyzer { IsConfigured = true };
        var service = new PtvMetadataQualityService(
            () => [new PtvMetadataQualityLibrarySummary { Id = libraryId, Name = "Movies" }],
            (_, startIndex, limit) => new PtvMetadataQualityItemBatch(new BaseItem[] { item }.Skip(startIndex).Take(limit).ToList(), 1),
            store,
            new PtvMetadataQualityRuleEngine(),
            provider,
            ai,
            NullLogger<PtvMetadataQualityService>.Instance);

        await service.RunScheduledScanAsync(new RecordingProgress(), CancellationToken.None);

        Assert.Equal(1, provider.Calls);
        Assert.Equal(0, ai.Calls);
        Assert.Equal(PtvMetadataQualityStatuses.LikelyWrong, (await service.GetResultAsync(item.Id))!.Status);
    }

    [Fact]
    public async Task InFlightScanPreservesSameFingerprintReviewDecisionAtPersistBoundary()
    {
        var libraryId = Guid.NewGuid();
        var item = Movie("The Thing", "C:\\Movies\\The Thing (1982)\\The.Thing.1982.mkv", 2011, "60935");
        var store = CreateStore();
        var firstService = new PtvMetadataQualityService(
            () => [new PtvMetadataQualityLibrarySummary { Id = libraryId, Name = "Movies" }],
            (_, startIndex, limit) => new PtvMetadataQualityItemBatch(new BaseItem[] { item }.Skip(startIndex).Take(limit).ToList(), 1),
            store,
            new PtvMetadataQualityRuleEngine(),
            new RecordingProviderVerifier(),
            new RecordingAiAnalyzer(),
            NullLogger<PtvMetadataQualityService>.Instance);
        await firstService.RunScheduledScanAsync(new RecordingProgress(), CancellationToken.None);

        var blockingProvider = new BlockingProviderVerifier();
        var service = new PtvMetadataQualityService(
            () => [new PtvMetadataQualityLibrarySummary { Id = libraryId, Name = "Movies" }],
            (_, startIndex, limit) => new PtvMetadataQualityItemBatch(new BaseItem[] { item }.Skip(startIndex).Take(limit).ToList(), 1),
            store,
            new PtvMetadataQualityRuleEngine(),
            blockingProvider,
            new RecordingAiAnalyzer(),
            NullLogger<PtvMetadataQualityService>.Instance);

        await service.StartScanAsync(new PtvMetadataQualityScanRequest { Mode = "full" });
        await blockingProvider.Entered.Task.WaitAsync(TimeSpan.FromSeconds(2));
        var resolved = await service.ResolveAsync(item.Id, "dismiss");
        Assert.True(resolved?.Dismissed);
        blockingProvider.Release.TrySetResult();

        for (var attempt = 0; attempt < 100 && (await service.GetStatusAsync()).State != PtvMetadataQualityScanStates.Idle; attempt++)
        {
            await Task.Delay(20);
        }

        var final = Assert.IsType<PtvMetadataQualityResult>(await service.GetResultAsync(item.Id));
        Assert.True(final.Dismissed);
        Assert.Equal("dismissed", final.Resolution?.State);
        Assert.Equal(final.ScanFingerprint, final.DismissedFingerprint);
    }

    [Fact]
    public async Task MissingReviewActionReturnsAStableValidationFailure()
    {
        var service = CreateService(Guid.NewGuid(), "Movies", [], new RecordingProviderVerifier());

        var error = await Assert.ThrowsAsync<PtvMetadataQualityServiceException>(() =>
            service.ResolveAsync(Guid.NewGuid(), null!));

        Assert.Equal("PTV_METADATA_QUALITY_ACTION_INVALID", error.Code);
    }

    [Fact]
    public async Task FirstReadAfterRestartProjectsInterruptedStateWithoutPersisting()
    {
        var runId = Guid.NewGuid();
        var store = new RecordingStore
        {
            Document = new PtvMetadataQualityDocument
            {
                ScanRuns =
                [
                    new PtvMetadataQualityScanRun
                    {
                        RunId = runId,
                        Mode = "changed",
                        State = PtvMetadataQualityScanStates.Running,
                        StartedAt = DateTimeOffset.UtcNow.AddMinutes(-5)
                    }
                ]
            }
        };
        var service = new PtvMetadataQualityService(
            () => [],
            (_, _, _) => new PtvMetadataQualityItemBatch([], 0),
            store,
            new PtvMetadataQualityRuleEngine(),
            new RecordingProviderVerifier(),
            new RecordingAiAnalyzer(),
            NullLogger<PtvMetadataQualityService>.Instance);

        var summary = await service.GetSummaryAsync();
        var persisted = Assert.Single((await store.ReadAsync()).ScanRuns);

        Assert.Equal(runId, persisted.RunId);
        Assert.Equal(PtvMetadataQualityScanStates.Running, persisted.State);
        Assert.Null(persisted.CompletedAt);
        Assert.Null(persisted.ErrorCode);
        Assert.Equal(PtvMetadataQualityScanStates.Interrupted, summary.Scan.State);
        Assert.NotNull(summary.Scan.CompletedAt);
        Assert.Equal("The Metadata Quality scan did not finish.", summary.Scan.ErrorMessage);
        Assert.Equal(0, store.Updates);
        Assert.Equal(0, store.Writes);
    }

    [Fact]
    public async Task SummaryProjectionIsCachedUntilAnExplicitMutationInvalidatesIt()
    {
        var itemId = Guid.NewGuid();
        var store = new RecordingStore
        {
            Document = new PtvMetadataQualityDocument
            {
                ItemResults = new Dictionary<string, PtvMetadataQualityResult>(StringComparer.OrdinalIgnoreCase)
                {
                    [itemId.ToString("N")] = new()
                    {
                        ItemId = itemId,
                        ScanFingerprint = "fingerprint",
                        Status = PtvMetadataQualityStatuses.Healthy
                    }
                }
            }
        };
        var service = new PtvMetadataQualityService(
            () => [],
            (_, _, _) => new PtvMetadataQualityItemBatch([], 0),
            store,
            new PtvMetadataQualityRuleEngine(),
            new RecordingProviderVerifier(),
            new RecordingAiAnalyzer(),
            NullLogger<PtvMetadataQualityService>.Instance);

        var first = await service.GetSummaryAsync();
        var second = await service.GetSummaryAsync();

        Assert.Equal(1, first.Counts.Healthy);
        Assert.Equal(1, second.Counts.Healthy);
        Assert.Equal(1, store.Reads);

        await service.ResolveAsync(itemId, "dismiss");
        var afterMutation = await service.GetSummaryAsync();

        Assert.Equal(0, afterMutation.Counts.Healthy);
        Assert.Equal(1, afterMutation.Counts.Dismissed);
        Assert.Equal(1, store.Reads);
    }

    [Fact]
    public async Task SummaryResultsAndDetailShareOneReadOnlyDocumentSnapshotAcrossMutation()
    {
        var itemId = Guid.NewGuid();
        var store = new RecordingStore
        {
            Document = new PtvMetadataQualityDocument
            {
                ItemResults = new Dictionary<string, PtvMetadataQualityResult>(StringComparer.OrdinalIgnoreCase)
                {
                    [itemId.ToString("N")] = new()
                    {
                        ItemId = itemId,
                        ScanFingerprint = "fingerprint",
                        Status = PtvMetadataQualityStatuses.Healthy,
                        Title = "Cached title"
                    }
                }
            }
        };
        var service = new PtvMetadataQualityService(
            () => [],
            (_, _, _) => new PtvMetadataQualityItemBatch([], 0),
            store,
            new PtvMetadataQualityRuleEngine(),
            new RecordingProviderVerifier(),
            new RecordingAiAnalyzer(),
            NullLogger<PtvMetadataQualityService>.Instance);

        await service.GetSummaryAsync();
        var page = await service.GetResultsAsync(new PtvMetadataQualityResultQuery());
        var detail = await service.GetResultAsync(itemId);

        Assert.Equal(1, store.Reads);
        Assert.Single(page.Items);
        Assert.Equal("Cached title", detail?.Title);

        await service.ResolveAsync(itemId, "dismiss");
        await service.GetResultsAsync(new PtvMetadataQualityResultQuery());

        Assert.Equal(1, store.Reads);
    }

    [Fact]
    public async Task ConcurrentColdSummaryCallersShareOnePhysicalStoreRead()
    {
        var itemId = Guid.NewGuid();
        var store = new BlockingDiagnosticStore(new PtvMetadataQualityDocument
        {
            ItemResults = new Dictionary<string, PtvMetadataQualityResult>(StringComparer.OrdinalIgnoreCase)
            {
                [itemId.ToString("N")] = new()
                {
                    ItemId = itemId,
                    ScanFingerprint = "fingerprint",
                    Status = PtvMetadataQualityStatuses.Review
                }
            }
        });
        var service = CreateService(
            Guid.NewGuid(),
            "Movies",
            [],
            new RecordingProviderVerifier(),
            store,
            new RecordingAiAnalyzer());

        var first = service.GetSummaryAsync();
        await store.Entered.Task;
        var waiting = Enumerable.Range(0, 4).Select(_ => service.GetSummaryAsync()).ToArray();
        store.Release.TrySetResult();
        var responses = await Task.WhenAll([first, .. waiting]);

        Assert.Equal(1, store.Reads);
        Assert.All(responses, response => Assert.Equal(1, response.Counts.NeedsReview));
        Assert.Equal(1, responses.Sum(response => response.Diagnostics.Operations.GetValueOrDefault("storeReads")));
        Assert.Contains(responses, response => response.Diagnostics.CacheState == "miss");
        Assert.Equal(4, responses.Count(response => response.Diagnostics.CacheState == "summary-shared"));
    }

    [Fact]
    public async Task CancellingFirstColdCallerDoesNotCancelSharedPhysicalStoreRead()
    {
        var store = new BlockingDiagnosticStore(new PtvMetadataQualityDocument
        {
            ItemResults = new Dictionary<string, PtvMetadataQualityResult>(StringComparer.OrdinalIgnoreCase)
            {
                [Guid.NewGuid().ToString("N")] = new()
                {
                    ItemId = Guid.NewGuid(),
                    ScanFingerprint = "fingerprint",
                    Status = PtvMetadataQualityStatuses.Review
                }
            }
        });
        var service = CreateService(
            Guid.NewGuid(),
            "Movies",
            [],
            new RecordingProviderVerifier(),
            store,
            new RecordingAiAnalyzer());
        using var firstCancellation = new CancellationTokenSource();

        var first = service.GetSummaryAsync(firstCancellation.Token);
        await store.Entered.Task;
        var second = service.GetSummaryAsync();
        firstCancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);
        store.Release.TrySetResult();
        var response = await second;

        Assert.Equal(1, store.Reads);
        Assert.Equal(1, response.Counts.NeedsReview);
        Assert.Equal(1, response.Diagnostics.Operations.GetValueOrDefault("storeReads"));
    }

    [Fact]
    public async Task ReadResponsesCannotMutateSharedDocumentSnapshot()
    {
        var itemId = Guid.NewGuid();
        var store = new RecordingStore
        {
            Document = new PtvMetadataQualityDocument
            {
                ItemResults = new Dictionary<string, PtvMetadataQualityResult>(StringComparer.OrdinalIgnoreCase)
                {
                    [itemId.ToString("N")] = new()
                    {
                        ItemId = itemId,
                        ScanFingerprint = "fingerprint",
                        Status = PtvMetadataQualityStatuses.Review,
                        Title = "Original",
                        CurrentMatch = new PtvMetadataMatchSummary
                        {
                            Name = "Original",
                            ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { ["Provider"] = "1" }
                        },
                        Reasons = [new PtvMetadataQualityReason { Code = "ORIGINAL", Message = "Original reason" }],
                        Resolution = new PtvMetadataQualityResolution { State = "kept_current" }
                    }
                }
            }
        };
        var service = new PtvMetadataQualityService(
            () => [],
            (_, _, _) => new PtvMetadataQualityItemBatch([], 0),
            store,
            new PtvMetadataQualityRuleEngine(),
            new RecordingProviderVerifier(),
            new RecordingAiAnalyzer(),
            NullLogger<PtvMetadataQualityService>.Instance);

        var firstDetail = Assert.IsType<PtvMetadataQualityResult>(await service.GetResultAsync(itemId));
        firstDetail.Title = "Mutated";
        firstDetail.CurrentMatch!.Name = "Mutated";
        firstDetail.CurrentMatch.ProviderIds["Provider"] = "2";
        firstDetail.Reasons[0].Message = "Mutated";
        firstDetail.Resolution!.State = "dismissed";

        var firstPage = await service.GetResultsAsync(new PtvMetadataQualityResultQuery());
        firstPage.Items[0].CurrentMatch!.Name = "Mutated again";
        firstPage.Items[0].Reasons[0].Message = "Mutated again";

        var secondDetail = Assert.IsType<PtvMetadataQualityResult>(await service.GetResultAsync(itemId));
        var secondPage = await service.GetResultsAsync(new PtvMetadataQualityResultQuery());

        Assert.Equal("Original", secondDetail.Title);
        Assert.Equal("Original", secondDetail.CurrentMatch?.Name);
        Assert.Equal("1", secondDetail.CurrentMatch?.ProviderIds["Provider"]);
        Assert.Equal("Original reason", secondDetail.Reasons[0].Message);
        Assert.Equal("kept_current", secondDetail.Resolution?.State);
        Assert.Equal("Original", secondPage.Items[0].CurrentMatch?.Name);
        Assert.Equal("Original reason", secondPage.Items[0].Reasons[0].Message);
        Assert.Equal(1, store.Reads);
    }

    [Fact]
    public async Task ExplicitScanStartPersistsRecoveryOfInterruptedRun()
    {
        var store = CreateStore();
        var staleRunId = Guid.NewGuid();
        await store.WriteAsync(new PtvMetadataQualityDocument
        {
            ScanRuns =
            [
                new PtvMetadataQualityScanRun
                {
                    RunId = staleRunId,
                    Mode = "changed",
                    State = PtvMetadataQualityScanStates.Running,
                    StartedAt = DateTimeOffset.UtcNow.AddMinutes(-5)
                }
            ]
        });
        var service = new PtvMetadataQualityService(
            () => [],
            (_, _, _) => new PtvMetadataQualityItemBatch([], 0),
            store,
            new PtvMetadataQualityRuleEngine(),
            new RecordingProviderVerifier(),
            new RecordingAiAnalyzer(),
            NullLogger<PtvMetadataQualityService>.Instance);

        await service.RunScheduledScanAsync(new RecordingProgress(), CancellationToken.None);

        var runs = (await store.ReadAsync()).ScanRuns;
        var recovered = Assert.Single(runs, run => run.RunId == staleRunId);
        Assert.Equal(PtvMetadataQualityScanStates.Interrupted, recovered.State);
        Assert.NotNull(recovered.CompletedAt);
        Assert.Equal("PTV_METADATA_QUALITY_SCAN_INTERRUPTED", recovered.ErrorCode);
        Assert.Contains(runs, run => run.RunId != staleRunId && run.State == PtvMetadataQualityScanStates.Completed);
    }

    [Theory]
    [InlineData("Book")]
    [InlineData("BoxSet")]
    [InlineData("MusicAlbum")]
    [InlineData("MusicArtist")]
    public async Task IncompleteProviderCapableTypesReachBoundedProviderVerification(string itemType)
    {
        var libraryId = Guid.NewGuid();
        var provider = new RecordingProviderVerifier();
        var service = CreateService(libraryId, "Library", [IncompleteItem(itemType)], provider);

        await service.RunScheduledScanAsync(new RecordingProgress(), CancellationToken.None);

        Assert.Equal(1, provider.Calls);
        Assert.Equal(itemType, provider.LastRequest?.ItemType);
    }

    [Fact]
    public void CandidateScoringUsesRuntimeAndOnlyVerifiedKnownMediaTypes()
    {
        var item = new PtvMetadataQualityAnalysisItem
        {
            ItemId = Guid.NewGuid(),
            ItemType = "Movie",
            Name = "Arrival",
            FileName = "Arrival.2016.mkv",
            FolderName = "Arrival (2016)",
            ProductionYear = 2016,
            RunTimeTicks = TimeSpan.FromMinutes(116).Ticks
        };
        var close = new PtvMetadataMatchSummary
        {
            Name = "Arrival",
            ProductionYear = 2016,
            RuntimeMinutes = 118,
            Type = "Movie",
            TypeVerified = true
        };
        var extremeRuntime = new PtvMetadataMatchSummary
        {
            Name = "Arrival",
            ProductionYear = 2016,
            RuntimeMinutes = 22,
            Type = "Movie",
            TypeVerified = true
        };
        var wrongVerifiedType = new PtvMetadataMatchSummary
        {
            Name = "Arrival",
            ProductionYear = 2016,
            RuntimeMinutes = 118,
            Type = "Series",
            TypeVerified = true
        };
        var unknownType = new PtvMetadataMatchSummary
        {
            Name = "Arrival",
            ProductionYear = 2016,
            RuntimeMinutes = 118,
            Type = "FutureMediaType",
            TypeVerified = true
        };
        var unverifiedType = new PtvMetadataMatchSummary
        {
            Name = "Arrival",
            ProductionYear = 2016,
            RuntimeMinutes = 118,
            Type = "Series"
        };

        var closeScore = PtvMetadataQualityService.ScoreCandidate(item, close);
        Assert.True(closeScore > PtvMetadataQualityService.ScoreCandidate(item, extremeRuntime));
        Assert.True(closeScore > PtvMetadataQualityService.ScoreCandidate(item, wrongVerifiedType));
        Assert.Equal(
            PtvMetadataQualityService.ScoreCandidate(item, unknownType),
            PtvMetadataQualityService.ScoreCandidate(item, unverifiedType));
    }

    [Fact]
    public async Task ExtremeAuthoritativeRuntimeMismatchIsExplainableAndCapsConfidence()
    {
        var libraryId = Guid.NewGuid();
        var book = (Book)IncompleteItem("Book");
        book.Name = "Dune";
        book.Path = "C:\\Books\\Dune (1965)\\Dune.1965.epub";
        book.ProductionYear = 1965;
        book.RunTimeTicks = TimeSpan.FromMinutes(600).Ticks;
        var provider = new RecordingProviderVerifier
        {
            Result = new PtvMetadataProviderVerificationResult
            {
                Available = true,
                Attempted = true,
                Candidates =
                [
                    new PtvMetadataMatchSummary
                    {
                        Name = "Dune",
                        ProductionYear = 1965,
                        RuntimeMinutes = 60,
                        Type = "Book",
                        TypeVerified = true
                    }
                ]
            }
        };
        var service = CreateService(libraryId, "Books", [book], provider);

        await service.RunScheduledScanAsync(new RecordingProgress(), CancellationToken.None);
        var result = Assert.IsType<PtvMetadataQualityResult>(await service.GetResultAsync(book.Id));

        Assert.True(result.Signals.RuntimeDifferencePercent > 75);
        Assert.True(result.MatchConfidence <= 49);
        Assert.Contains(result.Reasons, reason => reason.Code == PtvMetadataQualityReasonCodes.RuntimeMismatch);
    }

    [Fact]
    public async Task DeadpoolIssueNineRanksTheCorrectRunAheadOfProviderOrderAndRejectsIssueSix()
    {
        var libraryId = Guid.NewGuid();
        var book = new Book
        {
            Id = Guid.NewGuid(),
            Name = "Deadpool 009 (2019) (Digital) (Zone-Empire)",
            Path = "C:\\Books\\Deadpool 2019\\Deadpool 009 (2019) (Digital) (Zone-Empire).cbr",
            DateModified = DateTime.UtcNow
        };
        var wrongProviderSlug = "009-recyborg-6";
        var wrongIssueSix = ComicCandidate("#006", "6", 2019, wrongProviderSlug);
        wrongIssueSix.SeriesTitle = "Deadpool";
        wrongIssueSix.SeriesTitleEvidence = PtvReadingIdentityEvidenceSource.Provider;
        wrongIssueSix.ProductionYear = 2026;
        wrongIssueSix.IssuePublicationYear = 2026;
        var provider = new RecordingProviderVerifier
        {
            Result = new PtvMetadataProviderVerificationResult
            {
                Available = true,
                Attempted = true,
                Candidates =
                [
                    wrongIssueSix,
                    ComicCandidate("#001", "1", 2019, "deadpool-1"),
                    ComicCandidate("#002", "2", 2019, "deadpool-2"),
                    ComicCandidate("#003", "3", 2019, "deadpool-3"),
                    ComicCandidate("GN", null, 2019, "deadpool-graphic-novel"),
                    new PtvMetadataMatchSummary
                    {
                        Name = "Deadpool #9",
                        MediaClass = PtvReadingMediaClass.Comic,
                        SeriesTitle = "Deadpool",
                        SeriesTitleEvidence = PtvReadingIdentityEvidenceSource.Provider,
                        NormalizedIssueNumber = "9",
                        IssueNumberEvidence = PtvReadingIdentityEvidenceSource.Provider,
                        SeriesStartYear = 2019,
                        SeriesStartYearEvidence = PtvReadingIdentityEvidenceSource.Provider,
                        ProductionYear = 2020,
                        IssuePublicationYear = 2020,
                        IssuePublicationDate = new DateTimeOffset(2020, 12, 16, 0, 0, 0, TimeSpan.Zero),
                        IssuePublicationEvidence = PtvReadingIdentityEvidenceSource.Provider,
                        Publisher = "Marvel",
                        VolumeId = "deadpool-2019",
                        ProviderName = "Comic Vine",
                        Type = "Book",
                        TypeVerified = true,
                        ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                        {
                            ["ComicVine"] = "77815"
                        }
                    }
                ]
            }
        };
        var service = CreateService(libraryId, "Books", [book], provider);

        await service.RunScheduledScanAsync(new RecordingProgress(), CancellationToken.None);

        var result = Assert.IsType<PtvMetadataQualityResult>(await service.GetResultAsync(book.Id));
        Assert.Equal(PtvMetadataQualityConstants.ScannerVersion, result.ScannerVersion);
        Assert.Equal(PtvMetadataQualityConstants.RuleVersion, result.RuleVersion);
        Assert.Equal(PtvReadingMediaClass.Comic, result.CurrentMatch?.MediaClass);
        Assert.Equal("Deadpool", result.CurrentMatch?.SeriesTitle);
        Assert.Equal("9", result.CurrentMatch?.NormalizedIssueNumber);
        Assert.Equal(2019, result.CurrentMatch?.SeriesStartYear);
        Assert.Null(result.CurrentMatch?.IssuePublicationYear);

        var best = Assert.IsType<PtvMetadataQualityCandidate>(result.Candidates.FirstOrDefault());
        Assert.Equal("9", best.NormalizedIssueNumber);
        Assert.Equal(2019, best.SeriesStartYear);
        Assert.Equal(2020, best.IssuePublicationYear);
        Assert.Equal(PtvReadingMediaClass.Comic, best.MediaClass);
        Assert.True(best.Score >= 75);
        Assert.Contains(best.Confidence, new[] { "strong", "excellent" });
        Assert.False(best.HasHardConflict);
        Assert.False(best.Rejected);
        Assert.DoesNotContain(best.Reasons, reason => reason.Code == PtvReadingMatchReasonCodes.IssuePublicationYearMismatch);

        var wrong = Assert.Single(result.Candidates, candidate =>
            candidate.ProviderIds.GetValueOrDefault("ComicVine") == wrongProviderSlug);
        Assert.True(wrong.Score < 40);
        Assert.Equal("rejected", wrong.Confidence);
        Assert.True(wrong.HasHardConflict);
        Assert.True(wrong.Rejected);
        Assert.Contains(wrong.Reasons, reason => reason.Code == PtvReadingMatchReasonCodes.IssueMismatch);

        Assert.Equal("77815", result.SuggestedMatch?.ProviderIds.GetValueOrDefault("ComicVine"));
        Assert.Equal("9", result.SuggestedMatch?.NormalizedIssueNumber);
        Assert.Equal(PtvReadingMediaClass.Comic, result.SuggestedMatch?.MediaClass);
        Assert.DoesNotContain(result.Candidates, candidate => candidate.Score == 62);
        Assert.True(result.MatchConfidence >= 75);
        Assert.Empty(book.ProviderIds);
    }

    [Fact]
    public async Task ReadingQualityRanksCorrectCandidateBeyondPositionThirtyBeforeTopFiveProjection()
    {
        var libraryId = Guid.NewGuid();
        var book = new Book
        {
            Id = Guid.NewGuid(),
            Name = "Deadpool 009 (2019) (Digital) (Zone-Empire)",
            Path = "C:\\Books\\Deadpool 2019\\Deadpool 009 (2019) (Digital) (Zone-Empire).cbr",
            DateModified = DateTime.UtcNow
        };
        var candidates = Enumerable.Range(1, 75)
            .Select(index => ComicCandidate("#006", "6", 2026, $"unrelated-{index}"))
            .ToList();
        candidates[39] = new PtvMetadataMatchSummary
        {
            Name = "Deadpool #9",
            MediaClass = PtvReadingMediaClass.Comic,
            SeriesTitle = "Deadpool",
            SeriesTitleEvidence = PtvReadingIdentityEvidenceSource.Provider,
            NormalizedIssueNumber = "9",
            IssueNumberEvidence = PtvReadingIdentityEvidenceSource.Provider,
            SeriesStartYear = 2019,
            SeriesStartYearEvidence = PtvReadingIdentityEvidenceSource.Provider,
            ProductionYear = 2020,
            IssuePublicationYear = 2020,
            IssuePublicationEvidence = PtvReadingIdentityEvidenceSource.Provider,
            ProviderName = "Comic Vine",
            Type = "Book",
            TypeVerified = true,
            ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["ComicVine"] = "77815"
            }
        };
        var provider = new RecordingProviderVerifier
        {
            Result = new PtvMetadataProviderVerificationResult
            {
                Available = true,
                Attempted = true,
                Candidates = candidates
            }
        };
        var service = CreateService(libraryId, "Books", [book], provider);

        await service.RunScheduledScanAsync(new RecordingProgress(), CancellationToken.None);

        var result = Assert.IsType<PtvMetadataQualityResult>(await service.GetResultAsync(book.Id));
        Assert.Equal(5, result.Candidates.Count);
        Assert.Equal("77815", result.Candidates[0].ProviderIds.GetValueOrDefault("ComicVine"));
        Assert.Equal("77815", result.SuggestedMatch?.ProviderIds.GetValueOrDefault("ComicVine"));
        Assert.True(result.Candidates[0].Score >= 75);
        Assert.Empty(book.ProviderIds);
    }

    [Fact]
    public async Task ReadingQualityDoesNotPromoteWeakCandidatesOrSendThemToAi()
    {
        var libraryId = Guid.NewGuid();
        var book = new Book
        {
            Id = Guid.NewGuid(),
            Name = "Deadpool 009 (2019) (Digital) (Zone-Empire)",
            Path = "C:\\Books\\Deadpool 2019\\Deadpool 009 (2019) (Digital) (Zone-Empire).cbr",
            DateModified = DateTime.UtcNow
        };
        var store = CreateStore();
        await store.WriteSettingsAsync(new PtvMetadataQualitySettings
        {
            AiEnabled = true,
            AiMinimumConfidence = 0,
            AiThreshold = 100,
            AiMaxItemsPerRun = 10
        });
        var provider = new RecordingProviderVerifier
        {
            Result = new PtvMetadataProviderVerificationResult
            {
                Available = true,
                Attempted = true,
                Candidates =
                [
                    ComicCandidate("#006", "6", 2026, "009-recyborg-6"),
                    ComicCandidate("GN", null, 2019, "deadpool-graphic-novel")
                ]
            }
        };
        var ai = new RecordingAiAnalyzer
        {
            IsConfigured = true,
            Result = new PtvMetadataAiAnalysisResult
            {
                Reviewed = true,
                Confidence = 99,
                SuggestedCandidateIndex = 0
            }
        };
        var service = CreateService(libraryId, "Books", [book], provider, store, ai);

        await service.RunScheduledScanAsync(new RecordingProgress(), CancellationToken.None);

        var result = Assert.IsType<PtvMetadataQualityResult>(await service.GetResultAsync(book.Id));
        Assert.Null(result.SuggestedMatch);
        Assert.DoesNotContain(result.Candidates, candidate => candidate.Confidence is "strong" or "excellent");
        Assert.Equal(0, ai.Calls);
        Assert.Empty(book.ProviderIds);
    }

    [Fact]
    public async Task ShallowComicVineIssueWithoutAuthoritativeSeriesRunIsNotASuggestion()
    {
        var libraryId = Guid.NewGuid();
        var book = new Book
        {
            Id = Guid.NewGuid(),
            Name = "Deadpool 009 (2019) (Digital) (Zone-Empire)",
            Path = "C:\\Books\\Deadpool 2019\\Deadpool 009 (2019) (Digital) (Zone-Empire).cbr",
            DateModified = DateTime.UtcNow
        };
        var provider = new RecordingProviderVerifier
        {
            Result = new PtvMetadataProviderVerificationResult
            {
                Available = true,
                Attempted = true,
                Candidates =
                [
                    new PtvMetadataMatchSummary
                    {
                        Name = "#009",
                        MediaClass = PtvReadingMediaClass.Comic,
                        NormalizedIssueNumber = "009",
                        IssueNumberEvidence = PtvReadingIdentityEvidenceSource.Provider,
                        ProductionYear = 2020,
                        IssuePublicationYear = 2020,
                        IssuePublicationEvidence = PtvReadingIdentityEvidenceSource.Provider,
                        ProviderName = "Comic Vine",
                        Type = "Book",
                        TypeVerified = true,
                        ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                        {
                            ["ComicVine"] = "77815"
                        }
                    }
                ]
            }
        };
        var service = CreateService(libraryId, "Books", [book], provider);

        await service.RunScheduledScanAsync(new RecordingProgress(), CancellationToken.None);

        var result = Assert.IsType<PtvMetadataQualityResult>(await service.GetResultAsync(book.Id));
        var candidate = Assert.Single(result.Candidates);
        Assert.True(candidate.SeriesTitleFromSearchContext);
        Assert.Equal(PtvReadingIdentityEvidenceSource.Unknown, candidate.SeriesTitleEvidence);
        Assert.Null(candidate.SeriesStartYear);
        Assert.True(candidate.Score < 75);
        Assert.Contains(candidate.Confidence, new[] { "possible", "weak" });
        Assert.Null(result.SuggestedMatch);
    }

    [Fact]
    public async Task LocalVolumeNumberIsNotPromotedToProviderRunIdentity()
    {
        var libraryId = Guid.NewGuid();
        var book = new Book
        {
            Id = Guid.NewGuid(),
            Name = "Saga Vol. 2 #9",
            Path = "C:\\Books\\Saga\\Saga Vol. 2 #9.cbz",
            DateModified = DateTime.UtcNow
        };
        var provider = new RecordingProviderVerifier();
        var service = CreateService(libraryId, "Books", [book], provider);

        await service.RunScheduledScanAsync(new RecordingProgress(), CancellationToken.None);

        var result = Assert.IsType<PtvMetadataQualityResult>(await service.GetResultAsync(book.Id));
        Assert.Equal("2", result.CurrentMatch?.VolumeNumber);
        Assert.Null(result.CurrentMatch?.VolumeId);
        Assert.Equal("2", provider.LastRequest?.VolumeNumber);
        Assert.Null(provider.LastRequest?.VolumeId);
    }

    [Fact]
    public async Task VerifiedKnownMediaTypeConflictCapsConfidenceButUnknownTypeDoesNot()
    {
        var libraryId = Guid.NewGuid();
        var book = (Book)IncompleteItem("Book");
        book.Name = "Dune";
        book.Path = "C:\\Books\\Dune (1965)\\Dune.1965.epub";
        book.ProductionYear = 1965;
        var provider = new RecordingProviderVerifier
        {
            Result = new PtvMetadataProviderVerificationResult
            {
                Available = true,
                Attempted = true,
                Candidates =
                [
                    new PtvMetadataMatchSummary
                    {
                        Name = "Dune",
                        ProductionYear = 1965,
                        Type = "Movie",
                        TypeVerified = true
                    }
                ]
            }
        };
        var service = CreateService(libraryId, "Books", [book], provider);

        await service.RunScheduledScanAsync(new RecordingProgress(), CancellationToken.None);
        var result = Assert.IsType<PtvMetadataQualityResult>(await service.GetResultAsync(book.Id));

        Assert.True(result.Signals.ItemTypeConflict);
        Assert.True(result.MatchConfidence <= 49);
        Assert.Contains(result.Reasons, reason => reason.Code == PtvMetadataQualityReasonCodes.MediaTypeConflict);
    }

    [Fact]
    public async Task CompletedAllLibrariesScanRemovesResultsForDeletedLibraries()
    {
        var deletedLibraryId = Guid.NewGuid();
        var availableLibraryId = Guid.NewGuid();
        var deletedItemId = Guid.NewGuid();
        var store = CreateStore();
        await store.WriteAsync(new PtvMetadataQualityDocument
        {
            ItemResults = new Dictionary<string, PtvMetadataQualityResult>(StringComparer.OrdinalIgnoreCase)
            {
                [deletedItemId.ToString("N")] = new()
                {
                    ItemId = deletedItemId,
                    LibraryId = deletedLibraryId,
                    Title = "Deleted library item",
                    ScanFingerprint = "old"
                }
            }
        });
        var service = new PtvMetadataQualityService(
            () => [new PtvMetadataQualityLibrarySummary { Id = availableLibraryId, Name = "Movies" }],
            (_, _, _) => new PtvMetadataQualityItemBatch([], 0),
            store,
            new PtvMetadataQualityRuleEngine(),
            new RecordingProviderVerifier(),
            new RecordingAiAnalyzer(),
            NullLogger<PtvMetadataQualityService>.Instance);

        await service.RunScheduledScanAsync(new RecordingProgress(), CancellationToken.None);

        Assert.Null(await service.GetResultAsync(deletedItemId));
    }

    [Fact]
    public async Task AiAmbiguousGuardIsPersistedEvenWhenAnotherReasonComesFirst()
    {
        var libraryId = Guid.NewGuid();
        var item = Movie("Arrival", "C:\\Movies\\Different Title (2016)\\Different.Title.2016.mkv", 2016, "329865");
        var store = CreateStore();
        await store.WriteSettingsAsync(new PtvMetadataQualitySettings
        {
            AiEnabled = true,
            AiMinimumConfidence = 0,
            AiThreshold = 100,
            AiMaxItemsPerRun = 10
        });
        var provider = ProviderWithCandidate("Different Title", 2016, "Movie");
        var ai = new RecordingAiAnalyzer
        {
            IsConfigured = true,
            Result = new PtvMetadataAiAnalysisResult
            {
                Reviewed = true,
                Confidence = 60,
                ReasonCodes =
                [
                    PtvMetadataQualityReasonCodes.YearMismatch,
                    PtvMetadataQualityReasonCodes.AiAmbiguous
                ],
                Summary = "The candidate selection was invalid."
            }
        };
        var service = CreateService(libraryId, "Movies", [item], provider, store, ai);

        await service.RunScheduledScanAsync(new RecordingProgress(), CancellationToken.None);
        var result = Assert.IsType<PtvMetadataQualityResult>(await service.GetResultAsync(item.Id));

        Assert.Contains(result.Reasons, reason => reason.Code == PtvMetadataQualityReasonCodes.AiAmbiguous);
    }

    [Fact]
    public async Task AiBudgetSkippedCountsOnlyOtherwiseEligibleItemsBeyondCap()
    {
        var libraryId = Guid.NewGuid();
        var items = new BaseItem[]
        {
            Movie("Arrival", "C:\\Movies\\Different One (2016)\\Different.One.2016.mkv", 2016, "329865"),
            Movie("Contact", "C:\\Movies\\Different Two (1997)\\Different.Two.1997.mkv", 1997, "686")
        };
        var store = CreateStore();
        await store.WriteSettingsAsync(new PtvMetadataQualitySettings
        {
            AiEnabled = true,
            AiMinimumConfidence = 0,
            AiThreshold = 100,
            AiMaxItemsPerRun = 1
        });
        var ai = new RecordingAiAnalyzer { IsConfigured = true };
        var service = CreateService(
            libraryId,
            "Movies",
            items,
            ProviderWithCandidate("Candidate", 2016, "Movie"),
            store,
            ai);

        await service.RunScheduledScanAsync(new RecordingProgress(), CancellationToken.None);
        var run = Assert.Single((await store.ReadAsync()).ScanRuns);

        Assert.Equal(1, ai.Calls);
        Assert.Equal(1, run.AiRequests);
        Assert.Equal(1, run.AiBudgetSkipped);
    }

    [Theory]
    [InlineData(PtvMetadataAiErrorCodes.ModelUnavailable)]
    [InlineData(PtvMetadataAiErrorCodes.RateLimited)]
    [InlineData(PtvMetadataAiErrorCodes.Timeout)]
    [InlineData(PtvMetadataAiErrorCodes.ApiUnavailable)]
    public async Task SystemicAiFailureOpensPerRunCircuitAndPreservesDeterministicScan(string aiErrorCode)
    {
        var libraryId = Guid.NewGuid();
        var items = Enumerable.Range(0, 100)
            .Select(index => (BaseItem)Movie(
                $"Movie {index}",
                $"C:\\Movies\\Different {index} (2020)\\Different.{index}.2020.mkv",
                2020,
                $"id-{index}"))
            .ToArray();
        var store = CreateStore();
        await store.WriteSettingsAsync(new PtvMetadataQualitySettings
        {
            AiEnabled = true,
            AiMinimumConfidence = 0,
            AiThreshold = 100,
            AiMaxItemsPerRun = 100
        });
        var ai = new RecordingAiAnalyzer
        {
            IsConfigured = true,
            Result = new PtvMetadataAiAnalysisResult
            {
                Reviewed = false,
                ErrorCode = aiErrorCode
            }
        };
        var service = CreateService(
            libraryId,
            "Movies",
            items,
            ProviderWithCandidate("Candidate", 2020, "Movie"),
            store,
            ai);

        await service.RunScheduledScanAsync(new RecordingProgress(), CancellationToken.None);
        var document = await store.ReadAsync();
        var run = Assert.Single(document.ScanRuns);

        Assert.Equal(PtvMetadataQualityScanStates.Completed, run.State);
        Assert.Equal(100, run.AiEligible);
        Assert.Equal(1, run.AiRequests);
        Assert.Equal(1, run.AiFailures);
        Assert.Equal(99, run.AiSkipped);
        Assert.Equal(99, run.AiCircuitSkipped);
        Assert.Equal(aiErrorCode, run.AiErrorCode);
        Assert.Equal(0, run.Errors);
        Assert.Equal(100, document.ItemResults.Count);
        Assert.DoesNotContain(document.ItemResults.Values, result => result.Status == PtvMetadataQualityStatuses.Unavailable);
    }

    [Fact]
    public async Task MissingCredentialSkipsAiButCompletesProviderAndDeterministicWork()
    {
        var libraryId = Guid.NewGuid();
        var items = new BaseItem[]
        {
            Movie("Arrival", "C:\\Movies\\Different One (2016)\\Different.One.2016.mkv", 2016, "329865"),
            Movie("Contact", "C:\\Movies\\Different Two (1997)\\Different.Two.1997.mkv", 1997, "686")
        };
        var store = CreateStore();
        await store.WriteSettingsAsync(new PtvMetadataQualitySettings
        {
            AiEnabled = true,
            AiMinimumConfidence = 0,
            AiThreshold = 100
        });
        var ai = new RecordingAiAnalyzer { IsConfigured = false };
        var service = CreateService(
            libraryId,
            "Movies",
            items,
            ProviderWithCandidate("Candidate", 2016, "Movie"),
            store,
            ai);

        await service.RunScheduledScanAsync(new RecordingProgress(), CancellationToken.None);
        var run = Assert.Single((await store.ReadAsync()).ScanRuns);

        Assert.Equal(PtvMetadataQualityScanStates.Completed, run.State);
        Assert.Equal(0, ai.Calls);
        Assert.Equal(0, run.AiRequests);
        Assert.Equal(2, run.AiSkipped);
        Assert.Equal(PtvMetadataAiErrorCodes.MissingCredential, run.AiErrorCode);
        Assert.Equal(0, run.Errors);
    }

    [Fact]
    public async Task AiDisabledMakesNoAiRequestEvenWhenCredentialExists()
    {
        var libraryId = Guid.NewGuid();
        var store = CreateStore();
        await store.WriteSettingsAsync(new PtvMetadataQualitySettings
        {
            AiEnabled = false,
            AiMinimumConfidence = 0,
            AiThreshold = 100
        });
        var ai = new RecordingAiAnalyzer { IsConfigured = true };
        var service = CreateService(
            libraryId,
            "Movies",
            [Movie("Arrival", "C:\\Movies\\Arrival (2016)\\Arrival.2016.mkv", 2016, "329865")],
            ProviderWithCandidate("Candidate", 2016, "Movie"),
            store,
            ai);

        await service.RunScheduledScanAsync(new RecordingProgress(), CancellationToken.None);
        var run = Assert.Single((await store.ReadAsync()).ScanRuns);

        Assert.Equal(0, ai.Calls);
        Assert.Equal(0, run.AiEligible);
        Assert.Equal(0, run.AiRequests);
    }

    [Fact]
    public async Task StatusAndConnectionTestAreSafeReadOnlyProjections()
    {
        var store = new RecordingStore
        {
            Settings = new PtvMetadataQualitySettings
            {
                AiEnabled = false,
                AiModel = "settings-api-model"
            }
        };
        var ai = new RecordingAiAnalyzer
        {
            IsConfigured = true,
            TestResult = new PtvMetadataAiConnectionTestResponse
            {
                Success = true,
                Status = PtvMetadataAiErrorCodes.Success,
                Model = "draft-api-model"
            }
        };
        var service = new PtvMetadataQualityService(
            () => [],
            (_, _, _) => throw new InvalidOperationException("A connection test must not enumerate items."),
            store,
            new PtvMetadataQualityRuleEngine(),
            new RecordingProviderVerifier(),
            ai,
            NullLogger<PtvMetadataQualityService>.Instance);

        var status = await service.GetStatusAsync();
        var test = await service.TestAiConnectionAsync(new PtvMetadataAiConnectionTestRequest
        {
            Model = "draft-api-model"
        });

        Assert.True(status.Ai.CredentialConfigured);
        Assert.Equal(PtvMetadataAiCredentialSources.Environment, status.Ai.CredentialSource);
        Assert.Equal("settings-api-model", status.Ai.ConfiguredModel);
        Assert.True(test.Success);
        Assert.Equal(0, store.Writes);
        Assert.Equal(0, store.Updates);
    }

    [Fact]
    public async Task SettingsSavePreservesUnknownFieldsAndRejectsStaleRevision()
    {
        var libraryId = Guid.NewGuid();
        var store = CreateStore();
        using var futureValue = JsonDocument.Parse("true");
        await store.WriteSettingsAsync(new PtvMetadataQualitySettings
        {
            ExtensionData = new Dictionary<string, JsonElement>
            {
                ["futureScannerOption"] = futureValue.RootElement.Clone()
            }
        });
        var service = CreateService(
            libraryId,
            "Movies",
            [],
            new RecordingProviderVerifier(),
            store,
            new RecordingAiAnalyzer());
        var first = await service.GetSettingsAsync();
        Assert.Null(first.ExtensionData);
        first.AiModel = "settings-api-model";

        var saved = await service.SaveSettingsAsync(first);
        var conflict = await Assert.ThrowsAsync<PtvMetadataQualityStoreException>(() =>
            service.SaveSettingsAsync(first));
        var reloaded = await store.ReadSettingsAsync();

        Assert.Equal(first.Revision + 1, saved.Revision);
        Assert.Null(saved.ExtensionData);
        Assert.Equal("PTV_METADATA_QUALITY_SETTINGS_CONFLICT", conflict.Code);
        Assert.Equal("settings-api-model", reloaded.AiModel);
        Assert.True(reloaded.ExtensionData?.ContainsKey("futureScannerOption"));
    }

    [Fact]
    public async Task DismissalResurfacesWhenReasonSignatureChangesAtSameFingerprint()
    {
        var libraryId = Guid.NewGuid();
        var item = Movie("The Thing", "C:\\Movies\\The Thing (1982)\\The.Thing.1982.mkv", 2011, "60935");
        var store = CreateStore();
        var firstService = CreateService(libraryId, "Movies", [item], new RecordingProviderVerifier(), store, new RecordingAiAnalyzer());
        await firstService.RunScheduledScanAsync(new RecordingProgress(), CancellationToken.None);
        Assert.True((await firstService.ResolveAsync(item.Id, "dismiss"))?.Dismissed);

        var changedEvidenceProvider = new RecordingProviderVerifier
        {
            Result = new PtvMetadataProviderVerificationResult
            {
                Available = true,
                Attempted = true,
                Candidates =
                [
                    new PtvMetadataMatchSummary
                    {
                        Name = "The Thing",
                        ProductionYear = 1982,
                        Type = "Movie",
                        TypeVerified = true,
                        ProviderIds = new Dictionary<string, string> { ["Tmdb"] = "1091" }
                    }
                ]
            }
        };
        var secondService = CreateService(libraryId, "Movies", [item], changedEvidenceProvider, store, new RecordingAiAnalyzer());
        await secondService.StartScanAsync(new PtvMetadataQualityScanRequest { Mode = "full" });
        await WaitForIdleAsync(secondService);

        var result = Assert.IsType<PtvMetadataQualityResult>(await secondService.GetResultAsync(item.Id));
        Assert.False(result.Dismissed);
        Assert.Null(result.DismissedFingerprint);
        Assert.NotEqual("dismissed", result.Resolution?.State);
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    private PtvMetadataQualityService CreateService(
        Guid libraryId,
        string libraryName,
        IReadOnlyList<BaseItem> items,
        IPtvMetadataQualityProviderVerifier provider) => new(
        () => [new PtvMetadataQualityLibrarySummary { Id = libraryId, Name = libraryName }],
        (_, startIndex, limit) => new PtvMetadataQualityItemBatch(items.Skip(startIndex).Take(limit).ToList(), items.Count),
        CreateStore(),
        new PtvMetadataQualityRuleEngine(),
        provider,
        new RecordingAiAnalyzer(),
        NullLogger<PtvMetadataQualityService>.Instance);

    private static PtvMetadataQualityService CreateService(
        Guid libraryId,
        string libraryName,
        IReadOnlyList<BaseItem> items,
        IPtvMetadataQualityProviderVerifier provider,
        IPtvMetadataQualityStore store,
        IPtvMetadataAiAnalyzer ai) => new(
        () => [new PtvMetadataQualityLibrarySummary { Id = libraryId, Name = libraryName }],
        (_, startIndex, limit) => new PtvMetadataQualityItemBatch(items.Skip(startIndex).Take(limit).ToList(), items.Count),
        store,
        new PtvMetadataQualityRuleEngine(),
        provider,
        ai,
        NullLogger<PtvMetadataQualityService>.Instance);

    private PtvMetadataQualityStore CreateStore() => new(_root, NullLogger<PtvMetadataQualityStore>.Instance);

    private static Movie Movie(string name, string path, int year, string providerId) => new()
    {
        Id = Guid.NewGuid(),
        Name = name,
        Path = path,
        ProductionYear = year,
        Overview = "Overview",
        DateModified = DateTime.UtcNow,
        ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { ["Tmdb"] = providerId }
    };

    private static BaseItem IncompleteItem(string itemType)
    {
        BaseItem item = itemType switch
        {
            "Book" => new Book(),
            "BoxSet" => new BoxSet(),
            "MusicAlbum" => new MusicAlbum(),
            "MusicArtist" => new MusicArtist(),
            _ => throw new ArgumentOutOfRangeException(nameof(itemType))
        };
        item.Id = Guid.NewGuid();
        item.Name = $"Incomplete {itemType}";
        item.Path = $"C:\\Media\\Incomplete {itemType}";
        item.DateModified = DateTime.UtcNow;
        return item;
    }

    private static RecordingProviderVerifier ProviderWithCandidate(string name, int year, string itemType) => new()
    {
        Result = new PtvMetadataProviderVerificationResult
        {
            Available = true,
            Attempted = true,
            Candidates =
            [
                new PtvMetadataMatchSummary
                {
                    Name = name,
                    ProductionYear = year,
                    Type = itemType,
                    TypeVerified = true
                }
            ]
        }
    };

    private static PtvMetadataMatchSummary ComicCandidate(
        string name,
        string? issueNumber,
        int? runYear,
        string providerId) => new()
    {
        Name = name,
        MediaClass = PtvReadingMediaClass.Comic,
        NormalizedIssueNumber = issueNumber,
        IssueNumberEvidence = string.IsNullOrWhiteSpace(issueNumber)
            ? PtvReadingIdentityEvidenceSource.Unknown
            : PtvReadingIdentityEvidenceSource.Provider,
        SeriesStartYear = runYear,
        SeriesStartYearEvidence = runYear.HasValue
            ? PtvReadingIdentityEvidenceSource.Provider
            : PtvReadingIdentityEvidenceSource.Unknown,
        ProductionYear = runYear,
        IssuePublicationYear = runYear,
        IssuePublicationEvidence = runYear.HasValue
            ? PtvReadingIdentityEvidenceSource.Provider
            : PtvReadingIdentityEvidenceSource.Unknown,
        ProviderName = "Comic Vine",
        Type = "Book",
        TypeVerified = true,
        ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["ComicVine"] = providerId
        }
    };

    private static async Task WaitForIdleAsync(PtvMetadataQualityService service)
    {
        for (var attempt = 0; attempt < 100; attempt++)
        {
            if ((await service.GetStatusAsync()).State == PtvMetadataQualityScanStates.Idle) return;
            await Task.Delay(20);
        }

        throw new TimeoutException("Metadata Quality scan did not become idle.");
    }

    private sealed class RecordingProgress : IProgress<double>
    {
        public List<double> Values { get; } = [];

        public void Report(double value) => Values.Add(value);
    }

    private sealed class RecordingProviderVerifier : IPtvMetadataQualityProviderVerifier
    {
        public int Calls { get; private set; }

        public PtvMetadataProviderVerificationRequest? LastRequest { get; private set; }

        public PtvMetadataProviderVerificationResult Result { get; init; } = new();

        public Task<PtvMetadataProviderVerificationResult> VerifyAsync(
            PtvMetadataProviderVerificationRequest request,
            PtvMetadataProviderVerificationBudget budget,
            CancellationToken cancellationToken)
        {
            Calls++;
            LastRequest = request;
            return Task.FromResult(Result);
        }
    }

    private sealed class RecordingAiAnalyzer : IPtvMetadataAiAnalyzer
    {
        public bool IsConfigured { get; init; }

        public int Calls { get; private set; }

        public PtvMetadataAiAnalysisResult Result { get; init; } = new()
        {
            Reviewed = true,
            Confidence = 50
        };

        public PtvMetadataAiConnectionTestResponse TestResult { get; init; } = new();

        public PtvMetadataAiStatusResponse GetStatus(bool enabled, string? configuredModel) => new()
        {
            Enabled = enabled,
            CredentialConfigured = IsConfigured,
            CredentialSource = IsConfigured
                ? PtvMetadataAiCredentialSources.Environment
                : PtvMetadataAiCredentialSources.Missing,
            ConfiguredModel = configuredModel ?? PtvMetadataQualityConstants.DefaultOpenAiModel,
            EffectiveModel = configuredModel ?? PtvMetadataQualityConstants.DefaultOpenAiModel,
            ModelSource = PtvMetadataAiModelSources.Settings
        };

        public Task<PtvMetadataAiAnalysisResult> AnalyzeAsync(
            PtvMetadataAiAnalysisInput input,
            string? configuredModel,
            CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult(Result);
        }

        public Task<PtvMetadataAiConnectionTestResponse> TestConnectionAsync(
            string? configuredModel,
            CancellationToken cancellationToken) => Task.FromResult(TestResult);
    }

    private sealed class BlockingProviderVerifier : IPtvMetadataQualityProviderVerifier
    {
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public async Task<PtvMetadataProviderVerificationResult> VerifyAsync(
            PtvMetadataProviderVerificationRequest request,
            PtvMetadataProviderVerificationBudget budget,
            CancellationToken cancellationToken)
        {
            Entered.TrySetResult();
            await Release.Task.WaitAsync(cancellationToken);
            return new PtvMetadataProviderVerificationResult { Available = true, Attempted = true };
        }
    }

    private sealed class RecordingStore : IPtvMetadataQualityStore
    {
        public PtvMetadataQualityDocument Document { get; set; } = new();

        public PtvMetadataQualitySettings Settings { get; set; } = new();

        public int Reads { get; private set; }

        public int Writes { get; private set; }

        public int Updates { get; private set; }

        public Task<PtvMetadataQualityDocument> ReadAsync(CancellationToken cancellationToken = default)
        {
            Reads++;
            return Task.FromResult(Document);
        }

        public Task<PtvMetadataQualityDocument> WriteAsync(PtvMetadataQualityDocument document, CancellationToken cancellationToken = default)
        {
            Writes++;
            Document = document;
            return Task.FromResult(Document);
        }

        public Task<PtvMetadataQualityDocument> UpdateAsync(Func<PtvMetadataQualityDocument, PtvMetadataQualityDocument> update, CancellationToken cancellationToken = default)
        {
            Updates++;
            Document = update(Document);
            return Task.FromResult(Document);
        }

        public Task<PtvMetadataQualitySettings> ReadSettingsAsync(CancellationToken cancellationToken = default) => Task.FromResult(Settings);

        public Task<PtvMetadataQualitySettings> WriteSettingsAsync(PtvMetadataQualitySettings settings, CancellationToken cancellationToken = default)
        {
            Writes++;
            Settings = settings;
            return Task.FromResult(settings);
        }

        public Task<PtvMetadataQualitySettings> UpdateSettingsAsync(
            long expectedRevision,
            Func<PtvMetadataQualitySettings, PtvMetadataQualitySettings> update,
            CancellationToken cancellationToken = default)
        {
            Updates++;
            Settings = update(Settings);
            Settings.Revision++;
            return Task.FromResult(Settings);
        }

        public Task<string?> GetErrorCodeAsync(CancellationToken cancellationToken = default) => Task.FromResult<string?>(null);
    }

    private sealed class BlockingDiagnosticStore(PtvMetadataQualityDocument document)
        : IPtvMetadataQualityStore, IPtvMetadataQualityDiagnosticStore
    {
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public TaskCompletionSource Release { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public int Reads { get; private set; }

        public async Task<PtvMetadataQualityDocument> ReadAsync(CancellationToken cancellationToken = default) =>
            (await ((IPtvMetadataQualityDiagnosticStore)this).ReadWithDiagnosticsAsync(cancellationToken)).Document;

        async Task<PtvMetadataQualityStoreReadResult> IPtvMetadataQualityDiagnosticStore.ReadWithDiagnosticsAsync(
            CancellationToken cancellationToken)
        {
            Reads++;
            Entered.TrySetResult();
            await Release.Task.WaitAsync(cancellationToken);
            return new PtvMetadataQualityStoreReadResult(
                document,
                new PtvMetadataQualityStoreReadDiagnostics
                {
                    PersistedResults = document.ItemResults.Count,
                    Operations = new Dictionary<string, long>(StringComparer.Ordinal)
                    {
                        ["storeFileReads"] = 1,
                        ["jsonDeserializations"] = 1,
                        ["jsonSerializations"] = 0,
                        ["metadataWrites"] = 0
                    }
                });
        }

        public Task<PtvMetadataQualityDocument> WriteAsync(
            PtvMetadataQualityDocument value,
            CancellationToken cancellationToken = default) => Task.FromResult(value);

        public Task<PtvMetadataQualityDocument> UpdateAsync(
            Func<PtvMetadataQualityDocument, PtvMetadataQualityDocument> update,
            CancellationToken cancellationToken = default) => Task.FromResult(update(document));

        public Task<PtvMetadataQualitySettings> ReadSettingsAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(new PtvMetadataQualitySettings());

        public Task<PtvMetadataQualitySettings> WriteSettingsAsync(
            PtvMetadataQualitySettings settings,
            CancellationToken cancellationToken = default) => Task.FromResult(settings);

        public Task<PtvMetadataQualitySettings> UpdateSettingsAsync(
            long expectedRevision,
            Func<PtvMetadataQualitySettings, PtvMetadataQualitySettings> update,
            CancellationToken cancellationToken = default) => Task.FromResult(update(new PtvMetadataQualitySettings()));

        public Task<string?> GetErrorCodeAsync(CancellationToken cancellationToken = default) => Task.FromResult<string?>(null);
    }
}
