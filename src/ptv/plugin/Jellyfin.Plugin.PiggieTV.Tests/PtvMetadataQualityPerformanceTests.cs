using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using Xunit.Abstractions;

namespace Jellyfin.Plugin.PiggieTV.Tests;

/// <summary>
/// Opt-in cold-path benchmark for a real or synthetic Metadata Quality store.
/// The fixture path is supplied outside the repository and its metadata is never written to test output.
/// </summary>
public sealed class PtvMetadataQualityPerformanceTests : IDisposable
{
    private const string FixtureEnvironmentVariable = "PTV_METADATA_QUALITY_BENCHMARK_FILE";
    private const string ReportEnvironmentVariable = "PTV_METADATA_QUALITY_BENCHMARK_REPORT";
    private readonly string _root = Path.Combine(Path.GetTempPath(), "ptv-metadata-quality-performance", Guid.NewGuid().ToString("N"));
    private readonly ITestOutputHelper _output;

    public PtvMetadataQualityPerformanceTests(ITestOutputHelper output)
    {
        _output = output;
    }

    [MetadataQualityBenchmarkFact]
    [Trait("Category", "Performance")]
    public async Task ColdQueueAndSummaryBenchmarkIsBoundedAndRepeatable()
    {
        var fixturePath = Environment.GetEnvironmentVariable(FixtureEnvironmentVariable);
        Assert.False(string.IsNullOrWhiteSpace(fixturePath));

        fixturePath = Path.GetFullPath(fixturePath);
        Assert.True(File.Exists(fixturePath), $"Benchmark fixture does not exist: {fixturePath}");
        Directory.CreateDirectory(_root);
        var isolatedFixturePath = Path.Combine(_root, "metadata-quality.json");
        File.Copy(fixturePath, isolatedFixturePath, overwrite: true);
        var before = await CaptureFileIdentityAsync(isolatedFixturePath);

        await WarmUpJitAsync();

        var coldRuns = new List<BenchmarkSample>();
        var warmRuns = new List<BenchmarkSample>();
        var concurrentRuns = new List<ConcurrentBenchmarkSample>();
        string? expectedFingerprint = null;
        string? expectedCompatibilityFingerprint = null;

        for (var run = 0; run < 5; run++)
        {
            var service = CreateService(new PtvMetadataQualityStore(_root, NullLogger<PtvMetadataQualityStore>.Instance));
            var cold = await MeasureRealPagePairAsync(service);
            expectedFingerprint ??= cold.ResultFingerprint;
            expectedCompatibilityFingerprint ??= cold.CompatibilityFingerprint;
            Assert.Equal(expectedFingerprint, cold.ResultFingerprint);
            Assert.Equal(expectedCompatibilityFingerprint, cold.CompatibilityFingerprint);
            coldRuns.Add(cold);

            if (run == 0)
            {
                for (var warmRun = 0; warmRun < 10; warmRun++)
                {
                    var warm = await MeasureRealPagePairAsync(service);
                    Assert.Equal(expectedFingerprint, warm.ResultFingerprint);
                    Assert.Equal(expectedCompatibilityFingerprint, warm.CompatibilityFingerprint);
                    warmRuns.Add(warm);
                }
            }
        }

        foreach (var concurrency in new[] { 2, 5 })
        {
            var service = CreateService(new PtvMetadataQualityStore(_root, NullLogger<PtvMetadataQualityStore>.Instance));
            concurrentRuns.Add(await MeasureConcurrentPagePairsAsync(service, concurrency));
        }

        var after = await CaptureFileIdentityAsync(isolatedFixturePath);
        Assert.Equal(before, after);

        var report = new
        {
            fixtureBytes = new FileInfo(isolatedFixturePath).Length,
            fixtureUnchanged = true,
            cold = Summarize(coldRuns),
            warm = Summarize(warmRuns),
            samples = new { coldRuns, warmRuns, concurrentRuns },
            resultFingerprint = expectedFingerprint,
            compatibilityFingerprint = expectedCompatibilityFingerprint
        };
        var json = JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true });
        _output.WriteLine(json);

        var reportPath = Environment.GetEnvironmentVariable(ReportEnvironmentVariable);
        if (!string.IsNullOrWhiteSpace(reportPath))
        {
            await File.WriteAllTextAsync(Path.GetFullPath(reportPath), json);
        }
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
    }

    private static async Task<BenchmarkSample> MeasureRealPagePairAsync(PtvMetadataQualityService service)
    {
        var stopwatch = Stopwatch.StartNew();
        var resultsTask = service.GetResultsAsync(new PtvMetadataQualityResultQuery
        {
            Status = PtvMetadataQualityStatuses.Review,
            Sort = "attention",
            StartIndex = 0,
            Limit = PtvMetadataQualityConstants.MaximumPageSize
        });
        var summaryTask = service.GetSummaryAsync();
        var results = await resultsTask;
        var summary = await summaryTask;
        stopwatch.Stop();

        Assert.InRange(results.Items.Count, 0, PtvMetadataQualityConstants.MaximumPageSize);
        return new BenchmarkSample(
            stopwatch.Elapsed.TotalMilliseconds,
            summary.Counts.TotalScanned,
            results.TotalRecordCount,
            results.Items.Count,
            CreateResultFingerprint(summary, results),
            CreateCompatibilityFingerprint(summary, results),
            summary.Diagnostics,
            results.Diagnostics);
    }

    private static async Task<ConcurrentBenchmarkSample> MeasureConcurrentPagePairsAsync(
        PtvMetadataQualityService service,
        int concurrency)
    {
        var stopwatch = Stopwatch.StartNew();
        var responses = await Task.WhenAll(Enumerable.Range(0, concurrency).Select(_ => MeasureRealPagePairAsync(service)));
        stopwatch.Stop();

        var fingerprints = responses.Select(response => response.ResultFingerprint).Distinct(StringComparer.Ordinal).ToArray();
        Assert.Single(fingerprints);
        var storeReads = responses.Sum(response =>
            response.SummaryDiagnostics.Operations.GetValueOrDefault("storeReads")
            + response.ResultsDiagnostics.Operations.GetValueOrDefault("storeReads"));
        Assert.Equal(1, storeReads);
        return new ConcurrentBenchmarkSample(
            concurrency,
            stopwatch.Elapsed.TotalMilliseconds,
            storeReads,
            responses.SelectMany(response => new[]
            {
                response.SummaryDiagnostics.CacheState,
                response.ResultsDiagnostics.CacheState
            }).ToArray(),
            fingerprints[0]);
    }

    private static object Summarize(IReadOnlyCollection<BenchmarkSample> samples)
    {
        var ordered = samples.Select(sample => sample.TotalMilliseconds).Order().ToArray();
        return new
        {
            repetitions = ordered.Length,
            medianMs = Percentile(ordered, 0.5),
            p90Ms = Percentile(ordered, 0.9),
            minimumMs = ordered.FirstOrDefault(),
            maximumMs = ordered.LastOrDefault()
        };
    }

    private static double Percentile(IReadOnlyList<double> ordered, double percentile)
    {
        if (ordered.Count == 0) return 0;
        var index = (int)Math.Ceiling(percentile * ordered.Count) - 1;
        return Math.Round(ordered[Math.Clamp(index, 0, ordered.Count - 1)], 2);
    }

    private static string CreateResultFingerprint(
        PtvMetadataQualitySummaryResponse summary,
        PtvMetadataQualityResultsResponse results)
    {
        var contract = new
        {
            Summary = new
            {
                summary.Counts,
                summary.LastScanAt,
                summary.Libraries,
                summary.RuleVersion,
                summary.ScannerVersion,
                summary.Scan
            },
            results.TotalRecordCount,
            results.StartIndex,
            results.Limit,
            results.Items
        };
        var bytes = JsonSerializer.SerializeToUtf8Bytes(contract);
        return Convert.ToHexString(SHA256.HashData(bytes));
    }

    private static string CreateCompatibilityFingerprint(
        PtvMetadataQualitySummaryResponse summary,
        PtvMetadataQualityResultsResponse results)
    {
        var contract = new
        {
            summary.Counts,
            summary.RuleVersion,
            summary.ScannerVersion,
            results.TotalRecordCount,
            Items = results.Items.Select(item => new
            {
                item.ItemId,
                item.Status,
                item.MatchConfidence,
                item.CompletenessScore,
                Reasons = item.Reasons.Select(reason => reason.Code),
                SuggestedProviderIds = item.SuggestedMatch?.ProviderIds
            })
        };
        return Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(contract)));
    }

    private static async Task WarmUpJitAsync()
    {
        var root = Path.Combine(Path.GetTempPath(), "ptv-metadata-quality-performance-warmup", Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(root);
            var store = new PtvMetadataQualityStore(root, NullLogger<PtvMetadataQualityStore>.Instance);
            await store.WriteAsync(new PtvMetadataQualityDocument());
            var service = CreateService(store);
            await MeasureRealPagePairAsync(service);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    private static async Task<FileIdentity> CaptureFileIdentityAsync(string path)
    {
        await using var stream = File.OpenRead(path);
        var hash = await SHA256.HashDataAsync(stream);
        var info = new FileInfo(path);
        return new FileIdentity(info.Length, info.LastWriteTimeUtc, Convert.ToHexString(hash));
    }

    private static PtvMetadataQualityService CreateService(IPtvMetadataQualityStore store) => new(
        () => [],
        (_, _, _) => new PtvMetadataQualityItemBatch([], 0),
        store,
        new PtvMetadataQualityRuleEngine(),
        new NoOpProviderVerifier(),
        new NoOpAiAnalyzer(),
        NullLogger<PtvMetadataQualityService>.Instance);

    private sealed class NoOpProviderVerifier : IPtvMetadataQualityProviderVerifier
    {
        public Task<PtvMetadataProviderVerificationResult> VerifyAsync(
            PtvMetadataProviderVerificationRequest request,
            PtvMetadataProviderVerificationBudget budget,
            CancellationToken cancellationToken) => Task.FromResult(new PtvMetadataProviderVerificationResult());
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

    private sealed record BenchmarkSample(
        double TotalMilliseconds,
        int ItemsEnumerated,
        int EligibleResults,
        int RowsReturned,
        string ResultFingerprint,
        string CompatibilityFingerprint,
        PtvMetadataQualityRequestDiagnostics SummaryDiagnostics,
        PtvMetadataQualityRequestDiagnostics ResultsDiagnostics);

    private sealed record ConcurrentBenchmarkSample(
        int Concurrency,
        double TotalMilliseconds,
        long StoreReads,
        IReadOnlyList<string> CacheStates,
        string ResultFingerprint);

    private sealed record FileIdentity(long Length, DateTime LastWriteTimeUtc, string Sha256);

}

/// <summary>Discovers the opt-in benchmark as skipped unless its private fixture is configured.</summary>
public sealed class MetadataQualityBenchmarkFactAttribute : FactAttribute
{
    public MetadataQualityBenchmarkFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("PTV_METADATA_QUALITY_BENCHMARK_FILE")))
        {
            Skip = "Set PTV_METADATA_QUALITY_BENCHMARK_FILE to run the opt-in cold-path benchmark.";
        }
    }
}
