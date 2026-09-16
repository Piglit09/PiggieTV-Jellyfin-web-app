using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>A privacy-minimized PiggieTV media issue submitted by a client.</summary>
public sealed class PtvMediaReportRequest
{
    /// <summary>Gets or sets the request schema version.</summary>
    [JsonPropertyName("schemaVersion")]
    public int SchemaVersion { get; set; } = 1;

    /// <summary>Gets or sets the Jellyfin item identifier.</summary>
    [JsonPropertyName("itemId")]
    public string? ItemId { get; set; }

    /// <summary>Gets or sets the bounded client surface category.</summary>
    [JsonPropertyName("source")]
    public string? Source { get; set; }

    /// <summary>Gets or sets the bounded issue category.</summary>
    [JsonPropertyName("reason")]
    public string? Reason { get; set; }

    /// <summary>Gets or sets an optional Jellyfin item type.</summary>
    [JsonPropertyName("itemType")]
    public string? ItemType { get; set; }

    /// <summary>Gets or sets an optional playback position in milliseconds.</summary>
    [JsonPropertyName("playbackPositionMs")]
    public long? PlaybackPositionMs { get; set; }

    /// <summary>Gets or sets an optional Jellyfin media-source identifier.</summary>
    [JsonPropertyName("mediaSourceId")]
    public string? MediaSourceId { get; set; }

    /// <summary>Gets or sets an optional bounded Jellyfin play-method label.</summary>
    [JsonPropertyName("playMethod")]
    public string? PlayMethod { get; set; }

    /// <summary>Gets or sets optional user-supplied issue detail.</summary>
    [JsonPropertyName("details")]
    public string? Details { get; set; }
}

/// <summary>One accepted, privacy-minimized media issue retained by the server.</summary>
public sealed class PtvMediaReportRecord
{
    /// <summary>Gets or sets the stored record schema version.</summary>
    [JsonPropertyName("schemaVersion")]
    public int SchemaVersion { get; set; } = 1;

    /// <summary>Gets or sets the server-generated opaque report identifier.</summary>
    [JsonPropertyName("reportId")]
    public string ReportId { get; set; } = string.Empty;

    /// <summary>Gets or sets the server receipt timestamp.</summary>
    [JsonPropertyName("receivedAtUtc")]
    public DateTimeOffset ReceivedAtUtc { get; set; }

    /// <summary>Gets or sets the normalized Jellyfin item identifier.</summary>
    [JsonPropertyName("itemId")]
    public string ItemId { get; set; } = string.Empty;

    /// <summary>Gets or sets the bounded client surface category.</summary>
    [JsonPropertyName("source")]
    public string Source { get; set; } = string.Empty;

    /// <summary>Gets or sets the bounded issue category.</summary>
    [JsonPropertyName("reason")]
    public string Reason { get; set; } = string.Empty;

    /// <summary>Gets or sets an optional Jellyfin item type.</summary>
    [JsonPropertyName("itemType")]
    public string? ItemType { get; set; }

    /// <summary>Gets or sets an optional playback position in milliseconds.</summary>
    [JsonPropertyName("playbackPositionMs")]
    public long? PlaybackPositionMs { get; set; }

    /// <summary>Gets or sets an optional Jellyfin media-source identifier.</summary>
    [JsonPropertyName("mediaSourceId")]
    public string? MediaSourceId { get; set; }

    /// <summary>Gets or sets an optional bounded Jellyfin play-method label.</summary>
    [JsonPropertyName("playMethod")]
    public string? PlayMethod { get; set; }

    /// <summary>Gets or sets optional sanitized issue detail.</summary>
    [JsonPropertyName("details")]
    public string? Details { get; set; }
}

/// <summary>Successful media-report submission response.</summary>
public sealed class PtvMediaReportAcceptedResponse
{
    /// <summary>Gets or sets the response schema version.</summary>
    [JsonPropertyName("schemaVersion")]
    public int SchemaVersion { get; set; } = 1;

    /// <summary>Gets or sets the server-generated report identifier.</summary>
    [JsonPropertyName("reportId")]
    public string ReportId { get; set; } = string.Empty;

    /// <summary>Gets or sets the server receipt timestamp.</summary>
    [JsonPropertyName("receivedAtUtc")]
    public DateTimeOffset ReceivedAtUtc { get; set; }

    /// <summary>Gets or sets the stable acceptance state.</summary>
    [JsonPropertyName("status")]
    public string Status { get; set; } = "accepted";
}

/// <summary>Outcome from the bounded media-report store.</summary>
public sealed class PtvMediaReportSubmissionResult
{
    /// <summary>Gets or sets the submission outcome.</summary>
    public PtvMediaReportSubmissionStatus Status { get; set; }

    /// <summary>Gets or sets the accepted record.</summary>
    public PtvMediaReportRecord? Record { get; set; }

    /// <summary>Gets or sets the bounded retry delay for rate-limited callers.</summary>
    public int RetryAfterSeconds { get; set; }
}

/// <summary>Bounded media-report store outcomes.</summary>
public enum PtvMediaReportSubmissionStatus
{
    /// <summary>The report was durably accepted.</summary>
    Accepted,

    /// <summary>The authenticated owner exceeded the bounded submission window.</summary>
    RateLimited,

    /// <summary>The server-local store could not safely accept the report.</summary>
    Unavailable
}
