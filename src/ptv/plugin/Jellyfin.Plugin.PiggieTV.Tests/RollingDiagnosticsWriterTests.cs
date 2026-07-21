using System.IO.Compression;
using System.Text;
using Jellyfin.Plugin.PiggieTV.Configuration;
using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace Jellyfin.Plugin.PiggieTV.Tests;

public sealed class RollingDiagnosticsWriterTests : IAsyncLifetime
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "piggie-tv-diagnostics-tests", Guid.NewGuid().ToString("N"));

    public Task InitializeAsync()
    {
        Directory.CreateDirectory(_root);
        return Task.CompletedTask;
    }

    public Task DisposeAsync()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
        return Task.CompletedTask;
    }

    [Fact]
    public async Task AppendsMultipleEventsToOneActiveJsonlFileAndSanitizesSecrets()
    {
        await using var writer = CreateWriter();
        writer.Enqueue(Event("search", "one", new { token = "secret-token", url = "https://example.test/path?api_key=secret" }));
        writer.Enqueue(Event("search", "two", new { durationMs = 42 }));
        await writer.FlushAsync();

        var files = Directory.GetFiles(_root, "*.log");
        var lines = Encoding.UTF8.GetString(await writer.ReadActiveLogAsync())
            .Split(Environment.NewLine, StringSplitOptions.RemoveEmptyEntries);
        Assert.Single(files);
        Assert.Equal(2, lines.Length);
        Assert.All(lines, line => Assert.Contains("\"timestamp\"", line));
        Assert.DoesNotContain("secret-token", string.Join('\n', lines), StringComparison.Ordinal);
    }

    [Fact]
    public async Task RotatesAtConfiguredSizeAndEnforcesRotationCount()
    {
        await using var writer = CreateWriter(new PtvDiagnosticsStorageSettings { MaximumFileSizeMb = 1, MaximumRotatedFiles = 1 });
        var detail = new { payload = new string('x', 1024) };
        for (var index = 0; index < 1100; index += 1) writer.Enqueue(Event("performance", $"sample-{index}", detail));
        await writer.FlushAsync();
        await writer.RotateAsync();
        await writer.RotateAsync();

        Assert.True(File.Exists(Path.Combine(_root, "ptv-diagnostics.1.log")));
        Assert.False(File.Exists(Path.Combine(_root, "ptv-diagnostics.2.log")));
        Assert.True(writer.GetStatus().RotationsCompleted >= 2);
    }

    [Fact]
    public async Task CleansExpiredRotationsAndKeepsUnknownFiles()
    {
        var expired = Path.Combine(_root, "ptv-diagnostics.1.log");
        var unknown = Path.Combine(_root, "important-user-file.json");
        await File.WriteAllTextAsync(expired, "old");
        File.SetLastWriteTimeUtc(expired, DateTime.UtcNow.AddDays(-31));
        await File.WriteAllTextAsync(unknown, "keep");

        await using var writer = CreateWriter(new PtvDiagnosticsStorageSettings { RetentionDays = 1 });
        Assert.False(File.Exists(expired));
        Assert.True(File.Exists(unknown));
    }

    [Fact]
    public async Task SupportsConcurrentEventsAndSummarizesCheckInsWithoutPerEventFiles()
    {
        await using var writer = CreateWriter();
        await Task.WhenAll(Enumerable.Range(0, 64).Select(index => Task.Run(() => writer.Enqueue(Event("search", $"concurrent-{index}", new { index })))));
        writer.Enqueue(Event("remote", "client-check-in", new { route = "/home" }, "client-a"));
        writer.Enqueue(Event("remote", "client-check-in", new { route = "/home" }, "client-a"));
        await writer.FlushAsync();

        var text = Encoding.UTF8.GetString(await writer.ReadActiveLogAsync());
        Assert.Contains("client-checkin-summary", text, StringComparison.Ordinal);
        Assert.Single(Directory.GetFiles(_root, "*.log"));
        Assert.True(writer.GetStatus().EventsWritten >= 65);
    }

    [Fact]
    public async Task FailedWritesNeverEscapeCallersAndLegacyCleanupOnlySelectsKnownPatterns()
    {
        var legacy = Path.Combine(_root, "piggie-tv-diagnostics-client_123-20260720-161548.json");
        var unknown = Path.Combine(_root, "featured-content-cache.json");
        await File.WriteAllTextAsync(legacy, "legacy");
        await File.WriteAllTextAsync(unknown, "keep");

        await using (var writer = CreateWriter())
        {
            var result = await writer.ConsolidateLegacyAsync(createArchive: true);
            Assert.Equal(1, result.FileCount);
            Assert.False(File.Exists(legacy));
            Assert.True(File.Exists(unknown));
            Assert.True(File.Exists(Path.Combine(_root, "ptv-diagnostics-legacy.zip")));
            Assert.False(File.Exists(Path.Combine(_root, ".ptv-diagnostics-legacy.tmp")));
        }

        var blockedPath = Path.Combine(_root, "not-a-directory");
        await File.WriteAllTextAsync(blockedPath, "file");
        await using var blockedWriter = new PtvRollingDiagnosticsWriter(blockedPath, () => new PtvDiagnosticsStorageSettings(), NullLogger<PtvRollingDiagnosticsWriter>.Instance);
        blockedWriter.Enqueue(Event("plugin", "write-failure", new { value = 1 }));
        await blockedWriter.FlushAsync();
        Assert.True(blockedWriter.GetStatus().WriteFailures > 0);
    }

    [Fact]
    public async Task ProducesAnInMemoryBundleWithoutLeavingTemporaryZipFiles()
    {
        await using var writer = CreateWriter();
        writer.Enqueue(Event("plugin", "bundle", new { ok = true }));
        var bundle = await writer.CreateBundleAsync();

        using var zip = new ZipArchive(new MemoryStream(bundle), ZipArchiveMode.Read);
        Assert.Contains(zip.Entries, entry => entry.Name == "manifest.json");
        Assert.DoesNotContain(Directory.GetFiles(_root, "*.tmp"), path => Path.GetFileName(path).Contains("diagnostics", StringComparison.OrdinalIgnoreCase));
    }

    private PtvRollingDiagnosticsWriter CreateWriter(PtvDiagnosticsStorageSettings? settings = null) => new(
        _root,
        () => settings ?? new PtvDiagnosticsStorageSettings(),
        NullLogger<PtvRollingDiagnosticsWriter>.Instance);

    private static PtvRollingDiagnosticEvent Event(string category, string eventName, object detail, string? clientId = null) => new()
    {
        Category = category,
        ClientId = clientId,
        Detail = detail,
        EventName = eventName,
        Level = "information"
    };
}
