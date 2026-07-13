using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Looks up reading metadata candidates through server-side Google Books.
/// </summary>
public interface IPtvGoogleBooksMetadataLookupService
{
    /// <summary>
    /// Searches Google Books for reading metadata candidates.
    /// </summary>
    /// <param name="request">Lookup request.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Lookup response.</returns>
    Task<PtvGoogleBooksMetadataLookupResponse> SearchAsync(
        PtvGoogleBooksMetadataLookupRequest request,
        CancellationToken cancellationToken);
}
