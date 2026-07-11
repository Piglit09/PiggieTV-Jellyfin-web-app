using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Looks up music metadata candidates through server-side providers.
/// </summary>
public interface IPtvMusicMetadataLookupService
{
    /// <summary>
    /// Searches configured music metadata providers.
    /// </summary>
    /// <param name="request">Lookup request.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Lookup response.</returns>
    Task<PtvMusicMetadataLookupResponse> SearchAsync(
        PtvMusicMetadataLookupRequest request,
        CancellationToken cancellationToken);
}
