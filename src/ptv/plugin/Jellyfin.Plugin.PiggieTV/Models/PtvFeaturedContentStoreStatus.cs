using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>
/// File-store status for the shared PiggieTV featured-content cache.
/// </summary>
public sealed class PtvFeaturedContentStoreStatus
{
    /// <summary>
    /// Gets or sets a value indicating whether the fixed cache directory exists.
    /// </summary>
    [JsonPropertyName("cachePathExists")]
    public bool CachePathExists { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the fixed cache directory is writable.
    /// </summary>
    [JsonPropertyName("cachePathWritable")]
    public bool CachePathWritable { get; set; }

    /// <summary>
    /// Gets or sets the fixed cache directory path.
    /// </summary>
    [JsonPropertyName("cachePath")]
    public string? CachePath { get; set; }

    /// <summary>
    /// Gets or sets the fixed featured-content cache file path.
    /// </summary>
    [JsonPropertyName("cacheFilePath")]
    public string? CacheFilePath { get; set; }

    /// <summary>
    /// Gets or sets the last cache store write error.
    /// </summary>
    [JsonPropertyName("cacheWriteError")]
    public string? CacheWriteError { get; set; }

    /// <summary>
    /// Gets or sets the last serialized cache payload size in bytes.
    /// </summary>
    [JsonPropertyName("cachePayloadBytes")]
    public long CachePayloadBytes { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the featured cache file exists.
    /// </summary>
    [JsonPropertyName("featuredCacheExists")]
    public bool FeaturedCacheExists { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the stored cache has payload and is fresh.
    /// </summary>
    [JsonPropertyName("featuredCacheFresh")]
    public bool FeaturedCacheFresh { get; set; }

    /// <summary>
    /// Gets or sets the cache creation timestamp as Unix epoch milliseconds.
    /// </summary>
    [JsonPropertyName("featuredCacheCreatedAt")]
    public long? FeaturedCacheCreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the cache expiry timestamp as Unix epoch milliseconds.
    /// </summary>
    [JsonPropertyName("featuredCacheExpiresAt")]
    public long? FeaturedCacheExpiresAt { get; set; }

    /// <summary>
    /// Gets or sets the currently readable cache document.
    /// </summary>
    [JsonPropertyName("document")]
    public PtvFeaturedContentDocument Document { get; set; } = Jellyfin.Plugin.PiggieTV.Services.PtvFeaturedContentValidator.CreateEmptyDocument();
}
