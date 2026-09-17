using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Coordinates observational Metadata Quality scans and review state.</summary>
public interface IPtvMetadataQualityService
{
    Task<PtvMetadataQualitySummaryResponse> GetSummaryAsync(CancellationToken cancellationToken = default);

    Task<PtvMetadataQualityStatusResponse> GetStatusAsync(CancellationToken cancellationToken = default);

    Task<PtvMetadataQualityResultsResponse> GetResultsAsync(PtvMetadataQualityResultQuery query, CancellationToken cancellationToken = default);

    Task<PtvMetadataQualityResult?> GetResultAsync(Guid itemId, CancellationToken cancellationToken = default);

    Task<PtvMetadataQualitySummaryResponse> StartScanAsync(PtvMetadataQualityScanRequest request, CancellationToken cancellationToken = default);

    Task<PtvMetadataQualitySummaryResponse> CancelScanAsync(CancellationToken cancellationToken = default);

    Task<PtvMetadataQualityResult?> ResolveAsync(Guid itemId, string action, CancellationToken cancellationToken = default);

    /// <summary>Rebuilds the derived Metadata Quality index from its retained authoritative migration source.</summary>
    Task<PtvMetadataQualitySummaryResponse> RebuildIndexAsync(CancellationToken cancellationToken = default);

    Task<PtvMetadataQualitySettings> GetSettingsAsync(CancellationToken cancellationToken = default);

    Task<PtvMetadataQualitySettings> SaveSettingsAsync(PtvMetadataQualitySettings settings, CancellationToken cancellationToken = default);

    Task<PtvMetadataAiConnectionTestResponse> TestAiConnectionAsync(
        PtvMetadataAiConnectionTestRequest request,
        CancellationToken cancellationToken = default);

    Task RunScheduledScanAsync(IProgress<double> progress, CancellationToken cancellationToken);
}

/// <summary>Stable safe Metadata Quality service failure.</summary>
public sealed class PtvMetadataQualityServiceException : Exception
{
    public PtvMetadataQualityServiceException(string code, string message, Exception? innerException = null)
        : base(message, innerException)
    {
        Code = code;
    }

    public string Code { get; }
}
