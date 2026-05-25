using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>
/// PiggieTV plugin health response.
/// </summary>
public sealed class PtvStatusResponse
{
    /// <summary>
    /// Gets or sets a value indicating whether the plugin API is available.
    /// </summary>
    [JsonPropertyName("ok")]
    public bool Ok { get; set; } = true;

    /// <summary>
    /// Gets or sets the plugin name.
    /// </summary>
    [JsonPropertyName("name")]
    public string Name { get; set; } = "PiggieTV";

    /// <summary>
    /// Gets or sets the plugin name.
    /// </summary>
    [JsonPropertyName("pluginName")]
    public string PluginName { get; set; } = "PiggieTV";

    /// <summary>
    /// Gets or sets the plugin version.
    /// </summary>
    [JsonPropertyName("version")]
    public string Version { get; set; } = Plugin.Instance?.Version?.ToString() ?? "0.0.0.0";

    /// <summary>
    /// Gets or sets the plugin version.
    /// </summary>
    [JsonPropertyName("pluginVersion")]
    public string PluginVersion { get; set; } = Plugin.Instance?.Version?.ToString() ?? "0.0.0.0";

    /// <summary>
    /// Gets or sets the public PiggieTV plugin API version.
    /// </summary>
    [JsonPropertyName("apiVersion")]
    public int ApiVersion { get; set; } = Api.PtvApiRoutes.CurrentVersion;

    /// <summary>
    /// Gets or sets the current versioned API path.
    /// </summary>
    [JsonPropertyName("apiPath")]
    public string ApiPath { get; set; } = $"/{Api.PtvApiRoutes.Root}/{Api.PtvApiRoutes.V1}";

    /// <summary>
    /// Gets or sets the server timestamp as Unix epoch milliseconds.
    /// </summary>
    [JsonPropertyName("serverTime")]
    public long ServerTime { get; set; } = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    /// <summary>
    /// Gets or sets the current server UTC timestamp.
    /// </summary>
    [JsonPropertyName("serverTimeUtc")]
    public DateTimeOffset ServerTimeUtc { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>
    /// Gets or sets the cache backend identifier.
    /// </summary>
    [JsonPropertyName("cacheBackend")]
    public string CacheBackend { get; set; } = "plugin-file";

    /// <summary>
    /// Gets or sets the available plugin features.
    /// </summary>
    [JsonPropertyName("features")]
    public string[] Features { get; set; } = ["status", "featuredContent", "featuredContentRefresh"];

    /// <summary>
    /// Gets or sets a value indicating whether authenticated users can read featured content.
    /// </summary>
    [JsonPropertyName("canReadFeaturedContent")]
    public bool CanReadFeaturedContent { get; set; } = true;

    /// <summary>
    /// Gets or sets a value indicating whether the current user can write featured content.
    /// </summary>
    [JsonPropertyName("canWriteFeaturedContent")]
    public bool CanWriteFeaturedContent { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the fixed plugin cache directory exists.
    /// </summary>
    [JsonPropertyName("cachePathExists")]
    public bool CachePathExists { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether a featured cache file exists.
    /// </summary>
    [JsonPropertyName("featuredCacheExists")]
    public bool FeaturedCacheExists { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the featured cache exists and is fresh.
    /// </summary>
    [JsonPropertyName("featuredCacheFresh")]
    public bool FeaturedCacheFresh { get; set; }

    /// <summary>
    /// Gets or sets the featured cache creation timestamp as Unix epoch milliseconds.
    /// </summary>
    [JsonPropertyName("featuredCacheCreatedAt")]
    public long? FeaturedCacheCreatedAt { get; set; }

    /// <summary>
    /// Gets or sets the featured cache expiry timestamp as Unix epoch milliseconds.
    /// </summary>
    [JsonPropertyName("featuredCacheExpiresAt")]
    public long? FeaturedCacheExpiresAt { get; set; }

    /// <summary>
    /// Gets or sets the maximum accepted cache payload size.
    /// </summary>
    [JsonPropertyName("maxCachePayloadBytes")]
    public int MaxCachePayloadBytes { get; set; } = Jellyfin.Plugin.PiggieTV.Services.PtvFeaturedContentValidator.MaxDocumentBytes;

    /// <summary>
    /// Gets or sets the featured-content cache status.
    /// </summary>
    [JsonPropertyName("featuredContent")]
    public PtvFeaturedContentStatus FeaturedContent { get; set; } = new();

    /// <summary>
    /// Gets or sets a value indicating whether a server-side featured-content refresh is currently running.
    /// </summary>
    [JsonPropertyName("refreshInProgress")]
    public bool RefreshInProgress { get; set; }

    /// <summary>
    /// Gets or sets the last refresh start timestamp as Unix epoch milliseconds.
    /// </summary>
    [JsonPropertyName("lastRefreshStartedAt")]
    public long? LastRefreshStartedAt { get; set; }

    /// <summary>
    /// Gets or sets the last refresh completion timestamp as Unix epoch milliseconds.
    /// </summary>
    [JsonPropertyName("lastRefreshCompletedAt")]
    public long? LastRefreshCompletedAt { get; set; }

    /// <summary>
    /// Gets or sets the last refresh duration in milliseconds.
    /// </summary>
    [JsonPropertyName("lastRefreshDurationMs")]
    public long? LastRefreshDurationMs { get; set; }

    /// <summary>
    /// Gets or sets the last refresh error.
    /// </summary>
    [JsonPropertyName("lastRefreshError")]
    public string? LastRefreshError { get; set; }

    /// <summary>
    /// Gets or sets the next scheduled refresh timestamp as Unix epoch milliseconds.
    /// </summary>
    [JsonPropertyName("nextRefreshAt")]
    public long? NextRefreshAt { get; set; }

    /// <summary>
    /// Gets or sets the optional TMDb metadata enrichment status.
    /// </summary>
    [JsonPropertyName("tmdbMetadata")]
    public PtvTmdbMetadataStatus TmdbMetadata { get; set; } = new();

    /// <summary>
    /// Creates a status response from a stored document.
    /// </summary>
    /// <param name="storeStatus">Featured-content store status.</param>
    /// <param name="canWriteFeaturedContent">Whether the current user can write featured content.</param>
    /// <param name="refreshStatus">Featured-content refresh worker status.</param>
    /// <param name="tmdbMetadata">TMDb metadata enrichment status.</param>
    /// <returns>Status response.</returns>
    public static PtvStatusResponse FromStoreStatus(
        PtvFeaturedContentStoreStatus storeStatus,
        bool canWriteFeaturedContent,
        PtvFeaturedContentRefreshStatus? refreshStatus = null,
        PtvTmdbMetadataStatus? tmdbMetadata = null)
    {
        var now = DateTimeOffset.UtcNow;
        var pluginVersion = Plugin.Instance?.Version?.ToString() ?? "0.0.0.0";
        refreshStatus ??= new PtvFeaturedContentRefreshStatus();

        return new PtvStatusResponse
        {
            CanWriteFeaturedContent = canWriteFeaturedContent,
            CachePathExists = storeStatus.CachePathExists,
            FeaturedCacheCreatedAt = storeStatus.FeaturedCacheCreatedAt,
            FeaturedCacheExists = storeStatus.FeaturedCacheExists,
            FeaturedCacheExpiresAt = storeStatus.FeaturedCacheExpiresAt,
            FeaturedCacheFresh = storeStatus.FeaturedCacheFresh,
            FeaturedContent = PtvFeaturedContentStatus.FromDocument(storeStatus.Document),
            LastRefreshCompletedAt = refreshStatus.LastRefreshCompletedAt,
            LastRefreshDurationMs = refreshStatus.LastRefreshDurationMs,
            LastRefreshError = refreshStatus.LastRefreshError,
            LastRefreshStartedAt = refreshStatus.LastRefreshStartedAt,
            NextRefreshAt = refreshStatus.NextRefreshAt ?? storeStatus.FeaturedCacheExpiresAt,
            PluginVersion = pluginVersion,
            RefreshInProgress = refreshStatus.RefreshInProgress,
            ServerTime = now.ToUnixTimeMilliseconds(),
            ServerTimeUtc = now,
            TmdbMetadata = tmdbMetadata ?? new PtvTmdbMetadataStatus(),
            Version = pluginVersion
        };
    }
}
