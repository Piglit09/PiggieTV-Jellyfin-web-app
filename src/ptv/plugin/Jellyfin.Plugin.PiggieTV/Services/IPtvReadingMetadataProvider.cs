using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Provider-neutral contract for Reading metadata identification.</summary>
public interface IPtvReadingMetadataProvider
{
    /// <summary>Stable provider identifier used in API and persistence contracts.</summary>
    string Id { get; }

    /// <summary>Human-readable provider name.</summary>
    string DisplayName { get; }

    /// <summary>Returns whether this provider is appropriate for the supplied local context.</summary>
    bool Supports(PtvMetadataSearchContext context);

    /// <summary>Searches using a parsed, provider-neutral query.</summary>
    Task<PtvReadingProviderSearchResult> SearchAsync(
        PtvStructuredMetadataQuery query,
        CancellationToken cancellationToken);

    /// <summary>Resolves one immutable provider identity without fuzzy title matching.</summary>
    Task<PtvNormalizedMetadataCandidate?> GetByIdAsync(
        string providerId,
        CancellationToken cancellationToken);

    /// <summary>Returns a safe, inexpensive provider health snapshot.</summary>
    Task<PtvReadingProviderStatus> GetStatusAsync(CancellationToken cancellationToken);
}
