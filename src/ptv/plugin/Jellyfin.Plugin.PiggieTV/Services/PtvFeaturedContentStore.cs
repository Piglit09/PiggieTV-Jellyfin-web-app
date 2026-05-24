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
        var normalizedDocument = ValidateDocument(document);

        await _gate.WaitAsync(cancellationToken).ConfigureAwait(false);

        try
        {
            Directory.CreateDirectory(_directory);

            var temporaryPath = $"{_filePath}.{Guid.NewGuid():N}.tmp";

            await using (var stream = File.Create(temporaryPath))
            {
                await JsonSerializer
                    .SerializeAsync(stream, normalizedDocument, JsonOptions, cancellationToken)
                    .ConfigureAwait(false);
            }

            File.Move(temporaryPath, _filePath, true);

            return normalizedDocument;
        }
        finally
        {
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

            return new PtvFeaturedContentStoreStatus
            {
                CachePathExists = Directory.Exists(_directory),
                Document = document,
                FeaturedCacheCreatedAt = featuredStatus.CreatedAt,
                FeaturedCacheExists = File.Exists(_filePath),
                FeaturedCacheExpiresAt = featuredStatus.ExpiresAt,
                FeaturedCacheFresh = featuredStatus.HasPayload
                    && featuredStatus.ExpiresAt.HasValue
                    && featuredStatus.ExpiresAt.Value > now
            };
        }
        finally
        {
            _gate.Release();
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

            return PtvFeaturedContentValidator.CreateEmptyDocument();
        }
    }
}
