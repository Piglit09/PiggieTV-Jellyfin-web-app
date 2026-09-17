using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Applies the shared PiggieTV recommendation policy.</summary>
public interface IPtvRecommendationPolicyService
{
    /// <summary>Ranks and sequences client-supplied candidates.</summary>
    /// <param name="request">Versioned request.</param>
    /// <returns>Versioned policy response.</returns>
    PtvRecommendationPolicyResponse Rank(PtvRecommendationPolicyRequest request);
}
