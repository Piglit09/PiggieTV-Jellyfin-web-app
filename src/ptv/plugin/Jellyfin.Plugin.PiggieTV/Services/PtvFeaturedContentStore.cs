using System.Text.Json;
using System.Text.Json.Nodes;
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
    private readonly PtvConfiguredRowAssociationService? _associations;
    private long _lastPayloadBytes;
    private string? _lastWriteError;

    /// <summary>
    /// Initializes a new instance of the <see cref="PtvFeaturedContentStore"/> class.
    /// </summary>
    /// <param name="applicationPaths">Jellyfin application paths.</param>
    /// <param name="logger">Logger.</param>
    /// <param name="associations">Optional process-local generation provenance owner.</param>
    public PtvFeaturedContentStore(
        IApplicationPaths applicationPaths,
        ILogger<PtvFeaturedContentStore> logger,
        PtvConfiguredRowAssociationService? associations = null)
    {
        _logger = logger;
        _associations = associations;

        _directory = Path.Combine(applicationPaths.PluginConfigurationsPath, "PiggieTV");
        Directory.CreateDirectory(_directory);
        _filePath = Path.Combine(_directory, "featured-content-cache.json");

        _logger.LogInformation(
            "PiggieTV featured-content cache store constructed. Category=store; DirectoryExists={DirectoryExists}.",
            Directory.Exists(_directory));
    }

    private static bool HasCurrentScopeSchemaSafely(PtvFeaturedContentDocument document)
    {
        try { return PtvFeaturedContentValidator.HasCurrentScopeSchema(document); }
        catch (ArgumentException) { return false; } // Duplicate raw JSON keys cannot confer freshness.
    }

    private void FilterTopology(PtvFeaturedContentDocument document,
        PtvConfiguredRowAssociationService.Generation? generation = null, bool publicRead = false)
    {
        // v7 has no scoped separation; retain raw diagnostics, never response authority.
        if (document.FeaturedContent?["version"]?.ToJsonString() == "7") return;
        if (_associations is not null)
        {
            _associations.FilterStoredTopology(document, publicRead);
            if (generation is not null && !_associations.IsCurrentTopology(generation)
                && document.FeaturedContent?["payload"] is JsonObject generatedPayload)
                PtvFeaturedTopology.Filter(generatedPayload, null, generation.CreateConfiguration().Rows);
        }
        else if (document.FeaturedContent is JsonObject featured && featured["payload"] is JsonObject payload)
            PtvFeaturedTopology.Filter(payload, null, null, false);
    }

    /// <inheritdoc />
    public async Task<PtvFeaturedContentDocument> ReadAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);

        try
        {
            var document = await ReadDocumentNoLockAsync(cancellationToken).ConfigureAwait(false);
            FilterTopology(document, publicRead: true);
            FilterTopology(document, publicRead: true);
            return document;
        }
        finally
        {
            _gate.Release();
        }
    }

    /// <inheritdoc />
    public Task<PtvFeaturedContentDocument> WriteAsync(
        PtvFeaturedContentDocument document,
        CancellationToken cancellationToken) => WriteCoreAsync(document, null, cancellationToken);

    internal Task<PtvFeaturedContentDocument> WriteGeneratedAsync(
        PtvFeaturedContentDocument document,
        PtvConfiguredRowAssociationService.Generation generation,
        CancellationToken cancellationToken) => WriteCoreAsync(document, generation, cancellationToken);

    private async Task<PtvFeaturedContentDocument> WriteCoreAsync(
        PtvFeaturedContentDocument document,
        PtvConfiguredRowAssociationService.Generation? generation,
        CancellationToken cancellationToken)
    {
        PtvFeaturedContentDocument normalizedDocument;
        byte[] payloadBytes = [];
        var incomingStats = GetDocumentDebugStats(document);

        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);

        var temporaryPath = $"{_filePath}.{Guid.NewGuid():N}.tmp";

        try
        {
            if (generation is not null)
            {
                // Cleanup must not launder malformed generated structure into a valid write.
                if (!HasCurrentScopeSchemaSafely(document))
                    throw new PtvFeaturedContentValidationException("PTV_CACHE_INVALID_SCOPE_SECTIONS", "Generated Featured sections must have coherent identities.");
                FilterTopology(document, generation);
            }
            normalizedDocument = ValidateDocument(document);
            if (generation is null) ValidateClientScope(normalizedDocument);
            payloadBytes = JsonSerializer.SerializeToUtf8Bytes(normalizedDocument, JsonOptions);

            Directory.CreateDirectory(_directory);
            var directoryExists = Directory.Exists(_directory);
            var fileExists = File.Exists(_filePath);
            var isWritable = TryProbeCacheDirectoryWritable(out var writeProbeError);
            var normalizedStats = GetDocumentDebugStats(normalizedDocument);

            _logger.LogInformation(
                "PiggieTV featured-content cache write starting. Category=store; DirectoryExists={DirectoryExists}; FileExists={FileExists}; Writable={Writable}; PayloadBytes={PayloadBytes}; MaxPayloadBytes={MaxPayloadBytes}; HeroCount={HeroCount}; SectionCount={SectionCount}; ItemCount={ItemCount}; IncomingHeroCount={IncomingHeroCount}; IncomingSectionCount={IncomingSectionCount}; IncomingItemCount={IncomingItemCount}.",
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
                throw new IOException("PiggieTV cache directory is not writable.");
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

            // Recheck after asynchronous I/O so a hold/epoch change while staging the
            // bytes cannot publish the previously captured library claims.
            FilterTopology(normalizedDocument, generation);
            var currentBytes = JsonSerializer.SerializeToUtf8Bytes(normalizedDocument, JsonOptions);
            if (!payloadBytes.AsSpan().SequenceEqual(currentBytes))
            {
                payloadBytes = currentBytes;
                await File.WriteAllBytesAsync(temporaryPath, payloadBytes, cancellationToken).ConfigureAwait(false);
            }
            // A retired configuration generation never receives presentation provenance.
            var currentGeneration = generation is not null && _associations?.IsCurrentTopology(generation) == true;
            if (generation is not null && !currentGeneration)
            {
                FilterTopology(normalizedDocument, generation);
                var retiredBytes = JsonSerializer.SerializeToUtf8Bytes(normalizedDocument, JsonOptions);
                if (!payloadBytes.AsSpan().SequenceEqual(retiredBytes))
                {
                    payloadBytes = retiredBytes;
                    await File.WriteAllBytesAsync(temporaryPath, payloadBytes, cancellationToken).ConfigureAwait(false);
                }
            }
            if (_associations is { } associations)
                associations.CommitStoreReplacement(() => ReplaceTemporaryFile(temporaryPath, _filePath), generation, normalizedDocument);
            else
                ReplaceTemporaryFile(temporaryPath, _filePath);
            _lastPayloadBytes = payloadBytes.Length;
            _lastWriteError = null;
            _logger.LogInformation(
                "PiggieTV featured-content cache write finished. Category=success; PayloadBytes={PayloadBytes}.",
                payloadBytes.Length);

            FilterTopology(normalizedDocument, generation);
            return normalizedDocument;
        }
        catch (PtvFeaturedContentValidationException ex)
        {
            _lastWriteError = "PTV_FEATURED_CACHE_VALIDATION_FAILED";
            _logger.LogWarning(
                "PiggieTV featured-content cache validation failed. Category=validation; Code={Code}; PayloadBytes={PayloadBytes}; MaxPayloadBytes={MaxPayloadBytes}; HeroCount={HeroCount}; SectionCount={SectionCount}; ItemCount={ItemCount}.",
                ex.Code,
                payloadBytes.Length,
                PtvFeaturedContentValidator.GetMaxDocumentBytes(),
                incomingStats.HeroCount,
                incomingStats.SectionCount,
                incomingStats.ItemCount);
            throw;
        }
        catch (Exception)
        {
            _lastWriteError = "PTV_FEATURED_CACHE_WRITE_FAILED";
            _logger.LogError(
                "PiggieTV featured-content cache write failed. Category=store; PayloadBytes={PayloadBytes}; MaxPayloadBytes={MaxPayloadBytes}; HeroCount={HeroCount}; SectionCount={SectionCount}; ItemCount={ItemCount}; DirectoryExists={DirectoryExists}; FileExists={FileExists}.",
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
            _associations?.RetireStoreBinding();
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
            var hadCurrentScopeSchema = HasCurrentScopeSchemaSafely(document);
            FilterTopology(document, publicRead: true);
            var featuredStatus = PtvFeaturedContentStatus.FromDocument(document);
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var isWritable = TryProbeCacheDirectoryWritable(out var writeProbeError);

            if (!isWritable && string.IsNullOrWhiteSpace(_lastWriteError))
            {
                _lastWriteError = writeProbeError;
            }

            var status = new PtvFeaturedContentStoreStatus
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
                    && hadCurrentScopeSchema
                    && PtvFeaturedContentValidator.HasCurrentScopeSchema(document)
                    && featuredStatus.ExpiresAt.HasValue
                    && featuredStatus.ExpiresAt.Value > now
            };
            FilterTopology(status.Document, publicRead: true);
            return status;
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
        catch (Exception)
        {
            error = "PTV_FEATURED_CACHE_PROBE_FAILED";
            _logger.LogWarning("PiggieTV featured-content cache directory is not writable. Category=write-probe.");
            return false;
        }
    }

    /// <inheritdoc />
    public PtvFeaturedContentDocument ValidateDocument(PtvFeaturedContentDocument? document)
    {
        return PtvFeaturedContentValidator.ValidateForSave(document, JsonOptions);
    }

    private void ValidateClientScope(PtvFeaturedContentDocument document)
    {
        var payload = (document.FeaturedContent as JsonObject)?["payload"] as JsonObject;
        var sections = payload?["sections"] as JsonArray;
        if (sections is null) return;

        var currentRules = _associations?.CaptureGeneration()?.CreateConfiguration().Rows?.Rules ?? [];
        var ownedRules = currentRules
            .Where(rule => rule.LibraryScope?.Mode is "defaultLibrary" or "virtualFolder")
            .Select(rule => rule.Id)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var section in sections.OfType<JsonObject>())
        {
            var sourceRuleId = ReadUniqueScopeField(section, "sourceRuleId");
            var ruleId = ReadUniqueScopeField(section, "ruleId");
            var claimedType = ReadUniqueScopeField(section, "scopeType");
            if (sourceRuleId is not null && ruleId is not null
                && !sourceRuleId.Equals(ruleId, StringComparison.OrdinalIgnoreCase))
            {
                throw new PtvFeaturedContentValidationException(
                    "PTV_CACHE_CONFLICTING_LIBRARY_SCOPE", "Featured section rule identifiers conflict.");
            }
            if (PtvFeaturedTopology.Owned(section, null)
                || string.Equals(claimedType, "library", StringComparison.OrdinalIgnoreCase)
                || (sourceRuleId is not null && ownedRules.Contains(sourceRuleId))
                || (ruleId is not null && ownedRules.Contains(ruleId)))
            {
                throw new PtvFeaturedContentValidationException(
                    "PTV_CACHE_UNTRUSTED_LIBRARY_SCOPE",
                    "Library-owned Featured sections require a current server-generated document.");
            }
        }
    }

    private static string? ReadUniqueScopeField(JsonObject source, string field)
    {
        var values = source.Where(property => property.Key.Equals(field, StringComparison.OrdinalIgnoreCase)).ToArray();
        if (values.Length == 0) return null;
        if (values.Length != 1 || values[0].Value is not JsonValue value || !value.TryGetValue<string>(out var text))
        {
            throw new PtvFeaturedContentValidationException(
                "PTV_CACHE_AMBIGUOUS_LIBRARY_SCOPE", "Featured section scope fields must be unique strings.");
        }

        return text?.Trim();
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
            var root = await JsonSerializer
                .DeserializeAsync<JsonObject>(stream, JsonOptions, cancellationToken)
                .ConfigureAwait(false);
            var document = CreateDocumentFromStoredJson(root);

            return PtvFeaturedContentValidator.NormalizeStoredDocument(document);
        }
        catch (JsonException)
        {
            _logger.LogWarning("PiggieTV featured-content cache file is invalid. Category=invalid-json; EmptyDocument=true.");
            QuarantineCorruptCacheFile();

            return PtvFeaturedContentValidator.CreateEmptyDocument();
        }
    }

    private static PtvFeaturedContentDocument CreateDocumentFromStoredJson(JsonObject? root)
    {
        if (root is null)
        {
            return PtvFeaturedContentValidator.CreateEmptyDocument();
        }

        if (root["featuredContent"] is not null || root["featuredContentSettings"] is not null)
        {
            return new PtvFeaturedContentDocument
            {
                FeaturedContent = root["featuredContent"]?.DeepClone(),
                FeaturedContentSettings = root["featuredContentSettings"]?.DeepClone(),
                UpdatedAt = ReadLong(root, "updatedAt") ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                Version = ReadInt(root, "version") ?? PtvFeaturedContentValidator.DocumentVersion
            };
        }

        if (root["payload"] is JsonObject)
        {
            return new PtvFeaturedContentDocument
            {
                FeaturedContent = root.DeepClone(),
                UpdatedAt = ReadLong(root, "updatedAt")
                    ?? ReadLong(root, "createdAt")
                    ?? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                Version = PtvFeaturedContentValidator.DocumentVersion
            };
        }

        return PtvFeaturedContentValidator.CreateEmptyDocument();
    }

    private static int? ReadInt(JsonObject source, string propertyName)
    {
        return source.TryGetPropertyValue(propertyName, out var value)
            && value is JsonValue jsonValue
            && jsonValue.TryGetValue<int>(out var result)
            ? result
            : null;
    }

    private static long? ReadLong(JsonObject source, string propertyName)
    {
        return source.TryGetPropertyValue(propertyName, out var value)
            && value is JsonValue jsonValue
            && jsonValue.TryGetValue<long>(out var result)
            ? result
            : null;
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
        catch (Exception)
        {
            _logger.LogWarning("PiggieTV featured-content cache size read failed. Category=file-size.");
        }

        return _lastPayloadBytes;
    }

    private void QuarantineCorruptCacheFile()
    {
        try
        {
            if (!File.Exists(_filePath))
            {
                return;
            }

            var corruptPath = $"{_filePath}.corrupt.{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";

            File.Move(_filePath, corruptPath, true);
            _logger.LogWarning("PiggieTV corrupt featured-content cache quarantined. Category=invalid-json.");
        }
        catch (Exception)
        {
            _logger.LogWarning("PiggieTV corrupt featured-content cache quarantine failed. Category=invalid-json.");
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
