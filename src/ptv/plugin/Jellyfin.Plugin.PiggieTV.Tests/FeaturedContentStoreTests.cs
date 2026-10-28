using System.Text.Json;
using System.Text.Json.Nodes;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using MediaBrowser.Common.Configuration;
using Microsoft.Extensions.Logging;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class FeaturedContentStoreTests
{
    [Fact]
    public async Task VersionEightWithoutScopeSchemaCannotBeStoredAsFresh()
    {
        using var fixture = new TempApplicationPaths();
        var payload = CreateLegacyV7Payload();
        payload["version"] = PtvFeaturedContentValidator.FeaturedCacheVersion;
        var store = new PtvFeaturedContentStore(fixture, new NoopLogger<PtvFeaturedContentStore>());

        await Assert.ThrowsAsync<PtvFeaturedContentValidationException>(() => store.WriteAsync(
            new PtvFeaturedContentDocument { Version = 1, UpdatedAt = NowMs(), FeaturedContent = payload },
            CancellationToken.None));

        Assert.False((await store.GetStatusAsync(CancellationToken.None)).FeaturedCacheFresh);
    }

    [Fact]
    public async Task RetainedVersionEightWithoutScopeSchemaIsStale()
    {
        using var fixture = new TempApplicationPaths();
        var cacheDirectory = Path.Combine(fixture.PluginConfigurationsPath, "PiggieTV");
        Directory.CreateDirectory(cacheDirectory);
        var payload = CreateLegacyV7Payload();
        payload["version"] = PtvFeaturedContentValidator.FeaturedCacheVersion;
        await File.WriteAllTextAsync(Path.Combine(cacheDirectory, "featured-content-cache.json"), payload.ToJsonString(JsonOptions));

        var status = await new PtvFeaturedContentStore(fixture, new NoopLogger<PtvFeaturedContentStore>())
            .GetStatusAsync(CancellationToken.None);

        Assert.True(status.FeaturedCacheExists);
        Assert.False(status.FeaturedCacheFresh);
    }

    [Fact]
    public async Task VersionEightOrphanItemsCannotRemainFreshButInvisible()
    {
        using var fixture = new TempApplicationPaths();
        var payload = CreateLegacyV7Payload();
        payload["version"] = PtvFeaturedContentValidator.FeaturedCacheVersion;
        payload["payload"]!["scopeSchemaVersion"] = 2;
        var document = new PtvFeaturedContentDocument { Version = 1, UpdatedAt = NowMs(), FeaturedContent = payload };
        var store = new PtvFeaturedContentStore(fixture, new NoopLogger<PtvFeaturedContentStore>());

        await Assert.ThrowsAsync<PtvFeaturedContentValidationException>(() => store.WriteAsync(document, CancellationToken.None));

        var cacheDirectory = Path.Combine(fixture.PluginConfigurationsPath, "PiggieTV");
        Directory.CreateDirectory(cacheDirectory);
        await File.WriteAllTextAsync(Path.Combine(cacheDirectory, "featured-content-cache.json"), payload.ToJsonString(JsonOptions));
        Assert.False((await store.GetStatusAsync(CancellationToken.None)).FeaturedCacheFresh);
    }

    [Fact]
    public async Task LegacyV7FeaturedPayloadReportsCountsAndSerializesContent()
    {
        using var fixture = new TempApplicationPaths();
        var cacheDirectory = Path.Combine(fixture.PluginConfigurationsPath, "PiggieTV");
        Directory.CreateDirectory(cacheDirectory);
        await File.WriteAllTextAsync(
            Path.Combine(cacheDirectory, "featured-content-cache.json"),
            CreateLegacyV7Payload().ToJsonString(JsonOptions));

        var store = new PtvFeaturedContentStore(fixture, new NoopLogger<PtvFeaturedContentStore>());
        var status = await store.GetStatusAsync(CancellationToken.None);
        var featuredStatus = PtvFeaturedContentStatus.FromDocument(status.Document);
        var serialized = JsonSerializer.SerializeToUtf8Bytes(status.Document, JsonOptions);
        var serializedObject = JsonNode.Parse(serialized)!.AsObject();
        var featuredContent = serializedObject["featuredContent"]!.AsObject();
        var payload = featuredContent["payload"]!.AsObject();

        Assert.True(status.FeaturedCacheExists);
        Assert.False(status.FeaturedCacheFresh);
        Assert.True(featuredStatus.HasPayload);
        Assert.Equal(7, featuredStatus.CacheVersion);
        Assert.Equal(2, featuredStatus.HeroCount);
        Assert.Equal(2, featuredStatus.SectionCount);
        Assert.Equal(3, featuredStatus.ItemCount);
        Assert.True(serialized.Length > 4);
        Assert.Equal(2, payload["heroItems"]!.AsArray().Count);
        Assert.Equal(2, payload["sectionItems"]!.AsObject().Count);
    }

    [Fact]
    public async Task WrappedV7FeaturedPayloadReportsSameCountsAsDocument()
    {
        using var fixture = new TempApplicationPaths();
        var cacheDirectory = Path.Combine(fixture.PluginConfigurationsPath, "PiggieTV");
        Directory.CreateDirectory(cacheDirectory);
        var legacyPayload = CreateLegacyV7Payload();
        var wrappedPayload = new JsonObject
        {
            ["version"] = 1,
            ["featuredContent"] = legacyPayload.DeepClone(),
            ["updatedAt"] = NowMs()
        };

        await File.WriteAllTextAsync(
            Path.Combine(cacheDirectory, "featured-content-cache.json"),
            wrappedPayload.ToJsonString(JsonOptions));

        var store = new PtvFeaturedContentStore(fixture, new NoopLogger<PtvFeaturedContentStore>());
        var status = await store.GetStatusAsync(CancellationToken.None);
        var featuredStatus = PtvFeaturedContentStatus.FromDocument(status.Document);
        var serialized = JsonSerializer.SerializeToUtf8Bytes(status.Document, JsonOptions);

        Assert.True(status.FeaturedCacheExists);
        Assert.False(status.FeaturedCacheFresh);
        Assert.True(featuredStatus.HasPayload);
        Assert.Equal(7, featuredStatus.CacheVersion);
        Assert.Equal(2, featuredStatus.HeroCount);
        Assert.Equal(2, featuredStatus.SectionCount);
        Assert.Equal(3, featuredStatus.ItemCount);
        Assert.True(serialized.Length > 4);
    }

    private static JsonObject CreateLegacyV7Payload()
    {
        var now = NowMs();

        return new JsonObject
        {
            ["version"] = 7,
            ["createdAt"] = now,
            ["expiresAt"] = now + 3_600_000,
            ["payload"] = new JsonObject
            {
                ["heroItems"] = new JsonArray(
                    new JsonObject
                    {
                        ["Id"] = "hero-1",
                        ["Name"] = "Hero One",
                        ["Type"] = "Movie"
                    },
                    new JsonObject
                    {
                        ["Id"] = "hero-2",
                        ["Name"] = "Hero Two",
                        ["Type"] = "Movie"
                    }),
                ["sectionItems"] = new JsonObject
                {
                    ["recommended-for-you"] = new JsonArray(
                        new JsonObject
                        {
                            ["Id"] = "item-1",
                            ["Name"] = "Item One",
                            ["Type"] = "Movie"
                        },
                        new JsonObject
                        {
                            ["Id"] = "item-2",
                            ["Name"] = "Item Two",
                            ["Type"] = "Episode"
                        }),
                    ["latest"] = new JsonArray(
                        new JsonObject
                        {
                            ["Id"] = "item-3",
                            ["Name"] = "Item Three",
                            ["Type"] = "Movie"
                        })
                }
            }
        };
    }

    private static long NowMs()
    {
        return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false
    };

    private sealed class TempApplicationPaths : IApplicationPaths, IDisposable
    {
        private readonly string _root = Path.Combine(Path.GetTempPath(), $"ptv-featured-test-{Guid.NewGuid():N}");

        public string ProgramDataPath => _root;

        public string WebPath => Path.Combine(_root, "web");

        public string ProgramSystemPath => Path.Combine(_root, "system");

        public string DataPath => Path.Combine(_root, "data");

        public string ImageCachePath => Path.Combine(_root, "images");

        public string PluginsPath => Path.Combine(_root, "plugins");

        public string PluginConfigurationsPath => Path.Combine(_root, "plugin-configs");

        public string LogDirectoryPath => Path.Combine(_root, "logs");

        public string ConfigurationDirectoryPath => Path.Combine(_root, "config");

        public string SystemConfigurationFilePath => Path.Combine(ConfigurationDirectoryPath, "system.xml");

        public string CachePath => Path.Combine(_root, "cache");

        public string TempDirectory => Path.Combine(CachePath, "temp");

        public string VirtualDataPath => "%AppDataPath%";

        public string TrickplayPath => Path.Combine(_root, "trickplay");

        public string BackupPath => Path.Combine(_root, "backups");

        public void MakeSanityCheckOrThrow()
        {
            Directory.CreateDirectory(_root);
            Directory.CreateDirectory(PluginConfigurationsPath);
        }

        public void CreateAndCheckMarker(string path, string marker, bool isDirectory)
        {
            Directory.CreateDirectory(path);
            File.WriteAllText(Path.Combine(path, marker), string.Empty);
        }

        public void Dispose()
        {
            if (Directory.Exists(_root))
            {
                Directory.Delete(_root, true);
            }
        }
    }

    private sealed class NoopLogger<T> : ILogger<T>
    {
        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull
        {
            return null;
        }

        public bool IsEnabled(LogLevel logLevel)
        {
            return false;
        }

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
        }
    }
}
