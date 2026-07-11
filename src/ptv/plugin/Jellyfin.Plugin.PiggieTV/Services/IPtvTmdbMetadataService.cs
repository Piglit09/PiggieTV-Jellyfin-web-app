using Jellyfin.Plugin.PiggieTV.Models;
using MediaBrowser.Controller.Entities;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Provides optional server-side TMDb metadata enrichment for PiggieTV row matching.
/// </summary>
public interface IPtvTmdbMetadataService
{
    /// <summary>
    /// Gets a value indicating whether TMDb enrichment has a credential available.
    /// </summary>
    bool IsConfigured { get; }

    /// <summary>
    /// Gets TMDb enrichment facts for Jellyfin items that have TMDb provider ids.
    /// </summary>
    /// <param name="items">Jellyfin items to enrich.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>TMDb facts keyed by Jellyfin item id.</returns>
    Task<IReadOnlyDictionary<Guid, PtvTmdbItemFacts>> GetFactsAsync(
        IEnumerable<BaseItem> items,
        CancellationToken cancellationToken);

    /// <summary>
    /// Validates the configured TMDb credential without enriching any Jellyfin items.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>TMDb metadata status after validation.</returns>
    Task<PtvTmdbMetadataStatus> ValidateCredentialsAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Gets the current TMDb enrichment status.
    /// </summary>
    /// <returns>TMDb enrichment status.</returns>
    PtvTmdbMetadataStatus GetStatus();
}
