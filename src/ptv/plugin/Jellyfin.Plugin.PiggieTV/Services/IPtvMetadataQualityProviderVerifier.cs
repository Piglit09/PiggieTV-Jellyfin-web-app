using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Performs bounded, observational metadata-provider searches for suspicious items.
/// </summary>
public interface IPtvMetadataQualityProviderVerifier
{
    /// <summary>
    /// Searches the server's configured metadata providers without applying any result.
    /// </summary>
    /// <param name="request">Minimal item identity used for the lookup.</param>
    /// <param name="budget">Per-scan logical request budget.</param>
    /// <param name="cancellationToken">Cancellation token.</param>
    /// <returns>A bounded set of server-verified candidates.</returns>
    Task<PtvMetadataProviderVerificationResult> VerifyAsync(
        PtvMetadataProviderVerificationRequest request,
        PtvMetadataProviderVerificationBudget budget,
        CancellationToken cancellationToken);
}
