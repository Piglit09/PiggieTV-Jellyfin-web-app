using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Bounded centralized persistent diagnostics writer.</summary>
public interface IPtvRollingDiagnosticsWriter
{
    /// <summary>Queues a sanitized persistent diagnostic event without blocking a request thread.</summary>
    void Enqueue(PtvRollingDiagnosticEvent diagnosticEvent);

    /// <summary>Returns current bounded storage health.</summary>
    PtvDiagnosticsStorageStatus GetStatus();

    /// <summary>Flushes queued events.</summary>
    Task FlushAsync(CancellationToken cancellationToken = default);

    /// <summary>Forces one safe log rotation.</summary>
    Task RotateAsync(CancellationToken cancellationToken = default);

    /// <summary>Deletes only recognized rolling log files.</summary>
    Task<PtvDiagnosticsStorageActionResult> ClearAsync(CancellationToken cancellationToken = default);

    /// <summary>Archives and removes only recognized legacy diagnostic files.</summary>
    Task<PtvDiagnosticsStorageActionResult> ConsolidateLegacyAsync(bool createArchive, CancellationToken cancellationToken = default);

    /// <summary>Reads the active JSONL file after flushing.</summary>
    Task<byte[]> ReadActiveLogAsync(CancellationToken cancellationToken = default);

    /// <summary>Builds an in-memory diagnostic bundle without leaving a temporary ZIP behind.</summary>
    Task<byte[]> CreateBundleAsync(CancellationToken cancellationToken = default);
}
