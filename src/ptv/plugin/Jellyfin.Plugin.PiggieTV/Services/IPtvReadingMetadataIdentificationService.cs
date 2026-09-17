using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Coordinates local parsing, provider routing, scoring, and safe candidate projection.</summary>
public interface IPtvReadingMetadataIdentificationService
{
    Task<PtvReadingMetadataProvidersResponse> GetProvidersAsync(CancellationToken cancellationToken);

    Task<PtvReadingMetadataSearchResponse> SearchAsync(
        PtvReadingMetadataSearchRequest request,
        CancellationToken cancellationToken);
}
