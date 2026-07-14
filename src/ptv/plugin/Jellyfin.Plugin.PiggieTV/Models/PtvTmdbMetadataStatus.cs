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
    /// Gets or sets the last credential validation state.
    /// </summary>
    [JsonPropertyName("credentialStatus")]
    public string? CredentialStatus { get; set; }

    /// <summary>
    /// Gets or sets the detected credential type.
    /// </summary>
    [JsonPropertyName("credentialType")]
    public string? CredentialType { get; set; }

    /// <summary>
    /// Gets or sets the sanitized credential length.
    /// </summary>
    [JsonPropertyName("credentialLength")]
    public int CredentialLength { get; set; }

    /// <summary>
    /// Gets or sets the number of cached TMDb fact entries in memory.
    /// </summary>
    [JsonPropertyName("cacheSize")]
    public int CacheSize { get; set; }

    /// <summary>
    /// Gets or sets the number of short-lived negative TMDb cache entries.
    /// </summary>
    [JsonPropertyName("negativeCacheSize")]
    public int NegativeCacheSize { get; set; }

    /// <summary>
    /// Gets or sets the number of short-lived negative TMDb cache hits.
    /// </summary>
    [JsonPropertyName("negativeCacheHits")]
    public long NegativeCacheHits { get; set; }

    /// <summary>
    /// Gets or sets the number of short-lived negative TMDb cache writes.
    /// </summary>
    [JsonPropertyName("negativeCacheWrites")]
    public long NegativeCacheWrites { get; set; }

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
    /// Gets or sets a stable code for the last TMDb enrichment error, if any.
    /// </summary>
    [JsonPropertyName("lastErrorCode")]
    public string? LastErrorCode { get; set; }

    /// <summary>
    /// Gets or sets the last TMDb HTTP status code observed during credential validation.
    /// </summary>
    [JsonPropertyName("lastStatusCode")]
    public int? LastStatusCode { get; set; }

    /// <summary>
    /// Gets or sets a sanitized TMDb error response body, if available.
    /// </summary>
    [JsonPropertyName("lastErrorBody")]
    public string? LastErrorBody { get; set; }

    /// <summary>
    /// Gets or sets the last TMDb enrichment duration in milliseconds.
    /// </summary>
    [JsonPropertyName("lastDurationMs")]
    public long? LastDurationMs { get; set; }

    /// <summary>
    /// Gets or sets when credentials were last validated.
    /// </summary>
    [JsonPropertyName("lastValidatedAt")]
    public DateTimeOffset? LastValidatedAt { get; set; }

    /// <summary>
    /// Gets or sets the number of unique TMDb requests considered in the last enrichment pass.
    /// </summary>
    [JsonPropertyName("lastRequestedCount")]
    public int LastRequestedCount { get; set; }

    /// <summary>
    /// Gets or sets the number of requests served from positive or negative cache in the last pass.
    /// </summary>
    [JsonPropertyName("lastCachedCount")]
    public int LastCachedCount { get; set; }

    /// <summary>
    /// Gets or sets the number of remote requests started in the last pass.
    /// </summary>
    [JsonPropertyName("lastAttemptedCount")]
    public int LastAttemptedCount { get; set; }

    /// <summary>
    /// Gets or sets the number of successful remote requests completed in the last pass.
    /// </summary>
    [JsonPropertyName("lastCompletedCount")]
    public int LastCompletedCount { get; set; }

    /// <summary>
    /// Gets or sets the number of requests deferred by the per-pass remote budget.
    /// </summary>
    [JsonPropertyName("lastSkippedCount")]
    public int LastSkippedCount { get; set; }

    /// <summary>
    /// Gets or sets the number of failed remote requests in the last pass.
    /// </summary>
    [JsonPropertyName("lastFailedCount")]
    public int LastFailedCount { get; set; }

    /// <summary>
    /// Gets or sets the number of cancelled remote requests in the last pass.
    /// </summary>
    [JsonPropertyName("lastCancelledCount")]
    public int LastCancelledCount { get; set; }

    /// <summary>
    /// Gets or sets a value indicating whether the last pass returned a useful partial result.
    /// </summary>
    [JsonPropertyName("lastPartial")]
    public bool LastPartial { get; set; }
}
