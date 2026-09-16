using System.Text;
using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvMetadataQualityJsonStreamReaderTests
{
    [Fact]
    public async Task StreamsResultsInSourceOrderAndReturnsHeadersInArbitraryPropertyOrder()
    {
        var firstId = Guid.NewGuid();
        var secondId = Guid.NewGuid();
        var runId = Guid.NewGuid();
        var updatedAt = DateTimeOffset.Parse("2026-08-15T10:30:00Z");
        var lastFull = DateTimeOffset.Parse("2026-08-14T09:00:00Z");
        var lastIncremental = DateTimeOffset.Parse("2026-08-15T09:00:00Z");
        var json = $$"""
            {
              "unknownBefore": { "nested": [1, 2, { "future": true }] },
              "itemResults": {
                "z-key": { "itemId": "{{firstId}}", "title": "First", "itemType": "Movie", "scanFingerprint": "one" },
                "a-key": { "itemId": "{{secondId}}", "title": "Second", "itemType": "Book", "scanFingerprint": "two" }
              },
              "lastIncrementalScan": "{{lastIncremental:O}}",
              "ruleVersion": "rules-7",
              "scanRuns": [{ "runId": "{{runId}}", "mode": "changed", "startedAt": "2026-08-15T09:00:00Z" }],
              "schemaVersion": 1,
              "unknownAfter": [true, false, null],
              "updatedAt": "{{updatedAt:O}}",
              "scannerVersion": "scanner-3",
              "lastFullScan": "{{lastFull:O}}"
            }
            """;
        var streamed = new List<(string Key, Guid ItemId, long Ordinal)>();

        await using var source = new MemoryStream(Encoding.UTF8.GetBytes(json));
        var header = await PtvMetadataQualityJsonStreamReader.ReadAsync(
            source,
            (key, result, ordinal, _) =>
            {
                streamed.Add((key, result.ItemId, ordinal));
                return ValueTask.CompletedTask;
            },
            initialBufferSize: 32,
            maximumBufferSize: 4096);

        Assert.Equal(
            [("z-key", firstId, 0L), ("a-key", secondId, 1L)],
            streamed);
        Assert.Equal(1, header.SchemaVersion);
        Assert.Equal("scanner-3", header.ScannerVersion);
        Assert.Equal("rules-7", header.RuleVersion);
        Assert.Equal(updatedAt, header.UpdatedAt);
        Assert.Equal(lastFull, header.LastFullScan);
        Assert.Equal(lastIncremental, header.LastIncrementalScan);
        Assert.Equal(2, header.ItemResultCount);
        var run = Assert.Single(header.ScanRuns);
        Assert.Equal(runId, run.RunId);
    }

    [Fact]
    public async Task SkipsLargeUnknownStructuresWithoutBufferingTheWholeProperty()
    {
        var itemId = Guid.NewGuid();
        var unknownValues = string.Join(',', Enumerable.Range(0, 2000));
        var json = $$"""
            {
              "futurePayload": [{{unknownValues}}],
              "itemResults": {
                "{{itemId:N}}": { "itemId": "{{itemId}}", "title": "Bounded", "scanFingerprint": "fingerprint" }
              },
              "scanRuns": []
            }
            """;
        var items = new List<Guid>();

        await using var source = new MemoryStream(Encoding.UTF8.GetBytes(json));
        var header = await PtvMetadataQualityJsonStreamReader.ReadAsync(
            source,
            (_, result, _, _) =>
            {
                items.Add(result.ItemId);
                return ValueTask.CompletedTask;
            },
            initialBufferSize: 64,
            maximumBufferSize: 256);

        Assert.Equal([itemId], items);
        Assert.Equal(1, header.ItemResultCount);
    }

    [Fact]
    public async Task GrowsForOneResultButRejectsAResultAboveTheConfiguredBound()
    {
        var itemId = Guid.NewGuid();
        var withinBound = CreateDocumentJson(itemId, new string('t', 600));
        await using (var source = new MemoryStream(Encoding.UTF8.GetBytes(withinBound)))
        {
            var count = 0;
            var header = await PtvMetadataQualityJsonStreamReader.ReadAsync(
                source,
                (_, _, _, _) =>
                {
                    count++;
                    return ValueTask.CompletedTask;
                },
                initialBufferSize: 32,
                maximumBufferSize: 2048);

            Assert.Equal(1, count);
            Assert.Equal(1, header.ItemResultCount);
        }

        var aboveBound = CreateDocumentJson(itemId, new string('t', 2048));
        await using var oversizedSource = new MemoryStream(Encoding.UTF8.GetBytes(aboveBound));
        var error = await Assert.ThrowsAsync<JsonException>(() =>
            PtvMetadataQualityJsonStreamReader.ReadAsync(
                oversizedSource,
                (_, _, _, _) => ValueTask.CompletedTask,
                initialBufferSize: 32,
                maximumBufferSize: 512));

        Assert.Contains("streaming limit", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task CancellationStopsBeforeAdditionalCallbacks()
    {
        var firstId = Guid.NewGuid();
        var secondId = Guid.NewGuid();
        var json = $$"""
            {
              "itemResults": {
                "first": { "itemId": "{{firstId}}", "title": "First", "scanFingerprint": "one" },
                "second": { "itemId": "{{secondId}}", "title": "Second", "scanFingerprint": "two" }
              },
              "scanRuns": []
            }
            """;
        using var cancellation = new CancellationTokenSource();
        var callbacks = 0;
        await using var source = new MemoryStream(Encoding.UTF8.GetBytes(json));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            PtvMetadataQualityJsonStreamReader.ReadAsync(
                source,
                (_, _, _, _) =>
                {
                    callbacks++;
                    cancellation.Cancel();
                    return ValueTask.CompletedTask;
                },
                initialBufferSize: 32,
                maximumBufferSize: 2048,
                cancellationToken: cancellation.Token));

        Assert.Equal(1, callbacks);
    }

    [Theory]
    [InlineData("")]
    [InlineData("[]")]
    [InlineData("{\"itemResults\":{")]
    [InlineData("{\"itemResults\":[],\"scanRuns\":[]}")]
    [InlineData("{\"itemResults\":{},\"scanRuns\":[]} trailing")]
    public async Task MalformedDocumentsFail(string json)
    {
        await using var source = new MemoryStream(Encoding.UTF8.GetBytes(json));

        await Assert.ThrowsAnyAsync<JsonException>(() =>
            PtvMetadataQualityJsonStreamReader.ReadAsync(
                source,
                (_, _, _, _) => ValueTask.CompletedTask,
                initialBufferSize: 16,
                maximumBufferSize: 512));
    }

    [Fact]
    public async Task NullCollectionsAndNullResultEntriesUseDocumentSemantics()
    {
        var json = """
            {
              "scanRuns": null,
              "itemResults": {
                "missing": null
              }
            }
            """;
        var callbacks = 0;
        await using var source = new MemoryStream(Encoding.UTF8.GetBytes(json));

        var header = await PtvMetadataQualityJsonStreamReader.ReadAsync(
            source,
            (_, _, _, _) =>
            {
                callbacks++;
                return ValueTask.CompletedTask;
            },
            initialBufferSize: 16,
            maximumBufferSize: 512);

        Assert.Equal(0, callbacks);
        Assert.Equal(0, header.ItemResultCount);
        Assert.Empty(header.ScanRuns);
    }

    [Fact]
    public async Task ScanRunMemoryRemainsBoundedToTheDocumentHistoryContract()
    {
        var runs = Enumerable.Range(0, 30)
            .Reverse()
            .Select(index => new PtvMetadataQualityScanRun
            {
                RunId = Guid.NewGuid(),
                StartedAt = DateTimeOffset.UnixEpoch.AddMinutes(index)
            })
            .ToArray();
        var json = JsonSerializer.Serialize(new
        {
            scanRuns = runs,
            itemResults = new Dictionary<string, PtvMetadataQualityResult>()
        }, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        await using var source = new MemoryStream(Encoding.UTF8.GetBytes(json));

        var header = await PtvMetadataQualityJsonStreamReader.ReadAsync(
            source,
            (_, _, _, _) => ValueTask.CompletedTask,
            initialBufferSize: 64,
            maximumBufferSize: 4096);

        Assert.Equal(PtvMetadataQualityConstants.MaximumRunHistory, header.ScanRuns.Count);
        Assert.Equal(DateTimeOffset.UnixEpoch.AddMinutes(10), header.ScanRuns[0].StartedAt);
        Assert.Equal(DateTimeOffset.UnixEpoch.AddMinutes(29), header.ScanRuns[^1].StartedAt);
    }

    private static string CreateDocumentJson(Guid itemId, string title)
        => JsonSerializer.Serialize(new PtvMetadataQualityDocument
        {
            ItemResults = new Dictionary<string, PtvMetadataQualityResult>
            {
                [itemId.ToString("N")] = new()
                {
                    ItemId = itemId,
                    Title = title,
                    ScanFingerprint = "fingerprint"
                }
            }
        }, new JsonSerializerOptions(JsonSerializerDefaults.Web));
}
