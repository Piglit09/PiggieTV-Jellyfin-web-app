using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Server-side store for the shared PiggieTV featured-content cache.
/// </summary>
public interface IPtvFeaturedContentStore
{
    /// <summary>
    /// Reads the current cache document.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Cache document.</returns>
    Task<PtvFeaturedContentDocument> ReadAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Writes the current cache document.
    /// </summary>
    /// <param name="document">Cache document.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Stored cache document.</returns>
    Task<PtvFeaturedContentDocument> WriteAsync(PtvFeaturedContentDocument document, CancellationToken cancellationToken);

    /// <summary>
    /// Clears the current cache document.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A task representing the clear operation.</returns>
    Task ClearAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Gets store and cache status.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Store status.</returns>
    Task<PtvFeaturedContentStoreStatus> GetStatusAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Validates and normalizes a document without writing it.
    /// </summary>
    /// <param name="document">Cache document.</param>
    /// <returns>Validated cache document.</returns>
    PtvFeaturedContentDocument ValidateDocument(PtvFeaturedContentDocument? document);
}
