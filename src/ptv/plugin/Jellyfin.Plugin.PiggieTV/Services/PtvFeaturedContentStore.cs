using System.Text.Json;
using Jellyfin.Plugin.PiggieTV.Models;
using MediaBrowser.Common.Configuration;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// File-backed featured-content store.
/// </summary>
public sealed class PtvFeaturedContentStore : IPtvFeaturedContentStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = false
    };

    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _directory;
    private readonly string _filePath;
    private readonly ILogger<PtvFeaturedContentStore> _logger;
    private long _lastPayloadBytes;
    private string? _lastWriteError;

    /// <summary>
    /// Initializes a new instance of the <see cref="PtvFeaturedContentStore"/> class.
    /// </summary>
    /// <param name="applicationPaths">Jellyfin application paths.</param>
    /// <param name="logger">Logger.</param>
    public PtvFeaturedContentStore(
        IApplicationPaths applicationPaths,
        ILogger<PtvFeaturedContentStore> logger)
    {
        _logger = logger;

        _directory = Path.Combine(applicationPaths.PluginConfigurationsPath, "PiggieTV");
        Directory.CreateDirectory(_directory);
        _filePath = Path.Combine(_directory, "featured-content-cache.json");

        _logger.LogInformation(
            "PiggieTV featured-content cache store constructed. Directory={CacheDirectory}. File={CacheFilePath}. DirectoryExists={DirectoryExists}.",
            _directory,
            _filePath,
            Directory.Exists(_directory));
    }

    /// <inheritdoc />
    public async Task<PtvFeaturedContentDocument> ReadAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);

        try
        {
            return await ReadDocumentNoLockAsync(cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <inheritdoc />
    public async Task<PtvFeaturedContentDocument> WriteAsync(
        PtvFeaturedContentDocument document,
        CancellationToken cancellationToken)
    {
        PtvFeaturedContentDocument normalizedDocument;
        byte[] payloadBytes = [];
        var incomingStats = GetDocumentDebugStats(document);

        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);

        var temporaryPath = $"{_filePath}.{Guid.NewGuid():N}.tmp";

        try
        {
            normalizedDocument = ValidateDocument(document);
            payloadBytes = JsonSerializer.SerializeToUtf8Bytes(normalizedDocument, JsonOptions);

            Directory.CreateDirectory(_directory);
            var directoryExists = Directory.Exists(_directory);
            var fileExists = File.Exists(_filePath);
            var isWritable = TryProbeCacheDirectoryWritable(out var writeProbeError);
            var normalizedStats = GetDocumentDebugStats(normalizedDocument);

            _logger.LogInformation(
                "PiggieTV featured-content cache write starting. Directory: {CacheDirectory}. File: {CacheFilePath}. DirectoryExists: {DirectoryExists}. FileExists: {FileExists}. Writable: {Writable}. PayloadBytes: {PayloadBytes}. MaxPayloadBytes: {MaxPayloadBytes}. HeroCount: {HeroCount}. SectionCount: {SectionCount}. ItemCount: {ItemCount}. IncomingHeroCount: {IncomingHeroCount}. IncomingSectionCount: {IncomingSectionCount}. IncomingItemCount: {IncomingItemCount}.",
                _directory,
                _filePath,
                directoryExists,
                fileExists,
                isWritable,
                payloadBytes.Length,
                PtvFeaturedContentValidator.GetMaxDocumentBytes(),
                normalizedStats.HeroCount,
                normalizedStats.SectionCount,
                normalizedStats.ItemCount,
                incomingStats.HeroCount,
                incomingStats.SectionCount,
                incomingStats.ItemCount);

            if (!isWritable)
            {
                throw new IOException($"PiggieTV cache directory is not writable: {writeProbeError}");
            }

            await using (var stream = new FileStream(
                temporaryPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                bufferSize: 81920,
                options: FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await stream.WriteAsync(payloadBytes, cancellationToken).ConfigureAwait(false);
                await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
            }

            ReplaceTemporaryFile(temporaryPath, _filePath);
            _lastPayloadBytes = payloadBytes.Length;
            _lastWriteError = null;
            _logger.LogInformation(
                "PiggieTV featured-content cache write finished. File: {CacheFilePath}. PayloadBytes: {PayloadBytes}.",
                _filePath,
                payloadBytes.Length);

            return normalizedDocument;
        }
        catch (PtvFeaturedContentValidationException ex)
        {
            _lastWriteError = $"Featured cache validation failed: {ex.Code}: {ex.Message}";
            _logger.LogWarning(
                ex,
                "PiggieTV featured-content cache validation failed. Code: {Code}. Message: {Message}. Directory: {CacheDirectory}. File: {CacheFilePath}. PayloadBytes: {PayloadBytes}. MaxPayloadBytes: {MaxPayloadBytes}. HeroCount: {HeroCount}. SectionCount: {SectionCount}. ItemCount: {ItemCount}.",
                ex.Code,
                ex.Message,
                _directory,
                _filePath,
                payloadBytes.Length,
                PtvFeaturedContentValidator.GetMaxDocumentBytes(),
                incomingStats.HeroCount,
                incomingStats.SectionCount,
                incomingStats.ItemCount);
            throw;
        }
        catch (Exception ex)
        {
            _lastWriteError = FormatStoreException("Unable to store featured cache", ex);
            _logger.LogError(
                ex,
                "PiggieTV featured-content cache write failed. Directory: {CacheDirectory}. File: {CacheFilePath}. TempFile: {TemporaryPath}. PayloadBytes: {PayloadBytes}. MaxPayloadBytes: {MaxPayloadBytes}. HeroCount: {HeroCount}. SectionCount: {SectionCount}. ItemCount: {ItemCount}. DirectoryExists: {DirectoryExists}. FileExists: {FileExists}.",
                _directory,
                _filePath,
                temporaryPath,
                payloadBytes.Length,
                PtvFeaturedContentValidator.GetMaxDocumentBytes(),
                incomingStats.HeroCount,
                incomingStats.SectionCount,
                incomingStats.ItemCount,
                Directory.Exists(_directory),
                File.Exists(_filePath));
            throw;
        }
        finally
        {
            TryDeleteTemporaryFile(temporaryPath);
            _gate.Release();
        }
    }

    /// <inheritdoc />
    public async Task ClearAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);

        try
        {
            if (File.Exists(_filePath))
            {
                File.Delete(_filePath);
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <inheritdoc />
    public async Task<PtvFeaturedContentStoreStatus> GetStatusAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);

        try
        {
            var document = await ReadDocumentNoLockAsync(cancellationToken).ConfigureAwait(false);
            var featuredStatus = PtvFeaturedContentStatus.FromDocument(document);
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var isWritable = TryProbeCacheDirectoryWritable(out var writeProbeError);

            if (!isWritable && string.IsNullOrWhiteSpace(_lastWriteError))
            {
                _lastWriteError = writeProbeError;
            }

            return new PtvFeaturedContentStoreStatus
            {
                CacheFilePath = _filePath,
                CachePath = _directory,
                CachePathExists = Directory.Exists(_directory),
                CachePathWritable = isWritable,
                CachePayloadBytes = GetCachePayloadBytes(),
                CacheWriteError = _lastWriteError,
                Document = document,
                FeaturedCacheCreatedAt = featuredStatus.CreatedAt,
                FeaturedCacheExists = File.Exists(_filePath),
                FeaturedCacheExpiresAt = featuredStatus.ExpiresAt,
                FeaturedCacheFresh = featuredStatus.HasPayload
                    && featuredStatus.CacheVersion == PtvFeaturedContentValidator.FeaturedCacheVersion
                    && featuredStatus.ExpiresAt.HasValue
                    && featuredStatus.ExpiresAt.Value > now
            };
        }
        finally
        {
            _gate.Release();
        }
    }

    private bool TryProbeCacheDirectoryWritable(out string? error)
    {
        error = null;

        try
        {
            Directory.CreateDirectory(_directory);
            var probePath = Path.Combine(_directory, $".ptv-write-test-{Guid.NewGuid():N}.tmp");
            File.WriteAllText(probePath, "ok");
            File.Delete(probePath);
            return true;
        }
        catch (Exception ex)
        {
            error = FormatStoreException("Cache directory write probe failed", ex);
            _logger.LogWarning(
                ex,
                "PiggieTV featured-content cache directory is not writable. Directory: {CacheDirectory}. File: {CacheFilePath}.",
                _directory,
                _filePath);
            return false;
        }
    }

    /// <inheritdoc />
    public PtvFeaturedContentDocument ValidateDocument(PtvFeaturedContentDocument? document)
    {
        return PtvFeaturedContentValidator.ValidateForSave(document, JsonOptions);
    }

    private async Task<PtvFeaturedContentDocument> ReadDocumentNoLockAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_filePath))
        {
            return PtvFeaturedContentValidator.CreateEmptyDocument();
        }

        try
        {
            await using var stream = File.OpenRead(_filePath);
            var document = await JsonSerializer
                .DeserializeAsync<PtvFeaturedContentDocument>(stream, JsonOptions, cancellationToken)
                .ConfigureAwait(false);

            return PtvFeaturedContentValidator.NormalizeStoredDocument(document);
        }
        catch (JsonException ex)
        {
            _logger.LogWarning(ex, "PiggieTV featured-content cache file is invalid. Returning an empty document.");
            QuarantineCorruptCacheFile(ex);

            return PtvFeaturedContentValidator.CreateEmptyDocument();
        }
    }

    private long GetCachePayloadBytes()
    {
        try
        {
            if (File.Exists(_filePath))
            {
                _lastPayloadBytes = new FileInfo(_filePath).Length;
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "PiggieTV could not read featured-content cache file size.");
        }

        return _lastPayloadBytes;
    }

    private void QuarantineCorruptCacheFile(Exception sourceException)
    {
        try
        {
            if (!File.Exists(_filePath))
            {
                return;
            }

            var corruptPath = $"{_filePath}.corrupt.{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";

            File.Move(_filePath, corruptPath, true);
            _logger.LogWarning(
                sourceException,
                "PiggieTV moved corrupt featured-content cache file to {CorruptCacheFilePath}.",
                corruptPath);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                ex,
                "PiggieTV could not move corrupt featured-content cache file. File: {CacheFilePath}.",
                _filePath);
        }
    }

    private static void ReplaceTemporaryFile(string temporaryPath, string filePath)
    {
        if (!File.Exists(filePath))
        {
            File.Move(temporaryPath, filePath);
            return;
        }

        try
        {
            File.Replace(temporaryPath, filePath, null, true);
        }
        catch (PlatformNotSupportedException)
        {
            File.Move(temporaryPath, filePath, true);
        }
        catch (IOException)
        {
            File.Move(temporaryPath, filePath, true);
        }
    }

    private static void TryDeleteTemporaryFile(string temporaryPath)
    {
        try
        {
            if (File.Exists(temporaryPath))
            {
                File.Delete(temporaryPath);
            }
        }
        catch
        {
            // Best-effort cleanup. The original write exception is more useful than a temp-file cleanup failure.
        }
    }

    private static string FormatStoreException(string context, Exception exception)
    {
        return $"{context}: {exception.GetType().FullName}: {exception.Message}{Environment.NewLine}{exception.StackTrace}";
    }

    private static DocumentDebugStats GetDocumentDebugStats(PtvFeaturedContentDocument? document)
    {
        var featuredContent = document?.FeaturedContent as System.Text.Json.Nodes.JsonObject;
        var payload = featuredContent?["payload"] as System.Text.Json.Nodes.JsonObject;
        var heroItems = payload?["heroItems"] as System.Text.Json.Nodes.JsonArray;
        var sectionItems = payload?["sectionItems"] as System.Text.Json.Nodes.JsonObject;
        var itemCount = 0;

        if (sectionItems is not null)
        {
            foreach (var section in sectionItems)
            {
                itemCount += section.Value is System.Text.Json.Nodes.JsonArray items ? items.Count : 0;
            }
        }

        return new DocumentDebugStats(
            heroItems?.Count ?? 0,
            sectionItems?.Count ?? 0,
            itemCount);
    }

    private sealed record DocumentDebugStats(int HeroCount, int SectionCount, int ItemCount);
}
