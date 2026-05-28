using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>
/// Public status for the featured-content cache subsystem.
/// </summary>
public sealed class PtvContentCacheStatus
{
    /// <summary>
    /// Gets or sets a value indicating whether the cache file exists.
    /// </summary>
    [JsonPropertyName("exists")]
    public bool Exists { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the cache file is fresh.
    /// </summary>
    [JsonPropertyName("fresh")]
    public bool Fresh { get; set; }

    /// <summary>
    /// Gets or sets the last cache write error.
    /// </summary>
    [JsonPropertyName("writeError")]
    public string? WriteError { get; set; }

    /// <summary>
    /// Gets or sets the last serialized cache payload size in bytes.
    /// </summary>
    [JsonPropertyName("payloadBytes")]
    public long PayloadBytes { get; set; }

    /// <summary>
    /// Gets or sets the cache creation timestamp as Unix epoch milliseconds.
    /// </summary>
    [JsonPropertyName("createdAt")]
    public long? CreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the cache expiry timestamp as Unix epoch milliseconds.
    /// </summary>
    [JsonPropertyName("expiresAt")]
    public long? ExpiresAt { get; set; }

    /// <summary>
    /// Creates public content cache status from the store status.
    /// </summary>
    /// <param name="storeStatus">Store status.</param>
    /// <returns>Public content cache status.</returns>
    public static PtvContentCacheStatus FromStoreStatus(PtvFeaturedContentStoreStatus storeStatus)
    {
        return new PtvContentCacheStatus
        {
            CreatedAt = storeStatus.FeaturedCacheCreatedAt,
            Exists = storeStatus.FeaturedCacheExists,
            ExpiresAt = storeStatus.FeaturedCacheExpiresAt,
            Fresh = storeStatus.FeaturedCacheFresh,
            PayloadBytes = storeStatus.CachePayloadBytes,
            WriteError = storeStatus.CacheWriteError
        };
    }
}
