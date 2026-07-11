using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>
/// Request for server-side music metadata lookup.
/// </summary>
public sealed class PtvMusicMetadataLookupRequest
{
    /// <summary>Gets or sets the Jellyfin item id to hydrate lookup terms from.</summary>
    [JsonPropertyName("itemId")]
    public string? ItemId { get; set; }

    /// <summary>Gets or sets the track title.</summary>
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    /// <summary>Gets or sets the artist name.</summary>
    [JsonPropertyName("artist")]
    public string? Artist { get; set; }

    /// <summary>Gets or sets the album or release title.</summary>
    [JsonPropertyName("album")]
    public string? Album { get; set; }

    /// <summary>Gets or sets the release year.</summary>
    [JsonPropertyName("year")]
    public int? Year { get; set; }

    /// <summary>Gets or sets the maximum candidate count per provider.</summary>
    [JsonPropertyName("limit")]
    public int? Limit { get; set; }
}

/// <summary>
/// Server-side music metadata lookup response.
/// </summary>
public sealed class PtvMusicMetadataLookupResponse
{
    /// <summary>Gets or sets a value indicating whether the lookup completed.</summary>
    [JsonPropertyName("ok")]
    public bool Ok { get; set; }

    /// <summary>Gets or sets the Jellyfin item id.</summary>
    [JsonPropertyName("itemId")]
    public string? ItemId { get; set; }

    /// <summary>Gets or sets the Jellyfin item name.</summary>
    [JsonPropertyName("itemName")]
    public string? ItemName { get; set; }

    /// <summary>Gets or sets the track title used for lookup.</summary>
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    /// <summary>Gets or sets the artist used for lookup.</summary>
    [JsonPropertyName("artist")]
    public string? Artist { get; set; }

    /// <summary>Gets or sets the album used for lookup.</summary>
    [JsonPropertyName("album")]
    public string? Album { get; set; }

    /// <summary>Gets or sets the release year used for lookup.</summary>
    [JsonPropertyName("year")]
    public int? Year { get; set; }

    /// <summary>Gets or sets the generated-at timestamp.</summary>
    [JsonPropertyName("generatedAtUtc")]
    public DateTimeOffset GeneratedAtUtc { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>Gets or sets provider statuses.</summary>
    [JsonPropertyName("providers")]
    public List<PtvMusicMetadataProviderStatus> Providers { get; set; } = [];

    /// <summary>Gets or sets metadata candidates.</summary>
    [JsonPropertyName("candidates")]
    public List<PtvMusicMetadataCandidate> Candidates { get; set; } = [];

    /// <summary>Gets or sets lookup diagnostics for administrators.</summary>
    [JsonPropertyName("diagnostics")]
    public List<string> Diagnostics { get; set; } = [];
}

/// <summary>
/// Music metadata provider status for one lookup.
/// </summary>
public sealed class PtvMusicMetadataProviderStatus
{
    /// <summary>Gets or sets provider name.</summary>
    [JsonPropertyName("provider")]
    public string Provider { get; set; } = string.Empty;

    /// <summary>Gets or sets a value indicating whether the provider is enabled.</summary>
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; }

    /// <summary>Gets or sets a value indicating whether the provider has required credentials.</summary>
    [JsonPropertyName("configured")]
    public bool Configured { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether the response came from the plugin cache.</summary>
    [JsonPropertyName("cached")]
    public bool Cached { get; set; }

    /// <summary>Gets or sets result count.</summary>
    [JsonPropertyName("candidateCount")]
    public int CandidateCount { get; set; }

    /// <summary>Gets or sets provider HTTP status code.</summary>
    [JsonPropertyName("statusCode")]
    public int? StatusCode { get; set; }

    /// <summary>Gets or sets provider request duration.</summary>
    [JsonPropertyName("durationMs")]
    public long? DurationMs { get; set; }

    /// <summary>Gets or sets provider error.</summary>
    [JsonPropertyName("error")]
    public string? Error { get; set; }
}

/// <summary>
/// Candidate metadata from an external music provider.
/// </summary>
public sealed class PtvMusicMetadataCandidate
{
    /// <summary>Gets or sets provider name.</summary>
    [JsonPropertyName("provider")]
    public string Provider { get; set; } = string.Empty;

    /// <summary>Gets or sets provider confidence or score.</summary>
    [JsonPropertyName("confidence")]
    public double Confidence { get; set; }

    /// <summary>Gets or sets track title.</summary>
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    /// <summary>Gets or sets artist name.</summary>
    [JsonPropertyName("artist")]
    public string? Artist { get; set; }

    /// <summary>Gets or sets album or release title.</summary>
    [JsonPropertyName("album")]
    public string? Album { get; set; }

    /// <summary>Gets or sets release year.</summary>
    [JsonPropertyName("year")]
    public int? Year { get; set; }

    /// <summary>Gets or sets provider ids that can be copied into Jellyfin metadata.</summary>
    [JsonPropertyName("providerIds")]
    public Dictionary<string, string> ProviderIds { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Gets or sets genres.</summary>
    [JsonPropertyName("genres")]
    public List<string> Genres { get; set; } = [];

    /// <summary>Gets or sets Discogs styles.</summary>
    [JsonPropertyName("styles")]
    public List<string> Styles { get; set; } = [];

    /// <summary>Gets or sets tags.</summary>
    [JsonPropertyName("tags")]
    public List<string> Tags { get; set; } = [];

    /// <summary>Gets or sets labels.</summary>
    [JsonPropertyName("labels")]
    public List<string> Labels { get; set; } = [];

    /// <summary>Gets or sets provider URL.</summary>
    [JsonPropertyName("url")]
    public string? Url { get; set; }

    /// <summary>Gets or sets compact candidate summary.</summary>
    [JsonPropertyName("summary")]
    public string? Summary { get; set; }
}
