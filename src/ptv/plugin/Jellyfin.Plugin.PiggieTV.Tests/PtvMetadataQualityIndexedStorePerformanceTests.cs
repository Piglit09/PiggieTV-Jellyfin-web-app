using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using Xunit.Abstractions;

namespace Jellyfin.Plugin.PiggieTV.Tests;

/// <summary>
/// Opt-in production-scale benchmark for the Metadata Quality JSON-to-index migration and indexed reads.
/// </summary>
public sealed class PtvMetadataQualityIndexedStorePerformanceTests : IDisposable
{
    private const string EnabledEnvironmentVariable = "PTV_RUN_METADATA_QUALITY_INDEX_BENCHMARK";
    private const string RecordCountEnvironmentVariable = "PTV_METADATA_QUALITY_INDEX_BENCHMARK_RECORDS";
    private const string WarmRepetitionsEnvironmentVariable = "PTV_METADATA_QUALITY_INDEX_BENCHMARK_WARM_REPETITIONS";
    private const int ProductionRecordCount = 132_474;
    private const int DefaultWarmRepetitions = 10;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false
    };

    private readonly string _root = Path.Combine(
        Path.GetTempPath(),
        "ptv-metadata-quality-index-performance",
        Guid.NewGuid().ToString("N"));
    private readonly ITestOutputHelper _output;

    public PtvMetadataQualityIndexedStorePerformanceTests(ITestOutputHelper output)
    {
        _output = output;
    }

    [MetadataQualityIndexedStoreBenchmarkFact]
    [Trait("Category", "Performance")]
    public async Task ProductionScaleStreamingImportAndIndexedReadsAreMeasured()
    {
        var recordCount = ReadBoundedInteger(
            RecordCountEnvironmentVariable,
            ProductionRecordCount,
            minimum: 1,
            maximum: ProductionRecordCount);
        var warmRepetitions = ReadBoundedInteger(
            WarmRepetitionsEnvironmentVariable,
            DefaultWarmRepetitions,
            minimum: 1,
            maximum: 100);

        await WarmRuntimeAsync();
        Directory.CreateDirectory(_root);
        var legacyStore = new PtvMetadataQualityStore(
            _root,
            NullLogger<PtvMetadataQualityStore>.Instance);

        var fixtureStarted = Stopwatch.GetTimestamp();
        await WriteRepresentativeDocumentAsync(legacyStore.ResultsPath, recordCount);
        var fixtureGenerationMs = Stopwatch.GetElapsedTime(fixtureStarted).TotalMilliseconds;
        var fixtureBytes = new FileInfo(legacyStore.ResultsPath).Length;

        var importStore = new PtvMetadataQualityIndexedStore(
            _root,
            legacyStore,
            NullLogger<PtvMetadataQualityIndexedStore>.Instance);
        ForceManagedCollection();
        var import = await MeasureWithManagedMemoryAsync(async () =>
        {
            await importStore.EnsureReadyAsync();
            return true;
        });
        var databaseBytes = new FileInfo(importStore.DatabasePath).Length;

        var readStore = new PtvMetadataQualityIndexedStore(
            _root,
            legacyStore,
            NullLogger<PtvMetadataQualityIndexedStore>.Instance);
        ForceManagedCollection();
        var reopen = await MeasureWithManagedMemoryAsync(async () =>
        {
            await readStore.EnsureReadyAsync();
            return true;
        });
        ForceManagedCollection();
        var cold = await MeasurePagePairAsync(readStore);
        Assert.Equal(recordCount, cold.Summary.Counts.TotalScanned);
        Assert.InRange(cold.Page.Items.Count, 0, PtvMetadataQualityConstants.MaximumPageSize);
        if (recordCount >= 200)
        {
            Assert.Equal(PtvMetadataQualityConstants.MaximumPageSize, cold.Page.Items.Count);
        }

        var expectedFingerprint = CreateResponseFingerprint(cold.Summary, cold.Page);
        var warm = new List<PagePairSample>(warmRepetitions);
        for (var repetition = 0; repetition < warmRepetitions; repetition++)
        {
            var sample = await MeasurePagePairAsync(readStore);
            Assert.Equal(expectedFingerprint, CreateResponseFingerprint(sample.Summary, sample.Page));
            warm.Add(sample);
        }

        var detailItemId = cold.Page.Items.FirstOrDefault()?.ItemId ?? CreateGuid(1);
        var expectedDetail = Assert.IsType<PtvMetadataQualityResult>(
            await readStore.ReadResultAsync(detailItemId));
        var expectedEquivalence = CreateEquivalenceFingerprints(cold.Summary, cold.Page, expectedDetail);
        var lifecycleTimestamp = DateTimeOffset.Parse("2026-08-15T12:00:00Z");
        var noChangeRun = new PtvMetadataQualityScanRun
        {
            RunId = CreateGuid(recordCount + 20),
            Mode = "changed",
            State = PtvMetadataQualityScanStates.Running,
            StartedAt = lifecycleTimestamp.AddSeconds(-1),
            ItemsConsidered = recordCount,
            ItemCount = recordCount,
            ItemsSkipped = recordCount,
            Healthy = cold.Summary.Counts.Healthy,
            Review = cold.Summary.Counts.NeedsReview,
            LikelyWrong = cold.Summary.Counts.LikelyIncorrect,
            Incomplete = cold.Summary.Counts.Incomplete,
            Unavailable = cold.Summary.Counts.Unavailable,
            ProgressPercent = 100
        };
        ForceManagedCollection();
        var lifecycle = await MeasureGenerationLifecycleAsync(
            readStore.DatabasePath,
            async () =>
            {
                var begin = await MeasureWithManagedMemoryAsync(() => readStore.BeginGenerationAsync(
                    noChangeRun,
                    resetAllResults: false,
                    resetLibraryIds: [],
                    CancellationToken.None));
                var afterBeginStorage = CaptureSqliteStorage(readStore.DatabasePath);
                noChangeRun.State = PtvMetadataQualityScanStates.Completed;
                noChangeRun.CompletedAt = lifecycleTimestamp;
                var complete = await MeasureWithManagedMemoryAsync(async () =>
                {
                    await readStore.CompleteGenerationAsync(begin.Value.GenerationId, noChangeRun);
                    return true;
                });
                return new GenerationLifecyclePayload(
                    begin,
                    complete,
                    afterBeginStorage);
            });

        var postLifecycle = await MeasurePagePairAsync(readStore);
        var postLifecycleDetail = Assert.IsType<PtvMetadataQualityResult>(
            await readStore.ReadResultAsync(detailItemId));
        var actualEquivalence = CreateEquivalenceFingerprints(
            postLifecycle.Summary,
            postLifecycle.Page,
            postLifecycleDetail);
        Assert.Equal(expectedFingerprint, CreateResponseFingerprint(postLifecycle.Summary, postLifecycle.Page));
        Assert.Equal(expectedEquivalence, actualEquivalence);
        Assert.Equal(lifecycle.Value.Begin.Value.GenerationId, postLifecycle.Summary.GenerationId);
        var generationStates = await ReadGenerationStatesAsync(readStore.DatabasePath);
        Assert.Equal(1, generationStates.Active);
        Assert.InRange(generationStates.Retired, 0, 1);
        Assert.Equal(0, generationStates.Building);
        Assert.Equal(0, generationStates.Validating);
        Assert.Equal(0, generationStates.Failed);
        Assert.Equal(
            generationStates.Active + generationStates.Retired,
            generationStates.Total);

        var queryPlan = await CaptureDefaultQueryPlanAsync(importStore.DatabasePath);
        Assert.Contains(queryPlan.Page, entry =>
            entry.Detail.Contains("mq_result", StringComparison.OrdinalIgnoreCase)
            && entry.Detail.Contains("INDEX", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(queryPlan.Page, entry =>
            entry.Detail.Contains("TEMP B-TREE FOR ORDER BY", StringComparison.OrdinalIgnoreCase));

        var report = new
        {
            benchmark = "metadata-quality-index-v2",
            fullScaleRecordTarget = ProductionRecordCount,
            actualRecords = recordCount,
            productionScale = recordCount == ProductionRecordCount,
            runtimeWarmed = true,
            fixture = new
            {
                bytes = fixtureBytes,
                generationMs = Round(fixtureGenerationMs)
            },
            import = new
            {
                wallMs = Round(import.Milliseconds),
                rowsPerSecond = Round(recordCount / Math.Max(import.Milliseconds / 1000D, 0.000001D)),
                databaseBytes,
                databaseBytesPerRecord = Round((double)databaseBytes / recordCount),
                managedMemory = CreateMemoryReport(import.Memory)
            },
            activeProcessReopen = new
            {
                wallMs = Round(reopen.Milliseconds),
                managedMemory = CreateMemoryReport(reopen.Memory)
            },
            cold = new
            {
                pairWallMs = Round(cold.PairMilliseconds),
                defaultPageMs = Round(cold.PageMilliseconds),
                summaryMs = Round(cold.SummaryMilliseconds),
                totalMatchingReviewRows = cold.Page.TotalRecordCount,
                rowsReturned = cold.Page.Items.Count,
                pageDiagnostics = cold.Page.Diagnostics,
                summaryDiagnostics = cold.Summary.Diagnostics,
                managedMemory = CreateMemoryReport(cold.Memory)
            },
            warm = new
            {
                repetitions = warm.Count,
                pair = Summarize(warm.Select(sample => sample.PairMilliseconds)),
                defaultPage = Summarize(warm.Select(sample => sample.PageMilliseconds)),
                summary = Summarize(warm.Select(sample => sample.SummaryMilliseconds)),
                managedMemory = new
                {
                    allocated = SummarizeBytes(warm.Select(sample => sample.Memory.TotalAllocatedBytes)),
                    approximatePeakIncrease = SummarizeBytes(warm.Select(sample => sample.Memory.ApproximatePeakIncreaseBytes)),
                    endingDelta = SummarizeBytes(warm.Select(sample => sample.Memory.EndingDeltaBytes))
                }
            },
            noChangeIncrementalGeneration = new
            {
                beginClone = new
                {
                    wallMs = Round(lifecycle.Value.Begin.Milliseconds),
                    rowsPerSecond = Round(recordCount / Math.Max(
                        lifecycle.Value.Begin.Milliseconds / 1000D,
                        0.000001D)),
                    managedMemory = CreateMemoryReport(lifecycle.Value.Begin.Memory)
                },
                completeValidateExportActivate = new
                {
                    wallMs = Round(lifecycle.Value.Complete.Milliseconds),
                    rowsPerSecond = Round(recordCount / Math.Max(
                        lifecycle.Value.Complete.Milliseconds / 1000D,
                        0.000001D)),
                    managedMemory = CreateMemoryReport(lifecycle.Value.Complete.Memory)
                },
                total = new
                {
                    wallMs = Round(lifecycle.Milliseconds),
                    rowsPerSecond = Round(recordCount / Math.Max(
                        lifecycle.Milliseconds / 1000D,
                        0.000001D)),
                    managedMemory = CreateMemoryReport(lifecycle.Memory)
                },
                storage = new
                {
                    before = CreateStorageReport(lifecycle.Storage.Before),
                    afterBeginClone = CreateStorageReport(lifecycle.Value.AfterBeginStorage),
                    final = CreateStorageReport(lifecycle.Storage.After),
                    sampledPeak = CreateStorageReport(lifecycle.Storage.SampledPeak)
                },
                generations = generationStates,
                postActivation = new
                {
                    pairWallMs = Round(postLifecycle.PairMilliseconds),
                    defaultPageMs = Round(postLifecycle.PageMilliseconds),
                    summaryMs = Round(postLifecycle.SummaryMilliseconds),
                    rowsReturned = postLifecycle.Page.Items.Count
                },
                equivalence = new
                {
                    before = expectedEquivalence,
                    after = actualEquivalence,
                    unchanged = expectedEquivalence == actualEquivalence
                }
            },
            defaultReviewQueryPlan = new
            {
                count = queryPlan.Count,
                page = queryPlan.Page,
                usesResultIndex = queryPlan.Page.Any(entry =>
                    entry.Detail.Contains("mq_result", StringComparison.OrdinalIgnoreCase)
                    && entry.Detail.Contains("INDEX", StringComparison.OrdinalIgnoreCase)),
                usesTemporaryOrderBySort = queryPlan.Page.Any(entry =>
                    entry.Detail.Contains("TEMP B-TREE FOR ORDER BY", StringComparison.OrdinalIgnoreCase))
            },
            responseFingerprint = expectedFingerprint
        };

        _output.WriteLine(JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }

    private static async Task<PagePairSample> MeasurePagePairAsync(PtvMetadataQualityIndexedStore store)
    {
        var measured = await MeasureWithManagedMemoryAsync(async () =>
        {
            var pageTask = MeasureAsync(() => store.QueryResultsAsync(CreateDefaultQuery()));
            var summaryTask = MeasureAsync(() => store.ReadSummaryAsync());
            await Task.WhenAll(pageTask, summaryTask);
            return new PagePairPayload(await pageTask, await summaryTask);
        });
        return new PagePairSample(
            measured.Milliseconds,
            measured.Value.Page.Milliseconds,
            measured.Value.Summary.Milliseconds,
            measured.Value.Page.Value,
            measured.Value.Summary.Value,
            measured.Memory);
    }

    private static PtvMetadataQualityResultQuery CreateDefaultQuery() => new()
    {
        Status = PtvMetadataQualityStatuses.Review,
        Sort = "priority",
        StartIndex = 0,
        Limit = PtvMetadataQualityConstants.MaximumPageSize
    };

    private static async Task<TimedValue<T>> MeasureAsync<T>(Func<Task<T>> operation)
    {
        var started = Stopwatch.GetTimestamp();
        var value = await operation();
        return new TimedValue<T>(Stopwatch.GetElapsedTime(started).TotalMilliseconds, value);
    }

    private static async Task<MeasuredOperation<T>> MeasureWithManagedMemoryAsync<T>(Func<Task<T>> operation)
    {
        var baselineBytes = GC.GetTotalMemory(forceFullCollection: false);
        var allocatedBytesBefore = GC.GetTotalAllocatedBytes(precise: false);
        var peak = new ManagedHeapPeakTracker(baselineBytes);
        using var samplingCancellation = new CancellationTokenSource();
        var samplingTask = SampleManagedHeapAsync(peak, samplingCancellation.Token);
        var started = Stopwatch.GetTimestamp();

        try
        {
            var value = await operation();
            var elapsed = Stopwatch.GetElapsedTime(started).TotalMilliseconds;
            var endingBytes = GC.GetTotalMemory(forceFullCollection: false);
            peak.Observe(endingBytes);
            var allocatedBytesAfter = GC.GetTotalAllocatedBytes(precise: false);
            return new MeasuredOperation<T>(
                elapsed,
                value,
                new ManagedMemorySample(
                    baselineBytes,
                    endingBytes,
                    endingBytes - baselineBytes,
                    peak.PeakBytes,
                    Math.Max(0, peak.PeakBytes - baselineBytes),
                    Math.Max(0, allocatedBytesAfter - allocatedBytesBefore)));
        }
        finally
        {
            samplingCancellation.Cancel();
            await samplingTask;
        }
    }

    private static async Task<GenerationLifecycleMeasurement<T>> MeasureGenerationLifecycleAsync<T>(
        string databasePath,
        Func<Task<T>> operation)
    {
        var before = CaptureSqliteStorage(databasePath);
        var storagePeak = new SqliteStoragePeakTracker(before);
        using var samplingCancellation = new CancellationTokenSource();
        var samplingTask = SampleSqliteStorageAsync(
            databasePath,
            storagePeak,
            samplingCancellation.Token);
        try
        {
            var measured = await MeasureWithManagedMemoryAsync(operation);
            var after = CaptureSqliteStorage(databasePath);
            storagePeak.Observe(after);
            return new GenerationLifecycleMeasurement<T>(
                measured.Milliseconds,
                measured.Value,
                measured.Memory,
                new SqliteStorageMeasurement(before, after, storagePeak.Peak));
        }
        finally
        {
            samplingCancellation.Cancel();
            await samplingTask;
        }
    }

    private static async Task SampleManagedHeapAsync(
        ManagedHeapPeakTracker peak,
        CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(5));
        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken))
            {
                peak.Observe(GC.GetTotalMemory(forceFullCollection: false));
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Sampling ends with the measured operation.
        }
    }

    private static async Task SampleSqliteStorageAsync(
        string databasePath,
        SqliteStoragePeakTracker peak,
        CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(25));
        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken))
            {
                peak.Observe(CaptureSqliteStorage(databasePath));
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Sampling ends with the measured generation lifecycle.
        }
    }

    private static void ForceManagedCollection()
    {
        GC.Collect(GC.MaxGeneration, GCCollectionMode.Forced, blocking: true, compacting: true);
        GC.WaitForPendingFinalizers();
        GC.Collect(GC.MaxGeneration, GCCollectionMode.Forced, blocking: true, compacting: true);
    }

    private static object CreateMemoryReport(ManagedMemorySample memory) => new
    {
        baselineBytes = memory.BaselineBytes,
        endingBytes = memory.EndingBytes,
        endingDeltaBytes = memory.EndingDeltaBytes,
        approximatePeakBytes = memory.ApproximatePeakBytes,
        approximatePeakIncreaseBytes = memory.ApproximatePeakIncreaseBytes,
        totalAllocatedBytes = memory.TotalAllocatedBytes,
        approximatePeakIncreaseMiB = Round(memory.ApproximatePeakIncreaseBytes / (1024D * 1024D)),
        totalAllocatedMiB = Round(memory.TotalAllocatedBytes / (1024D * 1024D))
    };

    private static SqliteStorageSnapshot CaptureSqliteStorage(string databasePath)
    {
        var databaseBytes = ReadFileLength(databasePath);
        var walBytes = ReadFileLength(databasePath + "-wal");
        var journalBytes = ReadFileLength(databasePath + "-journal");
        var sharedMemoryBytes = ReadFileLength(databasePath + "-shm");
        return new SqliteStorageSnapshot(
            databaseBytes,
            walBytes,
            journalBytes,
            sharedMemoryBytes,
            checked(databaseBytes + walBytes + journalBytes + sharedMemoryBytes));
    }

    private static long ReadFileLength(string path)
    {
        try
        {
            return File.Exists(path) ? new FileInfo(path).Length : 0;
        }
        catch (IOException)
        {
            return 0;
        }
    }

    private static object CreateStorageReport(SqliteStorageSnapshot storage) => new
    {
        databaseBytes = storage.DatabaseBytes,
        walBytes = storage.WalBytes,
        journalBytes = storage.JournalBytes,
        sharedMemoryBytes = storage.SharedMemoryBytes,
        totalSqliteBytes = storage.TotalSqliteBytes,
        totalSqliteMiB = Round(storage.TotalSqliteBytes / (1024D * 1024D))
    };

    private static async Task<GenerationStateCounts> ReadGenerationStatesAsync(string databasePath)
    {
        var builder = new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadOnly,
            Cache = SqliteCacheMode.Private,
            Pooling = false
        };
        await using var connection = new SqliteConnection(builder.ToString());
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT state, COUNT(*) FROM mq_generation GROUP BY state;";
        var states = new Dictionary<string, int>(StringComparer.Ordinal);
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            states[reader.GetString(0)] = checked((int)reader.GetInt64(1));
        }

        return new GenerationStateCounts(
            states.Values.Sum(),
            states.GetValueOrDefault("ACTIVE"),
            states.GetValueOrDefault("RETIRED"),
            states.GetValueOrDefault("BUILDING"),
            states.GetValueOrDefault("VALIDATING"),
            states.GetValueOrDefault("FAILED"));
    }

    private static async Task<DefaultQueryPlan> CaptureDefaultQueryPlanAsync(string databasePath)
    {
        var builder = new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadOnly,
            Cache = SqliteCacheMode.Private,
            Pooling = false
        };
        await using var connection = new SqliteConnection(builder.ToString());
        connection.CreateCollation(
            "PTV_ORDINAL_NOCASE",
            static (left, right) => StringComparer.OrdinalIgnoreCase.Compare(left, right));
        await connection.OpenAsync();

        string generationId;
        await using (var generationCommand = connection.CreateCommand())
        {
            generationCommand.CommandText = "SELECT active_generation_id FROM mq_store_state WHERE id = 1;";
            generationId = Assert.IsType<string>(await generationCommand.ExecuteScalarAsync());
        }

        const string defaultReviewWhere = """
            AND r.raw_status COLLATE PTV_ORDINAL_NOCASE = @status COLLATE PTV_ORDINAL_NOCASE
            AND NOT (
                o.item_id IS NOT NULL
                AND (o.dismissed = 1 OR o.resolution_state IN ('kept_current', 'corrected')))
            """;
        var count = await ReadExplainPlanAsync(
            connection,
            $"""
            EXPLAIN QUERY PLAN
            SELECT COUNT(*)
            FROM mq_result r
            LEFT JOIN mq_review_state o
                ON o.item_id = r.item_id AND o.scan_fingerprint = r.scan_fingerprint
            WHERE r.generation_id = @generation {defaultReviewWhere};
            """,
            generationId,
            includePageParameters: false);
        var page = await ReadExplainPlanAsync(
            connection,
            $"""
            EXPLAIN QUERY PLAN
            SELECT r.detail_json,
                   o.dismissed, o.dismissed_at_ticks, o.dismissed_fingerprint,
                   o.dismissed_reason_signature, o.resolution_json
            FROM mq_result r
            LEFT JOIN mq_review_state o
                ON o.item_id = r.item_id AND o.scan_fingerprint = r.scan_fingerprint
            WHERE r.generation_id = @generation {defaultReviewWhere}
            ORDER BY r.match_confidence ASC, r.scanned_at_ticks DESC, r.source_ordinal ASC
            LIMIT @limit OFFSET @offset;
            """,
            generationId,
            includePageParameters: true);
        return new DefaultQueryPlan(count, page);
    }

    private static async Task<IReadOnlyList<ExplainPlanEntry>> ReadExplainPlanAsync(
        SqliteConnection connection,
        string commandText,
        string generationId,
        bool includePageParameters)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = commandText;
        command.Parameters.AddWithValue("@generation", generationId);
        command.Parameters.AddWithValue("@status", PtvMetadataQualityStatuses.Review);
        if (includePageParameters)
        {
            command.Parameters.AddWithValue("@limit", PtvMetadataQualityConstants.MaximumPageSize);
            command.Parameters.AddWithValue("@offset", 0);
        }

        var entries = new List<ExplainPlanEntry>();
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            entries.Add(new ExplainPlanEntry(
                reader.GetInt64(0),
                reader.GetInt64(1),
                reader.GetInt64(2),
                reader.GetString(3)));
        }

        return entries;
    }

    private static async Task WarmRuntimeAsync()
    {
        var root = Path.Combine(
            Path.GetTempPath(),
            "ptv-metadata-quality-index-warmup",
            Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(root);
            var legacyStore = new PtvMetadataQualityStore(
                root,
                NullLogger<PtvMetadataQualityStore>.Instance);
            await WriteRepresentativeDocumentAsync(legacyStore.ResultsPath, 4);
            var indexedStore = new PtvMetadataQualityIndexedStore(
                root,
                legacyStore,
                NullLogger<PtvMetadataQualityIndexedStore>.Instance);
            await indexedStore.EnsureReadyAsync();
            await indexedStore.QueryResultsAsync(CreateDefaultQuery());
            await indexedStore.ReadSummaryAsync();
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    private static async Task WriteRepresentativeDocumentAsync(string path, int recordCount)
    {
        await using var stream = new FileStream(
            path,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None,
            1024 * 1024,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        using var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Indented = false });
        var timestamp = DateTimeOffset.Parse("2026-08-15T12:00:00Z");

        writer.WriteStartObject();
        writer.WriteNumber("schemaVersion", PtvMetadataQualityConstants.SchemaVersion);
        writer.WriteString("scannerVersion", PtvMetadataQualityConstants.ScannerVersion);
        writer.WriteString("ruleVersion", PtvMetadataQualityConstants.RuleVersion);
        writer.WriteString("updatedAt", timestamp);
        writer.WriteString("lastFullScan", timestamp.AddDays(-1));
        writer.WriteString("lastIncrementalScan", timestamp);
        writer.WritePropertyName("itemResults");
        writer.WriteStartObject();

        for (var index = 0; index < recordCount; index++)
        {
            var result = CreateRepresentativeResult(index, timestamp);
            writer.WritePropertyName(result.ItemId.ToString("N"));
            JsonSerializer.Serialize(writer, result, JsonOptions);
            if ((index + 1) % 1_000 == 0)
            {
                await writer.FlushAsync();
            }
        }

        writer.WriteEndObject();
        writer.WritePropertyName("scanRuns");
        writer.WriteStartArray();
        JsonSerializer.Serialize(writer, new PtvMetadataQualityScanRun
        {
            RunId = CreateGuid(recordCount + 10),
            Mode = "full",
            State = PtvMetadataQualityScanStates.Completed,
            StartedAt = timestamp.AddMinutes(-30),
            CompletedAt = timestamp,
            ItemsConsidered = recordCount,
            ItemCount = recordCount,
            ItemsScanned = recordCount,
            ProgressPercent = 100
        }, JsonOptions);
        writer.WriteEndArray();
        writer.WriteEndObject();
        await writer.FlushAsync();
        await stream.FlushAsync();
    }

    private static PtvMetadataQualityResult CreateRepresentativeResult(int index, DateTimeOffset timestamp)
    {
        var itemId = CreateGuid(index + 1);
        var libraryNumber = index % 24;
        var libraryId = CreateGuid(1_000_000 + libraryNumber);
        var status = SelectStatus(index);
        var matchConfidence = status switch
        {
            PtvMetadataQualityStatuses.LikelyWrong => 25 + (index % 20),
            PtvMetadataQualityStatuses.Review => 50 + (index % 20),
            PtvMetadataQualityStatuses.Incomplete => 82 + (index % 12),
            PtvMetadataQualityStatuses.Unavailable => 45,
            _ => 92 + (index % 9)
        };
        var completeness = status == PtvMetadataQualityStatuses.Incomplete
            ? 45 + (index % 25)
            : 90 + (index % 11);
        var itemType = SelectItemType(index);
        var providerName = itemType is "Book" ? "Google Books" : "TMDb";
        var providerKey = itemType is "Book" ? "GoogleBooks" : "Tmdb";
        var title = $"Representative {itemType} {index:D6}";
        var currentMatch = new PtvMetadataMatchSummary
        {
            Name = title,
            ProductionYear = 1980 + (index % 45),
            ProviderName = providerName,
            Type = itemType,
            TypeVerified = true,
            RuntimeMinutes = 80 + (index % 70),
            ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                [providerKey] = $"current-{index:D8}"
            }
        };
        var flagged = status is PtvMetadataQualityStatuses.LikelyWrong or PtvMetadataQualityStatuses.Review;
        var reasons = CreateReasons(status, index);

        return new PtvMetadataQualityResult
        {
            ItemId = itemId,
            LibraryId = libraryId,
            LibraryName = $"Library {libraryNumber:D2}",
            ItemType = itemType,
            Title = title,
            FileName = $"Representative.Title.{index:D6}.2026.cbz",
            FolderName = $"Representative Title {index:D6}",
            ScanFingerprint = $"fixture-fingerprint-{index:D8}",
            ScannedAt = timestamp.AddSeconds(-(index % 86_400)),
            Status = status,
            MatchConfidence = matchConfidence,
            CompletenessScore = completeness,
            RuleScore = matchConfidence,
            ProviderScore = flagged ? Math.Min(100, matchConfidence + 8) : null,
            AiScore = index % 20 == 0 ? matchConfidence + 2 : null,
            Signals = new PtvMetadataQualitySignals
            {
                FilenameTitleSimilarity = 0.55 + ((index % 40) / 100D),
                FolderTitleSimilarity = 0.60 + ((index % 35) / 100D),
                FilenameYear = 1980 + (index % 45),
                YearDifference = flagged ? 5 + (index % 20) : 0,
                RuntimeDifferencePercent = flagged ? 12 + (index % 25) : 2,
                ProviderIdPresent = true,
                ProviderIdConflict = status == PtvMetadataQualityStatuses.LikelyWrong,
                MissingPrimaryImage = status == PtvMetadataQualityStatuses.Incomplete,
                MissingOverview = status == PtvMetadataQualityStatuses.Incomplete,
                CandidateCount = flagged ? 2 : 0
            },
            Reasons = reasons,
            CurrentMatch = currentMatch,
            SuggestedMatch = flagged ? new PtvMetadataMatchSummary
            {
                Name = $"Suggested {itemType} {index:D6}",
                ProductionYear = 1980 + (index % 45),
                ProviderName = providerName,
                Type = itemType,
                TypeVerified = true,
                RuntimeMinutes = 81 + (index % 70),
                ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                {
                    [providerKey] = $"suggested-{index:D8}"
                }
            } : null,
            Candidates = flagged ?
            [
                new PtvMetadataQualityCandidate
                {
                    Name = $"Suggested {itemType} {index:D6}",
                    ProductionYear = 1980 + (index % 45),
                    Type = itemType,
                    TypeVerified = true,
                    RuntimeMinutes = 81 + (index % 70),
                    ProviderIds = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                    {
                        [providerKey] = $"suggested-{index:D8}"
                    },
                    Score = Math.Min(100, matchConfidence + 8),
                    Source = providerName
                }
            ] : [],
            ProviderVerified = flagged,
            AiReviewed = index % 20 == 0,
            AiProvider = index % 20 == 0 ? "OpenAI" : null,
            AiModel = index % 20 == 0 ? "benchmark-model" : null,
            AiPromptVersion = index % 20 == 0 ? "benchmark-prompt" : null,
            Dismissed = index % 997 == 0,
            DismissedAt = index % 997 == 0 ? timestamp : null,
            DismissedFingerprint = index % 997 == 0 ? $"fixture-fingerprint-{index:D8}" : null,
            DismissedReasonSignature = index % 997 == 0
                ? string.Join('|', reasons.Select(reason => reason.Code))
                : null
        };
    }

    private static List<PtvMetadataQualityReason> CreateReasons(string status, int index) => status switch
    {
        PtvMetadataQualityStatuses.LikelyWrong =>
        [
            CreateReason(PtvMetadataQualityReasonCodes.ProviderIdConflict, "error", -35, $"provider-{index:D8}"),
            CreateReason(PtvMetadataQualityReasonCodes.YearMismatch, "warning", -20, $"year-{index % 45}")
        ],
        PtvMetadataQualityStatuses.Review =>
        [
            CreateReason(PtvMetadataQualityReasonCodes.TitleMismatch, "warning", -18, $"title-{index:D8}"),
            CreateReason(PtvMetadataQualityReasonCodes.BetterProviderCandidate, "info", -8, $"candidate-{index:D8}")
        ],
        PtvMetadataQualityStatuses.Incomplete =>
        [
            CreateReason(PtvMetadataQualityReasonCodes.MissingArtwork, "info", 0, null),
            CreateReason(PtvMetadataQualityReasonCodes.MissingOverview, "info", 0, null)
        ],
        PtvMetadataQualityStatuses.Unavailable =>
        [
            CreateReason(PtvMetadataQualityReasonCodes.ItemAnalysisFailed, "warning", 0, null)
        ],
        _ => []
    };

    private static PtvMetadataQualityReason CreateReason(
        string code,
        string severity,
        int scoreImpact,
        string? evidence) => new()
        {
            Code = code,
            Severity = severity,
            ScoreImpact = scoreImpact,
            Message = $"Representative benchmark reason: {code}",
            Evidence = evidence
        };

    private static string SelectStatus(int index) => (index % 20) switch
    {
        0 or 1 => PtvMetadataQualityStatuses.LikelyWrong,
        2 or 3 or 4 or 5 or 6 => PtvMetadataQualityStatuses.Review,
        7 or 8 or 9 => PtvMetadataQualityStatuses.Incomplete,
        10 => PtvMetadataQualityStatuses.Unavailable,
        _ => PtvMetadataQualityStatuses.Healthy
    };

    private static string SelectItemType(int index) => (index % 8) switch
    {
        0 or 1 => "Movie",
        2 => "Series",
        3 or 4 => "Episode",
        5 => "Book",
        6 => "Audio",
        _ => "MusicAlbum"
    };

    private static Guid CreateGuid(int value) => new(
        value,
        (short)(value >> 16),
        (short)value,
        0x50,
        0x54,
        0x56,
        0x4D,
        0x51,
        0x42,
        (byte)(value >> 8),
        (byte)value);

    private static string CreateResponseFingerprint(
        PtvMetadataQualityIndexedSummary summary,
        PtvMetadataQualityIndexedPage page)
    {
        var contract = new
        {
            summary.Counts,
            summary.LastScanAt,
            summary.RuleVersion,
            summary.ScannerVersion,
            page.TotalRecordCount,
            page.StartIndex,
            page.Limit,
            page.Items
        };
        return CreateContractFingerprint(contract);
    }

    private static EquivalenceFingerprints CreateEquivalenceFingerprints(
        PtvMetadataQualityIndexedSummary summary,
        PtvMetadataQualityIndexedPage page,
        PtvMetadataQualityResult detail) => new(
            CreateContractFingerprint(new
            {
                summary.Counts,
                summary.LastScanAt,
                summary.RuleVersion,
                summary.ScannerVersion,
                summary.CompatibilityFingerprint
            }),
            CreateContractFingerprint(new
            {
                page.TotalRecordCount,
                page.StartIndex,
                page.Limit,
                page.Items
            }),
            CreateContractFingerprint(detail));

    private static string CreateContractFingerprint<T>(T contract) => Convert.ToHexString(
        SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(contract, JsonOptions)));

    private static object Summarize(IEnumerable<double> values)
    {
        var ordered = values.Order().ToArray();
        return new
        {
            medianMs = Round(Percentile(ordered, 0.50)),
            p90Ms = Round(Percentile(ordered, 0.90)),
            p95Ms = Round(Percentile(ordered, 0.95)),
            minimumMs = Round(ordered.FirstOrDefault()),
            maximumMs = Round(ordered.LastOrDefault())
        };
    }

    private static object SummarizeBytes(IEnumerable<long> values)
    {
        var ordered = values.Select(value => (double)value).Order().ToArray();
        var median = Percentile(ordered, 0.50);
        var p90 = Percentile(ordered, 0.90);
        var p95 = Percentile(ordered, 0.95);
        var minimum = ordered.FirstOrDefault();
        var maximum = ordered.LastOrDefault();
        return new
        {
            medianBytes = checked((long)median),
            p90Bytes = checked((long)p90),
            p95Bytes = checked((long)p95),
            minimumBytes = checked((long)minimum),
            maximumBytes = checked((long)maximum),
            medianMiB = Round(median / (1024D * 1024D)),
            p95MiB = Round(p95 / (1024D * 1024D))
        };
    }

    private static double Percentile(IReadOnlyList<double> ordered, double percentile)
    {
        if (ordered.Count == 0) return 0;
        var index = (int)Math.Ceiling(percentile * ordered.Count) - 1;
        return ordered[Math.Clamp(index, 0, ordered.Count - 1)];
    }

    private static double Round(double value) => Math.Round(value, 2);

    private static int ReadBoundedInteger(string environmentVariable, int fallback, int minimum, int maximum)
    {
        var raw = Environment.GetEnvironmentVariable(environmentVariable);
        if (string.IsNullOrWhiteSpace(raw)) return fallback;
        Assert.True(int.TryParse(raw, out var parsed), $"{environmentVariable} must contain an integer.");
        Assert.InRange(parsed, minimum, maximum);
        return parsed;
    }

    private sealed record TimedValue<T>(double Milliseconds, T Value);

    private sealed record MeasuredOperation<T>(
        double Milliseconds,
        T Value,
        ManagedMemorySample Memory);

    private sealed record ManagedMemorySample(
        long BaselineBytes,
        long EndingBytes,
        long EndingDeltaBytes,
        long ApproximatePeakBytes,
        long ApproximatePeakIncreaseBytes,
        long TotalAllocatedBytes);

    private sealed record GenerationLifecycleMeasurement<T>(
        double Milliseconds,
        T Value,
        ManagedMemorySample Memory,
        SqliteStorageMeasurement Storage);

    private sealed record GenerationLifecyclePayload(
        MeasuredOperation<PtvMetadataQualityGenerationHandle> Begin,
        MeasuredOperation<bool> Complete,
        SqliteStorageSnapshot AfterBeginStorage);

    private sealed record SqliteStorageMeasurement(
        SqliteStorageSnapshot Before,
        SqliteStorageSnapshot After,
        SqliteStorageSnapshot SampledPeak);

    private sealed record SqliteStorageSnapshot(
        long DatabaseBytes,
        long WalBytes,
        long JournalBytes,
        long SharedMemoryBytes,
        long TotalSqliteBytes);

    private sealed record GenerationStateCounts(
        int Total,
        int Active,
        int Retired,
        int Building,
        int Validating,
        int Failed);

    private sealed record EquivalenceFingerprints(
        string Summary,
        string Page,
        string Detail);

    private sealed record PagePairPayload(
        TimedValue<PtvMetadataQualityIndexedPage> Page,
        TimedValue<PtvMetadataQualityIndexedSummary> Summary);

    private sealed record PagePairSample(
        double PairMilliseconds,
        double PageMilliseconds,
        double SummaryMilliseconds,
        PtvMetadataQualityIndexedPage Page,
        PtvMetadataQualityIndexedSummary Summary,
        ManagedMemorySample Memory);

    private sealed record DefaultQueryPlan(
        IReadOnlyList<ExplainPlanEntry> Count,
        IReadOnlyList<ExplainPlanEntry> Page);

    private sealed record ExplainPlanEntry(
        long Id,
        long Parent,
        long NotUsed,
        string Detail);

    private sealed class ManagedHeapPeakTracker
    {
        private long _peakBytes;

        public ManagedHeapPeakTracker(long baselineBytes)
        {
            _peakBytes = baselineBytes;
        }

        public long PeakBytes => Volatile.Read(ref _peakBytes);

        public void Observe(long bytes)
        {
            var observed = Volatile.Read(ref _peakBytes);
            while (bytes > observed)
            {
                var previous = Interlocked.CompareExchange(ref _peakBytes, bytes, observed);
                if (previous == observed) return;
                observed = previous;
            }
        }
    }

    private sealed class SqliteStoragePeakTracker
    {
        private readonly object _sync = new();
        private SqliteStorageSnapshot _peak;

        public SqliteStoragePeakTracker(SqliteStorageSnapshot baseline)
        {
            _peak = baseline;
        }

        public SqliteStorageSnapshot Peak
        {
            get
            {
                lock (_sync)
                {
                    return _peak;
                }
            }
        }

        public void Observe(SqliteStorageSnapshot current)
        {
            lock (_sync)
            {
                _peak = new SqliteStorageSnapshot(
                    Math.Max(_peak.DatabaseBytes, current.DatabaseBytes),
                    Math.Max(_peak.WalBytes, current.WalBytes),
                    Math.Max(_peak.JournalBytes, current.JournalBytes),
                    Math.Max(_peak.SharedMemoryBytes, current.SharedMemoryBytes),
                    Math.Max(_peak.TotalSqliteBytes, current.TotalSqliteBytes));
            }
        }
    }
}

/// <summary>Skips the production-scale index benchmark unless explicitly enabled.</summary>
public sealed class MetadataQualityIndexedStoreBenchmarkFactAttribute : FactAttribute
{
    public MetadataQualityIndexedStoreBenchmarkFactAttribute()
    {
        if (!string.Equals(
            Environment.GetEnvironmentVariable("PTV_RUN_METADATA_QUALITY_INDEX_BENCHMARK"),
            "1",
            StringComparison.Ordinal))
        {
            Skip = "Set PTV_RUN_METADATA_QUALITY_INDEX_BENCHMARK=1 to run the opt-in indexed-store benchmark.";
        }
    }
}
