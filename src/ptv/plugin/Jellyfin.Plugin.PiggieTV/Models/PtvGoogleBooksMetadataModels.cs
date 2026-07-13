using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>
/// Request for server-side Google Books metadata lookup.
/// </summary>
public sealed class PtvGoogleBooksMetadataLookupRequest
{
    /// <summary>Gets or sets the Jellyfin item id to hydrate lookup terms from.</summary>
    [JsonPropertyName("itemId")]
    public string? ItemId { get; set; }

    /// <summary>Gets or sets the book/comic title.</summary>
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    /// <summary>Gets or sets the author/creator name.</summary>
    [JsonPropertyName("author")]
    public string? Author { get; set; }

    /// <summary>Gets or sets the ISBN search term.</summary>
    [JsonPropertyName("isbn")]
    public string? Isbn { get; set; }

    /// <summary>Gets or sets an existing Google Books volume id.</summary>
    [JsonPropertyName("googleBooksId")]
    public string? GoogleBooksId { get; set; }

    /// <summary>Gets or sets the publication year.</summary>
    [JsonPropertyName("year")]
    public int? Year { get; set; }

    /// <summary>Gets or sets the maximum candidate count.</summary>
    [JsonPropertyName("limit")]
    public int? Limit { get; set; }
}

/// <summary>
/// Google Books lookup response.
/// </summary>
public sealed class PtvGoogleBooksMetadataLookupResponse
{
    /// <summary>Gets or sets a value indicating whether lookup completed.</summary>
    [JsonPropertyName("ok")]
    public bool Ok { get; set; }

    /// <summary>Gets or sets the generated-at timestamp.</summary>
    [JsonPropertyName("generatedAtUtc")]
    public DateTimeOffset GeneratedAtUtc { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>Gets or sets provider status.</summary>
    [JsonPropertyName("provider")]
    public PtvGoogleBooksMetadataProviderStatus Provider { get; set; } = new();

    /// <summary>Gets or sets metadata candidates.</summary>
    [JsonPropertyName("candidates")]
    public List<PtvGoogleBooksMetadataCandidate> Candidates { get; set; } = [];

    /// <summary>Gets or sets metadata candidates using Jellyfin remote-search casing.</summary>
    [JsonPropertyName("Candidates")]
    public List<PtvGoogleBooksMetadataCandidate> JellyfinCandidates => Candidates;

    /// <summary>Gets or sets lookup diagnostics for administrators.</summary>
    [JsonPropertyName("diagnostics")]
    public List<string> Diagnostics { get; set; } = [];
}

/// <summary>
/// Google Books provider status for one lookup.
/// </summary>
public sealed class PtvGoogleBooksMetadataProviderStatus
{
    /// <summary>Gets or sets provider name.</summary>
    [JsonPropertyName("provider")]
    public string Provider { get; set; } = "Google Books";

    /// <summary>Gets or sets a value indicating whether the provider is enabled.</summary>
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; } = true;

    /// <summary>Gets or sets a value indicating whether an API key is configured.</summary>
    [JsonPropertyName("configured")]
    public bool Configured { get; set; }

    /// <summary>Gets or sets a value indicating whether the response came from cache.</summary>
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
/// A normalized Google Books metadata candidate that can also be used by Jellyfin remote-search apply UI.
/// </summary>
public sealed class PtvGoogleBooksMetadataCandidate
{
    /// <summary>Gets or sets provider name.</summary>
    [JsonPropertyName("SearchProviderName")]
    public string SearchProviderName { get; set; } = "Google Books";

    /// <summary>Gets or sets provider name using compact PiggieTV casing.</summary>
    [JsonPropertyName("provider")]
    public string Provider { get; set; } = "Google Books";

    /// <summary>Gets or sets a value indicating this result was produced by PiggieTV's native provider.</summary>
    [JsonPropertyName("PtvNativeProvider")]
    public bool PtvNativeProvider { get; set; } = true;

    /// <summary>Gets or sets provider confidence score.</summary>
    [JsonPropertyName("confidence")]
    public double Confidence { get; set; }

    /// <summary>Gets or sets match reason.</summary>
    [JsonPropertyName("matchReason")]
    public string? MatchReason { get; set; }

    /// <summary>Gets or sets volume title.</summary>
    [JsonPropertyName("Name")]
    public string? Name { get; set; }

    /// <summary>Gets or sets original title.</summary>
    [JsonPropertyName("OriginalTitle")]
    public string? OriginalTitle { get; set; }

    /// <summary>Gets or sets overview.</summary>
    [JsonPropertyName("Overview")]
    public string? Overview { get; set; }

    /// <summary>Gets or sets publication year.</summary>
    [JsonPropertyName("ProductionYear")]
    public int? ProductionYear { get; set; }

    /// <summary>Gets or sets premiere/published date.</summary>
    [JsonPropertyName("PremiereDate")]
    public string? PremiereDate { get; set; }

    /// <summary>Gets or sets cover image URL.</summary>
    [JsonPropertyName("ImageUrl")]
    public string? ImageUrl { get; set; }

    /// <summary>Gets or sets canonical provider URL.</summary>
    [JsonPropertyName("Url")]
    public string? Url { get; set; }

    /// <summary>Gets or sets provider ids.</summary>
    [JsonPropertyName("ProviderIds")]
    public Dictionary<string, string> ProviderIds { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Gets or sets genres/categories.</summary>
    [JsonPropertyName("Genres")]
    public List<string> Genres { get; set; } = [];

    /// <summary>Gets or sets tags.</summary>
    [JsonPropertyName("Tags")]
    public List<string> Tags { get; set; } = [];

    /// <summary>Gets or sets people/creators.</summary>
    [JsonPropertyName("People")]
    public List<PtvGoogleBooksPerson> People { get; set; } = [];

    /// <summary>Gets or sets publisher as Jellyfin studio-like metadata.</summary>
    [JsonPropertyName("Studios")]
    public List<PtvGoogleBooksNamedValue> Studios { get; set; } = [];

    /// <summary>Gets or sets publisher.</summary>
    [JsonPropertyName("Publisher")]
    public string? Publisher { get; set; }

    /// <summary>Gets or sets authors.</summary>
    [JsonPropertyName("Authors")]
    public List<string> Authors { get; set; } = [];

    /// <summary>Gets or sets page count.</summary>
    [JsonPropertyName("PageCount")]
    public int? PageCount { get; set; }

    /// <summary>Gets or sets language.</summary>
    [JsonPropertyName("Language")]
    public string? Language { get; set; }
}

/// <summary>
/// Jellyfin person metadata for Google Books creators.
/// </summary>
public sealed class PtvGoogleBooksPerson
{
    /// <summary>Gets or sets person name.</summary>
    [JsonPropertyName("Name")]
    public string Name { get; set; } = string.Empty;

    /// <summary>Gets or sets person type.</summary>
    [JsonPropertyName("Type")]
    public string Type { get; set; } = "Author";
}

/// <summary>
/// Jellyfin name wrapper used by some metadata fields.
/// </summary>
public sealed class PtvGoogleBooksNamedValue
{
    /// <summary>Gets or sets name.</summary>
    [JsonPropertyName("Name")]
    public string Name { get; set; } = string.Empty;
}
