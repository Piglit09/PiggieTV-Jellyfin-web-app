namespace Jellyfin.Plugin.PiggieTV.Models;

/// <summary>Administrator-supplied overrides for one bounded Reading identification search.</summary>
public sealed class PtvReadingMetadataSearchRequest
{
    public string? SearchGeneration { get; set; }

    public string ItemId { get; set; } = string.Empty;

    public string? Title { get; set; }

    public string? SeriesTitle { get; set; }

    public string? IssueNumber { get; set; }

    public string? VolumeNumber { get; set; }

    public string? ChapterNumber { get; set; }

    public int? Year { get; set; }

    /// <summary>Comic run start year. Prefer this over <see cref="Year"/> for comic searches.</summary>
    public int? SeriesStartYear { get; set; }

    /// <summary>Issue cover/publication year, distinct from the comic run start year.</summary>
    public int? IssuePublicationYear { get; set; }

    /// <summary>Issue cover/publication date when known.</summary>
    public DateTimeOffset? IssuePublicationDate { get; set; }

    public string? Author { get; set; }

    public string? Isbn { get; set; }

    public PtvReadingMediaClass? MediaClass { get; set; }

    /// <summary>Stable provider id or <c>auto</c>.</summary>
    public string? Provider { get; set; }

    /// <summary>Direct immutable provider identity. When present, fuzzy search is bypassed.</summary>
    public string? ProviderId { get; set; }
}

/// <summary>One provider surfaced by the native Reading identification service.</summary>
public sealed class PtvReadingMetadataProviderStatusResponse
{
    public string Provider { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;

    public PtvReadingProviderState State { get; set; } = PtvReadingProviderState.Unknown;

    public string? Message { get; set; }

    public int? RetryAfterSeconds { get; set; }
}

/// <summary>Safe provider inventory used to populate the Identify provider filter.</summary>
public sealed class PtvReadingMetadataProvidersResponse
{
    public List<PtvReadingMetadataProviderStatusResponse> Providers { get; set; } = [];
}

/// <summary>Compact, path-free diagnostics describing local evidence used for this search.</summary>
public sealed class PtvReadingLocalMetadataSummary
{
    public PtvReadingLocalInspectionState State { get; set; } = PtvReadingLocalInspectionState.NotFound;

    public List<string> Sources { get; set; } = [];

    public List<string> Warnings { get; set; } = [];
}

/// <summary>Provider-neutral, independently settled Reading identification response.</summary>
public sealed class PtvReadingMetadataSearchResponse
{
    public string SearchGeneration { get; set; } = string.Empty;

    /// <summary>Separate bounded archive and source identities, before query merging.</summary>
    public PtvReadingIdentitySources IdentitySources { get; init; } = new();

    public required PtvStructuredMetadataQuery Query { get; init; }

    public PtvReadingLocalMetadataSummary LocalMetadata { get; init; } = new();

    public List<PtvReadingProviderSearchResult> ProviderResults { get; set; } = [];

    public List<PtvNormalizedMetadataCandidate> Candidates { get; set; } = [];
}

/// <summary>User-safe Reading identification service exception.</summary>
public sealed class PtvReadingMetadataServiceException : Exception
{
    public PtvReadingMetadataServiceException(string code, string message)
        : base(message)
    {
        Code = code;
    }

    public string Code { get; }
}

/// <summary>Read-only fresh identity assessment request; item paths and administrator IDs are server-owned.</summary>
public sealed class PtvReadingIdentityReassessRequest
{
    public string ItemId { get; set; } = string.Empty;
    public string CandidateContext { get; set; } = string.Empty;
    public string? DisplayedRevision { get; set; }
}
