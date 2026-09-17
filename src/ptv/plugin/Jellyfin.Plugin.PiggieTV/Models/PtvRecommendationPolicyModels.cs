using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>Recommendation surfaces with distinct familiarity and discovery intent.</summary>
public enum PtvRecommendationSurface
{
    /// <summary>General Home recommendations.</summary>
    [JsonStringEnumMemberName("home")]
    Home,

    /// <summary>Personalized, mostly familiar listening.</summary>
    [JsonStringEnumMemberName("made-for-you")]
    MadeForYou,

    /// <summary>Seed-focused radio.</summary>
    [JsonStringEnumMemberName("radio")]
    Radio,

    /// <summary>Related content for a selected item.</summary>
    [JsonStringEnumMemberName("related")]
    Related,

    /// <summary>Novel discovery listening.</summary>
    [JsonStringEnumMemberName("discovery")]
    Discovery
}

/// <summary>Seed metadata used only for bounded affinity scoring.</summary>
public sealed class PtvRecommendationPolicySeed
{
    /// <summary>Gets or sets the opaque seed item id.</summary>
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    /// <summary>Gets or sets opaque artist ids.</summary>
    [JsonPropertyName("artistIds")]
    public List<string> ArtistIds { get; set; } = [];

    /// <summary>Gets or sets the opaque album id.</summary>
    [JsonPropertyName("albumId")]
    public string? AlbumId { get; set; }

    /// <summary>Gets or sets normalized genre labels.</summary>
    [JsonPropertyName("genres")]
    public List<string> Genres { get; set; } = [];
}

/// <summary>Candidate supplied by a PiggieTV client for authoritative sequencing.</summary>
public sealed class PtvRecommendationPolicyCandidate
{
    /// <summary>Gets or sets the item id.</summary>
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    /// <summary>Gets or sets the item title.</summary>
    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    /// <summary>Gets or sets the normalized media type.</summary>
    [JsonPropertyName("mediaType")]
    public string MediaType { get; set; } = "unknown";

    /// <summary>Gets or sets the candidate source.</summary>
    [JsonPropertyName("source")]
    public string Source { get; set; } = "jellyfin";

    /// <summary>Gets or sets affinity, discovery, or mixed classification.</summary>
    [JsonPropertyName("classification")]
    public string Classification { get; set; } = "mixed";

    /// <summary>Gets or sets the client candidate score.</summary>
    [JsonPropertyName("baseScore")]
    public double BaseScore { get; set; }

    /// <summary>Gets or sets opaque artist ids.</summary>
    [JsonPropertyName("artistIds")]
    public List<string> ArtistIds { get; set; } = [];

    /// <summary>Gets or sets the opaque album id.</summary>
    [JsonPropertyName("albumId")]
    public string? AlbumId { get; set; }

    /// <summary>Gets or sets normalized genre labels.</summary>
    [JsonPropertyName("genres")]
    public List<string> Genres { get; set; } = [];

    /// <summary>Gets or sets a value indicating whether the item is familiar to the user.</summary>
    [JsonPropertyName("familiar")]
    public bool Familiar { get; set; }
}

/// <summary>Versioned policy request.</summary>
public sealed class PtvRecommendationPolicyRequest
{
    /// <summary>Gets or sets the additive contract version.</summary>
    [JsonPropertyName("contractVersion")]
    public string ContractVersion { get; set; } = "2.0";

    /// <summary>Gets or sets the policy version.</summary>
    [JsonPropertyName("policyVersion")]
    public string PolicyVersion { get; set; } = "music-premium-v2";

    /// <summary>Gets or sets the requested algorithm id.</summary>
    [JsonPropertyName("algorithmId")]
    public string? AlgorithmId { get; set; }

    /// <summary>Gets or sets the request correlation id.</summary>
    [JsonPropertyName("requestId")]
    public string? RequestId { get; set; }

    /// <summary>Gets or sets the deterministic rollout cohort.</summary>
    [JsonPropertyName("cohort")]
    public string? Cohort { get; set; }

    /// <summary>Gets or sets the recommendation surface.</summary>
    [JsonPropertyName("surface")]
    [JsonConverter(typeof(JsonStringEnumConverter<PtvRecommendationSurface>))]
    public PtvRecommendationSurface Surface { get; set; } = PtvRecommendationSurface.Radio;

    /// <summary>Gets or sets the server scope.</summary>
    [JsonPropertyName("serverId")]
    public string ServerId { get; set; } = string.Empty;

    /// <summary>Gets or sets the user scope.</summary>
    [JsonPropertyName("userId")]
    public string UserId { get; set; } = string.Empty;

    /// <summary>Gets or sets the requested result limit.</summary>
    [JsonPropertyName("limit")]
    public int Limit { get; set; } = 50;

    /// <summary>Gets or sets optional seed metadata.</summary>
    [JsonPropertyName("seed")]
    public PtvRecommendationPolicySeed? Seed { get; set; }

    /// <summary>Gets or sets candidate items.</summary>
    [JsonPropertyName("candidates")]
    public List<PtvRecommendationPolicyCandidate> Candidates { get; set; } = [];
}

/// <summary>Policy constraints returned to every client for diagnostics and parity tests.</summary>
public sealed class PtvRecommendationPolicyConstraints
{
    /// <summary>Gets or sets the target discovery share.</summary>
    [JsonPropertyName("discoveryTarget")]
    public double DiscoveryTarget { get; set; }

    /// <summary>Gets or sets the target familiar share.</summary>
    [JsonPropertyName("familiarTarget")]
    public double FamiliarTarget { get; set; }

    /// <summary>Gets or sets the artist cap.</summary>
    [JsonPropertyName("maxItemsPerArtist")]
    public int MaxItemsPerArtist { get; set; }

    /// <summary>Gets or sets the album cap.</summary>
    [JsonPropertyName("maxItemsPerAlbum")]
    public int MaxItemsPerAlbum { get; set; }

    /// <summary>Gets or sets the artist run cap.</summary>
    [JsonPropertyName("maxConsecutiveArtist")]
    public int MaxConsecutiveArtist { get; set; }

    /// <summary>Gets or sets the album run cap.</summary>
    [JsonPropertyName("maxConsecutiveAlbum")]
    public int MaxConsecutiveAlbum { get; set; }
}

/// <summary>Ranked recommendation item with stable policy evidence.</summary>
public sealed class PtvRankedRecommendationPolicyItem
{
    /// <summary>Gets or sets the item id.</summary>
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    /// <summary>Gets or sets the title.</summary>
    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    /// <summary>Gets or sets the media type.</summary>
    [JsonPropertyName("mediaType")]
    public string MediaType { get; set; } = "unknown";

    /// <summary>Gets or sets the source.</summary>
    [JsonPropertyName("source")]
    public string Source { get; set; } = "jellyfin";

    /// <summary>Gets or sets the classification.</summary>
    [JsonPropertyName("classification")]
    public string Classification { get; set; } = "mixed";

    /// <summary>Gets or sets one-based sequence rank.</summary>
    [JsonPropertyName("rank")]
    public int Rank { get; set; }

    /// <summary>Gets or sets final score.</summary>
    [JsonPropertyName("score")]
    public double Score { get; set; }

    /// <summary>Gets or sets transition contribution.</summary>
    [JsonPropertyName("transitionScore")]
    public double TransitionScore { get; set; }

    /// <summary>Gets or sets stable reason codes.</summary>
    [JsonPropertyName("reasons")]
    public List<string> Reasons { get; set; } = [];
}

/// <summary>Versioned authoritative ranking response.</summary>
public sealed class PtvRecommendationPolicyResponse
{
    /// <summary>Gets or sets the contract version.</summary>
    [JsonPropertyName("contractVersion")]
    public string ContractVersion { get; set; } = "2.0";

    /// <summary>Gets or sets the policy version.</summary>
    [JsonPropertyName("policyVersion")]
    public string PolicyVersion { get; set; } = "music-premium-v2";

    /// <summary>Gets or sets the algorithm id.</summary>
    [JsonPropertyName("algorithmId")]
    public string AlgorithmId { get; set; } = "ptv-diversified-sequence-v2";

    /// <summary>Gets or sets request correlation id.</summary>
    [JsonPropertyName("requestId")]
    public string RequestId { get; set; } = string.Empty;

    /// <summary>Gets or sets rollout cohort.</summary>
    [JsonPropertyName("cohort")]
    public string Cohort { get; set; } = "default";

    /// <summary>Gets or sets surface.</summary>
    [JsonPropertyName("surface")]
    [JsonConverter(typeof(JsonStringEnumConverter<PtvRecommendationSurface>))]
    public PtvRecommendationSurface Surface { get; set; }

    /// <summary>Gets or sets generation timestamp.</summary>
    [JsonPropertyName("generatedAt")]
    public DateTimeOffset GeneratedAt { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>Gets or sets generation latency.</summary>
    [JsonPropertyName("generationLatencyMs")]
    public double GenerationLatencyMs { get; set; }

    /// <summary>Gets or sets a bounded fallback reason.</summary>
    [JsonPropertyName("fallbackReason")]
    public string? FallbackReason { get; set; }

    /// <summary>Gets or sets applied policy constraints.</summary>
    [JsonPropertyName("constraints")]
    public PtvRecommendationPolicyConstraints Constraints { get; set; } = new();

    /// <summary>Gets or sets ranked items.</summary>
    [JsonPropertyName("items")]
    public List<PtvRankedRecommendationPolicyItem> Items { get; set; } = [];
}
