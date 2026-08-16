using Jellyfin.Plugin.PiggieTV.Models;

namespace Jellyfin.Plugin.PiggieTV.Services;

/// <summary>Validated account backup, retention, verification, and restore boundary.</summary>
public interface IPtvAccountBackupService
{
    /// <summary>Creates a validated account backup through the shared task service.</summary>
    Task<PtvAccountBackupOperationResponse> CreateBackupAsync(
        string reason,
        CancellationToken cancellationToken = default);

    /// <summary>Validates an existing backup without modifying production data.</summary>
    Task<PtvAccountBackupOperationResponse> VerifyBackupAsync(
        string backupId,
        CancellationToken cancellationToken = default);

    /// <summary>Validates and optionally restores a backup after a pre-restore backup.</summary>
    Task<PtvAccountBackupOperationResponse> RestoreBackupAsync(
        string backupId,
        bool dryRun,
        CancellationToken cancellationToken = default);

    /// <summary>Gets persisted count-only backup task status.</summary>
    Task<PtvAccountBackupStatus> GetStatusAsync(CancellationToken cancellationToken = default);
}
