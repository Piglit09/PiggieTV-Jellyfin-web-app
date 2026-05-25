using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>
/// PiggieTV TMDb metadata enrichment status.
/// </summary>
public sealed class PtvTmdbMetadataStatus
{
    /// <summary>
    /// Gets or sets a value indicating whether TMDb metadata enrichment is enabled.
    /// </summary>
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether a server-side TMDb credential is configured.
    /// </summary>
    [JsonPropertyName("configured")]
    public bool Configured { get; set; }

    /// <summary>
    /// Gets or sets the number of cached TMDb fact entries in memory.
    /// </summary>
    [JsonPropertyName("cacheSize")]
    public int CacheSize { get; set; }

    /// <summary>
    /// Gets or sets the number of TMDb fact cache hits.
    /// </summary>
    [JsonPropertyName("cacheHits")]
    public long CacheHits { get; set; }

    /// <summary>
    /// Gets or sets the number of TMDb fact cache misses.
    /// </summary>
    [JsonPropertyName("cacheMisses")]
    public long CacheMisses { get; set; }

    /// <summary>
    /// Gets or sets the last TMDb enrichment error, if any.
    /// </summary>
    [JsonPropertyName("lastError")]
    public string? LastError { get; set; }

    /// <summary>
    /// Gets or sets the last TMDb enrichment duration in milliseconds.
    /// </summary>
    [JsonPropertyName("lastDurationMs")]
    public long? LastDurationMs { get; set; }
}
