using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>
/// Generation-safe indexed Metadata Quality persistence. The legacy JSON store
/// remains the migration/reference source during the v2 transition.
/// </summary>
public interface IPtvMetadataQualityIndexedStore
{
    Task EnsureReadyAsync(CancellationToken cancellationToken = default);

    Task<PtvMetadataQualityIndexedSummary> ReadSummaryAsync(CancellationToken cancellationToken = default);

    Task<PtvMetadataQualityIndexedPage> QueryResultsAsync(
        PtvMetadataQualityResultQuery query,
        CancellationToken cancellationToken = default);

    Task<PtvMetadataQualityResult?> ReadResultAsync(Guid itemId, CancellationToken cancellationToken = default);

    Task<PtvMetadataQualityResult?> ResolveAsync(
        Guid itemId,
        string action,
        CancellationToken cancellationToken = default);

    /// <summary>Builds and atomically installs a validated index from the retained JSON source.</summary>
    Task RebuildFromLegacyAsync(CancellationToken cancellationToken = default);

    Task<PtvMetadataQualityGenerationHandle> BeginGenerationAsync(
        PtvMetadataQualityScanRun run,
        bool resetAllResults,
        IReadOnlyCollection<Guid> resetLibraryIds,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyDictionary<Guid, PtvMetadataQualityScanBaseline>> ReadScanBaselinesAsync(
        Guid generationId,
        IReadOnlyCollection<Guid> itemIds,
        CancellationToken cancellationToken = default);

    Task<Dictionary<string, Guid>> ReadCurrentProviderIdentityMapAsync(
        Guid generationId,
        CancellationToken cancellationToken = default);

    Task<bool> HasResultsInLibrariesAsync(
        Guid generationId,
        IReadOnlyCollection<Guid> libraryIds,
        CancellationToken cancellationToken = default);

    Task WriteGenerationBatchAsync(
        Guid generationId,
        PtvMetadataQualityScanRun run,
        IReadOnlyDictionary<string, PtvMetadataQualityResult> changedResults,
        IReadOnlyCollection<Guid> seenItemIds,
        CancellationToken cancellationToken = default);

    Task CompleteGenerationAsync(
        Guid generationId,
        PtvMetadataQualityScanRun run,
        CancellationToken cancellationToken = default);

    Task FailGenerationAsync(
        Guid generationId,
        PtvMetadataQualityScanRun run,
        CancellationToken cancellationToken = default);

    Task<string?> GetErrorCodeAsync(CancellationToken cancellationToken = default);
}

/// <summary>Immutable identity for one generation under construction.</summary>
public sealed record PtvMetadataQualityGenerationHandle(Guid GenerationId);

/// <summary>Compact prior-result state required by the incremental scanner.</summary>
public sealed class PtvMetadataQualityScanBaseline
{
    public Guid ItemId { get; init; }

    public string ScanFingerprint { get; init; } = string.Empty;

    public string ScannerVersion { get; init; } = string.Empty;

    public string RuleVersion { get; init; } = string.Empty;

    public string Status { get; init; } = PtvMetadataQualityStatuses.Healthy;

    public bool Dismissed { get; init; }

    public DateTimeOffset? DismissedAt { get; init; }

    public string? DismissedFingerprint { get; init; }

    public string? DismissedReasonSignature { get; init; }

    public PtvMetadataQualityResolution? Resolution { get; init; }

    public PtvMetadataQualityResult ToHistoryResult() => new()
    {
        ItemId = ItemId,
        ScanFingerprint = ScanFingerprint,
        ScannerVersion = ScannerVersion,
        RuleVersion = RuleVersion,
        Status = Status,
        Dismissed = Dismissed,
        DismissedAt = DismissedAt,
        DismissedFingerprint = DismissedFingerprint,
        DismissedReasonSignature = DismissedReasonSignature,
        Resolution = PtvMetadataQualityProjection.CloneResolution(Resolution)
    };
}

/// <summary>Indexed aggregate for the active immutable generation.</summary>
public sealed class PtvMetadataQualityIndexedSummary
{
    public Guid GenerationId { get; init; }

    public PtvMetadataQualityCounts Counts { get; init; } = new();

    public DateTimeOffset? LastScanAt { get; init; }

    public string RuleVersion { get; init; } = PtvMetadataQualityConstants.RuleVersion;

    public string ScannerVersion { get; init; } = PtvMetadataQualityConstants.ScannerVersion;

    public PtvMetadataQualityScanRun? LatestRun { get; init; }

    public string? CompatibilityFingerprint { get; init; }

    public PtvMetadataQualityRequestDiagnostics Diagnostics { get; init; } = new();
}

/// <summary>Bounded indexed page plus the exact post-filter count.</summary>
public sealed class PtvMetadataQualityIndexedPage
{
    public int TotalRecordCount { get; init; }

    public int StartIndex { get; init; }

    public int Limit { get; init; }

    public List<PtvMetadataQualityResultSummary> Items { get; init; } = [];

    public PtvMetadataQualityRequestDiagnostics Diagnostics { get; init; } = new();
}
