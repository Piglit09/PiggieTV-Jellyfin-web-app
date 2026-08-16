using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class PtvMetadataQualityStoreTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "ptv-metadata-quality-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task AtomicRoundTripReturnsDetachedStateAndKeepsLatestTwentyRuns()
    {
        var store = CreateStore();
        var itemId = Guid.NewGuid();
        var document = new PtvMetadataQualityDocument
        {
            ItemResults = new Dictionary<string, PtvMetadataQualityResult>(StringComparer.OrdinalIgnoreCase)
            {
                [itemId.ToString("N")] = new() { ItemId = itemId, Title = "Arrival", ScanFingerprint = "fingerprint" }
            },
            ScanRuns = Enumerable.Range(0, 25).Select(index => new PtvMetadataQualityScanRun
            {
                RunId = Guid.NewGuid(),
                StartedAt = DateTimeOffset.UnixEpoch.AddMinutes(index)
            }).ToList()
        };

        var written = await store.WriteAsync(document);
        written.ItemResults[itemId.ToString("N")].Title = "caller mutation";
        var loaded = await store.ReadAsync();

        Assert.Equal("Arrival", loaded.ItemResults[itemId.ToString("N")].Title);
        Assert.Equal(PtvMetadataQualityConstants.MaximumRunHistory, loaded.ScanRuns.Count);
        Assert.Equal(DateTimeOffset.UnixEpoch.AddMinutes(5), loaded.ScanRuns[0].StartedAt);
        Assert.Empty(Directory.EnumerateFiles(_root, "*.tmp", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task ConcurrentUpdatesAreSerializedWithoutLostResults()
    {
        var store = CreateStore();
        await Task.WhenAll(Enumerable.Range(0, 12).Select(index => store.UpdateAsync(document =>
        {
            var itemId = Guid.NewGuid();
            document.ItemResults[itemId.ToString("N")] = new PtvMetadataQualityResult
            {
                ItemId = itemId,
                Title = $"Item {index}",
                ScanFingerprint = index.ToString()
            };
            return document;
        })));

        Assert.Equal(12, (await store.ReadAsync()).ItemResults.Count);
    }

    [Fact]
    public async Task DiagnosticReadReportsOneDeserializeAndNoRedundantIsolationClone()
    {
        var store = CreateStore();
        var itemId = Guid.NewGuid();
        await store.WriteAsync(new PtvMetadataQualityDocument
        {
            ItemResults = new Dictionary<string, PtvMetadataQualityResult>(StringComparer.OrdinalIgnoreCase)
            {
                [itemId.ToString("N")] = new() { ItemId = itemId, Title = "Arrival", ScanFingerprint = "fingerprint" }
            }
        });

        var read = await ((IPtvMetadataQualityDiagnosticStore)store).ReadWithDiagnosticsAsync();

        Assert.Single(read.Document.ItemResults);
        Assert.Equal(1, read.Diagnostics.PersistedResults);
        Assert.True(read.Diagnostics.FileBytes > 0);
        Assert.True(read.Diagnostics.TotalMs >= 0);
        Assert.Equal(1, read.Diagnostics.Operations["storeFileReads"]);
        Assert.Equal(1, read.Diagnostics.Operations["jsonDeserializations"]);
        Assert.Equal(0, read.Diagnostics.Operations["jsonSerializations"]);
        Assert.Equal(0, read.Diagnostics.Operations["metadataWrites"]);
        Assert.Equal(0, read.Diagnostics.Stages["isolationCloneSerialize"]);
        Assert.Equal(0, read.Diagnostics.Stages["isolationCloneDeserialize"]);
    }

    [Fact]
    public async Task CorruptStoreIsQuarantinedAndNeverSilentlyReset()
    {
        var store = CreateStore();
        await File.WriteAllTextAsync(store.ResultsPath, "{ this is not json");

        var first = await Assert.ThrowsAsync<PtvMetadataQualityStoreException>(() => store.ReadAsync());
        var second = await Assert.ThrowsAsync<PtvMetadataQualityStoreException>(() => store.ReadAsync());

        Assert.Equal("PTV_METADATA_QUALITY_STORE_CORRUPT", first.Code);
        Assert.Equal(first.Code, second.Code);
        Assert.Equal(first.Code, await store.GetErrorCodeAsync());
        Assert.False(File.Exists(store.ResultsPath));
        Assert.Single(Directory.EnumerateFiles(_root, "metadata-quality.json.corrupt.*", SearchOption.AllDirectories));
    }

    [Fact]
    public async Task SettingsAreClampedDeduplicatedAndContainNoCredentialField()
    {
        var store = CreateStore();
        var libraryId = Guid.NewGuid();
        var saved = await store.WriteSettingsAsync(new PtvMetadataQualitySettings
        {
            ReviewThreshold = 500,
            LikelyWrongThreshold = 300,
            ProviderMaximumRequestsPerRun = 9000,
            AiThreshold = 60,
            AiMinimumConfidence = 90,
            AiMaxItemsPerRun = 900,
            SelectedLibraryIds = [libraryId, Guid.Empty, libraryId]
        });

        Assert.Equal(100, saved.ReviewThreshold);
        Assert.Equal(100, saved.LikelyWrongThreshold);
        Assert.Equal(5000, saved.ProviderMaximumRequestsPerRun);
        Assert.Equal(60, saved.AiMinimumConfidence);
        Assert.Equal(100, saved.AiMaxItemsPerRun);
        Assert.Equal([libraryId], saved.SelectedLibraryIds);
        Assert.DoesNotContain(typeof(PtvMetadataQualitySettings).GetProperties(), property =>
            property.Name.Contains("key", StringComparison.OrdinalIgnoreCase)
            || property.Name.Contains("secret", StringComparison.OrdinalIgnoreCase)
            || property.Name.Contains("token", StringComparison.OrdinalIgnoreCase));
        var settingsJson = await File.ReadAllTextAsync(store.SettingsPath);
        Assert.DoesNotContain("aiConfigured", settingsJson, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("apiKey", settingsJson, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task SettingsUpdateIncrementsRevisionRejectsStaleWritesAndPreservesUnknownFields()
    {
        var store = CreateStore();
        using var futureValue = JsonDocument.Parse("{\"mode\":\"future\"}");
        using var legacyProjection = JsonDocument.Parse("false");
        var created = await store.WriteSettingsAsync(new PtvMetadataQualitySettings
        {
            ExtensionData = new Dictionary<string, JsonElement>
            {
                ["futureOption"] = futureValue.RootElement.Clone(),
                ["aiConfigured"] = legacyProjection.RootElement.Clone()
            }
        });

        var saved = await store.UpdateSettingsAsync(created.Revision, current =>
        {
            current.AiModel = "settings-api-model";
            return current;
        });
        var conflict = await Assert.ThrowsAsync<PtvMetadataQualityStoreException>(() =>
            store.UpdateSettingsAsync(created.Revision, current => current));
        var reloaded = await store.ReadSettingsAsync();

        Assert.Equal(created.Revision + 1, saved.Revision);
        Assert.Equal("PTV_METADATA_QUALITY_SETTINGS_CONFLICT", conflict.Code);
        Assert.Equal("settings-api-model", reloaded.AiModel);
        Assert.True(reloaded.ExtensionData?.ContainsKey("futureOption"));
        Assert.Contains("futureOption", await File.ReadAllTextAsync(store.SettingsPath), StringComparison.Ordinal);
        Assert.DoesNotContain("aiConfigured", await File.ReadAllTextAsync(store.SettingsPath), StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("bad\nmodel")]
    [InlineData("bad\u0000model")]
    public async Task SettingsRejectInvalidModelIds(string model)
    {
        var store = CreateStore();

        var error = await Assert.ThrowsAsync<PtvMetadataQualityStoreException>(() =>
            store.WriteSettingsAsync(new PtvMetadataQualitySettings { AiModel = model }));

        Assert.Equal("PTV_METADATA_QUALITY_AI_MODEL_INVALID", error.Code);
        Assert.False(File.Exists(store.SettingsPath));
    }

    [Fact]
    public async Task SettingsRejectModelIdsAboveBound()
    {
        var store = CreateStore();

        var error = await Assert.ThrowsAsync<PtvMetadataQualityStoreException>(() =>
            store.WriteSettingsAsync(new PtvMetadataQualitySettings
            {
                AiModel = new string('m', PtvMetadataQualityConstants.MaximumOpenAiModelLength + 1)
            }));

        Assert.Equal("PTV_METADATA_QUALITY_AI_MODEL_INVALID", error.Code);
        Assert.False(File.Exists(store.SettingsPath));
    }

    [Fact]
    public void SettingsRejectModelIdEqualToActiveCredentialWithoutPrefixAssumptions()
    {
        const string activeCredential = "unit-test-credential";

        var error = Assert.Throws<PtvMetadataQualityStoreException>(() =>
            PtvMetadataQualityStore.NormalizeModel(activeCredential, activeCredential));

        Assert.Equal("PTV_METADATA_QUALITY_AI_MODEL_INVALID", error.Code);
    }

    [Theory]
    [InlineData("openAiApiKey")]
    [InlineData("openAiCredential")]
    [InlineData("openAiKey")]
    [InlineData("credential")]
    [InlineData("key")]
    public async Task SettingsRejectSecretLikeUnknownFieldsInsteadOfPreservingThem(string fieldName)
    {
        var store = CreateStore();
        using var value = JsonDocument.Parse("\"test-openai-key\"");

        var error = await Assert.ThrowsAsync<PtvMetadataQualityStoreException>(() =>
            store.WriteSettingsAsync(new PtvMetadataQualitySettings
            {
                ExtensionData = new Dictionary<string, JsonElement>
                {
                    [fieldName] = value.RootElement.Clone()
                }
            }));

        Assert.Equal("PTV_METADATA_QUALITY_SETTINGS_SECRET_INVALID", error.Code);
        Assert.False(File.Exists(store.SettingsPath));
    }

    [Fact]
    public async Task UnsupportedSettingsSchemaIsPreservedInQuarantineAndFailsClosed()
    {
        var store = CreateStore();
        await File.WriteAllTextAsync(store.SettingsPath, "{\"schemaVersion\":999}");

        var error = await Assert.ThrowsAsync<PtvMetadataQualityStoreException>(() => store.ReadSettingsAsync());

        Assert.Equal("PTV_METADATA_QUALITY_SETTINGS_CORRUPT", error.Code);
        Assert.False(File.Exists(store.SettingsPath));
        Assert.Single(Directory.EnumerateFiles(_root, "settings.json.corrupt.*", SearchOption.AllDirectories));
        Assert.Equal("PTV_METADATA_QUALITY_SETTINGS_CORRUPT", await store.GetErrorCodeAsync());
    }

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    private PtvMetadataQualityStore CreateStore() => new(_root, NullLogger<PtvMetadataQualityStore>.Instance);
}
