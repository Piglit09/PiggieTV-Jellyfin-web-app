using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Durable versioned Metadata Quality state and settings.</summary>
public interface IPtvMetadataQualityStore
{
    Task<PtvMetadataQualityDocument> ReadAsync(CancellationToken cancellationToken = default);

    Task<PtvMetadataQualityDocument> WriteAsync(PtvMetadataQualityDocument document, CancellationToken cancellationToken = default);

    Task<PtvMetadataQualityDocument> UpdateAsync(
        Func<PtvMetadataQualityDocument, PtvMetadataQualityDocument> update,
        CancellationToken cancellationToken = default);

    Task<PtvMetadataQualitySettings> ReadSettingsAsync(CancellationToken cancellationToken = default);

    Task<PtvMetadataQualitySettings> WriteSettingsAsync(PtvMetadataQualitySettings settings, CancellationToken cancellationToken = default);

    Task<PtvMetadataQualitySettings> UpdateSettingsAsync(
        long expectedRevision,
        Func<PtvMetadataQualitySettings, PtvMetadataQualitySettings> update,
        CancellationToken cancellationToken = default);

    Task<string?> GetErrorCodeAsync(CancellationToken cancellationToken = default);
}

internal interface IPtvMetadataQualityDiagnosticStore
{
    Task<PtvMetadataQualityStoreReadResult> ReadWithDiagnosticsAsync(CancellationToken cancellationToken = default);
}

internal sealed record PtvMetadataQualityStoreReadResult(
    PtvMetadataQualityDocument Document,
    PtvMetadataQualityStoreReadDiagnostics Diagnostics);

internal sealed class PtvMetadataQualityStoreReadDiagnostics
{
    public long FileBytes { get; init; }

    public int PersistedResults { get; init; }

    public double TotalMs { get; init; }

    public Dictionary<string, double> Stages { get; init; } = new(StringComparer.Ordinal);

    public Dictionary<string, long> Operations { get; init; } = new(StringComparer.Ordinal);
}

/// <summary>Stable safe Metadata Quality persistence failure.</summary>
public sealed class PtvMetadataQualityStoreException : Exception
{
    public PtvMetadataQualityStoreException(string code, string message, Exception? innerException = null)
        : base(message, innerException)
    {
        Code = code;
    }

    public string Code { get; }
}
