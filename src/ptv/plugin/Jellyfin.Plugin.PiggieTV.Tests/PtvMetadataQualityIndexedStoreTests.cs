using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvMetadataQualityIndexedStoreTests : IDisposable
{
    private readonly string _root = Path.Combine(
        Path.GetTempPath(),
        "ptv-metadata-quality-index-tests",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task ConcurrentInitializationImportsOneGenerationAndPreservesLegacyJsonExactly()
    {
        var legacy = CreateLegacyStore();
        var document = CreateDocument(
            CreateResult("Arrival", PtvMetadataQualityStatuses.Review, 61),
            CreateResult("Amélie", PtvMetadataQualityStatuses.Healthy, 97));
        await legacy.WriteAsync(document);
        var originalJson = await File.ReadAllBytesAsync(legacy.ResultsPath);
        var indexed = CreateIndexedStore(legacy);

        await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => indexed.EnsureReadyAsync()));

        Assert.True(File.Exists(indexed.DatabasePath));
        Assert.Equal(originalJson, await File.ReadAllBytesAsync(legacy.ResultsPath));
        var page = await indexed.QueryResultsAsync(new PtvMetadataQualityResultQuery
        {
            Sort = "title",
            Limit = 50
        });
        Assert.Equal(2, page.TotalRecordCount);
        Assert.Equal(["Amélie", "Arrival"], page.Items.Select(item => item.Title));
        Assert.Equal(0, page.Diagnostics.Operations["metadataWrites"]);

        await using var connection = OpenDatabase(indexed.DatabasePath);
        await connection.OpenAsync();
        Assert.Equal(1L, await ScalarLongAsync(connection, "SELECT COUNT(*) FROM mq_generation;"));
        Assert.Equal(1L, await ScalarLongAsync(connection, "SELECT COUNT(*) FROM mq_generation WHERE state = 'ACTIVE';"));
    }

    [Fact]
    public async Task EmptyStoreBootstrapExportsAndActivatesAnEmptyGeneration()
    {
        var legacy = CreateLegacyStore();
        Assert.False(File.Exists(legacy.ResultsPath));
        var indexed = CreateIndexedStore(legacy);

        await indexed.EnsureReadyAsync();

        var summary = await indexed.ReadSummaryAsync();
        var page = await indexed.QueryResultsAsync(new PtvMetadataQualityResultQuery { Limit = 50 });
        var generationId = summary.GenerationId;

        Assert.True(File.Exists(legacy.ResultsPath));
        Assert.Equal(0, summary.Counts.TotalScanned);
        Assert.Equal(0, page.TotalRecordCount);
        Assert.Empty(page.Items);
        Assert.Empty((await legacy.ReadAsync()).ItemResults);
        Assert.Null(await indexed.GetErrorCodeAsync());

        await using var connection = OpenDatabase(indexed.DatabasePath);
        await connection.OpenAsync();
        Assert.Equal(1L, await ScalarLongAsync(connection, "SELECT COUNT(*) FROM mq_generation;"));
        Assert.Equal(1L, await ScalarLongAsync(connection, "SELECT COUNT(*) FROM mq_generation WHERE state = 'ACTIVE';"));
        Assert.Equal(0L, await ScalarLongAsync(connection, "SELECT COUNT(*) FROM mq_generation WHERE state IN ('BUILDING', 'VALIDATING', 'FAILED');"));
        Assert.Equal(0L, await ScalarLongAsync(
            connection,
            "SELECT COUNT(*) FROM mq_generation WHERE pending_source_hash IS NOT NULL OR (state = 'ACTIVE' AND snapshot_dirty = 1);"));

        var restarted = CreateIndexedStore(legacy);
        var restartedSummary = await restarted.ReadSummaryAsync();
        Assert.Equal(generationId, restartedSummary.GenerationId);
        Assert.Equal(0, restartedSummary.Counts.TotalScanned);
    }

    [Fact]
    public async Task InitializationDeadlineRenewsWhileImportReportsProgress()
    {
        var inactivityTimeout = TimeSpan.FromSeconds(1);
        using var deadline = new PtvMetadataQualityIndexedStore.InitializationInactivityDeadline(inactivityTimeout);

        for (var step = 0; step < 5; step++)
        {
            await Task.Delay(TimeSpan.FromMilliseconds(250));
            deadline.ReportProgress();
            Assert.False(deadline.Token.IsCancellationRequested);
        }

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => Task.Delay(Timeout.InfiniteTimeSpan, deadline.Token));
    }

    [Fact]
    public async Task CallerCancellationStopsWaitingWithoutCancellingSharedInitialization()
    {
        var legacy = CreateLegacyStore();
        await legacy.WriteAsync(CreateDocument(
            Enumerable.Range(0, 501)
                .Select(index => CreateResult($"Shared import {index:D3}", PtvMetadataQualityStatuses.Review, index % 100))
                .ToArray()));
        var indexed = CreateIndexedStore(legacy);
        using var callerCancellation = new CancellationTokenSource();
        callerCancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => indexed.EnsureReadyAsync(callerCancellation.Token));
        await indexed.EnsureReadyAsync();

        var summary = await indexed.ReadSummaryAsync();
        Assert.Equal(501, summary.Counts.TotalScanned);
        await using var connection = OpenDatabase(indexed.DatabasePath);
        await connection.OpenAsync();
        Assert.Equal(1L, await ScalarLongAsync(connection, "SELECT COUNT(*) FROM mq_generation WHERE state = 'ACTIVE';"));
    }

    [Fact]
    public async Task MalformedLegacyJsonFailsClosedWithoutQuarantiningOrReplacingTheMigrationSource()
    {
        var legacy = CreateLegacyStore();
        var malformed = "{\"schemaVersion\":1,\"itemResults\":{";
        await File.WriteAllTextAsync(legacy.ResultsPath, malformed);
        var original = await File.ReadAllBytesAsync(legacy.ResultsPath);
        var indexed = CreateIndexedStore(legacy);

        await Assert.ThrowsAsync<PtvMetadataQualityStoreException>(() => indexed.EnsureReadyAsync());

        Assert.Equal(original, await File.ReadAllBytesAsync(legacy.ResultsPath));
        Assert.DoesNotContain(
            Directory.EnumerateFiles(_root),
            path => Path.GetFileName(path).Contains(".corrupt.", StringComparison.Ordinal));
        await using var connection = OpenDatabase(indexed.DatabasePath);
        await connection.OpenAsync();
        Assert.Equal(0L, await ScalarLongAsync(connection, "SELECT COUNT(*) FROM mq_generation WHERE state = 'ACTIVE';"));
    }

    [Fact]
    public async Task CorruptIndexFailsClosedAndPreservesTheJsonRollbackSource()
    {
        var legacy = CreateLegacyStore();
        await legacy.WriteAsync(CreateDocument(CreateResult("Rollback source", PtvMetadataQualityStatuses.Review, 55)));
        var original = await File.ReadAllBytesAsync(legacy.ResultsPath);
        var indexed = CreateIndexedStore(legacy);
        await File.WriteAllBytesAsync(indexed.DatabasePath, [0x50, 0x54, 0x56, 0x00, 0x01]);

        var error = await Assert.ThrowsAsync<PtvMetadataQualityStoreException>(() => indexed.EnsureReadyAsync());

        Assert.Equal("PTV_METADATA_QUALITY_INDEX_CORRUPT", error.Code);
        Assert.Equal(original, await File.ReadAllBytesAsync(legacy.ResultsPath));
        Assert.Equal("PTV_METADATA_QUALITY_INDEX_CORRUPT", await indexed.GetErrorCodeAsync());
    }

    [Fact]
    public async Task UnsupportedIndexedSchemaFailsClosedWithoutChangingTheRetainedJson()
    {
        var result = CreateResult("Schema rollback source", PtvMetadataQualityStatuses.Review, 54);
        var legacy = CreateLegacyStore();
        await legacy.WriteAsync(CreateDocument(result));
        var originalJson = await File.ReadAllBytesAsync(legacy.ResultsPath);
        var indexed = CreateIndexedStore(legacy);
        await indexed.EnsureReadyAsync();
        await using (var connection = OpenWritableDatabase(indexed.DatabasePath))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = "UPDATE mq_store_state SET schema_version = 999 WHERE id = 1;";
            Assert.Equal(1, await command.ExecuteNonQueryAsync());
        }

        var reopened = CreateIndexedStore(CreateLegacyStore());
        var error = await Assert.ThrowsAsync<PtvMetadataQualityStoreException>(
            () => reopened.EnsureReadyAsync());

        Assert.Equal("PTV_METADATA_QUALITY_INDEX_SCHEMA_UNSUPPORTED", error.Code);
        Assert.Equal(originalJson, await File.ReadAllBytesAsync(legacy.ResultsPath));
        Assert.Equal(error.Code, await reopened.GetErrorCodeAsync());
    }

    [Fact]
    public async Task InitialMigrationInterruptsAStaleRunningScanWithoutChangingTheRetainedJson()
    {
        var run = RunningRun("changed");
        var document = CreateDocument(CreateResult("Interrupted migration", PtvMetadataQualityStatuses.Review, 62));
        document.ScanRuns = [run];
        var legacy = CreateLegacyStore();
        await legacy.WriteAsync(document);
        var originalJson = await File.ReadAllBytesAsync(legacy.ResultsPath);
        var indexed = CreateIndexedStore(legacy);

        await indexed.EnsureReadyAsync();

        var migrated = Assert.IsType<PtvMetadataQualityScanRun>((await indexed.ReadSummaryAsync()).LatestRun);
        Assert.Equal(run.RunId, migrated.RunId);
        Assert.Equal(PtvMetadataQualityScanStates.Interrupted, migrated.State);
        Assert.NotNull(migrated.CompletedAt);
        Assert.Equal("PTV_METADATA_QUALITY_SCAN_INTERRUPTED", migrated.ErrorCode);
        Assert.Equal(originalJson, await File.ReadAllBytesAsync(legacy.ResultsPath));
    }

    [Fact]
    public async Task ControlledRebuildReplacesACorruptDatabaseFromJsonAndRetainsTheOldDatabaseQuarantine()
    {
        var likelyWrong = CreateResult("Rebuild detail", PtvMetadataQualityStatuses.LikelyWrong, 24);
        likelyWrong.Reasons = [Reason("YEAR_MISMATCH"), Reason("PROVIDER_ID_CONFLICT")];
        likelyWrong.CurrentMatch = Match("Rebuild detail", "TMDb", ("TMDb", "CURRENT-24"));
        likelyWrong.SuggestedMatch = Match("Rebuild detail corrected", "TMDb", ("TMDb", "SUGGESTED-24"));
        var review = CreateResult("Rebuild review", PtvMetadataQualityStatuses.Review, 63);
        var healthy = CreateResult("Rebuild healthy", PtvMetadataQualityStatuses.Healthy, 98);
        var legacy = CreateLegacyStore();
        await legacy.WriteAsync(CreateDocument(likelyWrong, review, healthy));
        var originalJson = await File.ReadAllBytesAsync(legacy.ResultsPath);
        var indexed = CreateIndexedStore(legacy);
        await indexed.EnsureReadyAsync();
        var expectedSummary = await indexed.ReadSummaryAsync();
        var expectedPage = await indexed.QueryResultsAsync(new PtvMetadataQualityResultQuery { Limit = 50 });
        var expectedDetail = await indexed.ReadResultAsync(likelyWrong.ItemId);
        byte[] corruptDatabase = [0x50, 0x54, 0x56, 0x2D, 0x49, 0x4E, 0x56, 0x41, 0x4C, 0x49, 0x44];
        await File.WriteAllBytesAsync(indexed.DatabasePath, corruptDatabase);

        await indexed.RebuildFromLegacyAsync();

        var actualSummary = await indexed.ReadSummaryAsync();
        var actualPage = await indexed.QueryResultsAsync(new PtvMetadataQualityResultQuery { Limit = 50 });
        var actualDetail = await indexed.ReadResultAsync(likelyWrong.ItemId);
        Assert.Equal(
            JsonSerializer.Serialize(expectedSummary.Counts),
            JsonSerializer.Serialize(actualSummary.Counts));
        Assert.Equal(expectedSummary.CompatibilityFingerprint, actualSummary.CompatibilityFingerprint);
        Assert.Equal(expectedPage.TotalRecordCount, actualPage.TotalRecordCount);
        Assert.Equal(
            JsonSerializer.Serialize(expectedPage.Items),
            JsonSerializer.Serialize(actualPage.Items));
        Assert.Equal(
            JsonSerializer.Serialize(expectedDetail),
            JsonSerializer.Serialize(actualDetail));
        Assert.Equal(originalJson, await File.ReadAllBytesAsync(legacy.ResultsPath));
        var quarantine = Assert.Single(Directory.EnumerateFiles(
            _root,
            "metadata-quality-index-v2.db.replaced-*.bak",
            SearchOption.TopDirectoryOnly));
        Assert.Equal(corruptDatabase, await File.ReadAllBytesAsync(quarantine));
        await using var connection = OpenDatabase(indexed.DatabasePath);
        await connection.OpenAsync();
        Assert.Equal(1L, await ScalarLongAsync(connection, "SELECT COUNT(*) FROM mq_generation WHERE state = 'ACTIVE';"));
    }

    [Fact]
    public async Task ControlledRebuildRejectsMalformedJsonWithoutReplacingTheCurrentDatabase()
    {
        var result = CreateResult("Still indexed", PtvMetadataQualityStatuses.Review, 61);
        result.Reasons = [Reason("TITLE_MISMATCH")];
        var legacy = CreateLegacyStore();
        await legacy.WriteAsync(CreateDocument(result));
        var indexed = CreateIndexedStore(legacy);
        await indexed.EnsureReadyAsync();
        var expectedSummary = await indexed.ReadSummaryAsync();
        var expectedPage = await indexed.QueryResultsAsync(new PtvMetadataQualityResultQuery { Limit = 50 });
        var expectedDetail = await indexed.ReadResultAsync(result.ItemId);
        var originalDatabase = await File.ReadAllBytesAsync(indexed.DatabasePath);
        var malformedJson = JsonSerializer.SerializeToUtf8Bytes(CreateDocument(result))[..^1];
        await File.WriteAllBytesAsync(legacy.ResultsPath, malformedJson);

        var error = await Assert.ThrowsAsync<PtvMetadataQualityStoreException>(
            () => indexed.RebuildFromLegacyAsync());

        Assert.False(string.IsNullOrWhiteSpace(error.Code));
        Assert.Equal(originalDatabase, await File.ReadAllBytesAsync(indexed.DatabasePath));
        Assert.Equal(malformedJson, await File.ReadAllBytesAsync(legacy.ResultsPath));
        Assert.Empty(Directory.EnumerateFiles(
            _root,
            "metadata-quality-index-v2.db.replaced-*.bak",
            SearchOption.TopDirectoryOnly));
        Assert.Empty(Directory.EnumerateDirectories(
            _root,
            ".index-rebuild-*",
            SearchOption.TopDirectoryOnly));
        var actualSummary = await indexed.ReadSummaryAsync();
        var actualPage = await indexed.QueryResultsAsync(new PtvMetadataQualityResultQuery { Limit = 50 });
        var actualDetail = await indexed.ReadResultAsync(result.ItemId);
        Assert.Equal(expectedSummary.GenerationId, actualSummary.GenerationId);
        Assert.Equal(
            JsonSerializer.Serialize(expectedSummary.Counts),
            JsonSerializer.Serialize(actualSummary.Counts));
        Assert.Equal(
            JsonSerializer.Serialize(expectedPage.Items),
            JsonSerializer.Serialize(actualPage.Items));
        Assert.Equal(
            JsonSerializer.Serialize(expectedDetail),
            JsonSerializer.Serialize(actualDetail));
    }

    [Fact]
    public async Task ConcurrentControlledRebuildsSerializeSafelyWithoutCorruptingTheActiveIndex()
    {
        var results = Enumerable.Range(0, 75)
            .Select(index => CreateResult(
                $"Concurrent rebuild {index:D2}",
                index % 3 == 0 ? PtvMetadataQualityStatuses.LikelyWrong : PtvMetadataQualityStatuses.Review,
                index % 100))
            .ToArray();
        var legacy = CreateLegacyStore();
        await legacy.WriteAsync(CreateDocument(results));
        var originalJson = await File.ReadAllBytesAsync(legacy.ResultsPath);
        var indexed = CreateIndexedStore(legacy);
        await indexed.EnsureReadyAsync();
        var expectedPage = await indexed.QueryResultsAsync(new PtvMetadataQualityResultQuery { Limit = 50 });
        var expectedDetail = await indexed.ReadResultAsync(results[37].ItemId);

        var rebuilds = Enumerable.Range(0, 3)
            .Select(_ => indexed.RebuildFromLegacyAsync())
            .ToArray();
        await Task.WhenAll(rebuilds);

        var actualSummary = await indexed.ReadSummaryAsync();
        var actualPage = await indexed.QueryResultsAsync(new PtvMetadataQualityResultQuery { Limit = 50 });
        var actualDetail = await indexed.ReadResultAsync(results[37].ItemId);
        Assert.Equal(results.Length, actualSummary.Counts.TotalScanned);
        Assert.Equal(expectedPage.TotalRecordCount, actualPage.TotalRecordCount);
        Assert.Equal(
            JsonSerializer.Serialize(expectedPage.Items),
            JsonSerializer.Serialize(actualPage.Items));
        Assert.Equal(
            JsonSerializer.Serialize(expectedDetail),
            JsonSerializer.Serialize(actualDetail));
        Assert.Equal(originalJson, await File.ReadAllBytesAsync(legacy.ResultsPath));
        Assert.Empty(Directory.EnumerateDirectories(
            _root,
            ".index-rebuild-*",
            SearchOption.TopDirectoryOnly));
        Assert.Equal(2, Directory.EnumerateFiles(
            _root,
            "metadata-quality-index-v2.db.replaced-*.bak",
            SearchOption.TopDirectoryOnly).Count());
        await using var connection = OpenDatabase(indexed.DatabasePath);
        await connection.OpenAsync();
        Assert.Equal(1L, await ScalarLongAsync(connection, "SELECT COUNT(*) FROM mq_generation WHERE state = 'ACTIVE';"));
        Assert.Equal(0L, await ScalarLongAsync(
            connection,
            "SELECT COUNT(*) FROM mq_generation WHERE state IN ('BUILDING', 'VALIDATING', 'FAILED');"));
    }

    [Fact]
    public async Task ProcessColdReopenUsesTheActiveIndexWithoutReadingMalformedLegacyJson()
    {
        var result = CreateResult("Indexed authority", PtvMetadataQualityStatuses.Review, 57);
        var legacy = CreateLegacyStore();
        await legacy.WriteAsync(CreateDocument(result));
        var firstProcess = CreateIndexedStore(legacy);
        await firstProcess.EnsureReadyAsync();
        var activeGeneration = (await firstProcess.ReadSummaryAsync()).GenerationId;
        const string malformedRollbackSource = "{ retained rollback json is intentionally malformed";
        await File.WriteAllTextAsync(legacy.ResultsPath, malformedRollbackSource);

        var reopenedLegacy = CreateLegacyStore();
        var secondProcess = CreateIndexedStore(reopenedLegacy);
        await using (var exclusiveLegacyLease = new FileStream(
                         legacy.ResultsPath,
                         FileMode.Open,
                         FileAccess.ReadWrite,
                         FileShare.None))
        {
            await secondProcess.EnsureReadyAsync();
        }

        var summary = await secondProcess.ReadSummaryAsync();
        Assert.Equal(activeGeneration, summary.GenerationId);
        Assert.Equal(1, summary.Counts.TotalScanned);
        Assert.Equal("Indexed authority", (await secondProcess.ReadResultAsync(result.ItemId))!.Title);
        Assert.Equal(malformedRollbackSource, await File.ReadAllTextAsync(legacy.ResultsPath));
        Assert.Null(await secondProcess.GetErrorCodeAsync());
    }

    [Fact]
    public async Task ReviewQueryCountsAllEligibleRowsButNeverReturnsMoreThanFifty()
    {
        var reviewItems = Enumerable.Range(0, 61)
            .Select(index => CreateResult(
                $"Review {index:D2}",
                PtvMetadataQualityStatuses.Review,
                index,
                scannedAt: DateTimeOffset.UnixEpoch.AddMinutes(index)))
            .ToList();
        reviewItems.AddRange(Enumerable.Range(0, 5).Select(index =>
            CreateResult($"Healthy {index}", PtvMetadataQualityStatuses.Healthy, 100)));
        var indexed = await CreateReadyStoreAsync(CreateDocument(reviewItems.ToArray()));

        var page = await indexed.QueryResultsAsync(new PtvMetadataQualityResultQuery
        {
            Status = "  REVIEW  ",
            Limit = 5_000
        });

        Assert.Equal(61, page.TotalRecordCount);
        Assert.Equal(PtvMetadataQualityConstants.MaximumPageSize, page.Limit);
        Assert.Equal(PtvMetadataQualityConstants.MaximumPageSize, page.Items.Count);
        Assert.Equal(Enumerable.Range(0, 50), page.Items.Select(item => item.MatchConfidence));
        Assert.All(page.Items, item => Assert.Equal(PtvMetadataQualityStatuses.Review, item.Status));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(49)]
    [InlineData(50)]
    [InlineData(51)]
    [InlineData(250)]
    public async Task ReviewPageHonorsTheFiftyRowOutputBoundaryAtEveryEdge(int eligibleCount)
    {
        var results = Enumerable.Range(0, eligibleCount)
            .Select(index => CreateResult(
                $"Boundary {index:D3}",
                PtvMetadataQualityStatuses.Review,
                index % 101,
                scannedAt: DateTimeOffset.UnixEpoch.AddSeconds(index)))
            .ToArray();
        var indexed = await CreateReadyStoreAsync(CreateDocument(results));

        var page = await indexed.QueryResultsAsync(new PtvMetadataQualityResultQuery
        {
            Status = PtvMetadataQualityStatuses.Review,
            Limit = int.MaxValue
        });

        Assert.Equal(eligibleCount, page.TotalRecordCount);
        Assert.Equal(PtvMetadataQualityConstants.MaximumPageSize, page.Limit);
        Assert.Equal(Math.Min(eligibleCount, PtvMetadataQualityConstants.MaximumPageSize), page.Items.Count);
        Assert.Equal(page.Items.Count, page.Items.Select(item => item.ItemId).Distinct().Count());
    }

    [Fact]
    public async Task IndexedFiltersSearchAndSortMatchTheEstablishedQueryContract()
    {
        var libraryOne = Guid.NewGuid();
        var libraryTwo = Guid.NewGuid();
        var first = CreateResult("Amélie", PtvMetadataQualityStatuses.Review, 42, libraryOne, "Movie");
        first.FileName = "amelie.2001.mkv";
        first.AiReviewed = true;
        first.Reasons = [Reason("YEAR_MISMATCH"), Reason("TITLE_MISMATCH")];
        first.CurrentMatch = Match("Amélie", "TMDb", ("TMDb", "194"));

        var second = CreateResult("Alpha", PtvMetadataQualityStatuses.Incomplete, 88, libraryOne, "Book");
        second.FileName = "alpha-book.epub";
        second.Reasons = [Reason("MISSING_ARTWORK")];
        second.SuggestedMatch = Match("Alpha Book", "Google Books", ("GoogleBooks", "BOOK-9"));

        var third = CreateResult("alpha", PtvMetadataQualityStatuses.LikelyWrong, 21, libraryTwo, "Movie");
        third.FileName = "wrong-remake.mkv";
        third.Reasons = [Reason("PROVIDER_ID_CONFLICT")];
        third.CurrentMatch = Match("Wrong Remake", null, ("TMDb", "999"));

        var fourth = CreateResult("東京物語", PtvMetadataQualityStatuses.Healthy, 99, null, "Series");
        fourth.SuggestedMatch = Match("Tokyo Story", "AniList", ("AniList", "CJK-1"));

        var indexed = await CreateReadyStoreAsync(CreateDocument(first, second, third, fourth));

        await AssertIdsAsync(indexed, new() { Status = "likely_WRONG" }, third.ItemId);
        await AssertIdsAsync(indexed, new() { LibraryId = libraryOne, Sort = "title" }, second.ItemId, first.ItemId);
        await AssertIdsAsync(indexed, new() { ItemType = " movie ", Sort = "confidence" }, third.ItemId, first.ItemId);
        await AssertIdsAsync(indexed, new() { MinConfidence = 40, MaxConfidence = 90, Sort = "confidence" }, first.ItemId, second.ItemId);
        await AssertIdsAsync(indexed, new() { Reason = " year_mismatch " }, first.ItemId);
        await AssertIdsAsync(indexed, new() { AiReviewed = true }, first.ItemId);
        await AssertIdsAsync(indexed, new() { Provider = " tmdb ", Sort = "confidence" }, third.ItemId, first.ItemId);
        await AssertIdsAsync(indexed, new() { Provider = "google books" }, second.ItemId);
        await AssertIdsAsync(indexed, new() { Search = " 2001 " }, first.ItemId);
        await AssertIdsAsync(indexed, new() { Search = "book-9" }, second.ItemId);
        await AssertIdsAsync(indexed, new() { Search = "東京" }, fourth.ItemId);

        var stableTitleOrder = await indexed.QueryResultsAsync(new PtvMetadataQualityResultQuery
        {
            Search = "alpha",
            Sort = "title",
            Limit = 50
        });
        Assert.Equal([second.ItemId, third.ItemId], stableTitleOrder.Items.Select(item => item.ItemId));
    }

    [Fact]
    public async Task ListProjectionIsBoundedWhileDetailRoundTripsAllEvidence()
    {
        var result = CreateResult(
            "Deadpool 009 (2019) (Digital) (Zone-Empire)",
            PtvMetadataQualityStatuses.LikelyWrong,
            34,
            itemType: "Book");
        result.CompletenessScore = 73;
        result.RuleScore = 29;
        result.ProviderScore = 41;
        result.AiScore = 38;
        result.ProviderVerified = true;
        result.AiReviewed = true;
        result.AiProvider = "openai";
        result.AiModel = "unit-test-model";
        result.Signals = new PtvMetadataQualitySignals
        {
            FilenameTitleSimilarity = 0.91,
            FilenameYear = 1982,
            YearDifference = 29,
            ProviderIdConflict = true,
            CandidateCount = 2
        };
        result.Reasons =
        [
            Reason("YEAR_MISMATCH"),
            Reason("PROVIDER_ID_CONFLICT"),
            Reason("FILENAME_CONFLICT"),
            Reason("BETTER_PROVIDER_CANDIDATE")
        ];
        result.CurrentMatch = Match("Deadpool 009", "Comic Vine", ("ComicVine", "legacy-current"));
        result.SuggestedMatch = Match("Deadpool #9", "Comic Vine", ("ComicVine", "77815"));
        result.CurrentMatch.Type = "Book";
        result.CurrentMatch.MediaClass = PtvReadingMediaClass.Comic;
        result.CurrentMatch.EditionKind = PtvReadingEditionKind.Standard;
        result.CurrentMatch.EditionKindEvidence = PtvReadingIdentityEvidenceSource.FileName;
        result.CurrentMatch.SeriesTitle = "Deadpool";
        result.CurrentMatch.SeriesTitleEvidence = PtvReadingIdentityEvidenceSource.FileName;
        result.CurrentMatch.NormalizedIssueNumber = "9";
        result.CurrentMatch.IssueNumberEvidence = PtvReadingIdentityEvidenceSource.FileName;
        result.CurrentMatch.VolumeNumber = "1";
        result.CurrentMatch.SeriesStartYear = 2019;
        result.CurrentMatch.SeriesStartYearEvidence = PtvReadingIdentityEvidenceSource.Folder;
        result.SuggestedMatch.Type = "Book";
        result.SuggestedMatch.MediaClass = PtvReadingMediaClass.Comic;
        result.SuggestedMatch.EditionKind = PtvReadingEditionKind.Standard;
        result.SuggestedMatch.EditionKindEvidence = PtvReadingIdentityEvidenceSource.Provider;
        result.SuggestedMatch.SeriesTitle = "Deadpool";
        result.SuggestedMatch.SeriesTitleEvidence = PtvReadingIdentityEvidenceSource.Provider;
        result.SuggestedMatch.SeriesTitleFromSearchContext = true;
        result.SuggestedMatch.NormalizedIssueNumber = "9";
        result.SuggestedMatch.IssueNumberEvidence = PtvReadingIdentityEvidenceSource.Provider;
        result.SuggestedMatch.VolumeNumber = "1";
        result.SuggestedMatch.SeriesStartYear = 2019;
        result.SuggestedMatch.SeriesStartYearEvidence = PtvReadingIdentityEvidenceSource.Provider;
        result.SuggestedMatch.IssuePublicationYear = 2020;
        result.SuggestedMatch.IssuePublicationDate = new DateTimeOffset(2020, 12, 16, 0, 0, 0, TimeSpan.Zero);
        result.SuggestedMatch.IssuePublicationEvidence = PtvReadingIdentityEvidenceSource.Provider;
        result.SuggestedMatch.Publisher = "Marvel";
        result.SuggestedMatch.VolumeId = "deadpool-2019";
        result.Candidates =
        [
            new PtvMetadataQualityCandidate
            {
                Name = "Deadpool #9",
                ProductionYear = 2020,
                MediaClass = PtvReadingMediaClass.Comic,
                EditionKind = PtvReadingEditionKind.Standard,
                EditionKindEvidence = PtvReadingIdentityEvidenceSource.Provider,
                SeriesTitle = "Deadpool",
                SeriesTitleEvidence = PtvReadingIdentityEvidenceSource.Provider,
                SeriesTitleFromSearchContext = true,
                NormalizedIssueNumber = "9",
                IssueNumberEvidence = PtvReadingIdentityEvidenceSource.Provider,
                VolumeNumber = "1",
                SeriesStartYear = 2019,
                SeriesStartYearEvidence = PtvReadingIdentityEvidenceSource.Provider,
                IssuePublicationYear = 2020,
                IssuePublicationDate = new DateTimeOffset(2020, 12, 16, 0, 0, 0, TimeSpan.Zero),
                IssuePublicationEvidence = PtvReadingIdentityEvidenceSource.Provider,
                Publisher = "Marvel",
                VolumeId = "deadpool-2019",
                ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) { ["ComicVine"] = "77815" },
                Score = 96,
                Confidence = "excellent",
                HasHardConflict = false,
                Rejected = false,
                Reasons = [Reason(PtvReadingMatchReasonCodes.IssueMatch)]
            },
            new PtvMetadataQualityCandidate
            {
                Name = "#006",
                ProductionYear = 2026,
                MediaClass = PtvReadingMediaClass.Comic,
                EditionKind = PtvReadingEditionKind.Standard,
                SeriesTitle = "Deadpool",
                NormalizedIssueNumber = "6",
                IssueNumberEvidence = PtvReadingIdentityEvidenceSource.Provider,
                ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                {
                    ["ComicVine"] = "009-recyborg-6/4000-1157701"
                },
                Score = 39,
                Confidence = "rejected",
                HasHardConflict = true,
                Rejected = true,
                Reasons = [Reason(PtvReadingMatchReasonCodes.IssueMismatch)]
            }
        ];
        var indexed = await CreateReadyStoreAsync(CreateDocument(result));

        var page = await indexed.QueryResultsAsync(new PtvMetadataQualityResultQuery { Limit = 50 });
        var detail = await indexed.ReadResultAsync(result.ItemId);

        Assert.Single(page.Items);
        Assert.Equal(3, page.Items[0].Reasons.Count);
        Assert.Equal(PtvReadingMediaClass.Comic, page.Items[0].SuggestedMatch!.MediaClass);
        Assert.Equal("Deadpool", page.Items[0].SuggestedMatch!.SeriesTitle);
        Assert.Equal("9", page.Items[0].SuggestedMatch!.NormalizedIssueNumber);
        Assert.Equal(2019, page.Items[0].SuggestedMatch!.SeriesStartYear);
        Assert.Equal(2020, page.Items[0].SuggestedMatch!.IssuePublicationYear);
        Assert.Equal("Marvel", page.Items[0].SuggestedMatch!.Publisher);
        Assert.Equal("deadpool-2019", page.Items[0].SuggestedMatch!.VolumeId);
        Assert.NotNull(detail);
        Assert.Equal(4, detail!.Reasons.Count);
        Assert.Equal(2, detail.Candidates.Count);
        Assert.True(detail.Signals.ProviderIdConflict);
        Assert.Equal("77815", detail.SuggestedMatch!.ProviderIds["ComicVine"]);
        Assert.Equal(PtvReadingEditionKind.Standard, detail.SuggestedMatch.EditionKind);
        Assert.Equal(PtvReadingIdentityEvidenceSource.Provider, detail.SuggestedMatch.EditionKindEvidence);
        Assert.Equal("1", detail.SuggestedMatch.VolumeNumber);
        Assert.Equal(PtvReadingIdentityEvidenceSource.Provider, detail.SuggestedMatch.SeriesTitleEvidence);
        Assert.True(detail.SuggestedMatch.SeriesTitleFromSearchContext);
        Assert.Equal(
            new DateTimeOffset(2020, 12, 16, 0, 0, 0, TimeSpan.Zero),
            detail.SuggestedMatch.IssuePublicationDate);
        Assert.Equal(PtvReadingIdentityEvidenceSource.Provider, detail.SuggestedMatch.IssuePublicationEvidence);
        Assert.Equal("excellent", detail.Candidates[0].Confidence);
        Assert.False(detail.Candidates[0].Rejected);
        Assert.Equal(PtvReadingMatchReasonCodes.IssueMatch, detail.Candidates[0].Reasons[0].Code);
        Assert.Equal("6", detail.Candidates[1].NormalizedIssueNumber);
        Assert.Equal("rejected", detail.Candidates[1].Confidence);
        Assert.True(detail.Candidates[1].HasHardConflict);
        Assert.True(detail.Candidates[1].Rejected);
        Assert.Equal(PtvReadingMatchReasonCodes.IssueMismatch, detail.Candidates[1].Reasons[0].Code);
        Assert.Null(await indexed.ReadResultAsync(Guid.NewGuid()));

        detail.Title = "caller mutation";
        Assert.Equal(
            "Deadpool 009 (2019) (Digital) (Zone-Empire)",
            (await indexed.ReadResultAsync(result.ItemId))!.Title);
    }

    [Fact]
    public async Task IndexedServiceListAndDetailRemainLocalAndNeverInvokeProviderVerification()
    {
        var result = CreateResult("Deadpool #9", PtvMetadataQualityStatuses.Review, 82, itemType: "Book");
        result.SuggestedMatch = Match("Deadpool #9", "Comic Vine", ("ComicVine", "77815"));
        var legacy = CreateLegacyStore();
        await legacy.WriteAsync(CreateDocument(result));
        var indexed = CreateIndexedStore(legacy);
        await indexed.EnsureReadyAsync();
        var provider = new NoOpProviderVerifier();
        var itemEnumerationCalls = 0;
        var service = new PtvMetadataQualityService(
            () => throw new InvalidOperationException("Indexed list/detail reads must not discover Jellyfin libraries."),
            (_, _, _) =>
            {
                itemEnumerationCalls++;
                throw new InvalidOperationException("Indexed list/detail reads must not enumerate Jellyfin items.");
            },
            legacy,
            new PtvMetadataQualityRuleEngine(),
            provider,
            new NoOpAiAnalyzer(),
            NullLogger<PtvMetadataQualityService>.Instance,
            indexed);

        var page = await service.GetResultsAsync(new PtvMetadataQualityResultQuery { Limit = int.MaxValue });
        var detail = await service.GetResultAsync(result.ItemId);

        Assert.Single(page.Items);
        Assert.Equal(PtvMetadataQualityConstants.MaximumPageSize, page.Limit);
        Assert.NotNull(detail);
        Assert.Equal(0, provider.Calls);
        Assert.Equal(0, itemEnumerationCalls);
        Assert.Equal(0, page.Diagnostics.Operations["providerRequests"]);
        Assert.Equal(0, page.Diagnostics.Operations["storeFileReads"]);
        Assert.Equal(0, page.Diagnostics.Operations["archiveReads"]);
    }

    [Fact]
    public async Task SummaryCountsDisplayStatesAndUsesLatestRunAndScanTimestamp()
    {
        var healthy = CreateResult("Healthy", PtvMetadataQualityStatuses.Healthy, 100);
        var review = CreateResult("Review", PtvMetadataQualityStatuses.Review, 60);
        var wrong = CreateResult("Wrong", PtvMetadataQualityStatuses.LikelyWrong, 30);
        var incomplete = CreateResult("Incomplete", PtvMetadataQualityStatuses.Incomplete, 92);
        var unavailable = CreateResult("Unavailable", PtvMetadataQualityStatuses.Unavailable, 0);
        var dismissed = CreateResult("Dismissed", PtvMetadataQualityStatuses.LikelyWrong, 20);
        dismissed.Dismissed = true;
        dismissed.DismissedFingerprint = dismissed.ScanFingerprint;
        var resolved = CreateResult("Resolved", PtvMetadataQualityStatuses.Review, 65);
        resolved.Resolution = new PtvMetadataQualityResolution
        {
            State = "kept_current",
            ResolvedAt = DateTimeOffset.UnixEpoch.AddHours(4),
            Fingerprint = resolved.ScanFingerprint,
            PreviousStatus = resolved.Status
        };
        var earlier = new PtvMetadataQualityScanRun
        {
            RunId = Guid.NewGuid(),
            State = PtvMetadataQualityScanStates.Completed,
            StartedAt = DateTimeOffset.UnixEpoch.AddHours(1)
        };
        var latest = new PtvMetadataQualityScanRun
        {
            RunId = Guid.NewGuid(),
            State = PtvMetadataQualityScanStates.Failed,
            StartedAt = DateTimeOffset.UnixEpoch.AddHours(3)
        };
        var document = CreateDocument(healthy, review, wrong, incomplete, unavailable, dismissed, resolved);
        document.LastFullScan = DateTimeOffset.UnixEpoch.AddHours(2);
        document.LastIncrementalScan = DateTimeOffset.UnixEpoch.AddHours(5);
        document.ScanRuns = [latest, earlier];
        var indexed = await CreateReadyStoreAsync(document);

        var summary = await indexed.ReadSummaryAsync();

        Assert.Equal(7, summary.Counts.TotalScanned);
        Assert.Equal(1, summary.Counts.Healthy);
        Assert.Equal(1, summary.Counts.NeedsReview);
        Assert.Equal(1, summary.Counts.LikelyIncorrect);
        Assert.Equal(1, summary.Counts.Incomplete);
        Assert.Equal(1, summary.Counts.Unavailable);
        Assert.Equal(1, summary.Counts.Dismissed);
        Assert.Equal(1, summary.Counts.Resolved);
        Assert.Equal(document.LastIncrementalScan, summary.LastScanAt);
        Assert.Equal(latest.RunId, summary.LatestRun!.RunId);
        Assert.Equal(0, summary.Diagnostics.Operations["metadataWrites"]);
    }

    [Fact]
    public async Task BuildingAndFailedGenerationNeverReplaceTheActiveGenerationOrJson()
    {
        var original = CreateResult("Original", PtvMetadataQualityStatuses.Review, 55);
        var legacy = CreateLegacyStore();
        await legacy.WriteAsync(CreateDocument(original));
        var indexed = CreateIndexedStore(legacy);
        await indexed.EnsureReadyAsync();
        var originalJson = await File.ReadAllBytesAsync(legacy.ResultsPath);
        var run = RunningRun("full");
        var generation = await indexed.BeginGenerationAsync(run, resetAllResults: true, [], CancellationToken.None);
        var replacement = CreateResult("Replacement", PtvMetadataQualityStatuses.Healthy, 100);
        await indexed.WriteGenerationBatchAsync(
            generation.GenerationId,
            run,
            new Dictionary<string, PtvMetadataQualityResult> { [replacement.ItemId.ToString("N")] = replacement },
            [replacement.ItemId]);

        await AssertIdsAsync(indexed, new(), original.ItemId);
        Assert.Equal(originalJson, await File.ReadAllBytesAsync(legacy.ResultsPath));

        run.State = PtvMetadataQualityScanStates.Failed;
        run.CompletedAt = DateTimeOffset.UtcNow;
        run.ErrorCode = "UNIT_TEST_FAILURE";
        await indexed.FailGenerationAsync(generation.GenerationId, run);

        await AssertIdsAsync(indexed, new(), original.ItemId);
        Assert.Equal(originalJson, await File.ReadAllBytesAsync(legacy.ResultsPath));

        var afterRestart = CreateIndexedStore(legacy);
        await afterRestart.EnsureReadyAsync();
        await AssertIdsAsync(afterRestart, new(), original.ItemId);
        await using var connection = OpenDatabase(afterRestart.DatabasePath);
        await connection.OpenAsync();
        Assert.Equal(1L, await ScalarLongAsync(connection, "SELECT COUNT(*) FROM mq_generation WHERE state = 'ACTIVE';"));
        Assert.True(await ScalarLongAsync(connection, "SELECT COUNT(*) FROM mq_generation WHERE state = 'FAILED';") >= 1);
    }

    [Fact]
    public async Task CandidateValidationFailureNeverReplacesTheActiveGenerationAndIsCleanedOnRestart()
    {
        var original = CreateResult("Validated active", PtvMetadataQualityStatuses.Review, 57);
        var legacy = CreateLegacyStore();
        await legacy.WriteAsync(CreateDocument(original));
        var originalJson = await File.ReadAllBytesAsync(legacy.ResultsPath);
        var indexed = CreateIndexedStore(legacy);
        await indexed.EnsureReadyAsync();
        var activeGeneration = (await indexed.ReadSummaryAsync()).GenerationId;
        var run = RunningRun("full");
        var generation = await indexed.BeginGenerationAsync(run, resetAllResults: true, [], CancellationToken.None);
        var replacement = CreateResult("Invalid candidate", PtvMetadataQualityStatuses.Healthy, 100);
        await indexed.WriteGenerationBatchAsync(
            generation.GenerationId,
            run,
            new Dictionary<string, PtvMetadataQualityResult>
            {
                [replacement.ItemId.ToString("N")] = replacement
            },
            [replacement.ItemId]);
        await using (var connection = OpenWritableDatabase(indexed.DatabasePath))
        {
            await connection.OpenAsync();
            await using var command = connection.CreateCommand();
            command.CommandText = """
                UPDATE mq_result SET detail_json = '{'
                WHERE generation_id = @generation AND item_id = @item;
                """;
            command.Parameters.AddWithValue("@generation", generation.GenerationId.ToString("N"));
            command.Parameters.AddWithValue("@item", replacement.ItemId.ToString("N"));
            Assert.Equal(1, await command.ExecuteNonQueryAsync());
        }

        run.State = PtvMetadataQualityScanStates.Completed;
        run.CompletedAt = DateTimeOffset.UtcNow;
        var error = await Assert.ThrowsAsync<PtvMetadataQualityStoreException>(
            () => indexed.CompleteGenerationAsync(generation.GenerationId, run));

        Assert.Equal("PTV_METADATA_QUALITY_GENERATION_INVALID", error.Code);
        Assert.Equal(activeGeneration, (await indexed.ReadSummaryAsync()).GenerationId);
        Assert.Equal("Validated active", (await indexed.ReadResultAsync(original.ItemId))!.Title);
        Assert.Null(await indexed.ReadResultAsync(replacement.ItemId));
        Assert.Equal(originalJson, await File.ReadAllBytesAsync(legacy.ResultsPath));

        var restarted = CreateIndexedStore(CreateLegacyStore());
        await restarted.EnsureReadyAsync();
        Assert.Equal(activeGeneration, (await restarted.ReadSummaryAsync()).GenerationId);
        await using var recoveredConnection = OpenDatabase(restarted.DatabasePath);
        await recoveredConnection.OpenAsync();
        Assert.Equal(1L, await ScalarLongAsync(
            recoveredConnection,
            $"SELECT COUNT(*) FROM mq_generation WHERE generation_id = '{generation.GenerationId:N}' AND state = 'FAILED';"));
        Assert.Equal(0L, await ScalarLongAsync(
            recoveredConnection,
            $"SELECT COUNT(*) FROM mq_result WHERE generation_id = '{generation.GenerationId:N}';"));
        Assert.Equal(1L, await ScalarLongAsync(
            recoveredConnection,
            "SELECT COUNT(*) FROM mq_generation WHERE state = 'ACTIVE';"));
    }

    [Fact]
    public async Task RestartMarksAnAbandonedBuildingGenerationFailedAndKeepsThePriorActiveGeneration()
    {
        var original = CreateResult("Still authoritative", PtvMetadataQualityStatuses.Review, 58);
        var legacy = CreateLegacyStore();
        await legacy.WriteAsync(CreateDocument(original));
        var firstProcess = CreateIndexedStore(legacy);
        await firstProcess.EnsureReadyAsync();
        var originalJson = await File.ReadAllBytesAsync(legacy.ResultsPath);
        var run = RunningRun("full");
        var generation = await firstProcess.BeginGenerationAsync(run, resetAllResults: true, [], CancellationToken.None);
        var partial = CreateResult("Partial build", PtvMetadataQualityStatuses.Healthy, 100);
        await firstProcess.WriteGenerationBatchAsync(
            generation.GenerationId,
            run,
            new Dictionary<string, PtvMetadataQualityResult> { [partial.ItemId.ToString("N")] = partial },
            [partial.ItemId]);

        var restartedProcess = CreateIndexedStore(legacy);
        await restartedProcess.EnsureReadyAsync();

        await AssertIdsAsync(restartedProcess, new(), original.ItemId);
        Assert.Equal(originalJson, await File.ReadAllBytesAsync(legacy.ResultsPath));
        await using var connection = OpenDatabase(restartedProcess.DatabasePath);
        await connection.OpenAsync();
        Assert.Equal(1L, await ScalarLongAsync(connection, "SELECT COUNT(*) FROM mq_generation WHERE state = 'ACTIVE';"));
        Assert.Equal(1L, await ScalarLongAsync(
            connection,
            $"SELECT COUNT(*) FROM mq_generation WHERE generation_id = '{generation.GenerationId:N}' AND state = 'FAILED';"));
    }

    [Fact]
    public async Task RestartFailsAndCleansAnUnmatchedValidatingGenerationWhileKeepingThePriorActiveGeneration()
    {
        var original = CreateResult("Prior active", PtvMetadataQualityStatuses.Review, 59);
        var legacy = CreateLegacyStore();
        await legacy.WriteAsync(CreateDocument(original));
        var firstProcess = CreateIndexedStore(legacy);
        await firstProcess.EnsureReadyAsync();
        var originalJson = await File.ReadAllBytesAsync(legacy.ResultsPath);
        var priorGeneration = (await firstProcess.ReadSummaryAsync()).GenerationId;
        var replacement = CreateResult("Unmatched validating", PtvMetadataQualityStatuses.Healthy, 100);
        var replacementGeneration = await CompleteReplacementGenerationAsync(firstProcess, replacement);
        await RewindActivationBoundaryAsync(firstProcess.DatabasePath, priorGeneration, replacementGeneration);
        await File.WriteAllBytesAsync(legacy.ResultsPath, originalJson);

        var restartedProcess = CreateIndexedStore(CreateLegacyStore());
        await restartedProcess.EnsureReadyAsync();

        var summary = await restartedProcess.ReadSummaryAsync();
        Assert.Equal(priorGeneration, summary.GenerationId);
        Assert.Equal("Prior active", (await restartedProcess.ReadResultAsync(original.ItemId))!.Title);
        Assert.Null(await restartedProcess.ReadResultAsync(replacement.ItemId));
        await using var connection = OpenDatabase(restartedProcess.DatabasePath);
        await connection.OpenAsync();
        Assert.Equal(1L, await ScalarLongAsync(
            connection,
            $"SELECT COUNT(*) FROM mq_generation WHERE generation_id = '{replacementGeneration:N}' AND state = 'FAILED';"));
        Assert.Equal(0L, await ScalarLongAsync(
            connection,
            $"SELECT COUNT(*) FROM mq_result WHERE generation_id = '{replacementGeneration:N}';"));
        Assert.Equal(1L, await ScalarLongAsync(connection, "SELECT COUNT(*) FROM mq_generation WHERE state = 'ACTIVE';"));
    }

    [Fact]
    public async Task RestartActivatesAValidatingGenerationWhoseSourceHashMatchesInstalledJson()
    {
        var original = CreateResult("Prior active", PtvMetadataQualityStatuses.Review, 59);
        var legacy = CreateLegacyStore();
        await legacy.WriteAsync(CreateDocument(original));
        var firstProcess = CreateIndexedStore(legacy);
        await firstProcess.EnsureReadyAsync();
        var priorGeneration = (await firstProcess.ReadSummaryAsync()).GenerationId;
        var replacement = CreateResult("Recovered validating", PtvMetadataQualityStatuses.Healthy, 100);
        var replacementGeneration = await CompleteReplacementGenerationAsync(firstProcess, replacement);
        var matchingJson = await File.ReadAllBytesAsync(legacy.ResultsPath);
        await RewindActivationBoundaryAsync(firstProcess.DatabasePath, priorGeneration, replacementGeneration);

        var restartedProcess = CreateIndexedStore(CreateLegacyStore());
        await restartedProcess.EnsureReadyAsync();

        var summary = await restartedProcess.ReadSummaryAsync();
        Assert.Equal(replacementGeneration, summary.GenerationId);
        Assert.Equal(1, summary.Counts.Healthy);
        Assert.Equal("Recovered validating", (await restartedProcess.ReadResultAsync(replacement.ItemId))!.Title);
        Assert.Null(await restartedProcess.ReadResultAsync(original.ItemId));
        Assert.Equal(matchingJson, await File.ReadAllBytesAsync(legacy.ResultsPath));
        await using var connection = OpenDatabase(restartedProcess.DatabasePath);
        await connection.OpenAsync();
        Assert.Equal(1L, await ScalarLongAsync(
            connection,
            $"SELECT COUNT(*) FROM mq_generation WHERE generation_id = '{replacementGeneration:N}' AND state = 'ACTIVE';"));
        Assert.Equal(1L, await ScalarLongAsync(
            connection,
            $"SELECT COUNT(*) FROM mq_generation WHERE generation_id = '{priorGeneration:N}' AND state = 'RETIRED';"));
    }

    [Fact]
    public async Task RestartReexportsAStagedActiveReviewSnapshotBeforeFileReplace()
    {
        var result = CreateResult("Pending review overlay", PtvMetadataQualityStatuses.LikelyWrong, 19);
        result.Reasons = [Reason("YEAR_MISMATCH")];
        var legacy = CreateLegacyStore();
        await legacy.WriteAsync(CreateDocument(result));
        var priorJson = await File.ReadAllBytesAsync(legacy.ResultsPath);
        var indexed = CreateIndexedStore(legacy);
        await indexed.EnsureReadyAsync();
        var generationId = (await indexed.ReadSummaryAsync()).GenerationId;
        string priorHash;
        await using (var connection = OpenDatabase(indexed.DatabasePath))
        {
            await connection.OpenAsync();
            priorHash = await ScalarStringAsync(
                connection,
                $"SELECT source_hash FROM mq_generation WHERE generation_id = '{generationId:N}';");
        }

        await indexed.ResolveAsync(result.ItemId, "dismiss");
        var resolvedJson = await File.ReadAllBytesAsync(legacy.ResultsPath);
        string resolvedHash;
        await using (var connection = OpenDatabase(indexed.DatabasePath))
        {
            await connection.OpenAsync();
            resolvedHash = await ScalarStringAsync(
                connection,
                $"SELECT source_hash FROM mq_generation WHERE generation_id = '{generationId:N}';");
        }

        Assert.NotEqual(priorHash, resolvedHash);
        await StageActivePendingSnapshotAsync(
            indexed.DatabasePath,
            generationId,
            priorHash,
            priorJson.LongLength,
            resolvedHash,
            resolvedJson.LongLength);
        await File.WriteAllBytesAsync(legacy.ResultsPath, priorJson);

        var restarted = CreateIndexedStore(CreateLegacyStore());
        await restarted.EnsureReadyAsync();

        var recovered = await restarted.ReadResultAsync(result.ItemId);
        Assert.NotNull(recovered);
        Assert.True(recovered!.Dismissed);
        Assert.Equal("dismissed", recovered.Resolution!.State);
        Assert.Equal(generationId, (await restarted.ReadSummaryAsync()).GenerationId);
        Assert.Equal(resolvedJson, await File.ReadAllBytesAsync(legacy.ResultsPath));
        await using (var connection = OpenDatabase(restarted.DatabasePath))
        {
            await connection.OpenAsync();
            Assert.Equal(resolvedHash, await ScalarStringAsync(
                connection,
                $"SELECT source_hash FROM mq_generation WHERE generation_id = '{generationId:N}';"));
            Assert.Equal(0L, await ScalarLongAsync(
                connection,
                "SELECT COUNT(*) FROM mq_generation WHERE pending_source_hash IS NOT NULL;"));
        }
    }

    [Fact]
    public async Task RestartRepairsACommittedDirtyReviewOverlayWhenTheRetainedJsonIsStale()
    {
        var result = CreateResult("Dirty review overlay", PtvMetadataQualityStatuses.LikelyWrong, 18);
        result.Reasons = [Reason("PROVIDER_ID_CONFLICT")];
        var legacy = CreateLegacyStore();
        await legacy.WriteAsync(CreateDocument(result));
        var priorJson = await File.ReadAllBytesAsync(legacy.ResultsPath);
        var indexed = CreateIndexedStore(legacy);
        await indexed.EnsureReadyAsync();
        var generationId = (await indexed.ReadSummaryAsync()).GenerationId;
        string priorHash;
        await using (var connection = OpenDatabase(indexed.DatabasePath))
        {
            await connection.OpenAsync();
            priorHash = await ScalarStringAsync(
                connection,
                $"SELECT source_hash FROM mq_generation WHERE generation_id = '{generationId:N}';");
        }

        await indexed.ResolveAsync(result.ItemId, "dismiss");
        var expectedResolvedJson = await File.ReadAllBytesAsync(legacy.ResultsPath);
        await StageDirtyActiveSnapshotAsync(
            indexed.DatabasePath,
            generationId,
            priorHash,
            priorJson.LongLength);
        await File.WriteAllBytesAsync(legacy.ResultsPath, priorJson);

        var restarted = CreateIndexedStore(CreateLegacyStore());
        await restarted.EnsureReadyAsync();

        var recovered = await restarted.ReadResultAsync(result.ItemId);
        var summary = await restarted.ReadSummaryAsync();
        Assert.NotNull(recovered);
        Assert.True(recovered!.Dismissed);
        Assert.Equal("dismissed", recovered.Resolution!.State);
        Assert.Equal(generationId, summary.GenerationId);
        Assert.Equal(0, summary.Counts.LikelyIncorrect);
        Assert.Equal(1, summary.Counts.Dismissed);
        Assert.Equal(expectedResolvedJson, await File.ReadAllBytesAsync(legacy.ResultsPath));
        await using var recoveredConnection = OpenDatabase(restarted.DatabasePath);
        await recoveredConnection.OpenAsync();
        Assert.Equal(0L, await ScalarLongAsync(
            recoveredConnection,
            $"SELECT snapshot_dirty FROM mq_generation WHERE generation_id = '{generationId:N}';"));
        Assert.Equal(0L, await ScalarLongAsync(
            recoveredConnection,
            "SELECT COUNT(*) FROM mq_generation WHERE pending_source_hash IS NOT NULL;"));
        Assert.NotEqual(priorHash, await ScalarStringAsync(
            recoveredConnection,
            $"SELECT source_hash FROM mq_generation WHERE generation_id = '{generationId:N}';"));
    }

    [Fact]
    public async Task RestartPrefersDirtyIndexedReviewStateOverAnOlderPendingSnapshotAlreadyInstalled()
    {
        var first = CreateResult("Pending snapshot A", PtvMetadataQualityStatuses.LikelyWrong, 17);
        first.Reasons = [Reason("YEAR_MISMATCH")];
        var second = CreateResult("Dirty overlay B", PtvMetadataQualityStatuses.Review, 64);
        second.Reasons = [Reason("TITLE_MISMATCH")];
        var legacy = CreateLegacyStore();
        await legacy.WriteAsync(CreateDocument(first, second));
        var initialJson = await File.ReadAllBytesAsync(legacy.ResultsPath);
        var indexed = CreateIndexedStore(legacy);
        await indexed.EnsureReadyAsync();
        var generationId = (await indexed.ReadSummaryAsync()).GenerationId;
        string initialHash;
        await using (var connection = OpenDatabase(indexed.DatabasePath))
        {
            await connection.OpenAsync();
            initialHash = await ScalarStringAsync(
                connection,
                $"SELECT source_hash FROM mq_generation WHERE generation_id = '{generationId:N}';");
        }

        await indexed.ResolveAsync(first.ItemId, "dismiss");
        var snapshotA = await File.ReadAllBytesAsync(legacy.ResultsPath);
        string snapshotAHash;
        await using (var connection = OpenDatabase(indexed.DatabasePath))
        {
            await connection.OpenAsync();
            snapshotAHash = await ScalarStringAsync(
                connection,
                $"SELECT source_hash FROM mq_generation WHERE generation_id = '{generationId:N}';");
        }

        await indexed.ResolveAsync(second.ItemId, "keep_current");
        var snapshotB = await File.ReadAllBytesAsync(legacy.ResultsPath);
        string snapshotBHash;
        await using (var connection = OpenDatabase(indexed.DatabasePath))
        {
            await connection.OpenAsync();
            snapshotBHash = await ScalarStringAsync(
                connection,
                $"SELECT source_hash FROM mq_generation WHERE generation_id = '{generationId:N}';");
        }

        Assert.NotEqual(snapshotAHash, snapshotBHash);
        await StageCompoundPendingAndDirtyActiveSnapshotAsync(
            indexed.DatabasePath,
            generationId,
            initialHash,
            initialJson.LongLength,
            snapshotAHash,
            snapshotA.LongLength);
        await File.WriteAllBytesAsync(legacy.ResultsPath, snapshotA);

        var restarted = CreateIndexedStore(CreateLegacyStore());
        await restarted.EnsureReadyAsync();

        var recoveredFirst = await restarted.ReadResultAsync(first.ItemId);
        var recoveredSecond = await restarted.ReadResultAsync(second.ItemId);
        var summary = await restarted.ReadSummaryAsync();
        Assert.True(recoveredFirst!.Dismissed);
        Assert.Equal("dismissed", recoveredFirst.Resolution!.State);
        Assert.False(recoveredSecond!.Dismissed);
        Assert.Equal("kept_current", recoveredSecond.Resolution!.State);
        Assert.Equal(1, summary.Counts.Dismissed);
        Assert.Equal(1, summary.Counts.Resolved);
        Assert.Equal(snapshotB, await File.ReadAllBytesAsync(legacy.ResultsPath));
        await using var recoveredConnection = OpenDatabase(restarted.DatabasePath);
        await recoveredConnection.OpenAsync();
        Assert.Equal(snapshotBHash, await ScalarStringAsync(
            recoveredConnection,
            $"SELECT source_hash FROM mq_generation WHERE generation_id = '{generationId:N}';"));
        Assert.Equal(0L, await ScalarLongAsync(
            recoveredConnection,
            $"SELECT snapshot_dirty FROM mq_generation WHERE generation_id = '{generationId:N}';"));
        Assert.Equal(0L, await ScalarLongAsync(
            recoveredConnection,
            "SELECT COUNT(*) FROM mq_generation WHERE pending_source_hash IS NOT NULL;"));
        Assert.Equal(1L, await ScalarLongAsync(
            recoveredConnection,
            "SELECT COUNT(*) FROM mq_generation WHERE state = 'ACTIVE';"));
    }

    [Fact]
    public async Task RestartPromotesAndActivatesAStagedValidatingSnapshotAlreadyInstalledOnDisk()
    {
        var original = CreateResult("Prior active snapshot", PtvMetadataQualityStatuses.Review, 58);
        var legacy = CreateLegacyStore();
        await legacy.WriteAsync(CreateDocument(original));
        var indexed = CreateIndexedStore(legacy);
        await indexed.EnsureReadyAsync();
        var priorGeneration = (await indexed.ReadSummaryAsync()).GenerationId;
        var replacement = CreateResult("Installed pending snapshot", PtvMetadataQualityStatuses.Healthy, 100);
        var replacementGeneration = await CompleteReplacementGenerationAsync(indexed, replacement);
        var replacementJson = await File.ReadAllBytesAsync(legacy.ResultsPath);
        string replacementHash;
        await using (var connection = OpenDatabase(indexed.DatabasePath))
        {
            await connection.OpenAsync();
            replacementHash = await ScalarStringAsync(
                connection,
                $"SELECT source_hash FROM mq_generation WHERE generation_id = '{replacementGeneration:N}';");
        }

        await StageValidatingPendingSnapshotAsync(
            indexed.DatabasePath,
            priorGeneration,
            replacementGeneration,
            replacementHash,
            replacementJson.LongLength);

        var restarted = CreateIndexedStore(CreateLegacyStore());
        await restarted.EnsureReadyAsync();

        Assert.Equal(replacementGeneration, (await restarted.ReadSummaryAsync()).GenerationId);
        Assert.Equal("Installed pending snapshot", (await restarted.ReadResultAsync(replacement.ItemId))!.Title);
        Assert.Null(await restarted.ReadResultAsync(original.ItemId));
        Assert.Equal(replacementJson, await File.ReadAllBytesAsync(legacy.ResultsPath));
        await using (var connection = OpenDatabase(restarted.DatabasePath))
        {
            await connection.OpenAsync();
            Assert.Equal(replacementHash, await ScalarStringAsync(
                connection,
                $"SELECT source_hash FROM mq_generation WHERE generation_id = '{replacementGeneration:N}';"));
            Assert.Equal(0L, await ScalarLongAsync(
                connection,
                "SELECT COUNT(*) FROM mq_generation WHERE pending_source_hash IS NOT NULL;"));
            Assert.Equal(1L, await ScalarLongAsync(
                connection,
                $"SELECT COUNT(*) FROM mq_generation WHERE generation_id = '{replacementGeneration:N}' AND state = 'ACTIVE';"));
        }
    }

    [Fact]
    public async Task RestartFailsAndCleansAStagedValidatingSnapshotWhenTheOldJsonRemainsInstalled()
    {
        var original = CreateResult("Preserved prior snapshot", PtvMetadataQualityStatuses.Review, 58);
        var legacy = CreateLegacyStore();
        await legacy.WriteAsync(CreateDocument(original));
        var priorJson = await File.ReadAllBytesAsync(legacy.ResultsPath);
        var indexed = CreateIndexedStore(legacy);
        await indexed.EnsureReadyAsync();
        var priorGeneration = (await indexed.ReadSummaryAsync()).GenerationId;
        var replacement = CreateResult("Never installed pending snapshot", PtvMetadataQualityStatuses.Healthy, 100);
        var replacementGeneration = await CompleteReplacementGenerationAsync(indexed, replacement);
        var replacementJson = await File.ReadAllBytesAsync(legacy.ResultsPath);
        string replacementHash;
        await using (var connection = OpenDatabase(indexed.DatabasePath))
        {
            await connection.OpenAsync();
            replacementHash = await ScalarStringAsync(
                connection,
                $"SELECT source_hash FROM mq_generation WHERE generation_id = '{replacementGeneration:N}';");
        }

        await StageValidatingPendingSnapshotAsync(
            indexed.DatabasePath,
            priorGeneration,
            replacementGeneration,
            replacementHash,
            replacementJson.LongLength);
        await File.WriteAllBytesAsync(legacy.ResultsPath, priorJson);

        var restarted = CreateIndexedStore(CreateLegacyStore());
        await restarted.EnsureReadyAsync();

        Assert.Equal(priorGeneration, (await restarted.ReadSummaryAsync()).GenerationId);
        Assert.Equal("Preserved prior snapshot", (await restarted.ReadResultAsync(original.ItemId))!.Title);
        Assert.Null(await restarted.ReadResultAsync(replacement.ItemId));
        Assert.Equal(priorJson, await File.ReadAllBytesAsync(legacy.ResultsPath));
        await using (var connection = OpenDatabase(restarted.DatabasePath))
        {
            await connection.OpenAsync();
            Assert.Equal(1L, await ScalarLongAsync(
                connection,
                $"SELECT COUNT(*) FROM mq_generation WHERE generation_id = '{replacementGeneration:N}' AND state = 'FAILED';"));
            Assert.Equal(0L, await ScalarLongAsync(
                connection,
                $"SELECT COUNT(*) FROM mq_result WHERE generation_id = '{replacementGeneration:N}';"));
            Assert.Equal(0L, await ScalarLongAsync(
                connection,
                "SELECT COUNT(*) FROM mq_generation WHERE pending_source_hash IS NOT NULL;"));
            Assert.Equal(1L, await ScalarLongAsync(
                connection,
                "SELECT COUNT(*) FROM mq_generation WHERE state = 'ACTIVE';"));
        }
    }

    [Fact]
    public async Task NearEndOfFileInitialImportFailuresAreRetryableAndKeepNoRowsOrUnboundedFailures()
    {
        var legacy = CreateLegacyStore();
        var results = Enumerable.Range(0, 501)
            .Select(index => CreateResult($"Import {index:D3}", PtvMetadataQualityStatuses.Review, index % 100))
            .ToArray();
        var validJson = JsonSerializer.SerializeToUtf8Bytes(
            CreateDocument(results),
            new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var truncatedJson = validJson[..^1];
        await File.WriteAllBytesAsync(legacy.ResultsPath, truncatedJson);
        var indexed = CreateIndexedStore(legacy);

        for (var attempt = 0; attempt < 9; attempt++)
        {
            await Assert.ThrowsAsync<PtvMetadataQualityStoreException>(() => indexed.EnsureReadyAsync());
        }

        Assert.Equal(truncatedJson, await File.ReadAllBytesAsync(legacy.ResultsPath));
        await using var connection = OpenDatabase(indexed.DatabasePath);
        await connection.OpenAsync();
        Assert.Equal(0L, await ScalarLongAsync(connection, "SELECT COUNT(*) FROM mq_result;"));
        Assert.Equal(0L, await ScalarLongAsync(connection, "SELECT COUNT(*) FROM mq_generation WHERE state = 'BUILDING';"));
        Assert.Equal(0L, await ScalarLongAsync(connection, "SELECT COUNT(*) FROM mq_generation WHERE state = 'ACTIVE';"));
        Assert.InRange(
            await ScalarLongAsync(connection, "SELECT COUNT(*) FROM mq_generation WHERE state = 'FAILED';"),
            0,
            5);
    }

    [Fact]
    public async Task SuccessfulGenerationSwitchesAtomicallyAndRemovesUnseenResults()
    {
        var kept = CreateResult("Keep before", PtvMetadataQualityStatuses.Review, 62);
        var removed = CreateResult("Remove me", PtvMetadataQualityStatuses.Incomplete, 91);
        var legacy = CreateLegacyStore();
        await legacy.WriteAsync(CreateDocument(kept, removed));
        var indexed = CreateIndexedStore(legacy);
        await indexed.EnsureReadyAsync();
        var oldGeneration = (await indexed.ReadSummaryAsync()).GenerationId;
        var run = RunningRun("full");
        var generation = await indexed.BeginGenerationAsync(run, resetAllResults: true, [], CancellationToken.None);
        var updated = CreateResult("Keep after", PtvMetadataQualityStatuses.Healthy, 100);
        updated.ItemId = kept.ItemId;
        updated.ScanFingerprint = "updated-fingerprint";
        await indexed.WriteGenerationBatchAsync(
            generation.GenerationId,
            run,
            new Dictionary<string, PtvMetadataQualityResult> { [updated.ItemId.ToString("N")] = updated },
            [updated.ItemId]);

        await AssertIdsAsync(indexed, new(), kept.ItemId, removed.ItemId);
        Assert.Equal("Keep before", (await indexed.ReadResultAsync(kept.ItemId))!.Title);

        run.State = PtvMetadataQualityScanStates.Completed;
        run.CompletedAt = DateTimeOffset.UtcNow;
        run.ItemsConsidered = 1;
        run.ItemsScanned = 1;
        await indexed.CompleteGenerationAsync(generation.GenerationId, run);

        var summary = await indexed.ReadSummaryAsync();
        Assert.NotEqual(oldGeneration, summary.GenerationId);
        Assert.Equal(generation.GenerationId, summary.GenerationId);
        await AssertIdsAsync(indexed, new(), kept.ItemId);
        Assert.Equal("Keep after", (await indexed.ReadResultAsync(kept.ItemId))!.Title);
        Assert.Null(await indexed.ReadResultAsync(removed.ItemId));
        var exported = await legacy.ReadAsync();
        Assert.Single(exported.ItemResults);
        Assert.Equal("Keep after", exported.ItemResults[kept.ItemId.ToString("N")].Title);
    }

    [Fact]
    public async Task ReviewMutationsPersistWithoutChangingOtherResults()
    {
        var dismissedCandidate = CreateResult("Dismiss", PtvMetadataQualityStatuses.LikelyWrong, 22);
        dismissedCandidate.Reasons = [Reason("YEAR_MISMATCH"), Reason("TITLE_MISMATCH")];
        var keptCandidate = CreateResult("Keep", PtvMetadataQualityStatuses.Review, 64);
        var untouched = CreateResult("Untouched", PtvMetadataQualityStatuses.Healthy, 100);
        var legacy = CreateLegacyStore();
        await legacy.WriteAsync(CreateDocument(dismissedCandidate, keptCandidate, untouched));
        var indexed = CreateIndexedStore(legacy);
        await indexed.EnsureReadyAsync();
        var initialGeneration = (await indexed.ReadSummaryAsync()).GenerationId;

        var dismissed = await indexed.ResolveAsync(dismissedCandidate.ItemId, "dismiss");
        var afterDismiss = await indexed.ReadSummaryAsync();

        Assert.Equal(initialGeneration, afterDismiss.GenerationId);
        Assert.Equal(3, afterDismiss.Counts.TotalScanned);
        Assert.Equal(1, afterDismiss.Counts.Healthy);
        Assert.Equal(1, afterDismiss.Counts.NeedsReview);
        Assert.Equal(0, afterDismiss.Counts.LikelyIncorrect);
        Assert.Equal(1, afterDismiss.Counts.Dismissed);
        Assert.Equal(0, afterDismiss.Counts.Resolved);

        var kept = await indexed.ResolveAsync(keptCandidate.ItemId, "keep_current");
        var afterKeep = await indexed.ReadSummaryAsync();

        Assert.True(dismissed!.Dismissed);
        Assert.Equal("dismissed", dismissed.Resolution!.State);
        Assert.Equal(dismissed.ScanFingerprint, dismissed.DismissedFingerprint);
        Assert.False(kept!.Dismissed);
        Assert.Equal("kept_current", kept.Resolution!.State);
        Assert.Equal(initialGeneration, afterKeep.GenerationId);
        Assert.Equal(3, afterKeep.Counts.TotalScanned);
        Assert.Equal(1, afterKeep.Counts.Healthy);
        Assert.Equal(0, afterKeep.Counts.NeedsReview);
        Assert.Equal(0, afterKeep.Counts.LikelyIncorrect);
        Assert.Equal(1, afterKeep.Counts.Dismissed);
        Assert.Equal(1, afterKeep.Counts.Resolved);
        await AssertIdsAsync(indexed, new() { Status = "dismissed" }, dismissedCandidate.ItemId);
        await AssertIdsAsync(indexed, new() { Status = "resolved" }, keptCandidate.ItemId);
        Assert.Equal("Untouched", (await indexed.ReadResultAsync(untouched.ItemId))!.Title);

        var exported = await legacy.ReadAsync();
        Assert.True(exported.ItemResults[dismissedCandidate.ItemId.ToString("N")].Dismissed);
        Assert.Equal(
            "kept_current",
            exported.ItemResults[keptCandidate.ItemId.ToString("N")].Resolution!.State);
        Assert.Equal("Untouched", exported.ItemResults[untouched.ItemId.ToString("N")].Title);
    }

    [Fact]
    public async Task ReviewExportFailureRollsBackOverlayAndKeepsTheActiveGenerationAndCounts()
    {
        var result = CreateResult("Rollback review", PtvMetadataQualityStatuses.LikelyWrong, 23);
        result.Reasons = [Reason("YEAR_MISMATCH")];
        var legacy = CreateLegacyStore();
        await legacy.WriteAsync(CreateDocument(result));
        var originalJson = await File.ReadAllBytesAsync(legacy.ResultsPath);
        var indexed = CreateIndexedStore(legacy);
        await indexed.EnsureReadyAsync();
        var activeGeneration = (await indexed.ReadSummaryAsync()).GenerationId;

        File.Delete(legacy.ResultsPath);
        Directory.CreateDirectory(legacy.ResultsPath);
        try
        {
            await Assert.ThrowsAsync<IOException>(() => indexed.ResolveAsync(result.ItemId, "dismiss"));

            var detail = await indexed.ReadResultAsync(result.ItemId);
            var summary = await indexed.ReadSummaryAsync();
            Assert.NotNull(detail);
            Assert.False(detail!.Dismissed);
            Assert.Null(detail.Resolution);
            Assert.Equal(activeGeneration, summary.GenerationId);
            Assert.Equal(1, summary.Counts.TotalScanned);
            Assert.Equal(1, summary.Counts.LikelyIncorrect);
            Assert.Equal(0, summary.Counts.Dismissed);
            Assert.Equal(0, summary.Counts.Resolved);
            await AssertIdsAsync(indexed, new() { Status = PtvMetadataQualityStatuses.LikelyWrong }, result.ItemId);
        }
        finally
        {
            if (Directory.Exists(legacy.ResultsPath)) Directory.Delete(legacy.ResultsPath, true);
            await File.WriteAllBytesAsync(legacy.ResultsPath, originalJson);
        }

        Assert.Equal(originalJson, await File.ReadAllBytesAsync(legacy.ResultsPath));
        Assert.Empty(Directory.EnumerateFiles(_root, "*.tmp", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task OneThousandRandomizedQueriesMatchTheLegacyJsonOracleExactly()
    {
        var random = new Random(8_675_309);
        var libraries = Enumerable.Range(0, 3).Select(_ => Guid.NewGuid()).ToArray();
        var statuses = new[]
        {
            PtvMetadataQualityStatuses.Healthy,
            PtvMetadataQualityStatuses.Review,
            PtvMetadataQualityStatuses.LikelyWrong,
            PtvMetadataQualityStatuses.Incomplete,
            PtvMetadataQualityStatuses.Unavailable
        };
        var types = new[] { "Movie", "Series", "Episode", "Book" };
        var reasons = new[] { "YEAR_MISMATCH", "TITLE_MISMATCH", "MISSING_ARTWORK", "PROVIDER_ID_CONFLICT" };
        var providerNames = new[] { "TMDb", "AniList", "Google Books" };
        var results = new List<PtvMetadataQualityResult>();
        for (var index = 0; index < 250; index++)
        {
            var result = CreateResult(
                index % 17 == 0 ? $"東京 {index:D3}" : $"Title {(char)('A' + (index % 8))} {index % 29:D2}",
                statuses[index % statuses.Length],
                random.Next(0, 101),
                index % 7 == 0 ? null : libraries[index % libraries.Length],
                types[index % types.Length],
                DateTimeOffset.UnixEpoch.AddMinutes(random.Next(0, 10_000)));
            result.FileName = index % 17 == 0 ? $"東京.{index:D3}.mkv" : $"fixture-{index:D3}-{index % 11}.mkv";
            result.AiReviewed = index % 3 == 0;
            result.Reasons =
            [
                Reason(reasons[index % reasons.Length]),
                Reason(reasons[(index + 1) % reasons.Length]),
                Reason(reasons[(index + 2) % reasons.Length]),
                Reason(reasons[(index + 3) % reasons.Length])
            ];
            result.CurrentMatch = Match(
                result.Title,
                providerNames[index % providerNames.Length],
                (providerNames[index % providerNames.Length].Replace(" ", string.Empty, StringComparison.Ordinal), $"CURRENT-{index:D3}"));
            if (index % 2 == 0)
            {
                result.SuggestedMatch = Match(
                    $"Suggested {index:D3}",
                    providerNames[(index + 1) % providerNames.Length],
                    (providerNames[(index + 1) % providerNames.Length].Replace(" ", string.Empty, StringComparison.Ordinal), $"SUGGESTED-{index:D3}"));
            }

            if (index % 11 == 0)
            {
                result.Dismissed = true;
                result.DismissedAt = DateTimeOffset.UnixEpoch.AddHours(index);
                result.DismissedFingerprint = result.ScanFingerprint;
            }
            else if (index % 13 == 0)
            {
                result.Resolution = new PtvMetadataQualityResolution
                {
                    State = "kept_current",
                    ResolvedAt = DateTimeOffset.UnixEpoch.AddHours(index),
                    Fingerprint = result.ScanFingerprint,
                    PreviousStatus = result.Status
                };
            }

            results.Add(result);
        }

        var legacy = CreateLegacyStore();
        await legacy.WriteAsync(CreateDocument(results.ToArray()));
        var indexed = CreateIndexedStore(legacy);
        await indexed.EnsureReadyAsync();
        var oracle = new PtvMetadataQualityService(
            () => [],
            (_, _, _) => throw new InvalidOperationException("Read queries must not enumerate Jellyfin items."),
            legacy,
            new PtvMetadataQualityRuleEngine(),
            new NoOpProviderVerifier(),
            new NoOpAiAnalyzer(),
            NullLogger<PtvMetadataQualityService>.Instance);

        var displayStatuses = statuses.Concat(["dismissed", "resolved"]).ToArray();
        var sorts = new string?[] { null, "priority", "confidence", "library", "recent", "title", "unknown" };
        var searchValues = new[] { "Title A", "fixture-01", "CURRENT-", "SUGGESTED-0", "東京", "not-present" };
        for (var iteration = 0; iteration < 1_000; iteration++)
        {
            var query = new PtvMetadataQualityResultQuery
            {
                Status = random.Next(4) == 0 ? displayStatuses[random.Next(displayStatuses.Length)] : null,
                LibraryId = random.Next(5) == 0 ? libraries[random.Next(libraries.Length)] : null,
                ItemType = random.Next(5) == 0 ? types[random.Next(types.Length)] : null,
                MinConfidence = random.Next(6) == 0 ? random.Next(0, 70) : null,
                MaxConfidence = random.Next(6) == 0 ? random.Next(30, 101) : null,
                Reason = random.Next(6) == 0 ? reasons[random.Next(reasons.Length)] : null,
                AiReviewed = random.Next(6) == 0 ? random.Next(2) == 0 : null,
                Provider = random.Next(6) == 0 ? providerNames[random.Next(providerNames.Length)] : null,
                Search = random.Next(5) == 0 ? searchValues[random.Next(searchValues.Length)] : null,
                Sort = sorts[random.Next(sorts.Length)],
                StartIndex = new[] { -5, 0, 1, 7, 30, 300 }[random.Next(6)],
                Limit = new[] { 0, 1, 7, 50, 500 }[random.Next(5)]
            };

            var expected = await oracle.GetResultsAsync(query);
            var actual = await indexed.QueryResultsAsync(query);
            Assert.Equal(expected.TotalRecordCount, actual.TotalRecordCount);
            Assert.Equal(expected.StartIndex, actual.StartIndex);
            Assert.Equal(expected.Limit, actual.Limit);
            Assert.Equal(
                JsonSerializer.Serialize(expected.Items),
                JsonSerializer.Serialize(actual.Items));
        }
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    private PtvMetadataQualityStore CreateLegacyStore() =>
        new(_root, NullLogger<PtvMetadataQualityStore>.Instance);

    private PtvMetadataQualityIndexedStore CreateIndexedStore(PtvMetadataQualityStore legacy) =>
        new(_root, legacy, NullLogger<PtvMetadataQualityIndexedStore>.Instance);

    private async Task<PtvMetadataQualityIndexedStore> CreateReadyStoreAsync(PtvMetadataQualityDocument document)
    {
        var legacy = CreateLegacyStore();
        await legacy.WriteAsync(document);
        var indexed = CreateIndexedStore(legacy);
        await indexed.EnsureReadyAsync();
        return indexed;
    }

    private static async Task<Guid> CompleteReplacementGenerationAsync(
        PtvMetadataQualityIndexedStore indexed,
        PtvMetadataQualityResult replacement)
    {
        var run = RunningRun("full");
        var generation = await indexed.BeginGenerationAsync(
            run,
            resetAllResults: true,
            [],
            CancellationToken.None);
        await indexed.WriteGenerationBatchAsync(
            generation.GenerationId,
            run,
            new Dictionary<string, PtvMetadataQualityResult>
            {
                [replacement.ItemId.ToString("N")] = replacement
            },
            [replacement.ItemId]);
        run.State = PtvMetadataQualityScanStates.Completed;
        run.CompletedAt = DateTimeOffset.UtcNow;
        run.ItemsConsidered = 1;
        run.ItemsScanned = 1;
        await indexed.CompleteGenerationAsync(generation.GenerationId, run);
        return generation.GenerationId;
    }

    private static async Task RewindActivationBoundaryAsync(
        string databasePath,
        Guid priorGeneration,
        Guid validatingGeneration)
    {
        await using var connection = OpenWritableDatabase(databasePath);
        await connection.OpenAsync();
        using var transaction = connection.BeginTransaction();
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = """
            UPDATE mq_generation SET state = 'VALIDATING'
            WHERE generation_id = @validating AND state = 'ACTIVE';
            UPDATE mq_generation SET state = 'ACTIVE'
            WHERE generation_id = @prior AND state = 'RETIRED';
            UPDATE mq_store_state SET active_generation_id = @prior WHERE id = 1;
            """;
        command.Parameters.AddWithValue("@prior", priorGeneration.ToString("N"));
        command.Parameters.AddWithValue("@validating", validatingGeneration.ToString("N"));
        Assert.Equal(3, await command.ExecuteNonQueryAsync());
        await transaction.CommitAsync();
    }

    private static async Task StageActivePendingSnapshotAsync(
        string databasePath,
        Guid generationId,
        string sourceHash,
        long sourceLength,
        string pendingHash,
        long pendingLength)
    {
        await using var connection = OpenWritableDatabase(databasePath);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE mq_generation
            SET source_hash = @sourceHash,
                source_length = @sourceLength,
                pending_source_hash = @pendingHash,
                pending_source_length = @pendingLength
            WHERE generation_id = @generation AND state = 'ACTIVE';
            """;
        command.Parameters.AddWithValue("@sourceHash", sourceHash);
        command.Parameters.AddWithValue("@sourceLength", sourceLength);
        command.Parameters.AddWithValue("@pendingHash", pendingHash);
        command.Parameters.AddWithValue("@pendingLength", pendingLength);
        command.Parameters.AddWithValue("@generation", generationId.ToString("N"));
        Assert.Equal(1, await command.ExecuteNonQueryAsync());
    }

    private static async Task StageDirtyActiveSnapshotAsync(
        string databasePath,
        Guid generationId,
        string sourceHash,
        long sourceLength)
    {
        await using var connection = OpenWritableDatabase(databasePath);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE mq_generation
            SET source_hash = @sourceHash,
                source_length = @sourceLength,
                pending_source_hash = NULL,
                pending_source_length = NULL,
                snapshot_dirty = 1
            WHERE generation_id = @generation AND state = 'ACTIVE';
            """;
        command.Parameters.AddWithValue("@sourceHash", sourceHash);
        command.Parameters.AddWithValue("@sourceLength", sourceLength);
        command.Parameters.AddWithValue("@generation", generationId.ToString("N"));
        Assert.Equal(1, await command.ExecuteNonQueryAsync());
    }

    private static async Task StageCompoundPendingAndDirtyActiveSnapshotAsync(
        string databasePath,
        Guid generationId,
        string sourceHash,
        long sourceLength,
        string pendingHash,
        long pendingLength)
    {
        await using var connection = OpenWritableDatabase(databasePath);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE mq_generation
            SET source_hash = @sourceHash,
                source_length = @sourceLength,
                pending_source_hash = @pendingHash,
                pending_source_length = @pendingLength,
                snapshot_dirty = 1
            WHERE generation_id = @generation AND state = 'ACTIVE';
            """;
        command.Parameters.AddWithValue("@sourceHash", sourceHash);
        command.Parameters.AddWithValue("@sourceLength", sourceLength);
        command.Parameters.AddWithValue("@pendingHash", pendingHash);
        command.Parameters.AddWithValue("@pendingLength", pendingLength);
        command.Parameters.AddWithValue("@generation", generationId.ToString("N"));
        Assert.Equal(1, await command.ExecuteNonQueryAsync());
    }

    private static async Task StageValidatingPendingSnapshotAsync(
        string databasePath,
        Guid priorGeneration,
        Guid validatingGeneration,
        string pendingHash,
        long pendingLength)
    {
        await using var connection = OpenWritableDatabase(databasePath);
        await connection.OpenAsync();
        using var transaction = connection.BeginTransaction();
        await using (var validating = connection.CreateCommand())
        {
            validating.Transaction = transaction;
            validating.CommandText = """
                UPDATE mq_generation
                SET state = 'VALIDATING',
                    source_hash = NULL,
                    source_length = 0,
                    pending_source_hash = @pendingHash,
                    pending_source_length = @pendingLength
                WHERE generation_id = @generation AND state = 'ACTIVE';
                """;
            validating.Parameters.AddWithValue("@pendingHash", pendingHash);
            validating.Parameters.AddWithValue("@pendingLength", pendingLength);
            validating.Parameters.AddWithValue("@generation", validatingGeneration.ToString("N"));
            Assert.Equal(1, await validating.ExecuteNonQueryAsync());
        }

        await using (var prior = connection.CreateCommand())
        {
            prior.Transaction = transaction;
            prior.CommandText = """
                UPDATE mq_generation SET state = 'ACTIVE'
                WHERE generation_id = @generation AND state = 'RETIRED';
                UPDATE mq_store_state SET active_generation_id = @generation WHERE id = 1;
                """;
            prior.Parameters.AddWithValue("@generation", priorGeneration.ToString("N"));
            Assert.Equal(2, await prior.ExecuteNonQueryAsync());
        }

        await transaction.CommitAsync();
    }

    private static PtvMetadataQualityDocument CreateDocument(params PtvMetadataQualityResult[] results) => new()
    {
        ItemResults = results.ToDictionary(
            result => result.ItemId.ToString("N"),
            result => result,
            StringComparer.OrdinalIgnoreCase)
    };

    private static PtvMetadataQualityResult CreateResult(
        string title,
        string status,
        int confidence,
        Guid? libraryId = null,
        string itemType = "Movie",
        DateTimeOffset? scannedAt = null) => new()
    {
        ItemId = Guid.NewGuid(),
        LibraryId = libraryId,
        LibraryName = libraryId.HasValue ? $"Library {libraryId.Value:N}" : null,
        ItemType = itemType,
        Title = title,
        ScanFingerprint = $"fingerprint-{Guid.NewGuid():N}",
        ScannedAt = scannedAt ?? DateTimeOffset.UnixEpoch.AddHours(1),
        Status = status,
        MatchConfidence = confidence,
        CompletenessScore = status == PtvMetadataQualityStatuses.Incomplete ? 75 : 100,
        RuleScore = confidence,
        Signals = new PtvMetadataQualitySignals()
    };

    private static PtvMetadataQualityReason Reason(string code) => new()
    {
        Code = code,
        Severity = "warning",
        ScoreImpact = -10,
        Message = $"Reason {code}",
        Evidence = "bounded unit-test evidence"
    };

    private static PtvMetadataMatchSummary Match(
        string name,
        string? provider,
        params (string Key, string Value)[] providerIds) => new()
    {
        Name = name,
        ProviderName = provider,
        Type = "Movie",
        TypeVerified = true,
        ProviderIds = providerIds.ToDictionary(
            pair => pair.Key,
            pair => pair.Value,
            StringComparer.OrdinalIgnoreCase)
    };

    private static PtvMetadataQualityScanRun RunningRun(string mode) => new()
    {
        RunId = Guid.NewGuid(),
        Mode = mode,
        State = PtvMetadataQualityScanStates.Running,
        StartedAt = DateTimeOffset.UtcNow
    };

    private static async Task AssertIdsAsync(
        PtvMetadataQualityIndexedStore store,
        PtvMetadataQualityResultQuery query,
        params Guid[] expected)
    {
        query.Limit = 50;
        var page = await store.QueryResultsAsync(query);
        Assert.Equal(expected.Length, page.TotalRecordCount);
        Assert.Equal(expected, page.Items.Select(item => item.ItemId));
    }

    private static SqliteConnection OpenDatabase(string path) => new(new SqliteConnectionStringBuilder
    {
        DataSource = path,
        Mode = SqliteOpenMode.ReadOnly,
        Pooling = false
    }.ToString());

    private static SqliteConnection OpenWritableDatabase(string path) => new(new SqliteConnectionStringBuilder
    {
        DataSource = path,
        Mode = SqliteOpenMode.ReadWrite,
        Pooling = false
    }.ToString());

    private static async Task<long> ScalarLongAsync(SqliteConnection connection, string sql)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        return Convert.ToInt64(await command.ExecuteScalarAsync());
    }

    private static async Task<string> ScalarStringAsync(SqliteConnection connection, string sql)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        return Assert.IsType<string>(await command.ExecuteScalarAsync());
    }

    private sealed class NoOpProviderVerifier : IPtvMetadataQualityProviderVerifier
    {
        public int Calls { get; private set; }

        public Task<PtvMetadataProviderVerificationResult> VerifyAsync(
            PtvMetadataProviderVerificationRequest request,
            PtvMetadataProviderVerificationBudget budget,
            CancellationToken cancellationToken)
        {
            Calls++;
            return Task.FromResult(new PtvMetadataProviderVerificationResult());
        }
    }

    private sealed class NoOpAiAnalyzer : IPtvMetadataAiAnalyzer
    {
        public bool IsConfigured => false;

        public PtvMetadataAiStatusResponse GetStatus(bool enabled, string? configuredModel) => new();

        public Task<PtvMetadataAiAnalysisResult> AnalyzeAsync(
            PtvMetadataAiAnalysisInput input,
            string? configuredModel,
            CancellationToken cancellationToken) => Task.FromResult(new PtvMetadataAiAnalysisResult());

        public Task<PtvMetadataAiConnectionTestResponse> TestConnectionAsync(
            string? configuredModel,
            CancellationToken cancellationToken) => Task.FromResult(new PtvMetadataAiConnectionTestResponse());
    }
}
