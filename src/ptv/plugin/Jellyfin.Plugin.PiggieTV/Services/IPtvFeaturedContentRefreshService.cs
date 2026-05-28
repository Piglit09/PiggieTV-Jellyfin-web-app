using Jellyfin.Plugin.PiggieTV.Models;
using Jellyfin.Plugin.PiggieTV.Configuration;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Coordinates server-side PiggieTV featured-content refreshes.
/// </summary>
public interface IPtvFeaturedContentRefreshService
{
    /// <summary>
    /// Gets refresh worker status, combined with the current store status when available.
    /// </summary>
    /// <param name="storeStatus">Current cache store status.</param>
    /// <returns>Refresh status.</returns>
    PtvFeaturedContentRefreshStatus GetRefreshStatus(PtvFeaturedContentStoreStatus? storeStatus = null);

    /// <summary>
    /// Refreshes the shared featured-content cache when missing or expired.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The cache store status after the attempt.</returns>
    Task<PtvFeaturedContentStoreStatus> RefreshIfNeededAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Previews configured homepage rows without writing the featured-content cache.
    /// </summary>
    /// <param name="settings">Optional row-builder settings override.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>Row preview response.</returns>
    Task<PtvRowPreviewResponse> PreviewRowsAsync(RowBuilderSettings? settings, CancellationToken cancellationToken);

    /// <summary>
    /// Triggers a featured-content cache refresh.
    /// </summary>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>The cache store status after the attempt.</returns>
    Task<PtvFeaturedContentStoreStatus> RefreshAsync(CancellationToken cancellationToken);
}
