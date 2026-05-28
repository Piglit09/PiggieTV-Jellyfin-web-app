using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>
/// Runtime status for the PiggieTV server-side featured-content refresh worker.
/// </summary>
public sealed class PtvFeaturedContentRefreshStatus
{
    /// <summary>
    /// Gets or sets a value indicating whether a refresh is currently running.
    /// </summary>
    [JsonPropertyName("refreshInProgress")]
    public bool RefreshInProgress { get; set; }

    /// <summary>
    /// Gets or sets the last refresh start timestamp as Unix epoch milliseconds.
    /// </summary>
    [JsonPropertyName("lastRefreshStartedAt")]
    public long? LastRefreshStartedAt { get; set; }

    /// <summary>
    /// Gets or sets the last successful or failed refresh completion timestamp as Unix epoch milliseconds.
    /// </summary>
    [JsonPropertyName("lastRefreshCompletedAt")]
    public long? LastRefreshCompletedAt { get; set; }

    /// <summary>
    /// Gets or sets the last refresh duration in milliseconds.
    /// </summary>
    [JsonPropertyName("lastRefreshDurationMs")]
    public long? LastRefreshDurationMs { get; set; }

    /// <summary>
    /// Gets or sets the last refresh error, if any.
    /// </summary>
    [JsonPropertyName("lastRefreshError")]
    public string? LastRefreshError { get; set; }

    /// <summary>
    /// Gets or sets the last non-fatal refresh warning, if any.
    /// </summary>
    [JsonPropertyName("lastRefreshWarning")]
    public string? LastRefreshWarning { get; set; }

    /// <summary>
    /// Gets or sets the next scheduled refresh timestamp as Unix epoch milliseconds.
    /// </summary>
    [JsonPropertyName("nextRefreshAt")]
    public long? NextRefreshAt { get; set; }
}
